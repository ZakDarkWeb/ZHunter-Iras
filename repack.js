/* v9.22.7 — Repack: products already on Temu get a new (smaller) pack count or new pictures.
   Tick products on Temu "Manage products" → 📦 Repack reads them → per product: new pack count, your own prompt,
   which images to edit → the AI edits them in bulk → copy the title, download the images, "Open on Temu".
   Loaded after sidepanel.js and uses its helpers (temuReadTicked, temuStartBulkImageEdit, zhApplyImgEdits, zhImageToPngBlob, zhSaveBlob, zhLibAll).
   v9.22.12 — one prompt for all + each product's own prompt, saved prompts, image ticks per product, open the product on Temu.
   v9.22.19 — per image 🗑 / ★, your own image files, all titles at once (copy / paste back), and "Apply on Temu":
   title + description / bullets cleared + images + Submit on the product's edit page. */
'use strict';

const RP_KEY = 'zhRepack', RP_PROMPT_KEY = 'zhRepackPrompt', RP_OPT_KEY = 'zhRepackOpts';
const RP_MAX_AI = 24;   // the AI pack prompt cannot draw more units than this reliably
// v9.22.44 — the Step 3 switch sets every SKU's list price; v9.22.57 — a random $79.99 … $99.99 per product (zhRandListPrice)
const RP_LIST_TXT = '$79.99 – $99.99';
const Rp = { items: [], prompt: '', loaded: false, timer: 0, clearText: true, submit: true, listPrice: false, ttIds: null, busy: false, open: new Set(), lastId: '' };

// "50 Pack", "50-Pack", "50 Count", "50 ct", "50 pcs", "Pack of 50"
const RP_NUM_RE = /\b(\d{1,3})(\s*-?\s*)(pack|pk|count|ct|pcs|pieces|piece)\b/gi;
const RP_OF_RE = /\b(pack\s+of\s+)(\d{1,3})\b/gi;
function rpOldN(title) {
  const t = String(title || '');
  const a = new RegExp(RP_NUM_RE.source, 'i').exec(t), b = new RegExp(RP_OF_RE.source, 'i').exec(t);
  const pa = a ? a.index : Infinity, pb = b ? b.index : Infinity;
  if (pa === Infinity && pb === Infinity) return 0;
  return parseInt(pa <= pb ? a[1] : b[2], 10) || 0;
}
// Only the numbers that are the old pack count change; with no count in the title, "N Pack - " goes in front.
function rpNewTitle(title, oldN, newN) {
  const t = String(title || '').trim();
  if (!newN) return t;
  if (!oldN) return `${newN} Pack - ${t}`;
  return t.replace(RP_NUM_RE, (m, n, sp, w) => (parseInt(n, 10) === oldN ? `${newN}${sp}${w}` : m))
          .replace(RP_OF_RE, (m, pre, n) => (parseInt(n, 10) === oldN ? `${pre}${newN}` : m));
}
const rpUrlOf = img => (typeof img === 'string' ? img : img?.url || '');
const rpImgs = it => (Array.isArray(it.images) ? it.images.map(rpUrlOf) : []);
const rpImg = it => rpImgs(it)[0] || '';
const rpEditedAt = (it, i) => { const cur = rpImgs(it)[i], o = (it.origImgs || [])[i]; return !!cur && !!o && cur !== o; };
const rpEditedIdx = it => rpImgs(it).map((_, i) => i).filter(i => rpEditedAt(it, i));
const rpEdited = it => rpEditedIdx(it).length > 0;
const rpPicks = it => (Array.isArray(it.pick) && it.pick.length ? it.pick : [0]).filter(i => i < rpImgs(it).length);
// the prompt this product uses: its own, else the one for all ({N} = the new pack count)
// (9.22.22: each product's own prompt box is gone — only the prompt for all counts)
const rpPromptOf = it => String(Rp.prompt.trim()).split('{N}').join(String(Number(it.newN) || it.oldN || ''));
const rpCanRun = it => rpPicks(it).length > 0 && (!!rpPromptOf(it) || (Number(it.newN) >= 2 && Number(it.newN) <= RP_MAX_AI));
// v9.22.19 — what goes on Temu: your own images (Flow etc.) first, then the Temu images not marked 🗑; ★ moves one to the front.
// Keys: 'o2' = your own image no. 3, 'i4' = Temu image no. 5 (its AI-edited version when there is one).
const RP_MAX_TEMU = 10;
const rpOwn = it => (Array.isArray(it.own) ? it.own : []);
const rpDrop = it => new Set(Array.isArray(it.drop) ? it.drop : []);
function rpFinalKeys(it) {
  const drop = rpDrop(it);
  const keys = [...rpOwn(it).map((_, i) => 'o' + i), ...rpImgs(it).map((_, i) => 'i' + i).filter((_, i) => !drop.has(i))];
  const m = keys.indexOf(it.main); if (m > 0) keys.unshift(keys.splice(m, 1)[0]);
  return keys;
}
const rpKeyUrl = (it, k) => (k[0] === 'o' ? rpOwn(it)[+k.slice(1)] : rpImgs(it)[+k.slice(1)]) || '';
const rpImgsChanged = it => rpOwn(it).length > 0 || rpDrop(it).size > 0 || rpEdited(it) || (!!it.main && rpFinalKeys(it)[0] !== 'i0');
// v9.22.25 — package weight (lb) and size (in): empty = keep what Temu has
const rpNewW = it => { const w = parseFloat(it.newW); return w > 0 ? w : 0; };
const rpNewDims = it => { const d = (Array.isArray(it.newDims) ? it.newDims : []).map(x => parseFloat(x)); return d.length === 3 && d.every(x => x > 0) ? d : null; };
const rpTitleChanged = it => !!String(it.title || '').trim() && String(it.title).trim() !== String(it.oldTitle || '').trim();
const rpEsc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const rpSafeName = s => String(s || 'product').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 50) || 'product';

async function rpLoad() {
  if (!Rp.loaded) {
    try {
      const r = await chrome.storage.local.get([RP_KEY, RP_PROMPT_KEY, RP_OPT_KEY]);
      Rp.items = r?.[RP_KEY] || []; Rp.prompt = r?.[RP_PROMPT_KEY] || '';
      const o = r?.[RP_OPT_KEY] || {};
      Rp.clearText = o.clearText !== false; Rp.submit = o.submit !== false; Rp.listPrice = o.listPrice === true; Rp.par = [1, 2, 3].includes(o.par) ? o.par : 1; Rp.ttIds = Array.isArray(o.ttIds) ? o.ttIds : null;
    } catch (_) { Rp.items = []; }
    // lists saved by 9.22.7 knew only the first original image
    Rp.items = Rp.items.filter(it => !it.temuSubmitted);   // submitted before 9.22.26: done, off the list
    Rp.items.forEach(it => { if (!Array.isArray(it.origImgs)) it.origImgs = [it.origMain || rpImg(it), ...rpImgs(it).slice(1)]; });
    Rp.loaded = true;
  }
  try { await zhApplyImgEdits(Rp.items); } catch (_) { /* no edit journal yet */ }   // new images come back after a reload
  return Rp.items;
}
async function rpSave() {
  try { await chrome.storage.local.set({ [RP_KEY]: Rp.items.map(({ _repackQty, _repackPrompt, ...it }) => it), [RP_PROMPT_KEY]: Rp.prompt, [RP_OPT_KEY]: { clearText: Rp.clearText, submit: Rp.submit, listPrice: Rp.listPrice, par: Rp.par, ttIds: Rp.ttIds } }); }
  catch (e) { toast('Repack list could not be saved: ' + (e?.message || e), 'warn'); }
}

