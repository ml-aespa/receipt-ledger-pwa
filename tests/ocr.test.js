import test from 'node:test';
import assert from 'node:assert/strict';
import { extractAmounts, extractDates, extractMerchants, extractReceiptFields, suggestCategory } from '../src/ocr.js';

test('レシート全文から合計・日付・店名候補を抽出', () => {
  const text = `ローソン 渋谷店
2026/09/25 12:30
おにぎり 180円
飲料 120円
お買上合計 ￥1,280
内消費税 116円
お預り 2,000円`;
  const fields = extractReceiptFields(text, '2026-09-26');
  assert.equal(fields.amountCandidates[0].value, 1280);
  assert.equal(fields.amountCandidates.some(item => item.value === 25 || item.value === 30), false);
  assert.equal(fields.dateCandidates[0], '2026-09-25');
  assert.match(fields.merchantCandidates[0].value, /ローソン/);
  assert.equal(fields.category.id, 'groceries');
});

test('金額候補は税・預りより合計を優先', () => {
  const amounts = extractAmounts(['小計 1,000円', '消費税 100円', '合計 ￥1,100', 'お預り 2,000円', 'お釣り 900円']);
  assert.equal(amounts[0].value, 1100);
});

test('未来日を候補にせず年月日を検証', () => {
  assert.deepEqual(extractDates(['2026年9月25日', '2026年9月27日', '2026/02/31'], '2026-09-26'), ['2026-09-25']);
});

test('カテゴリ根拠がなければ未分類を返す', () => {
  const category = suggestCategory('株式会社 ABC 1234 合計 500円');
  assert.equal(category.id, 'uncategorized');
  assert.equal(category.confident, false);
});

test('店名の日本語が誤読されても英字名と商品名から分類する', () => {
  const category = suggestCategory('ローソフン テスト店\nLAWSON\nおにぎり 480円\n飲料 800円');
  assert.equal(category.id, 'groceries');
  assert.equal(category.confident, true);
});

test('店名候補は見出し語や合計行を除外', () => {
  const merchants = extractMerchants(['領収書', '青空スーパー 本店', 'TEL 00-0000-0000', '合計 500円']);
  assert.equal(merchants[0].value, '青空スーパー 本店');
});
