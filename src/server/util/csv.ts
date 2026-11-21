import { DateTime } from 'luxon';
import { opportunitiesCsv, opportunitiesCsvFilename } from '../../shared/csv.js';
import type { Opportunity } from '../../shared/schemas.js';
import { formatLocal } from './dates.js';

// The cell rules live in src/shared so the browser prototype builds the same file.
export { CSV_BOM, csvCell, decisionLabel, OPPORTUNITY_CSV_HEADERS, toCsv } from '../../shared/csv.js';

/** The opportunities spreadsheet with every date in the user's time zone. */
export function opportunitiesCsvText(items: Opportunity[], zone: string): string {
  return opportunitiesCsv(items, {
    closes: (o) => formatLocal(o.closesAt, o.closesAtPrecision, zone),
    firstSeen: (o) => formatLocal(o.firstSeenAt, 'datetime', zone),
  });
}

/** Named after the local day, so a morning export in Victoria is not dated tomorrow (UTC). */
export function opportunitiesCsvName(now: Date, zone: string): string {
  return opportunitiesCsvFilename(DateTime.fromJSDate(now).setZone(zone).toFormat('yyyy-MM-dd'));
}