// v9.22.42 — line icons instead of emoji in the Repack window
const rpIc = d => `<svg class="rp-svg" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const RP_IC = {
  box: rpIc('<path d="M21 8 12 3 3 8l9 5 9-5Z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/>'),
  plus: rpIc('<path d="M12 5v14M5 12h14"/>'),
  text: rpIc('<path d="M4 6h16M4 12h10M4 18h13"/>'),
  spark: rpIc('<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18"/>'),
  up: rpIc('<path d="M12 19V6M6 11l6-6 6 6"/><path d="M5 21h14"/>'),
  win: rpIc('<rect x="3" y="5" width="14" height="12" rx="2"/><path d="M7 21h12a2 2 0 0 0 2-2V9"/>'),
  x: rpIc('<path d="M6 6l12 12M18 6 6 18"/>'),
  star: rpIc('<path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9L12 3.5Z"/>'),
  copy: rpIc('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>'),
  undo: rpIc('<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>'),
  upload: rpIc('<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>'),
  clip: rpIc('<rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4V3h6v1M9 10h6M9 14h4"/>')
};
function rpModal() {
  let m = $('rpModal');
  if (m) return m;
  m = document.createElement('div');
  m.id = 'rpModal'; m.className = 'modal-back rp-modal hidden';
  m.innerHTML = `<div class="modal-box rp-box" role="dialog" aria-label="Repack">
    <div class="rp-head">
      <span class="rp-logo" aria-hidden="true">${RP_IC.box}</span>
      <div class="rp-head-t"><b>Repack</b><span class="rp-sub">Change the title, images and weight of products listed on Temu</span></div>
      <button type="button" class="rp-x" data-rp="close" aria-label="Close">${RP_IC.x}</button>
    </div>
    <ol class="rp-flow">
      <li class="rp-step" data-step="1">
        <span class="rp-step-n">1</span>
        <div class="rp-step-h"><b>Add products</b><small>Tick products on Temu <i>Manage products</i>, then press this</small></div>
        <button type="button" class="btn btn-primary rp-btn-block" data-rp="read" title="The products ticked on Temu Manage products come into this list (ones already here are refreshed)">${RP_IC.plus}<span>Add products</span></button>
        <details class="rp-steps"><summary>How does it work?</summary>
          <ol>
            <li>Tick products on Temu → <b>Add products</b>. <b>✕</b> on a line = remove it from the list.</li>
            <li>Click a line = open its card. Click an image = see it big, <b>★</b> main, <b>⧉</b> copy, <b>✕</b> remove (↺ undo), <b>✨</b> AI edit.</li>
            <li>An image from Flow: <b>Paste image</b>, <b>My image</b> or drag it onto the card — it goes first.</li>
            <li>Write the title in the card, or use <b>All titles at once</b>. Empty weight / size = Temu's value stays.</li>
            <li><b>Apply on Temu</b>: title, description + bullets cleared, images, weight / size, then Submit. Temu pages run in a separate window behind yours; a submitted product leaves the list.</li>
          </ol>
        </details>
      </li>
      <li class="rp-step" data-step="2">
        <span class="rp-step-n">2</span>
        <div class="rp-step-h"><b>Edit</b><small>Open each product's card below — or use these tools on all at once</small></div>
        <details class="rp-sec rp-tt">
          <summary><span class="rp-ico">${RP_IC.text}</span><span class="rp-sum-t"><b>All titles at once</b><small>Copy → GPT / Gemini → paste the answer</small></span></summary>
          <div class="rp-sec-body">
            <div class="rp-btns"><button type="button" class="btn btn-ghost btn-xs" data-rp="ttcopy">Copy all titles</button><small class="rp-tt-info rp-help">A numbered list is copied.</small></div>
            <textarea class="rp-tt-paste rp-in" rows="4" placeholder="Paste the GPT / Gemini answer here (1. … 2. …)" aria-label="New titles"></textarea>
            <div class="rp-btns"><button type="button" class="btn btn-primary btn-xs" data-rp="ttapply">Apply titles</button></div>
          </div>
        </details>
        <details class="rp-sec rp-ai">
          <summary><span class="rp-ico">${RP_IC.spark}</span><span class="rp-sum-t"><b>AI images</b><small>If needed — let the AI make a pack image</small></span></summary>
          <div class="rp-sec-body">
            <div class="rp-field"><label class="rp-lbl">AI</label><select class="rp-eng-sel rp-in" aria-label="AI image engine"></select></div>
            <div class="rp-field">
              <div class="rp-field-head"><label class="rp-lbl">Prompt — for all products</label><select class="rp-lib rp-in" aria-label="Saved prompts"><option value="">Saved prompt…</option></select></div>
              <textarea class="rp-gprompt rp-in" rows="4" placeholder="e.g. Make one sleeve with 3 golf balls, combined in one clean product image, white background"></textarea>
              <small class="rp-help"><b>{N}</b> = new pack count · leave empty = pack image only (from the card's "New packs")</small>
            </div>
            <div class="rp-btns"><button type="button" class="btn btn-primary btn-xs" data-rp="ai">Make images</button><button type="button" class="btn btn-ghost btn-xs" data-rp="dlall">Download all new images</button></div>
          </div>
        </details>
      </li>
      <li class="rp-step" data-step="3">
        <span class="rp-step-n">3</span>
        <div class="rp-step-h"><b>Apply on Temu</b><small>${RP_IC.win} Temu pages open in a separate window behind yours and close by themselves</small></div>
        <div class="rp-apply-box">
          <label class="rp-switch"><input type="checkbox" class="rp-opt-clear"><span class="rp-sw" aria-hidden="true"></span>Remove the old description + bullet points</label>
          <label class="rp-switch"><input type="checkbox" class="rp-opt-list"><span class="rp-sw" aria-hidden="true"></span>Set the list price → <b>${RP_LIST_TXT}</b> <small>(random)</small></label>
          <label class="rp-switch"><input type="checkbox" class="rp-opt-submit"><span class="rp-sw" aria-hidden="true"></span>Press Submit at the end</label>
          <div class="rp-field rp-inline"><label class="rp-lbl">At once</label><select class="rp-opt-par rp-in" aria-label="Tabs at once" title="How many Temu tabs run at the same time (in a separate window behind yours)"><option value="1">1 tab</option><option value="2">2 tabs</option><option value="3">3 tabs</option></select></div>
          <button type="button" class="btn btn-primary rp-btn-block" data-rp="applyall">Apply all on Temu</button>
        </div>
      </li>
    </ol>
    <div class="rp-status" aria-live="polite"></div>
    <div class="rp-listhead"><b>Products</b><span class="rp-count">0</span><span class="rp-flex"></span><button type="button" class="btn btn-ghost btn-xs" data-rp="openall">▾ Open all</button><button type="button" class="btn btn-ghost btn-xs rp-clear" data-rp="clear">Clear list</button></div>
    <div class="rp-list"></div>
    <input type="file" class="rp-file" accept="image/*" multiple hidden>
  </div>`;
  document.body.appendChild(m);
  m.addEventListener('click', rpClick);
  m.addEventListener('input', rpInput);
  // your own images: a card's "My image", or files dropped on the card
  m.addEventListener('dragover', e => { if (e.target.closest('.rp-card') && [...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); e.target.closest('.rp-card').classList.add('drop'); } });
  m.addEventListener('dragleave', e => e.target.closest('.rp-card')?.classList.remove('drop'));
  m.addEventListener('drop', e => {
    const card = e.target.closest('.rp-card'); if (!card) return;
    e.preventDefault(); card.classList.remove('drop');
    const it = Rp.items.find(x => x.id === card.dataset.id); if (it) rpAddOwn(it, e.dataTransfer.files);
  });
  m.addEventListener('change', e => {
    if (e.target.classList.contains('rp-file')) {
      const it = Rp.items.find(x => x.id === Rp.fileFor);
      if (it) rpAddOwn(it, e.target.files);
      e.target.value = '';
    }
    else if (e.target.classList.contains('rp-opt-clear')) { Rp.clearText = e.target.checked; rpSave(); }
    else if (e.target.classList.contains('rp-opt-list')) { Rp.listPrice = e.target.checked; rpSave(); rpRender(); }
    else if (e.target.classList.contains('rp-opt-par')) { Rp.par = Number(e.target.value) || 1; rpSave(); }
    else if (e.target.classList.contains('rp-opt-submit')) { Rp.submit = e.target.checked; rpSave(); rpUpdateAiBtn(); }
    else if (e.target.closest('.rp-eng-sel')) rpEngineSet(e.target.value);
    else if (e.target.closest('.rp-lib')) {
      const lib = (typeof zhLibAll === 'function' ? zhLibAll() : []).find(x => x.id === e.target.value);
      if (lib?.text) { Rp.prompt = lib.text; m.querySelector('.rp-gprompt').value = lib.text; rpSave(); rpUpdateAiBtn(); }
      e.target.value = '';
    }
  });
  return m;
}
function rpSay(t) {
  const s = $('rpModal')?.querySelector('.rp-status'); if (!s) return;
  s.hidden = !t; s.innerHTML = '';
  // v9.22.42 — while products are read or put on Temu, "x / y" in the first line also shows as a bar
  const head = String(t || '').split('\n')[0], pm = (Rp.busy || /^Reading\b/.test(head)) && head.match(/(\d+)\s*\/\s*(\d+)/);
  if (pm && +pm[2] > 0) {
    const bar = document.createElement('div'); bar.className = 'rp-prog';
    const fill = document.createElement('i'); fill.style.width = Math.min(100, Math.round(+pm[1] / +pm[2] * 100)) + '%';
    bar.appendChild(fill); s.appendChild(bar);
  }
  // v9.22.32 — one line each: ✓ green, ✗ red, the first line bold
  String(t || '').split('\n').filter(Boolean).forEach((l, i) => {
    const d = document.createElement('div');
    d.className = 'rp-log' + (i === 0 ? ' head' : '') + (/^✓/.test(l) ? ' ok' : /^✗/.test(l) ? ' bad' : '');
    d.textContent = l; s.appendChild(d);
  });
}

// the engine choice is the same one the Temu Export image tools use
function rpEngineFill() {
  const src = $('temuAiImgEngineSel'), sel = $('rpModal')?.querySelector('.rp-eng-sel');
  if (!sel) return;
  sel.innerHTML = '';
  if (src) [...src.options].forEach(o => sel.add(new Option(o.textContent, o.value)));
  else sel.add(new Option('Flow', 'flow'));
  sel.value = src?.value || sel.options[0]?.value || 'flow';
}
function rpEngineSet(v) {
  const src = $('temuAiImgEngineSel');
  if (src) { src.value = v; src.dispatchEvent(new Event('change', { bubbles: true })); }
  else chrome.storage.local.set({ zhImgEngine: v }).catch(() => {});
}
function rpLibFill() {
  const sel = $('rpModal')?.querySelector('.rp-lib'); if (!sel) return;
  while (sel.options.length > 1) sel.remove(1);
  try { (typeof zhLibAll === 'function' ? zhLibAll() : []).filter(e => e && e.text).forEach(e => sel.add(new Option(e.name || e.id, e.id))); } catch (_) { /* no library */ }
}

function rpWarn(it) {
  const n = Number(it.newN) || 0, own = !!rpPromptOf(it);
  if (n > RP_MAX_AI && !own) return `More than ${RP_MAX_AI}: no AI pack image (write a prompt, or make the image yourself). The title was changed.`;
  if (n === 1 && !own) return '1 pack: no AI pack image — write a prompt if the image should change.';
  return '';
}
function rpCard(it, idx) {
  const n = Number(it.newN) || 0, imgs = rpImgs(it), picks = new Set(rpPicks(it)), w = rpWarn(it);
  const ed = rpEditedIdx(it).length, drop = rpDrop(it), fin = rpFinalKeys(it), main = fin[0], own = rpOwn(it);
  const no = (idx >= 0 ? idx : Rp.items.indexOf(it)) + 1, open = Rp.open.has(it.id);
  const state = it.temuDoneAt ? `<span class="rp-state ok">✓ Applied on Temu${it.temuSubmitted ? ' + Submit' : ''}</span>`
    : ed ? `<span class="rp-state ok">✓ ${ed} new image${ed === 1 ? '' : 's'}</span>` : rpCanRun(it) ? '<span class="rp-state">Images to do</span>' : '';
  // v9.22.43 — each image: a bigger tile, then one even row of icon buttons (★ main, copy, AI, remove)
  const acts = k => `<div class="rp-tw-acts"><button type="button" data-rp="main" data-k="${k}" title="Make this the main (first) image"${k === main ? ' class="on"' : ''}>${RP_IC.star}</button><button type="button" data-rp="cpimg" data-k="${k}" title="Copy the image — then Ctrl+V in Flow / GPT / Gemini">${RP_IC.copy}</button>${k[0] === 'i' ? `<button type="button" data-rp="pick" data-i="${k.slice(1)}" title="${picks.has(+k.slice(1)) ? 'The AI will edit this image (Make images) — click: don\'t' : 'Click: let the AI edit this image (Make images)'}"${picks.has(+k.slice(1)) ? ' class="on"' : ''}>${RP_IC.spark}<b>AI</b></button>` : ''}${k[0] === 'o'
    ? `<button type="button" data-rp="owndel" data-i="${k.slice(1)}" title="Remove this image of yours">${RP_IC.x}</button>`
    : `<button type="button" data-rp="drop" data-i="${k.slice(1)}" title="${drop.has(+k.slice(1)) ? 'Will be removed — click: keep it' : 'Click: remove from Temu'}"${drop.has(+k.slice(1)) ? ' class="on"' : ''}>${drop.has(+k.slice(1)) ? RP_IC.undo : RP_IC.x}</button>`}</div>`;
  const ownHtml = own.map((u, i) => `<div class="rp-tw own${'o' + i === main ? ' main' : ''}"><button type="button" class="rp-th" data-rp="view" data-k="o${i}" title="Click: see it big"><img src="${rpEsc(u)}" alt="" loading="lazy"><span>Mine</span>${'o' + i === main ? '<em class="rp-mb">Main</em>' : ''}</button>${acts('o' + i)}</div>`).join('');
  const over = fin.length > RP_MAX_TEMU ? `<p class="rp-warn">Temu takes up to ${RP_MAX_TEMU} images — ${fin.length} are chosen, the last ${fin.length - RP_MAX_TEMU} will not go (press ✕).</p>` : '';
  // the line itself opens / closes the card; its ✕ takes the product off this list (9.22.24)
  const head = `<div class="rp-chw"><button type="button" class="rp-ch" data-rp="tog" aria-expanded="${open}"><span class="rp-no">${no}</span><img src="${rpEsc(main ? rpKeyUrl(it, main) : rpImg(it))}" alt="" loading="lazy"><span class="rp-ch-t">${rpEsc(it.title || it.oldTitle)}</span>${state}<span class="rp-chev">${open ? '▾' : '▸'}</span></button><button type="button" class="rp-ch-del" data-rp="del" title="Remove from the list (nothing changes on Temu)" aria-label="Remove">✕</button></div>`;
  if (!open) return `<div class="rp-card" data-id="${rpEsc(it.id)}">${head}</div>`;
  return `<div class="rp-card open" data-id="${rpEsc(it.id)}">${head}
   <div class="rp-cb">
    <img class="rp-img" src="${rpEsc(main ? rpKeyUrl(it, main) : rpImg(it))}" alt="" loading="lazy">
    <div class="rp-body">
      <div class="rp-old" title="${rpEsc(it.oldTitle)}">Old: ${rpEsc(it.oldTitle)}</div>
      <div class="rp-row">
        <span class="rp-meta">Old packs: <b>${it.oldN || '?'}</b></span>
        <label class="rp-n-lbl">New packs <input class="rp-n${n > RP_MAX_AI ? ' bad' : ''}" type="number" min="1" max="999" value="${n || ''}" placeholder="—" aria-label="New pack count"></label>
        <span class="rp-meta">Price: <b>${it.price ? '$' + rpEsc(it.price) : '—'}</b></span>
      </div>
      <p class="rp-warn"${w ? '' : ' hidden'}>${rpEsc(w)}</p>
      <div class="rp-thumbs" role="group" aria-label="Images">${ownHtml}${imgs.map((u, i) => `<div class="rp-tw${drop.has(i) ? ' gone' : ''}${'i' + i === main ? ' main' : ''}${picks.has(i) ? ' ai' : ''}"><button type="button" class="rp-th${rpEditedAt(it, i) ? ' done' : ''}" data-rp="view" data-k="i${i}" title="Click: see it big"><img src="${rpEsc(u)}" alt="" loading="lazy"><span>${i + 1}</span>${'i' + i === main ? '<em class="rp-mb">Main</em>' : ''}${picks.has(i) ? '<em class="rp-ab">AI</em>' : ''}</button>${acts('i' + i)}</div>`).join('')}
        <button type="button" class="rp-add" data-rp="own" title="Choose your own image file (e.g. from Google Flow) — or drag the file onto the card">${RP_IC.upload}<span>My image</span></button>
        <button type="button" class="rp-add" data-rp="paste" title="Paste a copied image here (or Ctrl+V while the card is open)">${RP_IC.clip}<span>Paste image</span></button></div>
      <p class="rp-hint rp-legend">Going to Temu: <b>${Math.min(fin.length, RP_MAX_TEMU)}</b> image${fin.length === 1 ? '' : 's'} · click an image to see it big</p>
      <p class="rp-hint rp-legend">${RP_IC.star} main · ${RP_IC.copy} copy · ${RP_IC.spark} AI edit · ${RP_IC.x} remove</p>${over}
      <textarea class="rp-title" rows="2" aria-label="New title">${rpEsc(it.title)}</textarea>
      <p class="rp-tsame"${rpTitleChanged(it) ? ' hidden' : ''}>The title is the same as before — it will not change on Temu.</p>
      <div class="rp-pack">
        <label>Weight <input class="rp-w" type="number" min="0" step="0.01" value="${rpEsc(it.newW || '')}" placeholder="${rpEsc(it.oldW || '—')}" aria-label="New weight in lb"> lb</label>
        <label>Size <input class="rp-d" data-d="0" type="number" min="0" step="0.01" value="${rpEsc((it.newDims || [])[0] || '')}" placeholder="${rpEsc((it.oldDims || [])[0] || 'L')}" aria-label="Length in inch">×<input class="rp-d" data-d="1" type="number" min="0" step="0.01" value="${rpEsc((it.newDims || [])[1] || '')}" placeholder="${rpEsc((it.oldDims || [])[1] || 'W')}" aria-label="Width in inch">×<input class="rp-d" data-d="2" type="number" min="0" step="0.01" value="${rpEsc((it.newDims || [])[2] || '')}" placeholder="${rpEsc((it.oldDims || [])[2] || 'H')}" aria-label="Height in inch"> in</label>
        <small>Empty = Temu's value stays (grey text = what Temu has now)</small>
      </div>
      <div class="rp-acts">
        <button type="button" class="btn btn-ghost btn-xs" data-rp="copy">Copy title</button>
        <button type="button" class="btn btn-ghost btn-xs" data-rp="dl"${ed ? '' : ' disabled'}>Download new images</button>
        <button type="button" class="btn btn-ghost btn-xs" data-rp="temu" title="Open this product's Temu edit page (Manage products must be open)">Open on Temu ↗</button>
        <span class="rp-flex"></span>
        <button type="button" class="btn btn-primary btn-xs" data-rp="apply" title="On the Temu edit page (in a separate window behind yours): new title, old description + bullets cleared, images replaced (if changed), then Submit (if ticked above)">Apply on Temu</button>
      </div>
    </div>
   </div>
  </div>`;
}function rpUpdateAiBtn() {
  const m = $('rpModal'); if (!m) return;
  const ready = Rp.items.filter(rpCanRun), imgs = ready.reduce((s, it) => s + rpPicks(it).length, 0);
  const b = m.querySelector('[data-rp="ai"]'); if (b) { b.disabled = !ready.length; b.textContent = ready.length ? `Images banao (${imgs})` : 'Images banao'; }
  const d = m.querySelector('[data-rp="dlall"]'); if (d) d.disabled = !Rp.items.some(rpEdited);
  const n = Rp.items.filter(rpHasWork).length, ap = m.querySelector('[data-rp="applyall"]');
  if (ap) { ap.disabled = !n || Rp.busy; ap.textContent = Rp.busy ? 'Applying on Temu…' : `Apply all on Temu${n ? ` (${n})` : ''}${Rp.submit ? ' + Submit' : ''}`; }
  // v9.22.42 — the steps: 1 is ticked once products are in the list; 2 and 3 wait for them
  const has = Rp.items.length > 0;
  m.querySelectorAll('.rp-step').forEach(s => {
    const k = s.dataset.step, nEl = s.querySelector('.rp-step-n');
    s.classList.toggle('is-done', k === '1' && has);
    s.classList.toggle('is-off', k !== '1' && !has);
    if (nEl) nEl.textContent = k === '1' && has ? '✓' : k;
  });
}
const rpHasWork = it => !it.temuDoneAt && (rpTitleChanged(it) || rpImgsChanged(it) || !!rpNewW(it) || !!rpNewDims(it) || Rp.clearText || Rp.listPrice);
// what "Apply on Temu" will do for this product, in words (for the question before it starts)
function rpPlanText(it) {
  const p = [];
  p.push(rpTitleChanged(it) ? 'new title' : 'same title (no change)');
  if (Rp.clearText) p.push('description + bullets cleared');
  if (rpImgsChanged(it)) p.push(`${Math.min(rpFinalKeys(it).length, RP_MAX_TEMU)} images`);
  if (Rp.listPrice) p.push(`list price ${RP_LIST_TXT} (random)`);
  if (rpNewW(it)) p.push(`weight ${rpNewW(it)} lb`);
  if (rpNewDims(it)) p.push(`size ${rpNewDims(it).join(' × ')} in`);
  return p.join(', ');
}
function rpRender() {
  const m = $('rpModal'); if (!m) return;
  const list = m.querySelector('.rp-list');
  // a box being typed in is not redrawn (the caret would jump)
  // (only a text box: a clicked button keeps the focus too, and its card must redraw — 9.22.21)
  const act = document.activeElement, keepId = act && list.contains(act) && act.matches('textarea, input:not([type="checkbox"]):not([type="file"])') ? act.closest('.rp-card')?.dataset.id : '';
  if (keepId) {
    list.querySelectorAll('.rp-card').forEach(c => {
      if (c.dataset.id === keepId) return;
      const it = Rp.items.find(x => x.id === c.dataset.id); if (it) c.outerHTML = rpCard(it, Rp.items.indexOf(it));
    });
  } else list.innerHTML = Rp.items.length ? Rp.items.map(rpCard).join('') : '<p class="rp-empty">No products yet. Tick products on Temu, then press "Add products".</p>';
  const cnt = m.querySelector('.rp-count'); if (cnt) cnt.textContent = String(Rp.items.length);
  rpUpdateAiBtn();
}

async function rpOpen() {
  const m = rpModal();
  rpEngineFill(); rpLibFill();
  await rpLoad();
  m.querySelector('.rp-gprompt').value = Rp.prompt;
  m.querySelector('.rp-opt-clear').checked = Rp.clearText;
  m.querySelector('.rp-opt-submit').checked = Rp.submit;
  m.querySelector('.rp-opt-list').checked = !!Rp.listPrice;
  m.querySelector('.rp-opt-par').value = String(Rp.par || 1);
  rpSay('');
  rpRender();
  m.classList.remove('hidden');
  clearInterval(Rp.timer);
  // the AI writes the new images into these product objects while it runs: keep the cards current
  Rp.timer = setInterval(async () => {
    if ($('rpModal')?.classList.contains('hidden')) { clearInterval(Rp.timer); return; }
    const before = Rp.items.map(it => rpImgs(it).join(',')).join('|');
    try { await zhApplyImgEdits(Rp.items); } catch (_) { /* journal busy */ }
    if (Rp.items.map(it => rpImgs(it).join(',')).join('|') !== before) { rpRender(); rpSave(); }
  }, 2500);
}
function rpClose() { $('rpModal')?.classList.add('hidden'); clearInterval(Rp.timer); rpSave(); }

async function rpRead() {
  const m = $('rpModal'), btn = m?.querySelector('[data-rp="read"]'), lbl = btn?.querySelector('span');
  if (btn) btn.disabled = true;
  if (lbl) lbl.textContent = 'Adding products…';
  try {
    const got = await temuReadTicked(rpSay);
    if (!got) return;
    const { done, problems } = got;
    let added = 0;
    for (const { p, d } of done) {
      const imgs = (d.images || []).filter(Boolean);
      if (!imgs.length) { problems.push(`${String(p.title || p.goodsId).slice(0, 40)}: images not found`); continue; }
      const title = String(d.title || p.title || '').trim(), s0 = (d.skus && d.skus[0]) || {};
      const base = parseFloat(s0.base);
      const it = {
        id: 'rp_' + p.goodsId, goodsId: String(p.goodsId), url: `https://www.temu.com/goods.html?goods_id=${p.goodsId}`,
        oldTitle: title, title, oldN: rpOldN(title), newN: 0, price: base > 0 ? base.toFixed(2) : '',
        images: imgs.slice(), origImgs: imgs.slice(), origMain: imgs[0], pick: [0], prompt: '', at: Date.now(),
        oldW: s0.weight || '', oldDims: Array.isArray(s0.dims) ? s0.dims : [], newW: '', newDims: ['', '', '']
      };
      const i = Rp.items.findIndex(x => x.id === it.id);
      if (i >= 0) Rp.items[i] = it; else Rp.items.push(it);
      added++;
    }
    await rpSave();
    rpRender();
    rpSay(`✓ ${added} product${added === 1 ? '' : 's'} in the Repack list.` + (problems.length ? '\n' + problems.map(x => '• ' + x).join('\n') : ''));
  } catch (e) { rpSay('✗ ' + (e?.message || e)); }
  finally { if (btn) btn.disabled = false; if (lbl) lbl.textContent = 'Add products'; }
}

