import { describe, expect, it } from 'vitest';
import { openDatabase } from '../src/server/db/database.js';
import { createStore, KEYS_VERSION, recomputeKeys } from '../src/server/db/store.js';
import { organizationKey } from '../src/server/matching/geo.js';
import { sourceConfigSchema } from '../src/shared/schemas.js';

const now = new Date('2026-06-15T20:00:00Z');

describe('organization aliases (MAT-6a)', () => {
  it.each([
    ['Capital Regional District', 'crd'],
    ['CRD', 'crd'],
    ['Parks Division (CRD)', 'crd'],
    ['University of Victoria', 'uvic'],
    ['UVic Facilities Management', 'uvic'],
    ['SD61', 'sd61'],
    ['SD 61', 'sd61'],
    ['School District No. 61 (Greater Victoria)', 'sd61'],
    ['Greater Victoria School District', 'sd61'],
    ['SD62', 'sd62'],
    ['Sooke School District No 62', 'sd62'],
    ['SD63', 'sd63'],
    ['Saanich School District', 'sd63'],
    ['Capital Region Housing Corporation', 'crhc'],
    ['CRHC', 'crhc'],
    ['Capital Regional Hospital District', 'crhd'],
  ])('%s → %s', (name, key) => {
    expect(organizationKey(name)).toBe(key);
  });

  it('keeps distinct buyers apart and strips "Corporation of the"', () => {
    expect(organizationKey('Capital Region Housing Corporation')).not.toBe(organizationKey('Capital Regional District'));
    expect(organizationKey('Capital Regional Hospital District')).not.toBe(organizationKey('CRD'));
    expect(organizationKey('The Corporation of the District of Saanich')).toBe(organizationKey('District of Saanich'));
    expect(organizationKey('School District 61')).not.toBe(organizationKey('School District 62'));
  });
});

describe('stored key recompute (MAT-6b)', () => {
  it('links CRD and Capital Regional District rows and recomputes only once', () => {
    const db = openDatabase(':memory:');
    const store = createStore(db);
    store.insertSource({ id: 'a', name: 'A', kind: 'html_list', enabled: true, builtin: false, notes: '', config: sourceConfigSchema.parse({}) }, now);
    store.insertSource({ id: 'b', name: 'B', kind: 'html_list', enabled: true, builtin: false, notes: '', config: sourceConfigSchema.parse({}) }, now);
    const base = { title: 'RFQ 2026-041 Boulevard Mowing Services', url: 'https://bids.example/1', closing: { iso: '2026-07-09T21:00:00Z', precision: 'datetime' as const } };
    const first = store.upsertOpportunity('a', { ...base, externalId: '1', organization: 'Capital Regional District' }, false, now).id;
    const second = store.upsertOpportunity('b', { ...base, externalId: '2', organization: 'CRD' }, false, now).id;
    expect(store.linkDuplicate(second)).toBe(first);

    // Simulate rows saved under the old key rules.
    db.run("UPDATE opportunities SET ref_key = 'old', title_key = 'old'");
    db.run("UPDATE meta SET value = '1' WHERE key = 'keys_version'");
    expect(recomputeKeys(db)).toBe(2);
    expect(store.getMeta('keys_version')).toBe(KEYS_VERSION);
    expect(db.get<{ ref_key: string }>('SELECT ref_key FROM opportunities WHERE id = :id', { id: first })!.ref_key).toMatch(/^crd:/);

    db.run("UPDATE opportunities SET ref_key = 'hand'");
    expect(recomputeKeys(db)).toBe(0);
    expect(db.get<{ ref_key: string }>('SELECT ref_key FROM opportunities WHERE id = :id', { id: first })!.ref_key).toBe('hand');
  });
});
