/**
 * Dev-only in-memory API used when VITE_MOCK=1, so every screen can be seen
 * without the server. All notices are invented; every e-mail uses .example.
 * Loaded with a dynamic import from api.ts and never part of a production build.
 */
import type {
  AlertInboxView,
  ActionResult,
  DashboardResponse,
  EmailSettingsView,
  OpportunityList,
  OpportunityViewName,
  ProfileResponse,
  RunState,
  SessionInfo,
  SourceTest,
} from '../shared/api.js';
import type {
  Analysis,
  Application,
  ApplicationStatus,
  AutomationSettings,
  EventRecord,
  LibraryDocument,
  Opportunity,
  Profile,
  RegionSettings,
  RunRecord,
  SourceInput,
  SourceRecord,
} from '../shared/schemas.js';
import { automationSchema, profileSchema, sourceConfigSchema } from '../shared/schemas.js';
import type { MockResponse } from './api.js';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const now = Date.now();
const iso = (offsetMs: number) => new Date(now + offsetMs).toISOString();
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
    sourceId: 'bcbid',
    sourceName: 'BC Bid (via CanadaBuys)',
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
    sourceId: 'saanich',
    sourceName: 'Saanich bid opportunities',
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
      alsoListed: [{ source: 'BC Bid (via CanadaBuys)', url: 'https://bids.example/bcbid/101' }],
    }),
  }),
  opp({
    id: 102,
    title: 'ITT PRK-26-07 – Sports Field Mowing and Turf Maintenance',
    organization: 'Sample City of Langford',
    referenceNumber: 'PRK-26-07',
    noticeType: 'ITT',
    sourceId: 'langford',
    sourceName: 'Langford bids&tenders',
    closesAt: endOfDay(12),
    closesAtPrecision: 'date',
    closesAtRaw: 'December 2026',
    submissionMethod: 'bidsandtenders',
    submissionUrl: 'https://langford-sample.bidsandtenders.example/Module/Tenders',
    location: 'Langford, BC',
    suitabilityScore: 78,
    description: 'Mowing, aeration, top dressing and line painting of eight sports fields.\nMandatory site meeting on the 1st.',
    analysis: analysis({
      services: ['lawn'],
      reasons: [
        { tone: 'good', text: 'Sports field and turf work you offer.' },
        { tone: 'warn', text: 'A site meeting is mandatory. Make sure you attend.' },
        { tone: 'warn', text: 'Submitted on the bids&tenders portal; you upload it.' },
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

function source(p: Partial<SourceRecord> & Pick<SourceRecord, 'id' | 'name' | 'kind'>): SourceRecord {
  return {
    enabled: true,
    builtin: true,
    notes: '',
    config: sourceConfigSchema.parse({ url: `https://${p.id}.example/bids` }),
    lastRunAt: iso(-2 * HOUR),
    lastOkAt: iso(-2 * HOUR),
    lastStatus: 'ok',
    lastMessage: '',
    lastItemCount: 12,
    consecutiveFailures: 0,
    ...p,
  };
}

let sources: SourceRecord[] = [
  source({ id: 'bcbid', name: 'BC Bid (via CanadaBuys)', kind: 'canadabuys_csv', lastItemCount: 214, lastMessage: '214 notices read; 6 in British Columbia look relevant.' }),
  source({ id: 'canadabuys', name: 'CanadaBuys search', kind: 'canadabuys_search', lastItemCount: 31 }),
  source({ id: 'saanich', name: 'Saanich bid opportunities', kind: 'html_list', lastItemCount: 7 }),
  source({ id: 'langford', name: 'Langford bids&tenders', kind: 'html_list', lastStatus: 'blocked', lastMessage: 'The site answered with a browser check (403). Lgbids cannot read it automatically.', consecutiveFailures: 3, lastOkAt: iso(-3 * DAY) }),
  source({ id: 'crd', name: 'Capital Regional District (Bonfire)', kind: 'bonfire', lastStatus: 'empty', lastItemCount: 0, lastMessage: 'The portal listed no open opportunities.' }),
  source({ id: 'esquimalt', name: 'Esquimalt tenders feed', kind: 'rss', builtin: false, enabled: false, lastStatus: 'never', lastRunAt: null, lastOkAt: null, lastItemCount: null }),
];

let automation: AutomationSettings = automationSchema.parse({ notifyEmail: 'office@garryoak.example' });
let region: RegionSettings = {
  places: ['Victoria', 'Saanich', 'Oak Bay', 'Esquimalt', 'View Royal', 'Langford', 'Colwood', 'Metchosin', 'Sooke', 'Sidney', 'North Saanich', 'Central Saanich'],
  excludePlaces: ['Salt Spring Island', 'Port Renfrew'],
  organizations: ['Capital Regional District', 'School District No. 61', 'University of Victoria'],
};
const defaultRegion = structuredClone(region);
let alertInbox: AlertInboxView = { host: 'imap.gmail.com', port: 993, secure: true, user: '', folder: 'INBOX', lookbackDays: 30, verifiedAt: null, hasPassword: false };
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

let runs: RunRecord[] = [runRecord(14, -2 * HOUR, 'partial'), runRecord(13, -8 * HOUR, 'partial'), runRecord(12, -14 * HOUR, 'ok', 'manual'), runRecord(11, -20 * HOUR, 'error', 'startup')];
let running: RunRecord | null = null;

let events: EventRecord[] = [
  { id: 9, at: iso(-2 * HOUR), level: 'warn', kind: 'source', message: 'Langford bids&tenders could not be read: the site answered with a browser check.', opportunityId: null, applicationId: null, runId: 14 },
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
const ok = (body: unknown): MockResponse => ({ status: 200, body });
const fail = (status: number, error: string): MockResponse => ({ status, body: { error } });
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
    },
    attention: applications.filter((a) => ['needs_input', 'ready', 'failed'].includes(a.status)).map(withOpp),
    deadlines: open.filter((o) => o.closesAt).sort((a, b) => (a.closesAt! < b.closesAt! ? -1 : 1)),
    setup: [
      { key: 'profile', label: 'Fill in your company profile', done: profileMissing().length === 0, href: '/profile' },
      { key: 'documents', label: 'Add your insurance certificate and WorkSafeBC letter', done: documents.length >= 2, href: '/documents' },
      { key: 'email', label: 'Set up outgoing e-mail and send a test', done: email.verifiedAt !== null, href: '/settings#email' },
      { key: 'sources', label: 'Turn on at least one source', done: sources.some((s) => s.enabled), href: '/sources' },
    ],
    sources,
  };
}

function sampleTest(input: { name: string; config: { url: string } }): SourceTest {
  const blocked = input.name.toLowerCase().includes('langford');
  return blocked
    ? {
        status: 'blocked',
        message: 'The site answered with a browser check (403). Lgbids cannot read it automatically.',
        ms: 1830,
        count: 0,
        sample: [],
        requests: [
          { url: `${input.config.url.replace(/\/$/, '')}/robots.txt`, status: 200, bytes: 312, ms: 220 },
          { url: input.config.url, status: 403, bytes: 5120, ms: 1610, error: 'Browser check page' },
        ],
      }
    : {
        status: 'ok',
        message: 'Read 1 page and found 3 notices.',
        ms: 2412,
        count: 3,
        sample: [
          { title: 'RFQ 26-140 – Boulevard and Median Landscape Maintenance', url: 'https://bids.example/notice/101', organization: 'Sample District of Saanich', closesAt: iso(3 * DAY), closingRaw: '', referenceNumber: 'RFQ 26-140' },
          { title: 'Tree Pruning – Various Parks', url: 'https://bids.example/notice/77', organization: 'Sample District of Saanich', closesAt: null, closingRaw: 'Early December', referenceNumber: '' },
          { title: 'Washroom Building Renovation', url: 'https://bids.example/notice/78', organization: '', closesAt: iso(9 * DAY), closingRaw: '', referenceNumber: 'ENG 26-03' },
        ],
        requests: [
          { url: `${input.config.url.replace(/\/$/, '')}/robots.txt`, status: 200, bytes: 312, ms: 210 },
          { url: input.config.url || 'https://example.example/bids', status: 200, bytes: 48_220, ms: 1490 },
        ],
      };
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

type Body = Record<string, unknown>;

export async function handleMock(method: string, fullPath: string, rawBody: unknown): Promise<MockResponse> {
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

  // Opportunities
  if (path === '/api/opportunities' && method === 'GET') {
    const view = (q.get('view') ?? 'suitable') as OpportunityViewName;
    const text = (q.get('q') ?? '').toLowerCase();
    const limit = Number(q.get('limit') ?? 50);
    const offset = Number(q.get('offset') ?? 0);
    const match = (o: Opportunity) => !text || `${o.title} ${o.organization} ${o.referenceNumber}`.toLowerCase().includes(text);
    const counts = { suitable: 0, review: 0, unsuitable: 0, closed: 0, dismissed: 0, all: 0 } as Record<OpportunityViewName, number>;
    for (const o of opportunities.filter(match)) for (const v of viewOf(o)) counts[v]++;
    const items = opportunities
      .filter((o) => match(o) && viewOf(o).includes(view))
      .sort((a, b) => (b.suitabilityScore ?? 0) - (a.suitabilityScore ?? 0));
    return ok({ items: items.slice(offset, offset + limit), total: items.length, counts } satisfies OpportunityList);
  }
  if ((r = m(/^\/api\/opportunities\/(\d+)$/))) {
    const o = opportunities.find((x) => x.id === Number(r![1]));
    return o ? ok(o) : fail(404, 'That opportunity no longer exists.');
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
  if ((r = m(/^\/api\/applications\/(\d+)\/status$/))) {
    return updateApp(Number(r[1]), (x) => recompute({ ...x, status: body.status as ApplicationStatus }));
  }
  if ((r = m(/^\/api\/applications\/(\d+)\/files$/))) {
    const file = rawBody instanceof FormData ? rawBody.get('file') : null;
    if (!(file instanceof File)) return fail(400, 'Choose a file to upload.');
    return updateApp(Number(r[1]), (x) => ({ ...x, files: [...x.files, { id: nextId++, name: file.name, size: file.size, mime: file.type }] }));
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
  if (path === '/api/alerts/import') return ok({ ok: true, message: 'The e-mail was imported. It is read on the next check.' } satisfies ActionResult);
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

  // Sources
  if (path === '/api/sources/test') return ok(sampleTest(body as unknown as SourceInput));
  if (path === '/api/sources' && method === 'POST') {
    const input = body as unknown as SourceInput;
    const s = source({ id: `custom-${nextId++}`, name: input.name, kind: input.kind, builtin: false, notes: input.notes, config: input.config, lastStatus: 'never', lastRunAt: null, lastOkAt: null, lastItemCount: null, enabled: input.enabled });
    sources.push(s);
    return ok(s);
  }
  if (path === '/api/sources') return ok(sources);
  if ((r = m(/^\/api\/sources\/([\w-]+)\/test$/))) {
    const s = sources.find((x) => x.id === r![1]);
    return s ? ok(sampleTest(s)) : fail(404, 'That source no longer exists.');
  }
  if ((r = m(/^\/api\/sources\/([\w-]+)$/))) {
    const i = sources.findIndex((x) => x.id === r![1]);
    if (i < 0) return fail(404, 'That source no longer exists.');
    if (method === 'DELETE') {
      if (sources[i]!.builtin) return fail(409, 'Built-in sources cannot be deleted. Turn it off instead.');
      sources.splice(i, 1);
      return ok({ ok: true });
    }
    sources[i] = { ...sources[i]!, ...(body as Partial<SourceRecord>) };
    return ok(sources[i]);
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
      runs.unshift({ ...runRecord(running.id, 0, 'partial', 'manual'), startedAt: running.startedAt, finishedAt: new Date().toISOString() });
      running = null;
    }, 5000);
    return ok({ running: true, run: running } satisfies RunState);
  }
  if (path === '/api/runs/current') return ok({ running: running !== null, run: running ?? runs[0] ?? null } satisfies RunState);
  if (path === '/api/runs') return ok(runs);
  if (path === '/api/events') return ok(events.slice(0, Number(q.get('limit') ?? 50)));

  return fail(404, `The mock has no answer for ${method} ${path}.`);
}
