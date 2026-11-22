import { Link } from 'react-router-dom';
import { useDocumentTitle } from '../hooks.js';
import { GLOSSARY } from '../components/Popover.js';
import { PageHeader, Section } from '../components/ui.js';

const TOPICS = [
  { id: 'start', title: 'Getting started' },
  { id: 'alerts', title: 'How bids reach Lgbids' },
  { id: 'phone', title: 'Alerts on your phone and by e-mail' },
  { id: 'csv', title: 'Download to a spreadsheet' },
  { id: 'changed', title: 'When a site may have changed' },
  { id: 'scores', title: 'What “Suitable” means' },
  { id: 'submitting', title: 'Preparing and submitting' },
  { id: 'never', title: 'What Lgbids never does' },
  { id: 'words', title: 'Bid words explained' },
];

export function HelpPage() {
  useDocumentTitle('Help');
  return (
    <>
      <PageHeader title="Help" intro={<p>How Lgbids finds bids, scores them and helps you submit them.</p>} />
      <nav aria-label="Help topics" className="section-links">
        {TOPICS.map((t) => (
          <a key={t.id} href={`#${t.id}`}>
            {t.title}
          </a>
        ))}
      </nav>

      <Section title="Getting started" id="start" className="help">
        <ol>
          <li>
            Fill in your <Link to="/profile">company profile</Link>: business details, insurance, the services you offer and three references.
            Bids only ever state what you enter there.
          </li>
          <li>
            Connect your <Link to="/settings#alerts">bid alert inbox</Link> so BC Bid and Bonfire alerts are read.
          </li>
          <li>
            Upload your insurance certificate and WorkSafeBC clearance letter under <Link to="/documents">Documents</Link>; they are attached to
            applications.
          </li>
          <li>
            Set up <Link to="/settings#email">outgoing e-mail</Link> if you want Lgbids to send e-mail submissions from your own address.
          </li>
          <li>Press “Run now” on the Today screen. After that, Lgbids checks on its own every few hours.</li>
        </ol>
      </Section>

      <Section title="How bids reach Lgbids" id="alerts" className="help">
        <p>
          Most Greater Victoria landscaping work is posted on <strong>BC Bid</strong> and on each buyer’s <strong>Bonfire</strong> portal. Those
          sites ask automated tools not to read them, and Lgbids respects that. Instead it reads the alert e-mails they send you: turn on BC Bid
          notifications for your landscaping commodities, follow each buyer on Bonfire, and connect the Gmail they arrive in. Lgbids opens that
          mailbox read-only and only looks at messages from the alert services.
        </p>
        <p>You hear only from the buyers and services you sign up with, so set up each one:</p>
        <ul>
          <li>
            <strong>BC Bid</strong>: subscribe to e-mail notifications for the grounds maintenance and landscaping commodities.
          </li>
          <li>
            <strong>Bonfire</strong>: follow the City of Victoria, the District of Saanich, the District of Central Saanich, the District of North
            Saanich and the University of Victoria.
          </li>
          <li>
            <strong>CanadaBuys</strong>: save a search for landscaping and grounds work in British Columbia with e-mail alerts, for federal work
            such as CFB Esquimalt and Parks Canada.
          </li>
          <li>
            <strong>bids&amp;tenders</strong>: follow the Town of Sidney.
          </li>
        </ul>
        <p>
          The steps, and a Gmail filter that keeps the alerts together, are under <Link to="/settings#alerts">Settings → Bid alert inbox</Link>.
        </p>
        <p>
          It also reads the District of Saanich and Township of Esquimalt bid pages directly. The <Link to="/sources">Sources</Link> page shows
          each source and whether it worked on the last check.
        </p>
      </Section>

      <Section title="Alerts on your phone and by e-mail" id="phone" className="help">
        <p>
          Lgbids can tell you about new suitable bids, closing reminders and changes to bids you pursue. Choose which of these you get by e-mail
          under <Link to="/settings#notifications">Settings → Notifications</Link>.
        </p>
        <p>
          For alerts on your phone, open <Link to="/settings#push">Settings → Phone alerts</Link>, choose ntfy or Telegram, follow the steps and
          press “Send test alert”. Both are free. Alerts are sent by Lgbids itself, so they arrive only while it is running and the computer is
          awake.
        </p>
      </Section>

      <Section title="Download to a spreadsheet" id="csv" className="help">
        <p>
          On <Link to="/opportunities">Opportunities</Link>, filter the list the way you want, then press “Download CSV”. The file opens in Excel,
          Numbers or Google Sheets and holds the bids you see, with their scores and closing dates.
        </p>
      </Section>

      <Section title="When a site may have changed" id="changed" className="help">
        <p>
          If a bid site listed bids on one check and none on the next, Lgbids shows “Check needed” on <Link to="/sources">Sources</Link> and a
          warning on Today. The site may have changed how it shows bids, so Lgbids could be missing some. Open the site and look for open bids,
          then press “Test again”. If the site simply has nothing open, the warning goes away when bids are listed again.
        </p>
      </Section>

      <Section title="What “Suitable” means" id="scores" className="help">
        <p>Every bid gets a score out of 100 from plain rules, not guesswork. It goes up when:</p>
        <ul>
          <li>the work is landscaping, grounds maintenance, mowing, planting or similar work you offer;</li>
          <li>the buyer or the site is in your service area;</li>
          <li>the bid type is one you pursue, and there is enough time left to prepare it.</li>
        </ul>
        <p>
          Bids scoring at or above your threshold (60 unless you change it in Settings) are <strong>Suitable</strong>, and Lgbids drafts an
          application for them. Bids just below go to <strong>Review</strong> for your judgement. Tap a score in the list to see the main
          reasons behind it.
        </p>
      </Section>

      <Section title="Preparing and submitting" id="submitting" className="help">
        <p>
          Each application lists what is still needed: usually the price, ticking that you have read the bid documents and any addenda, and the
          buyer’s own forms. Changes save on their own.
        </p>
        <ul>
          <li>
            <strong>E-mail bids</strong>: press “Send submission”. Lgbids shows exactly what goes to whom before anything is sent.
          </li>
          <li>
            <strong>Portal bids</strong> (BC Bid, Bonfire): download the package, upload it on the portal yourself, then mark it as submitted.
          </li>
          <li>Record the result (won or not awarded) so your records stay complete.</li>
        </ul>
      </Section>

      <Section title="What Lgbids never does" id="never" className="help">
        <ul>
          <li>It never sends a bid without your approval.</li>
          <li>It never logs in to BC Bid, Bonfire or any other portal, and never creates accounts.</li>
          <li>It never invents facts about your company: a bid only states what is in your profile.</li>
          <li>It never works around a site that asks automated tools not to read it.</li>
          <li>It never marks, moves or deletes e-mail in your inbox.</li>
        </ul>
      </Section>

      <Section title="Bid words explained" id="words" className="help">
        <dl className="glossary">
          {Object.entries(GLOSSARY).map(([term, text]) => (
            <div key={term}>
              <dt>{term === 'bid_bond' ? 'Bid bond' : term === 'performance_bond' ? 'Performance bond' : term === 'addenda' ? 'Addenda' : term}</dt>
              <dd>{text.replace(/^[^:]+: /, '').replace(/^./, (c) => c.toUpperCase())}</dd>
            </div>
          ))}
        </dl>
      </Section>
    </>
  );
}
