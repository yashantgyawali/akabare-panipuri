/**
 * Buttons in the Tumlet system.
 *   primary   -> tilted red CTA with a hard yellow shadow (one per screen section)
 *   leaf      -> tilted yellow CTA with a hard brown shadow
 *   secondary -> ink outline, yellow on hover
 *   danger    -> red outline (destructive)
 *   solid-danger -> filled red (confirming a destructive action)
 *   light     -> beige outline for dark scrims
 *   ghost     -> underlined text button
 */
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cx } from './hooks.ts';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'leaf' | 'secondary' | 'danger' | 'solid-danger' | 'light' | 'ghost' | 'ghost-light';
  size?: 'sm' | 'md' | 'lg';
  /** Request in flight: spinner + disabled. */
  busy?: boolean;
  block?: boolean;
  icon?: ReactNode;
}

function classesFor(variant: NonNullable<ButtonProps['variant']>, size: NonNullable<ButtonProps['size']>, block: boolean): string {
  switch (variant) {
    case 'primary':
    case 'leaf':
      return cx('btn-cta', variant === 'primary' ? 'red' : 'yellow', size === 'md' && 'btn-cta--md', size === 'sm' && 'btn-cta--sm', block && 'btn-cta--block');
    case 'ghost':
      return 'tp-link';
    case 'ghost-light':
      return 'tp-link tp-link--light';
    default:
      return cx(
        'tp-btn',
        variant === 'danger' && 'tp-btn--danger',
        variant === 'solid-danger' && 'tp-btn--solid-danger',
        variant === 'light' && 'tp-btn--light',
        size === 'sm' && 'tp-btn--sm',
        size === 'lg' && 'tp-btn--lg',
        block && 'tp-btn--block',
      );
  }
}

export function Button({ variant = 'secondary', size = 'md', busy = false, block = false, icon, className, children, disabled, type, ...rest }: ButtonProps) {
  return (
    <button
      type={type ?? 'button'}
      {...rest}
      className={cx(classesFor(variant, size, block), className)}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
    >
      {busy ? <span className="tp-spinner" aria-hidden="true" /> : icon}
      {children !== undefined && children !== null ? <span>{children}</span> : null}
    </button>
  );
}

/** Square icon button with an accessible name. */
export function IconButton({ label, children, className, badge, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; badge?: ReactNode }) {
  return (
    <button type="button" {...rest} className={cx('tp-iconbtn', className)} aria-label={label} title={label}>
      {children}
      {badge !== undefined && badge !== null ? <span className="tp-iconbtn__badge">{badge}</span> : null}
    </button>
  );
}
