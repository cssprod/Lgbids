import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { APPLICATION_STATUSES, applicationUpdateSchema, type Application, type ApplicationStatus } from '../../shared/schemas.js';
import type { ApplicationPatch } from '../contracts.js';
import { isOwnCompany } from '../matching/award.js';
import { closingDeadline, nowIso } from '../util/dates.js';
import { isEmail } from '../util/text.js';
import { ApiError, idParam, notFound, parseBody, query, readUpload, sanitizeName, sendFile, type RouteContext } from './util.js';

/** States in which the user may still change what will be submitted. */
const EDITABLE: ApplicationStatus[] = ['needs_input', 'ready', 'failed'];
/** States after which nothing more happens to an application. */
const FINAL: ApplicationStatus[] = ['won', 'lost', 'withdrawn', 'expired'];

const markSubmittedSchema = z.object({
  via: z.string().trim().max(80).optional(),
  ref: z.string().trim().max(200).optional(),
  note: z.string().trim().max(2000).optional(),
});

// The same sentences are used by the prototype mock (src/web/mock/awards.ts).
const RESULT_CONFLICT = 'Only a submitted application can be marked as won or not awarded.';
const UNDO_CONFLICT = 'Only an application with a result can have its result undone.';
const WITHDRAW_RESULT_CONFLICT = 'This application already has a result, so it cannot be withdrawn. Undo the result first.';
const statusSchema = z.object({ status: z.enum(['withdrawn', 'won', 'lost', 'needs_input', 'submitted']) });

/** Addresses may be a comma or semicolon separated list; each one has to be valid. */
function checkAddresses(field: string, value: string | undefined): void {
  if (!value) return;
  const parts = value.split(/[,;\s]+/).filter(Boolean);
  const bad = parts.find((p) => !isEmail(p));
  if (bad !== undefined) throw new ApiError(400, `“${bad}” in ${field} is not a valid e-mail address.`);
}

/**
 * A won or not-awarded hint from an award notice (MAT-16 logs it as an
 * `award_suggested` event). Only a hint: the person confirms the result.
 * Not in the shared Application type yet (reported as a contract request).
 */
export interface ResultSuggestion {
  outcome: 'won' | 'lost';
  winner: string;
  message: string;
}
export type ApplicationWithResult = Application & { resultSuggestion: ResultSuggestion | null };

function appendNote(existing: string, note: string | undefined): string {
  if (!note) return existing;
  return existing ? `${existing}\n\n${note}` : note;
}

