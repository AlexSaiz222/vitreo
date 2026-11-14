/**
 * Water on glass (D118): tiling textures made by code when the glass is
 * built, no third-party asset and nothing to download. Pure, so tested
 * without a browser.
 *
 * The drop tile is RGBA, one texel row up the pane per row:
 * - RG: how the drop's surface leans there (0.5 flat), for the fake refraction;
 * - B: how thick the water is (0 dry, 1 the top of a drop);
 * - A: how wet the glass must be for this drop to be there (small ones first).
 *
 * Drops are thrown one by one, biggest first, wrapping round the edges: no
 * grid to read, and no seam when the tile repeats.
 */

/** A fixed sequence: the same drops every visit, and in captures. */
function createRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 16807) % 2147483647;
    return state / 2147483647;
  };
}

/** How many of each size, as a share of the tile's width: few big, many small. */
const SIZES = [
  { radius: [0.02, 0.028], count: 7 },
  { radius: [0.011, 0.018], count: 34 },
  { radius: [0.004, 0.009], count: 300 },
] as const;
/** Space kept between two drops, as a share of the tile's width. */
const GAP = 0.004;
/** Attempts per drop before giving up on it: the tile just has one fewer. */
const TRIES = 40;

interface Drop {
  x: number;
  y: number;
  radius: number;
}

/** Shortest way round a tile of width 1. */
const wrapped = (d: number) => d - Math.round(d);

export function dropTile(size = 512, seed = 11): Uint8Array {
  const random = createRandom(seed);
  const data = new Uint8Array(size * size * 4);
  // Flat and dry; a threshold of 0 outside the drops, so that smaller mips
  // (which average it with the drops') fade them by thickness alone.
  for (let i = 0; i < size * size; i++) {
    data[i * 4] = 128;
    data[i * 4 + 1] = 128;
  }
  const placed: Drop[] = [];
  const biggest = SIZES[0].radius[1];
  for (const { radius, count } of SIZES) {
    for (let n = 0; n < count; n++) {
      const r = radius[0] + random() * (radius[1] - radius[0]);
      let spot: Drop | null = null;
      for (let t = 0; t < TRIES && !spot; t++) {
        const x = random();
        const y = random();
        const clear = placed.every((other) => {
          const dx = wrapped(x - other.x);
          const dy = wrapped(y - other.y);
          return Math.hypot(dx, dy) > r + other.radius + GAP;
        });
        if (clear) spot = { x, y, radius: r };
      }
      // Always use the same numbers per drop, placed or not.
      const lobes = random() * Math.PI * 2;
      const lobeSize = 0.03 + random() * 0.07;
      const threshold = 0.06 + 0.5 * random() + 0.36 * (r / biggest);
      if (!spot) continue;
      placed.push(spot);
      stamp(data, size, spot, { lobes, lobeSize, threshold: Math.min(threshold, 0.98) });
    }
  }
  return data;
}

function stamp(
  data: Uint8Array,
  size: number,
  drop: Drop,
  shape: { lobes: number; lobeSize: number; threshold: number },
): void {
  // A little room for the uneven edge, in texels.
  const reach = Math.ceil(drop.radius * size * 1.3);
  const cx = drop.x * size;
  const cy = drop.y * size;
  const radius = drop.radius * size;
  const startX = Math.floor(cx - reach);
  const startY = Math.floor(cy - reach);
  for (let py = startY; py <= startY + reach * 2; py++) {
    for (let px = startX; px <= startX + reach * 2; px++) {
      const dx = px + 0.5 - cx;
      const dy = py + 0.5 - cy;
      // Water hangs: a drop is narrower above and rounder below.
      const sag = dy > 0 ? 1.18 : 0.94;
      const angle = Math.atan2(dy, dx);
      // Round, a little uneven: low frequencies only, or it reads as a polygon.
      const edge =
        radius *
        (1 +
          shape.lobeSize * Math.sin(angle * 2 + shape.lobes) +
          0.4 * shape.lobeSize * Math.sin(angle * 3 + shape.lobes * 2));
      const u = dx / edge;
      const v = (dy * sag) / edge;
      const distance = Math.hypot(u, v);
      if (distance >= 1) continue;
      const i = ((py + size * 4) % size) * size + ((px + size * 4) % size);
      data[i * 4] = Math.round(127.5 + 127.5 * u);
      data[i * 4 + 1] = Math.round(127.5 + 127.5 * v);
      data[i * 4 + 2] = Math.round(255 * Math.sqrt(1 - distance * distance));
      data[i * 4 + 3] = Math.round(255 * shape.threshold);
    }
  }
}

/**
 * Soft blotches (R8) that repeat without a seam: how thick the mist is here,
 * and where the drops gather. Four octaves of value noise on a wrapping
 * lattice, stretched to fill 0–255.
 */
export function mistTile(size = 128, seed = 23): Uint8Array {
  const random = createRandom(seed);
  const field = new Float32Array(size * size);
  let weight = 1;
  for (const cells of [4, 8, 16, 32]) {
    const lattice = Float32Array.from({ length: cells * cells }, () => random());
    const at = (x: number, y: number) => lattice[(y % cells) * cells + (x % cells)] ?? 0;
    for (let py = 0; py < size; py++) {
      const fy = (py / size) * cells;
      const y0 = Math.floor(fy);
      const ty = fy - y0;
      const sy = ty * ty * (3 - 2 * ty);
      for (let px = 0; px < size; px++) {
        const fx = (px / size) * cells;
        const x0 = Math.floor(fx);
        const tx = fx - x0;
        const sx = tx * tx * (3 - 2 * tx);
        const bottom = at(x0, y0) * (1 - sx) + at(x0 + 1, y0) * sx;
        const top = at(x0, y0 + 1) * (1 - sx) + at(x0 + 1, y0 + 1) * sx;
        const i = py * size + px;
        field[i] = (field[i] ?? 0) + (bottom * (1 - sy) + top * sy) * weight;
      }
    }
    weight *= 0.55;
  }
  let low = Infinity;
  let high = -Infinity;
  for (const value of field) {
    low = Math.min(low, value);
    high = Math.max(high, value);
  }
  return Uint8Array.from(field, (value) => Math.round((255 * (value - low)) / (high - low)));
}
