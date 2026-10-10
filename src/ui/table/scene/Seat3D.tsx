/**
 * One seat of the round table: an anchor in the table plane holding the
 * lying cards (Pile3D), a spotlight when it is this player's turn, and the
 * upright nameplate standing at the rim (billboarded).
 */
import type { CSSProperties } from 'react';
import type { PlayerView, PublicPlayerView } from '../../../engine/types.ts';
import { PLAYER_PALETTE } from '../../../cards/index.ts';
import { cx } from '../../common/hooks.ts';
import type { NameBook } from '../../text.ts';
import type { SeatSpot } from './geometry.ts';
import { Nameplate } from './Nameplate.tsx';
import { Pile3D } from './Pile3D.tsx';
import type { Clickable, SeatCue, SeatStatus } from './seatData.ts';

export interface Seat3DProps {
  p: PublicPlayerView;
  view: PlayerView;
  names: NameBook;
  spot: SeatSpot;
  /** Table radius in px (to clamp nameplates on narrow stages). */
  R: number;
  /** Half the stage width in px; nameplates are kept inside it. */
  halfW: number;
  isHost: boolean;
  online: boolean | null;
  turn: boolean;
  status: SeatStatus | null;
  cardW: number;
  stackMax: number;
  stack: Clickable;
  power: Clickable;
  cue: SeatCue | null;
  phone: boolean;
}

const pulseClass = (seq: number, tone?: 'good' | 'bad') => cx(seq % 2 ? 'tp-cue-a' : 'tp-cue-b', tone && `tp-cue--${tone}`);

export function Seat3D(props: Seat3DProps) {
  const { p, view, names, spot, R, halfW, isHost, online, turn, status, cardW, stackMax, stack, power, cue, phone } = props;
  const you = p.id === view.youId;
  const plateHalf = phone ? 62 : 108;
  const limit = Math.max(0, halfW - plateHalf - 4);
  const nx = Math.max(-limit - spot.pile.x * R, Math.min(limit - spot.pile.x * R, (spot.name.x - spot.pile.x) * R));
  const ny = (spot.name.y - spot.pile.y) * R;
  const showHand = (view.phase === 'serving' || view.phase === 'bidding') && p.handCount > 0;
  return (
    <section
      className={cx('tp-seat3d', turn && 'is-turn', you && 'is-you')}
      style={{ left: `${50 + spot.pile.x * 50}%`, top: `${50 + spot.pile.y * 50}%`, ['--c' as string]: PLAYER_PALETTE[p.color].base, ['--c-ink' as string]: PLAYER_PALETTE[p.color].onBase } as CSSProperties}
      aria-label={`${you ? 'You' : p.name}${turn ? ', to act' : ''}`}
      data-seat={p.id}
    >
      <Pile3D p={p} view={view} names={names} rot={spot.rot} cardW={cardW} stackMax={stackMax} stack={stack} power={power} cue={cue} />
      <div className="tp-seat3d__foot" style={{ transform: `translate3d(${nx}px, ${ny}px, 0)` }}>
        <Nameplate
          name={p.name}
          initial={names.initial(p.id)}
          score={p.score}
          you={you}
          isHost={isHost}
          isBot={p.isBot}
          online={online}
          turn={turn}
          status={status}
          handCount={showHand ? p.handCount : null}
          busts={p.busts}
          pulse={cue?.part === 'seat' ? pulseClass(cue.seq, cue.tone) : undefined}
        />
      </div>
    </section>
  );
}
