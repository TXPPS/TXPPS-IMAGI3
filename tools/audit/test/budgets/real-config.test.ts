import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseBudgetDocument } from '../../src/budgets/load.ts';
import { BUDGETS_FILENAME, findRepoRoot } from '../../src/repo-root.ts';

const repoRoot = findRepoRoot();
const document = parseBudgetDocument(
  JSON.parse(readFileSync(join(repoRoot, BUDGETS_FILENAME), 'utf8')),
);

describe('the committed budgets.json', () => {
  it('parses and declares every budget the brief mandates', () => {
    const ids = new Set(document.rules.map((r) => r.id));
    for (const required of [
      'editor.coldLoad.desktop',
      'editor.coldLoad.tablet',
      'runtime.bundle.gzip',
      'playmode.fps.tablet.reference2d',
      'playmode.fps.phone.reference3d',
      'editor.frameSpike.max',
      'playmode.heap.peak.phone',
      'gpu.texture.phone',
    ]) {
      expect(ids).toContain(required);
    }
  });

  it('keeps the brief-mandated numbers exactly', () => {
    const byId = new Map(document.rules.map((r) => [r.id, r]));
    expect(byId.get('editor.coldLoad.desktop')?.max).toBe(3000);
    expect(byId.get('editor.coldLoad.tablet')?.max).toBe(6000);
    expect(byId.get('runtime.bundle.gzip')?.max).toBe(1.5 * 1024 * 1024);
    expect(byId.get('playmode.fps.tablet.reference2d')?.min).toBe(60);
    expect(byId.get('playmode.fps.phone.reference3d')?.min).toBe(30);
    expect(byId.get('editor.frameSpike.max')?.max).toBe(32);
    expect(byId.get('playmode.heap.peak.phone')?.max).toBe(500 * 1024 * 1024);
    expect(byId.get('gpu.texture.phone')?.max).toBe(256 * 1024 * 1024);
  });

  it('documents provenance for every rule', () => {
    for (const rule of document.rules) {
      expect(rule.source.length).toBeGreaterThan(0);
      expect(rule.description.length).toBeGreaterThan(0);
    }
  });
});
