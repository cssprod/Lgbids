import { describe, expect, it } from 'vitest';
import { alertSender, parseAlertEmail, readAlertEmail, type AlertEmail } from '../src/server/sources/alerts/parse.js';

// These alert e-mails are INVENTED in the shape such notifications usually
// take (a table of notices, a card per notice behind click-tracking links, a
// plain-text list). Replace or extend them with real BC Bid and Bonfire alerts
// (trimmed, personal details changed to .example) once samples are available.

const opts = { zone: 'America/Vancouver', now: new Date('2026-06-15T12:00:00Z') };

function mail(from: string, subject: string, html: string, text = ''): AlertEmail {
  return { from, subject, html, text, date: new Date('2026-06-15T15:00:00Z') };
}

describe('alertSender', () => {
  it('recognises BC Bid and Bonfire senders only', () => {
    expect(alertSender('BC Bid <noreply@bcbid.gov.bc.ca>')).toBe('bcbid');
    expect(alertSender('Bonfire <notifications@gobonfire.com>')).toBe('bonfire');
    expect(alertSender('Euna Procurement <no-reply@euna.example>')).toBe('bonfire');
    expect(alertSender('Pat <pat@friend.example>')).toBeNull();
  });
});

describe('parseAlertEmail', () => {
  it('reads a table of notices with labelled columns (BC Bid style, invented)', () => {
    const html = `<html><body>
      <p>New opportunities matching your commodity codes:</p>
      <table>
        <tr><th>Opportunity ID</th><th>Description</th><th>Organization</th><th>Closing Date</th></tr>
        <tr><td>CS-2026-114</td><td><a href="https://bcbid.gov.bc.ca/page.aspx/en/bpm/process_manage_extranet/91234">Boulevard Mowing and Trimming Services</a></td><td>City of Langford</td><td>2026-07-09 2:00 PM</td></tr>
        <tr><td>SD61-26-07</td><td><a href="https://bcbid.gov.bc.ca/page.aspx/en/bpm/process_manage_extranet/91240">School Grounds Maintenance</a></td><td>School District No. 61 (Greater Victoria)</td><td>2026-07-14 11:00 AM</td></tr>
      </table>
      <p><a href="https://bcbid.gov.bc.ca/page.aspx/en/usr/login">Log in to BC Bid</a> · <a href="https://bcbid.example/unsubscribe">Unsubscribe</a></p>
    </body></html>`;
    const items = parseAlertEmail(mail('BC Bid <noreply@bcbid.gov.bc.ca>', 'BC Bid: 2 new opportunities', html), opts);
    expect(items.map((i) => i.title)).toEqual(['Boulevard Mowing and Trimming Services', 'School Grounds Maintenance']);
    expect(items[0]).toMatchObject({
      url: 'https://bcbid.gov.bc.ca/page.aspx/en/bpm/process_manage_extranet/91234',
      bcSource: true,
      status: 'open',
    });
    // Each cell takes its label from the column header.
    expect(items[0]!.closing).toEqual({ iso: '2026-07-09T21:00:00Z', precision: 'datetime' });
    expect(items[0]).toMatchObject({ organization: 'City of Langford', referenceNumber: 'CS-2026-114' });
    expect(items[1]).toMatchObject({ organization: 'School District No. 61 (Greater Victoria)', referenceNumber: 'SD61-26-07' });
    expect(items[1]!.closing?.iso).toBe('2026-07-14T18:00:00Z');
  });

  it('reads cards behind click-tracking links with a "View opportunity" button (Bonfire style, invented)', () => {
    const html = `<html><body>
      <h1>New public opportunity</h1>
      <div class="card">
        <p><strong>City of Victoria</strong> has posted a new opportunity.</p>
        <p><strong>Project:</strong> RFQ 26-140 Garden Bed and Hanging Basket Maintenance</p>
        <p><strong>Reference #:</strong> RFQ 26-140</p>
        <p><strong>Closes:</strong> July 9, 2026 2:00 PM PDT</p>
        <p><a href="https://u123.ct.sendgrid.example/ls/click?upn=abc">View Opportunity</a></p>
      </div>
      <p><a href="https://u123.ct.sendgrid.example/ls/click?upn=unsub">Manage your notifications</a></p>
    </body></html>`;
    const items = parseAlertEmail(mail('Bonfire <notifications@gobonfire.com>', 'New opportunity from City of Victoria', html), opts);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      title: 'RFQ 26-140 Garden Bed and Hanging Basket Maintenance',
      organization: 'City of Victoria',
      referenceNumber: 'RFQ 26-140',
      url: 'https://u123.ct.sendgrid.example/ls/click?upn=abc',
    });
    expect(items[0]!.closing).toEqual({ iso: '2026-07-09T21:00:00Z', precision: 'datetime' });
  });

  it('names the buyer from a direct portal link (Bonfire style, invented)', () => {
    const html = `<p><a href="https://saanich.bonfirehub.ca/opportunities/123456">Boulevard and Median Landscape Maintenance</a><br>Closing Date: July 20, 2026 3:00 PM</p>`;
    const [item] = parseAlertEmail(mail('Bonfire <no-reply@bonfirehub.com>', 'New opportunity', html), opts);
    expect(item).toMatchObject({ title: 'Boulevard and Median Landscape Maintenance', organization: 'District of Saanich' });
    expect(item!.closing?.iso).toBe('2026-07-20T22:00:00Z');
  });

  it('reads a plain-text alert (invented)', () => {
    const text = [
      'New opportunities on BC Bid',
      '',
      'Cemetery Grounds Maintenance',
      'Organization: District of Metchosin',
      'Closing: July 30, 2026 2:00 PM',
      'https://bcbid.gov.bc.ca/page.aspx/en/bpm/process_manage_extranet/91300',
      '',
      'To stop these e-mails: https://bcbid.example/unsubscribe',
    ].join('\n');
    const [item, ...rest] = parseAlertEmail(mail('noreply@bcbid.gov.bc.ca', 'BC Bid opportunity notification', '', text), opts);
    expect(rest).toHaveLength(0);
    expect(item).toMatchObject({ title: 'Cemetery Grounds Maintenance', organization: 'District of Metchosin' });
    expect(item!.closing?.iso).toBe('2026-07-30T21:00:00Z');
  });

  it('ignores mail from anyone else, and alerts with only boilerplate links', () => {
    expect(parseAlertEmail(mail('Pat <pat@friend.example>', 'Hi', '<a href="https://bcbid.gov.bc.ca/x/1">Lunch?</a>'), opts)).toEqual([]);
    expect(
      parseAlertEmail(mail('noreply@bcbid.gov.bc.ca', 'Your password', '<p><a href="https://bcbid.gov.bc.ca/">BC Bid</a> <a href="https://bcbid.gov.bc.ca/login">Log in</a></p>'), opts),
    ).toEqual([]);
  });
});

