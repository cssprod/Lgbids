import { DateTime } from 'luxon';
import PDFDocument from 'pdfkit';
import type { Profile } from '../../shared/schemas.js';
import type { OpportunityRecord } from '../contracts.js';
import { formatLocal } from '../util/dates.js';
import { collapse } from '../util/text.js';
import { companyName, legalCompanyName, letterSections, noticeLine, packageFilename, submissionWord, type LetterSection } from './templates.js';

export { packageFilename };

/**
 * The submission package as a PDF: a cover letter on letterhead, then the
 * supporting sections. Plain layout on purpose — it is read, printed and
 * filed by purchasing staff, and must survive any viewer.
 *
 * Only pdfkit's built-in Helvetica is used, so nothing has to be embedded.
 * Those fonts use the WinAnsi character set; anything outside it is replaced
 * with a plain equivalent or dropped, because pdfkit would otherwise print
 * garbage for it.
 */

type Doc = InstanceType<typeof PDFDocument>;

const MARGIN = 72;
const BODY_SIZE = 10.5;
const SMALL_SIZE = 9.5;
const TEXT_COLOR = '#111111';
const MUTED_COLOR = '#555555';
const RULE_COLOR = '#999999';

// Characters WinAnsi has beyond ASCII and Latin-1.
const WINANSI_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');
// Keyed by code point so invisible characters (odd spaces) stay readable here.
const REPLACEMENT_LIST: [number, string][] = [
  [0x00a0, ' '], [0x2002, ' '], [0x2003, ' '], [0x2009, ' '], [0x202f, ' '],
  [0x2010, '-'], [0x2011, '-'], [0x2012, '-'], [0x2212, '-'], [0x2015, '—'],
  [0x2032, "'"], [0x2033, '"'],
  [0x2190, '<-'], [0x2192, '->'], [0x2264, '<='], [0x2265, '>='], [0x2260, '!='],
  [0x2713, '*'], [0x2714, '*'], [0x25cf, '•'], [0x25aa, '•'],
  // Letters with no decomposed form to fall back on: Ł ł Đ đ ı.
  [0x0141, 'L'], [0x0142, 'l'], [0x0110, 'D'], [0x0111, 'd'], [0x0131, 'i'],
];
const REPLACEMENTS = new Map(REPLACEMENT_LIST.map(([cp, to]) => [String.fromCodePoint(cp), to]));

function encodable(ch: string): boolean {
  const c = ch.codePointAt(0) ?? 0;
  return (c >= 0x20 && c <= 0x7e) || (c >= 0xa1 && c <= 0xff) || WINANSI_EXTRA.has(ch) || ch === '\n';
}

/** Make text safe for the built-in fonts. */
export function pdfSafe(input: string): string {
  let out = '';
  for (const ch of input.replace(/\r\n?/g, '\n').normalize('NFC')) {
    if (encodable(ch)) {
      out += ch;
      continue;
    }
    const mapped = REPLACEMENTS.get(ch);
    if (mapped !== undefined) {
      out += mapped;
      continue;
    }
    if (ch === '\t' || /\s/.test(ch)) {
      out += ' ';
      continue;
    }
    // Accented letters outside Latin-1 (e.g. "ł", "ő") lose their accent rather than disappear.
    const base = ch.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
    if (base && [...base].every(encodable)) out += base;
  }
  return out;
}

interface Layout {
  doc: Doc;
  left: number;
  width: number;
}

function bottom(doc: Doc): number {
  return doc.page.height - doc.page.margins.bottom;
}

function ensureSpace(l: Layout, needed: number): void {
  if (l.doc.y + needed > bottom(l.doc)) l.doc.addPage();
  l.doc.x = l.left;
}

function paragraph(l: Layout, text: string, opts: { size?: number; font?: string; color?: string; gap?: number } = {}): void {
  const { doc } = l;
  const t = pdfSafe(text);
  doc.font(opts.font ?? 'Helvetica').fontSize(opts.size ?? BODY_SIZE).fillColor(opts.color ?? TEXT_COLOR);
  // Keep short blocks (signature lines, a two-line paragraph) on one page.
  const h = doc.heightOfString(t, { width: l.width, lineGap: 2 });
  if (h < 120) ensureSpace(l, h);
  doc.text(t, l.left, doc.y, { width: l.width, lineGap: 2 });
  doc.moveDown(opts.gap ?? 0.7);
}

function heading(l: Layout, text: string): void {
  // Never leave a heading alone at the foot of a page.
  ensureSpace(l, 60);
  l.doc.font('Helvetica-Bold').fontSize(12).fillColor(TEXT_COLOR).text(pdfSafe(text), l.left, l.doc.y, { width: l.width });
  l.doc.moveDown(0.4);
}

