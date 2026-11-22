import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppDeps, OpportunityRecord, Pipeline, Scheduler } from '../contracts.js';
import type { Opportunity } from '../../shared/schemas.js';

/** What every route module receives. */
export interface RouteContext {
  deps: AppDeps;
  pipeline: Pipeline;
  scheduler: Scheduler;
}

/** An error whose message is meant for the user, with the HTTP status to answer with. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const notFound = (what: string): ApiError => new ApiError(404, `That ${what} could not be found. It may have been deleted.`);

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

function sentence(text: string): string {
  const trimmed = text.trim();
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

/** Turn zod issues into one sentence that names the field(s) at fault. */
export function zodSentence(error: z.ZodError): string {
  const parts = error.issues.slice(0, 3).map((issue) => {
    const path = issue.path.map(String).join('.');
    return path ? `“${path}”: ${issue.message}` : issue.message;
  });
  const more = error.issues.length > 3 ? ` (and ${error.issues.length - 3} more)` : '';
  return sentence(`Please check ${parts.join('; ')}${more}`);
}

export function isZodError(err: unknown): err is z.ZodError {
  return err instanceof z.ZodError || (typeof err === 'object' && err !== null && (err as { name?: string }).name === 'ZodError' && Array.isArray((err as { issues?: unknown }).issues));
}

/** Validate a request body; a failure becomes a 400 with a readable sentence. */
export function parseBody<S extends z.ZodType>(schema: S, body: unknown): z.output<S> {
  const result = schema.safeParse(body ?? {});
  if (!result.success) throw new ApiError(400, zodSentence(result.error));
  return result.data;
}

/** A numeric id from the URL; anything else cannot match a row, so it is a 404. */
export function idParam(req: FastifyRequest, what: string, name = 'id'): number {
  const raw = (req.params as Record<string, string | undefined>)[name] ?? '';
  if (!/^\d{1,12}$/.test(raw)) throw notFound(what);
  return Number(raw);
}

export function stringParam(req: FastifyRequest, name: string): string {
  return (req.params as Record<string, string | undefined>)[name] ?? '';
}

export function query(req: FastifyRequest): Record<string, string | undefined> {
  const q = (req.query ?? {}) as Record<string, unknown>;
  const out: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(q)) out[key] = Array.isArray(value) ? String(value[0] ?? '') : value === undefined ? undefined : String(value);
  return out;
}

export function intQuery(value: string | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || !/^\d+$/.test(value)) return fallback;
  return Math.min(max, Math.max(min, Number(value)));
}

/** The public shape of an opportunity: the internal pipeline fields (document text and stamps) stay on the server. */
export function opportunityDto(record: OpportunityRecord | Opportunity): Opportunity {
  const {
    noticeTypeHint: _hint,
    documentText: _text,
    bcSource: _bc,
    detailFetchedAt: _detail,
    documentsReadAt: _docs,
    analysedAt: _analysed,
    notifiedAt: _notified,
    ...rest
  } = record as OpportunityRecord;
  return rest;
}

/** Display names for uploads: no folders, no control characters, a sensible length. */
export function sanitizeName(input: string | undefined | null, fallback = 'file'): string {
  const base = String(input ?? '')
    .split(/[\\/]/)
    .pop()!
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '');
  const name = base || fallback;
  return name.length > 160 ? name.slice(0, 160) : name;
}

/** A browser only gets a MIME type back that looks like one; anything else downloads as plain bytes. */
export function safeMime(input: string | undefined): string {
  const mime = (input ?? '').trim().toLowerCase();
  return /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(mime) ? mime : 'application/octet-stream';
}

/** Content-Disposition with an ASCII-only fallback name plus the UTF-8 original (RFC 6266). */
export function contentDisposition(kind: 'attachment' | 'inline', filename: string): string {
  const ascii =
    filename
      .normalize('NFKD')
      .replace(/[^\x20-\x7e]/g, '')
      .replace(/["\\;%]/g, '')
      .trim() || 'download';
  const encoded = encodeURIComponent(filename).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

/** Content-Security-Policy for downloaded files (set for every attachment response in app.ts). */
export const DOWNLOAD_CSP = "sandbox; default-src 'none'";

export function sendFile(reply: FastifyReply, kind: 'attachment' | 'inline', filename: string, mime: string, content: Buffer): FastifyReply {
  return reply
    .header('content-type', safeMime(mime))
    .header('content-disposition', contentDisposition(kind, filename))
    .header('x-content-type-options', 'nosniff')
    .header('cache-control', 'private, no-store')
    .send(content);
}

export interface Upload {
  content: Buffer;
  filename: string;
  mime: string;
  fields: Record<string, string>;
}

/** Read a multipart form with exactly one file in it (plus plain fields, in any order). */
export async function readUpload(req: FastifyRequest): Promise<Upload> {
  if (!req.isMultipart()) throw new ApiError(400, 'Please send the file as a form upload (multipart/form-data).');
  let file: { content: Buffer; filename: string; mime: string } | null = null;
  const fields: Record<string, string> = {};
  for await (const part of req.parts({ limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 20, fieldSize: 20_000 } })) {
    if (part.type === 'file') {
      file = { content: await part.toBuffer(), filename: part.filename, mime: part.mimetype };
    } else {
      fields[part.fieldname] = String(part.value ?? '');
    }
  }
  if (!file) throw new ApiError(400, 'Please choose a file to upload.');
  if (file.content.length === 0) throw new ApiError(400, 'The file is empty.');
  return { ...file, fields };
}

/** Answer for a v2 route whose work package has not landed yet. */
export function notBuilt(): never {
  throw new ApiError(501, 'Not built yet.');
}
