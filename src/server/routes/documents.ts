import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DOCUMENT_KINDS, type DocumentKind } from '../../shared/schemas.js';
import { ApiError, idParam, notFound, parseBody, readUpload, sanitizeName, sendFile, type RouteContext } from './util.js';

const expiresOn = z
  .string()
  .trim()
  .regex(/^(\d{4}-\d{2}-\d{2})?$/, 'Use the form YYYY-MM-DD, or leave it empty.');

const patchSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  kind: z.enum(DOCUMENT_KINDS).optional(),
  expiresOn: expiresOn.optional(),
  attachByDefault: z.boolean().optional(),
});

function truthy(value: string | undefined): boolean {
  return value !== undefined && /^(1|true|on|yes)$/i.test(value.trim());
}

export function registerDocuments(app: FastifyInstance, ctx: RouteContext): void {
  const { store, files, now } = ctx.deps;

  app.get('/api/documents', async () => store.listDocuments());

  app.post('/api/documents', async (req) => {
    const upload = await readUpload(req);
    const filename = sanitizeName(upload.filename, 'document');
    const kind = (upload.fields.kind?.trim() || 'other') as DocumentKind;
    if (!DOCUMENT_KINDS.includes(kind)) throw new ApiError(400, `“${kind}” is not a document type. Use one of: ${DOCUMENT_KINDS.join(', ')}.`);
    const expires = expiresOn.safeParse(upload.fields.expiresOn ?? '');
    if (!expires.success) throw new ApiError(400, 'Please give the expiry date in the form YYYY-MM-DD, or leave it empty.');
    const name = sanitizeName(upload.fields.name, filename);

    const storedName = await files.save(upload.content, filename);
    return store.addDocument(
      {
        storedName,
        name,
        filename,
        mime: upload.mime || 'application/octet-stream',
        size: upload.content.length,
        kind,
        expiresOn: expires.data,
        attachByDefault: truthy(upload.fields.attachByDefault),
      },
      now(),
    );
  });

  app.patch('/api/documents/:id', async (req) => {
    const id = idParam(req, 'document');
    if (!store.getDocument(id)) throw notFound('document');
    const body = parseBody(patchSchema, req.body);
    const updated = store.updateDocument(id, { ...body, ...(body.name !== undefined ? { name: sanitizeName(body.name) } : {}) });
    if (!updated) throw notFound('document');
    return updated;
  });

  app.delete('/api/documents/:id', async (req) => {
    const storedName = store.deleteDocument(idParam(req, 'document'));
    if (storedName === null) throw notFound('document');
    await files.remove(storedName).catch((err: unknown) => req.log.warn({ err }, 'could not remove a library document'));
    return { ok: true };
  });

  app.get('/api/documents/:id/download', async (req, reply) => {
    const doc = store.getDocument(idParam(req, 'document'));
    if (!doc) throw notFound('document');
    return sendFile(reply, 'attachment', doc.filename || doc.name, doc.mime, await files.read(doc.storedName));
  });
}
