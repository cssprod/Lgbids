import { extractText, getDocumentProxy } from 'unpdf';
import type { DocumentLink } from '../../shared/schemas.js';
import type { HttpClient } from '../http/client.js';
import { tidyParagraphs } from '../util/text.js';

/**
 * Reads the bid documents a notice links to (the actual tender or quotation
 * request). Notice pages often say only "see the documents"; the PDF is where
 * the submission address, pricing form and requirements are written.
 *
 * Reading documents is a bonus, never a requirement: anything that goes wrong
 * here gives back empty text and the rest of the run carries on.
 */

export const MAX_DOCUMENTS = 3;
export const MAX_DOCUMENT_BYTES = 15_000_000;
export const MAX_PAGES = 40;
export const MAX_CHARS = 60_000;

export interface DocumentReadResult {
  /** Text of every document that could be read, one after another. */
  text: string;
  /** How many documents were read successfully. */
  read: number;
  /** One plain sentence per document that could not be read. */
  problems: string[];
}

/** True when the link looks like a PDF file (by address or by its label). */
export function looksLikePdf(doc: DocumentLink): boolean {
  return /\.pdf(?:$|[?#])/i.test(doc.url) || /\bpdf\b/i.test(doc.name);
}

/** Extract the text of a PDF, limited to its first pages. Throws on a damaged file. */
export async function pdfText(data: Uint8Array, opts: { maxPages?: number; maxChars?: number } = {}): Promise<string> {
  const maxPages = opts.maxPages ?? MAX_PAGES;
  const maxChars = opts.maxChars ?? MAX_CHARS;
  // pdf.js may take over the buffer it is given, so it gets its own copy.
  const pdf = await getDocumentProxy(new Uint8Array(data));
  try {
    let text: string;
    if (pdf.numPages <= maxPages) {
      text = (await extractText(pdf, { mergePages: true })).text;
    } else {
      // Long documents (specifications, drawings) put the instructions to
      // bidders at the front; reading the whole file would only cost time.
      const pages: string[] = [];
      for (let n = 1; n <= maxPages; n += 1) {
        const page = await pdf.getPage(n);
        const content = await page.getTextContent();
        pages.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' '));
      }
      text = pages.join('\n');
    }
    return text.length > maxChars ? text.slice(0, maxChars) : text;
  } finally {
    await pdf.loadingTask.destroy().catch(() => undefined);
  }
}

/** Download and read up to three PDF documents. Never throws. */
export async function readDocuments(http: HttpClient, documents: DocumentLink[], opts: { maxDocuments?: number; maxBytes?: number } = {}): Promise<DocumentReadResult> {
  const maxDocuments = opts.maxDocuments ?? MAX_DOCUMENTS;
  const maxBytes = opts.maxBytes ?? MAX_DOCUMENT_BYTES;
  const result: DocumentReadResult = { text: '', read: 0, problems: [] };
  const seen = new Set<string>();
  const candidates = documents.filter((doc) => {
    if (!doc.url || seen.has(doc.url) || !looksLikePdf(doc)) return false;
    seen.add(doc.url);
    return true;
  });
  const parts: string[] = [];
  for (const doc of candidates.slice(0, maxDocuments)) {
    const label = doc.name || doc.url;
    try {
      const response = await http.get(doc.url, { accept: 'application/pdf,*/*;q=0.5', maxBytes, timeoutMs: 60_000 });
      // A "PDF" link sometimes leads to a sign-in page; only real PDFs are read.
      if (response.body.subarray(0, 1024).indexOf('%PDF') === -1) {
        result.problems.push(`“${label}” is not a PDF file, so it was not read.`);
        continue;
      }
      const text = tidyParagraphs(await pdfText(response.body));
      if (!text) {
        result.problems.push(`“${label}” has no readable text (it may be a scanned image).`);
        continue;
      }
      parts.push(text);
      result.read += 1;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      result.problems.push(`“${label}” could not be read: ${reason}`);
    }
  }
  result.text = parts.join('\n\n');
  return result;
}
