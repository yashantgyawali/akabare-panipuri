/* Akabare Panipuri rules engine (port of src/engine, rules v0.6) + simple bots. Exposes window.AkEngine. */
(function () {
  const POWERS = ['vinegar', 'dahi', 'nayaplate', 'chaat'];
  const LABEL = { panipuri: 'Panipuri', akabare: 'Akabare', vinegar: 'Vinegar', dahi: 'Dahi', nayaplate: 'Naya Plate', chaat: 'Chaat' };
  const DEF = { targetScore: 30, maxRounds: 5, trapReward: 2, startingStack: 2, panipuriPerPlayer: 5, powerFlipsMax: 2, powerResetRound: 4, minBid: 1, revealOnRoundEnd: false };
  const clone = (s) => JSON.parse(JSON.stringify(s));
  const P = (s, id) => s.players.find((p) => p.id === id);
  const who = (s, id) => (id === 'me' ? 'You' : (P(s, id) || {}).name || 'Someone');
  const whose = (s, id) => (id === 'me' ? 'your' : `${(P(s, id) || {}).name}’s`);
  const verb = (id, a, b) => (id === 'me' ? a : b);
  const signed = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '±0');

  function nextSeat(s, id, skip = []) {
    const n = s.players.length, f = s.players.findIndex((p) => p.id === id);
    for (let k = 1; k <= n; k++) { const c = s.players[(f + k) % n].id; if (!skip.includes(c)) return c; }
    return id;
  }
  function fullSet(id, c) {
    const a = [];
    for (let i = 1; i <= c.panipuriPerPlayer; i++) a.push({ id: `${id}:p${i}`, owner: id, kind: 'panipuri' });
    a.push({ id: `${id}:a`, owner: id, kind: 'akabare' });
    return a;
  }
  const take = (cards, kind) => { const i = cards.findIndex((c) => c.kind === kind); return i < 0 ? null : cards.splice(i, 1)[0]; };
  const emit = (s, text, tone = 'quiet') => s.log.push({ seq: s.log.length, round: s.round, text, tone });
  const isReset = (r, R) => (r - 1) % (R - 1) === 0;
  const avail = (s, id) => { const p = P(s, id); return POWERS.filter((k) => !p.usedPowers.includes(k)); };
  const tableEmpty = (s) => s.players.every((p) => p.stack.length === 0);
  const tableMax = (s) => s.players.reduce((n, p) => n + p.stack.length, 0) + 2 * s.config.powerFlipsMax;
  function canFlipPower(s) {
    const e = s.eating;
    if (!e || e.powersFlipped >= s.config.powerFlipsMax) return false;
    return s.players.some((p) => p.power && !p.power.revealed);
  }

  function create(players, config) {
    const cfg = Object.assign({}, DEF, config || {});
    const first = players[Math.floor(Math.random() * players.length)].id;
    const s = {
      config: cfg,
      players: players.map((p, seat) => ({ id: p.id, name: p.name, color: p.color, isBot: !!p.isBot, seat, score: 0, busts: 0, hand: [], stack: [], power: null, usedPowers: [], powerPicks: [], setupDone: false, ready: false, setup: null })),
      round: 1, phase: 'setup', firstPlayerId: first, serving: null, bidding: null, eating: null, results: [], winners: null, log: [], flash: null,
    };
    begin(s);
    return s;
  }
  function begin(s) {
    const reset = isReset(s.round, s.config.powerResetRound);
    for (const p of s.players) {
      p.hand = fullSet(p.id, s.config); p.stack = []; p.power = null; p.setupDone = false; p.ready = false; p.setup = null;
      if (reset) p.usedPowers = [];
    }
    s.phase = 'setup'; s.serving = null; s.bidding = null; s.eating = null; s.flash = null;
    emit(s, `Round ${s.round} begins. ${who(s, s.firstPlayerId)} ${verb(s.firstPlayerId, 'serve', 'serves')} first.${reset && s.round > 1 ? ' All four powers are back.' : ''}`, 'info');
  }
  function winners(ps) {
    const top = Math.max(...ps.map((p) => p.score));
    const lead = ps.filter((p) => p.score === top);
    const few = Math.min(...lead.map((p) => p.busts));
    return lead.filter((p) => p.busts === few).map((p) => p.id);
  }
  function cont(s) {
    const { targetScore: t, maxRounds: m } = s.config;
    if ((t !== null && s.players.some((p) => p.score >= t)) || (m !== null && s.round >= m)) {
      s.phase = 'gameOver'; s.winners = winners(s.players);
      emit(s, s.winners.length === 1 ? `Game over! ${who(s, s.winners[0])} ${verb(s.winners[0], 'win', 'wins')}.` : 'Game over! Shared win.', 'spicy');
      return;
    }
    s.round += 1; s.firstPlayerId = nextSeat(s, s.firstPlayerId); begin(s);
  }
  function startEating(s, id) {
    const b = s.bidding; b.turnId = id; s.phase = 'eating';
    s.eating = { eaterId: id, bid: b.highBid, target: b.highBid, eaten: 0, powersFlipped: 0, skipNext: false, freePlate: false, pendingAkabare: null, plate: [], powers: [] };
    emit(s, id === 'me' ? `You won the bid: eat ${b.highBid}!` : `${who(s, id)} won the bid and must eat ${b.highBid}.`, 'spicy');
    checkEnd(s);
  }
  function flipTargets(s) {
    const e = s.eating;
    if (s.phase !== 'eating' || !e || e.pendingAkabare) return [];
    const eater = P(s, e.eaterId);
    if (e.freePlate) return s.players.filter((p) => p.stack.length).map((p) => p.id);
    if (eater.stack.length) return [eater.id];
    return s.players.filter((p) => p.id !== eater.id && p.stack.length).map((p) => p.id);
  }
  const powerTargets = (s) => (s.phase === 'eating' && canFlipPower(s) ? s.players.filter((p) => p.power && !p.power.revealed).map((p) => p.id) : []);
  function checkEnd(s) {
    const e = s.eating;
    if (e.eaten >= e.target) finish(s, 'success', null, null);
    else if (tableEmpty(s) && !canFlipPower(s)) finish(s, 'bust', 'emptyTable', null);
  }
  function finish(s, outcome, reason, ak) {
    const e = s.eating, eater = P(s, e.eaterId);
    const d = Object.fromEntries(s.players.map((p) => [p.id, 0]));
    const akOwner = ak ? ak.owner : null;
    let trapTo = null;
    if (outcome === 'success') d[eater.id] += e.target;
    else {
      d[eater.id] -= e.target; eater.busts += 1;
      if (akOwner && akOwner !== eater.id && s.config.trapReward > 0) { trapTo = akOwner; d[akOwner] += s.config.trapReward; }
    }
    for (const p of s.players) p.score += d[p.id];
    e.pendingAkabare = null;
    if (outcome === 'success') emit(s, `${who(s, eater.id)} ate ${e.target} puri! ${signed(e.target)} points.`, 'good');
    else emit(s, `${who(s, eater.id)} ${verb(eater.id, 'bust', 'busts')}! ${signed(-e.target)} points.${reason === 'emptyTable' ? ' The table ran out.' : ''}${trapTo ? ` ${who(s, trapTo)} ${verb(trapTo, 'get', 'gets')} +${s.config.trapReward} for the trap.` : ''}`, 'bad');
    s.results.push({ round: s.round, eaterId: eater.id, bid: e.bid, target: e.target, eaten: e.eaten, outcome, bustReason: reason, akabareOwnerId: akOwner, trapRewardTo: trapTo, scoreDeltas: d, scoresAfter: Object.fromEntries(s.players.map((p) => [p.id, p.score])) });
    s.phase = 'roundEnd';
    for (const p of s.players) p.ready = p.isBot;
  }

  const H = {
    SUBMIT_SETUP(s, p, a) {
      const c = s.config;
      if (s.phase !== 'setup') return 'Setup is over for this round.';
      if (a.stack.length !== c.startingStack) return `Choose exactly ${c.startingStack} puri cards.`;
      if (a.stack.filter((k) => k === 'akabare').length > 1) return 'You only have 1 Akabare.';
      if (!avail(s, p.id).includes(a.power)) return `${LABEL[a.power]} isn’t available this round.`;
      const hand = fullSet(p.id, c);
      p.stack = a.stack.map((k) => take(hand, k)); p.hand = hand;
      p.power = { kind: a.power, revealed: false }; p.setup = { stack: a.stack.slice(), power: a.power };
      if (!p.setupDone) { p.setupDone = true; emit(s, p.id === 'me' ? 'Your stack and power are down.' : `${p.name} has set up.`); }
      if (s.players.every((q) => q.setupDone)) {
        for (const q of s.players) { const k = q.power.kind; if (!q.usedPowers.includes(k)) q.usedPowers.push(k); q.powerPicks.push(k); }
        s.phase = 'serving'; s.serving = { turnId: s.firstPlayerId };
        emit(s, `Serving begins: ${s.firstPlayerId === 'me' ? 'you go' : `${who(s, s.firstPlayerId)} goes`} first.`, 'info');
      }
    },
    PLACE_PURI(s, p, a) {
      if (s.phase !== 'serving') return 'It’s not serving time.';
      if (s.serving.turnId !== p.id) return `It’s ${who(s, s.serving.turnId)}’s turn.`;
      const t = P(s, a.targetPlayerId); if (!t) return 'No such stack.';
      const card = take(p.hand, a.kind); if (!card) return `You have no ${LABEL[a.kind]} in hand.`;
      t.stack.push(card);
      const where = t.id === p.id ? (p.id === 'me' ? 'your own stack' : 'their own stack') : `${whose(s, t.id)} stack`;
      emit(s, `${who(s, p.id)} placed a puri on ${where}.`);
      s.serving.turnId = nextSeat(s, p.id);
    },
    START_BID(s, p, a) {
      if (s.phase !== 'serving') return 'It’s not serving time.';
      if (s.serving.turnId !== p.id) return `It’s ${who(s, s.serving.turnId)}’s turn.`;
      if (a.amount < s.config.minBid) return `The opening bid must be at least ${s.config.minBid}.`;
      s.phase = 'bidding'; s.serving = null;
      s.bidding = { starterId: p.id, highBid: a.amount, highBidderId: p.id, turnId: nextSeat(s, p.id), passed: [] };
      emit(s, `${who(s, p.id)} opened the bid at ${a.amount}.`, 'info');
    },
    RAISE(s, p, a) {
      const b = s.bidding;
      if (s.phase !== 'bidding') return 'There is no bid to raise.';
      if (b.turnId !== p.id) return `It’s ${who(s, b.turnId)}’s turn.`;
      if (a.amount <= b.highBid) return `Raise above ${b.highBid}.`;
      b.highBid = a.amount; b.highBidderId = p.id;
      emit(s, `${who(s, p.id)} raised to ${a.amount}.`, 'info');
      b.turnId = nextSeat(s, p.id, b.passed);
    },
    PASS(s, p) {
      const b = s.bidding;
      if (s.phase !== 'bidding') return 'There is no bid to pass on.';
      if (b.turnId !== p.id) return `It’s ${who(s, b.turnId)}’s turn.`;
      b.passed.push(p.id); emit(s, `${who(s, p.id)} passed.`);
      const active = s.players.filter((q) => !b.passed.includes(q.id));
      if (active.length === 1) startEating(s, active[0].id);
      else b.turnId = nextSeat(s, p.id, b.passed);
    },
    FLIP_PURI(s, p, a) {
      const e = s.eating;
      if (s.phase !== 'eating' || e.eaterId !== p.id) return 'Only the eater can do that.';
      if (e.pendingAkabare) return 'You bit an Akabare: flip a power or accept the bust.';
      const t = P(s, a.targetPlayerId);
      if (!flipTargets(s).includes(t.id)) return p.stack.length ? 'Finish your own stack first.' : 'That stack is empty.';
      const card = t.stack.pop();
      const cancelled = e.skipNext; e.skipNext = false;
      if (!cancelled && card.kind === 'panipuri') e.eaten += 1;
      e.plate.push({ owner: card.owner, kind: card.kind, fromStackOf: t.id, cancelled, saved: false, id: card.id });
      const from = t.id === p.id ? (p.id === 'me' ? 'your own stack' : 'their own stack') : `${whose(s, t.id)} stack`;
      if (cancelled) emit(s, `Numb! ${whose(s, card.owner).replace(/^./, (x) => x.toUpperCase())} ${LABEL[card.kind]} is cancelled by Vinegar.`, 'good');
      else if (card.kind === 'panipuri') emit(s, `${who(s, p.id)} ate a Panipuri from ${from} (${e.eaten}/${e.target}).`, 'info');
      if (!cancelled && card.kind === 'akabare') {
        emit(s, `${who(s, p.id)} bit ${card.owner === p.id ? (p.id === 'me' ? 'your own' : 'their own') : whose(s, card.owner)} Akabare!`, 'bad');
        if (canFlipPower(s)) e.pendingAkabare = { card, fromStackOf: t.id };
        else finish(s, 'bust', 'akabare', card);
        return;
      }
      checkEnd(s);
    },
    FLIP_POWER(s, p, a) {
      const e = s.eating;
      if (s.phase !== 'eating' || e.eaterId !== p.id) return 'Only the eater can do that.';
      if (e.powersFlipped >= s.config.powerFlipsMax) return 'No power flips left.';
      const t = P(s, a.targetPlayerId);
      if (!t.power || t.power.revealed) return 'That power is already face up.';
      e.powersFlipped += 1; t.power.revealed = true;
      const kind = t.power.kind;
      const rec = (effect, fx) => { e.powers.push({ kind, owner: t.id, effect }); emit(s, `${who(s, p.id)} flipped ${t.id === p.id ? (p.id === 'me' ? 'your own' : 'their own') : whose(s, t.id)} ${LABEL[kind]}: ${fx}.`, effect === 'failedSave' ? 'bad' : effect === 'wasted' ? 'quiet' : 'good'); };
      const pend = e.pendingAkabare;
      if (pend) {
        if (kind === 'dahi') {
          const pl = e.plate.find((x) => x.id === pend.card.id); if (pl) pl.saved = true;
          e.pendingAkabare = null; rec('saved', 'saved by Dahi!');
          s.flash = { n: s.log.length, type: 'saved', eaterId: p.id, owner: pend.card.owner, powerOwner: t.id };
          checkEnd(s);
        } else { rec('failedSave', 'no Dahi'); s.lastFailed = { kind, owner: t.id }; finish(s, 'bust', 'akabare', pend.card); }
        return;
      }
      if (kind === 'vinegar') { rec(e.skipNext ? 'wasted' : 'numb', e.skipNext ? 'no effect' : 'the next puri is cancelled'); e.skipNext = true; }
      else if (kind === 'dahi') rec('wasted', 'no effect');
      else if (kind === 'nayaplate') { rec(e.freePlate ? 'wasted' : 'freePlate', e.freePlate ? 'no effect' : 'any stack is fair game now'); e.freePlate = true; }
      else { e.eaten += 2; rec('plusTwo', `counts as 2 eaten (${e.eaten}/${e.target})`); }
      checkEnd(s);
    },
    ACCEPT_BUST(s, p) {
      const e = s.eating;
      if (s.phase !== 'eating' || e.eaterId !== p.id) return 'Only the eater can do that.';
      if (e.pendingAkabare) { finish(s, 'bust', 'akabare', e.pendingAkabare.card); return; }
      if (tableEmpty(s) && e.eaten < e.target) { finish(s, 'bust', 'emptyTable', null); return; }
      return 'You can only give up after a bite or on an empty table.';
    },
    READY(s, p) {
      if (s.phase !== 'roundEnd') return 'Nothing to be ready for.';
      if (p.ready) return 'Already ready.';
      p.ready = true;
      if (s.players.every((q) => q.isBot || q.ready)) cont(s);
    },
    FORCE_CONTINUE(s) { if (s.phase !== 'roundEnd') return 'Not at round end.'; cont(s); },
  };

  function apply(state, pid, a) {
    if (state.phase === 'gameOver') return { ok: false, error: 'The game is over.' };
    const s = clone(state);
    const p = P(s, pid);
    const err = H[a.type](s, p, a);
    return err ? { ok: false, error: err } : { ok: true, state: s };
  }
  function setBot(state, id, isBot) {
    const s = clone(state); const p = P(s, id); p.isBot = isBot;
    if (s.phase === 'roundEnd') p.ready = isBot;
    emit(s, isBot ? `A bot is playing for ${id === 'me' ? 'you' : p.name} now.` : `${who(s, id)} took ${id === 'me' ? 'your' : 'their'} seat back.`);
    return s;
  }

  function legal(s, id) {
    const L = { setup: null, place: null, startBid: null, raise: null, pass: false, flipPuri: [], flipPower: [], acceptBust: false, ready: false };
    const p = P(s, id); if (!p) return L;
    switch (s.phase) {
      case 'setup': L.setup = { size: s.config.startingStack, available: avail(s, id) }; break;
      case 'serving':
        if (s.serving.turnId !== id) break;
        if (p.hand.length) L.place = { kinds: ['panipuri', 'akabare'].filter((k) => p.hand.some((c) => c.kind === k)) };
        L.startBid = { min: s.config.minBid }; break;
      case 'bidding':
        if (s.bidding.turnId !== id) break;
        L.raise = { min: s.bidding.highBid + 1 }; L.pass = true; break;
      case 'eating': {
        const e = s.eating; if (e.eaterId !== id) break;
        L.flipPuri = flipTargets(s); L.flipPower = powerTargets(s);
        L.acceptBust = !!e.pendingAkabare || (tableEmpty(s) && e.eaten < e.target); break;
      }
      case 'roundEnd': L.ready = !p.ready; break;
    }
    return L;
  }
  function pending(s) {
    switch (s.phase) {
      case 'setup': return s.players.filter((p) => !p.setupDone).map((p) => p.id);
      case 'serving': return [s.serving.turnId];
      case 'bidding': return [s.bidding.turnId];
      case 'eating': return [s.eating.eaterId];
      case 'roundEnd': return s.players.filter((p) => !p.isBot && !p.ready).map((p) => p.id);
      default: return [];
    }
  }

  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  function botAction(s, id) {
    const L = legal(s, id), p = P(s, id), c = s.config;
    if (L.setup && !p.setupDone) {
      const stack = Array(c.startingStack).fill('panipuri');
      if (Math.random() < 0.35) stack[Math.floor(Math.random() * stack.length)] = 'akabare';
      return { type: 'SUBMIT_SETUP', stack, power: pick(L.setup.available) };
    }
    if (L.startBid) {
      const onTable = s.players.reduce((n, q) => n + q.stack.length, 0);
      const ak = p.hand.some((x) => x.kind === 'akabare');
      if (L.place && (onTable < s.players.length * 3 || ak) && Math.random() < 0.8) {
        if (ak && Math.random() < 0.6) {
          const others = s.players.filter((q) => q.id !== id);
          return { type: 'PLACE_PURI', kind: 'akabare', targetPlayerId: pick(others).id };
        }
        if (L.place.kinds.includes('panipuri')) return { type: 'PLACE_PURI', kind: 'panipuri', targetPlayerId: Math.random() < 0.6 ? id : pick(s.players).id };
      }
      const safe = p.stack.filter((x) => x.kind === 'panipuri').length;
      return { type: 'START_BID', amount: Math.max(c.minBid, Math.min(safe + 1, 3)) };
    }
    if (L.pass) {
      const safe = p.stack.filter((x) => x.kind === 'panipuri').length;
      const mine = p.power && p.power.kind === 'chaat' ? 2 : 0;
      const est = safe + mine + Math.floor(Math.random() * 3);
      return L.raise && L.raise.min <= est ? { type: 'RAISE', amount: L.raise.min } : { type: 'PASS' };
    }
    if (s.phase === 'eating' && s.eating.eaterId === id) {
      const e = s.eating;
      const myPow = p.power && !p.power.revealed ? p.power.kind : null;
      if (e.pendingAkabare) {
        if (myPow === 'dahi' && L.flipPower.includes(id)) return { type: 'FLIP_POWER', targetPlayerId: id };
        const others = L.flipPower.filter((x) => x !== id);
        if (others.length) return { type: 'FLIP_POWER', targetPlayerId: pick(others) };
        return { type: 'ACCEPT_BUST' };
      }
      if (myPow === 'chaat' && L.flipPower.includes(id)) return { type: 'FLIP_POWER', targetPlayerId: id };
      if (L.flipPuri.length) return { type: 'FLIP_PURI', targetPlayerId: L.flipPuri.includes(id) ? id : pick(L.flipPuri) };
      if (L.flipPower.length) return { type: 'FLIP_POWER', targetPlayerId: pick(L.flipPower) };
      return { type: 'ACCEPT_BUST' };
    }
    if (L.ready) return { type: 'READY' };
    return null;
  }

  window.AkEngine = { create, apply, legal, pending, botAction, setBot, tableMax, avail, LABEL, POWERS, DEF, signed };
})();
