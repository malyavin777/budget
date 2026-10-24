/**
 * Поиск и автосоздание файлов месяцев.
 * Папки годов: «2025», «2026»… Файлы: «Октябрь 26». Лист операций: «Октябрь».
 */

function rootFolder_() {
  return DriveApp.getFolderById(rootFolderId_());
}

function yearFolder_(y, create) {
  const root = rootFolder_();
  const it = root.getFoldersByName(String(y));
  if (it.hasNext()) return it.next();
  return create ? root.createFolder(String(y)) : null;
}

function fileAlive_(id) {
  try {
    return !DriveApp.getFileById(id).isTrashed();
  } catch (e) {
    return false;
  }
}

function rememberFile_(ym, file) {
  CacheService.getScriptCache().put('file:' + ym, file.getId(), 21600);
  const rows = readTable_('files').filter(function (r) { return toYm_(r[0]) !== ym; });
  rows.push([ym, file.getId(), file.getName()]);
  rewriteTable_('files', rows);
}

/** ID файла месяца или null. Порядок: кэш → лист «Кэш_файлов» → просмотр папок. */
function findMonthFileId_(y, m) {
  const ym = ymOf_(y, m);
  const cache = CacheService.getScriptCache();
  const cached = cache.get('file:' + ym);
  if (cached && fileAlive_(cached)) return cached;

  const known = readTable_('files').filter(function (r) { return toYm_(r[0]) === ym; });
  for (let i = 0; i < known.length; i++) {
    const id = String(known[i][1]);
    if (id && fileAlive_(id)) {
      cache.put('file:' + ym, id, 21600);
      return id;
    }
  }

  const found = scanMonthFiles_().filter(function (f) { return f.y === y && f.m === m; });
  if (!found.length) return null;
  const file = DriveApp.getFileById(found[0].id);
  rememberFile_(ym, file);
  return file.getId();
}

/** Все файлы месяцев: папки-годы + корень. Дубликаты одного месяца — самый свежий первым. */
function scanMonthFiles_() {
  const root = rootFolder_();
  const folders = [root];
  const sub = root.getFolders();
  while (sub.hasNext()) {
    const f = sub.next();
    if (/^\d{4}$/.test(f.getName().trim())) folders.push(f);
  }
  const out = [];
  folders.forEach(function (folder) {
    const files = folder.getFilesByType(MimeType.GOOGLE_SHEETS);
    while (files.hasNext()) {
      const file = files.next();
      const p = parseMonthFileName_(file.getName());
      if (p) out.push({ y: p.y, m: p.m, id: file.getId(), name: file.getName(), updated: file.getLastUpdated().getTime() });
    }
  });
  out.sort(function (a, b) { return (a.y - b.y) || (a.m - b.m) || (b.updated - a.updated); });
  return out;
}

/** Лист операций: по имени месяца, иначе первый лист с месячным названием. */
function opsSheetFor_(ss, m) {
  let sh = m ? ss.getSheetByName(CFG.MONTHS[m - 1]) : null;
  if (!sh) {
    sh = ss.getSheets().filter(function (s) {
      return CFG.MONTHS.indexOf(s.getName().trim()) >= 0;
    })[0] || null;
  }
  if (!sh) throw structureError_(ss, 'нет листа операций с названием месяца');
  const head = sh.getRange(CFG.OPS_HEADER_ROW, 1, 1, 10).getValues()[0];
  const okExp = String(head[CFG.EXPENSE_COLS.date - 1]).trim() === 'Дата' && String(head[CFG.EXPENSE_COLS.amount - 1]).trim() === 'Сумма';
  const okInc = String(head[CFG.INCOME_COLS.date - 1]).trim() === 'Дата' && String(head[CFG.INCOME_COLS.amount - 1]).trim() === 'Сумма';
  if (!okExp || !okInc) throw structureError_(ss, 'в 4-й строке листа «' + sh.getName() + '» нет заголовков «Дата / Сумма» в B:C и G:H');
  return sh;
}

function structureError_(ss, what) {
  const msg = 'Файл «' + ss.getName() + '»: ' + what + '.';
  logEvent_('error', 'structure', msg);
  notifyOwner_('Структура таблицы изменилась', msg + '\n' + ss.getUrl());
  return fail_('structure_changed', 'Структура таблицы изменилась, нужна настройка');
}

/**
 * Файл месяца есть → вернуть. Нет → скопировать ближайший прошлый (до 3 месяцев назад),
 * переименовать файл и лист операций, очистить операции, план оставить черновиком.
 * Вызывать под LockService.getScriptLock().
 */
function ensureMonthFile_(y, m) {
  const existing = findMonthFileId_(y, m);
  if (existing) return { id: existing, created: false };

  let prev = null;
  for (let k = 1; k <= 3 && !prev; k++) {
    const p = addMonths_(y, m, -k);
    const id = findMonthFileId_(p.y, p.m);
    if (id) prev = { id: id, y: p.y, m: p.m };
  }
  if (!prev) {
    notifyOwner_('Не удалось создать файл месяца', 'Нет файлов ни за один из трёх месяцев до ' + monthFileName_(y, m));
    throw fail_('no_previous_month', 'Не удалось создать файл месяца, владелец получил уведомление');
  }

  const src = DriveApp.getFileById(prev.id);
  const copy = src.makeCopy(monthFileName_(y, m), yearFolder_(y, true));
  shareLikeSource_(src, copy);

  const ss = SpreadsheetApp.openById(copy.getId());
  const ops = opsSheetFor_(ss, prev.m);
  ops.setName(CFG.MONTHS[m - 1]); // формулы «Сводки» обновятся сами
  const n = ops.getMaxRows() - CFG.OPS_FIRST_ROW + 1;
  if (n > 0) {
    ops.getRange(CFG.OPS_FIRST_ROW, CFG.EXPENSE_COLS.date, n, 4).clearContent();
    ops.getRange(CFG.OPS_FIRST_ROW, CFG.INCOME_COLS.date, n, 4).clearContent();
  }
  SpreadsheetApp.flush();

  rememberFile_(ymOf_(y, m), copy);
  logEvent_('info', 'create_month', 'Создан «' + copy.getName() + '» из «' + src.getName() + '»');
  return { id: copy.getId(), created: true };
}

/** Новый файл доступен тем же людям, что и прошлый (FR-M6). */
function shareLikeSource_(src, copy) {
  try {
    const me = Session.getEffectiveUser().getEmail();
    const emails = src.getEditors().map(function (u) { return u.getEmail(); });
    const owner = src.getOwner();
    if (owner) emails.push(owner.getEmail());
    const uniq = emails.filter(function (e, i) { return e && e !== me && emails.indexOf(e) === i; });
    if (uniq.length) copy.addEditors(uniq);
  } catch (e) {
    logEvent_('warn', 'share', String(e));
  }
}
