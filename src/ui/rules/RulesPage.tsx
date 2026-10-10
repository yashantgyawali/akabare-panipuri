/** The #/rules page: three steps and the six cards. */
import { useEffect } from 'react';
import { Card } from '../../cards/index.ts';
import { Wordmark } from '../common/Brand.tsx';
import { usePhone } from '../common/hooks.ts';
import { HOME } from '../router.ts';
import { GALLERY, STEPS } from './data.ts';

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

        <h1 className="tp-sr">Rules</h1>
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
          <h2 className="tp-sr" id="rules-cards">
            Cards
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
      </main>
    </div>
  );
}
