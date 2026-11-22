import { afterEach, describe, expect, it } from 'vitest';
import { closeHarnesses, createApp, harness, seedOpportunity } from './helpers/apiHarness.js';

afterEach(closeHarnesses);

async function withApp(status: Parameters<typeof createApp>[2]) {
  const h = await harness();
  const app = createApp(h.deps, seedOpportunity(h.deps, { title: 'Park mowing' }), status);
  const post = (to: string) => h.app.inject({ method: 'POST', url: `/api/applications/${app.id}/status`, payload: { status: to } });
  return { h, app, post };
}

describe('result correction (UX-5)', () => {
  it('allows won → lost', async () => {
    const { post } = await withApp('won');
    const res = await post('lost');
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('lost');
  });

  it('allows lost → submitted (undo result)', async () => {
    const { post } = await withApp('lost');
    const res = await post('submitted');
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('submitted');
  });

  it('refuses needs_input → won', async () => {
    const { post } = await withApp('needs_input');
    const res = await post('won');
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('Only a submitted application can be marked as won or not awarded.');
  });

  it('refuses withdrawn from won', async () => {
    const { post } = await withApp('won');
    const res = await post('withdrawn');
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatch(/already has a result/);
  });

  it('refuses undo when there is no result', async () => {
    const { post } = await withApp('submitted');
    expect((await post('submitted')).statusCode).toBe(409);
  });
});