async function rpMakeImages() {
  const go = Rp.items.filter(rpCanRun);
  if (!go.length) { toast('Write a prompt first, or set "New packs" (2 to ' + RP_MAX_AI + ')', 'warn'); return; }
  const only = new Set();
  go.forEach(it => {
    it._repackPrompt = rpPromptOf(it);
    it._repackQty = Number(it.newN) || 0;
    rpPicks(it).forEach(i => only.add(it.id + '#' + i));
  });
  await rpSave();
  rpEngineSet($('rpModal')?.querySelector('.rp-eng-sel')?.value || 'flow');
  // the progress window opens over this one: hide it until the images are done
  rpClose();
  toast(`${only.size} image${only.size === 1 ? '' : 's'} (${go.length} product${go.length === 1 ? '' : 's'}) — open 📦 Repack again when they are done`, 'info');
  await temuStartBulkImageEdit({ rows: go, repack: true, allImgs: true, only });
}

async function rpDownload(items) {
  const list = items.filter(rpEdited);
  if (!list.length) { toast('No new image made yet', 'warn'); return; }
  let ok = 0;
  for (const it of list) {
    const imgs = rpImgs(it);
    for (const i of rpEditedIdx(it)) {
      try {
        const blob = await zhImageToPngBlob(imgs[i]);
        await zhSaveBlob(blob, `Repack/${rpSafeName(it.title)}/image_${i + 1}${it.newN ? '_' + it.newN + 'pack' : ''}.png`);
        ok++;
      } catch (e) { toast(`${rpSafeName(it.title).slice(0, 30)} #${i + 1}: ${e?.message || e}`, 'warn'); }
    }
  }
  if (list.length > 1) {   // all new titles in one file, next to the images
    const txt = list.map(it => `${it.title}\n  Old: ${it.oldTitle}\n  Packs: ${it.oldN || '?'} → ${it.newN || '-'}${it.price ? `   Price (old): $${it.price}` : ''}\n`).join('\n');
    await zhSaveBlob(new Blob([txt], { type: 'text/plain;charset=utf-8' }), 'Repack/titles.txt');
  }
  toast(`⬇ ${ok} image${ok === 1 ? '' : 's'} → Downloads/…/Repack`, ok ? 'ok' : 'warn');
}

