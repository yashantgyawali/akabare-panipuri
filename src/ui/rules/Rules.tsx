/** The rules (v0.6), condensed from the PDF plus the clarifications the engine implements. */
import { useEffect } from 'react';
import { DEFAULT_CONFIG, POWER_KINDS, type GameConfig, type PowerKind } from '../../engine/types.ts';
import { CardFront, Card } from '../../cards/index.ts';
import { Wordmark } from '../common/Brand.tsx';
import { Icon } from '../common/Icon.tsx';
import { cx, usePhone } from '../common/hooks.ts';
import { HOME } from '../router.ts';
import { goalText } from '../text.ts';

const POWER_ROWS: Record<PowerKind, { when: string; effect: string }> = {
  vinegar: { when: 'Before a puri', effect: 'Numbs your tongue: the next card you eat is cancelled. An Akabare can’t hurt you, a Panipuri doesn’t count. Only the next card.' },
  dahi: { when: 'Right after you bite an Akabare', effect: 'The lifesaver: you’re safe and keep eating. Flipped at any other time it does nothing.' },
  khali: { when: 'Any time', effect: 'An empty shell: your bid goes up by 1. Bid 5, flip Khali Puri, now you need 6 (and lose 6 if you bust).' },
  chaat: { when: 'Any time', effect: 'Counts as 2 Panipuri eaten. Bid 4, eat 1, flip Chaat: you’re at 3.' },
};

const EXAMPLES: { title: string; text: string }[] = [
  { title: 'Vinegar saves you', text: 'Sita suspects Ramesh planted his Akabare on top of his own stack. She flips her Vinegar first, then his top card. It’s the Akabare, cancelled. She’s safe.' },
  { title: 'Vinegar wastes a puri', text: 'Anil flips Vinegar, but his next card is a Panipuri. It doesn’t count.' },
  { title: 'The blind Dahi', text: 'Priya bites an Akabare and flips the power beside Anil’s stack, hoping for Dahi. It’s Chaat. She’s out: Chaat doesn’t count after a bite.' },
  { title: 'Chaat speeds you up', text: 'Ramesh bids 4, eats 1 Panipuri, then flips the power beside Sita’s stack. Chaat: he’s at 3 and needs 1 more.' },
  { title: 'Khali Puri backfires', text: 'Priya bids 5 and gambles on Ramesh’s power. Khali Puri: now she needs 6, and a bust costs her 6.' },
  { title: 'Chaat on an empty table', text: 'Anil bids 7. Every stack is empty and he’s eaten 5. He spends his last flip on Sita’s power. Chaat: 7. Success.' },
  { title: 'The planted chili', text: 'Sita slips her Akabare onto Anil’s stack. Ramesh wins the bid, clears his own stack, flips Anil’s top card: Akabare. He flips a power hoping for Dahi; it’s Khali Puri. Ramesh busts, and Sita gets +2.' },
];

