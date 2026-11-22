import { afterEach, describe, expect, it } from 'vitest';
import { allowedHosts, loadConfig, trustProxy } from '../src/server/config.js';
import { buildApp } from '../src/server/app.js';
import { PASSWORD_FINGERPRINT_KEY, SESSION_COOKIE, sessionKey, weakPasswordWarning } from '../src/server/routes/auth.js';
import { closeHarnesses, harness, multipart, NOW } from './helpers/apiHarness.js';

afterEach(closeHarnesses);

describe('host allowlist (DNS rebinding)', () => {
  it('refuses an unknown Host on API reads and writes when bound to loopback', async () => {
    const { app, deps } = await harness();
    const read = await app.inject({ method: 'GET', url: '/api/settings/automation', headers: { host: 'attacker.example:3000' } });
    expect(read.statusCode).toBe(403);
    expect(read.json().error).toMatch(/does not answer to that address/);
    const body = deps.settings.getAutomation();
    const write = await app.inject({ method: 'PUT', url: '/api/settings/automation', headers: { host: 'attacker.example:3000' }, payload: body });
    expect(write.statusCode).toBe(403);
  });

  it('refuses an unknown Host on non-API routes too', async () => {
    const { app } = await harness();
    const page = await app.inject({ method: 'GET', url: '/', headers: { host: 'attacker.example' } });
    expect(page.statusCode).toBe(403);
  });

  it('answers to localhost, 127.0.0.1 and [::1], and to the default inject host', async () => {
    const { app } = await harness();
    for (const host of ['localhost:3000', '127.0.0.1:3000', '[::1]:3000', '127.0.0.2']) {
      const res = await app.inject({ method: 'GET', url: '/api/settings/automation', headers: { host } });
      expect(res.statusCode, host).toBe(200);
    }
    expect((await app.inject({ method: 'GET', url: '/api/settings/automation' })).statusCode).toBe(200);
  });

  it('accepts names listed in ALLOWED_HOSTS, in every mode', async () => {
    const local = await harness({ allowedHosts: allowedHosts({ ALLOWED_HOSTS: 'bids.example.com, Other.Example:8443' }) });
    for (const host of ['bids.example.com', 'other.example:8443', 'localhost']) {
      expect((await local.app.inject({ method: 'GET', url: '/api/settings/automation', headers: { host } })).statusCode, host).toBe(200);
    }
    expect((await local.app.inject({ method: 'GET', url: '/api/settings/automation', headers: { host: 'evil.example' } })).statusCode).toBe(403);

    const hosted = await harness({ host: '0.0.0.0', allowedHosts: ['bids.example.com'] });
    expect((await hosted.app.inject({ method: 'GET', url: '/api/settings/automation', headers: { host: 'bids.example.com' } })).statusCode).toBe(200);
    expect((await hosted.app.inject({ method: 'GET', url: '/api/settings/automation', headers: { host: 'evil.example' } })).statusCode).toBe(403);
  });

  it('answers any name on a public bind address without ALLOWED_HOSTS', async () => {
    const { app } = await harness({ host: '0.0.0.0' });
    expect((await app.inject({ method: 'GET', url: '/api/settings/automation', headers: { host: 'bids.example.com' } })).statusCode).toBe(200);
  });

  it('reads ALLOWED_HOSTS and TRUST_PROXY from the environment', () => {
    expect(loadConfig({ ALLOWED_HOSTS: 'a.example,b.example:80' }).allowedHosts).toEqual(['a.example', 'b.example']);
    expect(loadConfig({}).allowedHosts).toEqual([]);
    expect(trustProxy({ TRUST_PROXY: '1' })).toBe('127.0.0.1,::1');
    expect(trustProxy({})).toBe(false);
    expect(trustProxy({ TRUST_PROXY: '10.0.0.0/8, 192.168.1.5' })).toBe('10.0.0.0/8,192.168.1.5');
    expect(trustProxy({ TRUST_PROXY: 'hops=2' })).toBe(2);
  });
});

