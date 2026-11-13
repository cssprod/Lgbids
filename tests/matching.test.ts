import { describe, expect, it } from 'vitest';
import { automationSchema, profileSchema, type Profile } from '../src/shared/schemas.js';
import { analyse, type AnalyseInput } from '../src/server/matching/analyse.js';
import { assessArea, defaultRegion, mightBeLocal, organizationKey } from '../src/server/matching/geo.js';
import { detectNoticeType, extractReference, referenceKey, titleKey } from '../src/server/matching/notice.js';
import { assessRelevance, BORDERLINE_AT, mightBeRelevant, RELEVANT_AT } from '../src/server/matching/relevance.js';
import { detectSubmission, extractFacts } from '../src/server/matching/requirements.js';

const region = defaultRegion();
const now = new Date('2026-06-15T20:00:00Z');
const zone = 'America/Vancouver';

describe('assessRelevance', () => {
  const relevant = [
    'Yard Maintenance Services',
    'Roadside Flail Mowing Services',
    'Arboricultural Services',
    'Supply, Deliver and Install of Turf Grass Sod at Glanford Park',
    'RFQ 26-140 - Boulevard Tree Planting Program',
    'Landscape Maintenance Services - Municipal Facilities',
    'Grounds Maintenance, CFB Esquimalt',
    'Invasive Species Removal - Mount Douglas Park',
    'Irrigation System Repairs and Winterization',
    'Hanging Basket Supply and Maintenance',
    'Grass cutting, grass trimming and clean-up, South Island',
    'Sports Field Maintenance and Renovation',
    'Hedge Trimming and Shrub Bed Maintenance',
    'Garry Oak Meadow Restoration Planting',
    'Snow Removal and Ice Control Services',
  ];
  it.each(relevant)('treats "%s" as landscaping work', (title) => {
    const r = assessRelevance({ title });
    expect(r.score, JSON.stringify(r.matchedTerms)).toBeGreaterThanOrEqual(RELEVANT_AT);
    expect(r.inTitle).toBe(true);
    expect(r.primary).not.toBeNull();
  });

  const irrelevant = [
    'Sewell Pump Station System Upgrade',
    'Wastewater Treatment Plant Aeration Blower Replacement',
    'ITT 25-030 - Earthworks Services',
    'RFP NO P&R 25-02 - Supply of Vending Services',
    'Miscellaneous Road and Parking Lot Marking Services',
    'RFQ 26-107 - Roofing Program',
    'Cyber Security Threat Landscape Assessment',
    'Enterprise Resource Planning (ERP) Consulting Services',
    'Janitorial Services at the Institute of Ocean Sciences Centre',
    'Fire Sprinkler System Inspection and Testing',
    'Kindergarten Classroom Furniture',
    'Garden Suite Housing Policy Review',
    'Six Mile Road Street Lighting and Crosswalk',
    'Yard Waste Processing Services',
    'Seed Funding Program Administration',
    'Wound Irrigation Solution Supply',
    'Ocean View Park Washroom Building',
  ];
  it.each(irrelevant)('does not treat "%s" as landscaping work', (title) => {
    const r = assessRelevance({ title });
    expect(r.score, JSON.stringify(r.matchedTerms)).toBeLessThan(BORDERLINE_AT);
  });

  it('identifies the kind of work', () => {
    expect(assessRelevance({ title: 'Arboricultural Services' }).primary).toBe('tree');
    expect(assessRelevance({ title: 'Roadside Flail Mowing Services' }).primary).toBe('vegetation');
    expect(assessRelevance({ title: 'Irrigation System Repairs' }).primary).toBe('irrigation');
    expect(assessRelevance({ title: 'Rock Wall Construction' }).primary).toBe('hardscape');
    expect(assessRelevance({ title: 'Snow Removal Services' }).primary).toBe('snow');
    expect(assessRelevance({ title: 'Lawn Mowing and Turf Care' }).primary).toBe('lawn');
  });

  it('separates supply-only purchases from installation work', () => {
    const supply = assessRelevance({ title: 'Supply of Growing Medium' });
    expect(supply.supplyOnly).toBe(true);
    expect(supply.services).toEqual(['supply']);

    const mower = assessRelevance({ title: 'Supply and Delivery of One (1) Zero-Turn Mower' });
    expect(mower.supplyOnly).toBe(true);

    const install = assessRelevance({ title: 'Supply, Deliver and Install of Turf Grass Sod at Glanford Park' });
    expect(install.supplyOnly).toBe(false);
    expect(install.services).toContain('lawn');
  });

  it('recognises plans and studies as consulting', () => {
    const plan = assessRelevance({ title: 'Town of View Royal - Parks and Trails Master Plan' });
    expect(plan.consulting).toBe(true);
    expect(plan.primary).toBe('design');
    const bog = assessRelevance({
      title: "RFP 26-133 - Restoration Plan, Rithet's Bog",
      description: 'Development of an ecological restoration plan including native vegetation management.',
    });
    expect(bog.consulting).toBe(true);
    expect(bog.services).toContain('restoration');
  });

  it('scores a term in the title above the same term in the description only', () => {
    const inTitle = assessRelevance({ title: 'Landscape Maintenance Services', description: '' });
    const inBody = assessRelevance({ title: 'Contracted Services 2026', description: 'Landscape maintenance of municipal sites.' });
    expect(inTitle.score).toBeGreaterThan(inBody.score);
    expect(inBody.score).toBeGreaterThanOrEqual(RELEVANT_AT);
    expect(inBody.inTitle).toBe(false);
  });

  it('uses commodity codes and user keywords', () => {
    expect(assessRelevance({ title: 'Facility services', categories: ['UNSPSC 70111706 Lawn care services'] }).score).toBeGreaterThanOrEqual(60);
    expect(assessRelevance({ title: 'Cenotaph plaza upkeep' }, { includeKeywords: ['cenotaph'] }).score).toBeGreaterThanOrEqual(70);
  });

  it('pre-filters national feed rows cheaply', () => {
    expect(mightBeRelevant('Grounds maintenance services for the Dockyard')).toBe(true);
    expect(mightBeRelevant('Supply of bandpass and notch cavity filters')).toBe(false);
  });
});

