/** Block mosaics from the Symbols for Legacy Computing blocks, drawn as
 * geometry instead of font glyphs so they tile seamlessly and render even
 * when no installed font covers them:
 *
 * - Sextants U+1FB00–U+1FB3B (2×3 grid)
 * - Octants  U+1CD00–U+1CDE5 (2×4 grid, Unicode 16)
 *
 * Both blocks omit the patterns Unicode already encodes elsewhere (empty,
 * full, half blocks, quadrants), so the codepoint → pattern mapping skips
 * those. The sextant formula and the octant table follow Ghostty's sprite
 * renderer (src/font/sprite/draw/symbols_for_legacy_computing*.zig and
 * octants.txt; MIT, © Mitchell Hashimoto and Ghostty contributors).
 */

const SEXTANT_MIN = 0x1fb00;
const SEXTANT_MAX = 0x1fb3b;
const OCTANT_MIN = 0x1cd00;
const OCTANT_MAX = 0x1cde5;

/** Bit n-1 set = cell n filled, with cells numbered row-major from the
 * top-left (1 2 / 3 4 / 5 6 / 7 8), as in the Unicode character names
 * ("BLOCK OCTANT-1235"). Generated from Ghostty's octants.txt. */
const OCTANT_MASKS = hexBytes(
  '04060708090b0c0d0e1011121315161718191a1b1c1d1e1f2021222324252627292a2b2c2d2e2f' +
    '303132333435363738393a3b3c3d3e4142434445464748494a4b4c4d4e4f51525354565758595b' +
    '5c5d5e606162636465666768696a6b6c6d6e6f707172737475767778797a7b7c7d7e7f81828384' +
    '85868788898a8b8c8d8e8f909192939495969798999a9b9c9d9e9fa1a2a3a4a6a7a8a9abacadae' +
    'b0b1b2b3b4b5b6b7b8b9babbbcbdbebfc1c2c3c4c5c6c7c8c9cacbcccdcecfd0d1d2d3d4d5d6d7' +
    'd8d9dadbdcdddedfe0e1e2e3e4e5e6e7e8e9eaebecedeeeff1f2f3f4f6f7f8f9fbfdfe'
);

function hexBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** Cell pattern for a mosaic codepoint: `rows` × 2 cells, bit n-1 = cell n
 * (row-major from top-left). Returns null for codepoints outside both blocks. */
export function mosaicPattern(cp: number): { rows: number; mask: number } | null {
  if (cp >= SEXTANT_MIN && cp <= SEXTANT_MAX) {
    const idx = cp - SEXTANT_MIN;
    // +1 skips the empty pattern; idx/20 skips the left-half (21) and
    // right-half (42) patterns, which are U+258C and U+2590.
    return { rows: 3, mask: idx + Math.floor(idx / 20) + 1 };
  }
  if (cp >= OCTANT_MIN && cp <= OCTANT_MAX) {
    return { rows: 4, mask: OCTANT_MASKS[cp - OCTANT_MIN] };
  }
  return null;
}

/** Whether `cp` is a block mosaic this module draws. */
export function isBlockMosaic(cp: number): boolean {
  return (cp >= SEXTANT_MIN && cp <= SEXTANT_MAX) || (cp >= OCTANT_MIN && cp <= OCTANT_MAX);
}

/** Device pixels per unit of the context's current transform, so cell
 * boundaries can be snapped to whole device pixels (no seams between
 * adjacent cells or between sub-cells). */
function deviceScale(ctx: CanvasRenderingContext2D): number {
  const t = typeof ctx.getTransform === 'function' ? ctx.getTransform() : null;
  const s = t ? Math.hypot(t.a, t.b) : 1;
  return Number.isFinite(s) && s > 0 ? s : 1;
}

/** Fill the mosaic for `cp` into (x, y, width, height) with the current
 * fillStyle. Returns false (drawing nothing) if `cp` is not a mosaic. */
export function drawBlockMosaic(
  ctx: CanvasRenderingContext2D,
  cp: number,
  x: number,
  y: number,
  width: number,
  height: number
): boolean {
  const pattern = mosaicPattern(cp);
  if (!pattern) return false;
  const { rows, mask } = pattern;
  const s = deviceScale(ctx);
  // Snap absolute edges (not sizes) so neighbouring cells share boundaries.
  const snap = (v: number) => Math.round(v * s) / s;
  const xs = [snap(x), snap(x + width / 2), snap(x + width)];
  const ys: number[] = [];
  for (let r = 0; r <= rows; r++) ys.push(snap(y + (height * r) / rows));

  // One path, so touching sub-cells don't double-apply faint alpha.
  ctx.beginPath();
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < 2; c++) {
      if (mask & (1 << (r * 2 + c))) {
        ctx.rect(xs[c], ys[r], xs[c + 1] - xs[c], ys[r + 1] - ys[r]);
      }
    }
  }
  ctx.fill();
  return true;
}
