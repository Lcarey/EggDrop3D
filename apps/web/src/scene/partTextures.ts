import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from "three";

/**
 * Procedural Canvas2D textures for build parts. Everything here is generated
 * once, cached at module level, and shared by every mesh that uses it, so the
 * cost is a few milliseconds at first paint and zero afterwards.
 *
 * All generators are guarded for environments without a 2D canvas (jsdom) and
 * return null there; callers fall back to flat colours.
 */

type ShellCanvas = { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D };

const textureCache = new Map<string, CanvasTexture | null>();

const createCanvas = (size: number): ShellCanvas | null => {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  return { canvas, ctx };
};

// Deterministic PRNG so textures look identical across sessions and machines.
const mulberry32 = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const finalize = (canvas: HTMLCanvasElement, srgb: boolean): CanvasTexture => {
  const texture = new CanvasTexture(canvas);
  if (srgb) texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.anisotropy = 4;
  return texture;
};

const cached = (key: string, srgb: boolean, paint: (shell: ShellCanvas) => void): CanvasTexture | null => {
  if (textureCache.has(key)) return textureCache.get(key) ?? null;
  const shell = createCanvas(256);
  if (!shell) {
    textureCache.set(key, null);
    return null;
  }
  paint(shell);
  const texture = finalize(shell.canvas, srgb);
  textureCache.set(key, texture);
  return texture;
};

/** Kraft-paper colour map: near-white base with darker fibre flecks, meant to be tinted by the material colour. */
export const getCardboardMap = (): CanvasTexture | null =>
  cached("cardboard-map", true, ({ canvas, ctx }) => {
    const random = mulberry32(101);
    ctx.fillStyle = "#f5ecdd";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < 2600; i += 1) {
      const shade = 205 + Math.floor(random() * 50);
      ctx.fillStyle = `rgba(${shade}, ${shade - 12}, ${shade - 34}, ${0.16 + random() * 0.2})`;
      ctx.fillRect(random() * canvas.width, random() * canvas.height, 1 + random() * 2.4, 1 + random() * 1.4);
    }
    for (let i = 0; i < 90; i += 1) {
      ctx.strokeStyle = `rgba(150, 120, 78, ${0.05 + random() * 0.08})`;
      ctx.lineWidth = 0.6 + random() * 0.8;
      const x = random() * canvas.width;
      const y = random() * canvas.height;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (random() - 0.5) * 42, y + (random() - 0.5) * 10);
      ctx.stroke();
    }
  });

/** Corrugation bump map: soft vertical flutes plus fibre noise. */
export const getCardboardBump = (): CanvasTexture | null =>
  cached("cardboard-bump", false, ({ canvas, ctx }) => {
    const random = mulberry32(202);
    ctx.fillStyle = "#808080";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const flute = 16;
    for (let x = 0; x < canvas.width; x += 1) {
      const wave = Math.sin((x / flute) * Math.PI * 2) * 0.5 + 0.5;
      const shade = Math.round(112 + wave * 34);
      ctx.fillStyle = `rgba(${shade}, ${shade}, ${shade}, 0.55)`;
      ctx.fillRect(x, 0, 1, canvas.height);
    }
    for (let i = 0; i < 2000; i += 1) {
      const shade = 100 + Math.floor(random() * 56);
      ctx.fillStyle = `rgba(${shade}, ${shade}, ${shade}, 0.3)`;
      ctx.fillRect(random() * canvas.width, random() * canvas.height, 1.6, 1.2);
    }
  });

/** Barber-pole stripes for straws, baked in the given colour on white. */
export const getStrawMap = (color: string): CanvasTexture | null =>
  cached(`straw-map-${color}`, true, ({ canvas, ctx }) => {
    ctx.fillStyle = "#fbfbf8";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = color;
    const stripe = canvas.width / 4;
    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate(-Math.PI / 7);
    for (let x = -canvas.width * 1.5; x < canvas.width * 1.5; x += stripe * 2) {
      ctx.fillRect(x, -canvas.height * 1.5, stripe, canvas.height * 3);
    }
    ctx.restore();
  });

/** Newsprint: pale paper, faint column rules, dashes of fake body text, and one halftone photo block. */
export const getNewsprintMap = (): CanvasTexture | null =>
  cached("newsprint-map", true, ({ canvas, ctx }) => {
    const random = mulberry32(303);
    ctx.fillStyle = "#eceae2";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < 1400; i += 1) {
      const shade = 196 + Math.floor(random() * 40);
      ctx.fillStyle = `rgba(${shade}, ${shade}, ${shade - 8}, 0.35)`;
      ctx.fillRect(random() * canvas.width, random() * canvas.height, 1.5, 1.5);
    }
    ctx.fillStyle = "rgba(58, 58, 62, 0.62)";
    for (let column = 0; column < 2; column += 1) {
      const left = 14 + column * 128;
      for (let y = 22; y < canvas.height - 12; y += 7) {
        let x = left;
        while (x < left + 100) {
          const word = 6 + random() * 18;
          ctx.fillRect(x, y, word, 2.4);
          x += word + 4;
        }
      }
    }
    for (let dotY = 40; dotY < 120; dotY += 5) {
      for (let dotX = 150; dotX < 236; dotX += 5) {
        const radius = 0.6 + random() * 1.5;
        ctx.beginPath();
        ctx.fillStyle = "rgba(70, 70, 74, 0.5)";
        ctx.arc(dotX, dotY, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  });
