import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../api.js';
import type { ProfileResponse } from '../../shared/api.js';
import type { Profile, Rate, Reference } from '../../shared/schemas.js';
import { SERVICE_KEYS, SERVICE_LABELS } from '../../shared/schemas.js';
import { useAction, useDocumentTitle, useResource, useUnsavedWarning } from '../hooks.js';
import { Callout, Check, ErrorBox, Field, Live, Loading, NumberInput, PageHeader } from '../components/ui.js';

type Credentials = Profile['credentials'];
const CREDENTIAL_LABELS: Record<keyof Credentials, string> = {
  isaArborist: 'ISA Certified Arborist on staff',
  pesticideApplicator: 'BC pesticide applicator certificate',
  redSeal: 'Red Seal landscape horticulturist on staff',
  corSafety: 'COR safety certification',
  firstAid: 'Occupational first aid attendant on crews',
  irrigationCertified: 'Certified irrigation technician',
};

const TEXT_SECTIONS: { key: 'about' | 'approach' | 'safety' | 'environment' | 'team' | 'equipment'; label: string; hint: string }[] = [
  { key: 'about', label: 'About the company', hint: 'Who you are, how long you have worked, the kind of clients you serve.' },
  { key: 'approach', label: 'How you approach the work', hint: 'How you plan, schedule, supervise and keep the buyer informed.' },
  { key: 'safety', label: 'Safety', hint: 'Your safety program, training and record.' },
  { key: 'environment', label: 'Environment', hint: 'Waste, fuel, chemicals, native plants, and how you protect sensitive areas.' },
  { key: 'team', label: 'Team', hint: 'Key people and their experience.' },
  { key: 'equipment', label: 'Equipment', hint: 'Main vehicles and machines you own or can rent.' },
];

const emptyReference = (): Reference => ({ client: '', contactName: '', contactInfo: '', description: '', year: '', value: '' });
const emptyRate = (): Rate => ({ label: '', unit: '', rate: 0 });

const SECTIONS = ['Company', 'Contact and signatory', 'Registration and insurance', 'Services offered', 'Credentials', 'About your company', 'References', 'Rates'];

function sectionId(title: string): string {
  return `profile-${title.toLowerCase().replace(/[^a-z]+/g, '-')}`;
}

function Fieldset({ title, intro, children }: { title: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <fieldset className="card form-section" id={sectionId(title)}>
      <legend>{title}</legend>
      {intro ? <div className="muted small section-intro">{intro}</div> : null}
      {children}
    </fieldset>
  );
}

