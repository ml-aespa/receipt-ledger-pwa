import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';

test('Service Workerの全キャッシュ対象が存在する', async () => {
  const worker = await readFile(new URL('../sw.js', import.meta.url), 'utf8');
  const assets = [...worker.matchAll(/'\.\/(.*?)'/g)].map(match => match[1]).filter(value => value && value !== '');
  for (const asset of new Set(assets)) await access(new URL(`../${asset}`, import.meta.url));
});

test('Service Workerはオンライン更新とオフラインフォールバックを備える', async () => {
  const worker = await readFile(new URL('../sw.js', import.meta.url), 'utf8');
  assert.match(worker, /fetch\(event\.request\)/);
  assert.match(worker, /caches\.match\(event\.request\)/);
  assert.match(worker, /mode === 'navigate'/);
});

test('外部スクリプト・外部スタイル・通信APIを含まない', async () => {
  const files = ['index.html','src/app.js','src/core.js','src/db.js'];
  const source = (await Promise.all(files.map(file => readFile(new URL(`../${file}`, import.meta.url),'utf8')))).join('\n');
  assert.doesNotMatch(source,/https?:\/\//);
  assert.doesNotMatch(source,/XMLHttpRequest|WebSocket|sendBeacon/);
  assert.match(source,/connect-src 'none'/);
});
