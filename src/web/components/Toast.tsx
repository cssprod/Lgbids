import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { Icon } from './Icon.js';

/**
 * Short messages after an action ("Dismissed. Undo"), shown at the bottom of
 * the screen. Successes hide after a few seconds; errors stay until closed.
 * One polite live region announces them to screen readers.
 */

export interface ToastAction {
  label: string;
  run: () => void;
}

export interface ToastInput {
  text: string;
  ok?: boolean;
  /** Actions such as Undo, shown as buttons in the toast in this order. Any of them closes it. */
  actions?: ToastAction[];
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
      if (t.ok !== false) window.setTimeout(() => close(id), t.actions?.length ? 7000 : 4000);
    },
    [close],
  );

  const value = useMemo(() => show, [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toasts" aria-live="polite" aria-atomic="false">
        {items.map((t) => (
          <div
            key={t.id}
            className={`toast ${t.ok === false ? 'toast-bad' : 'toast-ok'}${(t.actions?.length ?? 0) > 1 ? ' toast-multi' : ''}`}
            role={t.ok === false ? 'alert' : undefined}
          >
            <Icon name={t.ok === false ? 'alert' : 'check'} size={18} />
            <p>{t.text}</p>
            {t.actions?.length ? (
              <div className="toast-actions">
                {t.actions.map((a) => (
                  <button
                    key={a.label}
                    type="button"
                    className="btn btn-small btn-secondary"
                    onClick={() => {
                      a.run();
                      close(t.id);
                    }}
                  >
                    {a.label}
                  </button>
                ))}
              </div>
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