// COV-7 probe cases (all INVENTED, in the shapes the probes found).
describe('alert parser robustness', () => {
  const bonfire = 'Bonfire <notifications@gobonfire.com>';
  const bcbid = 'BC Bid <noreply@bcbid.gov.bc.ca>';

  it('reads a single notice behind a button nested deep in layout tables', () => {
    const html = `<html><body><table><tr><td><table><tr><td>
      <table><tr><td><h2>Parks Irrigation Upgrades</h2></td></tr>
      <tr><td><table><tr><td>City of Victoria has posted a new opportunity.</td></tr></table></td></tr>
      <tr><td><table><tr><td><table><tr><td><table><tr><td>
        <a href="https://track.mail.example.net/c/abc123">View Opportunity</a>
      </td></tr></table></td></tr></table></td></tr></table></td></tr>
      <tr><td>Closes July 21, 2026 at 2:00 PM</td></tr></table>
    </td></tr></table></td></tr></table>
    <p><a href="https://bonfire.example/unsubscribe">Unsubscribe</a></p></body></html>`;
    const items = parseAlertEmail(mail(bonfire, 'New opportunity from City of Victoria', html), opts);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ title: 'Parks Irrigation Upgrades', organization: 'City of Victoria' });
    expect(items[0]!.closing?.iso).toBe('2026-07-21T21:00:00Z');
  });

  it('reads one notice from a table row holding three links', () => {
    const html = `<table><tr><th>Opportunity ID</th><th>Title</th><th>Organization</th><th>Closing Date</th></tr>
      <tr><td><a href="https://bcbid.gov.bc.ca/page.aspx/en/bpm/process_manage_extranet/50001">CS-2026-200</a></td>
      <td><a href="https://bcbid.gov.bc.ca/page.aspx/en/bpm/process_manage_extranet/50001?tab=1">Hedge and Shrub Pruning</a></td>
      <td><a href="https://bcbid.gov.bc.ca/page.aspx/en/org/77">District of Saanich</a></td><td>2026-08-01 2:00 PM</td></tr></table>`;
    const items = parseAlertEmail(mail(bcbid, 'BC Bid: 1 new opportunity', html), opts);
    expect(items.map((i) => i.title)).toEqual(['Hedge and Shrub Pruning']);
    expect(items[0]).toMatchObject({ organization: 'District of Saanich', referenceNumber: 'CS-2026-200' });
  });

  it('trims the angle bracket and punctuation from plain-text links', () => {
    const text = 'New opportunity matching your interests:\n\nTurf Aeration Services\nClosing: August 3, 2026 2:00 PM\n<https://bcbid.gov.bc.ca/page.aspx/en/bpm/process_manage_extranet/50002>.\n';
    const [item] = parseAlertEmail(mail(bcbid, 'BC Bid opportunity notification', '', text), opts);
    expect(item?.url).toBe('https://bcbid.gov.bc.ca/page.aspx/en/bpm/process_manage_extranet/50002');
    expect(item?.title).toBe('Turf Aeration Services');
  });

  it('takes the card title, not the intro line, for an unlabelled card', () => {
    const html = `<div><p>District of Central Saanich has posted a new opportunity matching your categories.</p>
      <div><p>Snow Clearing and Sanding Services 2026</p><p>Closes August 4, 2026</p>
      <a href="https://centralsaanich.bonfirehub.ca/opportunities/1234">View</a></div></div>`;
    const items = parseAlertEmail(mail(bonfire, 'New opportunity', html), opts);
    expect(items.map((i) => i.title)).toEqual(['Snow Clearing and Sanding Services 2026']);
    expect(items[0]?.organization).toBe('District of Central Saanich');
  });

  it('gives no notices for a newsletter or a password e-mail', () => {
    const news = `<h1>The Euna Procurement newsletter</h1><p>Join our webinar on smarter sourcing.</p><a href="https://euna.example.net/blog/smarter-sourcing-tips">Read about smarter sourcing for buyers</a>`;
    expect(readAlertEmail(mail('Euna Solutions <news@euna.example>', 'Euna newsletter: November', news), opts)).toEqual({ kind: 'other', items: [] });
    const pw = `<p>Your BC Bid password was changed.</p><a href="https://bcbid.gov.bc.ca/page.aspx/en/usr/account/settings">Review your account settings</a>`;
    expect(readAlertEmail(mail(bcbid, 'BC Bid password reset', pw), opts).items).toEqual([]);
  });

  it('marks an addendum e-mail and carries the new closing date', () => {
    const html = `<table><tr><th>Opportunity ID</th><th>Description</th><th>Closing Date</th></tr>
      <tr><td>CS-2026-114</td><td><a href="https://bcbid.gov.bc.ca/page.aspx/en/bpm/process_manage_extranet/91234">Boulevard Mowing and Trimming Services</a></td><td>2026-07-16 2:00 PM</td></tr></table>`;
    const r = readAlertEmail(mail(bcbid, 'BC Bid: Addendum 2 issued, closing date extended', html), opts);
    expect(r.kind).toBe('addendum');
    expect(r.items[0]).toMatchObject({ event: 'addendum', status: 'open' });
    expect(r.items[0]!.closing?.iso).toBe('2026-07-16T21:00:00Z');
  });

  it('marks cancelled and awarded notices', () => {
    const card = (t: string) => `<div><h3>${t}</h3><p>Closing: July 9, 2026</p><a href="https://victoria.bonfirehub.ca/opportunities/777">View Opportunity</a></div>`;
    const c = readAlertEmail(mail(bonfire, 'Opportunity cancelled: Tree Planting 2026', card('Tree Planting 2026')), opts);
    expect(c.kind).toBe('cancelled');
    expect(c.items[0]).toMatchObject({ event: 'cancellation', status: 'cancelled' });
    const a = readAlertEmail(mail(bonfire, 'Award notice: Tree Planting 2026', card('Tree Planting 2026')), opts);
    expect(a.kind).toBe('award');
    expect(a.items[0]).toMatchObject({ event: 'award', status: 'awarded' });
    expect(readAlertEmail(mail(bonfire, 'New opportunity', card('Tree Planting 2026')), opts).kind).toBe('new');
  });
});

