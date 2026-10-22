/**
 * The #/rules page: pictures first, laid out like a short party-game rulebook
 * (hook, what you get, the round as five big steps, the powers, a comic-strip
 * example, winning). Each step keeps to its core action; the exceptions live
 * in one "Fine print" section at the end. Glass panels over the still tavern.
 * Every number comes from the default config (data.ts).
 */
import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { DEFAULT_CONFIG, MAX_PLAYERS, MIN_PLAYERS } from '../../engine/types.ts';
import { TavernBackdrop } from '../tavern/TavernBackdrop.tsx';
import { TavernTitle } from '../tavern/TavernTitle.tsx';
import { cx, usePhone, useReducedMotion } from '../common/hooks.ts';
import { HOME } from '../router.ts';
import { EXAMPLE, MODES, POWERS, goalLine, plural, powerReturnText } from './data.ts';
import { Arrow, Delta, MiniTable, OpenBowl, Power, Say, Stack, Who } from './Pictures.tsx';

export interface RulesPageProps {
  /** Where the visitor came from, for the back button. */
  from?: { href: string; label: string };
}

const C = DEFAULT_CONFIG;
const HAND = C.panipuriPerPlayer + 1 - C.startingStack;

const SECTIONS = [
  { id: 'rb-kit', label: 'What you get' },
  { id: 'rb-round', label: 'A round' },
  { id: 'rb-powers', label: 'Powers' },
  { id: 'rb-example', label: 'Example' },
  { id: 'rb-win', label: 'Winning' },
  { id: 'rb-fine', label: 'Fine print' },
];

