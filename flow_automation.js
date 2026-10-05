// ═════════════════════════════════════════════════════════════════
// ZHunter PRO — Google Flow (flow.google.com) Automation Engine  v9.9.0
// ═════════════════════════════════════════════════════════════════
// One job = one product image. Strict order, every step verified:
//   1. prepare  → Agent OFF, settings = Image · 1:1 · x1, prompt box cleared
//   2. image    → product image attached as a prompt INGREDIENT (chip ready)
//   3. prompt   → prompt text pasted
//   4. generate → trusted (CDP) click on "Start generation", start confirmed
//   5. result   → the NEW tile that has a "Reuse prompt" button (= generated,
//                 never an upload) is sent back with the same jobId
// The side panel only accepts a result whose jobId matches its current step.

(() => {
  'use strict';

  if (window.__zhunterFlowLoaded) {
    window.__zhunterFlowExecute?.();
    return;
  }
  window.__zhunterFlowLoaded = true;

  const TAG = '[ZHunter Flow]';
  const log = (...a) => console.log(TAG, ...a);
  const warn = (...a) => console.warn(TAG, ...a);
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  let activeJob = null;
  let manualBusy = false;
  class JobCancelled extends Error {}
  function checkCurrentJob() {
    if (activeJob && latestPending && (latestPending.jobId !== activeJob.jobId || latestPending.processed)) throw new JobCancelled('Job stopped');
    if (activeJob?.projectUrl && activeJob.projectUrl !== location.href.split('?')[0].split('#')[0]) throw new JobError('Flow project changed — batch stopped for manual review');
  }
  async function checkpoint() {
    if (!activeJob) return;
    latestPending = (await chrome.storage.local.get('pendingFlowAction')).pendingFlowAction;
    if (!latestPending) throw new JobCancelled('Job removed');
    checkCurrentJob();
  }
  async function pace(min = 500, max = 1500) {
    const until = Date.now() + min + Math.floor(Math.random() * (max - min + 1));
    while (Date.now() < until) { checkCurrentJob(); await sleep(Math.min(100, until - Date.now())); }
    await checkpoint();
  }

  const ATTACH_TIMEOUT_MS = 60000;   // image upload into the chip
  const START_TIMEOUT_MS = 20000;    // generation must visibly start within this
  const RESULT_TIMEOUT_MS = 180000;  // generated image must arrive within this
  const STALE_JOB_MS = 10 * 60000;   // ignore jobs older than this that never started

  log('Automation script initialized on', location.href);

  // ── Generic helpers ──────────────────────────────────────────────
  function isShown(el) {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  async function waitFor(fn, timeoutMs = 8000, intervalMs = 250) {
    const end = Date.now() + timeoutMs;
    for (;;) {
      checkCurrentJob();
      let v = null;
      try { v = fn(); } catch (e) { if (e instanceof JobCancelled) throw e; v = null; }
      if (v) return v;
      if (Date.now() >= end) return null;
      await sleep(intervalMs);
    }
  }

  function sendBg(message) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(message, (res) => {
          if (chrome.runtime.lastError) return resolve({ ok: false, error: chrome.runtime.lastError.message });
          resolve(res || {});
        });
      } catch (e) {
        resolve({ ok: false, error: e?.message || String(e) });
      }
    });
  }

  // DOM pointer events for ordinary controls; Generate uses the worker's guarded CDP click.
  async function trustedClick(el, label = '') {
    await checkpoint();
    if (!el || !el.isConnected) return false;
    try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch (_) {}
    await sleep(80);
    const box = el.getBoundingClientRect();
    if (!box.width || !box.height) return false;
    const x = box.left + box.width / 2;
    const y = box.top + box.height / 2;
    const opts = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0, buttons: 1, composed: true };
    try { el.dispatchEvent(new PointerEvent('pointerdown', { ...opts, pointerType: 'mouse', isPrimary: true })); } catch (_) {}
    try { el.dispatchEvent(new MouseEvent('mousedown', opts)); } catch (_) {}
    try { el.focus(); } catch (_) {}
    try { el.dispatchEvent(new PointerEvent('pointerup', { ...opts, buttons: 0, pointerType: 'mouse', isPrimary: true })); } catch (_) {}
    try { el.dispatchEvent(new MouseEvent('mouseup', { ...opts, buttons: 0 })); } catch (_) {}
    // v9.10.1 — exactly ONE click. Before, a dispatched click + el.click() fired twice:
    // the settings popover opened and closed again, toggles flipped back, generate ran twice.
    let sent = false;
    try { sent = el.dispatchEvent(new MouseEvent('click', { ...opts, buttons: 0 })) || true; } catch (_) {}
    if (!sent) { try { el.click(); } catch (_) {} }
    return true;
  }

  function dataUrlToFile(dataUrl, filename = 'zhunter_product.png') {
    try {
      const [head, body] = dataUrl.split(',');
      const mime = head.match(/:(.*?);/)?.[1] || 'image/png';
      const bin = atob(body);
      const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      const ext = (mime.split('/')[1] || 'png').replace('jpeg', 'jpg');
      return new File([u8], filename.replace(/\.\w+$/, '') + '.' + ext, { type: mime });
    } catch (e) {
      warn('dataUrlToFile error:', e);
      return null;
    }
  }

  // Flow accepts PNG/JPEG/WEBP/GIF/HEIF only — Walmart & co. often serve AVIF.
  // Re-encode anything else to PNG before it ever reaches Flow.
  async function ensureSupportedImage(file) {
    if (!file) return null;
    if (/^image\/(png|jpe?g|webp)$/i.test(file.type)) return file;
    try {
      const bmp = await createImageBitmap(file);
      const c = document.createElement('canvas');
      c.width = bmp.width; c.height = bmp.height;
      c.getContext('2d').drawImage(bmp, 0, 0);
      try { bmp.close(); } catch (_) {}
      const blob = await new Promise(res => c.toBlob(res, 'image/png'));
      if (!blob) return null;
      log(`Converted ${file.type || 'unknown'} → image/png`);
      return new File([blob], file.name.replace(/\.\w+$/, '') + '.png', { type: 'image/png' });
    } catch (e) {
      warn('Image conversion failed:', e);
      return null;
    }
  }

  // Flow shows upload problems in a small card with a "Dismiss" button.
  const FLOW_ERR_RE = /(unsupported file type|upload failed|couldn.?t upload|could not upload|file is too large|too large to upload)/i;
  function flowErrorEl() {
    const btn = Array.from(document.querySelectorAll('button')).find(b =>
      /^\s*dismiss\s*$/i.test(b.textContent || '') && FLOW_ERR_RE.test(b.parentElement?.parentElement?.textContent || b.parentElement?.textContent || ''));
    if (btn) return { btn, text: (btn.parentElement?.parentElement?.textContent || '').replace(/\s*dismiss\s*$/i, '').replace(/\s+/g, ' ').trim() };
    const s = snackText();
    return s && FLOW_ERR_RE.test(s) ? { btn: null, text: s } : null;
  }
  async function dismissFlowError() {
    const e = flowErrorEl();
    if (e?.btn) await trustedClick(e.btn, 'dismiss error');
  }

  // ── Flow DOM (from real DOM harvests, Sep 2026) ─────────────────
  const Q = {
    // v9.10.1 — never use the Agent chat panel's prompt box (flow-agent-panel): a submit
    // there goes to the Agent chat (and waits for "confirm"), not to image generation.
    promptRoot: () =>
      document.querySelector('flow-prompt-box flow-base-prompt-box') ||
      Array.from(document.querySelectorAll('flow-base-prompt-box')).find(el => !el.closest('flow-agent-panel')) || null,
    editor: (root) => root?.querySelector('.ProseMirror'),
    agentChip: () => document.querySelector('flow-agent-mode-toggle-chip button.agent-mode-chip') ||
      document.querySelector('flow-agent-mode-toggle-chip button[aria-pressed]'),
    agentPanel: () => { const p = document.querySelector('flow-agent-panel'); return p && isShown(p) ? p : null; },
    clearBtn: (root) => root?.querySelector('button[aria-label="Clear prompt"]'),
    chips: (root) => Array.from(root?.querySelectorAll('flow-image-ingredient-chip button.chip-container') || []),
    genBtn: (root) => root?.querySelector('flow-generate-icon-button button[aria-label="Start generation"]'),
    settingsBtn: (root) => root?.querySelector('button.settings-trigger-button'),
    addMenuBtn: (root) => root?.querySelector('button.add-menu-trigger'),
    tiles: () => Array.from(document.querySelectorAll('flow-grid-tile-container')),
    scroller: () => document.querySelector('.cdk-virtual-scrollable.page-container'),
    newProjectBtn: () =>
      document.querySelector('button.new-project-button') ||
      Array.from(document.querySelectorAll('button')).find(b => /new project/i.test(b.textContent || ''))
  };

  const isDisabled = (btn) =>
    !btn || btn.disabled || btn.getAttribute('disabled') === 'true' || btn.classList.contains('mat-mdc-button-disabled');

  const editorText = (root) => (Q.editor(root)?.textContent || '').trim();

  function tileInfo(tile) {
    const img = tile.querySelector('img[data-media-id]');
    return {
      tile,
      mediaId: img?.getAttribute('data-media-id') || '',
      src: img?.currentSrc || img?.src || '',
      pending: !!tile.querySelector('flow-pending-tile'),
      // Generated media carries a "Reuse prompt" action; uploads never do.
      generated: !!tile.querySelector('button[aria-label="Reuse prompt"]'),
      title: (tile.getAttribute('aria-label') || '').trim()
    };
  }

  const allTiles = () => Q.tiles().map(tileInfo);

  // v9.10.1 — every Flow media <img> in the grid, whatever the tile markup looks like
  // (Flow ships different builds per account). Id comes from the signed URL /image/<id>.
  const FLOW_IMG_RE = /^https:\/\/flow-content\.google\/image\/([\w-]+)/i;
  function gridImages() {
    return Array.from(document.querySelectorAll('img')).map(img => {
      const src = img.currentSrc || img.src || '';
      const m = src.match(FLOW_IMG_RE);
      if (!m) return null;
      if (img.closest('flow-base-prompt-box, flow-add-menu-popover-content, flow-agent-panel, .cdk-overlay-container, #zh-flow-hud')) return null;
      const holder = img.closest('flow-grid-tile-container, [aria-label]');
      return {
        img, src, mediaId: img.getAttribute('data-media-id') || m[1],
        title: (holder?.getAttribute('aria-label') || '').trim(),
        generated: !!img.closest('flow-grid-tile-container')?.querySelector('button[aria-label="Reuse prompt"]'),
        loaded: img.complete && img.naturalWidth > 0
      };
    }).filter(Boolean);
  }
  const looksLikeUpload = (title) => /\.(png|jpe?g|webp|gif|avif|heic)$/i.test(title || '') || /^zhunter_/i.test(title || '');
  const pendingCount = () => allTiles().filter(t => t.pending).length;
  function generationFailureText(tile) {
    const txt = (tile.textContent || '').replace(/\s+/g, ' ').trim();
    return /failed/i.test(txt) && /unusual activity|help center|charged|could not|couldn|polic|violat/i.test(txt) ? txt : '';
  }
  function failureCounts(tiles) {
    const counts = new Map();
    for (const tile of tiles) {
      const text = generationFailureText(tile);
      if (text) counts.set(text, (counts.get(text) || 0) + 1);
    }
    return counts;
  }
  function newFailureText(tiles, baseline) {
    for (const [text, count] of failureCounts(tiles)) {
      if (count > (baseline.get(text) || 0)) return text;
    }
    return '';
  }
  const mediaIdSet = () => new Set(allTiles().map(t => t.mediaId).filter(Boolean));

  function scrollGridTop() {
    const sc = Q.scroller();
    if (sc) sc.scrollTop = 0;
  }

  function snackText() {
    const s = document.querySelector('.mat-mdc-snack-bar-label, simple-snack-bar, mat-snack-bar-container');
    return (s?.textContent || '').trim();
  }

  // ── HUD on the Flow page ─────────────────────────────────────────
  function updateFlowHUD(msg, type = 'info', actionBtn = null) {
    let hud = document.getElementById('zh-flow-hud');
    if (!hud) {
      hud = document.createElement('div');
      hud.id = 'zh-flow-hud';
      hud.style.cssText = `
        position: fixed; top: 14px; right: 18px; z-index: 2147483647;
        background: linear-gradient(135deg, rgba(2, 6, 23, 0.96), rgba(11, 25, 44, 0.94));
        border: 1px solid #00E5FF;
        box-shadow: 0 10px 30px rgba(0,0,0,0.85), 0 0 20px rgba(0,229,255,0.35);
        border-radius: 12px; padding: 10px 16px; color: #F8FAFC;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 13px; font-weight: 600; display: flex; align-items: center; gap: 12px;
        max-width: 460px; pointer-events: auto; backdrop-filter: blur(8px);
        transition: opacity 0.3s, transform 0.3s;
      `;
      document.body.appendChild(hud);
    }
    hud.style.opacity = '1';
    hud.style.transform = 'none';
    const icon = type === 'ok' ? '✓' : type === 'warn' ? '⚠️' : '⚡';
    const iconColor = type === 'ok' ? '#10B981' : type === 'warn' ? '#F59E0B' : '#00E5FF';
    hud.textContent = '';
    const i = document.createElement('span');
    i.style.cssText = `color:${iconColor};font-size:15px;display:inline-flex;align-items:center;`;
    i.textContent = icon;
    const t = document.createElement('span');
    t.style.letterSpacing = '0.2px';
    t.textContent = msg;
    hud.append(i, t);
    if (actionBtn) {
      const b = document.createElement('button');
      b.textContent = actionBtn.label;
      b.style.cssText = 'background:#00E5FF;color:#020617;border:none;border-radius:6px;padding:4px 10px;font-size:12px;font-weight:700;cursor:pointer;margin-left:6px;';
      b.onclick = actionBtn.onClick;
      hud.appendChild(b);
    }
    clearTimeout(hud._hideT);
    if (type === 'ok') {
      hud._hideT = setTimeout(() => { hud.style.opacity = '0'; hud.style.transform = 'translateY(-10px)'; }, 5000);
    }
  }

  // ── Job reporting ────────────────────────────────────────────────
  function reportStatus(job, phase, text, isError = false, extra = {}) {
    updateFlowHUD(text, isError ? 'warn' : 'info');
    sendBg({ action: 'ZH_FLOW_STATUS', jobId: job.jobId, productId: job.productId, imageIndex: job.imageIndex, projectUrl: location.href.split('?')[0].split('#')[0], phase, text, error: isError, ...extra });
  }

  // v9.10.1 — latest job record seen in storage: lets a running job stop waiting as soon as
  // the side panel has taken the result (or a newer job replaced it).
  let latestPending = null;

  async function finishJob(job, status, extra = {}) {
    try {
      const cur = (await chrome.storage.local.get(['pendingFlowAction']))?.pendingFlowAction;
      if (cur && cur.jobId === job.jobId && cur.status !== 'cancelled') {
        await chrome.storage.local.set({ pendingFlowAction: { ...cur, processed: true, status, finishedAt: Date.now(), ...extra } });
      }
    } catch (_) {}
  }

  class JobError extends Error {}

  // ── Step 1: prepare the prompt box ──────────────────────────────
  // v9.10.1 — Agent mode has two parts: the "Agent" chip in the prompt box and the Agent chat
  // panel ("Untitled session"). While the panel is open the normal prompt box is gone.
  // Close the panel, then switch the chip off; fall back to a real (CDP) click if needed.
  const agentOn = () => !!Q.agentPanel() || Q.agentChip()?.getAttribute('aria-pressed') === 'true' ||
    !!document.querySelector('flow-prompt-box flow-creative-agent-prompt-box');

  async function cdpClickEl(el) {
    await checkpoint();
    if (!el || !el.isConnected) return false;
    try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch (_) {}
    await sleep(120);
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    const res = await sendBg({ action: 'ZH_CDP_CLICK', x: r.left + r.width / 2, y: r.top + r.height / 2 });
    sendBg({ action: 'ZH_CDP_DETACH' });
    return !!res?.ok;
  }

  async function clickUntil(el, done, label, ms = 3000) {
    await trustedClick(el, label);
    if (await waitFor(done, ms, 200)) return true;
    warn(`${label}: page click ignored — trying trusted click`);
    await cdpClickEl(el);
    return !!(await waitFor(done, ms, 200));
  }

  async function ensureAgentOff() {
    for (let attempt = 0; attempt < 3 && agentOn(); attempt++) {
      const panel = Q.agentPanel();
      if (panel) {
        log('Agent panel open — closing it');
        const back = panel.querySelector('.agent-panel-header button[aria-label="Back"]');
        if (back) { await trustedClick(back, 'agent back'); await sleep(400); }
        const close = Q.agentPanel()?.querySelector('.agent-panel-header button[aria-label="Close"]');
        if (close) await clickUntil(close, () => !Q.agentPanel(), 'agent panel close', 4000);
        await sleep(500);
      }
      const chip = Q.agentChip();
      if (chip && chip.getAttribute('aria-pressed') === 'true') {
        log('Agent mode is ON — turning it off');
        await clickUntil(chip, () => Q.agentChip()?.getAttribute('aria-pressed') === 'false', 'agent chip', 4000);
        await sleep(600);
      }
    }
    if (agentOn()) throw new JobError('Agent mode band nahi hua — Flow mein Agent panel band karke "Agent" chip khud off kar dein');
  }

  function settingsSummary(root) {
    return (Q.settingsBtn(root)?.textContent || '').replace(/\s+/g, ' ').trim();
  }

  async function pickToggle(groupLabel, text) {
    const find = () => {
      const group = document.querySelector(`flow-prompt-box-settings flow-toggles[aria-label="${groupLabel}"]`);
      return Array.from(group?.querySelectorAll('button.mat-button-toggle-button') || [])
        .find(b => (b.textContent || '').replace(/\s+/g, ' ').includes(text)) || null;
    };
    const btn = find();
    if (!btn) { warn(`Setting not found: ${groupLabel} ${text}`); return false; }
    if (btn.getAttribute('aria-checked') === 'true') return true;
    return clickUntil(btn, () => find()?.getAttribute('aria-checked') === 'true', `${groupLabel} ${text}`, 2500);
  }

  // Nano Banana 2 Lite is a different model; never accept it as Nano Banana 2.
  const correctModel = (sum) => /\bnano banana 2\b/i.test(sum) && !/\bnano banana 2\s*lite\b/i.test(sum);
  const settingsOk = (sum) => correctModel(sum) && /crop_square|\b1\s*:\s*1\b/.test(sum) && /\bx1\b/.test(sum);
  const settingsPanel = () => document.querySelector('flow-prompt-box-settings');

  async function closeSettings() {
    if (!settingsPanel()) return;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
    if (await waitFor(() => !settingsPanel(), 800, 100)) return;
    const backdrop = document.querySelector('.cdk-overlay-backdrop');
    if (backdrop) await trustedClick(backdrop, 'settings backdrop');
    if (await waitFor(() => !settingsPanel(), 800, 100)) return;
    const b = Q.settingsBtn(Q.promptRoot());
    if (b) await clickUntil(b, () => !settingsPanel(), 'settings (close)', 1500);
  }

  async function ensureSettings() {
    for (let attempt = 1; attempt <= 2; attempt++) {
      const sum = settingsSummary(Q.promptRoot());
      if (settingsOk(sum)) return;
      log('Adjusting settings. Current summary:', sum);
      const btn = Q.settingsBtn(Q.promptRoot());
      if (!btn) break;
      if (!settingsPanel()) await clickUntil(btn, () => !!settingsPanel(), 'settings', 3000);
      if (!settingsPanel()) { warn('Settings panel did not open'); continue; }
      await pickToggle('Mode', 'Image');
      await pickToggle('Aspect ratio', '1:1');
      await pickToggle('Output count', 'x1');
      if (!correctModel(settingsSummary(Q.promptRoot()))) {
        const modelBtn = document.querySelector('flow-prompt-box-settings button[aria-label="Select model family"]');
        if (modelBtn) {
          const menuItem = () => Array.from(document.querySelectorAll('.cdk-overlay-container [role="menuitem"], .cdk-overlay-container [role="menuitemradio"], .cdk-overlay-container [role="option"]'))
            .find(el => correctModel(el.textContent || ''));
          await clickUntil(modelBtn, () => !!menuItem(), 'model menu', 2500);
          const item = menuItem();
          if (item) await trustedClick(item, 'Nano Banana 2');
          else warn('Nano Banana 2 option not found in model menu');
          await sleep(400);
        }
      }
      await closeSettings();
      await sleep(300);
    }
    const after = settingsSummary(Q.promptRoot());
    if (!settingsOk(after)) {
      throw new JobError(`Flow settings set nahi huin (${after.replace('crop_square', '1:1')}) — khud "Nano Banana 2 · 1:1 · x1" select karke "Send Again" dabayein`);
    }
  }

  async function clearPromptBox() {
    for (let attempt = 0; attempt < 3; attempt++) {
      const root = Q.promptRoot();
      if (!root) throw new JobError('Flow ka prompt box nahi mila');
      if (!Q.chips(root).length && !editorText(root)) return;
      const clear = Q.clearBtn(root);
      if (clear) {
        await trustedClick(clear, 'clear prompt');
      } else {
        // No clear button: remove chips one by one (click shows the cancel overlay → removes)
        for (const chip of Q.chips(root)) await trustedClick(chip, 'remove chip');
      }
      const done = await waitFor(() => {
        const r = Q.promptRoot();
        return r && !Q.chips(r).length && !editorText(r);
      }, 4000);
      if (done) return;
    }
    // Last resort for text only
    const ed = Q.editor(Q.promptRoot());
    if (ed && editorText(Q.promptRoot())) {
      ed.focus();
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(ed);
      sel.removeAllRanges(); sel.addRange(range);
      document.execCommand('delete', false, null);
    }
    const r = Q.promptRoot();
    if (Q.chips(r).length) throw new JobError('Pichhli image prompt box se nahi hati — "Clear prompt" khud daba dein');
  }

  // ── Step 2: attach image as ingredient ──────────────────────────
  function chipReady(root) {
    const chips = Q.chips(root);
    if (chips.length !== 1) return null;
    const c = chips[0];
    return c.getAttribute('aria-busy') === 'false' && c.querySelector('img.chip-image') ? c : null;
  }

  async function tryPaste(file) {
    await checkpoint();
    const root = Q.promptRoot();
    const ed = Q.editor(root);
    if (!ed) return false;
    ed.focus();
    const dt = new DataTransfer();
    dt.items.add(file);
    ed.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }));
    return !!(await waitFor(() => Q.chips(Q.promptRoot()).length > 0 || !!flowErrorEl(), 4000)) && !flowErrorEl();
  }

  async function tryDrop(file) {
    await checkpoint();
    const target = Q.promptRoot()?.querySelector('.base-prompt-box') || Q.promptRoot();
    if (!target) return false;
    const dt = new DataTransfer();
    dt.items.add(file);
    const r = target.getBoundingClientRect();
    const opts = { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
    target.dispatchEvent(new DragEvent('dragenter', opts));
    target.dispatchEvent(new DragEvent('dragover', opts));
    await sleep(80);
    target.dispatchEvent(new DragEvent('drop', opts));
    target.dispatchEvent(new DragEvent('dragleave', opts));
    return !!(await waitFor(() => Q.chips(Q.promptRoot()).length > 0 || !!flowErrorEl(), 4000)) && !flowErrorEl();
  }

  // Fallback: upload to the project, then "+" menu → the uploaded asset → "Add to prompt".
  async function tryUploadThenAddMenu(file, idsBefore) {
    await checkpoint();
    // Reuse an upload that the paste/drop attempts may already have started.
    let up = allTiles().find(t => t.mediaId && !idsBefore.has(t.mediaId) && !t.generated);
    if (!up) {
      const input = document.querySelector('flow-media-upload input[type="file"]') || document.querySelector('input[type="file"]');
      if (input) {
        const dt = new DataTransfer();
        dt.items.add(file);
        input.files = dt.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      } else {
        const dt = new DataTransfer();
        dt.items.add(file);
        const opts = { bubbles: true, cancelable: true, dataTransfer: dt };
        document.body.dispatchEvent(new DragEvent('dragenter', opts));
        document.body.dispatchEvent(new DragEvent('dragover', opts));
        document.body.dispatchEvent(new DragEvent('drop', opts));
        document.body.dispatchEvent(new DragEvent('dragleave', opts));
      }
    }
    scrollGridTop();
    up = await waitFor(() => flowErrorEl() ? { err: true } : allTiles().find(t => t.mediaId && !idsBefore.has(t.mediaId) && !t.generated && !t.pending), ATTACH_TIMEOUT_MS, 500);
    if (!up || up.err) return false;
    log('Upload finished, media id:', up.mediaId);

    const addBtn = Q.addMenuBtn(Q.promptRoot());
    if (!addBtn) return false;
    await trustedClick(addBtn, 'add ingredients');
    const item = await waitFor(() => Array.from(document.querySelectorAll('flow-add-menu-popover-content button.asset-item'))
      .find(b => (b.querySelector('img')?.src || '').includes(up.mediaId)), 6000);
    if (!item) {
      warn('Uploaded asset not found in add menu');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
      return false;
    }
    await trustedClick(item, 'asset item');
    const addToPrompt = await waitFor(() => {
      const b = document.querySelector('flow-add-menu-popover-content .detail-add-to-prompt-btn');
      const pv = document.querySelector('flow-add-menu-popover-content .detail-preview-image');
      return b && (!pv || (pv.src || '').includes(up.mediaId)) ? b : null;
    }, 4000);
    if (!addToPrompt) return false;
    await trustedClick(addToPrompt, 'add to prompt');
    await sleep(500);
    if (document.querySelector('flow-add-menu-popover-content')) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
    }
    return !!(await waitFor(() => Q.chips(Q.promptRoot()).length > 0, 5000));
  }

  async function attachImage(job) {
    const raw = dataUrlToFile(job.imgBase64, `zhunter_${job.productId || 'product'}_${(job.imageIndex ?? 0) + 1}.png`);
    if (!raw) throw new JobError('Product image load nahi hui (base64 kharab)');
    const file = await ensureSupportedImage(raw);
    if (!file) throw new JobError(`Image format (${raw.type || 'unknown'}) Flow ke liye convert nahi ho saka`);
    await dismissFlowError(); // clear a leftover error card from an earlier attempt
    const idsBefore = mediaIdSet();

    const failIfFlowError = async () => {
      const e = flowErrorEl();
      if (e) { await dismissFlowError(); throw new JobError('Flow ne image qubool nahi ki: ' + (e.text || 'upload error')); }
    };

    let attached = await tryPaste(file);
    await failIfFlowError();
    if (!attached) { log('Paste did not create a chip — trying drop'); attached = await tryDrop(file); await failIfFlowError(); }
    if (!attached) { log('Drop did not create a chip — upload + Add to prompt'); attached = await tryUploadThenAddMenu(file, idsBefore); await failIfFlowError(); }
    if (!attached) throw new JobError('Image prompt box mein attach nahi hui');

    const root = Q.promptRoot();
    if (Q.chips(root).length > 1) {
      // Two methods both fired — keep exactly one chip so only THIS product is the reference.
      const extras = Q.chips(root).slice(1);
      for (const c of extras) await trustedClick(c, 'remove extra chip');
      await waitFor(() => Q.chips(Q.promptRoot()).length === 1, 4000);
    }
    const ready = await waitFor(() => chipReady(Q.promptRoot()) || (flowErrorEl() ? 'err' : null), ATTACH_TIMEOUT_MS, 250);
    if (ready === 'err') await failIfFlowError();
    if (!ready) throw new JobError('Image upload poora nahi hua (chip ready nahi)');
  }

  // ── Step 3: prompt text ─────────────────────────────────────────
  async function injectPrompt(text) {
    await checkpoint();
    // ProseMirror renders line breaks as <br>/<p>, so compare with all whitespace removed
    const squash = (v) => String(v || '').replace(/\s+/g, '');
    const probe = squash(text);
    if (!probe) throw new JobError('Prompt khali hai');
    const has = () => squash(editorText(Q.promptRoot())) === probe;
    const ed = Q.editor(Q.promptRoot());
    if (!ed) throw new JobError('Prompt editor nahi mila');
    ed.focus();

    try {
      const dt = new DataTransfer();
      dt.setData('text/plain', text);
      ed.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }));
    } catch (_) {}
    if (await waitFor(has, 1500)) return;

    await checkpoint();
    ed.focus();
    try { document.execCommand('insertText', false, text); } catch (_) {}
    if (await waitFor(has, 1500)) return;

    throw new JobError('Prompt editor mein text nahi gaya');
  }

  // ── Step 4 + 5: generate and capture the result ─────────────────
  async function generateAndCapture(job) {
    await checkpoint();
    // Recheck immediately before submitting, including after image upload/paste.
    await ensureSettings();
    const root = Q.promptRoot();
    const gen = await waitFor(() => { const b = Q.genBtn(Q.promptRoot()); return b && !isDisabled(b) ? b : null; }, 10000);
    if (!gen) throw new JobError('Generate button enable nahi hua');
    // A pending component can remain in an existing tile; its presence alone
    // does not prove an active generation. Track changes from the baseline below.
    if (!chipReady(Q.promptRoot()) || editorText(Q.promptRoot()).replace(/\s+/g, '') !== String(job.prompt || '').replace(/\s+/g, '')) throw new JobError('Image ya poora prompt verify nahi hua');
    await pace(1000, 3000);

    scrollGridTop();
    // Existing failures belong to previous jobs, even if Flow recreates their DOM.
    const failuresBefore = failureCounts(Q.tiles());
    const before = mediaIdSet();
    gridImages().forEach(g => before.add(g.mediaId));
    // The ingredient chip image points at the uploaded product image: never return that.
    const refIds = new Set(Q.chips(Q.promptRoot())
      .map(c => ((c.querySelector('img')?.src || '').match(/\/image\/([\w-]+)/) || [])[1]).filter(Boolean));
    const pendingBefore = pendingCount();
    const probe = editorText(Q.promptRoot()).replace(/\s+/g, '').slice(0, 40);
    const started = () => {
      if (pendingCount() > pendingBefore ||
        allTiles().some(t => t.generated && t.mediaId && !before.has(t.mediaId))) return true;
      // v9.10.1 — Flow clears the prompt box once it accepts a submit (image chip + text gone)
      const r = Q.promptRoot();
      return !!(r && probe && !Q.chips(r).length && !editorText(r).replace(/\s+/g, '').includes(probe));
    };

    // Submit once with a real mouse click. Unconfirmed submissions must not be
    // retried through Enter or another click: Flow may already have accepted them.
    const cdpGenClick = async () => {
      await checkpoint();
      // Resolve the button in the worker AFTER debugger attach changes the viewport.
      const selector = 'flow-base-prompt-box flow-generate-icon-button button[aria-label="Start generation"]';
      let res;
      try { res = await sendBg({ action: 'ZH_CDP_CLICK', selector, jobId: job.jobId }); }
      finally { await sendBg({ action: 'ZH_CDP_DETACH' }); }
      if (!res?.ok) throw new JobError('Send click nahi hua: ' + (res?.error || 'Chrome debugger attach nahi hua'));
      return !!res?.ok;
    };
    const attempts = [
      ['trusted CDP click', cdpGenClick, START_TIMEOUT_MS]
    ];
    let ok = false;
    for (const [name, fn, wait] of attempts) {
      if (await waitFor(started, 300, 100)) { ok = true; break; }
      log('Start generation via', name);
      await fn();
      if (await waitFor(started, wait, 200)) { ok = true; break; }
      warn(`Generation did not start after ${name}`);
    }
    if (!ok) {
      const b = Q.genBtn(Q.promptRoot());
      warn('Gen button state:', b ? b.outerHTML.slice(0, 400) : 'NOT FOUND',
        '| agent chip:', Q.agentChip()?.getAttribute('aria-pressed'));
      throw new JobError('Generate click ke baad generation shuru nahi hui');
    }

    const beforeIds = [...before], refIdList = [...refIds];
    reportStatus(job, 'generating', `🎨 Generating · ${job.shortTitle} · Image #${(job.imageIndex ?? 0) + 1}`, false,
      { beforeIds, refIds: refIdList });
    try {
      const cur = (await chrome.storage.local.get(['pendingFlowAction']))?.pendingFlowAction;
      if (cur && cur.jobId === job.jobId) {
        await chrome.storage.local.set({ pendingFlowAction: { ...cur, phase: 'generating', beforeIds, refIds: refIdList } });
      }
    } catch (_) {}
    const t0 = Date.now();
    let lastSnack = '';
    const result = await waitFor(() => {
      const lp = latestPending;
      if (lp && (lp.jobId !== job.jobId || (lp.processed && lp.status === 'done'))) return { cancelled: true };
      scrollGridTop();
      // Check for failed generation tiles immediately (don't wait 3 minutes!)
      const failed = newFailureText(Q.tiles(), failuresBefore);
      if (failed && Date.now() - t0 > 2000) {
        const txt = failed;
        log('Detected failed tile:', txt);
        if (txt.toLowerCase().includes('unusual activity')) {
          return { error: 'Google: "unusual activity" — ZHunter thora ruk kar naya project bana kar dobara try karega (side panel dekhein).' };
        }
        return { error: txt.slice(0, 100) };
      }

      // Only the first few tiles (grid is newest-first) — protects against old tiles
      // that the virtual scroller renders later.
      const candidates = allTiles().slice(0, 8).filter(t =>
        t.mediaId && !before.has(t.mediaId) && !refIds.has(t.mediaId) && !t.pending &&
        /^https:\/\/flow-content\.google\//i.test(t.src) &&
        t.generated);
      if (candidates.length > 1) return { error: 'Multiple new results — manual image select karein' };
      if (candidates[0]) return candidates[0];
      const fresh2 = gridImages().slice(0, 10).filter(g =>
        !before.has(g.mediaId) && !refIds.has(g.mediaId) && g.loaded && g.generated);
      if (fresh2.length > 1) return { error: 'Multiple new results — manual image select karein' };
      if (fresh2[0]) return { mediaId: fresh2[0].mediaId, src: fresh2[0].src };
      const s = snackText();
      if (s && s !== lastSnack) { lastSnack = s; log('Flow says:', s); }
      if (s && /(couldn.?t|could not|failed|unable|violat|policy|try again|error)/i.test(s) && Date.now() - t0 > 3000) {
        return { error: s };
      }
      return null;
    }, RESULT_TIMEOUT_MS, 700);

    if (!result) throw new JobError('Image 3 minute mein nahi bani');
    if (result.cancelled) return result;
    if (result.error) throw new JobError('Flow error: ' + result.error);
    return result;
  }

  // ── Job runner ──────────────────────────────────────────────────
  let runningJobId = null;

  async function runJob(job) {
    runningJobId = job.jobId;
    job.shortTitle = (job.productTitle || 'Product').slice(0, 30);
    log('Job start', job.jobId, job.productTitle, 'img#', job.imageIndex);
    try {
      activeJob = job;
      await checkpoint();

      reportStatus(job, 'prepare', `ZHunter: prompt box tayyar · ${job.shortTitle}`);
      // Agent panel open = no normal prompt box, so turn Agent off first.
      await waitFor(() => Q.promptRoot() || Q.agentPanel(), 15000);
      await ensureAgentOff();
      await waitFor(() => Q.promptRoot(), 8000);
      if (!Q.promptRoot()) throw new JobError('Flow ka prompt box nahi mila');
      await ensureSettings();
      await clearPromptBox();
      await pace();

      reportStatus(job, 'image', `ZHunter: image attach · ${job.shortTitle}`);
      await attachImage(job);
      await pace();

      reportStatus(job, 'prompt', 'ZHunter: prompt paste');
      await injectPrompt(job.prompt);
      await checkpoint();

      const res = await generateAndCapture(job);
      if (res.cancelled) {
        log('Result already taken by ZHunter (or newer job) — done');
        updateFlowHUD(`✓ Image #${(job.imageIndex ?? 0) + 1} → ZHunter (${job.shortTitle})`, 'ok');
        return;
      }
      log('Generated media', res.mediaId, res.src);

      await checkpoint();
      // Persist the verified result before notifying a panel that may be closed.
      await finishJob(job, 'done', { mediaId: res.mediaId, newImgUrl: res.src });
      await sendBg({
        action: 'ZH_REPLACE_IMAGE_FROM_FLOW',
        jobId: job.jobId,
        productId: job.productId,
        imageIndex: job.imageIndex,
        originalUrl: job.imgUrl,
        mediaId: res.mediaId,
        newImgUrl: res.src
      });
      updateFlowHUD(`✓ Image #${(job.imageIndex ?? 0) + 1} → ZHunter (${job.shortTitle})`, 'ok');
    } catch (e) {
      if (e instanceof JobCancelled || latestPending?.status === 'cancelled') { log('Job cancelled', job.jobId); return; }
      const msg = e instanceof JobError ? e.message : `Unexpected error: ${e?.message || e}`;
      // v9.12.7 — expected Flow failures (unusual activity, policy, timeout…) are handled by the
      // side panel; log them quietly so Chrome's Errors page doesn't show a false alarm.
      if (e instanceof JobError) log('Job failed (handled):', msg);
      else warn('Job failed:', msg, e);
      reportStatus(job, 'error', msg, true);
      await finishJob(job, 'error', { error: msg });
    } finally {
      activeJob = null;
      runningJobId = null;
      // A newer job (e.g. "Send Again") may have arrived while this one was running.
      setTimeout(handlePendingFlowAction, 300);
    }
  }

  // ── Entry: pick up the pending job ──────────────────────────────
  // Synchronous gate: several triggers (load, storage change, message, URL change) can fire
  // together — only one may read the job and start it.
  let checking = false;

  async function handlePendingFlowAction() {
    if (runningJobId || checking || manualBusy) return;
    if (!chrome?.storage?.local) return;
    checking = true;
    try {
      await checkAndRun();
    } finally {
      checking = false;
    }
  }

  async function checkAndRun() {
    let job;
    try {
      job = (await chrome.storage.local.get(['pendingFlowAction']))?.pendingFlowAction;
    } catch (_) { return; }
    if (!job || job.processed || job.status === 'running') return;
    if (!job.jobId || !job.imgBase64) return;
    const owner = await sendBg({ action: 'ZH_FLOW_OWNER', jobId: job.jobId });
    if (!owner?.ok) return;
    if (Date.now() - (job.timestamp || 0) > STALE_JOB_MS) {
      const error = 'Queued job expired — Flow check karke Send Again karein';
      reportStatus(job, 'error', error, true);
      await finishJob(job, 'error', { error });
      return;
    }

    const insideProject = /\/project\/[\w-]+/i.test(location.pathname);
    if (job.projectUrl && job.projectUrl !== location.href.split('?')[0].split('#')[0]) return;
    if (insideProject) {
      const claim = await sendBg({ action: 'ZH_FLOW_CLAIM', jobId: job.jobId });
      if (!claim?.ok) return;
      job.projectUrl = claim.projectUrl;
    }
    if (!insideProject) {
      activeJob = job;
      try {
      await checkpoint();
      updateFlowHUD(`ZHunter: naya project bana raha hoon · ${(job.productTitle || '').slice(0, 30)}`, 'info');
      const btn = await waitFor(() => Q.newProjectBtn(), 8000);
      if (!btn) {
        updateFlowHUD(`"+ New project" dabayein — phir automation khud chalegi`, 'warn');
        return;
      }
      await trustedClick(btn, 'new project');
      // URL watcher below resumes the job once we're inside /project/...
      return;
      } catch (e) { if (!(e instanceof JobCancelled)) throw e; }
      finally { activeJob = null; }
      return;
    }
    runningJobId = job.jobId; // claim before any await so no second runner can start
    await runJob(job);
  }

  window.__zhunterFlowExecute = handlePendingFlowAction;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', handlePendingFlowAction);
  } else {
    handlePendingFlowAction();
  }

  // SPA navigation (e.g. home → new project)
  let lastUrl = location.href;
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      setTimeout(handlePendingFlowAction, 800);
    }
  }, 800);

  // New job written by the side panel
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      const nv = area === 'local' ? changes.pendingFlowAction?.newValue : null;
      if (nv) latestPending = nv;
      if (nv && !nv.processed && nv.status !== 'running' && nv.jobId !== runningJobId) handlePendingFlowAction();
    });
  } catch (_) {}

  // ── v9.11.0 Manual studio: put images (+ prompt) into the prompt box — NO generate ──
  async function pasteOneImage(file, want) {
    const got = () => Q.chips(Q.promptRoot()).length >= want;
    const ed = Q.editor(Q.promptRoot());
    if (ed) {
      ed.focus();
      const dt = new DataTransfer();
      dt.items.add(file);
      ed.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }));
      if (await waitFor(() => got() || !!flowErrorEl(), 4000, 150) && !flowErrorEl()) return true;
    }
    if (flowErrorEl()) return false;
    const target = Q.promptRoot()?.querySelector('.base-prompt-box') || Q.promptRoot();
    if (!target) return false;
    const dt = new DataTransfer();
    dt.items.add(file);
    const r = target.getBoundingClientRect();
    const o = { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
    target.dispatchEvent(new DragEvent('dragenter', o));
    target.dispatchEvent(new DragEvent('dragover', o));
    target.dispatchEvent(new DragEvent('drop', o));
    return !!(await waitFor(() => got() || !!flowErrorEl(), 4000, 150)) && !flowErrorEl();
  }

  async function manualAttach({ images = [], prompt = '', clear = true }) {
    if (runningJobId) return { ok: false, error: 'Auto job chal rahi hai — khatam hone dein' };
    if (!/\/project\/[\w-]+/i.test(location.pathname)) return { ok: false, error: 'Flow mein pehle koi project kholein (+ New project)' };
    await waitFor(() => Q.promptRoot() || Q.agentPanel(), 8000);
    // v9.11.0 — manual mode never uses the debugger (no "started debugging" banner)
    if (agentOn()) return { ok: false, error: 'Flow mein "Agent" off karein (Agent panel band karein), phir dobara dabayein' };
    if (!Q.promptRoot()) return { ok: false, error: 'Flow ka prompt box nahi mila' };
    if (clear) await clearPromptBox();
    await dismissFlowError();
    let n = Q.chips(Q.promptRoot()).length, added = 0;
    for (let i = 0; i < images.length; i++) {
      updateFlowHUD(`ZHunter: image ${i + 1}/${images.length} paste`, 'info');
      const raw = dataUrlToFile(images[i], `zhunter_img_${i + 1}.png`);
      const file = await ensureSupportedImage(raw);
      if (!file) continue;
      if (await pasteOneImage(file, n + 1)) { n++; added++; }
      else { await dismissFlowError(); }
    }
    const ready = await waitFor(() => Q.chips(Q.promptRoot()).length === n && Q.chips(Q.promptRoot()).every(c => c.getAttribute('aria-busy') === 'false' && c.querySelector('img.chip-image')), ATTACH_TIMEOUT_MS, 250);
    if (!ready) return { ok: false, added, total: images.length, ready: false, error: 'Images attach huin lekin ready nahi — Generate na karein' };
    if (prompt) {
      try { await injectPrompt(prompt); }
      catch (e) { return { ok: false, added, total: images.length, ready: true, promptConfirmed: false, error: e.message }; }
    }
    Q.editor(Q.promptRoot())?.focus();
    const complete = added === images.length && added > 0;
    updateFlowHUD(`${complete ? 'Ready' : 'Partial'}: ${added}/${images.length} images${prompt ? ' + prompt' : ''} — ${complete ? 'ab Generate dabayein' : 'missing images check karein; Generate na karein'}`, complete ? 'ok' : 'warn');
    return { ok: complete, added, total: images.length, ready: true, promptConfirmed: true, error: complete ? '' : 'Kuch images attach nahi huin — missing images check karein' };
  }

  chrome.runtime.onMessage?.addListener((msg, _sender, sendResponse) => {
    if (msg?.action === 'ZH_FLOW_EXECUTE') handlePendingFlowAction();
    if (msg?.action === 'ZH_FLOW_MANUAL_ATTACH') {
      if (manualBusy || runningJobId || checking) { sendResponse({ ok: false, error: 'Flow busy — current action khatam hone dein' }); return; }
      manualBusy = true;
      manualAttach(msg).then(sendResponse, e => sendResponse({ ok: false, error: e?.message || String(e) })).finally(() => { manualBusy = false; handlePendingFlowAction(); });
      return true;
    }
  });
})();
