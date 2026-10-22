/**
 * Card and room textures, cached. Backs are the pre-rendered back webps;
 * fronts are drawn on a canvas from the card art (only ever requested for a
 * card the viewer may see). A face-down card of another owner only ever gets
 * backTex(type, colour): nothing here is keyed by its kind.
 */
import * as THREE from 'three';
import type { ColorId } from '../../../engine/types.ts';
import { backImageUrl, CARD_INFO, CREAM_BRIGHT, INK, type BackKind, type FaceKind } from '../../../cards/index.ts';
import { FRAME_FILL } from '../../../cards/palette.ts';

const cache = new Map<string, THREE.Texture>();
const loader = new THREE.TextureLoader();
const W = 375;
const H = 525;

function srgb<T extends THREE.Texture>(t: T, aniso = 4): T {
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  return t;
}

function cached<T extends THREE.Texture>(key: string, make: () => T): T {
  let t = cache.get(key) as T | undefined;
  if (!t) {
    t = make();
    cache.set(key, t);
  }
  return t;
}

const images = new Map<string, Promise<HTMLImageElement>>();
function image(url: string): Promise<HTMLImageElement> {
  let p = images.get(url);
  if (!p) {
    p = new Promise((res, rej) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => res(img);
      img.onerror = rej;
      img.src = url;
    });
    images.set(url, p);
  }
  return p;
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** The face-down back of a card (owner's colour). */
export function backTex(type: BackKind, color: ColorId): THREE.Texture {
  return cached(`back:${type}:${color}`, () => srgb(loader.load(backImageUrl(type, color, true))));
}

/** Rounded-corner mask shared by every card face. */
export function cardAlpha(): THREE.Texture {
  return cached('alpha', () => {
    const c = document.createElement('canvas');
    c.width = 126;
    c.height = 176;
    const g = c.getContext('2d')!;
    g.fillStyle = '#000';
    g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#fff';
    roundRect(g, 1, 1, c.width - 2, c.height - 2, 9);
    g.fill();
    return new THREE.CanvasTexture(c);
  });
}

async function fontsReady() {
  try {
    await Promise.all([document.fonts.load('40px "Rozha One"'), document.fonts.load('700 30px Mukta')]);
  } catch {
    /* draw with the fallback font */
  }
}

/** A card front (the viewer may see this card). */
export function frontTex(face: FaceKind, color: ColorId): THREE.Texture {
  return cached(`front:${face}:${color}`, () => {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const t = srgb(new THREE.CanvasTexture(c));
    const info = CARD_INFO[face];
    const draw = (art: HTMLImageElement | null) => {
      const g = c.getContext('2d')!;
      g.fillStyle = FRAME_FILL[color];
      g.fillRect(0, 0, W, H);
      g.fillStyle = CREAM_BRIGHT;
      roundRect(g, 18, 18, W - 36, H - 36, 18);
      g.fill();
      if (art) {
        g.save();
        roundRect(g, 30, 30, W - 60, 330, 12);
        g.clip();
        const s = Math.max((W - 60) / art.width, 330 / art.height);
        g.drawImage(art, 30 + (W - 60 - art.width * s) / 2, 30 + (330 - art.height * s) / 2, art.width * s, art.height * s);
        g.restore();
      }
      g.fillStyle = FRAME_FILL[color];
      g.fillRect(30, 368, W - 60, 6);
      g.fillStyle = INK;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      const title = info.title;
      g.font = `${title.length > 9 ? 40 : 50}px "Rozha One", Georgia, serif`;
      g.fillText(title, W / 2, 418);
      g.font = '700 28px Mukta, sans-serif';
      g.fillStyle = FRAME_FILL[color];
      g.fillText(info.devanagari, W / 2, 462);
      // Corner index, like a playing card: readable on the sliver of a card held in a fan.
      const letter = info.title.slice(0, 1);
      const ink = face === 'akabare' ? '#C8321A' : INK;
      for (const [x, y, flip] of [[52, 66, false]] as const) {
        g.save();
        g.translate(x, y);
        if (flip) g.rotate(Math.PI);
        g.fillStyle = CREAM_BRIGHT;
        roundRect(g, -30, -36, 60, 72, 12);
        g.fill();
        g.strokeStyle = FRAME_FILL[color];
        g.lineWidth = 4;
        g.stroke();
        g.fillStyle = ink;
        g.font = '56px "Rozha One", Georgia, serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(letter, 0, 4);
        g.restore();
      }
      t.needsUpdate = true;
    };
    draw(null);
    void Promise.all([image(info.art), fontsReady()]).then(([img]) => draw(img), () => draw(null));
    return t;
  });
}

/** Your own face-down card: the back with a small reminder chip of what it is (only you get this). */
export function peekTex(type: BackKind, color: ColorId, face: FaceKind): THREE.Texture {
  return cached(`peek:${type}:${color}:${face}`, () => {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const t = srgb(new THREE.CanvasTexture(c));
    const draw = (back: HTMLImageElement | null) => {
      const g = c.getContext('2d')!;
      if (back) g.drawImage(back, 0, 0, W, H);
      else {
        g.fillStyle = FRAME_FILL[color];
        g.fillRect(0, 0, W, H);
      }
      const r = 62;
      g.fillStyle = CREAM_BRIGHT;
      g.strokeStyle = INK;
      g.lineWidth = 8;
      g.beginPath();
      g.arc(W - 30 - r, 30 + r, r, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      g.fillStyle = face === 'akabare' ? '#C8321A' : INK;
      g.font = '700 84px Mukta, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(CARD_INFO[face].title.slice(0, 1), W - 30 - r, 36 + r);
      t.needsUpdate = true;
    };
    draw(null);
    void Promise.all([image(backImageUrl(type, color, true)), fontsReady()]).then(([img]) => draw(img), () => draw(null));
    return t;
  });
}

/** A round brass token with a number painted on it (the high bid, stack counts). */
export function numberTex(text: string, ink: string, rim: string): THREE.Texture {
  return cached(`num:${text}:${ink}:${rim}`, () => {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const t = srgb(new THREE.CanvasTexture(c));
    const draw = () => {
      const g = c.getContext('2d')!;
      g.clearRect(0, 0, 256, 256);
      const grad = g.createRadialGradient(100, 90, 20, 128, 128, 128);
      grad.addColorStop(0, '#f6d78a');
      grad.addColorStop(0.7, '#c9953a');
      grad.addColorStop(1, '#7a5418');
      g.fillStyle = grad;
      g.beginPath();
      g.arc(128, 128, 126, 0, Math.PI * 2);
      g.fill();
      g.lineWidth = 14;
      g.strokeStyle = rim;
      g.beginPath();
      g.arc(128, 128, 112, 0, Math.PI * 2);
      g.stroke();
      g.fillStyle = ink;
      g.font = `700 ${text.length > 1 ? 128 : 150}px Mukta, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(text, 128, 138);
      t.needsUpdate = true;
    };
    draw();
    // Redraw once Mukta is in (the first draw may use the fallback font).
    void fontsReady().then(draw);
    return t;
  });
}

/** Procedural wood grain (no external images). */
export function woodTex(key: string, base: [number, number, number], rings: boolean, size = 512): THREE.Texture {
  return cached(`wood:${key}`, () => {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d')!;
    const img = g.createImageData(size, size);
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const waves = Array.from({ length: 6 }, () => ({ f: 2 + rnd() * 6, p: rnd() * 6.28, a: 0.02 + rnd() * 0.05 }));
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const u = x / size;
        const v = y / size;
        let w: number;
        if (rings) {
          const dx = u - 0.5;
          const dy = v - 0.5;
          let d = Math.sqrt(dx * dx + dy * dy) * 34;
          for (const k of waves) d += Math.sin(Math.atan2(dy, dx) * k.f + k.p) * k.a * 6;
          w = 0.5 + 0.5 * Math.sin(d);
        } else {
          let d = v * 46;
          for (const k of waves) d += Math.sin(u * k.f * 3.14 + k.p) * k.a * 30;
          w = 0.5 + 0.5 * Math.sin(d);
        }
        const n = 0.9 + 0.1 * Math.sin(u * 900 + v * 37) * Math.sin(v * 700);
        const s = (0.6 + 0.4 * Math.pow(w, 3)) * n;
        const i = (y * size + x) * 4;
        img.data[i] = base[0] * s;
        img.data[i + 1] = base[1] * s;
        img.data[i + 2] = base[2] * s;
        img.data[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    const t = srgb(new THREE.CanvasTexture(c));
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  });
}
