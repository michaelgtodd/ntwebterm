import { afterEach, describe, expect, test } from 'bun:test';
import { createIsolatedTerminal } from './test-helpers';

const open: Array<{ dispose(): void }> = [];
afterEach(() => {
  for (const t of open.splice(0)) t.dispose();
});

async function terminal(options: Parameters<typeof createIsolatedTerminal>[0] = {}) {
  const term = await createIsolatedTerminal({ cols: 40, rows: 10, ...options });
  const container = document.createElement('div');
  document.body.appendChild(container);
  await term.open(container);
  open.push(term);
  const data: string[] = [];
  term.onData((d) => data.push(d));
  const write = (s: string) => new Promise<void>((r) => term.write(s, r));
  return { term, data, write };
}

describe('terminalResponses', () => {
  test("'send' (default) answers queries through onData", async () => {
    const { data, write } = await terminal();
    await write('\x1b[c\x1b[6n'); // DA1, cursor position
    expect(data.join('')).toContain('\x1b[?');
    expect(data.join('')).toContain('R');
  });

  test("'drop' discards answers to queries", async () => {
    const { data, write } = await terminal({ terminalResponses: 'drop' });
    await write('hello\x1b[c\x1b[6n\x1b[?2026$p\x1b[>q');
    expect(data).toEqual([]);
  });

  test("'drop' still sends pastes", async () => {
    const { term, data, write } = await terminal({ terminalResponses: 'drop' });
    await write('\x1b[?2004h'); // bracketed paste on
    term.paste('pasted text');
    expect(data.join('')).toBe('\x1b[200~pasted text\x1b[201~');
  });
});
