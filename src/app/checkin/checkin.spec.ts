import { create } from 'qrcode';

import {
  decodeQrPixels,
  outcomeDescription,
  outcomeIcon,
  qrCanvasPlan,
  uploadErrorMessage,
} from './checkin';

describe('event helper outcomes', () => {
  it('maps every server outcome to explicit helper-facing text', () => {
    expect(outcomeDescription('VALID')).toContain('Valid ticket');
    expect(outcomeDescription('ALREADY_USED')).toContain('Already used');
    expect(outcomeDescription('INVALID')).toContain('Invalid ticket');
    expect(outcomeDescription('WRONG_EVENT')).toContain('Wrong event');
  });

  it('keeps the outcome descriptions distinct for assistive feedback', () => {
    expect(outcomeDescription('VALID')).not.toBe(outcomeDescription('ALREADY_USED'));
    expect(outcomeDescription('INVALID')).not.toBe(outcomeDescription('WRONG_EVENT'));
  });

  it('provides non-color indicators for every outcome', () => {
    const outcomes = ['VALID', 'ALREADY_USED', 'INVALID', 'WRONG_EVENT'] as const;
    expect(new Set(outcomes.map((outcome) => outcomeIcon(outcome))).size).toBe(4);
  });
});

describe('uploaded QR image preparation', () => {
  it('decodes a dense ticket QR at two pixels per module with only a one-module border', () => {
    const token = '8d70e932-51f7-4e17-8bb1-1578ea497672:ticket:0000000000000001';
    const qr = create(token, { errorCorrectionLevel: 'M' });
    const margin = 1;
    const scale = 2;
    const side = (qr.modules.size + margin * 2) * scale;
    const pixels = new Uint8ClampedArray(side * side * 4);

    for (let y = 0; y < side; y += 1) {
      for (let x = 0; x < side; x += 1) {
        const moduleRow = Math.floor(y / scale) - margin;
        const moduleColumn = Math.floor(x / scale) - margin;
        const isDark =
          moduleRow >= 0 &&
          moduleColumn >= 0 &&
          moduleRow < qr.modules.size &&
          moduleColumn < qr.modules.size &&
          qr.modules.get(moduleRow, moduleColumn) === 1;
        const offset = (y * side + x) * 4;
        const value = isDark ? 0 : 255;
        pixels[offset] = value;
        pixels[offset + 1] = value;
        pixels[offset + 2] = value;
        pixels[offset + 3] = 255;
      }
    }

    expect(decodeQrPixels(pixels, side, side)).toBe(token);
  });

  it('upscales small QR crops without smoothing and adds a white quiet zone', () => {
    expect(qrCanvasPlan(80, 80)).toEqual({
      scale: 8,
      padding: 51,
      width: 742,
      height: 742,
    });
  });

  it('does not enlarge already high-resolution screenshots', () => {
    expect(qrCanvasPlan(1600, 900)).toEqual({
      scale: 1,
      padding: 72,
      width: 1744,
      height: 1044,
    });
  });
});

describe('uploaded QR failures', () => {
  it('tells the helper the file was not a usable image when decoding never started', () => {
    expect(uploadErrorMessage(new Error('qr_image_empty'))).toContain('could not be opened');
    expect(uploadErrorMessage(new Error('qr_image_load_failed'))).toContain('could not be opened');
  });

  it('keeps the crop advice for an image that decoded but held no QR code', () => {
    expect(uploadErrorMessage(new Error('qr_not_found'))).toContain('No readable QR code');
    expect(uploadErrorMessage(undefined)).toContain('No readable QR code');
  });
});
