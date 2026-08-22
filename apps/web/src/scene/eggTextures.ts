import {
  CanvasTexture,
  RepeatWrapping,
  SRGBColorSpace,
  type Texture,
} from "three";

const TEXTURE_SIZE = 1024;

type EggShellTextures = {
  map: Texture;
  bumpMap: Texture;
};

let cached: EggShellTextures | null = null;

function paintShellColor(ctx: CanvasRenderingContext2D, size: number) {
  const gradient = ctx.createLinearGradient(0, 0, size, size * 1.1);
  gradient.addColorStop(0, "#faf6ee");
  gradient.addColorStop(0.45, "#f3ead8");
  gradient.addColorStop(1, "#ddd0b8");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  for (let i = 0; i < 2_400; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const radius = Math.random() * 2.4 + 0.35;
    const alpha = Math.random() * 0.14 + 0.03;
    ctx.fillStyle = `rgba(96, 72, 48, ${alpha})`;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  for (let i = 0; i < 180; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const w = Math.random() * 28 + 8;
    const h = Math.random() * 6 + 2;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.random() * Math.PI);
    ctx.fillStyle = `rgba(255, 255, 255, ${Math.random() * 0.08 + 0.02})`;
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.restore();
  }
}

function paintShellBump(ctx: CanvasRenderingContext2D, size: number) {
  const image = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = x / size;
      const ny = y / size;
      const fine = Math.sin(nx * 180) * Math.cos(ny * 160);
      const coarse = Math.sin(nx * 42 + ny * 31) * 0.35;
      const speck = Math.random() * 0.18;
      const value = Math.floor((0.52 + fine * 0.08 + coarse * 0.12 + speck) * 255);
      const index = (y * size + x) * 4;
      image.data[index] = value;
      image.data[index + 1] = value;
      image.data[index + 2] = value;
      image.data[index + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
}

export function getEggShellTextures(): EggShellTextures {
  if (cached) return cached;

  const colorCanvas = document.createElement("canvas");
  colorCanvas.width = TEXTURE_SIZE;
  colorCanvas.height = TEXTURE_SIZE;
  const colorCtx = colorCanvas.getContext("2d");
  if (!colorCtx) throw new Error("Could not create egg shell color canvas");
  paintShellColor(colorCtx, TEXTURE_SIZE);

  const bumpCanvas = document.createElement("canvas");
  bumpCanvas.width = TEXTURE_SIZE;
  bumpCanvas.height = TEXTURE_SIZE;
  const bumpCtx = bumpCanvas.getContext("2d");
  if (!bumpCtx) throw new Error("Could not create egg shell bump canvas");
  paintShellBump(bumpCtx, TEXTURE_SIZE);

  const map = new CanvasTexture(colorCanvas);
  map.colorSpace = SRGBColorSpace;
  map.wrapS = RepeatWrapping;
  map.wrapT = RepeatWrapping;
  map.anisotropy = 8;

  const bumpMap = new CanvasTexture(bumpCanvas);
  bumpMap.wrapS = RepeatWrapping;
  bumpMap.wrapT = RepeatWrapping;
  bumpMap.anisotropy = 8;

  cached = { map, bumpMap };
  return cached;
}
