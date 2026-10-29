// ═════════════════════════════════════════════════════════════════
// ZHunter — Meta AI (meta.ai) image editing (v9.22.0, 25 Oct 2026)
// The side panel sends ZH_META_IMG_RUN { job: { id, imgBase64, prompt } } to this tab. We attach the product photo,
// type the prompt, press Send, wait for Meta's new picture and write it to chrome.storage.local["zhGptRes_"+id]
// (the same result key the ChatGPT runner uses): { status:'working'|'done'|'error', dataUrl?, error?, limit? }.
// ═════════════════════════════════════════════════════════════════
(() => {
  'use strict';

  // re-injection / extension reload must not leave several message listeners
  try { window.__zhMetaOff && window.__zhMetaOff(); } catch (_) {}
  const listeners = [];
  window.__zhMetaOff = () => { listeners.forEach(fn => { try { chrome.runtime.onMessage.removeListener(fn); } catch (_) {} }); };

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  async function waitUntil(fn, ms, step = 300) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { let v = null; try { v = fn(); } catch (_) {} if (v) return v; await sleep(step); }
    return null;
  }
  const SEL = {
    editor: '[contenteditable="true"][data-testid="composer-input"], [contenteditable="true"][data-lexical-editor="true"], div[role="textbox"][contenteditable="true"]',
    send: '[data-testid="composer-send-button"], button[aria-label="Send"]',
    add: '[data-testid="composer-add-attachment-button"], button[aria-label="Add attachment"]',
    bot: '[data-testid="assistant-message"]'
  };

  function hud(text, type = 'info') {
    try {
      let el = document.getElementById('__zhunter_meta_hud');
      if (!el) {
        el = document.createElement('div'); el.id = '__zhunter_meta_hud';
        el.style.cssText = 'position:fixed;bottom:90px;right:24px;z-index:999999;background:#111827;color:#e5e7eb;border:1px solid #374151;border-radius:4px;padding:10px 14px;font:13px system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.45)';
        document.body.appendChild(el);
      }
      el.textContent = (type === 'ok' ? '✓ ' : type === 'warn' ? '⚠ ' : '⚡ ') + text;
      el.style.borderColor = type === 'ok' ? '#10b981' : type === 'warn' ? '#f59e0b' : '#374151';
      clearTimeout(el._t); el._t = setTimeout(() => el.remove(), type === 'info' ? 15000 : 6000);
    } catch (_) {}
  }
  const setResult = (job, status, extra = {}) => { try { chrome.storage.local.set({ ['zhGptRes_' + job.id]: { id: job.id, status, at: Date.now(), ...extra } }); } catch (_) {} };

  function dataUrlToFile(dataUrl, name) {
    try {
      const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataUrl || ''); if (!m) return null;
      const type = m[1] || 'image/png';
      const bin = m[2] ? atob(m[3]) : decodeURIComponent(m[3]);
      const buf = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
      const ext = /jpe?g/i.test(type) ? 'jpg' : /webp/i.test(type) ? 'webp' : 'png';
      return new File([buf], name.replace(/\.\w+$/, '') + '.' + ext, { type });
    } catch (_) { return null; }
  }
  const blobToDataUrl = b => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(b); });

  // the composer box = the smallest block that holds the editor AND the Send button
  function composerRoot() {
    const ed = document.querySelector(SEL.editor), send = document.querySelector(SEL.send);
    let r = ed;
    while (r && send && !r.contains(send)) r = r.parentElement;
    return r || ed?.parentElement || document.body;
  }
  // pictures waiting in the composer (the attached photo shows as a small preview there)
  const composerImgs = () => composerRoot().querySelectorAll('img').length;

  async function attachImage(dataUrl) {
    const file = dataUrlToFile(dataUrl, 'zhunter_product.png');
    if (!file) throw new Error('Image could not be converted');
    const ed = await waitUntil(() => document.querySelector(SEL.editor), 25000);
    if (!ed) throw new Error('Meta AI message box not found (is meta.ai open and signed in?)');
    await sleep(800);
    const before = composerImgs();
    // 1) the page's own file box (what "Add attachment" opens)
    const input = [...document.querySelectorAll('input[type="file"]')].find(i => /image/i.test(i.accept || '')) || document.querySelector('input[type="file"]');
    if (input) {
      try {
        const dt = new DataTransfer(); dt.items.add(file);
        input.files = dt.files;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      } catch (_) {}
      if (await waitUntil(() => composerImgs() > before, 8000)) { await sleep(1200); return; }
    }
    // 2) paste the picture into the message box
    try {
      ed.focus();
      const dt = new DataTransfer(); dt.items.add(file);
      ed.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }));
    } catch (_) {}
    if (await waitUntil(() => composerImgs() > before, 8000)) { await sleep(1200); return; }
    // 3) drop it on the composer
    try {
      const root = composerRoot(), dt = new DataTransfer(); dt.items.add(file);
      const o = { bubbles: true, cancelable: true, dataTransfer: dt };
      root.dispatchEvent(new DragEvent('dragenter', o)); root.dispatchEvent(new DragEvent('dragover', o)); await sleep(80); root.dispatchEvent(new DragEvent('drop', o));
    } catch (_) {}
    if (await waitUntil(() => composerImgs() > before, 8000)) { await sleep(1200); return; }
    throw new Error('The image did not attach in Meta AI');
  }

  async function typePrompt(text) {
    const ed = await waitUntil(() => document.querySelector(SEL.editor), 15000);
    if (!ed) throw new Error('Meta AI message box not found');
    ed.focus();
    const val = () => (ed.innerText || '').replace(/\s+/g, '');
    const want = String(text).replace(/\s+/g, '');
    // Lexical editor: a plain-text paste keeps the line breaks
    try { const dt = new DataTransfer(); dt.setData('text/plain', text); ed.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt })); } catch (_) {}
    if (await waitUntil(() => val().length >= want.length * 0.95, 2500)) return;
    try { ed.focus(); document.execCommand('insertText', false, text); } catch (_) {}
    if (await waitUntil(() => val().length >= want.length * 0.95, 3000)) return;
    throw new Error('The prompt did not enter the Meta AI message box');
  }

  const bots = () => [...document.querySelectorAll(SEL.bot)];
  // Meta's finished picture: big (≥ 512 px) image inside the newest answer; its file name looks like "gallery/image_….webp"
  function answerImage(bot, skip) {
    const imgs = [...bot.querySelectorAll('img')].filter(i => i.complete && i.naturalWidth >= 512 && !skip.has(i.currentSrc || i.src));
    const gal = imgs.filter(i => /^gallery\//i.test(i.alt || ''));
    const list = gal.length ? gal : imgs;
    return list.sort((a, b) => b.naturalWidth * b.naturalHeight - a.naturalWidth * a.naturalHeight)[0] || null;
  }
  // Meta's picture is a .webp on fbcdn.net (signed link). The page may not read it (CORS), so the extension's worker fetches it;
  // the webp is then turned into a high-quality JPEG (Temu and the image hosts take JPEG everywhere)
  async function toJpeg(dataUrl) {
    if (!/^data:image\/webp/i.test(dataUrl || '')) return dataUrl;
    try {
      const im = new Image(); im.src = dataUrl; await im.decode();
      const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight;
      const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(im, 0, 0);
      return c.toDataURL('image/jpeg', 0.95);
    } catch (_) { return dataUrl; }
  }
  async function readImage(img) {
    const src = img.currentSrc || img.src;
    try { const r = await fetch(src, { credentials: 'include' }); if (r.ok) { const b = await r.blob(); if (b.size > 1000) return await toJpeg(await blobToDataUrl(b)); } } catch (_) {}
    try { const r = await chrome.runtime.sendMessage({ action: 'FETCH_META_IMAGE', url: src }); if (r?.success && r.dataUrl) return await toJpeg(r.dataUrl); } catch (_) {}
    return null;
  }

  async function runImgJob(job) {
    if (!job?.id || !job.imgBase64) return;
    window.__zhMetaSeen = window.__zhMetaSeen || new Set();
    if (window.__zhMetaSeen.has(job.id)) return;
    window.__zhMetaSeen.add(job.id);
    if (window.__zhMetaBusy) { setResult(job, 'error', { error: 'This Meta AI tab is busy' }); return; }
    window.__zhMetaBusy = true;
    try {
      hud('ZHunter: editing the image in Meta AI…');
      setResult(job, 'working', { note: 'Meta AI: attaching image…' });
      await attachImage(job.imgBase64);
      setResult(job, 'working', { note: 'Meta AI: typing the prompt…' });
      await typePrompt(job.prompt);
      await sleep(700 + Math.random() * 600);
      const botBefore = bots().length;
      const seen = new Set([...document.querySelectorAll('img')].map(i => i.currentSrc || i.src));   // every picture already on the page
      const btn = await waitUntil(() => { const b = document.querySelector(SEL.send); return b && !b.disabled && b.getAttribute('aria-disabled') !== 'true' ? b : null; }, 20000);
      const started = () => bots().length > botBefore || !(document.querySelector(SEL.editor)?.innerText || '').trim();
      if (btn) { try { btn.click(); } catch (_) {} }
      if (!(await waitUntil(started, 5000))) {
        try { const ed = document.querySelector(SEL.editor); ed?.focus(); ed?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true })); } catch (_) {}
      }
      if (!(await waitUntil(started, 5000))) {
        hud('ZHunter: press Send in Meta AI yourself — I will read the picture', 'warn');
        setResult(job, 'working', { note: 'Press Send in the Meta AI tab' });
        if (!(await waitUntil(started, 5 * 60000, 500))) throw new Error('Message was not sent');
      }
      setResult(job, 'working', { note: 'Meta AI is creating the image…' });
      await waitUntil(() => bots().length > botBefore, 90000, 400);
      const t0 = Date.now(); let img = null, last = '', stable = 0, lastTxt = '', quiet = 0;
      while (Date.now() - t0 < 6 * 60000) {
        await sleep(1500);
        const list = bots(); const bot = list[list.length - 1];
        if (!bot || list.length <= botBefore) continue;
        const cand = answerImage(bot, seen);
        const txt = (bot.innerText || '').trim();
        if (cand) {
          const s = cand.currentSrc || cand.src;
          if (s === last) stable++; else { stable = 0; last = s; }
          if (stable >= 2) { img = cand; break; }
          continue;
        }
        if (/reached (your|the) (daily )?limit|too many (requests|images)|try again (later|tomorrow)|limit reached/i.test(txt) && txt.length < 800) throw new Error('LIMIT: ' + txt.slice(0, 140));
        if (txt === lastTxt) quiet++; else { quiet = 0; lastTxt = txt; }
        if (quiet >= 40 && txt.length > 40) throw new Error('Meta AI answered without a picture: ' + txt.slice(0, 120));
      }
      if (!img) throw new Error('Meta AI picture did not appear in time');
      setResult(job, 'working', { note: 'Meta AI: reading the picture…' });
      const dataUrl = await readImage(img);
      if (!dataUrl) throw new Error('Could not read the Meta AI picture');
      setResult(job, 'done', { dataUrl, chat: location.pathname });
      hud('Image ready — ZHunter is taking it', 'ok');
    } catch (e) {
      const m = e?.message || String(e);
      setResult(job, 'error', { error: m.replace(/^LIMIT:\s*/, ''), limit: /^LIMIT:/.test(m) });
      hud('ZHunter: ' + m.replace(/^LIMIT:\s*/, ''), 'warn');
    } finally { window.__zhMetaBusy = false; }
  }

  try {
    const onMsg = (msg, sender, sendResponse) => {
      if (msg?.action === 'ZH_META_PING') { try { sendResponse({ ok: true }); } catch (_) {} return; }
      if (msg?.action === 'ZH_META_IMG_RUN') { runImgJob(msg.job); try { sendResponse({ ok: true }); } catch (_) {} }
    };
    chrome.runtime?.onMessage?.addListener(onMsg); listeners.push(onMsg);
  } catch (_) {}
})();
