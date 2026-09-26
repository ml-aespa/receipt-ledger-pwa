import {
  CATEGORIES, PAYMENT_METHODS, addMonths, categoryTotals, checkedSum, dailyTotals, dateRange, executeQuestion,
  filterExpenses, localISO, money, monthlySummary, parseISO, parseQuestion, sixMonthTotals, validateExpense
} from './core.js';
import { deleteExpense, listExpenses, saveExpense } from './db.js';
import { extractReceiptFields, recognizeReceipt } from './ocr.js';

const $ = selector => document.querySelector(selector);
const views = ['home', 'history', 'analysis', 'question'];
const categoryName = id => CATEGORIES.find(item => item.id === id)?.name || '未分類';
const paymentName = id => PAYMENT_METHODS.find(item => item.id === id)?.name || '未選択';
const html = value => String(value ?? '').replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]);
const uuid = () => crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const firstWeekday = (() => { try { return new Intl.Locale(navigator.language).weekInfo.firstDay % 7; } catch { return 0; } })();

let expenses = [];
let activeTab = 'home';
let selectedExpenseId = null;
let historyFilters = { month: '', categoryId: '', search: '' };
let analysisMonth = localISO().slice(0, 7);
let questionState = { input: '', result: null, message: '' };
let formSource = 'manual';
let formOCR = { text: '', confidence: null };
let ocrDraft = null;
let receiptPreviewURL = null;
let pendingSave = null;

function formatDate(value) {
  const { year, month, day } = parseISO(value);
  return `${year}年${month}月${day}日`;
}

function expenseRows(records, emptyMessage = '該当する支出はありません。') {
  if (!records.length) return `<div class="empty"><p>${html(emptyMessage)}</p></div>`;
  return records.map(record => `<button class="expense-row" type="button" data-expense-id="${html(record.id)}" aria-label="${html(`${formatDate(record.date)}、${record.merchant || '店名なし'}、${categoryName(record.categoryId)}、${money(BigInt(record.amount))}`)}"><span><span class="merchant">${html(record.merchant || '店名なし')}</span><span class="muted caption">${html(formatDate(record.date))}・${html(categoryName(record.categoryId))}</span></span><span class="expense-amount">${money(BigInt(record.amount))}</span></button>`).join('');
}

function comparisonText(summary) {
  if (summary.percentTenths === null) return `${money(summary.difference)}（比較できません）`;
  const sign = summary.percentTenths > 0n ? '+' : '';
  return `${money(summary.difference)}（${sign}${Number(summary.percentTenths) / 10}%）`;
}

function renderHome() {
  const month = localISO().slice(0, 7);
  const summary = monthlySummary(expenses, month);
  const totals = categoryTotals(summary.current);
  const today = parseISO(localISO());
  $('#home-view').innerHTML = `
    ${!window.matchMedia('(display-mode: standalone)').matches ? '<aside class="card install-note"><strong>ホーム画面へ追加できます</strong><p class="muted caption">Safariの共有メニューから「ホーム画面に追加」→「Webアプリとして開く」をオンにしてください。</p></aside>' : ''}
    <section class="card hero"><p class="muted">今月の支出</p><p class="hero-amount">${money(summary.total)}</p><p>前月との差：${comparisonText(summary)}</p>${today.day !== 1 ? '<p class="muted caption">今月の記録済み合計と前月全体の比較です。</p>' : ''}</section>
    <section class="card"><h2>カテゴリ別</h2>${totals.length ? totals.slice(0, 5).map(item => `<div class="stat-row"><span>${html(item.name)}</span><span class="stat-value">${money(item.amount)}</span></div>`).join('') : '<p class="muted">今月の支出はまだありません。</p>'}</section>
    <section class="card"><h2>最近の支出</h2>${expenseRows(expenses.slice().sort((a,b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)).slice(0, 5), '追加ボタンから最初の支出を登録できます。')}</section>`;
  bindExpenseRows();
}

function availableMonths() {
  return [...new Set([localISO().slice(0, 7), ...expenses.map(item => item.date.slice(0, 7))])].sort().reverse();
}

