import { describe, expect, it } from 'vitest';
import { extractText, getDocumentProxy } from 'unpdf';
import {
  emailSettingsSchema,
  profileSchema,
  type Analysis,
  type ChecklistItem,
  type LibraryDocument,
  type Profile,
  type Requirement,
} from '../src/shared/schemas.js';
import type { DraftContext, OpportunityRecord } from '../src/server/contracts.js';
import { assessReadiness, draftApplication, mergeChecklist, profileGaps } from '../src/server/applications/draft.js';
import { letterSections, transmittalText } from '../src/server/applications/templates.js';
import { buildPackagePdf, packageFilename, pdfSafe } from '../src/server/applications/pdf.js';

const zone = 'America/Vancouver';
const now = new Date('2026-06-15T20:00:00Z');

const fullProfile: Profile = profileSchema.parse({
  legalName: 'Example Landscaping Ltd.',
  addressLine: '100 Sample Road',
  city: 'Victoria',
  postalCode: 'V8V 0A0',
  phone: '250-555-0100',
  email: 'office@landscaping.example',
  website: 'landscaping.example',
  contactName: 'Jordan Lee',
  contactTitle: 'Operations Manager',
  signatoryName: 'Sam Patel',
  signatoryTitle: 'President',
  gstNumber: '123456789 RT0001',
  worksafeNumber: '987654',
  businessLicence: 'Inter-Municipal Business Licence 2026-0042',
  yearEstablished: 2011,
  crewSize: 9,
  insuranceProvider: 'Example Mutual Insurance',
  insurancePolicy: 'CGL-55501',
  insuranceLiability: 5_000_000,
  insuranceExpiry: '2027-03-31',
  bondingAvailable: true,
  bondingLimit: 250_000,
  certifications: ['ISA Certified Arborist PN-0000A', 'BC Pesticide Applicator Certificate'],
  about: 'Example Landscaping is a Victoria company providing grounds maintenance and landscape installation.',
  approach: 'Each site gets a written maintenance schedule agreed with the buyer before work starts.',
  safety: 'All crews follow our written safety program and hold daily tailgate meetings.',
  team: 'Our crew leads each hold a horticulture certificate.',
  equipment: 'Ride-on and walk-behind mowers, a chipper and two crew trucks.',
  references: [
    { client: 'Harbourview Strata Council', contactName: 'Pat Kim', contactInfo: '250-555-0111', description: 'Grounds maintenance of a 120-unit complex', year: '2025', value: '$48,000' },
    { client: 'Sample Business Park', contactName: 'Alex Moore', contactInfo: 'alex@park.example', description: 'Irrigation repairs and bed renovation', year: '2024', value: '$22,500' },
    { client: 'Oakside School Society', description: 'Playing field turf care', year: '2024' },
  ],
  rates: [
    { label: 'Two-person crew with truck and equipment', unit: 'hour', rate: 118 },
    { label: 'General labourer', unit: 'hour', rate: 52.5 },
  ],
});

const emptyProfile: Profile = profileSchema.parse({});

const emailOk = emailSettingsSchema.parse({ host: '127.0.0.1', port: 2525, fromName: 'Example Landscaping', fromEmail: 'bids@landscaping.example' });
const emailUnset = emailSettingsSchema.parse({});

const requirements: Requirement[] = [
  { key: 'site_meeting', label: 'Mandatory site meeting', detail: 'Tue, Jun 23, 2026 at 10:00 AM PDT', met: null },
  { key: 'forms', label: "Buyer's own forms must be completed", detail: 'Download them from the bid documents.', met: null },
  { key: 'insurance', label: 'Liability insurance', detail: '$5,000,000 required, you carry $5,000,000', met: true },
  { key: 'worksafe', label: 'WorkSafeBC coverage in good standing', detail: '', met: null },
  { key: 'certification', label: 'ISA Certified Arborist', detail: '', met: true },
  { key: 'certification', label: 'Pesticide applicator certificate', detail: '', met: false },
  { key: 'performance_bond', label: 'Performance bond if awarded', detail: '', met: null },
];

