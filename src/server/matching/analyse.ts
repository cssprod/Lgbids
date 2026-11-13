import {
  NOTICE_TYPE_LABELS,
  SERVICE_LABELS,
  type Analysis,
  type AnalysisReason,
  type AutomationSettings,
  type DatePrecision,
  type Decision,
  type NoticeType,
  type OpportunityStatus,
  type Profile,
  type RegionSettings,
  type SubmissionMethod,
} from '../../shared/schemas.js';
import { closingDeadline, formatLocal } from '../util/dates.js';
import { normalize, phraseRegex } from '../util/text.js';
import { assessArea } from './geo.js';
import { detectNoticeType } from './notice.js';
import { assessRelevance, BORDERLINE_AT, RELEVANT_AT } from './relevance.js';
import { buildRequirements, extractFacts, type NoticeFacts, type PricingKind } from './requirements.js';

/**
 * The suitability call for one opportunity: is it landscaping work, is it in
 * the service area, is it still open, is it a kind of work the company does,
 * and does anything in the notice rule the company out?
 *
 * The result is a score for ranking, a three-way decision, and the list of
 * reasons shown to the user so the call can be checked at a glance.
 */

export interface AnalyseInput {
  title: string;
  organization: string;
  description: string;
  location: string;
  categories: string[];
  /** Solicitation type as stated by the source, if any. */
  noticeTypeHint: string;
  closesAt: string | null;
  closesAtPrecision: DatePrecision | null;
  status: OpportunityStatus;
  url: string;
  /** Text read from publicly linked bid documents. */
  documentText: string;
  localSource: boolean;
  bcSource: boolean;
  sourceSubmission: SubmissionMethod;
}

export interface AnalyseContext {
  profile: Profile;
  automation: AutomationSettings;
  region: RegionSettings;
  now: Date;
  zone: string;
}

