// Сквозной тест на макете Google Таблиц/Диска: node tests/flow.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

/* ---------- макет таблиц ---------- */
class Sheet {
  constructor(name, rows = 60, cols = 12) {
    this.name = name;
    this.cells = Array.from({ length: rows }, () => Array(cols).fill(''));
  }
  getName() { return this.name; }
  setName(n) { this.name = n; }
  getMaxRows() { return this.cells.length; }
  getLastRow() {
    for (let r = this.cells.length - 1; r >= 0; r--) if (this.cells[r].some((v) => v !== '')) return r + 1;
    return 0;
  }
  insertRowsAfter(_, n) { for (let i = 0; i < n; i++) this.cells.push(Array(this.cells[0].length).fill('')); }
  insertSheetRow_() {}
  getRange(r, c, nr = 1, nc = 1) {
    if (typeof r === 'string') throw new Error('A1 не поддержан');
    while (this.cells.length < r + nr - 1) this.cells.push(Array(this.cells[0].length).fill(''));
    const sh = this;
    const range = {
      getValues: () => sh.cells.slice(r - 1, r - 1 + nr).map((row) => row.slice(c - 1, c - 1 + nc)),
      setValues: (v) => { v.forEach((row, i) => row.forEach((x, j) => { sh.cells[r - 1 + i][c - 1 + j] = x; })); return range; },
      setValue: (x) => { sh.cells[r - 1][c - 1] = x; },
      clearContent: () => { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) sh.cells[r - 1 + i][c - 1 + j] = ''; },
      setNumberFormat: () => ({ setFontWeight: () => {} }),
      setFontWeight: () => {},
      getRow: () => r,
      createTextFinder: (q) => ({
        matchEntireCell: function () { return this; },
        matchCase: function () { return this; },
        findNext: () => {
          for (let i = 0; i < nr; i++) if (String(sh.cells[r - 1 + i][c - 1]) === q) return { getRow: () => r + i };
          return null;
        },
      }),
    };
    return range;
  }
  setFrozenRows() {}
  deleteRows(start, n) { this.cells.splice(start - 1, n); }
}
class Book {
  constructor(id, name, sheets) { this.id = id; this.name = name; this.sheets = sheets; }
  getId() { return this.id; }
  getName() { return this.name; }
  getUrl() { return 'https://docs/' + this.id; }
  getSheetByName(n) { return this.sheets.find((s) => s.name === n) || null; }
  getSheets() { return this.sheets; }
  insertSheet(n) { const s = new Sheet(n, 200, 12); this.sheets.push(s); return s; }
  deleteSheet(s) { this.sheets = this.sheets.filter((x) => x !== s); }
}

function monthBook(id, name, monthSheet) {
  const ops = new Sheet(monthSheet, 40, 11);
  ops.cells[3][1] = 'Дата'; ops.cells[3][2] = 'Сумма'; ops.cells[3][3] = 'Описание'; ops.cells[3][4] = 'Категория';
  ops.cells[3][6] = 'Дата'; ops.cells[3][7] = 'Сумма'; ops.cells[3][8] = 'Описание'; ops.cells[3][9] = 'Категория';
  ops.cells[4] = ['', '04.10', 5000, '', 'Одежда и обувь Настя', '', new Date(2026, 9, 1), 2500, '', 'Клиенты психология', ''];
  ops.cells[5] = ['', '', 1800, '', 'Детская одежда и обувь', '', '', 2500, '', 'Клиенты психология', ''];
  const sum = new Sheet('Сводка', 68, 13);
  const exp = [['Рестораны', 4000], ['Продукты', 30000], ['b17', 0], ['Одежда и обувь Настя', 8000], ['Детская одежда и обувь', 3000]];
  exp.forEach(([n, p], i) => { sum.cells[26 + i][1] = n; sum.cells[26 + i][3] = p; sum.cells[26 + i][4] = 0; });
  sum.cells[28][7] = 'Клиенты психология'; sum.cells[28][9] = 100000; sum.cells[28][10] = 5000;
  sum.cells[29][7] = 'Продажа '; sum.cells[29][9] = 5000;
  sum.cells[50][7] = 'Вклад'; // блок инвестиций — не статья дохода
  return new Book(id, name, [ops, sum]);
}

/* ---------- макет диска ---------- */
const books = {};
const files = {};
let seq = 0;
function makeFile(book, folder) {
  const f = {
    id: book.id, name: book.name, folder, trashed: false,
    getId: () => f.id, getName: () => f.name, isTrashed: () => f.trashed, getLastUpdated: () => new Date(),
    getEditors: () => [{ getEmail: () => 'wife@example.com' }], getOwner: () => ({ getEmail: () => 'wife@example.com' }),
    addEditors: (list) => { f.editors = list; },
    moveTo: (fo) => { f.folder = fo; },
    makeCopy: (name, toFolder) => {
      const src = books[f.id];
      const id = 'copy' + (++seq);
      const clone = new Book(id, name, src.sheets.map((s) => { const n = new Sheet(s.name); n.cells = s.cells.map((r) => r.slice()); return n; }));
      books[id] = clone;
      return makeFile(clone, toFolder);
    },
  };
  files[f.id] = f;
  return f;
}
function folder(name) {
  return { name, getName: () => name, getId: () => 'fold_' + name };
}
const root = folder('Бюджет');
const y2026 = folder('2026');
const folders = [root, y2026];
books.oct = monthBook('oct', 'Октябрь 26', 'Октябрь');
makeFile(books.oct, y2026);
books.svc = new Book('svc', 'Бюджет — Служебное', []);

