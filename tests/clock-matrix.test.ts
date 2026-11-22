// Clock and time-zone matrix (TST-10, lean mode: two clocks, one summer and one winter).
// Every sample site states its closing in a different zone (CanadaBuys Eastern,
// Bonfire UTC, Saanich Pacific); each must come out as 2:00 pm in Victoria.
import { rmSync } from 'node:fs';
import { DateTime } from 'luxon';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assessReadiness } from '../src/server/applications/draft.js';
import { buildDashboard } from '../src/server/dashboard.js';
import { startFixtureServer, type FixtureServer } from '../src/server/demo/server.js';
import { createPipeline } from '../src/server/pipeline/run.js';
import { buildCalendar } from '../src/server/routes/calendar.js';
import { opportunityDto } from '../src/server/routes/util.js';
import { closingDeadline } from '../src/server/util/dates.js';
import { opportunitiesCsvName } from '../src/server/util/csv.js';
import { fakeScheduler } from './helpers/apiHarness.js';
import { dirs, makeEnv, type Env } from './helpers/pipelineEnv.js';

const ZONE = 'America/Vancouver';
// BC stays on UTC-7 all year from 2026 only in current tz data; older runtimes (the Node floor) show UTC-8 in January.
const NEW_TZ_DATA = DateTime.fromISO('2027-01-15T12:00', { zone: ZONE }).offset === -420;
const pacific = (iso: string) => DateTime.fromISO(iso, { zone: 'utc' }).setZone(ZONE);

const CLOCKS = [
  { name: 'summer afternoon', now: '2026-06-15T20:00:00Z', localDay: '2026-06-15', winter: false },
  { name: 'winter afternoon', now: '2027-01-15T20:00:00Z', localDay: '2027-01-15', winter: true },
];

describe.each(CLOCKS)('at $now ($name)', ({ now, localDay, winter }) => {
  const clock = new Date(now);
  // Winter results depend on the tz data; only check them where BC is already on year-round UTC-7.
  const tzIt = winter && !NEW_TZ_DATA ? it.skip : it;
  let server: FixtureServer;
  let env: Env;

  beforeAll(async () => {
    server = await startFixtureServer(clock);
    const u = server.url;
    env = makeEnv({
      noSamples: true,
      extraSources: [
        { id: 'cb-csv', name: 'Federal tenders', kind: 'canadabuys_csv', config: { url: `${u}/canadabuys/opendata/open.csv`, timeZone: 'America/Toronto', fetchDetails: false } },
        { id: 'bf-saanich', name: 'Saanich portal', kind: 'bonfire', config: { url: `${u}/bonfire/saanich`, organization: 'District of Saanich', localBuyer: true, defaultSubmission: 'bonfire', fetchDetails: false } },
        { id: 'saanich-rss', name: 'Saanich feed', kind: 'rss', config: { url: `${u}/saanich/tenders.rss`, organization: 'District of Saanich', localBuyer: true, defaultSubmission: 'bonfire' } },
        // CRD has a bid closing tomorrow, so closingSoon is never zero by accident.
        { id: 'crd', name: 'CRD', kind: 'html_list', config: { url: `${u}/crd/contracts-rfps/current`, linkPattern: '^/crd/contracts-rfps/current/[^/?#]+', organization: 'Capital Regional District', localBuyer: true } },
      ],
    });
    env.clock.now = clock;
    await createPipeline(env.deps).run('manual');
  });

  afterAll(async () => {
    await server.close();
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  const all = () => env.store.listOpportunities({ view: 'all', limit: 500 }, clock).items;

  tzIt('reads every source closing as 2:00 pm Pacific', () => {
    for (const source of ['cb-csv', 'bf-saanich', 'saanich-rss', 'crd']) {
      const timed = all().filter((o) => o.sourceId === source && o.closesAt && o.closesAtPrecision === 'datetime');
      expect(timed.length, source).toBeGreaterThan(0);
      for (const o of timed) expect(pacific(o.closesAt!).toFormat('HH:mm'), `${source}: ${o.title}`).toBe('14:00');
    }
  });

  tzIt('uses the start of the local day as the sending deadline for date-only closings', () => {
    const endOfDay = DateTime.fromISO(`${localDay}T23:59:59`, { zone: ZONE }).toUTC().toISO()!;
    const deadline = closingDeadline(endOfDay, 'date', ZONE);
    expect(DateTime.fromJSDate(deadline).setZone(ZONE).toISO()).toBe(DateTime.fromISO(`${localDay}T00:00:00`, { zone: ZONE }).toISO());
    const timed = '2026-07-09T21:00:00Z';
    expect(closingDeadline(timed, 'datetime', ZONE).toISOString()).toBe('2026-07-09T21:00:00.000Z');
  });

  tzIt('treats a date-only closing today as closed and tomorrow as open', () => {
    const opp = all().find((o) => o.closesAt)!;
    const ctx = { profile: env.deps.settings.getProfile(), email: env.deps.settings.getEmail(), documents: [], now: clock, zone: ZONE };
    const app = { channel: 'portal' as const, toEmail: '', priceTotal: 100, includeRates: false, checklist: [], subject: 's', body: 'b' };
    const day = (d: number) => DateTime.fromISO(localDay, { zone: ZONE }).plus({ days: d }).endOf('day').toUTC().toISO()!;
    const closedMsg = 'This opportunity has closed.';
    expect(assessReadiness(app, { ...opp, status: 'open', closesAt: day(0), closesAtPrecision: 'date' }, ctx).missing).toContain(closedMsg);
    expect(assessReadiness(app, { ...opp, status: 'open', closesAt: day(1), closesAtPrecision: 'date' }, ctx).missing).not.toContain(closedMsg);
  });

  it('names the CSV file after the local day', () => {
    expect(opportunitiesCsvName(clock, ZONE)).toContain(localDay);
  });

  tzIt('writes the ICS DTSTART in UTC for timed closings and as the local day for date-only ones', () => {
    const opp = opportunityDto(all().find((o) => o.closesAt && o.closesAtPrecision === 'datetime')!);
    const ics = buildCalendar([opp, { ...opp, id: opp.id + 10_000, closesAtPrecision: 'date' }], clock, ZONE);
    const closes = pacific(opp.closesAt!);
    expect(ics).toContain(`DTSTART:${closes.toUTC().toFormat("yyyyMMdd'T'HHmmss'Z'")}`);
    expect(ics).toContain(`DTSTART;VALUE=DATE:${closes.toFormat('yyyyMMdd')}`);
  });

  it('counts suitable open bids closing within a week as closing soon', () => {
    // Eight days on, the earliest suitable sample bid (13 days out) falls inside the week.
    const later = new Date(clock.getTime() + 8 * 86_400_000);
    const deps = { ...env.deps, now: () => later };
    const dash = buildDashboard(deps, createPipeline(deps), fakeScheduler());
    const week = later.getTime() + 7 * 86_400_000;
    const expected = env.store
      .listOpportunities({ view: 'suitable', limit: 500 }, later)
      .items.filter((o) => o.status === 'open' && o.closesAt && Date.parse(o.closesAt) >= later.getTime() && Date.parse(o.closesAt) <= week).length;
    expect(expected).toBeGreaterThan(0);
    expect(dash.counts.closingSoon).toBe(expected);
  });
});