/** In-page jumps. The app routes on the hash, so these scroll instead of linking to #ids. */
function JumpNav() {
  const reduced = useReducedMotion();
  const go = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
    el.focus({ preventScroll: true });
  };
  return (
    <nav className="rb-jump" aria-label="On this page">
      <ul>
        {SECTIONS.map((s) => (
          <li key={s.id}>
            <button type="button" className="tv-chip rb-jump__btn" onClick={() => go(s.id)}>
              {s.label}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function SectionHead({ id, title, sub }: { id: string; title: string; sub?: ReactNode }) {
  return (
    <header className="rb-sechead">
      <h2 id={id} className="rb-h2" tabIndex={-1}>
        {title}
      </h2>
      {sub ? <p className="rb-sub">{sub}</p> : null}
    </header>
  );
}

function Step({
  n,
  title,
  lead,
  pic,
  extra,
  children,
}: {
  n: number;
  title: string;
  lead: ReactNode;
  pic?: ReactNode;
  extra?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <li className={cx('rb-step tv-glass', !pic && 'rb-step--wide')}>
      <div className="rb-step__head">
        <span className="rb-step__n" aria-hidden="true">
          {n}
        </span>
        <h3 className="rb-h3">
          <span className="tp-sr">Step {n}: </span>
          {title}
        </h3>
      </div>
      {pic ? <div className="rb-step__pic">{pic}</div> : null}
      <div className="rb-step__text">
        <p className="rb-step__lead">{lead}</p>
        {children}
      </div>
      {extra ? <div className="rb-step__extra">{extra}</div> : null}
    </li>
  );
}

/** The exceptions, kept out of the five steps. */
const FINE: { title: string; items: string[] }[] = [
  {
    title: 'Turns and bids',
    items: [
      'Round 1 starts with a random player. Each new round, the next player clockwise starts.',
      'Nobody raises? The player who opened the bidding eats.',
      'There is no top limit on a bid.',
    ],
  },
  {
    title: 'Eating',
    items: [
      `No bowls left on the whole table and still short? Flip a power card if you can (a Chaat might get you there). If that doesn't do it, you bust.`,
    ],
  },
  {
    title: 'Power cards',
    items: [
      `Every flip counts toward the ${C.powerFlipsMax} a round, even when the card does nothing, like a Dahi with no bite.`,
      'A blind Vinegar can cancel a good Panipuri: that bowl counts 0.',
      'Two Vinegars in a row still cancel only one bowl. A second Naya Plate does nothing.',
      "A power card is used up once it's down, even if nobody flips it.",
    ],
  },
  {
    title: 'Scoring',
    items: [
      `Someone else's Akabare pays its owner +${C.trapReward} even when it was sitting on your own stack.`,
      'No bonus for biting your own Akabare, or for busting on an empty table.',
      'Going past your bid (with a Chaat) adds nothing. Scores can go below 0.',
    ],
  },
];

function More({ items }: { items: ReactNode[] }) {
  return (
    <ul className="rb-more">
      {items.map((x, i) => (
        <li key={i}>{x}</li>
      ))}
    </ul>
  );
}

export function RulesPage({ from = { href: HOME, label: 'Home' } }: RulesPageProps) {
  const phone = usePhone();
  useEffect(() => {
    document.title = 'Rules · Akabare Panipuri';
  }, []);
  const bowl = phone ? 48 : 64;
  const flips = C.powerFlipsMax;
  return (
    <div className="tv-page tv-rules rb">
      <TavernBackdrop still mode="orbit" guests={[]} />
      <main className="tp-container tp-container--narrow rb-main">
        <header className="tp-header rb-top">
          <a href={HOME} className="tv-screen__home" aria-label="Akabare Panipuri: home">
            <TavernTitle size="sm" as="div" />
          </a>
          <a className="tv-chip" href={from.href}>
            <span aria-hidden="true">←</span> {from.label}
          </a>
        </header>

        {/* ---- hook + goal ---- */}
        <section className="rb-hero tv-glass" aria-labelledby="rb-title">
          <div className="rb-hero__text">
            <p className="rb-kicker">Rules · 5 steps</p>
            <h1 id="rb-title" className="rb-h1">
              How to play
            </h1>
            <p className="rb-hook">Eat the bowls you bid. Don't bite the chili.</p>
            <p className="rb-lead">
              Everyone hides puri in upside-down bowls. One of your bowls hides an Akabare, a fiery chili. Bid how many bowls you can eat, then eat them
              without getting bitten.
            </p>
            <p className="rb-lead">
              <strong>Sneak your own Akabare onto other stacks:</strong> if it bites whoever is eating, you get +{C.trapReward}.
            </p>
            <p className="rb-goal">
              <strong>Goal:</strong> {goalLine(C)}
            </p>
            <ul className="rb-facts" aria-label="At a glance">
              <li>
                {MIN_PLAYERS} to {MAX_PLAYERS} players
              </li>
              <li>Hide, serve, bid, eat</li>
            </ul>
          </div>
          <div className="rb-hero__pics">
            <figure className="rb-hero__fig">
              <OpenBowl kind="panipuri" color="green" size={phone ? 104 : 136} title="An open Panipuri bowl" />
              <figcaption>
                <strong>Panipuri</strong>
                <span>Eat these</span>
              </figcaption>
            </figure>
            <figure className="rb-hero__fig rb-hero__fig--hot">
              <OpenBowl kind="akabare" color="red" size={phone ? 104 : 136} title="An open Akabare bowl, with a red chili" />
              <figcaption>
                <strong>Akabare</strong>
                <span>Don't bite this</span>
              </figcaption>
            </figure>
          </div>
        </section>

        <JumpNav />

        {/* ---- what you get ---- */}
        <section className="rb-sec" aria-labelledby="rb-kit">
          <SectionHead id="rb-kit" title="What you get" sub="Every player gets the same set, in their own colour." />
          <ul className="rb-kit">
            <li className="rb-kit__item tv-glass">
              <span className="rb-kit__pic rb-fan" aria-hidden="true">
                {Array.from({ length: C.panipuriPerPlayer }, (_, i) => (
                  <OpenBowl key={i} kind="panipuri" color="red" size={phone ? 40 : 52} />
                ))}
              </span>
              <span className="rb-kit__text">
                <strong className="rb-kit__name">{plural(C.panipuriPerPlayer, 'Panipuri bowl')}</strong>
                <span>Each one counts 1 when eaten.</span>
              </span>
            </li>
            <li className="rb-kit__item tv-glass">
              <span className="rb-kit__pic" aria-hidden="true">
                <OpenBowl kind="akabare" color="red" size={phone ? 56 : 64} />
              </span>
              <span className="rb-kit__text">
                <strong className="rb-kit__name">1 Akabare bowl</strong>
                <span>The chili. Bite it and you bust (fail your bid, lose points), unless a power saves you.</span>
              </span>
            </li>
            <li className="rb-kit__item tv-glass">
              <span className="rb-kit__pic rb-fan rb-fan--cards" aria-hidden="true">
                {POWERS.map((p) => (
                  <Power key={p.kind} kind={p.kind} color="red" width={phone ? 46 : 54} />
                ))}
              </span>
              <span className="rb-kit__text">
                <strong className="rb-kit__name">4 power cards</strong>
                <span>Whoever is eating can flip them for help. You hide 1 each round.</span>
              </span>
            </li>
          </ul>
          <div className="rb-callout tv-glass">
            <span className="rb-callout__pic">
              <Stack bowls={[{ color: 'red' }]} size={phone ? 56 : 64} label="An upside-down bowl with a red base" />
              <Arrow />
              <span className="rb-qmark" aria-hidden="true">
                ?
              </span>
            </span>
            <p>
              <strong>Upside down, a bowl hides what's inside.</strong> Its base shows the owner's colour, so everyone knows whose bowl it is, but not what's in
              it.
            </p>
          </div>
        </section>

        {/* ---- a round ---- */}
        <section className="rb-sec" aria-labelledby="rb-round">
          <SectionHead id="rb-round" title="A round" sub="Every round has the same 5 steps." />
          <ol className="rb-steps">
            <Step
              n={1}
              title="Hide"
              lead={
                <>
                  <strong>Hide {plural(C.startingStack, 'bowl')} upside down as your stack, and 1 power card face down beside it.</strong> The top bowl gets
                  eaten first.
                </>
              }
              pic={
                <div className="rb-pic rb-pic--setup">
                  <span className="rb-labelled">
                    <Stack
                      bowls={[
                        { color: 'red', kind: 'panipuri' },
                        { color: 'red', kind: 'akabare' },
                      ]}
                      size={bowl + 8}
                      inside
                      label="Your stack: 2 upside-down bowls, a Panipuri at the bottom and your Akabare on top"
                    />
                    <span className="rb-cap">Your stack</span>
                  </span>
                  <span className="rb-labelled">
                    <Power color="red" width={phone ? 50 : 60} />
                    <span className="rb-cap">Your power</span>
                  </span>
                  <span className="rb-labelled rb-labelled--hand">
                    <span className="rb-fan" aria-hidden="true">
                      {Array.from({ length: HAND }, (_, i) => (
                        <OpenBowl key={i} kind="panipuri" color="red" size={phone ? 32 : 38} />
                      ))}
                    </span>
                    <span className="rb-cap">{HAND} left in your hand</span>
                  </span>
                </div>
              }
            >
              <More
                items={[
                  'Anything goes: hide your Akabare here, or keep it in your hand for later.',
                  'You know your own power card. Others can only guess.',
                ]}
              />
            </Step>

            <Step
              n={2}
              title="Serve"
              lead={
                <>
                  <strong>Take turns clockwise. On your turn, do one of two things.</strong>
                </>
              }
            >
              <div className="rb-either">
                <div className="rb-option">
                  <span className="rb-option__tag">Either</span>
                  <div className="rb-pic">
                    <Stack bowls={[{ color: 'red' }]} size={bowl} label="Your bowl" />
                    <Arrow />
                    <Stack bowls={[{ color: 'blue' }, { color: 'blue' }]} size={bowl} label="Another player's stack" />
                  </div>
                  <p>
                    <strong>Serve a bowl.</strong> Put 1 bowl from your hand upside down on top of any stack. Your own counts too.
                  </p>
                  <p className="rb-why">
                    <strong>Why?</strong> To slip your Akabare where whoever eats will bite it.
                  </p>
                </div>
                <div className="rb-option">
                  <span className="rb-option__tag">Or</span>
                  <div className="rb-pic">
                    <Say color="red">I'll eat 3</Say>
                  </div>
                  <p>
                    <strong>Open the bidding.</strong> Say how many bowls you'll eat{C.minBid > 1 ? `, at least ${C.minBid}` : ''}.
                  </p>
                </div>
              </div>
              <More
                items={[
                  'No bowls left in your hand? You must open the bidding.',
                  'Once the bidding opens, nobody serves any more.',
                ]}
              />
            </Step>

            <Step
              n={3}
              title="Bid"
              lead={
                <>
                  <strong>Going clockwise, raise the bid or pass. The last player left is the eater.</strong> The bid is how many bowls they must eat.
                </>
              }
              pic={
                <ol className="rb-bids" aria-label="Bidding example">
                  <li>
                    <Who name="Maya" color="yellow" />
                    <Say color="yellow">3</Say>
                  </li>
                  <li>
                    <Who name="Asha" color="red" />
                    <Say color="red">4</Say>
                  </li>
                  <li>
                    <Who name="Bikash" color="blue" />
                    <Say color="blue">Pass</Say>
                  </li>
                  <li>
                    <Who name="Maya" color="yellow" />
                    <Say color="yellow">Pass</Say>
                  </li>
                  <li className="rb-bids__end">
                    <Arrow />
                    <span>Asha eats 4</span>
                  </li>
                </ol>
              }
            >
              <More items={["Pass and you're out of the bidding until the next round."]} />
            </Step>

            <Step
              n={4}
              title="Eat"
              extra={
                <div className="rb-bitten">
                  <h4 className="rb-h4">Bitten by an Akabare?</h4>
                  <ol className="rb-bitten__steps">
                    <li>
                      <span className="rb-bitten__pic">
                        <OpenBowl kind="akabare" color="yellow" size={48} />
                      </span>
                      <span>
                        <strong>You get one try:</strong> if you've flipped fewer than {flips} power cards and one is still face down, flip a power card.
                      </span>
                    </li>
                    <li>
                      <span className="rb-bitten__pic">
                        <Power kind="dahi" color="blue" width={40} />
                      </span>
                      <span>
                        <strong>Dahi: you're saved.</strong> Keep eating.
                      </span>
                    </li>
                    <li>
                      <span className="rb-bitten__pic">
                        <Power kind="chaat" color="green" width={40} />
                      </span>
                      <span>
                        <strong>Anything else: you bust.</strong> No try left? You bust right away.
                      </span>
                    </li>
                  </ol>
                </div>
              }
              lead={
                <>
                  <strong>Flip bowls one at a time, top bowl first. Start with your own stack.</strong> Then flip the top bowl of any other stack, in any
                  order. Reach your bid and you stop at once: you made it.
                </>
              }
              pic={
                <div className="rb-pic rb-pic--eat">
                  <span className="rb-labelled">
                    <Stack bowls={[{ color: 'red' }, { color: 'blue' }]} size={bowl} label="Your own stack" />
                    <span className="rb-cap rb-cap--hot">1. Yours</span>
                  </span>
                  <Arrow />
                  <span className="rb-labelled">
                    <span className="rb-row">
                      <Stack bowls={[{ color: 'blue' }, { color: 'blue' }, { color: 'yellow' }]} size={bowl} label="Bikash's stack" />
                      <Stack bowls={[{ color: 'yellow' }, { color: 'red' }]} size={bowl} label="Maya's stack" />
                    </span>
                    <span className="rb-cap">2. Then any</span>
                  </span>
                  <span className="rb-results">
                    <span className="rb-result">
                      <OpenBowl kind="panipuri" color="blue" size={bowl - 4} />
                      <span>
                        <strong>Panipuri</strong> counts 1
                      </span>
                    </span>
                    <span className="rb-result rb-result--hot">
                      <OpenBowl kind="akabare" color="yellow" size={bowl - 4} />
                      <span>
                        <strong>Akabare</strong> bites
                      </span>
                    </span>
                  </span>
                </div>
              }
            >
              <More
                items={[
                  <>
                    <strong>Only a Naya Plate</strong> lets you skip your own stack.
                  </>,
                  <>
                    Any time, you may flip up to {flips} power cards: your own, or a gamble on someone else's. Whoever owns the card, its effect works for
                    you, the eater.
                  </>,
                ]}
              />
            </Step>

            <Step
              n={5}
              title="Score"
              lead={
                <>
                  <strong>Made it: win points equal to your bid. Bust: lose that many.</strong>
                </>
              }
              pic={
                <ul className="rb-scores" aria-label="Scoring">
                  <li>
                    <Delta value="+4" />
                    <span>Bid 4, ate 4</span>
                  </li>
                  <li>
                    <Delta value="−4" />
                    <span>Bid 4, bust</span>
                  </li>
                  <li>
                    <Delta value={`+${C.trapReward}`} />
                    <span>Your Akabare busts someone else</span>
                  </li>
                </ul>
              }
            >
              <More items={[`Then a new round: everyone takes all ${C.panipuriPerPlayer + 1} bowls back, and leftover bowls stay secret.`]} />
            </Step>
          </ol>
        </section>

        {/* ---- powers ---- */}
        <section className="rb-sec" aria-labelledby="rb-powers">
          <SectionHead
            id="rb-powers"
            title="The 4 power cards"
            sub={
              <>
                Only the eater flips power cards, from anyone's place, and the effect always works for the eater. You know your own card. Others can
                only guess.
              </>
            }
          />
          <ul className="rb-powers">
            {POWERS.map((p) => (
              <li key={p.kind} className="rb-power tv-glass">
                <span className="rb-power__card">
                  <Power kind={p.kind} color={p.color} width={phone ? 96 : 116} />
                </span>
                <div className="rb-power__text">
                  <h3 className="rb-h3">{p.name}</h3>
                  <span className="rb-when">{p.when}</span>
                  <p>{p.text}</p>
                </div>
              </li>
            ))}
          </ul>
          <More
            items={[
              `Each round you hide 1 face down beside your stack. ${powerReturnText(C)}`,
              `The eater may flip up to ${flips} a round. After a bite, only Dahi helps.`,
            ]}
          />
        </section>

        {/* ---- example ---- */}
        <section className="rb-sec" aria-labelledby="rb-example">
          <SectionHead id="rb-example" title="Example round" sub="3 players. A and P show what's inside each bowl. At the table, only the owner sees them." />
          <ol className="rb-comic">
            {EXAMPLE.map((panel, i) => (
              <li key={panel.title} className="rb-panel tv-glass">
                <div className="rb-panel__head">
                  <span className="rb-panel__n" aria-hidden="true">
                    {i + 1}
                  </span>
                  <h3 className="rb-h3">{panel.title}</h3>
                </div>
                <MiniTable panel={panel} size={phone ? 42 : 54} />
                <p className="rb-panel__text">{panel.text}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* ---- winning ---- */}
        <section className="rb-sec" aria-labelledby="rb-win">
          <SectionHead id="rb-win" title="Winning" sub="Scores are checked at the end of each round. The host picks the mode in the lobby." />
          <ul className="rb-modes">
            {MODES.map((m) => (
              <li key={m.id} className="rb-mode tv-glass">
                <h3 className="rb-h3">{m.label}</h3>
                <p>{m.rule}</p>
              </li>
            ))}
          </ul>
          <p className="rb-tie tv-glass">
            <strong>Two players past the target in the same round?</strong> The higher score wins. <strong>Tied?</strong> Fewer busts wins. Still tied?
            You share the win.
          </p>
        </section>

        {/* ---- fine print ---- */}
        <section className="rb-sec" aria-labelledby="rb-fine">
          <SectionHead id="rb-fine" title="Fine print" sub="You don't need these to start. Look here when one comes up." />
          <div className="rb-fine">
            {FINE.map((g) => (
              <div key={g.title} className="rb-fine__group tv-glass">
                <h3 className="rb-h3">{g.title}</h3>
                <More items={g.items} />
              </div>
            ))}
          </div>
        </section>

        <footer className="rb-foot">
          <p className="rb-hook rb-hook--sm">That's it. Go eat.</p>
          <div className="rb-foot__btns">
            <a className="tv-chip rb-cta" href={HOME}>
              Start a game
            </a>
            {from.href !== HOME ? (
              <a className="tv-chip" href={from.href}>
                <span aria-hidden="true">←</span> {from.label}
              </a>
            ) : null}
          </div>
        </footer>
      </main>
    </div>
  );
}
