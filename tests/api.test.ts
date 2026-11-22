import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Application, SourceRecord } from '../src/shared/schemas.js';
import { at, closeHarnesses, createApp, harness, HOUR, multipart, NOW, seedOpportunity, SOURCE_ID, type Harness } from './helpers/apiHarness.js';

// Every app and store opened by a test is closed after it.
afterEach(closeHarnesses);

describe('sign-in', () => {
  it('is open when no password is set', async () => {
    const { app } = await harness();
    const session = await app.inject({ method: 'GET', url: '/api/session' });
    expect(session.json()).toEqual({ authRequired: false, authenticated: true, demo: false });
    expect((await app.inject({ method: 'GET', url: '/api/sources' })).statusCode).toBe(200);
  });

  it('answers the health check without signing in', async () => {
    const { app } = await harness({ appPassword: 'secret-pass-123' });
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it('protects the API, signs in with a cookie and signs out', async () => {
    const { app } = await harness({ appPassword: 'correct horse' });
    expect((await app.inject({ method: 'GET', url: '/api/session' })).json()).toMatchObject({ authRequired: true, authenticated: false });
    const blocked = await app.inject({ method: 'GET', url: '/api/dashboard' });
    expect(blocked.statusCode).toBe(401);
    expect(blocked.json().error).toMatch(/sign in/i);

    const wrong = await app.inject({ method: 'POST', url: '/api/login', payload: { password: 'nope' } });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json().error).toBe('That password is not correct.');

    const ok = await app.inject({ method: 'POST', url: '/api/login', payload: { password: 'correct horse' } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ authRequired: true, authenticated: true });
    const cookie = ok.cookies.find((c) => c.name === 'lgbids_session')!;
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Strict', path: '/' });
    expect(cookie.value).toMatch(/^[0-9a-f]{64}$/);
    expect(new Date(cookie.expires!).getTime() - NOW.getTime()).toBe(30 * 24 * HOUR);

    const headers = { cookie: `lgbids_session=${cookie.value}` };
    expect((await app.inject({ method: 'GET', url: '/api/dashboard', headers })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/session', headers })).json().authenticated).toBe(true);

    const out = await app.inject({ method: 'POST', url: '/api/logout', headers });
    expect(out.json().authenticated).toBe(false);
    expect((await app.inject({ method: 'GET', url: '/api/dashboard', headers })).statusCode).toBe(401);
  });

  it('locks out an address after five wrong passwords', async () => {
    const { app } = await harness({ appPassword: 'secret' });
    for (let i = 0; i < 5; i++) {
      expect((await app.inject({ method: 'POST', url: '/api/login', payload: { password: `guess${i}` } })).statusCode).toBe(401);
    }
    const locked = await app.inject({ method: 'POST', url: '/api/login', payload: { password: 'secret' } });
    expect(locked.statusCode).toBe(429);
    expect(locked.json().error).toMatch(/Too many wrong passwords/);
  });

  it('refuses state-changing requests from another origin', async () => {
    const { app } = await harness();
    const foreign = await app.inject({ method: 'POST', url: '/api/runs', headers: { origin: 'https://evil.example' } });
    expect(foreign.statusCode).toBe(403);
    expect(foreign.json().error).toMatch(/another website/);
    const same = await app.inject({ method: 'POST', url: '/api/runs', headers: { origin: 'http://localhost:80', host: 'localhost:80' } });
    expect(same.statusCode).toBe(202);
    // Reading is fine from anywhere the browser allows.
    expect((await app.inject({ method: 'GET', url: '/api/session', headers: { origin: 'https://evil.example' } })).statusCode).toBe(200);
  });

  it('sets security headers on every response', async () => {
    const { app } = await harness();
    const res = await app.inject({ method: 'GET', url: '/api/session' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['referrer-policy']).toBe('same-origin');
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
  });
});

describe('profile and settings', () => {
  it('round-trips the profile and reports what is missing', async () => {
    const { app } = await harness();
    const before = await app.inject({ method: 'GET', url: '/api/profile' });
    expect(before.json().profile.province).toBe('BC');
    expect(before.json().missing.length).toBeGreaterThan(0);

    const saved = await app.inject({ method: 'PUT', url: '/api/profile', payload: { ...before.json().profile, legalName: 'Garry Oak Gardens Ltd.', email: 'bids@garryoak.example' } });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().profile.legalName).toBe('Garry Oak Gardens Ltd.');
    expect(Array.isArray(saved.json().missing)).toBe(true);
    expect((await app.inject({ method: 'GET', url: '/api/profile' })).json().profile.legalName).toBe('Garry Oak Gardens Ltd.');
  });

  it('answers a validation error with a sentence naming the field', async () => {
    const { app } = await harness();
    const res = await app.inject({ method: 'PUT', url: '/api/profile', payload: { legalName: 'x'.repeat(300) } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/^Please check “legalName”: .+\.$/);
    const bad = await app.inject({ method: 'PUT', url: '/api/profile', headers: { 'content-type': 'application/json' }, payload: '{nope' });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toBe('The request body is not valid JSON.');
  });

  it('saves automation and region settings and reschedules', async () => {
    const { app, scheduler } = await harness();
    const automation = (await app.inject({ method: 'GET', url: '/api/settings/automation' })).json();
    expect(automation.mode).toBe('prepare');
    const put = await app.inject({ method: 'PUT', url: '/api/settings/automation', payload: { ...automation, mode: 'discover', intervalHours: 12 } });
    expect(put.json()).toMatchObject({ mode: 'discover', intervalHours: 12 });
    expect(scheduler.reschedules).toBe(1);
    const invalid = await app.inject({ method: 'PUT', url: '/api/settings/automation', payload: { mode: 'yolo' } });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().error).toContain('“mode”');

    const region = (await app.inject({ method: 'GET', url: '/api/settings/region' })).json();
    expect(region.places.length).toBeGreaterThan(5);
    const custom = await app.inject({ method: 'PUT', url: '/api/settings/region', payload: { places: ['Saanich'], excludePlaces: [], organizations: [] } });
    expect(custom.json().places).toEqual(['Saanich']);
    const reset = await app.inject({ method: 'POST', url: '/api/settings/region/reset' });
    expect(reset.json().places.length).toBe(region.places.length);
    expect(scheduler.reschedules).toBe(3);
  });

  it('saves the bid alert inbox without ever returning its password, and tests the connection', async () => {
    let opened: { user: string; pass: string; folder: string } | null = null;
    let fail = false;
    const { app } = await harness({}, undefined, {
      alertMailboxFactory: (inbox) => {
        opened = { user: inbox.user, pass: inbox.pass, folder: inbox.folder };
        return {
          fetchNew: async () => ({ messages: [], position: null }),
          test: async () => {
            if (fail) throw new Error('The mail server did not accept the user name and password. For Gmail, use an app password, not your normal password.');
            return { count: 3 };
          },
        };
      },
    });
    const notSet = await app.inject({ method: 'POST', url: '/api/settings/alert-inbox/test' });
    expect(notSet.json()).toMatchObject({ ok: false });
    expect((await app.inject({ method: 'GET', url: '/api/settings/alert-inbox' })).json()).toMatchObject({ host: 'imap.gmail.com', port: 993, secure: true, folder: 'INBOX', hasPassword: false });

    const saved = await app.inject({ method: 'PUT', url: '/api/settings/alert-inbox', payload: { user: 'bids@garryoak.example', pass: 'abcd efgh ijkl mnop', folder: 'Bid alerts' } });
    expect(saved.statusCode).toBe(200);
    expect(saved.body).not.toContain('abcd');
    expect(saved.json()).toMatchObject({ hasPassword: true, folder: 'Bid alerts' });
    const sources = (await app.inject({ method: 'GET', url: '/api/sources' })).json() as { id: string; enabled: boolean }[];
    expect(sources.find((s) => s.id === 'email-alerts')?.enabled).toBe(true);

    // An empty password keeps the saved one.
    await app.inject({ method: 'PUT', url: '/api/settings/alert-inbox', payload: { user: 'bids@garryoak.example', pass: '', folder: 'Bid alerts' } });
    const ok = await app.inject({ method: 'POST', url: '/api/settings/alert-inbox/test' });
    expect(ok.json()).toEqual({ ok: true, message: 'Connected. Found 3 alert e-mails from BC Bid or Bonfire in “Bid alerts” from the last 30 days.' });
    expect(opened).toEqual({ user: 'bids@garryoak.example', pass: 'abcd efgh ijkl mnop', folder: 'Bid alerts' });
    expect((await app.inject({ method: 'GET', url: '/api/settings/alert-inbox' })).json().verifiedAt).not.toBeNull();

    fail = true;
    const bad = await app.inject({ method: 'POST', url: '/api/settings/alert-inbox/test' });
    expect(bad.json()).toMatchObject({ ok: false, message: expect.stringContaining('app password') });
  });

  it('imports a saved alert e-mail under a generated name and rejects other files', async () => {
    const { app, deps } = await harness();
    const eml = Buffer.from('From: BC Bid <noreply@bcbid.gov.bc.ca>\r\nSubject: New opportunity\r\nDate: Mon, 15 Jun 2026 08:00:00 -0700\r\n\r\nHello\r\n');
    const ok = await app.inject({ method: 'POST', url: '/api/alerts/import', ...multipart({}, { name: '../../evil.eml', type: 'message/rfc822', content: eml }) });
    expect(ok.statusCode).toBe(200);
    const saved = readdirSync(deps.alertImportDir);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatch(/^\d+-[0-9a-f]{12}\.eml$/);
    const pdf = await app.inject({ method: 'POST', url: '/api/alerts/import', ...multipart({}, { name: 'notice.pdf', type: 'application/pdf', content: Buffer.from('%PDF-1.4') }) });
    expect(pdf.statusCode).toBe(400);
    const notMail = await app.inject({ method: 'POST', url: '/api/alerts/import', ...multipart({}, { name: 'x.eml', type: 'message/rfc822', content: Buffer.from('just text') }) });
    expect(notMail.json().error).toBe('This file does not look like a saved e-mail.');
  });

  it('never returns the SMTP password and keeps it when the field is left empty', async () => {
    const { app, deps } = await harness();
    const email = { host: 'smtp.example', port: 587, secure: false, user: 'me', pass: 's3cret', fromName: 'Garry Oak', fromEmail: 'bids@garryoak.example', replyTo: '', bccSelf: true };
    const saved = await app.inject({ method: 'PUT', url: '/api/settings/email', payload: email });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).not.toHaveProperty('pass');
    expect(saved.json()).toMatchObject({ hasPassword: true, host: 'smtp.example', fromEnvironment: expect.any(Array) });
    expect(saved.body).not.toContain('s3cret');

    const kept = await app.inject({ method: 'PUT', url: '/api/settings/email', payload: { ...email, pass: '', fromName: 'Garry Oak Gardens' } });
    expect(kept.json()).toMatchObject({ hasPassword: true, fromName: 'Garry Oak Gardens' });
    expect(deps.settings.getEmail().pass).toBe('s3cret');
    expect((await app.inject({ method: 'GET', url: '/api/settings/email' })).body).not.toContain('s3cret');

    const badFrom = await app.inject({ method: 'PUT', url: '/api/settings/email', payload: { ...email, fromEmail: 'not an address' } });
    expect(badFrom.statusCode).toBe(400);
  });

  it('sends a test e-mail and stamps the settings as verified', async () => {
    const { app, sent, deps } = await harness();
    const notSet = await app.inject({ method: 'POST', url: '/api/settings/email/test', payload: {} });
    expect(notSet.json()).toMatchObject({ ok: false });

    await app.inject({ method: 'PUT', url: '/api/settings/email', payload: { host: 'smtp.example', port: 587, user: 'me', pass: 'pw', fromEmail: 'bids@garryoak.example' } });
    const res = await app.inject({ method: 'POST', url: '/api/settings/email/test', payload: { to: 'owner@garryoak.example' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toEqual(['owner@garryoak.example']);
    expect(deps.settings.getEmail().verifiedAt).toBe('2026-06-15T20:00:00Z');
    expect(deps.settings.getEmail().pass).toBe('pw');
  });

  it('reports a failed e-mail test as a sentence with HTTP 200', async () => {
    const { app } = await harness({}, { verify: async () => Promise.reject(new Error('Could not connect to the mail server at smtp.example:587. Check the host name and port.')) });
    await app.inject({ method: 'PUT', url: '/api/settings/email', payload: { host: 'smtp.example', port: 587, fromEmail: 'bids@garryoak.example' } });
    const res = await app.inject({ method: 'POST', url: '/api/settings/email/test' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: false, message: 'Could not connect to the mail server at smtp.example:587. Check the host name and port.' });
  });
});

describe('sources', () => {
  it('creates, edits, tests and deletes a source', async () => {
    const { app, pipeline } = await harness();
    const list = (await app.inject({ method: 'GET', url: '/api/sources' })).json() as SourceRecord[];
    expect(list.some((s) => s.builtin)).toBe(true);

    const created = await app.inject({
      method: 'POST',
      url: '/api/sources',
      payload: { name: 'Town of Example bids', kind: 'html_list', config: { url: 'https://town.example/bids', linkPattern: '^/bids/' } },
    });
    expect(created.statusCode).toBe(200);
    const source = created.json() as SourceRecord;
    expect(source.id).toMatch(/^town-of-example-bids-[0-9a-f]{6}$/);
    expect(source).toMatchObject({ builtin: false, enabled: true });

    const patched = await app.inject({ method: 'PATCH', url: `/api/sources/${source.id}`, payload: { enabled: false, config: { maxPages: 3 } } });
    expect(patched.json()).toMatchObject({ enabled: false, config: { maxPages: 3, url: 'https://town.example/bids', linkPattern: '^/bids/' } });

    const tested = await app.inject({ method: 'POST', url: `/api/sources/${source.id}/test` });
    expect(tested.json()).toMatchObject({ status: 'ok', count: 1 });
    const unsaved = await app.inject({ method: 'POST', url: '/api/sources/test', payload: { name: 'Trial', kind: 'rss', config: { url: 'https://town.example/feed.xml' } } });
    expect(unsaved.statusCode).toBe(200);
    const tried = pipeline.calls.filter((c) => c.method === 'testSource').map((c) => (c.args[0] as SourceRecord).name);
    expect(tried).toEqual(['Town of Example bids', 'Trial']);

    expect((await app.inject({ method: 'DELETE', url: `/api/sources/${source.id}` })).json()).toEqual({ ok: true });
    expect((await app.inject({ method: 'DELETE', url: `/api/sources/${source.id}` })).statusCode).toBe(404);
  });

  it('refuses to delete a built-in source and rejects bad input', async () => {
    const { app, deps } = await harness();
    const builtin = deps.store.listSources().find((s) => s.builtin)!;
    const del = await app.inject({ method: 'DELETE', url: `/api/sources/${builtin.id}` });
    expect(del.statusCode).toBe(409);
    expect(del.json().error).toBe('Built-in sources can be switched off but not deleted.');

    const regex = await app.inject({ method: 'POST', url: '/api/sources', payload: { name: 'Bad', kind: 'html_list', config: { url: 'https://x.example/', linkPattern: '([' } } });
    expect(regex.statusCode).toBe(400);
    expect(regex.json().error).toMatch(/not a valid regular expression/);
    const scheme = await app.inject({ method: 'POST', url: '/api/sources', payload: { name: 'Bad', kind: 'rss', config: { url: 'ftp://x.example/feed' } } });
    expect(scheme.statusCode).toBe(400);
    expect(scheme.json().error).toMatch(/http/);
    const name = await app.inject({ method: 'POST', url: '/api/sources', payload: { name: '', kind: 'rss' } });
    expect(name.statusCode).toBe(400);
    expect(name.json().error).toContain('“name”');
  });
});

describe('documents', () => {
  it('uploads, lists, downloads, edits and deletes a library document', async () => {
    const { app } = await harness();
    const form = multipart(
      { name: 'Liability certificate', kind: 'insurance', expiresOn: '2027-03-31', attachByDefault: 'true' },
      { name: '../../etc/Certificate\u0007 2026.pdf', type: 'application/pdf', content: Buffer.from('%PDF-1.4 insurance') },
    );
    const up = await app.inject({ method: 'POST', url: '/api/documents', ...form });
    expect(up.statusCode).toBe(200);
    const doc = up.json();
    expect(doc).toMatchObject({ name: 'Liability certificate', kind: 'insurance', filename: 'Certificate 2026.pdf', expiresOn: '2027-03-31', attachByDefault: true, size: 18 });

    expect((await app.inject({ method: 'GET', url: '/api/documents' })).json()).toHaveLength(1);
    const down = await app.inject({ method: 'GET', url: `/api/documents/${doc.id}/download` });
    expect(down.body).toBe('%PDF-1.4 insurance');
    expect(down.headers['content-disposition']).toMatch(/^attachment; filename="Certificate 2026\.pdf"/);
    expect(down.headers['x-content-type-options']).toBe('nosniff');

    const patched = await app.inject({ method: 'PATCH', url: `/api/documents/${doc.id}`, payload: { attachByDefault: false, expiresOn: '' } });
    expect(patched.json()).toMatchObject({ attachByDefault: false, expiresOn: '' });

    expect((await app.inject({ method: 'DELETE', url: `/api/documents/${doc.id}` })).json()).toEqual({ ok: true });
    expect((await app.inject({ method: 'GET', url: `/api/documents/${doc.id}/download` })).statusCode).toBe(404);
  });

  it('rejects uploads without a file or with a bad kind', async () => {
    const { app } = await harness();
    const none = await app.inject({ method: 'POST', url: '/api/documents', ...multipart({ name: 'x' }) });
    expect(none.statusCode).toBe(400);
    expect(none.json().error).toBe('Please choose a file to upload.');
    const kind = await app.inject({ method: 'POST', url: '/api/documents', ...multipart({ kind: 'secret' }, { name: 'a.pdf', type: 'application/pdf', content: Buffer.from('x') }) });
    expect(kind.statusCode).toBe(400);
    const json = await app.inject({ method: 'POST', url: '/api/documents', payload: { file: 'x' } });
    expect(json.statusCode).toBe(400);
  });
});

describe('applications', () => {
  let h: Harness;
  let oppId: number;
  let appId: number;

  beforeEach(async () => {
    h = await harness();
    oppId = seedOpportunity(h.deps, { title: 'Park Mowing Services' });
    appId = createApp(h.deps, oppId).id;
  });

  it('lists and reads applications with their opportunity', async () => {
    const list = await h.app.inject({ method: 'GET', url: '/api/applications?status=ready,needs_input' });
    expect(list.json()).toHaveLength(1);
    expect(list.json()[0].opportunity.title).toBe('Park Mowing Services');
    expect((await h.app.inject({ method: 'GET', url: '/api/applications?status=submitted' })).json()).toHaveLength(0);
    expect((await h.app.inject({ method: 'GET', url: '/api/applications?status=bogus' })).statusCode).toBe(400);
    expect((await h.app.inject({ method: 'GET', url: `/api/applications/${appId}` })).json().opportunity.id).toBe(oppId);
    expect((await h.app.inject({ method: 'GET', url: '/api/applications/9999' })).statusCode).toBe(404);
    expect((await h.app.inject({ method: 'GET', url: '/api/applications/abc' })).statusCode).toBe(404);
  });

  it('applies an edit, ticks checklist items by key and reassesses', async () => {
    const res = await h.app.inject({
      method: 'PATCH',
      url: `/api/applications/${appId}`,
      payload: { subject: 'Quotation for park mowing', priceTotal: 12500, checklist: [{ key: 'forms', done: true }, { key: 'unknown', done: true }] },
    });
    expect(res.statusCode).toBe(200);
    const updated = res.json() as Application;
    expect(updated).toMatchObject({ subject: 'Quotation for park mowing', priceTotal: 12500, editedByUser: true });
    expect(updated.checklist.map((c) => [c.key, c.done])).toEqual([
      ['forms', true],
      ['site_meeting', false],
    ]);
    expect(updated.checklist[0]!.label).toBe('Sign the bid form');
    expect(h.pipeline.calls.filter((c) => c.method === 'reassess').map((c) => c.args[0])).toEqual([appId]);

    const priceOnly = await h.app.inject({ method: 'PATCH', url: `/api/applications/${appId}`, payload: { priceNotes: 'Includes GST.' } });
    expect(priceOnly.json().priceNotes).toBe('Includes GST.');
  });

  it('does not flag an edit when only the price changed', async () => {
    const res = await h.app.inject({ method: 'PATCH', url: `/api/applications/${appId}`, payload: { priceTotal: 100, subject: 'Quotation: Park mowing' } });
    expect(res.json().editedByUser).toBe(false);
  });

  it('validates addresses and refuses edits in a closed state', async () => {
    const bad = await h.app.inject({ method: 'PATCH', url: `/api/applications/${appId}`, payload: { toEmail: 'not-an-address' } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toMatch(/not a valid e-mail address/);
    const cc = await h.app.inject({ method: 'PATCH', url: `/api/applications/${appId}`, payload: { ccEmail: 'a@town.example, b@town.example' } });
    expect(cc.statusCode).toBe(200);

    h.deps.store.transitionApplication(appId, ['ready'], 'submitted', NOW);
    const locked = await h.app.inject({ method: 'PATCH', url: `/api/applications/${appId}`, payload: { subject: 'Changed' } });
    expect(locked.statusCode).toBe(409);
    expect((await h.app.inject({ method: 'POST', url: `/api/applications/${appId}/regenerate` })).statusCode).toBe(409);
  });

  it('regenerates through the pipeline', async () => {
    const res = await h.app.inject({ method: 'POST', url: `/api/applications/${appId}/regenerate` });
    expect(res.statusCode).toBe(200);
    expect(h.pipeline.calls.find((c) => c.method === 'draftFor')!.args).toEqual([oppId, { rebuild: true }]);
  });

  it('maps send results to the fresh application or a 409 with the reason', async () => {
    h.pipeline.sendResult = { ok: false, error: 'Outgoing e-mail is not set up yet.' };
    const refused = await h.app.inject({ method: 'POST', url: `/api/applications/${appId}/send` });
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toEqual({ error: 'Outgoing e-mail is not set up yet.' });

    h.pipeline.sendResult = { ok: true, error: '' };
    const sent = await h.app.inject({ method: 'POST', url: `/api/applications/${appId}/send` });
    expect(sent.statusCode).toBe(200);
    expect(sent.json().status).toBe('submitted');
    expect(h.pipeline.calls.filter((c) => c.method === 'send').map((c) => c.args)).toEqual([
      [appId, { auto: false }],
      [appId, { auto: false }],
    ]);
  });

  it('marks a portal submission as submitted, once', async () => {
    h.deps.store.updateApplication(appId, { notes: 'Earlier note.' }, NOW);
    const res = await h.app.inject({ method: 'POST', url: `/api/applications/${appId}/mark-submitted`, payload: { ref: 'BF-12345', note: 'Uploaded to Bonfire.' } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      status: 'submitted',
      submittedAt: '2026-06-15T20:00:00Z',
      submittedVia: 'portal',
      submissionRef: 'BF-12345',
      notes: 'Earlier note.\n\nUploaded to Bonfire.',
    });
    expect(h.deps.store.listEvents(10).some((e) => e.kind === 'application_submitted' && e.applicationId === appId)).toBe(true);
    expect((await h.app.inject({ method: 'POST', url: `/api/applications/${appId}/mark-submitted`, payload: {} })).statusCode).toBe(409);
    const longVia = await h.app.inject({ method: 'POST', url: `/api/applications/${appId}/mark-submitted`, payload: { via: 'x'.repeat(81) } });
    expect(longVia.statusCode).toBe(400);
  });

  it('allows only sensible status changes', async () => {
    const post = (status: string) => h.app.inject({ method: 'POST', url: `/api/applications/${appId}/status`, payload: { status } });
    expect((await post('won')).statusCode).toBe(409);
    expect((await post('withdrawn')).json().status).toBe('withdrawn');
    expect((await post('withdrawn')).statusCode).toBe(409);

    const reopened = await post('needs_input');
    expect(reopened.json().status).toBe('needs_input');
    expect(h.pipeline.calls.some((c) => c.method === 'reassess' && c.args[0] === appId)).toBe(true);

    h.deps.store.transitionApplication(appId, ['needs_input'], 'submitted', NOW);
    expect((await post('lost')).json().status).toBe('lost');
    // UX-5: a result can be corrected (lost <-> won) and undone back to submitted.
    expect((await post('won')).json().status).toBe('won');
    expect((await post('submitted')).json().status).toBe('submitted');
    expect((await post('bogus')).statusCode).toBe(400);
  });

  it('does not reopen an application whose opportunity has closed', async () => {
    const closedOpp = seedOpportunity(h.deps, { title: 'Closed Mowing', closesAt: at(-48) });
    const closedApp = createApp(h.deps, closedOpp, 'expired');
    const res = await h.app.inject({ method: 'POST', url: `/api/applications/${closedApp.id}/status`, payload: { status: 'needs_input' } });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatch(/closed/);
  });

  it('serves the package PDF inline', async () => {
    const res = await h.app.inject({ method: 'GET', url: `/api/applications/${appId}/package.pdf` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toMatch(/^inline; filename="Application \d+\.pdf"/);
    expect(res.body.startsWith('%PDF')).toBe(true);
  });

  it('uploads, downloads and deletes files on an application', async () => {
    const form = multipart({}, { name: 'Signed bid form – é.pdf', type: 'application/pdf', content: Buffer.from('%PDF signed') });
    const up = await h.app.inject({ method: 'POST', url: `/api/applications/${appId}/files`, ...form });
    expect(up.statusCode).toBe(200);
    const files = (up.json() as Application).files;
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({ name: 'Signed bid form – é.pdf', size: 11 });

    const down = await h.app.inject({ method: 'GET', url: `/api/applications/${appId}/files/${files[0]!.id}` });
    expect(down.body).toBe('%PDF signed');
    expect(down.headers['content-disposition']).toBe(`attachment; filename="Signed bid form  e.pdf"; filename*=UTF-8''Signed%20bid%20form%20%E2%80%93%20%C3%A9.pdf`);

    const del = await h.app.inject({ method: 'DELETE', url: `/api/applications/${appId}/files/${files[0]!.id}` });
    expect(del.json().files).toHaveLength(0);
    expect((await h.app.inject({ method: 'GET', url: `/api/applications/${appId}/files/${files[0]!.id}` })).statusCode).toBe(404);
  });

  it('refuses files over 25 MB', async () => {
    const big = multipart({}, { name: 'huge.pdf', type: 'application/pdf', content: Buffer.alloc(25 * 1024 * 1024 + 10, 1) });
    const res = await h.app.inject({ method: 'POST', url: `/api/applications/${appId}/files`, ...big });
    expect(res.statusCode).toBe(413);
    expect(res.json().error).toMatch(/25 MB/);
  });
});

describe('opportunities', () => {
  it('filters by closing window', async () => {
    const { app, deps } = await harness();
    seedOpportunity(deps, { title: 'Closes in 3 days', closesAt: at(24 * 3) });
    seedOpportunity(deps, { title: 'Closes in 12 days', closesAt: at(24 * 12) });
    seedOpportunity(deps, { title: 'No closing date', closesAt: null });
    const week = (await app.inject({ method: 'GET', url: '/api/opportunities?view=suitable&closingWithinDays=7' })).json();
    expect(week.items.map((o: { title: string }) => o.title)).toEqual(['Closes in 3 days']);
    const twoWeeks = (await app.inject({ method: 'GET', url: '/api/opportunities?view=suitable&closingWithinDays=14' })).json();
    expect(twoWeeks.total).toBe(2);
    const any = (await app.inject({ method: 'GET', url: '/api/opportunities?view=suitable' })).json();
    expect(any.total).toBe(3);
  });

  it('lists by view with counts and filters by text', async () => {
    const { app, deps } = await harness();
    seedOpportunity(deps, { title: 'Boulevard Mowing' });
    seedOpportunity(deps, { title: 'Sewer Relining', decision: 'unsuitable' });
    seedOpportunity(deps, { title: 'Garden Bed Care', decision: 'review' });

    const suitable = (await app.inject({ method: 'GET', url: '/api/opportunities?view=suitable' })).json();
    expect(suitable.items.map((o: { title: string }) => o.title)).toEqual(['Boulevard Mowing']);
    expect(suitable.total).toBe(1);
    expect(suitable.counts).toMatchObject({ suitable: 1, review: 1, unsuitable: 1, all: 3 });
    expect(suitable.items[0]).not.toHaveProperty('documentText');

    const search = (await app.inject({ method: 'GET', url: '/api/opportunities?q=garden' })).json();
    expect(search.items.map((o: { title: string }) => o.title)).toEqual(['Garden Bed Care']);
    expect((await app.inject({ method: 'GET', url: '/api/opportunities?view=nope' })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/api/opportunities/424242' })).statusCode).toBe(404);
  });

  it('pursues (drafting an application), dismisses (withdrawing it) and clears decisions', async () => {
    const { app, deps, pipeline } = await harness();
    const id = seedOpportunity(deps, { title: 'Garden Bed Care', decision: 'review' });

    const pursued = await app.inject({ method: 'POST', url: `/api/opportunities/${id}/decision`, payload: { decision: 'pursue' } });
    expect(pursued.statusCode).toBe(200);
    expect(pursued.json()).toMatchObject({ userDecision: 'pursue', analysis: { alsoListed: [] } });
    expect(pipeline.calls.find((c) => c.method === 'draftFor')!.args).toEqual([id, { rebuild: false }]);
    const application = deps.store.getApplicationByOpportunity(id)!;

    const dismissed = await app.inject({ method: 'POST', url: `/api/opportunities/${id}/decision`, payload: { decision: 'dismissed' } });
    expect(dismissed.json().userDecision).toBe('dismissed');
    expect(deps.store.getApplication(application.id)!.status).toBe('withdrawn');

    const cleared = await app.inject({ method: 'POST', url: `/api/opportunities/${id}/decision`, payload: { decision: null } });
    expect(cleared.json().userDecision).toBeNull();
    expect((await app.inject({ method: 'POST', url: `/api/opportunities/${id}/decision`, payload: { decision: 'maybe' } })).statusCode).toBe(400);
  });
});

describe('opportunities spreadsheet', () => {
  it('downloads every match of the current filters as an Excel-friendly CSV', async () => {
    const { app, deps } = await harness();
    seedOpportunity(deps, { title: 'Boulevard mowing, phase 2', closesAt: at(24 * 3) });
    seedOpportunity(deps, { title: '=HYPERLINK("https://evil.example")', closesAt: at(24 * 12) });
    seedOpportunity(deps, { title: 'Snow clearing', decision: 'unsuitable' });

    const res = await app.inject({ method: 'GET', url: '/api/opportunities.csv?view=suitable' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    // NOW is 1 PM on June 15 in Victoria.
    expect(res.headers['content-disposition']).toBe('attachment; filename="lgbids-opportunities-2026-06-15.csv"');
    expect(res.rawPayload.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
    const lines = res.body.replace(/^\uFEFF/, '').trimEnd().split('\r\n');
    expect(lines[0]).toBe('Title,Buyer,Source,Reference,Type,Decision,Score,Closes,Submission,Link,First seen');
    expect(lines).toHaveLength(3);
    expect(res.body).toContain('"Boulevard mowing, phase 2",District of Saanich,Test source,RFQ 26-1,');
    expect(res.body).toContain(`"'=HYPERLINK(""https://evil.example"")"`);
    expect(res.body).not.toContain('Snow clearing');

    // The same filters as the list on screen.
    const week = await app.inject({ method: 'GET', url: '/api/opportunities.csv?view=suitable&closingWithinDays=7&q=boulevard' });
    expect(week.body.trimEnd().split('\r\n')).toHaveLength(2);
    const other = await app.inject({ method: 'GET', url: '/api/opportunities.csv?view=all&sourceId=nowhere' });
    expect(other.body.trimEnd().split('\r\n')).toHaveLength(1);
    expect((await app.inject({ method: 'GET', url: '/api/opportunities.csv?view=nonsense' })).statusCode).toBe(400);
  });

  it('needs sign-in like the rest of the API', async () => {
    const { app } = await harness({ appPassword: 'secret' });
    expect((await app.inject({ method: 'GET', url: '/api/opportunities.csv' })).statusCode).toBe(401);
  });
});

describe('source layout warning', () => {
  it('is returned with the source and cleared by a test that lists notices', async () => {
    const { app, deps } = await harness();
    deps.store.recordSourceRun(SOURCE_ID, { status: 'ok', message: '', itemCount: 6 }, NOW);
    const raised = deps.store.recordSourceRun(SOURCE_ID, { status: 'empty', message: 'Nothing is listed right now.', itemCount: 0 }, NOW);
    expect(raised.raised).toBe(true);
    const listed = (await app.inject({ method: 'GET', url: '/api/sources' })).json() as SourceRecord[];
    expect(listed.find((s) => s.id === SOURCE_ID)!.layoutWarning).toMatch(/listed 6 notices last time — its layout may have changed/);

    expect((await app.inject({ method: 'POST', url: `/api/sources/${SOURCE_ID}/test` })).statusCode).toBe(200);
    expect(deps.store.getSource(SOURCE_ID)!.layoutWarning).toBe('');
  });
});

describe('runs, events and calendar', () => {
  it('starts a run without waiting and refuses a second one', async () => {
    const { app, pipeline } = await harness();
    const started = await app.inject({ method: 'POST', url: '/api/runs' });
    expect(started.statusCode).toBe(202);
    expect(started.json().running).toBe(true);
    expect(pipeline.calls.filter((c) => c.method === 'run').map((c) => c.args[0])).toEqual(['manual']);

    pipeline.running = true;
    const again = await app.inject({ method: 'POST', url: '/api/runs' });
    expect(again.statusCode).toBe(409);
    expect(again.json().error).toMatch(/already running/);

    const current = (await app.inject({ method: 'GET', url: '/api/runs/current' })).json();
    expect(current).toMatchObject({ running: true, run: { trigger: 'manual' } });
    expect((await app.inject({ method: 'GET', url: '/api/runs' })).json()).toHaveLength(1);
    expect(Array.isArray((await app.inject({ method: 'GET', url: '/api/events?limit=5' })).json())).toBe(true);
  });

  it('exports closing dates as an iCalendar file', async () => {
    const { app, deps } = await harness();
    const timed = seedOpportunity(deps, { title: 'Boulevard Mowing; Trimming, and Edging of Parks in the District of Saanich — 2026 season', closesAt: '2026-06-25T21:00:00Z' });
    const dated = seedOpportunity(deps, { title: 'Hanging Baskets', closesAt: '2026-07-03T06:59:59Z', precision: 'date' });
    seedOpportunity(deps, { title: 'Open-ended', closesAt: null });
    seedOpportunity(deps, { title: 'Sewer Relining', decision: 'unsuitable' });

    const res = await app.inject({ method: 'GET', url: '/api/calendar.ics' });
    expect(res.headers['content-type']).toBe('text/calendar; charset=utf-8');
    const body = res.body;
    expect(body.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true);
    expect(body.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(body.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(body).toContain(`UID:opportunity-${timed}@lgbids`);
    expect(body).toContain('DTSTART:20260625T210000Z');
    expect(body).toContain(`UID:opportunity-${dated}@lgbids`);
    expect(body).toContain('DTSTART;VALUE=DATE:20260702');
    expect(body).toContain('DTEND;VALUE=DATE:20260703');
    const unfolded = body.replace(/\r\n /g, '');
    expect(unfolded).toContain('SUMMARY:Bid closes: Boulevard Mowing\\; Trimming\\, and Edging');
    for (const line of body.split('\r\n')) expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75);

    // One bid, whatever its view; a bid without a closing date or an unknown id is refused.
    const one = await app.inject({ method: 'GET', url: `/api/calendar.ics?id=${dated}` });
    expect(one.body.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(one.body).toContain(`UID:opportunity-${dated}@lgbids`);
    expect(one.headers['content-disposition']).toContain(`lgbids-bid-${dated}.ics`);
    const openEnded = deps.store.listOpportunities({ view: 'all', q: 'Open-ended' }, NOW).items[0]!.id;
    expect((await app.inject({ method: 'GET', url: `/api/calendar.ics?id=${openEnded}` })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/api/calendar.ics?id=999999' })).statusCode).toBe(404);
  });
});

describe('dashboard', () => {
  it('summarises the state of things', async () => {
    const { app, deps } = await harness();
    const soon = seedOpportunity(deps, { title: 'Closing Soon Mowing', closesAt: at(48) });
    seedOpportunity(deps, { title: 'Later Mowing', closesAt: at(24 * 20) });
    seedOpportunity(deps, { title: 'Garden Review', decision: 'review' });
    createApp(deps, soon, 'needs_input');

    const res = await app.inject({ method: 'GET', url: '/api/dashboard' });
    expect(res.statusCode).toBe(200);
    const d = res.json();
    expect(d).toMatchObject({
      mode: 'prepare',
      running: false,
      lastRun: null,
      nextRunAt: at(6),
      demo: false,
      timeZone: 'America/Vancouver',
      counts: { openSuitable: 2, review: 1, needsInput: 1, ready: 0, submitted: 0, closingSoon: 1, sourcesFailing: 0 },
    });
    expect(d.counts.sourcesEnabled).toBeGreaterThan(1);
    expect(d.attention.map((a: Application) => a.opportunityId)).toEqual([soon]);
    expect(d.deadlines.map((o: { title: string }) => o.title)).toEqual(['Closing Soon Mowing', 'Later Mowing']);
    expect(d.setup.map((s: { key: string; done: boolean }) => [s.key, s.done])).toEqual([
      ['profile', false],
      ['alerts', false],
      ['services', false],
      ['email', false],
      ['documents', false],
      ['run', false],
      ['push', false],
    ]);
    expect(d.sources.filter((s: { enabled: boolean }) => s.enabled).length).toBe(d.counts.sourcesEnabled);
  });
});

describe('web UI', () => {
  it('explains that the UI is not built when there is no web folder', async () => {
    const { app } = await harness();
    const res = await app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/plain/);
    expect(res.body).toContain('npm run build');
    const missing = await app.inject({ method: 'GET', url: '/api/nothing-here' });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error).toBe('There is nothing at this address.');
  });

  it('serves the built files and falls back to index.html for client routes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lgbids-web-'));
    try {
      writeFileSync(join(dir, 'index.html'), '<!doctype html><title>Lgbids</title><div id="root"></div>');
      writeFileSync(join(dir, 'manifest.webmanifest'), '{"display":"standalone"}');
      const { app } = await harness({ webDir: dir });
      const index = await app.inject({ method: 'GET', url: '/' });
      expect(index.body).toContain('<div id="root">');
      expect((await app.inject({ method: 'GET', url: '/manifest.webmanifest' })).body).toContain('standalone');
      const route = await app.inject({ method: 'GET', url: '/opportunities/12' });
      expect(route.statusCode).toBe(200);
      expect(route.headers['content-type']).toMatch(/^text\/html/);
      expect(route.body).toContain('<div id="root">');
      const api = await app.inject({ method: 'GET', url: '/api/nope' });
      expect(api.statusCode).toBe(404);
      expect(api.headers['content-type']).toMatch(/json/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
