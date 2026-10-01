/// <reference types="bun" />
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { CONTROL_NAMES, USAGE, resolveControls, runtimeControls } from './update-data';
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const file = () => JSON.parse(read('scripts/update-data.config.json'));

test('configuration precedence: file < advanced < nonblank input < environment', () => {
  const c = resolveControls({ CONCURRENCY: 2, TICKERS: 'VTI' }, { CONCURRENCY: 3, TICKERS: 'VOO' }, { CONCURRENCY: '4', TICKERS: '' }, { CONCURRENCY: '5' });
  expect(c.CONCURRENCY).toBe('5');
  expect(c.TICKERS).toBe('VOO');
  expect(resolveControls({ TICKERS: 'VTI' }, { TICKERS: '' }, { TICKERS: '' }).TICKERS).toBe('');
  expect(resolveControls({ CONCURRENCY: 2 }, {}, { CONCURRENCY: '' }).CONCURRENCY).toBe('2');
  expect(resolveControls({ CONCURRENCY: 2 }, { CONCURRENCY: 3 }, { CONCURRENCY: '4' }).CONCURRENCY).toBe('4');
  expect(resolveControls({ VERBOSE: true }, {}, {}, { VERBOSE: 'false' }).VERBOSE).toBe('false');
  expect(resolveControls({ MAX_RETRIES: 0 }).MAX_RETRIES).toBe('0');
});

test('scheduled path (empty inputs and advanced) equals config defaults', () => {
  const f = file();
  expect(resolveControls(f, {}, {}, {})).toEqual(Object.fromEntries(Object.entries(f).map(([k, v]) => [k, String(v)])));
});

test('provider-specific defaults', () => {
  expect(file()).toEqual({
    REQUEST_SLEEP: '0', CONCURRENCY: '4', TICKERS: '', HOLDINGS_PAGE_SIZE: '250',
    HISTORY_PAGE_SIZE: '1000', MAX_RETRIES: '2', SEC_UA: '', VERBOSE: 'false',
  });
  expect(file().SEC_UA).not.toMatch(/@/);
});

test('resolver rejects unknown, invalid, non-scalar and newline values', () => {
  for (const value of [{ UNKNOWN: 1 }, { SEC_UA: 'x\nEVIL=yes' }, { CONCURRENCY: 0 }, { MAX_RETRIES: -1 }, { HOLDINGS_PAGE_SIZE: 1.5 }, { REQUEST_SLEEP: '-1' }, { VERBOSE: 'maybe' }, { TICKERS: ['VTI'] }, { TICKERS: { a: 1 } }, null, []]) {
    expect(() => resolveControls(value)).toThrow();
  }
  expect(() => resolveControls({}, { SEC_UA: 'x\rfoo' })).toThrow();
  expect(() => resolveControls({}, {}, {}, { SEC_UA: 'x\0bad' })).toThrow();
  expect(() => resolveControls({}, 'x')).toThrow();
  expect(() => JSON.parse('{bad')).toThrow();
});

test('runtimeControls reads the config file and honors env overrides', async () => {
  expect((await runtimeControls({})).CONCURRENCY).toBe(file().CONCURRENCY);
  expect((await runtimeControls({ CONCURRENCY: '7' })).CONCURRENCY).toBe('7');
});

test('config keys, CONTROL_NAMES, --help and README controls stay in sync', () => {
  expect(Object.keys(file()).sort()).toEqual([...CONTROL_NAMES].sort());
  const doc = read('README.md');
  const readmeRows = [...doc.slice(doc.indexOf('### Update controls'), doc.indexOf('### Examples')).matchAll(/^\| `([A-Z0-9_]+)` \|/gm)].map((m) => m[1]);
  expect(readmeRows.sort()).toEqual([...CONTROL_NAMES].sort());
  for (const name of CONTROL_NAMES) expect(USAGE).toContain(`  ${name} `);
  expect(doc).toContain('scripts/update-data.config.json');
});

test('workflow: one resolver, fixed output dir, inputs map to controls', () => {
  const actual = read('.github/workflows/update-data.yml');
  const names = [...actual.slice(actual.indexOf('    inputs:'), actual.indexOf('\npermissions:')).matchAll(/^      (\w+):$/gm)].map((m) => m[1]);
  expect(names.length).toBeLessThanOrEqual(25);
  expect(names).toContain('advanced');
  expect(actual).toContain("default: '{}'");
  for (const name of names.filter((n) => n !== 'advanced')) expect(CONTROL_NAMES).toContain(name.toUpperCase() as any);
  expect(actual).toContain("cron: '0 0 * * 0'");
  expect(actual).toContain('toJSON(inputs)');
  expect(actual).toContain('resolveControls(file, advanced, individual, protectedVars)');
  expect(actual).toContain('PROTECTED_SEC_UA: ${{ vars.SEC_UA }}');
  expect(actual).not.toMatch(/\$\{\{\s*inputs\./);
  expect(actual).not.toMatch(/OUTPUT_DIR|output_dir/i);
  expect(actual.match(/git add (\S+)/g)).toEqual(['git add api/vanguard']);
  expect(actual.match(/api\/[\w-]+/g)!.every((p) => p === 'api/vanguard')).toBe(true);
});
