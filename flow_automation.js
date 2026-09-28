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
      let v = null;
      try { v = fn(); } catch (_) { v = null; }
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

  // Realistic human mouse & pointer event sequence — safe from Google BotGuard / CDP detection
  async function trustedClick(el, label = '') {
    if (!el || !el.isConnected) return false;
    try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch (_) {}
    await sleep(80);
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const opts = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0, buttons: 1, composed: true };
    try { el.dispatchEvent(new PointerEvent('pointerdown', { ...opts, pointerType: 'mouse', isPrimary: true })); } catch (_) {}
    try { el.dispatchEvent(new MouseEvent('mousedown', opts)); } catch (_) {}
    try { el.focus(); } catch (_) {}
    try { el.dispatchEvent(new PointerEvent('pointerup', { ...opts, buttons: 0, pointerType: 'mouse', isPrimary: true })); } catch (_) {}
    try { el.dispatchEvent(new MouseEvent('mouseup', { ...opts, buttons: 0 })); } catch (_) {}
    try { el.dispatchEvent(new MouseEvent('click', { ...opts, buttons: 0 })); } catch (_) {}
    try { el.click(); } catch (_) {}
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
    promptRoot: () =>
      document.querySelector('flow-prompt-box flow-base-prompt-box') ||
      document.querySelector('flow-base-prompt-box'),
    editor: (root) => root?.querySelector('.ProseMirror'),
    agentChip: () => document.querySelector('flow-agent-mode-toggle-chip button.agent-mode-chip'),
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
  const pendingCount = () => allTiles().filter(t => t.pending).length;
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
  function reportStatus(job, phase, text, isError = false) {
    updateFlowHUD(text, isError ? 'warn' : 'info');
    sendBg({ action: 'ZH_FLOW_STATUS', jobId: job.jobId, productId: job.productId, imageIndex: job.imageIndex, phase, text, error: isError });
  }

  async function finishJob(job, status, extra = {}) {
    try {
      const cur = (await chrome.storage.local.get(['pendingFlowAction']))?.pendingFlowAction;
      if (cur && cur.jobId === job.jobId) {
        await chrome.storage.local.set({ pendingFlowAction: { ...cur, processed: true, status, finishedAt: Date.now(), ...extra } });
      }
    } catch (_) {}
  }

  class JobError extends Error {}

  // ── Step 1: prepare the prompt box ──────────────────────────────
  async function ensureAgentOff() {
    const chip = Q.agentChip();
    if (chip && chip.getAttribute('aria-pressed') === 'true') {
      log('Agent mode is ON — turning it off');
      await trustedClick(chip, 'agent chip');
      const off = await waitFor(() => Q.agentChip()?.getAttribute('aria-pressed') === 'false', 5000);
      if (!off) throw new JobError('Agent mode band nahi hua — Flow mein "Agent" chip khud off kar dein');
      await sleep(600);
    }
  }

  function settingsSummary(root) {
    return (Q.settingsBtn(root)?.textContent || '').replace(/\s+/g, ' ').trim();
  }

  async function pickToggle(groupLabel, text) {
    const group = document.querySelector(`flow-prompt-box-settings flow-toggles[aria-label="${groupLabel}"]`);
    if (!group) return false;
    const btn = Array.from(group.querySelectorAll('button.mat-button-toggle-button'))
      .find(b => (b.textContent || '').replace(/\s+/g, ' ').includes(text));
    if (!btn) return false;
    if (btn.getAttribute('aria-checked') === 'true') return true;
    await trustedClick(btn, `${groupLabel} ${text}`);
    return !!(await waitFor(() => btn.getAttribute('aria-checked') === 'true', 3000));
  }

  async function ensureSettings() {
    const root = Q.promptRoot();
    const sum = settingsSummary(root);
    const okModel = /nano banana 2/i.test(sum);
    const okRatio = /crop_square/.test(sum);
    const okCount = /\bx1\b/.test(sum);
    if (okModel && okRatio && okCount) return;

    log('Adjusting settings. Current summary:', sum);
    const btn = Q.settingsBtn(root);
    if (!btn) return;
    await trustedClick(btn, 'settings');
    const panel = await waitFor(() => document.querySelector('flow-prompt-box-settings'), 4000);
    if (!panel) { warn('Settings panel did not open'); return; }
    await pickToggle('Mode', 'Image');
    await pickToggle('Aspect ratio', '1:1');
    await pickToggle('Output count', 'x1');

    if (!okModel) {
      const modelBtn = document.querySelector('flow-prompt-box-settings button[aria-label="Select model family"]');
      if (modelBtn) {
        await trustedClick(modelBtn, 'model menu');
        const item = await waitFor(() => Array.from(document.querySelectorAll('.cdk-overlay-container [role="menuitem"], .cdk-overlay-container [role="menuitemradio"], .cdk-overlay-container [role="option"]'))
          .find(el => /nano banana 2/i.test(el.textContent || '')), 3000);
        if (item) await trustedClick(item, 'Nano Banana 2');
        else warn('Nano Banana 2 option not found in model menu');
        await sleep(400);
      }
    }
    // Close the settings popover
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
    await sleep(300);
    if (document.querySelector('flow-prompt-box-settings')) {
      const again = Q.settingsBtn(Q.promptRoot());
      if (again) await trustedClick(again, 'settings (close)');
      await sleep(300);
    }
    const after = settingsSummary(Q.promptRoot());
    if (!/nano banana 2/i.test(after) || !/crop_square/.test(after) || !/\bx1\b/.test(after)) {
      warn('Settings still not Nano Banana 2 · 1:1 · x1 →', after);
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
    const ready = await waitFor(() => chipReady(Q.promptRoot()) || (flowErrorEl() ? 'err' : null), ATTACH_TIMEOUT_MS, 500);
    if (ready === 'err') await failIfFlowError();
    if (!ready) throw new JobError('Image upload poora nahi hua (chip ready nahi)');
  }

  // ── Step 3: prompt text ─────────────────────────────────────────
  async function injectPrompt(text) {
    // ProseMirror renders line breaks as <br>/<p>, so compare with all whitespace removed
    const squash = (v) => String(v || '').replace(/\s+/g, '');
    const probe = squash(text).slice(0, 40);
    const has = () => squash(editorText(Q.promptRoot())).includes(probe);
    const ed = Q.editor(Q.promptRoot());
    if (!ed) throw new JobError('Prompt editor nahi mila');
    ed.focus();

    try {
      const dt = new DataTransfer();
      dt.setData('text/plain', text);
      ed.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }));
    } catch (_) {}
    if (await waitFor(has, 1500)) return;

    ed.focus();
    try { document.execCommand('insertText', false, text); } catch (_) {}
    if (await waitFor(has, 1500)) return;

    throw new JobError('Prompt editor mein text nahi gaya');
  }

  // ── Step 4 + 5: generate and capture the result ─────────────────
  async function generateAndCapture(job) {
    const root = Q.promptRoot();
    const gen = await waitFor(() => { const b = Q.genBtn(Q.promptRoot()); return b && !isDisabled(b) ? b : null; }, 10000);
    if (!gen) throw new JobError('Generate button enable nahi hua');

    scrollGridTop();
    const before = mediaIdSet();
    const pendingBefore = pendingCount();
    const tilesBefore = Q.tiles().length;
    const started = () => pendingCount() > pendingBefore || Q.tiles().length > tilesBefore ||
      allTiles().some(t => t.mediaId && !before.has(t.mediaId));

    for (let attempt = 1; attempt <= 2; attempt++) {
      await trustedClick(Q.genBtn(Q.promptRoot()) || gen, 'start generation');
      if (await waitFor(started, START_TIMEOUT_MS / 2, 400)) break;
      if (attempt === 2) throw new JobError('Generate click ke baad generation shuru nahi hui');
      const b = Q.genBtn(Q.promptRoot());
      if (!b || isDisabled(b)) {
        // Button went disabled = Flow accepted the submit; give it the rest of the window.
        if (await waitFor(started, START_TIMEOUT_MS / 2, 400)) break;
        throw new JobError('Generate click ke baad generation shuru nahi hui');
      }
      warn('Generation did not start — clicking again');
    }

    reportStatus(job, 'generating', `🎨 Generating · ${job.shortTitle} · Image #${(job.imageIndex ?? 0) + 1}`);
    const t0 = Date.now();
    let lastSnack = '';
    const result = await waitFor(() => {
      scrollGridTop();
      // Check for failed generation tiles immediately (don't wait 3 minutes!)
      const failed = Q.tiles().slice(0, 6).find(t => {
        const txt = (t.textContent || '').toLowerCase();
        return txt.includes('failed') && (txt.includes('unusual activity') || txt.includes('help center') || txt.includes('charged') || txt.includes('could not') || txt.includes('couldn'));
      });
      if (failed && Date.now() - t0 > 2000) {
        const txt = (failed.textContent || '').replace(/\s+/g, ' ').trim();
        log('Detected failed tile:', txt);
        if (txt.toLowerCase().includes('unusual activity')) {
          return { error: 'We noticed some unusual activity. Barahe karam Google Flow mein "+ New project" banayein.' };
        }
        return { error: txt.slice(0, 100) };
      }

      // Only the first few tiles (grid is newest-first) — protects against old tiles
      // that the virtual scroller renders later.
      const fresh = allTiles().slice(0, 6).find(t =>
        t.mediaId && !before.has(t.mediaId) && t.generated && !t.pending &&
        /^https:\/\/flow-content\.google\//i.test(t.src));
      if (fresh) return fresh;
      const s = snackText();
      if (s && s !== lastSnack) { lastSnack = s; log('Flow says:', s); }
      if (s && /(couldn.?t|could not|failed|unable|violat|policy|try again|error)/i.test(s) && Date.now() - t0 > 3000) {
        return { error: s };
      }
      return null;
    }, RESULT_TIMEOUT_MS, 1500);

    if (!result) throw new JobError('Image 3 minute mein nahi bani');
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
      await chrome.storage.local.set({ pendingFlowAction: { ...job, status: 'running', startedAt: Date.now() } });

      reportStatus(job, 'prepare', `ZHunter: prompt box tayyar · ${job.shortTitle}`);
      await waitFor(() => Q.promptRoot(), 15000);
      if (!Q.promptRoot()) throw new JobError('Flow ka prompt box nahi mila');
      await ensureAgentOff();
      await ensureSettings();
      await clearPromptBox();

      reportStatus(job, 'image', `ZHunter: image attach · ${job.shortTitle}`);
      await attachImage(job);

      reportStatus(job, 'prompt', 'ZHunter: prompt paste');
      await injectPrompt(job.prompt);

      const res = await generateAndCapture(job);
      log('Generated media', res.mediaId, res.src);

      await sendBg({
        action: 'ZH_REPLACE_IMAGE_FROM_FLOW',
        jobId: job.jobId,
        productId: job.productId,
        imageIndex: job.imageIndex,
        originalUrl: job.imgUrl,
        mediaId: res.mediaId,
        newImgUrl: res.src
      });
      await finishJob(job, 'done', { mediaId: res.mediaId });
      updateFlowHUD(`✓ Image #${(job.imageIndex ?? 0) + 1} → ZHunter (${job.shortTitle})`, 'ok');
    } catch (e) {
      const msg = e instanceof JobError ? e.message : `Unexpected error: ${e?.message || e}`;
      warn('Job failed:', msg, e);
      reportStatus(job, 'error', msg, true);
      await finishJob(job, 'error', { error: msg });
    } finally {
      runningJobId = null;
      // A newer job (e.g. "Send Again") may have arrived while this one was running.
      setTimeout(handlePendingFlowAction, 800);
    }
  }

  // ── Entry: pick up the pending job ──────────────────────────────
  // Synchronous gate: several triggers (load, storage change, message, URL change) can fire
  // together — only one may read the job and start it.
  let checking = false;

  async function handlePendingFlowAction() {
    if (runningJobId || checking) return;
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
    if (!job || job.processed || job.status === 'running' && job.startedAt && Date.now() - job.startedAt < RESULT_TIMEOUT_MS + 60000) return;
    if (!job.jobId || !job.imgBase64) return;
    if (Date.now() - (job.timestamp || 0) > STALE_JOB_MS) {
      await finishJob(job, 'stale');
      return;
    }

    const insideProject = /\/project\/[\w-]+/i.test(location.pathname);
    if (!insideProject) {
      updateFlowHUD(`ZHunter: naya project bana raha hoon · ${(job.productTitle || '').slice(0, 30)}`, 'info');
      const btn = await waitFor(() => Q.newProjectBtn(), 8000);
      if (!btn) {
        updateFlowHUD(`"+ New project" dabayein — phir automation khud chalegi`, 'warn');
        return;
      }
      await trustedClick(btn, 'new project');
      // URL watcher below resumes the job once we're inside /project/...
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
      if (nv && !nv.processed && nv.status !== 'running' && nv.jobId !== runningJobId) handlePendingFlowAction();
    });
  } catch (_) {}

  chrome.runtime.onMessage?.addListener((msg) => {
    if (msg?.action === 'ZH_FLOW_EXECUTE') handlePendingFlowAction();
  });
})();
