import jsQR from 'jsqr';

/**
 * Reads a QR code that is too small for a normal decoder: a screenshot where each
 * module is only 2-3 pixels and anti-aliasing has smeared edges into grey.
 *
 * Instead of asking a decoder to find the code, this assumes the image is mostly
 * the QR on a light background, measures the symbol's edges to sub-pixel
 * precision, and for each plausible grid size samples the average darkness of
 * every module. The fixed finder and timing patterns are redrawn exactly, then
 * the rebuilt, crisp symbol is handed to jsQR, whose error correction absorbs the
 * few modules the blur made ambiguous.
 */
export function recoverSmallQr(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  budgetMs = 1500,
): string | null {
  const darkness = darknessMap(pixels, width, height);
  if (!darkness) return null;
  const bounds = symbolBounds(darkness, width, height);
  if (!bounds) return null;

  const deadline = Date.now() + budgetMs;
  const symbolWidth = bounds.right - bounds.left;
  const symbolHeight = bounds.bottom - bounds.top;
  // Versions 1-10. Below ~1.4 px per module there is not enough signal left to sample.
  const sizes = [21, 25, 29, 33, 37, 41, 45, 49, 53, 57].filter(
    (size) => symbolWidth / size >= 1.4 && symbolHeight / size >= 1.4,
  );

  for (const [dl, dt, dr, db] of edgeJitters()) {
    for (const size of sizes) {
      if (Date.now() > deadline) return null;
      const grid = {
        left: bounds.left + dl,
        top: bounds.top + dt,
        right: bounds.right + dr,
        bottom: bounds.bottom + db,
      };
      for (const coverage of [0.6, 1]) {
        const modules = sampleModules(darkness, width, height, grid, size, coverage);
        stampFunctionPatterns(modules, size);
        const text = decodeModules(modules, size);
        if (text) return text;
      }
    }
  }
  return null;
}

/** 0 = background, 1 = ink, normalised against the image's own contrast range. */
function darknessMap(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): Float32Array | null {
  const luminance = new Float32Array(width * height);
  for (let i = 0; i < luminance.length; i++) {
    const offset = i * 4;
    const alpha = pixels[offset + 3] / 255;
    const lum = pixels[offset] * 0.299 + pixels[offset + 1] * 0.587 + pixels[offset + 2] * 0.114;
    // Transparent PNG areas are treated as white paper.
    luminance[i] = lum * alpha + 255 * (1 - alpha);
  }
  const sorted = Float32Array.from(luminance).sort();
  const ink = sorted[Math.floor(sorted.length * 0.02)];
  const paper = sorted[Math.floor(sorted.length * 0.98)];
  if (paper - ink < 40) return null;
  const darkness = new Float32Array(luminance.length);
  for (let i = 0; i < luminance.length; i++) {
    darkness[i] = Math.min(1, Math.max(0, (paper - luminance[i]) / (paper - ink)));
  }
  return darkness;
}

interface Bounds {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/**
 * The dark-module bounding box of a QR is exactly the outer edge of its three
 * finder patterns. Partially covered edge pixels are read as fractional coverage,
 * which places each edge to within a fraction of a pixel.
 */
function symbolBounds(darkness: Float32Array, width: number, height: number): Bounds | null {
  const columns = new Float32Array(width);
  const rows = new Float32Array(height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const value = darkness[y * width + x];
      if (value > columns[x]) columns[x] = value;
      if (value > rows[y]) rows[y] = value;
    }
  }
  const horizontal = profileEdges(columns);
  const vertical = profileEdges(rows);
  if (!horizontal || !vertical) return null;
  return { left: horizontal[0], right: horizontal[1], top: vertical[0], bottom: vertical[1] };
}

function profileEdges(profile: Float32Array): [number, number] | null {
  const first = profile.findIndex((value) => value >= 0.5);
  if (first < 0) return null;
  let last = profile.length - 1;
  while (profile[last] < 0.5) last--;
  let start = first + 1;
  for (let i = Math.max(0, first - 2); i <= first; i++) start -= profile[i];
  let end = last;
  for (let i = last; i <= Math.min(profile.length - 1, last + 2); i++) end += profile[i];
  return end - start >= 21 * 1.4 ? [start, end] : null;
}

