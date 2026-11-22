import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { SourceKind } from '../src/shared/schemas.js';
import type { AppDeps } from '../src/server/contracts.js';
import type { AlertMailbox } from '../src/server/sources/alerts/mailbox.js';
import { createPipeline } from '../src/server/pipeline/run.js';
import { closeHarnesses, harness, multipart } from './helpers/apiHarness.js';
import { makeEnv } from './helpers/pipelineEnv.js';

// Invented alert e-mails in the shape of the samples in tests/alerts.test.ts.
const eml = (from: string, subject: string, html: string) =>
  Buffer.from(
    [`From: ${from}`, 'To: bids@garryoak.example', `Subject: ${subject}`, 'Date: Mon, 15 Jun 2026 08:00:00 -0700', 'MIME-Version: 1.0', 'Content-Type: text/html; charset=utf-8', '', html].join('\r\n'),
  );
const bcbid = eml(
  'BC Bid <noreply@bcbid.gov.bc.ca>',
  'BC Bid: new opportunities',
  '<table><tr><th>Opportunity ID</th><th>Description</th><th>Organization</th><th>Closing Date</th></tr>' +
    '<tr><td>CS-2026-114</td><td><a href="https://bcbid.gov.bc.ca/page.aspx/en/bpm/process_manage_extranet/91234">Boulevard Mowing and Trimming Services</a></td><td>City of Langford</td><td>2026-07-09 2:00 PM</td></tr>' +
    '<tr><td>SD61-26-07</td><td><a href="https://bcbid.gov.bc.ca/page.aspx/en/bpm/process_manage_extranet/91240">School Grounds Maintenance</a></td><td>School District No. 61</td><td>2026-07-14 11:00 AM</td></tr></table>',
);
// From an alert sender, but a newsletter: not an alert.
const newsletter = eml('Bonfire <news@gobonfire.com>', 'Bonfire newsletter: our summer webinar', '<p>Join our webinar on procurement trends. <a href="https://gobonfire.com/webinar">Register</a></p>');

const alertSource = { id: 'email-alerts', name: 'Bid alert e-mails', kind: 'email_alerts' as SourceKind, config: { fetchDetails: false, bcOnly: true } };

/** Wraps the HTTP client so every request it would make is counted. */
function countRequests(deps: AppDeps): () => number {
  let calls = 0;
  const original = deps.httpFactory;
  deps.httpFactory = (automation) => {
    const client = original(automation);
    const get = client.get.bind(client);
    const stream = client.stream.bind(client);
    client.get = (...args) => {
      calls += 1;
      return get(...args);
    };
    client.stream = (...args) => {
      calls += 1;
      return stream(...args);
    };
    return client;
  };
  return () => calls;
}

afterEach(closeHarnesses);

describe('unrecognised alert e-mails are kept', () => {
  it('an imported newsletter moves to "unrecognised", a real alert to "read", and nothing is fetched', async () => {
    const env = makeEnv({ noSamples: true, extraSources: [alertSource] });
    const requests = countRequests(env.deps);
    mkdirSync(env.deps.alertImportDir, { recursive: true });
    writeFileSync(join(env.deps.alertImportDir, 'news.eml'), newsletter);
    writeFileSync(join(env.deps.alertImportDir, 'bcbid.eml'), bcbid);

    const run = await createPipeline(env.deps).run('manual');
    const stat = run.stats!.sources[0]!;
    expect(stat).toMatchObject({ found: 2 });
    expect(stat.message).toContain('1 not recognised — kept for a bug report');
    expect(readdirSync(join(env.deps.alertImportDir, 'unrecognised'))).toEqual(['news.eml']);
    expect(readdirSync(join(env.deps.alertImportDir, 'read'))).toEqual(['bcbid.eml']);
    expect(requests()).toBe(0);
  });

  it('keeps the headers of the last 20 skipped inbox e-mails in the source state', async () => {
    let batch = 0;
    const mailbox: AlertMailbox = {
      async fetchNew() {
        batch += 1;
        const messages = Array.from({ length: 15 }, (_, n) => ({ id: `imap:${batch * 100 + n}`, raw: newsletter }));
        return { messages, position: { uidValidity: '7', lastUid: batch * 100 + 14 } };
      },
      async test() {
        return { count: 0 };
      },
    };
    const env = makeEnv({ noSamples: true, extraSources: [alertSource], mailbox });
    env.deps.settings.setAlertInbox({ user: 'bids@garryoak.example', pass: 'app-password' });
    const pipeline = createPipeline(env.deps);
    await pipeline.run('manual');
    await pipeline.run('manual');
    const skipped = env.store.getSourceState('email-alerts').skipped as { uid: string; from: string; subject: string; date: string | null }[];
    expect(skipped).toHaveLength(20);
    expect(skipped.at(-1)).toEqual({ uid: '214', from: expect.stringContaining('news@gobonfire.com'), subject: 'Bonfire newsletter: our summer webinar', date: '2026-06-15T15:00:00Z' });
    expect(skipped[0]!.uid).toBe('110');
  });

  it('a Test moves nothing and saves nothing', async () => {
    const env = makeEnv({ noSamples: true, extraSources: [alertSource] });
    mkdirSync(env.deps.alertImportDir, { recursive: true });
    writeFileSync(join(env.deps.alertImportDir, 'news.eml'), newsletter);
    await createPipeline(env.deps).testSource(env.store.getSource('email-alerts')!);
    expect(existsSync(join(env.deps.alertImportDir, 'news.eml'))).toBe(true);
    expect(env.store.getSourceState('email-alerts')).toEqual({});
  });
});

describe('POST /api/alerts/import', () => {
  it('reads a recognised alert at once and names its notices', async () => {
    const { app } = await harness();
    const res = await app.inject({ method: 'POST', url: '/api/alerts/import', ...multipart({}, { name: 'alert.eml', type: 'message/rfc822', content: bcbid }) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      ok: true,
      recognised: true,
      titles: ['Boulevard Mowing and Trimming Services', 'School Grounds Maintenance'],
      message: expect.stringMatching(/^Found 2 notices: “Boulevard Mowing and Trimming Services”, “School Grounds Maintenance”\./),
    });
  });

  it('says so when the e-mail is not recognised, and keeps it', async () => {
    const { app, deps } = await harness();
    const res = await app.inject({ method: 'POST', url: '/api/alerts/import', ...multipart({}, { name: 'news.eml', type: 'message/rfc822', content: newsletter }) });
    expect(res.json()).toMatchObject({ ok: true, recognised: false, titles: [], message: expect.stringMatching(/^Not recognised.*kept so it can be checked\.$/) });
    expect(readdirSync(deps.alertImportDir)).toHaveLength(1);
  });
});
