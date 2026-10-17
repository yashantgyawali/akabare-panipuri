/**
 * Table sounds, synthesised with Web Audio (no audio files): card slides and
 * flips, coin clinks for bids, a wooden knock for a pass, stings for the
 * Akabare bite / bust / success, a soft ding when it's your turn, and a quiet
 * low room hum while the table is open.
 * Browsers only allow audio after a user gesture: the context is created (or
 * resumed) on the first pointer/key press. Mute is remembered per browser.
 */

const KEY = 'akp.muted';
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noise: AudioBuffer | null = null;
let muted = (() => {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
})();
const listeners = new Set<(m: boolean) => void>();

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.7;
    master.connect(ctx.destination);
    noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return ctx;
}

if (typeof window !== 'undefined') {
  const unlock = () => {
    const c = audio();
    if (c && c.state === 'suspended') void c.resume();
  };
  window.addEventListener('pointerdown', unlock, { capture: true });
  window.addEventListener('keydown', unlock, { capture: true });
}

export function isMuted(): boolean {
  return muted;
}

export function setMuted(m: boolean) {
  muted = m;
  try {
    localStorage.setItem(KEY, m ? '1' : '0');
  } catch {
    /* not remembered */
  }
  if (ctx && master) master.gain.setTargetAtTime(m ? 0 : 0.7, ctx.currentTime, 0.05);
  listeners.forEach((f) => f(m));
}

export function onMuted(f: (m: boolean) => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}

/** Only play when the context is running (after a gesture) and not muted. */
function live(): AudioContext | null {
  const c = ctx;
  return c && master && c.state === 'running' && !muted ? c : null;
}

function env(c: AudioContext, at: number, peak: number, attack: number, decay: number): GainNode {
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(peak, at + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
  g.connect(master!);
  return g;
}

function burst(c: AudioContext, at: number, { dur, freq, q = 1, type = 'bandpass', peak = 0.5, sweepTo }: { dur: number; freq: number; q?: number; type?: BiquadFilterType; peak?: number; sweepTo?: number }) {
  const src = c.createBufferSource();
  src.buffer = noise;
  src.playbackRate.value = 0.8 + Math.random() * 0.4;
  const f = c.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(freq, at);
  if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, at + dur);
  f.Q.value = q;
  src.connect(f).connect(env(c, at, peak, 0.005, dur));
  src.start(at, Math.random());
  src.stop(at + dur + 0.05);
}

function tone(c: AudioContext, at: number, { freq, dur, type = 'sine', peak = 0.3, to, attack = 0.005 }: { freq: number; dur: number; type?: OscillatorType; peak?: number; to?: number; attack?: number }) {
  const o = c.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, at);
  if (to) o.frequency.exponentialRampToValueAtTime(to, at + dur);
  o.connect(env(c, at, peak, attack, dur));
  o.start(at);
  o.stop(at + attack + dur + 0.05);
}

const bell = (c: AudioContext, at: number, f: number, peak = 0.18, dur = 0.9) => {
  tone(c, at, { freq: f, dur, peak });
  tone(c, at, { freq: f * 2.76, dur: dur * 0.4, peak: peak * 0.35 });
};

