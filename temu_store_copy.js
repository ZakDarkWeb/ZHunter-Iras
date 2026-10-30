/* ZHunter — Store export (v9.15)
 * seller.temu.com only. Two read-only jobs:
 *   ZC_LIST_SELECTED : on "Manage products" — returns the products whose checkbox the user ticked.
 *   ZC_COPY_SCRAPE   : on a product's edit/copy page — reads title, category, brand, description, bullets,
 *                      attributes, price, weight, size and image links (it only presses "Next", never "Submit").
 */
(function () {
  'use strict';
  if (window.__zhStoreCopy) return;
  window.__zhStoreCopy = true;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const byId = id => document.getElementById(id);
  const val = el => el ? String(el.value !== undefined && el.value !== null && el.tagName !== 'DIV' && el.tagName !== 'SPAN' ? el.value : el.textContent || '').replace(/\s+/g, ' ').trim() : '';
  const vis = el => !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));
  async function waitFor(fn, ms, step) {
    const t0 = Date.now();
    while (Date.now() - t0 < (ms || 20000)) { try { const v = fn(); if (v) return v; } catch (_) {} await sleep(step || 250); }
    return null;
  }
  const isProdImg = u => /^https?:\/\//i.test(u) && /\.(jpe?g|png|webp)(\?|$)/i.test(u) && !/seller-public|upload_aimg|\/static\//i.test(u);
  const cleanImg = u => String(u || '').replace(/\?.*$/, '');

  /* ── Manage products: ticked rows ── */
  function listSelected() {
    const rows = [...document.querySelectorAll('tr[data-testid="beast-core-table-body-tr"]')];
    const out = [], seen = new Set();
    for (const tr of rows) {
      const lab = tr.querySelector('label[data-checked]');
      const cb = tr.querySelector('input[type="checkbox"]');
      const on = (lab && lab.getAttribute('data-checked') === 'true') || (cb && cb.checked);
      if (!on) continue;
      const txt = tr.innerText || '';
      const gid = (txt.match(/Goods ID:\s*(\d{8,})/i) || [])[1];
      if (!gid || seen.has(gid)) continue;
      seen.add(gid);
      const img = tr.querySelector('img[src*="kwcdn"]');
      const nm = tr.querySelector('[data-testid="beast-core-ellipsis"] [role="button"]');
      const stock = (() => { const m = txt.match(/\n(\d{1,6})\n/); return m ? m[1] : ''; })();
      out.push({ goodsId: gid, title: nm ? nm.textContent.trim() : '', thumb: img ? cleanImg(img.src) : '' });
    }
    return out;
  }

  /* ── recorded page answers (temu_net_hook.js) ── */
  function readNet() {
    const res = { carousel: [], sku: [], other: [], desc: '', bullets: [], paths: [] };
    const box = document.getElementById('zh-net-box');
    if (!box) return res;
    const seen = new Set();
    const add = (arr, u) => { u = cleanImg(u); if (!seen.has(u)) { seen.add(u); arr.push(u); } };
    const walk = (v, path, depth) => {
      if (depth > 14 || v === null || v === undefined) return;
      if (typeof v === 'string') {
        const p = path.toLowerCase();
        if (isProdImg(v)) {
          if (/detail/.test(p)) return;
          if (/carousel/.test(p)) add(res.carousel, v);
          else if (/sku/.test(p)) add(res.sku, v);
          else add(res.other, v);
          if (res.paths.length < 12 && !res.paths.includes(path)) res.paths.push(path);
        } else if (/goodsdesc$|description$/.test(p) && v.length > res.desc.length && !/^https?:/i.test(v)) res.desc = v;
        return;
      }
      if (Array.isArray(v)) {
        if (/bulletpoints?$/i.test(path) && v.every(x => typeof x === 'string')) { if (v.length > res.bullets.length) res.bullets = v.slice(); return; }
        v.forEach((x, i) => walk(x, path + '[]', depth + 1)); return;
      }
      if (typeof v === 'object') Object.keys(v).forEach(k => walk(v[k], path ? path + '.' + k : k, depth + 1));
    };
    box.content.childNodes.forEach(n => { try { walk(JSON.parse(n.textContent), '', 0); } catch (_) {} });
    return res;
  }

  /* ── page steps ── */
  const heading = () => (document.querySelector('#publish-form-wrapper h2') || {}).textContent || '';
  function readStep1(o) {
    o.title = val(byId('goodsBasic.goodsName') && byId('goodsBasic.goodsName').querySelector('input'));
    const cat = document.querySelector('[data-name="category"] [class*="textOverflow"]');
    o.catPath = cat ? cat.textContent.replace(/\s+/g, ' ').trim() : '';
    const br = byId('brand') && byId('brand').querySelector('input[data-testid="beast-core-cascader-htmlInput"]');
    const bv = val(br);
    o.brand = bv.split(' / ')[0].trim();
    o.trademark = (bv.split(' / ')[1] || o.brand).trim();
    o.description = val(byId('goodsExtensionInfo.goodsDesc') && byId('goodsExtensionInfo.goodsDesc').querySelector('textarea'));
    const bp = byId('goodsExtensionInfo.bulletPoints');
    o.bullets = bp ? [...bp.querySelectorAll('input[type="text"], textarea')].map(val).filter(Boolean) : [];
    o.domImgs = [];
    ['goodsBasic.goodsGallery.goodsCarouselImage', 'goodsBasic.goodsGallery.detailImage'].forEach((id, k) => {
      const box = byId(id); if (!box) return;
      box.querySelectorAll('img').forEach(im => { const u = im.currentSrc || im.src || im.getAttribute('data-src') || ''; if (k === 0 && isProdImg(u)) o.domImgs.push(cleanImg(u)); });
    });
  }
  function readStep2(o) {
    o.attrs = [];
    const seenL = new Set();
    document.querySelectorAll('[class*="attr-control-item"]').forEach(it => {
      const lab = it.querySelector('[class*="Form_itemLabelContent"]');
      const label = lab ? lab.textContent.trim() : '';
      if (!label || seenL.has(label)) return;
      let vals = [];
      const one = it.querySelector('[class*="inputItemRenderer"]');
      if (one) vals = [one.textContent.trim()];
      else {
        vals = [...it.querySelectorAll('[class*="tag" i], [class*="Tag_" i], [class*="TG_"]')].map(x => x.textContent.trim()).filter(Boolean);
        if (!vals.length) vals = [...it.querySelectorAll('input[type="text"]')].filter(i => !i.getAttribute('data-testid') || !/select/.test(i.getAttribute('data-testid'))).map(i => (i.value || '').trim()).filter(Boolean);
      }
      vals = [...new Set(vals.filter(x => x && !/^select$/i.test(x)))];
      if (!vals.length) return;
      seenL.add(label); o.attrs.push({ label, values: vals });
    });
  }
  function readStep3(o) {
    const tables = [...document.querySelectorAll('#publish-form-wrapper table')];
    const head = tables.find(t => t.querySelector('thead'));
    const body = tables.find(t => t.querySelector('tbody tr'));
    o.vtype = head ? ((head.querySelector('th') || {}).textContent || '').trim() : '';
    o.skus = [];
    if (!body) return;
    body.querySelectorAll('tbody tr').forEach(tr => {
      const tds = [...tr.querySelectorAll(':scope > td')];
      if (tds.length < 5) return;
      const ins = i => [...(tds[i] ? tds[i].querySelectorAll('input[type="text"]') : [])].map(x => x.value);
      const unitTxt = tds[3] ? tds[3].textContent.toLowerCase() : '';
      let w = parseFloat(ins(3)[0]);
      if (isFinite(w)) { if (/\boz\b/.test(unitTxt)) w = w / 16; else if (/\bkg\b/.test(unitTxt)) w = w * 2.20462; else if (/\bg\b/.test(unitTxt) && !/\blb\b/.test(unitTxt)) w = w / 453.592; }
      const dm = (tds[4] ? tds[4].textContent : '').match(/([\d.]+)\s*(in|cm)\D+([\d.]+)\s*(?:in|cm)\D+([\d.]+)\s*(?:in|cm)/i);
      let dims = dm ? [parseFloat(dm[1]), parseFloat(dm[3]), parseFloat(dm[4])] : [];
      if (dm && /cm/i.test(dm[2])) dims = dims.map(x => Math.round(x / 2.54 * 10) / 10);
      const imgN = parseInt(((tds[1] ? tds[1].textContent : '').match(/(\d+)\s*Images?/i) || [])[1] || '0', 10);
      o.skus.push({
        name: (tds[0].textContent || '').trim(), imgCount: imgN, qty: ins(2)[0] || '',
        weight: isFinite(w) ? Math.round(w * 100) / 100 : '', dims,
        base: (ins(5)[0] || '').replace(/[^\d.]/g, ''), list: (ins(6)[0] || '').replace(/[^\d.]/g, '')
      });
    });
  }

  /* click the first SKU's "N Images" label → Temu shows all its images in a window; read them, then close it */
  async function readSkuImages(o) {
    o.skuImgs = [];
    const tb = [...document.querySelectorAll('#publish-form-wrapper table')].find(x => x.querySelector('tbody tr'));
    const tr = tb && tb.querySelector('tbody tr'); const td = tr && tr.querySelectorAll(':scope > td')[1];
    if (!td) return;
    const lab = [...td.querySelectorAll('div')].find(e => /^\d+\s*Images?$/i.test(e.textContent.trim()) && !e.children.length);
    if (!lab) return;
    const want = parseInt(lab.textContent, 10) || 1;
    const grab = () => [...new Set([...document.querySelectorAll('img')].map(i => i.currentSrc || i.src || '').filter(isProdImg).map(cleanImg))];
    lab.click();
    await waitFor(() => grab().length >= want, 7000, 300);
    o.skuImgs = grab();
    const btn = [...document.querySelectorAll('button, [role="button"]')].find(b => /^(Cancel|Close)$/i.test((b.textContent || '').trim()) && vis(b) && !b.closest('#publish-form-wrapper'));
    if (btn) btn.click(); else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
    await sleep(600);
  }
  async function clickNext(o, expect) {
    const btn = await waitFor(() => [...document.querySelectorAll('#publish-form-wrapper [role="button"], #publish-form-wrapper button')].find(b => /^Next$/i.test((b.textContent || '').trim()) && vis(b)), 15000, 300);   // Temu hides Next while a step is loading
    if (!btn) { o.warn.push('NO_NEXT_BTN:' + expect); return false; }
    btn.click();
    const ok = await waitFor(() => new RegExp(expect, 'i').test(heading()), 20000, 300);
    if (!ok) { o.warn.push('STEP_BLOCKED:' + expect); return false; }
    await sleep(900);
    return true;
  }
  async function copyScrape() {
    const o = { ok: false, warn: [] };
    const ready = await waitFor(() => { const i = byId('goodsBasic.goodsName'); const v = i && i.querySelector('input'); return v && v.value; }, 30000, 400);
    if (!ready) { o.warn.push('PAGE_NOT_READY'); return o; }
    await sleep(1500);
    { const pn = document.querySelector('[class*="pageName"]'); o.mode = pn ? pn.textContent.trim() : ''; if (/^Edit/i.test(o.mode)) o.warn.push('EDIT_MODE'); }
    readStep1(o);
    let net = readNet();
    if (await clickNext(o, 'Product details')) { await sleep(600); readStep2(o); } else o.attrs = [];
    if (await clickNext(o, 'Variations')) { await sleep(1200); readStep3(o); try { await readSkuImages(o); } catch (_) { o.skuImgs = []; } } else o.skus = [];
    net = readNet();
    if (!o.description && net.desc) o.description = net.desc;
    if (!o.bullets.length && net.bullets.length) o.bullets = net.bullets;
    let imgs = net.carousel.length ? net.carousel : (o.skuImgs || []).length ? o.skuImgs : o.domImgs.length ? o.domImgs : net.sku.length ? net.sku : net.other;
    if (net.carousel.length && net.sku.length) net.sku.forEach(u => { if (!imgs.includes(u)) imgs.push(u); });
    o.images = [...new Set(imgs)].slice(0, 12);
    if (!o.images.length) { o.warn.push('NO_IMAGES_FOUND'); o.netPaths = net.paths; }
    o.ok = !!(o.title && o.catPath);
    return o;
  }


  /* ── press the row's own "More → Copy listing" (exactly what the user does by hand) ── */
  const ownText = el => [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim();
  async function openCopy(gid) {
    const tr = [...document.querySelectorAll('tr[data-testid="beast-core-table-body-tr"]')].find(r => new RegExp('Goods ID:\\s*' + gid).test(r.innerText || r.textContent || ''));
    if (!tr) return { ok: false, error: 'row not found' };
    if (document.documentElement.getAttribute('data-zc-hook') !== '1') return { ok: false, error: 'Refresh this Temu page (F5) once, then try again' };
    const tds = tr.querySelectorAll(':scope > td');
    const scope = tds[tds.length - 1] || tr;
    const more = [...scope.querySelectorAll('*')].find(e => ownText(e) === 'More');
    if (!more) return { ok: false, error: 'More button not found' };
    ['mouseover', 'mouseenter', 'mousedown', 'mouseup', 'click'].forEach(ev => more.dispatchEvent(new MouseEvent(ev, { bubbles: true, cancelable: true, view: window })));
    const menuItems = () => [...document.querySelectorAll('li[class*="cIL_item"]')].filter(vis);
    const item = await waitFor(() => { const m = menuItems(); return m.find(li => /^copy\s*(listing|product|goods)?\s*$/i.test((li.textContent || '').trim()) && !/id/i.test(li.textContent)) || m.find(li => /copy/i.test(li.textContent || '') && !/\bid\b/i.test(li.textContent || '')); }, 5000, 150);
    if (!item) { document.body.click(); return { ok: false, error: 'Copy item not in menu' }; }
    const de = document.documentElement;
    de.removeAttribute('data-zc-url'); de.setAttribute('data-zc-capture', '1');
    await sleep(300);
    ['mouseover', 'mouseenter', 'mousedown', 'mouseup'].forEach(ev => item.dispatchEvent(new MouseEvent(ev, { bubbles: true, cancelable: true, view: window })));
    item.click();
    const url = await waitFor(() => de.getAttribute('data-zc-url'), 6000, 150);
    de.removeAttribute('data-zc-capture');
    if (!url) { const ah = item.querySelector('a[href]')?.getAttribute('href'); if (ah && !/^(#|javascript:)/i.test(ah)) return { ok: true, url: ah, label: (item.textContent || '').trim() }; }
    if (!url) {
      const menu = [...document.querySelectorAll('li[class*="cIL_item"]')].filter(vis).map(li => (li.textContent || '').trim()).slice(0, 6).join(' / ');
      return { ok: false, error: 'Temu did not give a copy link' + (menu ? ' [menu: ' + menu + ']' : ''), tabHint: true };
    }
    return { ok: true, url, label: (item.textContent || '').trim() };
  }

  // v9.22.12 — Repack "Temu par kholo": press the row's own "Edit" (its link is captured like Copy, a scripted click would be popup-blocked)
  async function openEdit(gid) {
    const tr = [...document.querySelectorAll('tr[data-testid="beast-core-table-body-tr"]')].find(r => new RegExp('Goods ID:\\s*' + gid).test(r.innerText || r.textContent || ''));
    if (!tr) return { ok: false, error: 'row not found' };
    const tds = tr.querySelectorAll(':scope > td');
    const scope = tds[tds.length - 1] || tr;
    const edit = [...scope.querySelectorAll('*')].find(e => ownText(e) === 'Edit');
    if (!edit) return { ok: false, error: 'Edit button not found' };
    const ah = edit.closest('a[href]')?.getAttribute('href');
    if (ah && !/^(#|javascript:)/i.test(ah)) return { ok: true, url: ah };
    const de = document.documentElement;
    de.removeAttribute('data-zc-url'); de.setAttribute('data-zc-capture', '1');
    await sleep(200);
    ['mouseover', 'mouseenter', 'mousedown', 'mouseup'].forEach(ev => edit.dispatchEvent(new MouseEvent(ev, { bubbles: true, cancelable: true, view: window })));
    edit.click();
    const url = await waitFor(() => de.getAttribute('data-zc-url'), 5000, 150);
    de.removeAttribute('data-zc-capture');
    return url ? { ok: true, url } : { ok: false, error: 'Temu did not give an edit link', tabHint: true };
  }

  /* v9.22.13 — Repack "Temu par badlo", on the product's edit page: step 3 (Variations) → the SKU's "N Images" window →
     "Remove all" (+ its "Remove" confirm) → the new images into the upload box → the window's own Save.
     The product itself is NOT submitted: the person checks it and presses Submit. Checked live on 28 Oct 2026:
     window "Upload SKU images", [class*=removeBtn] "Remove all", confirm popover (PP_withConfirmPopoverMain) No / Remove,
     upload input inside [class*=UPD_outerWrapper] (multiple), counter "Uploaded images: N/ 10", buttons Cancel / Save. */
  function hud(t, bad) {
    let h = document.getElementById('zh-rp-hud');
    if (!h) { h = document.createElement('div'); h.id = 'zh-rp-hud'; h.style.cssText = 'position:fixed;right:18px;bottom:90px;z-index:2147483646;max-width:360px;padding:12px 14px;border-radius:8px;font:13px/1.45 -apple-system,Segoe UI,Arial,sans-serif;color:#fff;box-shadow:0 8px 24px rgba(0,0,0,.35)'; document.body.appendChild(h); }
    h.style.background = bad ? '#b91c1c' : '#0f766e'; h.textContent = t;
  }
  const skuModal = () => [...document.querySelectorAll('[data-testid="beast-core-modal"]')].find(x => vis(x) && /Upload SKU images/i.test(x.innerText || ''));
  const upCount = mo => { const mm = ((mo && mo.innerText) || '').match(/Uploaded images:\s*(\d+)\s*\/\s*(\d+)/i); return mm ? +mm[1] : -1; };
  function dataUrlFile(u, name) {
    const [head, b64] = String(u).split(','); const mime = (head.match(/:(.*?);/) || [])[1] || 'image/jpeg';
    const bin = atob(b64); const a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
    return new File([a], name + (/png/.test(mime) ? '.png' : '.jpg'), { type: mime });
  }
  async function replaceImages(images, quiet) {
    const o = { warn: [] };
    if (!Array.isArray(images) || !images.length) return { ok: false, error: 'no images' };
    if (images.length > 10) images = images.slice(0, 10);
    hud('ZHunter: opening the image step…');
    const ready = await waitFor(() => { const i = byId('goodsBasic.goodsName'); const v = i && i.querySelector('input'); return v && v.value; }, 40000, 400);
    if (!ready) return { ok: false, error: 'edit page did not load' };
    await sleep(1500);
    if (!/Variations/i.test(heading())) {
      if (!/Product details/i.test(heading()) && !(await clickNext(o, 'Product details'))) return { ok: false, error: 'could not open step 2 (' + o.warn.join(', ') + ')' };
      await sleep(800);
      if (!(await clickNext(o, 'Variations'))) return { ok: false, error: 'could not open step 3 (' + o.warn.join(', ') + ')' };
      await sleep(1500);
    }
    const tb = [...document.querySelectorAll('#publish-form-wrapper table')].find(x => x.querySelector('tbody tr'));
    const trs = tb ? [...tb.querySelectorAll('tbody tr')].filter(tr => tr.querySelectorAll(':scope > td').length >= 5) : [];
    if (!trs.length) return { ok: false, error: 'SKU table not found' };
    const td = trs[0].querySelectorAll(':scope > td')[1];
    const lab = td && [...td.querySelectorAll('div')].find(e => /^\d+\s*Images?$/i.test(e.textContent.trim()) && !e.children.length);
    if (!lab) return { ok: false, error: '"N Images" not found in the first SKU' };
    hud('ZHunter: removing the old images…');
    lab.click();
    let mo = await waitFor(skuModal, 8000, 250);
    if (!mo) return { ok: false, error: 'image window did not open' };
    await waitFor(() => upCount(skuModal()) >= 0, 5000, 250);
    if (upCount(skuModal()) > 0) {
      const ra = skuModal().querySelector('[class*="removeBtn"]');
      if (!ra) return { ok: false, error: '"Remove all" not found' };
      ra.click();
      const yes = await waitFor(() => [...document.querySelectorAll('[class*="PP_withConfirmPopoverMain"] button, [class*="PP_popoverMain"] button')].find(b => vis(b) && /^Remove$/i.test(b.textContent.trim())), 5000, 200);
      if (!yes) return { ok: false, error: 'remove confirm did not show' };
      yes.click();
      if (!(await waitFor(() => upCount(skuModal()) === 0, 8000, 250))) return { ok: false, error: 'old images were not removed' };
    }
    hud(`ZHunter: uploading ${images.length} new image${images.length === 1 ? '' : 's'}…`);
    const inp = await waitFor(() => [...(skuModal() || document).querySelectorAll('input[type="file"]')].find(i => i.closest('[class*="UPD_outerWrapper"]')), 6000, 250);
    if (!inp) return { ok: false, error: 'upload box not found' };
    const dt = new DataTransfer();
    images.forEach((u, i) => { const f = dataUrlFile(u, 'zh_repack_' + (i + 1)); if (f) dt.items.add(f); });
    inp.files = dt.files;
    inp.dispatchEvent(new Event('change', { bubbles: true }));
    const got = await waitFor(() => upCount(skuModal()) >= images.length, 90000, 500);
    if (!got) return { ok: false, error: `Temu took ${Math.max(0, upCount(skuModal()))} of ${images.length} images (size / 1:1 / at least 480 px?) — the window is left open, check it` };
    await sleep(1200);
    // v9.22.23 — since 29 Oct 2026 the window's Save / Cancel are <div role="button"> (no <button>)
    const save = [...skuModal().querySelectorAll('[role="button"], button')].find(b => /^Save$/i.test(b.textContent.trim()) && vis(b));
    if (!save) return { ok: false, error: 'Save button not found in the image window' };
    save.click();
    await waitFor(() => !skuModal(), 8000, 250);
    const now = (td.innerText || '').trim();
    if (!quiet) hud(`ZHunter: ✓ ${images.length} new image${images.length === 1 ? '' : 's'} in (${now}). Check the product, then press Next → Submit yourself.` + (trs.length > 1 ? ` Only the 1st of ${trs.length} SKUs was changed.` : ''));
    return { ok: true, n: images.length, skus: trs.length, now };
  }

  /* v9.22.19 — Repack "Temu par lagao": step 1 gets the new title, the description is emptied and every bullet point
     deleted (the old text names the old quantity), then the images as above, then Next → … → Submit (the person asked
     for the Submit). Checked live on 29 Oct 2026: title input in #goodsBasic.goodsName, description textarea in
     #goodsExtensionInfo.goodsDesc, each bullet a textarea in #goodsExtensionInfo.bulletPoints with its own "Delete"
     (no confirm), steps Product description → Product details → Variations → Offer → Safety and compliance (Submit). */
  function setText(el, v) {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
    ['input', 'change', 'blur', 'focusout'].forEach(ev => el.dispatchEvent(new Event(ev, { bubbles: true })));
  }
  /* v9.22.25 — package weight + size on step 3 (every SKU row). Checked live on 29 Oct 2026: weight = number box in
     column 4 with its unit (lb) next to it; size = column 5 "7.50in x 5.20in x 1.50in", a click opens a popover with
     "Longest side" / "Second longest side" / "Shortest side" boxes that take the value when the popover closes. */
  async function goVariations() {
    for (let i = 0; i < 4 && !/Variations/i.test(heading()); i++) {
      const nx = await waitFor(() => stepBtn(/^Next$/i), 15000, 300); if (!nx) return false;
      const h0 = heading(); nx.click();
      if (!(await waitFor(() => heading() !== h0, 20000, 300))) return false;
      await sleep(1200);
    }
    return /Variations/i.test(heading());
  }
  const fmt = n => String(Math.round(n * 100) / 100);
  // v9.22.44 — listPrice: every SKU's "List price" (input in #skuList[N].marketPrice, column 7 of step 3; checked live 30 Oct 2026)
  async function setPack(weight, dims, listPrice) {
    const done = [];
    if (!(await goVariations())) return { ok: false, error: 'could not open step 3 (Variations): "' + heading() + '"' };
    const tb = [...document.querySelectorAll('#publish-form-wrapper table')].find(x => x.querySelector('tbody tr'));
    const trs = tb ? [...tb.querySelectorAll('tbody tr')].filter(tr => tr.querySelectorAll(':scope > td').length >= 5) : [];
    if (!trs.length) return { ok: false, error: 'SKU table not found' };
    const closePop = () => ['mousedown', 'mouseup', 'click'].forEach(ev => document.body.dispatchEvent(new MouseEvent(ev, { bubbles: true, view: window })));
    for (const tr of trs) {
      const tds = tr.querySelectorAll(':scope > td');
      if (weight) {
        const wi = tds[3] && tds[3].querySelector('input');
        if (!wi) return { ok: false, error: 'weight box not found' };
        const unit = (tds[3].textContent || '').toLowerCase();
        let w = Number(weight);   // the extension's value is in lb
        if (/\boz\b/.test(unit)) w = w * 16; else if (/\bkg\b/.test(unit)) w = w / 2.20462; else if (/\bg\b/.test(unit) && !/\blb\b/.test(unit)) w = w * 453.592;
        setText(wi, fmt(w)); await sleep(400);
        if (Math.abs(parseFloat(wi.value) - Math.round(w * 100) / 100) > 0.011) return { ok: false, error: 'the weight did not take' };
      }
      if (Array.isArray(dims) && dims.length === 3) {
        const wrap = tds[4] && tds[4].querySelector('[class*="dimensionWrapper"]');
        const val = wrap && wrap.querySelector('[class*="value-"]');
        if (!val) return { ok: false, error: 'size box not found' };
        const cm = /cm/i.test(wrap.textContent || '');
        const s = dims.map(Number).sort((a, b) => b - a).map(x => cm ? x * 2.54 : x);   // Temu asks longest side first
        ['mousedown', 'mouseup', 'click'].forEach(ev => val.dispatchEvent(new MouseEvent(ev, { bubbles: true, view: window })));
        const names = ['Longest side', 'Second longest side', 'Shortest side'];
        const box = n => [...document.querySelectorAll('input')].find(i => i.placeholder === n && vis(i));
        if (!(await waitFor(() => box(names[0]), 5000, 200))) return { ok: false, error: 'size window did not open' };
        for (let i = 0; i < 3; i++) { setText(box(names[i]), fmt(s[i])); await sleep(250); }
        closePop(); await sleep(900);
        const got = ((wrap.textContent || '').match(/[\d.]+/g) || []).map(Number);
        if (got.length < 3 || got.slice(0, 3).some((x, i) => Math.abs(x - Math.round(s[i] * 100) / 100) > 0.011)) return { ok: false, error: 'the size did not take (' + (wrap.textContent || '').trim() + ')' };
      }
      if (listPrice) {
        const fi = tr.querySelector('[id$=".marketPrice"]'), li = fi && fi.querySelector('input');
        if (!li) return { ok: false, error: 'list price box not found' };
        const want = Number(listPrice).toFixed(2);
        setText(li, want); await sleep(500);
        if (Math.abs(parseFloat(li.value) - Number(want)) > 0.001) return { ok: false, error: 'the list price did not take' };
        const ex = [...fi.querySelectorAll('[class*="Form_itemExplain"]')].map(e => (e.innerText || '').trim()).filter(Boolean)[0];
        if (ex) return { ok: false, error: 'Temu does not accept list price ' + want + ': ' + ex.slice(0, 120) };
      }
    }
    if (listPrice) done.push('list price $' + Number(listPrice).toFixed(2));
    if (weight) done.push('weight ' + fmt(Number(weight)) + ' lb');
    if (Array.isArray(dims) && dims.length === 3) done.push('size ' + dims.map(x => fmt(Number(x))).join('x') + ' in');
    return { ok: true, done };
  }
  const stepBtn = re => [...document.querySelectorAll('#publish-form-wrapper [role="button"], #publish-form-wrapper button')].find(b => re.test((b.textContent || '').trim()) && vis(b));
  async function applyEdit(m) {
    const o = { warn: [] };
    hud('ZHunter: opening the product…');
    // v9.22.31 — some products open on the last step (Safety and compliance): there is no title box yet, so "loaded" is
    // any step heading; then Previous back to step 1
    const titleBox = () => { const i = byId('goodsBasic.goodsName'); const v = i && i.querySelector('input'); return v && v.value ? v : null; };
    const ready = await waitFor(() => titleBox() || (/Product details|Variations|Offer|Safety and compliance/i.test(heading()) && stepBtn(/^Previous$/i)), 40000, 400);
    if (!ready) return { ok: false, error: 'edit page did not load' };
    await sleep(1500);
    for (let i = 0; i < 6 && !/Product description/i.test(heading()); i++) {
      const prev = await waitFor(() => stepBtn(/^Previous$/i), 10000, 300); if (!prev) break;
      const h0 = heading(); hud('ZHunter: back to step 1 (from "' + h0 + '")…');
      prev.click();
      await waitFor(() => heading() !== h0, 15000, 300); await sleep(1000);
    }
    if (!/Product description/i.test(heading())) return { ok: false, error: 'could not go back to step 1 (stuck on "' + heading() + '")' };
    if (!(await waitFor(titleBox, 20000, 400))) return { ok: false, error: 'step 1 opened but the title box did not load' };
    await sleep(800);
    const done = [];
    if (m.title) {
      const want = String(m.title).replace(/\s+/g, ' ').trim().slice(0, 500);
      const box = () => byId('goodsBasic.goodsName') && byId('goodsBasic.goodsName').querySelector('input');
      // v9.22.25 — set, wait, check again (and once more) so a late page refresh cannot put the old title back
      for (let i = 0; i < 3 && box() && box().value !== want; i++) { setText(box(), want); await sleep(1500); }
      if (!box() || box().value !== want) return { ok: false, error: 'the new title did not take (Temu kept: "' + ((box() && box().value) || '').slice(0, 60) + '")' };
      done.push('title');
    }
    // v9.22.30 — no brand chosen (red "Please enter the brand" blocks Next): tick "This product does not have a brand"
    const bi = byId('brand');
    if (bi) {
      const lab = re => [...bi.querySelectorAll('label')].find(l => re.test(l.textContent || ''));
      const on = l => !!l && (l.getAttribute('data-checked') === 'true' || !!(l.querySelector('input') || {}).checked);
      // the chosen brand is the value of the brand list's text box (a cascader, "TAYLORMADE / TAYLORMADE"); empty = no brand
      const bx = bi.querySelector('input[type="text"]');
      const empty = !!bx && !String(bx.value || '').trim();
      const none = lab(/does not have a brand/i), later = lab(/fill in later/i);
      if (empty && none && !on(none) && !on(later)) {
        none.click(); await sleep(800);
        if (!on(none)) return { ok: false, error: 'brand is empty and "This product does not have a brand" could not be ticked' };
        done.push('no brand ticked');
      }
    }
    if (m.clearText) {
      const d = byId('goodsExtensionInfo.goodsDesc') && byId('goodsExtensionInfo.goodsDesc').querySelector('textarea');
      if (d && d.value) { setText(d, ''); done.push('description'); }
      const bp = byId('goodsExtensionInfo.bulletPoints');
      let n = 0;
      for (let i = 0; i < 30 && bp; i++) {
        const del = [...bp.querySelectorAll('span')].find(s => s.textContent.trim() === 'Delete' && vis(s));
        if (!del) break;
        (del.closest('[class*="textButton"]') || del.parentElement).click(); n++; await sleep(350);
      }
      if (bp && bp.querySelector('textarea')) return { ok: false, error: 'bullet points could not all be deleted' };
      if (n) done.push(n + ' bullet' + (n === 1 ? '' : 's') + ' deleted');
    }
    let img = null;
    if (Array.isArray(m.images) && m.images.length) {
      img = await replaceImages(m.images, true);
      if (!img.ok) return Object.assign(img, { done });
      done.push(img.n + ' images');
    }
    if (m.weight || (Array.isArray(m.dims) && m.dims.length === 3) || m.listPrice) {
      const p = await setPack(m.weight, m.dims, m.listPrice);
      if (!p.ok) return Object.assign(p, { done });
      done.push(...p.done);
    }
    if (!m.submit) { hud('ZHunter: ✓ ' + done.join(', ') + '. Check it and press Submit yourself.'); return { ok: true, done, submitted: false, skus: img && img.skus }; }
    // on to the last step
    for (let i = 0; i < 5 && !/Safety and compliance/i.test(heading()); i++) {
      const nx = await waitFor(() => stepBtn(/^Next$/i), 15000, 300);
      if (!nx) return { ok: false, error: 'Next not found on "' + heading() + '"', done };
      const h0 = heading(); nx.click();
      if (!(await waitFor(() => heading() !== h0, 20000, 300))) return { ok: false, error: 'Temu stopped on "' + h0 + '" (a field there needs you)', done };
      await sleep(1000);
    }
    const sub = await waitFor(() => stepBtn(/^Submit$/i), 15000, 300);
    if (!sub) return { ok: false, error: 'Submit button not found', done };
    hud('ZHunter: submitting…');
    const url0 = location.href;
    sub.click();
    // done when Temu leaves the edit page or says so; a window / red field that stays means the person must look.
    // v9.22.45 — a short Temu message (toast) is remembered even after it fades, and when nothing at all happened
    // after 15 s while Submit is still there, Submit is pressed once more (a page in a window behind can miss the first)
    let seen = '', again = false;
    const t0 = Date.now();
    const res = await waitFor(() => {
      if (location.href !== url0 && !/product-info/i.test(location.href)) return 'left';
      const t = [...document.querySelectorAll('[data-testid="beast-core-modal"], [class*="Toast"], [class*="toast"], [class*="MSG_"]')].filter(vis).map(x => (x.innerText || '').trim()).filter(Boolean).join(' ');
      if (/success|submitted|under review/i.test(t)) return 'ok';
      if (t) seen = t;
      if (!again && !seen && Date.now() - t0 > 15000) {
        const s2 = stepBtn(/^Submit$/i);
        if (s2 && !s2.disabled && !/loading/i.test(s2.className || '')) { again = true; hud('ZHunter: submitting again…'); s2.click(); }
      }
      return '';
    }, 60000, 500);
    if (!res) {
      const red = [...document.querySelectorAll('[data-testid="beast-core-modal"], [class*="Form_itemExplain"], [class*="error"]')].filter(vis).find(x => (x.innerText || '').trim());
      if (red) { try { red.scrollIntoView({ block: 'center' }); } catch (_) { /* no scroll */ } }
      const msg = (red && red.innerText.trim()) || seen;
      return { ok: false, error: 'Submit pressed' + (again ? ' twice' : '') + ', but Temu did not confirm' + (msg ? ': ' + msg.replace(/\s+/g, ' ').slice(0, 160) : ' — check this tab'), done };
    }
    hud('ZHunter: ✓ submitted (' + done.join(', ') + ')');
    return { ok: true, done, submitted: true, skus: img && img.skus };
  }

  chrome.runtime.onMessage.addListener((m, s, send) => {
    if (!m || typeof m.action !== 'string' || m.action.indexOf('ZC_') !== 0) return;
    if (m.action === 'ZC_REPLACE_IMAGES') { replaceImages(m.images).then(r => { if (!r.ok) hud('ZHunter: ' + r.error, true); send(r); }).catch(e => { hud('ZHunter: ' + (e && e.message || e), true); send({ ok: false, error: String(e && e.message || e) }); }); return true; }
    if (m.action === 'ZC_APPLY_EDIT') { applyEdit(m).then(r => { if (!r.ok) hud('ZHunter: ' + r.error, true); send(r); }).catch(e => { hud('ZHunter: ' + (e && e.message || e), true); send({ ok: false, error: String(e && e.message || e) }); }); return true; }
    if (m.action === 'ZC_OPEN_EDIT') { openEdit(String(m.goodsId || '')).then(send).catch(e => send({ ok: false, error: String(e && e.message || e) })); return true; }
    if (!/seller\.temu\.com$/i.test(location.hostname)) { send({ success: false, error: 'not seller.temu.com' }); return true; }
    if (m.action === 'ZC_PING') { send({ ready: true, path: location.pathname }); return true; }
    if (m.action === 'ZC_LIST_SELECTED') { try { send({ success: true, rows: listSelected() }); } catch (e) { send({ success: false, error: String(e && e.message || e) }); } return true; }
    if (m.action === 'ZC_OPEN_COPY') { openCopy(String(m.goodsId || '')).then(send).catch(e => send({ ok: false, error: String(e && e.message || e) })); return true; }
    if (m.action === 'ZC_COPY_SCRAPE') { copyScrape().then(r => send({ success: true, data: r })).catch(e => send({ success: false, error: String(e && e.message || e) })); return true; }
  });
})();
