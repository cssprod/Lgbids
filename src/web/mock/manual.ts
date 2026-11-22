import type { PasteAlertResult } from '../../shared/api.js';
import type { Opportunity, SubmissionMethod } from '../../shared/schemas.js';
import { DAY, fail, iso, ok, type MockContext, type MockModule } from './context.js';

/**
 * Bids added by hand and pasted alerts (COV-15), for the prototype. The real
 * server scores the text; here a bid added by hand goes to "Needs review" and
 * a pasted alert yields one notice per link (the line above it is the title).
 */

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

function addOpportunity(ctx: MockContext, p: { title: string; buyer: string; closesAt: string | null; precision: 'date' | 'datetime'; url: string; method: SubmissionMethod; text: string; sourceId: string; sourceName: string }): Opportunity {
  const id = ctx.newId();
  const opp: Opportunity = {
    id,
    sourceId: p.sourceId,
    sourceName: p.sourceName,
    externalId: `manual-${id}`,
    title: p.title,
    organization: p.buyer,
    referenceNumber: '',
    noticeType: 'OTHER',
    description: p.text,
    url: p.url,
    publishedAt: null,
    closesAt: p.closesAt,
    closesAtPrecision: p.closesAt ? p.precision : null,
    closesAtRaw: '',
    location: '',
    categories: [],
    contactName: '',
    contactEmail: '',
    contactPhone: '',
    documents: [],
    submissionMethod: p.method,
    submissionEmail: '',
    submissionUrl: '',
    status: 'open',
    suitabilityScore: 55,
    decision: 'review',
    userDecision: null,
    analysis: null,
    duplicateOf: null,
    firstSeenAt: iso(0),
    lastSeenAt: iso(0),
    application: null,
    alertsMuted: false,
    unseenChanges: 0,
    lastChangedAt: null,
  };
  ctx.state.opportunities = [opp, ...ctx.state.opportunities];
  return opp;
}

function closingOf(value: string): { closesAt: string | null; precision: 'date' | 'datetime' } {
  if (!value) return { closesAt: null, precision: 'date' };
  // Browser-local time stands in for Pacific time in the prototype.
  const dateOnly = !value.includes('T');
  const d = new Date(dateOnly ? `${value}T23:59:59` : value);
  return Number.isNaN(d.getTime()) ? { closesAt: null, precision: 'date' } : { closesAt: d.toISOString(), precision: dateOnly ? 'date' : 'datetime' };
}

export const manual: MockModule = (ctx, { method, path, body }) => {
  if (method !== 'POST') return null;
  if (path === '/api/opportunities/manual') {
    const title = str(body.title);
    const buyer = str(body.buyer);
    if (title.length < 3) return fail(400, 'Please enter a title of at least 3 characters.');
    if (buyer.length < 2) return fail(400, 'Please enter the buyer.');
    const link = str(body.link);
    if (link && !/^https?:\/\//i.test(link)) return fail(400, 'The link must be a web address starting with http:// or https://.');
    const closing = closingOf(str(body.closing));
    const opp = addOpportunity(ctx, {
      title,
      buyer,
      closesAt: closing.closesAt ?? iso(14 * DAY),
      precision: closing.closesAt ? closing.precision : 'date',
      url: link,
      method: (str(body.submissionMethod) || 'unknown') as SubmissionMethod,
      text: str(body.text),
      sourceId: 'manual',
      sourceName: 'Bids added by hand',
    });
    return ok(opp);
  }
  if (path === '/api/opportunities/paste-alert') {
    const text = str(body.text) || str(body.html).replace(/<[^>]+>/g, '\n');
    if (!text) return fail(400, 'Paste the alert e-mail first.');
    const lines = text.split(/\r?\n/).map((l) => l.trim());
    const ids: number[] = [];
    const titles: string[] = [];
    lines.forEach((line, i) => {
      const url = /https?:\/\/\S+/.exec(line)?.[0];
      if (!url) return;
      const title = lines.slice(0, i).reverse().find((l) => l.length >= 3 && !/https?:\/\//.test(l) && !/^(from|subject|to|date):/i.test(l));
      if (!title) return;
      const opp = addOpportunity(ctx, { title, buyer: 'Sample buyer (from the alert)', closesAt: iso(14 * DAY), precision: 'date', url, method: 'unknown', text: '', sourceId: 'email-alerts', sourceName: 'Bid alert e-mails (BC Bid and Bonfire)' });
      ids.push(opp.id);
      titles.push(`“${title}”`);
    });
    const result: PasteAlertResult =
      ids.length === 0
        ? { ok: false, recognised: false, found: 0, ids: [], message: 'Not recognised: no notice could be read from the pasted alert. Try pasting the whole e-mail, or add the bid by hand.' }
        : { ok: true, recognised: true, found: ids.length, ids, message: `Found ${ids.length} ${ids.length === 1 ? 'notice' : 'notices'} in the pasted alert: ${titles.join(', ')}.` };
    return ok(result);
  }
  return null;
};
