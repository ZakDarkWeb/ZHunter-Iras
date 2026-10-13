// ═════════════════════════════════════════════════════════════════
// ZHunter PRO — ChatGPT (chatgpt.com) Automation Engine
// ═════════════════════════════════════════════════════════════════

(() => {
  'use strict';

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
        if (tag === 'OL') { let n = parseInt(c.getAttribute('start') || '1', 10) || 1; for (const li of c.children) lines.push(`${n++}. ${li.innerText.trim().replace(/\s*\n\s*/g, ' ')}`); }
        else if (tag === 'UL') { for (const li of c.children) lines.push(li.innerText.trim().replace(/\s*\n\s*/g, ' ')); }
        else if (tag === 'PRE') { lines.push(...c.innerText.split('\n').map(x => x.trim()).filter(Boolean)); }
        else if (tag === 'P' || /^H[1-6]$/.test(tag) || tag === 'BLOCKQUOTE') { lines.push(...c.innerText.split('\n').map(x => x.trim()).filter(Boolean)); }
        else if (c.children.length) walk(c);
        else { const t = c.innerText?.trim(); if (t) lines.push(t); }
      }
    };
    walk(root);
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
        if (!/done/i.test(first)) console.warn('[ZHunter GPT] First reply was not DONE:', first.slice(0, 80));
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

  window.__zhunterGptExecute = checkPendingAction;

  try {
    chrome.runtime?.onMessage?.addListener((msg) => {
      if (msg?.action === 'TRIGGER_GPT_IMAGE') {
        checkPendingAction();
      }
      if (msg?.action === 'ZH_GPT_TITLES_START') runTitlesJob();
    });
  } catch (_) {}

  // Run immediately
  checkPendingAction();
  setTimeout(runTitlesJob, 2500);   // a freshly opened ChatGPT tab picks up a waiting titles job

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', checkPendingAction);
  }
})();
