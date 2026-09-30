/** The wordmark and the local-mode badge. */
import { isLocalMode } from '../../net/index.ts';
import { HOME } from '../router.ts';
import { cx } from './hooks.ts';

export function Wordmark({ size = 'md', link = false, className }: { size?: 'sm' | 'md' | 'xl'; link?: boolean; className?: string }) {
  const body = (
    <>
      <span className="ak-wordmark__latin">
        Akabare <span className="ak-wordmark__pani">Panipuri</span>
      </span>
      {size !== 'sm' ? (
        <span className="ak-wordmark__deva" lang="ne">
          अकबरे पानीपुरी
        </span>
      ) : null}
    </>
  );
  const cls = cx('ak-wordmark', `ak-wordmark--${size}`, className);
  return link ? (
    <a href={HOME} className={cls} aria-label="Akabare Panipuri: home">
      {body}
    </a>
  ) : (
    <span className={cls}>{body}</span>
  );
}

export function LocalBadge({ className }: { className?: string }) {
  if (!isLocalMode()) return null;
  return (
    <p className={cx('ak-localbadge', className)}>
      <span className="ak-localbadge__dot" aria-hidden="true" />
      <span>
        <strong>Offline demo:</strong> open more tabs to add players.
      </span>
    </p>
  );
}
