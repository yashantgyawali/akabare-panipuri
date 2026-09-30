/** Hash-routed app shell: #/ home, #/g/<CODE> game, #/rules, #/cards (gallery). */
import { useEffect } from 'react';
import { CardGallery } from './cards/index.ts';
import { Wordmark } from './ui/common/Brand.tsx';
import { Icon } from './ui/common/Icon.tsx';
import { ToastProvider } from './ui/common/Toasts.tsx';
import { GameRoute } from './ui/game/GameRoute.tsx';
import { Home } from './ui/home/Home.tsx';
import { RulesPage } from './ui/rules/Rules.tsx';
import { HOME, useRoute } from './ui/router.ts';

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
  return <ToastProvider>{page}</ToastProvider>;
}
