import { simpleParser } from 'mailparser';
import { describe, expect, it } from 'vitest';
import { parseAlertEmail, type AlertEmail } from '../src/server/sources/alerts/parse.js';
import { SCRUB_HTML_MAX, SCRUBBED_RECIPIENT, scrubEml, scrubHtml } from '../src/server/util/scrub.js';

// An INVENTED alert e-mail carrying the kinds of personal details real ones do.
const HTML = `<html><head><style>p{color:red}</style><script>track()</script></head><body>
<p>Hello Pat Gardener (pat.gardener@gmail.com), call 250-361-0000 or (778) 432-1111.</p>
<table><tr><th>Opportunity ID</th><th>Description</th><th>Organization</th><th>Closing Date</th></tr>
<tr><td>CS-2026-114</td><td><a href="https://bcbid.gov.bc.ca/page.aspx/en/bpm/process_manage_extranet/91234">Boulevard Mowing and Trimming Services</a></td><td>City of Langford</td><td>2026-07-09 2:00 PM</td></tr>
<tr><td>SD61-26-07</td><td><a href="https://click.mail.example.net/ls/click?upn=SECRETTOKEN123">School Grounds Maintenance</a></td><td>School District No. 61</td><td>2026-07-14 11:00 AM</td></tr>
</table><svg><path d="M0"/></svg><img src="data:image/png;base64,AAAA"><p>Buyer contact: jo.buyer@langford.ca</p></body></html>`;

function qp(s: string): string {
  return s.replace(/=/g, '=3D').replace(/(.{70})/g, '$1=\n');
}

const EML = [
  'Return-Path: <bounce@bcbid.gov.bc.ca>',
  'Received: from mail.example by mx.google.com',
  'Delivered-To: pat.gardener@gmail.com',
  'DKIM-Signature: v=1; a=rsa-sha256; d=bcbid.gov.bc.ca;',
  '  b=abcdef',
  'ARC-Seal: i=1; cv=none',
  'Message-ID: <123@bcbid.gov.bc.ca>',
  'From: BC Bid <noreply@bcbid.gov.bc.ca>',
  'To: Pat Gardener <pat.gardener@gmail.com>',
  'Cc: office@gardens.ca',
  'Subject: BC Bid: 2 new opportunities',
  'Date: Mon, 15 Jun 2026 15:00:00 +0000',
  'MIME-Version: 1.0',
  'Content-Type: multipart/alternative; boundary="b1"',
  '',
  '--b1',
  'Content-Type: text/plain; charset=utf-8',
  'Content-Transfer-Encoding: base64',
  '',
  Buffer.from('Hello Pat, pat.gardener@gmail.com\nBoulevard Mowing https://bcbid.gov.bc.ca/x?utm_source=mail\n').toString('base64'),
  '--b1',
  'Content-Type: text/html; charset="utf-8"',
  'Content-Transfer-Encoding: quoted-printable',
  '',
  qp(HTML),
  '--b1--',
  '',
].join('\r\n');

async function toAlert(raw: string): Promise<AlertEmail> {
  const m = await simpleParser(raw);
  return { from: m.from?.text ?? '', subject: m.subject ?? '', html: typeof m.html === 'string' ? m.html : '', text: m.text ?? '', date: m.date ?? null };
}

const opts = { zone: 'America/Vancouver', now: new Date('2026-06-15T12:00:00Z') };

describe('scrubHtml', () => {
  it('removes scripts, styles, svg and data images and replaces personal details', () => {
    const out = scrubHtml(HTML);
    expect(out).not.toMatch(/<script|<style|<svg|data:image/);
    expect(out).toContain('name@gmail.com.example');
    expect(out).toContain('name@langford.ca.example');
    expect(out).not.toMatch(/361-0000|432-1111/);
    expect(out).toMatch(/250-555-0100/);
    expect(out).toContain('<th>Closing Date</th>');
    expect(out).not.toContain('SECRETTOKEN');
    for (const m of out.matchAll(/[\w.+-]+@([\w-]+(?:\.[\w-]+)+)/g)) expect(m[1]).toMatch(/\.example$/);
  });

  it('caps the output size', () => {
    expect(scrubHtml(`<p>${'x'.repeat(SCRUB_HTML_MAX * 2)}</p>`).length).toBe(SCRUB_HTML_MAX);
  });
});

describe('scrubEml', () => {
  const out = scrubEml(EML);

  it('drops routing headers and replaces the recipient', () => {
    expect(out).not.toMatch(/^(?:Received|Delivered-To|DKIM-Signature|ARC-Seal|Message-ID|Return-Path|Cc):/im);
    expect(out).toContain(`To: ${SCRUBBED_RECIPIENT}`);
    expect(out).toContain('From: BC Bid <noreply@bcbid.gov.bc.ca>');
    expect(out).toMatch(/^Subject: BC Bid: 2 new opportunities$/m);
    expect(out).toMatch(/^Date: Mon, 15 Jun 2026/m);
  });

  it('leaves no address outside .example except the sender', () => {
    const body = out.replace(/^From:.*$/m, '');
    for (const m of body.matchAll(/[\w.+-]+@([\w-]+(?:\.[\w-]+)+)/g)) expect(m[1]).toMatch(/\.example$/);
    expect(out).not.toContain('SECRETTOKEN');
    expect(out).not.toContain('utm_source');
  });

  it('keeps both parts readable and the alert reading the same', async () => {
    const before = await toAlert(EML);
    const after = await toAlert(out);
    expect(after.text).toContain('Boulevard Mowing');
    const a = parseAlertEmail(before, opts);
    const b = parseAlertEmail(after, opts);
    expect(a.length).toBe(2);
    expect(b.map((i) => [i.title, i.closing?.iso])).toEqual(a.map((i) => [i.title, i.closing?.iso]));
  });
});
