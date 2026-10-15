// ═════════════════════════════════════════════════════════════════
// ZHunter PRO — ChatGPT (chatgpt.com) Automation Engine
// ═════════════════════════════════════════════════════════════════

(() => {
  'use strict';

  // re-injection (or an extension reload) must not leave several copies of the message listener: each message would run several times
  try { window.__zhGptOff && window.__zhGptOff(); } catch (_) {}
  const __zhGptListeners = [];
  window.__zhGptOff = () => { __zhGptListeners.forEach(fn => { try { chrome.runtime.onMessage.removeListener(fn); } catch (_) {} }); };

  console.log('[ZHunter GPT] Automation script active on', location.href);

  // Floating Toast HUD on ChatGPT page
  function showGptHUD(text, type = 'info') {
    let hud = document.getElementById('__zhunter_gpt_hud');
    if (!hud) {
      hud = document.createElement('div');
      hud.id = '__zhunter_gpt_hud';
      hud.style.cssText = `
        position: fixed;
        bottom: 80px;
        right: 28px;
        z-index: 999999;
        background: #202123;
        color: #ececf1;
        border: 1px solid #4d4d4f;
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
    hud.style.borderColor = type === 'ok' ? '#10a37f' : type === 'warn' ? '#f59e0b' : '#4d4d4f';
    setTimeout(() => {
      if (hud && hud.parentNode) hud.parentNode.removeChild(hud);
    }, 6000);
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
      console.warn('[ZHunter GPT] dataUrlToFile error:', e);
      return null;
    }
  }

  // Main injection logic
  async function injectImage(imgBase64) {
    if (!imgBase64 || window.__zhGptImgInProgress) return;
    window.__zhGptImgInProgress = true;
    setTimeout(() => { window.__zhGptImgInProgress = false; }, 6000);

    showGptHUD('ZHunter: Attaching product image...', 'info');

    const file = dataUrlToFile(imgBase64, 'zhunter_product.png');
    if (!file) {
      showGptHUD('Image could not be converted', 'warn');
      return;
    }

    // Copy to clipboard in ChatGPT tab if document is focused
    if (document.hasFocus?.()) {
      try {
        const blob = file.slice(0, file.size, 'image/png');
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        console.log('[ZHunter GPT] Image written to clipboard');
      } catch (_) {}
    }

    // Wait for ChatGPT's composer to appear
    const composer = await waitForEl('form[data-type="unified-composer"], [data-composer-surface="true"], #prompt-textarea', 12000);

    // Allow React / ProseMirror to complete hydration & attach event listeners
    await new Promise(r => setTimeout(r, 1200));

    // Focus editor
    const textarea = document.querySelector('#prompt-textarea') || composer;
    try { textarea?.focus(); } catch (_) {}

    const dt = new DataTransfer();
    dt.items.add(file);

    // Dispatch exactly ONE Drag & Drop event to composer
    const dropTarget = document.querySelector('form[data-type="unified-composer"]') ||
                       document.querySelector('[data-composer-surface="true"]') ||
                       composer;

    if (dropTarget) {
      try {
        const dropOpts = {
          bubbles: true,
          cancelable: true,
          dataTransfer: dt,
          clientX: Math.floor(window.innerWidth / 2),
          clientY: Math.floor(window.innerHeight / 2)
        };
        dropTarget.dispatchEvent(new DragEvent('dragenter', dropOpts));
        dropTarget.dispatchEvent(new DragEvent('dragover', dropOpts));
        await new Promise(r => setTimeout(r, 80));
        dropTarget.dispatchEvent(new DragEvent('drop', dropOpts));
        console.log('[ZHunter GPT] Clean 1-drop dispatched to:', dropTarget.tagName);
        showGptHUD('✓ Image attached to ChatGPT!', 'ok');
        return;
      } catch (_) {}
    }

    showGptHUD('✓ Image ready! Paste with Ctrl+V if needed.', 'ok');
  }

  // Check and process pending action from storage
  function checkPendingAction() {
    try {
      if (!chrome?.storage?.local) return;
      chrome.storage.local.get(['pendingGptAction'], (res) => {
        if (chrome.runtime.lastError) return;
        const act = res?.pendingGptAction;
        if (!act || act.processed) return;

        // Valid within last 2 minutes
        if (Date.now() - (act.timestamp || 0) < 120000 && act.imgBase64) {
          chrome.storage.local.set({
            pendingGptAction: { ...act, processed: true }
          });
          injectImage(act.imgBase64);
        }
      });
    } catch (e) {
      console.warn('[ZHunter GPT] Storage error:', e);
    }
  }


  // ═══ v9.15 — Titles via ChatGPT (auto) ═══════════════════════════════════
  // Job lives in chrome.storage.local.zhGptTitlesJob = { id, text, prompt?, newChat }.
  // We type the text into the composer, click Send (if ChatGPT ignores the scripted click, the user presses Send —
  // we keep waiting), wait for the reply to finish, and store the reply text in zhGptTitlesResult.
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const SEL = {
    editor: 'form[data-chatgpt-composer] .ProseMirror, div.ProseMirror[role="textbox"], #prompt-textarea, div.ProseMirror[contenteditable="true"], textarea[name="prompt-textarea"]',
    send: 'form[data-chatgpt-composer] button[type="submit"], button[data-testid="send-button"], button[aria-label="Send"], button[aria-label="Send prompt"], button[aria-label="Send message"]',
    stop: 'button[data-testid="stop-button"], button[aria-label="Stop"], button[aria-label="Stop streaming"], button[aria-label="Stop generating"]',
    user: '[data-message-author-role="user"], [data-chatgpt-search-unit-key$=":user"]',
    bot: '[data-message-author-role="assistant"], [data-chatgpt-search-unit-key$=":assistant"]'
  };
  const countEl = (sel) => document.querySelectorAll(sel).length;
  const setResult = (job, status, extra = {}) => { try { chrome.storage.local.set({ zhGptTitlesResult: { id: job.id, status, at: Date.now(), ...extra } }); } catch (_) {} };

  async function waitUntil(fn, ms, step = 300) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await sleep(step); }
    return null;
  }

  async function typeIntoComposer(text) {
    const ed = await waitUntil(() => document.querySelector(SEL.editor), 20000);
    if (!ed) throw new Error('ChatGPT message box not found (is the chat open and logged in?)');
    ed.focus();
    const getVal = () => (ed.value !== undefined ? ed.value : ed.innerText) || '';
    const squash = (v) => String(v).replace(/\s+/g, '');
    const want = squash(text);
    // 1) clear
    try { document.execCommand('selectAll'); document.execCommand('delete'); } catch (_) {}
    // 2) paste event (ProseMirror handles plain-text paste incl. line breaks)
    try {
      const dt = new DataTransfer(); dt.setData('text/plain', text);
      ed.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }));
    } catch (_) {}
    if (await waitUntil(() => squash(getVal()).length >= want.length * 0.98, 2500)) return ed;
    // 3) fallback: insertText
    ed.focus();
    try { document.execCommand('selectAll'); document.execCommand('delete'); document.execCommand('insertText', false, text); } catch (_) {}
    if (await waitUntil(() => squash(getVal()).length >= want.length * 0.98, 4000)) return ed;
    throw new Error('Text did not enter the ChatGPT message box');
  }

  // Turn the rendered answer into plain lines ("1. title"). innerText drops list numbers, so lists are walked by hand.
  function answerText(node) {
    if (!node) return '';
    const root = node.querySelector('.markdown, [class*="markdown"]') || node;
    const lines = [];
    const walk = (el) => {
      for (const c of el.children) {
        const tag = c.tagName;
        if (c.classList.contains('sr-only') || (tag === 'H4' && /^(ChatGPT|You) said/i.test(c.textContent.trim()))) continue;
        if (tag === 'OL') { let n = parseInt(c.getAttribute('start') || '1', 10) || 1; for (const li of c.children) lines.push(`${n++}. ${li.innerText.trim().replace(/\s*\n\s*/g, ' ')}`); }
        else if (tag === 'UL') { for (const li of c.children) lines.push(li.innerText.trim().replace(/\s*\n\s*/g, ' ')); }
        else if (tag === 'PRE') { lines.push(...c.innerText.split('\n').map(x => x.trim()).filter(Boolean)); }
        else if (tag === 'P' || /^H[1-6]$/.test(tag) || tag === 'BLOCKQUOTE') { lines.push(...c.innerText.split('\n').map(x => x.trim()).filter(Boolean)); }
        else if (c.children.length) walk(c);
        else { const t = c.innerText?.trim(); if (t) lines.push(t); }
      }
    };
    walk(root);
    for (let i = lines.length - 1; i >= 0; i--) if (/^(ChatGPT said|You said)\s*:?$/i.test(lines[i])) lines.splice(i, 1);
    return (lines.length ? lines : root.innerText.split('\n').map(x => x.trim()).filter(Boolean)).join('\n');
  }

  // type → send → wait for the reply; returns the reply text
  async function askChatGpt(job, text, label) {
    const userBefore = countEl(SEL.user), botBefore = countEl(SEL.bot);
    setResult(job, 'working', { note: `${label}: typing…` });
    await typeIntoComposer(text);
    await sleep(600 + Math.random() * 600);
    const btn = await waitUntil(() => { const b = document.querySelector(SEL.send); return b && !b.disabled ? b : null; }, 8000);
    const started = () => countEl(SEL.user) > userBefore || !!document.querySelector(SEL.stop);
    if (btn) { try { btn.click(); } catch (_) {} }
    if (!(await waitUntil(started, 4000))) {   // second try: submit the composer form directly
      try { const f = (btn && btn.form) || document.querySelector('form[data-chatgpt-composer]'); f?.requestSubmit?.(btn || undefined); } catch (_) {}
    }
    if (!(await waitUntil(started, 4000))) {
      showGptHUD('ZHunter: press Send in ChatGPT yourself — I will read the answer', 'warn');
      setResult(job, 'press_send', { note: 'Press Send in the ChatGPT tab' });
      if (!(await waitUntil(started, 10 * 60000, 500))) throw new Error('Message was not sent within 10 minutes');
    }
    setResult(job, 'working', { note: `${label}: ChatGPT is answering…` });
    await waitUntil(() => countEl(SEL.bot) > botBefore, 60000, 400);
    // finished = no stop button and the answer text stayed the same for ~3 s
    let last = '', stable = 0; const t0 = Date.now();
    while (Date.now() - t0 < 10 * 60000) {
      await sleep(1000);
      const bots = document.querySelectorAll(SEL.bot); const cur = bots.length ? bots[bots.length - 1].innerText : '';
      if (document.querySelector(SEL.stop)) { stable = 0; last = cur; continue; }
      if (cur && cur === last) stable++; else { stable = 0; last = cur; }
      if (stable >= 3) break;
    }
    const bots = document.querySelectorAll(SEL.bot);
    if (!bots.length) throw new Error('No answer from ChatGPT');
    return answerText(bots[bots.length - 1]);
  }

  async function runTitlesJob() {
    let job;
    try { job = (await chrome.storage.local.get(['zhGptTitlesJob']))?.zhGptTitlesJob; } catch (_) { return; }
    if (!job || job.started || Date.now() - (job.at || 0) > 5 * 60000) return;
    if (window.__zhGptTitlesBusy) return;
    window.__zhGptTitlesBusy = true;
    try {
      await chrome.storage.local.set({ zhGptTitlesJob: { ...job, started: true } });
      showGptHUD('ZHunter: sending titles to ChatGPT…', 'info');
      if (job.newChat && job.prompt) {
        const first = await askChatGpt(job, job.prompt, 'Prompt');
        if (!/done/i.test(first)) console.log('[ZHunter GPT] First reply was not DONE:', first.slice(0, 80));
        await sleep(1500);
      }
      const reply = await askChatGpt(job, job.text, 'Titles');
      setResult(job, 'done', { text: reply });
      showGptHUD('✓ Answer read — go back to ZHunter and press Apply', 'ok');
    } catch (e) {
      setResult(job, 'error', { error: e?.message || String(e) });
      showGptHUD('ZHunter: ' + (e?.message || 'error'), 'warn');
    } finally { window.__zhGptTitlesBusy = false; }
  }

  // ═══ v9.15 — Image edit via ChatGPT (auto) ═══════════════════════════════
  // Job comes from the side panel (message ZH_GPT_IMG_RUN); the result is written to chrome.storage.local["zhGptRes_"+id].
  // New chat (opened by the side panel) → attach image → pick "Create image" (if the menu has it) → prompt → send →
  // wait for the new image → read it → zhGptImgResult = { id, status:'done', dataUrl } (or 'error').
  const setImgResult = (job, status, extra = {}) => { try { chrome.storage.local.set({ ['zhGptRes_' + job.id]: { id: job.id, status, at: Date.now(), ...extra } }); } catch (_) {} };
  const blobToDataUrl = (b) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(b); });
  const humanClick = (el) => {
    for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      try { el.dispatchEvent(new (t.startsWith('pointer') ? PointerEvent : MouseEvent)(t, { bubbles: true, cancelable: true, button: 0 })); } catch (_) {}
    }
  };

  async function attachImageToComposer(dataUrl) {
    const file = dataUrlToFile(dataUrl, 'zhunter_product.png');
    if (!file) throw new Error('Image could not be converted');
    const ed = await waitUntil(() => document.querySelector(SEL.editor), 25000);
    if (!ed) throw new Error('ChatGPT message box not found (is the chat open and logged in?)');
    await sleep(1200);
    const target = document.querySelector('form[data-type="unified-composer"]') || document.querySelector('form[data-chatgpt-composer]') ||
                   document.querySelector('[data-composer-surface="true"]') || ed.closest('form') || ed;
    const thumbs = () => target.querySelectorAll('img[src^="blob:"], [data-testid*="attachment"], [data-testid*="file" i], button[aria-label*="Remove" i]').length;
    const before = thumbs();
    try { ed.focus(); } catch (_) {}
    const dt = new DataTransfer(); dt.items.add(file);
    const o = { bubbles: true, cancelable: true, dataTransfer: dt, clientX: Math.floor(innerWidth / 2), clientY: Math.floor(innerHeight / 2) };
    target.dispatchEvent(new DragEvent('dragenter', o)); target.dispatchEvent(new DragEvent('dragover', o));
    await sleep(80);
    target.dispatchEvent(new DragEvent('drop', o));
    if (!(await waitUntil(() => thumbs() > before, 15000))) console.log('[ZHunter GPT] Could not confirm the attachment thumbnail — continuing');
    await sleep(1500);
  }

  // Best effort: "+" menu → "Create image". If the menu looks different we just continue (prompt says "Create an image").
  async function pickCreateImageTool() {
    try {
      const form = () => document.querySelector('form[data-chatgpt-composer], form[data-type="unified-composer"]');
      const chosen = () => /create image/i.test((form()?.innerText || '')) && !document.querySelector('[data-mention-section-items]');
      const findRow = () => {
        const rows = [...document.querySelectorAll('[data-mention-section-items] button, [data-menu-row-content]')];
        const hit = rows.find(x => /^\s*create image/i.test((x.innerText || x.textContent || '').trim()));
        return hit ? (hit.closest('button') || hit) : null;
      };
      const plus = document.querySelector('[data-testid="composer-plus-btn"], button[aria-label="Add files and more"], button[aria-label*="Add files" i]');
      if (!plus) return false;
      for (let attempt = 0; attempt < 3; attempt++) {
        let row = findRow();
        if (!row) {   // menu is closed → open it (never click "+" while it is already open: that closes it)
          if (plus.getAttribute('aria-expanded') !== 'true') { humanClick(plus); }
          row = await waitUntil(findRow, 3500, 150);
        }
        if (!row) { await sleep(500); continue; }
        try { row.scrollIntoView({ block: 'nearest' }); } catch (_) {}
        await sleep(250 + Math.random() * 250);
        humanClick(row); await sleep(900);
        if (!findRow() && /create image/i.test((form()?.innerText || ''))) return true;   // menu closed and the "Create image" chip is in the composer
        if (!findRow()) return true;   // menu closed after the click
        try { row.click(); } catch (_) {}   // second way to press it
        await sleep(900);
        if (!findRow()) return true;
      }
      try { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); } catch (_) {}
      await sleep(300);
      return false;
    } catch (_) { return false; }
  }

  // every assistant answer block (image-only answers have no data-chatgpt-search-unit-key, so the "ChatGPT said:" heading is used too)
  function botEls() {
    const set = new Set(document.querySelectorAll(SEL.bot));
    document.querySelectorAll('h4[data-conversation-role="assistant"]').forEach(h => { const b = h.closest('.block-BQZwFn') || h.parentElement; if (b) set.add(b); });
    const all = [...set];
    return all.filter(el => !all.some(o => o !== el && o.contains(el))).sort((a, b) => (a.compareDocumentPosition(b) & 4) ? -1 : 1);
  }

  // the biggest finished image inside the newest answer
  function bestAnswerImage(bot) {
    let best = null, area = 0;
    for (const im of bot.querySelectorAll('img')) {
      if (!im.complete || im.naturalWidth < 300) continue;
      const a = im.naturalWidth * im.naturalHeight;
      if (a > area) { best = im; area = a; }
    }
    return best;
  }

  async function readImageAsDataUrl(img) {
    const src = img.currentSrc || img.src;
    try { const r = await fetch(src, { credentials: 'include' }); if (r.ok) return await blobToDataUrl(await r.blob()); } catch (_) {}
    try {
      const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
      c.getContext('2d').drawImage(img, 0, 0); return c.toDataURL('image/png');
    } catch (_) {}
    return null;
  }

  // job = { id, imgBase64, prompt } — sent by the side panel straight to this tab (chat may be reused for several images)
  async function runImgJob(job) {
    if (!job || !job.imgBase64 || !job.id) return;
    window.__zhGptSeen = window.__zhGptSeen || new Set();
    if (window.__zhGptSeen.has(job.id)) return;
    window.__zhGptSeen.add(job.id);
    if (window.__zhGptImgBusy) { setImgResult(job, 'error', { error: 'This ChatGPT tab is busy' }); return; }
    window.__zhGptImgBusy = true;
    try {
      showGptHUD('ZHunter: editing the image in ChatGPT…', 'info');
      setImgResult(job, 'working', { note: 'ChatGPT: attaching image…' });
      await attachImageToComposer(job.imgBase64);
      setImgResult(job, 'working', { note: 'ChatGPT: preparing…' });
      const form0 = document.querySelector('form[data-chatgpt-composer], form[data-type="unified-composer"]');
      const tool = (form0 && /create image/i.test(form0.innerText || '')) ? true : await pickCreateImageTool();
      const userBefore = countEl(SEL.user), botBefore = botEls().length;
      // every generated image already on the page before we send (a new one that is not in this set is ours)
      const genImgs = () => [...document.querySelectorAll('[data-testid="generated-image-gallery"] img, img[alt^="Generated image" i], img[alt*="generated image" i]')];
      const seenSrc = new Set(genImgs().map(i => i.currentSrc || i.src));
      await typeIntoComposer((tool ? '' : 'Create an image. ') + job.prompt);
      await sleep(900 + Math.random() * 700);
      const btn = await waitUntil(() => { const b = document.querySelector(SEL.send); return b && !b.disabled ? b : null; }, 20000);
      const started = () => countEl(SEL.user) > userBefore || !!document.querySelector(SEL.stop);
      if (btn) { try { btn.click(); } catch (_) {} }
      if (!(await waitUntil(started, 4000))) { try { const f = (btn && btn.form) || document.querySelector('form[data-chatgpt-composer]'); f?.requestSubmit?.(btn || undefined); } catch (_) {} }
      if (!(await waitUntil(started, 4000))) {
        showGptHUD('ZHunter: press Send in ChatGPT yourself — I will read the image', 'warn');
        setImgResult(job, 'working', { note: 'Press Send in the ChatGPT tab' });
        if (!(await waitUntil(started, 5 * 60000, 500))) throw new Error('Message was not sent');
      }
      setImgResult(job, 'working', { note: 'ChatGPT is creating the image…' });
      await waitUntil(() => botEls().length > botBefore, 60000, 400);
      const t0 = Date.now(); let img = null, stable = 0, lastSrc = '', quiet = 0, lastTxt = '', lastFresh = '', freshStable = 0;
      while (Date.now() - t0 < 8 * 60000) {
        await sleep(1500);
        // fallback: a NEW generated image anywhere on the page (works even when the answer block is not recognised)
        { const us = document.querySelectorAll(SEL.user), lastUser = us[us.length - 1];
          const fresh = (us.length > userBefore ? genImgs() : []).filter(i => i.complete && i.naturalWidth >= 300 && !seenSrc.has(i.currentSrc || i.src) && (!lastUser || (lastUser.compareDocumentPosition(i) & 4)));
          if (fresh.length) {
            const cand2 = fresh.sort((a, b) => b.naturalWidth * b.naturalHeight - a.naturalWidth * a.naturalHeight)[0];
            const s2 = cand2.currentSrc || cand2.src;
            if (s2 === lastFresh) freshStable++; else { freshStable = 0; lastFresh = s2; }
            if (freshStable >= (document.querySelector(SEL.stop) ? 5 : 2)) { img = cand2; break; }
          } else { freshStable = 0; lastFresh = ''; } }
        const bots = botEls();
        const bot = bots[bots.length - 1];
        if (!bot || bots.length <= botBefore) continue;
        const busy = !!document.querySelector(SEL.stop);
        const txt = (bot.innerText || '').trim();
        const cand = bestAnswerImage(bot);
        if (cand && !busy) {
          const s = cand.currentSrc || cand.src;
          if (s === lastSrc) stable++; else { stable = 0; lastSrc = s; }
          if (stable >= 2) { img = cand; break; }
          continue;
        }
        stable = 0;
        if (!busy && !cand) {
          if (/limit|too many|try again (later|after)|come back/i.test(txt) && txt.length < 600) throw new Error('LIMIT: ' + txt.slice(0, 120));
          if (txt === lastTxt) quiet++; else { quiet = 0; lastTxt = txt; }
          if (quiet >= 20 && txt) throw new Error('ChatGPT did not make an image: ' + txt.slice(0, 120));
        } else quiet = 0;
      }
      if (!img) throw new Error('ChatGPT image did not appear in time');
      const dataUrl = await readImageAsDataUrl(img);
      if (!dataUrl) throw new Error('Could not read the generated image');
      setImgResult(job, 'done', { dataUrl, chat: location.pathname });
      showGptHUD('✓ Image ready — ZHunter is taking it', 'ok');
    } catch (e) {
      const m = e?.message || String(e);
      setImgResult(job, 'error', { error: m.replace(/^LIMIT:\s*/, ''), limit: /^LIMIT:/.test(m) });
      showGptHUD('ZHunter: ' + m.replace(/^LIMIT:\s*/, ''), 'warn');
    } finally { window.__zhGptImgBusy = false; }
  }

  // ═══ v9.15 — Archive a chat that ZHunter created (never delete; only the exact path the panel names) ═══
  async function runArchive(path, expect) {
    if (!path || !/^\/c\/[\w-]+$/.test(path) || location.pathname !== path) return { ok: false, error: 'not the expected chat' };
    await waitUntil(() => document.querySelector(SEL.editor), 15000);
    await sleep(1500);
    // safety: every user message in this chat must start from one of our own prompts, otherwise it is NOT archived
    { const msgs = [...document.querySelectorAll(SEL.user)].map(m => (m.innerText || '').trim()).filter(Boolean);
      const keys = (expect || []).filter(Boolean);
      if (!keys.length || !msgs.length || !msgs.every(t => keys.some(k => t.includes(k)))) return { ok: false, error: 'not found: this chat has messages that are not ours — left alone' }; }
    const id = path.split('/').pop();
    const finders = [
      () => document.querySelector('[data-app-shell-main-titlebar] button[aria-label="More"]'),
      () => document.querySelector('header button[aria-label="More"]'),
      () => document.querySelector('[data-testid="conversation-options-button"], button[aria-label="Open conversation options"], button[aria-label*="conversation options" i]'),
      () => document.querySelector('[data-sidebar-chatgpt-conversation-key$=":' + id + '"] button[aria-label="Chat actions"]')
    ];
    const findArchive = () => [...document.querySelectorAll('[role="menuitem"]')].find(x => /^\s*archive\s*$/i.test(x.textContent || '') || x.getAttribute('data-testid') === 'archive-chat-menu-item');
    let item = null;
    for (const f of finders) {
      const btn = await waitUntil(f, 3000);
      if (!btn) continue;
      humanClick(btn); await sleep(900);
      item = await waitUntil(findArchive, 2500);
      if (item) break;
      try { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); } catch (_) {}
      await sleep(400);
    }
    if (!item) return { ok: false, error: 'Archive item not found' };
    humanClick(item);
    const gone = await waitUntil(() => location.pathname !== path, 6000);
    return gone ? { ok: true } : { ok: false, error: 'archive not confirmed' };
  }

  window.__zhunterGptExecute = checkPendingAction;

  try {
    const __gptOnMsg = (msg, sender, sendResponse) => {
      if (msg?.action === 'TRIGGER_GPT_IMAGE') {
        checkPendingAction();
      }
      if (msg?.action === 'ZH_GPT_TITLES_START') runTitlesJob();
      if (msg?.action === 'ZH_GPT_ARCHIVE') { runArchive(msg.path, msg.expect).then(r => { try { sendResponse(r); } catch (_) {} }).catch(e => { try { sendResponse({ ok: false, error: e?.message || String(e) }); } catch (_) {} }); return true; }
      if (msg?.action === 'ZH_GPT_MANUAL_ATTACH') {   // manual: put image + prompt in the composer, the person presses Send
        (async () => {
          try {
            if (msg.imgBase64) await attachImageToComposer(msg.imgBase64);
            const form0 = document.querySelector('form[data-chatgpt-composer], form[data-type="unified-composer"]');
            const tool = (form0 && /create image/i.test(form0.innerText || '')) ? true : await pickCreateImageTool();
            if (msg.prompt) await typeIntoComposer((tool ? '' : 'Create an image. ') + msg.prompt);
            showGptHUD('ZHunter: image + prompt are ready — press Send', 'ok');
            sendResponse({ ok: true });
          } catch (e) { try { sendResponse({ ok: false, error: e?.message || String(e) }); } catch (_) {} }
        })();
        return true;
      }
      if (msg?.action === 'ZH_GPT_GRAB_LATEST') {   // manual: newest generated image of the open chat
        (async () => {
          try {
            const bots = botEls();
            for (let i = bots.length - 1; i >= 0; i--) {
              const img = bestAnswerImage(bots[i]);
              if (img) { const dataUrl = await readImageAsDataUrl(img); if (dataUrl) { sendResponse({ ok: true, dataUrl }); return; } }
            }
            sendResponse({ ok: false, error: 'No generated image in this chat' });
          } catch (e) { try { sendResponse({ ok: false, error: e?.message || String(e) }); } catch (_) {} }
        })();
        return true;
      }
      if (msg?.action === 'ZH_GPT_IMG_RUN') { runImgJob(msg.job); try { sendResponse({ ok: true }); } catch (_) {} }

    };
    chrome.runtime?.onMessage?.addListener(__gptOnMsg); __zhGptListeners.push(__gptOnMsg);
  } catch (_) {}

  // Run immediately
  checkPendingAction();
  setTimeout(runTitlesJob, 2500);   // a freshly opened ChatGPT tab picks up a waiting titles job

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', checkPendingAction);
  }
})();
