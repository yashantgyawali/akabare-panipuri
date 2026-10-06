/** The wordmark ("Akabare Panipuri" + "by Tumlet") and the local-mode badge. */
import { isLocalMode } from '../../net/index.ts';
import { HOME } from '../router.ts';
import { cx } from './hooks.ts';

export function Wordmark({ link = false, byline = true, className }: { link?: boolean; byline?: boolean; className?: string; size?: 'sm' | 'md' | 'xl' }) {
  const body = (
    <>
      <span>Akabare Panipuri</span>
      {byline ? <span className="tp-brand__by">by Tumlet</span> : null}
    </>
  );
  return link ? (
    <a href={HOME} className={cx('tp-brand', className)} aria-label="Akabare Panipuri: home">
      {body}
    </a>
  ) : (
    <span className={cx('tp-brand', className)}>{body}</span>
  );
}

export function LocalBadge({ className }: { className?: string }) {
  if (!isLocalMode()) return null;
  return (
    <p className={cx('tp-localbadge', className)}>
      <span className="tp-localbadge__dot" aria-hidden="true" />
      <span>
        <strong>Offline demo:</strong> open more tabs to add players.
      </span>
    </p>
  );
}
