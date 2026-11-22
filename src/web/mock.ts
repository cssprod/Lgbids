/**
 * In-memory API used when VITE_MOCK=1, so every screen can be seen without the
 * server: in development, and as the hosted beta prototype (VITE_PROTOTYPE=1,
 * which also saves the state in the browser). All notices are invented; every
 * e-mail uses .example. Loaded with a dynamic import from api.ts and never part
 * of the real app's build.
 */
import type {
  AlertInboxView,
  PushSettingsView,
  TelegramChatResult,
  ActionResult,
  AlertImportResult,
  DashboardResponse,
  EmailSettingsView,
  OpportunityList,
  OpportunityViewName,
  ProfileResponse,
  RunState,
  SessionInfo,
} from '../shared/api.js';
import type {
  Analysis,
  ServiceKey,
  Application,
  ApplicationStatus,
  AutomationSettings,
  EventRecord,
  LibraryDocument,
  Opportunity,
  Profile,
  RegionSettings,
  RunRecord,
  SourceRecord,
} from '../shared/schemas.js';
import { automationSchema, profileSchema } from '../shared/schemas.js';
import { feedbackCsv, feedbackCsvFilename, opportunitiesCsv, opportunitiesCsvFilename } from '../shared/csv.js';
import type { MockResponse } from './api.js';
import { formatDate, formatDateTime } from './format.js';
import { alerts } from './mock/alerts.js';
import { awards } from './mock/awards.js';
import { DAY, fail, HOUR, iso, now, ok, type MockContext, type MockModule, type MockState, type MockV2State } from './mock/context.js';
import { feedback } from './mock/feedback.js';
import { manual } from './mock/manual.js';
import { searches } from './mock/searches.js';
import { initialSources, sources as sourceRoutes } from './mock/sources.js';

/** End of a local day N days from now, as stored for date-only closings. */
function endOfDay(days: number): string {
  const d = new Date(now + days * DAY);
  d.setHours(23, 59, 59, 0);
  return d.toISOString();
}
const params = new URLSearchParams(location.search);
// ?mockAuth=1 shows the sign-in screen; ?mockEmpty=1 shows empty states.
const EMPTY = params.get('mockEmpty') === '1' || sessionStorage.getItem('mockEmpty') === '1';
if (params.get('mockEmpty') === '1') sessionStorage.setItem('mockEmpty', '1');
if (params.get('mockEmpty') === '0') sessionStorage.removeItem('mockEmpty');
let authenticated = !(params.get('mockAuth') === '1');
const authRequired = params.get('mockAuth') === '1';

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

let profile: Profile = profileSchema.parse({
  legalName: 'Garry Oak Landscapes Ltd.',
  tradeName: 'Garry Oak Landscapes',
  addressLine: '100 Sample Road',
  city: 'Victoria',
  postalCode: 'V8Z 0A0',
  phone: '250-555-0142',
  email: 'office@garryoak.example',
  contactName: 'Sam Rivera',
  contactTitle: 'Operations manager',
  signatoryName: '',
  gstNumber: '123456789 RT0001',
  worksafeNumber: '',
  yearEstablished: 2011,
  crewSize: 9,
  insuranceProvider: 'Sample Mutual Insurance',
  insurancePolicy: 'CGL-55501',
  insuranceLiability: 5000000,
  insuranceExpiry: '2027-03-31',
  certifications: ['ISA Certified Arborist PN-0000A (sample)'],
  credentials: { isaArborist: true, firstAid: true },
  about: 'Garry Oak Landscapes has maintained parks, strata grounds and school sites around Greater Victoria since 2011.',
  references: [
    { client: 'Sample Strata Corporation', contactName: 'Pat Lee', contactInfo: 'pat@strata.example', description: 'Weekly grounds maintenance for 140 units.', year: '2022–2026', value: '$48,000 / year' },
  ],
  rates: [
    { label: 'Labourer', unit: 'hour', rate: 62 },
    { label: 'Foreman with truck', unit: 'hour', rate: 95 },
  ],
});

function analysis(partial: Partial<Analysis>): Analysis {
  return {
    relevance: 80,
    matchedTerms: ['landscape maintenance'],
    services: ['grounds'],
    area: 'yes',
    areaMatch: 'Saanich',
    reasons: [],
    requirements: [],
    pricing: 'lump_sum',
    alsoListed: [],
    ...partial,
  };
}

function opp(p: Partial<Opportunity> & Pick<Opportunity, 'id' | 'title' | 'organization'>): Opportunity {
  return {
    sourceId: 'email-alerts',
    sourceName: 'Bid alert e-mails (BC Bid and Bonfire)',
    externalId: `ext-${p.id}`,
    referenceNumber: '',
    noticeType: 'RFQ',
    description: '',
    url: `https://bids.example/notice/${p.id}`,
    publishedAt: iso(-5 * DAY),
    closesAt: iso(10 * DAY),
    closesAtPrecision: 'datetime',
    closesAtRaw: '',
    location: '',
    categories: [],
    contactName: '',
    contactEmail: '',
    contactPhone: '',
    documents: [],
    submissionMethod: 'email',
    submissionEmail: '',
    submissionUrl: '',
    status: 'open',
    suitabilityScore: 70,
    decision: 'suitable',
    userDecision: null,
    analysis: null,
    duplicateOf: null,
    firstSeenAt: iso(-4 * DAY),
    lastSeenAt: iso(-2 * HOUR),
    application: null,
    alertsMuted: false,
    unseenChanges: 0,
    lastChangedAt: null,
    ...p,
  };
}

