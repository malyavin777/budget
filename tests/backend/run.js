// Юнит-тесты чистой логики бэкенда в Node: node tests/run.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const src = path.join(__dirname, '..', '..', 'apps-script');
const files = fs.readdirSync(src).filter((f) => f.endsWith('.gs')).sort();

const Utilities = {
  formatDate(d, tz, fmt) {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(d).map((x) => [x.type, x.value]));
    return fmt.replace('yyyy', p.year).replace('MM', p.month).replace('dd', p.day).replace(/\bd\b/, String(Number(p.day)));
  },
  getUuid() { return require('crypto').randomUUID(); },
};
const ctx = vm.createContext({ Utilities, console, Date, Math, JSON, Number, String, Object, Array, isFinite, Error });
let code = files.map((f) => fs.readFileSync(path.join(src, f), 'utf8')).join('\n;\n');
// const на верхнем уровне не попадает в контекст — делаем доступными для тестов
code += '\n;globalThis.__t = { CFG, DEFAULT_GROUPS, parseMonthFileName_, monthFileName_, parseAmount_, sanitizeText_, isCategoryName_, addMonths_, daysInMonth_, ymOf_, parseYm_, parseOpDate_, buildForecastCtx_, forecastCategory_, statusOf_, defaultGroupOf_, checkToken_, num_ };';
vm.runInContext(code, ctx, { filename: 'all.gs' });
const T = ctx.__t;

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.log('  ✗ ' + name + '\n    ' + e.message); process.exitCode = 1; }
}

console.log('Имена файлов');
test('обычное имя', () => assert.deepStrictEqual({ ...T.parseMonthFileName_('Октябрь 26') }, { y: 2026, m: 10 }));
test('пробел в начале', () => assert.deepStrictEqual({ ...T.parseMonthFileName_(' Март 25') }, { y: 2025, m: 3 }));
test('год четырьмя цифрами', () => assert.deepStrictEqual({ ...T.parseMonthFileName_('Апрель 2026') }, { y: 2026, m: 4 }));
test('регистр', () => assert.deepStrictEqual({ ...T.parseMonthFileName_('ноябрь  25') }, { y: 2025, m: 11 }));
test('служебная таблица не месяц', () => assert.strictEqual(T.parseMonthFileName_('Бюджет — Служебное'), null));
test('копия не месяц', () => assert.strictEqual(T.parseMonthFileName_('Копия Октябрь 26'), null));
test('имя нового файла', () => assert.strictEqual(T.monthFileName_(2026, 11), 'Ноябрь 26'));
test('январь 2027', () => assert.strictEqual(T.monthFileName_(2027, 1), 'Январь 27'));

console.log('Месяцы');
test('назад через год', () => assert.deepStrictEqual({ ...T.addMonths_(2026, 1, -2) }, { y: 2025, m: 11 }));
test('вперёд через год', () => assert.deepStrictEqual({ ...T.addMonths_(2026, 12, 1) }, { y: 2027, m: 1 }));
test('дней в феврале 2028', () => assert.strictEqual(T.daysInMonth_(2028, 2), 29));
test('ym', () => assert.strictEqual(T.ymOf_(2026, 3), '2026-03'));

console.log('Суммы и текст');
test('1 250,50', () => assert.strictEqual(T.parseAmount_('1 250,50'), 1250.5));
test('число', () => assert.strictEqual(T.parseAmount_(300), 300));
test('мусор отклоняется', () => assert.ok(isNaN(T.parseAmount_('12abc'))));
test('три знака после запятой отклоняются', () => assert.ok(isNaN(T.parseAmount_('1,234'))));
test('формула экранируется', () => assert.strictEqual(T.sanitizeText_('=IMPORTXML(1)'), "'=IMPORTXML(1)"));
test('минус экранируется', () => assert.strictEqual(T.sanitizeText_('-5'), "'-5"));
test('обычный текст как есть', () => assert.strictEqual(T.sanitizeText_(' аванс '), 'аванс'));
test('обрезка 200', () => assert.strictEqual(T.sanitizeText_('я'.repeat(300)).length, 200));
test('заглушка b17 не статья', () => assert.strictEqual(T.isCategoryName_('b17'), false));
test('Итого не статья', () => assert.strictEqual(T.isCategoryName_('Итого'), false));
test('рубли в ячейке', () => assert.strictEqual(T.num_('26500,00 ₽'), 26500));