describe('assessArea', () => {
  it('accepts local buyers', () => {
    const r = assessArea({ title: 'Yard Maintenance Services', organization: 'The Corporation of the District of Saanich' }, region);
    expect(r.area).toBe('yes');
    expect(assessArea({ title: 'Mowing', organization: 'Capital Regional District' }, region).area).toBe('yes');
    expect(assessArea({ title: 'Town of View Royal - Boulevard Mowing', organization: '' }, region).area).toBe('yes');
  });

  it('rejects local buyers posting work outside the area', () => {
    const r = assessArea({ title: 'SSI 2026-020 Parks Mowing - Salt Spring Island', organization: 'Capital Regional District' }, region);
    expect(r.area).toBe('no');
    expect(r.note).toContain('Salt Spring');
    expect(assessArea({ title: 'Port Renfrew Bin Hauling Services', organization: 'Capital Regional District' }, region).area).toBe('no');
  });

  it('does not mistake local street names for other cities', () => {
    expect(assessArea({ title: 'Richmond Road Boulevard Landscaping', organization: 'City of Victoria' }, region).area).toBe('yes');
    expect(assessArea({ title: 'Vernon Avenue Median Planting', organization: 'District of Saanich' }, region).area).toBe('yes');
  });

  it('accepts place names in the title when the notice is from British Columbia', () => {
    expect(assessArea({ title: 'Grounds Maintenance, CFB Esquimalt', organization: 'Department of National Defence' }, region).area).toBe('yes');
    expect(assessArea({ title: 'Landscaping - Victoria, BC', organization: 'Public Works and Government Services Canada' }, region).area).toBe('yes');
    expect(
      assessArea({ title: 'Grounds maintenance', organization: 'BC Housing', location: 'Langford, British Columbia' }, region).area,
    ).toBe('yes');
  });

  it('needs a British Columbia cue for names that exist elsewhere', () => {
    expect(assessArea({ title: 'Snow clearing - Victoria Hospital', organization: 'Shared Health Manitoba', location: 'Manitoba' }, region).area).toBe('no');
    expect(assessArea({ title: 'Lawn care - Sidney', organization: 'Some Agency' }, region).area).toBe('no');
    expect(assessArea({ title: 'Lawn care - Sidney', organization: 'Some Agency', bcSource: true }, region).area).toBe('yes');
  });

  it('is unsure when only the description mentions Victoria', () => {
    const r = assessArea(
      {
        title: 'Roadside mowing - Service Area 20',
        organization: 'Ministry of Transportation and Transit',
        description: 'Contact: 940 Blanshard Street, Victoria, BC',
        bcSource: true,
      },
      region,
    );
    expect(r.area).toBe('unknown');
  });

  it('rejects work elsewhere in British Columbia', () => {
    expect(assessArea({ title: 'Landscape Maintenance - Nanaimo Courthouse', organization: 'Ministry of Citizens Services', bcSource: true }, region).area).toBe('no');
    expect(assessArea({ title: 'Parks mowing', organization: 'City of Kelowna', bcSource: true }, region).area).toBe('no');
  });

  it('treats everything from a local source as local unless it names an outside place', () => {
    expect(assessArea({ title: 'Mowing services', localSource: true }, region).area).toBe('yes');
    expect(assessArea({ title: 'Galiano Island parks maintenance', localSource: true }, region).area).toBe('no');
  });

  it('pre-filters national rows', () => {
    expect(mightBeLocal('Grounds maintenance, Esquimalt', region)).toBe(true);
    expect(mightBeLocal('Grounds maintenance, British Columbia', region)).toBe(true);
    expect(mightBeLocal('Grounds maintenance, Gatineau, Quebec', region)).toBe(false);
  });

  it('builds stable buyer keys', () => {
    expect(organizationKey('The Corporation of the District of Saanich')).toBe('saanich');
    expect(organizationKey('District of Saanich')).toBe('saanich');
    expect(organizationKey('District of Central Saanich')).toBe('central-saanich');
    expect(organizationKey('City of Victoria')).toBe('victoria');
  });
});

