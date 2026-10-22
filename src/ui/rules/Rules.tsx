/**
 * The rules inside the in-game drawer (a light beige sheet): the same five
 * steps as the #/rules page, cut down to a line or two each with a small
 * picture, then the bite, the powers and scoring. Numbers come from the
 * game's own config. No dark-theme classes: everything here is .rq-* and
 * the shared .rp-* pictures (rules.css).
 */
import type { ReactNode } from 'react';
import { DEFAULT_CONFIG, type GameConfig } from '../../engine/types.ts';
import { RULES } from '../router.ts';
import { cx } from '../common/hooks.ts';
import { POWERS, goalLine, plural, powerReturnText } from './data.ts';
import { Arrow, Delta, OpenBowl, Power, Say, Stack } from './Pictures.tsx';

/** ": " between a kit item's name and its line: read aloud always, shown only when the two run inline (phones). */
const Sep = () => <span className="rq-kit__sep">: </span>;

function QStep({ n, title, pic, children }: { n: number; title: string; pic: ReactNode; children: ReactNode }) {
  return (
    <li className="rq-step">
      <span className="rq-step__n" aria-hidden="true">
        {n}
      </span>
      <div className="rq-step__body">
        <h3 className="rq-h3">
          <span className="tp-sr">Step {n}: </span>
          {title}
        </h3>
        <p>{children}</p>
      </div>
      <div className="rq-step__pic" aria-hidden="true">
        {pic}
      </div>
    </li>
  );
}

export function RulesContent({ compact = false, config }: { compact?: boolean; config?: GameConfig }) {
  const c = config ?? DEFAULT_CONFIG;
  const s = compact ? 36 : 42;
  const hand = c.panipuriPerPlayer + 1 - c.startingStack;
  return (
    <div className={cx('rq', compact && 'rq--compact')}>
      <p className="rq-hook">
        <strong>Eat the bowls you bid. Don't bite an Akabare.</strong> Sneak yours onto other stacks: if it busts someone else, you get +{c.trapReward}.{' '}
        {goalLine(c)}
      </p>

      <section className="rq-sec" aria-labelledby="rq-kit">
        <h3 id="rq-kit" className="rq-h3">
          You have
        </h3>
        <ul className="rq-kit">
          <li>
            <OpenBowl kind="panipuri" color="green" size={s + 8} />
            <span>
              <strong>{plural(c.panipuriPerPlayer, 'Panipuri bowl')}</strong>
              <Sep />each counts 1 toward the bid
            </span>
          </li>
          <li>
            <OpenBowl kind="akabare" color="green" size={s + 8} />
            <span>
              <strong>1 Akabare bowl</strong>
              <Sep />bite it and you bust (lose points)
            </span>
          </li>
          <li>
            <Power color="green" width={compact ? 32 : 36} />
            <span>
              <strong>4 power cards</strong>
              <Sep />flip them for help when you eat. Hide 1 a round.
            </span>
          </li>
        </ul>
      </section>

      <ol className="rq-steps">
        <QStep
          n={1}
          title="Hide"
          pic={
            <>
              <Stack bowls={[{ color: 'green' }, { color: 'green' }]} size={s} />
              <Power color="green" width={compact ? 28 : 32} />
            </>
          }
        >
          <strong>Hide {plural(c.startingStack, 'bowl')} upside down as your stack</strong> (the top one gets eaten first) and 1 power card face down.{' '}
          {hand} bowls stay in your hand.
        </QStep>
        <QStep
          n={2}
          title="Serve"
          pic={
            <>
              <Stack bowls={[{ color: 'green' }]} size={s} />
              <Arrow size={18} />
              <Stack bowls={[{ color: 'blue' }, { color: 'blue' }]} size={s} />
            </>
          }
        >
          <strong>On your turn, serve or bid.</strong> Serve: put 1 bowl upside down on any stack, your own too. Or open the bidding
          {c.minBid > 1 ? ` at ${c.minBid} or more` : ''}. No bowls left? You must bid.
        </QStep>
        <QStep
          n={3}
          title="Bid"
          pic={
            <>
              <Say>4</Say>
              <Say>Pass</Say>
            </>
          }
        >
          <strong>Raise or pass, clockwise.</strong> The last one left is the eater and must eat that many bowls.
        </QStep>
        <QStep
          n={4}
          title="Eat"
          pic={
            <>
              <Stack bowls={[{ color: 'green' }]} size={s} />
              <Arrow size={18} />
              <OpenBowl kind="panipuri" color="green" size={s} />
            </>
          }
        >
          <strong>Flip bowls one at a time, top bowl first. Start with your own stack.</strong> Then the top bowl of any other stack, in any order. Only
          Naya Plate lets you skip your own. Any time, flip up to {plural(c.powerFlipsMax, 'power card')}, yours or anyone's: the effect works for you.
          Reach your bid and you stop. No bowls left on the table and still short? Flip a power card if you can (a Chaat might get you there).
          Otherwise you bust.
        </QStep>
        <QStep
          n={5}
          title="Score"
          pic={
            <>
              <Delta value="+4" />
              <Delta value="−4" />
            </>
          }
        >
          <strong>Made it: plus your bid. Bust: minus your bid.</strong> If someone else's Akabare busts you, its owner gets +{c.trapReward}.
        </QStep>
      </ol>

      <section className="rq-box" aria-labelledby="rq-bite">
        <h3 id="rq-bite" className="rq-h3">
          Bitten by an Akabare?
        </h3>
        <p>
          If you've flipped fewer than {plural(c.powerFlipsMax, 'power card')} and one is still face down, you get one try: flip a power card.{' '}
          <strong>Dahi saves you.</strong> Anything else, or no try left, and you bust.
        </p>
      </section>

      <section className="rq-sec" aria-labelledby="rq-powers">
        <h3 id="rq-powers" className="rq-h3">
          Power cards
        </h3>
        <ul className="rq-powers">
          {POWERS.map((p) => (
            <li key={p.kind}>
              <Power kind={p.kind} color={p.color} width={compact ? 52 : 64} />
              <span>
                <strong>{p.name}</strong> <span className="rq-when">{p.when}</span>
                <br />
                {p.text}
              </span>
            </li>
          ))}
        </ul>
        <p className="rq-note">
          {powerReturnText(c)} A card is used up once it's down, even if nobody flips it.
        </p>
      </section>

      <p className="rq-more">
        <a href={RULES} target="_blank" rel="noopener">
          Full rules with an example <span className="rq-more__tab">(opens in a new tab)</span>
          <svg className="rq-more__icon" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </a>
      </p>
    </div>
  );
}
