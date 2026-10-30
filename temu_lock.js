/* v9.22.33 — the Temu part (upload, Temu Export window, Repack, wizard) is hidden behind your own code.
   Locked: every Temu button is gone (header pill, Settings row, Bulk / Queue / Library buttons); after a hunt a small 🔒
   sits where "Temu upload" was. 🔒 → your code → everything comes back until Chrome is closed (chrome.storage.session).
   First time: you make the code (typed twice). Only a salted SHA-256 of it is kept (chrome.storage.local zhTemuLock).
   Unlocked: Settings has "🔒 Lock" and "Code badlo". Loaded after sidepanel.js and repack.js.
   v9.22.34 — a faint 🔒 in the Library export menu too; a backup code opens "Code bhool gaya?" → a new code.
   v9.22.35 — you type the backup code yourself (the same one can go in every Chrome profile).
   v9.22.36 — the "Temu upload" buttons are back on screen (Library bar, Library menu, after a hunt) but they never open
   anything. The only way in is the small status dot at the very bottom of the panel: dot → code → the Temu window.
   The code is asked again every time the panel is opened (kept only in this page's memory).
   v9.22.40 — 3 quick clicks on a secret spot, then the code is typed blind (no box) + Enter; see zlTap below. */
'use strict';

const ZL_KEY = 'zhTemuLock';
// look like the way in, never open anything (also when unlocked)
const ZL_DECOYS = '#bulkTemuBtn, #masterTemuBtn, #masterBulkTemuBtn, #topTemuStorePill, #settingsTemuOpenBtn, #bulkTemuOpenBtn, #queueTemuBtn';
// stopped only while locked
const ZL_GATES = '#temuRepackBtn, .zh-job-chip[data-job="upload"], .zh-job-chip[data-job="img"]';
let ZlBypass = false;   // set for the one click the dot makes itself

const zlIsOn = () => document.body.classList.contains('zh-temu-on');
function zlShow(on) {
  document.body.classList.toggle('zh-temu-on', !!on);
  if (!on) {   // locking: close what is open
    ['temuModal', 'rpModal', 'zhWiz', 'zhWizPick', 'temuImgStepperModal'].forEach(id => { const m = document.getElementById(id); if (m && !m.classList.contains('hidden')) m.classList.add('hidden'); });
  }
}
async function zlHash(code, salt) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + '|' + code));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
async function zlStored() { try { return (await chrome.storage.local.get(ZL_KEY))[ZL_KEY] || null; } catch (_) { return null; } }
// unlocked lives only in this panel page: closing the panel (or Chrome) locks again
async function zlSetUnlocked(on) { zlShow(on); if (on) setTimeout(zlAfterUnlock, 150); }
// v9.22.37 — right after the code: an image run that stopped (panel / Chrome closed) is offered first, nothing skipped
async function zlAfterUnlock() {
  try {
    const busy = typeof TemuImgStepper !== 'undefined' && !!TemuImgStepper?.running;
    const rem = !busy && typeof zhImgQueueRemaining === 'function' ? await zhImgQueueRemaining() : null;
    if (rem && typeof zhAsk === 'function') {
      const n = rem.left.length;
      if (await zhAsk('Adhoora kaam', `Image editing poori nahi hui thi: ${n} image${n === 1 ? '' : 's'} baqi (${rem.st.engine}). Jo ban chuki hain woh mehfooz hain. Wahin se resume karein?`, '▶ Resume')) {
        if (typeof openTemuModal === 'function') await openTemuModal();
        if (typeof zhImgQueueContinue === 'function') await zhImgQueueContinue();
        return;
      }
    }
  } catch (_) { /* nothing to resume */ }
  zlOpenTemu();
}
// what the dot opens: Library products ticked and the Library in view → upload those (like the Library button did);
// otherwise the Temu window with the start wizard
function zlOpenTemu() {
  if (!zlIsOn()) return;
  const lib = document.getElementById('masterTemuBtn');
  const libOpen = !!lib && !!document.getElementById('tab-btn-library')?.classList.contains('active') && typeof MasterUIState !== 'undefined' && MasterUIState?.selectedIds?.size > 0;
  if (libOpen) { ZlBypass = true; lib.disabled = false; try { lib.click(); } finally { ZlBypass = false; } return; }
  Promise.resolve(typeof openTemuModal === 'function' && openTemuModal()).then(() => typeof zhWizChoose === 'function' && zhWizChoose()).catch(() => {});
}

