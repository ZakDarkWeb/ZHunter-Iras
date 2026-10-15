// ============================================================
// ZHunter v8.0 — Side panel shell glue
// Runs after sidepanel.js. Wires the new 4-tab layout onto the
// existing controllers without changing their logic.
// ============================================================
'use strict';

// Animations are OFF by default (they kept Chrome busy: ~7% CPU idle vs ~0.2% off in a measurement).
// To get the glow back: in the panel's console run  chrome.storage.local.set({zhFx:'full'})  (or 'subtle'), then Reload.
try { chrome.storage.local.get('zhFx', r => { const v = r && r.zhFx; if (v === 'full' || v === 'subtle' || v === 'off') document.documentElement.dataset.fx = v; }); } catch (_) {}

(function () {
  const $ = id => document.getElementById(id);
  const $$ = sel => [...document.querySelectorAll(sel)];

  // ── Tab hooks ───────────────────────────────────────────────
  // Hunt tab (data-tab="images") also scans videos; Library loads the master sheet.
  document.querySelector('#tab-btn-images')?.addEventListener('click', () => {
    if (typeof scanVideos === 'function' && typeof VidTabState !== 'undefined' && !VidTabState.videos.length && !VidTabState.isScanning) {
      setTimeout(() => scanVideos(), 200);
    }
  });
  document.querySelector('#tab-btn-library')?.addEventListener('click', () => {
    if (typeof updateMasterStats === 'function') updateMasterStats();
  });
  document.querySelector('#tab-btn-bulk')?.addEventListener('click', () => {
    if (typeof loadBulkQueue === 'function') loadBulkQueue();
  });

  // ── Export dropdowns ────────────────────────────────────────
  function closeMenus() { $$('.menu.open').forEach(m => m.classList.remove('open')); }
  [['queueExportMenuBtn', 'queueExportMenu'], ['masterExportMenuBtn', 'masterExportMenu']].forEach(([btnId, menuId]) => {
    const btn = $(btnId), menu = $(menuId);
    if (!btn || !menu) return;
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const open = menu.classList.contains('open');
      closeMenus();
      if (!open) menu.classList.add('open');
    });
    menu.querySelectorAll('button').forEach(b => b.addEventListener('click', closeMenus));
  });
  document.addEventListener('click', e => { if (!e.target.closest('.dd')) closeMenus(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenus(); });

  // Enable the Export menu button whenever any item inside becomes enabled.
  function watchMenuEnable(menuId, btnId) {
    const menu = $(menuId), btn = $(btnId);
    if (!menu || !btn) return;
    const sync = () => { btn.disabled = ![...menu.querySelectorAll('button')].some(b => !b.disabled); };
    new MutationObserver(sync).observe(menu, { attributes: true, subtree: true, attributeFilter: ['disabled'] });
    sync();
  }
  watchMenuEnable('queueExportMenu', 'queueExportMenuBtn');
  watchMenuEnable('masterExportMenu', 'masterExportMenuBtn');

  // ── "Add to queue" → review dialog on the live bulk queue ──
  const addBtn = $('bulkAddAllTabsToQueueBtn');
  if (addBtn && typeof showQueueImportPreview === 'function') {
    const fresh = addBtn.cloneNode(true);          // drops the direct-add listener from sidepanel.js
    addBtn.replaceWith(fresh);
    fresh.addEventListener('click', async () => {
      if (typeof loadBulkTabs === 'function') await loadBulkTabs();
      const tabs = (typeof BulkState !== 'undefined' && Array.isArray(BulkState.tabs)) ? BulkState.tabs : [];
      const candidates = tabs.filter(t => t?.url && /^https?:/i.test(t.url)).map(t => ({ url: t.url, title: t.title || '', source: 'open_tab' }));
      if (!candidates.length) { toast('No web tabs open in this window.', 'warn'); return; }
      await showQueueImportPreview(candidates, 'open_tab', {
        previewAction: 'PREVIEW_BULK_QUEUE',
        adder: async items => {
          const res = await msg({ action: 'ADD_BULK_QUEUE_ITEMS', items: items.map(i => ({ url: i.url, title: i.title })) });
          if (typeof loadBulkQueue === 'function') await loadBulkQueue();
          toast(`${res?.addedCount || 0} added to the queue`, res?.success ? 'ok' : 'err');
          return res || { success: false, addedCount: 0 };
        }
      });
    });
  }

  // ── Queue badge + auto-open the "Paste links" section when it has items ──
  let queueAutoOpened = false;
  function syncBulkBadge() {
    if (typeof QueueState === 'undefined') return;
    const n = (QueueState.items || []).filter(i => !i.hunted && i.status !== 'complete').length;
    const tabEl = $('bulkTabCount'); if (tabEl) tabEl.textContent = n ? String(n) : '';
    const badge = $('bulkQueueBadge'); if (badge) badge.textContent = n ? `${n} waiting` : '';
    const det = $('bulkQueueDetails');
    if (det && n && !queueAutoOpened) { det.open = true; queueAutoOpened = true; }
  }
  // Clicking "Paste links instead" focuses the input.
  $('bulkQueueDetails')?.addEventListener('toggle', e => { if (e.target.open) setTimeout(() => $('queueAddInput')?.focus(), 50); });
  const queueList = $('bulkQueueList');
  if (queueList) new MutationObserver(syncBulkBadge).observe(queueList, { childList: true });


  // ── Store tags: tag text → data-plat so CSS can color them ──
  function tagPlatforms(root) {
    root.querySelectorAll('.bulk-tab-platform, .master-row-platform, .bulk-prog-platform').forEach(el => {
      const t = (el.textContent || '').trim().toLowerCase();
      if (t && t !== '?' && !el.dataset.plat) el.dataset.plat = t;
    });
  }
  tagPlatforms(document);
  new MutationObserver(muts => muts.forEach(m => m.addedNodes.forEach(n => { if (n.nodeType === 1) tagPlatforms(n); }))).observe(document.body, { childList: true, subtree: true });


  // ── Quick settings (side panel) → same keys as the full settings page ──
  // ── Settings tab ────────────────────────────────────────────
  function syncThemeSeg() {
    const light = document.body.classList.contains('light-mode');
    $$('#themeSeg button').forEach(b => b.classList.toggle('on', b.dataset.theme === (light ? 'light' : 'dark')));
  }
  $('themeSeg')?.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    const light = document.body.classList.contains('light-mode');
    if ((b.dataset.theme === 'light') !== light) $('themeToggleBtn')?.click();
    setTimeout(syncThemeSeg, 50);
  });
  new MutationObserver(syncThemeSeg).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  syncThemeSeg();
  // ── In-panel Data Management ──────────────────────────────
  const nav = document.querySelector('.tab-nav');
  function moveIndicator() {
    const a = nav?.querySelector('.tab-btn.active:not(.hidden)');
    if (!nav || !a) return;
    nav.classList.add('has-indicator');
    const nr = nav.getBoundingClientRect(), r = a.getBoundingClientRect();
    nav.style.setProperty('--tab-x', `${r.left - nr.left + r.width * 0.22}px`);
    nav.style.setProperty('--tab-w', `${r.width * 0.56}px`);
  }
  nav?.addEventListener('click', () => setTimeout(moveIndicator, 0));
  window.addEventListener('resize', moveIndicator);
  setTimeout(moveIndicator, 50);

  // ── Count-up on the hunt-complete stats ─────────────────────
  function countUp(el) {
    const target = parseInt(el.textContent, 10);
    if (!Number.isFinite(target) || target === 0 || document.documentElement.dataset.fx === 'off') return;
    const t0 = performance.now(), dur = 600;
    const step = now => { const p = Math.min(1, (now - t0) / dur); el.textContent = String(Math.round(target * (1 - Math.pow(1 - p, 3)))); if (p < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }
  const summary = $('bulkResultSummary');
  if (summary) new MutationObserver(() => { if (!summary.classList.contains('hidden')) ['bulkRsOk','bulkRsPartial','bulkRsFail'].forEach(id => { const el = $(id); if (el) countUp(el); }); })
    .observe(summary, { attributes: true, attributeFilter: ['class'] });

  // ── Live status line while hunting ──────────────────────────
  const progText = $('bulkProgText');
  if (progText) new MutationObserver(() => {
    const t = $('statusLineText'); if (!t) return;
    const modalOpen = !$('bulkProgressModal')?.classList.contains('hidden');
    if (modalOpen && progText.textContent.trim()) t.textContent = `Hunting ${progText.textContent.trim()}`;
    else syncStatus();
  }).observe(progText, { childList: true, characterData: true, subtree: true });

  // ── Status line ─────────────────────────────────────────────
  async function syncStatus() {
    try {
      const bytes = await chrome.storage.local.getBytesInUse(null);
      const mb = bytes / 1048576;
      const size = mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
      const t = $('statusLineText'); if (t) t.textContent = `Local · ${size}`;
    } catch (_) {}
  }
  syncStatus();
  setInterval(syncStatus, 30000);
})();