/** Edge offsets to try, nearest the measured edges first. */
function* edgeJitters(): Generator<readonly [number, number, number, number]> {
  yield [0, 0, 0, 0];
  const steps = [0.25, -0.25, 0.5, -0.5];
  for (const step of steps) {
    yield [step, step, step, step];
    yield [step, step, 0, 0];
    yield [0, 0, step, step];
  }
  for (const a of steps) {
    for (const b of steps) {
      yield [a, b, a, b];
      yield [a, a, b, b];
      yield [a, b, b, a];
    }
  }
}

/** Average darkness over the central `coverage` fraction of each module, thresholded. */
function sampleModules(
  darkness: Float32Array,
  width: number,
  height: number,
  grid: Bounds,
  size: number,
  coverage: number,
): Uint8Array {
  const moduleWidth = (grid.right - grid.left) / size;
  const moduleHeight = (grid.bottom - grid.top) / size;
  const insetX = (moduleWidth * (1 - coverage)) / 2;
  const insetY = (moduleHeight * (1 - coverage)) / 2;
  const modules = new Uint8Array(size * size);
  for (let row = 0; row < size; row++) {
    const y0 = grid.top + row * moduleHeight + insetY;
    const y1 = y0 + moduleHeight - insetY * 2;
    for (let column = 0; column < size; column++) {
      const x0 = grid.left + column * moduleWidth + insetX;
      const x1 = x0 + moduleWidth - insetX * 2;
      modules[row * size + column] =
        areaAverage(darkness, width, height, x0, y0, x1, y1) >= 0.5 ? 1 : 0;
    }
  }
  return modules;
}

function areaAverage(
  darkness: Float32Array,
  width: number,
  height: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): number {
  let total = 0;
  let area = 0;
  for (let y = Math.max(0, Math.floor(y0)); y < Math.min(height, Math.ceil(y1)); y++) {
    const overlapY = Math.min(y + 1, y1) - Math.max(y, y0);
    if (overlapY <= 0) continue;
    for (let x = Math.max(0, Math.floor(x0)); x < Math.min(width, Math.ceil(x1)); x++) {
      const overlapX = Math.min(x + 1, x1) - Math.max(x, x0);
      if (overlapX <= 0) continue;
      const weight = overlapX * overlapY;
      total += darkness[y * width + x] * weight;
      area += weight;
    }
  }
  return area > 0 ? total / area : 0;
}

/**
 * Finder, separator, timing and (for versions 2-6) alignment patterns are fixed
 * by the QR spec, so they are redrawn exactly rather than trusted to the sample.
 * These are what jsQR locks onto; data modules are left to error correction.
 */
function stampFunctionPatterns(modules: Uint8Array, size: number): void {
  const set = (row: number, column: number, dark: boolean) => {
    if (row >= 0 && row < size && column >= 0 && column < size) {
      modules[row * size + column] = dark ? 1 : 0;
    }
  };
  for (const [top, left] of [
    [0, 0],
    [0, size - 7],
    [size - 7, 0],
  ]) {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const ring = Math.max(Math.abs(r - 3), Math.abs(c - 3));
        set(top + r, left + c, ring !== 2 && ring !== 4);
      }
    }
  }
  for (let i = 8; i < size - 8; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  const version = (size - 17) / 4;
  if (version >= 2 && version <= 6) {
    const centre = size - 7;
    for (let r = -2; r <= 2; r++) {
      for (let c = -2; c <= 2; c++) {
        set(centre + r, centre + c, Math.max(Math.abs(r), Math.abs(c)) !== 1);
      }
    }
  }
}

/** Renders the module grid as a crisp image with a quiet zone and decodes it. */
function decodeModules(modules: Uint8Array, size: number): string | null {
  const scale = 6;
  const quiet = 4;
  const side = (size + quiet * 2) * scale;
  const image = new Uint8ClampedArray(side * side * 4).fill(255);
  for (let row = 0; row < size; row++) {
    for (let column = 0; column < size; column++) {
      if (!modules[row * size + column]) continue;
      for (let y = 0; y < scale; y++) {
        const start = (((row + quiet) * scale + y) * side + (column + quiet) * scale) * 4;
        for (let x = 0; x < scale * 4; x += 4) {
          image[start + x] = 0;
          image[start + x + 1] = 0;
          image[start + x + 2] = 0;
        }
      }
    }
  }
  return jsQR(image, side, side, { inversionAttempts: 'dontInvert' })?.data.trim() || null;
}
