import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { ActionMessage } from '../hooks.js';

// ---------------------------------------------------------------------------
// Form fields: every input gets a visible label and, if given, a hint tied to it.
// ---------------------------------------------------------------------------

interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  children: ReactElement<{ id?: string; 'aria-describedby'?: string }>;
  className?: string;
  /** Mark the label as optional for the reader. */
  optional?: boolean;
  /** What is wrong with the value and how to fix it; marks the control invalid. */
  error?: string;
}

export function Field({ label, hint, children, className, optional, error }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [error ? errorId : '', hint ? hintId : ''].filter(Boolean).join(' ') || undefined;
  const control = isValidElement(children)
    ? cloneElement(children as ReactElement<Record<string, unknown>>, { id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined })
    : children;
  return (
    <div className={`field ${className ?? ''}`}>
      <label htmlFor={id}>
        {label}
        {optional ? <span className="optional"> (optional)</span> : null}
      </label>
      {control}
      {error ? (
        <p className="field-error" id={errorId}>
          <span aria-hidden="true">✕ </span>
          {error}
        </p>
      ) : null}
      {hint ? (
        <p className="hint" id={hintId}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

interface CheckProps {
  label: ReactNode;
  hint?: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
}

export function Check({ label, hint, checked, onChange, disabled, className }: CheckProps) {
  const id = useId();
  return (
    <div className={`check ${className ?? ''}`}>
      <input
        type="checkbox"
        id={id}
        checked={checked}
        disabled={disabled}
        aria-describedby={hint ? `${id}-hint` : undefined}
        onChange={(e) => onChange(e.target.checked)}
      />
      <div>
        <label htmlFor={id}>{label}</label>
        {hint ? (
          <p className="hint" id={`${id}-hint`}>
            {hint}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** Number input that keeps an empty box as null instead of 0. */
export function NumberInput({
  value,
  onChange,
  min,
  max,
  step,
  id,
  disabled,
  placeholder,
  'aria-describedby': describedBy,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  min?: number;
  max?: number;
  step?: number | 'any';
  id?: string;
  disabled?: boolean;
  placeholder?: string;
  'aria-describedby'?: string;
}) {
  return (
    <input
      id={id}
      type="number"
      inputMode="decimal"
      value={value === null || Number.isNaN(value) ? '' : String(value)}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      placeholder={placeholder}
      aria-describedby={describedBy}
      onChange={(e) => {
        const raw = e.target.value;
        if (raw === '') onChange(null);
        else {
          const n = Number(raw);
          if (Number.isFinite(n)) onChange(n);
        }
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Status chips: a symbol plus words, so meaning never depends on colour.
// ---------------------------------------------------------------------------

export type Tone = 'good' | 'warn' | 'bad' | 'info' | 'neutral';

const TONE_SYMBOL: Record<Tone, string> = { good: '✓', warn: '!', bad: '✕', info: '•', neutral: '–' };

export function Chip({ tone, symbol, children, title }: { tone: Tone; symbol?: string; children: ReactNode; title?: string }) {
  return (
    <span className={`chip chip-${tone}`} title={title}>
      <span className="chip-symbol" aria-hidden="true">
        {symbol ?? TONE_SYMBOL[tone]}
      </span>
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Page states
// ---------------------------------------------------------------------------

export function PageHeader({ title, intro, actions }: { title: string; intro?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        {intro ? <div className="page-intro">{intro}</div> : null}
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </header>
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <p className="loading" role="status">
      <span className="spinner" aria-hidden="true" />
      {label}
    </p>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="callout callout-bad" role="alert">
      <p>
        <strong>
          <span aria-hidden="true">✕ </span>Something went wrong.
        </strong>{' '}
        {message}
      </p>
      {onRetry ? (
        <button type="button" className="btn btn-secondary" onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </div>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <p className="empty-title">{title}</p>
      {children ? <div className="empty-body">{children}</div> : null}
      {action ? <div className="empty-action">{action}</div> : null}
    </div>
  );
}

/** Polite live region for save/send results. Always rendered so screen readers pick up changes. */
export function Live({ message, className }: { message: ActionMessage | null; className?: string }) {
  return (
    <div className={`live ${className ?? ''}`} aria-live="polite" aria-atomic="true">
      {message ? (
        <p className={message.ok ? 'live-ok' : 'live-bad'} role={message.ok ? undefined : 'alert'}>
          <span aria-hidden="true">{message.ok ? '✓ ' : '✕ '}</span>
          {message.text}
        </p>
      ) : null}
    </div>
  );
}

export function Callout({ tone, title, children }: { tone: 'info' | 'warn' | 'bad' | 'good'; title?: ReactNode; children?: ReactNode }) {
  const symbol = { info: 'i', warn: '!', bad: '✕', good: '✓' }[tone];
  return (
    <div className={`callout callout-${tone}`}>
      <span className="callout-symbol" aria-hidden="true">
        {symbol}
      </span>
      <div>
        {title ? <p className="callout-title">{title}</p> : null}
        {children}
      </div>
    </div>
  );
}

export function ExternalLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
      {children}
      <span className="visually-hidden"> (opens in a new tab)</span>
      <span aria-hidden="true" className="ext">
        {' '}
        ↗
      </span>
    </a>
  );
}

export function BackLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <p className="back">
      <Link to={to}>
        <span aria-hidden="true">← </span>
        {children}
      </Link>
    </p>
  );
}

/** Plain text with blank-line paragraphs. Never rendered as HTML. */
export function PlainText({ text }: { text: string }) {
  const paras = text
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (paras.length === 0) return <p className="muted">No description was given.</p>;
  return (
    <div className="plain-text">
      {paras.map((p, i) => (
        <p key={i}>{p}</p>
      ))}
    </div>
  );
}

export function Section({ title, children, id, actions, className }: { title: string; children: ReactNode; id?: string; actions?: ReactNode; className?: string }) {
  const hid = useId();
  return (
    <section className={`card ${className ?? ''}`} aria-labelledby={hid} id={id}>
      <div className="card-head">
        <h2 id={hid}>{title}</h2>
        {actions ? <div className="card-actions">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}