function analysis(overrides: Partial<Analysis> = {}): Analysis {
  return {
    relevance: 85,
    matchedTerms: ['landscape maintenance', 'boulevard'],
    services: ['grounds', 'lawn', 'garden'],
    area: 'yes',
    areaMatch: 'Saanich',
    reasons: [{ tone: 'good', text: 'Landscaping work in the service area.' }],
    requirements,
    pricing: 'lump_sum',
    alsoListed: [],
    ...overrides,
  };
}

function makeOpp(overrides: Partial<OpportunityRecord> = {}): OpportunityRecord {
  return {
    id: 7,
    sourceId: 'demo-city',
    sourceName: 'Demo City',
    externalId: 'rfq-26-140',
    title: 'RFQ 26-140 - Boulevard and Median Landscape Maintenance',
    organization: 'Demo Municipality',
    referenceNumber: 'RFQ 26-140',
    noticeType: 'RFQ',
    description: 'The municipality invites quotations for boulevard and median landscape maintenance.',
    url: 'https://city.example/bids/26-140',
    publishedAt: '2026-06-01T16:00:00Z',
    closesAt: '2026-07-08T21:00:00Z',
    closesAtPrecision: 'datetime',
    closesAtRaw: 'July 8, 2026 at 2:00 p.m.',
    location: 'Saanich, BC',
    categories: ['Landscaping'],
    contactName: '',
    contactEmail: 'buyer@city.example',
    contactPhone: '250-555-0199',
    documents: [{ name: 'RFQ 26-140.pdf', url: 'https://city.example/bids/26-140.pdf' }],
    submissionMethod: 'email',
    submissionEmail: 'bids@city.example',
    submissionUrl: '',
    status: 'open',
    suitabilityScore: 82,
    decision: 'suitable',
    userDecision: null,
    analysis: analysis(),
    duplicateOf: null,
    firstSeenAt: '2026-06-01T17:00:00Z',
    lastSeenAt: '2026-06-15T17:00:00Z',
    application: null,
    noticeTypeHint: 'RFQ',
    documentText: '',
    bcSource: true,
    detailFetchedAt: '2026-06-01T17:00:00Z',
    documentsReadAt: null,
    analysedAt: '2026-06-01T17:00:00Z',
    notifiedAt: null,
    ...overrides,
  };
}

