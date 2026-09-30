/** Standalone mount of the card gallery for /cards-preview.html (npm run dev → /cards-preview.html). */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { CardGallery } from './CardGallery.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <CardGallery />
  </StrictMode>,
);
