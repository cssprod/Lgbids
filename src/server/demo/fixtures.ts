import { DateTime } from 'luxon';
import PDFDocument from 'pdfkit';

/**
 * Sample bid sites for demo mode and for the automated tests.
 *
 * Everything here is INVENTED. The pages imitate the shape of the real
 * sources (a CanadaBuys CSV, a Bonfire JSON listing, an RSS feed, municipal
 * web pages) so the whole pipeline can be run without touching a real site.
 * Buyer names are real so that the service-area rules behave as they would in
 * practice, but none of these notices exists, and every e-mail address uses
 * the reserved ".example" domain, which cannot receive mail.
 *
 * Dates are generated relative to "now" so the samples never go stale.
 */

export interface FixtureResponse {
  status?: number;
  type: string;
  body: string | Buffer;
  headers?: Record<string, string>;
}

const PACIFIC = 'America/Vancouver';
const EASTERN = 'America/Toronto';

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

/** 2:00 pm Pacific, the given number of days from now. */
function closing(now: Date, days: number): DateTime {
  return DateTime.fromJSDate(now, { zone: PACIFIC }).plus({ days }).set({ hour: 14, minute: 0, second: 0, millisecond: 0 });
}

function posted(now: Date, daysAgo: number): DateTime {
  return DateTime.fromJSDate(now, { zone: PACIFIC }).minus({ days: daysAgo }).set({ hour: 9, minute: 0, second: 0, millisecond: 0 });
}

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>${esc(title)}</title></head>
<body>
<header><nav><a href="/">Home</a> <a href="/contact">Contact us</a> <a href="/login">Login</a></nav></header>
<main id="main-content">
${body}
</main>
<footer><p>Sample page for Lgbids demo mode. Not a real notice.</p><a href="/privacy">Privacy</a></footer>
</body>
</html>`;
}

function makePdf(heading: string, paragraphs: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 72 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.fontSize(15).text(heading);
    doc.moveDown();
    doc.fontSize(10.5);
    for (const paragraph of paragraphs) {
      doc.text(paragraph);
      doc.moveDown(0.6);
    }
    doc.end();
  });
}

// ---------------------------------------------------------------------------
// CanadaBuys open-data CSV (federal notices)
// ---------------------------------------------------------------------------

const CSV_COLUMNS = [
  'title-titre-eng',
  'title-titre-fra',
  'referenceNumber-numeroReference',
  'amendmentNumber-numeroModification',
  'solicitationNumber-numeroSollicitation',
  'publicationDate-datePublication',
  'tenderClosingDate-appelOffresDateCloture',
  'amendmentDate-dateModification',
  'tenderStatus-tenderStatut-eng',
  'tenderStatus-tenderStatut-fra',
  'gsin-nibs',
  'gsinDescription-nibsDescription-eng',
  'unspsc',
  'unspscDescription-eng',
  'procurementCategory-categorieApprovisionnement',
  'noticeType-avisType-eng',
  'procurementMethod-methodeApprovisionnement-eng',
  'regionsOfOpportunity-regionAppelOffres-eng',
  'regionsOfDelivery-regionsLivraison-eng',
  'contractingEntityName-nomEntitContractante-eng',
  'contractingEntityAddressCity-entiteContractanteAdresseVille-eng',
  'contractingEntityAddressProvince-entiteContractanteAdresseProvince-eng',
  'endUserEntitiesName-nomEntitesUtilisateurFinal-eng',
  'endUserEntitiesAddress-adresseEntitesUtilisateurFinal-eng',
  'contactInfoName-informationsContactNom',
  'contactInfoEmail-informationsContactCourriel',
  'contactInfoPhone-contactInfoTelephone',
  'noticeURL-URLavis-eng',
  'attachment-piecesJointes-eng',
  'tenderDescription-descriptionAppelOffres-eng',
];

interface FederalNotice {
  title: string;
  reference: string;
  solicitation: string;
  closesInDays: number;
  status?: string;
  unspsc?: string;
  unspscText?: string;
  noticeType: string;
  delivery: string;
  endUser: string;
  endUserAddress: string;
  description: string;
}

const FEDERAL: FederalNotice[] = [
  {
    title: 'Grounds Maintenance Services – CFB Esquimalt, Dockyard and Naden',
    reference: 'cb-771-90000101',
    solicitation: 'W0103-26GM01/A',
    closesInDays: 24,
    unspsc: '70111706',
    unspscText: 'Lawn care services',
    noticeType: 'Request for Standing Offer',
    delivery: '*British Columbia',
    endUser: 'Department of National Defence',
    endUserAddress: 'CFB Esquimalt, Victoria, British Columbia',
    description:
      'The Department of National Defence requires grounds maintenance services on an as-and-when-requested basis at CFB Esquimalt (Dockyard and Naden), Victoria, British Columbia. Work includes lawn mowing, trimming, shrub bed maintenance, hedge trimming and seasonal clean-up. Offers must be submitted through SAP Ariba. Firm hourly rates are requested for a three (3) year period. The contractor must hold $2,000,000 commercial general liability insurance and WorkSafeBC coverage. Personnel require Reliability Status.',
  },
  {
    title: 'Vegetation Management – Fort Rodd Hill and Fisgard Lighthouse National Historic Sites',
    reference: 'cb-771-90000102',
    solicitation: '5P420-26-0117/A',
    closesInDays: 17,
    unspsc: '70111712',
    unspscText: 'Park management or maintenance services',
    noticeType: 'Request for Proposal',
    delivery: '*British Columbia',
    endUser: 'Parks Canada',
    endUserAddress: '603 Fort Rodd Hill Road, Colwood, British Columbia',
    description:
      'Parks Canada invites proposals for invasive species removal and meadow mowing at Fort Rodd Hill and Fisgard Lighthouse National Historic Sites, Colwood, British Columbia. The work includes Scotch broom and English ivy removal within Garry oak ecosystems, and flail mowing of meadow areas. A mandatory site visit will be held; see the solicitation documents for the date.',
  },
  {
    title: 'Landscaping and Snow Removal – RCMP Detachment, Prince George',
    reference: 'cb-771-90000103',
    solicitation: 'M2989-26-0440/A',
    closesInDays: 12,
    unspsc: '72102902',
    unspscText: 'Landscaping services',
    noticeType: 'Request for Proposal',
    delivery: '*British Columbia',
    endUser: 'Royal Canadian Mounted Police',
    endUserAddress: 'Prince George, British Columbia',
    description: 'Landscaping and snow removal services for the RCMP North District building in Prince George, British Columbia.',
  },
  {
    title: 'Janitorial Services – Institute of Ocean Sciences, Sidney',
    reference: 'cb-771-90000104',
    solicitation: 'F1700-26-0031/A',
    closesInDays: 20,
    noticeType: 'Request for Proposal',
    delivery: '*British Columbia',
    endUser: 'Fisheries and Oceans Canada',
    endUserAddress: '9860 West Saanich Road, Sidney, British Columbia',
    description: 'Janitorial services for the Institute of Ocean Sciences in Sidney, British Columbia.',
  },
  {
    title: 'Grass Cutting Services – Rideau Canal Lockstations',
    reference: 'cb-771-90000105',
    solicitation: '5P300-26-0220/A',
    closesInDays: 15,
    unspsc: '70111706',
    unspscText: 'Lawn care services',
    noticeType: 'Request for Standing Offer',
    delivery: '*Ontario (except NCR)',
    endUser: 'Parks Canada',
    endUserAddress: 'Smiths Falls, Ontario',
    description: 'Grass cutting and trimming at lockstations along the Rideau Canal.',
  },
];

function federalCsv(now: Date, base: string): string {
  const rows = FEDERAL.map((n) => {
    const closes = closing(now, n.closesInDays).setZone(EASTERN);
    const values: Record<string, string> = {
      'title-titre-eng': n.title,
      'title-titre-fra': n.title,
      'referenceNumber-numeroReference': n.reference,
      'amendmentNumber-numeroModification': '000',
      'solicitationNumber-numeroSollicitation': n.solicitation,
      'publicationDate-datePublication': posted(now, 6).toFormat('yyyy-MM-dd'),
      // Zone-less, as in the real file; CanadaBuys works in Eastern time.
      'tenderClosingDate-appelOffresDateCloture': closes.toFormat("yyyy-MM-dd'T'HH:mm:ss"),
      'amendmentDate-dateModification': '',
      'tenderStatus-tenderStatut-eng': n.status ?? 'Open',
      'tenderStatus-tenderStatut-fra': 'Ouvert',
      'gsin-nibs': '',
      'gsinDescription-nibsDescription-eng': '',
      unspsc: n.unspsc ? `*${n.unspsc}` : '',
      'unspscDescription-eng': n.unspscText ? `*${n.unspscText}` : '',
      'procurementCategory-categorieApprovisionnement': '*SRV',
      'noticeType-avisType-eng': n.noticeType,
      'procurementMethod-methodeApprovisionnement-eng': 'Competitive – Open Bidding',
      'regionsOfOpportunity-regionAppelOffres-eng': '*Canada',
      'regionsOfDelivery-regionsLivraison-eng': n.delivery,
      'contractingEntityName-nomEntitContractante-eng': 'Public Works and Government Services Canada',
      'contractingEntityAddressCity-entiteContractanteAdresseVille-eng': 'Gatineau',
      'contractingEntityAddressProvince-entiteContractanteAdresseProvince-eng': 'Quebec',
      'endUserEntitiesName-nomEntitesUtilisateurFinal-eng': n.endUser,
      'endUserEntitiesAddress-adresseEntitesUtilisateurFinal-eng': n.endUserAddress,
      'contactInfoName-informationsContactNom': 'Sample Contracting Officer',
      'contactInfoEmail-informationsContactCourriel': 'contracting.officer@canada.example',
      'contactInfoPhone-contactInfoTelephone': '(250) 555-0100',
      'noticeURL-URLavis-eng': `${base}/canadabuys/en/tender-opportunities/tender-notice/${n.reference}`,
      'attachment-piecesJointes-eng': '',
      'tenderDescription-descriptionAppelOffres-eng': n.description,
    };
    return CSV_COLUMNS.map((c) => csvCell(values[c] ?? '')).join(',');
  });
  return `﻿${CSV_COLUMNS.map(csvCell).join(',')}\r\n${rows.join('\r\n')}\r\n`;
}

// ---------------------------------------------------------------------------
// CanadaBuys website search (mirrored BC Bid notices)
// ---------------------------------------------------------------------------

interface MirroredNotice {
  id: string;
  title: string;
  organization: string;
  category: string;
  closesInDays: number;
  solicitation: string;
  description: string;
  contact: string;
  email: string;
}

const MIRRORED: MirroredNotice[] = [
  {
    id: 'bc900101',
    title: 'RFQ 26-140 - Boulevard and Median Landscape Maintenance',
    organization: 'The Corporation of the District of Saanich',
    category: 'Services',
    closesInDays: 19,
    solicitation: '26-140',
    description:
      'The District of Saanich invites quotations for boulevard and median landscape maintenance at various locations, on an as-needed basis at hourly rates. This will be the only notice posted to BC Bid concerning this project. All documents and addenda are only available for download and submission on the Saanich Procurement Portal (Bonfire).',
    contact: 'Purchasing Services',
    email: 'purchasing@saanich.example',
  },
  {
    id: 'bc900102',
    title: 'ITT PRK-26-07 - Sports Field Mowing and Turf Maintenance',
    organization: 'City of Langford',
    category: 'Services',
    closesInDays: 15,
    solicitation: 'PRK-26-07',
    description:
      'The City of Langford invites tenders for mowing, aeration, top dressing and overseeding of municipal sports fields for the 2027 and 2028 seasons. Tenders must be submitted electronically through BC Bid. A mandatory site meeting will be held; details are in the tender documents. The contractor must carry $5,000,000 commercial general liability insurance and be in good standing with WorkSafeBC. Tenderers must complete the Tender Form in Appendix A and the Schedule of Prices.',
    contact: 'Parks Department',
    email: 'parks@langford.example',
  },
  {
    id: 'bc900103',
    title: 'RFP 26-055 - Parks and Trails Master Plan',
    organization: 'Town of View Royal',
    category: 'Services',
    closesInDays: 27,
    solicitation: '26-055',
    description: 'The Town of View Royal seeks a qualified consultant to prepare a ten-year Parks and Trails Master Plan.',
    contact: 'Director of Engineering',
    email: 'engineering@viewroyal.example',
  },
  {
    id: 'bc900104',
    title: 'Landscape Maintenance Services - Kelowna Courthouse',
    organization: "Ministry of Citizens' Services",
    category: 'Services',
    closesInDays: 22,
    solicitation: 'RE-26-3391',
    description: 'Landscape maintenance services for the Kelowna Courthouse grounds.',
    contact: 'Procurement Specialist',
    email: 'procurement@gov-bc.example',
  },
  {
    id: 'bc900105',
    title: 'NOI 26-009 - Notice of Intent: Turf Maintenance Equipment',
    organization: 'City of Colwood',
    category: 'Goods',
    closesInDays: 9,
    solicitation: '26-009',
    description: 'The City of Colwood intends to direct award a contract for turf maintenance equipment.',
    contact: 'Purchasing',
    email: 'purchasing@colwood.example',
  },
  {
    id: 'bc900106',
    title: 'RFP 2026-18 - School Grounds Maintenance and Landscaping Services',
    organization: 'School District No. 61 (Greater Victoria)',
    category: 'Services',
    closesInDays: 30,
    solicitation: '2026-18',
    description:
      'The Greater Victoria School District invites proposals for grounds maintenance and landscaping services at twelve school sites, including lawn mowing, garden bed maintenance and pruning. Proposals must be submitted electronically via BC Bid. Proponents must provide three (3) references.',
    contact: 'Purchasing Services',
    email: 'purchasing@sd61.example',
  },
];

function searchPage(now: Date, base: string, query: string): string {
  const q = query.toLowerCase();
  // A crude keyword match is enough to imitate a search page.
  const hits = MIRRORED.filter((n) => !q || `${n.title} ${n.description}`.toLowerCase().includes(q));
  const rows = hits
    .map((n) => {
      const closes = closing(now, n.closesInDays).setZone(EASTERN);
      return `<tr>
  <td><a href="${base}/canadabuys/en/tender-opportunities/tender-notice/${n.id}">${esc(n.title)}</a></td>
  <td>${esc(n.category)}</td>
  <td>${posted(now, 5).toFormat('yyyy/MM/dd')}</td>
  <td>${closes.toFormat('yyyy/MM/dd')}</td>
  <td>${esc(n.organization)}</td>
