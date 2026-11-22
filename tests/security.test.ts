import { afterEach, describe, expect, it } from 'vitest';
import { allowedHosts, loadConfig, trustProxy } from '../src/server/config.js';
import { closeHarnesses, harness } from './helpers/apiHarness.js';

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
