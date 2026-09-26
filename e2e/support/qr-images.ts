import { toBuffer } from 'qrcode';
import type { Page } from '@playwright/test';

import { TICKET_TOKEN } from './door';

/** A 1x1 white PNG: a valid image that contains no QR code. */
export const BLANK_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** A crisp ticket QR with a white border. */
export function qrPng(token: string = TICKET_TOKEN, width = 320): Promise<Buffer> {
  return toBuffer(token, { width, margin: 4 });
}

/** How to degrade a QR image. Every step is optional. */
export interface Recipe {
  /** Redraw at this width with smoothing, so edges blur into grey like a shrunken screenshot. */
  readonly width?: number;
  /** Grey levels the black and white pixels are remapped to; closer together is fainter. */
  readonly ink?: number;
  readonly paper?: number;
  /** Keep only this part of the image (fractions of width and height). */
  readonly keep?: {
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
  };
}

/**
 * Applies `recipe` to a PNG with a canvas, in the browser, so no image library is needed.
 * The page only has to be able to run scripts; any loaded page will do.
 */
export async function degrade(page: Page, png: Buffer, recipe: Recipe): Promise<Buffer> {
  const base64 = await page.evaluate(
    async ({ source, steps }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${source}`;
      await image.decode();

      const crop = steps.keep ?? { x: 0, y: 0, w: 1, h: 1 };
      const sx = Math.round(image.width * crop.x);
      const sy = Math.round(image.height * crop.y);
      const sw = Math.round(image.width * crop.w);
      const sh = Math.round(image.height * crop.h);
      const scale = steps.width ? steps.width / image.width : 1;

      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(sw * scale));
      canvas.height = Math.max(1, Math.round(sh * scale));
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('no 2d canvas');
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      context.drawImage(image, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);

      if (steps.ink !== undefined && steps.paper !== undefined) {
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
        for (let i = 0; i < pixels.data.length; i += 4) {
          const level = steps.ink + (pixels.data[i] / 255) * (steps.paper - steps.ink);
          pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = level;
        }
        context.putImageData(pixels, 0, 0);
      }
      return canvas.toDataURL('image/png').split(',')[1];
    },
    { source: png.toString('base64'), steps: recipe },
  );
  return Buffer.from(base64, 'base64');
}