</tr>`;
    })
    .join('\n');
  return page(
    'Tender opportunities | CanadaBuys (sample)',
    `<h1>Tender opportunities</h1>
<p>${hits.length} results</p>
<table>
<thead><tr><th>Title</th><th>Category</th><th>Open/amendment date</th><th>Closing date</th><th>Organization</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>`,
  );
}

function noticePage(now: Date, n: MirroredNotice): string {
  const closes = closing(now, n.closesInDays).setZone(EASTERN);
  return page(
    `${n.title} | CanadaBuys (sample)`,
    `<h1>${esc(n.title)}</h1>
<dl>
  <dt>Solicitation number</dt><dd>${esc(n.solicitation)}</dd>
  <dt>Publication date</dt><dd>${posted(now, 5).toFormat('yyyy/MM/dd')}</dd>
  <dt>Closing date and time</dt><dd>${closes.toFormat('yyyy/MM/dd HH:mm')} ${closes.toFormat('ZZZZ')}</dd>
  <dt>Notice type</dt><dd>${n.title.startsWith('NOI') ? 'Notice of Intent' : 'Request for Proposal'}</dd>
  <dt>Organization</dt><dd>${esc(n.organization)}</dd>
  <dt>Region(s) of delivery</dt><dd>British Columbia</dd>
  <dt>Contact</dt><dd>${esc(n.contact)}, ${esc(n.email)}, (250) 555-0142</dd>
