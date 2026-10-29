/* v9.22.7 — Repack: products already on Temu get a new (smaller) pack count or new pictures.
   Tick products on Temu "Manage products" → 📦 Repack reads them → per product: new pack count, your own prompt,
   which images to edit → the AI edits them in bulk → copy the title, download the images, "Temu par kholo".
   Loaded after sidepanel.js and uses its helpers (temuReadTicked, temuStartBulkImageEdit, zhApplyImgEdits, zhImageToPngBlob, zhSaveBlob, zhLibAll).
   v9.22.12 — one prompt for all + each product's own prompt, saved prompts, image ticks per product, open the product on Temu. */
'use strict';

const RP_KEY = 'zhRepack', RP_PROMPT_KEY = 'zhRepackPrompt';
const RP_MAX_AI = 24;   // the AI pack prompt cannot draw more units than this reliably
const Rp = { items: [], prompt: '', loaded: false, timer: 0 };

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
const rpPromptOf = it => String((it.prompt || '').trim() || Rp.prompt.trim()).split('{N}').join(String(Number(it.newN) || it.oldN || ''));
const rpCanRun = it => rpPicks(it).length > 0 && (!!rpPromptOf(it) || (Number(it.newN) >= 2 && Number(it.newN) <= RP_MAX_AI));
const rpEsc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const rpSafeName = s => String(s || 'product').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 50) || 'product';

async function rpLoad() {
  if (!Rp.loaded) {
    try {
      const r = await chrome.storage.local.get([RP_KEY, RP_PROMPT_KEY]);
      Rp.items = r?.[RP_KEY] || []; Rp.prompt = r?.[RP_PROMPT_KEY] || '';
    } catch (_) { Rp.items = []; }
    // lists saved by 9.22.7 knew only the first original image
    Rp.items.forEach(it => { if (!Array.isArray(it.origImgs)) it.origImgs = [it.origMain || rpImg(it), ...rpImgs(it).slice(1)]; });
    Rp.loaded = true;
  }
  try { await zhApplyImgEdits(Rp.items); } catch (_) { /* no edit journal yet */ }   // new images come back after a reload
  return Rp.items;
}
async function rpSave() {
  try { await chrome.storage.local.set({ [RP_KEY]: Rp.items.map(({ _repackQty, _repackPrompt, ...it }) => it), [RP_PROMPT_KEY]: Rp.prompt }); }
  catch (e) { toast('Repack list could not be saved: ' + (e?.message || e), 'warn'); }
}

