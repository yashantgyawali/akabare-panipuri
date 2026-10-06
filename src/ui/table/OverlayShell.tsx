/** The modal scrim shared by the bite, round result and game over screens (focus management + trap), and a card that flips face up. */
import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import type { ColorId } from '../../engine/types.ts';
import { Card, type FaceKind } from '../../cards/index.ts';
import { cx } from '../common/hooks.ts';

export function Overlay({ className, labelledBy, children, focusKey, dark }: { className?: string; labelledBy: string; children: ReactNode; focusKey?: string; dark?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Move focus into the overlay when it opens (or its stage changes), so keyboard users land on the choices.
    const el = ref.current;
    if (!el) return;
    const target = el.querySelector<HTMLElement>('[data-autofocus]') ?? el;
    target.focus({ preventScroll: true });
  }, [focusKey]);
  useEffect(() => {
    // Focus that lands behind the overlay (e.g. a closing drawer hands it back
    // to the covered header button) comes back in. Open dialogs and toasts sit
    // above the overlay and keep theirs.
    const el = ref.current;
    if (!el) return;
    const into = () => (el.querySelector<HTMLElement>('[data-autofocus]') ?? el).focus({ preventScroll: true });
    const pull = (e: FocusEvent) => {
      const t = e.target;
      if (!(t instanceof Element) || el.contains(t) || t.closest('dialog[open], .tp-toasts')) return;
      into();
    };
    // While a modal dialog was open the overlay couldn't take focus (the page is
    // inert); when it closes, focus often just drops to <body>: take it then.
    let timer: number | undefined;
    const closed = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const at = document.activeElement;
        if (!document.querySelector('dialog[open]') && (!at || !el.contains(at))) into();
      }, 0);
    };
    document.addEventListener('focusin', pull);
    document.addEventListener('close', closed, true);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('focusin', pull);
      document.removeEventListener('close', closed, true);
    };
  }, []);
  // aria-modal: keep Tab inside the overlay instead of wandering into the table hidden behind it.
  const trapTab = (e: KeyboardEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (e.key !== 'Tab' || !el) return;
    const items = [...el.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), [tabindex]:not([tabindex="-1"])')].filter(
      (x) => x.offsetParent !== null,
    );
    if (items.length === 0) {
      e.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const at = document.activeElement;
    if (e.shiftKey && (at === first || at === el || !el.contains(at))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (at === last || !el.contains(at))) {
      e.preventDefault();
      first.focus();
    }
  };
  return (
    <div
      ref={ref}
      className={cx('tp-scrim tp-ov', dark && 'tp-scrim--dark', className)}
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      tabIndex={-1}
      onKeyDown={trapTab}
    >
      {children}
    </div>
  );
}

/** A card that turns face up just after it appears. */
export function RevealCard({
  back,
  color,
  face,
  width,
  state,
  delay = 120,
}: {
  back: 'puri' | 'power';
  color: ColorId;
  face: FaceKind;
  width: number;
  state?: 'danger' | 'selected' | 'idle';
  delay?: number;
}) {
  const [up, setUp] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setUp(true), delay);
    return () => clearTimeout(t);
  }, [delay]);
  return <Card back={back} color={color} face={face} faceUp={up} width={width} state={state} decorative flipMs={700} />;
}
