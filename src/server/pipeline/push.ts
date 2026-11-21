import { ntfyServerProblem, type PushSettings } from '../../shared/schemas.js';
import type { FetchLike } from '../contracts.js';

/**
 * Short phone alerts through Telegram or ntfy. Only the settings the user
 * saved are used; nothing here ever logs or repeats a token, because error
 * messages end up in the activity log and on screen.
 */

/** A line of the alert; with a url it becomes a link (Telegram) or gets the address below it (ntfy). */
export type PushLine = string | { text: string; url: string };

export interface PushMessage {
  title: string;
  lines: PushLine[];
  /** Where tapping the alert goes (ntfy), or a link at the end (Telegram). */
  url?: string;
}

/** A failure whose message is a full sentence for the user, never containing a token. */
export class PushError extends Error {
  override name = 'PushError';
}

export const TELEGRAM_LIMIT = 4096;
/** ntfy turns longer messages into file attachments, which are awkward on a phone. */
export const NTFY_LIMIT_BYTES = 4000;
const LINE_MAX = 300;
const TIMEOUT_MS = 10_000;
const TELEGRAM_API = 'https://api.telegram.org';
const TOKEN_PATTERN = /\d{5,16}:[A-Za-z0-9_-]{30,80}/g;

/** What still stops alerts from being sent, as a sentence, or null when they can be sent. */
export function pushProblem(settings: PushSettings): string | null {
  if (settings.provider === 'telegram') {
    if (!settings.telegramToken) return 'Enter the bot token from BotFather, then save.';
    if (!settings.telegramChatId) return 'Enter your Telegram chat id, then save.';
    return null;
  }
  if (settings.provider === 'ntfy') {
    if (!settings.ntfyTopic) return 'Enter the ntfy topic name, then save.';
    return ntfyServerProblem(settings.ntfyServer);
  }
  return 'Phone alerts are not set up yet. Choose Telegram or ntfy, fill in the fields, then save.';
}

export function pushConfigured(settings: PushSettings): boolean {
  return settings.provider !== 'off' && pushProblem(settings) === null;
}

/** One line, cut at a word boundary so a long title cannot crowd out the rest. */
function clip(text: string, max = LINE_MAX): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const safeUrl = (url: string): string | null => (/^https?:\/\/[^\s]+$/i.test(url) && url.length <= 2000 ? url : null);

/**
 * Join the head and as many whole lines as fit within the limit; what does
 * not fit is summed up in a last line, so a message is never cut mid-tag.
 */
function fit(head: string, parts: string[], limit: number, measure: (s: string) => number, more: (n: number) => string): string {
  const join = (count: number) => [head, ...parts.slice(0, count), ...(count < parts.length ? [more(parts.length - count)] : [])].join('\n');
  for (let count = parts.length; count > 0; count -= 1) {
    const text = join(count);
    if (measure(text) <= limit) return text;
  }
  return join(0);
}

const moreLine = (n: number) => `…and ${n} more ${n === 1 ? 'line' : 'lines'} in Lgbids.`;

/** Telegram HTML: bold title, escaped lines, links for notices. Exported for tests. */
export function telegramText(message: PushMessage): string {
  const parts = message.lines.map((line) => {
    if (typeof line === 'string') return escapeHtml(clip(line));
    const href = safeUrl(line.url);
    return href ? `<a href="${escapeHtml(href).replace(/"/g, '&quot;')}">${escapeHtml(clip(line.text))}</a>` : escapeHtml(clip(line.text));
  });
  const url = message.url ? safeUrl(message.url) : null;
  if (url) parts.push(escapeHtml(url));
  return fit(`<b>${escapeHtml(clip(message.title))}</b>`, parts, TELEGRAM_LIMIT, (s) => s.length, (n) => escapeHtml(moreLine(n)));
}

/** ntfy plain text: each notice with its address underneath. Exported for tests. */
export function ntfyText(message: PushMessage): string {
  const parts = message.lines.map((line) => (typeof line === 'string' ? clip(line) : `${clip(line.text)}\n${safeUrl(line.url) ?? ''}`.trimEnd()));
  const [first, ...rest] = parts;
  if (first === undefined) return clip(message.title);
  return fit(first, rest, NTFY_LIMIT_BYTES, (s) => Buffer.byteLength(s, 'utf8'), moreLine);
}

function redact(text: string, token: string): string {
  const withoutToken = token ? text.split(token).join('[bot token]') : text;
  return withoutToken.replace(TOKEN_PATTERN, '[bot token]');
}