let opportunities: Opportunity[] = [
  opp({
    id: 101,
    title: 'RFQ 26-140 – Boulevard and Median Landscape Maintenance',
    organization: 'Sample District of Saanich',
    referenceNumber: 'RFQ 26-140',
    noticeType: 'RFQ',
    sourceId: 'saanich-rss',
    sourceName: 'District of Saanich — bid opportunities feed',
    closesAt: iso(3 * DAY + 5 * HOUR),
    location: 'Saanich, BC',
    submissionMethod: 'email',
    submissionEmail: 'purchasing@saanich-sample.example',
    contactName: 'Jordan Purchasing',
    contactEmail: 'purchasing@saanich-sample.example',
    contactPhone: '250-555-0100',
    suitabilityScore: 86,
    description:
      'The District invites quotations for the maintenance of boulevards and medians along major roads for the 2027 season.\n\nWork includes mowing, edging, shrub bed weeding, litter pick-up and seasonal pruning. Crews must carry traffic control certification.\n\nQuotations must be e-mailed as a single PDF to the address below.',
    documents: [
      { name: 'RFQ 26-140 document (PDF)', url: 'https://bids.example/files/rfq-26-140.pdf' },
      { name: 'Site map', url: 'https://bids.example/files/rfq-26-140-map.pdf' },
    ],
    analysis: analysis({
      services: ['grounds', 'lawn', 'garden'],
      reasons: [
        { tone: 'good', text: 'Asks for grounds maintenance, mowing and shrub bed care, which you offer.' },
        { tone: 'good', text: 'Work is in Saanich, inside your service area.' },
        { tone: 'warn', text: 'Crews need traffic control certification; your profile does not say.' },
        { tone: 'good', text: 'Submitted by e-mail, so Lgbids can send it for you.' },
      ],
      requirements: [
        { key: 'insurance', label: 'General liability insurance', detail: '$5,000,000', met: true },
        { key: 'worksafe', label: 'WorkSafeBC clearance letter', detail: '', met: false },
        { key: 'certification', label: 'Traffic control certification', detail: 'All crew on roadways', met: null },
        { key: 'pricing', label: 'Price form', detail: 'Annual lump sum', met: null },
      ],
      alsoListed: [{ source: 'Bid alert e-mails (BC Bid and Bonfire)', url: 'https://bids.example/bcbid/101' }],
    }),
  }),
  opp({
    id: 102,
    title: 'ITT PRK-26-07 – Sports Field Mowing and Turf Maintenance',
    organization: 'Sample City of Langford',
    referenceNumber: 'PRK-26-07',
    noticeType: 'ITT',
    sourceId: 'email-alerts',
    sourceName: 'Bid alert e-mails (BC Bid and Bonfire)',
    closesAt: endOfDay(12),
    closesAtPrecision: 'date',
    closesAtRaw: 'December 2026',
    // The sample change below (MAT-15): the buyer moved the closing date.
    unseenChanges: 1,
    lastChangedAt: iso(-3 * HOUR),
    submissionMethod: 'bcbid',
    submissionUrl: 'https://bcbid.example/opportunity/PRK-26-07',
    location: 'Langford, BC',
    suitabilityScore: 78,
    description: 'Mowing, aeration, top dressing and line painting of eight sports fields.\nMandatory site meeting on the 1st.',
    analysis: analysis({
      services: ['lawn'],
      reasons: [
        { tone: 'good', text: 'Sports field and turf work you offer.' },
        { tone: 'warn', text: 'A site meeting is mandatory. Make sure you attend.' },
        { tone: 'warn', text: 'Submitted on BC Bid; you upload the package there yourself.' },
      ],
      requirements: [
        { key: 'site_meeting', label: 'Mandatory site meeting', detail: 'At the Westhills fields', met: null },
        { key: 'bid_bond', label: 'Bid bond', detail: '10% of the bid', met: false },
      ],
    }),
  }),
  opp({
    id: 103,
    title: 'Cemetery Grounds Maintenance',
    organization: 'Sample District of Metchosin',
    noticeType: 'RFP',
    closesAt: iso(26 * HOUR),
    submissionMethod: 'email',
    submissionEmail: 'admin@metchosin-sample.example',
    suitabilityScore: 72,
    analysis: analysis({ reasons: [{ tone: 'good', text: 'Grounds maintenance in Metchosin.' }, { tone: 'warn', text: 'Closes in about a day.' }] }),
  }),
  opp({
    id: 104,
    title: 'RFP 26-055 – Parks and Trails Master Plan',
    organization: 'Sample Town of View Royal',
    noticeType: 'RFP',
    decision: 'review',
    suitabilityScore: 52,
    submissionMethod: 'bonfire',
    submissionUrl: 'https://viewroyal-sample.bonfirehub.example/opportunities/123',
    analysis: analysis({
      services: ['design'],
      reasons: [
        { tone: 'warn', text: 'Mostly planning and consulting work; you offer design only as a minor service.' },
        { tone: 'good', text: 'Buyer is local.' },
      ],
    }),
  }),
  opp({
    id: 105,
    title: 'Hartland Landfill Invasive Species Control',
    organization: 'Sample Capital Regional District',
    noticeType: 'RFQ',
    decision: 'review',
    suitabilityScore: 58,
    closesAt: iso(6 * DAY),
    submissionMethod: 'unknown',
    analysis: analysis({
      services: ['vegetation'],
      reasons: [
        { tone: 'good', text: 'Invasive plant control, which you offer.' },
        { tone: 'warn', text: 'A pesticide applicator certificate may be needed.' },
        { tone: 'warn', text: 'How to submit is not stated. Check the documents.' },
      ],
    }),
  }),
  opp({
    id: 106,
    title: 'Landscape Maintenance Services – Kelowna Courthouse',
    organization: 'Sample BC Government',
    noticeType: 'RFQ',
    decision: 'unsuitable',
    suitabilityScore: 18,
    location: 'Kelowna, BC',
    analysis: analysis({
      area: 'no',
      areaMatch: 'Kelowna',
      reasons: [{ tone: 'block', text: 'The work is in Kelowna, outside your service area.' }, { tone: 'good', text: 'Landscape maintenance you offer.' }],
    }),
  }),
  opp({
    id: 107,
    title: 'Janitorial Services – Institute of Ocean Sciences, Sidney',
    organization: 'Sample Federal Department',
    noticeType: 'RFP',
    decision: 'unsuitable',
    suitabilityScore: 4,
    analysis: analysis({ services: [], reasons: [{ tone: 'block', text: 'Not gardening or landscaping work.' }] }),
  }),
  opp({
    id: 108,
    title: 'Memorial Park Garden Maintenance',
    organization: 'Sample Township of Esquimalt',
    noticeType: 'RFQ',
    closesAt: iso(-3 * DAY),
    status: 'closed',
    suitabilityScore: 81,
    analysis: analysis({ reasons: [{ tone: 'good', text: 'Garden maintenance in Esquimalt.' }] }),
  }),
  opp({
    id: 109,
    title: 'Rock Wall Construction',
    organization: 'Sample Oak Bay',
    noticeType: 'ITT',
    userDecision: 'dismissed',
    suitabilityScore: 55,
    decision: 'review',
    analysis: analysis({ services: ['hardscape'], reasons: [{ tone: 'bad', text: 'Hardscape work, which you do not offer.' }] }),
  }),
  opp({
    id: 110,
    title: 'RFP 2026-18 – School Grounds Maintenance and Landscaping Services',
    organization: 'Sample School District No. 61',
    noticeType: 'RFP',
    closesAt: iso(20 * DAY),
    submissionMethod: 'bcbid',
    submissionUrl: 'https://bcbid.example/opportunity/110',
    suitabilityScore: 74,
    analysis: analysis({ reasons: [{ tone: 'good', text: 'School grounds maintenance across Greater Victoria.' }] }),
  }),
];

function app(p: Partial<Application> & Pick<Application, 'id' | 'opportunityId' | 'status'>): Application {
  return {
    channel: 'email',
    toEmail: '',
    ccEmail: '',
    subject: '',
    body: '',
    priceTotal: null,
    priceNotes: '',
    includeRates: false,
    checklist: [],
    documentIds: [1],
    files: [],
    missing: [],
    autoGenerated: true,
    editedByUser: false,
    submittedAt: null,
    submittedVia: '',
    submissionRef: '',
    error: '',
    notes: '',
    remindedAt: null,
    createdAt: iso(-2 * DAY),
    updatedAt: iso(-1 * DAY),
    ...p,
  };
}