export interface AnalyseResult {
  noticeType: NoticeType;
  score: number;
  decision: Decision;
  analysis: Analysis;
  facts: NoticeFacts;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function timeLeft(hours: number): string {
  if (hours < 1) return 'less than an hour';
  if (hours < 48) return plural(Math.round(hours), 'hour');
  return plural(Math.round(hours / 24), 'day');
}

export function analyse(input: AnalyseInput, ctx: AnalyseContext): AnalyseResult {
  const { profile, automation, region, now, zone } = ctx;
  const reasons: AnalysisReason[] = [];
  let blocked = false;
  let needsReview = false;
  const block = (text: string) => {
    blocked = true;
    reasons.push({ tone: 'block', text });
  };
  const warn = (text: string, review = true) => {
    if (review) needsReview = true;
    reasons.push({ tone: 'warn', text });
  };
  const good = (text: string) => reasons.push({ tone: 'good', text });

  const fullText = [input.title, input.description, input.documentText].filter(Boolean).join('.\n');
  const noticeType = detectNoticeType(input.title, input.description, input.noticeTypeHint);
  const relevance = assessRelevance(
    { title: input.title, description: `${input.description}\n${input.documentText}`, categories: input.categories },
    { includeKeywords: automation.includeKeywords },
  );
  const area = assessArea(
    {
      title: input.title,
      organization: input.organization,
      location: input.location,
      description: input.description,
      localSource: input.localSource,
      bcSource: input.bcSource,
    },
    region,
  );
  const facts = extractFacts(fullText, { zone, now, hints: { sourceDefault: input.sourceSubmission, url: input.url } });
  const requirements = buildRequirements(facts, profile, { now, zone });

  // --- Is it still open? ------------------------------------------------------
  let hoursLeft: number | null = null;
  if (input.status !== 'open') {
    block(input.status === 'awarded' ? 'Already awarded.' : input.status === 'cancelled' ? 'Cancelled by the buyer.' : 'No longer open.');
  }
  if (input.closesAt) {
    const deadline = closingDeadline(input.closesAt, input.closesAtPrecision, zone);
    hoursLeft = (deadline.getTime() - now.getTime()) / 3_600_000;
    const closedAt = new Date(input.closesAt).getTime();
    if (closedAt <= now.getTime()) {
      if (input.status === 'open') block(`Closed ${formatLocal(input.closesAt, input.closesAtPrecision, zone)}.`);
    } else if (hoursLeft < automation.minLeadDays * 24) {
      warn(
        hoursLeft <= 0
          ? `Closes today (${formatLocal(input.closesAt, input.closesAtPrecision, zone)}) — the time is not stated, so treat it as due now.`
          : `Closes in ${timeLeft(hoursLeft)} (${formatLocal(input.closesAt, input.closesAtPrecision, zone)}) — little time to prepare.`,
      );
    } else {
      good(`Closes ${formatLocal(input.closesAt, input.closesAtPrecision, zone)} — ${timeLeft(hoursLeft)} left.`);
    }
  } else if (input.status === 'open') {
    warn('Closing date not found — check the notice before relying on this.', false);
  }

  // --- Is it landscaping work? ------------------------------------------------
  const terms = relevance.matchedTerms.slice(0, 4).join(', ');
  if (relevance.score >= RELEVANT_AT) {
    if (relevance.inTitle) good(`Gardening / landscaping work (${terms}).`);
    else warn(`Landscaping is mentioned in the description but not the title (${terms}) — it may be a small part of a larger job.`);
  } else if (relevance.score >= BORDERLINE_AT) {
    warn(`Only loosely related to landscaping (${terms || 'weak wording'}).`);
  } else {
    block('Not gardening or landscaping work.');
  }

  const haystack = normalize(`${input.title} ${input.description}`);
  const excluded = automation.excludeKeywords.find((k) => phraseRegex(k)?.test(haystack));
  if (excluded) block(`Contains your excluded keyword “${excluded}”.`);

  // --- Is it in the service area? ---------------------------------------------
  if (area.area === 'yes') good(area.note);
  else if (area.area === 'unknown') warn(area.note);
  else block(area.note);

  // --- Can it be bid on at all? -----------------------------------------------
  if (noticeType === 'NOI') block('Notice of intent to award directly — not open to bids.');
  else if (noticeType === 'AWARD') block('Award notice — the contract has already been let.');
  else if (noticeType === 'RFI' && !automation.pursueTypes.includes('RFI')) block('Request for information only — no contract is being awarded.');
  else if (!automation.pursueTypes.includes(noticeType)) block(`${NOTICE_TYPE_LABELS[noticeType]} — a type you chose not to pursue.`);

  // --- Is it work the company does? -------------------------------------------
  let serviceFit: 'offered' | 'partial' | 'none' | 'undetected' = 'undetected';
  if (relevance.primary) {
    const offered = relevance.services.filter((s) => profile.services[s]);
    if (profile.services[relevance.primary]) {
      serviceFit = 'offered';
      good(`${SERVICE_LABELS[relevance.primary]} — a service you offer.`);
    } else if (offered.length > 0) {
      serviceFit = 'partial';
      warn(
        `Mainly ${SERVICE_LABELS[relevance.primary].toLowerCase()}, which you do not offer; also involves ${SERVICE_LABELS[offered[0]!].toLowerCase()}.`,
      );
    } else {
      serviceFit = 'none';
      if (relevance.score >= BORDERLINE_AT) {
        block(`${SERVICE_LABELS[relevance.primary]} — not a service in your profile.`);
      }
    }
  }

  // --- Does anything in the notice rule the company out? ----------------------
  let unmet = 0;
  for (const req of requirements) {
    if (req.met !== false) continue;
    unmet += 1;
    if (req.key === 'site_meeting') block(`The mandatory site meeting has already been held (${req.detail.replace(' — already held', '')}).`);
    else if (req.key === 'bid_bond') warn('Asks for a bid bond; your profile says bonding is not available.');
    else if (req.key === 'performance_bond') warn('Asks for a performance bond if awarded; your profile says bonding is not available.');
    else if (req.key === 'insurance') warn(`Insurance: ${req.detail}.`);
    else if (req.key === 'certification') warn(`Asks for ${req.label}, which is not in your profile.`);
    else if (req.key === 'references') warn(`Asks for ${req.label.toLowerCase()}; you have ${req.detail}.`);
  }
  const upcomingMeeting = requirements.find((r) => r.key === 'site_meeting' && r.met === null && facts.siteMeeting?.mandatory);
  if (upcomingMeeting) warn(`Mandatory site meeting: ${upcomingMeeting.detail}. You must attend before bidding.`, false);

  // --- Pricing basis ------------------------------------------------------------
  let pricing: PricingKind = facts.pricing;
  if (noticeType === 'RFSQ' || noticeType === 'RFEOI' || noticeType === 'RFI') pricing = pricing === 'lump_sum' ? 'lump_sum' : 'none';
  else if (noticeType === 'RFSO' && pricing === 'unknown') pricing = 'rates';

  // --- Score ----------------------------------------------------------------
  const areaPoints = area.area === 'yes' ? 20 : area.area === 'unknown' ? 8 : 0;
  const servicePoints = serviceFit === 'offered' ? 20 : serviceFit === 'partial' ? 10 : serviceFit === 'undetected' ? 12 : 0;
  let timingPoints = 5;
  if (hoursLeft !== null) {
    const days = hoursLeft / 24;
    timingPoints = days <= 0 ? 0 : days >= 14 ? 10 : days >= 7 ? 9 : days >= automation.minLeadDays ? 7 : 3;
  }
  const capabilityPoints = Math.max(0, 10 - unmet * 3);
  let score = Math.round(relevance.score * 0.4 + areaPoints + servicePoints + timingPoints + capabilityPoints);
  if (blocked) score = Math.min(score, 39);
  score = Math.max(0, Math.min(100, score));

  let decision: Decision;
  if (blocked) decision = 'unsuitable';
  else if (needsReview || score < automation.suitableThreshold) decision = 'review';
  else decision = 'suitable';

  // Most important first: blockers, then cautions, then what speaks for it.
  const order = { block: 0, warn: 1, bad: 2, good: 3 } as const;
  reasons.sort((a, b) => order[a.tone] - order[b.tone]);

  return {
    noticeType,
    score,
    decision,
    facts,
    analysis: {
      relevance: relevance.score,
      matchedTerms: relevance.matchedTerms,
      services: relevance.services,
      area: area.area,
      areaMatch: area.match,
      reasons,
      requirements,
      pricing,
      alsoListed: [],
    },
  };
}
