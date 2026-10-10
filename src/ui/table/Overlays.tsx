/**
 * Full-screen moments: the Akabare bite (its own dramatic screen), the round
 * result, and game over. All are sequenced by event playback: they only open
 * once the events before them have played. The result and game over dialogs
 * live in OverlayResult.tsx / OverlayGameOver.tsx.
 */
import { useId } from 'react';
import type { Action, PlayerId, PlayerView, PowerKind } from '../../engine/types.ts';
import { Card } from '../../cards/index.ts';
import { Button } from '../common/Button.tsx';
import { cx } from '../common/hooks.ts';
import { powerName, signed, type NameBook } from '../text.ts';
import { Overlay, RevealCard } from './OverlayShell.tsx';

export { RoundEndPanel } from './OverlayResult.tsx';
export { GameOverPanel } from './OverlayGameOver.tsx';

export interface Moment {
  eaterId: PlayerId;
  owner: PlayerId;
  fromStackOf: PlayerId;
  stage: 'bitten' | 'saved' | 'failed' | 'bust';
  power?: { kind: PowerKind; owner: PlayerId };
  trapRewardTo?: PlayerId | null;
  target?: number;
}

export function AkabareMoment({
  moment,
  view,
  names,
  phone,
  busy,
  pending,
  act,
  onDismiss,
  watch,
}: {
  moment: Moment;
  view: PlayerView;
  names: NameBook;
  phone: boolean;
  busy: boolean;
  pending: string | null;
  act: (key: string, action: Action) => void;
  onDismiss: () => void;
  /** Set for everyone but the deciding eater while they decide (stage 'bitten'). */
  watch?: {
    /** The eater seems to be offline (after the presence grace period). */
    offline: boolean;
    /** Host only: hand the eater's seat to a bot so the game can go on. */
    onReplace?: () => void;
    replacing: boolean;
    /** Unused: kept so callers need not change. */
    onPeek?: () => void;
  };
}) {
  const titleId = useId();
  const you = view.youId;
  const eaterIsYou = moment.eaterId === you;
  // A bot playing your seat decides for you: you watch like everyone else.
  const youDecide = eaterIsYou && !watch;
  const ownerText =
    moment.owner === moment.eaterId ? (eaterIsYou ? 'your own' : 'their own') : moment.owner === you ? 'your' : `${names.name(moment.owner)}’s`;
  const legal = view.legal;
  const choices = moment.stage === 'bitten' && youDecide ? legal.flipPower : [];
  const canAccept = moment.stage === 'bitten' && youDecide && legal.acceptBust;
  const target = moment.target ?? view.eating?.target ?? 0;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  const reserve = (phone ? 230 : 250) + (moment.stage === 'bitten' && youDecide ? 150 : 40);
  const bigW = Math.round(Math.min(phone ? 132 : 170, Math.max(phone ? 64 : 90, (vh - reserve) * 0.7)));
  const stageClass = `tp-bite--${moment.stage}`;
  const eaterName = eaterIsYou ? 'You' : names.name(moment.eaterId);

  let headline: string;
  switch (moment.stage) {
    case 'bitten':
      headline = eaterIsYou ? `You bit ${ownerText} Akabare` : `${eaterName} bit ${ownerText} Akabare`;
      break;
    case 'saved':
      headline = 'Saved by Dahi';
      break;
    case 'failed':
      headline = moment.power && moment.power.kind !== 'dahi' ? `Not Dahi` : 'No Dahi';
      break;
    case 'bust':
      headline = `${eaterName} ${eaterIsYou ? 'bust' : 'busts'} ${signed(-target)}`;
      break;
  }

  return (
    <Overlay dark className={cx('tp-bite', stageClass)} labelledBy={titleId} focusKey={`${moment.stage}:${choices.length}`}>
      <div className="tp-bite__content">
        <div className="tp-bite__cards">
          <div className="tp-bite__card tp-bite__card--chili">
            <RevealCard back="puri" color={names.color(moment.owner)} face="akabare" width={bigW} state={moment.stage === 'saved' ? 'idle' : 'danger'} />
          </div>
          {moment.power && moment.stage !== 'bitten' ? (
            <div className="tp-bite__card">
              <RevealCard back="power" color={names.color(moment.power.owner)} face={moment.power.kind} width={Math.round(bigW * 0.74)} state={moment.power.kind === 'dahi' ? 'selected' : 'danger'} delay={60} />
            </div>
          ) : null}
        </div>
        <h2 className="tp-bite__title" id={titleId} aria-live="assertive">
          {headline}
        </h2>

        {choices.length > 0 || canAccept ? (
          <div className="tp-bite__choices">
            {choices.length > 0 ? (
              <ul className="tp-bite__powers">
                {choices.map((id) => {
                  const pw = view.players.find((x) => x.id === id)?.power;
                  const known = id === you && pw?.kind ? pw.kind : null;
                  const label = known ? (known === 'dahi' ? 'Dahi' : `not Dahi`) : names.name(id);
                  return (
                    <li key={id}>
                      <button
                        type="button"
                        className={cx('tp-bite__pick', known === 'dahi' && 'is-safe')}
                        disabled={busy}
                        aria-label={known ? `Flip your ${powerName(known)}` : `Flip ${names.name(id)}’s power`}
                        onClick={() => act(`power:${id}`, { type: 'FLIP_POWER', targetPlayerId: id })}
                        data-autofocus={id === choices[0] ? '' : undefined}
                      >
                        <Card back="power" color={names.color(id)} peek={known} badge={names.initial(id)} width={phone ? 52 : 60} decorative />
                        <span className="tp-bite__picktext">{label}</span>
                        {pending === `power:${id}` ? <span className="tp-spinner" aria-hidden="true" /> : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : null}
            {canAccept ? (
              <Button
                variant="light"
                size="lg"
                className="tp-bite__accept"
                busy={pending === 'accept'}
                disabled={busy}
                onClick={() => act('accept', { type: 'ACCEPT_BUST' })}
                data-autofocus={choices.length === 0 ? '' : undefined}
              >
                Accept the bust
              </Button>
            ) : null}
          </div>
        ) : null}

        {moment.stage === 'bitten' && watch?.offline && watch.onReplace ? (
          <div className="tp-bite__watch">
            <Button variant="light" size="sm" busy={watch.replacing} disabled={busy} onClick={watch.onReplace} data-autofocus="">
              Replace with bot
            </Button>
          </div>
        ) : null}

        {moment.stage === 'saved' ? (
          <Button variant="leaf" size="lg" onClick={onDismiss} data-autofocus="">
            Continue
          </Button>
        ) : null}
      </div>
    </Overlay>
  );
}