const letter = (title: string) =>
  `Dear Purchasing Team,\n\nGarry Oak Landscapes Ltd. is pleased to submit our quotation for ${title}.\n\nWe have maintained parks, strata grounds and school sites around Greater Victoria since 2011, with a crew of 9.\n\nOur price and the completed forms are attached.\n\nSincerely,\n\nSam Rivera\nOperations manager\nGarry Oak Landscapes Ltd.\n250-555-0142`;

let applications: Application[] = [
  app({
    id: 201,
    opportunityId: 101,
    status: 'needs_input',
    toEmail: 'purchasing@saanich-sample.example',
    subject: 'Quotation – RFQ 26-140 Boulevard and Median Landscape Maintenance',
    body: letter('RFQ 26-140 Boulevard and Median Landscape Maintenance'),
    checklist: [
      { key: 'forms', label: 'Complete the buyer’s price form', detail: 'Appendix B in the RFQ document', done: false, required: true },
      { key: 'insurance', label: 'Attach the insurance certificate', detail: '$5,000,000 general liability', done: true, required: false },
      { key: 'certification', label: 'Confirm traffic control certification', detail: '', done: false, required: true },
    ],
    missing: ['Enter your total price.', 'Add the signatory’s name in your company profile.', 'Tick “Complete the buyer’s price form” once it is attached.'],
  }),
  app({
    id: 202,
    opportunityId: 102,
    status: 'ready',
    channel: 'portal',
    priceTotal: 64800,
    body: letter('ITT PRK-26-07 Sports Field Mowing and Turf Maintenance'),
    checklist: [{ key: 'site_meeting', label: 'Attend the mandatory site meeting', detail: 'Westhills fields', done: true, required: true }],
  }),
  app({
    id: 203,
    opportunityId: 103,
    status: 'failed',
    toEmail: 'admin@metchosin-sample.example',
    subject: 'Proposal – Cemetery Grounds Maintenance',
    body: letter('Cemetery Grounds Maintenance'),
    priceTotal: 22500,
    error: 'The mail server refused the message: 535 5.7.8 Username and Password not accepted. Check the user name and password in Settings → Outgoing e-mail.',
  }),
  app({
    id: 204,
    opportunityId: 108,
    status: 'submitted',
    toEmail: 'parks@esquimalt-sample.example',
    subject: 'Quotation – Memorial Park Garden Maintenance',
    body: letter('Memorial Park Garden Maintenance'),
    priceTotal: 18400,
    submittedAt: iso(-5 * DAY),
    submittedVia: 'E-mail to parks@esquimalt-sample.example',
    submissionRef: '',
  }),
  app({
    id: 205,
    opportunityId: 110,
    status: 'won',
    channel: 'portal',
    priceTotal: 132000,
    submittedAt: iso(-40 * DAY),
    submittedVia: 'BC Bid',
    submissionRef: 'BCB-778812',
  }),
];

function linkApps() {
  for (const o of opportunities) {
    const a = applications.find((x) => x.opportunityId === o.id);
    o.application = a ? { id: a.id, status: a.status } : null;
  }
}
linkApps();

let documents: LibraryDocument[] = [
  { id: 1, name: 'Certificate of insurance 2026', kind: 'insurance', filename: 'COI-2026.pdf', mime: 'application/pdf', size: 184_220, expiresOn: ymd(20), attachByDefault: true, createdAt: iso(-200 * DAY) },
  { id: 2, name: 'WorkSafeBC clearance letter', kind: 'worksafe', filename: 'wsbc-clearance.pdf', mime: 'application/pdf', size: 92_004, expiresOn: ymd(-4), attachByDefault: true, createdAt: iso(-100 * DAY) },
  { id: 3, name: 'Safety program summary', kind: 'safety', filename: 'safety-program.pdf', mime: 'application/pdf', size: 1_402_112, expiresOn: '', attachByDefault: false, createdAt: iso(-60 * DAY) },
];

