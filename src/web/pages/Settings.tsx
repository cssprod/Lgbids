import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api.js';
import type { ActionResult, EmailSettingsView } from '../../shared/api.js';
import type { AutomationMode, AutomationSettings, EmailSettings, NoticeType, RegionSettings } from '../../shared/schemas.js';
import { AUTOMATION_MODES, AUTOMATION_MODE_LABELS, NOTICE_TYPES, NOTICE_TYPE_LABELS } from '../../shared/schemas.js';
import { useAction, useDocumentTitle, useFormat, useResource, useUnsavedWarning } from '../hooks.js';
import { ConfirmDialog } from '../components/Dialog.js';
import { TagEditor } from '../components/TagEditor.js';
import { Callout, Check, ErrorBox, Field, Live, Loading, NumberInput, PageHeader } from '../components/ui.js';

const MODE_HINT: Record<AutomationMode, string> = {
  off: 'Nothing happens on a schedule.',
  discover: 'Checks the bid sites on a schedule and scores what it finds.',
  prepare: 'Also drafts an application for each suitable bid. You review and send. Recommended.',
  auto: 'Also sends complete e-mail submissions that pass every rule below, without asking you.',
};

const AUTO_ACK = 'I understand complete e-mail submissions will be sent to buyers without my review, as formal offers.';

export function SettingsPage() {
  useDocumentTitle('Settings');
  return (
    <>
      <PageHeader title="Settings" />
      <nav aria-label="Settings sections" className="section-links">
        <a href="#automation">Automation</a>
        <a href="#email">Outgoing e-mail</a>
        <a href="#area">Service area (advanced)</a>
      </nav>
      <AutomationForm />
      <EmailForm />
      <RegionForm />
    </>
  );
}

function num(v: number | null, fallback: number): number {
  return v === null ? fallback : v;
}

function TypeChecklist({ legend, hint, value, onChange }: { legend: string; hint: string; value: NoticeType[]; onChange: (v: NoticeType[]) => void }) {
  return (
    <fieldset className="sub-fieldset">
      <legend>{legend}</legend>
      <p className="hint">{hint}</p>
      <div className="check-grid">
        {NOTICE_TYPES.map((t) => (
          <Check
            key={t}
            label={NOTICE_TYPE_LABELS[t]}
            checked={value.includes(t)}
            onChange={(on) => onChange(on ? [...value, t] : value.filter((x) => x !== t))}
          />
        ))}
      </div>
    </fieldset>
  );
}

