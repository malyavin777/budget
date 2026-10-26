/**
 * Бюджет API — настройки и общие помощники.
 *
 * Все адреса ячеек взяты из ваших файлов (шаблон Google «Бюджет на месяц»):
 *   лист операций <Месяц>: заголовки в 4-й строке, данные с 5-й,
 *     расходы B:E (Дата, Сумма, Описание, Категория), доходы G:J;
 *   лист «Сводка»: статьи с 27-й строки,
 *     расходы B (статья), D (план), E (факт); доходы H, J, K до 48-й строки.
 */

const CFG = {
  // Папка «Бюджет». ID не хранится в коде (репозиторий публичный):
  // setup() находит её по имени и запоминает в свойстве ROOT_FOLDER_ID.
  ROOT_FOLDER_NAME: 'Бюджет',
  TZ: 'Asia/Yekaterinburg',
  SERVICE_NAME: 'Бюджет — Служебное',
  MONTHS: ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
    'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'],

  SUMMARY_SHEET: 'Сводка',
  OPS_HEADER_ROW: 4,
  OPS_FIRST_ROW: 5,
  EXPENSE_COLS: { date: 2, amount: 3, comment: 4, category: 5 }, // B..E
  INCOME_COLS: { date: 7, amount: 8, comment: 9, category: 10 }, // G..J

  SUMMARY_FIRST_ROW: 27,
  SUMMARY_TOTAL_ROW: 26,
  // индексы колонок внутри строки, прочитанной с колонки A (A = 0)
  SUM_IDX: { expName: 1, expPlan: 3, expFact: 4, incName: 7, incPlan: 9, incFact: 10 },
  INCOME_LAST_ROW: 48, // с 49-й строки — блок «Инвестиции» (в старых файлах он выше)
  INVEST_HEADER: 'Инвестиции', // доходы заканчиваются на этом заголовке

  MAX_AMOUNT: 10000000,
  MAX_COMMENT: 200,
  WRITE_RATE_PER_MIN: 30,
  REPORT_CACHE_SEC: 300,
  CATEGORIES_CACHE_SEC: 600,
  UNDO_WINDOW_MIN: 10,
  FREQUENT_DAYS: 60,
  FREQUENT_COUNT: 4,
  DATE_BACK_DAYS: 45, // насколько назад можно внести операцию
  RECLOSE_UNTIL_DAY: 10, // до 10-го числа итоги прошлого месяца пересчитываются (траты дописывают позже)
  LOG_KEEP_ROWS: 2000,
  PLACEHOLDER_RE: /^b\d+$/i, // заглушки вида «b17»
};

function prop_(key) {
  return PropertiesService.getScriptProperties().getProperty(key);
}

function setProp_(key, value) {
  PropertiesService.getScriptProperties().setProperty(key, value);
}

function rootFolderId_() {
  const id = prop_('ROOT_FOLDER_ID');
  if (!id) throw new Error('Не выполнен setup(): неизвестна папка «Бюджет»');
  return id;
}

/* ---------- даты и месяцы ---------- */

function ymOf_(y, m) {
  return y + '-' + (m < 10 ? '0' : '') + m;
}

function parseYm_(s) {
  const mt = /^(\d{4})-(\d{2})$/.exec(String(s || ''));
  if (!mt) return null;
  const y = Number(mt[1]);
  const m = Number(mt[2]);
  if (m < 1 || m > 12) return null;
  return { y: y, m: m };
}

/** Значение ячейки «месяц» в виде ГГГГ-ММ, даже если таблица превратила его в дату. */
function toYm_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, CFG.TZ, 'yyyy-MM');
  return String(v || '').trim();
}

function today_() {
  const parts = Utilities.formatDate(new Date(), CFG.TZ, 'yyyy-MM-dd').split('-').map(Number);
  return { y: parts[0], m: parts[1], d: parts[2] };
}

function addMonths_(y, m, delta) {
  const t = y * 12 + (m - 1) + delta;
  return { y: Math.floor(t / 12), m: (t % 12 + 12) % 12 + 1 };
}

function daysInMonth_(y, m) {
  return new Date(y, m, 0).getDate();
}

function dayIndex_(y, m, d) {
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
}

/* ---------- имена файлов ---------- */

/** «Октябрь 26», « Март 25», «Апрель 2026» → {y, m}. Иное → null. */
function parseMonthFileName_(name) {
  const s = String(name || '').replace(/\s+/g, ' ').trim();
  const mt = /^([А-Яа-яЁё]+) (\d{2}|\d{4})$/.exec(s);
  if (!mt) return null;
  const word = mt[1].toLowerCase();
  const idx = CFG.MONTHS.findIndex(function (x) { return x.toLowerCase() === word; });
  if (idx < 0) return null;
  let y = Number(mt[2]);
  if (y < 100) y += 2000;
  return { y: y, m: idx + 1 };
}

function monthFileName_(y, m) {
  return CFG.MONTHS[m - 1] + ' ' + String(y % 100).padStart(2, '0');
}

/* ---------- значения ---------- */

function num_(v) {
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  if (v === null || v === undefined || v === '') return 0;
  const s = String(v).replace(/[\s ₽]/g, '').replace(',', '.').replace(/[^\d.\-]/g, '');
  const n = Number(s);
  return isFinite(n) ? n : 0;
}

/** Сумма из клиента: число или строка «1 250,50». Возвращает число с 2 знаками или NaN. */
function parseAmount_(v) {
  let n;
  if (typeof v === 'number') n = v;
  else {
    const s = String(v || '').replace(/[\s ₽]/g, '').replace(',', '.');
    if (!/^\d+(\.\d{1,2})?$/.test(s)) return NaN;
    n = Number(s);
  }
  if (!isFinite(n)) return NaN;
  return Math.round(n * 100) / 100;
}

/** Текст не должен стать формулой. */
function sanitizeText_(s, maxLen) {
  let t = String(s || '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, maxLen || CFG.MAX_COMMENT);
  if (/^[=+\-@]/.test(t)) t = "'" + t;
  return t;
}

function isCategoryName_(raw) {
  const s = String(raw || '').trim();
  return s !== '' && s !== 'Итого' && !CFG.PLACEHOLDER_RE.test(s);
}

function clamp_(x, lo, hi) {
  return Math.min(hi, Math.max(lo, x));
}

/** Ошибка, которую можно показать клиенту. */
function fail_(code, message) {
  const e = new Error(message || code);
  e.userCode = code;
  return e;
}