</dl>
<h2>Description</h2>
<p>${esc(n.description)}</p>
<p>Full details for this tender opportunity are available on a third-party site: BC Bid.</p>`,
  );
}

// ---------------------------------------------------------------------------
// Bonfire portals
// ---------------------------------------------------------------------------

interface BonfireProject {
  id: string;
  ref: string;
  name: string;
  closesInDays: number;
}

const BONFIRE: Record<string, BonfireProject[]> = {
  saanich: [
    { id: '181001', ref: 'RFQ 26-140', name: 'Boulevard and Median Landscape Maintenance', closesInDays: 19 },
    { id: '181002', ref: 'ITT 26-151', name: 'Cedar Hill Golf Course Irrigation System Upgrades', closesInDays: 23 },
    { id: '181003', ref: 'RFP 26-133', name: "Restoration Plan, Rithet's Bog", closesInDays: 16 },
    { id: '181004', ref: 'RFQ 26-162', name: 'Supply of Fleet Vehicle Tires', closesInDays: 11 },
  ],
  victoria: [
    { id: '77201', ref: 'RFP 26-088', name: 'Garden Bed and Hanging Basket Maintenance - Downtown and Beacon Hill Park', closesInDays: 26 },
    { id: '77202', ref: 'ITT 26-090', name: 'Sewer Main Relining Program', closesInDays: 14 },
    { id: '77203', ref: 'RFSQ 26-093', name: 'Pre-Qualification of Landscape Contractors for Parks Capital Projects', closesInDays: 33 },
  ],
};

function bonfireJson(now: Date, portal: string): string {
  const projects: Record<string, unknown> = {};
  for (const p of BONFIRE[portal] ?? []) {
    projects[p.id] = {
      ProjectID: p.id,
      OrganizationID: '9001',
      DepartmentID: '12',
      ReferenceID: p.ref,
      ProjectName: p.name,
      // Bonfire stores UTC and has no zone on the value.
      DateClose: closing(now, p.closesInDays).toUTC().toFormat('yyyy-MM-dd HH:mm:ss'),
      ProjectStatusID: '2',
      PrivateProjectID: '0',
    };
  }
  return JSON.stringify({ success: 1, message: '', payload: { projects } });
}

// ---------------------------------------------------------------------------
// District of Saanich: RSS feed and notice pages
// ---------------------------------------------------------------------------

interface SaanichNotice {
  slug: string;
  title: string;
  closesInDays: number;
  body: string;
}

const SAANICH: SaanichNotice[] = [
  {
    slug: 'boulevard-and-median-landscape-maintenance',
    title: 'Boulevard and Median Landscape Maintenance',
    closesInDays: 19,
    body: '<p>RFQ 26-140. The District of Saanich invites quotations for boulevard and median landscape maintenance on an as-needed basis.</p><p>All documents and addenda are only available for download and submission on the Saanich Procurement Portal.</p><p>All inquiries should be directed to purchasing@saanich.example.</p>',
  },
  {
    slug: 'yard-maintenance-services',
    title: 'Yard Maintenance Services',
    closesInDays: 13,
    body: '<p>The District of Saanich invites quotations from qualified contractors for yard maintenance services (lawn mowing, hedge trimming, weeding and seasonal clean-up) at District-owned residential properties, on an as-needed basis at hourly rates for a one (1) year term.</p><p>Quotations must be submitted by email to quotes@saanich.example before the closing time. Please include your hourly rates, proof of WorkSafeBC coverage and $2,000,000 liability insurance.</p><p>Questions may be directed to parks.contracts@saanich.example.</p>',
  },
  {
    slug: 'rock-wall-construction',
    title: 'Rock Wall Construction',
    closesInDays: 21,
    body: '<p>The District of Saanich invites quotations for rock wall construction for the Public Works Yard on an as-needed basis.</p>',
  },
  {
    slug: 'arboricultural-services',
    title: 'Arboricultural Services',
    closesInDays: 18,
    body: '<p>Provision of arboricultural services for Parks, Public Works and Engineering on an as-needed basis. Work must be supervised by an ISA Certified Arborist.</p>',
  },
];

function saanichFeed(now: Date, base: string): string {
  const items = SAANICH.map((n) => {
    const closes = closing(now, n.closesInDays);
    const link = `${base}/saanich/bid-opportunities/${n.slug}.html`;
    return `    <item>
      <title>${esc(n.title)}</title>
      <link>${link}</link>
      <guid isPermaLink="true">${link}</guid>
      <pubDate>${posted(now, 4).toRFC2822()}</pubDate>
      <description><![CDATA[<p>Closing Date: ${closes.toFormat('LLLL d, yyyy')} at ${closes.toFormat('h:mm a')}</p>]]></description>
    </item>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>District of Saanich - Bid Opportunities (sample)</title>
    <link>${base}/saanich/bid-opportunities.html</link>
    <description>Sample feed for Lgbids demo mode</description>
