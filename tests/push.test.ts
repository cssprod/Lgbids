import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/server/app.js';
import { createDeps } from '../src/server/bootstrap.js';
import type { AppConfig, AppDeps, FetchLike, Pipeline, Scheduler } from '../src/server/contracts.js';
import { sendDigest } from '../src/server/pipeline/notify.js';
import { findTelegramChat, ntfyText, PushError, sendPush, telegramText, TELEGRAM_LIMIT } from '../src/server/pipeline/push.js';
import { ntfyServerProblem, pushSettingsSchema, type PushSettings } from '../src/shared/schemas.js';

// Nothing here touches the network: every request goes to a recording fake.

const NOW = new Date('2026-07-08T18:00:00Z');
const TOKEN = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw0';
const config: AppConfig = { port: 0, host: '127.0.0.1', dataDir: ':memory:', appPassword: '', timeZone: 'America/Vancouver', demo: false, webDir: '' };

interface Call {
  url: string;
  init: RequestInit;
  body: Record<string, unknown>;
}

function fakeFetch(reply: (call: Call) => Response | Promise<Response> = () => Response.json({ ok: true, result: {} })): FetchLike & { calls: Call[] } {
  const calls: Call[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    const call = { url, init, body: JSON.parse(String(init.body ?? '{}')) as Record<string, unknown> };
    calls.push(call);
    return reply(call);
  }) as FetchLike & { calls: Call[] };
  fn.calls = calls;
  return fn;
}

const telegram = (over: Partial<PushSettings> = {}): PushSettings => pushSettingsSchema.parse({ provider: 'telegram', telegramToken: TOKEN, telegramChatId: '42424242', ...over });
const ntfy = (over: Partial<PushSettings> = {}): PushSettings => pushSettingsSchema.parse({ provider: 'ntfy', ntfyServer: 'https://ntfy.example', ntfyTopic: 'lgbids-x7Kq92mPz', ...over });

async function failure(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(PushError);
    return (error as Error).message;
  }
  throw new Error('expected the push to fail');
}

