import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../src/server/contracts.js';
import { buildApp } from '../src/server/app.js';
import { createPipeline } from '../src/server/pipeline/run.js';
import { fakeScheduler } from './helpers/apiHarness.js';
import { makeEnv, type Env } from './helpers/pipelineEnv.js';

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

const apps: FastifyInstance[] = [];
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
});

async function setup(automation?: Record<string, unknown>): Promise<{ env: Env; app: FastifyInstance; requests: () => number }> {
  const env = makeEnv({ noSamples: true, automation });
  const requests = countRequests(env.deps);
  const app = await buildApp(env.deps, createPipeline(env.deps), fakeScheduler());
  apps.push(app);
  return { env, app, requests };
}

// An invented notice, pasted as the user would copy it from a portal page.
const NOTICE = [
  'Request for Quotation RFQ 26-201 – Park Mowing and Trimming',
  'The Sample Town of View Royal invites quotations for mowing, trimming and edging of municipal parks in View Royal, BC for the 2026 season.',
  'Quotations must be e-mailed to purchasing@viewroyal-sample.example no later than 2:00 PM on July 9, 2026.',
].join('\n\n');

describe('POST /api/opportunities/manual', () => {
  it('fills the closing date and reference from the pasted text, scores the bid and drafts it', async () => {
    const { env, app, requests } = await setup();
    const res = await app.inject({
      method: 'POST',
      url: '/api/opportunities/manual',
      payload: { title: 'Park Mowing and Trimming', buyer: 'Sample Town of View Royal', link: 'https://viewroyal-sample.example/bids/26-201', submissionMethod: 'unknown', text: NOTICE },
    });
    expect(res.statusCode).toBe(200);
    const opp = res.json();
    expect(opp).toMatchObject({
      sourceId: 'manual',
      organization: 'Sample Town of View Royal',
      referenceNumber: 'RFQ 26-201',
      closesAt: '2026-07-09T21:00:00Z',
      closesAtPrecision: 'datetime',
      decision: 'suitable',
      submissionMethod: 'email',
      submissionEmail: 'purchasing@viewroyal-sample.example',
    });
    expect(env.store.getApplicationByOpportunity(opp.id)).toBeDefined();
    // The link is kept, never opened.
    expect(requests()).toBe(0);
  });

  it('takes the closing date as typed (a date alone is the end of that day) and the chosen submission method', async () => {
    const { env, app } = await setup({ mode: 'discover' });
    const res = await app.inject({
      method: 'POST',
      url: '/api/opportunities/manual',
      payload: { title: 'Boulevard Garden Bed Maintenance', buyer: 'Sample Township of Esquimalt', closing: '2026-07-20', submissionMethod: 'bonfire', text: 'Garden bed maintenance and weeding of boulevards in Esquimalt, BC.' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ closesAt: '2026-07-21T06:59:59Z', closesAtPrecision: 'date', submissionMethod: 'bonfire' });
    // Discover mode only finds bids; nothing is drafted.
    expect(env.store.getApplicationByOpportunity(res.json().id)).toBeUndefined();
  });

  it('answers a bad request with a full sentence', async () => {
    const { app } = await setup();
    const short = await app.inject({ method: 'POST', url: '/api/opportunities/manual', payload: { title: 'x', buyer: 'Town' } });
    expect(short.statusCode).toBe(400);
    expect(short.json().error).toMatch(/\.$/);
    const link = await app.inject({ method: 'POST', url: '/api/opportunities/manual', payload: { title: 'Park mowing', buyer: 'Town', link: 'javascript:alert(1)' } });
    expect(link.statusCode).toBe(400);
    expect(link.json().error).toBe('The link must be a web address starting with http:// or https://.');
    const date = await app.inject({ method: 'POST', url: '/api/opportunities/manual', payload: { title: 'Park mowing', buyer: 'Town', closing: '2026-02-31' } });
    expect(date.statusCode).toBe(400);
    expect(date.json().error).toMatch(/is not a real date\./);
  });
});

describe('POST /api/opportunities/paste-alert', () => {
  const table =
    '<table><tr><th>Opportunity ID</th><th>Description</th><th>Organization</th><th>Closing Date</th></tr>' +
    '<tr><td>CS-2026-114</td><td><a href="https://bcbid.gov.bc.ca/page.aspx/en/bpm/process_manage_extranet/91234">Boulevard Mowing and Trimming Services</a></td><td>City of Langford</td><td>2026-07-09 2:00 PM</td></tr>' +
    '<tr><td>SD61-26-07</td><td><a href="https://bcbid.gov.bc.ca/page.aspx/en/bpm/process_manage_extranet/91240">School Grounds Maintenance</a></td><td>School District No. 61</td><td>2026-07-14 11:00 AM</td></tr></table>';

  it('reads the notices of a pasted alert without opening its links', async () => {
    const { env, app, requests } = await setup();
    const res = await app.inject({ method: 'POST', url: '/api/opportunities/paste-alert', payload: { html: table, sender: 'BC Bid <noreply@bcbid.gov.bc.ca>' } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ ok: true, recognised: true, found: 2 });
    expect(body.ids).toHaveLength(2);
    expect(body.message).toContain('“Boulevard Mowing and Trimming Services”');
    const langford = env.store.getOpportunity(body.ids[0]);
    expect(langford).toMatchObject({ organization: 'City of Langford', closesAt: '2026-07-09T21:00:00Z' });
    expect(requests()).toBe(0);
  });

  it('finds the sender in a forwarded alert, and says so when nothing can be read', async () => {
    const { app } = await setup();
    const forwarded = await app.inject({
      method: 'POST',
      url: '/api/opportunities/paste-alert',
      payload: { text: 'From: BC Bid <noreply@bcbid.gov.bc.ca>\nSubject: New opportunity\n\nBoulevard Mowing and Trimming Services\nhttps://bcbid.gov.bc.ca/page.aspx/en/bpm/process_manage_extranet/91234\nOrganization: City of Langford\nClosing Date: 2026-07-09 2:00 PM' },
    });
    expect(forwarded.json()).toMatchObject({ recognised: true, found: 1 });

    const nothing = await app.inject({ method: 'POST', url: '/api/opportunities/paste-alert', payload: { text: 'Hello, see you Tuesday.', sender: 'noreply@bcbid.gov.bc.ca' } });
    expect(nothing.statusCode).toBe(200);
    expect(nothing.json()).toMatchObject({ ok: false, recognised: false, found: 0 });

    const unknown = await app.inject({ method: 'POST', url: '/api/opportunities/paste-alert', payload: { text: 'Some text', sender: 'pat@friend.example' } });
    expect(unknown.statusCode).toBe(400);
    expect(unknown.json().error).toMatch(/^Please enter the address the alert came from.*\.$/);

    const empty = await app.inject({ method: 'POST', url: '/api/opportunities/paste-alert', payload: { sender: 'noreply@bcbid.gov.bc.ca' } });
    expect(empty.statusCode).toBe(400);
    expect(empty.json().error).toMatch(/Paste the alert e-mail first/);
  });
});
