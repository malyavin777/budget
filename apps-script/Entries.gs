/**
 * Статьи, запись операции, отмена, частые статьи.
 */

/** Статьи из «Сводки»: расходы B27:B (до конца), доходы H27:H48. Имена — как в ячейках. */
function readCategories_(ss) {
  const sh = ss.getSheetByName(CFG.SUMMARY_SHEET);
  if (!sh) throw structureError_(ss, 'нет листа «Сводка»');
  const first = CFG.SUMMARY_FIRST_ROW;
  const n = Math.max(0, sh.getLastRow() - first + 1);
  const pick = function (values) {
    const seen = {};
    return values.map(function (r) { return String(r[0]); })
      .filter(function (s) {
        const k = s.trim();
        if (!isCategoryName_(k) || seen[k]) return false;
        seen[k] = true;
        return true;
      });
  };
  const expense = n ? pick(sh.getRange(first, 2, n, 1).getValues()) : [];
  const incN = CFG.INCOME_LAST_ROW - first + 1;
  const income = pick(sh.getRange(first, 8, incN, 1).getValues());
  return { expense: expense, income: income };
}

/** Файл для чтения статей: текущий месяц, а если его ещё нет — ближайший прошлый. */
function fileForRead_(y, m) {
  for (let k = 0; k <= 3; k++) {
    const p = addMonths_(y, m, -k);
    const id = findMonthFileId_(p.y, p.m);
    if (id) return { id: id, y: p.y, m: p.m };
  }
  throw fail_('no_month_file', 'Файл месяца не найден');
}

function apiCategories_(req) {
  const t = today_();
  const ym = req.ym ? parseYm_(req.ym) : { y: t.y, m: t.m };
  if (!ym) throw fail_('bad_ym');
  const key = 'cats:' + ymOf_(ym.y, ym.m);
  const cache = CacheService.getScriptCache();
  const hit = cache.get(key);
  let cats;
  if (hit) cats = JSON.parse(hit);
  else {
    const f = fileForRead_(ym.y, ym.m);
    cats = readCategories_(SpreadsheetApp.openById(f.id));
    cache.put(key, JSON.stringify(cats), CFG.CATEGORIES_CACHE_SEC);
  }
  return { ok: true, ym: ymOf_(ym.y, ym.m), expense: cats.expense, income: cats.income, frequent: frequent_() };
}

/** Частые статьи за 60 дней по журналу «Операции». */
function frequent_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('frequent');
  if (hit) return JSON.parse(hit);
  const since = Date.now() - CFG.FREQUENT_DAYS * 86400000;
  const counts = { expense: {}, income: {} };
  readOps_().forEach(function (op) {
    if (op.status !== 'ok' || !(op.recordedAt.getTime() >= since) || !counts[op.type]) return;
    counts[op.type][op.category] = (counts[op.type][op.category] || 0) + 1;
  });
  const top = function (obj) {
    return Object.keys(obj).sort(function (a, b) { return obj[b] - obj[a]; }).slice(0, CFG.FREQUENT_COUNT);
  };
  const out = { expense: top(counts.expense), income: top(counts.income) };
  cache.put('frequent', JSON.stringify(out), 3600);
  return out;
}

/** Дата операции 'ГГГГ-ММ-ДД' (по умолчанию сегодня), не старше 45 дней и не из будущего. */
function parseOpDate_(s, today) {
  if (!s) return { y: today.y, m: today.m, d: today.d };
  const mt = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s));
  if (!mt) throw fail_('bad_date', 'Неверная дата');
  const y = Number(mt[1]), m = Number(mt[2]), d = Number(mt[3]);
  if (m < 1 || m > 12 || d < 1 || d > daysInMonth_(y, m)) throw fail_('bad_date', 'Неверная дата');
  const diff = dayIndex_(today.y, today.m, today.d) - dayIndex_(y, m, d);
  if (diff < -1 || diff > CFG.DATE_BACK_DAYS) throw fail_('bad_date', 'Дата слишком далеко от сегодняшней');
  return { y: y, m: m, d: d };
}

