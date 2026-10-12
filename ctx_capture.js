/* ZHunter — right-click helper (v9.15)
 * Remembers which product links sit around the element you right-clicked, so
 * "Add to queue" works even when you click the price / badge / empty part of a product card
 * (not only the title or picture). Passive: it only reads links, never clicks or changes the page.
 */
(function () {
  'use strict';
  if (window.__zhCtxInstalled) return;
  window.__zhCtxInstalled = true;
  const textOf = (a) => {
    const t = (a.getAttribute('aria-label') || a.getAttribute('title') || a.innerText || a.querySelector('img[alt]')?.alt || '').replace(/\s+/g, ' ').trim();
    return t.slice(0, 200);
  };
  document.addEventListener('contextmenu', (ev) => {
    try {
      const levels = [];
      let el = ev.target instanceof Element ? ev.target : null;
      for (let depth = 0; el && depth < 12 && el !== document.body && el !== document.documentElement; depth++, el = el.parentElement) {
        const list = [];
        const self = el.matches('a[href]') ? [el] : [];
        const kids = Array.from(el.querySelectorAll('a[href]')).slice(0, 40);
        for (const a of [...self, ...kids]) {
          const href = a.href;
          if (!/^https?:/i.test(href)) continue;
          if (!list.some(x => x.href === href)) list.push({ href, text: textOf(a) });
        }
        if (list.length) levels.push(list);
        if (levels.length >= 6) break;
      }
      window.__zhCtx = { t: Date.now(), levels };
    } catch (_) { window.__zhCtx = { t: Date.now(), levels: [] }; }
  }, true);
})();
