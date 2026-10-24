/**
 * Точка входа веб-приложения.
 *
 * Все запросы — POST с телом JSON и заголовком Content-Type: text/plain
 * (так браузер не делает предварительный CORS-запрос, который Apps Script не обслуживает).
 *
 *   { token, action: 'ping' }
 *   { token, action: 'categories', ym? }
 *   { token, action: 'add', clientId, type: 'expense'|'income', category, amount, comment?, date? }
 *   { token, action: 'undo', clientId }
 *   { token, action: 'report', ym? }
 *   { token, action: 'category', ym, name, type? }
 *
 * Ответ всегда JSON: { ok: true, ... } или { ok: false, code, message }.
 */

function doGet() {
  return json_({ ok: true, service: 'budget', hint: 'POST JSON' });
}

function doPost(e) {
  let req;
  try {
    req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({ ok: false, code: 'bad_json' });
  }
  const action = String(req.action || '');
  try {
    if (!checkToken_(req.token)) {
      logEvent_('warn', 'auth', 'Неверный код доступа, действие: ' + action);
      return json_({ ok: false, code: 'unauthorized', message: 'Нужно заново ввести код доступа' });
    }
    switch (action) {
      case 'ping': return json_({ ok: true, today: ymOf_(today_().y, today_().m) });
      case 'categories': return json_(apiCategories_(req));
      case 'add': return json_(apiAdd_(req));
      case 'undo': return json_(apiUndo_(req));
      case 'report': return json_(apiReport_(req));
      case 'category': return json_(apiCategory_(req));
      default: return json_({ ok: false, code: 'unknown_action' });
    }
  } catch (err) {
    if (err && err.userCode) return json_({ ok: false, code: err.userCode, message: err.message });
    logEvent_('error', action, (err && err.stack) || String(err));
    return json_({ ok: false, code: 'server_error', message: 'Ошибка на сервере, попробуйте позже' });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** Сравнение без раннего выхода. */
function checkToken_(token) {
  const real = prop_('TOKEN');
  if (!real || typeof token !== 'string' || token.length !== real.length) return false;
  let diff = 0;
  for (let i = 0; i < real.length; i++) diff |= real.charCodeAt(i) ^ token.charCodeAt(i);
  return diff === 0;
}