describe('sendPush', () => {
  it('posts an escaped HTML message to the Telegram bot API', async () => {
    const fetch = fakeFetch();
    await sendPush(telegram(), { title: 'Lgbids: 1 new <opportunity>', lines: [{ text: 'Mowing & trimming — Saanich', url: 'https://saanich.example/bids?id=1&x=2' }, 'Closes 1 < 2'] }, fetch);
    expect(fetch.calls).toHaveLength(1);
    const [call] = fetch.calls;
    expect(call!.url).toBe(`https://api.telegram.org/bot${TOKEN}/sendMessage`);
    expect(call!.init.method).toBe('POST');
    expect(call!.init.redirect).toBe('error');
    expect(call!.init.signal).toBeInstanceOf(AbortSignal);
    expect(call!.body).toMatchObject({ chat_id: '42424242', parse_mode: 'HTML', disable_web_page_preview: true });
    expect(call!.body.text).toBe(
      '<b>Lgbids: 1 new &lt;opportunity&gt;</b>\n<a href="https://saanich.example/bids?id=1&amp;x=2">Mowing &amp; trimming — Saanich</a>\nCloses 1 &lt; 2',
    );
  });

  it('publishes JSON to the ntfy server with the seedling tag, a click link and the access token', async () => {
    const fetch = fakeFetch(() => new Response('{}', { status: 200 }));
    await sendPush(ntfy({ ntfyToken: 'tk_abc123' }), { title: 'Lgbids: 2 new opportunities — Oak Bay', lines: [{ text: 'Hedge trimming', url: 'https://oakbay.example/bid/7' }, '1 new draft needs your input.'] }, fetch);
    const [call] = fetch.calls;
    expect(call!.url).toBe('https://ntfy.example/');
    expect((call!.init.headers as Record<string, string>).authorization).toBe('Bearer tk_abc123');
    expect(call!.body).toEqual({
      topic: 'lgbids-x7Kq92mPz',
      title: 'Lgbids: 2 new opportunities — Oak Bay',
      message: 'Hedge trimming\nhttps://oakbay.example/bid/7\n1 new draft needs your input.',
      tags: ['seedling'],
      click: 'https://oakbay.example/bid/7',
    });
    // Without a token there is no Authorization header at all.
    await sendPush(ntfy(), { title: 'Test', lines: ['Hello.'] }, fetch);
    expect((fetch.calls[1]!.init.headers as Record<string, string>).authorization).toBeUndefined();
  });

  it('keeps long messages under the limits by dropping whole lines', () => {
    const lines = Array.from({ length: 120 }, (_, i) => ({ text: `Boulevard mowing contract number ${i} with a long description & more`, url: `https://town.example/bids/${i}` }));
    const text = telegramText({ title: 'Lgbids: 120 new opportunities', lines });
    expect(text.length).toBeLessThanOrEqual(TELEGRAM_LIMIT);
    expect(text.split('<a ').length).toBe(text.split('</a>').length);
    expect(text).toMatch(/…and \d+ more lines in Lgbids\.$/);
    expect(Buffer.byteLength(ntfyText({ title: 't', lines }), 'utf8')).toBeLessThanOrEqual(4000);
    // One very long title is clipped at a word, not dropped.
    const long = telegramText({ title: 'Mowing '.repeat(200), lines: [] });
    expect(long.length).toBeLessThan(320);
    expect(long).toMatch(/Mowing…<\/b>$/);
  });

  it('turns Telegram refusals into sentences without the token', async () => {
    const refused = await failure(sendPush(telegram(), { title: 't', lines: [] }, fakeFetch(() => Response.json({ ok: false, description: 'Unauthorized' }, { status: 401 }))));
    expect(refused).toBe('Telegram refused the bot token. Check it in BotFather.');
    const chat = await failure(sendPush(telegram(), { title: 't', lines: [] }, fakeFetch(() => Response.json({ ok: false, description: 'Bad Request: chat not found' }, { status: 400 }))));
    expect(chat).toContain('could not find that chat');
    const echoed = await failure(
      sendPush(telegram(), { title: 't', lines: [] }, fakeFetch(() => Response.json({ ok: false, description: `Bad Request: bot ${TOKEN} cannot do this` }, { status: 400 }))),
    );
    expect(echoed).not.toContain(TOKEN);
    expect(echoed).toContain('[bot token]');
    const network = await failure(
      sendPush(telegram(), { title: 't', lines: [] }, (async (url: string) => {
        throw new TypeError(`fetch failed for ${url}`);
      }) as FetchLike),
    );
    expect(network).not.toContain(TOKEN);
    expect(network).toContain('could not reach Telegram');
    const slow = await failure(
      sendPush(telegram(), { title: 't', lines: [] }, (async () => {
        throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
      }) as FetchLike),
    );
    expect(slow).toContain('within 10 seconds');
  });

  it('explains ntfy refusals and incomplete settings', async () => {
    expect(await failure(sendPush(ntfy(), { title: 't', lines: [] }, fakeFetch(() => new Response('{}', { status: 403 }))))).toContain('refused to publish');
    expect(await failure(sendPush(ntfy({ ntfyTopic: '' }), { title: 't', lines: [] }, fakeFetch()))).toBe('Enter the ntfy topic name, then save.');
    expect(await failure(sendPush(telegram({ telegramChatId: '' }), { title: 't', lines: [] }, fakeFetch()))).toBe('Enter your Telegram chat id, then save.');
  });

  it('finds the chat that last wrote to the bot', async () => {
    const fetch = fakeFetch(() =>
      Response.json({
        ok: true,
        result: [
          { update_id: 1, message: { chat: { id: 111, first_name: 'Old' } } },
          { update_id: 2, message: { chat: { id: 987654321, first_name: 'Sam', last_name: 'Gardener' } } },
        ],
      }),
    );
    expect(await findTelegramChat(TOKEN, fetch)).toEqual({ id: '987654321', name: 'Sam Gardener' });
    expect(fetch.calls[0]!.url).toBe(`https://api.telegram.org/bot${TOKEN}/getUpdates`);
    expect(await findTelegramChat(TOKEN, fakeFetch(() => Response.json({ ok: true, result: [] })))).toBeNull();
  });
});

