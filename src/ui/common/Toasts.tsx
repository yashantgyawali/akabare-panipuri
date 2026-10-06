/** Toasts: short-lived messages (copied link, errors from the server). */
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Icon } from './Icon.tsx';
import { cx } from './hooks.ts';

export type ToastTone = 'info' | 'good' | 'error';
interface Toast {
  id: number;
  text: string;
  tone: ToastTone;
}

type Push = (text: string, tone?: ToastTone, ms?: number) => void;
const Ctx = createContext<Push>(() => {});

export const useToast = (): Push => useContext(Ctx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(1);
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const push = useCallback<Push>(
    (text, tone = 'info', ms) => {
      const id = next.current++;
      setToasts((t) => [...t.filter((x) => x.text !== text), { id, text, tone }].slice(-3));
      setTimeout(() => dismiss(id), ms ?? (tone === 'error' ? 6000 : 3200));
    },
    [dismiss],
  );
  const value = useMemo(() => push, [push]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="tp-toasts" aria-live="polite" aria-relevant="additions">
        {toasts.map((t) => (
          <div key={t.id} className={cx('tp-toast', `tp-toast--${t.tone}`)} role={t.tone === 'error' ? 'alert' : 'status'}>
            <span className="tp-toast__text">{t.text}</span>
            <button type="button" className="tp-toast__x" aria-label="Dismiss" onClick={() => dismiss(t.id)}>
              <Icon name="close" size={16} />
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