/** Первая строка с 5-й, где все 4 ячейки блока пусты. */
function firstEmptyRow_(sh, firstCol) {
  const first = CFG.OPS_FIRST_ROW;
  const max = sh.getMaxRows();
  const n = max - first + 1;
  if (n > 0) {
    const vals = sh.getRange(first, firstCol, n, 4).getValues();
    for (let i = 0; i < vals.length; i++) {
      if (vals[i].every(function (v) { return v === '' || v === null; })) return first + i;
    }
  }
  sh.insertRowsAfter(max, 50);
  return max + 1;
}

function checkWriteRate_() {
  const c = CacheService.getScriptCache();
  const key = 'rate:' + Math.floor(Date.now() / 60000);
  const n = Number(c.get(key) || 0) + 1;
  c.put(key, String(n), 120);
  if (n > CFG.WRITE_RATE_PER_MIN) {
    logEvent_('warn', 'rate', 'Превышен лимит записей в минуту');
    throw fail_('rate_limited', 'Слишком много запросов, попробуйте через минуту');
  }
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw fail_('busy', 'Таблица занята, повторите');
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function apiAdd_(req) {
  checkWriteRate_();
  const clientId = String(req.clientId || '');
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(clientId)) throw fail_('bad_client_id');
  const type = req.type;
  if (type !== 'expense' && type !== 'income') throw fail_('bad_type');
  const amount = parseAmount_(req.amount);
  if (!(amount > 0 && amount <= CFG.MAX_AMOUNT)) throw fail_('bad_amount', 'Неверная сумма');
  const date = parseOpDate_(req.date, today_());
  const comment = sanitizeText_(req.comment, CFG.MAX_COMMENT);
  const category = String(req.category || '');
  const ym = ymOf_(date.y, date.m);

  return withLock_(function () {
    const prev = findOp_(clientId);
    if (prev) return { ok: true, duplicate: prev.status === 'ok', undone: prev.status !== 'ok', ym: prev.ym, row: prev.row };

    const file = ensureMonthFile_(date.y, date.m);
    const ss = SpreadsheetApp.openById(file.id);
    const cats = readCategories_(ss);
    const list = type === 'expense' ? cats.expense : cats.income;
    if (list.indexOf(category) < 0) {
      invalidateCaches_(ym);
      throw fail_('unknown_category', 'Статья не найдена, список обновлён — выберите заново');
    }

    const sh = opsSheetFor_(ss, date.m);
    const cols = type === 'expense' ? CFG.EXPENSE_COLS : CFG.INCOME_COLS;
    const row = firstEmptyRow_(sh, cols.date);
    const dt = new Date(date.y, date.m - 1, date.d, 12, 0, 0);
    sh.getRange(row, cols.date, 1, 4).setValues([[dt, amount, comment, category]]);
    sh.getRange(row, cols.date).setNumberFormat('dd.MM.yyyy');
    SpreadsheetApp.flush();

    appendRows_('ops', [[clientId, new Date(), ym, type, category, amount, dt, file.id, row, 'ok']]);
    invalidateCaches_(ym);
    return { ok: true, ym: ym, row: row, file: ss.getName(), createdMonth: file.created };
  });
}

function apiUndo_(req) {
  checkWriteRate_();
  const clientId = String(req.clientId || '');
  return withLock_(function () {
    const op = findOp_(clientId);
    if (!op) throw fail_('not_found', 'Запись не найдена');
    if (op.status !== 'ok') return { ok: true, already: true };
    if (Date.now() - op.recordedAt.getTime() > CFG.UNDO_WINDOW_MIN * 60000) throw fail_('undo_expired', 'Отменить уже нельзя — исправьте в таблице');

    const ss = SpreadsheetApp.openById(op.fileId);
    const ym = parseYm_(op.ym);
    const sh = opsSheetFor_(ss, ym.m);
    const cols = op.type === 'expense' ? CFG.EXPENSE_COLS : CFG.INCOME_COLS;
    const range = sh.getRange(op.row, cols.date, 1, 4);
    const v = range.getValues()[0];
    if (Math.abs(num_(v[1]) - op.amount) > 0.001 || String(v[3]) !== op.category) {
      throw fail_('row_changed', 'Строку уже изменили в таблице — исправьте вручную');
    }
    range.clearContent();
    sheet_('ops').getRange(op.sheetRow, 10).setValue('undone');
    invalidateCaches_(op.ym);
    return { ok: true, undone: true };
  });
}