${items}
  </channel>
</rss>`;
}

function saanichPage(now: Date, n: SaanichNotice): string {
  const closes = closing(now, n.closesInDays);
  return page(
    `${n.title} | District of Saanich (sample)`,
    `<h1>${esc(n.title)}</h1>
<p><strong>Closing Date:</strong> ${closes.toFormat('LLLL d, yyyy')} at ${closes.toFormat('h:mm a')} local time</p>
${n.body}`,
  );
}

// ---------------------------------------------------------------------------
// Capital Regional District: listing page, notice pages and one bid document
// ---------------------------------------------------------------------------

interface CrdNotice {
  slug: string;
  title: string;
  closesInDays: number;
  body: string;
  document?: boolean;
}

const CRD: CrdNotice[] = [
  {
    slug: '2026-041---itq---regional-parks-mowing-and-trimming-services',
    title: '2026-041 - ITQ - Regional Parks Mowing and Trimming Services',
    closesInDays: 16,
    body: '<p>The Capital Regional District invites quotations for mowing and line trimming at Elk/Beaver Lake, Island View Beach and Thetis Lake Regional Parks for the 2027 season.</p><p>Inquiries: parks.procurement@crd.example</p>',
    document: true,
  },
  {
    slug: 'ssi-2026-020---rfp---salt-spring-island-parks-mowing',
    title: 'SSI 2026-020 - RFP - Salt Spring Island Parks Mowing',
    closesInDays: 20,
    body: '<p>Mowing of community parks on Salt Spring Island.</p>',
  },
  {
    slug: 'erm2026-012---itt---port-renfrew-bin-hauling-services',
    title: 'ERM2026-012 - ITT - Port Renfrew Bin Hauling Services',
    closesInDays: 10,
    body: '<p>Hauling of bins from the Port Renfrew transfer station.</p>',
  },
  {
    slug: 'erm2026-015---rfq---hartland-landfill-invasive-species-control',
    title: 'ERM2026-015 - RFQ - Hartland Landfill Invasive Species Control',
    closesInDays: 1,
    body: '<p>Control of Scotch broom and Himalayan blackberry on the Hartland Landfill buffer lands. Quotations are to be emailed to environmental.procurement@crd.example.</p>',
  },
];

function crdListing(now: Date): string {
  const cards = CRD.map((n) => {
    const closes = closing(now, n.closesInDays);
    return `<div class="views-row">
  <h3><a href="/crd/contracts-rfps/current/${n.slug}">${esc(n.title)}</a></h3>
  <p>Closing Date: ${closes.toFormat('LLLL d, yyyy h:mm a')} (Pacific Time)</p>
