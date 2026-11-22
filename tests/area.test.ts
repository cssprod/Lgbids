import { describe, expect, it } from 'vitest';
import { assessArea, defaultRegion } from '../src/server/matching/geo.js';

const region = defaultRegion();
const area = (title: string, organization = '', bcSource = true) => assessArea({ title, organization, bcSource }, region);

describe('area fixes (MAT-5, D10)', () => {
  it('does not read an ambiguous place from a street name', () => {
    expect(area('Landscape Maintenance for Victoria Street Properties', 'Ministry of Housing').area).toBe('unknown');
    expect(area('Victoria Road Boulevard Mowing', 'City of Nanaimo').area).toBe('no');
    expect(area('Saanich Road Boulevard Mowing', 'Ministry of Transportation').area).toBe('yes');
  });

  it('lets a non-local council beat an ambiguous place', () => {
    expect(area('Victoria Park Mowing', 'Town of Victoria Lake').area).toBe('no');
  });

  it('gives unknown when the title names a core place and an excluded one', () => {
    expect(area('Highway 14 Roadside Mowing - Sooke to Port Renfrew', 'Ministry of Transportation and Transit').area).toBe('unknown');
  });

  it('keeps Juan de Fuca places outside the strict service area', () => {
    expect(area('Juan de Fuca Electoral Area - Port Renfrew Hall Grounds', 'Capital Regional District').area).toBe('no');
    expect(area('Jordan River Regional Park Trail Clearing', 'Capital Regional District').area).toBe('no');
    expect(area('Shirley Community Hall Grounds Maintenance', 'Capital Regional District').area).toBe('no');
  });

  it('marks boat-access islands unknown', () => {
    for (const t of ['Sidney Island Trail Vegetation Management', 'James Island Grounds', 'Piers Island Mowing']) {
      expect(area(t, 'BC Parks').area, t).toBe('unknown');
    }
  });

  it('knows the new local places, unambiguous ones even without a BC cue', () => {
    for (const t of ['SEAPARC Grounds Maintenance', 'Panorama Recreation Landscaping', 'Juan de Fuca Recreation Centre Fields', 'Saanich Commonwealth Place Planting', 'Crystal Pool Landscaping', 'Royal Athletic Park Turf', 'Heals Range Mowing', 'HMC Dockyard Grounds', 'Willis Point Trail Work', 'Tod Inlet Trail Work', 'Matheson Lake Park Mowing', 'Gorge Road Hospital Grounds', 'Aberdeen Hospital Grounds']) {
      expect(area(t, '', false).area, t).toBe('yes');
    }
    for (const t of ['Durrance Lake Trail', 'Deep Cove Park Grounds', 'Dean Park Mowing', 'Ardmore Golf Grounds', 'Mount Wells Park Trail']) {
      expect(area(t, 'BC Parks').area, t).toBe('yes');
    }
  });
});
