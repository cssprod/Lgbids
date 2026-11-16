import { DateTime } from 'luxon';
import {
  sourceConfigSchema,
  type Application,
  type ApplicationStatus,
  type AutomationSettings,
  type EmailSettings,
  type Profile,
  type RegionSettings,
  type RunRecord,
  type RunStats,
  type SourceConfig,
  type SourceRecord,
  type SourceRunStat,
} from '../../shared/schemas.js';
import { assessReadiness, draftApplication, mergeChecklist } from '../applications/draft.js';
import { buildPackagePdf } from '../applications/pdf.js';
import { packageFilename } from '../applications/templates.js';
import type { AppDeps, ApplicationPatch, DraftContext, OpportunityRecord, OutgoingMail, Pipeline, SendResult, SourceTestResult } from '../contracts.js';
import { HttpError, type HttpClient } from '../http/client.js';
import { analyse, type AnalyseInput } from '../matching/analyse.js';
import { mightBeRelevant } from '../matching/relevance.js';
import { connectorFor, listSource } from '../sources/registry.js';
import type { RawOpportunity } from '../sources/types.js';
import { buildSubmissionMail, emailConfigured } from '../submission/email.js';
import { closingDeadline, formatLocal, nowIso } from '../util/dates.js';
import { isEmail, parseEmailList } from '../util/text.js';
import { readDocuments } from './documents.js';
import { sendDigest } from './notify.js';

/**
 * One run of the whole job: read every bid source, store what is new, score
 * it, draft submissions for the good ones and — only in fully automatic mode,
 * and only when every guardrail passes — send the e-mail ones.
 *
 * `send` is the single place anything leaves the system. Every check it makes
 * is repeated at the moment of sending, against fresh data, because the
 * opportunity or the profile may have changed since the draft was made.
 */

/** Notice pages opened per source per run, so one big listing cannot stall a run. */
export const MAX_DETAILS_PER_SOURCE = 40;

const CRASHED_WHILE_SENDING = 'The app stopped while this was being sent. Check your sent mail before sending again.';

/** Statuses a draft can still move between on its own. */
const OPEN_DRAFT: ApplicationStatus[] = ['needs_input', 'ready'];
/** Statuses that turn into "expired" when the opportunity closes. */
const UNSENT: ApplicationStatus[] = ['needs_input', 'ready', 'failed'];

