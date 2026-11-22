import { randomBytes } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import type { FileStore } from './contracts.js';

/**
 * Uploaded files on disk. The name on disk is always generated here, and only
 * names of exactly that shape are ever opened, so a name from a request can
 * never point outside the folder.
 */

const STORED_NAME = /^[0-9a-f]{16}\.[a-z0-9]{1,8}$/;

function safeExtension(originalName: string): string {
  const ext = extname(originalName).slice(1).toLowerCase();
  return /^[a-z0-9]{1,8}$/.test(ext) ? ext : 'bin';
}

export function isStoredName(name: string): boolean {
  return STORED_NAME.test(name);
}

function check(storedName: string): string {
  if (!isStoredName(storedName)) throw new Error('That file name is not one this app created.');
  return storedName;
}

export function createFileStore(dataDir: string): FileStore {
  const dir = join(dataDir, 'files');

  return {
    async save(content, originalName) {
      await mkdir(dir, { recursive: true, mode: 0o700 });
      const name = `${randomBytes(8).toString('hex')}.${safeExtension(originalName)}`;
      // 'wx' refuses to overwrite, in the near-impossible case of a repeated random name.
      await writeFile(join(dir, name), content, { flag: 'wx', mode: 0o600 });
      return name;
    },

    async read(storedName) {
      return readFile(join(dir, check(storedName)));
    },

    async remove(storedName) {
      try {
        await unlink(join(dir, check(storedName)));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    },
  };
}