function zlModal() {
  let m = document.getElementById('zlModal');
  if (m) return m;
  m = document.createElement('div');
  m.id = 'zlModal'; m.className = 'modal-back zl-modal hidden';
  m.innerHTML = `<div class="modal-box zl-box" role="dialog" aria-label="Code">
    <div class="zl-ico" aria-hidden="true">🔒</div>
    <b class="zl-title"></b>
    <p class="zl-msg"></p>
    <input class="zl-in zl-a" type="password" autocomplete="off" spellcheck="false">
    <input class="zl-in zl-b" type="password" autocomplete="off" spellcheck="false" hidden>

    <p class="zl-err" aria-live="polite"></p>
    <div class="zl-btns"><button type="button" class="btn btn-ghost btn-xs" data-zl="cancel">Cancel</button><button type="button" class="btn btn-primary btn-xs" data-zl="ok">OK</button></div>
    <button type="button" class="zl-forgot" data-zl="forgot">Code bhool gaya?</button>
  </div>`;
  document.body.appendChild(m);
  m.addEventListener('click', e => {
    if (e.target === m || e.target.closest('[data-zl="cancel"]')) zlClose();
    else if (e.target.closest('[data-zl="ok"]')) zlSubmit();
    else if (e.target.closest('[data-zl="forgot"]')) zlOpenBox('recover');

  });
  m.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); zlSubmit(); } else if (e.key === 'Escape') zlClose(); });
  return m;
}
let ZlMode = 'open';   // open | create | change-old | change-new | backup-set | recover
let ZlPending = null;  // v9.22.35 — the new code, kept here until its backup code is typed too
function zlOpenBox(mode) {
  ZlMode = mode;
  const m = zlModal(), a = m.querySelector('.zl-a'), b = m.querySelector('.zl-b');
  const txt = {
    open: ['Code daalo', '', 'Code'],
    create: ['Naya code banao', 'Apni marzi ka code likho (kam se kam 4 harf), phir dobara wahi likho. Har profile mein wahi code rakh sakte ho.', 'Naya code'],
    'change-old': ['Code badlo', 'Pehle purana code likho.', 'Purana code'],
    'change-new': ['Naya code', 'Naya code likho, phir dobara wahi likho.', 'Naya code'],
    'backup-set': ['Backup code banao', 'Ek doosra code likho (kam se kam 6 harf) — code bhool jao to is se naya code bana sakte ho. Har profile mein wahi backup code rakh sakte ho.', 'Backup code'],
    recover: ['Code bhool gaye?', 'Apna backup code likho.', 'Backup code']
  }[mode];
  m.querySelector('.zl-title').textContent = txt[0];
  const msg = m.querySelector('.zl-msg'); msg.textContent = txt[1]; msg.hidden = !txt[1];
  a.placeholder = txt[2]; a.value = ''; b.value = '';
  b.placeholder = mode === 'backup-set' ? 'Dobara wahi backup code' : 'Dobara wahi code';
  b.hidden = !(mode === 'create' || mode === 'change-new' || mode === 'backup-set');
  m.querySelector('.zl-forgot').hidden = mode !== 'open';
  m.querySelector('.zl-err').textContent = '';
  m.classList.remove('hidden');
  setTimeout(() => a.focus(), 30);
}
function zlClose() { ZlPending = null; document.getElementById('zlModal')?.classList.add('hidden'); }
function zlErr(t) {
  const m = zlModal(), e = m.querySelector('.zl-err'); e.textContent = t;
  const box = m.querySelector('.zl-box'); box.classList.remove('zl-shake'); void box.offsetWidth; box.classList.add('zl-shake');
}
// backup codes: capitals, spaces and dashes do not matter
const zlNorm = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const zlRand = n => [...crypto.getRandomValues(new Uint8Array(n))].map(x => x.toString(16).padStart(2, '0')).join('');
async function zlSubmit() {
  const m = zlModal(), a = m.querySelector('.zl-a').value, b = m.querySelector('.zl-b').value;
  if (ZlMode === 'create' || ZlMode === 'change-new') {
    if (a.length < 4) return zlErr('Kam se kam 4 harf ka code');
    if (a !== b) return zlErr('Dono code ek jaise nahi');
    const keepMode = ZlMode;
    zlOpenBox('backup-set'); ZlPending = { code: a, mode: keepMode };
    return;
  }
  if (ZlMode === 'backup-set') {
    if (zlNorm(a).length < 6) return zlErr('Backup code kam se kam 6 harf / number');
    if (zlNorm(a) !== zlNorm(b)) return zlErr('Dono backup code ek jaise nahi');
    const st = await zlStored(), pend = ZlPending;
    if (pend && zlNorm(a) === zlNorm(pend.code)) return zlErr('Backup code, code se alag rakho');
    if (pend) {   // a new code + its backup code
      const salt = zlRand(12);
      await chrome.storage.local.set({ [ZL_KEY]: { salt, hash: await zlHash(pend.code, salt), bkHash: await zlHash(zlNorm(a), salt), bkOwn: true, at: Date.now() } });
      toast(pend.mode === 'create' ? '✓ Code ban gaya — khul gaya' : '✓ Naya code + backup code ban gaye', 'ok');
    } else if (st) {   // only a backup code for the code you have
      await chrome.storage.local.set({ [ZL_KEY]: { ...st, bkHash: await zlHash(zlNorm(a), st.salt), bkOwn: true } });
      toast('✓ Backup code ban gaya', 'ok');
    }
    zlClose();
    await zlSetUnlocked(true);
    return;
  }
  if (ZlMode === 'recover') {
    const st0 = await zlStored();
    if (!st0?.bkHash) return zlErr('Is code ka koi backup code nahi bana tha');
    if ((await zlHash(zlNorm(a), st0.salt)) !== st0.bkHash) { m.querySelector('.zl-a').value = ''; return zlErr('Galat backup code'); }
    zlOpenBox('change-new');
    return;
  }
  const st = await zlStored();
  if (!st) { zlOpenBox('create'); return; }
  if ((await zlHash(a, st.salt)) !== st.hash) { m.querySelector('.zl-a').value = ''; return zlErr('Galat code'); }
  if (ZlMode === 'change-old') { zlOpenBox('change-new'); return; }
  // no backup code of your own yet (none, or the random one of 9.22.34): ask for one now
  if (!st.bkOwn) { zlOpenBox('backup-set'); return; }
  zlClose();
  await zlSetUnlocked(true);
  toast('✓ Khul gaya', 'ok');
}

