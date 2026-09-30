/**
 * Public entry of the cards module: React components (see the API comment at the top of
 * ./Card.tsx), the gallery, and the framework-free data they are built from.
 *
 *   import { Card, CardStack, CardFront, CardBack, backImageUrl, CARD_INFO } from '../cards';
 *
 * Node scripts must import the framework-free modules directly (./backs.ts, ./palette.ts, …):
 * this file pulls in React and cards.css.
 */
export {
  Card,
  CardFront,
  CardBack,
  CardStack,
  backImageUrl,
  cardHeight,
  cardName,
  defaultCardLabel,
  CARD_ASPECT,
} from './Card.tsx';
export type {
  FaceKind,
  BackKind,
  CardState,
  CardProps,
  CardFrontProps,
  CardBackProps,
  CardStackProps,
  CardStackItem,
} from './Card.tsx';
export { CardGallery } from './CardGallery.tsx';
export { CARD_INFO, BACK_COPY, artUrl, cardIndex, PANIPURI_INDICES } from './content.ts';
export type { CardInfo, CardKind, BackCopy } from './content.ts';
export { PLAYER_PALETTE, CREAM, CREAM_BRIGHT, PAPER, INK, INK_SOFT, GOLD, CHILI, LEAF, PURI_GOLD } from './palette.ts';
export type { PlayerShades } from './palette.ts';
export { BACK_IMAGE_REV, BACK_IMAGE_VERSION } from './backImages.ts';