export const sfx = {
  /** A card slid across the wood and dropped on a stack. */
  place() {
    const c = live();
    if (!c) return;
    const t = c.currentTime;
    burst(c, t, { dur: 0.22, freq: 2400, sweepTo: 900, q: 0.8, peak: 0.25 });
    burst(c, t + 0.2, { dur: 0.06, freq: 1800, q: 1.5, peak: 0.5 });
    tone(c, t + 0.2, { freq: 140, to: 70, dur: 0.09, peak: 0.35 });
  },
  /** A card snapped over. */
  flip() {
    const c = live();
    if (!c) return;
    const t = c.currentTime;
    burst(c, t, { dur: 0.04, freq: 3200, type: 'highpass', peak: 0.4 });
    burst(c, t + 0.07, { dur: 0.08, freq: 1500, q: 1.2, peak: 0.45 });
  },
  /** Coins on brass: a bid or a raise. */
  bid() {
    const c = live();
    if (!c) return;
    const t = c.currentTime;
    bell(c, t, 2093, 0.14, 0.35);
    bell(c, t + 0.09, 2637, 0.12, 0.45);
  },
  /** Knuckles on the table: pass. */
  pass() {
    const c = live();
    if (!c) return;
    const t = c.currentTime;
    for (const d of [0, 0.13]) {
      tone(c, t + d, { freq: 210, to: 110, dur: 0.1, peak: 0.35 });
      burst(c, t + d, { dur: 0.05, freq: 900, q: 2, peak: 0.25 });
    }
  },
  /** Someone won the bid and becomes the eater. */
  eater() {
    const c = live();
    if (!c) return;
    const t = c.currentTime;
    bell(c, t, 523, 0.16);
    bell(c, t + 0.14, 784, 0.16);
  },
  /** The Akabare bites: a low drop and a dissonant hit. */
  bite() {
    const c = live();
    if (!c) return;
    const t = c.currentTime;
    tone(c, t, { freq: 220, to: 55, dur: 0.7, type: 'sawtooth', peak: 0.18 });
    tone(c, t, { freq: 233, to: 58, dur: 0.7, type: 'sawtooth', peak: 0.14 });
    burst(c, t, { dur: 0.35, freq: 400, type: 'lowpass', peak: 0.6 });
  },
  /** Dahi saved the eater. */
  saved() {
    const c = live();
    if (!c) return;
    const t = c.currentTime;
    [1047, 1319, 1568, 2093].forEach((f, i) => bell(c, t + i * 0.06, f, 0.1, 0.5));
  },
  /** Bust: a sad slide down. */
  bust() {
    const c = live();
    if (!c) return;
    const t = c.currentTime;
    [392, 370, 349].forEach((f, i) => tone(c, t + i * 0.28, { freq: f, dur: 0.3, type: 'triangle', peak: 0.2 }));
    tone(c, t + 0.84, { freq: 330, to: 250, dur: 0.8, type: 'triangle', peak: 0.2 });
  },
  /** The eater made it. */
  success() {
    const c = live();
    if (!c) return;
    const t = c.currentTime;
    [523, 659, 784, 1047].forEach((f, i) => bell(c, t + i * 0.1, f, 0.15, 0.8));
  },
  /** Your move. */
  turn() {
    const c = live();
    if (!c) return;
    const t = c.currentTime;
    bell(c, t, 880, 0.1, 0.5);
    bell(c, t + 0.12, 1175, 0.1, 0.6);
  },
  /** A new round: the deck is shuffled. */
  shuffle() {
    const c = live();
    if (!c) return;
    const t = c.currentTime;
    for (let i = 0; i < 7; i++) burst(c, t + i * 0.055, { dur: 0.05, freq: 2600 + Math.random() * 800, q: 0.9, peak: 0.18 });
  },
};

/** The tavern bed: a soft low room hum. Returns a stop function. */
export function startAmbience(): () => void {
  let stopped = false;
  let nodes: AudioNode[] = [];
  const begin = () => {
    const c = ctx;
    if (stopped || !c || !master || c.state !== 'running' || nodes.length) return;
    const src = c.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 260;
    const g = c.createGain();
    g.gain.value = 0.0001;
    g.gain.exponentialRampToValueAtTime(0.04, c.currentTime + 2);
    src.connect(lp).connect(g).connect(master);
    src.start();
    nodes = [src, lp, g];
  };
  // Wait for the first gesture (the context may still be suspended).
  const poll = setInterval(() => {
    audio();
    begin();
    if (nodes.length) clearInterval(poll);
  }, 500);
  begin();
  return () => {
    stopped = true;
    clearInterval(poll);
    for (const n of nodes) {
      try {
        if (n instanceof AudioBufferSourceNode) n.stop();
        n.disconnect();
      } catch {
        /* already gone */
      }
    }
  };
}
