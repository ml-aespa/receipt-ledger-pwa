export const CATEGORIES = [
  ['dining', '外食'], ['groceries', '食料品'], ['daily_goods', '日用品'], ['transport', '交通'],
  ['entertainment', '趣味・娯楽'], ['clothing', '衣服'], ['medical', '医療'], ['utilities', '光熱・通信'],
  ['other', 'その他'], ['uncategorized', '未分類']
].map(([id, name], order) => ({ id, name, order }));

export const PAYMENT_METHODS = [
  ['cash', '現金'], ['credit', 'クレジットカード'], ['debit', 'デビットカード'],
  ['electronic', '電子マネー'], ['qr', 'QRコード決済'], ['other', 'その他']
].map(([id, name], order) => ({ id, name, order }));

export const CONVENIENCE_ALIASES = ['コンビニ', 'セブンイレブン', 'セブン-イレブン', '7-eleven', 'ファミリーマート', 'ファミマ', 'familymart', 'ローソン', 'lawson', 'ミニストップ', 'ministop', 'デイリーヤマザキ', 'セイコーマート'];
export const MAX_AMOUNT = 999_999_999;

export function localISO(date = new Date()) {
  const y = date.getFullYear();
  return `${y}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function parseISO(value) {
  const [year, month, day] = value.split('-').map(Number);
  return { year, month, day };
}

export function makeISO(year, month, day = 1) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function addCalendarDays(value, count) {
  const { year, month, day } = parseISO(value);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + count);
  return makeISO(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

export function addMonths(monthKey, count) {
  const { year, month } = parseISO(`${monthKey}-01`);
  const date = new Date(Date.UTC(year, month - 1 + count, 1));
  return makeISO(date.getUTCFullYear(), date.getUTCMonth() + 1).slice(0, 7);
}

export function dateRange(period, now = new Date(), firstWeekday = 0) {
  const today = localISO(now);
  const { year, month, day } = parseISO(today);
  if (period === 'all') return null;
  if (period === 'today') return { start: today, end: addCalendarDays(today, 1) };
  if (period === 'yesterday') { const start = addCalendarDays(today, -1); return { start, end: today }; }
  if (period === 'thisMonth' || period === 'lastMonth') {
    const key = addMonths(makeISO(year, month).slice(0, 7), period === 'lastMonth' ? -1 : 0);
    return { start: `${key}-01`, end: `${addMonths(key, 1)}-01` };
  }
  if (period === 'thisYear' || period === 'lastYear') {
    const y = year + (period === 'lastYear' ? -1 : 0);
    return { start: `${y}-01-01`, end: `${y + 1}-01-01` };
  }
  if (period === 'thisWeek' || period === 'lastWeek') {
    const localDay = now.getDay();
    const offset = (localDay - firstWeekday + 7) % 7 + (period === 'lastWeek' ? 7 : 0);
    const start = addCalendarDays(today, -offset);
    return { start, end: addCalendarDays(start, 7) };
  }
  throw new Error('不明な期間です。');
}

export function parseAmount(input) {
  const text = String(input).normalize('NFKC').trim();
  if (!text) throw new Error('金額を入力してください。');
  let plain = text;
  if (text.includes(',')) {
    if (!/^[0-9]{1,3}(,[0-9]{3})*$/.test(text)) throw new Error('桁区切りを正しく入力してください。');
    plain = text.replaceAll(',', '');
  } else if (!/^[0-9]+$/.test(text)) throw new Error('金額は1円単位の整数で入力してください。');
  const value = Number(plain);
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_AMOUNT) throw new Error('金額は1円以上999,999,999円以下で入力してください。');
  return value;
}

export function validateExpense(input, today = localISO()) {
  const errors = {};
  let amount;
  try { amount = parseAmount(input.amount); } catch (error) { errors.amount = error.message; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date || '') || input.date > today) errors.date = '利用日は今日以前を選んでください。';
  if (!CATEGORIES.some(category => category.id === input.categoryId)) errors.category = 'カテゴリを選択してください。';
  return { valid: Object.keys(errors).length === 0, errors, value: amount };
}

export function checkedSum(records) {
  const value = records.reduce((sum, record) => sum + BigInt(record.amount), 0n);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('金額の合計が扱える範囲を超えました。');
  return value;
}

export function money(value) {
  return new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY', maximumFractionDigits: 0 }).format(value);
}

export function filterExpenses(records, { month = '', categoryId = '', search = '', range = null, categoryIds = [], merchant = null, minimum = null } = {}) {
  const term = search.trim().toLocaleLowerCase('ja-JP');
  return records.filter(record => {
    if (month && !record.date.startsWith(`${month}-`)) return false;
    if (categoryId && record.categoryId !== categoryId) return false;
    if (range && !(record.date >= range.start && record.date < range.end)) return false;
    if (categoryIds.length && !categoryIds.includes(record.categoryId)) return false;
    if (minimum !== null && record.amount < minimum) return false;
    if (term && !record.merchant.toLocaleLowerCase('ja-JP').includes(term) && !record.memo.toLocaleLowerCase('ja-JP').includes(term)) return false;
    if (merchant?.type === 'contains' && !record.merchant.toLocaleLowerCase('ja-JP').includes(merchant.value.toLocaleLowerCase('ja-JP'))) return false;
    if (merchant?.type === 'convenience' && !CONVENIENCE_ALIASES.some(alias => record.merchant.toLocaleLowerCase('ja-JP').includes(alias.toLocaleLowerCase('ja-JP')))) return false;
    return true;
  }).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
}

export function categoryTotals(records) {
  return CATEGORIES.map(category => ({ ...category, amount: checkedSum(records.filter(record => record.categoryId === category.id)) }))
    .filter(item => item.amount > 0n).sort((a, b) => a.amount === b.amount ? a.order - b.order : a.amount > b.amount ? -1 : 1);
}

function roundDiv(value, divisor) {
  if (value >= 0n) return (value + divisor / 2n) / divisor;
  return -((-value + divisor / 2n) / divisor);
}

export function monthlySummary(records, monthKey) {
  const current = filterExpenses(records, { month: monthKey });
  const previous = filterExpenses(records, { month: addMonths(monthKey, -1) });
  const total = checkedSum(current), previousTotal = checkedSum(previous), difference = total - previousTotal;
  const average = current.length ? roundDiv(total, BigInt(current.length)) : null;
  const totals = categoryTotals(current);
  const top = totals.length ? totals.filter(item => item.amount === totals[0].amount).map(item => item.name) : [];
  const percentTenths = previousTotal === 0n ? null : roundDiv(difference * 1000n, previousTotal);
  return { total, count: current.length, average, top, difference, percentTenths, current, previous };
}

export function dailyTotals(records, monthKey) {
  const end = `${addMonths(monthKey, 1)}-01`;
  const result = [];
  for (let date = `${monthKey}-01`; date < end; date = addCalendarDays(date, 1)) {
    result.push({ key: date, label: `${parseISO(date).day}日`, amount: checkedSum(records.filter(record => record.date === date)) });
  }
  return result;
}

export function sixMonthTotals(records, monthKey) {
  return Array.from({ length: 6 }, (_, index) => {
    const key = addMonths(monthKey, index - 5);
    return { key, label: `${parseISO(`${key}-01`).year}/${parseISO(`${key}-01`).month}`, amount: checkedSum(filterExpenses(records, { month: key })) };
  });
}

export function parseQuestion(input) {
  const text = String(input).normalize('NFKC').replace(/[\s、]/g, '').replace(/[?？。]+$/g, '');
  if (!text) return { status: 'unsupported', message: '質問を入力してください。' };
  const unsupported = ['以外', '以下', '未満', 'だけ', '現金', 'より多', 'より少'];
  const hit = unsupported.find(word => text.includes(word));
  if (hit) return { status: 'unsupported', message: `「${hit}」を含む条件にはまだ対応していません。条件を省略した検索は行いません。` };
  const periods = [['今日', 'today'], ['昨日', 'yesterday'], ['今週', 'thisWeek'], ['先週', 'lastWeek'], ['今月', 'thisMonth'], ['先月', 'lastMonth'], ['今年', 'thisYear'], ['去年', 'lastYear']].filter(([word]) => text.includes(word));
  if (periods.length > 1) return { status: 'ambiguous', message: '期間の指定が矛盾しています。' };
  const period = periods[0]?.[1] || 'all';
  const periodPattern = '(今日|昨日|今週|先週|今月|先月|今年|去年)?';
  const shapes = [
    new RegExp(`^${periodPattern}(の)?(外食|食料品|食費|未分類|コンビニ)?(費|に|代)?(の)?(支出)?(合計)?(は|を|代を)?(いくら使った|いくら|見せて|表示して|何件ある|一番使ったカテゴリ|最も使ったカテゴリ|月別に表示して)$`),
    /^1万(円)?以上の支出を見せて$/, new RegExp(`^${periodPattern}(の)?[『「].+[』」]の支出を見せて$`),
    new RegExp(`^${periodPattern}(の)?支出合計は$`), new RegExp(`^${periodPattern}(の)?(一番|最も)使ったカテゴリは$`)
  ];
  if (!shapes.some(pattern => pattern.test(text))) return { status: 'unsupported', message: '対応していない条件または文型が含まれています。条件を省略した検索は行いません。' };
  const query = { period, categoryIds: [], merchant: null, minimum: null, aggregation: 'list' };
  if (text.includes('食費')) query.categoryIds = ['dining', 'groceries'];
  else if (text.includes('外食')) query.categoryIds = ['dining'];
  else if (text.includes('食料品')) query.categoryIds = ['groceries'];
  else if (text.includes('未分類')) query.categoryIds = ['uncategorized'];
  if (text.includes('コンビニ')) query.merchant = { type: 'convenience' };
  else {
    const quoted = text.match(/[『「](.+)[』」]/);
    if (quoted) query.merchant = { type: 'contains', value: quoted[1] };
  }
  if (/1万(円)?以上/.test(text)) query.minimum = 10_000;
  if (text.includes('一番使ったカテゴリ') || text.includes('最も使ったカテゴリ')) query.aggregation = 'topCategory';
  else if (text.includes('月別')) query.aggregation = 'monthly';
  else if (text.includes('何件')) query.aggregation = 'count';
  else if (text.includes('合計') || text.includes('いくら')) query.aggregation = 'total';
  if (query.aggregation === 'monthly' && period !== 'thisYear') return { status: 'unsupported', message: '月別表示は今年を指定した質問に対応しています。' };
  return { status: 'success', query };
}

export function executeQuestion(query, records, now = new Date(), firstWeekday = 0) {
  const range = dateRange(query.period, now, firstWeekday);
  const matches = filterExpenses(records, { range, categoryIds: query.categoryIds, merchant: query.merchant, minimum: query.minimum });
  const result = { query, range, records: matches, total: checkedSum(matches), categories: categoryTotals(matches), months: [] };
  if (query.aggregation === 'monthly') {
    const currentMonth = localISO(now).slice(0, 7);
    const year = parseISO(localISO(now)).year;
    for (let month = 1; month <= parseISO(localISO(now)).month; month++) {
      const key = makeISO(year, month).slice(0, 7);
      result.months.push({ key, label: `${month}月`, amount: checkedSum(filterExpenses(matches, { month: key })) });
    }
    if (!result.months.length) result.months = [{ key: currentMonth, label: `${parseISO(localISO(now)).month}月`, amount: 0n }];
  }
  return result;
}
