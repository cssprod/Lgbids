/**
 * A very small PDF writer for the hosted prototype, which has no server to run
 * pdfkit. It lays out headings and wrapped paragraphs in Helvetica on Letter
 * pages: enough for testers to see what the bid package contains.
 */

export interface PdfBlock {
  kind: 'title' | 'heading' | 'text' | 'small';
  text: string;
}

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 64;

// Helvetica widths (per 1000 em) for the printable ASCII range; other characters use an average.
const WIDTHS: Record<string, number> = {};
const ascii =
  ' !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~';
const asciiWidths = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];
for (let i = 0; i < ascii.length; i++) WIDTHS[ascii[i]!] = asciiWidths[i]!;

// Characters outside Latin-1 that WinAnsiEncoding still has.
const WIN_ANSI: Record<string, number> = { '–': 0x96, '—': 0x97, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '…': 0x85, '€': 0x80 };

function textWidth(text: string, size: number): number {
  let w = 0;
  for (const ch of text) w += WIDTHS[ch] ?? 556;
  return (w * size) / 1000;
}

function wrap(text: string, size: number, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/)) {
      if (!word) continue;
      const next = line ? `${line} ${word}` : word;
      if (textWidth(next, size) > width && line) {
        lines.push(line);
        line = word;
      } else {
        line = next;
      }
    }
    lines.push(line);
  }
  return lines;
}

/** Encode a string as a PDF literal string in WinAnsi bytes. */
function pdfString(text: string): number[] {
  const out: number[] = [0x28];
  for (const ch of text) {
    let code = WIN_ANSI[ch] ?? ch.codePointAt(0)!;
    if (code > 255) code = 0x3f; // "?"
    if (code === 0x28 || code === 0x29 || code === 0x5c) out.push(0x5c);
    out.push(code);
  }
  out.push(0x29);
  return out;
}

const STYLE = {
  title: { font: 'F2', size: 18, gap: 10 },
  heading: { font: 'F2', size: 12.5, gap: 8 },
  text: { font: 'F1', size: 10.5, gap: 6 },
  small: { font: 'F1', size: 9, gap: 4 },
} as const;

export function buildPdf(blocks: PdfBlock[], footer: string): Blob {
  const pages: number[][] = [];
  let page: number[] = [];
  let y = PAGE_H - MARGIN;
  const push = (s: string) => {
    for (const c of s) page.push(c.charCodeAt(0));
  };
  const newPage = () => {
    pages.push(page);
    page = [];
    y = PAGE_H - MARGIN;
  };

  for (const block of blocks) {
    const style = STYLE[block.kind];
    const leading = style.size * 1.35;
    if (block.kind === 'heading' && y < MARGIN + 80) newPage();
    if (block.kind === 'heading') y -= 6;
    for (const line of wrap(block.text, style.size, PAGE_W - 2 * MARGIN)) {
      if (y < MARGIN + leading) newPage();
      y -= leading;
      push(`BT /${style.font} ${style.size} Tf ${MARGIN} ${y.toFixed(1)} Td `);
      page.push(...pdfString(line));
      push(' Tj ET\n');
    }
    y -= style.gap;
  }
  pages.push(page);

  // Footer with page numbers.
  pages.forEach((p, i) => {
    const text = `${footer} · page ${i + 1} of ${pages.length}`;
    for (const c of `BT /F1 8 Tf ${MARGIN} 36 Td `) p.push(c.charCodeAt(0));
    p.push(...pdfString(text));
    for (const c of ' Tj ET\n') p.push(c.charCodeAt(0));
  });

  // Objects: 1 catalog, 2 pages, 3 Helvetica, 4 Helvetica-Bold, then a page + content pair per page.
  const objects: number[][] = [];
  const enc = (s: string) => Array.from(s, (c) => c.charCodeAt(0));
  const kids = pages.map((_, i) => `${5 + i * 2} 0 R`).join(' ');
  objects.push(enc('<< /Type /Catalog /Pages 2 0 R >>'));
  objects.push(enc(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`));
  objects.push(enc('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'));
  objects.push(enc('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'));
  pages.forEach((content, i) => {
    objects.push(
      enc(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${6 + i * 2} 0 R >>`),
    );
    objects.push([...enc(`<< /Length ${content.length} >>\nstream\n`), ...content, ...enc('\nendstream')]);
  });

  const bytes: number[] = enc('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n');
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(bytes.length);
    bytes.push(...enc(`${i + 1} 0 obj\n`), ...obj, ...enc('\nendobj\n'));
  });
  const xref = bytes.length;
  bytes.push(...enc(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`));
  for (const o of offsets) bytes.push(...enc(`${String(o).padStart(10, '0')} 00000 n \n`));
  bytes.push(...enc(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`));
  return new Blob([new Uint8Array(bytes)], { type: 'application/pdf' });
}
