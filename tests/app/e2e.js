// Сквозная проверка веб-приложения с макетом бэкенда.
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = require('path').join(__dirname, '..', '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0].replace(/^\/budget/, ''));
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
}).listen(8765);

const EXPENSE = ['Рестораны', 'Кофейня', 'Продукты', 'Озон еда', 'Подарки', 'Лекарства и БАДы', 'Здоровье (Прием врача, диагностика, анализы)',
  'Ипотека', 'Бензин + общественный транспорт', 'Одежда и обувь Настя', 'Детская одежда и обувь', 'Тренировки бег', 'Супервизия', 'Английский', 'Такси', 'Новая статья'];
const INCOME = ['Оптик центр', 'Продажа ', 'Клиенты психология', 'ЧелГУ', 'Аренда квартиры', 'Кэшбек'];
const report = (ym) => ({
  ok: true, ym, title: ym === '2026-10' ? 'Октябрь 2026' : 'Сентябрь 2026', isCurrent: ym === '2026-10', day: ym === '2026-10' ? 26 : 30, daysInMonth: ym === '2026-10' ? 31 : 30,
  expense: { plan: 203900, fact: 27500, left: 176400, forecast: 198000, forecastNote: 'уточняется' },
  income: { plan: 224000, fact: 169505, items: [{ name: 'Клиенты психология', plan: 100000, fact: 131000 }, { name: 'Аренда квартиры', plan: 27000, fact: 26500 }, { name: 'Оптик центр', plan: 10000, fact: 7000 }] },
  categories: [
    { name: 'Рестораны', plan: 4000, fact: 7000, left: -3000, pct: 175, forecast: 8400, lowData: false, basis: 'linear', status: 'red' },
    { name: 'Продукты', plan: 30000, fact: 22000, left: 8000, pct: 73, forecast: 31500, lowData: false, basis: 'linear', status: 'amber' },
    { name: 'Тренировки бег', plan: 10000, fact: 10000, left: 0, pct: 100, forecast: 10000, lowData: false, basis: 'linear', status: 'green' },
    { name: 'Английский', plan: 9600, fact: 7200, left: 2400, pct: 75, forecast: 9600, lowData: true, basis: 'plan', status: 'green' },
    { name: 'Такси', plan: 0, fact: 1800, left: -1800, pct: null, forecast: 2400, lowData: false, basis: 'linear', status: 'none' },
    { name: 'Ипотека', plan: 16500, fact: 0, left: 16500, pct: 0, forecast: 16500, lowData: false, basis: 'linear', status: 'green' },
    { name: 'Подарки', plan: 3000, fact: 0, left: 3000, pct: 0, forecast: 3000, lowData: false, basis: 'linear', status: 'green' },
  ],
  prev: ym === '2026-10' ? '2026-09' : '2026-08', next: ym === '2026-10' ? null : '2026-10',
});

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ru-RU' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g|INTERNET_DISCONNECTED/.test(m.text())) errors.push(m.text()); });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));

  const calls = [];
  let offline = false;
  await page.route('https://script.google.com/**', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    calls.push(body);
    if (offline) return route.abort('internetdisconnected');
    const send = (o) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(o) });
    if (body.token !== 'x'.repeat(64)) return send({ ok: false, code: 'unauthorized', message: 'Нужно заново ввести код доступа' });
    switch (body.action) {
      case 'ping': return send({ ok: true });
      case 'categories': return send({ ok: true, ym: '2026-10', expense: EXPENSE, income: INCOME, frequent: { expense: [], income: [] } });
      case 'add': return send({ ok: true, ym: '2026-10', row: 60 });
      case 'undo': return send({ ok: true, undone: true });
      case 'report': return send(report(body.ym || '2026-10'));
      case 'category': return send({ ok: true, name: body.name, ops: [{ date: '2026-10-20', amount: 2400, comment: '' }, { date: '13.10', amount: 2400, comment: '' }], lastYear: null });
    }
  });

  let passed = 0;
  const step = async (name, fn) => { await fn(); passed++; console.log('  ✓ ' + name); };
  const shot = (n) => page.screenshot({ path: require('os').tmpdir() + '/budget-' + n + '.png', fullPage: n.startsWith('report') });

  await step('подключение по ссылке: неверный код отклоняется', async () => {
    await page.goto('http://localhost:8765/budget/#connect=AKfyTEST_id-1');
    await page.fill('#c-token', 'y'.repeat(64));
    await page.click('#c-go');
    await page.waitForFunction(() => document.querySelector('#c-err').textContent.length > 0);
    assert.match(await page.textContent('#c-err'), /не подошёл/);
    await shot('1-connect');
  });

  await step('подключение: верный код → экран «Внести»', async () => {
    await page.fill('#c-token', 'x'.repeat(64));
    await page.click('#c-go');
    await page.waitForSelector('.tile');
    assert.ok(page.url().endsWith('#add'));
    const cfg = await page.evaluate(() => JSON.parse(localStorage.getItem('budget.cfg')));
    assert.strictEqual(cfg.url, 'https://script.google.com/macros/s/AKfyTEST_id-1/exec');
  });

  await step('частые и группы', async () => {
    const tiles = await page.$$eval('.tile span:last-child', (els) => els.map((e) => e.textContent));
    assert.deepStrictEqual(tiles, ['Продукты', 'Рестораны', 'Кофейня', 'Бензин + транспорт']);
    const groups = await page.$$eval('.group h3', (els) => els.map((e) => e.textContent));
    assert.ok(groups.includes('Еда') && groups.includes('Другое'), groups.join(','));
    assert.ok(await page.$('.cat[title="Здоровье (Прием врача, диагностика, анализы)"]'));
    assert.strictEqual(await page.textContent('.cat[title="Здоровье (Прием врача, диагностика, анализы)"]'), 'Здоровье');
    assert.ok(await page.isDisabled('#save'));
    await shot('2-add-empty');
  });

  await step('поиск', async () => {
    await page.fill('#q', 'лекар');
    assert.deepStrictEqual(await page.$$eval('.cat', (e) => e.map((x) => x.textContent)), ['Лекарства и БАДы']);
    await page.fill('#q', '');
  });

  await step('сохранение расхода', async () => {
    await page.click('.tile[data-cat="Продукты"]');
    await page.fill('#amount', '1 250,5');
    assert.match(await page.textContent('#save-label'), /Сохранить · 1 250,50 ₽ · Продукты/);
    await shot('3-add-filled');
    await page.click('#save');
    await page.waitForSelector('#toast:not([hidden]) b');
    assert.strictEqual(await page.textContent('#toast b'), 'Сохранено');
    const add = calls.filter((c) => c.action === 'add').pop();
    assert.strictEqual(add.amount, 1250.5);
    assert.strictEqual(add.category, 'Продукты');
    assert.strictEqual(add.type, 'expense');
    assert.match(add.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.strictEqual(await page.inputValue('#amount'), '');
    await shot('4-saved');
  });

  await step('отмена', async () => {
    await page.click('#toast button');
    await page.waitForFunction(() => document.querySelector('#toast b') && document.querySelector('#toast b').textContent === 'Отменено');
    assert.strictEqual(calls.filter((c) => c.action === 'undo').length, 1);
  });

  await step('доход с комментарием', async () => {
    await page.click('[data-type="income"]');
    await page.click('.tile[data-cat="Клиенты психология"]');
    await page.fill('#comment', 'аванс');
    await page.fill('#amount', '60000');
    await page.click('#save');
    await page.waitForFunction(() => document.querySelector('#toast b').textContent === 'Сохранено');
    const add = calls.filter((c) => c.action === 'add').pop();
    assert.strictEqual(add.type, 'income'); assert.strictEqual(add.comment, 'аванс'); assert.strictEqual(add.amount, 60000);
    await page.click('[data-type="expense"]');
  });

  await step('без сети: в очередь, потом отправка', async () => {
    offline = true;
    await page.click('.tile[data-cat="Кофейня"]');
    await page.fill('#amount', '300');
    await page.click('#save');
    await page.waitForFunction(() => /Нет сети/.test(document.querySelector('#toast b').textContent));
    assert.strictEqual(await page.textContent('.badge'), '1');
    await shot('5-offline');
    offline = false;
    const before = calls.filter((c) => c.action === 'add').length;
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await page.waitForFunction(() => /Отправлено записей: 1/.test(document.querySelector('#toast b').textContent));
    const after = calls.filter((c) => c.action === 'add');
    assert.strictEqual(after.length, before + 1);
    const queued = after[after.length - 1];
    const offlineCall = calls.filter((c) => c.action === 'add')[before - 1];
    assert.strictEqual(queued.clientId, offlineCall.clientId, 'тот же clientId при повторе');
    assert.strictEqual(await page.$('.badge'), null);
  });

  await step('частые учитывают свои записи', async () => {
    const first = await page.$eval('.tile span:last-child', (e) => e.textContent);
    assert.ok(['Продукты', 'Кофейня'].includes(first), first);
  });

  await step('отчёт', async () => {
    await page.click('a[href="#report"]');
    await page.waitForSelector('.hero');
    assert.match(await page.textContent('.hero .big'), /176 400/);
    assert.match(await page.textContent('.forecast'), /уточняется/);
    assert.match(await page.textContent('.card[data-card="Рестораны"] .val'), /−3 000/);
    assert.match(await page.textContent('.card[data-card="Продукты"] .sub'), /\+5%/);
    assert.match(await page.textContent('.more'), /Ещё 2 статьи/);
    await shot('report-1');
  });

  await step('раскрытие статьи', async () => {
    await page.click('.card[data-card="Английский"]');
    await page.waitForSelector('.card.open .op');
    const ops = await page.$$eval('.card.open .op', (e) => e.map((x) => x.textContent));
    assert.ok(/20 октября/.test(ops[0]) && /13\.10/.test(ops[1]), ops.join('|'));
    await shot('report-2-open');
  });

  await step('все статьи и прошлый месяц', async () => {
    await page.click('#show-all');
    assert.ok(await page.$('.card[data-card="Ипотека"]'));
    await page.click('#prev');
    await page.waitForFunction(() => document.querySelector('.top h1').textContent === 'Сентябрь 2026');
    assert.match(await page.textContent('.top .title span'), /итоги месяца/);
    assert.strictEqual(await page.$('.forecast'), null);
    await page.click('#next');
    await page.waitForFunction(() => document.querySelector('.top h1').textContent === 'Октябрь 2026');
  });

  await step('открытие из виджета сразу на отчёт (повторный запуск)', async () => {
    const p2 = await ctx.newPage();
    await p2.route(/fonts\./, (r) => r.fulfill({ status: 200, body: '' }));
    await p2.route('https://script.google.com/**', (r) => new Promise(() => {})); // сеть висит — должен показать кэш
    const t0 = Date.now();
    await p2.goto('http://localhost:8765/budget/#report');
    await p2.waitForSelector('.hero');
    assert.ok(Date.now() - t0 < 3000, 'отчёт из кэша без сети');
    await p2.close();
  });

  await step('нет ошибок в консоли', async () => { assert.deepStrictEqual(errors, []); });

  console.log(passed + ' проверок пройдено');
  await browser.close();
  server.close();
})().catch((e) => { console.error('✗', e.message); process.exit(1); });
