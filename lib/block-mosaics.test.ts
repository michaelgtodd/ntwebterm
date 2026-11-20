import { describe, expect, test } from 'bun:test';
import { drawBlockMosaic, isBlockMosaic, mosaicPattern } from './block-mosaics';
import { drawBoxDrawing } from './box-drawing';

/** Minimal 2D context that records rect() calls. */
function recordingCtx(scale = 1) {
  const rects: Array<[number, number, number, number]> = [];
  let fills = 0;
  const ctx = {
    beginPath() {},
    rect(x: number, y: number, w: number, h: number) {
      rects.push([x, y, w, h]);
    },
    fill() {
      fills++;
    },
    getTransform: () => ({ a: scale, b: 0 }),
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, rects, fills: () => fills };
}

/** Mask from the digits of a Unicode name such as "BLOCK OCTANT-1235". */
const cells = (digits: string) => [...digits].reduce((m, d) => m | (1 << (Number(d) - 1)), 0);

describe('mosaicPattern', () => {
  test('sextants follow the Unicode names, skipping the half-block patterns', () => {
    expect(mosaicPattern(0x1fb00)).toEqual({ rows: 3, mask: cells('1') }); // BLOCK SEXTANT-1
    expect(mosaicPattern(0x1fb13)).toEqual({ rows: 3, mask: cells('35') }); // BLOCK SEXTANT-35
    // 135 (left half, U+258C) is skipped: U+1FB14 is BLOCK SEXTANT-235.
    expect(mosaicPattern(0x1fb14)).toEqual({ rows: 3, mask: cells('235') });
    // 246 (right half, U+2590) is skipped: U+1FB28 is BLOCK SEXTANT-1246.
    expect(mosaicPattern(0x1fb27)).toEqual({ rows: 3, mask: cells('146') });
    expect(mosaicPattern(0x1fb28)).toEqual({ rows: 3, mask: cells('1246') });
    expect(mosaicPattern(0x1fb3b)).toEqual({ rows: 3, mask: cells('23456') }); // last
  });

  test('every sextant is a distinct pattern other than empty, full and the halves', () => {
    const seen = new Set<number>();
    for (let cp = 0x1fb00; cp <= 0x1fb3b; cp++) seen.add(mosaicPattern(cp)!.mask);
    expect(seen.size).toBe(60);
    for (const excluded of [0, cells('135'), cells('246'), cells('123456')]) {
      expect(seen.has(excluded)).toBe(false);
    }
  });

  test('octants follow the Unicode names', () => {
    expect(mosaicPattern(0x1cd00)).toEqual({ rows: 4, mask: cells('3') }); // BLOCK OCTANT-3
    expect(mosaicPattern(0x1cd01)).toEqual({ rows: 4, mask: cells('23') }); // BLOCK OCTANT-23
    expect(mosaicPattern(0x1cde5)).toEqual({ rows: 4, mask: cells('2345678') }); // last
  });

  test('octants are 230 distinct patterns and never duplicate a quadrant pattern', () => {
    const seen = new Set<number>();
    for (let cp = 0x1cd00; cp <= 0x1cde5; cp++) seen.add(mosaicPattern(cp)!.mask);
    expect(seen.size).toBe(230);
    // Patterns where rows pair up (1=3, 2=4, 5=7, 6=8) are quadrant characters
    // (U+2580 block), including empty and full; Unicode does not repeat them.
    for (let q = 0; q < 16; q++) {
      const tl = q & 1,
        tr = (q >> 1) & 1,
        bl = (q >> 2) & 1,
        br = (q >> 3) & 1;
      const mask =
        tl | (tr << 1) | (tl << 2) | (tr << 3) | (bl << 4) | (br << 5) | (bl << 6) | (br << 7);
      expect(seen.has(mask)).toBe(false);
    }
  });

  test('other codepoints are not mosaics', () => {
    for (const cp of [0x2588, 0x1faff, 0x1fb3c, 0x1ccff, 0x1cde6, 0x41]) {
      expect(mosaicPattern(cp)).toBeNull();
      expect(isBlockMosaic(cp)).toBe(false);
    }
  });
});

describe('drawBlockMosaic', () => {
  test('fills one rect per lit cell on the 2×3 sextant grid', () => {
    const { ctx, rects, fills } = recordingCtx();
    // BLOCK SEXTANT-23456 in a 10×30 cell at (100, 200).
    expect(drawBlockMosaic(ctx, 0x1fb3b, 100, 200, 10, 30)).toBe(true);
    expect(rects).toEqual([
      [105, 200, 5, 10], // 2: top right
      [100, 210, 5, 10], // 3: middle left
      [105, 210, 5, 10], // 4: middle right
      [100, 220, 5, 10], // 5: bottom left
      [105, 220, 5, 10], // 6: bottom right
    ]);
    expect(fills()).toBe(1);
  });

  test('snaps sub-cell edges to device pixels so neighbours share edges', () => {
    const { ctx, rects } = recordingCtx(2);
    // BLOCK OCTANT-1 in a 7×17 CSS-px cell at dpr 2: edges land on half pixels.
    drawBlockMosaic(ctx, 0x1cd00 + 0, 0, 0, 7, 17); // OCTANT-3: second row, left
    const [[x, y, w, h]] = rects;
    for (const edge of [x, y, x + w, y + h]) expect((edge * 2) % 1).toBe(0);
    expect(x).toBe(0);
    expect(x + w).toBe(3.5);
    expect(y).toBe(4.5); // round(17/4 * 2) / 2
    expect(y + h).toBe(8.5);
  });

  test('draws nothing for non-mosaic codepoints', () => {
    const { ctx, rects } = recordingCtx();
    expect(drawBlockMosaic(ctx, 0x41, 0, 0, 10, 20)).toBe(false);
    expect(rects).toEqual([]);
  });
});

describe('drawBoxDrawing integration', () => {
  test('routes astral sextants and octants to the mosaic renderer', () => {
    const { ctx, rects } = recordingCtx();
    expect(drawBoxDrawing(ctx, '\u{1FB00}', 0, 0, 10, 30, 14)).toBe(true);
    expect(rects).toEqual([[0, 0, 5, 10]]);
    expect(drawBoxDrawing(ctx, '\u{1CDE5}', 0, 0, 10, 40, 14)).toBe(true);
    expect(rects.length).toBe(1 + 7);
  });

  test('leaves a mosaic with a combining mark to the font path', () => {
    const { ctx, rects } = recordingCtx();
    expect(drawBoxDrawing(ctx, '\u{1FB00}́', 0, 0, 10, 30, 14)).toBe(false);
    expect(rects).toEqual([]);
  });
});