// COV-8: INVENTED samples for the national services (sender addresses use `.example`).
describe('new alert senders (COV-8)', () => {
  it('recognises CanadaBuys, bids&tenders, MERX and Biddingo', () => {
    expect(alertSender('CanadaBuys <no-reply@canadabuys.example>')).toBe('canadabuys');
    expect(alertSender('bids&tenders <notices@bidsandtenders.example>')).toBe('bidsandtenders');
    expect(alertSender('MERX <alerts@merx.example>')).toBe('merx');
    expect(alertSender('Biddingo <info@biddingo.example>')).toBe('biddingo');
  });

  const cbRow = (lang: 'en' | 'fr', title: string, ref: string, region: string) =>
    `<tr><td><a href="https://canadabuys.canada.ca/${lang}/tender-opportunities/tender-notice/${ref.toLowerCase()}">${title}</a></td><td>${ref}</td><td>${region}</td><td>2026/07/09 14:00</td></tr>`;
  const cbTable = (rows: string) =>
    `<table><tr><th>Title</th><th>Reference number</th><th>Region</th><th>Closing date</th></tr>${rows}</table>`;

  it('reads CanadaBuys in Eastern time, collapses English and French, and marks rows outside BC', () => {
    const html = cbTable(
      cbRow('en', 'Grounds maintenance, CFB Esquimalt, British Columbia', 'WS1234', 'British Columbia') +
        cbRow('fr', 'Entretien des terrains, BFC Esquimalt, Colombie-Britannique', 'WS1234', 'Colombie-Britannique') +
        cbRow('en', 'Snow removal services, Ottawa', 'WS9999', 'Ontario'),
    );
    const items = parseAlertEmail(mail('CanadaBuys <no-reply@canadabuys.example>', 'New tender notices matching your saved search', html), opts);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ title: 'Grounds maintenance, CFB Esquimalt, British Columbia', bcSource: true });
    // 14:00 Eastern (EDT) = 18:00 UTC.
    expect(items[0]!.closing?.iso).toBe('2026-07-09T18:00:00Z');
    expect(items[1]).toMatchObject({ bcSource: false });
  });

  it('takes the buyer from the bids&tenders subdomain', () => {
    const html = `<p><a href="https://sidney.bidsandtenders.ca/Module/Tenders/en/Tender/Detail/abc-123">2026-05 Parks Landscape Maintenance</a><br>Closing: July 9, 2026 2:00 PM</p>`;
    const [item] = parseAlertEmail(mail('bids&tenders <notices@bidsandtenders.example>', 'New bid opportunity', html), opts);
    expect(item).toMatchObject({ organization: 'Town of Sidney', bcSource: true });
    expect(item!.closing?.iso).toBe('2026-07-09T21:00:00Z');
  });

  it('reads MERX zone-less times as Eastern', () => {
    const html = `<p><a href="https://www.merx.com/public/solicitations/123">Landscape maintenance services for a federal site</a><br>Closing Date: 2026/07/09 14:00</p>`;
    const [item] = parseAlertEmail(mail('MERX <alerts@merx.example>', 'New opportunities', html), opts);
    expect(item!.closing?.iso).toBe('2026-07-09T18:00:00Z');
    expect(item!.bcSource).toBe(false);
  });
});
