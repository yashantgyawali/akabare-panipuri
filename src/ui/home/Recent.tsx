/** Recent games as yellow pills: tap to rejoin, x to forget. */
import { useEffect, useState } from 'react';
import { clearSession, listSessions, saveSession, type Session } from '../../net/index.ts';
import { gameHref, navigate } from '../router.ts';

export function RecentGames() {
  const [sessions, setSessions] = useState<Session[]>(() => listSessions());
  useEffect(() => {
    const on = () => setSessions(listSessions());
    window.addEventListener('storage', on);
    return () => window.removeEventListener('storage', on);
  }, []);
  if (sessions.length === 0) return null;
  return (
    <section className="tp-home-recent" aria-labelledby="recent-h">
      <h2 className="tp-sr" id="recent-h">
        Recent
      </h2>
      <ul className="tp-home-recent__list">
        {sessions.slice(0, 6).map((s) => (
          <li key={s.code} className="tp-home-pill">
            <button
              type="button"
              className="tp-home-pill__main"
              aria-label={`Rejoin game ${s.code} as ${s.name}`}
              onClick={() => {
                saveSession(s);
                navigate(gameHref(s.code));
              }}
            >
              {s.code} · {s.name}
            </button>
            <button
              type="button"
              className="tp-home-pill__x"
              aria-label={`Forget game ${s.code}`}
              title="Forget"
              onClick={() => {
                clearSession(s.code, s.playerId);
                setSessions(listSessions());
              }}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
