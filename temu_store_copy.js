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
    const tds = tr.querySelectorAll(':scope > td');
    const scope = tds[tds.length - 1] || tr;
    const more = [...scope.querySelectorAll('*')].find(e => ownText(e) === 'More');
    if (!more) return { ok: false, error: 'More button not found' };
    ['mouseover', 'mouseenter', 'mousedown', 'mouseup', 'click'].forEach(ev => more.dispatchEvent(new MouseEvent(ev, { bubbles: true, cancelable: true, view: window })));
    const item = await waitFor(() => [...document.querySelectorAll('li[class*="cIL_item"]')].find(li => /^Copy/i.test((li.textContent || '').trim()) && vis(li)), 5000, 150);
    if (!item) { document.body.click(); return { ok: false, error: 'Copy item not in menu' }; }
    const de = document.documentElement;
    de.removeAttribute('data-zc-url'); de.setAttribute('data-zc-capture', '1');
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

  chrome.runtime.onMessage.addListener((m, s, send) => {
    if (!m || typeof m.action !== 'string' || m.action.indexOf('ZC_') !== 0) return;
    if (!/seller\.temu\.com$/i.test(location.hostname)) { send({ success: false, error: 'not seller.temu.com' }); return true; }
    if (m.action === 'ZC_PING') { send({ ready: true, path: location.pathname }); return true; }
    if (m.action === 'ZC_LIST_SELECTED') { try { send({ success: true, rows: listSelected() }); } catch (e) { send({ success: false, error: String(e && e.message || e) }); } return true; }
    if (m.action === 'ZC_OPEN_COPY') { openCopy(String(m.goodsId || '')).then(send).catch(e => send({ ok: false, error: String(e && e.message || e) })); return true; }
    if (m.action === 'ZC_COPY_SCRAPE') { copyScrape().then(r => send({ success: true, data: r })).catch(e => send({ success: false, error: String(e && e.message || e) })); return true; }
  });
})();
