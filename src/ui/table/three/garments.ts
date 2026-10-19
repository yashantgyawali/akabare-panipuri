/**
 * Clothing textures for the Nepali characters, drawn on canvases (no image
 * files): the Dhaka topi pattern, and the front of each garment in the
 * player's colour. Cached per garment + colour.
 */
import * as THREE from 'three';
import type { Top } from './looks.ts';

const cache = new Map<string, THREE.Texture>();

function tex(key: string, w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void, repeat = false): THREE.Texture {
  let t = cache.get(key);
  if (t) return t;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!, w, h);
  t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  cache.set(key, t);
  return t;
}

/** Mix a hex colour toward black (k < 0) or white (k > 0). */
export function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(k < 0 ? v * (1 + k) : v + (255 - v) * k));
  return `#${ch.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** The Dhaka topi weave: bands of small diamonds and triangles in red, black, orange, green and white. */
export function dhakaTex(): THREE.Texture {
  return tex(
    'dhaka',
    128,
    128,
    (g, w, h) => {
      g.fillStyle = '#fbf5e8';
      g.fillRect(0, 0, w, h);
      const bands = ['#d42a1e', '#1d1a17', '#f28a1c', '#2d8a3e', '#d42a1e', '#2350a8', '#1d1a17', '#f2b51c'];
      const bh = h / bands.length;
      bands.forEach((col, r) => {
        const y = r * bh;
        g.fillStyle = col;
        g.fillRect(0, y + bh * 0.42, w, bh * 0.16);
        // a row of diamonds, offset every other band
        const step = 16;
        for (let x = (r % 2) * (step / 2) - step; x < w + step; x += step) {
          g.beginPath();
          g.moveTo(x, y + bh / 2);
          g.lineTo(x + step / 2, y + 2);
          g.lineTo(x + step, y + bh / 2);
          g.lineTo(x + step / 2, y + bh - 2);
          g.closePath();
          g.fill();
          g.fillStyle = '#f3ead8';
          g.fillRect(x + step / 2 - 1.5, y + bh / 2 - 1.5, 3, 3);
          g.fillStyle = col;
        }
      });
    },
    true,
  );
}

const CREAM = '#efe6d2';
const GOLD = '#d9a62e';

function buttons(g: CanvasRenderingContext2D, x: number, y0: number, n: number, gap: number, col = GOLD) {
  g.fillStyle = col;
  for (let i = 0; i < n; i++) {
    g.beginPath();
    g.arc(x, y0 + i * gap, 5, 0, Math.PI * 2);
    g.fill();
  }
}

function border(g: CanvasRenderingContext2D, pts: [number, number][], width: number, col = GOLD) {
  g.strokeStyle = col;
  g.lineWidth = width;
  g.lineJoin = 'round';
  g.beginPath();
  pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.stroke();
}

/** The front of a garment (canvas 256 x 288, the torso's front face). */
export function frontTex(top: Top, color: string, vest: boolean): THREE.Texture {
  return tex(`front:${top}:${color}:${vest ? 1 : 0}`, 256, 288, (g, w, h) => {
    const dark = shade(color, -0.3);
    const light = shade(color, 0.25);
    switch (top) {
      case 'daura': {
        g.fillStyle = CREAM;
        g.fillRect(0, 0, w, h);
        // the daura's crossover flap and its ties
        border(g, [[40, 0], [70, 60], [150, 130], [215, 150]], 5, '#cbbd9f');
        g.strokeStyle = '#a8957a';
        g.lineWidth = 3;
        for (const [x, y] of [[96, 84], [150, 128]]) {
          g.beginPath();
          g.moveTo(x, y);
          g.lineTo(x + 14, y + 22);
          g.moveTo(x, y);
          g.lineTo(x - 6, y + 24);
          g.stroke();
        }
        if (vest) {
          g.fillStyle = color;
          g.fillRect(0, 0, 86, h);
          g.fillRect(170, 0, 86, h);
          g.fillStyle = dark;
          g.fillRect(80, 30, 6, h - 30);
          g.fillRect(170, 30, 6, h - 30);
          buttons(g, 92, 70, 4, 50);
          // pocket
          g.fillStyle = dark;
          g.fillRect(186, 180, 48, 6);
        }
        break;
      }
      case 'kurta': {
        g.fillStyle = color;
        g.fillRect(0, 0, w, h);
        g.fillStyle = dark;
        g.fillRect(118, 0, 20, 150);
        buttons(g, 128, 30, 3, 38, CREAM);
        border(g, [[60, 0], [128, 40], [196, 0]], 6);
        break;
      }
      case 'jacket': {
        g.fillStyle = '#ece6dc';
        g.fillRect(0, 0, w, h);
        g.fillStyle = color;
        g.fillRect(0, 0, 100, h);
        g.fillRect(156, 0, 100, h);
        g.fillStyle = dark;
        g.fillRect(96, 0, 6, h);
        g.fillRect(154, 0, 6, h);
        // collar
        g.beginPath();
        g.moveTo(60, 0);
        g.lineTo(100, 60);
        g.lineTo(100, 0);
        g.moveTo(196, 0);
        g.lineTo(156, 60);
        g.lineTo(156, 0);
        g.fill();
        break;
      }
      case 'sari': {
        // blouse and pleats
        g.fillStyle = dark;
        g.fillRect(0, 0, w, h);
        g.fillStyle = color;
        g.fillRect(0, 150, w, h - 150);
        g.strokeStyle = shade(color, -0.12);
        g.lineWidth = 3;
        for (let x = 30; x < w; x += 26) {
          g.beginPath();
          g.moveTo(x, 160);
          g.lineTo(x - 8, h);
          g.stroke();
        }
        // the pallu over the left shoulder, with gold borders and buttis
        g.fillStyle = light;
        g.beginPath();
        g.moveTo(150, 0);
        g.lineTo(256, 0);
        g.lineTo(256, 70);
        g.lineTo(70, h);
        g.lineTo(0, h);
        g.lineTo(0, 210);
        g.closePath();
        g.fill();
        border(g, [[150, 0], [0, 210]], 10);
        border(g, [[256, 70], [70, h]], 10);
        g.fillStyle = GOLD;
        for (let i = 0; i < 9; i++) {
          const t = i / 8;
          g.beginPath();
          g.arc(200 - t * 170 + 10, 30 + t * 220, 4, 0, Math.PI * 2);
          g.fill();
        }
        break;
      }
      case 'kurtaF': {
        g.fillStyle = color;
        g.fillRect(0, 0, w, h);
        border(g, [[80, 0], [128, 70], [176, 0]], 7);
        g.fillStyle = GOLD;
        for (let i = 0; i < 6; i++) g.fillRect(122, 80 + i * 14, 12, 6);
        // the dupatta over both shoulders
        g.fillStyle = '#f2c94c';
        g.fillRect(0, 0, 46, h);
        g.fillRect(210, 0, 46, h);
        border(g, [[46, 0], [46, h]], 6, shade(color, -0.2));
        border(g, [[210, 0], [210, h]], 6, shade(color, -0.2));
        break;
      }
      case 'cholo': {
        g.fillStyle = color;
        g.fillRect(0, 0, w, h);
        // the crossover front and its ties
        g.fillStyle = light;
        g.beginPath();
        g.moveTo(60, 0);
        g.lineTo(200, 0);
        g.lineTo(256, 70);
        g.lineTo(256, 150);
        g.closePath();
        g.fill();
        border(g, [[60, 0], [256, 150]], 6, dark);
        g.strokeStyle = CREAM;
        g.lineWidth = 4;
        for (const [x, y] of [[170, 86], [222, 124]]) {
          g.beginPath();
          g.moveTo(x, y);
          g.lineTo(x + 6, y + 26);
          g.moveTo(x, y);
          g.lineTo(x - 10, y + 24);
          g.stroke();
        }
        // patuka sash
        g.fillStyle = '#f0e2c4';
        g.fillRect(0, 222, w, 50);
        for (let x = 0; x < w; x += 24) {
          g.fillStyle = '#b3261e';
          g.fillRect(x, 232, 12, 8);
          g.fillStyle = '#2f6b3a';
          g.fillRect(x + 12, 254, 12, 8);
        }
        break;
      }
      case 'shawl': {
        g.fillStyle = CREAM;
        g.fillRect(0, 0, w, h);
        g.fillStyle = color;
        g.beginPath();
        g.moveTo(0, 0);
        g.lineTo(110, 0);
        g.lineTo(90, h);
        g.lineTo(0, h);
        g.closePath();
        g.fill();
        g.beginPath();
        g.moveTo(146, 0);
        g.lineTo(256, 0);
        g.lineTo(256, h);
        g.lineTo(166, h);
        g.closePath();
        g.fill();
        g.strokeStyle = light;
        g.lineWidth = 3;
        for (let y = 20; y < h; y += 22) {
          g.beginPath();
          g.moveTo(0, y);
          g.lineTo(100, y - 4);
          g.moveTo(156, y - 4);
          g.lineTo(256, y);
          g.stroke();
        }
        border(g, [[110, 0], [90, h]], 6, dark);
        border(g, [[146, 0], [166, h]], 6, dark);
        break;
      }
    }
  });
}

/** Main garment colour for the sides, back and shoulders. */
export function bodyColor(top: Top, color: string, vest: boolean): string {
  if (top === 'daura') return vest ? color : CREAM;
  return color;
}

/** Sleeve colour (upper arm) and whether the forearm is bare. */
export function sleeve(top: Top, color: string): { color: string; bareForearm: boolean } {
  switch (top) {
    case 'daura':
      return { color: CREAM, bareForearm: false };
    case 'sari':
      return { color: shade(color, -0.3), bareForearm: true };
    case 'jacket':
    case 'kurta':
    case 'kurtaF':
    case 'cholo':
    case 'shawl':
      return { color, bareForearm: false };
  }
}

/** Trousers / lower garment colour. */
export function lowerColor(top: Top, color: string): string {
  switch (top) {
    case 'daura':
      return CREAM;
    case 'kurta':
      return '#e9e2d4';
    case 'jacket':
      return '#2d3a52';
    case 'sari':
    case 'cholo':
      return color;
    case 'kurtaF':
      return '#efe6d2';
    case 'shawl':
      return '#6b2a1f';
  }
}