// open this product's own Temu edit page: its "Edit" button on Manage products is pressed (the row must be on the open page)
async function rpOpenTemu(it) {
  const send = (tabId, msg, ms) => new Promise(res => { const tm = setTimeout(() => res(null), ms || 10000); try { chrome.tabs.sendMessage(tabId, msg, x => { void chrome.runtime.lastError; clearTimeout(tm); res(x); }); } catch (_) { clearTimeout(tm); res(null); } });
  try {
    const tabs = (await chrome.tabs.query({ url: 'https://seller.temu.com/*' })).filter(t => /\/products\.html/.test(t.url || ''));
    const tab = tabs.find(t => t.active) || tabs[0];
    if (!tab) { toast('Open the Temu "Manage products" page first', 'warn'); return; }
    let ping = await send(tab.id, { action: 'ZC_PING' }, 1500);
    if (!ping?.ready) { try { await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['temu_store_copy.js'] }); } catch (_) { /* page not ready */ } }
    let created = null; const onNew = nt => { if (nt.openerTabId === tab.id || /seller\.temu\.com/.test(nt.pendingUrl || nt.url || '')) created = nt; };
    chrome.tabs.onCreated.addListener(onNew);
    let r; try { await chrome.tabs.update(tab.id, { active: true }); r = await send(tab.id, { action: 'ZC_OPEN_EDIT', goodsId: it.goodsId }, 9000); } finally { chrome.tabs.onCreated.removeListener(onNew); }
    if (r?.ok && r.url) { await chrome.tabs.create({ url: new URL(r.url, 'https://seller.temu.com').href, active: true, windowId: tab.windowId }); return; }
    if (created) { await chrome.tabs.update(created.id, { active: true }); return; }
    toast(r?.error === 'row not found' ? 'This product is not on the open Manage products page — bring it there (search / page number), then try again' : 'The Temu edit page did not open: ' + (r?.error || 'no answer — press F5 on the Temu page'), 'warn');
  } catch (e) { toast('The Temu edit page did not open: ' + (e?.message || e), 'warn'); }
}