</div>`;
  }).join('\n');
  return page(
    'Current Opportunities | Capital Regional District (sample)',
    `<h1>Current Contracts &amp; RFPs</h1>
<p><a href="/crd/contracts-rfps/awarded">Awarded</a> | <a href="/crd/contracts-rfps/closed">Closed</a></p>
${cards}`,
  );
}

function crdPage(now: Date, n: CrdNotice): string {
  const closes = closing(now, n.closesInDays);
  return page(
    `${n.title} | Capital Regional District (sample)`,
    `<h1>${esc(n.title)}</h1>
<table>
  <tr><th>Status</th><td>Open</td></tr>
  <tr><th>Closing Date</th><td>${closes.toFormat('LLLL d, yyyy h:mm a')} (Pacific Time)</td></tr>
  <tr><th>Department</th><td>Regional Parks</td></tr>
</table>
${n.body}
${n.document ? `<h2>Documents</h2><ul><li><a href="/crd/documents/2026-041-itq.pdf">2026-041 Invitation to Quote (PDF)</a></li></ul>` : ''}`,
  );
}

// ---------------------------------------------------------------------------
// Township of Esquimalt: a table listing
// ---------------------------------------------------------------------------

const ESQUIMALT = [
  {
    slug: 'rfq-no-pr-26-04-memorial-park-and-township-hall-garden-maintenance',
    title: 'RFQ NO. P&R 26-04 Memorial Park and Township Hall Garden Maintenance',
    closesInDays: 12,
    body: '<p>The Township of Esquimalt invites quotations for seasonal garden bed maintenance, pruning and mulching at Memorial Park and the Township Hall.</p><p>Quotations may be submitted by email to bids@esquimalt.example. Quotations are requested as a lump sum price for the season.</p>',
  },
  {
    slug: 'itt-no-eng-26-03-esquimalt-road-phase-2-underground-utility-renewals',
    title: 'ITT NO. ENG 26-03 Esquimalt Road Phase 2 - Underground Utility Renewals',
    closesInDays: 25,
    body: '<p>Underground utility renewals and active transportation improvements on Esquimalt Road.</p>',
  },
];

function esquimaltListing(now: Date): string {
  const rows = ESQUIMALT.map((n) => {
    const closes = closing(now, n.closesInDays);
    return `<tr><td><a href="/esquimalt/business-development/bids-tenders/${n.slug}">${esc(n.title)}</a></td><td>${closes.toFormat('cccc, LLLL d, yyyy')} at ${closes.toFormat('h:mm a').toLowerCase()} local time</td><td>Open</td></tr>`;
  }).join('\n');
  return page(
    'Bids & Tenders | Township of Esquimalt (sample)',
    `<h1>Bids &amp; Tenders</h1>
