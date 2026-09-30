/**
 * Event playback, the React part. Every new snapshot's view is kept; the
 * cursor walks the log one event at a time (see eventDuration for pacing) and
 * the table renders `display`, the view rewound to the cursor. On first load
 * the cursor starts at view.lastSeq: history is never replayed. The viewer's
 * own events play instantly. `skip()` jumps to the newest state.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { GameEvent, PlayerId, PlayerView } from '../../engine/types.ts';
import { actorOf, displayAt, eventAt, eventDuration } from './rewind.ts';

interface State {
  source: PlayerView | null;
  views: PlayerView[];
  cursor: number;
  /** The last event played in this session (null after a jump). */
  current: GameEvent | null;
  playedAt: number;
}

function fresh(view: PlayerView | null): State {
  return { source: view, views: view ? [view] : [], cursor: view ? view.lastSeq : -1, current: null, playedAt: 0 };
}

function ingest(s: State, view: PlayerView | null): State {
  if (!view) return { ...s, source: view };
  const newest = s.views[s.views.length - 1];
  if (!newest || s.cursor < 0 || view.lastSeq < s.cursor || view.round < newest.round) return fresh(view);
  if (view.lastSeq === newest.lastSeq) {
    // Same log position (e.g. a lobby-level change): take the newer view as is.
    return { ...s, source: view, views: [...s.views.slice(0, -1), view] };
  }
  // Can't play what isn't in the log tail: jump.
  const first = view.log[0]?.seq ?? view.lastSeq + 1;
  if (first > s.cursor + 1) return { ...fresh(view), current: null };
  const views = [...s.views, view].sort((a, b) => a.lastSeq - b.lastSeq);
  return { ...s, source: view, views: prune(views, s.cursor) };
}

/** Keep views at/after the cursor, plus the newest one before it (the forward fallback). */
function prune(views: PlayerView[], cursor: number): PlayerView[] {
  const before = views.filter((v) => v.lastSeq < cursor);
  const keep = views.filter((v) => v.lastSeq >= cursor);
  return before.length > 0 ? [before[before.length - 1], ...keep] : keep;
}

export interface Playback {
  /** The view to render (rewound to the cursor). */
  display: PlayerView | null;
  cursor: number;
  latestSeq: number;
  /** Most recently played event (drives cues and the announcer). */
  current: GameEvent | null;
  /** Events still to play. */
  queued: number;
  playing: boolean;
  skip(): void;
}

export function usePlayback(view: PlayerView | null, youId: PlayerId | null, reducedMotion: boolean): Playback {
  const [state, setState] = useState<State>(() => fresh(view));
  let s = state;
  if (view !== state.source) {
    s = ingest(state, view);
    setState(s);
  }
  const latestSeq = s.views.length > 0 ? s.views[s.views.length - 1].lastSeq : -1;

  useEffect(() => {
    if (s.cursor < 0 || s.cursor >= latestSeq) return;
    const cur = s.current && s.current.seq === s.cursor ? s.current : null;
    const queued = latestSeq - s.cursor;
    const hold = cur ? eventDuration(cur, !!youId && actorOf(cur) === youId, queued, reducedMotion) : 0;
    const wait = Math.max(0, hold - (Date.now() - s.playedAt));
    const t = setTimeout(() => {
      setState((prev) => {
        const newest = prev.views[prev.views.length - 1];
        if (!newest || prev.cursor >= newest.lastSeq) return prev;
        const seq = prev.cursor + 1;
        const e = eventAt(prev.views, seq);
        if (!e) return { ...prev, cursor: newest.lastSeq, current: null, playedAt: Date.now(), views: prune(prev.views, newest.lastSeq) };
        return { ...prev, cursor: seq, current: e, playedAt: Date.now(), views: prune(prev.views, seq) };
      });
    }, wait);
    return () => clearTimeout(t);
  }, [s.cursor, s.current, s.playedAt, latestSeq, youId, reducedMotion]);

  const skip = useCallback(() => {
    setState((prev) => {
      const newest = prev.views[prev.views.length - 1];
      if (!newest || prev.cursor >= newest.lastSeq) return prev;
      return { ...prev, cursor: newest.lastSeq, current: null, playedAt: Date.now(), views: prune(prev.views, newest.lastSeq) };
    });
  }, []);

  const display = useMemo(() => displayAt(s.views, s.cursor), [s.views, s.cursor]);
  return {
    display,
    cursor: s.cursor,
    latestSeq,
    current: s.current,
    queued: Math.max(0, latestSeq - s.cursor),
    playing: s.cursor < latestSeq,
    skip,
  };
}
