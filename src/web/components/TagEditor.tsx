import { useId, useState } from 'react';

/** Edits a list of short words or names, e.g. place names or keywords. */
export function TagEditor({
  label,
  hint,
  values,
  onChange,
  placeholder,
  disabled,
  maxLength = 80,
}: {
  label: string;
  hint?: string;
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
  maxLength?: number;
}) {
  const id = useId();
  const [draft, setDraft] = useState('');

  function add() {
    const parts = draft
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (parts.length === 0) return;
    const lower = new Set(values.map((v) => v.toLowerCase()));
    const next = [...values];
    for (const p of parts) {
      if (!lower.has(p.toLowerCase())) {
        next.push(p);
        lower.add(p.toLowerCase());
      }
    }
    onChange(next);
    setDraft('');
  }

  return (
    <fieldset className="tag-editor">
      <legend>{label}</legend>
      {hint ? (
        <p className="hint" id={`${id}-hint`}>
          {hint}
        </p>
      ) : null}
      {values.length > 0 ? (
        <ul className="tags">
          {values.map((v) => (
            <li key={v} className="tag">
              <span>{v}</span>
              <button
                type="button"
                className="tag-remove"
                disabled={disabled}
                aria-label={`Remove ${v}`}
                onClick={() => onChange(values.filter((x) => x !== v))}
              >
                <span aria-hidden="true">×</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">None yet.</p>
      )}
      <div className="tag-add">
        <label htmlFor={id} className="visually-hidden">
          Add to {label.toLowerCase()}
        </label>
        <input
          id={id}
          type="text"
          value={draft}
          maxLength={maxLength * 4}
          placeholder={placeholder ?? 'Type and press Enter'}
          disabled={disabled}
          aria-describedby={hint ? `${id}-hint` : undefined}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
        />
        <button type="button" className="btn btn-secondary" onClick={add} disabled={disabled || draft.trim() === ''}>
          Add
        </button>
      </div>
    </fieldset>
  );
}
