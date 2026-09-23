// ZHunter PRO — theme.js (v11 design system: micro-interactions)
// Ripple on buttons, number bump on stat tiles, performance-mode hook. No business logic here.
(function () {
  'use strict';
  const fxOff = () => document.documentElement.dataset.fx === 'off';

  // 1) Ripple — every .btn / .tab-btn / pill press
  document.addEventListener('pointerdown', e => {
    if (fxOff()) return;
    const b = e.target.closest('.btn, .tab-btn, .zh-speed-pill, .tck-filter-chip, .temu-tab');
    if (!b || b.disabled) return;
    const r = b.getBoundingClientRect();
    const size = Math.max(r.width, r.height) * 1.2;
    const s = document.createElement('span');
    s.className = 'zh-ripple';
    s.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX - r.left - size / 2}px;top:${e.clientY - r.top - size / 2}px`;
    b.appendChild(s);
    setTimeout(() => s.remove(), 600);
  }, { passive: true });

  // 2) Number bump — when a stat number changes, pop it
  const bump = el => { if (fxOff()) return; el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); };
  const watch = sel => document.querySelectorAll(sel).forEach(el => {
    let last = el.textContent;
    new MutationObserver(() => { if (el.textContent !== last) { last = el.textContent; bump(el); } }).observe(el, { childList: true, characterData: true, subtree: true });
  });
  const boot = () => {
    // ambient light orbs (background)
    if (!document.querySelector('.zh-orb')) ['zh-orb-1','zh-orb-2','zh-orb-3'].forEach(c => { const o = document.createElement('div'); o.className = 'zh-orb ' + c; document.body.prepend(o); });
    watch('.bulk-stat-num, #totalCount, .tck-sum, #tckBtnUploadCount, .bulk-ring-pct, #bulkRingPct'); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();

  // 3) Performance mode default = OFF now (Premium glass theme) — respect saved choice
  try { chrome.storage.local.get('zhReduceFx', x => { document.documentElement.dataset.fx = x?.zhReduceFx === true ? 'off' : 'full'; }); } catch (_) {}
})();