<table>
<thead><tr><th>Opportunity</th><th>Closing</th><th>Status</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>`,
  );
}

function esquimaltPage(now: Date, n: (typeof ESQUIMALT)[number]): string {
  const closes = closing(now, n.closesInDays);
  return page(
    `${n.title} | Township of Esquimalt (sample)`,
    `<h1>${esc(n.title)}</h1>
<p>Closing: ${closes.toFormat('cccc, LLLL d, yyyy')} at ${closes.toFormat('h:mm a').toLowerCase()} local time</p>
${n.body}`,
  );
}

// ---------------------------------------------------------------------------
// CivicInfo BC: a paginated, province-wide table
// ---------------------------------------------------------------------------

const CIVICINFO = [
  { id: '7001', title: 'Landscape Maintenance Services', organization: 'City of Coquitlam', type: 'Request for Proposals', closesInDays: 18 },
  { id: '7002', title: 'Cemetery Grounds Maintenance', organization: 'District of Metchosin', type: 'Request for Quotations', closesInDays: 14 },
  { id: '7003', title: 'Water Main Replacement Program', organization: 'District of Summerland', type: 'Invitation to Tender', closesInDays: 22 },
  { id: '7004', title: 'Street Tree Planting and Establishment Watering', organization: 'Town of Sidney', type: 'Invitation to Tender', closesInDays: 20 },
  { id: '7005', title: 'Parks Mowing Services', organization: 'City of Nanaimo', type: 'Request for Proposals', closesInDays: 16 },
  { id: '7006', title: 'Community Hall Roof Replacement', organization: 'District of Highlands', type: 'Invitation to Tender', closesInDays: 28 },
];
const CIVICINFO_PAGE_SIZE = 4;

function civicinfoListing(now: Date, pageNumber: number): string {
  const start = (pageNumber - 1) * CIVICINFO_PAGE_SIZE;
  const rows = CIVICINFO.slice(start, start + CIVICINFO_PAGE_SIZE)
    .map(
      (n) =>
        `<tr><td><a href="/civicinfo/bids?bidsid=${n.id}">${esc(n.title)}</a></td><td>${esc(n.organization)}</td><td>${esc(n.type)}</td><td>${posted(now, 3).toFormat('yyyy-MM-dd')}</td><td>${closing(now, n.closesInDays).toFormat('yyyy-MM-dd')}</td></tr>`,
    )
    .join('\n');
  const pages = Math.ceil(CIVICINFO.length / CIVICINFO_PAGE_SIZE);
  const pager = Array.from({ length: pages }, (_, i) => `<a href="/civicinfo/bids?pn=${i + 1}&amp;">${i + 1}</a>`).join(' ');
  return page(
    'Current Opportunities | CivicInfo BC (sample)',
    `<h1>Current Opportunities</h1>
