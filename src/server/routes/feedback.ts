import type { FastifyInstance } from 'fastify';
import { DateTime } from 'luxon';
import { feedbackCsv, feedbackCsvFilename } from '../../shared/csv.js';
import { feedbackInputSchema, missedBidSchema, sourceConfigSchema, type FeedbackRecord, type SourceConfig } from '../../shared/schemas.js';
import type { FeedbackSave, OpportunityRecord } from '../contracts.js';
import { analyse } from '../matching/analyse.js';
import { LEXICON_VERSION } from '../matching/relevance.js';
import { corpusRowFor, missedAnalyseInput } from '../matching/tuning.js';
import { formatLocal } from '../util/dates.js';
import { dismissOpportunity } from './opportunities.js';
import { contentDisposition, idParam, notFound, parseBody, type RouteContext } from './util.js';

/**
 * Feedback on scores (MAT-12): one record per notice, plus bids Lgbids
 * missed. Each record keeps a snapshot of how the notice was scored, so the
 * tuning report can tell which rule was wrong even after the rules change.
 * Nothing here changes a score.
 */
export function registerFeedback(app: FastifyInstance, ctx: RouteContext): void {
  const { store, settings } = ctx.deps;
  const zone = ctx.deps.config.timeZone;
  const localDay = () => DateTime.fromJSDate(ctx.deps.now()).setZone(zone).toFormat('yyyy-MM-dd');

  function sourceConfig(sourceId: string): SourceConfig {
    return store.getSource(sourceId)?.config ?? sourceConfigSchema.parse({});
  }

  function snapshot(opp: OpportunityRecord): Omit<FeedbackSave, 'opportunityId' | 'verdict' | 'reasons' | 'note' | 'foundVia'> {
    const a = opp.analysis;
    return {
      title: opp.title,
      url: opp.url,
      organization: opp.organization,
      sourceId: opp.sourceId,
      noticeType: opp.noticeType,
      score: opp.suitabilityScore,
      decision: opp.decision,
      matchedTerms: a?.matchedTerms ?? [],
      services: a?.services ?? [],
      area: a?.area ?? 'unknown',
      areaMatch: a?.areaMatch ?? '',
      trace: a?.trace ?? null,
      lexiconVersion: a?.trace?.lexiconVersion ?? '',
    };
  }

  app.put('/api/opportunities/:id/feedback', async (req): Promise<FeedbackRecord> => {
    const id = idParam(req, 'opportunity');
    const opp = store.getOpportunity(id);
    if (!opp) throw notFound('opportunity');
    const input = parseBody(feedbackInputSchema, req.body);
    const at = ctx.deps.now();
    const saved = store.saveFeedback({ ...snapshot(opp), opportunityId: id, verdict: input.verdict, reasons: input.reasons, note: input.note, foundVia: '' }, at);
    // D18: "Not relevant" also takes the bid off the lists.
    if (input.verdict === 'not_relevant' && opp.userDecision !== 'dismissed') dismissOpportunity(ctx, opp, at);
    return saved;
  });

  app.delete('/api/opportunities/:id/feedback', async (req) => {
    const id = idParam(req, 'opportunity');
    const opp = store.getOpportunity(id);
    if (!opp) throw notFound('opportunity');
    const previous = store.getFeedbackFor(id);
    store.deleteFeedbackFor(id);
    // Undo of "Not relevant" brings the bid back, as Undo of "Not for us" does.
    if (previous?.verdict === 'not_relevant' && opp.userDecision === 'dismissed') store.setUserDecision(id, null);
    return { ok: true as const };
  });

  app.post('/api/feedback/missed', async (req): Promise<FeedbackRecord> => {
    const input = parseBody(missedBidSchema, req.body);
    const now = ctx.deps.now();
    const result = analyse(missedAnalyseInput(input), {
      profile: settings.getProfile(),
      automation: settings.getAutomation(),
      region: settings.getRegion(),
      now,
      zone,
    });
    return store.saveFeedback(
      {
        opportunityId: null,
        verdict: 'missed',
        reasons: [],
        note: input.note,
        title: input.title,
        url: input.url,
        organization: input.organization,
        foundVia: input.foundVia,
        sourceId: '',
        noticeType: result.noticeType,
        score: result.score,
        decision: result.decision,
        matchedTerms: result.analysis.matchedTerms,
        services: result.analysis.services,
        area: result.analysis.area,
        areaMatch: result.analysis.areaMatch,
        trace: result.analysis.trace ?? null,
        lexiconVersion: result.analysis.trace?.lexiconVersion ?? LEXICON_VERSION,
      },
      now,
    );
  });

  app.get('/api/feedback', async (): Promise<FeedbackRecord[]> => store.listFeedback());

  app.get('/api/feedback.csv', async (_req, reply) =>
    reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', contentDisposition('attachment', feedbackCsvFilename(localDay())))
      .header('cache-control', 'private, no-store')
      .send(feedbackCsv(store.listFeedback(), (iso) => formatLocal(iso, 'datetime', zone))),
  );

  // Rows for the matching corpus (tests/fixtures/corpus): public notice fields only, never the profile or a note.
  app.get('/api/feedback/corpus.jsonl', async (_req, reply) => {
    const lines: string[] = [];
    for (const item of store.listFeedback()) {
      const opp = item.opportunityId === null ? undefined : store.getOpportunity(item.opportunityId);
      lines.push(JSON.stringify(corpusRowFor(item, opp, opp ? sourceConfig(opp.sourceId) : undefined)));
    }
    return reply
      .header('content-type', 'application/x-ndjson; charset=utf-8')
      .header('content-disposition', contentDisposition('attachment', `lgbids-corpus-${localDay()}.jsonl`))
      .header('cache-control', 'private, no-store')
      .send(lines.length ? `${lines.join('\n')}\n` : '');
  });
}
