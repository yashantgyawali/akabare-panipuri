/**
 * Seat data shared by Table.tsx and the 3D seats: status/click types and the
 * helpers that turn a PublicPlayerView into card-stack items and labels.
 * Hidden information: other owners' face-down cards get face={null}; only the
 * viewer's own face-down cards carry a `peek`. Kinds come from the view, which
 * already hides what this viewer may not know.
 */
import type { PlayerView, PublicPlayerView } from '../../../engine/types.ts';
import type { CardState, CardStackItem } from '../../../cards/index.ts';
import type { NameBook } from '../../text.ts';

export interface SeatStatus {
  label: string;
  tone: 'turn' | 'eater' | 'passed' | 'high' | 'done' | 'wait' | 'bust' | 'win';
}

export interface Clickable {
  onClick?: () => void;
  state: CardState;
  label: string;
}

export interface SeatCue {
  /** Which part pulses, keyed by seq (alternating animations restart on every event). */
  part: 'stack' | 'power' | 'seat';
  seq: number;
  tone?: 'good' | 'bad';
}

export function stackItems(p: PublicPlayerView, view: PlayerView, names: NameBook): CardStackItem[] {
  return p.stack.map((c, i) => {
    const mine = c.owner === view.youId;
    const shown = view.revealed && c.kind !== null;
    return {
      key: i,
      back: 'puri',
      color: names.color(c.owner),
      badge: names.initial(c.owner),
      face: shown ? c.kind : null,
      faceUp: shown,
      peek: mine && !shown ? c.kind : null,
    };
  });
}

export function stackLabel(p: PublicPlayerView, names: NameBook): string {
  const whose = names.Whose(p.id);
  if (p.stack.length === 0) return `${whose} stack is empty`;
  const top = p.stack[p.stack.length - 1];
  const topOwner = top.owner === names.you ? 'yours' : `${names.name(top.owner)}’s`;
  const known = top.kind ? (top.kind === 'akabare' ? ', an Akabare' : ', a Panipuri') : '';
  return `${whose} stack: ${p.stack.length} card${p.stack.length === 1 ? '' : 's'}, top card ${topOwner}${known}`;
}
