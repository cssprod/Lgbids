import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { SourceRecord } from '../../src/shared/schemas.js';
import { DEFAULT_SOURCES } from '../../src/server/sources/registry.js';

// Sources the prototype deliberately starts differently from a new install.
const START_ALLOWLIST = new Set(['email-alerts']); // enabled in the prototype so the demo shows alert e-mails

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => void data.delete(k),
    setItem: (k, v) => void data.set(k, String(v)),
  };
}

let mockSources: SourceRecord[] = [];

beforeAll(async () => {
  vi.stubGlobal('location', new URL('http://localhost/'));
  vi.stubGlobal('sessionStorage', memoryStorage());
  vi.stubGlobal('localStorage', memoryStorage());
  const { handleMock } = await import('../../src/web/mock.js');
  const res = await handleMock('GET', '/api/sources', undefined);
  mockSources = res.body as SourceRecord[];
});

describe('mock sources stay in step with DEFAULT_SOURCES', () => {
  it('lists the same sources', () => {
    expect(mockSources.map((s) => s.id).sort()).toEqual(DEFAULT_SOURCES.map((s) => s.id).sort());
  });

  for (const def of DEFAULT_SOURCES) {
    it(`matches ${def.id} on name, kind, start state and notes`, () => {
      const mock = mockSources.find((s) => s.id === def.id);
      expect(mock, def.id).toBeDefined();
      expect({ name: mock!.name, kind: mock!.kind, notes: mock!.notes }).toEqual({ name: def.name, kind: def.kind, notes: def.notes });
      if (!START_ALLOWLIST.has(def.id)) expect(mock!.enabled, def.id).toBe(def.enabled && !def.forceOff);
    });
  }
});
