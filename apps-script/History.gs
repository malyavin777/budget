/**
 * История месячных итогов и справочник групп статей.
 */

/** Стартовая разметка статей по группам. Ключи — без учёта регистра и лишних пробелов. */
const DEFAULT_GROUPS = {
  'Еда': ['Продукты', 'Питание', 'Рестораны', 'Кофейня', 'Озон еда'],
  'Дом и жильё': ['Дом', 'Ипотека', 'Коммунальные услуги', 'Коммунальные услуги Ласковая', 'Коммунальные услуги Захаренко',
    'Захаренко 7', 'Товары для дома', 'Товары для дома (постельное, вазы, посуда)', 'Хоз. товары (порошки, пасты, губки, тряпки)',
    'Связь', 'Связь (интернет, мобильная связь)', 'Подписки', 'Страхование'],
  'Транспорт': ['Транспорт', 'Бензин + общественный транспорт', 'Такси', 'Обслуживание машины', 'Обслуживание велосипедов'],
  'Дети': ['Детский сад', 'Няня', 'Детская одежда', 'Детская одежда и обувь', 'Развивашки, игровая Лео'],
  'Здоровье и забота': ['Здоровье/медицина', 'Здоровье (Прием врача, диагностика, анализы)', 'Лекарства и БАДы', 'Спорт',
    'Тренировки бег', 'Баня + массаж', 'Бьюти', 'Бьюти (товары для красоты, стрижка и т.д.)', 'Психотерапия'],
  'Одежда': ['Одежда', 'Одежда и обувь', 'Одежда и обувь Настя', 'Одежда и обувь Саша'],
  'Работа и учёба': ['Рабочие расходы', 'Раб.расходы Настя', 'Рабочие расходы Саша', 'Супервизия', 'Интервизия',
    'Аренда кабинета Настя', 'Образование', 'Образование Настя и Саша', 'Английский', 'Налог'],
  'Досуг': ['Развлечения', 'Развлечения (кино, театр, концерты, аттракционы)', 'Хобби/творчество',
    'Хобби/творчество (картины по номерам, краски, мастер-классы, арт-галерея, книги)',
    'Путешествия', 'Путешествия (отели, билеты)', 'Подарки'],
  'Личное': ['Личные расходы', 'Личные расходы Саша', 'Личные расходы Настя'],
};

function normName_(s) {
  return String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function defaultGroupOf_(name) {
  const n = normName_(name);
  const groups = Object.keys(DEFAULT_GROUPS);
  for (let i = 0; i < groups.length; i++) {
    if (DEFAULT_GROUPS[groups[i]].some(function (x) { return normName_(x) === n; })) return groups[i];
  }
  return '';
}

/** {статья: группа}, только размеченные строки. */
function readMap_() {
  const out = {};
  readTable_('map').forEach(function (r) {
    const name = String(r[0]).trim();
    const g = String(r[1]).trim();
    if (name && g) out[name] = g;
  });
  return out;
}

/** Записать итоги месяца из «Сводки» в «Историю» (старые строки этого месяца заменяются). */
function snapshotMonth_(y, m, fileId) {
  const ym = ymOf_(y, m);
  const s = readSummary_(SpreadsheetApp.openById(fileId));
  const now = new Date();
  const fresh = []
    .concat(s.expense.map(function (c) { return [ym, 'expense', c.name.trim(), c.plan, c.fact, now]; }))
    .concat(s.income.map(function (c) { return [ym, 'income', c.name.trim(), c.plan, c.fact, now]; }));
  const keep = readTable_('history').filter(function (r) { return toYm_(r[0]) !== ym; })
    .map(function (r) { return [toYm_(r[0]), r[1], r[2], r[3], r[4], r[5]]; });
  rewriteTable_('history', keep.concat(fresh));
}

/**
 * ЗАПУСТИТЬ ВРУЧНУЮ один раз после setup(): переносит итоги всех прошлых месяцев.
 * Если не уложится в лимит времени — сам продолжит через минуту.
 */
function migrateHistory() {
  const started = Date.now();
  const t = today_();
  const cur = ymOf_(t.y, t.m);
  const done = {};
  readTable_('history').forEach(function (r) { done[toYm_(r[0])] = true; });

  const seen = {};
  const files = scanMonthFiles_().filter(function (f) {
    const ym = ymOf_(f.y, f.m);
    if (seen[ym]) {
      logEvent_('warn', 'migrate', 'Два файла за ' + ym + ', взят более свежий: ' + seen[ym]);
      return false;
    }
    seen[ym] = f.name;
    return ym < cur;
  });

  let count = 0;
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const ym = ymOf_(f.y, f.m);
    if (done[ym]) continue;
    rememberFile_(ym, DriveApp.getFileById(f.id));
    snapshotMonth_(f.y, f.m, f.id);
    count++;
    if (Date.now() - started > 4.5 * 60 * 1000) {
      scheduleOnce_('migrateHistory', 60);
      console.log('Перенесено ' + count + ', продолжу через минуту');
      return;
    }
  }
  deleteTriggersFor_('migrateHistory');
  const unmapped = seedCategoryMap_();
  logEvent_('info', 'migrate', 'Перенесено месяцев: ' + count + '; без группы: ' + unmapped.length);
  console.log('Готово. Перенесено месяцев: ' + count);
  if (unmapped.length) console.log('Статьи без группы (впишите в «Справочник_категорий»):\n' + unmapped.join('\n'));
}

/** Дополнить справочник статьями из истории; вернуть список без группы. */
function seedCategoryMap_() {
  const rows = readTable_('map').map(function (r) { return [String(r[0]).trim(), String(r[1]).trim(), String(r[2])]; });
  const known = {};
  rows.forEach(function (r) { known[normName_(r[0])] = true; });
  readTable_('history').forEach(function (r) {
    if (String(r[1]) !== 'expense') return;
    const name = String(r[2]).trim();
    if (!name || known[normName_(name)]) return;
    known[normName_(name)] = true;
    const g = defaultGroupOf_(name);
    rows.push([name, g, g ? 'авто' : 'нужно указать']);
  });
  rows.sort(function (a, b) { return a[1].localeCompare(b[1]) || a[0].localeCompare(b[0]); });
  rewriteTable_('map', rows);
  return rows.filter(function (r) { return !r[1]; }).map(function (r) { return r[0]; });
}

/** Показать статьи без группы. */
function listUnmappedCategories() {
  const list = seedCategoryMap_();
  console.log(list.length ? 'Без группы:\n' + list.join('\n') : 'Все статьи размечены');
}

function scheduleOnce_(fn, seconds) {
  deleteTriggersFor_(fn);
  ScriptApp.newTrigger(fn).timeBased().after(seconds * 1000).create();
}

function deleteTriggersFor_(fn) {
  ScriptApp.getProjectTriggers().forEach(function (tr) {
    if (tr.getHandlerFunction() === fn) ScriptApp.deleteTrigger(tr);
  });
}