interface Snapshot {
  automation: AutomationSettings;
  region: RegionSettings;
  profile: Profile;
  email: EmailSettings;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function quoted(title: string): string {
  return `“${title || 'Untitled notice'}”`;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function sameAddress(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export function createPipeline(deps: AppDeps): Pipeline {
  const { store, settings, config } = deps;
  const zone = config.timeZone;
  let running = false;

  const snapshot = (): Snapshot => ({
    automation: settings.getAutomation(),
    region: settings.getRegion(),
    profile: settings.getProfile(),
    email: settings.getEmail(),
  });

  const draftContext = (snap: Snapshot, now: Date): DraftContext => ({
    profile: snap.profile,
    email: snap.email,
    documents: store.listDocuments(),
    now,
    zone,
  });

  const event = (
    level: 'info' | 'warn' | 'error',
    kind: string,
    message: string,
    refs: { opportunityId?: number | null; applicationId?: number | null; runId?: number | null } = {},
  ) => {
    try {
      store.addEvent(
        { level, kind, message, opportunityId: refs.opportunityId ?? null, applicationId: refs.applicationId ?? null, runId: refs.runId ?? null },
        deps.now(),
      );
    } catch {
      // The activity log must never be the reason a run or a send fails.
    }
  };

  // A submission left "sending" means the app stopped mid-send. Whether the
  // mail went out is unknown, so it is never sent again without a person.
  for (const app of store.listApplications({ status: ['sending'] })) {
    store.updateApplication(app.id, { status: 'failed', error: CRASHED_WHILE_SENDING }, deps.now());
    event('warn', 'send_interrupted', `The app stopped while sending the submission for ${quoted(app.opportunity?.title ?? '')}. Check your sent mail before sending it again.`, {
      opportunityId: app.opportunityId,
      applicationId: app.id,
    });
  }

  const sourceConfigs = (): Map<string, SourceConfig> => new Map(store.listSources().map((s) => [s.id, s.config]));

  function analyseInput(opp: OpportunityRecord, cfg: SourceConfig): AnalyseInput {
    return {
      title: opp.title,
      organization: opp.organization,
      description: opp.description,
      location: opp.location,
      categories: opp.categories,
      noticeTypeHint: opp.noticeTypeHint,
      closesAt: opp.closesAt,
      closesAtPrecision: opp.closesAtPrecision,
      status: opp.status,
      url: opp.url,
      documentText: opp.documentText,
      localSource: cfg.localBuyer,
      bcSource: opp.bcSource || cfg.localBuyer || cfg.bcOnly,
      sourceSubmission: cfg.defaultSubmission,
    };
  }

  /** Score one row and save the result. Returns the re-read row. */
  function analyseOne(opp: OpportunityRecord, snap: Snapshot, configs: Map<string, SourceConfig>, now: Date): OpportunityRecord {
    const cfg = configs.get(opp.sourceId) ?? sourceConfigSchema.parse({});
    const result = analyse(analyseInput(opp, cfg), { profile: snap.profile, automation: snap.automation, region: snap.region, now, zone });
    const alsoListed = store.duplicatesOf(opp.id).map((d) => ({ source: d.sourceName, url: d.url }));
    store.saveAnalysis(
      opp.id,
      {
        noticeType: result.noticeType,
        score: result.score,
        decision: result.decision,
        analysis: { ...result.analysis, alsoListed },
        submissionMethod: result.facts.submission.method,
        submissionEmail: result.facts.submission.email,
        submissionUrl: result.facts.submission.url,
        contactEmail: result.facts.contactEmail || undefined,
      },
      now,
    );
    return store.getOpportunity(opp.id) ?? opp;
  }

  /** Rebuild an untouched draft from the current notice and profile, keeping the user's ticks, price and notes. */
  function rebuildPatch(app: Application, opp: OpportunityRecord, ctx: DraftContext): ApplicationPatch {
    const draft = draftApplication(opp, ctx);
    const checklist = mergeChecklist(app.checklist, draft.checklist);
    const merged = { ...app, channel: draft.channel, toEmail: draft.toEmail, subject: draft.subject, body: draft.body, includeRates: draft.includeRates, checklist };
    const readiness = assessReadiness(merged, opp, ctx);
    return {
      channel: draft.channel,
      toEmail: draft.toEmail,
      ccEmail: app.ccEmail,
      subject: draft.subject,
      body: draft.body,
      includeRates: draft.includeRates,
      checklist,
      documentIds: draft.documentIds,
      status: readiness.status,
      missing: readiness.missing,
    };
  }

  /** Recompute what is missing; only ever moves between "needs input" and "ready". */
  function reassessApp(app: Application, opp: OpportunityRecord, ctx: DraftContext, now: Date): Application {
    if (!OPEN_DRAFT.includes(app.status)) return app;
    const readiness = assessReadiness(app, opp, ctx);
    if (readiness.status === app.status && JSON.stringify(readiness.missing) === JSON.stringify(app.missing)) return app;
    return store.updateApplication(app.id, { status: readiness.status, missing: readiness.missing }, now) ?? app;
  }

  function createDraft(opp: OpportunityRecord, ctx: DraftContext, autoGenerated: boolean, now: Date, runId: number | null): Application {
    const draft = draftApplication(opp, ctx);
    const app = store.createApplication({ ...draft, opportunityId: opp.id, autoGenerated }, now);
    const next =
      app.status === 'ready'
        ? app.channel === 'email'
          ? 'It is ready for you to approve and send.'
          : 'It is ready; upload or deliver it as the notice asks.'
        : 'It needs your input before it can go out.';
    event('info', 'drafted', `Drafted a submission for ${quoted(opp.title)}. ${next}`, { opportunityId: opp.id, applicationId: app.id, runId });
    return app;
  }

  /** Every open, canonical row the user should be bidding on. */
  function suitableRows(now: Date): OpportunityRecord[] {
    const rows: OpportunityRecord[] = [];
    for (let offset = 0; ; offset += 500) {
      const page = store.listOpportunities({ view: 'suitable', limit: 500, offset }, now);
      rows.push(...page.items);
      if (page.items.length < 500 || rows.length >= page.total) break;
    }
    return rows;
  }

  // -------------------------------------------------------------------------
  // send: the only way anything leaves the system
  // -------------------------------------------------------------------------

  async function send(applicationId: number, opts: { auto: boolean }): Promise<SendResult> {
    const { auto } = opts;
    const now = deps.now();
    const refuse = (error: string): SendResult => ({ ok: false, error });

    // a. The application itself.
    const app = store.getApplication(applicationId);
    if (!app) return refuse('This submission no longer exists.');
    if (app.status === 'sending') return refuse('This submission is already being sent.');
    if (app.status === 'submitted') return refuse('This submission has already been sent.');
    const sendable: ApplicationStatus[] = auto ? ['ready'] : ['ready', 'failed'];
    if (!sendable.includes(app.status)) {
      return refuse(app.status === 'needs_input' ? 'This submission still needs your input before it can be sent.' : 'This submission is not in a state that can be sent.');
    }
    if (app.channel !== 'email') return refuse('This submission is not an e-mail submission; it has to be uploaded to the buyer’s portal or delivered by hand.');

    // b. The opportunity is open and there is time left.
    const opp = store.getOpportunity(app.opportunityId);
    if (!opp) return refuse('The opportunity for this submission no longer exists.');
    if (opp.status !== 'open') return refuse('The opportunity is no longer open.');
    if (!opp.closesAt) {
      if (auto) return refuse('The closing date is not known, so it will not be sent automatically.');
    } else {
      const deadline = closingDeadline(opp.closesAt, opp.closesAtPrecision, zone).getTime();
      if (now.getTime() >= deadline) return refuse('The opportunity has closed.');
      if (auto) {
        const cutoffHours = settings.getAutomation().sendCutoffHours;
        if (now.getTime() >= deadline - cutoffHours * 3_600_000) {
          return refuse(`It closes within ${plural(cutoffHours, 'hour', 'hours')}, too close to send without a person checking it.`);
        }
      }
    }

    // c. Readiness, worked out again now.
    const snap = snapshot();
    if (!emailConfigured(snap.email)) return refuse('Outgoing e-mail is not set up yet.');
    const ctx = draftContext(snap, now);
    const readiness = assessReadiness(app, opp, ctx);
    if (readiness.status !== 'ready') {
      if (!auto && app.status === 'ready') store.updateApplication(app.id, { status: 'needs_input', missing: readiness.missing }, now);
      return refuse(`It is not ready to send: ${readiness.missing.join(' ')}`);
    }

    // d. The recipient.
    const recipients = parseEmailList(app.toEmail);
    if (recipients.length === 0) return refuse('The submission has no valid recipient address.');
    if (auto) {
      // Only an address read from the notice itself may receive an automatic submission.
      if (opp.submissionMethod !== 'email' || !isEmail(opp.submissionEmail)) return refuse('The notice does not name an e-mail address for submissions.');
      if (recipients.length !== 1 || !sameAddress(recipients[0]!, opp.submissionEmail)) {
        return refuse('The recipient address was changed from the one in the notice, so it will not be sent automatically.');
      }
    }

    // e. The automatic-mode guardrails.
    if (auto) {
      const a = snap.automation;
      if (a.mode !== 'auto') return refuse('Fully automatic mode is not switched on.');
      if (opp.userDecision === 'dismissed') return refuse('You dismissed this opportunity.');
      if ((opp.suitabilityScore ?? 0) < a.autoSendThreshold) {
        return refuse(`Its suitability score (${opp.suitabilityScore ?? 0}) is below your automatic-sending threshold (${a.autoSendThreshold}).`);
      }
      if (!a.autoSendTypes.includes(opp.noticeType)) return refuse('This type of notice is not one you allowed to be sent automatically.');
      if (store.countSubmittedSince(startOfToday(now), true) >= a.dailySendCap) {
        return refuse(`The daily limit of ${plural(a.dailySendCap, 'automatic submission', 'automatic submissions')} has been reached.`);
      }
    }

    // f. Attachments: the package, the chosen library documents and any uploaded files.
    let mail: OutgoingMail;
    try {
      const attachments: OutgoingMail['attachments'] = [];
      const pdf = await packagePdfFor(app, opp, snap.profile, now);
      attachments.push({ filename: pdf.filename, content: pdf.content, contentType: 'application/pdf' });
      for (const docId of app.documentIds) {
        const doc = store.getDocument(docId);
        if (!doc) {
          event('warn', 'attachment_missing', `A document chosen for the submission for ${quoted(opp.title)} has been deleted, so it was left out.`, {
            opportunityId: opp.id,
            applicationId: app.id,
          });
          continue;
        }
        try {
          attachments.push({ filename: doc.filename || doc.name, content: await deps.files.read(doc.storedName), contentType: doc.mime || 'application/octet-stream' });
        } catch {
          event('warn', 'attachment_missing', `The file for “${doc.name}” could not be read, so it was left out of the submission for ${quoted(opp.title)}.`, {
            opportunityId: opp.id,
            applicationId: app.id,
          });
        }
      }
      for (const file of store.listApplicationFiles(app.id)) {
        attachments.push({ filename: file.name, content: await deps.files.read(file.storedName), contentType: file.mime || 'application/octet-stream' });
      }
      mail = buildSubmissionMail({ app, settings: snap.email, attachments });
    } catch (error) {
      return refuse(`The submission could not be put together: ${errorText(error)}`);
    }

    // g. Claim it, then send. The claim is what makes a second send impossible.
    if (!store.transitionApplication(app.id, ['ready', 'failed'], 'sending', now)) {
      return refuse('This submission is already being sent.');
    }
    const to = mail.to.join(', ');
    try {
      const result = await deps.mailerFactory(snap.email).send(mail);
      const sentAt = deps.now();
      store.updateApplication(
        app.id,
        { status: 'submitted', submittedAt: nowIso(sentAt), submittedVia: auto ? 'auto-email' : 'email', submissionRef: result.messageId, error: '' },
        sentAt,
      );
      event('info', 'sent', `Sent the submission for ${quoted(opp.title)} to ${to}${auto ? ' automatically' : ''}.`, { opportunityId: opp.id, applicationId: app.id });
      return { ok: true, error: '' };
    } catch (error) {
      const message = errorText(error);
      store.updateApplication(app.id, { status: 'failed', error: message }, deps.now());
      event('error', 'send_failed', `The submission for ${quoted(opp.title)} could not be sent to ${to}: ${message}`, { opportunityId: opp.id, applicationId: app.id });
      return refuse(message);
    }
  }

  function startOfToday(now: Date): string {
    const start = DateTime.fromJSDate(now).setZone(zone).startOf('day').toUTC().toJSDate();
    return nowIso(start);
  }

  async function packagePdfFor(app: Application, opp: OpportunityRecord, profile: Profile, now: Date): Promise<{ filename: string; content: Buffer }> {
    const content = await buildPackagePdf(opp, profile, { priceTotal: app.priceTotal, priceNotes: app.priceNotes, includeRates: app.includeRates, zone, now });
    return { filename: packageFilename(opp, profile), content };
  }

  // -------------------------------------------------------------------------
  // run
  // -------------------------------------------------------------------------

  async function readDetails(
    source: SourceRecord,
    listed: { id: number; raw: RawOpportunity }[],
    http: HttpClient,
    snap: Snapshot,
    runId: number,
    now: Date,
  ): Promise<{ read: number; failed: number }> {
    const connector = connectorFor(source.kind);
    if (!connector.detail || !source.config.fetchDetails) return { read: 0, failed: 0 };
    const candidates: { id: number; raw: RawOpportunity; titleHit: boolean }[] = [];
    for (const entry of listed) {
      const row = store.getOpportunity(entry.id);
      if (!row || row.detailFetchedAt || row.status !== 'open') continue;
      // Wide listings (national, province-wide) carry mostly unrelated work;
      // only notices that could be landscaping are worth a page request.
      if (!source.config.localBuyer && !mightBeRelevant(`${row.title} ${row.description} ${row.categories.join(' ')}`)) continue;
      candidates.push({ ...entry, titleHit: mightBeRelevant(row.title) });
    }
    candidates.sort((a, b) => Number(b.titleHit) - Number(a.titleHit));

    let read = 0;
    let failed = 0;
    for (const { id, raw } of candidates.slice(0, MAX_DETAILS_PER_SOURCE)) {
      try {
        const detail = await connector.detail(source, raw, { http, now, region: snap.region, state: {}, note: () => undefined });
        const { closingChanged } = store.applyDetail(id, detail, now);
        if (closingChanged) closingChangedEvent(id, runId);
        store.linkDuplicate(id);
        read += 1;
      } catch (error) {
        // A page that is gone will stay gone; anything else is retried next run.
        if (error instanceof HttpError && (error.status === 404 || error.status === 410)) store.applyDetail(id, null, now);
        else failed += 1;
      }
    }
    return { read, failed };
  }

  function closingChangedEvent(id: number, runId: number): void {
    const opp = store.getOpportunity(id);
    if (!opp) return;
    const app = store.getApplicationByOpportunity(opp.canonicalId ?? opp.duplicateOf ?? opp.id) ?? store.getApplicationByOpportunity(opp.id);
    if (!app) return;
    const when = opp.closesAt ? `it now closes ${formatLocal(opp.closesAt, opp.closesAtPrecision, zone)}` : 'the new closing date could not be read';
    event('warn', 'closing_changed', `The closing date changed for ${quoted(opp.title)}; ${when}. Check the submission before it goes out.`, {
      opportunityId: opp.id,
      applicationId: app.id,
      runId,
    });
  }

  async function run(trigger: RunRecord['trigger']): Promise<RunRecord> {
    if (running) throw new Error('A run is already in progress.');
    running = true;
    let runRecord: RunRecord | null = null;
    try {
      runRecord = store.startRun(trigger, deps.now());
      const runId = runRecord.id;
      const stats: RunStats = { sources: [], found: 0, added: 0, analysed: 0, suitable: 0, drafted: 0, sent: 0, expired: 0 };
      try {
        await runSteps(runId, stats);
      } catch (error) {
        const message = errorText(error);
        event('error', 'run', `The run stopped early because of an unexpected problem: ${message}`, { runId });
        return finish(runId, 'error', stats, message);
      }
      const failed = stats.sources.filter((s) => s.status === 'error' || s.status === 'blocked').length;
      const status: RunRecord['status'] = failed === 0 ? 'ok' : failed === stats.sources.length ? 'error' : 'partial';
      return finish(runId, status, stats, status === 'error' ? 'None of the sources could be read.' : '');
    } finally {
      running = false;
    }

    async function finish(runId: number, status: RunRecord['status'], stats: RunStats, error: string): Promise<RunRecord> {
      const finished = store.finishRun(runId, status, stats, error, deps.now());
      event(
        status === 'ok' ? 'info' : status === 'partial' ? 'warn' : 'error',
        'run',
        `Run finished: ${plural(stats.found, 'notice', 'notices')} read, ${stats.added} new, ${stats.suitable} suitable, ${plural(stats.drafted, 'submission', 'submissions')} drafted, ${stats.sent} sent.`,
        { runId },
      );
      try {
        await sendDigest(deps, finished);
      } catch {
        // The summary e-mail is a courtesy; it never fails a run.
      }
      return finished;
    }
  }

  async function runSteps(runId: number, stats: RunStats): Promise<void> {
    const now = deps.now();
    const snap = snapshot();
    const http = deps.httpFactory(snap.automation);
    const sources = store.listSources().filter((s) => s.enabled);

    // 1-3. Read every source, store what it lists, open new notice pages.
    for (const source of sources) {
      const stat: SourceRunStat = { sourceId: source.id, name: source.name, status: 'error', message: '', found: 0, added: 0, ms: 0 };
      const started = Date.now();
      try {
        const state = store.getSourceState(source.id);
        const outcome = await listSource(source, { http, now, region: snap.region, state, note: () => undefined });
        if (outcome.state) store.setSourceState(source.id, outcome.state);
        const listed: { id: number; raw: RawOpportunity }[] = [];
        for (const raw of outcome.items) {
          const bcSource = !!raw.bcSource || source.config.localBuyer || source.config.bcOnly;
          const result = store.upsertOpportunity(source.id, raw, bcSource, now);
          listed.push({ id: result.id, raw });
          if (result.isNew) {
            stat.added += 1;
            store.linkDuplicate(result.id);
          } else if (result.closingChanged) {
            closingChangedEvent(result.id, runId);
          }
        }
        const details = await readDetails(source, listed, http, snap, runId, now);
        const messages = [outcome.message];
        if (details.failed > 0) {
          messages.push(`${plural(details.failed, 'notice page', 'notice pages')} could not be read and will be tried again next run.`);
        }
        stat.status = outcome.status;
        stat.message = messages.filter(Boolean).join(' ');
        stat.found = outcome.items.length;
        store.recordSourceRun(source.id, { status: outcome.status, message: stat.message, itemCount: outcome.unchanged ? source.lastItemCount : outcome.items.length }, now);
      } catch (error) {
        stat.status = 'error';
        stat.message = `Reading this source failed unexpectedly: ${errorText(error)}`;
        store.recordSourceRun(source.id, { status: 'error', message: stat.message, itemCount: null }, now);
      }
      stat.ms = Date.now() - started;
      if (stat.status === 'error' || stat.status === 'blocked') {
        event('warn', 'source', `${source.name} could not be read: ${stat.message}`, { runId });
      }
      stats.sources.push(stat);
      stats.found += stat.found;
      stats.added += stat.added;
    }

    // 4. Score everything new or changed.
    const configs = sourceConfigs();
    const analysed = new Map<number, OpportunityRecord>();
    for (const opp of store.opportunitiesToAnalyse()) {
      analysed.set(opp.id, analyseOne(opp, snap, configs, now));
    }

    // 5. Read the bid documents of the promising ones; they often hold the
    // submission address and the real requirements.
    if (snap.automation.readDocuments) {
      for (const [id, opp] of analysed) {
        if (opp.decision !== 'suitable' && opp.decision !== 'review') continue;
        if (opp.documents.length === 0 || opp.documentsReadAt) continue;
        const result = await readDocuments(http, opp.documents);
        store.setDocumentText(id, result.text, now);
        if (result.problems.length > 0 && result.read === 0) {
          event('info', 'documents', `The bid documents for ${quoted(opp.title)} could not be read: ${result.problems.join(' ')}`, { opportunityId: id, runId });
        }
        const fresh = store.getOpportunity(id);
        if (fresh) analysed.set(id, analyseOne(fresh, snap, configs, now));
      }
    }
    stats.analysed = analysed.size;
    stats.suitable = [...analysed.values()].filter((o) => o.decision === 'suitable').length;

    // 6. Draft submissions, and keep untouched drafts in step with the notice.
    const mode = snap.automation.mode;
    if (mode === 'prepare' || mode === 'auto') {
      const ctx = draftContext(snap, now);
      for (const opp of suitableRows(now)) {
        if (opp.duplicateOf !== null || opp.userDecision === 'dismissed') continue;
        if (opp.application || store.getApplicationByOpportunity(opp.id)) continue;
        createDraft(opp, ctx, true, now, runId);
        stats.drafted += 1;
      }
      for (const app of store.listApplications({ status: OPEN_DRAFT })) {
        const opp = analysed.get(app.opportunityId) ?? store.getOpportunity(app.opportunityId);
        if (!opp) continue;
        if (!app.editedByUser && analysed.has(app.opportunityId)) {
          store.updateApplication(app.id, rebuildPatch(app, opp, ctx), now);
        } else {
          reassessApp(app, opp, ctx, now);
        }
      }
    }

    // 7. Fully automatic mode: send what passes every guardrail.
    if (mode === 'auto') {
      const ready = store
        .listApplications({ status: ['ready'] })
        .filter((a) => a.channel === 'email')
        // Soonest closing first, so the daily cap is spent where time is short.
        .sort((a, b) => (a.opportunity?.closesAt ?? '9999').localeCompare(b.opportunity?.closesAt ?? '9999'));
      for (const app of ready) {
        if (store.countSubmittedSince(startOfToday(deps.now()), true) >= snap.automation.dailySendCap) break;
        const result = await send(app.id, { auto: true });
        if (result.ok) stats.sent += 1;
      }
    }

    // 8. Close what has passed its closing time; unsent drafts expire with it.
    const closedNow = deps.now();
    store.closeExpired(closedNow);
    for (const app of store.listApplications({ status: UNSENT })) {
      const opp = store.getOpportunity(app.opportunityId);
      if (!opp || opp.status === 'open') continue;
      store.updateApplication(app.id, { status: 'expired' }, closedNow);
      stats.expired += 1;
      event('info', 'expired', `The opportunity ${quoted(opp.title)} closed before its submission was sent.`, { opportunityId: opp.id, applicationId: app.id, runId });
    }
  }

  // -------------------------------------------------------------------------
  // The rest of the interface
  // -------------------------------------------------------------------------

  function draftFor(opportunityId: number, opts: { rebuild: boolean }): Application {
    const now = deps.now();
    const opp = store.getOpportunity(opportunityId);
    if (!opp) throw new Error('That opportunity no longer exists.');
    const ctx = draftContext(snapshot(), now);
    const existing = store.getApplicationByOpportunity(opportunityId);
    if (!existing) return createDraft(opp, ctx, false, now, null);
    if (!opts.rebuild) return reassessApp(existing, opp, ctx, now);
    if (!(['needs_input', 'ready', 'failed', 'withdrawn'] as ApplicationStatus[]).includes(existing.status)) {
      throw new Error('This submission has already gone out or closed, so it cannot be rebuilt.');
    }
    const patch: ApplicationPatch = { ...rebuildPatch(existing, opp, ctx), editedByUser: false };
    return store.updateApplication(existing.id, patch, now) ?? existing;
  }

  function reassess(applicationId: number): Application {
    const app = store.getApplication(applicationId);
    if (!app) throw new Error('This submission no longer exists.');
    const opp = store.getOpportunity(app.opportunityId);
    if (!opp) throw new Error('The opportunity for this submission no longer exists.');
    const now = deps.now();
    return reassessApp(app, opp, draftContext(snapshot(), now), now);
  }

  async function refreshOpportunity(id: number): Promise<void> {
    const opp = store.getOpportunity(id);
    if (!opp) throw new Error('That opportunity no longer exists.');
    const now = deps.now();
    const snap = snapshot();
    const fresh = analyseOne(opp, snap, sourceConfigs(), now);
    const ctx = draftContext(snap, now);
    const app = store.getApplicationByOpportunity(id);
    if (app) {
      if (!OPEN_DRAFT.includes(app.status)) return;
      if (!app.editedByUser) store.updateApplication(app.id, rebuildPatch(app, fresh, ctx), now);
      else reassessApp(app, fresh, ctx, now);
      return;
    }
    const mode = snap.automation.mode;
    const wanted = fresh.decision === 'suitable' || fresh.userDecision === 'pursue';
    if ((mode === 'prepare' || mode === 'auto') && wanted && fresh.userDecision !== 'dismissed' && fresh.status === 'open' && fresh.duplicateOf === null) {
      createDraft(fresh, ctx, fresh.userDecision !== 'pursue', now, null);
    }
  }

  async function packagePdf(applicationId: number): Promise<{ filename: string; content: Buffer }> {
    const app = store.getApplication(applicationId);
    if (!app) throw new Error('This submission no longer exists.');
    const opp = store.getOpportunity(app.opportunityId);
    if (!opp) throw new Error('The opportunity for this submission no longer exists.');
    return packagePdfFor(app, opp, settings.getProfile(), deps.now());
  }

  async function testSource(source: SourceRecord): Promise<SourceTestResult> {
    const snap = snapshot();
    const http = deps.httpFactory(snap.automation);
    const outcome = await listSource(source, { http, now: deps.now(), region: snap.region, state: {}, note: () => undefined });
    return {
      status: outcome.status,
      message: outcome.message,
      ms: outcome.ms,
      count: outcome.items.length,
      sample: outcome.items.slice(0, 8).map((item) => ({
        title: item.title,
        url: item.url,
        organization: item.organization || source.config.organization,
        closesAt: item.closing?.iso ?? null,
        closingRaw: item.closingRaw ?? '',
        referenceNumber: item.referenceNumber ?? '',
      })),
      requests: http.log.map((entry) => ({ ...entry })),
    };
  }

  return {
    run,
    isRunning: () => running,
    testSource,
    refreshOpportunity,
    draftFor,
    reassess,
    send,
    packagePdf,
  };
}
