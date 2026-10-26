/**
 * Отчёт: план/факт из «Сводки» + прогноз на конец месяца.
 */

function readSummary_(ss) {
  const sh = ss.getSheetByName(CFG.SUMMARY_SHEET);
  if (!sh) throw structureError_(ss, 'нет листа «Сводка»');
  const first = CFG.SUMMARY_FIRST_ROW;
  const n = Math.max(0, sh.getLastRow() - first + 1);
  const rows = n ? sh.getRange(first, 1, n, 12).getValues() : [];
  const I = CFG.SUM_IDX;
  const expense = [];
  const income = [];
  let incomeDone = false;
  rows.forEach(function (r, i) {
    const en = String(r[I.expName]);
    if (isCategoryName_(en)) expense.push({ name: en, plan: num_(r[I.expPlan]), fact: num_(r[I.expFact]) });
    const inn = String(r[I.incName]);
    if (inn.trim() === CFG.INVEST_HEADER) incomeDone = true;
    if (!incomeDone && first + i <= CFG.INCOME_LAST_ROW && isCategoryName_(inn)) {
      income.push({ name: inn, plan: num_(r[I.incPlan]), fact: num_(r[I.incFact]) });
    }
  });
  return { expense: expense, income: income };
}

/**
 * Данные для прогноза в удобном виде. Чистая функция — проверяется тестами.
 * hist: [{ym, cat, fact}] (только расходы), map: {статья: группа},
 * ops: [{ym, day, cat, amount}] (расходы из приложения, только status ok).
 */
function buildForecastCtx_(y, m, day, dim, hist, map, ops) {
  const key = function (s) { return String(s).trim(); };
  const groupOf = function (cat) { return map[key(cat)] || key(cat); };
  const catFact = {}, catSeen = {}, groupFact = {};
  hist.forEach(function (h) {
    const c = key(h.cat), g = groupOf(h.cat);
    catFact[h.ym + '|' + c] = (catFact[h.ym + '|' + c] || 0) + h.fact;
    catSeen[h.ym + '|' + c] = true;
    groupFact[h.ym + '|' + g] = (groupFact[h.ym + '|' + g] || 0) + h.fact;
  });

  // кривая накопления по дням из операций приложения: прошлые месяцы целиком
  const cur = ymOf_(y, m);
  const byMonthCat = {};
  const appMonthsSet = {};
  ops.forEach(function (o) {
    if (o.ym >= cur) return;
    appMonthsSet[o.ym] = true;
    const k = o.ym + '|' + key(o.cat);
    (byMonthCat[k] = byMonthCat[k] || []).push(o);
  });

  return {
    y: y, m: m, day: day, dim: dim,
    appMonths: Object.keys(appMonthsSet).length,
    groupOf: groupOf,
    catFact: function (ym, cat) { return catFact[ym + '|' + key(cat)] || 0; },
    catSeen: function (ym, cat) { return !!catSeen[ym + '|' + key(cat)]; },
    groupFact: function (ym, g) { return groupFact[ym + '|' + g] || 0; },
    /** Средняя доля месячной суммы статьи, накопленная к дню d; null, если месяцев < 3. */
    curve: function (cat, d) {
      const shares = [];
      Object.keys(appMonthsSet).forEach(function (ym) {
        const list = byMonthCat[ym + '|' + key(cat)];
        if (!list) return;
        const p = parseYm_(ym);
        const dimPast = daysInMonth_(p.y, p.m);
        const dd = Math.min(dimPast, Math.round(d / dim * dimPast)); // тот же процент месяца
        let total = 0, upTo = 0;
        list.forEach(function (o) { total += o.amount; if (o.day <= dd) upTo += o.amount; });
        if (total > 0) shares.push(upTo / total);
      });
      if (shares.length < 3) return null;
      return shares.reduce(function (a, b) { return a + b; }, 0) / shares.length;
    },
  };
}

