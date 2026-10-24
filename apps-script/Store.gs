/**
 * Служебная таблица «Бюджет — Служебное»: кэш файлов, история, справочник,
 * журнал операций из приложения и технический лог.
 */

const SHEETS = {
  files: 'Кэш_файлов',
  history: 'История',
  map: 'Справочник_категорий',
  ops: 'Операции',
  log: 'Журнал',
};

const HEADERS = {
  files: ['Месяц', 'ID файла', 'Имя файла'],
  history: ['Месяц', 'Тип', 'Статья', 'План', 'Факт', 'Обновлено'],
  map: ['Статья', 'Группа', 'Источник'],
  ops: ['clientId', 'Записано', 'Месяц', 'Тип', 'Статья', 'Сумма', 'Дата операции', 'ID файла', 'Строка', 'Статус'],
  log: ['Время', 'Уровень', 'Действие', 'Сообщение'],
};

// колонки, которые хранятся как текст (иначе «2026-10» станет датой)
const TEXT_COLS = {
  files: [1, 2, 3],
  history: [1, 2, 3],
  map: [1, 2, 3],
  ops: [1, 3, 4, 5, 8, 10],
  log: [],
};

let serviceCache_ = null;

function service_() {
  if (serviceCache_) return serviceCache_;
  const id = prop_('SERVICE_ID');
  if (!id) throw new Error('Не выполнен setup(): нет служебной таблицы');
  serviceCache_ = SpreadsheetApp.openById(id);
  return serviceCache_;
}

function sheet_(key) {
  const ss = service_();
  let sh = ss.getSheetByName(SHEETS[key]);
  if (!sh) {
    sh = ss.insertSheet(SHEETS[key]);
    sh.getRange(1, 1, 1, HEADERS[key].length).setValues([HEADERS[key]]).setFontWeight('bold');
    sh.setFrozenRows(1);
    TEXT_COLS[key].forEach(function (c) {
      sh.getRange(1, c, sh.getMaxRows(), 1).setNumberFormat('@');
    });
  }
  return sh;
}

function readTable_(key) {
  const sh = sheet_(key);
  const n = sh.getLastRow() - 1;
  if (n < 1) return [];
  return sh.getRange(2, 1, n, HEADERS[key].length).getValues();
}

/** Дописать строки одним вызовом. */
function appendRows_(key, rows) {
  if (!rows.length) return;
  const sh = sheet_(key);
  const start = sh.getLastRow() + 1;
  const need = start + rows.length - 1 - sh.getMaxRows();
  if (need > 0) sh.insertRowsAfter(sh.getMaxRows(), need + 100);
  TEXT_COLS[key].forEach(function (c) {
    sh.getRange(start, c, rows.length, 1).setNumberFormat('@');
  });
  sh.getRange(start, 1, rows.length, HEADERS[key].length).setValues(rows);
}

/** Переписать таблицу целиком (для небольших листов: история, справочник). */
function rewriteTable_(key, rows) {
  const sh = sheet_(key);
  const n = sh.getLastRow() - 1;
  if (n > 0) sh.getRange(2, 1, n, HEADERS[key].length).clearContent();
  appendRows_(key, rows);
}

function logEvent_(level, action, message) {
  try {
    appendRows_('log', [[new Date(), level, action || '', String(message).slice(0, 2000)]]);
  } catch (e) {
    console.error('log failed', e, message);
  }
}

function trimLog_() {
  const sh = sheet_('log');
  const extra = sh.getLastRow() - 1 - CFG.LOG_KEEP_ROWS;
  if (extra > 0) sh.deleteRows(2, extra);
}

function notifyOwner_(subject, body) {
  try {
    const to = prop_('OWNER_EMAIL') || Session.getEffectiveUser().getEmail();
    if (to) MailApp.sendEmail(to, '[Бюджет] ' + subject, body);
  } catch (e) {
    console.error('mail failed', e);
  }
}

/* ---------- журнал операций приложения ---------- */

function opFromRow_(r, sheetRow) {
  return {
    sheetRow: sheetRow,
    clientId: String(r[0]),
    recordedAt: r[1] instanceof Date ? r[1] : new Date(r[1]),
    ym: toYm_(r[2]),
    type: String(r[3]),
    category: String(r[4]),
    amount: Number(r[5]),
    date: r[6] instanceof Date ? r[6] : new Date(r[6]),
    fileId: String(r[7]),
    row: Number(r[8]),
    status: String(r[9]),
  };
}

function findOp_(clientId) {
  const sh = sheet_('ops');
  if (sh.getLastRow() < 2) return null;
  const cell = sh.getRange(2, 1, sh.getLastRow() - 1, 1)
    .createTextFinder(clientId).matchEntireCell(true).matchCase(true).findNext();
  if (!cell) return null;
  const r = cell.getRow();
  return opFromRow_(sh.getRange(r, 1, 1, HEADERS.ops.length).getValues()[0], r);
}

function readOps_() {
  return readTable_('ops').map(function (r, i) { return opFromRow_(r, i + 2); });
}

/* ---------- кэш ---------- */

function invalidateCaches_(ym) {
  CacheService.getScriptCache().removeAll(['report:' + ym, 'cats:' + ym, 'frequent']);
}
