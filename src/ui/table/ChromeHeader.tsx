/** The table's header bar: brand (leave), round + goal + phase pill, code + Scores / Log / Rules. */
import { useEffect, useRef, useState } from 'react';
import type { PlayerView } from '../../engine/types.ts';
import { shareUrl } from '../../net/index.ts';
import { IconButton } from '../common/Button.tsx';
import { Icon } from '../common/Icon.tsx';
import { copyText, cx } from '../common/hooks.ts';
import { useToast } from '../common/Toasts.tsx';
import { PHASE_LABELS, roundText, type NameBook } from '../text.ts';
import { turnText, type DrawerName } from './Chrome.tsx';

type Drawers = Exclude<DrawerName, null>;

const NAV: { id: Drawers; label: string; icon: 'trophy' | 'scroll' | 'book' }[] = [
  { id: 'scores', label: 'Scores', icon: 'trophy' },
  { id: 'log', label: 'Log', icon: 'scroll' },
  { id: 'rules', label: 'Rules', icon: 'book' },
];

export function TableHeader({
  view,
  names,
  code,
  phone,
  onOpen,
  onLeave,
  openDrawer,
}: {
  view: PlayerView;
  names: NameBook;
  code: string;
  phone: boolean;
  onOpen: (d: Drawers) => void;
  onLeave: () => void;
  /** The drawer that is open right now (its button is highlighted). */
  openDrawer?: DrawerName;
}) {
  const toast = useToast();
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent) {
        if (e.key === 'Escape') setMenu(false);
        return;
      }
      if (!menuRef.current?.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [menu]);
  const copy = async () => {
    const ok = await copyText(shareUrl(code));
    toast(ok ? 'Invite link copied.' : shareUrl(code), ok ? 'good' : 'info');
    setMenu(false);
  };
  const share = async () => {
    setMenu(false);
    try {
      await navigator.share({ title: 'Akabare Panipuri', text: `Join my Akabare Panipuri table: ${code}`, url: shareUrl(code) });
    } catch {
      /* dismissed */
    }
  };
  const turn = turnText(view, names);
  const yourTurn = turn.startsWith('Your turn') || turn === 'Set up your stack' || turn === 'Ready when you are';
  const pill = view.phase === 'roundEnd' || view.phase === 'gameOver' ? PHASE_LABELS[view.phase] : turn;
  const goal = view.config.targetScore !== null ? `first to ${view.config.targetScore}` : 'no target';
  const open = (d: Drawers) => {
    setMenu(false);
    onOpen(d);
  };
  return (
    <header className="tp-thead">
      <button type="button" className="tp-thead__brand" onClick={onLeave} title="Leave the table">
        Akabare Panipuri
      </button>
      <div className="tp-thead__mid">
        <span className="tp-thead__round">{roundText(view.round, view.config, phone)}</span>
        <span className="tp-thead__goal">{goal}</span>
        <span className={cx('tp-thead__pill', yourTurn && 'is-you')} title={PHASE_LABELS[view.phase]}>
          <span className="tp-sr">{PHASE_LABELS[view.phase]}: </span>
          {pill}
        </span>
      </div>
      <nav className="tp-thead__nav" aria-label="Table">
        <button type="button" className="tp-thead__code" onClick={copy} title="Copy invite link" aria-label={`Game code ${code}: copy invite link`}>
          {code}
        </button>
        {NAV.map((n) => (
          <button key={n.id} type="button" className={cx('tp-thead__link', openDrawer === n.id && 'is-active')} onClick={() => open(n.id)}>
            {n.label}
          </button>
        ))}
        <div className="tp-thead__menu" ref={menuRef}>
          <IconButton label="Menu" className="tp-thead__menubtn" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
            <Icon name="dots" />
          </IconButton>
          {menu ? (
            <div className="tp-thead__list" role="menu">
              {NAV.map((n) => (
                <button key={n.id} type="button" role="menuitem" className="tp-thead__only-phone" onClick={() => open(n.id)}>
                  <Icon name={n.icon} size={18} /> {n.label}
                </button>
              ))}
              <button type="button" role="menuitem" onClick={copy}>
                <Icon name="copy" size={18} /> Copy invite link ({code})
              </button>
              {canShare ? (
                <button type="button" role="menuitem" onClick={share}>
                  <Icon name="share" size={18} /> Share the table
                </button>
              ) : null}
              <button type="button" role="menuitem" className="is-danger" onClick={() => (setMenu(false), onLeave())}>
                <Icon name="leave" size={18} /> Leave game
              </button>
            </div>
          ) : null}
        </div>
      </nav>
    </header>
  );
}
