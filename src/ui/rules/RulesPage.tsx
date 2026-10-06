/** The #/rules page: three bites, the cards, quick details, then the full rules. */
import { useEffect } from 'react';
import { Card } from '../../cards/index.ts';
import { Wordmark } from '../common/Brand.tsx';
import { usePhone } from '../common/hooks.ts';
import { HOME } from '../router.ts';
import { RulesContent } from './Rules.tsx';
import { DETAILS, GALLERY, STEPS } from './data.ts';

export interface RulesPageProps {
  /** Where the visitor came from, for the back button. */
  from?: { href: string; label: string };
}

export function RulesPage({ from = { href: HOME, label: 'Home' } }: RulesPageProps) {
  const phone = usePhone();
  useEffect(() => {
    document.title = 'Rules · Akabare Panipuri';
  }, []);
  return (
    <div className="tp-page">
      <main className="tp-container tp-container--narrow tp-rulespage">
        <header className="tp-header">
          <Wordmark link byline={false} />
          <a className="tp-btn" href={from.href}>
            <span aria-hidden="true">←</span> {from.label}
          </a>
        </header>

        <section className="tp-rulespage__title">
          <span className="tp-eyebrow">rules v0.6 · 3–6 players · ~20 minutes</span>
          <h1 className="tp-h1 tp-h1--md">How to play, in three bites</h1>
        </section>

        <ol className="tp-bites">
          {STEPS.map((s) => (
            <li key={s.n} className="tp-bite">
              <span className="tp-bite__n tp-num" aria-hidden="true">
                {s.n}
              </span>
              <h2 className="tp-h2">{s.title}</h2>
              <p>{s.text}</p>
            </li>
          ))}
        </ol>

        <section className="tp-rulespage__sec" aria-labelledby="rules-cards">
          <h2 className="tp-h2 tp-h2--lg" id="rules-cards">
            The cards
          </h2>
          <ul className="tp-rcards">
            {GALLERY.map((g) => (
              <li key={g.face} className="tp-rcard">
                <Card back={g.back} color={g.color} face={g.face} faceUp width={phone ? 132 : 190} decorative />
                <span className="tp-small tp-muted">{g.note}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="tp-rulespage__sec" aria-labelledby="rules-details">
          <h2 className="tp-h2 tp-h2--lg" id="rules-details">
            The details
          </h2>
          <dl className="tp-details">
            {DETAILS.map((d) => (
              <div key={d.k} className="tp-details__row">
                <dt>{d.k}</dt>
                <dd>{d.v}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="tp-rulespage__sec tp-rulespage__full" aria-labelledby="rules-full">
          <h2 className="tp-h2 tp-h2--lg" id="rules-full">
            The full rules
          </h2>
          <p className="tp-muted">Every power, every edge case and some worked examples.</p>
          <article className="tp-panel tp-panel--shadow-yellow tp-rulespage__body">
            <RulesContent />
          </article>
        </section>
      </main>
    </div>
  );
}
