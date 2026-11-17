import { describe, expect, it } from 'vitest';
import { alertSender, parseAlertEmail, type AlertEmail } from '../src/server/sources/alerts/parse.js';

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
