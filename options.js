// ============================================================
// ZHunter PRO v8.9.2 - Options / Settings Page
// Full working settings with API key, toggles,
// stats, export, danger zone, model list
// ============================================================
'use strict';

// ── CSP-safe <img> error handling (MV3 blocks inline onerror=) ─────────
// Usage: <img data-onerror="hide|broken|vidicon">
document.addEventListener('error', e => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement)) return;
  const mode = img.dataset.onerror;
  if (!mode) return;
  const parent = img.parentElement;
  if (mode === 'hide') {
    img.style.display = 'none';
  } else if (mode === 'broken' && parent) {
    parent.classList.add('broken');
    img.style.display = 'none';
    if (!parent.querySelector('.hunt-img-broken')) {
      const d = document.createElement('div');
      d.className = 'hunt-img-broken';
      d.textContent = 'Image broken \u2014 auto-skipped';
      parent.appendChild(d);
    }
  } else if (mode === 'vidicon' && parent) {
    parent.innerHTML = '<div class=vid-thumb-icon>&#9654;</div>';
  }
}, true);

const STORAGE_KEY = 'zakLinkCollectorData';
const APP_VERSION = chrome.runtime.getManifest().version;


const DEFAULT_SETTINGS = {
  autoCategory:   true,
  duplicateCheck: true,
  badgeEnabled:   true,
  lastFolder:     'General',

  imageFormat:    'jpg',
  bulkFilenamePrefix: 'zhunter_',
  autoSkipDuplicates: true,
  imageRatio:     'original',
  imageBg:        'original',
  imageMinSize:   0,
  imageMax5MB:    true,
  bulkAutoCloseTabs: true,
  productSheetColumns: {
    folderNumber: true, title: true, link: true, sourcingPrice: true,
    platform: false, description: false, imageCount: false, videoCount: false,
    imageLinks: false, videoLinks: false, variants: false, status: false,
    source: false, createdAt: false
  },
  customProductColumns: []
};

// ── State ────────────────────────────────────────────────────
let currentSettings = { ...DEFAULT_SETTINGS };
let currentData     = null;
let confirmCb       = null;


function applyDynamicVersion() {
  const version = `v${APP_VERSION}`;
  document.querySelectorAll('[data-version], .opt-version').forEach(el => { el.textContent = version; });
  document.querySelectorAll('.version-value').forEach(el => { el.textContent = APP_VERSION; });
}

// ── DOM Helper ───────────────────────────────────────────────
function $(id) { return document.getElementById(id); }


// ── Theme / Day-Night Mode ───────────────────────────────────
const UI_KEY = 'zakUIState';
let currentTheme = 'dark';

async function getUIState() {
  try {
    const result = await chrome.storage.local.get(UI_KEY);
    return result[UI_KEY] || {};
  } catch (_) { return {}; }
}

async function saveUIState(updates) {
  try {
    const current = await getUIState();
    await chrome.storage.local.set({ [UI_KEY]: { ...current, ...updates } });
  } catch (_) {}
}

function applyTheme(theme) {
  currentTheme = theme === 'light' ? 'light' : 'dark';
  document.body.classList.toggle('light-mode', currentTheme === 'light');
  const btn = $('optThemeToggleBtn');
  if (btn) {
    btn.classList.toggle('theme-light-active', currentTheme === 'light');
    btn.title = currentTheme === 'light' ? 'Switch to Dark Mode' : 'Switch to Light Mode';
    btn.setAttribute('aria-label', btn.title);
  }
}

async function initTheme() {
  const ui = await getUIState();
  applyTheme(ui.theme === 'light' ? 'light' : 'dark');
  $('optThemeToggleBtn')?.addEventListener('click', async () => {
    applyTheme(currentTheme === 'light' ? 'dark' : 'light');
    await saveUIState({ theme: currentTheme });
    toast(`${currentTheme === 'light' ? '☀️ Light' : '🌙 Dark'} mode activated`, 'info');
  });
}

// ── Storage ──────────────────────────────────────────────────
async function getData() {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    return result[STORAGE_KEY] || null;
  } catch (_) { return null; }
}

async function saveSettings(settings) {
  try {
    const res = await chrome.runtime.sendMessage({ action: 'UPDATE_SETTINGS', settings });
    return res && res.success;
  } catch (_) { return false; }
}

// ── Toast ─────────────────────────────────────────────────────
function toast(message, type = 'info') {
  const stack = $('optToastStack');
  if (!stack) return;
  while (stack.children.length >= 4) stack.firstChild?.remove();

  const icons = { ok: '✅', err: '❌', warn: '⚠️', info: 'ℹ️' };
  const item = document.createElement('div');
  item.className = `toast-item ${type}`;
  item.innerHTML = `<span class="toast-icon">${icons[type] || 'ℹ️'}</span><span>${escHtml(message)}</span>`;
  stack.appendChild(item);
  item.getBoundingClientRect();
  item.classList.add('visible');
  setTimeout(() => {
    item.classList.add('leaving');
    setTimeout(() => item.remove(), 320);
  }, 3200);
}

function escHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Confirm Modal ─────────────────────────────────────────────
function showConfirm(title, message, okLabel, cb) {
  const tEl = $('optConfirmTitle');
  const mEl = $('optConfirmMessage');
  const oEl = $('optConfirmOk');
  if (tEl) tEl.textContent = title;
  if (mEl) mEl.textContent = message;
  if (oEl) oEl.textContent = okLabel;
  confirmCb = cb;
  $('optConfirmModal')?.classList.remove('hidden');
  setTimeout(() => $('optConfirmOk')?.focus(), 100);
}

function initConfirmModal() {
  $('optConfirmClose')?.addEventListener('click', closeConfirm);
  $('optConfirmCancel')?.addEventListener('click', closeConfirm);
  $('optConfirmOk')?.addEventListener('click', () => {
    closeConfirm();
    if (confirmCb) { confirmCb(); confirmCb = null; }
  });
  $('optConfirmModal')?.addEventListener('click', e => {
    if (e.target === $('optConfirmModal')) closeConfirm();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeConfirm();
  });
}

function closeConfirm() {
  $('optConfirmModal')?.classList.add('hidden');
}

// ── Toggle Switches ───────────────────────────────────────────
function initToggle(id, settingKey) {
  const track = $(id);
  if (!track) return;

  // Inject thumb into track
  const thumb = document.createElement('div');
  thumb.className = 'toggle-thumb';
  track.appendChild(thumb);

  const updateVisual = (val) => {
    track.classList.toggle('on', !!val);
    track.setAttribute('aria-checked', val ? 'true' : 'false');
  };

  updateVisual(currentSettings[settingKey]);

  const toggle = async () => {
    currentSettings[settingKey] = !currentSettings[settingKey];
    updateVisual(currentSettings[settingKey]);
    const ok = await saveSettings({ [settingKey]: currentSettings[settingKey] });
    if (ok) {
      const labels = { autoCategory: 'Auto category', duplicateCheck: 'Duplicate check', badgeEnabled: 'Badge counter', autoSkipDuplicates: 'Auto-skip duplicates', imageMax5MB: '5 MB limit', bulkAutoCloseTabs: 'Close tabs after hunt' };
      toast(`${labels[settingKey] || 'Setting'} ${currentSettings[settingKey] ? 'enabled' : 'disabled'}`, 'ok');
    } else {
      toast('Failed to save setting', 'err');
    }
  };

  track.addEventListener('click', toggle);
  track.addEventListener('keydown', e => {
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle(); }
  });
}


// ── Data Stats ────────────────────────────────────────────────
async function loadStats() {
  try {
    const st = await chrome.storage.local.get(['zhunterMasterSheet', 'zhunterMasterBatches', 'zhunterBulkQueue']);
    const rows = Array.isArray(st.zhunterMasterSheet) ? st.zhunterMasterSheet : [];
    const batches = Array.isArray(st.zhunterMasterBatches) ? st.zhunterMasterBatches : [];
    const queue = Array.isArray(st.zhunterBulkQueue) ? st.zhunterBulkQueue : [];
    const waiting = queue.filter(i => !i.hunted && i.status !== 'complete').length;
    if ($('statProducts')) $('statProducts').textContent = rows.length;
    if ($('statFolders'))  $('statFolders').textContent  = batches.length;
    if ($('statTags'))     $('statTags').textContent     = waiting;
    const bytes = await chrome.storage.local.getBytesInUse(null);
    const mb = (bytes / 1048576).toFixed(1), kb = Math.round(bytes / 1024);
    if ($('storageDesc')) $('storageDesc').textContent = bytes > 1048576 ? `${mb} MB used · ${rows.length} products in Library` : `${kb} KB used · ${rows.length} products in Library`;
  } catch (_) {
    if ($('storageDesc')) $('storageDesc').textContent = 'Could not read storage';
  }
}

// ── Export ────────────────────────────────────────────────────
function dlFile(content, name, mime) {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), {
    href: url, download: name, style: 'display:none'
  });
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
}

function fmtDate(iso) {
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: '2-digit'
    });
  } catch { return ''; }
}

function initExport() {
  // JSON Export
  $('exportDataBtn')?.addEventListener('click', async () => {
    const st = await chrome.storage.local.get(['zhunterMasterSheet', 'zhunterMasterBatches', 'zhunterBulkQueue']);
    const data = await getData();
    const backup = {
      app: 'ZHunter', version: APP_VERSION, exported: new Date().toISOString(),
      settings: data?.settings || {},
      masterSheet: Array.isArray(st.zhunterMasterSheet) ? st.zhunterMasterSheet : [],
      batches: Array.isArray(st.zhunterMasterBatches) ? st.zhunterMasterBatches : [],
      queue: Array.isArray(st.zhunterBulkQueue) ? st.zhunterBulkQueue : []
    };
    if (!backup.masterSheet.length && !backup.queue.length) { toast('Nothing to back up yet', 'warn'); return; }
    dlFile(JSON.stringify(backup, null, 2), `zhunter-backup-${new Date().toISOString().slice(0, 10)}.json`, 'application/json');
    toast(`Backup saved: ${backup.masterSheet.length} products`, 'ok');
  });

  // HTML Export
  $('exportHtmlOptBtn')?.addEventListener('click', async () => {
    const data = await getData();
    if (!data?.links?.length) { toast('No products to export', 'warn'); return; }
    buildHtmlExport(data.links);
    toast('HTML catalog exported', 'ok');
  });
}

