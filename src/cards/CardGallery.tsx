/**
 * Card gallery: every front in every owner colour, both backs, the four reference sizes,
 * flip / reveal, peek, badge, state and stack demos. Mounted at `#/cards` by the app and
 * standalone by /cards-preview.html (src/cards/preview-main.tsx) for checking in isolation.
 * Assumes a dark table background behind it (it sets none itself).
 */

import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { COLORS, POWER_KINDS, PURI_KINDS } from '../engine/types.ts';
import type { ColorId } from '../engine/types.ts';
import { Card, CardStack, cardName } from './Card.tsx';
import type { CardStackItem, CardState, FaceKind } from './Card.tsx';
import { CARD_INFO } from './content.ts';
import { PLAYER_PALETTE } from './palette.ts';

const KINDS: FaceKind[] = [...PURI_KINDS, ...POWER_KINDS];
const SIZES = [56, 90, 140, 240] as const;
const STATES: CardState[] = ['idle', 'selectable', 'selected', 'danger', 'dim'];
const HAND: FaceKind[] = ['panipuri', 'panipuri', 'akabare', 'panipuri'];
const NAMES: Record<ColorId, string> = { red: 'You', blue: 'Sita', yellow: 'Ramesh', green: 'Anil', purple: 'Priya', orange: 'Maya' };
const initial = (c: ColorId) => NAMES[c][0];

function useViewportWidth(): number {
  const [w, setW] = useState(() => (typeof window === 'undefined' ? 1200 : window.innerWidth));
  useEffect(() => {
    const on = () => setW(window.innerWidth);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return w;
}

function Section({ title, note, children }: { title: string; note?: ReactNode; children: ReactNode }) {
  return (
    <section className="ak-card-gallery__section">
      <h2 className="ak-card-gallery__h">{title}</h2>
      {note ? <p className="ak-card-gallery__note">{note}</p> : null}
      {children}
    </section>
  );
}

function Cell({ caption, children }: { caption?: ReactNode; children: ReactNode }) {
  return (
    <figure className="ak-card-gallery__cell">
      {children}
      {caption ? <figcaption className="ak-card-gallery__cap">{caption}</figcaption> : null}
    </figure>
  );
}

function Segmented<T extends string | number>({ value, options, onChange, label }: { value: T; options: readonly T[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="ak-card-gallery__seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={String(o)} type="button" className="ak-card-gallery__btn" aria-pressed={o === value} onClick={() => onChange(o)}>
          {String(o)}
          {typeof o === 'number' ? 'px' : ''}
        </button>
      ))}
    </div>
  );
}

