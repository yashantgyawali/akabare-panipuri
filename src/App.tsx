/** Hash-routed app shell: #/ home, #/g/<CODE> game, #/rules, #/cards (gallery). */
import { Suspense, lazy, useEffect } from 'react';
import { Wordmark } from './ui/common/Brand.tsx';
import { Icon } from './ui/common/Icon.tsx';
import { ToastProvider } from './ui/common/Toasts.tsx';
import { Home } from './ui/home/Home.tsx';
import { HOME, useRoute } from './ui/router.ts';

// Code-split: the home page loads first; the table, the rules and the card gallery load on demand.
const GameRoute = lazy(() => import('./ui/game/GameRoute.tsx').then((m) => ({ default: m.GameRoute })));
const RulesPage = lazy(() => import('./ui/rules/Rules.tsx').then((m) => ({ default: m.RulesPage })));
const CardGallery = lazy(() => import('./cards/CardGallery.tsx').then((m) => ({ default: m.CardGallery })));

function Loading() {
  return (
    <main className="ak-screen">
      <div className="ak-loading" role="status">
        <span className="ak-loading__puri" aria-hidden="true" />
        <p>Loading…</p>
      </div>
    </main>
  );
}

function CardsPage() {
  useEffect(() => {
    document.title = 'The cards · Akabare Panipuri';
  }, []);
  return (
    <main className="ak-screen ak-screen--wide ak-cardspage">
      <header className="ak-screen__top">
        <Wordmark size="sm" link />
        <a className="ak-toplink" href={HOME}>
          <Icon name="arrowLeft" size={18} /> Home
        </a>
      </header>
      <CardGallery />
    </main>
  );
}

export function App() {
  const route = useRoute();
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
      page = <RulesPage />;
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