function ymd(days: number): string {
  const d = new Date(now + days * DAY);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** One "layout may have changed" sample, so testers see how Today and Sources show it. */
function withWarningSample(list: SourceRecord[]): SourceRecord[] {
  return list.map((s) =>
    s.id === 'esquimalt'
      ? {
          ...s,
          layoutWarning:
            'This site returned no notices this time but listed 17 notices last time — its layout may have changed. Open it and check, then press “Test”. If the buyer simply has nothing open, this warning clears once the site lists notices again.',
        }
      : s,
  );
}

let sources: SourceRecord[] = withWarningSample(initialSources());

let automation: AutomationSettings = automationSchema.parse({ notifyEmail: 'office@garryoak.example' });
let region: RegionSettings = {
  places: ['Victoria', 'Saanich', 'Oak Bay', 'Esquimalt', 'View Royal', 'Langford', 'Colwood', 'Metchosin', 'Sooke', 'Sidney', 'North Saanich', 'Central Saanich'],
  excludePlaces: ['Salt Spring Island', 'Port Renfrew'],
  organizations: ['Capital Regional District', 'School District No. 61', 'University of Victoria'],
};
const defaultRegion = structuredClone(region);
let alertInbox: AlertInboxView = { host: 'imap.gmail.com', port: 993, secure: true, user: '', folder: 'INBOX', lookbackDays: 30, verifiedAt: null, hasPassword: false };
let push: PushSettingsView = { provider: 'off', telegramChatId: '', ntfyServer: 'https://ntfy.sh', ntfyTopic: '', verifiedAt: null, hasTelegramToken: false, hasNtfyToken: false };
let email: EmailSettingsView = {
  host: 'smtp.example.com',
  port: 587,
  secure: false,
  user: 'office@garryoak.example',
  fromName: 'Garry Oak Landscapes',
  fromEmail: 'office@garryoak.example',
  replyTo: '',
  bccSelf: true,
  verifiedAt: null,
  hasPassword: true,
  fromEnvironment: [],
};

function runRecord(id: number, offset: number, status: RunRecord['status'], trigger: RunRecord['trigger'] = 'schedule'): RunRecord {
  return {
    id,
    trigger,
    status,
    startedAt: iso(offset),
    finishedAt: iso(offset + 74_000),
    error: status === 'error' ? 'No source could be read. Check the internet connection.' : '',
    stats: {
      found: 260,
      added: id % 3,
      analysed: 18,
      suitable: 3,
      drafted: id % 2,
      sent: 0,
      expired: 0,
      sources: sources.map((s) => ({ sourceId: s.id, name: s.name, status: s.lastStatus, message: s.lastMessage, found: s.lastItemCount ?? 0, added: 0, ms: 2300 + s.name.length * 90 })),
    },
  };
}

let runs: RunRecord[] = [runRecord(14, -2 * HOUR, 'ok'), runRecord(13, -8 * HOUR, 'ok'), runRecord(12, -14 * HOUR, 'ok', 'manual'), runRecord(11, -20 * HOUR, 'error', 'startup')];
let running: RunRecord | null = null;

let events: EventRecord[] = [
  { id: 9, at: iso(-2 * HOUR), level: 'info', kind: 'source', message: 'District of Oak Bay — tenders listed nothing open. That is normal when the buyer has nothing out to bid.', opportunityId: null, applicationId: null, runId: 14 },
  { id: 8, at: iso(-2 * HOUR), level: 'info', kind: 'drafted', message: 'Drafted an application for “RFQ 26-140 – Boulevard and Median Landscape Maintenance”. It needs your input.', opportunityId: 101, applicationId: 201, runId: 14 },
  { id: 7, at: iso(-2 * HOUR), level: 'info', kind: 'found', message: 'Found a suitable bid: “RFQ 26-140 – Boulevard and Median Landscape Maintenance” (score 86).', opportunityId: 101, applicationId: null, runId: 14 },
  { id: 6, at: iso(-9 * HOUR), level: 'error', kind: 'send', message: 'Sending “Cemetery Grounds Maintenance” failed: the mail server refused the password.', opportunityId: 103, applicationId: 203, runId: null },
  { id: 5, at: iso(-5 * DAY), level: 'info', kind: 'submitted', message: 'Submitted “Memorial Park Garden Maintenance” by e-mail.', opportunityId: 108, applicationId: 204, runId: null },
];

if (EMPTY) {
  opportunities = [];
  applications = [];
  documents = [];
  runs = [];
  events = [];
  sources = [];
  profile = profileSchema.parse({});
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let nextId = 1000;
const withOpp = (a: Application): Application => ({ ...a, opportunity: opportunities.find((o) => o.id === a.opportunityId) });

function profileMissing(): string[] {
  const m: string[] = [];
  if (!profile.legalName) m.push('Your legal business name.');
  if (!profile.signatoryName) m.push('The name of the person who signs submissions.');
  if (!profile.worksafeNumber) m.push('Your WorkSafeBC account number.');
  if (!profile.email) m.push('A company e-mail address.');
  return m;
}

function viewOf(o: Opportunity): OpportunityViewName[] {
  const v: OpportunityViewName[] = ['all'];
  if (o.userDecision === 'dismissed') return [...v, 'dismissed'];
  if (o.status !== 'open' || (o.closesAt && new Date(o.closesAt).getTime() < Date.now())) return [...v, 'closed'];
  if (o.decision === 'suitable' || o.userDecision === 'pursue') v.push('suitable');
  else if (o.decision === 'review') v.push('review');
  else if (o.decision === 'unsuitable') v.push('unsuitable');
  return v;
}

/** The list filters, as the server applies them; the CSV download takes the same ones. */
function filterOpportunities(q: URLSearchParams): { items: Opportunity[]; counts: Record<OpportunityViewName, number> } {
  const view = (q.get('view') ?? 'suitable') as OpportunityViewName;
  const text = (q.get('q') ?? '').toLowerCase();
  const sourceId = q.get('sourceId') ?? '';
  const within = Number(q.get('closingWithinDays') ?? 0);
  // UX-13 filters, read like the server does.
  const minScore = /^\d{1,3}$/.test(q.get('minScore') ?? '') ? Number(q.get('minScore')) : null;
  const service = q.get('service') ?? '';
  const place = (q.get('place') ?? '').trim().toLowerCase();
  const match = (o: Opportunity) =>
    (minScore === null || (o.suitabilityScore !== null && o.suitabilityScore >= minScore)) &&
    (!service || (o.analysis?.services ?? []).includes(service as ServiceKey)) &&
    (!place || `${o.analysis?.areaMatch ?? ''}\n${o.location ?? ''}`.toLowerCase().includes(place)) &&
    (!text || `${o.title} ${o.organization} ${o.referenceNumber}`.toLowerCase().includes(text)) &&
    (!sourceId || o.sourceId === sourceId) &&
    (!within || (o.closesAt !== null && new Date(o.closesAt).getTime() <= Date.now() + within * DAY));
  const counts = { suitable: 0, review: 0, unsuitable: 0, closed: 0, dismissed: 0, all: 0 } as Record<OpportunityViewName, number>;
  for (const o of opportunities.filter(match)) for (const v of viewOf(o)) counts[v]++;
  const items = opportunities
    .filter((o) => match(o) && viewOf(o).includes(view))
    .sort((a, b) => (b.suitabilityScore ?? 0) - (a.suitabilityScore ?? 0));
  return { items, counts };
}

function recompute(a: Application): Application {
  const missing: string[] = [];
  if (a.priceTotal === null) missing.push('Enter your total price.');
  if (!profile.signatoryName) missing.push('Add the signatory’s name in your company profile.');
  for (const c of a.checklist) if (c.required && !c.done) missing.push(`Tick “${c.label}” once it is done.`);
  if (a.channel === 'email' && !a.toEmail) missing.push('Enter the buyer’s e-mail address.');
  const status: ApplicationStatus = ['needs_input', 'ready'].includes(a.status) ? (missing.length ? 'needs_input' : 'ready') : a.status;
  return { ...a, missing, status, updatedAt: new Date().toISOString() };
}

function updateApp(id: number, fn: (a: Application) => Application): MockResponse {
  const i = applications.findIndex((a) => a.id === id);
  if (i < 0) return fail(404, 'That application no longer exists.');
  applications[i] = fn(applications[i]!);
  linkApps();
  return ok(withOpp(applications[i]!));
}

function dashboard(): DashboardResponse {
  const open = opportunities.filter((o) => viewOf(o).includes('suitable'));
  return {
    demo: true,
    timeZone: 'America/Vancouver',
    mode: automation.mode,
    running: running !== null,
    lastRun: runs[0] ?? null,
    nextRunAt: automation.mode === 'off' ? null : iso(4 * HOUR),
    counts: {
      openSuitable: open.length,
      review: opportunities.filter((o) => viewOf(o).includes('review')).length,
      needsInput: applications.filter((a) => a.status === 'needs_input').length,
      ready: applications.filter((a) => a.status === 'ready').length,
      submitted: applications.filter((a) => a.status === 'submitted').length,
      closingSoon: open.filter((o) => o.closesAt && new Date(o.closesAt).getTime() - Date.now() < 7 * DAY).length,
      sourcesFailing: sources.filter((s) => s.enabled && (s.lastStatus === 'error' || s.lastStatus === 'blocked')).length,
      sourcesEnabled: sources.filter((s) => s.enabled).length,
      sourcesWarning: sources.filter((s) => s.enabled && s.layoutWarning).length,
      unseenChanges: opportunities.reduce((n, o) => n + (o.unseenChanges ?? 0), 0),
      awaitingResult: applications.filter((a) => {
        const closesAt = opportunities.find((o) => o.id === a.opportunityId)?.closesAt;
        return a.status === 'submitted' && !!closesAt && Date.now() - new Date(closesAt).getTime() >= 14 * DAY;
      }).length,
    },
    attention: applications.filter((a) => ['needs_input', 'ready', 'failed'].includes(a.status)).map(withOpp),
    deadlines: open.filter((o) => o.closesAt).sort((a, b) => (a.closesAt! < b.closesAt! ? -1 : 1)),
    setup: [
      { key: 'profile', label: 'Fill in your company profile', done: profileMissing().length === 0, href: '/profile' },
      { key: 'alerts', label: 'Connect your bid alert inbox (BC Bid and Bonfire)', done: alertInbox.verifiedAt !== null || (sources.find((s) => s.kind === 'email_alerts')?.lastItemCount ?? 0) > 0, href: '/settings#alerts' },
      // Same keys, order and links as src/server/dashboard.ts.
      { key: 'services', label: 'Choose the services you offer', done: profileMissing().length === 0, href: '/profile' },
      { key: 'email', label: 'Set up outgoing e-mail', done: email.verifiedAt !== null, href: '/settings#email' },
      { key: 'documents', label: 'Upload your insurance and WorkSafeBC documents', done: documents.length > 0, href: '/documents' },
      { key: 'run', label: 'Run the first search', done: runs.length > 0, href: '/' },
      { key: 'push', label: 'Get alerts on your phone (optional)', optional: true, done: push.verifiedAt !== null, href: '/settings#push' },
    ],
    sources,
  };
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

type Body = Record<string, unknown>;

/** One sample change, so the Changed chip, the timeline and the application banner can be tried. */
const SAMPLE_CHANGES: MockV2State['changes'] = EMPTY
  ? []
  : [
      {
        id: 901,
        opportunityId: 102,
        kind: 'closing_moved',
        summary: `The closing date moved from ${formatDate(endOfDay(9), 'America/Vancouver')} to ${formatDate(endOfDay(12), 'America/Vancouver')}.`,
        before: endOfDay(9),
        after: endOfDay(12),
        addendum: false,
        detectedAt: iso(-3 * HOUR),
        runId: 14,
        notifiedAt: iso(-3 * HOUR),
        seenAt: null,
      },
    ];

let v2: MockV2State = { changes: SAMPLE_CHANGES, feedback: [], awards: [], savedSearches: [], recipients: [] };

/** Live view of the core state for the mock modules (getters, so reassignments here are seen there). */
const state: MockState = {
  get opportunities() {
    return opportunities;
  },
  set opportunities(value) {
    opportunities = value;
  },
  get applications() {
    return applications;
  },
  set applications(value) {
    applications = value;
  },
  get sources() {
    return sources;
  },
  set sources(value) {
    sources = value;
  },
  get v2() {
    return v2;
  },
  set v2(value) {
    v2 = value;
  },
};

const ctx: MockContext = { state, newId: () => nextId++, updateApp: (id, fn) => updateApp(id, fn), recompute: (a) => recompute(a) };

/** v2 and moved routes, tried in order before the core routes. */
const MODULES: MockModule[] = [sourceRoutes, awards, alerts, feedback, searches, manual];

async function route(method: string, fullPath: string, rawBody: unknown): Promise<MockResponse> {
  await new Promise((r) => setTimeout(r, 120 + Math.random() * 180));
  const url = new URL(fullPath, location.origin);
  const path = url.pathname;
  const q = url.searchParams;
  const body = (rawBody ?? {}) as Body;
  const m = (re: RegExp) => re.exec(path);
  let r: RegExpExecArray | null;

  if (path === '/api/session') return ok({ authRequired, authenticated, demo: true } satisfies SessionInfo);
  if (path === '/api/login') {
    if (body.password === 'demo') authenticated = true;
    else return fail(401, 'That password is not right. In the mock, the password is “demo”.');
    return ok({ authRequired, authenticated, demo: true } satisfies SessionInfo);
  }
  if (path === '/api/logout') {
    authenticated = false;
    return ok({ authRequired, authenticated, demo: true } satisfies SessionInfo);
  }
  if (authRequired && !authenticated) return fail(401, 'Please sign in.');

  if (path === '/api/dashboard') return ok(dashboard());

  for (const handle of MODULES) {
    const res = await handle(ctx, { method, path, q, body, rawBody });
    if (res) return res;
  }
  if (path === '/api/status' || path === '/api/recipients' || /^\/api\/recipients\/\d+(\/test)?$/.test(path)) {
    return fail(501, 'Not built yet.');
  }

  // Opportunities
  if (path === '/api/opportunities' && method === 'GET') {
    const limit = Number(q.get('limit') ?? 50);
    const offset = Number(q.get('offset') ?? 0);
    const { items, counts } = filterOpportunities(q);
    return ok({ items: items.slice(offset, offset + limit), total: items.length, counts } satisfies OpportunityList);
  }
  if ((r = m(/^\/api\/opportunities\/(\d+)$/))) {
    const o = opportunities.find((x) => x.id === Number(r![1]));
    return o ? ok({ ...o, award: v2.awards.find((a) => a.opportunityId === o.id) ?? null, myFeedback: v2.feedback.find((f) => f.opportunityId === o.id) ?? null }) : fail(404, 'That opportunity no longer exists.');
  }
  if ((r = m(/^\/api\/opportunities\/(\d+)\/decision$/))) {
    const o = opportunities.find((x) => x.id === Number(r![1]));
    if (!o) return fail(404, 'That opportunity no longer exists.');
    o.userDecision = (body.decision as Opportunity['userDecision']) ?? null;
    if (o.userDecision === 'pursue' && !o.application) {
      const a = recompute(
        app({
          id: nextId++,
          opportunityId: o.id,
          status: 'needs_input',
          channel: o.submissionMethod === 'email' ? 'email' : o.submissionMethod === 'hardcopy' ? 'manual' : 'portal',
          toEmail: o.submissionEmail,
          subject: `Submission – ${o.title}`,
          body: letter(o.title),
          createdAt: new Date().toISOString(),
        }),
      );
      applications.push(a);
      linkApps();
    }
    return ok(o);
  }

  // Applications
  if (path === '/api/applications') {
    const statuses = q.get('status')?.split(',') ?? null;
    return ok(applications.filter((a) => !statuses || statuses.includes(a.status)).map(withOpp));
  }
  if ((r = m(/^\/api\/applications\/(\d+)$/))) {
    const id = Number(r[1]);
    if (method === 'PATCH') {
      return updateApp(id, (a) => {
        const next = { ...a, ...(body as Partial<Application>), editedByUser: true };
        if (Array.isArray(body.checklist)) {
          const done = new Map((body.checklist as { key: string; done: boolean }[]).map((c) => [c.key, c.done]));
          next.checklist = a.checklist.map((c) => ({ ...c, done: done.get(c.key) ?? c.done }));
        }
        return recompute(next);
      });
    }
    const a = applications.find((x) => x.id === id);
    return a ? ok(withOpp(a)) : fail(404, 'That application no longer exists.');
  }
  if ((r = m(/^\/api\/applications\/(\d+)\/regenerate$/))) {
    return updateApp(Number(r[1]), (a) => {
      const o = opportunities.find((x) => x.id === a.opportunityId);
      return recompute({ ...a, body: letter(o?.title ?? 'this opportunity'), editedByUser: false });
    });
  }
  if ((r = m(/^\/api\/applications\/(\d+)\/send$/))) {
    const a = applications.find((x) => x.id === Number(r![1]));
    if (!a) return fail(404, 'That application no longer exists.');
    if (a.missing.length) return fail(409, `This cannot be sent yet: ${a.missing.join(' ')}`);
    if (a.id === 203) return fail(409, 'The mail server refused the message: 535 5.7.8 Username and Password not accepted.');
    return updateApp(a.id, (x) => ({ ...x, status: 'submitted', error: '', submittedAt: new Date().toISOString(), submittedVia: `E-mail to ${x.toEmail}` }));
  }
  if ((r = m(/^\/api\/applications\/(\d+)\/mark-submitted$/))) {
    return updateApp(Number(r[1]), (x) => ({
      ...x,
      status: 'submitted',
      submittedAt: new Date().toISOString(),
      submittedVia: String(body.via ?? ''),
      submissionRef: String(body.ref ?? ''),
    }));
  }
  if ((r = m(/^\/api\/applications\/(\d+)\/files$/))) {
    const file = rawBody instanceof FormData ? rawBody.get('file') : null;
    if (!(file instanceof File)) return fail(400, 'Choose a file to upload.');
    const fid = nextId++;
    fileBlobs.set(fid, file);
    return updateApp(Number(r[1]), (x) => ({ ...x, files: [...x.files, { id: fid, name: file.name, size: file.size, mime: file.type }] }));
  }
  if ((r = m(/^\/api\/applications\/(\d+)\/files\/(\d+)$/)) && method === 'DELETE') {
    const fid = Number(r[2]);
    return updateApp(Number(r[1]), (x) => ({ ...x, files: x.files.filter((f) => f.id !== fid) }));
  }

  // Profile and settings
  if (path === '/api/profile') {
    if (method === 'PUT') profile = profileSchema.parse(body);
    if (method === 'PUT') applications = applications.map(recompute);
    return ok({ profile, missing: profileMissing() } satisfies ProfileResponse);
  }
  if (path === '/api/settings/automation') {
    if (method === 'PUT') {
      const parsed = automationSchema.safeParse(body);
      if (!parsed.success) return fail(400, 'Some automation settings are out of range. Check the numbers and try again.');
      automation = parsed.data;
    }
    return ok(automation);
  }
  if (path === '/api/settings/region/reset') {
    region = structuredClone(defaultRegion);
    return ok(region);
  }
  if (path === '/api/settings/region') {
    if (method === 'PUT') region = body as unknown as RegionSettings;
    return ok(region);
  }
  if (path === '/api/settings/alert-inbox/test') {
    alertInbox = { ...alertInbox, verifiedAt: new Date().toISOString() };
    return ok({ ok: true, message: 'Connected. Found 2 alert e-mails from BC Bid or Bonfire in “INBOX” from the last 30 days.' } satisfies ActionResult);
  }
  if (path === '/api/settings/alert-inbox') {
    if (method === 'PUT') {
      const { pass, ...rest } = body as Body & { pass?: string };
      alertInbox = { ...alertInbox, ...(rest as Partial<AlertInboxView>), hasPassword: alertInbox.hasPassword || !!pass, verifiedAt: null };
    }
    return ok(alertInbox);
  }
  // Phone alerts: the prototype keeps the settings but never contacts Telegram or ntfy.
  if (path === '/api/settings/push/test') {
    push = { ...push, verifiedAt: new Date().toISOString() };
    return ok({ ok: true, message: 'This is the prototype, so no alert was actually sent. In the real app a test alert would now arrive on your phone.' } satisfies ActionResult);
  }
  if (path === '/api/settings/push/telegram-chat') {
    push = { ...push, telegramChatId: '123456789', verifiedAt: null };
    return ok({ ok: true, chatId: '123456789', message: 'Found the chat with you and saved it (a sample chat id in the prototype). Now send a test alert.' } satisfies TelegramChatResult);
  }
  if (path === '/api/settings/push') {
    if (method === 'PUT') {
      const { telegramToken, ntfyToken, removeNtfyToken, ...rest } = body as Body & { telegramToken?: string; ntfyToken?: string; removeNtfyToken?: boolean };
      push = {
        ...push,
        ...(rest as Partial<PushSettingsView>),
        hasTelegramToken: push.hasTelegramToken || !!telegramToken,
        hasNtfyToken: !removeNtfyToken && (push.hasNtfyToken || !!ntfyToken),
        verifiedAt: null,
      };
    }
    return ok(push);
  }
  if (path === '/api/alerts/import') {
    const file = rawBody instanceof FormData ? rawBody.get('file') : null;
    if (!(file instanceof File)) return fail(400, 'Please choose a saved e-mail (.eml file). In Gmail: open the alert, ⋮ menu, “Download message”.');
    // A light stand-in for the server's alert reader: an e-mail whose subject
    // looks like a bid alert counts as one notice titled after the subject.
    const head = (await file.text()).slice(0, 16_384);
    if (!/^from:/im.test(head)) return fail(400, 'This file does not look like a saved e-mail.');
    const subject = /^subject:[ \t]*(.+)$/im.exec(head)?.[1]?.trim() ?? '';
    const name = file.name || 'The e-mail';
    if (!/bid|bonfire|opportunit|tender|solicitation/i.test(`${subject} ${head}`)) {
      return ok({
        ok: true,
        recognised: false,
        titles: [],
        message: `Not recognised: ${name} does not look like a bid alert Lgbids can read. It is kept so it can be checked.`,
      } satisfies AlertImportResult);
    }
    const title = subject.replace(/^(?:new\s+)?(?:opportunity|bid|alert)s?\s*[:\-–]\s*/i, '') || 'Sample bid from an alert e-mail';
    return ok({ ok: true, recognised: true, titles: [title], message: `Found 1 notice: “${title}”. It is added on the next check.` } satisfies AlertImportResult);
  }
  if (path === '/api/settings/email/test') {
    email = { ...email, verifiedAt: new Date().toISOString() };
    return ok({ ok: true, message: `A test e-mail was sent to ${String(body.to ?? email.fromEmail)}. Check that it arrived.` } satisfies ActionResult);
  }
  if (path === '/api/settings/email') {
    if (method === 'PUT') {
      const { pass, ...rest } = body as Body & { pass?: string };
      email = { ...email, ...(rest as Partial<EmailSettingsView>), hasPassword: email.hasPassword || !!pass, verifiedAt: null };
    }
    return ok(email);
  }

  // Documents
  if (path === '/api/documents' && method === 'POST') {
    const f = rawBody instanceof FormData ? rawBody : null;
    const file = f?.get('file');
    if (!(file instanceof File)) return fail(400, 'Choose a file to upload.');
    const d: LibraryDocument = {
      id: nextId++,
      name: String(f!.get('name') || file.name),
      kind: String(f!.get('kind') || 'other') as LibraryDocument['kind'],
      filename: file.name,
      mime: file.type,
      size: file.size,
      expiresOn: String(f!.get('expiresOn') || ''),
      attachByDefault: f!.get('attachByDefault') === 'true',
      createdAt: new Date().toISOString(),
    };
    documents.unshift(d);
    fileBlobs.set(d.id, file);
    return ok(d);
  }
  if (path === '/api/documents') return ok(documents);
  if ((r = m(/^\/api\/documents\/(\d+)$/))) {
    const i = documents.findIndex((x) => x.id === Number(r![1]));
    if (i < 0) return fail(404, 'That document no longer exists.');
    if (method === 'DELETE') {
      documents.splice(i, 1);
      return ok({ ok: true });
    }
    documents[i] = { ...documents[i]!, ...(body as Partial<LibraryDocument>) };
    return ok(documents[i]);
  }

  // Runs and events
  if (path === '/api/runs' && method === 'POST') {
    if (running) return fail(409, 'A check is already running.');
    running = { ...runRecord(runs.length + 20, 0, 'running', 'manual'), finishedAt: null, stats: null };
    setTimeout(() => {
      if (!running) return;
      runs.unshift({ ...runRecord(running.id, 0, 'ok', 'manual'), startedAt: running.startedAt, finishedAt: new Date().toISOString() });
      running = null;
      discoverNext();
      save();
    }, 5000);
    return ok({ running: true, run: running } satisfies RunState);
  }
  if (path === '/api/runs/current') return ok({ running: running !== null, run: running ?? runs[0] ?? null } satisfies RunState);
  if (path === '/api/runs') return ok(runs);
  if (path === '/api/events') return ok(events.slice(0, Number(q.get('limit') ?? 50)));

  return fail(404, `The mock has no answer for ${method} ${path}.`);
}

// ---------------------------------------------------------------------------
// Hosted prototype: saved state, "Run now" finds new bids, downloads
// ---------------------------------------------------------------------------

/** Files uploaded in this browser tab, so downloads give back what was uploaded. */
const fileBlobs = new Map<number, Blob>();
const PERSIST = import.meta.env.VITE_PROTOTYPE === '1';
const STORAGE_KEY = 'lgbids-prototype-v1';

/** Notices that "arrive" one per manual check, so testers see new bids come in. */
const upcoming: Opportunity[] = [
  opp({
    id: 151,
    title: 'Invasive Species Removal and Native Replanting – Sample Creek Park',
    organization: 'Sample District of Saanich',
    referenceNumber: 'RFQ 26-162',
    sourceId: 'saanich-rss',
    sourceName: 'District of Saanich — bid opportunities feed',
    closesAt: iso(9 * DAY),
    location: 'Saanich, BC',
    submissionMethod: 'email',
    submissionEmail: 'purchasing@saanich-sample.example',
    contactEmail: 'purchasing@saanich-sample.example',
    suitabilityScore: 81,
    description: 'Removal of ivy, broom and blackberry from 0.6 ha of park, followed by planting native shrubs supplied by the District. Quotations by e-mail.',
    analysis: analysis({
      services: ['garden', 'restoration'],
      reasons: [
        { tone: 'good', text: 'Invasive plant removal and planting, which you offer.' },
        { tone: 'good', text: 'Work is in Saanich, inside your service area.' },
        { tone: 'good', text: 'Submitted by e-mail, so Lgbids can send it for you.' },
      ],
      requirements: [{ key: 'pricing', label: 'Price form', detail: 'Lump sum', met: null }],
    }),
  }),
  opp({
    id: 152,
    title: 'Grass Cutting – Sample Fire Hall and Public Works Yard',
    organization: 'Sample Town of Sidney',
    referenceNumber: 'TS-26-31',
    sourceId: 'email-alerts',
    sourceName: 'Bid alert e-mails (BC Bid and Bonfire)',
    closesAt: endOfDay(15),
    closesAtPrecision: 'date',
    submissionMethod: 'bcbid',
    submissionUrl: 'https://bcbid.example/opportunity/TS-26-31',
    location: 'Sidney, BC',
    suitabilityScore: 64,
    description: 'Weekly grass cutting, April to October, at two municipal sites. Submit on BC Bid.',
    analysis: analysis({
      services: ['lawn'],
      areaMatch: 'Sidney',
      reasons: [
        { tone: 'good', text: 'Lawn mowing you offer.' },
        { tone: 'warn', text: 'Submitted on BC Bid; you upload the package there yourself.' },
      ],
    }),
  }),
];

function discoverNext(): void {
  const next = upcoming.find((o) => !opportunities.some((x) => x.id === o.id));
  if (!next) return;
  const found = { ...next, firstSeenAt: new Date().toISOString(), lastSeenAt: new Date().toISOString(), publishedAt: new Date().toISOString() };
  opportunities.unshift(found);
  events.unshift({
    id: nextId++,
    at: new Date().toISOString(),
    level: 'info',
    kind: 'found',
    message: `Found a suitable bid: “${found.title}” (score ${found.suitabilityScore}).`,
    opportunityId: found.id,
    applicationId: null,
    runId: runs[0]?.id ?? null,
  });
}

interface Snapshot {
  savedAt: number;
  state: Record<string, unknown>;
}

function save(): void {
  if (!PERSIST) return;
  const state = { profile, opportunities, applications, documents, sources, automation, region, alertInbox, push, email, runs, events, nextId, v2 };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ savedAt: Date.now(), state } satisfies Snapshot));
  } catch {
    // Private windows or full storage: the prototype still works, it just forgets on reload.
  }
}

