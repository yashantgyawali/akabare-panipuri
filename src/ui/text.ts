/**
 * Human-readable words for the game: player names ("You" for the viewer),
 * owner initials for card badges, phase labels, and one line per log event.
 * Only public information goes in (events never carry secrets).
 */
import type { ColorId, GameConfig, GameEvent, Phase, PlayerId, PowerEffect, PowerKind, PuriKind } from '../engine/types.ts';
import { POWER_LABELS, PURI_LABELS } from '../engine/index.ts';

export interface NameBook {
  you: PlayerId | null;
  /** Display name ("Sita"). Unknown ids → "Someone". */
  name(id: PlayerId | null | undefined): string;
  color(id: PlayerId | null | undefined): ColorId;
  /** Card badge: owner initial (two letters when initials collide). */
  initial(id: PlayerId | null | undefined): string;
  /** "You" / "Sita" (sentence subject). */
  who(id: PlayerId | null | undefined): string;
  /** "your" / "Sita's". */
  whose(id: PlayerId | null | undefined): string;
  /** "Your" / "Sita's" (sentence start). */
  Whose(id: PlayerId | null | undefined): string;
}

export function makeNameBook(players: readonly { id: PlayerId; name: string; color: ColorId }[], you: PlayerId | null): NameBook {
  const byId = new Map(players.map((p) => [p.id, p]));
  const firsts = players.map((p) => initialOf(p.name, 1));
  const initials = new Map(
    players.map((p, i) => {
      const clash = firsts.filter((f) => f === firsts[i]).length > 1;
      return [p.id, initialOf(p.name, clash ? 2 : 1)];
    }),
  );
  const name = (id: PlayerId | null | undefined) => (id && byId.get(id)?.name) || 'Someone';
  return {
    you,
    name,
    color: (id) => (id && byId.get(id)?.color) || 'red',
    initial: (id) => (id && initials.get(id)) || '?',
    who: (id) => (id && id === you ? 'You' : name(id)),
    whose: (id) => (id && id === you ? 'your' : `${name(id)}’s`),
    Whose: (id) => (id && id === you ? 'Your' : `${name(id)}’s`),
  };
}

function initialOf(name: string, n: number): string {
  const letters = [...name.trim()].filter((ch) => /\p{L}|\p{N}/u.test(ch));
  const s = letters.slice(0, n).join('');
  return s ? s[0].toUpperCase() + s.slice(1).toLowerCase() : '?';
}

export const PHASE_LABELS: Record<Phase, string> = {
  setup: 'Setting up',
  serving: 'Serving',
  bidding: 'Bidding',
  eating: 'Eating',
  roundEnd: 'Round over',
  gameOver: 'Game over',
};

export const powerName = (k: PowerKind): string => POWER_LABELS[k];
export const puriName = (k: PuriKind): string => PURI_LABELS[k];

export function goalText(config: GameConfig): string {
  const { targetScore, maxRounds } = config;
  if (targetScore !== null && maxRounds !== null) return `First to ${targetScore}, or best after ${maxRounds} round${maxRounds === 1 ? '' : 's'}`;
  if (targetScore !== null) return `First to ${targetScore} points, no round limit`;
  return `Best score after ${maxRounds} round${maxRounds === 1 ? '' : 's'}`;
}

export function roundText(round: number, config: GameConfig, short = false): string {
  if (config.maxRounds === null) return short ? `R${round}` : `Round ${round} · no limit`;
  return short ? `R${round}/${config.maxRounds}` : `Round ${round} of ${config.maxRounds}`;
}

export const EFFECT_TEXT: Record<PowerEffect, string> = {
  numb: 'tongue numbed: the next puri is cancelled',
  saved: 'saved by Dahi!',
  failedSave: 'no Dahi',
  wasted: 'no effect',
  freePlate: 'any stack is fair game now',
  plusTwo: 'counts as 2 eaten',
};

export type Tone = 'info' | 'quiet' | 'good' | 'bad' | 'spicy';

export interface EventLine {
  text: string;
  tone: Tone;
  /** The player the line is mostly about (for the colour dot). */
  actor: PlayerId | null;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '±0');