function doc(id: number, overrides: Partial<LibraryDocument> = {}): LibraryDocument {
  return {
    id,
    name: `Document ${id}`,
    kind: 'other',
    filename: `document-${id}.pdf`,
    mime: 'application/pdf',
    size: 1000,
    expiresOn: '',
    attachByDefault: true,
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function ctx(overrides: Partial<DraftContext> = {}): DraftContext {
  return { profile: fullProfile, email: emailOk, documents: [], now, zone, ...overrides };
}

function tickAll(list: ChecklistItem[]): ChecklistItem[] {
  return list.map((i) => ({ ...i, done: true }));
}

describe('profileGaps', () => {
  it('is empty for a complete profile', () => {
    expect(profileGaps(fullProfile)).toEqual([]);
  });
  it('lists every missing essential for an empty profile', () => {
    const gaps = profileGaps(emptyProfile);
    expect(gaps).toHaveLength(5);
    expect(gaps.join(' ')).toMatch(/legal name/);
    expect(gaps.join(' ')).toMatch(/mailing address/);
  });
  it('flags an invalid e-mail address and a missing city', () => {
    const gaps = profileGaps({ ...fullProfile, email: 'office at landscaping', city: '' });
    expect(gaps).toHaveLength(2);
    expect(gaps.join(' ')).toMatch(/not a valid address/);
  });
});

describe('draftApplication', () => {
  it('drafts an e-mail submission with subject, body, documents and checklist', () => {
    const documents = [
      doc(1),
      doc(2, { expiresOn: '2026-01-01' }),
      doc(3, { attachByDefault: false }),
      doc(4, { expiresOn: '2026-06-15', filename: 'insurance-certificate.pdf' }),
    ];
    const d = draftApplication(makeOpp(), ctx({ documents }));
    expect(d.channel).toBe('email');
    expect(d.toEmail).toBe('bids@city.example');
    expect(d.ccEmail).toBe('');
    expect(d.subject).toBe('Quotation – RFQ 26-140 – Boulevard and Median Landscape Maintenance – Example Landscaping Ltd.');
    expect(d.documentIds).toEqual([1, 4]);
    expect(d.includeRates).toBe(false);
    expect(d.body).toMatch(/^Dear Purchasing:/);
    expect(d.body).toContain('submit its quotation for RFQ 26-140 – Boulevard and Median Landscape Maintenance');
    expect(d.body).toContain('- Example-Landscaping-RFQ-26-140-submission.pdf');
    expect(d.body).toContain('- insurance-certificate.pdf');
    expect(d.body).not.toContain('document-2.pdf');
    expect(d.body).toContain('Sam Patel\nPresident\nExample Landscaping Ltd.');
    expect(d.body).not.toMatch(/total price/i);

    const byKey = Object.fromEntries(d.checklist.map((i) => [i.key, i]));
    expect(Object.keys(byKey)).toEqual([
      'site_meeting',
      'forms',
      'insurance',
      'worksafe',
      'certification',
      'certification_2',
      'performance_bond',
      'documents',
      'pricing',
    ]);
    expect(byKey.site_meeting).toMatchObject({ label: 'I attended the mandatory site meeting', required: true, done: false });
    expect(byKey.forms).toMatchObject({ label: "Buyer's forms completed and attached", required: true, done: false });
    expect(byKey.insurance).toMatchObject({ required: false, done: true });
    expect(byKey.worksafe).toMatchObject({ required: false, done: false });
    expect(byKey.certification).toMatchObject({ required: false, done: true });
    expect(byKey.certification_2).toMatchObject({ required: false, done: false });
    expect(byKey.performance_bond).toMatchObject({ required: false, done: false });
    expect(byKey.documents).toMatchObject({ required: true, done: false });
    expect(byKey.pricing).toMatchObject({ required: true, done: false });

    expect(d.status).toBe('needs_input');
    expect(d.missing).toEqual([
      'I attended the mandatory site meeting',
      "Buyer's forms completed and attached",
      'I have read the bid documents and any addenda',
      'Price entered and checked against the bid documents',
      'Enter the total price.',
    ]);
  });

  it('greets the buyer contact by name and uses the trade name in the subject', () => {
    const d = draftApplication(makeOpp({ contactName: 'Morgan Diaz', noticeType: 'ITT' }), ctx({ profile: { ...fullProfile, tradeName: 'Example Gardens' } }));
    expect(d.body).toMatch(/^Dear Morgan Diaz:/);
    expect(d.subject).toBe('Tender – RFQ 26-140 – Boulevard and Median Landscape Maintenance – Example Gardens');
  });

  it('leaves the reference out of the subject when the notice has none', () => {
    const d = draftApplication(makeOpp({ referenceNumber: '', title: 'Hanging Basket Supply', noticeType: 'RFP' }), ctx());
    expect(d.subject).toBe('Proposal – Hanging Basket Supply – Example Landscaping Ltd.');
  });

  it('prepares portal bids for upload without inventing a recipient', () => {
    const d = draftApplication(makeOpp({ submissionMethod: 'bonfire', submissionEmail: '' }), ctx({ email: emailUnset }));
    expect(d.channel).toBe('portal');
    expect(d.toEmail).toBe('');
    // E-mail checks do not apply: the user uploads the package themselves.
    expect(d.missing.join(' ')).not.toMatch(/e-mail/i);
  });

  it('treats hard copy, unknown and e-mail without a valid address as manual', () => {
    expect(draftApplication(makeOpp({ submissionMethod: 'hardcopy' }), ctx()).channel).toBe('manual');
    expect(draftApplication(makeOpp({ submissionMethod: 'unknown', submissionEmail: '' }), ctx()).channel).toBe('manual');
    const noAddress = draftApplication(makeOpp({ submissionMethod: 'email', submissionEmail: '' }), ctx());
    expect(noAddress.channel).toBe('manual');
    expect(noAddress.toEmail).toBe('');
  });

  it('drops the pricing item for qualification and information requests', () => {
    for (const noticeType of ['RFSQ', 'RFEOI', 'RFI'] as const) {
      const d = draftApplication(makeOpp({ noticeType, analysis: analysis({ requirements: [], pricing: 'unknown' }) }), ctx());
      expect(d.checklist.map((i) => i.key)).toEqual(['documents']);
      expect(d.missing).toEqual(['I have read the bid documents and any addenda']);
    }
  });

  it('includes rates when the notice asks for them and the profile has some', () => {
    const opp = makeOpp({ noticeType: 'RFSO', analysis: analysis({ requirements: [], pricing: 'rates' }) });
    const d = draftApplication(opp, ctx());
    expect(d.includeRates).toBe(true);
    expect(d.checklist.map((i) => i.key)).toEqual(['documents']);
    expect(d.body).toContain('unit rates');

    const none = draftApplication(opp, ctx({ profile: { ...fullProfile, rates: [] } }));
    expect(none.includeRates).toBe(false);
    expect(none.missing).toContain('Add your rates to the company profile.');
  });

  it('marks a non-mandatory site meeting and a bid bond correctly', () => {
    const d = draftApplication(
      makeOpp({
        analysis: analysis({
          requirements: [
            { key: 'site_meeting', label: 'Site meeting (check whether attendance is required)', detail: '', met: null },
            { key: 'bid_bond', label: 'Bid bond or bid security', detail: '', met: null },
            { key: 'security_clearance', label: 'Security clearance or record checks', detail: '', met: null },
          ],
        }),
      }),
      ctx(),
    );
    const byKey = Object.fromEntries(d.checklist.map((i) => [i.key, i]));
    expect(byKey.site_meeting?.required).toBe(false);
    expect(byKey.bid_bond).toMatchObject({ required: true, done: false });
    expect(byKey.security_clearance).toMatchObject({ required: false, done: false });
  });
});

describe('assessReadiness', () => {
  const opp = makeOpp();
  const base = draftApplication(opp, ctx());
  const app = { ...base, priceTotal: null as number | null };

  it('becomes ready once required items are ticked and a price is entered', () => {
    const ticked = { ...app, checklist: tickAll(app.checklist) };
    expect(assessReadiness(ticked, opp, ctx()).missing).toEqual(['Enter the total price.']);
    const priced = { ...ticked, priceTotal: 18_450 };
    expect(assessReadiness(priced, opp, ctx())).toEqual({ status: 'ready', missing: [] });
  });

  it('only needs required items ticked', () => {
    const checklist = app.checklist.map((i) => ({ ...i, done: i.required }));
    expect(assessReadiness({ ...app, checklist, priceTotal: 100 }, opp, ctx()).status).toBe('ready');
  });

  it('needs outgoing e-mail set up for the e-mail channel only', () => {
    const done = { ...app, checklist: tickAll(app.checklist), priceTotal: 18_450 };
    const r = assessReadiness(done, opp, ctx({ email: emailUnset }));
    expect(r).toEqual({ status: 'needs_input', missing: ['Outgoing e-mail is not set up yet.'] });
    expect(assessReadiness({ ...done, channel: 'portal', toEmail: '' }, opp, ctx({ email: emailUnset })).status).toBe('ready');
  });

  it('needs a valid recipient, subject and body for e-mail', () => {
    const done = { ...app, checklist: tickAll(app.checklist), priceTotal: 18_450, toEmail: 'not an address', subject: ' ', body: '' };
    expect(assessReadiness(done, opp, ctx()).missing).toEqual([
      "Enter the buyer's submission e-mail address.",
      'Enter a subject line for the e-mail.',
      'Write the e-mail message.',
    ]);
  });

  it('reports profile gaps with a prefix', () => {
    const done = { ...app, checklist: tickAll(app.checklist), priceTotal: 18_450 };
    const r = assessReadiness(done, opp, ctx({ profile: { ...fullProfile, phone: '' } }));
    expect(r.missing).toEqual(['Company profile: add a phone number.']);
  });

  it('is never ready once the opportunity has closed', () => {
    const done = { ...app, checklist: tickAll(app.checklist), priceTotal: 18_450 };
    const after = ctx({ now: new Date('2026-07-08T21:00:00Z') });
    expect(assessReadiness(done, opp, after).missing).toEqual(['This opportunity has closed.']);
    expect(assessReadiness(done, makeOpp({ status: 'cancelled' }), ctx()).missing).toEqual(['This opportunity has closed.']);
  });

  it('treats a date-only closing as closing at the start of that day', () => {
    const done = { ...app, checklist: tickAll(app.checklist), priceTotal: 18_450 };
    // July 8 end of day in Vancouver, stored as a date-only closing.
    const dateOnly = makeOpp({ closesAt: '2026-07-09T06:59:59Z', closesAtPrecision: 'date' });
    expect(assessReadiness(done, dateOnly, ctx({ now: new Date('2026-07-08T06:00:00Z') })).status).toBe('ready');
    expect(assessReadiness(done, dateOnly, ctx({ now: new Date('2026-07-08T08:00:00Z') })).missing).toEqual(['This opportunity has closed.']);
  });
});

describe('mergeChecklist', () => {
  it('keeps the user’s ticks by key and adds new items unticked', () => {
    const previous: ChecklistItem[] = [
      { key: 'documents', label: 'Old label', detail: '', done: true, required: true },
      { key: 'insurance', label: 'Liability insurance', detail: '', done: false, required: false },
      { key: 'gone', label: 'Removed', detail: '', done: true, required: true },
    ];
    const next: ChecklistItem[] = [
      { key: 'documents', label: 'I have read the bid documents and any addenda', detail: '', done: false, required: true },
      { key: 'insurance', label: 'Liability insurance', detail: '', done: true, required: false },
      { key: 'pricing', label: 'Price entered', detail: '', done: false, required: true },
    ];
    expect(mergeChecklist(previous, next)).toEqual([
      { key: 'documents', label: 'I have read the bid documents and any addenda', detail: '', done: true, required: true },
      { key: 'insurance', label: 'Liability insurance', detail: '', done: false, required: false },
      { key: 'pricing', label: 'Price entered', detail: '', done: false, required: true },
    ]);
  });
});

describe('letter content', () => {
  const opts = { priceTotal: null, priceNotes: '', includeRates: false, zone, now };

  it('invents nothing about a company with an empty profile', () => {
    const sections = letterSections(makeOpp(), emptyProfile, opts);
    const all = sections
      .flatMap((s) => [s.heading, ...s.paragraphs, ...(s.bullets ?? []), ...(s.table ? [...s.table.columns, ...s.table.rows.flat()] : [])])
      .join('\n');
    const mail = transmittalText(makeOpp(), emptyProfile, { priceTotal: null, includeRates: false, attachmentNames: [] });
    for (const text of [all, mail]) {
      expect(text).not.toMatch(/\$/);
      expect(text).not.toMatch(/\bISA\b|arborist|red seal|\bCOR\b|SECOR|first aid|pesticide|IIABC|certified|certificate/i);
      expect(text).not.toMatch(/years? of experience|experienced|since \d{4}|established|founded|award|employees|staff of|crew of/i);
      expect(text).not.toMatch(/insured|insurance|bond|WorkSafeBC|licen[cs]e|GST/i);
    }
    const headings = sections.map((s) => s.heading);
    expect(headings).toEqual(['Cover letter', 'Understanding of the work', 'Approach', 'Pricing', 'Declaration']);
  });

  it('states the profile’s facts, and only when present', () => {
    const sections = letterSections(makeOpp(), fullProfile, { ...opts, priceTotal: 18_450, priceNotes: 'Price covers the full 2026 season.', includeRates: true });
    const by = Object.fromEntries(sections.map((s) => [s.heading, s]));
    expect(sections.map((s) => s.heading)).toEqual([
      'Cover letter',
      'Company information',
      'Understanding of the work',
      'Approach',
      'Safety',
      'Team and equipment',
      'Certifications',
      'Insurance and compliance',
      'References',
      'Pricing',
      'Declaration',
    ]);
    expect(by['Company information']?.table?.rows).toContainEqual(['Year established', '2011']);
    expect(by['Insurance and compliance']?.bullets?.[0]).toContain('$5,000,000');
    expect(by['Insurance and compliance']?.bullets).toContain('Bonding is available up to $250,000.');
    expect(by.Approach?.paragraphs).toEqual([fullProfile.approach]);
    expect(by.Pricing?.paragraphs[0]).toBe('Total price: $18,450, plus GST.');
    expect(by.Pricing?.table?.rows[1]).toEqual(['General labourer', 'hour', '$52.50']);
    expect(by.References?.table?.columns).toEqual(['Client', 'Contact', 'Work', 'Year', 'Value']);
    expect(by['Understanding of the work']?.paragraphs).toHaveLength(4);

    const noBond = letterSections(makeOpp(), { ...fullProfile, bondingAvailable: false }, opts);
    expect(noBond.find((s) => s.heading === 'Insurance and compliance')?.bullets?.join(' ')).not.toMatch(/bond/i);
  });

  it('puts the price in the transmittal only when it is set', () => {
    const text = transmittalText(makeOpp(), fullProfile, { priceTotal: 18_450, includeRates: false, attachmentNames: ['a.pdf'] });
    expect(text).toContain('Our total price is $18,450 plus GST.');
    expect(text).toContain('Attached:\n- a.pdf');
    expect(text).toContain('Please direct any questions about this submission to Jordan Lee, Operations Manager, at 250-555-0100 or office@landscaping.example.');
  });
});

describe('submission package PDF', () => {
  it('names the file in plain ASCII', () => {
    expect(packageFilename(makeOpp(), fullProfile)).toBe('Example-Landscaping-RFQ-26-140-submission.pdf');
    const odd = packageFilename(makeOpp({ referenceNumber: '', title: 'Rénovation du parc – Phase 2 (Garry Oak) meadow restoration works' }), {
      ...fullProfile,
      tradeName: 'Côté & Fils Paysagistes Inc.',
    });
    expect(odd).toBe('Cote-and-Fils-Paysagistes-Renovation-du-parc-Phase-2-Garry-submission.pdf');
    expect(odd.length).toBeLessThanOrEqual(100);
    expect(packageFilename(makeOpp({ referenceNumber: 'X'.repeat(200) }), { ...fullProfile, legalName: 'Y'.repeat(200) }).length).toBeLessThanOrEqual(100);
  });

  it('replaces characters the built-in fonts cannot show', () => {
    expect(pdfSafe('Price ≥ $5 → “OK” – Łódź ✓\tdone')).toBe('Price >= $5 -> “OK” – Lódz * done');
  });

  it('renders a multi-page package with the company, reference and references', async () => {
    const opp = makeOpp({ contactName: 'Morgan Diaz', title: 'RFQ 26-140 - Boulevard and Median Landscape Maintenance 🌳' });
    const buf = await buildPackagePdf(opp, fullProfile, { priceTotal: 18_450, priceNotes: '', includeRates: true, zone, now });
    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const { totalPages, text } = await extractText(pdf, { mergePages: true });
    expect(totalPages).toBeGreaterThanOrEqual(2);
    expect(text).toContain('Example Landscaping Ltd.');
    expect(text).toContain('RFQ 26-140');
    expect(text).toContain('Harbourview Strata Council');
    expect(text).toContain('Morgan Diaz');
    expect(text).toContain(`Page 1 of ${totalPages}`);
  });

  it('renders for an empty profile and breaks long tables across pages', async () => {
    const empty = await buildPackagePdf(makeOpp(), emptyProfile, { priceTotal: null, priceNotes: '', includeRates: false, zone, now });
    expect(empty.subarray(0, 5).toString('latin1')).toBe('%PDF-');

    const many = {
      ...fullProfile,
      references: Array.from({ length: 20 }, (_, i) => ({
        client: `Client number ${i + 1}`,
        contactName: 'Pat Kim',
        contactInfo: '250-555-0111',
        description: 'Seasonal grounds maintenance including mowing, edging, shrub bed care, leaf clean-up and irrigation start-up. '.repeat(3),
        year: '2025',
        value: '$10,000',
      })),
    };
    const buf = await buildPackagePdf(makeOpp(), many, { priceTotal: null, priceNotes: '', includeRates: true, zone, now });
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const { totalPages, text } = await extractText(pdf, { mergePages: true });
    expect(totalPages).toBeGreaterThanOrEqual(4);
    expect(text).toContain('Client number 20');
  });
});