function AutomationForm() {
  const res = useResource<AutomationSettings>('/api/settings/automation');
  const [v, setV] = useState<AutomationSettings | null>(null);
  const [ack, setAck] = useState(false);
  const save = useAction();

  useEffect(() => {
    if (res.data) {
      setV(res.data);
      setAck(res.data.mode === 'auto');
    }
  }, [res.data]);

  const dirty = !!v && !!res.data && JSON.stringify(v) !== JSON.stringify(res.data);
  useUnsavedWarning(dirty);

  if (res.loading && !v) return <Loading />;
  if (res.error && !v) return <ErrorBox message={res.error} onRetry={res.reload} />;
  if (!v) return null;

  const set = <K extends keyof AutomationSettings>(k: K, val: AutomationSettings[K]) => setV({ ...v, [k]: val });
  const needsAck = v.mode === 'auto' && !ack;
  // Fully automatic sending is hidden for the beta. It only shows for someone
  // whose saved setting is already "auto", so they can see it and switch away.
  const savedAuto = res.data?.mode === 'auto';

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (needsAck) return;
    const r = await save.run(() => api.put<AutomationSettings>('/api/settings/automation', v), 'Automation settings saved.');
    if (r) res.setData(r);
  }

  return (
    <form className="card form-card" id="automation" aria-labelledby="automation-title" onSubmit={submit}>
      <div className="card-head">
        <h2 id="automation-title">Automation</h2>
      </div>
      <fieldset className="mode-cards">
        <legend>What should Lgbids do on its own?</legend>
        {AUTOMATION_MODES.filter((m) => m !== 'auto' || savedAuto).map((m) => (
          <label key={m} className={`mode-card ${v.mode === m ? 'selected' : ''} ${m === 'auto' ? 'mode-auto' : ''}`}>
            <input
              type="radio"
              name="mode"
              value={m}
              checked={v.mode === m}
              onChange={() => {
                set('mode', m);
                if (m !== 'auto') setAck(false);
              }}
            />
            <span className="mode-card-text">
              <strong>{AUTOMATION_MODE_LABELS[m]}</strong>
              <span className="hint">{MODE_HINT[m]}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {v.mode === 'auto' ? (
        <div className="ack-box">
          <Check label={AUTO_ACK} checked={ack} onChange={setAck} />
          <p className="hint">
            Only e-mail submissions are sent automatically, and only when every rule below is met. Portal bids always wait for you.
          </p>
        </div>
      ) : null}

      <div className="grid-3">
        <Field label="Check every (hours)" hint="Between 1 and 168.">
          <NumberInput value={v.intervalHours} min={1} max={168} step={1} onChange={(n) => set('intervalHours', num(n, 6))} />
        </Field>
        <Field label="Suitable at a score of" hint="Out of 100. Lower scores go to review.">
          <NumberInput value={v.suitableThreshold} min={0} max={100} step={1} onChange={(n) => set('suitableThreshold', Math.round(num(n, 60)))} />
        </Field>
        <Field label="Skip drafting when closing in fewer than (days)" hint="Too-close bids go to review instead.">
          <NumberInput value={v.minLeadDays} min={0} max={60} step={1} onChange={(n) => set('minLeadDays', num(n, 2))} />
        </Field>
      </div>


      {v.mode === 'auto' ? (
        <fieldset className="sub-fieldset">
          <legend>Rules for sending without review</legend>
        <p className="hint">Used only in fully automatic mode. A submission is sent only when it meets every rule.</p>
        <div className="grid-3">
          <Field label="Minimum score" hint="Out of 100.">
            <NumberInput value={v.autoSendThreshold} min={0} max={100} step={1} onChange={(n) => set('autoSendThreshold', Math.round(num(n, 75)))} />
          </Field>
          <Field label="Most sent per day" hint="Between 0 and 100.">
            <NumberInput value={v.dailySendCap} min={0} max={100} step={1} onChange={(n) => set('dailySendCap', Math.round(num(n, 5)))} />
          </Field>
          <Field label="Never send within (hours of closing)" hint="Leaves time for you to fix problems.">
            <NumberInput value={v.sendCutoffHours} min={0} max={240} step={1} onChange={(n) => set('sendCutoffHours', num(n, 4))} />
          </Field>
        </div>
        <TypeChecklist
          legend="Notice types that may be sent automatically"
          hint="Tenders and proposals usually need your own price and review, so they are off by default."
          value={v.autoSendTypes}
          onChange={(t) => set('autoSendTypes', t)}
        />
        </fieldset>
      ) : null}

      <fieldset className="sub-fieldset">
        <legend>Notifications</legend>
        <div className="grid-2">
          <Field label="Send notifications to" hint="Leave empty for no e-mail notifications." optional>
            <input type="email" value={v.notifyEmail} onChange={(e) => set('notifyEmail', e.target.value)} />
          </Field>
          <Field label="Deadline reminder (days before closing)" hint="0 turns reminders off.">
            <NumberInput value={v.deadlineReminderDays} min={0} max={30} step={1} onChange={(n) => set('deadlineReminderDays', Math.round(num(n, 3)))} />
          </Field>
        </div>
        <Check label="E-mail me when new suitable bids are found" checked={v.notifyOnNew} onChange={(b) => set('notifyOnNew', b)} />
      </fieldset>

      <details className="advanced">
        <summary>Advanced: bid types, keywords and how sites are read</summary>
        <p className="hint">The defaults suit most landscaping businesses. Change these only if Lgbids keeps missing bids or picking up the wrong ones.</p>
      <TypeChecklist
        legend="Notice types worth pursuing"
        hint="Bids of other types are marked not suitable."
        value={v.pursueTypes}
        onChange={(t) => set('pursueTypes', t)}
      />
      <fieldset className="sub-fieldset">
        <legend>Keywords</legend>
        <div className="grid-2">
          <TagEditor
            label="Always look at notices mentioning"
            hint="Words that make a notice relevant even if Lgbids would not otherwise pick it up."
            values={v.includeKeywords}
            onChange={(k) => set('includeKeywords', k)}
          />
          <TagEditor
            label="Ignore notices mentioning"
            hint="For example work you never do."
            values={v.excludeKeywords}
            onChange={(k) => set('excludeKeywords', k)}
          />
        </div>
      </fieldset>

        <fieldset className="sub-fieldset">
          <legend>How bid sites are read</legend>
        <Check
          label="Read linked bid documents (PDF)"
          hint="Finds submission instructions and requirements that are not on the notice page."
          checked={v.readDocuments}
          onChange={(b) => set('readDocuments', b)}
        />
        <Check
          label="Respect each site’s robots.txt"
          hint="Recommended. Turning this off may get Lgbids blocked."
          checked={v.respectRobots}
          onChange={(b) => set('respectRobots', b)}
        />
        <div className="grid-2">
          <Field label="Pause between requests (milliseconds)" hint="At least 250. Slower is kinder to the sites.">
            <NumberInput value={v.requestDelayMs} min={250} max={60000} step={250} onChange={(n) => set('requestDelayMs', Math.round(num(n, 1500)))} />
          </Field>
          <Field label="Browser name sent to sites (user agent)">
            <input type="text" value={v.userAgent} minLength={3} maxLength={200} onChange={(e) => set('userAgent', e.target.value)} />
          </Field>
        </div>
        </fieldset>
      </details>

      <div className="form-footer">
        <button type="submit" className="btn btn-primary" disabled={save.busy || needsAck}>
          {save.busy ? 'Saving…' : 'Save automation settings'}
        </button>
        {needsAck ? <p className="small text-warn">Tick the acknowledgement above to turn on fully automatic mode.</p> : null}
        {dirty && !needsAck ? <p className="small text-warn">You have unsaved changes.</p> : null}
        <Live message={save.message} />
      </div>
    </form>
  );
}

type EmailDraft = Omit<EmailSettings, 'verifiedAt'>;

function EmailForm() {
  const fmt = useFormat();
  const res = useResource<EmailSettingsView>('/api/settings/email');
  const [v, setV] = useState<EmailDraft | null>(null);
  const [testTo, setTestTo] = useState('');
  const save = useAction();
  const test = useAction();

  useEffect(() => {
    if (res.data) {
      const { hasPassword: _h, fromEnvironment: _f, verifiedAt: _v, ...rest } = res.data;
      setV({ ...rest, pass: '' });
    }
  }, [res.data]);

  if (res.loading && !v) return <Loading />;
  if (res.error && !v) return <ErrorBox message={res.error} onRetry={res.reload} />;
  if (!v || !res.data) return null;

  const view = res.data;
  const env = new Set(view.fromEnvironment);
  const set = <K extends keyof EmailDraft>(k: K, val: EmailDraft[K]) => setV({ ...v, [k]: val });
  const { hasPassword: _h, fromEnvironment: _f, verifiedAt: _v, ...saved } = view;
  const dirty = JSON.stringify(v) !== JSON.stringify({ ...saved, pass: '' });
  const envHint = 'Set by the server’s environment (SMTP settings), so it cannot be changed here.';

  async function submit(e: FormEvent) {
    e.preventDefault();
    const r = await save.run(() => api.put<EmailSettingsView>('/api/settings/email', { ...v, verifiedAt: view.verifiedAt }), 'E-mail settings saved.');
    if (r) res.setData(r);
  }

  async function sendTest() {
    const r = await test.run(() => api.post<ActionResult>('/api/settings/email/test', testTo.trim() ? { to: testTo.trim() } : {}));
    if (r) {
      test.setMessage({ ok: r.ok, text: r.message });
      if (r.ok) res.reload();
    }
  }

  const text = (k: 'host' | 'user' | 'fromName' | 'fromEmail' | 'replyTo', label: string, hint?: string, type = 'text') => (
    <Field label={label} hint={env.has(k) ? envHint : hint}>
      <input type={type} value={v[k]} readOnly={env.has(k)} onChange={(e) => set(k, e.target.value)} />
    </Field>
  );

  return (
    <form className="card form-card" id="email" aria-labelledby="email-title" onSubmit={submit}>
      <div className="card-head">
        <h2 id="email-title">Outgoing e-mail</h2>
      </div>
      <p className="muted">
        Lgbids sends e-mail submissions and notifications through your own mail account. Your e-mail provider lists these settings under “SMTP”
        or “outgoing mail”.
      </p>
      {view.verifiedAt ? (
        <Callout tone="good" title={`A test e-mail went through on ${fmt.dateTime(view.verifiedAt)}.`} />
      ) : (
        <Callout tone="warn" title="These settings have not been tested yet.">
          <p>Save them, then send a test e-mail to yourself.</p>
        </Callout>
      )}
      <div className="grid-2">
        {text('host', 'Mail server (SMTP host)', 'For example smtp.example.com.')}
        <Field label="Port" hint={env.has('port') ? envHint : 'Usually 587, or 465 for implicit TLS.'}>
          <NumberInput value={v.port} min={1} max={65535} step={1} disabled={env.has('port')} onChange={(n) => set('port', Math.round(num(n, 587)))} />
        </Field>
        {text('user', 'User name', 'Often your full e-mail address.')}
        <Field
          label="Password"
          hint={
            env.has('pass')
              ? envHint
              : view.hasPassword
                ? 'A password is saved. Leave this empty to keep it, or type a new one to replace it.'
                : 'For many providers this is an “app password”, not your normal password.'
          }
        >
          <input
            type="password"
            autoComplete="new-password"
            value={v.pass}
            readOnly={env.has('pass')}
            placeholder={view.hasPassword ? 'Saved' : ''}
            onChange={(e) => set('pass', e.target.value)}
          />
        </Field>
        {text('fromName', 'Sender name', 'Usually your company name.')}
        {text('fromEmail', 'Sender address', 'The address buyers see and reply to.', 'email')}
        {text('replyTo', 'Reply-to address', 'Optional. Leave empty to use the sender address.', 'email')}
      </div>
      <Check
        label="Use implicit TLS (port 465)"
        hint="Leave unticked for port 587; the connection is still encrypted when the server offers it."
        checked={v.secure}
        disabled={env.has('secure')}
        onChange={(b) => set('secure', b)}
      />
      <Check label="Send me a copy of every submission (blind copy)" checked={v.bccSelf} disabled={env.has('bccSelf')} onChange={(b) => set('bccSelf', b)} />

      <div className="form-footer">
        <button type="submit" className="btn btn-primary" disabled={save.busy || !dirty}>
          {save.busy ? 'Saving…' : 'Save e-mail settings'}
        </button>
        <Live message={save.message} />
      </div>

      <fieldset className="sub-fieldset">
        <legend>Send a test e-mail</legend>
        <div className="inline-row align-end">
          <Field label="Send it to" hint="Leave empty to send it to the sender address." optional>
            <input type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} />
          </Field>
          <button type="button" className="btn btn-secondary" onClick={sendTest} disabled={test.busy || dirty}>
            {test.busy ? 'Sending…' : 'Send test e-mail'}
          </button>
        </div>
        {dirty ? <p className="small text-warn">Save your changes first; the test uses the saved settings.</p> : null}
        <Live message={test.message} />
      </fieldset>
    </form>
  );
}

function RegionForm() {
  const res = useResource<RegionSettings>('/api/settings/region');
  const [v, setV] = useState<RegionSettings | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const save = useAction();

  useEffect(() => {
    if (res.data) setV(res.data);
  }, [res.data]);

  if (res.loading && !v) return <Loading />;
  if (res.error && !v) return <ErrorBox message={res.error} onRetry={res.reload} />;
  if (!v) return null;
  const dirty = JSON.stringify(v) !== JSON.stringify(res.data);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const r = await save.run(() => api.put<RegionSettings>('/api/settings/region', v), 'Service area saved. Bids are scored again on the next check.');
    if (r) res.setData(r);
  }

  async function reset() {
    const r = await save.run(() => api.post<RegionSettings>('/api/settings/region/reset'), 'The service area was reset to Greater Victoria.');
    if (r) res.setData(r);
    setConfirmReset(false);
  }

  return (
    <form className="card form-card" id="area" aria-labelledby="area-title" onSubmit={submit}>
      <div className="card-head">
        <h2 id="area-title">Service area</h2>
      </div>
      <p className="muted">
        Lgbids uses these names to decide whether a bid is in the area you work in. It comes set up for Greater Victoria (
        {v.places.length} places, {v.organizations.length} local buyers); most businesses never need to change it.
      </p>
      <details className="advanced" open={dirty}>
        <summary>Edit the places and buyers</summary>
      <TagEditor label="Places you work in" hint="Towns, neighbourhoods and areas, for example Saanich or Westshore." values={v.places} onChange={(p) => setV({ ...v, places: p })} />
      <TagEditor
        label="Places you do not work in"
        hint="A notice that names one of these is outside your area, even if the buyer is local."
        values={v.excludePlaces}
        onChange={(p) => setV({ ...v, excludePlaces: p })}
      />
      <TagEditor
        label="Local buyers"
        hint="Buyers whose work is always in your area, such as your municipality."
        values={v.organizations}
        maxLength={120}
        onChange={(p) => setV({ ...v, organizations: p })}
      />
      </details>
      <div className="form-footer">
        <button type="submit" className="btn btn-primary" disabled={save.busy || !dirty}>
          {save.busy ? 'Saving…' : 'Save service area'}
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => setConfirmReset(true)}>
          Reset to defaults
        </button>
        <Live message={save.message} />
      </div>
      <ConfirmDialog
        open={confirmReset}
        title="Reset the service area?"
        confirmLabel="Reset to defaults"
        danger
        busy={save.busy}
        onClose={() => setConfirmReset(false)}
        onConfirm={reset}
      >
        <p>Your lists are replaced with the built-in Greater Victoria places and buyers. Your own additions are lost.</p>
      </ConfirmDialog>
    </form>
  );
}