/** One line per public event. `trapReward` comes from the game config. */
export function describeEvent(e: GameEvent, b: NameBook, trapReward = 2): EventLine {
  switch (e.type) {
    case 'roundStart': {
      const reset = e.availablePowersReset && e.round > 1 ? ' All four powers are back.' : '';
      return { text: `Round ${e.round} begins. ${b.who(e.firstPlayerId)} ${e.firstPlayerId === b.you ? 'serve' : 'serves'} first.${reset}`, tone: 'info', actor: e.firstPlayerId };
    }
    case 'setupDone':
      return { text: e.playerId === b.you ? 'Your stack and power are down.' : `${b.name(e.playerId)} has set up.`, tone: 'quiet', actor: e.playerId };
    case 'servingStart':
      return { text: `Serving begins: ${e.turnId === b.you ? 'you go' : `${b.name(e.turnId)} goes`} first.`, tone: 'info', actor: e.turnId };
    case 'place': {
      const where =
        e.onStackOf === e.playerId ? (e.playerId === b.you ? 'your own stack' : 'their own stack') : `${b.whose(e.onStackOf)} stack`;
      return { text: `${b.who(e.playerId)} placed a puri on ${where}.`, tone: 'quiet', actor: e.playerId };
    }
    case 'bidStart':
      return { text: `${b.who(e.playerId)} opened the bid at ${e.amount}.`, tone: 'info', actor: e.playerId };
    case 'raise':
      return { text: `${b.who(e.playerId)} raised to ${e.amount}.`, tone: 'info', actor: e.playerId };
    case 'pass':
      return { text: `${b.who(e.playerId)} passed.`, tone: 'quiet', actor: e.playerId };
    case 'eater':
      return {
        text: e.playerId === b.you ? `You won the bid: eat ${e.bid}!` : `${b.name(e.playerId)} won the bid and must eat ${e.bid}.`,
        tone: 'spicy',
        actor: e.playerId,
      };
    case 'flipPuri': {
      const from = e.fromStackOf === e.eaterId ? (e.eaterId === b.you ? 'your own stack' : 'their own stack') : `${b.whose(e.fromStackOf)} stack`;
      const card = `${b.whose(e.owner)} ${puriName(e.kind)}`;
      if (e.cancelled) return { text: `Numb! ${capital(card)} from ${from} is cancelled by Vinegar.`, tone: 'good', actor: e.eaterId };
      if (e.kind === 'akabare') return { text: `${b.who(e.eaterId)} flipped ${card} from ${from}…`, tone: 'bad', actor: e.eaterId };
      return { text: `${b.who(e.eaterId)} ate a Panipuri from ${from} (${e.eaten}/${e.target}).`, tone: 'info', actor: e.eaterId };
    }
    case 'bite':
      return { text: `${b.who(e.eaterId)} bit ${e.owner === e.eaterId ? (e.eaterId === b.you ? 'your own' : 'their own') : b.whose(e.owner)} Akabare!`, tone: 'bad', actor: e.eaterId };
    case 'flipPower': {
      const whose = e.owner === e.eaterId ? (e.eaterId === b.you ? 'your own' : 'their own') : b.whose(e.owner);
      const extra = e.effect === 'plusTwo' ? ` (${e.eaten}/${e.target})` : '';
      const tone: Tone = e.effect === 'saved' || e.effect === 'plusTwo' || e.effect === 'numb' || e.effect === 'freePlate' ? 'good' : e.effect === 'failedSave' ? 'bad' : 'quiet';
      const fx = EFFECT_TEXT[e.effect];
      return { text: `${b.who(e.eaterId)} flipped ${whose} ${powerName(e.kind)}: ${fx}${/[.!?]$/.test(fx) ? '' : '.'}${extra}`, tone, actor: e.eaterId };
    }
    case 'success':
      return {
        text: `${e.eaterId === b.you ? 'You ate' : `${b.name(e.eaterId)} ate`} ${plural(e.target, 'puri', 'puri')}! ${signed(e.target)} points.`,
        tone: 'good',
        actor: e.eaterId,
      };
    case 'bust': {
      const why = e.reason === 'emptyTable' ? ' The table ran out.' : '';
      const trap = e.trapRewardTo ? ` ${b.who(e.trapRewardTo)} ${e.trapRewardTo === b.you ? 'get' : 'gets'} +${trapReward} for the trap.` : '';
      return { text: `${b.who(e.eaterId)} ${e.eaterId === b.you ? 'bust' : 'busts'}! ${signed(-e.target)} points.${why}${trap}`, tone: 'bad', actor: e.eaterId };
    }
    case 'roundEnd':
      return { text: `Round ${e.result.round} is over.`, tone: 'quiet', actor: null };
    case 'ready':
      return { text: `${b.who(e.playerId)} ${e.playerId === b.you ? 'are' : 'is'} ready.`, tone: 'quiet', actor: e.playerId };
    case 'gameOver': {
      const w = e.winners.map((id) => b.who(id));
      const text = w.length === 1 ? `Game over! ${w[0]} ${e.winners[0] === b.you ? 'win' : 'wins'}.` : `Game over! Shared win: ${joinNames(w)}.`;
      return { text, tone: 'spicy', actor: e.winners[0] ?? null };
    }
    case 'botSet':
      return {
        text: e.isBot
          ? `${e.playerId === b.you ? 'A bot is playing for you now' : `A bot is playing for ${b.name(e.playerId)} now`}.`
          : `${b.who(e.playerId)} took ${e.playerId === b.you ? 'your' : 'their'} seat back.`,
        tone: 'quiet',
        actor: e.playerId,
      };
  }
}

const capital = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

export function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

export { signed };

/** A score with a real minus sign. */
export const num = (n: number): string => (n < 0 ? `−${Math.abs(n)}` : String(n));
