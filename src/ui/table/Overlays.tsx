/**
 * Full-screen moments: the Akabare bite (its own dramatic screen), the round
 * result, and game over. All are sequenced by event playback: they only open
 * once the events before them have played. The result and game over dialogs
 * live in OverlayResult.tsx / OverlayGameOver.tsx.
 */
import { useId } from 'react';
import type { ReactNode } from 'react';
import type { Action, PlayerId, PlayerView, PowerKind } from '../../engine/types.ts';
import { Card, PLAYER_PALETTE } from '../../cards/index.ts';
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
    /** Set the overlay aside to look at the table (and reach the header). */
    onPeek: () => void;
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
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1024;
  // Leave room for the choices under the chili card. Phones lay the picks out
  // in two columns (see overlays.css), desktop wraps them in rows.
  const perRow = phone ? 2 : Math.max(1, Math.floor((Math.min(760, vw - 32) - 64 + 12) / (260 + 12)));
  const rows = choices.length > 0 ? Math.ceil(choices.length / perRow) : 0;
  const rowH = phone ? 80 : 84;
  const reserve = (phone ? 250 : 270) + (moment.stage === 'bitten' && youDecide ? 90 + rows * rowH : 40);
  const bigW = Math.round(Math.min(phone ? 132 : 170, Math.max(phone ? 64 : 90, (vh - reserve) * 0.7)));
  const trap = moment.trapRewardTo;
  const stageClass = `tp-bite--${moment.stage}`;

  let headline: string;
  let sub: ReactNode = null;
  switch (moment.stage) {
    case 'bitten':
      headline = eaterIsYou ? `You bit ${ownerText} Akabare!` : `${names.name(moment.eaterId)} bit ${ownerText} Akabare…`;
      sub = youDecide ? (
        choices.length > 0 ? (
          'Only Dahi can save you now.'
        ) : (
          'No power flips left to save you…'
        )
      ) : watch?.offline ? (
        <>Waiting on {names.who(moment.eaterId)}, who seems to be offline.</>
      ) : (
        <>
          {moment.eaterId === you ? 'Your bot decides: will it find Dahi?' : 'will they find Dahi?'}
          <span className="tp-dots" aria-hidden="true">
            <span>.</span>
            <span>.</span>
            <span>.</span>
          </span>
        </>
      );
      break;
    case 'saved':
      headline = 'Saved by Dahi!';
      sub = eaterIsYou
        ? 'Cool yoghurt, calm tongue. Keep eating.'
        : moment.owner === you
          ? `Your chili is wasted: ${names.name(moment.eaterId)} is safe and keeps eating.`
          : moment.power?.owner === you
            ? `Your Dahi saved ${names.name(moment.eaterId)}, who keeps eating.`
            : `${names.name(moment.eaterId)} is safe and keeps eating.`;
      break;
    case 'failed':
      headline = moment.power?.kind === 'nayaplate' ? 'It was Naya Plate: no help now…' : moment.power ? `It’s ${powerName(moment.power.kind)}. No Dahi…` : 'No Dahi…';
      sub = eaterIsYou ? 'The chili wins this one.' : `${names.name(moment.eaterId)} is in trouble.`;
      break;
    case 'bust':
      headline = eaterIsYou ? `You bust! ${signed(-target)}` : `${names.name(moment.eaterId)} busts! ${signed(-target)}`;
      sub = trap ? (
        <>
          <strong>{names.who(trap)}</strong> {trap === you ? 'get' : 'gets'} +{view.config.trapReward} for the trap.
        </>
      ) : moment.owner === moment.eaterId ? (
        eaterIsYou ? 'Your own chili: no trap reward.' : 'Their own chili: no trap reward.'
      ) : null;
      break;
  }

  return (
    <Overlay dark className={cx('tp-bite', stageClass)} labelledBy={titleId} focusKey={`${moment.stage}:${choices.length}`}>
      <div className="tp-bite__content">
        <div className="tp-bite__cards">
          <div className="tp-bite__card tp-bite__card--chili">
            <RevealCard back="puri" color={names.color(moment.owner)} face="akabare" width={bigW} state={moment.stage === 'saved' ? 'idle' : 'danger'} />
            <span className="tp-bite__owner" style={{ ['--c' as string]: PLAYER_PALETTE[names.color(moment.owner)].base }}>
              {moment.owner === you ? 'Your' : `${names.name(moment.owner)}’s`} Akabare
            </span>
          </div>
          {moment.power && moment.stage !== 'bitten' ? (
            <div className="tp-bite__card">
              <RevealCard back="power" color={names.color(moment.power.owner)} face={moment.power.kind} width={Math.round(bigW * 0.74)} state={moment.power.kind === 'dahi' ? 'selected' : 'danger'} delay={60} />
              <span className="tp-bite__owner" style={{ ['--c' as string]: PLAYER_PALETTE[names.color(moment.power.owner)].base }}>
                {moment.power.owner === you ? 'Your' : `${names.name(moment.power.owner)}’s`} {powerName(moment.power.kind)}
              </span>
            </div>
          ) : null}
        </div>
        <h2 className="tp-bite__title" id={titleId} aria-live="assertive">
          {headline}
        </h2>
        {sub ? <p className="tp-bite__sub">{sub}</p> : null}

        {choices.length > 0 || canAccept ? (
          <div className="tp-bite__choices">
            {choices.length > 0 ? (
              <>
                <h3 className="tp-bite__choose">Flip a power and pray for Dahi</h3>
                <ul className="tp-bite__powers">
                  {choices.map((id) => {
                    const p = view.players.find((x) => x.id === id);
                    const pw = p?.power;
                    const known = id === you && pw?.kind ? pw.kind : null;
                    const who = known ? `Your ${powerName(known)}` : `${names.name(id)}’s power`;
                    const what = known ? (known === 'dahi' ? 'safe!' : 'won’t save you') : 'blind gamble';
                    return (
                      <li key={id}>
                        <button
                          type="button"
                          className={cx('tp-bite__pick', known === 'dahi' && 'is-safe')}
                          disabled={busy}
                          onClick={() => act(`power:${id}`, { type: 'FLIP_POWER', targetPlayerId: id })}
                          data-autofocus={id === choices[0] ? '' : undefined}
                        >
                          <Card back="power" color={names.color(id)} peek={known} badge={names.initial(id)} width={phone ? 40 : 46} decorative />
                          <span className="tp-bite__picktext">
                            <strong>{who}</strong>
                            <span>{what}</span>
                          </span>
                          {pending === `power:${id}` ? <span className="tp-spinner" aria-hidden="true" /> : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </>
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
                Accept the bust ({signed(-target)})
              </Button>
            ) : null}
          </div>
        ) : null}

        {moment.stage === 'bitten' && watch ? (
          <div className="tp-bite__watch">
            {watch.offline && watch.onReplace ? (
              <Button variant="light" busy={watch.replacing} disabled={busy} onClick={watch.onReplace}>
                Replace {names.name(moment.eaterId)} with a bot
              </Button>
            ) : null}
            <Button variant="ghost-light" onClick={watch.onPeek} data-autofocus="">
              Look at the table
            </Button>
          </div>
        ) : null}

        {moment.stage === 'saved' ? (
          <Button variant="leaf" size="lg" onClick={onDismiss} data-autofocus="">
            {eaterIsYou ? 'Keep eating' : moment.owner === you ? 'Oh well' : 'Carry on'}
          </Button>
        ) : null}
      </div>
    </Overlay>
  );
}