/** `config`: the game's house rules (the in-game drawer); defaults to the standard v0.6 rules. */
export function RulesContent({ compact = false, config = DEFAULT_CONFIG }: { compact?: boolean; config?: GameConfig }) {
  const { targetScore: t, maxRounds: r, trapReward } = config;
  const phone = usePhone();
  const cardW = compact || phone ? 64 : 92;
  return (
    <div className={cx('ak-rules', compact && 'ak-rules--compact')}>
      <section className="ak-rules__sec">
        <h2>The idea</h2>
        <p>
          Everyone secretly builds a stack of puri, and anyone can add to anyone’s stack. Then comes the bidding: only the highest bidder eats. They start with their
          own stack, then dig into the others’. They may flip up to 2 power cards from anywhere on the table, but only their own is a known card. Bite an Akabare
          without the right power and you’re out.
        </p>
        <p className="ak-rules__facts">
          <span>3–6 players</span>
          <span>{goalText(config)}</span>
        </p>
        <div className="ak-rules__set" aria-label="Each player’s set">
          <figure>
            <div className="ak-rules__fan">
              {[0, 1, 2, 3, 4].map((i) => (
                <Card key={i} back="puri" color="yellow" face="panipuri" instance={i + 1} width={cardW * 0.7} decorative />
              ))}
              <Card back="puri" color="yellow" face="akabare" width={cardW * 0.7} decorative />
            </div>
            <figcaption>Your puri set: 5 Panipuri + 1 Akabare, in your colour. You get it all back every round.</figcaption>
          </figure>
          <figure>
            <div className="ak-rules__fan">
              {POWER_KINDS.map((k) => (
                <Card key={k} back="power" color="yellow" face={k} width={cardW * 0.7} decorative />
              ))}
            </div>
            <figcaption>Your powers: Vinegar, Dahi, Khali Puri, Chaat.</figcaption>
          </figure>
        </div>
      </section>

      <section className="ak-rules__sec">
        <h2>1 · Setup (every round)</h2>
        <ol>
          <li>
            <strong>Build your stack.</strong> Put 2 puri from your set face down, in any order, as your own stack. Only you know what they are. The other 4 stay in
            your hand. (You only have one Akabare, so at most one of the two.)
          </li>
          <li>
            <strong>Place your power</strong> face down beside your stack. A power counts as used as soon as you place it, flipped or not.
          </li>
          <li>
            <strong>First player:</strong> random in round 1, then it moves one seat clockwise each round.
          </li>
        </ol>
        <p>You can change your setup until the last player locks theirs in.</p>
        <table className="ak-rules__table">
          <caption>Which powers you can pick</caption>
          <thead>
            <tr>
              <th scope="col">Round</th>
              <th scope="col">Available</th>
              <th scope="col">Example pick</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>1</td>
              <td>All 4</td>
              <td>Vinegar</td>
            </tr>
            <tr>
              <td>2</td>
              <td>The 3 you haven’t used</td>
              <td>Chaat</td>
            </tr>
            <tr>
              <td>3</td>
              <td>The last 2</td>
              <td>Khali Puri</td>
            </tr>
            <tr>
              <td>4</td>
              <td>All 4 come back</td>
              <td>Vinegar</td>
            </tr>
            <tr>
              <td>5</td>
              <td>The 3 you didn’t pick in round 4</td>
              <td>Dahi</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section className="ak-rules__sec">
        <h2>2 · Serving</h2>
        <p>Starting with the first player and going clockwise, on your turn do one thing:</p>
        <ul>
          <li>
            <strong>Place a puri</strong> from your hand face down on top of <em>any</em> stack, yours or someone else’s. Its back shows your colour, so everyone knows
            who put it there, but not what it is.
          </li>
          <li>
            <strong>Or start the bid:</strong> announce how many Panipuri you’ll eat (at least 1).
          </li>
        </ul>
        <p>Once the bid starts nobody places any more cards. If your hand is empty on your turn, you must start the bid.</p>
      </section>

      <section className="ak-rules__sec">
        <h2>3 · Bidding</h2>
        <p>
          Clockwise from the player who opened, each player either <strong>raises</strong> by at least 1 or <strong>passes</strong> and is out for the round. The
          last player left is <strong>the eater</strong>; nobody else eats. If everyone passes straight away, the opener eats their opening bid.
        </p>
        <p>
          There’s no maximum bid (Chaat counts as 2). The game warns you if you bid more than anyone could possibly eat, that is, the face-down puri on the table plus
          2 for each power flip, but you can still go ahead.
        </p>
      </section>

      <section className="ak-rules__sec">
        <h2>4 · Eating</h2>
        <ol>
          <li>
            <strong>Your own stack first.</strong> Flip it from the top, one card at a time, until it’s empty.
          </li>
          <li>
            <strong>Then the others’.</strong> Each flip, pick any other stack and eat its top card. You can switch stacks between flips.
            <ul>
              <li>Panipuri: counts as 1 eaten.</li>
              <li>Akabare: you’re out, unless a power saves you.</li>
            </ul>
          </li>
          <li>
            <strong>Powers:</strong> at any point, flip up to 2 power cards from beside any stack. Your own is a known card; anyone else’s is a blind gamble.
          </li>
          <li>
            <strong>Stop when</strong> you reach your bid (success), you bite an Akabare and aren’t saved (bust), or every stack is empty and you’re still short with
            no flips left or you give up (bust). With an empty table you may still flip remaining powers first.
          </li>
        </ol>
      </section>

      <section className="ak-rules__sec">
        <h2>Power cards</h2>
        <ul className="ak-rules__powers">
          {POWER_KINDS.map((k) => (
            <li key={k} className="ak-rules__power">
              <CardFront kind={k} color={k === 'vinegar' ? 'yellow' : k === 'dahi' ? 'blue' : k === 'khali' ? 'orange' : 'green'} width={compact ? 96 : phone ? 104 : 150} showRule={!compact && !phone} />
              <div>
                <h3>
                  {k === 'khali' ? 'Khali Puri' : k[0].toUpperCase() + k.slice(1)} <span className="ak-rules__when">{POWER_ROWS[k].when}</span>
                </h3>
                <p>{POWER_ROWS[k].effect}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="ak-rules__sec ak-rules__sec--hot">
        <h2>
          <Icon name="chili" /> Biting an Akabare
        </h2>
        <p>
          You get one last chance. If you still have a power flip left, flip a power: <strong>Dahi saves you</strong> and you keep eating.{' '}
          <strong>Anything else and you’re out</strong>, even Chaat or Khali Puri: their effects don’t apply after a bite. Vinegar can’t save you after the bite; it
          only works before. You can also just accept the bust.
        </p>
      </section>

      <section className="ak-rules__sec">
        <h2>Scoring</h2>
        <p>Only the eater scores from the bid. The final bid includes any Khali Puri increases.</p>
        <ul>
          <li>
            <strong>Success:</strong> + your final bid (even if you ate more).
          </li>
          <li>
            <strong>Bust:</strong> − your final bid.
          </li>
          <li>
            <strong>Trap reward:</strong>{' '}
            {trapReward > 0 ? (
              <>
                if the eater busts on an Akabare, the owner of that Akabare (its colour, whoever’s stack it sat on) gets <strong>+{trapReward}</strong>.
              </>
            ) : (
              'none in this game (the host set it to 0).'
            )}
          </li>
        </ul>
        <p>No trap reward when the eater busts on their own Akabare, when the Akabare was cancelled by Vinegar or neutralised by Dahi, or when the table ran out.</p>
      </section>

      <section className="ak-rules__sec">
        <h2>Winning</h2>
        <p>
          At the end of each round everyone takes back their own puri and the first player moves clockwise.{' '}
          {t !== null ? `If anyone has ${t} or more points, the highest score wins.` : ''}
          {t !== null && r !== null ? ` If nobody reaches ${t}, the highest score after round ${r} wins.` : r !== null ? `The highest score after round ${r} wins.` : ' There is no round limit.'}
        </p>
        <p>
          <strong>Tiebreak:</strong> fewer busts across the game. Still tied? You share the win.
        </p>
        <p className="ak-muted">Hosts can change the target, the round limit (or drop one of them) and the trap reward in the lobby.</p>
      </section>

      <section className="ak-rules__sec">
        <h2>Examples</h2>
        <ul className="ak-rules__examples">
          {EXAMPLES.map((x) => (
            <li key={x.title}>
              <strong>{x.title}.</strong> {x.text}
            </li>
          ))}
        </ul>
      </section>

      <section className="ak-rules__sec">
        <h2>Small print</h2>
        <ul>
          <li>Vinegar cancels only the next puri you flip. Two Vinegars don’t stack.</li>
          <li>A failed save is a bust on that Akabare, even if the power you flipped was Chaat or Khali Puri.</li>
          <li>Face-down cards show only their owner (the back colour and initial). You can always see which of your own cards are where.</li>
          <li>Leftover cards stay secret at the end of a round unless the host turned on “reveal leftovers”. At game over everything is revealed.</li>
        </ul>
      </section>
    </div>
  );
}

export function RulesPage() {
  useEffect(() => {
    document.title = 'Rules · Akabare Panipuri';
  }, []);
  return (
    <main className="ak-screen ak-screen--wide ak-rulespage">
      <header className="ak-screen__top">
        <Wordmark size="sm" link />
        <a className="ak-toplink" href={HOME}>
          <Icon name="arrowLeft" size={18} /> Home
        </a>
      </header>
      <div className="ak-rulespage__hero">
        <p className="ak-kicker">Rules v0.6</p>
        <h1 className="ak-h1">How to play</h1>
        <p className="ak-rulespage__lede">Stack the puri. Bluff the bid. Don’t bite the chili.</p>
      </div>
      <article className="ak-paper ak-rulespage__body">
        <RulesContent />
      </article>
    </main>
  );
}