// the "Temu upload" look-alikes never open anything; the Repack / upload chips only while unlocked
document.addEventListener('click', e => {
  if (ZlBypass) return;
  if (e.target.closest?.(ZL_DECOYS) || (!zlIsOn() && e.target.closest?.(ZL_GATES))) { e.preventDefault(); e.stopImmediatePropagation(); }
}, true);
document.addEventListener('click', e => {
  if (e.target.closest?.('#zlLockBtn')) { zlSetUnlocked(false); toast('🔒 Band ho gaya', 'info'); }
  else if (e.target.closest?.('#zlChangeBtn')) zlOpenBox('change-old');
  // the way in: 3 quick clicks on the status dot, the ⋯ or the • (one or two clicks do nothing)
  else if (e.target.closest?.('.status-line > .dot, #zlMore, .zl-dot')) zlTap();
});

/* v9.22.40 — nothing on screen gives the way away. 3 clicks within 1 second on a secret spot, then (locked) the code
   is typed blind: no box, no cursor, no message — Enter checks it. Right code = the Temu window; your backup code =
   the "Naya code" box; anything else = nothing happens. 20 s without Enter = forgotten. A profile with no code yet
   shows the "Naya code banao" box once (that is you setting it up). */
let ZlTaps = [];
let ZlListen = null;   // { buf, until, timer }
// v9.22.41 — small signs on the secret spots only you know how to read: a tap = a tiny blink, 3 taps = they glow
// softly while you type, each key = a short flash, wrong = a short red blink, right = green
const ZL_SPOTS = '.status-line > .dot, #zlMore, .zl-dot';
function zlFx(cls, ms) {
  document.querySelectorAll(ZL_SPOTS).forEach(el => { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); });
  if (ms) setTimeout(() => document.querySelectorAll(ZL_SPOTS).forEach(el => el.classList.remove(cls)), ms);
}
function zlStopListen() {
  if (ZlListen?.timer) clearTimeout(ZlListen.timer);
  ZlListen = null;
  document.querySelectorAll(ZL_SPOTS).forEach(el => el.classList.remove('zl-listen'));
}
async function zlTap() {
  const now = Date.now();
  ZlTaps = ZlTaps.filter(t => now - t < 1000); ZlTaps.push(now);
  zlFx('zl-tap', 350);
  if (ZlTaps.length < 3) return;
  ZlTaps = [];
  if (zlIsOn()) { zlFx('zl-ok', 700); zlOpenTemu(); return; }
  if (!(await zlStored())) { zlOpenBox('create'); return; }
  zlStopListen();
  ZlListen = { buf: '', until: Date.now() + 20000, timer: setTimeout(zlStopListen, 20000) };
  zlFx('zl-listen');
}
async function zlBlindCheck(typed) {
  const st = await zlStored(); if (!st || !typed) { zlFx('zl-bad', 600); return; }
  if ((await zlHash(typed, st.salt)) === st.hash) {
    zlFx('zl-ok', 900);
    if (!st.bkOwn) { zlOpenBox('backup-set'); return; }   // an older code without your own backup code: once
    await zlSetUnlocked(true);
    return;
  }
  if (st.bkHash && (await zlHash(zlNorm(typed), st.salt)) === st.bkHash) { zlFx('zl-ok', 900); zlOpenBox('change-new'); return; }   // code forgotten
  zlFx('zl-bad', 600);
}
document.addEventListener('keydown', e => {
  const L = ZlListen; if (!L) return;
  if (Date.now() > L.until || zlIsOn()) { zlStopListen(); return; }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === 'Enter') { const t = L.buf; zlStopListen(); zlBlindCheck(t); }
  else if (e.key === 'Escape') zlStopListen();
  else if (e.key === 'Backspace') { L.buf = L.buf.slice(0, -1); zlFx('zl-key', 160); }
  else if (e.key.length === 1) { L.buf += e.key; zlFx('zl-key', 160); }
  else return;
  // the keys go to the code only, never into a box on the page
  e.preventDefault(); e.stopImmediatePropagation();
}, true);

