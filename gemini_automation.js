// ═════════════════════════════════════════════════════════════════
// ZHunter PRO — Google Gemini (gemini.google.com) Automation Engine
// ═════════════════════════════════════════════════════════════════

(() => {
  'use strict';

  // The panel re-injects this file when a tab does not answer — without this, every injection added one more listener and each message was handled several times (many uploads of the same image)
  try { window.__zhGemOff && window.__zhGemOff(); } catch (_) {}
  const __zhGemListeners = [];
  const addGemListener = (fn) => { try { chrome.runtime?.onMessage?.addListener(fn); __zhGemListeners.push(fn); } catch (_) {} };
  window.__zhGemOff = () => { __zhGemListeners.forEach(fn => { try { chrome.runtime.onMessage.removeListener(fn); } catch (_) {} }); };

  console.log('[ZHunter Gemini] Automation script active on', location.href);

  // Floating Toast HUD on Gemini page
  function showGeminiHUD(text, type = 'info') {
    let hud = document.getElementById('__zhunter_gemini_hud');
    if (!hud) {
      hud = document.createElement('div');
      hud.id = '__zhunter_gemini_hud';
      hud.style.cssText = `
        position: fixed;
        bottom: 90px;
        right: 28px;
        z-index: 999999;
        background: #1e1f20;
        color: #e3e3e3;
        border: 1px solid #444746;
        border-radius: 12px;
        padding: 12px 18px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 13px;
        box-shadow: 0 8px 24px rgba(0,0,0,0.5);
        display: flex;
        align-items: center;
        gap: 10px;
        transition: all 0.3s ease;
      `;
      document.body.appendChild(hud);
    }
    const icon = type === 'ok' ? '✓' : type === 'warn' ? '⚠️' : '⚡';
    hud.innerHTML = `<span>${icon}</span> <span>${text}</span>`;
    hud.style.borderColor = type === 'ok' ? '#38bdf8' : type === 'warn' ? '#f59e0b' : '#444746';
    // v9.15.1 — one timer: a new message cancels the old one (the HUD used to vanish 6 s after the FIRST message, mid-run)
    clearTimeout(hud._zhHide);
    hud._zhHide = setTimeout(() => {
      if (hud && hud.parentNode) hud.parentNode.removeChild(hud);
    }, type === 'info' ? 15000 : 6000);
  }

  // Helper: wait for element
  function waitForEl(selector, timeoutMs = 12000) {
    return new Promise((resolve) => {
      const el = document.querySelector(selector);
      if (el) return resolve(el);

      const observer = new MutationObserver(() => {
        const found = document.querySelector(selector);
        if (found) {
          observer.disconnect();
          resolve(found);
        }
      });

      observer.observe(document.body || document.documentElement, {
        childList: true,
        subtree: true
      });

      setTimeout(() => {
        observer.disconnect();
        resolve(document.querySelector(selector));
      }, timeoutMs);
    });
  }

  // Helper: convert base64 dataUrl to File
  function dataUrlToFile(dataUrl, filename = 'zhunter_product.png') {
    try {
      const arr = dataUrl.split(',');
      const mime = arr[0].match(/:(.*?);/)?.[1] || 'image/png';
      const bstr = atob(arr[1]);
      let n = bstr.length;
      const u8arr = new Uint8Array(n);
      while (n--) u8arr[n] = bstr.charCodeAt(n);
      return new File([u8arr], filename, { type: mime });
    } catch (e) {
      console.warn('[ZHunter Gemini] dataUrlToFile error:', e);
      return null;
    }
  }

  // Main injection logic
  async function injectImage(imgBase64) {
    if (!imgBase64 || window.__zhGeminiImgInProgress) return;
    window.__zhGeminiImgInProgress = true;
    setTimeout(() => { window.__zhGeminiImgInProgress = false; }, 6000);

    showGeminiHUD('ZHunter: Attaching product image...', 'info');

    const file = dataUrlToFile(imgBase64, 'zhunter_product.png');
    if (!file) {
      showGeminiHUD('Image could not be converted', 'warn');
      return;
    }

    // Copy to clipboard in Gemini tab if document is focused
    if (document.hasFocus?.()) {
      try {
        const blob = file.slice(0, file.size, 'image/png');
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        console.log('[ZHunter Gemini] Image written to clipboard');
      } catch (_) {}
    }

    // Wait for Gemini's editor to be ready
    const editor = await waitForEl('.ql-editor[role="textbox"], .ql-editor, div[contenteditable="true"]', 12000);

    // Allow Angular SPA to complete hydration & attach uploader dropzone
    await new Promise(r => setTimeout(r, 800));

    const dt = new DataTransfer();
    dt.items.add(file);

    // METHOD 1: Check for existing file input (Attach once and return)
    const inp = document.querySelector('input[type="file"]');
    if (inp) {
      try {
        inp.files = dt.files;
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        inp.dispatchEvent(new Event('change', { bubbles: true }));
        console.log('[ZHunter Gemini] Attached 1 image via file input');
        showGeminiHUD('✓ 1 Image attached to Gemini!', 'ok');
        return;
      } catch (_) {}
    }

    // METHOD 2: If no file input or not triggered, click the '+' upload button to reveal input
    const plusBtn = document.querySelector('button[aria-label*="Upload"], button[aria-label*="tool"], .simplified-input-menu button');
    if (plusBtn) {
      try {
        plusBtn.click();
        await new Promise(r => setTimeout(r, 250));
        const newFileInput = document.querySelector('input[type="file"]');
        if (newFileInput) {
          newFileInput.files = dt.files;
          newFileInput.dispatchEvent(new Event('input', { bubbles: true }));
          newFileInput.dispatchEvent(new Event('change', { bubbles: true }));
          console.log('[ZHunter Gemini] Attached 1 image via opened file input');
          showGeminiHUD('✓ 1 Image attached to Gemini!', 'ok');
          return;
        }
      } catch (_) {}
    }

    // METHOD 3: Fallback Drag & Drop Event on dropzone & editor (only if above failed)
    try {
      const dropTarget = document.querySelector('.xap-uploader-dropzone') || document.querySelector('file-drop-indicator') || editor;
      if (dropTarget) {
        const dropOpts = {
          bubbles: true,
          cancelable: true,
          dataTransfer: dt,
          clientX: Math.floor(window.innerWidth / 2),
          clientY: Math.floor(window.innerHeight / 2)
        };
        dropTarget.dispatchEvent(new DragEvent('dragenter', dropOpts));
        dropTarget.dispatchEvent(new DragEvent('dragover', dropOpts));
        await new Promise(r => setTimeout(r, 40));
        dropTarget.dispatchEvent(new DragEvent('drop', dropOpts));
        console.log('[ZHunter Gemini] Dispatched 1 Drag & Drop');
        showGeminiHUD('✓ 1 Image attached to Gemini!', 'ok');
        return;
      }
    } catch (_) {}

    showGeminiHUD('✓ Image ready! Paste with Ctrl+V if needed.', 'ok');
  }

  // Check and process pending action from storage
  function checkPendingAction() {
    try {
      if (!chrome?.storage?.local) return;
      chrome.storage.local.get(['pendingGeminiAction'], (res) => {
        if (chrome.runtime.lastError) return;
        const act = res?.pendingGeminiAction;
        if (!act || act.processed) return;

        // Valid within last 2 minutes
        if (Date.now() - (act.timestamp || 0) < 120000 && act.imgBase64) {
          chrome.storage.local.set({
            pendingGeminiAction: { ...act, processed: true }
          });
          injectImage(act.imgBase64);
        }
      });
    } catch (e) {
      console.warn('[ZHunter Gemini] Storage error:', e);
    }
  }

  window.__zhunterGeminiExecute = checkPendingAction;

  try {
    addGemListener((msg) => {
      if (msg?.action === 'TRIGGER_GEMINI_IMAGE') {
        checkPendingAction();
      }
    });
  } catch (_) {}


  // ───────── Manual helpers (the person presses Send) ─────────
  // v9.22.8 — after a screen lock the panel sends ZH_AI_CANCEL: a job still running from before the lock stops at its next pause
  const sleep = async (ms) => { await new Promise(r => setTimeout(r, ms)); if (window.__zhGemCancel) throw new Error('cancelled (screen was locked)'); };
  function composerEl() {
    return document.querySelector('rich-textarea .ql-editor[role="textbox"], rich-textarea .ql-editor, .ql-editor[role="textbox"], div[contenteditable="true"][role="textbox"]');
  }
  function inputArea() { return document.querySelector('input-area-v2, input-container, .input-area-container') || document.body; }
  function attachedCount() {   // previews of attached files in the composer area (names/classes change, so look at several signals)
    const area = inputArea();
    const named = area.querySelectorAll('uploader-file-preview, [data-test-id*="file-preview"], .file-preview, .attachment-preview-wrapper');
    if (named.length) return named.length;
    return [...area.querySelectorAll('img')].filter(i => i.offsetWidth >= 24 && i.offsetHeight >= 24).length;
  }
  // Gemini asks once per account: "Creating content from images and files" → Cancel / Agree. The person must press Agree (we never accept terms for them).
  function consentOpen() {
    return [...document.querySelectorAll('mat-dialog-container, [role="dialog"], .mat-mdc-dialog-container, dialog')].some(d => /creating content from images and files/i.test(d.innerText || ''));
  }
  async function waitConsent() {
    if (!consentOpen()) return false;
    showGeminiHUD('ZHunter: press “Agree” in this Gemini tab (one time) — I continue after that', 'warn');
    const end = Date.now() + 5 * 60000;
    while (consentOpen() && Date.now() < end) await sleep(500);
    await sleep(1500);
    return true;
  }
  async function waitOk(ok, iters) {   // wait until the attachment shows up; pause while the consent box is open
    for (let i = 0; i < iters && !ok(); i++) { if (consentOpen()) { await waitConsent(); i = 0; } await sleep(250); }
  }
  // Gemini shows a red "!" / red file name when an upload failed → true if any attached file in the composer is in error
  function attachFailed() {
    const area = inputArea();
    const red = (el) => { try { const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(getComputedStyle(el).color || ''); return !!m && +m[1] > 150 && +m[2] < 90 && +m[3] < 90; } catch (_) { return false; } };
    if (area.querySelector('.has-error, .gem-attachment-loading-error, mat-icon[data-mat-icon-name="error"]')) return true;
    const items = [...area.querySelectorAll('uploader-file-preview, [data-test-id*="file-preview"], .file-preview, .attachment-preview-wrapper, [class*="preview" i]')];
    for (const it of items) {
      if (it.querySelector('mat-icon[fonticon*="error" i], [data-mat-icon-name*="error" i], [class*="error" i], [aria-label*="error" i], [aria-label*="fail" i]')) return true;
      if ([...it.querySelectorAll('*')].some(e => e.children.length === 0 && /zhunter_/i.test(e.textContent || '') && red(e))) return true;
    }
    return [...area.querySelectorAll('*')].some(e => e.children.length === 0 && /^zhunter_/i.test((e.textContent || '').trim()) && red(e));
  }
  // remove files that are still waiting in the composer from an earlier (failed) try
  async function clearAttachments() {
    for (let round = 0; round < 6; round++) {
      const btns = [...inputArea().querySelectorAll('button')].filter(b => (/remove|delete|clear/i.test((b.getAttribute('aria-label') || '') + ' ' + (b.getAttribute('data-test-id') || '')) && !/voice|mic/i.test(b.getAttribute('aria-label') || ''))
        || /^close\s+\S/i.test(b.getAttribute('aria-label') || '') || !!b.closest('.gem-attachment-close-button'));   // Gemini's remove button on an attachment chip is labelled "close <file name>"
      if (!btns.length) break;
      try { btns[0].click(); } catch (_) {}
      await sleep(350);
    }
  }
  function findFileInput() {
    return document.querySelector('images-files-uploader input[type="file"], input[type="file"].hidden-file-input, input[type="file"]');
  }
  async function openPlusMenu() {
    const plus = document.querySelector('button[aria-label="Upload & tools"], button[aria-label*="Upload"], .simplified-input-menu button');
    if (!plus) return false;
    if (plus.getAttribute('aria-expanded') !== 'true') plus.click();
    await sleep(350);
    return true;
  }
  function closeMenus() {
    try { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true })); } catch (_) {}
  }
  // attach one or several images (data URLs) to the composer
  async function attachOnce(imgs) {
    const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);   // Gemini refuses a second file with the same name in one chat
    const files = imgs.map((u, i) => dataUrlToFile(u, 'zhunter_' + stamp + '_' + (i + 1) + '.png')).filter(Boolean);
    if (!files.length) throw new Error('image could not be read');
    const editor = await waitForEl('rich-textarea .ql-editor, .ql-editor, div[contenteditable="true"]', 15000);
    if (!editor) throw new Error('Gemini composer not found — open a chat first');
    await sleep(500);
    await clearAttachments();
    const before = attachedCount();
    const dt = new DataTransfer(); files.forEach(f => dt.items.add(f));
    const ok = () => attachedCount() >= before + 1 || (before === 0 && !!findSend() && !findSend().disabled);
    // 1) the hidden file input (appears after the "+" menu is opened once)
    let inp = findFileInput();
    if (!inp) { await openPlusMenu(); await sleep(250); inp = findFileInput(); }
    if (inp) {
      try {
        inp.files = dt.files;
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        inp.dispatchEvent(new Event('change', { bubbles: true }));
        await waitOk(ok, 60);   // up to 15 s (new chats upload slowly)
        closeMenus();
        if (ok()) return files.length;
      } catch (_) {}
    }
    // 2) paste event on the composer
    try {
      await clearAttachments();   // never stack a second copy on top of a first one
      editor.focus();
      const pe = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt });
      editor.dispatchEvent(pe);
      await waitOk(ok, 12);
      if (ok()) return files.length;
    } catch (_) {}
    // 3) drag & drop on the page
    try {
      await clearAttachments();
      const target = document.querySelector('.xap-uploader-dropzone') || document.querySelector('input-container') || editor;
      const o = { bubbles: true, cancelable: true, dataTransfer: dt, clientX: Math.floor(innerWidth / 2), clientY: Math.floor(innerHeight / 2) };
      target.dispatchEvent(new DragEvent('dragenter', o)); target.dispatchEvent(new DragEvent('dragover', o));
      await sleep(60); target.dispatchEvent(new DragEvent('drop', o));
      await waitOk(ok, 12);
      if (ok()) return files.length;
    } catch (_) {}
    await clearAttachments();
    throw new Error('image was not attached — check the Gemini page (F5) and try again');
  }
  // attach, and if Gemini marks the upload as failed (red "!"), remove it and upload again (3 tries)
  async function attachMany(imgs) {
    let last = null;
    for (let t = 1; t <= 3; t++) {
      try {
        const n = await attachOnce(imgs);
        await waitConsent();
        await sleep(2500);   // a failed upload turns red a moment later
        if (!attachFailed()) return n;
        showGeminiHUD('ZHunter: upload failed — trying again (' + t + '/3)…', 'warn');
      } catch (e) { last = e; }
      try { await clearAttachments(); } catch (_) {}
      await sleep(1500);
    }
    throw last || new Error('Gemini could not upload the image (red "!") — check the Gemini page and Retry failed');
  }
  async function typePrompt(text) {
    const ed = composerEl(); if (!ed) throw new Error('Gemini composer not found');
    const clear = () => {   // only the composer text — never select the whole page
      try { ed.focus({ preventScroll: true }); } catch (_) { try { ed.focus(); } catch (_) {} }
      if (!(ed.innerText || '').trim()) return;
      try {
        const r = document.createRange(); r.selectNodeContents(ed);
        const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
        document.execCommand('delete', false, null);
      } catch (_) {}
    };
    const len = () => (ed.innerText || '').replace(/\s+/g, '').length;
    const want = String(text).replace(/\s+/g, '').length;
    clear();
    let done = false;
    try { done = document.execCommand('insertText', false, text); } catch (_) {}
    await sleep(250);
    if (!done || len() < want * 0.95) {   // multi-line text was cut: type it line by line
      clear();
      const lines = String(text).split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (lines[i]) { try { document.execCommand('insertText', false, lines[i]); } catch (_) {} }
        if (i < lines.length - 1) { try { document.execCommand('insertParagraph', false, null); } catch (_) {} }
      }
      await sleep(250);
    }
    if (len() < want * 0.95) {
      ed.textContent = text; ed.classList.remove('ql-blank');
      ed.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    }
    try { window.getSelection()?.removeAllRanges(); } catch (_) {}
    await sleep(200);
  }
  function findSend() {
    const cands = [...document.querySelectorAll('button[aria-label*="Send message" i], button[aria-label="Send" i], button.send-button, .send-button-container button')];
    return cands.find(b => b.offsetParent !== null) || null;
  }
  const seenGen = new Set();
  function markSeen() { generatedImages().forEach(i => seenGen.add(i.currentSrc || i.src)); }
  // click Send as soon as it is enabled (it stays disabled while the image is still uploading)
  async function sendNow() {
    markSeen();
    const userBefore = document.querySelectorAll('user-query').length;
    window.__zhGemUserBase = userBefore;
    const end = Date.now() + 45000;
    let btn = null;
    while (Date.now() < end) {
      btn = findSend();
      if (btn && !btn.disabled && btn.getAttribute('aria-disabled') !== 'true') break;
      btn = null; await sleep(400);
    }
    if (!btn) return false;
    await sleep(400 + Math.random() * 500);
    try { btn.click(); } catch (_) {}
    for (let i = 0; i < 32; i++) {
      await sleep(250);
      if (document.querySelectorAll('user-query').length > userBefore || composerEl()?.classList.contains('ql-blank') || document.querySelector('button[aria-label*="Stop" i]')) return true;
    }
    return false;
  }
  // make sure "Create image" is on (so Gemini draws instead of answering with text)
  async function ensureCreateImage() {
    try {
      const find = () => [...document.querySelectorAll('button[role="menuitemcheckbox"]')].find(b => /create image/i.test(b.innerText || b.getAttribute('aria-label') || ''));
      // already selected? (a chip near the composer)
      if ([...document.querySelectorAll('.toolbox-drawer-item-button, .tool-chip, [class*="selected-tool"]')].some(e => /create image/i.test(e.innerText || ''))) return true;
      let b = find();
      if (!b) { await openPlusMenu(); await sleep(300); b = find(); }
      if (b) {
        if (b.getAttribute('aria-checked') !== 'true') { b.click(); await sleep(400); }
        closeMenus();
        return true;
      }
      closeMenus();
    } catch (_) {}
    return false;
  }
  // blob:/https image → data URL
  async function readImg(img) {
    const src = img.currentSrc || img.src;
    // Gemini's picture is on googleusercontent.com — this page may not read it (CORS), so the extension worker fetches it first
    if (/^https:\/\/[^/]*googleusercontent\.com\//i.test(src)) {
      try {
        const r = await new Promise(res => { try { chrome.runtime.sendMessage({ action: 'FETCH_GEMINI_IMAGE', url: src }, x => { void chrome.runtime.lastError; res(x); }); } catch (_) { res(null); } });
        if (r?.success && r.dataUrl) return r.dataUrl;
      } catch (_) {}
    }
    try { const b = await (await fetch(src)).blob(); return await new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = () => res(null); fr.readAsDataURL(b); }); } catch (_) {}
    try { const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; c.getContext('2d').drawImage(img, 0, 0); return c.toDataURL('image/png'); } catch (_) { return null; }
  }
  // every big picture in the chat that is not YOUR upload (the exact Gemini class names change, so size + place decide)
  function generatedImages() {
    return [...document.querySelectorAll('img')].filter(i => i.complete && i.naturalWidth >= 400 && i.naturalHeight >= 400
      && !i.closest('user-query, user-query-file-preview, user-query-file-carousel, rich-textarea, input-area-v2, .input-area-container, bard-sidenav'));   // (the chat itself sits inside <side-navigation-v2>, so that one must NOT be excluded)
  }
  async function grabLatest(waitMs, fresh) {
    const end = Date.now() + (waitMs || 0);
    for (;;) {
      // NOTE: the empty <div class="loader"> stays in finished images — only a visible loader / a .pending class means "still working"
      const pending = document.querySelector('.attachment-container.generated-images.pending, response-element.pending, generated-image.pending')
        || [...document.querySelectorAll('generated-image .loader')].some(l => { const r = l.getBoundingClientRect(); return r.width > 4 && r.height > 4 && getComputedStyle(l).visibility !== 'hidden'; });
      let imgs = generatedImages().filter(i => !fresh || !seenGen.has(i.currentSrc || i.src));
      if (fresh && window.__zhGemUserBase != null) {   // position check: only images AFTER the message we just sent
        const us = document.querySelectorAll('user-query'), lastU = us[us.length - 1];
        imgs = (us.length > window.__zhGemUserBase && lastU) ? generatedImages().filter(i => (lastU.compareDocumentPosition(i) & 4)) : [];
      }
      if (fresh && window.__zhGemUserBase != null) {   // usage limit of this Google account reached → stop waiting at once
        const us2 = document.querySelectorAll('user-query'), lu = us2[us2.length - 1];
        const resp = lu && lu.closest('.conversation-container')?.querySelector('model-response');
        if (resp && /limit resets|reached (your|the) .{0,40}limit|can create more images as soon/i.test(resp.innerText || '')) { window.__zhGemLimit = true; return null; }
      }
      if (fresh && window.__zhGemUserBase != null && !imgs.length) {   // Gemini answered with an error instead of a picture
        const us3 = document.querySelectorAll('user-query'), lu3 = us3[us3.length - 1];
        const resp3 = lu3 && lu3.closest('.conversation-container')?.querySelector('model-response');
        const tx = (resp3?.innerText || '').trim();
        if (tx && !document.querySelector('button[aria-label*="Stop" i]') && /encountered an error|something went wrong|please try again|could you try again/i.test(tx)) { window.__zhGemErr = tx.slice(0, 120); return null; }
        // 20 Oct 2026 — Gemini finished its answer but made NO picture (only text, or nothing): stop waiting after ~25 s quiet,
        // so the side panel sends the image again in a NEW chat (before: up to 9 minutes of waiting, then "failed")
        const busy = !!document.querySelector('button[aria-label*="Stop" i]') || !!pending || !!resp3?.querySelector('generated-image, .generated-images, [class*="loader"]:not([style*="display: none"])');
        if (resp3 && !busy) {
          const key = tx.slice(0, 200);
          if (window.__zhGemQuietKey !== key) { window.__zhGemQuietKey = key; window.__zhGemQuietAt = Date.now(); }
          else if (Date.now() - (window.__zhGemQuietAt || 0) > 25000) { window.__zhGemNoImg = (tx || '(empty answer)').slice(0, 120); return null; }
        } else { window.__zhGemQuietKey = null; }
      }
      console.log('[ZHunter Gemini] waiting for image', { found: imgs.length, pending: !!pending, users: document.querySelectorAll('user-query').length, base: window.__zhGemUserBase });
      if (imgs.length) {
        const im = imgs[imgs.length - 1], src = im.currentSrc || im.src;
        await sleep(pending ? 2500 : 900);   // the same picture still there after a moment = finished
        if (im.isConnected && im.complete && (im.currentSrc || im.src) === src) {
          const d = await readImg(im);
          if (d) { showGeminiHUD('ZHunter: image found ✓ (' + Math.round(d.length / 1024) + ' KB)', 'ok'); return d; }
          console.warn('[ZHunter Gemini] image found but could not be read', src);
        }
      }
      if (Date.now() > end) break;
      await sleep(700);
    }
    return null;
  }

  try {
    addGemListener((msg, _s, sendResponse) => {
      if (msg?.action === 'ZH_AI_CANCEL') {
        // v9.22.8 — stop the old job (it stops at its next pause), free the tab, close the "+" menu; the flag clears itself after 20 s
        // and a new job waits for that, so the old job has finished its own clean-up before the new image goes in
        window.__zhGemCancel = true; window.__zhGemBusy = 0;
        clearTimeout(window.__zhGemCancelT); window.__zhGemCancelT = setTimeout(() => { window.__zhGemCancel = false; }, 20000);
        closeMenus();
        (async () => { try { await new Promise(r => setTimeout(r, 300)); await clearAttachments(); } catch (_) {} try { sendResponse({ ok: true }); } catch (_) {} })();
        return true;
      }
      if (msg?.action === 'ZH_GEM_MANUAL_ATTACH') {
        if (window.__zhGemBusy && Date.now() - window.__zhGemBusy < 6 * 60000) { try { sendResponse({ ok: false, error: 'Gemini tab is still busy with the previous image' }); } catch (_) {} return true; }
        window.__zhGemBusy = Date.now();
        (async () => {
          try {
            if (window.__zhGemCancel) showGeminiHUD('ZHunter: clearing the old job from before the lock…', 'info');
            while (window.__zhGemCancel) await new Promise(r => setTimeout(r, 300));   // v9.22.8 — see ZH_AI_CANCEL
            const imgs = (msg.imgs && msg.imgs.length) ? msg.imgs : (msg.imgBase64 ? [msg.imgBase64] : []);
            showGeminiHUD('ZHunter: attaching image…', 'info');
            let n = 0;
            if (imgs.length) n = await attachMany(imgs);
            showGeminiHUD('ZHunter: image attached ✓ — typing prompt…', 'info');
            if (msg.prompt) {
              await ensureCreateImage();
              await typePrompt(msg.prompt);
            }
            showGeminiHUD('ZHunter: prompt ready — sending…', 'info');
            let sent = false;
            if (msg.send) {
              sent = await sendNow();
              for (let rt = 0; !sent && attachFailed() && rt < 2; rt++) {   // upload failed after typing: clear it, upload again, send again
                showGeminiHUD('ZHunter: upload failed — uploading again…', 'warn');
                await clearAttachments(); await sleep(1200);
                await attachMany(imgs); await typePrompt(msg.prompt || '');
                sent = await sendNow();
              }
              if (!sent && attachFailed()) throw new Error('Gemini upload keeps failing (red "!") — check the Gemini page, then Retry failed');
              showGeminiHUD(sent ? 'ZHunter: sent — waiting for the image…' : 'ZHunter: press Send yourself — I will take the image', sent ? 'info' : 'warn');
            } else showGeminiHUD('ZHunter: image' + (n > 1 ? 's' : '') + (msg.prompt ? ' + prompt' : '') + ' ready — press Send', 'ok');
            window.__zhGemBusy = 0;
            sendResponse({ ok: true, attached: n, sent });
          } catch (e) { window.__zhGemBusy = 0; showGeminiHUD(e?.message || 'failed', 'warn'); try { await clearAttachments(); } catch (_) {} try { sendResponse({ ok: false, error: e?.message || String(e) }); } catch (_) {} }
        })();
        return true;
      }
      if (msg?.action === 'ZH_GEM_GRAB_LATEST') {
        (async () => {
          try {
            window.__zhGemLimit = false; window.__zhGemErr = ''; window.__zhGemNoImg = '';
            const dataUrl = await grabLatest(msg.waitMs || 0, !!msg.fresh);
            sendResponse(dataUrl ? { ok: true, dataUrl } : { ok: false, gemErr: !!window.__zhGemErr, noImage: !!window.__zhGemNoImg, answer: window.__zhGemNoImg || '', limit: !!window.__zhGemLimit, error: window.__zhGemLimit ? 'Gemini limit reached on this account' : window.__zhGemNoImg ? 'Gemini answered without a picture' : 'No generated image in this chat yet' });
          } catch (e) { try { sendResponse({ ok: false, error: e?.message || String(e) }); } catch (_) {} }
        })();
        return true;
      }
    });
  } catch (_) {}

  // ═══ Titles via Gemini (same job / result keys as ChatGPT, job.engine === 'gemini') ═══
  // Job: chrome.storage.local.zhGptTitlesJob = { id, engine:'gemini', text, prompt?, newChat }. We make sure "Create image" is OFF
  // (titles are text), type → send → wait until the answer stops changing → zhGptTitlesResult = { id, status:'done', text }.
  const setTitlesResult = (job, status, extra = {}) => { try { chrome.storage.local.set({ zhGptTitlesResult: { id: job.id, status, at: Date.now(), ...extra } }); } catch (_) {} };
  async function ensureTextMode() {   // a chat used for images may still have the "Create image" tool on
    try {
      const chipOff = [...document.querySelectorAll('button')].find(b => /deselect.*create image|remove.*create image|create image.*(close|remove)/i.test(b.getAttribute('aria-label') || ''));
      if (chipOff) { chipOff.click(); await sleep(300); return; }
      const find = () => [...document.querySelectorAll('button[role="menuitemcheckbox"]')].find(b => /create image/i.test(b.innerText || b.getAttribute('aria-label') || ''));
      let b = find();
      if (!b && [...document.querySelectorAll('.toolbox-drawer-item-button, .tool-chip, [class*="selected-tool"]')].some(e => /create image/i.test(e.innerText || ''))) { await openPlusMenu(); await sleep(300); b = find(); }
      if (b && b.getAttribute('aria-checked') === 'true') { b.click(); await sleep(300); }
      closeMenus();
    } catch (_) {}
  }
  // the rendered answer → plain lines ("1. title"); innerText drops <ol> numbers, so lists are walked by hand
  function gemAnswerText(resp) {
    if (!resp) return '';
    const root = resp.querySelector('message-content .markdown, .markdown, message-content') || resp;
    const lines = [];
    const walk = (el) => {
      for (const c of el.children) {
        const tag = c.tagName;
        if (tag === 'OL') { let n = parseInt(c.getAttribute('start') || '1', 10) || 1; for (const li of c.children) lines.push(`${n++}. ${li.innerText.trim().replace(/\s*\n\s*/g, ' ')}`); }
        else if (tag === 'UL') { for (const li of c.children) lines.push(li.innerText.trim().replace(/\s*\n\s*/g, ' ')); }
        else if (tag === 'PRE' || tag === 'P' || /^H[1-6]$/.test(tag) || tag === 'BLOCKQUOTE') lines.push(...c.innerText.split('\n').map(x => x.trim()).filter(Boolean));
        else if (c.children.length) walk(c);
        else { const t = c.innerText?.trim(); if (t) lines.push(t); }
      }
    };
    walk(root);
    return (lines.length ? lines : (root.innerText || '').split('\n').map(x => x.trim()).filter(Boolean)).join('\n');
  }
  async function askGemini(job, text, label) {
    const ed = await waitForEl('rich-textarea .ql-editor, .ql-editor, div[contenteditable="true"]', 20000);
    if (!ed) throw new Error('Gemini message box not found (is Gemini open and signed in?)');
    await ensureTextMode();
    const respBefore = document.querySelectorAll('model-response').length;
    setTitlesResult(job, 'working', { note: `${label}: typing in Gemini…` });
    await typePrompt(text);
    const sent = await sendNow();
    if (!sent) {
      showGeminiHUD('ZHunter: press Send in Gemini yourself — I will read the answer', 'warn');
      setTitlesResult(job, 'press_send', { note: 'Press Send in the Gemini tab' });
      const end = Date.now() + 10 * 60000;
      while (Date.now() < end && document.querySelectorAll('user-query').length <= (window.__zhGemUserBase || 0)) await sleep(500);
      if (document.querySelectorAll('user-query').length <= (window.__zhGemUserBase || 0)) throw new Error('Message was not sent within 10 minutes');
    }
    setTitlesResult(job, 'working', { note: `${label}: Gemini is answering…` });
    const t0 = Date.now();
    while (Date.now() - t0 < 60000 && document.querySelectorAll('model-response').length <= respBefore) await sleep(400);
    // finished = no Stop button and the answer stayed the same for ~3 s
    let last = '', stable = 0;
    while (Date.now() - t0 < 10 * 60000) {
      await sleep(1000);
      const rs = document.querySelectorAll('model-response'); const cur = rs.length ? (rs[rs.length - 1].innerText || '') : '';
      if (document.querySelector('button[aria-label*="Stop" i]')) { stable = 0; last = cur; continue; }
      if (cur && cur === last) stable++; else { stable = 0; last = cur; }
      if (stable >= 3) break;
    }
    const rs = document.querySelectorAll('model-response');
    if (rs.length <= respBefore) throw new Error('No answer from Gemini');
    const out = gemAnswerText(rs[rs.length - 1]);
    if (/limit resets|reached (your|the) .{0,40}limit/i.test(out)) throw new Error('Gemini limit reached on this account');
    return out;
  }
  async function runGemTitlesJob() {
    let job;
    try { job = (await chrome.storage.local.get(['zhGptTitlesJob']))?.zhGptTitlesJob; } catch (_) { return; }
    if (!job || job.engine !== 'gemini' || job.started || Date.now() - (job.at || 0) > 5 * 60000) return;
    if (window.__zhGemTitlesBusy) return;
    window.__zhGemTitlesBusy = true;
    try {
      await chrome.storage.local.set({ zhGptTitlesJob: { ...job, started: true } });
      showGeminiHUD('ZHunter: sending titles to Gemini…', 'info');
      if (job.newChat && job.prompt) { await askGemini(job, job.prompt, 'Prompt'); await sleep(1500); }
      const reply = await askGemini(job, job.text, 'Titles');
      setTitlesResult(job, 'done', { text: reply });
      showGeminiHUD('✓ Answer read — go back to ZHunter and press Apply titles', 'ok');
    } catch (e) {
      setTitlesResult(job, 'error', { error: e?.message || String(e) });
      showGeminiHUD('ZHunter: ' + (e?.message || 'error'), 'warn');
    } finally { window.__zhGemTitlesBusy = false; }
  }
  addGemListener((msg) => { if (msg?.action === 'ZH_GEM_TITLES_START') runGemTitlesJob(); });

  // Run immediately
  checkPendingAction();
  setTimeout(runGemTitlesJob, 2500);   // a new Gemini tab opened for a titles job picks it up by itself

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', checkPendingAction);
  }
})();