describe('notice type and reference', () => {
  it('detects the solicitation type', () => {
    const cases: [string, string][] = [
      ['ITT 25-030 - Earthworks Services', 'ITT'],
      ["RFP 26-133 - Restoration Plan, Rithet's Bog", 'RFP'],
      ['RFQ 26-107 - Roofing Program', 'RFQ'],
      ['NOI 25-021 - Canoe Procurement', 'NOI'],
      ['Request for Qualifications - Landscape Contractors Roster', 'RFSQ'],
      ['RFQ - Request for Pre-Qualification of Arborists', 'RFSQ'],
      ['Request for Expressions of Interest: Community Garden Operator', 'RFEOI'],
      ['Request for Standing Offer - Tree Services', 'RFSO'],
      ['Invitation to Tender: Park Improvements', 'ITT'],
      ['Notice of Intent to Direct Award - Turf Equipment', 'NOI'],
      ['Yard Maintenance Services', 'OTHER'],
      ['Tender for Boulevard Mowing', 'ITT'],
    ];
    for (const [title, type] of cases) expect(detectNoticeType(title), title).toBe(type);
    expect(detectNoticeType('Grounds maintenance', '', 'Request for Proposal')).toBe('RFP');
    expect(detectNoticeType('Grounds maintenance', 'This Invitation to Tender covers...')).toBe('ITT');
    expect(detectNoticeType('Grounds maintenance', '', 'Advance Contract Award Notice')).toBe('NOI');
  });

  it('extracts reference numbers', () => {
    const cases: [string, string][] = [
      ["RFP 26-133 - Restoration Plan, Rithet's Bog", '26-133'],
      ['ITT 25-030 - Earthworks Services', '25-030'],
      ['RFP No. SSI 2026-011 Fernwood Pumpstation Demolition', 'SSI 2026-011'],
      ['RFP NO. FIN 26-01 Enterprise Resource Planning (ERP) Consulting Services', 'FIN 26-01'],
      ['ITT No. ENG 26-03 - TOE Esquimalt Road Phase 2', 'ENG 26-03'],
      ['RFP NO P&R 25-02 - Supply of Vending Services', 'P&R 25-02'],
      ['ERM2025-017 - RFP - Operation of the Material Diversion Transfer Station', 'ERM2025-017'],
      ['70.26.03-01 RFP - RMTS - CONDITION ASSESSMENTS (2026)', '70.26.03-01'],
      ['RFP No. 2023-WRP-01 CRD Website Redesign Project', '2023-WRP-01'],
      ['23-010 Doncaster Ventilation Upgrade', '23-010'],
      ['RFQ 2026 069 Landscape Maintenance Public Buildings', '2026-069'],
      ['Tender #2024-15: Park Mowing', '2024-15'],
      ['Yard Maintenance Services', ''],
      ['RFP for 2026 landscaping services', ''],
      ['2026 Treanor Avenue Sidewalk Infill', ''],
    ];
    for (const [title, ref] of cases) expect(extractReference(title), title).toBe(ref);
  });

  it('builds comparison keys', () => {
    expect(referenceKey('SSI 2026-011')).toBe('SSI2026011');
    expect(referenceKey('26-133')).toBe('26133');
    expect(referenceKey('442')).toBe('');
    expect(titleKey('RFQ 26-123 - Yard Maintenance Services')).toBe(titleKey('Yard Maintenance Services'));
    expect(titleKey('RFP No. SSI 2026-011 Fernwood Pumpstation Demolition')).toBe(titleKey('SSI 2026-011 Fernwood Pumpstation Demolition'));
    expect(titleKey('Esquimalt Road Phase 2')).toContain('phase');
  });
});