/** Прогноз по статье на конец месяца (FR-F2…F4). */
function forecastCategory_(name, plan, fact, ctx) {
  const y = ctx.y, m = ctx.m;
  const g = ctx.groupOf(name);
  const back = function (k) { const p = addMonths_(y, m, -k); return ymOf_(p.y, p.m); };
  const backLY = function (k) { const p = addMonths_(y, m, -k); return ymOf_(p.y - 1, p.m); };
  const sum = function (arr) { return arr.reduce(function (a, b) { return a + b; }, 0); };
  const last3 = [1, 2, 3].map(back);
  const last3LY = [1, 2, 3].map(backLY);

  // 1. Сезонная база
  let base = null;
  const gLY = ctx.groupFact(ymOf_(y - 1, m), g);
  const g3 = sum(last3.map(function (ym) { return ctx.groupFact(ym, g); }));
  const catRecent = last3.some(function (ym) { return ctx.catSeen(ym, name); });
  if (gLY > 0 && g3 > 0 && catRecent) {
    const c3 = sum(last3.map(function (ym) { return ctx.catFact(ym, name); }));
    const g3ly = sum(last3LY.map(function (ym) { return ctx.groupFact(ym, g); }));
    const K = g3ly > 0 ? clamp_(g3 / g3ly, 0.7, 1.5) : 1;
    base = gLY * (c3 / g3) * K;
  }
  if (base === null) {
    const months = [1, 2, 3, 4, 5, 6].map(back).filter(function (ym) { return ctx.catSeen(ym, name); });
    if (months.length >= 3) base = sum(months.map(function (ym) { return ctx.catFact(ym, name); })) / months.length;
  }

  if (base === null) {
    return { forecast: Math.round(Math.max(fact, plan)), lowData: true, basis: 'plan' };
  }

  // 2. Темп. Обе формулы сводятся к «факт + (не наступившая доля месяца) × база»:
  //    w × (факт / w) + (1 − w) × база, где w — доля месяца (линейно) или S (кривая).
  const S = ctx.curve(name, ctx.day);
  let value, basis;
  if (S !== null && S < 0.05) {
    value = base; basis = 'season';
  } else if (S !== null) {
    value = S * (fact / S) + (1 - S) * base; basis = 'curve';
  } else {
    const w = ctx.day / ctx.dim;
    const pace = ctx.day > 0 ? fact * ctx.dim / ctx.day : 0;
    value = w * pace + (1 - w) * base; basis = 'linear';
  }
  return { forecast: Math.round(Math.max(fact, value)), lowData: false, basis: basis };
}

/** green / amber / red / none (FR-R3, FR-R7). */
function statusOf_(plan, fact, forecast) {
  if (!(plan > 0)) return 'none';
  if (fact > plan || forecast > plan * 1.1) return 'red';
  if (forecast > plan) return 'amber';
  return 'green';
}

function forecastContext_(y, m, day, dim) {
  const hist = readTable_('history')
    .filter(function (r) { return String(r[1]) === 'expense'; })
    .map(function (r) { return { ym: toYm_(r[0]), cat: String(r[2]), fact: num_(r[4]) }; });
  const ops = readOps_()
    .filter(function (o) { return o.status === 'ok' && o.type === 'expense'; })
    .map(function (o) { return { ym: o.ym, day: Number(Utilities.formatDate(o.date, CFG.TZ, 'd')), cat: o.category, amount: o.amount }; });
  return buildForecastCtx_(y, m, day, dim, hist, readMap_(), ops);
}