export function CardGallery() {
  const vw = useViewportWidth();
  const [gridSize, setGridSize] = useState<number>(vw < 600 ? 56 : 90);
  const [allUp, setAllUp] = useState(true);
  const [flipped, setFlipped] = useState<Record<string, boolean>>({});
  const [revealed, setRevealed] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [stackPick, setStackPick] = useState<ColorId | null>(null);
  const big = Math.min(360, vw - 48);

  // A plausible serving-phase table: each seat's stack (bottom → top) and its power beside it.
  const seats: { owner: ColorId; cards: Omit<CardStackItem, 'badge'>[] }[] = [
    { owner: 'red', cards: [{ back: 'puri', color: 'red', peek: 'panipuri' }, { back: 'puri', color: 'blue' }, { back: 'puri', color: 'red', peek: 'akabare' }] },
    { owner: 'blue', cards: [{ back: 'puri', color: 'blue' }, { back: 'puri', color: 'blue' }] },
    { owner: 'yellow', cards: [{ back: 'puri', color: 'yellow' }, { back: 'puri', color: 'yellow' }, { back: 'puri', color: 'red', peek: 'akabare' }, { back: 'puri', color: 'green' }, { back: 'puri', color: 'orange' }] },
    { owner: 'green', cards: [] },
    { owner: 'purple', cards: [{ back: 'puri', color: 'purple' }, { back: 'puri', color: 'purple' }, { back: 'puri', color: 'red', peek: 'panipuri' }, { back: 'puri', color: 'blue' }] },
    {
      owner: 'orange',
      cards: [
        { back: 'puri', color: 'orange' },
        { back: 'puri', color: 'orange' },
        { back: 'puri', color: 'blue' },
        { back: 'puri', color: 'yellow' },
        { back: 'puri', color: 'red', peek: 'panipuri' },
        { back: 'puri', color: 'purple' },
        { back: 'puri', color: 'green' },
        { back: 'puri', color: 'yellow' },
        { back: 'puri', color: 'blue' },
        { back: 'puri', color: 'red', peek: 'panipuri' },
        { back: 'puri', color: 'green' },
      ],
    },
  ];
  const table = seats.map((s) => ({ ...s, cards: s.cards.map((c): CardStackItem => ({ ...c, badge: initial(c.color) })) }));

  return (
    <div className="ak-card-gallery">
      <header className="ak-card-gallery__header">
        <h1 className="ak-card-gallery__title">
          Akabare Panipuri <span lang="ne">अकबरे पानीपुरी</span>
        </h1>
        <p className="ak-card-gallery__note">
          Card components from <code>src/cards</code>: <code>&lt;Card&gt;</code>, <code>&lt;CardStack&gt;</code>, <code>&lt;CardFront&gt;</code>,{' '}
          <code>&lt;CardBack&gt;</code>. Fronts are HTML/CSS rebuilt from the print sheets; backs are the pre-rendered webps from{' '}
          <code>src/cards/backs.ts</code>.
        </p>
      </header>

      <Section
        title="Every front in every colour, with both backs"
        note={
          <>
            Grid size:{' '}
            <Segmented label="Grid card width" value={gridSize} options={SIZES} onChange={setGridSize} />{' '}
            <button type="button" className="ak-card-gallery__btn" onClick={() => setAllUp((u) => !u)}>
              {allUp ? 'Turn all face down' : 'Turn all face up'}
            </button>
          </>
        }
      >
        {COLORS.map((c) => (
          <div key={c} className="ak-card-gallery__row" aria-label={PLAYER_PALETTE[c].name}>
            <span className="ak-card-gallery__rowlabel" style={{ color: PLAYER_PALETTE[c].light }}>
              {PLAYER_PALETTE[c].name}
            </span>
            {KINDS.map((k) => (
              <Card key={k} back={CARD_INFO[k].family} color={c} face={k} faceUp={allUp} width={gridSize} />
            ))}
            <span className="ak-card-gallery__gap" />
            <Card back="puri" color={c} width={gridSize} badge={initial(c)} />
            <Card back="power" color={c} width={gridSize} badge={initial(c)} />
          </div>
        ))}
      </Section>

      <Section title="Reference sizes: 56 · 90 · 140 · 240 px" note="The rule text appears from 150 px, the Devanagari from 80 px. Everything else scales as one picture.">
        {(['vinegar', 'akabare'] as const).map((k, i) => {
          const c: ColorId = i ? 'blue' : 'yellow';
          return (
            <div key={k} className="ak-card-gallery__row ak-card-gallery__row--bottom">
              {SIZES.map((s) => (
                <Cell key={s} caption={`${s}px`}>
                  <Card back={CARD_INFO[k].family} color={c} face={k} width={s} />
                </Cell>
              ))}
              {SIZES.map((s) => (
                <Cell key={`b${s}`} caption={`${s}px`}>
                  <Card back={CARD_INFO[k].family} color={c} width={s} badge={NAMES[c]} peek={k} />
                </Cell>
              ))}
            </div>
          );
        })}
      </Section>

      <Section title="Rules size" note={`Hand / rules-drawer size (${big}px). Rule text: small-caps timing label, then the effect.`}>
        <div className="ak-card-gallery__row ak-card-gallery__row--bottom">
          {KINDS.map((k, i) => (
            <Card key={k} back={CARD_INFO[k].family} color={COLORS[i]} face={k} width={big} instance={3} />
          ))}
        </div>
      </Section>

      <Section title="Flip" note="Click a card to turn it (a 3D rotateY; prefers-reduced-motion gets a cross-fade). “Reveal” mounts a face that was unknown and flips it in one go, as when a card is flipped for everyone.">
        <div className="ak-card-gallery__row ak-card-gallery__row--bottom">
          {KINDS.map((k, i) => {
            const id = `f-${k}`;
            const up = flipped[id] ?? false;
            return (
              <Cell key={k} caption={cardName(k)}>
                <Card
                  back={CARD_INFO[k].family}
                  color={COLORS[(i + 2) % 6]}
                  face={k}
                  faceUp={up}
                  width={vw < 600 ? 90 : 120}
                  badge={initial(COLORS[(i + 2) % 6])}
                  onClick={() => setFlipped((f) => ({ ...f, [id]: !up }))}
                />
              </Cell>
            );
          })}
          <Cell caption={revealed ? 'Revealed' : 'Unknown (face = null)'}>
            <Card back="puri" color="purple" face={revealed ? 'akabare' : null} width={vw < 600 ? 90 : 120} badge="Priya" onClick={() => setRevealed((r) => !r)} />
          </Cell>
        </div>
      </Section>

      <Section title="Peek and badge" note="Peek: the owner's own face-down cards carry a quiet chip with the card's initial (and its mini art from 100 px). Badge: owner initial or short name, so ownership is never colour-only.">
        <div className="ak-card-gallery__row ak-card-gallery__row--bottom">
          {([56, 90, 140] as const).map((s) => (
            <Cell key={`pp${s}`} caption={`${s} · Panipuri`}>
              <Card back="puri" color="red" peek="panipuri" badge="You" width={s} />
            </Cell>
          ))}
          {([56, 90, 140] as const).map((s) => (
            <Cell key={`pa${s}`} caption={`${s} · Akabare`}>
              <Card back="puri" color="green" peek="akabare" badge="A" width={s} />
            </Cell>
          ))}
          {(['vinegar', 'dahi', 'khali', 'chaat'] as const).map((k, i) => (
            <Cell key={k} caption={`56 · ${cardName(k)}`}>
              <Card back="power" color={COLORS[i + 1]} peek={k} badge={initial(COLORS[i + 1])} width={56} />
            </Cell>
          ))}
          <Cell caption="long name">
            <Card back="puri" color="orange" badge="Ramesh Bahadur" peek="akabare" width={90} />
          </Cell>
        </div>
      </Section>

      <Section title="States" note="idle · selectable · selected · danger · dim, face up and face down.">
        <div className="ak-card-gallery__row ak-card-gallery__row--bottom">
          {STATES.map((st, i) => (
            <Cell key={st} caption={st}>
              <Card back="puri" color="yellow" face="panipuri" width={90} instance={i + 1} state={st} />
            </Cell>
          ))}
          {STATES.map((st) => (
            <Cell key={`b${st}`} caption={st}>
              <Card back="power" color="blue" width={56} badge="S" state={st} />
            </Cell>
          ))}
        </div>
      </Section>

      <Section title="Your hand" note="Hand cards as buttons (Tab to focus, Enter/Space to pick): selectable until one is picked, the rest dim while it is selected.">
        <div className="ak-card-gallery__row ak-card-gallery__row--bottom ak-card-gallery__hand">
          {HAND.map((k, i) => (
            <Card
              key={i}
              back="puri"
              color="red"
              face={k}
              instance={i + 1}
              width={vw < 600 ? 64 : 100}
              state={selected === null ? 'selectable' : selected === i ? 'selected' : 'dim'}
              onClick={() => setSelected((s) => (s === i ? null : i))}
            />
          ))}
        </div>
      </Section>

      <Section title="Stacks on the table" note="<CardStack>: bottom → top, top card last. Each lower card's top strip keeps its badge and (for your own cards) the peek. A count bubble appears above 4 cards; Maya's 11-card pile is squeezed with maxHeight. Stacks are clickable targets here.">
        <div className="ak-card-gallery__table">
          {table.map((s) => (
            <div key={s.owner} className="ak-card-gallery__seat">
              <div className="ak-card-gallery__seatname" style={{ color: PLAYER_PALETTE[s.owner].light }}>
                {NAMES[s.owner]}
              </div>
              <div className="ak-card-gallery__seatcards">
                <CardStack
                  cards={s.cards}
                  width={56}
                  maxHeight={s.cards.length > 6 ? 150 : undefined}
                  state={stackPick === s.owner ? 'selected' : 'selectable'}
                  onClick={() => setStackPick(s.owner)}
                  ariaLabel={`${NAMES[s.owner]}'s stack, ${s.cards.length} cards`}
                />
                <Card back="power" color={s.owner} width={44} badge={initial(s.owner)} peek={s.owner === 'red' ? 'dahi' : null} />
              </div>
            </div>
          ))}
        </div>
        <div className="ak-card-gallery__row ak-card-gallery__row--bottom">
          <Cell caption="90px, 3 cards">
            <CardStack width={90} cards={table[0].cards} />
          </Cell>
          <Cell caption="120px, dim">
            <CardStack width={120} cards={table[4].cards} state="dim" />
          </Cell>
          <Cell caption="danger">
            <CardStack width={90} cards={table[1].cards} state="danger" />
          </Cell>
        </div>
      </Section>
    </div>
  );
}

export default CardGallery;