describe('detectSubmission', () => {
  it('finds an e-mail address bids are sent to', () => {
    const { submission, contactEmail } = detectSubmission(
      'Quotations must be submitted by email to purchasing@example-town.ca before the closing time. Questions may be directed to parks@example-town.ca.',
    );
    expect(submission).toMatchObject({ method: 'email', email: 'purchasing@example-town.ca' });
    expect(contactEmail).toBe('parks@example-town.ca');
  });

  it('does not treat an inquiries address as the submission address', () => {
    const { submission, contactEmail } = detectSubmission('All inquiries should be directed to purchase@saanich.ca.');
    expect(submission.method).toBe('unknown');
    expect(contactEmail).toBe('purchase@saanich.ca');
  });

  it('respects a refusal of e-mailed bids', () => {
    const { submission } = detectSubmission(
      'Tenders must be delivered in a sealed envelope to City Hall. Submissions sent by email or fax will not be accepted. Contact tenders@example.ca.',
    );
    expect(submission.method).toBe('hardcopy');
    expect(submission.emailRefused).toBe(true);
  });

  it('recognises portals', () => {
    expect(detectSubmission('Submissions must be made through the Bonfire portal at https://saanich.bonfirehub.ca/opportunities/1234.').submission).toMatchObject({
      method: 'bonfire',
      url: 'https://saanich.bonfirehub.ca/opportunities/1234',
    });
    expect(detectSubmission('Proposals must be submitted electronically via BC Bid.').submission.method).toBe('bcbid');
    expect(detectSubmission('Register as a plan taker at victoria.bidsandtenders.ca.').submission.method).toBe('bidsandtenders');
  });

  it('keeps portal sources on the portal unless e-mail submission is explicit', () => {
    const questions = detectSubmission('Submit questions in writing to buyer@example.ca.', { sourceDefault: 'bonfire', url: 'https://x.bonfirehub.ca/opportunities/9' });
    expect(questions.submission).toMatchObject({ method: 'bonfire', url: 'https://x.bonfirehub.ca/opportunities/9' });
    const explicit = detectSubmission('Quotes are to be submitted by email to buyer@example.ca.', { sourceDefault: 'bonfire' });
    expect(explicit.submission).toMatchObject({ method: 'email', email: 'buyer@example.ca' });
  });
});

describe('extractFacts', () => {
  const text =
    'The District invites quotations for landscape maintenance on an as-needed basis at hourly rates. ' +
    'A mandatory site meeting will be held on June 25, 2026 at 10:00 AM at the Public Works Yard. ' +
    'The successful contractor must carry $5,000,000 commercial general liability insurance and be registered with WorkSafeBC. ' +
    'A valid business licence is required. Work must be supervised by an ISA Certified Arborist. ' +
    'Provide three (3) references. Bidders must complete and sign the Quotation Form in Appendix A. ' +
    'The contract is for a three (3) year term with two optional one-year renewals. ' +
    'Quotations must be emailed to purchasing@example.ca.';
  const facts = extractFacts(text, { zone, now });

  it('reads the requirements', () => {
    expect(facts.siteMeeting).toMatchObject({ mandatory: true, date: { iso: '2026-06-25T17:00:00Z' } });
    expect(facts.insuranceAmount).toBe(5_000_000);
    expect(facts.worksafe).toBe(true);
    expect(facts.businessLicence).toBe(true);
    expect(facts.certifications.map((c) => c.key)).toEqual(['isaArborist']);
    expect(facts.referencesRequired).toBe(3);
    expect(facts.formsRequired).toBe(true);
    expect(facts.pricing).toBe('rates');
    expect(facts.term).toContain('three (3) year term');
    expect(facts.submission).toMatchObject({ method: 'email', email: 'purchasing@example.ca' });
    expect(facts.bidBond).toBe(false);
  });

  it('reads bonding and lump-sum pricing', () => {
    const f = extractFacts('Tenders must be accompanied by a bid bond for 10% of the stipulated price. A performance bond is required.', { zone, now });
    expect(f.bidBond).toBe(true);
    expect(f.performanceBond).toBe(true);
    expect(f.pricing).toBe('lump_sum');
  });

  it('treats an optional site visit as optional', () => {
    const f = extractFacts('An optional site visit is scheduled for June 25, 2026.', { zone, now });
    expect(f.siteMeeting?.mandatory).toBe(false);
  });
});

