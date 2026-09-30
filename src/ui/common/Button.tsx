import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cx } from './hooks.ts';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'leaf';
  size?: 'sm' | 'md' | 'lg';
  /** Request in flight: spinner + disabled. */
  busy?: boolean;
  block?: boolean;
  icon?: ReactNode;
}

export function Button({ variant = 'secondary', size = 'md', busy = false, block = false, icon, className, children, disabled, type, ...rest }: ButtonProps) {
  return (
    <button
      type={type ?? 'button'}
      {...rest}
      className={cx('ak-btn', `ak-btn--${variant}`, `ak-btn--${size}`, busy && 'ak-btn--busy', block && 'ak-btn--block', className)}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
    >
      {busy ? <span className="ak-spinner" aria-hidden="true" /> : icon}
      {children !== undefined && children !== null ? <span className="ak-btn__label">{children}</span> : null}
    </button>
  );
}

/** Square icon button with an accessible name. */
export function IconButton({ label, children, className, badge, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; badge?: ReactNode }) {
  return (
    <button type="button" {...rest} className={cx('ak-iconbtn', className)} aria-label={label} title={label}>
      {children}
      {badge !== undefined && badge !== null ? <span className="ak-iconbtn__badge">{badge}</span> : null}
    </button>
  );
}