function renderHistory() {
  const filtered = filterExpenses(expenses, historyFilters);
  let total;
  try { total = money(checkedSum(filtered)); } catch { total = '合計できません'; }
  $('#history-view').innerHTML = `
    <div class="filters">
      <label class="wide">店名・メモ検索<input id="history-search" type="search" value="${html(historyFilters.search)}" placeholder="部分一致で検索"></label>
      <label>月<select id="history-month"><option value="">全期間</option>${availableMonths().map(key => `<option value="${key}" ${historyFilters.month === key ? 'selected' : ''}>${html(key.replace('-', '年'))}月</option>`).join('')}</select></label>
      <label>カテゴリ<select id="history-category"><option value="">すべて</option>${CATEGORIES.map(item => `<option value="${item.id}" ${historyFilters.categoryId === item.id ? 'selected' : ''}>${html(item.name)}</option>`).join('')}</select></label>
    </div>
    <div class="card"><div class="stat-row"><span>${filtered.length}件</span><span class="stat-value">合計 ${total}</span></div>${expenseRows(filtered, '絞り込み条件に一致する支出はありません。')}</div>`;
  $('#history-search').addEventListener('input', event => { historyFilters.search = event.target.value; renderHistory(); });
  $('#history-month').addEventListener('change', event => { historyFilters.month = event.target.value; renderHistory(); });
  $('#history-category').addEventListener('change', event => { historyFilters.categoryId = event.target.value; renderHistory(); });
  bindExpenseRows();
}

function verticalChart(data, label) {
  const max = data.reduce((value, item) => item.amount > value ? item.amount : value, 0n);
  if (max === 0n) return '<div class="empty">対象期間の支出データがありません。</div>';
  return `<div class="chart" role="img" aria-label="${html(label)}">${data.map((item, index) => { const height = Number(item.amount * 100n / max); const showLabel = data.length <= 12 || index % 5 === 0; return `<div class="bar-group" title="${html(item.label)} ${money(item.amount)}"><div class="bar" style="height:${Math.max(2, height)}%"></div>${showLabel ? `<span class="bar-label">${html(item.label)}</span>` : ''}<span class="sr-only">${html(item.label)} ${money(item.amount)}</span></div>`; }).join('')}</div>`;
}

function horizontalChart(data) {
  const max = data.reduce((value, item) => item.amount > value ? item.amount : value, 0n);
  if (max === 0n) return '<div class="empty">対象期間の支出データがありません。</div>';
  return data.map(item => `<div class="hbar-row"><span>${html(item.name || item.label)}</span><div class="hbar-track" aria-hidden="true"><div class="hbar" style="width:${Number(item.amount * 100n / max)}%"></div></div><strong>${money(item.amount)}</strong></div>`).join('');
}

function valueList(data) {
  return `<details><summary>数値を一覧で確認</summary>${data.map(item => `<div class="stat-row"><span>${html(item.name || item.label)}</span><span class="stat-value">${money(item.amount)}</span></div>`).join('')}</details>`;
}

function renderAnalysis() {
  const summary = monthlySummary(expenses, analysisMonth);
  const daily = dailyTotals(expenses, analysisMonth);
  const categories = categoryTotals(summary.current);
  const months = sixMonthTotals(expenses, analysisMonth);
  const top = summary.top.length ? `${summary.top.join('・')}${summary.top.length > 1 ? '（同率）' : ''}` : '—';
  const isCurrent = analysisMonth === localISO().slice(0, 7);
  $('#analysis-view').innerHTML = `
    <div class="month-nav"><button id="prev-month" type="button" aria-label="前の月">‹</button><strong>${html(analysisMonth.replace('-', '年'))}月</strong><button id="next-month" type="button" aria-label="次の月" ${isCurrent ? 'disabled' : ''}>›</button></div>
    <section class="card"><div class="stat-row"><span>支出合計</span><span class="stat-value">${money(summary.total)}</span></div><div class="stat-row"><span>登録件数</span><span class="stat-value">${summary.count}件</span></div><div class="stat-row"><span>1件あたり</span><span class="stat-value">${summary.average === null ? '—' : money(summary.average)}</span></div><div class="stat-row"><span>最多カテゴリ</span><span class="stat-value">${html(top)}</span></div><div class="stat-row"><span>前月との差</span><span class="stat-value">${comparisonText(summary)}</span></div>${isCurrent ? '<p class="muted caption">今月の記録済み合計と前月全体を比較しています。</p>' : ''}</section>
    <section class="card"><h2>日別支出</h2>${verticalChart(daily, `${analysisMonth}の日別支出`)}${valueList(daily)}</section>
    <section class="card"><h2>カテゴリ別支出</h2>${horizontalChart(categories)}${categories.length ? valueList(categories) : ''}</section>
    <section class="card"><h2>直近6か月の推移</h2>${verticalChart(months, `${analysisMonth}までの6か月支出`)}${valueList(months)}</section>
    <p class="muted caption">週の開始：${firstWeekday === 0 ? '日曜日' : firstWeekday === 1 ? '月曜日' : `端末設定（${firstWeekday}）`}</p>`;
  $('#prev-month').addEventListener('click', () => { analysisMonth = addMonths(analysisMonth, -1); renderAnalysis(); });
  $('#next-month').addEventListener('click', () => { analysisMonth = addMonths(analysisMonth, 1); renderAnalysis(); });
}