// v9.22.19 — "Apply on Temu": the product's edit page opens; the new title goes in, the old description and every
// bullet point go out (they name the old quantity), the SKU images become the chosen list (your own first, ★ main,
// no 🗑 ones), and Submit is pressed when that box is ticked. A tab that submitted closes; one with a problem stays open.
const rpSend = (tabId, msg, ms) => new Promise(res => { const tm = setTimeout(() => res(null), ms || 10000); try { chrome.tabs.sendMessage(tabId, msg, x => { void chrome.runtime.lastError; clearTimeout(tm); res(x); }); } catch (_) { clearTimeout(tm); res(null); } });
async function rpToJpeg(url) {
  // Temu wants JPG/PNG up to 5 MB, 1:1, at least 480 px: every image goes as a JPEG of at most 2000 px
  const blob = await zhImageToPngBlob(url);
  const durl = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(blob); });
  try { return await compressBase64Image(durl, 2000, 0.92); } catch (_) { return durl; }
}
// v9.22.28 — after Submit Temu leaves the edit page for Manage products ("Submission successful", the address has
// listing_commit_id): the page's script is gone before it can answer, so the tab itself tells whether it was submitted
async function rpSubmittedTab(tabId) {
  for (let i = 0; i < 15; i++) {
    let tab; try { tab = await chrome.tabs.get(tabId); } catch (_) { return false; }
    const u = tab?.url || tab?.pendingUrl || '';
    if (/listing_commit_id=|operate_type=3/.test(u)) return true;
    if (/\/products\.html/.test(u) && tab.status === 'complete') {
      try {
        const [res] = await chrome.scripting.executeScript({ target: { tabId }, func: () => /Submission successful/i.test(document.body?.innerText || '') });
        if (res?.result) return true;
      } catch (_) { /* page busy */ }
    }
    if (/product-info/.test(u) && tab.status === 'complete' && i > 4) return false;   // still on the edit page
    await new Promise(r => setTimeout(r, 1000));
  }
  return false;
}
async function rpApplyOnTemu(it, btn, quiet, bg, slot = 0) {
  const say = t => { if (btn) btn.textContent = t; };
  const old = btn?.textContent; if (btn) btn.disabled = true;
  const name = rpSafeName(it.title).slice(0, 34);
  try {
    let images = null;
    if (rpImgsChanged(it)) {
      const keys = rpFinalKeys(it).slice(0, RP_MAX_TEMU);
      if (!keys.length) return { ok: false, error: 'all images are marked ✕ (remove) — keep at least one' };
      say('⏳ Preparing images…'); images = [];
      for (const k of keys) images.push(await rpToJpeg(rpKeyUrl(it, k)));
    }
    const title = rpTitleChanged(it) ? String(it.title).trim() : '';
    const weight = rpNewW(it), dims = rpNewDims(it);
    if (!dims && (it.newDims || []).some(x => String(x).trim())) return { ok: false, error: 'fill all three size boxes (L × W × H) or leave all three empty' };
    const listPrice = Rp.listPrice ? zhRandListPrice(it.price) : 0;
    if (!images && !title && !weight && !dims && !Rp.clearText && !listPrice) return { ok: false, error: 'nothing changed (title, images, weight, size, list price or description)' };
    say('⏳ Opening Temu…');
    // v9.22.42 — in the separate work window behind yours (9.22.29: a background tab in your own window)
    const tab = await zhWorkTab(`https://seller.temu.com/product-info.html?add_method=1&click_type=1&goods_id=${encodeURIComponent(it.goodsId)}&tab=1`, slot);
    let ok = false;
    for (let i = 0; i < 40 && !ok; i++) {
      await new Promise(r => setTimeout(r, 1000));
      ok = !!(await rpSend(tab.id, { action: 'ZC_PING' }, 1500))?.ready;
      if (!ok && (i === 10 || i === 25)) { try { await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['temu_store_copy.js'] }); } catch (_) { /* still loading */ } }
    }
    if (!ok) return { ok: false, error: 'Could not reach the Temu edit page — press F5 on it and try again' };
    say('⏳ Applying on Temu…');
    let r = await rpSend(tab.id, { action: 'ZC_APPLY_EDIT', title, clearText: Rp.clearText, images, weight, dims, listPrice, submit: Rp.submit }, 300000);
    if (!r && Rp.submit && await rpSubmittedTab(tab.id)) r = { ok: true, done: ['Temu: Submission successful'], submitted: true };
    // v9.22.45 — "did not confirm" can be a late Temu: look at the tab once more before calling it a problem
    if (r && !r.ok && Rp.submit && /did not confirm/i.test(r.error || '') && await rpSubmittedTab(tab.id)) r = { ok: true, done: [...(r.done || []), 'Temu: Submission successful'], submitted: true };
    if (!r) {
      // v9.22.31 — no answer and not submitted: say on which step the tab stopped
      let where = '';
      try { const [x] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => ((document.querySelector('#publish-form-wrapper h2') || {}).textContent || '') + ' | ' + ((document.getElementById('zh-rp-hud') || {}).textContent || '') }); where = x?.result || ''; } catch (_) { /* tab gone */ }
      return { ok: false, error: 'The Temu page did not answer' + (where.replace(/[\s|]/g, '') ? ` (stopped at: ${where.slice(0, 140)})` : '') + ' — the tab is open in the Temu window behind yours, look there' };
    }
    if (!r?.ok) return { ok: false, error: (r?.error || 'The Temu page did not answer') + (r?.done?.length ? ` (already done: ${r.done.join(', ')})` : '') + ' — the tab is open in the Temu window behind yours, look there' };
    it.temuDoneAt = Date.now(); it.temuSubmitted = !!r.submitted;
    // v9.22.26 — a product that was submitted is done: it leaves the Repack list (without Submit it stays, marked ✓)
    if (r.submitted) { Rp.items = Rp.items.filter(x => x !== it); Rp.open.delete(it.id); }
    rpSave();
    if (r.submitted) { try { await chrome.tabs.remove(tab.id); } catch (_) { /* already closed */ } }
    const msg = `✓ ${name}: ${r.done.join(', ') || 'done'}${r.submitted ? ' → Submit (removed from the Repack list)' : ' — press Submit yourself'}` + (r.skus > 1 ? ` (images on the first SKU only, ${r.skus} in all)` : '');
    if (!quiet) toast(msg, 'ok');
    return { ok: true, msg };
  } catch (e) { return { ok: false, error: e?.message || String(e) }; }
  finally { if (btn) { btn.disabled = false; btn.textContent = old || 'Apply on Temu'; } }
}
async function rpApplyOne(it, btn) {
  if (Rp.busy) { toast('The previous job is still running', 'warn'); return; }
  if (Rp.submit && !(await zhAsk('Apply on Temu', `"${rpSafeName(it.title)}": ${rpPlanText(it)} — then Submit is pressed.`, 'Yes, apply'))) return;
  Rp.busy = true; rpUpdateAiBtn(); zhWorkBegin();
  try {
    const r = await rpApplyOnTemu(it, btn);
    if (!r.ok) toast(`${rpSafeName(it.title).slice(0, 30)}: ${r.error}`, 'warn');
  } finally { Rp.busy = false; rpRender(); await zhWorkEnd(); }
}
async function rpApplyAll() {
  if (Rp.busy) return;
  const list = Rp.items.filter(rpHasWork);
  if (!list.length) { toast('No product left to do', 'warn'); return; }
  const par = Math.min(3, Math.max(1, Number(Rp.par) || 1));
  if (!(await zhAsk('Apply all on Temu', `${list.length} product${list.length === 1 ? '' : 's'}, ${par === 1 ? 'one by one' : `${par} tabs at once`}, on Temu: new title${Rp.clearText ? ', description + bullets cleared' : ''}${Rp.listPrice ? `, list price ${RP_LIST_TXT} (random)` : ''}, changed images${Rp.submit ? ', then Submit' : ' (you press Submit)'}. If one has a problem, its tab stays open and the others go on.`, 'Yes, start'))) return;
  Rp.busy = true; rpUpdateAiBtn(); zhWorkBegin();
  const lines = [], now = new Set();
  let next = 0, fin = 0;
  const show = () => rpSay(`Applying on Temu: ${fin} / ${list.length} done` + (now.size ? `\nNow: ${[...now].join(' | ')}` : '') + (lines.length ? '\n' + lines.join('\n') : ''));
  // v9.22.28 — 1 to 3 Temu tabs at once (since 9.22.42 in their own window behind yours)
  const worker = async (_, slot) => {
    while (next < list.length) {
      const it = list[next++], nm = rpSafeName(it.title).slice(0, 24);
      now.add(nm); show();
      const r = await rpApplyOnTemu(it, null, true, par > 1, slot);
      now.delete(nm); fin++;
      lines.push(r.ok ? r.msg : `✗ ${rpSafeName(it.title).slice(0, 34)}: ${r.error}`);
      rpRender(); show();
    }
  };
  try { await Promise.all(Array.from({ length: Math.min(par, list.length) }, worker)); }
  finally { Rp.busy = false; rpRender(); await zhWorkEnd(); }
  const bad = lines.filter(l => l.startsWith('✗')).length;
  rpSay(`${list.length - bad} / ${list.length} applied on Temu.\n` + lines.join('\n'));
}

