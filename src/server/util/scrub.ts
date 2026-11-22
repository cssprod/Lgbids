import * as cheerio from 'cheerio';

/**
 * Scrubbers for real pages and alert e-mails before they become test fixtures
 * or leave the user's computer in a live-check bundle. They remove what could
 * identify a person (addresses, phone numbers, tracking tokens, mail routing)
 * and keep what the readers need (tags, labels, titles, dates). Pure.
 */

export const SCRUB_HTML_MAX = 300 * 1024;
export const SCRUBBED_RECIPIENT = 'recipient@inbox.example';

const EMAIL = /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]{1,64}@([A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){1,8})/g;
// North American numbers: (250) 555-1234, 250.555.1234, +1 778 555 1234.
const PHONE = /(?<![\d-])(?:\+?1[ .-]?)?\(?([2-9]\d{2})\)?[ .-]?(\d{3})[ .-](\d{4})(?![\d-])/g;
const URL_RE = /https?:\/\/[^\s"'<>()]+/g;
/** Hosts and paths that mark a click-tracking redirect: its query string carries a token. */
const TRACKING = /(?:^|\.)(?:click|clicks|links?|track(?:ing)?|email|e|ct|url\d*|mandrillapp|sendgrid|list-manage|mailchimp|hubspotlinks|mjt|rs6|r20)\.|\/(?:ls\/click|track|click|wf\/click|c\/|e\/)/i;

function scrubEmails(text: string, keep: Set<string> = new Set()): string {
  return text.replace(EMAIL, (whole, host: string) => {
    const lower = whole.toLowerCase();
    if (keep.has(lower) || /\.example$/i.test(host)) return whole;
    return `name@${host.toLowerCase()}.example`;
  });
}

function scrubPhones(text: string): string {
  const seen = new Map<string, string>();
  return text.replace(PHONE, (whole, a: string, b: string, c: string) => {
    const key = a + b + c;
    if (b === '555' && c.startsWith('01')) return whole;
    if (!seen.has(key)) seen.set(key, `250-555-01${String(seen.size % 100).padStart(2, '0')}`);
    return seen.get(key)!;
  });
}

function scrubUrl(href: string): string {
  try {
    const u = new URL(href.replace(/&amp;/g, '&'));
    if (TRACKING.test(`${u.hostname}${u.pathname}`)) {
      u.search = '';
      u.hash = '';
      return u.toString();
    }
    for (const k of [...u.searchParams.keys()]) if (/^(?:utm_|mc_|_hs|token|sig|email|e$|recipient)/i.test(k)) u.searchParams.delete(k);
    return u.toString();
  } catch {
    return href;
  }
}

function scrubText(text: string, keep?: Set<string>): string {
  return scrubPhones(scrubEmails(text.replace(URL_RE, scrubUrl), keep));
}

/** Clean a page or HTML e-mail body: no scripts, styles, inline SVG or data: images; personal details replaced. */
export function scrubHtml(html: string, opts: { keepEmails?: string[] } = {}): string {
  const $ = cheerio.load(html);
  $('script, style, svg, noscript, iframe').remove();
  $('img[src^="data:"], source[srcset^="data:"]').remove();
  $('[style*="data:"]').removeAttr('style');
  const keep = new Set((opts.keepEmails ?? []).map((e) => e.toLowerCase()));
  const out = scrubText($.html(), keep);
  return out.length > SCRUB_HTML_MAX ? out.slice(0, SCRUB_HTML_MAX) : out;
}

// ---------------------------------------------------------------------------
// E-mail (.eml)
// ---------------------------------------------------------------------------

const DROP_HEADERS = /^(?:to|cc|bcc|delivered-to|received|x-received|dkim-signature|x-google-dkim-signature|arc-[a-z-]+|message-id|return-path|authentication-results|received-spf|x-gm-message-state|x-google-smtp-source|references|in-reply-to|x-original-to|envelope-to)$/i;

interface Header {
  name: string;
  value: string;
}

function splitHead(raw: string): { headers: Header[]; body: string } {
  const m = /\r?\n\r?\n/.exec(raw);
  const head = m ? raw.slice(0, m.index) : raw;
  const body = m ? raw.slice(m.index + m[0].length) : '';
  const headers: Header[] = [];
  for (const line of head.split(/\r?\n/)) {
    if (/^[ \t]/.test(line) && headers.length) headers[headers.length - 1]!.value += `\n${line}`;
    else {
      const i = line.indexOf(':');
      if (i > 0) headers.push({ name: line.slice(0, i).trim(), value: line.slice(i + 1).trim() });
    }
  }
  return { headers, body };
}

function header(headers: Header[], name: string): string {
  return headers.find((h) => h.name.toLowerCase() === name)?.value.replace(/\s+/g, ' ') ?? '';
}

function param(value: string, name: string): string {
  const m = new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|([^;\\s]+))`, 'i').exec(value);
  return m ? (m[1] ?? m[2] ?? '') : '';
}

function decodeBody(body: string, encoding: string, charset: string): string {
  let bytes: Uint8Array;
  if (/base64/i.test(encoding)) bytes = Buffer.from(body.replace(/\s+/g, ''), 'base64');
  else if (/quoted-printable/i.test(encoding)) {
    const soft = body.replace(/=\r?\n/g, '');
    const parts: number[] = [];
    for (let i = 0; i < soft.length; i++) {
      if (soft[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(soft.slice(i + 1, i + 3))) {
        parts.push(parseInt(soft.slice(i + 1, i + 3), 16));
        i += 2;
      } else parts.push(...Buffer.from(soft[i]!, 'utf8'));
    }
    bytes = Uint8Array.from(parts);
  } else return body;
  try {
    return new TextDecoder(charset || 'utf-8').decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

function scrubPart(raw: string, keep: Set<string>, top: boolean): string {
  const { headers, body } = splitHead(raw);
  const type = header(headers, 'content-type') || 'text/plain';
  const kept = headers.filter((h) => !(top && DROP_HEADERS.test(h.name)) && !/^x-/i.test(h.name) || /^x-mailer$/i.test(h.name));
  const boundary = /^multipart\//i.test(type) ? param(type, 'boundary') : '';

  let newBody = body;
  const outHeaders = kept.map((h) => ({ ...h }));
  if (boundary) {
    const sep = `--${boundary}`;
    const pieces = body.split(new RegExp(`\\r?\\n?${sep.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    const preamble = pieces.shift() ?? '';
    const parts: string[] = [];
    let epilogue = '';
    for (const piece of pieces) {
      if (piece.startsWith('--')) {
        epilogue = piece.slice(2);
        break;
      }
      parts.push(scrubPart(piece.replace(/^[ \t]*\r?\n/, ''), keep, false));
    }
    newBody = `${preamble ? `${preamble.trim()}\n` : ''}${parts.map((p) => `${sep}\n${p}\n`).join('')}${sep}--${epilogue.trim() ? `\n${epilogue.trim()}` : ''}\n`;
  } else if (/^text\//i.test(type)) {
    const encoding = header(headers, 'content-transfer-encoding');
    const text = decodeBody(body, encoding, param(type, 'charset'));
    newBody = /^text\/html/i.test(type) ? scrubHtml(text, { keepEmails: [...keep] }) : scrubText(text, keep);
    // The body is written decoded, so its headers say so.
    for (const h of outHeaders) {
      if (h.name.toLowerCase() === 'content-transfer-encoding') h.value = '8bit';
      if (h.name.toLowerCase() === 'content-type' && param(h.value, 'charset')) h.value = h.value.replace(/charset\s*=\s*("[^"]*"|[^;\s]+)/i, 'charset=utf-8');
    }
  } else {
    // Attachments and images: not needed by the readers and may hold anything.
    newBody = '';
  }

  const lines = outHeaders.map((h) => {
    const lower = h.name.toLowerCase();
    // From keeps its domain (the reader recognises the sender by it); Subject and Date stay readable.
    if (lower === 'from') return `${h.name}: ${h.value}`;
    if (lower === 'subject') return `${h.name}: ${scrubText(h.value, keep)}`;
    if (lower === 'reply-to' || lower === 'sender') return `${h.name}: ${scrubEmails(h.value, keep)}`;
    return `${h.name}: ${h.value}`;
  });
  if (top) lines.splice(Math.max(0, lines.findIndex((l) => /^from:/i.test(l)) + 1), 0, `To: ${SCRUBBED_RECIPIENT}`);
  return `${lines.join('\n')}\n\n${newBody}`;
}

/** Clean one saved alert e-mail: routing headers dropped, recipient replaced, tracking tokens removed, From/Subject/Date and the text and HTML parts kept. */
export function scrubEml(raw: string): string {
  const { headers } = splitHead(raw);
  const from = header(headers, 'from');
  const keep = new Set<string>();
  for (const m of from.matchAll(EMAIL)) keep.add(m[0].toLowerCase());
  return scrubPart(raw.replace(/\r\n/g, '\n'), keep, true);
}