const examples = ['今週、外食にいくら使った？', '今月の支出合計は？', '先月の食費はいくら？', '昨日のコンビニ代を見せて', '今月一番使ったカテゴリは？', '1万円以上の支出を見せて', '未分類の支出は何件ある？', '今年の外食費を月別に表示して'];

function periodName(period) { return ({ all:'全期間', today:'今日', yesterday:'昨日', thisWeek:'今週', lastWeek:'先週', thisMonth:'今月', lastMonth:'先月', thisYear:'今年', lastYear:'去年' })[period]; }

function conditionText(result) {
  const { query, range } = result;
  const lines = [`期間：${periodName(query.period)}${range ? `（${formatDate(range.start)}以上、${formatDate(range.end)}未満）` : ''}`];
  if (query.categoryIds.length) lines.push(`カテゴリ：${query.categoryIds.map(categoryName).join('・')}`);
  if (query.merchant?.type === 'convenience') lines.push('店名：コンビニ辞書一致');
  if (query.merchant?.type === 'contains') lines.push(`店名に「${query.merchant.value}」を含む`);
  if (query.minimum !== null) lines.push(`金額：${money(BigInt(query.minimum))}以上`);
  return lines.join('\n');
}

function answerText(result) {
  if (result.query.aggregation === 'count') return `${result.records.length}件です。`;
  if (result.query.aggregation === 'total') return `合計は${money(result.total)}です。`;
  if (result.query.aggregation === 'topCategory') {
    if (!result.categories.length) return '最多カテゴリはありません。';
    const ties = result.categories.filter(item => item.amount === result.categories[0].amount);
    return `最多カテゴリは${ties.map(item => item.name).join('・')}、${money(ties[0].amount)}です${ties.length > 1 ? '（同率）' : ''}。`;
  }
  if (result.query.aggregation === 'monthly') return `合計は${money(result.total)}です。月別の内訳を表示します。`;
  return `${result.records.length}件、合計${money(result.total)}です。`;
}

function runQuestion(value) {
  questionState.input = value;
  const parsed = parseQuestion(value);
  if (parsed.status !== 'success') { questionState.result = null; questionState.message = parsed.message; }
  else { questionState.result = executeQuestion(parsed.query, expenses, new Date(), firstWeekday); questionState.message = ''; }
  renderQuestion();
}

function renderQuestion() {
  const result = questionState.result;
  $('#question-view').innerHTML = `
    <section class="card"><label>支出について質問<textarea id="question-input" rows="3" placeholder="今月の支出合計は？">${html(questionState.input)}</textarea></label><button id="ask-button" type="button" class="primary">質問する</button></section>
    <section class="card"><h2>質問例</h2><div class="question-examples">${examples.map(example => `<button type="button" data-question="${html(example)}">${html(example)}</button>`).join('')}</div></section>
    ${questionState.message ? `<section class="card error-panel"><h2>解釈できませんでした</h2><p>${html(questionState.message)}</p><p class="caption">例：今月の支出合計は？／1万円以上の支出を見せて</p></section>` : ''}
    ${result ? `<section class="card"><h2>適用した条件</h2><div class="condition-box">${html(conditionText(result))}</div></section><section class="card"><h2>回答</h2><p><strong>${html(answerText(result))}</strong></p>${result.query.merchant?.type === 'convenience' ? '<p class="muted caption">店名のコンビニ辞書で抽出しています。辞書にない店舗は対象外です。</p>' : ''}${!result.records.length ? '<p class="muted">条件に一致する支出はありません。</p>' : ''}</section>${result.months.length ? `<section class="card"><h2>月別</h2>${verticalChart(result.months, '月別支出')}${valueList(result.months)}</section>` : ''}<section class="card"><h2>根拠となる明細（${result.records.length}件）</h2>${expenseRows(result.records)}</section>` : ''}`;
  $('#ask-button').addEventListener('click', () => runQuestion($('#question-input').value));
  document.querySelectorAll('[data-question]').forEach(button => button.addEventListener('click', () => runQuestion(button.dataset.question)));
  bindExpenseRows();
}

