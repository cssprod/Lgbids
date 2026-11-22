import type { SourceTest } from '../../shared/api.js';
import { sourceConfigSchema, type SourceInput, type SourceRecord } from '../../shared/schemas.js';
import { DAY, fail, HOUR, iso, match, notBuilt, ok, type MockModule } from './context.js';

/**
 * Sources page in the mock: the built-in sources (kept in step with
 * DEFAULT_SOURCES in src/server/sources/registry.ts), "Test" results and the
 * source routes.
 */

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
    layoutWarning: '',
    ...p,
  };
}

const BONFIRE_OFF =
  'Turned off: Bonfire portals ask automated tools not to read them (their robots.txt disallows everything), so Lgbids leaves them alone. To hear about new bids, register a free vendor account on the portal and follow this buyer; Bonfire then e-mails you new opportunities.';
const CANADABUYS_OFF =
  'Turned off: canadabuys.canada.ca asks automated tools other than search engines not to read it (robots.txt), so Lgbids leaves it alone.';
function unchecked(about: string): string {
  return `${about} Not yet checked against the live site, so it ships turned off. Press “Test” to see whether it reads correctly, then turn it on.`;
}
const off = { enabled: false, lastStatus: 'never' as const, lastRunAt: null, lastOkAt: null, lastItemCount: null };