async function call(fetchImpl: FetchLike, url: string, init: RequestInit, service: string): Promise<Response> {
  try {
    // No redirects: a token or Authorization header must only ever go to the address the user saved.
    return await fetchImpl(url, { ...init, method: 'POST', redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    // The error itself is not repeated: it can contain the address, and for Telegram the address holds the token.
    const name = (error as { name?: string } | null)?.name;
    if (name === 'TimeoutError' || name === 'AbortError') {
      throw new PushError(`${service} did not answer within 10 seconds. Check that this server can reach the internet, then try again.`);
    }
    throw new PushError(`Lgbids could not reach ${service}. Check that this server can reach the internet and the address is right, then try again.`);
  }
}

interface TelegramReply {
  ok?: boolean;
  description?: string;
  result?: unknown;
}

async function telegramReply(res: Response): Promise<TelegramReply> {
  try {
    const body = (await res.json()) as unknown;
    return typeof body === 'object' && body !== null ? (body as TelegramReply) : {};
  } catch {
    return {};
  }
}

function telegramError(status: number, description: string, token: string): PushError {
  if (status === 401 || status === 404) return new PushError('Telegram refused the bot token. Check it in BotFather.');
  if (status === 400 && /chat not found/i.test(description)) {
    return new PushError('Telegram could not find that chat. Send your bot a message first, then check the chat id.');
  }
  if (status === 403) {
    return new PushError('Telegram will not let the bot write to that chat. Open the chat with your bot, press Start (or unblock it), then try again.');
  }
  if (status === 409) {
    return new PushError('This bot is connected to another service (a webhook), so Lgbids cannot read its messages. Enter the chat id by hand instead.');
  }
  if (status === 429) return new PushError('Telegram is limiting messages from this bot right now. Try again in a minute.');
  const detail = redact(description, token).replace(/[.\s]+$/, '');
  return new PushError(detail ? `Telegram did not accept the message: ${detail}.` : `Telegram answered with an error (status ${status}). Try again later.`);
}

async function sendTelegram(settings: PushSettings, message: PushMessage, fetchImpl: FetchLike): Promise<void> {
  const token = settings.telegramToken;
  const res = await call(
    fetchImpl,
    `${TELEGRAM_API}/bot${token}/sendMessage`,
    {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: settings.telegramChatId,
        text: telegramText(message),
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    },
    'Telegram',
  );
  const reply = await telegramReply(res);
  if (!res.ok || reply.ok === false) throw telegramError(res.status, reply.description ?? '', token);
}

async function sendNtfy(settings: PushSettings, message: PushMessage, fetchImpl: FetchLike): Promise<void> {
  const server = settings.ntfyServer.replace(/\/+$/, '');
  const firstLink = message.lines.find((line): line is { text: string; url: string } => typeof line !== 'string' && safeUrl(line.url) !== null);
  const click = (message.url && safeUrl(message.url)) || firstLink?.url;
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (settings.ntfyToken) headers.authorization = `Bearer ${settings.ntfyToken}`;
  // Published as JSON to the server root, so titles with accents or dashes are not limited by HTTP header rules.
  const res = await call(
    fetchImpl,
    `${server}/`,
    {
      headers,
      body: JSON.stringify({ topic: settings.ntfyTopic, title: clip(message.title, 250), message: ntfyText(message), tags: ['seedling'], ...(click ? { click } : {}) }),
    },
    'the ntfy server',
  );
  if (res.ok) return;
  if (res.status === 401 || res.status === 403) {
    throw new PushError('The ntfy server refused to publish to this topic. Check the access token, or choose a topic nobody else has reserved.');
  }
  if (res.status === 429) throw new PushError('The ntfy server is limiting messages right now. Try again in a few minutes.');
  if (res.status === 404 || res.status === 405) throw new PushError('That address does not look like an ntfy server. Check the server address.');
  throw new PushError(`The ntfy server answered with an error (status ${res.status}). Try again later.`);
}

/** Send one alert with the saved settings. Throws a PushError with a readable sentence. */
export async function sendPush(settings: PushSettings, message: PushMessage, fetchImpl: FetchLike = fetch): Promise<void> {
  const problem = pushProblem(settings);
  if (problem) throw new PushError(problem);
  if (settings.provider === 'telegram') await sendTelegram(settings, message, fetchImpl);
  else await sendNtfy(settings, message, fetchImpl);
}

export interface TelegramChat {
  id: string;
  /** The person's or group's name as Telegram shows it. */
  name: string;
}

/**
 * The chat that most recently wrote to the bot, read with getUpdates, so the
 * user does not have to open a URL holding their token. Null when nobody has
 * written to the bot in the last day (Telegram keeps updates for 24 hours).
 */
export async function findTelegramChat(token: string, fetchImpl: FetchLike = fetch): Promise<TelegramChat | null> {
  if (!token) throw new PushError('Enter the bot token from BotFather, then save.');
  const res = await call(
    fetchImpl,
    `${TELEGRAM_API}/bot${token}/getUpdates`,
    { headers: { 'content-type': 'application/json' }, body: JSON.stringify({ limit: 100, timeout: 0 }) },
    'Telegram',
  );
  const reply = await telegramReply(res);
  if (!res.ok || reply.ok === false) throw telegramError(res.status, reply.description ?? '', token);
  const updates = Array.isArray(reply.result) ? (reply.result as Record<string, unknown>[]) : [];
  for (const update of updates.slice().reverse()) {
    for (const key of ['message', 'channel_post', 'my_chat_member', 'edited_message']) {
      const chat = (update[key] as { chat?: Record<string, unknown> } | undefined)?.chat;
      if (chat && (typeof chat.id === 'number' || typeof chat.id === 'string')) {
        const person = [chat.first_name, chat.last_name].filter((p) => typeof p === 'string' && p).join(' ');
        const name = (typeof chat.title === 'string' && chat.title) || person || (typeof chat.username === 'string' ? `@${chat.username}` : 'your chat');
        return { id: String(chat.id), name };
      }
    }
  }
  return null;
}