describe('analyse', () => {
  const profile: Profile = profileSchema.parse({
    legalName: 'Example Landscaping Ltd.',
    worksafeNumber: '123456',
    businessLicence: 'Inter-municipal 0001',
    insuranceLiability: 5_000_000,
    references: [{ client: 'A' }, { client: 'B' }, { client: 'C' }],
  });
  const automation = automationSchema.parse({});
  const ctx = { profile, automation, region, now, zone };
  const base: AnalyseInput = {
    title: '',
    organization: 'District of Saanich',
    description: '',
    location: '',
    categories: [],
    noticeTypeHint: '',
    closesAt: '2026-07-09T21:00:00Z',
    closesAtPrecision: 'datetime',
    status: 'open',
    url: 'https://example.ca/notice',
    documentText: '',
    localSource: false,
    bcSource: true,
    sourceSubmission: 'unknown',
  };

  it('marks open, local landscaping work the company does as suitable', () => {
    const r = analyse({ ...base, title: 'RFQ 26-123 - Yard Maintenance Services' }, ctx);
    expect(r.decision).toBe('suitable');
    expect(r.score).toBeGreaterThanOrEqual(75);
    expect(r.noticeType).toBe('RFQ');
    expect(r.analysis.area).toBe('yes');
    expect(r.analysis.reasons.some((x) => x.tone === 'block')).toBe(false);
  });

  it('rules out closed, non-local and unrelated notices with the reason', () => {
    const closed = analyse({ ...base, title: 'Yard Maintenance Services', closesAt: '2026-06-01T21:00:00Z' }, ctx);
    expect(closed.decision).toBe('unsuitable');
    expect(closed.analysis.reasons[0]).toMatchObject({ tone: 'block' });
    expect(closed.analysis.reasons[0]!.text).toMatch(/^Closed /);

    const away = analyse({ ...base, title: 'Parks Mowing - Salt Spring Island', organization: 'Capital Regional District' }, ctx);
    expect(away.decision).toBe('unsuitable');

    const unrelated = analyse({ ...base, title: 'Sewell Pump Station System Upgrade' }, ctx);
    expect(unrelated.decision).toBe('unsuitable');
    expect(unrelated.analysis.reasons.some((x) => x.text === 'Not gardening or landscaping work.')).toBe(true);
  });

  it('rules out work the company does not offer', () => {
    const trees = analyse({ ...base, title: 'Arboricultural Services' }, ctx);
    expect(trees.decision).toBe('unsuitable');
    const withTrees = analyse({ ...base, title: 'Arboricultural Services' }, {
      ...ctx,
      profile: { ...profile, services: { ...profile.services, tree: true } },
    });
    expect(withTrees.decision).toBe('suitable');
  });

  it('rules out notices that cannot be bid on', () => {
    expect(analyse({ ...base, title: 'NOI 26-01 - Notice of Intent: Turf Maintenance' }, ctx).decision).toBe('unsuitable');
  });

  it('holds borderline cases for review', () => {
    const vague = analyse({ ...base, title: 'Contracted Services 2026', description: 'Includes landscape maintenance at several sites.' }, ctx);
    expect(vague.decision).toBe('review');

    const unknownArea = analyse(
      { ...base, title: 'Roadside Mowing - Service Area 20', organization: 'Ministry of Transportation and Transit' },
      ctx,
    );
    expect(unknownArea.decision).toBe('review');

    const soon = analyse({ ...base, title: 'Lawn Mowing Services', closesAt: '2026-06-16T21:00:00Z' }, ctx);
    expect(soon.decision).toBe('review');

    const bond = analyse({ ...base, title: 'Park Landscaping Improvements', description: 'A bid bond of 10% is required.' }, ctx);
    expect(bond.decision).toBe('review');
    expect(bond.analysis.requirements.find((r) => r.key === 'bid_bond')?.met).toBe(false);
  });

  it('blocks when a mandatory site meeting has passed', () => {
    const r = analyse(
      { ...base, title: 'Landscape Maintenance Services', description: 'A mandatory site meeting was held on June 10, 2026 at 10:00 AM.' },
      ctx,
    );
    expect(r.decision).toBe('unsuitable');
  });

  it('carries the submission method and pricing basis', () => {
    const r = analyse(
      {
        ...base,
        title: 'RFQ - Landscape Maintenance, as-needed',
        description: 'Hourly rates. Quotations must be submitted by email to purchasing@example.ca.',
      },
      ctx,
    );
    expect(r.facts.submission).toMatchObject({ method: 'email', email: 'purchasing@example.ca' });
    expect(r.analysis.pricing).toBe('rates');
  });
});
