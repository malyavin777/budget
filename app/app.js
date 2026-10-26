/* Бюджет — веб-приложение «Внести / Отчёт».
 * Без сборки и зависимостей. Данные — через бэкенд на Apps Script.
 * Адрес бэкенда и код доступа хранятся только на этом телефоне (localStorage).
 */
(function () {
  'use strict';

  const TZ = 'Asia/Yekaterinburg';
  const UNDO_MS = 5000;
  const TIMEOUT_MS = 12000;
  const RETRYABLE = ['network', 'timeout', 'busy', 'server_error', 'rate_limited'];
  const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

  // Группы для экрана ввода. Совпадают со «Справочником_категорий» по умолчанию.
  const GROUPS = [
    ['Еда', ['Продукты', 'Рестораны', 'Кофейня', 'Озон еда', 'Питание']],
    ['Дом и жильё', ['Ипотека', 'Коммунальные услуги Ласковая', 'Коммунальные услуги Захаренко', 'Захаренко 7', 'Товары для дома (постельное, вазы, посуда)', 'Хоз. товары (порошки, пасты, губки, тряпки)', 'Связь (интернет, мобильная связь)', 'Подписки', 'Страхование', 'Дом', 'Коммунальные услуги', 'Товары для дома', 'Связь']],
    ['Транспорт', ['Бензин + общественный транспорт', 'Такси', 'Обслуживание машины', 'Обслуживание велосипедов', 'Транспорт']],
    ['Дети', ['Детский сад', 'Няня', 'Детская одежда и обувь', 'Развивашки, игровая Лео', 'Велосипед Лео', 'Детская одежда']],
    ['Здоровье и забота', ['Здоровье (Прием врача, диагностика, анализы)', 'Лекарства и БАДы', 'Тренировки бег', 'Бассейн', 'Волейбол', 'Скалолазание', 'Баня + массаж', 'Бьюти (товары для красоты, стрижка и т.д.)', 'Здоровье/медицина', 'Спорт', 'Бьюти', 'Психотерапия']],
    ['Одежда', ['Одежда и обувь Настя', 'Одежда и обувь Саша', 'Одежда и обувь', 'Одежда']],
    ['Работа и учёба', ['Супервизия', 'Интервизия', 'Аренда кабинета Настя', 'Аренда кабинета', 'Рабочие расходы Саша', 'Раб.расходы Настя', 'Рабочие расходы', 'Образование Настя и Саша', 'Образование', 'Английский', 'Налог']],
    ['Досуг', ['Развлечения (кино, театр, концерты, аттракционы)', 'Хобби/творчество (картины по номерам, краски, мастер-классы, арт-галерея, книги)', 'Путешествия (отели, билеты)', 'Подарки', 'Развлечения', 'Хобби/творчество', 'Путешествия']],
    ['Личное', ['Личные расходы Саша', 'Личные расходы Настя', 'Личные расходы']],
    ['Разовые', ['Ремонт']],
  ];
  const DEFAULT_FREQUENT = {
    expense: ['Продукты', 'Рестораны', 'Кофейня', 'Бензин + общественный транспорт', 'Озон еда', 'Такси'],
    income: ['Клиенты психология', 'Аренда квартиры', 'ЧелГУ', 'Кэшбек', 'Оптик центр'],
  };
  const TILE_COLORS = ['#3DDC97', '#FF6A4D', '#E0A060', '#3D7BFF', '#9B5CFF', '#FFC24B'];
  const STATUS_COLOR = { green: '#3DDC97', amber: '#FFC24B', red: '#FF5C6A', none: '#8A90A6' };
  const SHORT = {
    'Бензин + общественный транспорт': 'Бензин + транспорт',
    'Коммунальные услуги Ласковая': 'Коммуналка Ласковая',
    'Коммунальные услуги Захаренко': 'Коммуналка Захаренко',
  };

  /* ---------- хранилище ---------- */
  const LS = {
    get(k, d) {
      try { const v = localStorage.getItem('budget.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; }
    },
    set(k, v) { try { localStorage.setItem('budget.' + k, JSON.stringify(v)); } catch (e) { /* приватный режим */ } },
    del(k) { try { localStorage.removeItem('budget.' + k); } catch (e) { /* */ } },
  };

  /* ---------- помощники ---------- */
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.prototype.slice.call((root || document).querySelectorAll(sel));
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }
  function short(name) {
    const n = String(name).trim();
    if (SHORT[n]) return SHORT[n];
    return n.replace(/\s*\(.*\)\s*$/, '').trim() || n;
  }
  function money(n, withCur) {
    const v = Math.round(Math.abs(Number(n) || 0));
    const s = String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    return (Number(n) < 0 ? '−' : '') + s + (withCur === false ? '' : ' ₽');
  }
  function moneyExact(n) {
    const v = Math.abs(Number(n) || 0);
    const int = Math.floor(v);
    const frac = Math.round((v - int) * 100);
    const s = String(int).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    return s + (frac ? ',' + String(frac).padStart(2, '0') : '') + ' ₽';
  }
  function todayStr() {
    return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  }
  function shiftDate(s, days) {
    const p = s.split('-').map(Number);
    const d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + days));
    return d.toISOString().slice(0, 10);
  }
  function dateLabel(s) {
    const t = todayStr();
    const p = s.split('-').map(Number);
    const base = p[2] + ' ' + MONTHS_SHORT[p[1] - 1];
    if (s === t) return 'Сегодня, ' + base;
    if (s === shiftDate(t, -1)) return 'Вчера, ' + base;
    return base;
  }
  function humanDate(s) {
    const mt = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
    if (mt) return Number(mt[3]) + ' ' + MONTHS_GEN[Number(mt[2]) - 1];
    return String(s || '—');
  }
  function parseAmount(s) {
    const t = String(s || '').replace(/[\s ₽]/g, '').replace(',', '.');
    if (!/^\d+(\.\d{1,2})?$/.test(t)) return NaN;
    return Math.round(Number(t) * 100) / 100;
  }
  function uid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
  }
  function icon(name) {
    const paths = {
      plus: '<path d="M12 5v14M5 12h14"/>',
      chart: '<path d="M6 19V13M12 19V6M18 19v-9"/>',
      left: '<path d="M15 6l-6 6 6 6"/>',
      right: '<path d="M9 6l6 6-6 6"/>',
      close: '<path d="M6 6l12 12M18 6L6 18"/>',
      search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/>',
      up: '<path d="M6 15l6-6 6 6"/>',
      cal: '<rect x="4" y="5" width="16" height="15" rx="3"/><path d="M4 10h16M9 3v4M15 3v4"/>',
    };
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths[name] + '</svg>';
  }

  /* ---------- API ---------- */
  function cfg() { return LS.get('cfg', null); }

  async function api(action, body) {
    const c = cfg();
    if (!c) { const e = new Error('Нет подключения'); e.code = 'unauthorized'; throw e; }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    let res;
    try {
      res = await fetch(c.url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(Object.assign({ token: c.token, action: action }, body || {})),
        redirect: 'follow',
        signal: ctrl.signal,
      });
    } catch (err) {
      const e = new Error(err && err.name === 'AbortError' ? 'Сервер долго не отвечает' : 'Нет сети');
      e.code = err && err.name === 'AbortError' ? 'timeout' : 'network';
      throw e;
    } finally {
      clearTimeout(timer);
    }
    let data;
    try { data = await res.json(); } catch (err) {
      const e = new Error('Сервер ответил непонятно'); e.code = 'server_error'; throw e;
    }
    if (!data.ok) {
      const e = new Error(data.message || data.code || 'Ошибка'); e.code = data.code || 'server_error'; throw e;
    }
    return data;
  }

  /* ---------- состояние ---------- */
  const S = {
    route: 'add',
    type: 'expense',
    picked: null,
    amount: '',
    comment: '',
    q: '',
    date: todayStr(),
    cats: LS.get('cats', null),
    report: null,
    reportYm: null,
    reportStale: false,
    open: null,
    detail: {},
    showAll: false,
    saving: false,
  };

  /* ---------- маршрутизация ---------- */
  function readRoute() {
    const h = location.hash.replace(/^#/, '');
    if (h.indexOf('connect=') === 0) {
      S.connectId = decodeURIComponent(h.slice(8));
      return 'connect';
    }
    if (!cfg()) return 'connect';
    if (h === 'report' || h.indexOf('report') === 0) return 'report';
    return 'add';
  }
  function go(route) {
    if (route === 'connect') { render(); return; }
    if (location.hash !== '#' + route) location.hash = route;
    else onRoute();
  }
  function onRoute() {
    S.route = readRoute();
    render();
  }

  function render() {
    const app = $('#app');
    if (S.route === 'connect') app.innerHTML = connectView();
    else if (S.route === 'report') { app.innerHTML = reportView(); bindReport(); loadReport(S.reportYm); }
    else { app.innerHTML = addView(); bindAdd(); }
    window.scrollTo(0, 0);
  }

  /* ================= ПОДКЛЮЧЕНИЕ ================= */
  function connectView(err) {
    const c = cfg();
    const knownUrl = S.connectId ? 'https://script.google.com/macros/s/' + S.connectId + '/exec' : (c && c.url) || '';
    return '' +
      '<div class="screen connect">' +
      '<form class="panel" id="connect-form" novalidate>' +
      '<h1>Подключение</h1>' +
      '<p>Вводится один раз на этом телефоне. Код доступа показывает функция <b>showToken</b> в редакторе скрипта.</p>' +
      (S.connectId ? '<input type="hidden" id="c-url" value="' + esc(knownUrl) + '">' :
        '<div class="field"><label class="label" for="c-url">Адрес бэкенда</label>' +
        '<input class="input" id="c-url" type="url" inputmode="url" autocomplete="off" placeholder="https://script.google.com/macros/s/…/exec" value="' + esc(knownUrl) + '"></div>') +
      '<div class="field"><label class="label" for="c-token">Код доступа</label>' +
      '<input class="input" id="c-token" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Вставьте код"></div>' +
      '<div class="error" id="c-err" role="alert">' + esc(err || '') + '</div>' +
      '<button class="primary" type="submit" id="c-go"><span class="glow" aria-hidden="true"></span><span>Подключить</span></button>' +
      (c ? '<button class="link" type="button" id="c-cancel">Отмена</button>' : '') +
      '</form></div>';
  }

  async function submitConnect(ev) {
    ev.preventDefault();
    const url = $('#c-url').value.trim();
    const token = $('#c-token').value.trim();
    const errEl = $('#c-err');
    if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url)) { errEl.textContent = 'Адрес должен быть вида https://script.google.com/macros/s/…/exec'; return; }
    if (token.length < 16) { errEl.textContent = 'Код слишком короткий — скопируйте его целиком'; return; }
    const btn = $('#c-go');
    btn.disabled = true; btn.classList.add('busy'); errEl.textContent = '';
    const prev = cfg();
    LS.set('cfg', { url: url, token: token });
    try {
      await api('ping');
      S.connectId = null;
      history.replaceState(null, '', location.pathname + location.search + '#add');
      onRoute();
      refreshCats();
      flushQueue();
    } catch (e) {
      if (prev) LS.set('cfg', prev); else LS.del('cfg');
      errEl.textContent = e.code === 'unauthorized' ? 'Код не подошёл. Проверьте, что скопировали его целиком.' : e.message;
      btn.disabled = false; btn.classList.remove('busy');
    }
  }

  /* ================= ВНЕСТИ ================= */
  function catsFor(type) {
    const c = S.cats;
    if (!c) return [];
    return (type === 'income' ? c.income : c.expense) || [];
  }

  function frequentFor(type) {
    const list = catsFor(type);
    const local = LS.get('freq', {})[type] || {};
    const server = (S.cats && S.cats.frequent && S.cats.frequent[type]) || [];
    const byLocal = Object.keys(local).sort((a, b) => local[b] - local[a]);
    const out = [];
    [].concat(byLocal, server, DEFAULT_FREQUENT[type], list).forEach((n) => {
      if (out.length < 4 && list.indexOf(n) >= 0 && out.indexOf(n) < 0) out.push(n);
    });
    return out;
  }

  function groupsFor(type, q) {
    const list = catsFor(type);
    const match = (n) => !q || n.toLowerCase().indexOf(q) >= 0 || short(n).toLowerCase().indexOf(q) >= 0;
    if (type === 'income') return [['Статьи дохода', list.filter(match)]].filter((g) => g[1].length);
    const used = {};
    const res = [];
    const norm = (s) => s.replace(/\s+/g, ' ').trim().toLowerCase();
    GROUPS.forEach((g) => {
      const keys = g[1].map(norm);
      const items = list.filter((n) => !used[n] && keys.indexOf(norm(n)) >= 0);
      items.forEach((n) => { used[n] = true; });
      const shown = items.filter(match);
      if (shown.length) res.push([g[0], shown]);
    });
    const rest = list.filter((n) => !used[n] && match(n));
    if (rest.length) res.push(['Другое', rest]);
    return res;
  }

  function addView() {
    const isInc = S.type === 'income';
    const queued = LS.get('queue', []).length;
    const today = todayStr();
    return '' +
      '<div class="screen">' +
      '<div class="top">' +
      '<a class="icon-btn" href="#report" aria-label="Отчёт">' + icon('chart') + (queued ? '<span class="badge" title="Ждут отправки">' + queued + '</span>' : '') + '</a>' +
      '<h1>Новая запись</h1>' +
      '<label class="chip' + (S.date !== today ? ' past' : '') + '">' + icon('cal').replace('<svg', '<svg width="14" height="14"') +
      '<span id="date-label">' + esc(dateLabel(S.date)) + '</span>' +
      '<input type="date" id="date" aria-label="Дата операции" value="' + S.date + '" max="' + today + '" min="' + shiftDate(today, -45) + '"></label>' +
      '</div>' +
      '<div class="seg" role="tablist" aria-label="Тип операции">' +
      '<button role="tab" data-type="expense" aria-selected="' + !isInc + '">Расход</button>' +
      '<button role="tab" data-type="income" aria-selected="' + isInc + '">Доход</button>' +
      '</div>' +
      '<div class="amount" id="amount-box"><label class="label" for="amount">Сумма</label>' +
      '<div class="amount-row"><input id="amount" inputmode="decimal" autocomplete="off" enterkeyhint="done" placeholder="0" value="' + esc(S.amount) + '"><span class="cur">₽</span></div></div>' +
      (S.cats ? catsBlock() : '<div class="skel" style="height:64px"></div><div class="skel" style="height:220px"></div>') +
      '<div class="save-bar"><div class="inner"><button class="primary" id="save"><span class="glow" aria-hidden="true"></span><span id="save-label"></span></button></div></div>' +
      '</div>';
  }

  function catsBlock() {
    const isInc = S.type === 'income';
    const freq = frequentFor(S.type);
    return '' +
      (freq.length ? '<div class="field"><span class="label">Частые</span><div class="freq">' +
        freq.map((n, i) => '<button class="tile" data-cat="' + esc(n) + '" aria-pressed="' + (S.picked === n) + '">' +
          '<span class="glow" aria-hidden="true" style="background:radial-gradient(closest-side,' + TILE_COLORS[i % TILE_COLORS.length] + ' 0%,rgba(0,0,0,0) 100%)"></span>' +
          '<span>' + esc(short(n)) + '</span></button>').join('') +
        '</div></div>' : '') +
      (isInc ? '<div class="field"><label class="label" for="comment">Комментарий (необязательно)</label>' +
        '<input class="input" id="comment" maxlength="200" autocomplete="off" placeholder="Например, аванс" value="' + esc(S.comment) + '"></div>' : '') +
      '<div class="search">' + icon('search').replace('stroke="currentColor"', 'stroke="#7D8399"') +
      '<label class="sr" for="q">Найти статью</label><input id="q" type="search" autocomplete="off" placeholder="Найти статью" value="' + esc(S.q) + '"></div>' +
      '<div class="groups" id="groups">' + groupsHtml() + '</div>';
  }

  function groupsHtml() {
    const gs = groupsFor(S.type, S.q.trim().toLowerCase());
    if (!gs.length) return '<p class="empty">Ничего не нашлось. Статьи берутся из «Сводки» текущего месяца.</p>';
    return gs.map((g) => '<div class="group"><h3>' + esc(g[0]) + '</h3><div class="chips">' +
      g[1].map((n) => '<button class="cat" data-cat="' + esc(n) + '" aria-pressed="' + (S.picked === n) + '" title="' + esc(n) + '">' + esc(short(n)) + '</button>').join('') +
      '</div></div>').join('');
  }

  function bindAdd() {
    const app = $('#app');
    app.onclick = function (ev) {
      const t = ev.target.closest('[data-type],[data-cat],#save');
      if (!t) return;
      if (t.dataset.type) {
        if (S.type === t.dataset.type) return;
        S.type = t.dataset.type; S.picked = null; S.q = '';
        app.innerHTML = addView(); bindAdd();
        return;
      }
      if (t.dataset.cat) {
        S.picked = S.picked === t.dataset.cat ? null : t.dataset.cat;
        $$('[data-cat]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.cat === S.picked)));
        updateSave();
        const a = $('#amount');
        if (S.picked && a && !a.value) a.focus();
        return;
      }
      if (t.id === 'save') save();
    };
    const amount = $('#amount');
    amount.oninput = function () { S.amount = amount.value; $('#amount-box').classList.remove('invalid'); updateSave(); };
    amount.onkeydown = function (ev) { if (ev.key === 'Enter') { amount.blur(); } };
    const q = $('#q');
    if (q) q.oninput = function () { S.q = q.value; $('#groups').innerHTML = groupsHtml(); };
    const cm = $('#comment');
    if (cm) cm.oninput = function () { S.comment = cm.value; };
    const d = $('#date');
    d.onchange = function () {
      const today = todayStr();
      S.date = d.value && d.value <= today && d.value >= shiftDate(today, -45) ? d.value : today;
      $('#date-label').textContent = dateLabel(S.date);
      d.parentNode.classList.toggle('past', S.date !== today);
    };
    updateSave();
  }

  function updateSave() {
    const btn = $('#save');
    if (!btn) return;
    const amt = parseAmount(S.amount);
    const okAmt = amt > 0 && amt <= 10000000;
    const ok = okAmt && !!S.picked && !S.saving;
    btn.disabled = !ok;
    let label;
    if (!S.cats) label = 'Загружаю статьи';
    else if (!S.picked && !S.amount) label = 'Выберите статью и сумму';
    else if (!S.picked) label = 'Выберите статью';
    else if (!okAmt) label = S.amount ? 'Проверьте сумму' : 'Введите сумму';
    else label = 'Сохранить · ' + moneyExact(amt) + ' · ' + short(S.picked);
    $('#save-label').textContent = label;
    btn.classList.toggle('busy', S.saving);
  }

  async function save() {
    const amt = parseAmount(S.amount);
    if (!(amt > 0) || !S.picked || S.saving) { $('#amount-box').classList.add('invalid'); return; }
    const op = {
      clientId: uid(),
      type: S.type,
      category: S.picked,
      amount: amt,
      comment: S.type === 'income' ? S.comment.trim().slice(0, 200) : '',
      date: S.date,
    };
    S.saving = true; updateSave();
    try {
      await api('add', op);
      afterSave(op, false);
    } catch (e) {
      if (RETRYABLE.indexOf(e.code) >= 0) {
        const q = LS.get('queue', []); q.push(op); LS.set('queue', q);
        afterSave(op, true);
      } else if (e.code === 'unauthorized') {
        toast({ kind: 'err', title: 'Нужно заново подключиться', text: e.message });
        S.route = 'connect'; render();
      } else if (e.code === 'unknown_category') {
        toast({ kind: 'err', title: 'Статья не найдена', text: 'Список обновлён — выберите заново' });
        S.picked = null; await refreshCats(true);
      } else {
        toast({ kind: 'err', title: 'Не сохранилось', text: e.message });
      }
    } finally {
      S.saving = false; updateSave();
    }
  }

  function afterSave(op, queued) {
    const freq = LS.get('freq', {});
    freq[op.type] = freq[op.type] || {};
    freq[op.type][op.category] = (freq[op.type][op.category] || 0) + 1;
    LS.set('freq', freq);
    if (navigator.vibrate) { try { navigator.vibrate(18); } catch (e) { /* */ } }
    S.amount = ''; S.comment = ''; S.picked = null; S.q = '';
    S.report = null; // отчёт устарел
    toast({
      kind: queued ? 'warn' : 'ok',
      title: queued ? 'Нет сети — запись сохранена' : 'Сохранено',
      text: moneyExact(op.amount) + ' · ' + short(op.category) + (queued ? ' · отправим сами' : ''),
      action: 'Отменить',
      onAction: () => undo(op),
      ms: UNDO_MS,
    });
    if (S.route === 'add') { $('#app').innerHTML = addView(); bindAdd(); }
  }

  async function undo(op) {
    const q = LS.get('queue', []);
    const i = q.findIndex((x) => x.clientId === op.clientId);
    if (i >= 0) {
      q.splice(i, 1); LS.set('queue', q);
      toast({ kind: 'ok', title: 'Отменено', text: 'Запись не будет отправлена' });
      if (S.route === 'add') { $('#app').innerHTML = addView(); bindAdd(); }
      return;
    }
    try {
      await api('undo', { clientId: op.clientId });
      S.report = null;
      toast({ kind: 'ok', title: 'Отменено', text: 'Строка удалена из таблицы' });
    } catch (e) {
      toast({ kind: 'err', title: 'Не удалось отменить', text: e.message });
    }
  }

  async function refreshCats(force) {
    if (!cfg()) return;
    try {
      const data = await api('categories');
      S.cats = { expense: data.expense, income: data.income, frequent: data.frequent, ym: data.ym, at: Date.now() };
      LS.set('cats', S.cats);
      if (S.route === 'add' && (force || !$('.groups'))) { $('#app').innerHTML = addView(); bindAdd(); }
      else if (S.route === 'add') { const g = $('#groups'); if (g) g.innerHTML = groupsHtml(); updateSave(); }
    } catch (e) {
      if (e.code === 'unauthorized') { S.route = 'connect'; render(); }
      else if (!S.cats) toast({ kind: 'err', title: 'Не загрузились статьи', text: e.message });
    }
  }

  let flushing = false;
  async function flushQueue() {
    if (flushing || !cfg()) return;
    let q = LS.get('queue', []);
    if (!q.length) return;
    flushing = true;
    let sent = 0;
    try {
      for (const op of q.slice()) {
        try {
          await api('add', op);
          sent++;
        } catch (e) {
          if (RETRYABLE.indexOf(e.code) >= 0) break;
          if (e.code === 'unauthorized') { S.route = 'connect'; render(); break; }
          toast({ kind: 'err', title: 'Не отправилась запись', text: moneyExact(op.amount) + ' · ' + short(op.category) + ': ' + e.message });
        }
        q = LS.get('queue', []).filter((x) => x.clientId !== op.clientId);
        LS.set('queue', q);
      }
    } finally {
      flushing = false;
    }
    if (sent) {
      S.report = null;
      toast({ kind: 'ok', title: 'Отправлено записей: ' + sent, text: 'из очереди без сети' });
      if (S.route === 'add') { $('#app').innerHTML = addView(); bindAdd(); }
      if (S.route === 'report') loadReport(S.reportYm);
    }
  }

  /* ================= ОТЧЁТ ================= */
  function reportView() {
    const r = S.report || LS.get('report.' + (S.reportYm || 'cur'), null);
    if (!r) {
      return '<div class="screen">' + reportTop(null) +
        '<div class="skel" style="height:220px"></div><div class="skel" style="height:200px"></div>' +
        '<div class="cards"><div class="skel" style="height:150px"></div><div class="skel" style="height:150px"></div></div></div>';
    }
    return '<div class="screen">' + reportTop(r) + heroHtml(r) + incomeHtml(r) + cardsHtml(r) +
      (S.reportStale ? '<p class="stale">Показаны сохранённые данные — обновляю…</p>' : '') +
      (r.isCurrent ? '<p class="foot">Белая риска на полосе — сколько месяца прошло. Заливка правее риски — тратите быстрее плана.</p>' : '') +
      '<button class="link" id="disconnect">Подключение и код доступа</button>' +
      '</div>';
  }

  function reportTop(r) {
    const sub = r ? (r.isCurrent ? r.day + ' из ' + r.daysInMonth + ' дня' : 'итоги месяца') : 'загружаю…';
    return '<div class="top">' +
      '<button class="icon-btn" id="prev" aria-label="Предыдущий месяц"' + (r && r.prev ? '' : ' disabled') + '>' + icon('left') + '</button>' +
      '<div class="title"><h1>' + esc(r ? r.title : 'Отчёт') + '</h1><span>' + esc(sub) + '</span></div>' +
      (r && r.next ? '<button class="icon-btn" id="next" aria-label="Следующий месяц">' + icon('right') + '</button>' :
        '<a class="icon-btn warm" href="#add" aria-label="Внести операцию">' + icon('plus') + '</a>') +
      '</div>';
  }

  function heroHtml(r) {
    const e = r.expense;
    const pct = e.plan > 0 ? Math.round(e.fact / e.plan * 100) : 0;
    const C = 2 * Math.PI * 34;
    const dash = Math.min(1, pct / 100) * C;
    const over = e.left < 0;
    return '<section class="hero" aria-label="Расходы месяца"><div class="bgfill" aria-hidden="true"></div>' +
      '<div class="hero-top"><div class="col">' +
      '<span class="k">' + (over ? 'Перерасход по плану' : (r.isCurrent ? 'Осталось по плану' : 'Сэкономлено по плану')) + '</span>' +
      '<span class="big num">' + money(Math.abs(e.left)) + '</span>' +
      '<span class="sub">потрачено ' + money(e.fact, false) + ' из ' + money(e.plan, false) + '</span></div>' +
      '<svg class="ring" role="img" aria-label="Использовано ' + pct + '% плана" width="84" height="84" viewBox="0 0 84 84">' +
      '<circle cx="42" cy="42" r="34" fill="none" stroke="rgba(255,255,255,0.22)" stroke-width="7"/>' +
      '<circle cx="42" cy="42" r="34" fill="none" stroke="' + (over ? '#FF9AA3' : '#FFE08A') + '" stroke-width="7" stroke-linecap="round" stroke-dasharray="' + dash.toFixed(1) + ' ' + C.toFixed(1) + '" transform="rotate(-90 42 42)"/>' +
      '<text x="42" y="47" text-anchor="middle" fill="#FFFFFF" font-family="Manrope, system-ui, sans-serif" font-size="16" font-weight="800">' + pct + '%</text></svg>' +
      '</div>' +
      (r.isCurrent ? '<div class="forecast"><div style="display:flex;flex-direction:column;gap:2px">' +
        '<span class="k" style="color:rgba(255,255,255,0.8);font-weight:600">Прогноз на конец месяца</span>' +
        '<span class="v num">≈ ' + money(e.forecast) + '</span></div>' +
        (e.forecastNote ? '<span class="pill">' + esc(e.forecastNote) + '</span>' :
          '<span class="pill">' + (e.forecast > e.plan ? '+' + money(e.forecast - e.plan) + ' к плану' : 'в плане') + '</span>') +
        '</div>' : '') +
      '</section>';
  }

  function incomeHtml(r) {
    const inc = r.income;
    const pct = inc.plan > 0 ? Math.min(100, Math.round(inc.fact / inc.plan * 100)) : 100;
    const items = inc.items.filter((i) => i.fact > 0).slice(0, 6);
    return '<section class="income" aria-label="Доходы месяца"><div class="glow" aria-hidden="true"></div>' +
      '<span class="k">Доход</span>' +
      '<div class="row"><span class="big num">' + money(inc.fact) + '</span>' + (inc.plan > 0 ? '<span class="of">из ' + money(inc.plan, false) + '</span>' : '') + '</div>' +
      (inc.plan > 0 ? '<div class="bar" aria-hidden="true"><i style="width:' + pct + '%"></i></div>' : '') +
      (items.length ? '<div class="lines">' + items.map((i) => '<div class="line"><span>' + esc(short(i.name)) + '</span><span class="num">' + money(i.fact) + '</span></div>').join('') + '</div>' : '') +
      '</section>';
  }

  function cardsHtml(r) {
    const cats = r.categories;
    const important = cats.filter((c) => c.fact > 0 || c.status === 'red' || c.status === 'amber');
    const rest = cats.filter((c) => important.indexOf(c) < 0);
    const shown = S.showAll ? cats : important;
    const restPlan = rest.reduce((a, c) => a + c.plan, 0);
    return '<div class="section-h"><h2>Статьи расходов</h2><span>' + (r.isCurrent ? 'риска сверху' : '') + '</span></div>' +
      '<div class="cards">' + shown.map((c) => cardHtml(c, r)).join('') +
      (!S.showAll && rest.length ? '<button class="more" id="show-all"><span style="font-size:14px;font-weight:600">Ещё ' + rest.length + ' ' + plural(rest.length, 'статья', 'статьи', 'статей') + '</span>' +
        '<span style="display:flex;flex-direction:column;gap:2px"><b class="num">' + money(restPlan) + '</b><span class="sub">в плане, пока без трат</span></span></button>' : '') +
      '</div>';
  }

  function plural(n, one, few, many) {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
  }

  function cardHtml(c, r) {
    const color = STATUS_COLOR[c.status] || STATUS_COLOR.none;
    const open = S.open === c.name;
    const active = c.fact > 0;
    const pct = c.plan > 0 ? Math.min(100, Math.round(c.fact / c.plan * 100)) : 0;
    const marker = r.isCurrent ? Math.round(r.day / r.daysInMonth * 100) : null;
    let val, sub, subCls = '';
    if (c.status === 'none') {
      val = money(c.fact); sub = active ? 'потрачено · без плана' : 'без плана';
    } else if (c.left < 0) {
      val = money(c.left); sub = 'перерасход · план ' + money(c.plan, false); subCls = 'red';
    } else if (c.left === 0 && c.fact > 0) {
      val = money(0); sub = 'план исчерпан · ' + money(c.plan, false);
    } else {
      val = money(c.left);
      if (r.isCurrent && (c.status === 'red' || c.status === 'amber')) {
        const d = Math.round((c.forecast - c.plan) / c.plan * 100);
        sub = 'прогноз ' + money(c.forecast, false) + ' · +' + d + '%'; subCls = c.status;
      } else if (r.isCurrent && c.lowData) {
        sub = 'осталось из ' + money(c.plan, false);
      } else if (r.isCurrent) {
        sub = 'осталось из ' + money(c.plan, false) + ' · прогноз ' + money(c.forecast, false);
      } else {
        sub = 'осталось из ' + money(c.plan, false);
      }
    }
    const glowOp = c.status === 'red' ? 0.6 : (active ? 0.45 : 0.12);
    return '<button class="card' + (c.status === 'red' ? ' red' : '') + (open ? ' open' : '') + '" data-card="' + esc(c.name) + '" aria-expanded="' + open + '">' +
      '<span class="glow" aria-hidden="true" style="background:radial-gradient(closest-side,' + color + ' 0%,rgba(0,0,0,0) 100%);opacity:' + glowOp + '"></span>' +
      '<span class="name">' + esc(open ? c.name : short(c.name)) + '</span>' +
      '<span class="stack"><span class="nums"><span class="val num">' + val + '</span><span class="sub ' + subCls + '">' + esc(sub) + '</span></span>' +
      (c.status === 'none' ? (r.isCurrent && c.forecast > c.fact ? '<span class="tag">прогноз ' + money(c.forecast, false) + '</span>' : '') :
        '<span class="mini" aria-hidden="true"><i style="width:' + pct + '%;background:' + color + '"></i>' + (marker !== null ? '<b style="left:' + marker + '%"></b>' : '') + '</span>') +
      '</span>' +
      (open ? detailHtml(c) : '') +
      '</button>';
  }

  function detailHtml(c) {
    const d = S.detail[c.name];
    if (!d) return '<span class="detail"><span class="op"><span>Загружаю операции…</span><span></span></span></span>';
    if (d.error) return '<span class="detail"><span class="op"><span>' + esc(d.error) + '</span><span></span></span></span>';
    const ops = d.ops.length ? d.ops.map((o) => '<span class="op"><span>' + esc(humanDate(o.date)) + (o.comment ? ' · ' + esc(o.comment) : '') + '</span><span class="num">' + moneyExact(o.amount) + '</span></span>').join('') :
      '<span class="op"><span>Операций пока нет</span><span></span></span>';
    let ly;
    if (d.lastYear) {
      const diff = c.fact - d.lastYear.fact;
      ly = 'Год назад: ' + money(d.lastYear.fact) + (S.report && S.report.isCurrent ? '' : (diff ? ' (' + (diff > 0 ? '+' : '') + money(diff) + ')' : ''));
    } else {
      ly = 'Год назад такой статьи не было — сравнить не с чем.';
    }
    return '<span class="detail">' + ops + '</span><span class="note">' + esc(ly) + '</span>';
  }

  async function loadReport(ym) {
    const key = 'report.' + (ym || 'cur');
    const cached = LS.get(key, null);
    if (cached && !S.report) { S.report = cached; S.reportStale = true; if (S.route === 'report') paintReport(); }
    try {
      const r = await api('report', ym ? { ym: ym } : {});
      S.report = r; S.reportStale = false;
      LS.set(key, r);
      if (S.route === 'report') paintReport();
    } catch (e) {
      S.reportStale = false;
      if (e.code === 'unauthorized') { S.route = 'connect'; render(); return; }
      toast({ kind: 'err', title: 'Отчёт не обновился', text: e.message });
      if (S.route === 'report') paintReport();
    }
  }

  function paintReport() {
    const y = window.scrollY;
    $('#app').innerHTML = reportView();
    window.scrollTo(0, y);
  }

  async function toggleCard(name) {
    S.open = S.open === name ? null : name;
    paintReport();
    if (!S.open || S.detail[name]) return;
    try {
      const d = await api('category', { ym: S.report.ym, name: name });
      S.detail[name] = d;
    } catch (e) {
      S.detail[name] = { error: e.message };
    }
    if (S.route === 'report' && S.open === name) paintReport();
    setTimeout(() => { delete S.detail[name]; }, 60000);
  }

  function bindReport() {
    $('#app').onclick = function (ev) {
      if (S.route !== 'report') return;
      const t = ev.target.closest('#prev,#next,#show-all,[data-card],#disconnect');
      if (!t) return;
      if (t.id === 'prev' || t.id === 'next') {
        const ym = t.id === 'prev' ? S.report.prev : S.report.next;
        const cur = LS.get('report.cur', null);
        S.reportYm = cur && cur.ym === ym ? null : ym;
        S.report = null; S.open = null; S.showAll = false; S.detail = {};
        paintReport(); loadReport(S.reportYm);
        return;
      }
      if (t.id === 'show-all') { S.showAll = true; paintReport(); return; }
      if (t.id === 'disconnect') {
        if (confirmDisconnect()) { LS.del('cfg'); LS.del('cats'); S.cats = null; S.route = 'connect'; render(); }
        return;
      }
      if (t.dataset.card) toggleCard(t.dataset.card);
    };
  }

  function confirmDisconnect() {
    // без системных диалогов: второе нажатие в течение 4 секунд
    const el = $('#disconnect');
    if (el.dataset.armed) return true;
    el.dataset.armed = '1';
    el.textContent = 'Нажмите ещё раз, чтобы отключить этот телефон';
    setTimeout(() => { if (el.isConnected) { delete el.dataset.armed; el.textContent = 'Подключение и код доступа'; } }, 4000);
    return false;
  }

  /* ---------- тост ---------- */
  let toastTimer = null;
  function toast(o) {
    const el = $('#toast');
    clearTimeout(toastTimer);
    el.className = 'toast ' + (o.kind || '');
    el.innerHTML = '<span class="t"><b>' + esc(o.title) + '</b>' + (o.text ? '<span>' + esc(o.text) + '</span>' : '') + '</span>' +
      (o.action ? '<button type="button">' + esc(o.action) + '</button>' : '') +
      (o.action ? '<span class="timer" style="animation-duration:' + (o.ms || UNDO_MS) + 'ms"></span>' : '');
    el.hidden = false;
    if (o.action) {
      el.querySelector('button').onclick = function () { el.hidden = true; clearTimeout(toastTimer); o.onAction(); };
    }
    toastTimer = setTimeout(() => { el.hidden = true; }, o.ms || (o.kind === 'err' ? 6000 : 3000));
  }

  /* ---------- старт ---------- */
  document.addEventListener('submit', (ev) => { if (ev.target.id === 'connect-form') submitConnect(ev); });
  document.addEventListener('click', (ev) => {
    if (ev.target.id === 'c-cancel') { S.connectId = null; history.replaceState(null, '', location.pathname + '#add'); onRoute(); }
  });
  window.addEventListener('hashchange', onRoute);
  window.addEventListener('online', flushQueue);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (S.date !== todayStr() && S.date === shiftDate(todayStr(), -1) && !S.amount) S.date = todayStr();
    flushQueue();
    if (S.route === 'report') loadReport(S.reportYm);
  });

  S.route = readRoute();
  render();
  if (cfg()) {
    refreshCats();
    flushQueue();
    if (S.route !== 'report') setTimeout(() => loadReport(null), 1500); // подогреть отчёт
  }

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
  }
})();
