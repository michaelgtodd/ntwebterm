import { afterEach, describe, expect, test } from 'bun:test';
import { Ghostty, type GhosttyTerminal } from './ghostty';
import { createIsolatedTerminal } from './test-helpers';

const owned: Array<{ free?: () => void; dispose?: () => void }> = [];
afterEach(() => {
  for (const t of owned.splice(0)) (t.dispose ?? t.free)?.call(t);
});

async function wasmTerminal(
  cols: number,
  rows: number
): Promise<{ ghostty: Ghostty; term: GhosttyTerminal }> {
  const ghostty = await Ghostty.load();
  const term = ghostty.createTerminal(cols, rows);
  term.setCellPixelSize(8, 16);
  owned.push(term);
  return { ghostty, term };
}

const lines = (t: GhosttyTerminal) =>
  Array.from({ length: t.rows }, (_, y) =>
    (t.getLine(y) ?? [])
      .map((c) => (c.codepoint ? String.fromCodePoint(c.codepoint) : ' '))
      .join('')
      .trimEnd()
  );

// A 1x1 red RGBA Kitty image, placed over 2x2 cells.
const kittyRed = '\x1b_Ga=T,f=32,s=1,v=1,i=9,c=2,r=2;/wAA/w==\x1b\\';

describe('GhosttyTerminal snapshots', () => {
  test('round trip keeps text, modes and Kitty images', async () => {
    const { ghostty, term } = await wasmTerminal(30, 8);
    term.write('hello snapshot\r\n');
    term.write(kittyRed);
    term.write('\x1b[?2004h\x1b]0;my title\x07');

    const snap = term.encodeSnapshot();
    expect(snap.length).toBeGreaterThan(0);

    const restored = ghostty.restoreTerminal(snap);
    owned.push(restored);
    restored.setCellPixelSize(8, 16);
    expect([restored.cols, restored.rows]).toEqual([30, 8]);
    expect(lines(restored)).toEqual(lines(term));
    expect(restored.getMode(2004, false)).toBe(true);
    expect(restored.getTitle()).toBe('my title');
    const frame = restored.getImageFrame();
    expect(frame.placements.map((p) => p.imageId)).toEqual([9]);
    expect(frame.pixels(9)).not.toBeNull();
  });

  test('a restored terminal reflows when resized', async () => {
    const { ghostty, term } = await wasmTerminal(40, 6);
    term.write('a line long enough to wrap at twenty columns\r\n');
    const restored = ghostty.restoreTerminal(term.encodeSnapshot());
    owned.push(restored);
    restored.resize(20, 6);
    expect(lines(restored).slice(0, 3)).toEqual([
      'a line long enough t',
      'o wrap at twenty col',
      'umns',
    ]);
  });

  test('rejects bytes that are not a snapshot', async () => {
    const { ghostty } = await wasmTerminal(10, 3);
    expect(() => ghostty.restoreTerminal(new TextEncoder().encode('not a snapshot'))).toThrow();
  });
});

describe('Terminal.restoreSnapshot', () => {
  async function openTerminal(cols: number, rows: number) {
    const term = await createIsolatedTerminal({ cols, rows });
    const container = document.createElement('div');
    document.body.appendChild(container);
    await term.open(container);
    owned.push(term);
    return term;
  }
  const screenText = (term: Awaited<ReturnType<typeof openTerminal>>) =>
    Array.from(
      { length: term.rows },
      (_, y) => term.buffer.active.getLine(y)?.translateToString(true) ?? ''
    );

  test('takes the snapshot state at its own size, and later writes continue', async () => {
    // A "server-side" terminal that has been following a shell at 40 columns.
    const { term: source } = await wasmTerminal(40, 6);
    source.write('$ echo restored-from-server\r\nrestored-from-server\r\n$ ');
    source.write('\x1b]2;server title\x07');

    const term = await openTerminal(30, 6);
    term.write('stale local content');
    const titles: string[] = [];
    term.onTitleChange((t) => titles.push(t));

    term.restoreSnapshot(source.encodeSnapshot());

    expect([term.cols, term.rows]).toEqual([30, 6]); // keeps its own size
    const text = screenText(term);
    expect(text.join('\n')).not.toContain('stale local content');
    expect(text.slice(0, 3)).toEqual(['$ echo restored-from-server', 'restored-from-server', '$']);
    expect(titles).toEqual(['server title']);

    // Live output after the snapshot lands on the restored screen.
    await new Promise<void>((r) => term.write('echo next\r\n', r));
    expect(screenText(term)[2]).toBe('$ echo next');
  });

  test('throws and leaves the terminal unchanged on a bad snapshot', async () => {
    const term = await openTerminal(20, 4);
    await new Promise<void>((r) => term.write('keep me', r));
    expect(() => term.restoreSnapshot(new Uint8Array([1, 2, 3]))).toThrow();
    expect(screenText(term)[0]).toBe('keep me');
    await new Promise<void>((r) => term.write(' still works', r));
    expect(screenText(term)[0]).toBe('keep me still works');
  });
});
