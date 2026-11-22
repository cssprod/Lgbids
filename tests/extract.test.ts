import { describe, expect, it } from 'vitest';
import { extractListing, portalFor } from '../src/server/sources/extract.js';

// Invented probe layouts modelled on common municipal bid pages (all hosts `.example`).
const now = new Date('2026-06-15T18:00:00Z');
const opts = { zone: 'America/Vancouver', now };

describe('generic page reader (COV-6)', () => {
  it('layout a: a list of posted documents with dates', () => {
    const html = `<main><h1>Bids and Tenders</h1><p>The town posts its current opportunities below. Read each document before you submit.</p><ul>
      <li><a href="/files/boulevard-mowing-2026.pdf">Boulevard Mowing 2026</a> Closing: July 9, 2026 at 2:00 PM</li>
      <li><a href="/files/tree.docx">Tree</a> Closing: July 16, 2026</li>
      <li><a href="/files/logo.pdf">Logo</a></li>
    </ul></main>`;
    const out = extractListing(html, 'https://town.example/bids', { ...opts, explain: true });
    expect(out.items.map((i) => i.title)).toEqual(['Boulevard Mowing 2026', 'Tree']);
    expect(out.items.every((i) => i.closing)).toBe(true);
    expect(out.rejected).toContainEqual(expect.objectContaining({ text: 'Logo', reason: 'document with a short name and no date' }));
  });

  it('layout b: a page that only points to a portal', () => {
    const html = `<main><h1>Bid Opportunities</h1><p>All of our bid opportunities are posted on our online portal. Register there to receive notices and to submit.</p>
      <p><a href="https://sidney.bidsandtenders.ca/Module/Tenders/en">View current bid opportunities</a></p>
      <p><a href="https://bcbid.gov.bc.ca/page.aspx/en/rfp/request_browse_public">Request for proposals on BC Bid</a></p></main>`;
    const out = extractListing(html, 'https://town.example/bids', { ...opts, explain: true });
    expect(out.items).toEqual([]);
    expect(out.notes).toContain("This page points to bids&tenders (sidney.bidsandtenders.ca); follow that buyer's alerts.");
    expect(out.portals.map((p) => p.name)).toEqual(['bids&tenders', 'BC Bid']);
    expect(out.rejected.every((r) => r.reason.startsWith('points to'))).toBe(true);
  });

  it('layout c: headings with generic Download links', () => {
    const html = `<main><h1>Current Opportunities</h1><p>Opportunities currently open for bids are listed here with their closing dates and documents.</p>
      <section><h3>Park Maintenance Services</h3><p>Closes July 9, 2026 at 2:00 PM. <a href="/docs/park.pdf">Download</a></p></section>
      <section><h3>Irrigation Repairs</h3><p>Closes July 20, 2026. <a href="/docs/irrigation.pdf">Download</a></p></section></main>`;
    const items = extractListing(html, 'https://town.example/opps', opts);
    expect(items.map((i) => i.title)).toEqual(['Park Maintenance Services', 'Irrigation Repairs']);
    expect(items.every((i) => i.closing)).toBe(true);
  });

  it('never takes an off-site portal link as a notice, even in a closing table', () => {
    const html = `<main><table><tr><th>Title</th><th>Closing</th></tr>
      <tr><td><a href="https://victoria.bonfirehub.ca/opportunities/123">RFP Park Mowing</a></td><td>July 9, 2026</td></tr></table></main>`;
    const out = extractListing(html, 'https://town.example/bids', { ...opts, explain: true });
    expect(out.items.every((i) => !i.url.includes('bonfirehub'))).toBe(true);
    expect(out.portals).toEqual([{ name: 'Bonfire', host: 'victoria.bonfirehub.ca' }]);
  });

  it('recognises portal hosts', () => {
    expect(portalFor(new URL('https://www.merx.com/x'))?.name).toBe('MERX');
    expect(portalFor(new URL('https://canadabuys.canada.ca/en'))?.name).toBe('CanadaBuys');
    expect(portalFor(new URL('https://town.example/x'))).toBeNull();
  });
});