// your own image files (Google Flow etc.) for one product: kept as JPEGs of at most 2000 px
async function rpAddOwn(it, files) {
  const list = [...(files || [])].filter(f => /^image\//.test(f.type));
  if (!list.length) { toast('Choose an image file (JPG / PNG / WEBP)', 'warn'); return; }
  it.own = rpOwn(it).slice();
  for (const f of list) {
    try {
      const durl = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(f); });
      let j = durl; try { j = await compressBase64Image(durl, 2000, 0.92); } catch (_) { /* keep as is */ }
      it.own.push(j);
    } catch (e) { toast(`${f.name}: ${e?.message || e}`, 'warn'); }
  }
  delete it.temuDoneAt;
  await rpSave(); rpRender();
  toast(`✓ ${list.length} image${list.length === 1 ? '' : 's'} of yours — ${list.length === 1 ? 'it goes' : 'they go'} first on Temu`, 'ok');
}

// v9.22.22 — ⧉ copies one image (Chrome's clipboard holds one image at a time) to paste into Flow / GPT / Gemini;
// "📋 Paste image" (or Ctrl+V while a card is open) adds the copied image to the card as your own image.
async function rpCopyImage(url) {
  try {
    const blob = await zhImageToPngBlob(url);
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    toast('Image copied — press Ctrl+V in Flow / GPT / Gemini', 'ok');
  } catch (e) { toast('The image was not copied: ' + (e?.message || e), 'warn'); }
}
async function rpPasteImage(it) {
  try {
    const files = [];
    for (const ci of await navigator.clipboard.read()) {
      const t = ci.types.find(x => /^image\//.test(x));
      if (t) { const bl = await ci.getType(t); files.push(new File([bl], 'pasted.' + (t.split('/')[1] || 'png'), { type: t })); }
    }
    if (!files.length) { toast('No image on the clipboard — copy an image first (in Flow: right-click → Copy image)', 'warn'); return; }
    await rpAddOwn(it, files);
  } catch (e) { toast('Paste failed: ' + (e?.message || e) + ' — open the card and try Ctrl+V', 'warn'); }
}
document.addEventListener('paste', e => {
  const m = $('rpModal'); if (!m || m.classList.contains('hidden')) return;
  if (e.target.closest?.('textarea, input')) return;   // pasting text into a box stays normal
  const files = [...(e.clipboardData?.files || [])].filter(f => /^image\//.test(f.type));
  if (!files.length) return;
  const it = Rp.items.find(x => x.id === Rp.lastId && Rp.open.has(x.id)) || (Rp.open.size === 1 ? Rp.items.find(x => Rp.open.has(x.id)) : null);
  if (!it) { toast('First open the card of the product that should get the image, then Ctrl+V', 'warn'); return; }
  e.preventDefault();
  rpAddOwn(it, files);
});

// all titles at once: a numbered list out, the AI's numbered answer back (the ids are remembered at copy time)
async function rpTitlesCopy() {
  if (!Rp.items.length) { toast('The list is empty', 'warn'); return; }
  Rp.ttIds = Rp.items.map(it => it.id);
  const txt = Rp.items.map((it, i) => `${i + 1}. ${String(it.title || it.oldTitle || '').replace(/\s+/g, ' ').trim()}`).join('\n');
  try { await navigator.clipboard.writeText(txt); toast(`${Rp.items.length} titles copied (numbered)`, 'ok'); }
  catch (_) { toast('Copy failed — press again', 'warn'); return; }
  rpSave();
  const inf = $('rpModal')?.querySelector('.rp-tt-info'); if (inf) inf.textContent = `${Rp.items.length} titles copied — the answer goes onto exactly this list.`;
}
function rpTitlesApply() {
  const ta = $('rpModal')?.querySelector('.rp-tt-paste');
  const ids = Rp.ttIds || [];
  if (!ids.length) { toast('Press "Copy all titles" first', 'warn'); return; }
  const lines = String(ta?.value || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean)
    .filter(l => !/^(ChatGPT said|You said|Gemini said|Show thinking)\s*:?$/i.test(l));
  const got = new Array(ids.length).fill('');
  const numbered = lines.filter(l => /^\d{1,4}\s*[.)\-:]\s*\S/.test(l));
  if (numbered.length) numbered.forEach(l => { const mm = l.match(/^(\d{1,4})\s*[.)\-:]\s*(.+)$/); const n = +mm[1]; if (n >= 1 && n <= ids.length) got[n - 1] = mm[2].trim(); });
  else lines.forEach((l, i) => { if (i < ids.length) got[i] = l.replace(/^[\-*•]\s*/, ''); });
  const n = got.filter(Boolean).length;
  if (n !== ids.length) { rpSay(`✗ ${ids.length} titles were sent, ${n} came back — nothing was applied. Ask the AI for the full list again.`); return; }
  let set = 0;
  ids.forEach((id, i) => { const it = Rp.items.find(x => x.id === id); if (it) { it.title = got[i].slice(0, 500); delete it.temuDoneAt; set++; } });
  rpSave(); rpRender();
  rpSay(`✓ ${set} new titles applied — check each card, then "Apply on Temu".`);
}

