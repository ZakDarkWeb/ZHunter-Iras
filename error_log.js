// ============================================================
// ZHunter — side panel error log (19 Oct 2026)
// Many places swallow errors on purpose (closed tab, page not ready …). Real programming bugs
// (TypeError, ReferenceError …) and uncaught errors were hidden the same way. They are now
// recorded here (deduplicated, last 200, storage key zhErrorLog) and shown in
// Settings → Data → "Error log". Expected / harmless errors are ignored.
// Loaded before sidepanel.js. zhQuiet() is safe to call from anywhere (never throws).
// ============================================================
(function () {
  'use strict';
  const KEY = 'zhErrorLog', MAX = 200;
  // errors that are part of normal work (tabs closing, pages not ready, cancelled jobs, the network) — never logged
  const EXPECTED = /no tab with id|tab was closed|receiving end does not exist|could not establish connection|message port closed|extension context invalidated|cannot access (contents of|a chrome)|frame with id|the tab was closed|no window with id|cannot be scripted|chrome-extension:\/\/ url|showing error page|failed to fetch|networkerror|load failed|aborted|aborterror|cancel+ed|timeout|timed out|quota|user denied|not allowed by the user|document is not focused|clipboard|write permission|notallowederror|the user aborted|operation was aborted|invalid url|404|403|rate.?limit/i;
  const BUG_TYPES = new Set(['TypeError', 'ReferenceError', 'RangeError', 'SyntaxError', 'URIError', 'EvalError']);
  let list = [], saveT = null, loaded = false;
  const listeners = new Set();

  try {
    chrome.storage.local.get([KEY], x => {
      const old = Array.isArray(x?.[KEY]) ? x[KEY] : [];
      const byKey = new Map(old.map(e => [e.k, e]));
      for (const e of list) { const o = byKey.get(e.k); if (o) { o.n += e.n; o.t = e.t; } else byKey.set(e.k, e); }   // merge errors that came before the load
      list = [...byKey.values()].sort((a, b) => b.t - a.t).slice(0, MAX);
      loaded = true; notify();
    });
  } catch (_) { loaded = true; }

  function save() {
    clearTimeout(saveT);
    saveT = setTimeout(() => { try { chrome.storage.local.set({ [KEY]: list.slice(0, MAX) }); } catch (_) {} }, 1500);
  }
  function notify() { listeners.forEach(fn => { try { fn(list); } catch (_) {} }); }

  // where in our code: first stack line that is one of our files ("sidepanel.js:12345 temuRunExport")
  function whereOf(err) {
    const st = String(err?.stack || '');
    for (const ln of st.split('\n').slice(1)) {
      const m = ln.match(/at\s+(?:(.*?)\s+\()?.*?\/([\w.-]+\.js):(\d+):\d+\)?/);
      if (m && !/\.min\.js$|^error_log\.js$/.test(m[2])) return `${m[2]}:${m[3]}${m[1] ? ' ' + m[1].replace(/^async\s+/, '') : ''}`;
    }
    return '';
  }

  function record(kind, err, where) {
    try {
      const msg = String(err?.message || err || '').slice(0, 300);
      if (!msg || EXPECTED.test(msg)) return;
      const loc = where || whereOf(err) || '';
      const k = kind + '|' + msg + '|' + loc;
      const now = Date.now();
      const e = list.find(x => x.k === k);
      if (e) { e.n++; e.t = now; list.sort((a, b) => b.t - a.t); }
      else { list.unshift({ k, kind, type: err?.name || '', msg, where: loc, t: now, n: 1 }); if (list.length > MAX) list.length = MAX; }
      save(); notify();
    } catch (_) {}
  }

  // for catch blocks that used to be empty: only real code bugs are kept (expected failures are ignored)
  window.zhQuiet = function (err, where) {
    try { if (err && BUG_TYPES.has(err.name)) record('bug', err, where); } catch (_) {}
  };
  // for places that know the error matters (any type)
  window.zhLogError = function (err, where) { record('error', err, where); };

  window.addEventListener('error', e => {
    if (e.target && e.target !== window) return;   // <img> / resource load errors are handled by their own code
    record('uncaught', e.error || { message: e.message, name: 'Error', stack: '' }, e.filename ? `${String(e.filename).split('/').pop()}:${e.lineno}` : '');
  });
  window.addEventListener('unhandledrejection', e => {
    const r = e.reason;
    record('promise', r instanceof Error ? r : { message: String(r?.message || r || ''), name: r?.name || 'Error', stack: r?.stack || '' });
  });
  // what the code already reports with console.error / console.warn goes into the log too (warnings only when they carry an Error)
  try {
    const oe = console.error.bind(console), ow = console.warn.bind(console);
    console.error = (...a) => { oe(...a); const err = a.find(x => x instanceof Error); record('console', err || { message: a.map(x => typeof x === 'string' ? x : '').join(' ').trim(), name: 'Error', stack: new Error().stack }); };
    console.warn = (...a) => { ow(...a); const err = a.find(x => x instanceof Error); if (err) record('warn', err, (typeof a[0] === 'string' ? a[0].slice(0, 60) : '')); };
  } catch (_) {}

  window.ZhErrorLog = {
    all: () => list.slice(),
    count: () => list.reduce((s, e) => s + e.n, 0),
    clear: () => { list = []; try { chrome.storage.local.set({ [KEY]: [] }); } catch (_) {} notify(); },
    onChange: fn => { listeners.add(fn); if (loaded) fn(list); return () => listeners.delete(fn); },
    text: () => list.map(e => `${new Date(e.t).toLocaleString()}  [${e.kind}${e.type ? ' ' + e.type : ''}] ×${e.n}  ${e.msg}${e.where ? '  @ ' + e.where : ''}`).join('\n')
  };

  // ── Settings → Data → Error log ──
  function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  function render() {
    const box = document.getElementById('zhErrLogList'), cnt = document.getElementById('zhErrLogCount');
    if (!box) return;
    const n = list.length;
    if (cnt) { cnt.textContent = n ? `${n} problem${n > 1 ? 's' : ''}` : 'No problems'; cnt.classList.toggle('has', n > 0); }
    box.innerHTML = n ? list.slice(0, 60).map(e => `<div class="zh-elog-row">
        <div class="zh-elog-top"><span class="zh-elog-kind k-${esc(e.kind)}">${esc(e.kind)}</span><span class="zh-elog-msg">${esc(e.msg)}</span>${e.n > 1 ? `<span class="zh-elog-n">×${e.n}</span>` : ''}</div>
        <div class="zh-elog-sub">${esc(new Date(e.t).toLocaleString())}${e.where ? ' · ' + esc(e.where) : ''}${e.type ? ' · ' + esc(e.type) : ''}</div>
      </div>`).join('') + (n > 60 ? `<div class="zh-elog-sub">… ${n - 60} more (Copy gives all)</div>` : '')
      : '<div class="zh-elog-empty">✓ No problems recorded</div>';
  }
  function bind() {
    window.ZhErrorLog.onChange(render);
    document.addEventListener('click', async e => {
      if (e.target.closest('#zhErrLogCopy')) {
        const t = window.ZhErrorLog.text() || 'No problems recorded';
        try { await navigator.clipboard.writeText(t); typeof toast === 'function' && toast('Error log copied — paste it to the developer', 'ok'); } catch (_) {}
      }
      if (e.target.closest('#zhErrLogClear')) { window.ZhErrorLog.clear(); typeof toast === 'function' && toast('Error log cleared', 'ok'); }
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind); else bind();
})();
