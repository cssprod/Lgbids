import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { Icon } from './Icon.js';

/**
 * Short messages after an action ("Dismissed. Undo"), shown at the bottom of
 * the screen. Successes hide after a few seconds; errors stay until closed.
 * One polite live region announces them to screen readers.
 */

export interface ToastInput {
  text: string;
  ok?: boolean;
  /** An action such as Undo, shown as a button in the toast. */
  action?: { label: string; run: () => void };
}

interface ToastItem extends ToastInput {
  id: number;
}

const ToastContext = createContext<(t: ToastInput) => void>(() => {});

export function useToast(): (t: ToastInput) => void {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const next = useRef(1);

  const close = useCallback((id: number) => setItems((all) => all.filter((t) => t.id !== id)), []);

  const show = useCallback(
    (t: ToastInput) => {
      const id = next.current++;
      // Newest at the bottom; keep at most three on screen.
      setItems((all) => [...all.slice(-2), { ...t, id }]);
      if (t.ok !== false) window.setTimeout(() => close(id), t.action ? 7000 : 4000);
    },
    [close],
  );

  const value = useMemo(() => show, [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toasts" aria-live="polite" aria-atomic="false">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.ok === false ? 'toast-bad' : 'toast-ok'}`} role={t.ok === false ? 'alert' : undefined}>
            <Icon name={t.ok === false ? 'alert' : 'check'} size={18} />
            <p>{t.text}</p>
            {t.action ? (
              <button
                type="button"
                className="btn btn-small btn-secondary"
                onClick={() => {
                  t.action!.run();
                  close(t.id);
                }}
              >
                {t.action.label}
              </button>
            ) : null}
            <button type="button" className="toast-close" aria-label="Close message" onClick={() => close(t.id)}>
              <Icon name="close" size={16} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
