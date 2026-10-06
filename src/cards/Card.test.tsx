import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';
import { existsSync } from 'node:fs';
import { COLORS } from '../engine/types.ts';
import { Card, CardBack, CardFront, CardStack, backImageUrl, cardHeight, cardName, defaultCardLabel } from './Card.tsx';
import { BACK_IMAGE_REV } from './backImages.ts';

// (React 19's SSR prepends <link rel=preload> tags for images: drop them)
const html = (el: ReactElement) => renderToStaticMarkup(el).replace(/<link [^>]*\/>/g, '');

describe('<Card>', () => {
  it('is a labelled span without onClick, a button with it', () => {
    const a = html(<Card back="puri" color="red" />);
    expect(a.startsWith('<span')).toBe(true);
    expect(a).toContain('role="img"');
    expect(a).toContain('aria-label="Face-down puri card owned by Red"');
    const b = html(<Card back="power" color="blue" face="vinegar" onClick={() => {}} state="selectable" />);
    expect(b.startsWith('<button')).toBe(true);
    expect(b).toContain('type="button"');
    expect(b).toContain('aria-label="Vinegar power card, Blue"');
    expect(b).toContain('aria-pressed="false"');
    expect(b).toContain('ak-card--up');
  });

  it('never puts a front in the DOM for an unknown face (no leak)', () => {
    const s = html(<Card back="puri" color="green" badge="Anil" />);
    expect(s).not.toContain('ak-card-front');
    expect(s).not.toMatch(/art\/(panipuri|akabare)/);
    expect(s).toContain('owned by Anil (Green)');
  });

  it('sizes to width × 88/63 and hides the rule below 150 px by default', () => {
    const s = html(<Card back="power" color="yellow" face="dahi" width={140} />);
    expect(s).toContain('width:140px');
    expect(s).toContain(`height:${cardHeight(140)}px`);
    expect(s).not.toContain('ak-card-front__rule');
    expect(html(<Card back="power" color="yellow" face="dahi" width={150} />)).toContain('ak-card-front__rule');
    expect(html(<Card back="power" color="yellow" face="dahi" width={90} showRule />)).toContain('ak-card-front__rule');
  });

  it('shows the peek chip and badge on the back, and the Panipuri instance numeral', () => {
    const s = html(<Card back="puri" color="red" face="panipuri" faceUp={false} peek="akabare" badge="You" instance={4} />);
    expect(s).toContain('ak-card-peek--akabare');
    expect(s).toContain('>A</span>');
    expect(s).toContain('ak-card-back__badge">You<');
    expect(s).toContain('ak-card-front__index">4<');
    expect(s).toContain('you know it is Akabare');
  });
});

describe('faces, urls, labels', () => {
  it('backImageUrl points at exported files', () => {
    expect(backImageUrl('puri', 'red')).toBe(`/backs/puri-red.webp?v=${BACK_IMAGE_REV}`);
    expect(backImageUrl('power', 'blue', true)).toBe(`/backs/power-blue-2x.webp?v=${BACK_IMAGE_REV}`);
    for (const k of ['puri', 'power'] as const) {
      for (const c of COLORS) {
        for (const hi of [false, true]) {
          const file = backImageUrl(k, c, hi).replace(/\?.*$/, '');
          expect(existsSync(new URL(`../../public${file}`, import.meta.url))).toBe(true);
        }
      }
    }
  });
  it('CardBack uses srcset/sizes; CardFront prints title, Devanagari and index', () => {
    const b = html(<CardBack kind="power" color="purple" width={90} />);
    expect(b).toMatch(/srcSet="[^"]+ 375w, [^"]+ 750w"/);
    expect(b).toContain('sizes="90px"');
    const f = html(<CardFront kind="nayaplate" color="orange" width={240} />);
    expect(f).toContain('NAYA PLATE');
    expect(f).toContain('नयाँ प्लेट');
    expect(f).toContain('ak-card-front__index">9<');
    expect(f).toContain('Flip any time');
  });
  it('names and labels', () => {
    expect(cardName('nayaplate')).toBe('Naya Plate');
    expect(defaultCardLabel({ back: 'puri', color: 'orange', face: 'akabare', faceUp: true })).toBe('Akabare card, Orange');
  });
});

describe('<CardStack>', () => {
  it('stacks top card last with a count bubble above 4', () => {
    const cards = COLORS.map((color) => ({ back: 'puri' as const, color }));
    const s = html(<CardStack cards={cards} width={56} offset={16} />);
    expect(s.match(/class="ak-card /g)?.length).toBe(6);
    expect(s).toContain('ak-card-stack__count');
    expect(s).toContain('>6</span>');
    expect(s).toContain('top:80px'); // 6th card at 5 × 16
    expect(s).toContain('top card owned by Orange');
    expect(html(<CardStack cards={cards.slice(0, 4)} />)).not.toContain('ak-card-stack__count');
  });
  it('squeezes to maxHeight and renders an empty slot', () => {
    const cards = Array.from({ length: 11 }, () => ({ back: 'puri' as const, color: 'blue' as const }));
    const s = html(<CardStack cards={cards} width={56} maxHeight={150} />);
    const h = cardHeight(56);
    expect(s).toContain(`height:${h + ((150 - h) / 10) * 10}px`);
    const e = html(<CardStack cards={[]} onClick={() => {}} />);
    expect(e).toContain('ak-card-stack__slot');
    expect(e).toContain('aria-label="Empty stack"');
  });
});