function renderAll() {
  renderHome(); renderHistory(); renderAnalysis(); renderQuestion();
}

function switchTab(tab) {
  activeTab = tab;
  views.forEach(name => $(`#${name}-view`).classList.toggle('active', name === tab));
  document.querySelectorAll('[data-tab]').forEach(button => { const selected = button.dataset.tab === tab; button.classList.toggle('selected', selected); if (selected) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current'); });
  $('#page-title').textContent = ({ home:'ホーム', history:'履歴', analysis:'分析', question:'質問' })[tab];
  window.scrollTo({ top: 0, behavior: 'auto' });
}

function bindExpenseRows() {
  document.querySelectorAll('[data-expense-id]').forEach(button => button.addEventListener('click', () => showDetail(button.dataset.expenseId)));
}

function resetErrors() { ['date-error','amount-error','category-error'].forEach(id => $(`#${id}`).textContent = ''); $('#save-error').hidden = true; }

function openForm(record = null, prefill = null) {
  resetErrors();
  $('#form-title').textContent = record ? '支出を編集' : '支出を追加';
  $('#expense-id').value = record?.id || '';
  $('#expense-date').value = prefill?.date || record?.date || localISO(); $('#expense-date').max = localISO();
  $('#merchant').value = prefill?.merchant || record?.merchant || ''; $('#amount').value = prefill?.amount || record?.amount || '';
  $('#category').innerHTML = CATEGORIES.map(item => `<option value="${item.id}">${html(item.name)}</option>`).join('');
  $('#category').value = prefill?.categoryId || record?.categoryId || 'uncategorized';
  $('#payment').innerHTML = `<option value="">未選択</option>${PAYMENT_METHODS.map(item => `<option value="${item.id}">${html(item.name)}</option>`).join('')}`;
  $('#payment').value = prefill?.paymentId || record?.paymentId || ''; $('#memo').value = prefill?.memo || record?.memo || '';
  formSource = prefill?.source || record?.source || 'manual';
  formOCR = { text: prefill?.ocrText || record?.ocrText || '', confidence: prefill?.ocrConfidence ?? record?.ocrConfidence ?? null };
  $('#expense-dialog').showModal();
}

function showDetail(id) {
  const record = expenses.find(item => item.id === id); if (!record) return;
  selectedExpenseId = id;
  $('#detail-content').innerHTML = `<div class="stat-row"><span>利用日</span><strong>${html(formatDate(record.date))}</strong></div><div class="stat-row"><span>店名</span><strong>${html(record.merchant || '店名なし')}</strong></div><div class="stat-row"><span>金額</span><strong>${money(BigInt(record.amount))}</strong></div><div class="stat-row"><span>カテゴリ</span><strong>${html(categoryName(record.categoryId))}</strong></div><div class="stat-row"><span>支払方法</span><strong>${html(paymentName(record.paymentId))}</strong></div>${record.memo ? `<div><h3>メモ</h3><p>${html(record.memo)}</p></div>` : ''}`;
  $('#detail-dialog').showModal();
}

async function reload() {
  expenses = await listExpenses();
  expenses.sort((a,b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  renderAll();
  if (questionState.input) runQuestion(questionState.input);
}

function toast(message) {
  const element = $('#toast'); element.textContent = message; element.hidden = false;
  setTimeout(() => { element.hidden = true; }, 2200);
}

function progressLabel(status) {
  return ({
    'preparing image':'写真をOCR用に整えています…',
    'loading tesseract core':'OCRエンジンを読み込み中…', 'initializing tesseract':'OCRエンジンを初期化中…',
    'loading language traineddata':'日本語辞書を読み込み中…', 'initializing api':'文字認識を準備中…',
    'recognizing text':'レシートの文字を読み取り中…'
  })[status] || 'レシートを処理中…';
}

function closeOCRDialog() {
  $('#ocr-dialog').close();
  if (receiptPreviewURL) { URL.revokeObjectURL(receiptPreviewURL); receiptPreviewURL = null; }
}

async function scanReceipt(file) {
  if (!file?.type.startsWith('image/')) { toast('画像ファイルを選択してください'); return; }
  if (file.size > 25 * 1024 * 1024) { toast('画像は25MB以下にしてください'); return; }
  if (receiptPreviewURL) URL.revokeObjectURL(receiptPreviewURL);
  receiptPreviewURL = URL.createObjectURL(file);
  $('#receipt-preview').src = receiptPreviewURL;
  $('#ocr-progress').hidden = false; $('#ocr-progress-bar').value = 0; $('#ocr-progress p').textContent = 'OCRを準備しています…';
  $('#ocr-results').hidden = true; $('#ocr-error').hidden = true; $('#ocr-dialog').showModal();
  try {
    const recognized = await recognizeReceipt(file, message => {
      $('#ocr-progress p').textContent = progressLabel(message.status);
      $('#ocr-progress-bar').value = Math.round((message.progress || 0) * 100);
    });
    ocrDraft = { ...extractReceiptFields(recognized.text), confidence: recognized.confidence };
    populateOCRResults(ocrDraft);
    $('#ocr-progress').hidden = true; $('#ocr-results').hidden = false;
  } catch (error) {
    const detail = error?.message || (typeof error === 'string' ? error : '画像形式または画像内容を認識できませんでした。');
    $('#ocr-progress').hidden = true; $('#ocr-error').textContent = `読み取りできませんでした。画像を撮り直すか、手入力をお使いください。\n${detail}`; $('#ocr-error').hidden = false;
  }
}

function populateOCRResults(result) {
  $('#ocr-confidence').textContent = `OCR信頼度の目安：${Math.round(result.confidence)}%。候補は必ずレシートと照合してください。`;
  $('#ocr-merchant-select').innerHTML = `${result.merchantCandidates.map(item => `<option value="${html(item.value)}">${html(item.value)}</option>`).join('')}<option value="__manual__">読み取れない／別の店名を入力</option>`;
  if (!result.merchantCandidates.length) $('#ocr-merchant-select').value = '__manual__';
  $('#ocr-merchant-manual-label').hidden = $('#ocr-merchant-select').value !== '__manual__';
  $('#ocr-date-select').innerHTML = `${result.dateCandidates.map(value => `<option value="${value}">${html(formatDate(value))}</option>`).join('')}<option value="${localISO()}">読み取れない／今日を使用</option>`;
  $('#ocr-amount-select').innerHTML = `<option value="">読み取れない／手入力する</option>${result.amountCandidates.map(item => `<option value="${item.value}">${money(BigInt(item.value))} — ${html(item.line.slice(0, 40))}</option>`).join('')}`;
  if (result.amountCandidates.length) $('#ocr-amount-select').value = String(result.amountCandidates[0].value);
  $('#ocr-category-select').innerHTML = CATEGORIES.map(item => `<option value="${item.id}">${html(item.name)}</option>`).join('');
  $('#ocr-category-select').value = result.category.id;
  $('#ocr-category-reason').textContent = `${result.category.reason}。違う場合は必ず選び直してください。`;
  $('#ocr-payment-select').innerHTML = `<option value="">読み取れない／未選択</option>${PAYMENT_METHODS.map(item => `<option value="${item.id}">${html(item.name)}</option>`).join('')}`;
  $('#ocr-raw-text').value = result.rawText;
}

async function persistRecord(record, existing) {
  const saveButton = $('#save-form'); saveButton.disabled = true; saveButton.textContent = '保存中…';
  const confirmButton = $('#accept-amount-confirm'); confirmButton.disabled = true;
  try {
    await saveExpense(record); await reload();
    if ($('#amount-confirm-dialog').open) $('#amount-confirm-dialog').close();
    if ($('#expense-dialog').open) $('#expense-dialog').close();
    pendingSave = null; toast(existing ? '更新しました' : '保存しました');
  } catch (error) {
    if ($('#amount-confirm-dialog').open) $('#amount-confirm-dialog').close();
    $('#save-error').textContent = `保存できませんでした。入力内容は保持されています。\n${error.message}`; $('#save-error').hidden = false;
  } finally {
    saveButton.disabled = false; saveButton.textContent = '保存'; confirmButton.disabled = false;
  }
}

document.querySelectorAll('[data-tab]').forEach(button => button.addEventListener('click', () => switchTab(button.dataset.tab)));
$('#add-button').addEventListener('click', () => openForm());
$('#scan-button').addEventListener('click', () => { $('#receipt-image').value = ''; $('#receipt-image').click(); });
$('#receipt-image').addEventListener('change', event => { if (event.target.files?.[0]) scanReceipt(event.target.files[0]); });
$('#cancel-ocr').addEventListener('click', closeOCRDialog);
$('#ocr-merchant-select').addEventListener('change', event => { $('#ocr-merchant-manual-label').hidden = event.target.value !== '__manual__'; });
$('#apply-ocr').addEventListener('click', () => {
  if (!ocrDraft) return;
  const merchantSelection = $('#ocr-merchant-select').value;
  const prefill = {
    date: $('#ocr-date-select').value, merchant: merchantSelection === '__manual__' ? $('#ocr-merchant-manual').value.trim() : merchantSelection,
    amount: $('#ocr-amount-select').value, categoryId: $('#ocr-category-select').value, paymentId: $('#ocr-payment-select').value || null,
    memo: '', source: 'receipt_ocr', ocrText: ocrDraft.rawText, ocrConfidence: ocrDraft.confidence
  };
  closeOCRDialog(); openForm(null, prefill);
});
$('#cancel-form').addEventListener('click', () => $('#expense-dialog').close());
$('#close-detail').addEventListener('click', () => $('#detail-dialog').close());
$('#edit-expense').addEventListener('click', () => { const record = expenses.find(item => item.id === selectedExpenseId); $('#detail-dialog').close(); openForm(record); });
$('#delete-expense').addEventListener('click', () => { const record = expenses.find(item => item.id === selectedExpenseId); $('#confirm-message').textContent = `${record?.merchant || '店名なし'}・${money(BigInt(record?.amount || 0))}`; $('#confirm-dialog').showModal(); });
$('#cancel-delete').addEventListener('click', () => $('#confirm-dialog').close());
$('#confirm-delete').addEventListener('click', async () => {
  const button = $('#confirm-delete'); button.disabled = true;
  try { await deleteExpense(selectedExpenseId); $('#confirm-dialog').close(); $('#detail-dialog').close(); await reload(); toast('削除しました'); }
  catch (error) { $('#confirm-message').textContent = `削除できませんでした。${error.message}`; }
  finally { button.disabled = false; }
});
$('#cancel-amount-confirm').addEventListener('click', () => { $('#amount-confirm-dialog').close(); pendingSave = null; });
$('#accept-amount-confirm').addEventListener('click', () => { if (pendingSave) persistRecord(pendingSave.record, pendingSave.existing); });

$('#expense-form').addEventListener('submit', async event => {
  event.preventDefault(); resetErrors();
  const input = { date: $('#expense-date').value, merchant: $('#merchant').value.trim(), amount: $('#amount').value, categoryId: $('#category').value, paymentId: $('#payment').value || null, memo: $('#memo').value.trim() };
  const validation = validateExpense(input);
  if (!validation.valid) { Object.entries(validation.errors).forEach(([key,value]) => $(`#${key}-error`).textContent = value); return; }
  const saveButton = $('#save-form'); if (saveButton.disabled) return;
  const existing = expenses.find(item => item.id === $('#expense-id').value);
  const now = new Date().toISOString();
  const record = {
    id: existing?.id || uuid(), date: input.date, merchant: input.merchant, amount: validation.value,
    categoryId: input.categoryId, paymentId: input.paymentId, memo: input.memo,
    createdAt: existing?.createdAt || now, updatedAt: now, schemaVersion: 1,
    source: formSource, ocrText: formOCR.text || existing?.ocrText || '', ocrConfidence: formOCR.confidence ?? existing?.ocrConfidence ?? null
  };
  if (formSource === 'receipt_ocr') {
    pendingSave = { record, existing };
    $('#amount-confirm-value').textContent = money(BigInt(record.amount));
    $('#amount-confirm-dialog').showModal();
  } else {
    await persistRecord(record, existing);
  }
});

document.addEventListener('visibilitychange', () => { if (!document.hidden) { const current = localISO().slice(0,7); if (analysisMonth > current) analysisMonth = current; renderAll(); } });

async function start() {
  try {
    await reload(); switchTab(activeTab);
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname))) navigator.serviceWorker.register('./sw.js').catch(() => {});
  } catch (error) {
    $('#home-view').innerHTML = `<div class="error-panel"><h2>端末内データを開けませんでした</h2><p>${html(error.message)}</p><button type="button" id="retry-load">再試行</button></div>`;
    $('#retry-load').addEventListener('click', start);
  }
}

start();