function apiReport_(req) {
  const t = today_();
  const ym = req.ym ? parseYm_(req.ym) : { y: t.y, m: t.m };
  if (!ym) throw fail_('bad_ym');
  const key = 'report:' + ymOf_(ym.y, ym.m);
  const cache = CacheService.getScriptCache();
  const hit = cache.get(key);
  if (hit) return JSON.parse(hit);

  const id = findMonthFileId_(ym.y, ym.m);
  if (!id) throw fail_('no_month_file', 'Файла за этот месяц нет');
  const s = readSummary_(SpreadsheetApp.openById(id));
  const isCurrent = ym.y === t.y && ym.m === t.m;
  const dim = daysInMonth_(ym.y, ym.m);
  const day = isCurrent ? t.d : dim;
  const ctx = isCurrent ? forecastContext_(ym.y, ym.m, day, dim) : null;
  const rank = { red: 0, amber: 1, green: 2, none: 3 };

  const categories = s.expense.map(function (c) {
    const f = ctx ? forecastCategory_(c.name, c.plan, c.fact, ctx) : { forecast: c.fact, lowData: false, basis: 'fact' };
    return {
      name: c.name.trim(),
      plan: c.plan,
      fact: c.fact,
      left: c.plan - c.fact,
      pct: c.plan > 0 ? Math.round(c.fact / c.plan * 100) : null,
      forecast: f.forecast,
      lowData: f.lowData,
      basis: f.basis,
      status: statusOf_(c.plan, c.fact, f.forecast),
    };
  }).sort(function (a, b) {
    return (rank[a.status] - rank[b.status]) || ((b.pct || 0) - (a.pct || 0)) || (b.plan - a.plan);
  });

  const total = function (arr, f) { return arr.reduce(function (a, c) { return a + c[f]; }, 0); };
  const prev = addMonths_(ym.y, ym.m, -1);
  const next = addMonths_(ym.y, ym.m, 1);
  const out = {
    ok: true,
    ym: ymOf_(ym.y, ym.m),
    title: CFG.MONTHS[ym.m - 1] + ' ' + ym.y,
    isCurrent: isCurrent,
    day: day,
    daysInMonth: dim,
    expense: {
      plan: total(s.expense, 'plan'),
      fact: total(s.expense, 'fact'),
      left: total(s.expense, 'plan') - total(s.expense, 'fact'),
      forecast: isCurrent ? total(categories, 'forecast') : total(s.expense, 'fact'),
      forecastNote: isCurrent && ctx.appMonths < 2 ? 'уточняется' : null,
    },
    income: {
      plan: total(s.income, 'plan'),
      fact: total(s.income, 'fact'),
      items: s.income.filter(function (c) { return c.fact > 0 || c.plan > 0; })
        .map(function (c) { return { name: c.name.trim(), plan: c.plan, fact: c.fact }; })
        .sort(function (a, b) { return b.fact - a.fact; }),
    },
    categories: categories,
    prev: ymOf_(prev.y, prev.m),
    next: isCurrent ? null : ymOf_(next.y, next.m),
  };
  cache.put(key, JSON.stringify(out), CFG.REPORT_CACHE_SEC);
  return out;
}

/** Раскрытая статья: последние 10 операций и тот же месяц прошлого года (FR-R5). */
function apiCategory_(req) {
  const ym = parseYm_(req.ym);
  const name = String(req.name || '').trim();
  if (!ym || !name) throw fail_('bad_request');
  const id = findMonthFileId_(ym.y, ym.m);
  if (!id) throw fail_('no_month_file', 'Файла за этот месяц нет');
  const ss = SpreadsheetApp.openById(id);
  const sh = opsSheetFor_(ss, ym.m);
  const type = req.type === 'income' ? 'income' : 'expense';
  const cols = type === 'expense' ? CFG.EXPENSE_COLS : CFG.INCOME_COLS;
  const n = sh.getLastRow() - CFG.OPS_FIRST_ROW + 1;
  const rows = n > 0 ? sh.getRange(CFG.OPS_FIRST_ROW, cols.date, n, 4).getValues() : [];
  let lastDate = '';
  const ops = [];
  rows.forEach(function (r) {
    // пустая дата = как в строке выше (так ведут таблицу вручную)
    if (r[0] instanceof Date) lastDate = Utilities.formatDate(r[0], CFG.TZ, 'yyyy-MM-dd');
    else if (String(r[0]).trim()) lastDate = String(r[0]).trim();
    if (String(r[3]).trim() === name && num_(r[1]) !== 0) {
      ops.push({ date: lastDate, amount: num_(r[1]), comment: String(r[2] || '') });
    }
  });
  const ly = ymOf_(ym.y - 1, ym.m);
  const lyRows = readTable_('history').filter(function (r) {
    return toYm_(r[0]) === ly && String(r[1]) === type && String(r[2]).trim() === name;
  });
  return {
    ok: true,
    name: name,
    ops: ops.slice(-10).reverse(),
    lastYear: lyRows.length ? { ym: ly, plan: num_(lyRows[0][3]), fact: num_(lyRows[0][4]) } : null,
  };
}