const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

/** Move every timestamp forward by the time since the save, so "closes in 4 days" stays true on the next visit. */
function shiftTimes<T>(value: T, delta: number): T {
  if (typeof value === 'string') return (ISO_TIME.test(value) ? new Date(Date.parse(value) + delta).toISOString() : value) as T;
  if (Array.isArray(value)) return value.map((v) => shiftTimes(v, delta)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shiftTimes(v, delta)])) as T;
  }
  return value;
}

function restore(): void {
  if (!PERSIST) return;
  let snap: Snapshot | null = null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    snap = raw ? (JSON.parse(raw) as Snapshot) : null;
  } catch {
    snap = null;
  }
  if (!snap?.state) return;
  const st = shiftTimes(snap.state, Date.now() - snap.savedAt) as Record<string, never>;
  profile = st.profile ?? profile;
  opportunities = st.opportunities ?? opportunities;
  applications = st.applications ?? applications;
  documents = st.documents ?? documents;
  sources = st.sources ?? sources;
  automation = st.automation ?? automation;
  region = st.region ?? region;
  alertInbox = st.alertInbox ?? alertInbox;
  push = st.push ?? push;
  email = st.email ?? email;
  runs = st.runs ?? runs;
  events = st.events ?? events;
  nextId = st.nextId ?? nextId;
  v2 = { ...v2, ...((st.v2 as Partial<MockV2State> | undefined) ?? {}) };
}
restore();

