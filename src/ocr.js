import { CATEGORIES, CONVENIENCE_ALIASES, localISO, makeISO, parseAmount } from './core.js';

const TOTAL_WORDS = ['合計', '総合計', 'お買上', 'お買い上げ', 'お支払', 'お支払い', '現計', 'total', 'ご請求'];
const EXCLUDE_AMOUNT_WORDS = ['お預り', 'お預かり', '釣銭', 'おつり', '税率', '内税', '外税', '消費税', 'tel', '電話'];

export function extractReceiptFields(rawText, today = localISO()) {
  const text = String(rawText || '').normalize('NFKC');
  const lines = text.split(/\r?\n/).map(line => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const amountCandidates = extractAmounts(lines);
  const merchantCandidates = extractMerchants(lines);
  const dateCandidates = extractDates(lines, today);
  const category = suggestCategory(text);
  return { rawText: text, lines, amountCandidates, merchantCandidates, dateCandidates, category };
}

export function extractAmounts(lines) {
  const found = new Map();
  for (const [lineIndex, line] of lines.entries()) {
    const lower = line.toLocaleLowerCase('ja-JP');
    const totalHit = TOTAL_WORDS.some(word => lower.includes(word));
    const excluded = EXCLUDE_AMOUNT_WORDS.some(word => lower.includes(word));
    const dateOrTimeLine = /\d{2,4}[年/.\-]\d{1,2}[月/.\-]\d{1,2}|\d{1,2}:\d{2}/.test(line);
    const matches = [...line.matchAll(/(?:[¥￥]\s*)?([0-9]{1,3}(?:,[0-9]{3})+|[0-9]{2,9})(?:\s*円)?/g)];
    for (const match of matches) {
      const token = match[1];
      let value;
      try { value = parseAmount(token); } catch { continue; }
      if (looksLikeDateOrTime(line, token) || value < 10) continue;
      if (dateOrTimeLine && !/[¥￥円]/.test(match[0]) && !totalHit) continue;
      let score = Math.max(0, 20 - lineIndex);
      if (totalHit) score += 120;
      if (/[¥￥円]/.test(match[0])) score += 25;
      if (excluded) score -= 100;
      const current = found.get(value);
      if (!current || score > current.score) found.set(value, { value, line, score });
    }
  }
  return [...found.values()].sort((a, b) => b.score - a.score || b.value - a.value).slice(0, 8);
}

function looksLikeDateOrTime(line, token) {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:\\d{2,4}[/.-])?${escaped}[/.:年時]`).test(line) || /\d{2,4}[年/.:-]\d{1,2}[月/.:-]\d{1,2}/.test(token);
}

export function extractDates(lines, today = localISO()) {
  const currentYear = Number(today.slice(0, 4));
  const values = new Set();
  for (const line of lines) {
    const patterns = [
      /((?:20)?\d{2})[年/.\-](\d{1,2})[月/.\-](\d{1,2})日?/g,
      /(?<!\d)(\d{1,2})[月/.\-](\d{1,2})日?(?!\d)/g
    ];
    for (const [index, pattern] of patterns.entries()) {
      for (const match of line.matchAll(pattern)) {
        let year = index === 0 ? Number(match[1]) : currentYear;
        const month = Number(match[index === 0 ? 2 : 1]);
        const day = Number(match[index === 0 ? 3 : 2]);
        if (year < 100) year += 2000;
        const candidate = makeISO(year, month, day);
        const valid = new Date(`${candidate}T00:00:00`);
        if (valid.getFullYear() === year && valid.getMonth() + 1 === month && valid.getDate() === day && candidate <= today) values.add(candidate);
      }
    }
  }
  return [...values].sort().reverse();
}

export function extractMerchants(lines) {
  const rejected = /(領収|レシート|receipt|tel|電話|登録番号|日時|担当|合計|小計|現金|お釣|釣銭|消費税|税率|点数)/i;
  return lines.slice(0, 12).map((line, index) => {
    const cleaned = line.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N})）店本舗館センター]+$/gu, '').trim();
    let score = 50 - index * 3;
    if (/[店舗館]/.test(cleaned)) score += 15;
    if (CONVENIENCE_ALIASES.some(alias => cleaned.includes(alias))) score += 30;
    if (rejected.test(cleaned) || cleaned.length < 2 || /^\d+$/.test(cleaned)) score -= 100;
    return { value: cleaned.slice(0, 100), line, score };
  }).filter(item => item.score > 0).sort((a, b) => b.score - a.score).filter((item, index, all) => all.findIndex(other => other.value === item.value) === index).slice(0, 6);
}

export function suggestCategory(rawText) {
  const text = String(rawText || '').normalize('NFKC').toLocaleLowerCase('ja-JP');
  const rules = {
    dining: ['レストラン','食堂','カフェ','喫茶','ラーメン','居酒屋','焼肉','寿司','うどん','そば','弁当','マクドナルド','スターバックス'],
    groceries: ['スーパー','食品','食料','青果','精肉','鮮魚','牛乳','野菜','飲料','おにぎり','パン','菓子','惣菜','コンビニ', ...CONVENIENCE_ALIASES],
    daily_goods: ['日用品','ホームセンター','ドラッグストア','洗剤','ティッシュ','トイレットペーパー','雑貨'],
    transport: ['鉄道','jr','地下鉄','バス','タクシー','交通','乗車','駐車','ガソリン','高速道路'],
    entertainment: ['映画','シネマ','ゲーム','書店','書籍','チケット','カラオケ','レジャー'],
    clothing: ['衣料','衣服','ファッション','ユニクロ','靴','シューズ','アパレル'],
    medical: ['病院','医院','クリニック','診療','処方','薬局','調剤','医療'],
    utilities: ['電気','ガス','水道','通信','電話料金','インターネット','携帯料金']
  };
  const scored = Object.entries(rules).map(([id, words]) => ({ id, hits: words.filter(word => text.includes(word)) })).filter(item => item.hits.length).sort((a, b) => b.hits.length - a.hits.length);
  if (!scored.length) return { id: 'uncategorized', name: '未分類', confident: false, reason: '分類できる語を読み取れませんでした' };
  const best = scored[0];
  return { id: best.id, name: CATEGORIES.find(item => item.id === best.id)?.name || '未分類', confident: best.hits.length >= 2 || scored.length === 1, reason: `OCR全文の「${best.hits.slice(0, 3).join('・')}」から候補を作成` };
}

export async function prepareReceiptImage(file, maxEdge = 2600) {
  if (typeof document === 'undefined' || typeof Image === 'undefined') return file;
  const objectURL = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = 'async';
    image.src = objectURL;
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error('この写真形式をSafariで開けませんでした。JPEGまたはPNGの写真を選んでください。'));
    });
    const sourceWidth = image.naturalWidth;
    const sourceHeight = image.naturalHeight;
    if (!sourceWidth || !sourceHeight) throw new Error('写真の大きさを取得できませんでした。');
    const scale = Math.min(1, maxEdge / Math.max(sourceWidth, sourceHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(sourceWidth * scale));
    canvas.height = Math.max(1, Math.round(sourceHeight * scale));
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('写真をOCR用に変換できませんでした。');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise((resolve, reject) => canvas.toBlob(
      blob => blob ? resolve(blob) : reject(new Error('写真をOCR用に変換できませんでした。')),
      'image/jpeg',
      0.94
    ));
  } finally {
    URL.revokeObjectURL(objectURL);
  }
}

export async function recognizeReceipt(file, onProgress = () => {}) {
  if (!globalThis.Tesseract?.createWorker) throw new Error('OCRエンジンを読み込めませんでした。オンラインでアプリを開き直してください。');
  const base = new URL('../vendor/ocr/', import.meta.url);
  let worker;
  try {
    onProgress({ status: 'preparing image', progress: 0 });
    const preparedImage = await prepareReceiptImage(file);
    worker = await globalThis.Tesseract.createWorker(['jpn', 'eng'], 1, {
      workerPath: new URL('worker.min.js', base).href,
      langPath: new URL('lang', base).href.replace(/\/$/, ''),
      corePath: new URL('core', base).href.replace(/\/$/, ''),
      workerBlobURL: false,
      logger: message => onProgress(message)
    });
    await worker.setParameters({ preserve_interword_spaces: '1' });
    const result = await worker.recognize(preparedImage, { rotateAuto: true });
    return { text: result.data.text || '', confidence: Number(result.data.confidence || 0) };
  } finally {
    if (worker) await worker.terminate();
  }
}
