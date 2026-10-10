/** Hash-routed app shell: #/ home, #/g/<CODE> game, #/rules, #/cards (gallery). */
import { Suspense, lazy, useEffect, useRef } from 'react';
import { Wordmark } from './ui/common/Brand.tsx';
import { Icon } from './ui/common/Icon.tsx';
import { ToastProvider } from './ui/common/Toasts.tsx';
import { Home } from './ui/home/Home.tsx';
import { HOME, gameHref, useRoute, type Route } from './ui/router.ts';

// Code-split: the home page loads first; the table, the rules and the card gallery load on demand.
const GameRoute = lazy(() => import('./ui/game/GameRoute.tsx').then((m) => ({ default: m.GameRoute })));
const RulesPage = lazy(() => import('./ui/rules/RulesPage.tsx').then((m) => ({ default: m.RulesPage })));
const CardGallery = lazy(() => import('./cards/CardGallery.tsx').then((m) => ({ default: m.CardGallery })));

function Loading() {
  return (
    <div className="tp-page">
      <main className="tp-loading" role="status">
        <span className="tp-spinner" aria-hidden="true" />
        <p>Loading…</p>
      </main>
    </div>
  );
}

function CardsPage() {
  useEffect(() => {
    document.title = 'Cards · Akabare Panipuri';
  }, []);
  return (
    <div className="tp-page">
      <main className="tp-container tp-cardspage">
        <header className="tp-header">
          <Wordmark link byline={false} />
          <a className="tp-btn" href={HOME}>
            <Icon name="arrowLeft" size={18} /> Home
          </a>
        </header>
        <div className="tp-panel tp-panel--ink tp-cardspage__stage">
          <CardGallery />
        </div>
      </main>
    </div>
  );
}

/** Back target for the rules page: the table/lobby we came from, else home. */
function rulesBack(prev: Route | null): { href: string; label: string } {
  if (prev?.name === 'game') return { href: gameHref(prev.code), label: 'Back to the game' };
  return { href: HOME, label: 'Home' };
}

export function App() {
  const route = useRoute();
  const prev = useRef<Route | null>(null);
  const last = useRef<Route | null>(null);
  if (last.current !== route && last.current?.name !== route.name) {
    prev.current = last.current;
  }
  last.current = route;
  const key = route.name === 'game' ? `game:${route.code}` : route.name;
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [key]);
  let page;
  switch (route.name) {
    case 'game':
      page = <GameRoute key={route.code} code={route.code} />;
      break;
    case 'rules':
      page = <RulesPage from={rulesBack(prev.current)} />;
      break;
    case 'cards':
      page = <CardsPage />;
      break;
    default:
      page = <Home />;
  }
  return (
    <ToastProvider>
      <Suspense fallback={<Loading />}>{page}</Suspense>
    </ToastProvider>
  );
}