console.log('Даты операции');
const today = { y: 2026, m: 10, d: 23 };
test('пусто = сегодня', () => assert.deepStrictEqual({ ...T.parseOpDate_('', today) }, today));
test('вчера можно', () => assert.deepStrictEqual({ ...T.parseOpDate_('2026-10-22', today) }, { y: 2026, m: 10, d: 22 }));
test('завтра можно (часовые пояса)', () => T.parseOpDate_('2026-10-24', today));
test('послезавтра нельзя', () => assert.throws(() => T.parseOpDate_('2026-10-25', today)));
test('полгода назад нельзя', () => assert.throws(() => T.parseOpDate_('2026-04-01', today)));
test('31 ноября нельзя', () => assert.throws(() => T.parseOpDate_('2026-11-31', { y: 2026, m: 11, d: 30 })));

console.log('Токен');
ctx.PropertiesService = { getScriptProperties: () => ({ getProperty: () => 'abc123' }) };
test('верный', () => assert.strictEqual(T.checkToken_('abc123'), true));
test('неверный', () => assert.strictEqual(T.checkToken_('abc124'), false));
test('пустой', () => assert.strictEqual(T.checkToken_(undefined), false));

console.log('Группы');
test('Питание → Еда', () => assert.strictEqual(T.defaultGroupOf_('Питание'), 'Еда'));
test('Продукты → Еда', () => assert.strictEqual(T.defaultGroupOf_('Продукты'), 'Еда'));
test('длинное имя с пробелом', () => assert.strictEqual(T.defaultGroupOf_('Здоровье (Прием врача, диагностика,  анализы) '), 'Здоровье и забота'));
test('неизвестная → пусто', () => assert.strictEqual(T.defaultGroupOf_('Новая статья'), ''));
test('нет пересечений групп', () => {
  const seen = {};
  Object.entries(T.DEFAULT_GROUPS).forEach(([g, list]) => list.forEach((n) => {
    assert.ok(!seen[n], n + ' в двух группах'); seen[n] = g;
  }));
});

console.log('Статус');
test('AC-8: Рестораны красные', () => assert.strictEqual(T.statusOf_(10000, 7000, 13500), 'red'));
test('+5% жёлтый', () => assert.strictEqual(T.statusOf_(30000, 22000, 31500), 'amber'));
test('в плане зелёный', () => assert.strictEqual(T.statusOf_(1500, 1000, 1500), 'green'));
test('превышен факт — красный', () => assert.strictEqual(T.statusOf_(1000, 1001, 1001), 'red'));
test('без плана', () => assert.strictEqual(T.statusOf_(0, 1800, 2400), 'none'));

console.log('Прогноз');
const map = { 'Питание': 'Еда', 'Продукты': 'Еда', 'Рестораны': 'Еда', 'Подарки': 'Досуг' };
// история: в 2025 «Питание», с весны 2026 — «Продукты»
const hist = [];
for (let m = 1; m <= 12; m++) {
  if (m === 12) continue; // декабря 2025 нет
  hist.push({ ym: T.ymOf_(2025, m), cat: 'Питание', fact: 40000 });
  hist.push({ ym: T.ymOf_(2025, m), cat: 'Подарки', fact: m === 11 ? 9000 : 2000 });
}
for (let m = 1; m <= 9; m++) {
  hist.push({ ym: T.ymOf_(2026, m), cat: m < 3 ? 'Питание' : 'Продукты', fact: 44000 });
  hist.push({ ym: T.ymOf_(2026, m), cat: 'Подарки', fact: 2200 });
  if (m >= 7) hist.push({ ym: T.ymOf_(2026, m), cat: 'Рестораны', fact: 6000 });
}
const c1 = T.buildForecastCtx_(2026, 10, 23, 31, hist, map, []);