<table>
<thead><tr><th>Title</th><th>Organization</th><th>Type</th><th>Posting Date</th><th>Closing Date</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>
<div class="pagination">${pager}</div>`,
  );
}

function civicinfoPage(now: Date, n: (typeof CIVICINFO)[number]): string {
  const closes = closing(now, n.closesInDays);
  const slug = n.organization.toLowerCase().replace(/[^a-z]+/g, '');
  return page(
    `${n.title} | CivicInfo BC (sample)`,
    `<h1>${esc(n.title)}</h1>
<dl>
  <dt>Organization</dt><dd>${esc(n.organization)}</dd>
  <dt>Type</dt><dd>${esc(n.type)}</dd>
  <dt>Closing Date</dt><dd>${closes.toFormat('LLLL d, yyyy')} 2:00 PM</dd>
</dl>
<p>${esc(n.organization)} invites submissions for ${esc(n.title.toLowerCase())}. Submissions may be emailed to tenders@${slug}.example.</p>`,
  );
}

// ---------------------------------------------------------------------------
// Assemble
// ---------------------------------------------------------------------------

export type Fixtures = (path: string, query: URLSearchParams) => FixtureResponse | null;

/**
 * Build the sample sites. `base` is the address the fixture server is
 * listening on; it is needed for the absolute links some formats carry.
 */
export async function buildFixtures(now: Date, base: string): Promise<Fixtures> {
  const closes = closing(now, 16);
  const crdDocument = await makePdf('Invitation to Quote 2026-041 - Regional Parks Mowing and Trimming Services (SAMPLE)', [
    'This is an invented sample document for Lgbids demo mode. It is not a real solicitation.',
    `Quotations must be submitted by email to quotes@crd.example before ${closes.toFormat('h:mm a')} Pacific Time on ${closes.toFormat('LLLL d, yyyy')}.`,
    'Pricing: provide a price per cut for each park and hourly rates for additional work as requested.',
    'The contractor must carry $5,000,000 commercial general liability insurance, be registered with WorkSafeBC and hold a valid business licence.',
    'Provide three (3) references for similar work completed in the last five years.',
    'Bidders must complete and sign the Quotation Form in Appendix A.',
  ]);

  const html = (body: string): FixtureResponse => ({ type: 'text/html; charset=utf-8', body });

  return (path, query) => {
    if (path === '/robots.txt') return { type: 'text/plain', body: 'User-agent: *\nDisallow: /private/\nAllow: /\n' };
    if (path === '/private/listing') return html(page('Private', '<p>Not for robots.</p>'));

    if (path === '/canadabuys/opendata/open.csv') return { type: 'text/csv; charset=utf-8', body: federalCsv(now, base), headers: { etag: '"sample-1"' } };
    if (path === '/canadabuys/en/tender-opportunities') return html(searchPage(now, base, query.get('words') ?? query.get('search_filter') ?? ''));
    const notice = /^\/canadabuys\/en\/tender-opportunities\/tender-notice\/([\w-]+)$/.exec(path);
    if (notice) {
      const found = MIRRORED.find((n) => n.id === notice[1]);
      return found ? html(noticePage(now, found)) : null;
    }

    const portal = /^\/bonfire\/(\w+)\/PublicPortal\/getOpenPublicOpportunitiesSectionData$/.exec(path);
    if (portal && BONFIRE[portal[1]!]) return { type: 'application/json', body: bonfireJson(now, portal[1]!) };

    if (path === '/saanich/tenders.rss') return { type: 'application/rss+xml; charset=utf-8', body: saanichFeed(now, base) };
    const saanich = /^\/saanich\/bid-opportunities\/([\w-]+)\.html$/.exec(path);
    if (saanich) {
      const found = SAANICH.find((n) => n.slug === saanich[1]);
      return found ? html(saanichPage(now, found)) : null;
    }

    if (path === '/crd/contracts-rfps/current') return html(crdListing(now));
    if (path === '/crd/documents/2026-041-itq.pdf') return { type: 'application/pdf', body: crdDocument };
    const crd = /^\/crd\/contracts-rfps\/current\/(.+)$/.exec(path);
    if (crd) {
      const found = CRD.find((n) => n.slug === decodeURIComponent(crd[1]!));
      return found ? html(crdPage(now, found)) : null;
    }

    if (path === '/esquimalt/business-development/bids-tenders') return html(esquimaltListing(now));
    const esquimalt = /^\/esquimalt\/business-development\/bids-tenders\/(.+)$/.exec(path);
    if (esquimalt) {
      const found = ESQUIMALT.find((n) => n.slug === decodeURIComponent(esquimalt[1]!));
      return found ? html(esquimaltPage(now, found)) : null;
    }

    if (path === '/civicinfo/bids') {
      const id = query.get('bidsid');
      if (id) {
        const found = CIVICINFO.find((n) => n.id === id);
        return found ? html(civicinfoPage(now, found)) : null;
      }
      return html(civicinfoListing(now, Number(query.get('pn') ?? '1') || 1));
    }

    if (path === '/blocked/listing') return { status: 403, type: 'text/html', body: '<html><head><title>Access denied</title></head><body>Forbidden</body></html>' };
    if (path === '/challenge/listing') {
      return html('<html><head><title>Just a moment...</title></head><body><div id="cf_chl_widget">Checking your browser</div></body></html>');
    }
    if (path === '/empty/listing') return html(page('Bid opportunities', '<h1>Bid opportunities</h1><p>There are no opportunities at this time.</p>'));
    return null;
  };
}
