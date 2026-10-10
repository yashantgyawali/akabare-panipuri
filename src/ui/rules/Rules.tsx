/** The rules body used inside the in-game drawer: the same three steps and six cards as the Rules page, kept short. */
import { Card } from '../../cards/index.ts';
import type { GameConfig } from '../../engine/types.ts';
import { GALLERY, STEPS } from './data.ts';

export function RulesContent({ compact = false }: { compact?: boolean; config?: GameConfig }) {
  return (
    <div className="tp-rules">
      <ol className="tp-bites">
        {STEPS.map((s) => (
          <li key={s.n} className="tp-bite">
            <span className="tp-bite__n tp-num" aria-hidden="true">
              {s.n}
            </span>
            <h3 className="tp-h3">{s.title}</h3>
            <p>{s.text}</p>
          </li>
        ))}
      </ol>
      <ul className="tp-rcards">
        {GALLERY.map((g) => (
          <li key={g.face} className="tp-rcard">
            <Card back={g.back} color={g.color} face={g.face} faceUp width={compact ? 84 : 140} decorative />
            <span className="tp-small tp-muted">{g.note}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