export function ProfilePage() {
  useDocumentTitle('Company profile');
  const res = useResource<ProfileResponse>('/api/profile');
  const [p, setP] = useState<Profile | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const save = useAction();

  useEffect(() => {
    if (res.data) {
      setP(res.data.profile);
      setMissing(res.data.missing);
    }
  }, [res.data]);

  const dirty = !!res.data && !!p && JSON.stringify(p) !== JSON.stringify(res.data.profile);
  useUnsavedWarning(dirty);

  if (res.loading && !p) return <Loading />;
  if (res.error && !p) return <ErrorBox message={res.error} onRetry={res.reload} />;
  if (!p) return null;

  const set = <K extends keyof Profile>(k: K, v: Profile[K]) => setP({ ...p, [k]: v });
  const text = (k: keyof Profile, label: string, opts: { hint?: string; type?: string; optional?: boolean; autoComplete?: string } = {}) => (
    <Field label={label} hint={opts.hint} optional={opts.optional}>
      <input
        type={opts.type ?? 'text'}
        autoComplete={opts.autoComplete}
        value={String(p[k] ?? '')}
        onChange={(e) => set(k, e.target.value as never)}
      />
    </Field>
  );

  async function submit() {
    // Empty rows added by mistake are not worth sending.
    const body: Profile = {
      ...p!,
      certifications: p!.certifications.map((c) => c.trim()).filter(Boolean),
      references: p!.references.filter((r) => Object.values(r).some((v) => v.trim() !== '')),
      rates: p!.rates.filter((r) => r.label.trim() !== ''),
    };
    const r = await save.run(() => api.put<ProfileResponse>('/api/profile', body), 'Your company profile was saved.');
    if (r) res.setData(r);
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <PageHeader
        title="Company profile"
        intro={
          <p>
            <strong>Submissions only state what you enter here.</strong> Lgbids never makes up facts about your company, so the more you fill in,
            the more complete your bids are.
          </p>
        }
      />
      <nav aria-label="Profile sections" className="section-links">
        {SECTIONS.map((t) => (
          <a key={t} href={`#${sectionId(t)}`}>
            {t}
          </a>
        ))}
      </nav>

      {missing.length > 0 ? (
        <Callout tone="warn" title="Still needed before any submission can be sent">
          <ul>
            {missing.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </Callout>
      ) : (
        <Callout tone="good" title="Your profile has everything a submission needs." />
      )}

      <Fieldset title="Company">
        <div className="grid-2">
          {text('legalName', 'Legal business name', { autoComplete: 'organization' })}
          {text('tradeName', 'Operating as', { hint: 'Leave empty if it is the same as the legal name.', optional: true })}
          {text('addressLine', 'Street address', { autoComplete: 'street-address' })}
          {text('city', 'City', { autoComplete: 'address-level2' })}
          {text('province', 'Province')}
          {text('postalCode', 'Postal code', { autoComplete: 'postal-code' })}
          {text('phone', 'Phone', { type: 'tel', autoComplete: 'tel' })}
          {text('email', 'E-mail', { type: 'email', autoComplete: 'email' })}
          {text('website', 'Website', { type: 'url', optional: true })}
          <Field label="Year established" optional>
            <NumberInput value={p.yearEstablished} min={1800} max={2100} step={1} onChange={(v) => set('yearEstablished', v === null ? null : Math.round(v))} />
          </Field>
          <Field label="Crew size" hint="Number of people who do the field work." optional>
            <NumberInput value={p.crewSize} min={0} step={1} onChange={(v) => set('crewSize', v === null ? null : Math.round(v))} />
          </Field>
        </div>
      </Fieldset>

      <Fieldset title="Contact and signatory" intro="The contact answers the buyer’s questions; the signatory signs the offer and must be able to bind the company.">
        <div className="grid-2">
          {text('contactName', 'Contact name', { autoComplete: 'name' })}
          {text('contactTitle', 'Contact title', { optional: true })}
          {text('signatoryName', 'Signatory name')}
          {text('signatoryTitle', 'Signatory title', { hint: 'For example Owner or President.' })}
        </div>
      </Fieldset>

      <Fieldset title="Registration and insurance">
        <div className="grid-2">
          {text('gstNumber', 'GST number')}
          {text('worksafeNumber', 'WorkSafeBC account number')}
          {text('businessLicence', 'Business licence(s)', { hint: 'For example “Victoria #12345; Inter-municipal licence #678”.', optional: true })}
          {text('insuranceProvider', 'Insurance company')}
          {text('insurancePolicy', 'Policy number')}
          <Field label="General liability limit (CAD)" hint="Most buyers ask for at least $2,000,000 or $5,000,000.">
            <NumberInput value={p.insuranceLiability} min={0} step={100000} onChange={(v) => set('insuranceLiability', v)} />
          </Field>
          <Field label="Insurance expiry date">
            <input type="date" value={p.insuranceExpiry} onChange={(e) => set('insuranceExpiry', e.target.value)} />
          </Field>
        </div>
        <Check label="We can get bid and performance bonds" checked={p.bondingAvailable} onChange={(v) => set('bondingAvailable', v)} />
        {p.bondingAvailable ? (
          <div className="grid-2">
            <Field label="Largest bond available (CAD)" optional>
              <NumberInput value={p.bondingLimit} min={0} step={10000} onChange={(v) => set('bondingLimit', v)} />
            </Field>
          </div>
        ) : null}
      </Fieldset>

      <Fieldset title="Services offered" intro="Lgbids scores bids higher when they ask for work you offer.">
        <div className="check-grid">
          {SERVICE_KEYS.map((k) => (
            <Check key={k} label={SERVICE_LABELS[k]} checked={p.services[k]} onChange={(v) => set('services', { ...p.services, [k]: v })} />
          ))}
        </div>
      </Fieldset>

      <Fieldset title="Credentials" intro="Tick only what your company holds now. Some bids require these.">
        <div className="check-grid">
          {(Object.keys(CREDENTIAL_LABELS) as (keyof Credentials)[]).map((k) => (
            <Check key={k} label={CREDENTIAL_LABELS[k]} checked={p.credentials[k]} onChange={(v) => set('credentials', { ...p.credentials, [k]: v })} />
          ))}
        </div>
        <ListEditor
          title="Certifications to list in submissions"
          hint="One per line, as you want it printed, for example “ISA Certified Arborist PN-1234A”."
          items={p.certifications}
          onChange={(v) => set('certifications', v)}
          addLabel="Add a certification"
        />
      </Fieldset>

      <Fieldset title="About your company" intro="These paragraphs are used in cover letters and the package. Write them once; leave any empty that you do not want used.">
        {TEXT_SECTIONS.map((s) => (
          <Field key={s.key} label={s.label} hint={s.hint} optional>
            <textarea rows={5} value={p[s.key]} onChange={(e) => set(s.key, e.target.value)} />
          </Field>
        ))}
      </Fieldset>

      <Fieldset title="References" intro="Past clients a buyer may call. Ask them first.">
        {p.references.length === 0 ? <p className="muted">No references yet. Most bids ask for three.</p> : null}
        <ol className="stack-list">
          {p.references.map((r, i) => (
            <li key={i} className="sub-card">
              <div className="sub-card-head">
                <h2 className="subheading">Reference {i + 1}</h2>
                <button type="button" className="btn btn-ghost btn-small" onClick={() => set('references', p.references.filter((_, j) => j !== i))}>
                  Remove reference {i + 1}
                </button>
              </div>
              <div className="grid-2">
                {(
                  [
                    ['client', 'Client'],
                    ['contactName', 'Contact person'],
                    ['contactInfo', 'Phone or e-mail'],
                    ['year', 'Year(s)'],
                    ['value', 'Contract value'],
                  ] as const
                ).map(([k, label]) => (
                  <Field key={k} label={label}>
                    <input type="text" value={r[k]} onChange={(e) => set('references', p.references.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)))} />
                  </Field>
                ))}
              </div>
              <Field label="Work done">
                <textarea
                  rows={2}
                  value={r.description}
                  onChange={(e) => set('references', p.references.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))}
                />
              </Field>
            </li>
          ))}
        </ol>
        {p.references.length < 20 ? (
          <button type="button" className="btn btn-secondary" onClick={() => set('references', [...p.references, emptyReference()])}>
            Add a reference
          </button>
        ) : null}
      </Fieldset>

      <Fieldset title="Rates" intro="Hourly or unit rates for bids that ask for them. Shown in the package when you choose to include them.">
        {p.rates.length === 0 ? <p className="muted">No rates yet.</p> : null}
        {p.rates.length > 0 ? (
          <div className="rate-table" role="table" aria-label="Rates">
            <div className="rate-row rate-head" role="row">
              <span role="columnheader">What</span>
              <span role="columnheader">Per</span>
              <span role="columnheader">Rate (CAD)</span>
              <span role="columnheader">
                <span className="visually-hidden">Remove</span>
              </span>
            </div>
            {p.rates.map((r, i) => (
              <div className="rate-row" role="row" key={i}>
                <span role="cell">
                  <label className="cell-label" htmlFor={`rate-label-${i}`}>
                    What
                  </label>
                  <input
                    id={`rate-label-${i}`}
                    type="text"
                    value={r.label}
                    placeholder="Labourer"
                    onChange={(e) => set('rates', p.rates.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
                  />
                </span>
                <span role="cell">
                  <label className="cell-label" htmlFor={`rate-unit-${i}`}>
                    Per
                  </label>
                  <input
                    id={`rate-unit-${i}`}
                    type="text"
                    value={r.unit}
                    placeholder="hour"
                    onChange={(e) => set('rates', p.rates.map((x, j) => (j === i ? { ...x, unit: e.target.value } : x)))}
                  />
                </span>
                <span role="cell">
                  <label className="cell-label" htmlFor={`rate-rate-${i}`}>
                    Rate (CAD)
                  </label>
                  <NumberInput
                    id={`rate-rate-${i}`}
                    value={r.rate}
                    min={0}
                    step="any"
                    onChange={(v) => set('rates', p.rates.map((x, j) => (j === i ? { ...x, rate: v ?? 0 } : x)))}
                  />
                </span>
                <span role="cell">
                  <button type="button" className="btn btn-ghost btn-small" onClick={() => set('rates', p.rates.filter((_, j) => j !== i))}>
                    Remove<span className="visually-hidden"> {r.label || `rate ${i + 1}`}</span>
                  </button>
                </span>
              </div>
            ))}
          </div>
        ) : null}
        <button type="button" className="btn btn-secondary" onClick={() => set('rates', [...p.rates, emptyRate()])}>
          Add a rate
        </button>
      </Fieldset>

      <div className="save-bar">
        <button type="submit" className="btn btn-primary" disabled={save.busy}>
          {save.busy ? 'Saving…' : 'Save profile'}
        </button>
        {dirty ? <span className="small text-warn">You have unsaved changes.</span> : null}
        <Live message={save.message} />
      </div>
    </form>
  );
}

function ListEditor({ title, hint, items, onChange, addLabel }: { title: string; hint: string; items: string[]; onChange: (v: string[]) => void; addLabel: string }) {
  return (
    <div className="list-editor">
      <h2 className="subheading">{title}</h2>
      <p className="hint">{hint}</p>
      <ul className="stack-list">
        {items.map((c, i) => (
          <li key={i} className="inline-row">
            <label className="visually-hidden" htmlFor={`cert-${i}`}>
              Certification {i + 1}
            </label>
            <input id={`cert-${i}`} type="text" value={c} maxLength={200} onChange={(e) => onChange(items.map((x, j) => (j === i ? e.target.value : x)))} />
            <button type="button" className="btn btn-ghost btn-small" onClick={() => onChange(items.filter((_, j) => j !== i))}>
              Remove<span className="visually-hidden"> certification {i + 1}</span>
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className="btn btn-secondary" onClick={() => onChange([...items, ''])}>
        {addLabel}
      </button>
    </div>
  );
}