// Lock / Code badlo in Settings (seen only while unlocked)
(function zlInit() {
  const row = document.getElementById('settingsTemuOpenBtn')?.closest('.it');
  if (row && !document.getElementById('zlLockBtn')) {
    row.classList.add('zl-set-row');
    const w = document.createElement('div');
    w.className = 'zl-set-btns';
    w.innerHTML = '<button type="button" id="zlChangeBtn" class="btn btn-ghost btn-xs">Code badlo</button><button type="button" id="zlLockBtn" class="btn btn-ghost btn-xs">🔒 Lock</button>';
    row.appendChild(w);
  }
  // v9.22.38 — the hunt result window covers the bottom line: a faint dot after "What next?" there
  const wn = document.querySelector('.bulk-result-actions .bp-actions-lbl');
  if (wn && !wn.querySelector('.zl-dot')) {
    const d = document.createElement('span');
    d.className = 'zl-dot'; d.textContent = '•'; d.setAttribute('aria-hidden', 'true');
    wn.appendChild(d);
  }
  // v9.22.37 — a second way in: a faint "⋯" at the right end of the bottom line
  const foot = document.querySelector('.status-line');
  if (foot && !document.getElementById('zlMore')) {
    const d = document.createElement('span');
    d.id = 'zlMore'; d.textContent = '⋯'; d.setAttribute('aria-hidden', 'true');
    foot.appendChild(d);
  }
  zlShow(false);
})();