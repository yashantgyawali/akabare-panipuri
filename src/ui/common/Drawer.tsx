/**
 * Drawer (side sheet on desktop, bottom sheet on phones) and a confirm dialog,
 * both on the native <dialog> (focus trap, Escape, top layer for free).
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
      className={cx('ak-drawer', wide && 'ak-drawer--wide', className)}
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
        <div className="ak-drawer__panel ak-paper">
          <header className="ak-drawer__head">
            <h2 id={titleId} className="ak-drawer__title">
              {title}
            </h2>
            <IconButton label="Close" onClick={onClose} className="ak-iconbtn--ink">
              <Icon name="close" />
            </IconButton>
          </header>
          <div className="ak-drawer__body">{children}</div>
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
  cancelLabel = 'Cancel',
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
      className="ak-confirm"
      aria-labelledby={titleId}
      onClose={onCancel}
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
    >
      {open ? (
        <div className="ak-confirm__panel ak-paper">
          <h2 id={titleId} className="ak-confirm__title">
            {title}
          </h2>
          {children ? <div className="ak-confirm__body">{children}</div> : null}
          <div className="ak-confirm__actions">
            <Button variant="ghost" onClick={onCancel} autoFocus>
              {cancelLabel}
            </Button>
            <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} busy={busy}>
              {confirmLabel}
            </Button>
          </div>
        </div>
      ) : null}
    </dialog>
  );
}