/** Mirrors DEFAULT_SOURCES in src/server/sources/registry.ts (beta set-up after the live check). */
export function initialSources(): SourceRecord[] {
  return [
  source({
      id: 'email-alerts',
      name: 'Bid alert e-mails (BC Bid and Bonfire)',
      kind: 'email_alerts',
      notes: 'BC Bid, Bonfire, CanadaBuys, bids&tenders, MERX and Biddingo e-mail you about new opportunities; Lgbids reads those alert e-mails from your inbox (read-only) or from .eml files you import here, and never opens the sites themselves. Set up the inbox under Settings → Bid alert inbox.',
      lastItemCount: 9,
      lastMessage: '9 alert e-mails read; 4 notices look relevant.',
    }),
    source({
      id: 'manual',
      name: 'Bids added by hand',
      kind: 'manual',
      notes: 'Bids you add on the Opportunities page, by typing them in or pasting an alert e-mail. Lgbids scores them like any other bid and never opens their links.',
      config: sourceConfigSchema.parse({ fetchDetails: false }),
      lastStatus: 'empty',
      lastItemCount: 0,
      lastMessage: 'Bids you add by hand are kept here, so there is nothing to read.',
    }),
    source({ id: 'saanich-rss', name: 'District of Saanich — bid opportunities feed', kind: 'rss', notes: 'Saanich’s own website feed. It includes smaller quotation requests that are not posted on BC Bid.', lastItemCount: 10 }),
    source({ id: 'esquimalt', name: 'Township of Esquimalt — bids & tenders', kind: 'html_list', notes: 'Esquimalt’s own bids page.', lastItemCount: 17 }),
    source({
      id: 'oakbay',
      name: 'District of Oak Bay — tenders',
      kind: 'html_list',
      notes: unchecked('Oak Bay’s tenders page (oakbay.ca now forwards to www.oakbay.ca). Oak Bay posts its documents on BC Bid, so this page is often empty.'),
      ...off,
    }),
    source({ id: 'canadabuys-bcbid', name: 'BC Bid notices (via CanadaBuys)', kind: 'canadabuys_search', notes: `${CANADABUYS_OFF} BC Bid itself puts a browser check in front of its listing. Most Greater Victoria municipalities, school districts and public bodies post on BC Bid: turn on BC Bid's own e-mail notifications for landscaping categories to hear about them.`, ...off }),
    source({ id: 'canadabuys-federal', name: 'Government of Canada tenders (open data)', kind: 'canadabuys_csv', notes: `${CANADABUYS_OFF} Federal work in the region (CFB Esquimalt, Parks Canada, federal buildings) is posted there: set up a saved search with e-mail alerts on CanadaBuys; Lgbids reads those CanadaBuys alert e-mails through the “Bid alert e-mails” source.`, ...off }),
    source({ id: 'bonfire-victoria', name: 'City of Victoria — bid portal', kind: 'bonfire', notes: BONFIRE_OFF, ...off }),
    source({ id: 'bonfire-saanich', name: 'District of Saanich — procurement portal', kind: 'bonfire', notes: BONFIRE_OFF, ...off }),
    source({ id: 'bonfire-centralsaanich', name: 'District of Central Saanich — procurement portal', kind: 'bonfire', notes: BONFIRE_OFF, ...off }),
    source({ id: 'bonfire-northsaanich', name: 'District of North Saanich — procurement portal', kind: 'bonfire', notes: BONFIRE_OFF, ...off }),
    source({ id: 'bonfire-uvic', name: 'University of Victoria — procurement portal', kind: 'bonfire', notes: BONFIRE_OFF, ...off }),
    source({ id: 'crd', name: 'Capital Regional District — current opportunities', kind: 'html_list', notes: 'Turned off: the CRD’s old bid site (bid.crd.ca) now answers “not found” for every page, and its replacement on crd.ca could not be checked yet. Look at the CRD’s current opportunities on crd.ca until this source is updated. Work on Salt Spring, the Gulf Islands and Port Renfrew is filtered out as outside Greater Victoria.', ...off }),
    source({ id: 'sooke', name: 'District of Sooke — bid and tender opportunities', kind: 'html_list', notes: unchecked('Sooke’s own bids page.'), ...off }),
    source({ id: 'langford', name: 'City of Langford — requests for proposals', kind: 'html_list', notes: unchecked('Langford’s own RFP page.'), ...off }),
    source({ id: 'colwood', name: 'City of Colwood — tenders and requests for proposals', kind: 'html_list', notes: unchecked('Colwood’s own tenders page.'), ...off }),
    source({ id: 'viewroyal', name: 'Town of View Royal — tenders and RFPs', kind: 'html_list', notes: unchecked('View Royal’s own tenders page.'), ...off }),
    source({
      id: 'sidney',
      name: 'Town of Sidney — bidding opportunities',
      kind: 'html_list',
      notes: unchecked('Sidney’s own bids page. Sidney takes bids through its bids&tenders portal, which needs a vendor login, so Lgbids prepares the package and you upload it there. Follow Sidney on bids&tenders to get its alert e-mails, which Lgbids reads through the “Bid alert e-mails” source.'),
      ...off,
    }),
    source({ id: 'civicinfo-bc', name: 'CivicInfo BC — local government bids', kind: 'html_list', notes: 'Turned off: CivicInfo BC puts a Cloudflare browser check in front of its bid listing, so it cannot be read automatically. Smaller Greater Victoria municipalities post there; check civicinfo.bc.ca/bids in your browser.', ...off }),
  ];
}

