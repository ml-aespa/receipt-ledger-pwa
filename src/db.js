const DB_NAME = 'receipt-ledger-local-v1';
const STORE = 'expenses';

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('端末内データベースを操作できませんでした。'));
  });
}

export async function openDatabase() {
  const request = indexedDB.open(DB_NAME, 1);
  request.onupgradeneeded = () => {
    const db = request.result;
    if (!db.objectStoreNames.contains(STORE)) {
      const store = db.createObjectStore(STORE, { keyPath: 'id' });
      store.createIndex('date', 'date');
      store.createIndex('categoryId', 'categoryId');
    }
  };
  return requestResult(request);
}

async function store(mode = 'readonly') {
  const db = await openDatabase();
  return db.transaction(STORE, mode).objectStore(STORE);
}

export async function listExpenses() { return requestResult((await store()).getAll()); }
export async function saveExpense(expense) { return requestResult((await store('readwrite')).put(expense)); }
export async function deleteExpense(id) { return requestResult((await store('readwrite')).delete(id)); }
