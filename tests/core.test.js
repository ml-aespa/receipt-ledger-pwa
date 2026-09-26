import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addCalendarDays, addMonths, checkedSum, dailyTotals, dateRange, executeQuestion, filterExpenses,
  monthlySummary, parseAmount, parseQuestion, sixMonthTotals, validateExpense
} from '../src/core.js';

const record = (date, amount, categoryId = 'dining', merchant = '店', memo = '') => ({
  id: `${date}-${amount}-${merchant}`, date, amount, categoryId, merchant, memo,
  paymentId: null, createdAt: `${date}T12:00:00.000Z`, updatedAt: `${date}T12:00:00.000Z`, schemaVersion: 1
});

test('金額の全角・桁区切りと不正値', () => {
  assert.equal(parseAmount('１０,０００'), 10_000);
  for (const value of ['', '0', '-1', '1.5', '1,00', '1000000000', '12a']) assert.throws(() => parseAmount(value));
  assert.equal(validateExpense({ date:'2026-03-16', amount:'100', categoryId:'dining' }, '2026-03-15').valid, false);
});

test('暦日・月移動・半開区間', () => {
  assert.equal(addCalendarDays('2024-02-28', 1), '2024-02-29');
  assert.equal(addCalendarDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addMonths('2026-01', 1), '2026-02');
  const month = dateRange('thisMonth', new Date(2026, 2, 15, 12));
  assert.deepEqual(month, { start:'2026-03-01', end:'2026-04-01' });
  assert.equal('2026-04-01' < month.end, false);
});

test('日曜・月曜開始の月またぎ週', () => {
  const now = new Date(2026, 2, 1, 12);
  assert.deepEqual(dateRange('thisWeek', now, 0), { start:'2026-03-01', end:'2026-03-08' });
  assert.deepEqual(dateRange('thisWeek', now, 1), { start:'2026-02-23', end:'2026-03-02' });
});

test('月次集計・平均四捨五入・前月比・同率', () => {
  const records = [record('2026-03-01',100), record('2026-03-02',101,'groceries'), record('2026-02-01',100)];
  const summary = monthlySummary(records, '2026-03');
  assert.equal(summary.total, 201n); assert.equal(summary.average, 101n); assert.equal(summary.difference, 101n); assert.equal(summary.percentTenths, 1010n);
  const tie = monthlySummary([record('2026-03-01',100), record('2026-03-02',100,'groceries')], '2026-03');
  assert.deepEqual(tie.top, ['外食','食料品']); assert.equal(tie.percentTenths, null);
  const decrease = monthlySummary([record('2026-02-01',50)], '2026-03');
  assert.equal(decrease.percentTenths, -1000n);
});

test('絞り込みAND、店名・メモOR、0補完', () => {
  const records = [record('2026-03-01',100,'dining','青空店'), record('2026-03-02',200,'groceries','別店','青空で購入'), record('2026-02-01',300,'dining','青空店')];
  const filtered = filterExpenses(records, { month:'2026-03', categoryId:'dining', search:'青空' });
  assert.equal(filtered.length,1); assert.equal(checkedSum(filtered),100n);
  assert.equal(dailyTotals(records,'2026-03').length,31);
  assert.equal(dailyTotals(records,'2026-03').find(item => item.key === '2026-03-02').amount, 200n);
  assert.equal(sixMonthTotals([], '2026-03').length,6);
});

test('全カテゴリを自然な質問文で検索できる', () => {
  const cases = [
    ['趣味・娯楽の合計', ['entertainment']], ['今月の日用品はいくら？', ['daily_goods']],
    ['先月の交通費の合計', ['transport']], ['今年の衣服の合計は？', ['clothing']],
    ['医療費を見せて', ['medical']], ['今月の光熱・通信の総額', ['utilities']],
    ['その他は何件ある？', ['other']]
  ];
  for (const [question, ids] of cases) {
    const parsed = parseQuestion(question);
    assert.equal(parsed.status, 'success', question);
    assert.deepEqual(parsed.query.categoryIds, ids, question);
  }
});

test('必須質問例をすべて解析', () => {
  const examples = ['今週、外食にいくら使った？','今月の支出合計は？','先月の食費はいくら？','昨日のコンビニ代を見せて','今月一番使ったカテゴリは？','1万円以上の支出を見せて','未分類の支出は何件ある？','今年の外食費を月別に表示して'];
  for (const value of examples) assert.equal(parseQuestion(value).status, 'success', value);
});

test('食費・コンビニ辞書・1万円境界・月別0補完', () => {
  const food = parseQuestion('先月の食費はいくら？').query;
  assert.deepEqual(food.categoryIds, ['dining','groceries']);
  const minimum = parseQuestion('１万円以上の支出を見せて？').query;
  const minResult = executeQuestion(minimum, [record('2026-01-01',9999),record('2026-01-02',10000)], new Date(2026,2,15,12));
  assert.equal(minResult.records.length,1); assert.equal(minResult.total,10000n);
  const convenience = parseQuestion('昨日のコンビニ代を見せて').query;
  const convResult = executeQuestion(convenience,[record('2026-03-14',100,'groceries','ファミマ渋谷店'),record('2026-03-14',200,'groceries','未知ストア')],new Date(2026,2,15,12));
  assert.equal(convResult.records.length,1); assert.equal(convResult.total,checkedSum(convResult.records));
  const monthly = executeQuestion(parseQuestion('今年の外食費を月別に表示して').query,[record('2026-02-01',300)],new Date(2026,2,15,12));
  assert.deepEqual(monthly.months.map(item => item.amount),[0n,300n,0n]);
});

test('未知・否定・未対応条件は安全に拒否', () => {
  for (const value of ['外食以外を見せて','1万円以下を見せて','現金だけ見せて','今月と先月の合計','スタバの支出を見せて']) assert.notEqual(parseQuestion(value).status,'success',value);
  const quoted = parseQuestion('今月の「○○スーパー」の支出を見せて');
  assert.equal(quoted.status,'success'); assert.deepEqual(quoted.query.merchant,{ type:'contains', value:'○○スーパー' });
});