const iter = (arr) => { let i = 0; return { hasNext: () => i < arr.length, next: () => arr[i++] }; };
const DriveApp = {
  getFolderById: () => ({
    getFoldersByName: (n) => iter(folders.filter((f) => f.name === n)),
    getFolders: () => iter(folders.filter((f) => f !== root)),
    createFolder: (n) => { const f = folder(n); f.getFilesByType = () => iter(Object.values(files).filter((x) => x.folder === f)); folders.push(f); return f; },
    getFilesByType: () => iter(Object.values(files).filter((x) => x.folder === root)),
  }),
  getFileById: (id) => { if (!files[id]) throw new Error('нет файла'); return files[id]; },
};
folders.forEach((f) => { f.getFilesByType = () => iter(Object.values(files).filter((x) => x.folder === f)); });

const cacheStore = {};
const ctx = vm.createContext({
  console: { log() {}, error() {} }, Date, Math, JSON, Number, String, Object, Array, isFinite, Error,
  Utilities: {
    formatDate(d, tz, fmt) {
      const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
        .formatToParts(d).map((x) => [x.type, x.value]));
      return fmt.replace('yyyy', p.year).replace('MM', p.month).replace('dd', p.day).replace(/\bd\b/, String(Number(p.day)));
    },
    getUuid: () => 'u' + Math.random().toString(16).slice(2),
  },
  PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => ({ TOKEN: 'secret', SERVICE_ID: 'svc', ROOT_FOLDER_ID: 'root' })[k] || null }) },
  CacheService: { getScriptCache: () => ({
    get: (k) => cacheStore[k] || null, put: (k, v) => { cacheStore[k] = v; },
    remove: (k) => { delete cacheStore[k]; }, removeAll: (ks) => ks.forEach((k) => delete cacheStore[k]),
  }) },
  LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
  SpreadsheetApp: { openById: (id) => books[id], flush() {} },
  DriveApp,
  MimeType: { GOOGLE_SHEETS: 'sheet' },
  Session: { getEffectiveUser: () => ({ getEmail: () => 'me@example.com' }) },
  MailApp: { sendEmail: (...a) => { ctx.__mail = a; } },
  ContentService: { createTextOutput: (s) => ({ setMimeType: () => JSON.parse(s) }), MimeType: { JSON: 'json' } },
});
const src = path.join(__dirname, '..', '..', 'apps-script');
const code = fs.readdirSync(src).filter((f) => f.endsWith('.gs')).sort()
  .map((f) => fs.readFileSync(path.join(src, f), 'utf8')).join('\n;\n')
  + '\n;globalThis.__t = { ensureMonthFile_, readCategories_, today_ };';
vm.runInContext(code, ctx);
const call = (body) => vm.runInContext('doPost', ctx)({ postData: { contents: JSON.stringify({ token: 'secret', ...body }) } });

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); } catch (e) { console.log('  ✗ ' + name + '\n    ' + e.stack); process.exitCode = 1; }
}
const ops = () => books.oct.getSheetByName('Октябрь').cells;
const today = ctx.__t.today_();
const dateStr = (y, m, d) => y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
const octDate = dateStr(2026, 10, 23);

// тест пишет в октябрь 2026: «сегодня» должно быть рядом
ctx.Date = class extends Date {
  constructor(...a) { if (a.length) super(...a); else super('2026-10-23T10:00:00Z'); }
  static now() { return new Date('2026-10-23T10:00:00Z').getTime(); }
};
vm.runInContext('Date = globalThis.Date', ctx);

