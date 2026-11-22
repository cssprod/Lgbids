import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { DateTime } from 'luxon';
import type { PasteAlertResult } from '../../shared/api.js';
import { manualOpportunitySchema, pasteAlertSchema, sourceConfigSchema, type ManualOpportunityInput, type Opportunity } from '../../shared/schemas.js';
import type { OpportunityRecord } from '../contracts.js';
import { analyse } from '../matching/analyse.js';
import { extractReference } from '../matching/notice.js';
import { extractFacts } from '../matching/requirements.js';
import { ALERT_SOURCE_ID } from '../settings.js';
import { alertSender, readAlertEmail } from '../sources/alerts/parse.js';
import { DEFAULT_SOURCES, MANUAL_SOURCE_ID } from '../sources/registry.js';
import type { RawOpportunity } from '../sources/types.js';
import { findClosingDate, type ParsedDate } from '../util/dates.js';
import { ApiError, opportunityDto, parseBody, type RouteContext } from './util.js';

/**
 * Bids added by hand, and alert e-mails pasted in (for Outlook users who
 * cannot save .eml files, or a bid seen on a portal that sent no alert).
 * Lgbids never opens the link the user gives or the links in a pasted alert.
 */

/** "2026-06-30" is the end of that local day; "2026-06-30T14:00" is that local time. */
function closingFrom(input: ManualOpportunityInput, zone: string, now: Date): ParsedDate | null {
  if (input.closing) {
    const dt = DateTime.fromISO(input.closing, { zone });
    if (!dt.isValid) throw new ApiError(400, `“${input.closing}” is not a real date. Use a date like 2026-06-30, or a date and time like 2026-06-30T14:00.`);
    const dateOnly = !input.closing.includes('T');
    const at = dateOnly ? dt.endOf('day').startOf('second') : dt;
    return { iso: at.toUTC().toISO({ suppressMilliseconds: true })!, precision: dateOnly ? 'date' : 'datetime' };
  }
  const found = input.text ? findClosingDate(input.text, { zone, now }) : null;
  return found ? { iso: found.iso, precision: found.precision } : null;
}

/** The sender address from a "From:" line in a pasted (forwarded) alert, when the user left it blank. */
function senderFrom(given: string, text: string, html: string): string {
  if (alertSender(given)) return given;
  const line = /^\s*(?:>\s*)?from:\s*(.+)$/im.exec(text || html.replace(/<[^>]+>/g, '\n'));
  return line && alertSender(line[1]!) ? line[1]!.trim() : given;
}