test('переименованная статья берёт базу из группы', () => {
  const f = T.forecastCategory_('Продукты', 30000, 20000, c1);
  assert.strictEqual(f.lowData, false);
  assert.strictEqual(f.basis, 'linear');
  // база: группа Еда окт-25 = 40000; доля Продуктов в Еде за июл-сен = 132000/150000; K = 150000/120000 = 1.25
  const base = 40000 * (132000 / 150000) * 1.25;
  const expected = Math.round(20000 + (1 - 23 / 31) * base);
  assert.strictEqual(f.forecast, expected);
});

test('прогноз не ниже факта', () => {
  const f = T.forecastCategory_('Продукты', 30000, 90000, c1);
  assert.ok(f.forecast >= 90000);
});

test('новая статья без истории → по плану, «мало данных»', () => {
  const f = T.forecastCategory_('Английский', 9600, 7200, c1);
  assert.deepStrictEqual({ ...f }, { forecast: 9600, lowData: true, basis: 'plan' });
});

test('декабрь без прошлого года → среднее за 6 месяцев', () => {
  const c = T.buildForecastCtx_(2026, 12, 2, 31, hist.concat([
    { ym: '2026-10', cat: 'Подарки', fact: 2200 }, { ym: '2026-11', cat: 'Подарки', fact: 2200 },
  ]), map, []);
  const f = T.forecastCategory_('Подарки', 3000, 0, c);
  assert.strictEqual(f.lowData, false);
  assert.strictEqual(f.forecast, Math.round((1 - 2 / 31) * 2200));
});

test('сезонность: ноябрь подарков выше', () => {
  const hist2 = hist.concat([{ ym: '2026-10', cat: 'Подарки', fact: 2200 }]);
  const c = T.buildForecastCtx_(2026, 11, 2, 30, hist2, map, []);
  const f = T.forecastCategory_('Подарки', 3000, 0, c);
  assert.ok(f.forecast > 8000, 'ожидали всплеск ноября, получили ' + f.forecast);
});

test('K ограничен 1.5', () => {
  const h = hist.map((x) => (x.ym >= '2026-07' && x.cat === 'Подарки' ? { ...x, fact: 20000 } : x));
  const c = T.buildForecastCtx_(2026, 10, 1, 31, h, map, []);
  const f = T.forecastCategory_('Подарки', 3000, 0, c);
  // группа Досуг окт-25 = 2000, доля 1, K = min(60000/6000, 1.5)
  assert.strictEqual(f.forecast, Math.round((30 / 31) * 2000 * 1.5));
});

test('кривая из операций приложения (≥3 месяцев)', () => {
  const ops = [];
  ['2026-07', '2026-08', '2026-09'].forEach((ym) => {
    ops.push({ ym, day: 1, cat: 'Ипотека', amount: 16500 }); // платится 1-го
  });
  const h = hist.concat(['2026-07', '2026-08', '2026-09'].map((ym) => ({ ym, cat: 'Ипотека', fact: 16500 })));
  const c = T.buildForecastCtx_(2026, 10, 5, 31, h, { ...map, 'Ипотека': 'Дом' }, ops);
  const f = T.forecastCategory_('Ипотека', 16500, 16500, c);
  assert.strictEqual(f.basis, 'curve');
  assert.strictEqual(f.forecast, 16500); // к 5-му уже 100% — линейный темп дал бы ~102 000
});

console.log('\n' + passed + ' проверок пройдено' + (process.exitCode ? ', есть ошибки' : ''));
