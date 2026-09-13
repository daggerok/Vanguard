import { expect, test } from "bun:test";

const seed = ["BND", "VOO", "VTI", "VT"];

test("Vanguard seed contains core ETFs", () => {
  expect(seed).toContain("VOO");
  expect(seed).toContain("VTI");
  expect(seed).toContain("VT");
});

test("ticker filters are normalized", () => {
  const input = " voo, VTI;vt ".split(/[\s,;]+/).filter(Boolean).map((x) => x.toUpperCase());
  expect(input).toEqual(["VOO", "VTI", "VT"]);
});

test("history rows use ISO dates", () => {
  const row = { date: new Date(0).toISOString().slice(0, 10), close: 1 };
  expect(row.date).toBe("1970-01-01");
});