console.log('API');
test('без токена — отказ', () => {
  const r = vm.runInContext('doPost', ctx)({ postData: { contents: '{"action":"report","token":"bad"}' } });
  assert.strictEqual(r.code, 'unauthorized');
});
test('статьи: без b17, с «Продажа », без «Вклад»', () => {
  const r = call({ action: 'categories' });
  assert.ok(r.ok, JSON.stringify(r));
  assert.deepStrictEqual([...r.expense], ['Рестораны', 'Продукты', 'Одежда и обувь Настя', 'Детская одежда и обувь']);
  assert.deepStrictEqual([...r.income], ['Клиенты психология', 'Продажа ']);
});
test('расход пишется в первую пустую строку блока B:E', () => {
  const r = call({ action: 'add', clientId: 'client_0001', type: 'expense', category: 'Продукты', amount: '1 250', date: octDate });
  assert.ok(r.ok, JSON.stringify(r));
  assert.strictEqual(r.row, 7);
  assert.strictEqual(ops()[6][2], 1250);
  assert.strictEqual(ops()[6][4], 'Продукты');
  assert.ok(ops()[6][1] instanceof Date);
});
test('доход пишется в G:J независимо от расходов', () => {
  const r = call({ action: 'add', clientId: 'client_0002', type: 'income', category: 'Продажа ', amount: 60000, comment: '=HACK()', date: octDate });
  assert.ok(r.ok, JSON.stringify(r));
  assert.strictEqual(r.row, 7);
  assert.strictEqual(ops()[6][8], "'=HACK()");
  assert.strictEqual(ops()[6][9], 'Продажа ');
});
test('повтор того же clientId не дублирует (AC-4)', () => {
  const r = call({ action: 'add', clientId: 'client_0001', type: 'expense', category: 'Продукты', amount: 1250, date: octDate });
  assert.strictEqual(r.duplicate, true);
  assert.strictEqual(ops()[7][2], '');
});
test('неизвестная статья отклоняется', () => {
  const r = call({ action: 'add', clientId: 'client_0003', type: 'expense', category: 'Кафе', amount: 100, date: octDate });
  assert.strictEqual(r.code, 'unknown_category');
});
test('сумма 0 отклоняется', () => {
  assert.strictEqual(call({ action: 'add', clientId: 'client_0004', type: 'expense', category: 'Продукты', amount: 0 }).code, 'bad_amount');
});
test('отмена очищает строку (AC-5)', () => {
  const r = call({ action: 'undo', clientId: 'client_0001' });
  assert.ok(r.undone, JSON.stringify(r));
  assert.deepStrictEqual(ops()[6].slice(1, 5), ['', '', '', '']);
  assert.strictEqual(ops()[6][7], 60000); // доход в той же строке не тронут
});
test('после отмены повтор не возвращает запись', () => {
  const r = call({ action: 'add', clientId: 'client_0001', type: 'expense', category: 'Продукты', amount: 1250, date: octDate });
  assert.strictEqual(r.undone, true);
  assert.strictEqual(ops()[6][2], '');
});

console.log('Новый месяц');
test('ноябрь создаётся копией октября (AC-6)', () => {
  const r = vm.runInContext('ensureMonthFile_(2026, 11)', ctx);
  assert.strictEqual(r.created, true);
  const nov = books[r.id];
  assert.strictEqual(nov.getName(), 'Ноябрь 26');
  assert.ok(nov.getSheetByName('Ноябрь'), 'лист переименован');
  assert.strictEqual(nov.getSheetByName('Октябрь'), null);
  const c = nov.getSheetByName('Ноябрь').cells;
  assert.strictEqual(c[3][1], 'Дата', 'заголовки сохранены');
  assert.ok(c.slice(4).every((row) => row.slice(1, 5).every((v) => v === '') && row.slice(6, 10).every((v) => v === '')), 'операции очищены');
  assert.strictEqual(nov.getSheetByName('Сводка').cells[27][3], 30000, 'план остался черновиком');
  assert.deepStrictEqual(files[r.id].editors, ['wife@example.com'], 'доступ супруге');
  assert.strictEqual(books.oct.getSheetByName('Октябрь').cells[4][2], 5000, 'октябрь не тронут');
});
test('повторный запуск не создаёт второй файл', () => {
  const r = vm.runInContext('ensureMonthFile_(2026, 11)', ctx);
  assert.strictEqual(r.created, false);
  assert.strictEqual(Object.values(files).filter((f) => f.name === 'Ноябрь 26').length, 1);
});
test('январь 2027: папка года создаётся', () => {
  vm.runInContext('ensureMonthFile_(2026, 12)', ctx);
  const r = vm.runInContext('ensureMonthFile_(2027, 1)', ctx);
  assert.strictEqual(r.created, true);
  assert.strictEqual(files[r.id].folder.name, '2027');
  assert.ok(books[r.id].getSheetByName('Январь'));
});

console.log('Отчёт');
test('отчёт за октябрь считает план и факт', () => {
  const r = call({ action: 'report', ym: '2026-10' });
  assert.ok(r.ok, JSON.stringify(r));
  assert.strictEqual(r.expense.plan, 45000);
  assert.strictEqual(r.categories.length, 4);
  assert.ok(r.categories.every((c) => c.lowData === true), 'истории нет — прогноз по плану');
  assert.strictEqual(r.expense.forecastNote, 'уточняется');
});
test('раскрытая статья: дата из строки выше', () => {
  const r = call({ action: 'category', ym: '2026-10', name: 'Детская одежда и обувь' });
  assert.ok(r.ok, JSON.stringify(r));
  assert.strictEqual(r.ops[0].date, '04.10');
  assert.strictEqual(r.ops[0].amount, 1800);
});

console.log('\n' + passed + ' проверок пройдено' + (process.exitCode ? ', есть ошибки' : ''));