/** Forget everything the tester changed and start again from the sample data. */
export function resetPrototype(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing saved, nothing to remove.
  }
}

export async function handleMock(method: string, fullPath: string, rawBody: unknown): Promise<MockResponse> {
  const res = await route(method, fullPath, rawBody);
  if (method !== 'GET') save();
  return res;
}

// --- Downloads -------------------------------------------------------------

export interface MockDownload {
  blob: Blob;
  filename: string;
}

function icsText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

function icsStamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function calendar(items: Opportunity[]): string {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Lgbids//Bid closing dates//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Bid closing dates'];
  for (const o of items) {
    if (!o.closesAt) continue;
    const closes = new Date(o.closesAt);
    lines.push('BEGIN:VEVENT', `UID:opportunity-${o.id}@lgbids`, `DTSTAMP:${icsStamp(new Date())}`);
    lines.push(`DTSTART:${icsStamp(closes)}`, `DTEND:${icsStamp(new Date(closes.getTime() + 30 * 60_000))}`);
    const details = [o.organization && `Buyer: ${o.organization}`, o.referenceNumber && `Reference: ${o.referenceNumber}`].filter(Boolean).join('\n');
    lines.push(`SUMMARY:${icsText(`Bid closes: ${o.title}`)}`, `DESCRIPTION:${icsText(details)}`, 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return `${lines.join('\r\n')}\r\n`;
}

const money = (n: number) => n.toLocaleString('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: Number.isInteger(n) ? 0 : 2 });

async function packagePdf(a: Application): Promise<Blob> {
  const { buildPdf } = await import('./prototypePdf.js');
  const o = opportunities.find((x) => x.id === a.opportunityId);
  const p = profile;
  const blocks: import('./prototypePdf.js').PdfBlock[] = [
    { kind: 'title', text: o?.title ?? a.subject },
    { kind: 'small', text: [o?.organization, o?.referenceNumber && `Reference ${o.referenceNumber}`].filter(Boolean).join(' · ') },
    { kind: 'small', text: `Submitted by ${p.legalName || p.tradeName || 'your company'}` },
    { kind: 'heading', text: 'Cover letter' },
    { kind: 'text', text: a.body || '(The letter is empty.)' },
    { kind: 'heading', text: 'Price' },
    { kind: 'text', text: a.priceTotal !== null ? `Total: ${money(a.priceTotal)} (CAD)` : 'No total price entered.' },
  ];
  if (a.priceNotes) blocks.push({ kind: 'text', text: a.priceNotes });
  if (a.includeRates && p.rates.length) {
    blocks.push({ kind: 'heading', text: 'Hourly and unit rates' });
    for (const r of p.rates) blocks.push({ kind: 'text', text: `${r.label}: ${money(r.rate)} per ${r.unit}` });
  }
  blocks.push({ kind: 'heading', text: 'Company profile' });
  blocks.push({ kind: 'text', text: [p.legalName, p.addressLine, [p.city, p.postalCode].filter(Boolean).join(' '), p.phone, p.email].filter(Boolean).join('\n') });
  if (p.about) blocks.push({ kind: 'text', text: p.about });
  const facts = [
    p.yearEstablished && `In business since ${p.yearEstablished}`,
    p.crewSize && `Crew of ${p.crewSize}`,
    p.insuranceLiability && `General liability insurance: ${money(p.insuranceLiability)}${p.insuranceProvider ? ` with ${p.insuranceProvider}` : ''}`,
    p.gstNumber && `GST number: ${p.gstNumber}`,
    p.worksafeNumber && `WorkSafeBC account: ${p.worksafeNumber}`,
    ...p.certifications,
  ].filter(Boolean) as string[];
  for (const f of facts) blocks.push({ kind: 'text', text: `• ${f}` });
  if (p.references.length) {
    blocks.push({ kind: 'heading', text: 'References' });
    for (const r of p.references) {
      blocks.push({ kind: 'text', text: [r.client, r.description, [r.year, r.value].filter(Boolean).join(' · '), [r.contactName, r.contactInfo].filter(Boolean).join(', ')].filter(Boolean).join('\n') });
    }
  }
  const attached = documents.filter((d) => a.documentIds.includes(d.id));
  if (attached.length || a.files.length) {
    blocks.push({ kind: 'heading', text: 'Attached documents' });
    for (const d of attached) blocks.push({ kind: 'text', text: `• ${d.name} (${d.filename})` });
    for (const f of a.files) blocks.push({ kind: 'text', text: `• ${f.name}` });
  }
  blocks.push({ kind: 'small', text: 'Prototype: this package was built from invented sample data in your browser.' });
  return buildPdf(blocks, `${p.tradeName || p.legalName || 'Lgbids'} · ${o?.referenceNumber || o?.title || ''}`);
}

async function placeholder(name: string): Promise<Blob> {
  const { buildPdf } = await import('./prototypePdf.js');
  return buildPdf(
    [
      { kind: 'title', text: name },
      { kind: 'text', text: 'This is a stand-in for a sample document. In the real app you get back exactly the file you uploaded. Files you upload in this prototype can be downloaded until you close or reload the tab.' },
    ],
    'Lgbids prototype',
  );
}

/** The file a download link would fetch from the server, built in the browser instead. */
export async function mockDownload(href: string): Promise<MockDownload | null> {
  const url = new URL(href, location.origin);
  const path = url.pathname;
  let r: RegExpExecArray | null;
  if (path === '/api/calendar.ics') {
    const id = Number(url.searchParams.get('id'));
    const items = id ? opportunities.filter((o) => o.id === id) : opportunities.filter((o) => viewOf(o).includes('suitable'));
    return { blob: new Blob([calendar(items)], { type: 'text/calendar' }), filename: id ? `bid-${id}.ics` : 'bid-closing-dates.ics' };
  }
  if (path === '/api/opportunities.csv') {
    const zone = 'America/Vancouver';
    const awards = url.searchParams.get('include') === 'awards';
    const items = filterOpportunities(url.searchParams).items.map((o) => (awards ? { ...o, award: v2.awards.find((a) => a.opportunityId === o.id) ?? null } : o));
    const text = opportunitiesCsv(
      items,
      {
        closes: (o) => (o.closesAtPrecision === 'date' ? formatDate(o.closesAt, zone) : formatDateTime(o.closesAt, zone)),
        firstSeen: (o) => formatDateTime(o.firstSeenAt, zone),
      },
      { awards },
    );
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(new Date());
    return { blob: new Blob([text], { type: 'text/csv;charset=utf-8' }), filename: opportunitiesCsvFilename(day) };
  }
  if (path === '/api/feedback.csv') {
    const zone = 'America/Vancouver';
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(new Date());
    const text = feedbackCsv(v2.feedback, (at) => formatDateTime(at, zone));
    return { blob: new Blob([text], { type: 'text/csv;charset=utf-8' }), filename: feedbackCsvFilename(day) };
  }
  if ((r = /^\/api\/applications\/(\d+)\/package\.pdf$/.exec(path))) {
    const a = applications.find((x) => x.id === Number(r![1]));
    if (!a) return null;
    return { blob: await packagePdf(a), filename: `bid-package-${a.id}.pdf` };
  }
  if ((r = /^\/api\/documents\/(\d+)\/download$/.exec(path))) {
    const d = documents.find((x) => x.id === Number(r![1]));
    if (!d) return null;
    return { blob: fileBlobs.get(d.id) ?? (await placeholder(d.name)), filename: fileBlobs.has(d.id) ? d.filename : `${d.name}.pdf` };
  }
  if ((r = /^\/api\/applications\/(\d+)\/files\/(\d+)$/.exec(path))) {
    const fid = Number(r[2]);
    const f = applications.flatMap((a) => a.files).find((x) => x.id === fid);
    if (!f) return null;
    return { blob: fileBlobs.get(fid) ?? (await placeholder(f.name)), filename: fileBlobs.has(fid) ? f.name : `${f.name}.pdf` };
  }
  return null;
}
