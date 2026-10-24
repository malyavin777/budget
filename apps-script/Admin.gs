/**
 * Функции, которые запускаются вручную из редактора (кнопка «Выполнить»),
 * и ежедневная задача.
 */

/** 1. Первый запуск: код доступа, служебная таблица, ежедневный триггер. */
function setup() {
  if (!prop_('ROOT_FOLDER_ID')) {
    const id = findRootFolder_();
    if (!id) return;
    setProp_('ROOT_FOLDER_ID', id);
  }
  if (!prop_('TOKEN')) setProp_('TOKEN', newToken_());

  if (!prop_('SERVICE_ID')) {
    const ss = SpreadsheetApp.create(CFG.SERVICE_NAME);
    DriveApp.getFileById(ss.getId()).moveTo(rootFolder_());
    setProp_('SERVICE_ID', ss.getId());
    serviceCache_ = ss;
    Object.keys(SHEETS).forEach(sheet_);
    ss.getSheets().forEach(function (sh) {
      if (Object.keys(SHEETS).map(function (k) { return SHEETS[k]; }).indexOf(sh.getName()) < 0) ss.deleteSheet(sh);
    });
  }

  installTriggers();
  const t = today_();
  const id = findMonthFileId_(t.y, t.m);
  console.log('Служебная таблица: ' + service_().getUrl());
  console.log('Файл текущего месяца: ' + (id ? DriveApp.getFileById(id).getName() : 'не найден — будет создан ночью'));
  console.log('Код доступа (сохраните, он нужен телефонам):\n' + prop_('TOKEN'));
}

/** Ищет вашу папку «Бюджет» (владелец — вы, внутри есть папки годов). */
function findRootFolder_() {
  const me = Session.getEffectiveUser().getEmail();
  const found = [];
  const it = DriveApp.getFoldersByName(CFG.ROOT_FOLDER_NAME);
  while (it.hasNext()) {
    const f = it.next();
    if (f.isTrashed() || f.getOwner().getEmail() !== me) continue;
    const sub = f.getFolders();
    let years = 0;
    while (sub.hasNext()) if (/^\d{4}$/.test(sub.next().getName().trim())) years++;
    if (years) found.push(f);
  }
  if (found.length === 1) {
    console.log('Папка «' + CFG.ROOT_FOLDER_NAME + '» найдена: ' + found[0].getUrl());
    return found[0].getId();
  }
  console.log(found.length
    ? 'Нашлось несколько папок «' + CFG.ROOT_FOLDER_NAME + '» с папками годов.'
    : 'Папка «' + CFG.ROOT_FOLDER_NAME + '» с папками годов не найдена.');
  console.log('Укажите её вручную: ⚙️ Настройки проекта → Свойства скрипта → ROOT_FOLDER_ID = ID папки ' +
    '(часть адреса после /folders/). Затем снова запустите setup.');
  return null;
}

function installTriggers() {
  deleteTriggersFor_('dailyJob');
  ScriptApp.newTrigger('dailyJob').timeBased().everyDays(1).atHour(0).nearMinute(10).inTimezone(CFG.TZ).create();
}

/** Ежедневно ~00:10: создать файл месяца; до 10-го числа обновить итоги прошлого месяца. */
function dailyJob() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return;
  try {
    const t = today_();
    const r = ensureMonthFile_(t.y, t.m);
    if (r.created) invalidateCaches_(ymOf_(t.y, t.m));
    if (t.d <= CFG.RECLOSE_UNTIL_DAY) {
      const p = addMonths_(t.y, t.m, -1);
      const id = findMonthFileId_(p.y, p.m);
      if (id) {
        snapshotMonth_(p.y, p.m, id);
        seedCategoryMap_();
      }
    }
    trimLog_();
  } catch (e) {
    logEvent_('error', 'dailyJob', (e && e.stack) || String(e));
    notifyOwner_('Ошибка ежедневной задачи', (e && e.stack) || String(e));
  } finally {
    lock.releaseLock();
  }
}

/** Новый код доступа. Потом введите его заново на обоих телефонах. */
function rotateToken() {
  setProp_('TOKEN', newToken_());
  console.log('Новый код доступа:\n' + prop_('TOKEN'));
}

function showToken() {
  console.log(prop_('TOKEN') || 'Код не задан — запустите setup()');
}

function newToken_() {
  return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
}

/** Проверка без записи: статьи и отчёт за текущий месяц в журнал выполнения. */
function testReadOnly() {
  const t = today_();
  const f = fileForRead_(t.y, t.m);
  const cats = readCategories_(SpreadsheetApp.openById(f.id));
  console.log('Файл: ' + DriveApp.getFileById(f.id).getName());
  console.log('Статей расхода: ' + cats.expense.length + ', дохода: ' + cats.income.length);
  CacheService.getScriptCache().remove('report:' + ymOf_(t.y, t.m));
  const r = apiReport_({});
  console.log('Расходы: план ' + r.expense.plan + ', факт ' + r.expense.fact + ', прогноз ' + r.expense.forecast);
  console.log('Доход: план ' + r.income.plan + ', факт ' + r.income.fact);
  r.categories.slice(0, 8).forEach(function (c) {
    console.log([c.status, c.name, 'план ' + c.plan, 'факт ' + c.fact, 'прогноз ' + c.forecast, c.basis].join(' · '));
  });
}

/**
 * Проверка записи и отмены на ТЕКУЩЕМ месяце: добавит доход 1 ₽ в первую статью дохода
 * и сразу отменит. В таблице ничего не останется.
 */
function testAddAndUndo() {
  const t = today_();
  const f = fileForRead_(t.y, t.m);
  const cats = readCategories_(SpreadsheetApp.openById(f.id));
  const clientId = 'test_' + Date.now();
  const add = apiAdd_({ clientId: clientId, type: 'income', category: cats.income[0], amount: 1, comment: 'проверка' });
  console.log('Запись: ' + JSON.stringify(add));
  const again = apiAdd_({ clientId: clientId, type: 'income', category: cats.income[0], amount: 1 });
  console.log('Повтор (должен быть duplicate): ' + JSON.stringify(again));
  const undo = apiUndo_({ clientId: clientId });
  console.log('Отмена: ' + JSON.stringify(undo));
}
