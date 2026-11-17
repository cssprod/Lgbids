import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

/**
 * A small panel opened by a button: a glossary entry, the reasons behind a
 * score. Opens on click or Enter, closes on Escape, a click outside, or the
 * button again; focus stays on the button so keyboard users never get lost.
 */
export function Popover({ trigger, label, children, className }: { trigger: ReactNode; label: string; children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
    };
  }, [open]);

  return (
    <span className={`popover ${className ?? ''}`} ref={root}>
      <button type="button" className="popover-trigger" aria-expanded={open} aria-controls={id} aria-label={label} onClick={() => setOpen((o) => !o)}>
        {trigger}
      </button>
      <span id={id} role="note" className="popover-panel" hidden={!open}>
        {children}
      </span>
    </span>
  );
}

/** Plain-language meanings of procurement words a landscaper may not use every day. */
export const GLOSSARY: Record<string, string> = {
  'Request for quotations': 'RFQ: the buyer has defined the work and mainly wants your price. Usually the simplest bid to prepare.',
  'Invitation to tender': 'ITT: a formal, priced bid on fixed specifications. Usually the lowest compliant price wins, and the bid is binding once opened.',
  'Request for proposals': 'RFP: the buyer scores your approach, experience and price together. Expect to write about how you would do the work.',
  'Pre-qualification': 'RFSQ / pre-qualification: get on a list of approved contractors first; actual jobs are offered or quoted later.',
  'Standing offer / as-needed': 'You agree rates now and are called on when the buyer needs work done, with no guaranteed amount.',
  'Expression of interest': 'EOI: tell the buyer you are interested and qualified; pricing usually comes in a later stage.',
  'Request for information': 'RFI: the buyer is researching the market. It is not a bid and no contract is awarded from it.',
  'Notice of intent (not open to bids)': 'The buyer plans to award directly to one supplier. Respond only if you believe you can also do the work.',
  bid_bond: 'Bid bond: a guarantee from a surety company, sent with the bid, that you will sign the contract if you win.',
  performance_bond: 'Performance bond: a guarantee bought after winning that the work will be completed as contracted.',
  addenda: 'Addenda: changes or answers the buyer issues after the notice is posted. You must read all of them before you bid.',
};

export function Term({ name, children }: { name: string; children: ReactNode }) {
  const text = GLOSSARY[name];
  if (!text) return <>{children}</>;
  return (
    <span className="term">
      {children}
      <Popover trigger={<span aria-hidden="true">?</span>} label={`What does this mean?`} className="term-popover">
        {text}
      </Popover>
    </span>
  );
}