export function registerApplications(app: FastifyInstance, ctx: RouteContext): void {
  const { store, files, now, config } = ctx.deps;
  const { pipeline } = ctx;

  function load(id: number): Application {
    const application = store.getApplication(id);
    if (!application) throw notFound('application');
    return application;
  }

  function event(application: Application, kind: string, message: string, level: 'info' | 'warn' = 'info'): void {
    store.addEvent({ level, kind, message, opportunityId: application.opportunityId, applicationId: application.id, runId: null }, now());
  }

  function title(application: Application): string {
    return application.opportunity?.title ? `“${application.opportunity.title}”` : `application ${application.id}`;
  }

  app.get('/api/applications', async (req) => {
    const raw = query(req).status;
    if (!raw) return store.listApplications({});
    const statuses = raw.split(',').map((s) => s.trim()).filter(Boolean);
    const unknown = statuses.find((s) => !(APPLICATION_STATUSES as readonly string[]).includes(s));
    if (unknown !== undefined) throw new ApiError(400, `“${unknown}” is not an application status.`);
    return store.listApplications({ status: statuses as ApplicationStatus[] });
  });

  /** The application with its bid's award and, while the award is unconfirmed, the won/lost hint. */
  function withResult(application: Application): ApplicationWithResult {
    const award = store.getAwardFor(application.opportunityId) ?? null;
    const opportunity = application.opportunity ? { ...application.opportunity, award } : application.opportunity;
    let resultSuggestion: ResultSuggestion | null = null;
    if (award && award.status === 'suggested' && award.winner && ['submitted', 'won', 'lost'].includes(application.status)) {
      const logged = store.listEvents(500).find((e) => e.kind === 'award_suggested' && e.applicationId === application.id);
      if (logged) {
        const profile = ctx.deps.settings.getProfile();
        const names = [profile.legalName, profile.tradeName].filter(Boolean);
        const own = names.length > 0 && isOwnCompany(award.winner, names);
        resultSuggestion = { outcome: own ? 'won' : 'lost', winner: award.winner, message: logged.message };
      }
    }
    return { ...application, opportunity, resultSuggestion };
  }

  app.get('/api/applications/:id', async (req) => withResult(load(idParam(req, 'application'))));

  app.patch('/api/applications/:id', async (req) => {
    const id = idParam(req, 'application');
    const current = load(id);
    const update = parseBody(applicationUpdateSchema, req.body);
    if (!EDITABLE.includes(current.status)) throw new ApiError(409, 'This application can no longer be edited.');
    checkAddresses('the “To” address', update.toEmail);
    checkAddresses('the “Cc” addresses', update.ccEmail);

    const patch: ApplicationPatch = {};
    if (update.toEmail !== undefined) patch.toEmail = update.toEmail;
    if (update.ccEmail !== undefined) patch.ccEmail = update.ccEmail;
    if (update.subject !== undefined) patch.subject = update.subject;
    if (update.body !== undefined) patch.body = update.body;
    if (update.channel !== undefined) patch.channel = update.channel;
    if (update.priceTotal !== undefined) patch.priceTotal = update.priceTotal;
    if (update.priceNotes !== undefined) patch.priceNotes = update.priceNotes;
    if (update.includeRates !== undefined) patch.includeRates = update.includeRates;
    if (update.notes !== undefined) patch.notes = update.notes;
    if (update.documentIds !== undefined) {
      const known = new Set(store.listDocuments().map((d) => d.id));
      const missing = update.documentIds.find((d) => !known.has(d));
      if (missing !== undefined) throw new ApiError(400, `Document ${missing} is not in your document library.`);
      patch.documentIds = [...new Set(update.documentIds)];
    }
    if (update.checklist !== undefined) {
      // Only the tick can change; labels and which items exist come from the notice.
      const done = new Map(update.checklist.map((c) => [c.key, c.done]));
      patch.checklist = current.checklist.map((item) => (done.has(item.key) ? { ...item, done: done.get(item.key)! } : item));
    }
    const textChanged = (['subject', 'body', 'toEmail', 'ccEmail', 'channel'] as const).some((k) => patch[k] !== undefined && patch[k] !== current[k]);
    if (textChanged) patch.editedByUser = true;

    store.updateApplication(id, patch, now());
    pipeline.reassess(id);
    return load(id);
  });

  app.post('/api/applications/:id/regenerate', async (req) => {
    const current = load(idParam(req, 'application'));
    if (!EDITABLE.includes(current.status)) throw new ApiError(409, 'This application has already been sent or closed, so it cannot be rebuilt.');
    pipeline.draftFor(current.opportunityId, { rebuild: true });
    return load(current.id);
  });

  app.post('/api/applications/:id/send', async (req) => {
    const current = load(idParam(req, 'application'));
    const result = await pipeline.send(current.id, { auto: false });
    if (!result.ok) throw new ApiError(409, result.error || 'This application could not be sent.');
    return load(current.id);
  });

  app.post('/api/applications/:id/mark-submitted', async (req) => {
    const current = load(idParam(req, 'application'));
    const body = parseBody(markSubmittedSchema, req.body);
    const at = now();
    if (!store.transitionApplication(current.id, EDITABLE, 'submitted', at)) {
      throw new ApiError(409, 'Only an application that has not been submitted yet can be marked as submitted.');
    }
    const via = body.via || 'portal';
    store.updateApplication(
      current.id,
      { submittedAt: nowIso(at), submittedVia: via, submissionRef: body.ref ?? '', notes: appendNote(current.notes, body.note), error: '' },
      at,
    );
    event(current, 'application_submitted', `You marked ${title(current)} as submitted (${via}${body.ref ? `, reference ${body.ref}` : ''}).`);
    return load(current.id);
  });

  app.post('/api/applications/:id/status', async (req) => {
    const current = load(idParam(req, 'application'));
    const { status } = parseBody(statusSchema, req.body);
    const at = now();

    if (status === 'won' || status === 'lost') {
      // A result can be corrected: won ↔ not awarded is allowed directly.
      if (!store.transitionApplication(current.id, ['submitted', 'won', 'lost'], status, at)) {
        throw new ApiError(409, RESULT_CONFLICT);
      }
      event(current, `application_${status}`, `${title(current)} was marked as ${status === 'won' ? 'won' : 'not awarded'}.`);
    } else if (status === 'submitted') {
      // "Undo result": back to submitted, for a result recorded by mistake.
      if (!store.transitionApplication(current.id, ['won', 'lost'], 'submitted', at)) {
        throw new ApiError(409, UNDO_CONFLICT);
      }
      event(current, 'application_result_undone', `The result for ${title(current)} was undone.`);
    } else if (status === 'withdrawn') {
      // Not while it is being sent: the outcome of that attempt has to be recorded first.
      // Not after a result either: a won or lost bid was not withdrawn.
      const from = APPLICATION_STATUSES.filter((s) => !FINAL.includes(s) && s !== 'sending');
      if (!store.transitionApplication(current.id, from, 'withdrawn', at)) {
        throw new ApiError(
          409,
          current.status === 'sending'
            ? 'This application is being sent right now. Try again in a moment.'
            : current.status === 'won' || current.status === 'lost'
              ? WITHDRAW_RESULT_CONFLICT
              : 'This application is already closed.',
        );
      }
      event(current, 'application_withdrawn', `${title(current)} was withdrawn.`);
    } else {
      const opp = store.getOpportunity(current.opportunityId);
      const stillOpen =
        !!opp && opp.status === 'open' && (!opp.closesAt || closingDeadline(opp.closesAt, opp.closesAtPrecision, config.timeZone).getTime() > at.getTime());
      if (!stillOpen) throw new ApiError(409, 'The opportunity has closed, so this application cannot be reopened.');
      if (!store.transitionApplication(current.id, ['withdrawn', 'expired'], 'needs_input', at)) {
        throw new ApiError(409, 'Only a withdrawn or expired application can be reopened.');
      }
      pipeline.reassess(current.id);
      event(current, 'application_reopened', `${title(current)} was reopened.`);
    }
    return withResult(load(current.id));
  });

  app.get('/api/applications/:id/package.pdf', async (req, reply) => {
    const current = load(idParam(req, 'application'));
    const pdf = await pipeline.packagePdf(current.id);
    return sendFile(reply, 'inline', pdf.filename || `application-${current.id}.pdf`, 'application/pdf', pdf.content);
  });

  app.post('/api/applications/:id/files', async (req) => {
    const current = load(idParam(req, 'application'));
    if (current.status === 'sending') throw new ApiError(409, 'This application is being sent right now. Try again in a moment.');
    const upload = await readUpload(req);
    const name = sanitizeName(upload.filename);
    const storedName = await files.save(upload.content, name);
    store.addApplicationFile(current.id, { storedName, name, mime: upload.mime || 'application/octet-stream', size: upload.content.length }, now());
    if (EDITABLE.includes(current.status)) pipeline.reassess(current.id);
    return load(current.id);
  });

  app.get('/api/applications/:id/files/:fileId', async (req, reply) => {
    const current = load(idParam(req, 'application'));
    const file = store.getApplicationFile(current.id, idParam(req, 'file', 'fileId'));
    if (!file) throw notFound('file');
    return sendFile(reply, 'attachment', file.name, file.mime, await files.read(file.storedName));
  });

  app.delete('/api/applications/:id/files/:fileId', async (req) => {
    const current = load(idParam(req, 'application'));
    if (current.status === 'sending') throw new ApiError(409, 'This application is being sent right now. Try again in a moment.');
    const storedName = store.deleteApplicationFile(current.id, idParam(req, 'file', 'fileId'));
    if (storedName === null) throw notFound('file');
    await files.remove(storedName).catch((err: unknown) => req.log.warn({ err }, 'could not remove an uploaded file'));
    if (EDITABLE.includes(current.status)) pipeline.reassess(current.id);
    return load(current.id);
  });
}