function bullets(l: Layout, items: string[]): void {
  const { doc } = l;
  const indent = 14;
  doc.font('Helvetica').fontSize(BODY_SIZE).fillColor(TEXT_COLOR);
  for (const item of items) {
    const t = pdfSafe(item);
    const h = doc.heightOfString(t, { width: l.width - indent, lineGap: 2 });
    ensureSpace(l, Math.min(h, 120));
    const y = doc.y;
    doc.text('•', l.left + 2, y, { width: indent, lineBreak: false });
    doc.text(t, l.left + indent, y, { width: l.width - indent, lineGap: 2 });
    doc.moveDown(0.3);
  }
  doc.x = l.left;
  doc.moveDown(0.4);
}

function table(l: Layout, columns: string[], rows: string[][]): void {
  const { doc } = l;
  const pad = 4;
  const cols = columns.map(pdfSafe);
  const body = rows.map((r) => cols.map((_, i) => pdfSafe(r[i] ?? '')));

  // Short columns ("Year", "Value") get their natural width so they never
  // wrap mid-number; the long columns share whatever room is left.
  const measure = (i: number, f: (t: string) => number) => Math.max(f(cols[i] ?? ''), ...body.map((r) => f(r[i] ?? '')));
  doc.font('Helvetica-Bold').fontSize(SMALL_SIZE);
  const headW = cols.map((c) => doc.widthOfString(c));
  doc.font('Helvetica').fontSize(SMALL_SIZE);
  const longestWord = (t: string) => Math.max(0, ...t.split(/\s+/).map((w) => doc.widthOfString(w)));
  const natural = cols.map((_, i) => Math.max(headW[i] ?? 0, measure(i, (t) => doc.widthOfString(t))) + pad * 2 + 2);
  const minimum = cols.map((_, i) => Math.min(Math.max(headW[i] ?? 0, measure(i, longestWord)) + pad * 2 + 2, l.width / 2));
  const widths = fitColumns(natural, minimum, l.width);

  const rowHeight = (cells: string[], font: string) => {
    doc.font(font).fontSize(SMALL_SIZE);
    return Math.max(...cells.map((c, i) => doc.heightOfString(c || ' ', { width: (widths[i] ?? 50) - pad * 2 }))) + pad * 2;
  };

  const drawRow = (cells: string[], font: string, shade: boolean) => {
    const h = rowHeight(cells, font);
    const y = doc.y;
    let x = l.left;
    cells.forEach((cell, i) => {
      const w = widths[i] ?? 50;
      if (shade) doc.rect(x, y, w, h).fill('#eeeeee');
      doc.rect(x, y, w, h).lineWidth(0.5).strokeColor(RULE_COLOR).stroke();
      doc.font(font).fontSize(SMALL_SIZE).fillColor(TEXT_COLOR).text(cell, x + pad, y + pad, { width: w - pad * 2 });
      x += w;
    });
    doc.x = l.left;
    doc.y = y + h;
  };

  ensureSpace(l, rowHeight(cols, 'Helvetica-Bold') + (body[0] ? rowHeight(body[0], 'Helvetica') : 0));
  drawRow(cols, 'Helvetica-Bold', true);
  for (const r of body) {
    if (doc.y + rowHeight(r, 'Helvetica') > bottom(doc)) {
      doc.addPage();
      // Repeat the header so a continued table can be read on its own.
      drawRow(cols, 'Helvetica-Bold', true);
    }
    drawRow(r, 'Helvetica', false);
  }
  doc.x = l.left;
  doc.moveDown(0.8);
}

/** Column widths that add up to `total`. */
export function fitColumns(natural: number[], minimum: number[], total: number): number[] {
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const naturalSum = sum(natural);
  if (naturalSum <= total) return natural.map((w) => w + ((total - naturalSum) * w) / naturalSum);
  const widths: number[] = natural.map(() => 0);
  let open = natural.map((_, i) => i);
  let remaining = total;
  for (;;) {
    const share = remaining / open.length;
    const fits = open.filter((i) => (natural[i] ?? 0) <= share);
    if (fits.length === 0 || fits.length === open.length) break;
    for (const i of fits) {
      widths[i] = natural[i] ?? 0;
      remaining -= widths[i];
    }
    open = open.filter((i) => !fits.includes(i));
  }
  const openNatural = sum(open.map((i) => natural[i] ?? 0));
  for (const i of open) widths[i] = Math.max(minimum[i] ?? 0, (remaining * (natural[i] ?? 0)) / openNatural);
  // Minimum widths can push the total over; shrink everything evenly if so.
  const used = sum(widths);
  return used > total ? widths.map((w) => (w * total) / used) : widths;
}