describe('sign-in on encoded addresses', () => {
  it('needs sign-in for a percent-encoded /api path, which Fastify decodes before routing', async () => {
    const { app } = await harness({ appPassword: 'correct horse battery' });
    const read = await app.inject({ method: 'GET', url: '/%61pi/applications' });
    expect(read.statusCode).toBe(401);
    const write = await app.inject({ method: 'POST', url: '/%61pi/opportunities/manual', payload: { title: 'Park mowing' } });
    expect(write.statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/%61pplications' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/%61pi/nothing-here' })).statusCode).toBe(401);
  });

  it('keeps the public routes open, encoded or not', async () => {
    const { app } = await harness({ appPassword: 'correct horse battery' });
    expect((await app.inject({ method: 'GET', url: '/api/health' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/%61pi/health' })).statusCode).toBe(200);
    const session = await app.inject({ method: 'GET', url: '/api/session' });
    expect(session.json()).toMatchObject({ authRequired: true, authenticated: false });
    const login = await app.inject({ method: 'POST', url: '/api/login', payload: { password: 'correct horse battery' } });
    expect(login.statusCode).toBe(200);
    const cookie = login.cookies.find((c) => c.name === SESSION_COOKIE)!;
    const signedIn = await app.inject({ method: 'GET', url: '/%61pi/applications', cookies: { [SESSION_COOKIE]: cookie.value } });
    expect(signedIn.statusCode).toBe(200);
  });
});

describe('sign-in throttling', () => {
  it('caps wrong passwords across all addresses, even with a rotating X-Forwarded-For behind a trusted proxy', async () => {
    const { app } = await harness({ appPassword: 'correct horse battery', trustProxy: trustProxy({ TRUST_PROXY: '1' }) });
    for (let i = 0; i < 30; i += 1) {
      const res = await app.inject({ method: 'POST', url: '/api/login', headers: { 'x-forwarded-for': `198.51.100.${i}` }, payload: { password: 'wrong' } });
      expect(res.statusCode, `try ${i}`).toBe(401);
    }
    const blocked = await app.inject({ method: 'POST', url: '/api/login', headers: { 'x-forwarded-for': '198.51.100.250' }, payload: { password: 'correct horse battery' } });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().error).toMatch(/sign-in is paused/);
  });

  it('still locks out one address after five wrong passwords', async () => {
    const { app } = await harness({ appPassword: 'correct horse battery' });
    for (let i = 0; i < 5; i += 1) await app.inject({ method: 'POST', url: '/api/login', payload: { password: 'wrong' } });
    expect((await app.inject({ method: 'POST', url: '/api/login', payload: { password: 'wrong' } })).statusCode).toBe(429);
  });

  it('warns about a short password only off this computer', () => {
    expect(weakPasswordWarning({ host: '0.0.0.0', appPassword: 'short' })).toMatch(/shorter than 12/);
    expect(weakPasswordWarning({ host: '127.0.0.1', appPassword: 'short' })).toBeNull();
    expect(weakPasswordWarning({ host: '0.0.0.0', appPassword: 'a long enough password' })).toBeNull();
    expect(weakPasswordWarning({ host: '0.0.0.0', appPassword: '' })).toBeNull();
  });
});

describe('security headers', () => {
  it('sends Permissions-Policy and COOP, and HSTS only over https', async () => {
    const { app } = await harness({ trustProxy: trustProxy({ TRUST_PROXY: '1' }) });
    const plain = await app.inject({ method: 'GET', url: '/api/session' });
    expect(plain.headers['permissions-policy']).toContain('camera=()');
    expect(plain.headers['cross-origin-opener-policy']).toBe('same-origin');
    expect(plain.headers['strict-transport-security']).toBeUndefined();
    const secure = await app.inject({ method: 'GET', url: '/api/session', headers: { 'x-forwarded-proto': 'https' } });
    expect(secure.headers['strict-transport-security']).toMatch(/max-age=\d+/);
  });

  it('ignores x-forwarded-proto when no proxy is trusted', async () => {
    const { app } = await harness();
    const res = await app.inject({ method: 'GET', url: '/api/session', headers: { 'x-forwarded-proto': 'https' } });
    expect(res.headers['strict-transport-security']).toBeUndefined();
  });

  it('sandboxes downloaded files', async () => {
    const { app } = await harness();
    const up = await app.inject({
      method: 'POST',
      url: '/api/documents',
      ...multipart({ kind: 'other', name: 'Page' }, { name: 'page.html', type: 'text/html', content: Buffer.from('<script>alert(1)</script>') }),
    });
    expect(up.statusCode).toBe(200);
    const down = await app.inject({ method: 'GET', url: `/api/documents/${up.json().id}/download` });
    expect(down.statusCode).toBe(200);
    expect(down.headers['content-security-policy']).toBe("sandbox; default-src 'none'");
    const csv = await app.inject({ method: 'GET', url: '/api/opportunities.csv' });
    expect(csv.headers['content-security-policy']).toBe("sandbox; default-src 'none'");
    const page = await app.inject({ method: 'GET', url: '/api/session' });
    expect(page.headers['content-security-policy']).toContain("default-src 'self'");
  });
});

describe('sessions', () => {
  const PASSWORD = 'correct horse battery';

  async function signIn(app: Awaited<ReturnType<typeof harness>>['app']): Promise<string> {
    const res = await app.inject({ method: 'POST', url: '/api/login', payload: { password: PASSWORD } });
    expect(res.statusCode).toBe(200);
    const cookie = res.cookies.find((c) => c.name === SESSION_COOKIE);
    expect(cookie).toBeDefined();
    return cookie!.value;
  }

  const authed = (token: string) => ({ cookie: `${SESSION_COOKIE}=${token}` });

  it('stores only a hash of the session token', async () => {
    const { app, deps } = await harness({ appPassword: PASSWORD });
    const token = await signIn(app);
    expect(deps.store.sessionValid(token, NOW)).toBe(false);
    expect(deps.store.sessionValid(sessionKey(token), NOW)).toBe(true);
    expect(deps.store.getMeta(PASSWORD_FINGERPRINT_KEY)).toMatch(/^scrypt:[0-9a-f]+:[0-9a-f]+$/);
    expect(deps.store.getMeta(PASSWORD_FINGERPRINT_KEY)).not.toContain(PASSWORD);
    expect((await app.inject({ method: 'GET', url: '/api/settings/automation', headers: authed(token) })).statusCode).toBe(200);
  });

  it('signs everyone out when the password changes at restart, and keeps sessions when it does not', async () => {
    const first = await harness({ appPassword: PASSWORD });
    const token = await signIn(first.app);

    const same = await buildApp(first.deps, first.pipeline, first.scheduler);
    expect((await same.inject({ method: 'GET', url: '/api/settings/automation', headers: authed(token) })).statusCode).toBe(200);
    await same.close();

    const changed = await buildApp({ ...first.deps, config: { ...first.deps.config, appPassword: 'a different password' } }, first.pipeline, first.scheduler);
    expect((await changed.inject({ method: 'GET', url: '/api/settings/automation', headers: authed(token) })).statusCode).toBe(401);
    await changed.close();
  });

  it('deletes the session on sign-out', async () => {
    const { app, deps } = await harness({ appPassword: PASSWORD });
    const token = await signIn(app);
    expect((await app.inject({ method: 'POST', url: '/api/logout', headers: authed(token) })).statusCode).toBe(200);
    expect(deps.store.sessionValid(sessionKey(token), NOW)).toBe(false);
    expect((await app.inject({ method: 'GET', url: '/api/settings/automation', headers: authed(token) })).statusCode).toBe(401);
  });
});