function buildHtmlExport(links) {
  const byFolder = {};
  links.forEach(l => {
    (byFolder[l.folder] = byFolder[l.folder] || []).push(l);
  });

  const sections = Object.entries(byFolder).map(([folder, fLinks]) => {
    const cards = fLinks.map(l => {
      const images = Array.isArray(l.images) && l.images.length > 0
        ? l.images : (l.base64Image ? [l.base64Image] : []);
      const safeUrl   = escHtml(l.url || '');
      const safeTitle = escHtml(l.title || l.url || '');
      const safeNotes = escHtml(l.notes || '').replace(/\n/g, '<br>');
      const safePrice = escHtml(l.price || '');
      const safeCat   = escHtml(l.category || 'Other');
      const safeTags  = (l.tags || []).map(t => `<span class="tag">${escHtml(t)}</span>`).join('');
      const safeDate  = escHtml(fmtDate(l.dateAdded));
      const safeVideo = l.videoUrl ? escHtml(l.videoUrl) : '';

      const imgGallery = images.length > 0
        ? `<div class="img-gallery">
            <div class="img-main-wrap">
              <img class="img-main" src="${escHtml(images[0])}" alt="${safeTitle}" loading="lazy" onerror="this.style.display='none'"/>
            </div>
            ${images.length > 1
              ? `<div class="img-thumbs">${images.slice(1, 6).map((src, i) =>
                  `<img class="img-thumb-exp" src="${escHtml(src)}" alt="Image ${i+2}" loading="lazy"
                   onclick="switchImg(this)" onerror="this.style.display='none'"/>`
                ).join('')}</div>`
              : ''}
           </div>`
        : `<div class="img-placeholder">No Image</div>`;

      let videoSection = '';
      if (safeVideo) {
        const isYT = safeVideo.includes('youtube.com/embed') || safeVideo.includes('youtu.be');
        videoSection = isYT
          ? `<iframe src="${safeVideo}" frameborder="0" allowfullscreen class="video-iframe" loading="lazy"></iframe>`
          : `<video controls class="video-player" preload="none"><source src="${safeVideo}"/></video>`;
      }

      return `
      <div class="card" id="card-${escHtml(l.id)}">
        ${imgGallery}
        ${videoSection ? `<div class="video-section">${videoSection}</div>` : ''}
        <div class="card-body">
          <div class="cat-badge">${safeCat}</div>
          <div class="title-row">
            <a href="${safeUrl}" target="_blank" rel="noopener noreferrer" class="card-title">${safeTitle}</a>
            <button class="copy-btn" onclick="copyText('${safeTitle.replace(/'/g, "\\'")}', this)" title="Copy title">📋</button>
          </div>
          ${safePrice ? `<div class="card-price">${safePrice}</div>` : ''}
          ${safeNotes
            ? `<div class="notes-wrap">
                <div class="card-notes" id="notes-${escHtml(l.id)}">${safeNotes}</div>
                <button class="copy-desc-btn" onclick="copyText(document.getElementById('notes-${escHtml(l.id)}').innerText,this)">📋 Copy Description</button>
               </div>`
            : ''}
          ${safeTags ? `<div class="card-tags">${safeTags}</div>` : ''}
          <div class="card-meta">
            <span>📅 ${safeDate}</span>
            <span>📁 ${escHtml(l.folder)}</span>
            ${safeVideo ? '<span>▶ Video</span>' : ''}
          </div>
          <div class="btn-row">
            <a href="${safeUrl}" target="_blank" rel="noopener noreferrer" class="btn-view">🔗 View Product</a>
            <button onclick="removeCard('${escHtml(l.id)}')" class="btn-rm">✕ Remove</button>
          </div>
        </div>
      </div>`;
    }).join('');

    return `
    <section class="folder-section" data-folder="${escHtml(folder)}">
      <div class="folder-head">
        <span>📁</span>
        <h2>${escHtml(folder)}</h2>
        <span class="folder-count">${fLinks.length} product${fLinks.length !== 1 ? 's' : ''}</span>
      </div>
      <div class="cards-grid">${cards}</div>
    </section>`;
  }).join('');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>ZHunter PRO — Catalog</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{--bg:#050816;--card:#0e1530;--border:#1a2347;--theme:#06b6d4;--green:#10b981;--text1:#fafafa;--text2:#d4d4d8;--text3:#a1a1aa;--text4:#71717a}
body{font-family:system-ui,sans-serif;background:var(--bg);color:var(--text1);min-height:100vh}
a{color:inherit;text-decoration:none}
header{background:linear-gradient(135deg,#0f0f1a,#1a0a12);padding:24px 32px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px}
.site-title{font-size:24px;font-weight:900;background:linear-gradient(135deg,#ffffff,#06b6d4);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.site-meta{font-size:11px;color:var(--text3);margin-top:3px}
.search-bar{padding:14px 32px;background:#111113;border-bottom:1px solid var(--border);display:flex;gap:8px;flex-wrap:wrap}
.search-inp{flex:1;min-width:180px;padding:9px 14px;background:var(--card);border:1px solid var(--border);border-radius:8px;color:var(--text1);font-size:13px;outline:none}
.search-inp:focus{border-color:var(--theme)}
.filter-sel{padding:9px 12px;background:var(--card);border:1px solid var(--border);border-radius:8px;color:var(--text1);font-size:12px;cursor:pointer;outline:none}
.container{max-width:1300px;margin:0 auto;padding:24px 32px}
.folder-section{margin-bottom:40px}
.folder-head{display:flex;align-items:center;gap:10px;margin-bottom:16px;padding-bottom:10px;border-bottom:1px solid var(--border)}
.folder-head h2{font-size:17px;font-weight:800}
.folder-count{margin-left:auto;font-size:11px;background:rgba(6,182,212,0.12);color:var(--theme);border:1px solid rgba(6,182,212,0.25);padding:2px 10px;border-radius:999px;font-weight:700}
.cards-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px}
.card{background:var(--card);border:1px solid var(--border);border-radius:14px;overflow:hidden;display:flex;flex-direction:column;transition:all 0.22s}
.card:hover{border-color:rgba(6,182,212,0.3);box-shadow:0 6px 24px rgba(6,182,212,0.1);transform:translateY(-2px)}
.card.removing{animation:fadeOut 0.32s ease forwards}
@keyframes fadeOut{to{opacity:0;transform:scale(0.93) translateY(8px)}}
.img-gallery{background:#0a0a0f}
.img-main-wrap{width:100%;aspect-ratio:4/3;overflow:hidden;background:#0d0d14;display:flex;align-items:center;justify-content:center}
.img-main{width:100%;height:100%;object-fit:contain;cursor:zoom-in;transition:transform 0.3s}
.img-main:hover{transform:scale(1.04)}
.img-thumbs{display:flex;gap:5px;padding:5px;background:#0d0d14;overflow-x:auto}
.img-thumb-exp{width:48px;height:48px;object-fit:cover;border-radius:5px;cursor:pointer;border:2px solid transparent;flex-shrink:0;transition:border-color 0.15s}
.img-thumb-exp:hover{border-color:var(--theme)}
.img-placeholder{display:flex;align-items:center;justify-content:center;padding:32px;background:#0d0d14;color:var(--text4);font-size:12px}
.video-section{background:#0a0a0f;padding:5px}
.video-iframe{width:100%;aspect-ratio:16/9;border-radius:7px;display:block;border:none}
.video-player{width:100%;aspect-ratio:16/9;border-radius:7px;background:#000;display:block}
.card-body{padding:13px;display:flex;flex-direction:column;gap:7px;flex:1}
.cat-badge{display:inline-block;padding:2px 8px;border-radius:999px;font-size:9px;font-weight:700;background:rgba(6,182,212,0.12);color:var(--theme);border:1px solid rgba(6,182,212,0.22);width:fit-content}
.title-row{display:flex;align-items:flex-start;gap:7px}
.card-title{font-size:13.5px;font-weight:700;line-height:1.4;flex:1;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.card-title:hover{color:#67e8f9}
.copy-btn{background:none;border:none;cursor:pointer;font-size:12px;padding:2px 4px;border-radius:4px;color:var(--text3);flex-shrink:0;transition:all 0.15s}
.copy-btn:hover{background:rgba(255,255,255,0.08);color:var(--text1)}
.card-price{font-size:16px;font-weight:800;color:var(--green)}
.notes-wrap{background:rgba(255,255,255,0.03);border-radius:7px;padding:7px 9px;border:1px solid var(--border)}
.card-notes{font-size:11.5px;color:var(--text2);line-height:1.6;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden;white-space:pre-wrap;margin-bottom:5px}
.copy-desc-btn{width:100%;background:rgba(6,182,212,0.1);border:1px solid rgba(6,182,212,0.22);color:#67e8f9;border-radius:5px;padding:4px 8px;font-size:10px;font-weight:700;cursor:pointer;transition:background 0.15s}
.copy-desc-btn:hover{background:rgba(6,182,212,0.2)}
.card-tags{display:flex;flex-wrap:wrap;gap:4px}
.tag{padding:2px 7px;border-radius:999px;font-size:9.5px;font-weight:600;background:rgba(6,182,212,0.12);color:#67e8f9;border:1px solid rgba(6,182,212,0.2)}
.card-meta{display:flex;gap:8px;font-size:10px;color:var(--text4);margin-top:auto;padding-top:5px;border-top:1px solid var(--border);flex-wrap:wrap}
.btn-row{display:flex;gap:5px;flex-wrap:wrap}
.btn-view{display:inline-flex;align-items:center;justify-content:center;flex:1;padding:7px 10px;border-radius:6px;font-size:11px;font-weight:700;background:linear-gradient(135deg,var(--theme),#0e7490);color:white;cursor:pointer;text-decoration:none;border:none;transition:opacity 0.15s}
.btn-view:hover{opacity:0.88}
.btn-rm{padding:7px 9px;border-radius:6px;font-size:11px;font-weight:700;background:rgba(239,68,68,0.1);color:#f87171;border:1px solid rgba(239,68,68,0.22);cursor:pointer;transition:background 0.15s}
.btn-rm:hover{background:rgba(239,68,68,0.2)}
.hidden{display:none!important}
footer{text-align:center;padding:24px;color:var(--text4);font-size:11px;border-top:1px solid var(--border);margin-top:16px}
@media(max-width:600px){.container,.search-bar,header{padding-left:12px;padding-right:12px}.cards-grid{grid-template-columns:1fr}}
</style>
</head>
<body>
<header>
  <div>
    <div class="site-title">🛍️ ZHunter PRO Catalog</div>
    <div class="site-meta">Exported ${new Date().toLocaleString()} · ${links.length} products · v${APP_VERSION}</div>
  </div>
</header>
<div class="search-bar">
  <input class="search-inp" type="search" placeholder="🔍 Search products…" oninput="filterCards(this.value)" autocomplete="off"/>
  <select class="filter-sel" onchange="filterByFolder(this.value)">
    <option value="">All Folders</option>
    ${Object.keys(byFolder).map(f => `<option value="${escHtml(f)}">${escHtml(f)}</option>`).join('')}
  </select>
</div>
<div class="container">${sections}</div>
<footer>Generated by ZHunter PRO v${APP_VERSION}</footer>
<script>
function copyText(text,btn){
  navigator.clipboard.writeText(text).then(()=>{
    const orig=btn.textContent;
    btn.textContent='✓ Copied!';
    btn.style.color='#10b981';
    setTimeout(()=>{btn.textContent=orig;btn.style.color='';},2000);
  }).catch(()=>{
    const ta=document.createElement('textarea');
    ta.value=text;ta.style.cssText='position:fixed;opacity:0';
    document.body.appendChild(ta);ta.select();
    try{document.execCommand('copy');}catch(e){}
    ta.remove();
    btn.textContent='✓ Copied!';
    setTimeout(()=>{btn.textContent=btn.dataset.orig||'📋';},2000);
  });
}
function removeCard(id){
  const c=document.getElementById('card-'+id);
  if(!c)return;
  c.classList.add('removing');
  setTimeout(()=>c.remove(),320);
}
function filterCards(q){
  q=q.toLowerCase().trim();
  document.querySelectorAll('.card').forEach(c=>{
    c.classList.toggle('hidden',q.length>0&&!c.textContent.toLowerCase().includes(q));
  });
}
function filterByFolder(f){
  document.querySelectorAll('.folder-section').forEach(s=>{
    if(!f){s.classList.remove('hidden');return;}
    s.classList.toggle('hidden',s.dataset.folder!==f);
  });
}
function switchImg(thumb){
  const g=thumb.closest('.img-gallery');
  const m=g&&g.querySelector('.img-main');
  if(m)m.src=thumb.src;
  g&&g.querySelectorAll('.img-thumb-exp').forEach(t=>t.style.borderColor='transparent');
  thumb.style.borderColor='#06b6d4';
}
<\/script>
</body>
</html>`;

  dlFile(html, 'zhunter-catalog.html', 'text/html');
}

// ── Danger Zone ───────────────────────────────────────────────
function initDangerZone() {
  $('dangerClearProducts')?.addEventListener('click', () => {
    showConfirm(
      'Clear All Products',
      `This empties the Library (all hunted products and hunt history). Settings and the queue are kept. This cannot be undone.`,
      'Delete All Products',
      async () => {
        try {
          // Use background.js CLEAR_ALL action — this triggers updateBadge()
          const res = await chrome.runtime.sendMessage({ action: 'CLEAR_ALL' });
          if (!res?.success) throw new Error('clear_failed');
          await loadStats();
          toast('All products deleted', 'ok');
        } catch (_) {
          toast('Failed to clear products', 'err');
        }
      }
    );
  });

  $('dangerResetSettings')?.addEventListener('click', () => {
    showConfirm(
      'Reset All Settings',
      'This will restore all settings to defaults. Your saved products will NOT be deleted.',
      'Reset Settings',
      async () => {
        try {
          // Sync via background so badge respects new badgeEnabled flag
          await chrome.runtime.sendMessage({
            action: 'UPDATE_SETTINGS',
            settings: {
              ...DEFAULT_SETTINGS
            }
          });
          currentSettings = { ...DEFAULT_SETTINGS };

          // Reload UI

          ['autoCategory', 'duplicateCheck', 'badgeEnabled'].forEach(key => {
            const track = document.querySelector(`#toggle-${key}`);
            if (track) {
              track.classList.toggle('on', !!DEFAULT_SETTINGS[key]);
              track.setAttribute('aria-checked', DEFAULT_SETTINGS[key] ? 'true' : 'false');
            }
          });

          toast('Settings reset to defaults', 'ok');
        } catch (_) {
          toast('Failed to reset settings', 'err');
        }
      }
    );
  });

  $('dangerWipeAll')?.addEventListener('click', () => {
    showConfirm(
      '⚠️ Wipe ALL Data',
      'This will permanently delete ALL products, folders, tags, settings, AND bulk hunt master sheet. This absolutely cannot be undone.',
      'Wipe Everything',
      async () => {
        try {
          // Remove all extension storage keys
          await chrome.storage.local.remove([
            STORAGE_KEY,
            'zhunterMasterSheet', 'zhunterMasterBatches',
            'zhunterBulkQueue', 'zhunterHuntState', 'zhunterPendingImageHunt', 'zhunter_fx', 'zakUIState'
          ]);
          currentSettings = { ...DEFAULT_SETTINGS };

          // Tell background.js to refresh its state + clear badge
          try {
            await chrome.runtime.sendMessage({ action: 'CLEAR_ALL' });
          } catch (_) {}
          // Explicit badge clear (in case CLEAR_ALL fails — e.g., if STORAGE_KEY was just removed)
          try {
            await chrome.action.setBadgeText({ text: '' });
          } catch (_) {}

          await loadStats();


          ['autoCategory', 'duplicateCheck', 'badgeEnabled'].forEach(key => {
            const track = document.querySelector(`#toggle-${key}`);
            if (track) {
              track.classList.toggle('on', !!DEFAULT_SETTINGS[key]);
              track.setAttribute('aria-checked', DEFAULT_SETTINGS[key] ? 'true' : 'false');
            }
          });

          toast('All data wiped', 'info');
        } catch (_) {
          toast('Failed to wipe data', 'err');
        }
      }
    );
  });
}

// ── Init ──────────────────────────────────────────────────────
async function init() {
  try {
    const data = await getData();
    currentSettings = {
      ...DEFAULT_SETTINGS,
      ...(data?.settings || {}),
      productSheetColumns: {
        ...DEFAULT_SETTINGS.productSheetColumns,
        ...(data?.settings?.productSheetColumns || {})
      },
      customProductColumns: Array.isArray(data?.settings?.customProductColumns)
        ? data.settings.customProductColumns
        : [],
      bulkSheetColumns: { ...(data?.settings?.bulkSheetColumns || {}) },
      customBulkColumns: Array.isArray(data?.settings?.customBulkColumns) ? data.settings.customBulkColumns : []
    };
  } catch (_) {
    currentSettings = { ...DEFAULT_SETTINGS };
  }

  await initTheme();

  initToggle('toggle-autoCategory',   'autoCategory');
  initToggle('toggle-duplicateCheck', 'duplicateCheck');
  initToggle('toggle-badgeEnabled',   'badgeEnabled');

  initBulkSettings();
  initExport();
  initDangerZone();
  initConfirmModal();

  await loadStats();

  $('refreshStatsBtn')?.addEventListener('click', async () => {
    await loadStats();
    toast('Stats refreshed', 'info');
  });
}

document.addEventListener('DOMContentLoaded', () => { applyDynamicVersion(); init(); });
// ── Bulk Hunt Settings ───────────────────────────────────────
function initBulkSettings() {
  const input    = $('bulkPrefixInput');
  const saveBtn  = $('saveBulkPrefixBtn');
  const status   = $('bulkPrefixStatus');
  const preview  = $('filenamePreview');
  if (!input) return;

  const refreshPreview = () => {
    const prefix = (input.value || 'zhunter_').trim();
    const d = new Date();
    const ymd = d.toISOString().slice(0, 10);
    const hm = `${String(d.getHours()).padStart(2,'0')}${String(d.getMinutes()).padStart(2,'0')}`;
    preview.textContent = `${prefix}${ymd}_${hm}.xlsx`;
  };

  input.value = currentSettings.bulkFilenamePrefix || 'zhunter_';
  refreshPreview();
  input.addEventListener('input', refreshPreview);

  saveBtn?.addEventListener('click', async () => {
    let prefix = (input.value || '').trim();
    if (!prefix) prefix = 'zhunter_';
    prefix = prefix.replace(/[^a-zA-Z0-9_\-]/g, '');
    if (!prefix.endsWith('_')) prefix += '_';
    input.value = prefix;

    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';
    const ok = await saveSettings({ bulkFilenamePrefix: prefix });
    currentSettings.bulkFilenamePrefix = prefix;

    if (status) {
      status.classList.remove('hidden', 'error');
      status.textContent = ok ? '✓ Filename prefix saved' : '✗ Save failed';
      if (!ok) status.classList.add('error');
      setTimeout(() => status.classList.add('hidden'), 2500);
    }
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save';
    refreshPreview();
  });

  // ── Column toggles grid ──
  // v8.4.0: same list + same defaults as sidepanel.js (Temu-ready)
  const DEFAULT_ON = new Set(['no', 'title', 'url', 'platform', 'brand', 'color', 'price',
    'weight', 'dimL', 'dimW', 'dimH', 'img1','img2','img3','img4','img5','img6','img7','img8','img9','img10']);

  const ALL_BULK_COLS_OPT = [
    { key: 'no',          label: '#'              },
    { key: 'title',       label: 'Title'          },
    { key: 'url',         label: 'Sourcing link'  },
    { key: 'platform',    label: 'Platform'       },
    { key: 'brand',       label: 'Brand'          },
    { key: 'color',       label: 'Color'          },
    { key: 'price',       label: 'Price'          },
    { key: 'labelCost',   label: 'Label Cost'     },
    { key: 'listPrice',   label: 'List Price'     },
    { key: 'profit',      label: 'Profit'         },
    { key: 'weight',      label: 'Weight'         },
    { key: 'dimL',        label: 'Length'         },
    { key: 'dimW',        label: 'Width'          },
    { key: 'dimH',        label: 'Height'         },
    { key: 'variants',    label: 'Variants'       },
    { key: 'imageCount',  label: 'Image Count'    },
    { key: 'videoCount',  label: 'Video Count'    },
    { key: 'videoUrl',    label: 'Video URL'      },
    { key: 'img1',  label: 'Image 1'  }, { key: 'img2',  label: 'Image 2'  }, { key: 'img3',  label: 'Image 3'  },
    { key: 'img4',  label: 'Image 4'  }, { key: 'img5',  label: 'Image 5'  }, { key: 'img6',  label: 'Image 6'  },
    { key: 'img7',  label: 'Image 7'  }, { key: 'img8',  label: 'Image 8'  }, { key: 'img9',  label: 'Image 9'  },
    { key: 'img10', label: 'Image 10' },
    { key: 'description', label: 'Description'    },
    { key: 'bullets',     label: 'Bullet Points'  },
    { key: 'tags',        label: 'Tags'           },
    { key: 'status',      label: 'Status'         },
    { key: 'scrapedAt',   label: 'Date Added'     }
  ];

  const grid = $('optBulkColumnsGrid');
  const colStatus = $('optBulkColumnsStatus');

  const renderColGrid = () => {
    if (!grid) return;
    const prefs = currentSettings.bulkSheetColumns || {};
    const customCols = currentSettings.customBulkColumns || [];
    
    grid.innerHTML = '';
    
    // Merge standard columns with custom columns
    const allCols = [...ALL_BULK_COLS_OPT, ...customCols];
    
    const hasSavedPrefs = Object.keys(prefs).length > 0;
    allCols.forEach(col => {
      const isCustom = customCols.some(c => c.key === col.key);
      // Default ON: title, url, price — everything else OFF by default
      const checked = prefs[col.key] === true || (prefs[col.key] !== false && DEFAULT_ON.has(col.key));
      const item = document.createElement('label');
      item.className = 'opt-col-item' + (checked ? ' on' : '') + (isCustom ? ' custom-col' : '');
      
      let innerHTML = `
        <span class="opt-col-checkbox"></span>
        <span class="opt-col-label">${escHtml(col.label)}</span>`;
      
      if (isCustom) {
        innerHTML += `<span class="opt-col-del" title="Delete custom column" data-key="${col.key}">✕</span>`;
      }
      
      item.innerHTML = innerHTML;
      
      // Handle click on delete button
      if (isCustom) {
        const delBtn = item.querySelector('.opt-col-del');
        delBtn.addEventListener('click', async (e) => {
          e.preventDefault();
          e.stopPropagation();
          const newCustomCols = customCols.filter(c => c.key !== col.key);
          const ok = await saveSettings({ customBulkColumns: newCustomCols });
          if (ok) {
            currentSettings.customBulkColumns = newCustomCols;
            renderColGrid();
            toast(`Column "${col.label}" deleted`, 'ok');
          }
        });
      }
      
      // Handle click on the checkbox/label
      item.addEventListener('click', async (e) => {
        if (e.target.classList.contains('opt-col-del')) return;
        e.preventDefault();
        if (col.required) return;
        const newPrefs = { ...prefs };
        newPrefs[col.key] = !checked;  // toggle based on current state
        const ok = await saveSettings({ bulkSheetColumns: newPrefs });
        if (ok) {
          currentSettings.bulkSheetColumns = newPrefs;
          renderColGrid();
          if (colStatus) {
            colStatus.classList.remove('hidden', 'error');
            colStatus.textContent = '✓ Saved';
            setTimeout(() => colStatus.classList.add('hidden'), 1200);
          }
        }
      });
      grid.appendChild(item);
    });
  };
  renderColGrid();
  
  // Logic for adding a new custom column
  const customColInput = $('customColInput');
  const addCustomColBtn = $('addCustomColBtn');
  
  if (customColInput && addCustomColBtn) {
    addCustomColBtn.addEventListener('click', async () => {
      const label = customColInput.value.trim();
      if (!label) {
        toast('Column name cannot be empty', 'warn');
        return;
      }
      
      const customCols = currentSettings.customBulkColumns || [];
      const keyStr = 'custom_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
      
      // Check for duplicates
      if (customCols.some(c => c.label.toLowerCase() === label.toLowerCase()) || 
          ALL_BULK_COLS_OPT.some(c => c.label.toLowerCase() === label.toLowerCase())) {
        toast('A column with this name already exists', 'warn');
        return;
      }
      
      const newCustomCols = [...customCols, { key: keyStr, label: label }];
      const prefs = { ...(currentSettings.bulkSheetColumns || {}) };
      prefs[keyStr] = true; // enable by default
      
      addCustomColBtn.disabled = true;
      const ok = await saveSettings({ customBulkColumns: newCustomCols, bulkSheetColumns: prefs });
      
      if (ok) {
        currentSettings.customBulkColumns = newCustomCols;
        currentSettings.bulkSheetColumns = prefs;
        customColInput.value = '';
        renderColGrid();
        toast(`Column "${label}" added!`, 'ok');
      } else {
        toast('Failed to save column', 'err');
      }
      addCustomColBtn.disabled = false;
    });
    
    // Add on enter key
    customColInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addCustomColBtn.click();
      }
    });
  }

  // ── Reset columns to defaults (Temu-ready set) ──
  const resetColsBtn = $('resetColsBtn');
  if (resetColsBtn) {
    resetColsBtn.addEventListener('click', async () => {
      // Clear saved prefs → getEnabledColumns() will fall back to DEFAULT_ON_COLS
      const ok = await saveSettings({ bulkSheetColumns: {} });
      if (ok) {
        currentSettings.bulkSheetColumns = {};
        renderColGrid();
        if (colStatus) {
          colStatus.classList.remove('hidden', 'error');
          colStatus.textContent = '✓ Reset to defaults (Temu-ready columns)';
          setTimeout(() => colStatus.classList.add('hidden'), 2500);
        }
      }
    });
  }

  // ── autoSkipDuplicates toggle ──
  initToggle('toggle-autoSkipDuplicates', 'autoSkipDuplicates');
  initToggle('toggle-bulkAutoCloseTabs', 'bulkAutoCloseTabs');

  // ── imageMax5MB toggle ──
  initToggle('toggle-imageMax5MB', 'imageMax5MB');

  // ── Image Format select ──
  const imgFmtSel = $('imageFormatSelect');
  if (imgFmtSel) {
    imgFmtSel.value = currentSettings.imageFormat || 'jpg';
    imgFmtSel.addEventListener('change', async () => {
      const fmt = imgFmtSel.value;
      const ok = await saveSettings({ imageFormat: fmt });
      currentSettings.imageFormat = fmt;
      if (ok) {
        toast(`Image format set to ${fmt.toUpperCase()}`, 'ok');
      } else {
        toast('Failed to save image format', 'err');
      }
    });
  }

  const imgRatioSel = $('imageRatioSelect');
  if (imgRatioSel) {
    imgRatioSel.value = currentSettings.imageRatio || 'original';
    imgRatioSel.addEventListener('change', async () => {
      currentSettings.imageRatio = imgRatioSel.value;
      await saveSettings({ imageRatio: currentSettings.imageRatio });
      toast('Image ratio updated', 'ok');
    });
  }

  const imgBgSel = $('imageBgSelect');
  if (imgBgSel) {
    imgBgSel.value = currentSettings.imageBg || 'original';
    imgBgSel.addEventListener('change', async () => {
      currentSettings.imageBg = imgBgSel.value;
      await saveSettings({ imageBg: currentSettings.imageBg });
      toast('Image background updated', 'ok');
    });
  }

  const imgMinSizeInp = $('imageMinSizeInput');
  if (imgMinSizeInp) {
    imgMinSizeInp.value = currentSettings.imageMinSize !== undefined ? currentSettings.imageMinSize : 0;
    imgMinSizeInp.addEventListener('change', async () => {
      let val = parseInt(imgMinSizeInp.value, 10);
      if (isNaN(val) || val < 0) val = 0;
      currentSettings.imageMinSize = val;
      await saveSettings({ imageMinSize: val });
      toast('Minimum dimension saved', 'ok');
    });
  }
}