describe('push settings', () => {
  it('accepts https servers, and http only on this computer', () => {
    expect(ntfyServerProblem('https://ntfy.sh')).toBeNull();
    expect(ntfyServerProblem('http://localhost:8080')).toBeNull();
    expect(ntfyServerProblem('http://127.0.0.1')).toBeNull();
    expect(ntfyServerProblem('http://ntfy.example')).toMatch(/https:\/\//);
    expect(ntfyServerProblem('https://user:pw@ntfy.example')).toMatch(/access token/);
    expect(ntfyServerProblem('ntfy.sh')).toMatch(/not a web address/);
    expect(pushSettingsSchema.safeParse({ ntfyTopic: 'has spaces' }).success).toBe(false);
    expect(pushSettingsSchema.safeParse({ telegramChatId: '-1001234567890' }).success).toBe(true);
    expect(pushSettingsSchema.safeParse({ telegramChatId: 'my chat' }).success).toBe(false);
    expect(pushSettingsSchema.safeParse({ telegramToken: 'not-a-token' }).success).toBe(false);
  });

  it('keeps saved tokens, and never moves an ntfy token to another server', () => {
    const deps = createDeps(config, { now: () => NOW });
    deps.settings.setPush({ provider: 'ntfy', ntfyServer: 'https://ntfy.example/', ntfyTopic: 'lgbids-a', ntfyToken: 'tk_secret' });
    expect(deps.settings.getPush()).toMatchObject({ ntfyServer: 'https://ntfy.example', ntfyToken: 'tk_secret' });
    deps.settings.setPush({ provider: 'ntfy', ntfyServer: 'https://ntfy.example', ntfyTopic: 'lgbids-b', ntfyToken: '' });
    expect(deps.settings.getPush().ntfyToken).toBe('tk_secret');
    deps.settings.setPush({ provider: 'ntfy', ntfyServer: 'https://other.example', ntfyTopic: 'lgbids-b', ntfyToken: '' });
    expect(deps.settings.getPush().ntfyToken).toBe('');
    deps.store.close();
  });
});

// ---------------------------------------------------------------------------
// The digest and the API
// ---------------------------------------------------------------------------

function seedSuitable(deps: AppDeps, title: string): number {
  deps.store.insertSource(
    { id: 'push-test', name: 'Test source', kind: 'html_list', enabled: true, builtin: false, notes: '', config: { url: 'https://town.example/bids' } as never },
    NOW,
  );
  const { id } = deps.store.upsertOpportunity(
    'push-test',
    {
      externalId: title,
      title,
      url: 'https://town.example/bids/1',
      organization: 'District of Saanich',
      referenceNumber: 'RFQ 26-1',
      description: 'Mowing and trimming of parks.',
      closing: { iso: '2026-07-20T21:00:00Z', precision: 'datetime' },
      closingRaw: 'July 20, 2026 2:00 PM',
      status: 'open',
    },
    false,
    NOW,
  );
  deps.store.saveAnalysis(
    id,
    {
      noticeType: 'RFQ',
      score: 80,
      decision: 'suitable',
      analysis: { relevance: 80, matchedTerms: ['mowing'], services: ['lawn'], area: 'yes', areaMatch: 'Saanich', reasons: [], requirements: [], pricing: 'lump_sum', alsoListed: [] },
      submissionMethod: 'email',
      submissionEmail: 'bids@saanich.example',
      submissionUrl: '',
    },
    NOW,
  );
  return id;
}

const opened: AppDeps[] = [];
afterEach(() => {
  for (const deps of opened.splice(0)) deps.store.close();
});

function depsWith(fetch: FetchLike): AppDeps {
  const deps = createDeps(config, { now: () => NOW, pushFetch: fetch });
  opened.push(deps);
  return deps;
}

describe('digest with a phone alert', () => {
  it('sends the alert even without e-mail, and marks the notices as told', async () => {
    const fetch = fakeFetch();
    const deps = depsWith(fetch);
    deps.settings.setPush({ provider: 'telegram', telegramToken: TOKEN, telegramChatId: '42424242' });
    const id = seedSuitable(deps, 'Boulevard mowing');
    const run = deps.store.startRun('manual', NOW);
    expect(await sendDigest(deps, run)).toBe(true);
    expect(fetch.calls).toHaveLength(1);
    expect(String(fetch.calls[0]!.body.text)).toContain('<a href="https://town.example/bids/1">Boulevard mowing — District of Saanich, closes');
    expect(deps.store.getOpportunity(id)?.notifiedAt).not.toBeNull();
    expect(deps.store.listEvents(10).some((e) => e.message === 'Sent a phone alert through Telegram.')).toBe(true);
  });

  it('logs a failed alert as a warning and does not throw', async () => {
    const deps = depsWith((async () => {
      throw new TypeError('fetch failed');
    }) as FetchLike);
    deps.settings.setPush({ provider: 'ntfy', ntfyTopic: 'lgbids-x7Kq92mPz' });
    const id = seedSuitable(deps, 'Hedge trimming');
    const run = deps.store.startRun('manual', NOW);
    await expect(sendDigest(deps, run)).resolves.toBe(false);
    const warning = deps.store.listEvents(10).find((e) => e.level === 'warn');
    expect(warning?.message).toMatch(/^The phone alert through ntfy could not be sent\. Lgbids could not reach the ntfy server/);
    // Not told, so the next check tries again.
    expect(deps.store.getOpportunity(id)?.notifiedAt).toBeNull();
  });
});

describe('push settings API', () => {
  const scheduler: Scheduler = { start() {}, stop() {}, reschedule() {}, nextRunAt: () => null };

  async function api(fetch: FetchLike) {
    const deps = depsWith(fetch);
    const app = await buildApp(deps, { isRunning: () => false } as unknown as Pipeline, scheduler);
    return { deps, app };
  }

  it('never returns the token, and reports a refused token in a sentence', async () => {
    let status = 401;
    const fetch = fakeFetch(() => (status === 200 ? Response.json({ ok: true, result: {} }) : Response.json({ ok: false, description: 'Unauthorized' }, { status })));
    const { app, deps } = await api(fetch);
    expect((await app.inject({ method: 'GET', url: '/api/settings/push' })).json()).toMatchObject({ provider: 'off', ntfyServer: 'https://ntfy.sh', hasTelegramToken: false });

    const saved = await app.inject({ method: 'PUT', url: '/api/settings/push', payload: { provider: 'telegram', telegramToken: TOKEN, telegramChatId: '42424242' } });
    expect(saved.statusCode).toBe(200);
    expect(saved.body).not.toContain(TOKEN);
    expect(saved.json()).toMatchObject({ provider: 'telegram', hasTelegramToken: true, telegramChatId: '42424242' });
    expect((await app.inject({ method: 'GET', url: '/api/settings/push' })).body).not.toContain(TOKEN);

    const refused = await app.inject({ method: 'POST', url: '/api/settings/push/test' });
    expect(refused.json()).toEqual({ ok: false, message: 'Telegram refused the bot token. Check it in BotFather.' });

    status = 200;
    const ok = await app.inject({ method: 'POST', url: '/api/settings/push/test' });
    expect(ok.json()).toMatchObject({ ok: true });
    expect(String(fetch.calls.at(-1)!.body.text)).toContain('Lgbids test alert — phone alerts are working.');
    expect(deps.settings.getPush().verifiedAt).not.toBeNull();
    await app.close();
  });

  it('rejects an unsafe ntfy server and finds the Telegram chat id', async () => {
    const fetch = fakeFetch(() => Response.json({ ok: true, result: [{ update_id: 5, message: { chat: { id: 5550001, first_name: 'Sam' } } }] }));
    const { app, deps } = await api(fetch);
    const bad = await app.inject({ method: 'PUT', url: '/api/settings/push', payload: { provider: 'ntfy', ntfyServer: 'http://ntfy.example', ntfyTopic: 'lgbids-a' } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error ?? bad.body).toMatch(/https:\/\//);

    const noToken = await app.inject({ method: 'POST', url: '/api/settings/push/telegram-chat' });
    expect(noToken.json()).toMatchObject({ ok: false });
    await app.inject({ method: 'PUT', url: '/api/settings/push', payload: { provider: 'telegram', telegramToken: TOKEN } });
    const found = await app.inject({ method: 'POST', url: '/api/settings/push/telegram-chat' });
    expect(found.json()).toMatchObject({ ok: true, chatId: '5550001', message: 'Found the chat with Sam and saved it. Now send a test alert.' });
    expect(deps.settings.getPush().telegramChatId).toBe('5550001');
    await app.close();
  });
});