export function sampleTest(input: { name: string; kind?: SourceRecord['kind']; config: { url: string } }): SourceTest {
  const url = input.config.url || 'https://example.example/bids';
  const robots = { url: `${url.replace(/\/$/, '')}/robots.txt`, status: 200, bytes: 312, ms: 220 };
  const failed = (status: SourceTest['status'], message: string, request: SourceTest['requests'][number]): SourceTest => ({
    status,
    message,
    ms: 1830,
    count: 0,
    sample: [],
    requests: [robots, request],
  });
  if (input.kind === 'bonfire' || input.kind === 'canadabuys_csv' || input.kind === 'canadabuys_search') {
    return { ...failed('blocked', 'The site’s robots.txt asks automated tools not to read it, so Lgbids did not open the listing.', robots), requests: [robots] };
  }
  if (input.name.startsWith('CivicInfo')) {
    return failed('blocked', 'The site answered with a browser check (403). Lgbids cannot read it automatically.', { url, status: 403, bytes: 5120, ms: 1610, error: 'Browser check page' });
  }
  if (input.name.startsWith('Capital Regional')) {
    return failed('error', 'The page answered “not found” (404). The site has probably moved.', { url, status: 404, bytes: 1024, ms: 410, error: 'Not found' });
  }
  if (input.kind === 'manual') {
    return { status: 'empty', message: 'Bids you add by hand are kept here, so there is nothing to read.', ms: 1, count: 0, sample: [], requests: [] };
  }
  if (input.kind === 'email_alerts') {
    return {
      status: 'ok',
      message: 'Read 9 alert e-mails from BC Bid and Bonfire; 3 notices shown below.',
      ms: 940,
      count: 9,
      sample: [
        { title: 'Cemetery Grounds Maintenance', url: '', organization: 'Sample District of Metchosin', closesAt: iso(DAY), closingRaw: '', referenceNumber: '' },
        { title: 'ITT PRK-26-07 – Sports Field Mowing and Turf Maintenance', url: '', organization: 'Sample City of Langford', closesAt: iso(12 * DAY), closingRaw: '', referenceNumber: 'PRK-26-07' },
        { title: 'Washroom Building Renovation', url: '', organization: 'Sample Town of Sidney', closesAt: iso(9 * DAY), closingRaw: '', referenceNumber: 'ENG 26-03' },
      ],
      requests: [],
    };
  }
  return {
    status: 'ok',
    message: 'Read 1 page and found 3 notices.',
    ms: 2412,
    count: 3,
    sample: [
      { title: 'RFQ 26-140 – Boulevard and Median Landscape Maintenance', url: 'https://bids.example/notice/101', organization: 'Sample District of Saanich', closesAt: iso(3 * DAY), closingRaw: '', referenceNumber: 'RFQ 26-140' },
      { title: 'Tree Pruning – Various Parks', url: 'https://bids.example/notice/77', organization: 'Sample District of Saanich', closesAt: null, closingRaw: 'Early December', referenceNumber: '' },
      { title: 'Washroom Building Renovation', url: 'https://bids.example/notice/78', organization: '', closesAt: iso(9 * DAY), closingRaw: '', referenceNumber: 'ENG 26-03' },
    ],
    requests: [robots, { url, status: 200, bytes: 48_220, ms: 1490 }],
  };
}

export const sources: MockModule = (ctx, { method, path, body }) => {
  const list = ctx.state.sources;
  let r: RegExpExecArray | null;
  if (path === '/api/sources/test') return ok(sampleTest(body as unknown as SourceInput));
  if (path === '/api/sources' && method === 'POST') {
    const input = body as unknown as SourceInput;
    const s = source({ id: `custom-${ctx.newId()}`, name: input.name, kind: input.kind, builtin: false, notes: input.notes, config: input.config, lastStatus: 'never', lastRunAt: null, lastOkAt: null, lastItemCount: null, enabled: input.enabled });
    list.push(s);
    return ok(s);
  }
  if (path === '/api/sources') return ok(list);
  // "Who you hear from" (COV-14): answers like the server stub until then.
  if (path === '/api/coverage') return notBuilt();
  if ((r = match(path, /^\/api\/sources\/([\w-]+)\/test$/))) {
    const s = list.find((x) => x.id === r![1]);
    if (!s) return fail(404, 'That source no longer exists.');
    const result = sampleTest(s);
    if (result.status === 'ok' && result.count > 0) s.layoutWarning = '';
    return ok(result);
  }
  if ((r = match(path, /^\/api\/sources\/([\w-]+)$/))) {
    const i = list.findIndex((x) => x.id === r![1]);
    if (i < 0) return fail(404, 'That source no longer exists.');
    if (method === 'DELETE') {
      if (list[i]!.builtin) return fail(409, 'Built-in sources cannot be deleted. Turn it off instead.');
      list.splice(i, 1);
      return ok({ ok: true });
    }
    list[i] = { ...list[i]!, ...(body as Partial<SourceRecord>) };
    return ok(list[i]);
  }
  return null;
};
