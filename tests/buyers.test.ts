import { describe, expect, it } from 'vitest';
import { BUYERS, MUNICIPALITY_IDS } from '../src/shared/buyers.js';
import { DEFAULT_SOURCES } from '../src/server/sources/registry.js';
import { BONFIRE_BUYERS } from '../src/server/sources/alerts/parse.js';
import { normalize } from '../src/server/util/text.js';

describe('buyer registry', () => {
  it('lists all 13 municipalities', () => {
    expect(MUNICIPALITY_IDS.sort()).toEqual(
      ['centralsaanich', 'colwood', 'esquimalt', 'highlands', 'langford', 'metchosin', 'northsaanich', 'oakbay', 'saanich', 'sidney', 'sooke', 'victoria', 'viewroyal'].sort(),
    );
  });

  it('names the main public bodies', () => {
    const ids = BUYERS.map((b) => b.id);
    for (const id of ['crd', 'sd61', 'sd62', 'sd63', 'uvic', 'camosun', 'royalroads', 'islandhealth', 'bchousing', 'yyj', 'bcferries', 'dnd', 'parkscanada', 'bcministries']) expect(ids).toContain(id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('points page channels at real sources and bonfire channels at known subdomains', () => {
    const sourceIds = new Set(DEFAULT_SOURCES.map((s) => s.id));
    for (const b of BUYERS) {
      expect(b.setupHint).toMatch(/\.$/);
      for (const c of b.channels) {
        if (c.startsWith('page:')) expect(sourceIds, `${b.id} ${c}`).toContain(c.slice(5));
        if (c.startsWith('bonfire:')) expect(Object.keys(BONFIRE_BUYERS), `${b.id} ${c}`).toContain(c.slice(8));
      }
    }
  });

  it('keeps names and aliases unique after normalising', () => {
    const all = BUYERS.flatMap((b) => [b.name, ...b.aliases]).map((s) => normalize(s));
    expect(new Set(all).size).toBe(all.length);
  });
});
