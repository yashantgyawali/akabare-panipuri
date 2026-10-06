/**
 * Drawer (420px right sheet; full width on phones) and a confirm dialog, both
 * on the native <dialog> (focus trap, Escape, top layer for free). Styles: overlays.css.
 */
import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';
import { Button, IconButton } from './Button.tsx';
import { Icon } from './Icon.tsx';
import { cx } from './hooks.ts';

function useModal(open: boolean) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      try {
        d.showModal();
      } catch {
        d.setAttribute('open', '');
      }
    } else if (!open && d.open) {
      d.close();
    }
  }, [open]);
  return ref;
}

export function Drawer({
  open,
  onClose,
  title,
  children,
  className,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  className?: string;
  wide?: boolean;
}) {
  const ref = useModal(open);
  const titleId = useId();
  return (
    <dialog
      ref={ref}
      className={cx('tp-sheet', wide && 'tp-sheet--wide', className)}
      aria-labelledby={titleId}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      {open ? (
        <div className="tp-drawer tp-sheet__panel">
          <header className="tp-sheet__head">
            <h2 id={titleId} className="tp-sheet__title">
              {title}
            </h2>
            <IconButton label="Close" onClick={onClose} className="tp-sheet__close">
              <Icon name="close" />
            </IconButton>
          </header>
          <div className="tp-sheet__body">{children}</div>
        </div>
      ) : null}
    </dialog>
  );
}

export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel = 'Stay',
  onConfirm,
  onCancel,
  danger,
  busy,
}: {
  open: boolean;
  title: ReactNode;
  children?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  danger?: boolean;
  busy?: boolean;
}) {
  const ref = useModal(open);
  const titleId = useId();
  return (
    <dialog
      ref={ref}
      className="tp-confirm"
      aria-labelledby={titleId}
      onClose={onCancel}
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
    >
      {open ? (
        <div className={cx('tp-dialog tp-dialog--sm', danger && 'tp-dialog--red')}>
          <h2 id={titleId} className="tp-confirm__title">
            {title}
          </h2>
          {children ? <div className="tp-confirm__body">{children}</div> : null}
          <div className="tp-confirm__actions">
            <Button variant="secondary" onClick={onCancel} autoFocus>
              {cancelLabel}
            </Button>
            <Button variant={danger ? 'solid-danger' : 'primary'} onClick={onConfirm} busy={busy}>
              {confirmLabel}
            </Button>
          </div>
        </div>
      ) : null}
    </dialog>
  );
}