function rpModal() {
  let m = $('rpModal');
  if (m) return m;
  m = document.createElement('div');
  m.id = 'rpModal'; m.className = 'modal-back rp-modal hidden';
  m.innerHTML = `<div class="modal-box rp-box" role="dialog" aria-label="Repack">
    <div class="rp-head"><b>📦 Repack</b><span class="rp-sub">Temu par list products ke packs / images badlo</span><button type="button" class="btn btn-ghost btn-xs" data-rp="close" aria-label="Close">✕</button></div>
    <div class="rp-steps">
      <p><b>1.</b> Temu <i>Manage products</i> par products tick karo, phir <b>Temu se parho</b>.</p>
      <p><b>2.</b> Prompt likho (sab ke liye, ya kisi product ka apna), <b>Naye packs</b> likho, aur jin images ko badalna hai un par tick karo.</p>
      <p><b>3.</b> <b>Images banao</b>: AI sab products ki chuni hui images bana deta hai.</p>
      <p><b>4.</b> Title copy karo, images download karo, <b>Temu par kholo</b>.</p>
    </div>
    <div class="rp-tools">
      <button type="button" class="btn btn-ghost btn-xs" data-rp="read">⬇ Temu se parho</button>
      <label class="rp-eng">AI <select class="rp-eng-sel" aria-label="AI image engine"></select></label>
      <button type="button" class="btn btn-primary btn-xs" data-rp="ai">✨ Images banao</button>
      <button type="button" class="btn btn-ghost btn-xs" data-rp="dlall">⬇ Sab nayi images</button>
      <button type="button" class="btn btn-ghost btn-xs rp-clear" data-rp="clear">List khaali karo</button>
    </div>
    <div class="rp-gp">
      <div class="rp-gp-head"><b>Prompt — sab products ke liye</b><select class="rp-lib" aria-label="Saved prompts"><option value="">Saved prompt chuno…</option></select></div>
      <textarea class="rp-gprompt" rows="3" placeholder="Jaise: Make one sleeve with 3 golf balls, combined in one clean product image… ({N} = naye packs). Khaali = sirf pack image (Naye packs se)."></textarea>
    </div>
    <div class="rp-status" aria-live="polite"></div>
    <div class="rp-list"></div>
  </div>`;
  document.body.appendChild(m);
  m.addEventListener('click', rpClick);
  m.addEventListener('input', rpInput);
  m.addEventListener('change', e => {
    if (e.target.closest('.rp-eng-sel')) rpEngineSet(e.target.value);
    else if (e.target.closest('.rp-lib')) {
      const lib = (typeof zhLibAll === 'function' ? zhLibAll() : []).find(x => x.id === e.target.value);
      if (lib?.text) { Rp.prompt = lib.text; m.querySelector('.rp-gprompt').value = lib.text; rpSave(); rpUpdateAiBtn(); }
      e.target.value = '';
    }
  });
  return m;
}
function rpSay(t) { const s = $('rpModal')?.querySelector('.rp-status'); if (s) { s.textContent = t; s.hidden = !t; } }

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
  if (n > RP_MAX_AI && !own) return `${RP_MAX_AI} se zyada: AI pack image nahi banegi (prompt likho, ya image khud banao). Title badal gaya hai.`;
  if (n === 1 && !own) return '1 pack: AI pack image nahi banegi — prompt likho agar image badalni hai.';
  return '';
}
function rpCard(it) {
  const n = Number(it.newN) || 0, imgs = rpImgs(it), picks = new Set(rpPicks(it)), w = rpWarn(it);
  const ed = rpEditedIdx(it).length;
  const state = ed ? `<span class="rp-state ok">✓ ${ed} nayi image${ed === 1 ? '' : 's'}</span>` : rpCanRun(it) ? '<span class="rp-state">Images baqi</span>' : '';
  return `<div class="rp-card" data-id="${rpEsc(it.id)}">
    <img class="rp-img" src="${rpEsc(rpImg(it))}" alt="" loading="lazy">
    <div class="rp-body">
      <div class="rp-old" title="${rpEsc(it.oldTitle)}">Purana: ${rpEsc(it.oldTitle)}</div>
      <div class="rp-row">
        <span class="rp-meta">Purane packs: <b>${it.oldN || '?'}</b></span>
        <label class="rp-n-lbl">Naye packs <input class="rp-n${n > RP_MAX_AI ? ' bad' : ''}" type="number" min="1" max="999" value="${n || ''}" placeholder="—" aria-label="New pack count"></label>
        <span class="rp-meta">Price: <b>${it.price ? '$' + rpEsc(it.price) : '—'}</b></span>
      </div>
      <p class="rp-warn"${w ? '' : ' hidden'}>${rpEsc(w)}</p>
      <div class="rp-thumbs" role="group" aria-label="Images to edit">${imgs.map((u, i) => `<button type="button" class="rp-th${picks.has(i) ? ' on' : ''}${rpEditedAt(it, i) ? ' done' : ''}" data-rp="pick" data-i="${i}" title="${picks.has(i) ? 'Edit hogi — click: mat badlo' : 'Click: is image ko bhi edit karo'}"><img src="${rpEsc(u)}" alt="" loading="lazy"><span>${i + 1}</span></button>`).join('')}</div>
      <textarea class="rp-prompt" rows="2" placeholder="Is product ka apna prompt (khaali = upar wala prompt)" aria-label="Own prompt">${rpEsc(it.prompt || '')}</textarea>
      <textarea class="rp-title" rows="2" aria-label="New title">${rpEsc(it.title)}</textarea>
      <div class="rp-acts">
        <button type="button" class="btn btn-ghost btn-xs" data-rp="copy">Copy title</button>
        <button type="button" class="btn btn-ghost btn-xs" data-rp="dl"${ed ? '' : ' disabled'}>⬇ Nayi images</button>
        <button type="button" class="btn btn-ghost btn-xs" data-rp="temu" title="Is product ka Temu edit page kholo (Manage products page khula ho)">↗ Temu par kholo</button>
        <button type="button" class="btn btn-primary btn-xs" data-rp="replace"${ed ? '' : ' disabled'} title="Temu edit page khol kar purani SKU images hatao aur sirf nayi (edited) images daalo. Submit aap khud dabao.">⬆ Temu par badlo</button>
        ${state}
        <button type="button" class="btn btn-ghost btn-xs rp-del" data-rp="del" title="List se hatao" aria-label="Remove">✕</button>
      </div>
    </div>
  </div>`;
}
function rpUpdateAiBtn() {
  const m = $('rpModal'); if (!m) return;
  const ready = Rp.items.filter(rpCanRun), imgs = ready.reduce((s, it) => s + rpPicks(it).length, 0);
  const b = m.querySelector('[data-rp="ai"]'); if (b) { b.disabled = !ready.length; b.textContent = ready.length ? `✨ Images banao (${imgs})` : '✨ Images banao'; }
  const d = m.querySelector('[data-rp="dlall"]'); if (d) d.disabled = !Rp.items.some(rpEdited);
}
function rpRender() {
  const m = $('rpModal'); if (!m) return;
  const list = m.querySelector('.rp-list');
  // a box being typed in is not redrawn (the caret would jump)
  const act = document.activeElement, keepId = act && list.contains(act) ? act.closest('.rp-card')?.dataset.id : '';
  if (keepId) {
    list.querySelectorAll('.rp-card').forEach(c => {
      if (c.dataset.id === keepId) return;
      const it = Rp.items.find(x => x.id === c.dataset.id); if (it) c.outerHTML = rpCard(it);
    });
  } else list.innerHTML = Rp.items.length ? Rp.items.map(rpCard).join('') : '<p class="rp-empty">Abhi koi product nahi. Temu par products tick karo, phir "Temu se parho".</p>';
  rpUpdateAiBtn();
}

