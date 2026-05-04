import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import ts from 'typescript';

async function importTsModule(path) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2023,
    },
  });

  return import(`data:text/javascript;base64,${Buffer.from(transpiled.outputText).toString('base64')}`);
}

const layout = await importTsModule('../src/lib/window-layout.ts');

test('desktop work area reserves the visible taskbar height and bottom inset', () => {
  assert.equal(layout.getTaskbarReservedHeight(1024), 80);
  assert.equal(layout.getTaskbarReservedHeight(500), 72);
});

test('window position clamp keeps the full window above the taskbar', () => {
  const rect = layout.clampWindowRect({
    x: 100,
    y: 700,
    width: 500,
    height: 300,
    viewportWidth: 1024,
    viewportHeight: 768,
  });

  assert.equal(rect.y + rect.height, 688);
});
