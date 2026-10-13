/* ZHunter — Temu seller page data recorder (v9.15)
 * Runs inside the Temu seller page. Only COPIES the JSON answers the page already receives
 * (product images / description) into a hidden <template>, so "Store export" can read them accurately.
 * It never sends anything anywhere and never changes the page.
 */
(function () {
  'use strict';
  if (window.__zhNetHook) return;
  window.__zhNetHook = true;
  const HINT = /goodsId|goods_id|carousel|imageUrl|hdThumbUrl|skuList|goodsDesc|bulletPoints|thumbUrl/i;
  let box = null;
  const getBox = () => {
    if (box && box.isConnected) return box;
    box = document.getElementById('zh-net-box');
    if (!box) {
      box = document.createElement('template');
      box.id = 'zh-net-box';
      (document.documentElement || document).appendChild(box);
    }
    return box;
  };
  const keep = (u, text) => {
    try {
      if (!text || text.length > 900000) return;
      const c = text.charCodeAt(0);
      if (c !== 123 && c !== 91) return; // { or [
      if (!HINT.test(text)) return;
      const b = getBox();
      const el = document.createElement('i');
      el.setAttribute('data-u', String(u || '').slice(0, 300));
      el.textContent = text;
      b.content.appendChild(el);
      while (b.content.childNodes.length > 60) b.content.removeChild(b.content.firstChild);
    } catch (_) {}
  };
  // "Store export": while the extension presses Temu's own "Copy Listing", keep the link Temu wants to open
  // (Chrome would block the popup because the click is scripted) — the extension opens that exact link itself.
  try {
    const oo = window.open;
    window.open = function (u) {
      try {
        const de = document.documentElement;
        if (de && de.getAttribute('data-zc-capture') === '1') {
          de.setAttribute('data-zc-url', String(u || ''));
          return { closed: true, focus() {}, close() {}, location: {} };
        }
      } catch (_) {}
      return oo.apply(this, arguments);
    };
  } catch (_) {}
  // Some rows (e.g. "Incomplete" products) open the copy page through a link click instead of window.open — capture that too.
  try {
    document.addEventListener('click', (e) => {
      try {
        const de = document.documentElement;
        if (!de || de.getAttribute('data-zc-capture') !== '1') return;
        const a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
        const h = a && a.getAttribute('href');
        if (h && !/^(#|javascript:)/i.test(h)) { e.preventDefault(); e.stopPropagation(); de.setAttribute('data-zc-url', h); }
      } catch (_) {}
    }, true);
    const ac = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      try {
        const de = document.documentElement; const h = this.getAttribute('href');
        if (de && de.getAttribute('data-zc-capture') === '1' && h && !/^(#|javascript:)/i.test(h)) { de.setAttribute('data-zc-url', h); return; }
      } catch (_) {}
      return ac.apply(this, arguments);
    };
  } catch (_) {}
  // The page's own "Leave site?" warning is skipped only while the extension closes its helper tab (data-zc-closing)
  try {
    const oa = EventTarget.prototype.addEventListener, orm = EventTarget.prototype.removeEventListener, map = new WeakMap();
    EventTarget.prototype.addEventListener = function (type, fn, opt) {
      if (type === 'beforeunload' && typeof fn === 'function' && this === window) {
        let w = map.get(fn);
        if (!w) { w = function () { try { if (document.documentElement.getAttribute('data-zc-closing') === '1') return; } catch (_) {} return fn.apply(this, arguments); }; map.set(fn, w); }
        return oa.call(this, type, w, opt);
      }
      return oa.apply(this, arguments);
    };
    EventTarget.prototype.removeEventListener = function (type, fn, opt) {
      if (type === 'beforeunload' && typeof fn === 'function' && map.has(fn)) return orm.call(this, type, map.get(fn), opt);
      return orm.apply(this, arguments);
    };
  } catch (_) {}
  try {
    const of = window.fetch;
    if (of) {
      window.fetch = function () {
        const p = of.apply(this, arguments);
        try {
          const a0 = arguments[0];
          const u = typeof a0 === 'string' ? a0 : (a0 && a0.url) || '';
          p.then(r => { try { r.clone().text().then(t => keep(u, t)).catch(() => {}); } catch (_) {} }).catch(() => {});
        } catch (_) {}
        return p;
      };
    }
    const X = XMLHttpRequest.prototype, oo = X.open, os = X.send;
    X.open = function (m, u) { try { this.__zu = u; } catch (_) {} return oo.apply(this, arguments); };
    X.send = function () {
      try {
        this.addEventListener('load', () => {
          try { if (this.responseType === '' || this.responseType === 'text') keep(this.__zu, this.responseText); } catch (_) {}
        });
      } catch (_) {}
      return os.apply(this, arguments);
    };
  } catch (_) {}
})();