async function rpOpen() {
  const m = rpModal();
  rpEngineFill(); rpLibFill();
  await rpLoad();
  m.querySelector('.rp-gprompt').value = Rp.prompt;
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
  const m = $('rpModal'), btn = m?.querySelector('[data-rp="read"]');
  if (btn) btn.disabled = true;
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
        images: imgs.slice(), origImgs: imgs.slice(), origMain: imgs[0], pick: [0], prompt: '', at: Date.now()
      };
      const i = Rp.items.findIndex(x => x.id === it.id);
      if (i >= 0) Rp.items[i] = it; else Rp.items.push(it);
      added++;
    }
    await rpSave();
    rpRender();
    rpSay(`✓ ${added} product${added === 1 ? '' : 's'} Repack list mein.` + (problems.length ? '\n' + problems.map(x => '• ' + x).join('\n') : ''));
  } catch (e) { rpSay('✗ ' + (e?.message || e)); }
  finally { if (btn) btn.disabled = false; }
}

async function rpMakeImages() {
  const go = Rp.items.filter(rpCanRun);
  if (!go.length) { toast('Pehle prompt likho, ya "Naye packs" (2 se ' + RP_MAX_AI + ' tak)', 'warn'); return; }
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
  toast(`${only.size} image${only.size === 1 ? '' : 's'} (${go.length} product${go.length === 1 ? '' : 's'}) — mukammal hone par 📦 Repack dobara kholein`, 'info');
  await temuStartBulkImageEdit({ rows: go, repack: true, allImgs: true, only });
}

async function rpDownload(items) {
  const list = items.filter(rpEdited);
  if (!list.length) { toast('Abhi koi nayi image nahi bani', 'warn'); return; }
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
    const txt = list.map(it => `${it.title}\n  Purana: ${it.oldTitle}\n  Packs: ${it.oldN || '?'} → ${it.newN || '-'}${it.price ? `   Price (purani): $${it.price}` : ''}\n`).join('\n');
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
    if (!tab) { toast('Pehle Temu "Manage products" page kholo', 'warn'); return; }
    let ping = await send(tab.id, { action: 'ZC_PING' }, 1500);
    if (!ping?.ready) { try { await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['temu_store_copy.js'] }); } catch (_) { /* page not ready */ } }
    let created = null; const onNew = nt => { if (nt.openerTabId === tab.id || /seller\.temu\.com/.test(nt.pendingUrl || nt.url || '')) created = nt; };
    chrome.tabs.onCreated.addListener(onNew);
    let r; try { await chrome.tabs.update(tab.id, { active: true }); r = await send(tab.id, { action: 'ZC_OPEN_EDIT', goodsId: it.goodsId }, 9000); } finally { chrome.tabs.onCreated.removeListener(onNew); }
    if (r?.ok && r.url) { await chrome.tabs.create({ url: new URL(r.url, 'https://seller.temu.com').href, active: true, windowId: tab.windowId }); return; }
    if (created) { await chrome.tabs.update(created.id, { active: true }); return; }
    toast(r?.error === 'row not found' ? 'Yeh product Manage products ke khule page par nahi — us page par le aao (search / page number), phir dobara' : 'Temu edit page nahi khula: ' + (r?.error || 'no answer — Temu page F5 karo'), 'warn');
  } catch (e) { toast('Temu edit page nahi khula: ' + (e?.message || e), 'warn'); }
}