function rpInput(e) {
  if (e.target.classList.contains('rp-gprompt')) {
    Rp.prompt = e.target.value;
    $('rpModal')?.querySelectorAll('.rp-card').forEach(c => { const it = Rp.items.find(x => x.id === c.dataset.id); const w = c.querySelector('.rp-warn'); if (it && w) { const t = rpWarn(it); w.hidden = !t; w.textContent = t; } });
    rpUpdateAiBtn();
    clearTimeout(rpInput._t); rpInput._t = setTimeout(rpSave, 500);
    return;
  }
  const card = e.target.closest('.rp-card'); if (!card) return;
  const it = Rp.items.find(x => x.id === card.dataset.id); if (!it) return;
  if (e.target.classList.contains('rp-n')) {
    const n = Math.max(0, parseInt(e.target.value, 10) || 0);
    it.newN = n; delete it.temuDoneAt;
    it.title = rpNewTitle(it.oldTitle, it.oldN, n);
    card.querySelector('.rp-title').value = it.title;
    e.target.classList.toggle('bad', n > RP_MAX_AI);
  } else if (e.target.classList.contains('rp-title')) { it.title = e.target.value; delete it.temuDoneAt; const s = card.querySelector('.rp-tsame'); if (s) s.hidden = rpTitleChanged(it); }
  else if (e.target.classList.contains('rp-w')) { it.newW = e.target.value; delete it.temuDoneAt; }
  else if (e.target.classList.contains('rp-d')) { const d = (Array.isArray(it.newDims) ? it.newDims : ['', '', '']).slice(); d[+e.target.dataset.d] = e.target.value; it.newDims = d; delete it.temuDoneAt; }
  else if (e.target.classList.contains('rp-prompt')) it.prompt = e.target.value;
  const w = card.querySelector('.rp-warn'); if (w) { const t = rpWarn(it); w.hidden = !t; w.textContent = t; }
  rpUpdateAiBtn();
  clearTimeout(rpInput._t); rpInput._t = setTimeout(rpSave, 500);
}