export function registerManual(app: FastifyInstance, ctx: RouteContext): void {
  const { store, settings, now } = ctx.deps;
  const zone = ctx.deps.config.timeZone;

  /** The "Bids added by hand" source; demo data and older databases may not have it yet. */
  function ensureManualSource(at: Date): void {
    if (store.getSource(MANUAL_SOURCE_ID)) return;
    const builtin = DEFAULT_SOURCES.find((s) => s.id === MANUAL_SOURCE_ID);
    store.insertSource(
      {
        id: MANUAL_SOURCE_ID,
        name: builtin?.name ?? 'Bids added by hand',
        kind: 'manual',
        enabled: true,
        builtin: true,
        notes: builtin?.notes ?? '',
        config: builtin?.config ?? sourceConfigSchema.parse({ fetchDetails: false }),
      },
      at,
    );
  }

  /**
   * Score a bid added by hand. Done here rather than by the pipeline so the
   * submission method the user chose counts when the text does not say.
   */
  function score(opp: OpportunityRecord, input: ManualOpportunityInput, at: Date): OpportunityRecord {
    const result = analyse(
      {
        title: opp.title,
        organization: opp.organization,
        description: opp.description,
        location: opp.location,
        categories: opp.categories,
        noticeTypeHint: `${opp.noticeTypeHint} ${opp.referenceNumber}`.trim(),
        closesAt: opp.closesAt,
        closesAtPrecision: opp.closesAtPrecision,
        status: opp.status,
        url: opp.url,
        documentText: opp.documentText,
        localSource: false,
        bcSource: opp.bcSource,
        sourceSubmission: input.submissionMethod,
      },
      { profile: settings.getProfile(), automation: settings.getAutomation(), region: settings.getRegion(), now: at, zone },
    );
    store.saveAnalysis(
      opp.id,
      {
        noticeType: result.noticeType,
        score: result.score,
        decision: result.decision,
        analysis: { ...result.analysis, alsoListed: store.duplicatesOf(opp.id).map((d) => ({ source: d.sourceName, url: d.url })) },
        submissionMethod: result.facts.submission.method,
        submissionEmail: result.facts.submission.email,
        submissionUrl: result.facts.submission.url,
        contactEmail: result.facts.contactEmail || undefined,
      },
      at,
    );
    return store.getOpportunity(opp.id) ?? opp;
  }

  const drafting = () => {
    const mode = settings.getAutomation().mode;
    return mode === 'prepare' || mode === 'auto';
  };

  app.post('/api/opportunities/manual', async (req): Promise<Opportunity> => {
    const input = parseBody(manualOpportunitySchema, req.body);
    const at = now();
    if (input.link) {
      let url: URL | null = null;
      try {
        url = new URL(input.link);
      } catch {
        url = null;
      }
      if (!url || (url.protocol !== 'http:' && url.protocol !== 'https:')) {
        throw new ApiError(400, 'The link must be a web address starting with http:// or https://.');
      }
    }
    ensureManualSource(at);
    const closing = closingFrom(input, zone, at);
    const facts = input.text ? extractFacts(input.text, { zone, now: at }) : null;
    const raw: RawOpportunity = {
      externalId: `manual-${at.getTime()}-${randomBytes(4).toString('hex')}`,
      title: input.title,
      url: input.link,
      organization: input.buyer,
      referenceNumber: extractReference(input.title) || extractReference(input.text.slice(0, 400)),
      description: input.text,
      closing,
      closingRaw: input.closing ?? '',
      contactEmail: facts?.contactEmail || facts?.submission.email || undefined,
      status: 'open',
    };
    const saved = store.upsertOpportunity(MANUAL_SOURCE_ID, raw, false, at);
    store.linkDuplicate(saved.id);
    const record = store.getOpportunity(saved.id);
    if (!record) throw new ApiError(500, 'The bid could not be saved. Please try again.');
    const scored = score(record, input, at);
    store.addEvent(
      { level: 'info', kind: 'manual_added', message: `You added “${scored.title}” by hand.`, opportunityId: scored.id, applicationId: null, runId: null },
      at,
    );
    if (drafting() && scored.decision === 'suitable' && scored.status === 'open' && scored.duplicateOf === null) {
      ctx.pipeline.draftFor(scored.id, { rebuild: false });
    }
    return opportunityDto(store.getOpportunity(scored.id) ?? scored);
  });

  app.post('/api/opportunities/paste-alert', async (req): Promise<PasteAlertResult> => {
    const input = parseBody(pasteAlertSchema, req.body);
    const at = now();
    const sender = senderFrom(input.sender, input.text, input.html);
    if (!alertSender(sender)) {
      throw new ApiError(400, 'Please enter the address the alert came from (for example noreply@bcbid.gov.bc.ca), so Lgbids knows which service sent it.');
    }
    const reading = readAlertEmail({ from: sender, subject: '', html: input.html, text: input.text, date: at }, { zone, now: at });
    if (reading.items.length === 0) {
      return {
        ok: false,
        recognised: false,
        found: 0,
        ids: [],
        message: 'Not recognised: no notice could be read from the pasted alert. Try pasting the whole e-mail, or add the bid by hand.',
      };
    }
    // Filed with the alert e-mails, so the same notice arriving in the inbox later is the same row.
    const alertSource = store.getSource(ALERT_SOURCE_ID);
    const sourceId = alertSource ? ALERT_SOURCE_ID : MANUAL_SOURCE_ID;
    if (!alertSource) ensureManualSource(at);
    const bcOnly = alertSource?.config.bcOnly ?? false;
    const ids: number[] = [];
    for (const item of reading.items) {
      const saved = store.upsertOpportunity(sourceId, item, !!item.bcSource || bcOnly, at);
      if (saved.isNew) store.linkDuplicate(saved.id);
      ids.push(saved.id);
      // Scores it, and drafts it when it suits and the mode is prepare or automatic.
      await ctx.pipeline.refreshOpportunity(saved.id);
    }
    const n = reading.items.length;
    const titles = reading.items
      .slice(0, 5)
      .map((i) => `“${i.title}”`)
      .join(', ');
    return { ok: true, recognised: true, found: n, ids, message: `Found ${n} ${n === 1 ? 'notice' : 'notices'} in the pasted alert: ${titles}${n > 5 ? ` and ${n - 5} more` : ''}.` };
  });
}