// v9.22.13 — put ONLY the edited images on the Temu listing: its edit page opens, step 3 → the SKU's image window →
// Remove all → the new images → the window's Save. The product is not submitted: you check it and press Submit on Temu.
async function rpReplaceOnTemu(it, btn) {
  const idx = rpEditedIdx(it);
  if (!idx.length) { toast('Is product ki abhi koi nayi image nahi', 'warn'); return; }
  const send = (tabId, msg, ms) => new Promise(res => { const tm = setTimeout(() => res(null), ms || 10000); try { chrome.tabs.sendMessage(tabId, msg, x => { void chrome.runtime.lastError; clearTimeout(tm); res(x); }); } catch (_) { clearTimeout(tm); res(null); } });
  const old = btn?.textContent; if (btn) { btn.disabled = true; btn.textContent = '⏳ Images tayyar…'; }
  try {
    // Temu wants JPG/PNG up to 5 MB, 1:1, at least 480 px: every image goes as a JPEG of at most 2000 px
    const imgs = [];
    for (const i of idx) {
      const blob = await zhImageToPngBlob(rpImgs(it)[i]);
      const durl = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(blob); });
      let j = durl; try { j = await compressBase64Image(durl, 2000, 0.92); } catch (_) { /* keep the PNG */ }
      imgs.push(j);
    }
    if (btn) btn.textContent = '⏳ Temu khul raha…';
    const tab = await chrome.tabs.create({ url: `https://seller.temu.com/product-info.html?add_method=1&click_type=1&goods_id=${encodeURIComponent(it.goodsId)}&tab=1`, active: true });
    let ok = false;
    for (let i = 0; i < 40 && !ok; i++) {
      await new Promise(r => setTimeout(r, 1000));
      ok = !!(await send(tab.id, { action: 'ZC_PING' }, 1500))?.ready;
      if (!ok && (i === 10 || i === 25)) { try { await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['temu_store_copy.js'] }); } catch (_) { /* still loading */ } }
    }
    if (!ok) { toast('Temu edit page se raabta nahi hua — page F5 kar ke dobara dabao', 'warn'); return; }
    if (btn) btn.textContent = '⏳ Temu par badal raha…';
    const r = await send(tab.id, { action: 'ZC_REPLACE_IMAGES', images: imgs }, 200000);
    if (r?.ok) {
      it.temuReplacedAt = Date.now(); rpSave();
      toast(`✓ ${r.n} nayi image Temu par lag gayi — wahan check kar ke Next → Submit khud dabao` + (r.skus > 1 ? ` (sirf pehla SKU, kul ${r.skus})` : ''), 'ok');
    } else toast('Temu par images nahi badlin: ' + (r?.error || 'no answer'), 'warn');
  } catch (e) { toast('Temu par images nahi badlin: ' + (e?.message || e), 'warn'); }
  finally { if (btn) { btn.disabled = false; btn.textContent = old || '⬆ Temu par badlo'; } }
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
    it.newN = n;
    it.title = rpNewTitle(it.oldTitle, it.oldN, n);
    card.querySelector('.rp-title').value = it.title;
    e.target.classList.toggle('bad', n > RP_MAX_AI);
  } else if (e.target.classList.contains('rp-title')) it.title = e.target.value;
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
  else if (a === 'clear') {
    if (!Rp.items.length) return;
    showConfirm('Repack list khaali karo', `${Rp.items.length} product Repack list se hat jayenge (Temu par kuch nahi badlega).`, 'Khaali karo', async () => { Rp.items = []; await rpSave(); rpRender(); rpSay(''); });
  }
  else if (!it) return;
  else if (a === 'pick') {
    const i = Number(b.dataset.i), set = new Set(rpPicks(it));
    if (set.has(i)) set.delete(i); else set.add(i);
    it.pick = [...set].sort((x, y) => x - y);
    b.classList.toggle('on', set.has(i));
    b.title = set.has(i) ? 'Edit hogi — click: mat badlo' : 'Click: is image ko bhi edit karo';
    rpUpdateAiBtn(); rpSave();
  }
  else if (a === 'copy') {
    try { await navigator.clipboard.writeText(it.title); toast('Title copy ho gaya', 'ok'); }
    catch (_) { card.querySelector('.rp-title')?.select(); document.execCommand('copy'); toast('Title copy ho gaya', 'ok'); }
  }
  else if (a === 'dl') rpDownload([it]);
  else if (a === 'temu') rpOpenTemu(it);
  else if (a === 'replace') rpReplaceOnTemu(it, b);
  else if (a === 'del') { Rp.items = Rp.items.filter(x => x !== it); await rpSave(); rpRender(); }
}

document.addEventListener('click', e => { if (e.target.closest('#temuRepackBtn')) rpOpen(); });