async function rpClick(e) {
  if (e.target === $('rpModal')) { rpClose(); return; }
  const b = e.target.closest('[data-rp]'); if (!b) return;
  const a = b.dataset.rp, card = b.closest('.rp-card'), it = card && Rp.items.find(x => x.id === card.dataset.id);
  if (a === 'close') rpClose();
  else if (a === 'read') rpRead();
  else if (a === 'ai') rpMakeImages();
  else if (a === 'dlall') rpDownload(Rp.items);
  else if (a === 'ttcopy') rpTitlesCopy();
  else if (a === 'ttapply') rpTitlesApply();
  else if (a === 'applyall') rpApplyAll();
  else if (a === 'clear') {
    if (!Rp.items.length) return;
    showConfirm('Clear the Repack list', `${Rp.items.length} product${Rp.items.length === 1 ? '' : 's'} will leave the Repack list (nothing changes on Temu).`, 'Clear', async () => { Rp.items = []; await rpSave(); rpRender(); rpSay(''); });
  }
  else if (a === 'openall') {
    const all = Rp.items.length && Rp.open.size < Rp.items.length;
    Rp.open = new Set(all ? Rp.items.map(x => x.id) : []);
    b.textContent = all ? '▸ Close all' : '▾ Open all';
    rpRender();
  }
  else if (!it) return;
  else if ((Rp.lastId = it.id) && a === 'tog') {
    if (Rp.open.has(it.id)) Rp.open.delete(it.id); else Rp.open.add(it.id);
    rpRender();
  }
  else if (a === 'cpimg') rpCopyImage(rpKeyUrl(it, b.dataset.k));
  else if (a === 'paste') rpPasteImage(it);
  else if (a === 'pick') {
    const i = Number(b.dataset.i), set = new Set(rpPicks(it));
    if (set.has(i)) set.delete(i); else set.add(i);
    it.pick = [...set].sort((x, y) => x - y);
    rpRender(); rpSave();
  }
  else if (a === 'view') {
    // v9.22.27 — the extension's own big image view; ← / → go through this product's images
    const keys = [...rpOwn(it).map((_, j) => 'o' + j), ...rpImgs(it).map((_, j) => 'i' + j)];
    const list = keys.map(k => rpKeyUrl(it, k));
    if (typeof openLightbox === 'function') openLightbox(rpKeyUrl(it, b.dataset.k), `${Rp.items.indexOf(it) + 1}. ${String(it.title || it.oldTitle || '').slice(0, 60)}`, list, keys.indexOf(b.dataset.k));
  }
  else if (a === 'copy') {
    try { await navigator.clipboard.writeText(it.title); toast('Title copied', 'ok'); }
    catch (_) { card.querySelector('.rp-title')?.select(); document.execCommand('copy'); toast('Title copied', 'ok'); }
  }
  else if (a === 'dl') rpDownload([it]);
  else if (a === 'temu') rpOpenTemu(it);
  else if (a === 'apply') rpApplyOne(it, b);
  else if (a === 'own') { Rp.fileFor = it.id; $('rpModal')?.querySelector('.rp-file')?.click(); }
  else if (a === 'main' || a === 'drop' || a === 'owndel') {
    const i = Number(b.dataset.i);
    if (a === 'main') { it.main = b.dataset.k; if (b.dataset.k[0] === 'i') it.drop = [...rpDrop(it)].filter(x => x !== +b.dataset.k.slice(1)); }
    else if (a === 'drop') { const s = rpDrop(it); if (s.has(i)) s.delete(i); else s.add(i); it.drop = [...s].sort((x, y) => x - y); }
    else { it.own = rpOwn(it).filter((_, j) => j !== i); if (it.main?.[0] === 'o') it.main = ''; }
    delete it.temuDoneAt;
    rpSave(); rpRender();
  }
  else if (a === 'del') { Rp.items = Rp.items.filter(x => x !== it); Rp.open.delete(it.id); await rpSave(); rpRender(); toast('Removed from the list (nothing changed on Temu)', 'ok'); }
}

document.addEventListener('click', e => { if (e.target.closest('#temuRepackBtn')) rpOpen(); });
