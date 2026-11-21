import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ActionResult, SourceTest } from '../../shared/api.js';
import { SOURCE_KINDS, sourceConfigSchema, sourceInputSchema, type SourceConfig, type SourceRecord } from '../../shared/schemas.js';
import { slugify } from '../util/text.js';
import { ALERT_SOURCE_ID } from '../settings.js';
import { ApiError, notFound, parseBody, readUpload, stringParam, zodSentence, type RouteContext } from './util.js';

const patchSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  kind: z.enum(SOURCE_KINDS).optional(),
  enabled: z.boolean().optional(),
  notes: z.string().trim().max(1000).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});

/** Checks the config schema cannot express: a real web address and a pattern that compiles. */
function checkConfig(config: SourceConfig): void {
  if (!config.url) throw new ApiError(400, 'Please enter the web address of the listing or feed.');
  let url: URL;
  try {
    url = new URL(config.url);
  } catch {
    throw new ApiError(400, `“${config.url}” is not a valid web address.`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new ApiError(400, 'The web address must start with http:// or https://.');
  if (config.linkPattern) {
    try {
      new RegExp(config.linkPattern);
    } catch {
      throw new ApiError(400, `The link pattern “${config.linkPattern}” is not a valid regular expression.`);
    }
  }
}

function sourceId(name: string): string {
  return `${slugify(name, 40) || 'source'}-${randomBytes(3).toString('hex')}`;
}

export function registerSources(app: FastifyInstance, ctx: RouteContext): void {
  // A saved BC Bid or Bonfire alert e-mail, read on the next check by the "Bid alert e-mails" source.
  app.post('/api/alerts/import', async (req): Promise<ActionResult> => {
    const upload = await readUpload(req);
    const head = upload.content.subarray(0, 16_384).toString('utf8');
    if (!/\.eml$/i.test(upload.filename) && !/rfc822/i.test(upload.mime)) {
      throw new ApiError(400, 'Please choose a saved e-mail (.eml file). In Gmail: open the alert, ⋮ menu, “Download message”.');
    }
    if (!/^from:/im.test(head) || !/^(?:subject|date):/im.test(head)) throw new ApiError(400, 'This file does not look like a saved e-mail.');
    const { alertImportDir, store, now } = ctx.deps;
    await mkdir(alertImportDir, { recursive: true });
    // Generated name: the uploaded file name is never used on disk.
    await writeFile(join(alertImportDir, `${Date.now()}-${randomBytes(6).toString('hex')}.eml`), upload.content);
    store.updateSource(ALERT_SOURCE_ID, { enabled: true }, now());
    return { ok: true, message: `${upload.filename || 'The e-mail'} was imported. It is read on the next check.` };
  });

  const { store, now } = ctx.deps;
  const { pipeline } = ctx;

  function load(id: string): SourceRecord {
    const source = store.getSource(id);
    if (!source) throw notFound('source');
    return source;
  }

  app.get('/api/sources', async () => store.listSources());

  app.post('/api/sources', async (req) => {
    const input = parseBody(sourceInputSchema, req.body);
    checkConfig(input.config);
    return store.insertSource(
      { id: sourceId(input.name), name: input.name, kind: input.kind, enabled: input.enabled, builtin: false, notes: input.notes, config: input.config },
      now(),
    );
  });

  app.patch('/api/sources/:id', async (req) => {
    const current = load(stringParam(req, 'id'));
    const body = parseBody(patchSchema, req.body);
    if (body.kind && body.kind !== current.kind) throw new ApiError(400, 'The kind of a source cannot be changed. Add a new source instead.');
    let config: SourceConfig | undefined;
    if (body.config) {
      const merged = sourceConfigSchema.safeParse({ ...current.config, ...body.config });
      if (!merged.success) throw new ApiError(400, zodSentence(merged.error));
      config = merged.data;
      checkConfig(config);
    }
    const updated = store.updateSource(
      current.id,
      {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
        ...(body.notes !== undefined ? { notes: body.notes } : {}),
        ...(config ? { config } : {}),
      },
      now(),
    );
    if (!updated) throw notFound('source');
    return updated;
  });

  app.delete('/api/sources/:id', async (req) => {
    const current = load(stringParam(req, 'id'));
    if (current.builtin) throw new ApiError(409, 'Built-in sources can be switched off but not deleted.');
    store.deleteSource(current.id);
    return { ok: true };
  });

  app.post('/api/sources/:id/test', async (req): Promise<SourceTest> => {
    const source = load(stringParam(req, 'id'));
    const result = await pipeline.testSource(source);
    // Notices read again: the "layout may have changed" warning no longer applies.
    if (source.layoutWarning && result.status === 'ok' && result.count > 0) store.clearLayoutWarning(source.id);
    return result;
  });

  app.post('/api/sources/test', async (req): Promise<SourceTest> => {
    const input = parseBody(sourceInputSchema, req.body);
    checkConfig(input.config);
    // A stand-in record so an unsaved source can be tried exactly as it would run.
    const record: SourceRecord = {
      id: 'unsaved-test',
      name: input.name,
      kind: input.kind,
      enabled: true,
      builtin: false,
      notes: input.notes,
      config: input.config,
      lastRunAt: null,
      lastOkAt: null,
      lastStatus: 'never',
      lastMessage: '',
      lastItemCount: null,
      consecutiveFailures: 0,
      layoutWarning: '',
    };
    return pipeline.testSource(record);
  });
}