function section(l: Layout, s: LetterSection, withHeading: boolean): void {
  if (withHeading) {
    // Keep a short text-only section (the declaration and its signature lines) on one page.
    if (!s.table && !s.bullets?.length) {
      l.doc.font('Helvetica').fontSize(BODY_SIZE);
      const h = s.paragraphs.reduce((sum, p) => sum + l.doc.heightOfString(pdfSafe(p), { width: l.width, lineGap: 2 }) + 12, 30);
      if (h < 300) ensureSpace(l, h);
    }
    heading(l, s.heading);
  }
  for (const p of s.paragraphs) paragraph(l, p);
  if (s.bullets?.length) bullets(l, s.bullets);
  if (s.table && s.table.rows.length) table(l, s.table.columns, s.table.rows);
}

function letterhead(l: Layout, profile: Profile): void {
  const { doc } = l;
  const name = companyName(profile);
  if (name) doc.font('Helvetica-Bold').fontSize(16).fillColor(TEXT_COLOR).text(pdfSafe(name), l.left, doc.y, { width: l.width });
  if (profile.tradeName && profile.legalName && profile.tradeName !== profile.legalName) {
    doc.font('Helvetica').fontSize(SMALL_SIZE).fillColor(MUTED_COLOR).text(pdfSafe(profile.legalName), { width: l.width });
  }
  const cityLine = [profile.city, [profile.province, profile.postalCode].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const address = [profile.addressLine, cityLine].filter(Boolean).join(', ');
  const contact = [profile.phone, profile.email, profile.website].filter(Boolean).join('   |   ');
  doc.font('Helvetica').fontSize(SMALL_SIZE).fillColor(MUTED_COLOR);
  if (address) doc.text(pdfSafe(address), { width: l.width });
  if (contact) doc.text(pdfSafe(contact), { width: l.width });
  doc.moveDown(0.5);
  const y = doc.y;
  doc.moveTo(l.left, y).lineTo(l.left + l.width, y).lineWidth(0.75).strokeColor(RULE_COLOR).stroke();
  doc.y = y + 18;
  doc.x = l.left;
}

function addressBlock(l: Layout, opp: OpportunityRecord, opts: { zone: string; now: Date }): void {
  const date = DateTime.fromJSDate(opts.now).setZone(opts.zone).toFormat('LLLL d, yyyy');
  paragraph(l, date, { gap: 1 });
  const to = [collapse(opp.organization), opp.contactName ? `Attention: ${collapse(opp.contactName)}` : ''].filter(Boolean);
  if (to.length) paragraph(l, to.join('\n'), { gap: 1 });
  paragraph(l, `RE: ${noticeLine(opp)}`, { font: 'Helvetica-Bold', gap: 0.2 });
  const closing = opp.closesAt ? formatLocal(opp.closesAt, opp.closesAtPrecision, opts.zone) : '';
  if (closing) paragraph(l, `Closing: ${closing}`, { size: SMALL_SIZE, color: MUTED_COLOR, gap: 1 });
  else l.doc.moveDown(0.8);
}

function pageNumbers(l: Layout, footerLeft: string): void {
  const { doc } = l;
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    // Writing inside the bottom margin would otherwise make pdfkit start a new page.
    const saved = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const y = doc.page.height - MARGIN / 2 - 4;
    doc.font('Helvetica').fontSize(8).fillColor(MUTED_COLOR);
    if (footerLeft) doc.text(pdfSafe(footerLeft), l.left, y, { width: l.width * 0.75, lineBreak: false, ellipsis: true });
    doc.text(`Page ${i - range.start + 1} of ${range.count}`, l.left, y, { width: l.width, align: 'right', lineBreak: false });
    doc.page.margins.bottom = saved;
  }
}

export async function buildPackagePdf(
  opp: OpportunityRecord,
  profile: Profile,
  opts: { priceTotal: number | null; priceNotes: string; includeRates: boolean; zone: string; now: Date },
): Promise<Buffer> {
  const sections = letterSections(opp, profile, opts);
  const company = companyName(profile);
  const doc = new PDFDocument({
    size: 'LETTER',
    margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
    bufferPages: true,
    info: {
      Title: pdfSafe(`${submissionWord(opp.noticeType)} – ${noticeLine(opp)}`),
      Author: pdfSafe(legalCompanyName(profile)),
      Subject: pdfSafe(collapse(opp.organization)),
      CreationDate: opts.now,
    },
  });
  const chunks: Buffer[] = [];
  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const l: Layout = { doc, left: MARGIN, width: doc.page.width - MARGIN * 2 };
  letterhead(l, profile);
  addressBlock(l, opp, opts);

  const [cover, ...rest] = sections;
  if (cover) section(l, cover, false);
  // The cover letter stands on its own; the supporting sections start on a fresh page.
  if (rest.length) doc.addPage();
  for (const s of rest) section(l, s, true);

  pageNumbers(l, [company, collapse(opp.referenceNumber)].filter(Boolean).join(' – '));
  doc.end();
  return finished;
}
