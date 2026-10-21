// ============================================================
// ZHunter PRO v9.7.5 - Background Service Worker
// Handles storage operations, messaging, content script orchestration, and AI generation
// ============================================================
'use strict';
importScripts('sourcing_sync.js', 'audit_storage.js', 'product_url_gate.js');
try { importScripts('sourcing_default.js'); } catch (_) {}   // optional built-in sheet connection


// Har download "ZHunter Export/YYYY-MM-DD/" folder mein (Downloads ke andar). Setting: zhExportFolder (default on).
let _zhExportFolder = true;
try { chrome.storage.local.get('zhExportFolder', x => { _zhExportFolder = x?.zhExportFolder !== false; }); } catch (_) {}
try { chrome.storage.onChanged.addListener((ch, area) => { if (area === 'local' && ch.zhExportFolder) _zhExportFolder = ch.zhExportFolder.newValue !== false; }); } catch (_) {}
// v9.15 — blob downloads reach this listener with a random UUID name, which used to REPLACE the real file name (batch name lost). Callers register the wanted name first.
const _zhDlNames = new Map();
try { chrome.runtime.onMessage.addListener((m, s, send) => { if (m && m.action === 'ZH_DL_NAME' && m.url && m.filename) { _zhDlNames.set(m.url, String(m.filename)); setTimeout(() => _zhDlNames.delete(m.url), 120000); send({ ok: true }); } }); } catch (_) {}
try {
  chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
    try {
      const want = _zhDlNames.get(item.url);
      const mine = !!want || item.byExtensionId === chrome.runtime.id || String(item.url || '').includes('chrome-extension://' + chrome.runtime.id) || String(item.referrer || '').startsWith('chrome-extension://' + chrome.runtime.id);
      if (!mine) return;
      const rel = String(want || item.filename || 'file').replace(/\\/g, '/').replace(/^\/+/, '');
      if (!_zhExportFolder) { if (want) suggest({ filename: rel, conflictAction: 'uniquify' }); return; }
      if (/^ZHunter Export\//i.test(rel)) { if (want) suggest({ filename: rel, conflictAction: 'uniquify' }); return; }
      const d = new Date(), pad = n => String(n).padStart(2, '0');
      const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      suggest({ filename: `ZHunter Export/${day}/${rel}`, conflictAction: 'uniquify' });
    } catch (_) {}
  });
} catch (_) {}

// ── Local-only storage — cloud sync removed in v7.11.1
// This avoids loading 500KB+ SDK files that block service worker startup
// and cause bulk hunting failures. Pure fetch() works perfectly in MV3.

const STORAGE_KEY   = 'zakLinkCollectorData';
const BADGE_COLOR   = '#06b6d4';
const SUCCESS_COLOR = '#10b981';

// Bulk Queue storage key — persistent queue of product URLs to hunt sequentially
const BULK_QUEUE_KEY = 'zhunterBulkQueue';

// Platform hostname patterns for auto-capture (mirrors PLATFORM_PATTERNS in popup.js)
const BG_PLATFORM_KEYS = [
  'walmart.com', 'amazon.', 'samsclub.com', 'faire.com', 'aliexpress.',
  'alibaba.com', 'temu.', 'ebay.', 'etsy.com', 'shein.com', 'daraz.',
  'worldwidegolfballs.com', 'worldwidegolfshops.com', 'flipkart.com',
  'noon.com', 'lazada.', 'myshopify.com', 'target.com', 'costco.com',
  'bestbuy.com', 'homedepot.com', 'bjs.com'
];
function bgDetectPlatform(url) {
  if (!url) return null;
  try {
    const h = new URL(url).hostname.toLowerCase();
    return BG_PLATFORM_KEYS.find(k => h.includes(k)) || null;
  } catch { return null; }
}

const IMG_CAP = 15;
const VID_CAP = 12;

// Secrets are kept in local storage for the worker only. They are never returned
// (no secret settings since v7.12 — AI removed)
const SECRET_SETTING_KEYS = new Set([]); // no secrets since v7.12 (AI removed)
const PUBLIC_SETTING_KEYS = new Set([
  'showTabHunt', 'showTabBulk', 'showTabLibrary', 'showTabSettings', 'maxHuntImages',
  'autoCategory', 'duplicateCheck', 'badgeEnabled', 'saveToCurrentFolder',
  'lastFolder', 'bulkFilenamePrefix', 'autoSkipDuplicates', 'bulkAutoCloseTabs', 'bulkTabGroup',
  'bulkSkipImageDownload', 'zhExportFolder', 'bulkParallelTabs', 'queueParallelTabs', 'bulkAutoRetry',
  'imageFormat', 'imageRatio', 'imageBg', 'imageMinSize', 'imageMax5MB',
  'bulkQueueAutoCapture', 'bulkSheetColumns', 'customBulkColumns',
  'temuConfig', 'temuTemplateB64', 'temuTemplateName',
  'temuStores', 'temuActiveStore',
  'temuListed',
  'productSheetColumns', 'customProductColumns', 'migratedToOriginal_2'
]);

const FETCH_CONCURRENCY = 8;   // was 16 — moderate concurrency to prevent network congestion
const FETCH_TIMEOUT_MS  = 12000; // was 5000 — safer timeout to prevent image download failures
const FETCH_MAX_BYTES   = 6 * 1024 * 1024;
const AI_TIMEOUT_MS     = 28000;

// ── Write Mutex ──────────────────────────────────────────────
// Serialises all storage-mutating operations to prevent read-modify-write
// race conditions when multiple messages arrive concurrently.
let _writeLock = Promise.resolve();
function withWriteLock(fn) {
  const result = _writeLock.then(fn);
  _writeLock = result.catch(() => {});
  return result;
}

// ── Service Worker Keepalive ─────────────────────────────────
// MV3 service workers are terminated after ~30 s of inactivity.
// Call startKeepAlive() before long bulk operations, stopKeepAlive() after.
// v9.15.1 — every task has its OWN keepalive (owner + time limit). Before, one shared timer was used: the side panel
// closing (port disconnect) also stopped a running upload's keepalive, and the 15-min cap cut long upload watches.
let _keepAliveInterval = null;
const _keepAliveOwners = new Map();   // owner → expires at (ms)
function _keepAliveTick() {
  const now = Date.now();
  for (const [k, until] of _keepAliveOwners) if (until <= now) _keepAliveOwners.delete(k);
  if (!_keepAliveOwners.size) { clearInterval(_keepAliveInterval); _keepAliveInterval = null; return; }
  chrome.runtime.getPlatformInfo(() => {}); // no-op — just prevents SW termination
}
function startKeepAlive(owner = 'default', maxMs = 15 * 60 * 1000) {
  _keepAliveOwners.set(owner, Date.now() + maxMs);
  if (!_keepAliveInterval) _keepAliveInterval = setInterval(_keepAliveTick, 20000);
}
function stopKeepAlive(owner = 'default') {
  _keepAliveOwners.delete(owner);
  if (!_keepAliveOwners.size && _keepAliveInterval) { clearInterval(_keepAliveInterval); _keepAliveInterval = null; }
}

// ── Persistent Port Keepalive ─────────────────────────────────
let _keepAlivePortSeq = 0;
try {
  chrome.runtime.onConnect.addListener(port => {
    if (port.name === 'zhunter-keepalive') {
      const owner = 'port:' + (++_keepAlivePortSeq);
      startKeepAlive(owner);
      port.onDisconnect.addListener(() => {
        stopKeepAlive(owner);
      });
    }
  });
} catch (_) {}

// ── Rate Limiter ─────────────────────────────────────────────
// Prevents a malicious page from flooding the extension with messages.
const _rateLimitMap = new Map();
const RATE_LIMIT_MAX       = 30;    // max requests per window per sender
const RATE_LIMIT_WINDOW_MS = 10000; // 10-second rolling window
function isRateLimited(sender) {
  // Internal extension contexts (sidepanel, options) have sender.id === chrome.runtime.id and no sender.tab
  if (!sender?.tab?.id && sender?.id === chrome.runtime.id) return false;
  const key  = sender?.tab?.id ?? 'unknown';
  const now  = Date.now();
  let   entry = _rateLimitMap.get(key);
  if (!entry || now > entry.resetAt) entry = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
  entry.count++;
  _rateLimitMap.set(key, entry);
  return entry.count > RATE_LIMIT_MAX;
}

// ── IndexedDB Helper ─────────────────────────────────────────
function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('ZHunterMedia', 1);
    request.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('images')) {
        db.createObjectStore('images', { keyPath: 'id' });
      }
    };
    request.onsuccess = e => resolve(e.target.result);
    request.onerror = e => reject(e.target.error);
  });
}

async function saveImagesToIndexedDB(id, imagesBase64) {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('images', 'readwrite');
      tx.objectStore('images').put({ id, images: imagesBase64 });
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  } catch (_) { return false; }
}

async function getImagesFromIndexedDB(id) {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction('images', 'readonly');
      const req = tx.objectStore('images').get(id);
      req.onsuccess = () => resolve(req.result ? req.result.images : []);
      req.onerror = () => resolve([]);
    });
  } catch (_) { return []; }
}

async function deleteImagesFromIndexedDB(id) {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction('images', 'readwrite');
      tx.objectStore('images').delete(id);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  } catch (_) { return false; }
}

async function clearIndexedDBImages() {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction('images', 'readwrite');
      tx.objectStore('images').clear();
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  } catch (_) { return false; }
}

const DEFAULT_DATA = {
  links:   [],
  folders: ['General', 'Favorites', 'Read Later'],
  tags:    ['Important', 'Unread', 'To Buy', 'Reference', 'Watch Later'],
  history: [],
  settings: {
    autoCategory:        true,
    duplicateCheck:      true,
    badgeEnabled:        true,
    saveToCurrentFolder: false,
    lastFolder:          'General',
    bulkFilenamePrefix:  'zhunter_',
    autoSkipDuplicates:  true,
    bulkAutoCloseTabs:   true,
    bulkSkipImageDownload: false,
    zhExportFolder:      true,
    bulkTabGroup:        true,        // v9.5.0: product tabs → one 'ZHunter' tab group
    imageFormat:         'jpg',        // 'original' | 'jpg' | 'png'
    imageRatio:          'original',
    imageBg:             'white',
    imageMinSize:        0,
    imageMax5MB:         true,
    // v8.4.0: "Temu-ready" default — matches DEFAULT_ON_COLS in sidepanel.js
    bulkSheetColumns: {
      no: true,           title: true,        url: true,
      platform: true,     brand: true,        color: true,
      price: true,        labelCost: false,   listPrice: false,
      profit: false,      description: false, bullets: false,
      tags: false,        variants: false,    imageCount: false,
      videoCount: false,  scrapedAt: false,   status: false,
      img1: true,  img2: true,  img3: true,  img4: true,  img5: true,
      img6: true,  img7: true,  img8: true,  img9: true,  img10: true,
      videoUrl: false,
      weight: true, dimL: true, dimW: true, dimH: true
    },
    customBulkColumns: [],
    // Product Queue Sheet: the original four columns stay enabled by default;
    // optional research fields are opt-in from Settings.
    productSheetColumns: {
      folderNumber: true, title: true, link: true, sourcingPrice: true,
      platform: false, description: false, imageCount: false, videoCount: false,
      imageLinks: false, videoLinks: false, variants: false, status: false,
      source: false, createdAt: false
    },
    customProductColumns: []
  }
};

function getPublicSettings(settings = {}) {
  const publicSettings = {};
  for (const key of PUBLIC_SETTING_KEYS) {
    if (Object.prototype.hasOwnProperty.call(settings, key)) publicSettings[key] = settings[key];
  }
  return publicSettings;
}

function sanitizeSettingsPatch(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return {};
  const clean = {};
  for (const [key, value] of Object.entries(patch)) {
    if (!PUBLIC_SETTING_KEYS.has(key) && !SECRET_SETTING_KEYS.has(key)) continue;
    if (SECRET_SETTING_KEYS.has(key)) {
      if (typeof value === 'string' && value.length <= 500) clean[key] = value.trim();
      continue;
    }
    if (key.startsWith('showTab')) { if (typeof value === 'boolean') clean[key] = value; continue; }
    if (key === 'maxHuntImages') { const n = Number(value); if (Number.isInteger(n) && n >= 1 && n <= 15) clean[key] = n; continue; }
    if (key === 'temuTemplateB64') { if (typeof value === 'string' && value.length <= 3000000) clean[key] = value; continue; }
    if (key === 'temuStores') { if (value && typeof value === 'object' && !Array.isArray(value) && JSON.stringify(value).length <= 20000000) clean[key] = value; continue; }
    if (typeof value === 'string') clean[key] = value.slice(0, 5000);
    else if (typeof value === 'boolean' || typeof value === 'number') clean[key] = value;
    else if (Array.isArray(value)) clean[key] = value.slice(0, 200);
    else if (value && typeof value === 'object') clean[key] = { ...value };
  }
  return clean;
}

// ── Storage helpers ──────────────────────────────────────────
async function getData() {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    const stored = result[STORAGE_KEY];
    if (!stored) return JSON.parse(JSON.stringify(DEFAULT_DATA));
    const settings = {
      ...DEFAULT_DATA.settings,
      ...(stored.settings || {}),
      productSheetColumns: {
        ...DEFAULT_DATA.settings.productSheetColumns,
        ...(stored.settings?.productSheetColumns || {})
      },
      customProductColumns: Array.isArray(stored.settings?.customProductColumns)
        ? stored.settings.customProductColumns
        : [...DEFAULT_DATA.settings.customProductColumns]
    };
    
    // Auto-migrate old defaults to the new "Original" values
    if (!settings.migratedToOriginal_2) {
      settings.imageFormat = 'jpg';
      settings.imageRatio = 'original';
      settings.imageBg = 'original';
      settings.imageMinSize = 0;
      settings.migratedToOriginal_2 = true;
      await chrome.storage.local.set({ [STORAGE_KEY]: { ...stored, settings } });
    }

    return {
      links:    Array.isArray(stored.links)   ? stored.links   : [],
      folders:  Array.isArray(stored.folders) ? stored.folders : DEFAULT_DATA.folders,
      tags:     Array.isArray(stored.tags)    ? stored.tags    : DEFAULT_DATA.tags,
      history:  Array.isArray(stored.history) ? stored.history : [],
      settings
    };
  } catch (e) {
    throw new Error('Stored data unavailable: ' + e.message);
  }
}

// v9.15.1 — image downloads only need the settings: keep them in memory instead of reading (and migrating) all stored data
// for every single image; dropped whenever the stored data changes.
let _zhSettingsCache = null;
async function zhSettingsCached() {
  if (!_zhSettingsCache) _zhSettingsCache = (await getData())?.settings || {};
  return _zhSettingsCache;
}
try { chrome.storage.onChanged.addListener((ch, area) => { if (area === 'local' && ch[STORAGE_KEY]) _zhSettingsCache = null; }); } catch (_) {}

async function saveData(data) {
  try {
    await chrome.storage.local.set({ [STORAGE_KEY]: data });
    await updateBadge(data.links.length, data.settings.badgeEnabled);
    return true;
  } catch (err) {
    console.warn('[ZHunter] Local storage write failed:', err?.message || 'storage_error');
    throw new Error('Local storage write failed: ' + err.message);
  }
}

// ── NO-TAB PRODUCT QUEUE ──────────────────────────────────────
let _queueProcessPromise = null;

function normalizeQueueUrl(raw) {
  try {
    const u = new URL(String(raw || '').trim());
    u.hash = '';
    u.hostname = u.hostname.toLowerCase();
    if (/(^|\.)temu\.com$/i.test(u.hostname) && typeof ZhGate !== 'undefined') return ZhGate.cleanUrl(u.href);
    if ((u.protocol === 'https:' && u.port === '443') || (u.protocol === 'http:' && u.port === '80')) u.port = '';
    for (const key of [...u.searchParams.keys()]) {
      if (/^(utm_|gclid$|fbclid$|msclkid$|ref$)/i.test(key)) u.searchParams.delete(key);
    }
    // v9.15 - on these sites the path alone identifies the product; tracking/variant params only create duplicates in the queue
    if (/(^|\.)(walmart\.com|amazon\.[a-z.]+|ebay\.[a-z.]+|etsy\.com|aliexpress\.[a-z]+|samsclub\.com)$/i.test(u.hostname)) u.search = '';
    u.searchParams.sort();
    return u.href;
  } catch (_) { return ''; }
}

function normalizeFolderNumber(value) {
  const n = String(value ?? '').trim().replace(/[^0-9A-Za-z_-]/g, '').slice(0, 20);
  return n || '1';
}

async function mutateLink(id, mutator) {
  const data = await getData();
  const idx = data.links.findIndex(l => l.id === id);
  if (idx === -1) return null;
  const updated = mutator({ ...data.links[idx] }) || data.links[idx];
  updated.dateModified = new Date().toISOString();
  data.links[idx] = updated;
  await saveData(data);
  return updated;
}

// ── Badge ────────────────────────────────────────────────────
async function updateBadge() {
  try {
    await chrome.action.setBadgeText({ text: '' });
  } catch (_) {}
}

async function flashBadgeSuccess() {
  try {
    await chrome.action.setBadgeText({ text: '✓' });
    await chrome.action.setBadgeBackgroundColor({ color: SUCCESS_COLOR });
    // FIX: setTimeout is unreliable in MV3 service workers — use chrome.alarms instead
    await chrome.alarms.create('badgeFlashReset', { delayInMinutes: 1 / 40 }); // ~1.5 s
  } catch (_) {}
}

// ── Utilities ────────────────────────────────────────────────
function detectCategory(url) {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    const map = {
      amazon: 'Amazon', youtube: 'YouTube', youtu: 'YouTube',
      github: 'GitHub', twitter: 'Twitter/X', x: 'Twitter/X',
      reddit: 'Reddit', linkedin: 'LinkedIn', instagram: 'Instagram',
      facebook: 'Facebook', wikipedia: 'Wikipedia',
      stackoverflow: 'Stack Overflow', medium: 'Medium', netflix: 'Netflix',
      google: 'Google', twitch: 'Twitch', tiktok: 'TikTok',
      pinterest: 'Pinterest', ebay: 'eBay', etsy: 'Etsy',
      apple: 'Apple', microsoft: 'Microsoft', figma: 'Figma',
      notion: 'Notion', temu: 'Temu', aliexpress: 'AliExpress',
      walmart: 'Walmart', shopify: 'Shopify', shein: 'Shein',
      daraz: 'Daraz', faire: 'Faire', samsclub: "Sam's Club", bjs: "BJ's",
      alibaba: 'Alibaba', worldwidegolfballs: 'WW Golf Balls',
      worldwidegolfshops: 'WW Golf Shops', worldgolfshop: 'World Golf Shop',
      golf: 'Golf.com', rockbottomgolf: 'Rock Bottom Golf'
    };
    const parts = host.split('.');
    for (const part of parts) if (map[part]) return map[part];
    return parts[0] ? parts[0].charAt(0).toUpperCase() + parts[0].slice(1) : 'Other';
  } catch (_) { return 'Other'; }
}

function getFavicon(url) {
  try { return `https://www.google.com/s2/favicons?domain=${new URL(url).hostname}&sz=64`; }
  catch (_) { return ''; }
}

function generateId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function isValidURL(str) {
  try { const { protocol } = new URL(str); return protocol === 'http:' || protocol === 'https:'; }
  catch (_) { return false; }
}

// Product-only workflow allowlist. General link saving remains available through
// the normal ADD_LINK path, but queue/context-menu product actions use this list
// so search engines and unrelated sites are never added to the hunt queue.
const PRODUCT_HOST_PATTERNS = [
  'amazon.com', 'amazon.co.uk', 'amazon.ca', 'amazon.de', 'amazon.fr', 'amazon.it',
  'amazon.es', 'amazon.co.jp', 'amazon.in', 'amazon.com.au', 'amazon.com.mx',
  'amazon.nl', 'amazon.pl', 'amazon.se', 'amazon.sg', 'amazon.ae', 'amazon.sa',
  'amazon.tr', 'amazon.eg', 'amazon.be', 'walmart.com', 'samsclub.com', 'bjs.com',
  'faire.com', 'alibaba.com', 'aliexpress.com', 'aliexpress.ru', 'temu.com',
  'ebay.com', 'ebay.co.uk', 'ebay.de', 'ebay.ca', 'ebay.com.au', 'ebay.fr',
  'ebay.it', 'ebay.es', 'etsy.com', 'daraz.pk', 'daraz.com.bd', 'daraz.lk',
  'daraz.com.np', 'daraz.ph', 'daraz.my', 'flipkart.com', 'noon.com', 'shein.com',
  'target.com', 'costco.com', 'homedepot.com', 'bestbuy.com',
  'worldwidegolfballs.com', 'worldwidegolfshops.com', 'worldgolfshop.com',
  'golf.com', 'rockbottomgolf.com'
];

function isSupportedProductUrl(str) {
  try {
    const u = new URL(str);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    const h = u.hostname.toLowerCase().replace(/^www\./, '');
    if (!PRODUCT_HOST_PATTERNS.some(pattern => h === pattern || h.endsWith('.' + pattern))) return false;
    // v9.14 — only real product pages (not home / store / mall / search / category / cart pages)
    return ZhGate.isProductUrl(str);
  } catch (_) { return false; }
}

function sanitizeBulkQueueItem(item) {
  if (!item || typeof item !== 'object') return null;
  const url = normalizeQueueUrl(item.url);
  if (!url || !isSupportedProductUrl(url)) return null;
  const status = ['queued', 'complete', 'needs_retry', 'error', 'fail', 'partial'].includes(item.status) ? item.status : (item.hunted ? 'complete' : 'queued');
  return {
    id: typeof item.id === 'string' && item.id.length <= 100 ? item.id : `q_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    url,
    title: sanitizeText(item.title || url).slice(0, 500),
    platform: sanitizeText(item.platform || bgDetectPlatform(url)).slice(0, 80),
    addedAt: Number.isFinite(item.addedAt) ? item.addedAt : Date.now(),
    checked: item.checked !== false,
    hunted: item.hunted === true,
    status,
    attempts: Number.isFinite(item.attempts) ? Math.max(0, Math.min(20, Math.floor(item.attempts))) : 0,
    error: sanitizeText(item.error || '').slice(0, 500)
  };
}

function sanitizeText(str) {
  return String(str || '').slice(0, 5000).replace(/<[^>]*>/g, '');
}

function broadcastMessage(payload) {
  chrome.runtime.sendMessage(payload).catch(() => {});
}

function broadcastToast(message, type) {
  chrome.runtime.sendMessage({ action: 'SHOW_TOAST', type, message }).catch(() => {});
}

// ── Image to Base64 ──────────────────────────────────────────
function fallbackImageUrl(imageUrl) {
  try {
    const u = new URL(imageUrl);
    let changed = false;
    ['odnHeight', 'odnWidth', 'odnBg', 'wid', 'hei', 'fmt'].forEach(p => {
      if (u.searchParams.has(p)) { u.searchParams.delete(p); changed = true; }
    });
    return changed ? u.href : null;
  } catch (_) { return null; }
}

async function fetchOnce(url, settings, fopts) {
  fopts = fopts || {};
  try {
    // Some CDNs (Amazon, etc.) block requests that don't look like browser image loads.
    // Adding Referer + Accept headers makes the fetch look like a normal <img> request.
    const headers = {
      'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Cache-Control': 'no-cache',
    };
    // Set Referer to the image's own origin so Amazon CDN allows the request
    try {
      const origin = new URL(url).origin;
      headers['Referer'] = origin + '/';
    } catch (_) {}
    // v9.14 — alternative strategies used when the first attempt fails
    if (fopts.noReferer) delete headers['Referer'];
    if (fopts.referer) headers['Referer'] = fopts.referer;

    const response = await fetch(url, {
      headers,
      credentials: 'omit',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
    });
    if (!response.ok) return { success: false, status: response.status };
    const cl = response.headers.get('content-length');
    if (cl && parseInt(cl) > FETCH_MAX_BYTES) return { success: false, reason: 'too_large' };
    let contentType = response.headers.get('content-type') || 'image/jpeg';
    if (!contentType.startsWith('image/')) return { success: false, reason: 'not_image' };
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > FETCH_MAX_BYTES) return { success: false, reason: 'too_large' };

    // Apply image formatting preferences
    const fmt = settings?.imageFormat || 'jpg';
    const ratio = settings?.imageRatio || 'original';
    const bg = settings?.imageBg || 'original';
    const minSize = typeof settings?.imageMinSize === 'number' ? settings.imageMinSize : 0;
    const max5MB = settings?.imageMax5MB !== false;
    
    let targetMime = contentType;
    if (fmt === 'png') targetMime = 'image/png';
    else if (fmt === 'jpg') targetMime = 'image/jpeg';
    else if (fmt === 'webp') targetMime = 'image/webp';
    
    const needsFormatChange = !contentType.startsWith(targetMime);
    
    const isOver5MB = max5MB && buffer.byteLength > 5 * 1024 * 1024;
    // NOTE: minSize is a DISPLAY FILTER (hide small images in the grid), NOT a resize
    // trigger. It must NOT be included here or it causes canvas re-encoding on every
    // 'original' download whenever the user has any minimum size filter set.
    const needsResizeOrPad = ratio !== 'original' || isOver5MB;

    // CRITICAL: When format is 'original', ALWAYS skip canvas processing entirely.
    // Canvas re-encodes the image (JPEG at 96% quality = quality loss).
    // 'original' must return the raw fetched bytes, byte-for-byte identical to
    // right-clicking and saving the image in the browser.
    if (fmt !== 'original' && (needsFormatChange || needsResizeOrPad)) {
      try {
        const blob = new Blob([buffer], { type: contentType });
        const bitmap = await createImageBitmap(blob);
        
        let targetW = bitmap.width;
        let targetH = bitmap.height;
        let sx = 0, sy = 0, sw = bitmap.width, sh = bitmap.height;
        
        if (ratio === '1:1' || ratio === 'square') {
          // Smart Auto-Trim: Detect and crop out excessive empty white margins on outer borders
          try {
            const probeCanvas = new OffscreenCanvas(bitmap.width, bitmap.height);
            const probeCtx = probeCanvas.getContext('2d');
            probeCtx.drawImage(bitmap, 0, 0);
            const imgData = probeCtx.getImageData(0, 0, bitmap.width, bitmap.height);
            const d = imgData.data;
            const isWhite = (x, y) => {
              const idx = (y * bitmap.width + x) * 4;
              return d[idx] >= 248 && d[idx + 1] >= 248 && d[idx + 2] >= 248;
            };
            let left = 0, right = bitmap.width - 1, top = 0, bottom = bitmap.height - 1;
            const stepY = Math.max(1, Math.floor(bitmap.height / 80));
            const stepX = Math.max(1, Math.floor(bitmap.width / 80));
            while (left < right) {
              let colW = true;
              for (let y = 0; y < bitmap.height; y += stepY) { if (!isWhite(left, y)) { colW = false; break; } }
              if (!colW) break;
              left += 2;
            }
            while (right > left) {
              let colW = true;
              for (let y = 0; y < bitmap.height; y += stepY) { if (!isWhite(right, y)) { colW = false; break; } }
              if (!colW) break;
              right -= 2;
            }
            while (top < bottom) {
              let rowW = true;
              for (let x = left; x <= right; x += stepX) { if (!isWhite(x, top)) { rowW = false; break; } }
              if (!rowW) break;
              top += 2;
            }
            while (bottom > top) {
              let rowW = true;
              for (let x = left; x <= right; x += stepX) { if (!isWhite(x, bottom)) { rowW = false; break; } }
              if (!rowW) break;
              bottom -= 2;
            }
            if (right - left >= 60 && bottom - top >= 60) {
              const pad = Math.round(Math.max(right - left, bottom - top) * 0.02);
              sx = Math.max(0, left - pad);
              sy = Math.max(0, top - pad);
              sw = Math.min(bitmap.width - sx, (right - left) + pad * 2);
              sh = Math.min(bitmap.height - sy, (bottom - top) + pad * 2);
            }
          } catch (_) {}
          targetW = targetH = Math.max(sw, sh, 800);
        } else if (ratio === '3:4') {
          if (targetW / targetH > 3/4) targetH = Math.round(targetW * (4/3));
          else targetW = Math.round(targetH * (3/4));
        } else if (ratio === '4:3') {
          if (targetW / targetH > 4/3) targetH = Math.round(targetW * (3/4));
          else targetW = Math.round(targetH * (4/3));
        }
        
        let scale = 1;
        // For non-square ratios, scale image to fill canvas (avoid blank bars)
        if (ratio === '3:4' || ratio === '4:3') {
          scale = Math.min(targetW / sw, targetH / sh);
        }
        
        const canvas = new OffscreenCanvas(targetW, targetH);
        const ctx = canvas.getContext('2d');
        
        if (bg === 'white' || targetMime === 'image/jpeg' || ratio === '1:1' || ratio === 'square') {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, targetW, targetH);
        }
        
        const drawW = Math.round(sw * scale);
        const drawH = Math.round(sh * scale);
        const drawX = Math.round((targetW - drawW) / 2);
        const drawY = Math.round((targetH - drawH) / 2);
        
        ctx.drawImage(bitmap, sx, sy, sw, sh, drawX, drawY, drawW, drawH);
        
        let quality = (fmt === 'jpg' || fmt === 'webp') ? 0.96 : undefined;
        let convertedBlob = await canvas.convertToBlob({ type: targetMime, quality });
        
        // Enforce max 5MB limit by dropping quality or downscaling slightly
        if (max5MB && convertedBlob.size > 5 * 1024 * 1024 && fmt === 'jpg') {
          quality = 0.8;
          convertedBlob = await canvas.convertToBlob({ type: targetMime, quality });
          if (convertedBlob.size > 5 * 1024 * 1024) {
            quality = 0.6;
            convertedBlob = await canvas.convertToBlob({ type: targetMime, quality });
          }
        }

        const convertedBuffer = await convertedBlob.arrayBuffer();
          const bytes2 = new Uint8Array(convertedBuffer);
          let binary2 = '';
          const chunk2 = 8192;
          for (let i = 0; i < bytes2.length; i += chunk2)
            binary2 += String.fromCharCode(...bytes2.subarray(i, i + chunk2));
          return { success: true, base64: `data:${targetMime};base64,${btoa(binary2)}`, byteLength: convertedBlob.size, width: targetW, height: targetH };
        } catch (_) {
          // Fall through to original if conversion fails
        }
    }

    let origW = 0, origH = 0;
    try {
      const bmp = await createImageBitmap(new Blob([buffer], { type: contentType }));
      origW = bmp.width;
      origH = bmp.height;
    } catch (_) {}

    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunk = 8192;
    for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    return { success: true, base64: `data:${contentType};base64,${btoa(binary)}`, byteLength: buffer.byteLength, width: origW, height: origH };
  } catch (_) { return { success: false }; }
}

async function fetchImageAsBase64(imageUrl, settings) {
  if (!imageUrl || typeof imageUrl !== 'string') return { success: false };
  if (!/^https?:\/\//i.test(imageUrl)) return { success: false };

  const primary = await fetchOnce(imageUrl, settings);
  if (primary.success) return primary;

  const fallback = fallbackImageUrl(imageUrl);
  if (fallback && fallback !== imageUrl) {
    const retry = await fetchOnce(fallback, settings);
    if (retry.success) return retry;
  }
  // v9.14 — more strategies before giving up: no Referer, the store's own page as Referer, query-less URL
  const alts = [{ noReferer: true }];
  if (/kwcdn\.com|temu/i.test(imageUrl)) alts.push({ referer: 'https://www.temu.com/' });
  for (const o of alts) {
    const r2 = await fetchOnce(imageUrl, settings, o);
    if (r2.success) return r2;
  }
  try {
    const u = new URL(imageUrl);
    if (u.search) {
      const bare = u.origin + u.pathname;
      const r3 = await fetchOnce(bare, settings, { noReferer: true });
      if (r3.success) return r3;
    }
  } catch (_) {}
  return primary;
}

// 20 Oct 2026 — Gemini's finished picture lives on lh3.googleusercontent.com: the Gemini page cannot read it (CORS, tainted
// canvas → "image found but could not be read", then retries = slow). The worker fetches it with your Google cookies instead.
async function fetchGeminiImage(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' || !/(^|\.)googleusercontent\.com$/i.test(u.hostname)) return { success: false, error: 'not_gemini_image' };
    let res = await fetch(url, { credentials: 'include', signal: AbortSignal.timeout(45000) });
    if (!res.ok) res = await fetch(url, { credentials: 'omit', signal: AbortSignal.timeout(45000) });
    if (!res.ok) return { success: false, error: 'http_' + res.status };
    const blob = await res.blob();
    if (!blob.size || blob.size > 30 * 1024 * 1024) return { success: false, error: 'bad_size' };
    const buf = new Uint8Array(await blob.arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    return { success: true, dataUrl: `data:${blob.type || 'image/png'};base64,${btoa(bin)}` };
  } catch (e) { return { success: false, error: e?.message || String(e) }; }
}

// v9.9.0 — Google Flow generated images: signed CDN URLs (no cookies needed) that expire
// in about an hour, often 2K PNGs larger than FETCH_MAX_BYTES. Fetch up to 30 MB and
// re-encode to JPEG (max 2048px) so the public re-host and Temu get a small, stable file.
async function fetchFlowImageAsJpeg(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' || !/(^|\.)flow-content\.google$/i.test(u.hostname)) {
      return { success: false, error: 'not_flow_url' };
    }
    const res = await fetch(url, { credentials: 'omit', signal: AbortSignal.timeout(45000) });
    if (!res.ok) return { success: false, error: 'http_' + res.status };
    const type = res.headers.get('content-type') || '';
    if (!type.startsWith('image/')) return { success: false, error: 'not_image' };
    const blob = await res.blob();
    if (blob.size > 30 * 1024 * 1024) return { success: false, error: 'too_large' };

    const bmp = await createImageBitmap(blob);
    const scale = Math.min(1, 2048 / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bmp, 0, 0, w, h);
    try { bmp.close(); } catch (_) {}
    const out = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.92 });
    const buf = new Uint8Array(await out.arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    return { success: true, base64: `data:image/jpeg;base64,${btoa(bin)}`, width: w, height: h, byteLength: out.size };
  } catch (e) {
    return { success: false, error: e?.message || String(e) };
  }
}

async function mapPool(items, limit, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  const workers = Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      try { out[i] = await fn(items[i], i); } catch (_) { out[i] = null; }
    }
  });
  await Promise.all(workers);
  return out;
}



// ── ADD LINK ─────────────────────────────────────────────────
async function addLink({
  url,
  title    = '',
  tags     = [],
  folder   = 'General',
  notes    = '',
  images   = [],
  videoUrl = '',
  price    = '',
  videos   = [],
  imageUrls = [],
  enrichmentStatus = '',
  brand = '', color = '', weight = '', dimL = '', dimW = '', dimH = '', bullets = []
} = {}) {
  if (!url || !isValidURL(url)) return { success: false, reason: 'invalid_url' };

  const data = await getData();
  const normalizedUrl = normalizeQueueUrl(url);
  if (data.settings.duplicateCheck) {
    const dup = data.links.find(l => normalizeQueueUrl(l.url) === normalizedUrl);
    if (dup) return { success: false, reason: 'duplicate', existingId: dup.id };
  }

  if (!data.folders.includes(folder)) folder = 'General';

  const validImages = Array.isArray(images)
    ? images.filter(i => typeof i === 'string' && isValidURL(i)).slice(0, IMG_CAP) : [];
  const validImageUrls = Array.isArray(imageUrls)
    ? imageUrls.filter(i => typeof i === 'string' && /^https?:\/\//i.test(i)).slice(0, IMG_CAP) : [];
  const validVideos = Array.isArray(videos)
    ? videos.filter(v => typeof v === 'string' && v.length > 0).slice(0, VID_CAP) : [];

  const newLink = {
    id:               generateId(),
    url,
    title:            sanitizeText(title) || url,
    category:         data.settings.autoCategory ? detectCategory(url) : 'Other',
    folder,
    tags:             Array.isArray(tags) ? tags.filter(t => String(t).trim()).slice(0, 15) : [],
    favicon:          getFavicon(url),
    images:           validImages,
    imageUrls:        validImageUrls,
    dateAdded:        new Date().toISOString(),
    dateModified:     new Date().toISOString(),
    notes:            sanitizeText(notes),
    price:            sanitizeText(price),
    videoUrl:         typeof videoUrl === 'string' ? videoUrl : '',
    brand: sanitizeText(brand).slice(0, 80), color: sanitizeText(color).slice(0, 80),
    weight: sanitizeText(weight).slice(0, 20), dimL: sanitizeText(dimL).slice(0, 20), dimW: sanitizeText(dimW).slice(0, 20), dimH: sanitizeText(dimH).slice(0, 20),
    bullets: Array.isArray(bullets) ? bullets.filter(v => typeof v === 'string').map(v => sanitizeText(v).slice(0, 700)).slice(0, 6) : [],
    videos:           validVideos,
    visited:          false,
    visitCount:       0,
    enrichmentStatus: enrichmentStatus || (validImages.length === 0 && validImageUrls.length > 0 ? 'pending' : '')
  };

  data.links.unshift(newLink);
  data.history.unshift({
    id:   generateId(),
    type: 'add',
    text: `Saved: ${newLink.title.substring(0, 50)}`,
    date: new Date().toISOString()
  });
  data.history = data.history.slice(0, 200);

  await saveData(data);
  return { success: true, link: newLink };
}

async function addLinkFast(payload) {
  const r = await addLink({
    url:       payload.url,
    title:     payload.title,
    folder:    payload.folder,
    notes:     payload.notes,
    tags:      payload.tags || [],
    price:     payload.price || '',
    videoUrl:  payload.videoUrl || '',
    videos:    payload.videos || [],
    imageUrls: payload.imageUrls || [],
    images:    [],
    enrichmentStatus: 'pending',
    brand: payload.brand || '', color: payload.color || '', weight: payload.weight || '',
    dimL: payload.dimL || '', dimW: payload.dimW || '', dimH: payload.dimH || '', bullets: payload.bullets || []
  });
  return r;
}

// ── ENRICH LINK ──────────────────────────────────────────────
async function enrichLink({ linkId }) {
  // FIX: Removed duplicate getData() call — read once, reuse both link and settings
  const data0 = await getData();
  let link = data0.links.find(l => l.id === linkId);
  if (!link) return { success: false, reason: 'not_found' };

  const urls = Array.isArray(link.imageUrls) ? link.imageUrls.slice(0, IMG_CAP) : [];
  const settings = data0.settings || {};

  if (urls.length) {
    const results = await mapPool(urls, FETCH_CONCURRENCY, u => fetchImageAsBase64(u, settings));
    
    let validImages = results.filter(r => r && r.success && typeof r.base64 === 'string');
    
    if (validImages.length > 1) {
      // Sort images by file size (largest first) to prioritize quality
      validImages.sort((a, b) => (b.byteLength || 0) - (a.byteLength || 0));
      
      // Filter out tiny thumbnails. Keep if dimensions are >= 400px OR file size >= 15KB.
      const highQualityImages = validImages.filter(img => 
        (img.width >= 400 || img.height >= 400) || (img.byteLength || 0) >= 15 * 1024
      );
      
      if (highQualityImages.length > 0) {
        validImages = highQualityImages;
      } else {
        // If all images are small, keep ONLY the single largest one so the tab succeeds
        // without flooding the folder with useless thumbnails.
        validImages = [validImages[0]];
      }
    }

    const base64s = validImages.map(r => r.base64);

    await saveImagesToIndexedDB(linkId, base64s);

    link = await mutateLink(linkId, l => ({
      ...l,
      enrichmentStatus: 'complete'
    }));
    if (link) broadcastMessage({ action: 'LINK_UPDATED', link });
  } else {
    link = await mutateLink(linkId, l => ({ ...l, enrichmentStatus: 'complete' }));
  }

  return { success: true };
}

// ── REMOVE / UPDATE / FOLDERS / TAGS ─────────────────────────
async function removeLink(id) {
  const data = await getData();
  const before = data.links.length;
  data.links = data.links.filter(l => l.id !== id);
  if (data.links.length === before) return { success: false, reason: 'not_found' };
  await saveData(data);
  await deleteImagesFromIndexedDB(id);
  return { success: true };
}

function sanitizeLinkUpdates(updates) {
  if (!updates || typeof updates !== 'object' || Array.isArray(updates)) return {};
  const clean = {};
  const allowed = new Set([
    'url', 'title', 'category', 'folder', 'tags', 'notes', 'images', 'imageUrls',
    'price', 'videoUrl', 'videos', 'visited', 'visitCount', 'enrichmentStatus',
    // PRO: Profit / ROI Calculator fields
    'sourcingPrice', 'sellingPrice', 'shippingCost', 'platformFeePercent',
    'landedCost', 'profit', 'marginPercent', 'roi',
    // PRO: Supplier fields
    'sellerName', 'sellerUrl', 'moq', 'stockStatus', 'shippingCountry',
    // PRO: Price history (array), supplier notes
    'priceHistory', 'supplierNotes',
    // PRO: Structured rich video objects
    'richVideos',
    // v8.4.0: product details
    'brand', 'color', 'weight', 'dimL', 'dimW', 'dimH', 'bullets'
  ]);
  for (const [key, value] of Object.entries(updates)) {
    if (!allowed.has(key)) continue;
    if (['brand', 'color', 'weight', 'dimL', 'dimW', 'dimH'].includes(key)) { if (typeof value === 'string') clean[key] = sanitizeText(value).slice(0, 80); continue; }
    if (key === 'bullets') { if (Array.isArray(value)) clean[key] = value.filter(v => typeof v === 'string').map(v => sanitizeText(v).slice(0, 700)).slice(0, 6); continue; }
    if (['title', 'category', 'notes', 'price', 'enrichmentStatus', 'sellerName', 'sellerUrl', 'moq', 'stockStatus', 'shippingCountry', 'supplierNotes', 'sourcingPrice', 'sellingPrice', 'shippingCost', 'platformFeePercent', 'landedCost', 'profit', 'marginPercent', 'roi'].includes(key)) {
      if (typeof value === 'string') clean[key] = sanitizeText(value);
      continue;
    }
    if (key === 'url') {
      if (typeof value === 'string' && isValidURL(value)) clean[key] = value;
      continue;
    }
    if (key === 'folder' || key === 'videoUrl') {
      if (typeof value === 'string' && value.length <= 2000) clean[key] = key === 'videoUrl' && value && !isValidURL(value) ? '' : value;
      continue;
    }
    if (key === 'tags') {
      if (Array.isArray(value)) clean[key] = value.map(v => sanitizeText(v)).filter(Boolean).slice(0, 15);
      continue;
    }
    if (key === 'images' || key === 'imageUrls' || key === 'videos') {
      if (Array.isArray(value)) clean[key] = value.filter(v => typeof v === 'string' && isValidURL(v)).slice(0, key === 'videos' ? VID_CAP : IMG_CAP);
      continue;
    }
    if (key === 'visited') {
      if (typeof value === 'boolean') clean[key] = value;
      continue;
    }
    if (key === 'visitCount') {
      if (Number.isFinite(value)) clean[key] = Math.max(0, Math.min(1000000, Math.floor(value)));
    }
    if (key === 'priceHistory') {
      if (Array.isArray(value)) clean[key] = value.slice(-50);
      continue;
    }
    if (key === 'richVideos') {
      if (Array.isArray(value)) clean[key] = value.slice(0, 30).map(v => ({
        url:       typeof v.url       === 'string' ? v.url       : '',
        platform:  typeof v.platform  === 'string' ? v.platform  : '',
        thumbnail: typeof v.thumbnail === 'string' ? v.thumbnail : '',
        duration:  typeof v.duration  === 'string' ? v.duration  : '',
        width:     typeof v.width     === 'string' ? v.width     : '',
        height:    typeof v.height    === 'string' ? v.height    : '',
        source:    typeof v.source    === 'string' ? v.source    : '',
        capturedAt:typeof v.capturedAt=== 'string' ? v.capturedAt: ''
      })).filter(v => v.url);
      continue;
    }
  }
  return clean;
}

async function updateLink(id, updates) {
  const data = await getData();
  updates = sanitizeLinkUpdates(updates);
  const idx = data.links.findIndex(l => l.id === id);
  if (idx === -1) return { success: false, reason: 'not_found' };

  if (updates.folder && !data.folders.includes(updates.folder)) updates.folder = data.links[idx].folder;

  // PRO: Price History — snapshot old price when it changes
  const existing = data.links[idx];
  if (updates.price && updates.price !== existing.price && existing.price) {
    const history = Array.isArray(existing.priceHistory) ? existing.priceHistory : [];
    history.push({ price: existing.price, date: new Date().toISOString() });
    updates.priceHistory = history.slice(-50); // keep last 50
  }

  data.links[idx] = { ...existing, ...updates, dateModified: new Date().toISOString() };
  await saveData(data);
  return { success: true, link: data.links[idx] };
}

// Add URLs to the live bulk queue (shared by the side panel, the context menu
// and the content script). Duplicates and unsupported links are skipped.
async function addBulkQueueItems(items) {
  if (!Array.isArray(items)) return { success: false, reason: 'invalid_items', addedCount: 0, rejected: [] };
  const existing = await chrome.storage.local.get(BULK_QUEUE_KEY);
  const queue = Array.isArray(existing[BULK_QUEUE_KEY])
    ? existing[BULK_QUEUE_KEY].map(sanitizeBulkQueueItem).filter(Boolean)
    : [];
  const seen = new Set(queue.map(item => normalizeQueueUrl(item.url)));
  const added = [], rejected = [];
  let duplicates = 0;
  for (const raw of items.slice(0, 2000)) {
    const url = normalizeQueueUrl(raw?.url || '');
    if (!url || !isSupportedProductUrl(url)) { rejected.push({ url: raw?.url || '', reason: 'unsupported_url' }); continue; }
    if (seen.has(url)) { duplicates++; continue; }
    seen.add(url);
    added.push({ id: `q_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, url, title: sanitizeText(raw?.title || url),
      platform: bgDetectPlatform(url), addedAt: Date.now(), checked: true, status: 'queued', attempts: 0, error: '' });
  }
  const nextQueue = [...queue, ...added].slice(-2000);
  await chrome.storage.local.set({ [BULK_QUEUE_KEY]: nextQueue });
  if (added.length) broadcastMessage({ action: 'BULK_QUEUE_UPDATED', count: added.length });
  return { success: true, addedCount: added.length, duplicates, rejected, total: nextQueue.length };
}

async function addFolder(name) {
  const n = String(name || '').trim().slice(0, 40);
  if (!n) return { success: false, reason: 'empty' };
  const data = await getData();
  if (data.folders.includes(n)) return { success: false, reason: 'duplicate' };
  data.folders.push(n);
  await saveData(data);
  return { success: true, folder: n };
}

async function renameFolder(oldName, newName) {
  const n = String(newName || '').trim().slice(0, 40);
  if (!n) return { success: false, reason: 'empty' };
  if (oldName === 'General') return { success: false, reason: 'protected' };
  const data = await getData();
  if (data.folders.includes(n)) return { success: false, reason: 'duplicate' };
  data.folders = data.folders.map(f => f === oldName ? n : f);
  data.links = data.links.map(l => l.folder === oldName
    ? { ...l, folder: n, dateModified: new Date().toISOString() } : l);
  await saveData(data);
  return { success: true };
}

async function removeFolder(folderName) {
  if (folderName === 'General') return { success: false, reason: 'protected' };
  const data = await getData();
  data.folders = data.folders.filter(f => f !== folderName);
  data.links = data.links.map(l => l.folder === folderName
    ? { ...l, folder: 'General', dateModified: new Date().toISOString() } : l);
  await saveData(data);
  return { success: true };
}

async function addTag(name) {
  const t = String(name || '').trim().slice(0, 30);
  if (!t) return { success: false, reason: 'empty' };
  const data = await getData();
  if (data.tags.includes(t)) return { success: false, reason: 'duplicate' };
  data.tags.push(t);
  await saveData(data);
  return { success: true, tag: t };
}

async function removeTag(tagName) {
  const data = await getData();
  data.tags = data.tags.filter(t => t !== tagName);
  data.links = data.links.map(l => ({
    ...l,
    tags: (l.tags || []).filter(t => t !== tagName),
    dateModified: new Date().toISOString()
  }));
  await saveData(data);
  return { success: true };
}

// FIX: Batch all tab saves into a single getData() + saveData() round-trip
// instead of N sequential read/mutate/write cycles.
async function saveAllTabs(folder = 'General', tags = []) {
  const tabs  = await chrome.tabs.query({});
  const data  = await getData();
  if (!data.folders.includes(folder)) folder = 'General';

  const results  = [];
  const nowIso   = new Date().toISOString();
  let   anyAdded = false;

  for (const tab of tabs) {
    if (!tab.url || !isValidURL(tab.url) || tab.url.startsWith('chrome://')) continue;
    if (data.settings.duplicateCheck && data.links.some(l => normalizeQueueUrl(l.url) === normalizeQueueUrl(tab.url))) {
      results.push({ url: tab.url, success: false, reason: 'duplicate' });
      continue;
    }
    const newLink = {
      id:               generateId(),
      url:              tab.url,
      title:            sanitizeText(tab.title || tab.url) || tab.url,
      category:         data.settings.autoCategory ? detectCategory(tab.url) : 'Other',
      folder,
      tags:             Array.isArray(tags) ? tags.filter(t => String(t).trim()).slice(0, 15) : [],
      favicon:          getFavicon(tab.url),
      images:           [], imageUrls: [],
      dateAdded:        nowIso, dateModified: nowIso,
      notes:            '', price: '', videoUrl: '', videos: [],
      visited:          false, visitCount: 0, enrichmentStatus: ''
    };
    data.links.unshift(newLink);
    results.push({ url: tab.url, success: true, link: newLink });
    anyAdded = true;
  }

  if (anyAdded) {
    data.history.unshift({
      id: generateId(), type: 'save_tabs',
      text: `Saved ${results.filter(r => r.success).length} tabs`,
      date: nowIso
    });
    data.history = data.history.slice(0, 200);
    await saveData(data);
  }
  return { success: true, results };
}

// ── Context menus ────────────────────────────────────────────
function setupContextMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'zh-add-page',      title: 'ZHunter: Add this product to queue',    contexts: ['page'] });
    chrome.contextMenus.create({ id: 'zh-add-link',      title: 'ZHunter: Add link to queue',            contexts: ['link'] });
    chrome.contextMenus.create({ id: 'zh-add-selection', title: 'ZHunter: Add selected URL to queue',    contexts: ['selection'] });
    chrome.contextMenus.create({ id: 'zh-reverse-image', title: 'ZHunter: Find supplier for this image', contexts: ['image'] });
  });
}

// ── Hunt from image right-click: open preview in popup ───────
// We store the pending hunt info in storage so the popup can pick it up.
async function storePendingImageHunt(tabId, tabUrl, tabTitle, imageUrl) {
  try {
    await chrome.storage.local.set({
      zhunterPendingImageHunt: {
        tabId,
        tabUrl,
        tabTitle,
        imageUrl,
        ts: Date.now()
      }
    });
  } catch (_) {}
}

// v9.15 - unwrap sponsored/redirect tracking links (Walmart /sp/track?...&rd=<real url>) to the real product URL
function unwrapTrackingUrl(str) {
  try {
    const u = new URL(str);
    for (const k of ['rd', 'url', 'u', 'redirect', 'redirect_url', 'dest', 'target']) {
      const v = u.searchParams.get(k);
      if (!v) continue;
      let d = v;
      try { d = decodeURIComponent(v); } catch (_) {}
      if (/^\//.test(d)) d = u.origin + d;
      if (/^https?:\/\//i.test(d) && isSupportedProductUrl(d)) return d;
    }
    if (/\/(?:sp\/track|track|click|redirect)\b/i.test(u.pathname)) {
      const m = decodeURIComponent(u.search).match(/(https?:\/\/[^\s&]+\/ip\/[^\s&]+|\/ip\/[^\s&]+)/i);
      if (m) { const d = m[1].startsWith('/') ? u.origin + m[1] : m[1]; if (isSupportedProductUrl(d)) return d; }
    }
  } catch (_) {}
  return str;
}

// v9.15 - resolve the product link around the last right-click (ctx_capture.js records nearby links)
async function zhCtxProduct(tab, frameId) {
  try {
    if (tab?.id == null) return {};
    const target = { tabId: tab.id }; if (Number.isInteger(frameId) && frameId > 0) target.frameIds = [frameId];
    const res = await chrome.scripting.executeScript({ target, func: () => window.__zhCtx || null });
    const ctx = res && res[0] && res[0].result;
    if (!ctx || !Array.isArray(ctx.levels) || Date.now() - (ctx.t || 0) > 60000) return {};
    for (const level of ctx.levels) {
      const hits = new Map();
      for (const l of level) {
        let u = l.href;
        if (!isSupportedProductUrl(u)) u = unwrapTrackingUrl(u);
        if (!isSupportedProductUrl(u)) continue;
        let key = u; try { const x = new URL(u); key = x.hostname + x.pathname; } catch (_) {}
        if (!hits.has(key) || (!hits.get(key).title && l.text)) hits.set(key, { url: u, title: l.text || '' });
      }
      if (hits.size === 1) return [...hits.values()][0];
      if (hits.size > 1) return { ambiguous: true };
    }
  } catch (_) {}
  return {};
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  let url = '', title = '';
  switch (info.menuItemId) {
    case 'zh-add-page':      url = tab?.url || '';                    title = tab?.title || url; break;
    case 'zh-add-link':      url = info.linkUrl || '';                title = info.linkText || url; break;
    case 'zh-add-selection':
      url = (info.selectionText || '').trim(); title = url;
      if (!isValidURL(url)) { broadcastToast('Selected text is not a link', 'err'); return; }
      break;
    case 'zh-reverse-image':
      if (info.srcUrl) chrome.tabs.create({ url: 'https://lens.google.com/uploadbyurl?url=' + encodeURIComponent(info.srcUrl) });
      else broadcastToast('Could not find image URL', 'err');
      return;
    default: return;
  }
  if (!url) return;
  if (!isSupportedProductUrl(url)) url = unwrapTrackingUrl(url);
  // v9.15 - inject the toast straight into the page (works even if the page was not refreshed after an extension reload)
  const pageToast = (text, type) => {
    if (tab?.id == null) return;
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      args: [String(text || ''), String(type || 'ok')],
      func: (msg, kind) => {
        let host = document.getElementById('zhunter-page-toast');
        if (!host) {
          host = document.createElement('div'); host.id = 'zhunter-page-toast';
          host.style.cssText = 'position:fixed;right:16px;bottom:96px;z-index:2147483647;pointer-events:none;display:flex;flex-direction:column;gap:6px;align-items:flex-end;';
          document.documentElement.appendChild(host);
        }
        const c = kind === 'warn' ? '#FBBF24' : kind === 'err' ? '#F87171' : '#34D399';
        const el = document.createElement('div');
        el.textContent = msg;
        el.style.cssText = 'font:600 13px Segoe UI,system-ui,sans-serif;color:#fff;background:#0b1220;border:1px solid ' + c + ';border-left:5px solid ' + c + ';padding:8px 14px;border-radius:4px;max-width:260px;box-shadow:0 8px 28px rgba(0,0,0,.45);opacity:0;transition:opacity .2s;';
        host.appendChild(el);
        requestAnimationFrame(() => { el.style.opacity = '1'; });
        setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 250); }, 3500);
      }
    }).catch(() => {});
  };
  if (!isSupportedProductUrl(url)) url = unwrapTrackingUrl(url);
  // v9.15 - right-click on a card's price/badge/empty area gives the page (or a non-product link): look at the product links around the click
  if (!isSupportedProductUrl(url) && info.menuItemId !== 'zh-add-selection') {
    const found = await zhCtxProduct(tab, info.frameId);
    if (found.url) { url = found.url; if (found.title) title = found.title; }
    else if (found.ambiguous) { broadcastToast('Several products here — right-click directly on the product title or picture', 'warn'); pageToast('ZHunter: right-click directly on the product title or picture', 'warn'); return; }
  }
  if (!isSupportedProductUrl(url)) { broadcastToast('Not a supported product link', 'warn'); pageToast('ZHunter: not a supported product link', 'warn'); return; }
  const result = await addBulkQueueItems([{ url, title }]);
  let text = '', type = 'ok';
  if (result.success && result.addedCount) { await flashBadgeSuccess(); text = `Added to ZHunter queue (${result.total} waiting)`; }
  else if (result.success) { text = 'Already in the ZHunter queue'; type = 'warn'; }
  if (!text) { text = 'ZHunter: could not add this link'; type = 'err'; }
  broadcastToast(text, type);
  pageToast(text.startsWith('ZHunter') ? text : 'ZHunter: ' + text, type);
});

// ── MESSAGE ROUTER ───────────────────────────────────────────
// Rate limiting alone is not enough: explicitly distinguish extension-page
// requests from the small set of actions allowed to page content scripts.

const CONTENT_SCRIPT_ACTIONS = new Set([
  'TEMU_NEED_VISIBLE', 'TEMU_UPLOAD_PROGRESS',
  'DOWNLOAD_PAGE_IMAGES', 'FETCH_BASE64',
  'FETCH_BASE64_BATCH', 'GET_PENDING_IMAGE_HUNT', 'CHECK_BULK_QUEUE',
  'ADD_TO_BULK_QUEUE',
  // v9.9.0 — Google Flow image studio (flow_automation.js / content.js lightbox)
  'ZH_CDP_CLICK', 'ZH_CDP_DETACH', 'OPEN_OR_FOCUS_FLOW', 'ZH_REPLACE_IMAGE_FROM_FLOW', 'ZH_FLOW_STATUS',
  'FETCH_GEMINI_IMAGE'   // gemini_automation.js: read the finished Gemini picture (Gemini tab only, googleusercontent.com only)
]);

function isAuthorizedMessage(msg, sender) {
  if (!msg || typeof msg.action !== 'string' || msg.action.length > 80) return false;
  if (sender?.id && sender.id !== chrome.runtime.id) return false;
  if (sender?.tab) {
    const tabUrl = String(sender.tab.url || '');
    return /^https?:\/\//i.test(tabUrl) && CONTENT_SCRIPT_ACTIONS.has(msg.action);
  }
  // Messages from sidepanel, popup, options, or the service worker itself.
  return !sender?.url || sender.url.startsWith(`chrome-extension://${chrome.runtime.id}/`);
}

// ═══ v9.1.1 — Temu auto-upload orchestrated from the service worker ═══
// Runs independent of the side panel, so switching tabs can never kill it.
// Flow: open Temu tab INACTIVE (peeche) → wait for content script → send file →
// content script attaches + waits for Temu to register the upload → if the hidden
// page refuses to mount its upload box, the content script asks TEMU_NEED_VISIBLE
// and we flash the tab forward for a moment, then restore the user's tab.
// cancel = user pressed Cancel in the side panel; sent = the file was already handed to the Temu page (can't be taken back)
const _temuUpload = { tabId: null, activated: false, prevTabId: null, cancel: false, sent: false };
function tabsSend(tabId, message) {
  return new Promise(res => {
    try {
      chrome.tabs.sendMessage(tabId, message, r => {
        if (chrome.runtime.lastError) return res({ __err: chrome.runtime.lastError.message });
        res(r);
      });
    } catch (e) { res({ __err: e?.message || String(e) }); }
  });
}
let ZhUploadTask = null;
async function temuBgAutoUpload(input) {
  if (ZhUploadTask) return { success: false, report: ['Upload already running; wait for its result'] };
  ZhUploadTask = (async () => {
    const previous = (await chrome.storage.local.get('zhTemuUploadJob')).zhTemuUploadJob;
    // A "running" job here means the worker stopped in the middle of it (this worker is not running one). v9.15.1 — say WHICH upload it was.
    if (previous?.state === 'running') {
      const ageMin = Math.max(0, Math.round((Date.now() - (previous.t || 0)) / 60000));
      return { success: false, report: ['Previous upload needs verification. Check its Temu tab before retrying.'], recoveryRequired: true,
        previous: { store: previous.store || '', filename: previous.filename || '', t: previous.t || 0, ageMin, stale: ageMin >= 30 } };
    }
    const job = { id: input.sourcing?.id || crypto.randomUUID(), state: 'running', t: Date.now(), store: input.expectStore, filename: input.filename, sourcing: input.sourcing };
    await chrome.storage.local.set({ zhTemuUploadJob: job });
    try { const result = await temuBgAutoUploadJob(input); await chrome.storage.local.set({ zhTemuUploadJob: { ...(await chrome.storage.local.get('zhTemuUploadJob')).zhTemuUploadJob, ...job, state: result.confirmed ? 'processed' : result.cancelled ? 'cancelled' : 'needs-review', result } }); return result; }
    catch (e) { await chrome.storage.local.set({ zhTemuUploadJob: { ...job, state: 'needs-review', error: e.message } }); throw e; }
  })();
  try { return await ZhUploadTask; } finally { ZhUploadTask = null; }
}
// v9.15.1 — store names must match exactly (only letter case / extra spaces ignored): "HQ TWO" ≠ "HQ - TWO"
const zhStoreNorm = s => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
const TEMU_UPLOAD_URL = 'https://seller.temu.com/upload-goods-multiple.html';
async function bgWaitTemuReady(tabId, tries = 50) {
  for (let i = 0; i < tries; i++) {
    await new Promise(r => setTimeout(r, i === 0 ? 1200 : 500));
    if (_temuUpload.cancel) return false;
    const r = await tabsSend(tabId, { action: 'PING' });
    if (r && r.ready) return true;
  }
  return false;
}
// resolves true once the tab has reloaded (loading → complete) — Temu reloads by itself after a store card is clicked
function bgWaitTabReload(tabId, ms = 30000) {
  return new Promise(res => {
    let sawLoading = false, done = false, timer = null;
    const end = v => { if (done) return; done = true; try { chrome.tabs.onUpdated.removeListener(fn); } catch (_) {} clearTimeout(timer); res(v); };
    const fn = (id, info) => { if (id !== tabId) return; if (info.status === 'loading') sawLoading = true; if (info.status === 'complete' && sawLoading) end(true); };
    chrome.tabs.onUpdated.addListener(fn);
    timer = setTimeout(() => end(sawLoading), ms);
  });
}
// v9.15.1 — the right store must be open before a file is sent. A wrong store is switched ONCE (header menu → Switch → exact store card),
// then the upload page is opened again and the name is checked again. Anything unclear = upload stops, nothing is sent.
async function bgEnsureTemuStore(tabId, expectStore, report) {
  const cur = await tabsSend(tabId, { action: 'TEMU_GET_STORE', wait: 15000 });
  if (!cur?.name) { report.push('✗ Store name not shown on the Temu page — upload blocked, nothing was sent' + (cur?.__err ? ` (${cur.__err})` : '')); return false; }
  if (zhStoreNorm(cur.name) === zhStoreNorm(expectStore)) { report.push(`✓ Store verified: ${cur.name}`); return true; }
  report.push(`• Temu is on "${cur.name}" — switching to "${expectStore}"…`);
  const reload = bgWaitTabReload(tabId);
  const sw = await tabsSend(tabId, { action: 'TEMU_SWITCH_STORE', name: expectStore });
  if (!sw?.ok) { report.push('✗ Store switch failed: ' + (sw?.error || sw?.__err || 'no answer from the Temu tab') + ' — nothing was uploaded'); return false; }
  if (sw.switching) {
    if (!(await reload)) { report.push('✗ Temu did not reload after the store was chosen — check the Temu tab; nothing was uploaded'); return false; }
    try { await chrome.tabs.update(tabId, { url: TEMU_UPLOAD_URL }); } catch (_) {}
    if (!(await bgWaitTemuReady(tabId))) { report.push('✗ Upload page did not load after the store switch — nothing was uploaded'); return false; }
  }
  const after = await tabsSend(tabId, { action: 'TEMU_GET_STORE', wait: 15000 });
  if (zhStoreNorm(after?.name) !== zhStoreNorm(expectStore)) { report.push(`✗ After switching, Temu still shows "${after?.name || '?'}" — nothing was uploaded`); return false; }
  report.push(`✓ Store switched to ${after.name}`);
  return true;
}
async function temuBgAutoUploadJob({ b64, filename, expectStore, background }) {
  const report = [];
  const bg = background !== false;
  _temuUpload.cancel = false; _temuUpload.sent = false;
  let tabIdForCancel = null;
  // user pressed Cancel before the file was sent: stop, close the Temu tab we opened, nothing reaches Temu
  const cancelled = async () => {
    report.push('✕ Cancelled by you — nothing was sent to Temu');
    if (tabIdForCancel != null) { try { await chrome.tabs.remove(tabIdForCancel); } catch (_) {} }
    if (_temuUpload.prevTabId != null) { try { await chrome.tabs.update(_temuUpload.prevTabId, { active: true }); } catch (_) {} }
    _temuUpload.activated = false;
    return finish({ success: false, cancelled: true, report });
  };
  // v9.15.1 — the Google Sheet sourcing record is no longer written here: the side panel sends it only for the products Temu confirmed
  startKeepAlive('upload', 30 * 60 * 1000);
  try {
    let prevTab = null;
    try { prevTab = (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0] || null; } catch (_) {}
    // v9.1.2: tab hamesha saamne khulta hai — Temu ki "Processing data %" page ke andar chalti hai aur
    // background tab mein throttle ho kar bohat slow ho jati hai. bg=true ka matlab: kaam khatam hote hi
    // focus khud aap ke pichle tab par wapas.
    const tab = await chrome.tabs.create({ url: TEMU_UPLOAD_URL, active: true });
    const savedJob = (await chrome.storage.local.get('zhTemuUploadJob')).zhTemuUploadJob;
    if (savedJob) await chrome.storage.local.set({zhTemuUploadJob:{...savedJob,tabId:tab.id}});
    _temuUpload.tabId = tab.id; _temuUpload.activated = true; _temuUpload.prevTabId = prevTab?.id ?? null;
    tabIdForCancel = tab.id;
    report.push(bg ? '✓ Temu tab opened (focus will return after processing)' : '✓ Temu tab khola');

    // wait for content script
    if (!(await bgWaitTemuReady(tab.id))) { if (_temuUpload.cancel) return cancelled(); report.push('✗ Temu page did not load (check login)'); return finish({ success: false, report }); }
    if (_temuUpload.cancel) return cancelled();
    report.push('✓ Temu page ready');
    if (expectStore && !(await bgEnsureTemuStore(tab.id, expectStore, report))) return _temuUpload.cancel ? cancelled() : finish({ success: false, report });
    if (_temuUpload.cancel) return cancelled();

    _temuUpload.sent = true;   // from here on the file is on its way to Temu
    const result = await tabsSend(tab.id, {
      action: 'TEMU_UPLOAD_FILE', b64, filename: filename || 'temu_upload.xlsx', expectStore,
      waitForUpload: true, hiddenMode: false
    });
    if (!result || result.__err) { report.push('✗ ' + (result?.__err || 'no response from Temu tab')); return finish({ success: false, report }); }
    report.push(...(result.report || []));
    return finish({ success: !!result.success, confirmed: !!result.confirmed, processed: result.processed ?? null, added: result.added ?? null, errors: result.errors ?? null, ready: result.ready ?? null, status: result.status || '', uploadId: result.uploadId || '', report, tabId: tab.id });
  } catch (e) {
    report.push('✗ ' + (e?.message || e));
    return finish({ success: false, report });
  }
  async function finish(out) {
    // restore the user's tab if we ever brought the Temu tab forward (and things went fine)
    try {
      if (bg && _temuUpload.activated && _temuUpload.prevTabId != null && out.success && out.confirmed !== false) {
        await chrome.tabs.update(_temuUpload.prevTabId, { active: true });
        out.report.push('✓ Focus returned to your tab');
      }
    } catch (_) {}
    _temuUpload.tabId = null; _temuUpload.activated = false; _temuUpload.prevTabId = null; _temuUpload.cancel = false; _temuUpload.sent = false;
    try { await chrome.storage.local.set({ temuLastUploadReport: { t: Date.now(), ...out } }); } catch (_) {}
    stopKeepAlive('upload');
    return out;
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!isAuthorizedMessage(msg, sender)) {
    sendResponse({ success: false, error: 'unauthorized_message' });
    return true;
  }
  if (isRateLimited(sender)) {
    sendResponse({ success: false, error: 'rate_limited' });
    return true;
  }
  handleMessage(msg, sender).then(sendResponse).catch(err => sendResponse({ success: false, error: err.message }));
  return true;
});

async function handleMessage(msg, sender, queueLocked = false) {
  if (!queueLocked && ['ADD_TO_BULK_QUEUE','ADD_BULK_QUEUE_ITEMS','REMOVE_FROM_BULK_QUEUE','UPDATE_BULK_QUEUE','CLEAR_BULK_QUEUE'].includes(msg.action)) return await withWriteLock(() => handleMessage(msg, sender, true));
  switch (msg.action) {
    case 'MASTER_COMMIT': return await withWriteLock(() => zhMasterCommit(msg));
    case 'MASTER_BATCH_ADD': return await withWriteLock(async () => {
      const incoming = msg.batch; if (!incoming?.id || !Array.isArray(incoming.urls)) throw new Error('Invalid hunt batch');
      const saved = await chrome.storage.local.get('zhunterMasterBatches'); const batches = saved.zhunterMasterBatches || [];
      let batch = batches.find(b => b.id === incoming.id); if (!batch) { batch = { ...incoming, urls: [], platforms: [], count: 0 }; batches.unshift(batch); }
      batch.urls = [...new Set([...(batch.urls || []), ...incoming.urls])]; batch.count = batch.urls.length;
      batch.platforms = [...new Set([...(batch.platforms || []), ...incoming.platforms])]; await chrome.storage.local.set({ zhunterMasterBatches: batches.slice(0,50) }); return { success: true };
    });
    case 'MASTER_RESET': return await withWriteLock(() => zhMasterReset(!!msg.wipe));
    case 'BACKUP_EXPORT': return await withWriteLock(zhBackupExport);
    case 'BACKUP_RESTORE': return await withWriteLock(() => zhBackupRestore(msg.backup));
    // -- Read-only / non-storage actions (no lock needed) --
    case 'GET_DATA': {
      const data = await getData();
      return { ...data, settings: getPublicSettings(data.settings) };
    }
    case 'GET_LINK_IMAGES':    return { success: true, images: await getImagesFromIndexedDB(msg.id) };
    case 'START_KEEPALIVE':    startKeepAlive('panel'); return { success: true };
    case 'SOURCING_CONNECT': return await zhSourcingConnect(msg.config);
    case 'SOURCING_DISCONNECT': await zhSourcingSerial(() => chrome.storage.local.remove('zhSourcingConnection')); return { success: true };
    case 'SOURCING_STATUS': return await zhSourcingStatus();
    case 'SOURCING_RETRY': return await zhSourcingRetry(false, '', true);
    case 'SOURCING_QUEUE': return await zhSourcingQueue(msg.snapshot);
    case 'SOURCING_OPEN': await zhSourcingOpen(); return { success: true };
    case 'TEMU_UPLOAD_REVIEWED': {
      if (ZhUploadTask) throw new Error('Upload is still running');
      const saved = (await chrome.storage.local.get('zhTemuUploadJob')).zhTemuUploadJob;
      if (saved) await chrome.storage.local.set({zhTemuUploadJob:{...saved,state:'reviewed',reviewedAt:Date.now()}});
      return {success:true};
    }
    case 'TEMU_AUTO_UPLOAD':   return await temuBgAutoUpload(msg);
    case 'TEMU_UPLOAD_CANCEL': {
      if (!ZhUploadTask) return { success: true, running: false };
      _temuUpload.cancel = true;
      return { success: true, running: true, sent: _temuUpload.sent };
    }
    case 'TEMU_NEED_VISIBLE': {
      // content script (hidden Temu tab) says the page won't mount its upload box while hidden →
      // bring the tab forward briefly; temuBgAutoUpload restores the previous tab afterwards.
      const tid = sender?.tab?.id;
      if (tid && _temuUpload.tabId === tid) {
        _temuUpload.activated = true;
        try { await chrome.tabs.update(tid, { active: true }); } catch (_) {}
        return { success: true, activated: true };
      }
      return { success: false };
    }
    case 'TEMU_UPLOAD_PROGRESS': {
      // v9.4.3 — content script (Temu tab) → live progress → side panel (broadcast) + storage
      const tid = sender?.tab?.id;
      if (!tid || _temuUpload.tabId !== tid) return { success: false };
      const prog = { t: Date.now(), phase: String(msg.phase || ''), pct: msg.pct ?? null, uploadId: msg.uploadId || null, secs: msg.secs ?? null };
      try { chrome.storage.local.set({ temuUploadProgress: prog }); } catch (_) {}
      try { chrome.runtime.sendMessage({ action: 'TEMU_UPLOAD_PROGRESS', ...prog }, () => void chrome.runtime.lastError); } catch (_) {}
      return { success: true };
    }
    case 'GROUP_PRODUCT_TABS': {
      // v9.5.0 — side panel: {tabIds:[..]} ya {all:true, windowId}
      if (msg.all) return await bgGroupAllProductTabs(msg.windowId);
      return await bgGroupTabs(msg.tabIds || []);
    }
    case 'ZH_CDP_CLICK': {
      const tabId = sender?.tab?.id || msg.tabId;
      if (!tabId) return { ok: false, error: 'no_tab' };
      if (sender?.tab?.id && !/^https:\/\/flow\.google\.com\//i.test(String(sender.tab.url || ''))) {
        return { ok: false, error: 'flow_only' };
      }
      try {
        const ok = msg.selector
          ? await cdpClickSelector(tabId, msg.selector)
          : await cdpClickAt(tabId, msg.x, msg.y);
        return { ok };
      } catch (e) {
        return { ok: false, error: e?.message || String(e) };
      }
    }
    case 'ZH_CDP_DETACH': {
      const tabId = sender?.tab?.id || msg.tabId;
      if (tabId) await cdpDetach(tabId);
      return { ok: true };
    }
    case 'ZH_REPLACE_IMAGE_FROM_FLOW':
    case 'ZH_FLOW_STATUS':
      // Handled by the side panel's own listener; acknowledge so the sender isn't left hanging.
      return { success: true };
    case 'FETCH_FLOW_IMAGE': {
      // v9.9.0 — side panel only: download a generated Flow image (signed, expiring
      // flow-content.google URL) and return it as a JPEG data URL for re-hosting.
      if (sender?.tab) return { success: false, error: 'not_allowed' };
      return await fetchFlowImageAsJpeg(String(msg.url || ''));
    }
    case 'OPEN_OR_FOCUS_FLOW': {
      const tabs = await chrome.tabs.query({ url: '*://flow.google.com/*' });
      if (tabs && tabs.length > 0) {
        const t = tabs.find(x => x.url && x.url.includes('/project/')) || tabs[0];
        await chrome.tabs.update(t.id, { active: true });
        try { await chrome.tabs.sendMessage(t.id, { action: 'ZH_FLOW_EXECUTE' }); } catch (_) {}
      } else {
        await chrome.tabs.create({ url: 'https://flow.google.com', active: true });
      }
      return { success: true };
    }
    case 'OPEN_SIDEPANEL_FOR_TAB': {
      try {
        const windowId = sender?.tab?.windowId;
        const tabId = sender?.tab?.id;
        if (chrome.sidePanel?.open) {
          if (windowId) await chrome.sidePanel.open({ windowId });
          else if (tabId) await chrome.sidePanel.open({ tabId });
        }
        return { success: true };
      } catch (e) {
        return { success: false, error: e?.message };
      }
    }
    case 'STOP_KEEPALIVE':     stopKeepAlive('panel');  return { success: true };
    case 'FETCH_GEMINI_IMAGE': {
      if (sender?.tab && !/^https:\/\/gemini\.google\.com\//i.test(String(sender.tab.url || ''))) return { success: false, error: 'gemini_only' };
      return await fetchGeminiImage(msg.url);
    }
    case 'FETCH_BASE64': {
      const storedSettings = await zhSettingsCached();
      const effectiveSettings = msg.settings ? { ...storedSettings, ...msg.settings } : storedSettings;
      return await fetchImageAsBase64(msg.url, effectiveSettings);
    }
    case 'FETCH_BASE64_BATCH': {
      const settings = await zhSettingsCached();
      const urls = Array.isArray(msg.urls) ? msg.urls.slice(0, 15) : [];
      const results = await mapPool(urls, FETCH_CONCURRENCY, u => fetchImageAsBase64(u, settings));
      return { success: true, results: results || [] };
    }
    case 'DOWNLOAD_PAGE_IMAGES': {
      const urls = Array.isArray(msg.urls) ? [...new Set(msg.urls.filter(isValidURL))].slice(0, 7) : [];
      const rawName = sanitizeText(msg.title || 'product-images').replace(/[<>:"/\\|?*]+/g, '_').trim().slice(0, 70) || 'product-images';

      const downloadResults = await Promise.all(urls.map(async (url, index) => {
        const match = url.match(/\.(png|webp|gif|jpeg|jpg)(?:[?#]|$)/i);
        const directExt = (match?.[1] || 'jpg').toLowerCase().replace('jpeg', 'jpg');
        const baseName = `ZHunter/${rawName}/${String(index + 1).padStart(2, '0')}`;

        // FIX: Fetch image bytes directly, create blob URL in service worker.
        // Data URLs have a size limit in chrome.downloads — large images silently fail.
        // Blob URLs created in the same service worker context work reliably.
        try {
          const headers = {
            'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Cache-Control': 'no-cache',
          };
          try { headers['Referer'] = new URL(url).origin + '/'; } catch (_) {}
          const response = await fetch(url, { headers, credentials: 'omit', signal: AbortSignal.timeout(15000) });
          if (response.ok) {
            const contentType = response.headers.get('content-type') || 'image/jpeg';
            if (contentType.startsWith('image/')) {
              const buffer = await response.arrayBuffer();
              const blob = new Blob([buffer], { type: contentType });
              const blobUrl = URL.createObjectURL(blob);
              const ext = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : directExt;
              const result = await new Promise(resolve => {
                _zhDlNames.set(blobUrl, `${baseName}.${ext}`); chrome.downloads.download({ url: blobUrl, filename: `${baseName}.${ext}`, saveAs: false, conflictAction: 'uniquify' }, downloadId => {
                  const error = chrome.runtime.lastError?.message || '';
                  setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
                  resolve(error || !downloadId ? { success: false, error: error || 'download_not_started' } : { success: true, downloadId });
                });
              });
              if (result.success) return { ...result, url };
            }
          }
        } catch (_) {}

        // Fallback: direct URL (non-CDN-restricted sources)
        return new Promise(resolve => {
          chrome.downloads.download({ url, filename: `${baseName}.${directExt}`, saveAs: false, conflictAction: 'uniquify' }, downloadId => {
            const error = chrome.runtime.lastError?.message || '';
            resolve(error || !downloadId ? { success: false, url, error: error || 'download_not_started' } : { success: true, downloadId, url });
          });
        });
      }));

      const started = downloadResults.filter(r => r?.success).length;
      const failed  = downloadResults.filter(r => !r?.success).length;
      return { success: started > 0, requested: urls.length, started, failed,
        errors: downloadResults.filter(r => !r?.success).map(r => r.error).slice(0, 7),
        failedUrls: downloadResults.filter(r => !r?.success).map(r => r.url).filter(Boolean).slice(0, 7) };
    }

    case 'GET_PENDING_IMAGE_HUNT': {
      const res = await chrome.storage.local.get('zhunterPendingImageHunt');
      const pending = res.zhunterPendingImageHunt || null;
      // Only return if recent (within 30s)
      if (pending && (Date.now() - pending.ts) < 30000) {
        await chrome.storage.local.remove('zhunterPendingImageHunt');
        return { success: true, pending };
      }
      return { success: true, pending: null };
    }
    case 'GET_SETTINGS': {
      const d = await getData();
      return { success: true, settings: getPublicSettings(d.settings) };
    }
    case 'COPY_ALL_TABS': {
      const tabs = await chrome.tabs.query({});
      const urls = tabs.filter(t => t.url && isValidURL(t.url)).map(t => t.url);
      return { success: true, urls };
    }

    // ── Storage-mutating actions (serialised via withWriteLock) ──
    // Prevents read-modify-write race conditions when multiple messages
    // arrive concurrently (e.g. 5 parallel bulk enrichments).
    case 'ADD_LINK':           return await withWriteLock(() => addLink({
                                  url:       msg.url,
                                  title:     msg.title,
                                  tags:      msg.tags,
                                  folder:    msg.folder,
                                  notes:     msg.notes,
                                  images:    msg.images || [],
                                  videoUrl:  msg.videoUrl || '',
                                  price:     msg.price || '',
                                  videos:    msg.videos || [],
                                  imageUrls: msg.imageUrls || []
                                }));
    case 'ADD_LINK_FAST':      return await withWriteLock(() => addLinkFast(msg));
    case 'ENRICH_LINK':        return await withWriteLock(() => enrichLink({ linkId: msg.linkId }));
    case 'REMOVE_LINK':        return await withWriteLock(() => removeLink(msg.id));
    case 'UPDATE_LINK':        return await withWriteLock(() => updateLink(msg.id, msg.updates));
    case 'ADD_FOLDER':         return await withWriteLock(() => addFolder(msg.folder));
    case 'RENAME_FOLDER':      return await withWriteLock(() => renameFolder(msg.oldName, msg.newName));
    case 'REMOVE_FOLDER':      return await withWriteLock(() => removeFolder(msg.folder));
    case 'ADD_TAG':            return await withWriteLock(() => addTag(msg.tag));
    case 'REMOVE_TAG':         return await withWriteLock(() => removeTag(msg.tag));
    case 'SAVE_ALL_TABS':      return await withWriteLock(() => saveAllTabs(msg.folder, msg.tags));
    case 'CLEAR_ALL':          return await withWriteLock(async () => {
      const data = await getData();
      data.links = [];
      await chrome.storage.local.remove(['zhunterMasterSheet', 'zhunterMasterBatches']);
      data.history.unshift({ id: generateId(), type: 'clear', text: 'Cleared all saved products', date: new Date().toISOString() });
      data.history = data.history.slice(0, 200);
      await saveData(data);
      await clearIndexedDBImages();
      return { success: true };
    });
    case 'UPDATE_SETTINGS':    return await withWriteLock(async () => {
      const data = await getData();
      const patch = sanitizeSettingsPatch(msg.settings);
      const dropped = Object.keys(msg.settings || {}).filter(k => !Object.prototype.hasOwnProperty.call(patch, k));
      if (dropped.length) throw new Error('Unsupported settings: ' + dropped.join(', '));
      data.settings = { ...data.settings, ...patch };
      if (['showTabHunt','showTabBulk','showTabLibrary','showTabSettings'].every(k => data.settings[k] === false)) throw new Error('At least one tab must remain visible');
      if (!await saveData(data)) throw new Error('Settings could not be saved');
      return { success: true, settings: getPublicSettings(data.settings) };
    });
    case 'LOG_ACTION':         return await withWriteLock(async () => {
      const data = await getData();
      data.history.unshift({ id: generateId(), type: msg.type || 'info', text: sanitizeText(msg.text), date: new Date().toISOString() });
      data.history = data.history.slice(0, 200);
      await saveData(data);
      return { success: true };
    });
    case 'CLEAR_HISTORY':      return await withWriteLock(async () => {
      const data = await getData();
      data.history = [];
      await saveData(data);
      return { success: true };
    });
    case 'ADD_IMAGE_TO_LINK':  return await withWriteLock(async () => {
      const data = await getData();
      const idx = data.links.findIndex(l => l.id === msg.id);
      if (idx === -1) return { success: false, reason: 'not_found' };
      const link = data.links[idx];
      const images = Array.isArray(link.images) ? [...link.images] : [];
      const imageUrls = Array.isArray(link.imageUrls) ? [...link.imageUrls] : [];
      if (images.length >= IMG_CAP) return { success: false, reason: 'max_images' };
      if (typeof msg.image === 'string' && isValidURL(msg.image)) {
        images.push(msg.image);
        imageUrls.push(msg.image);
        data.links[idx] = { ...link, images, imageUrls, dateModified: new Date().toISOString() };
        await saveData(data);
        return { success: true, images };
      }
      return { success: false, reason: 'invalid_image' };
    });
    case 'REMOVE_IMAGE_FROM_LINK': return await withWriteLock(async () => {
      const data = await getData();
      const idx = data.links.findIndex(l => l.id === msg.id);
      if (idx === -1) return { success: false, reason: 'not_found' };
      const link = data.links[idx];
      const images = Array.isArray(link.images) ? [...link.images] : [];
      const imageUrls = Array.isArray(link.imageUrls) ? [...link.imageUrls] : [];
      // FIX: Validate the index — an unvalidated splice(negativeIndex, 1) silently
      // deletes from the end of the array, removing the wrong image.
      const rmIdx = parseInt(msg.imageIndex);
      if (isNaN(rmIdx) || rmIdx < 0 || rmIdx >= images.length) return { success: false, reason: 'invalid_index' };
      images.splice(rmIdx, 1);
      imageUrls.splice(rmIdx, 1);
      data.links[idx] = { ...link, images, imageUrls, dateModified: new Date().toISOString() };
      await saveData(data);
      return { success: true, images };
    });

    // (cloud sync actions removed in v7.11.1)
    // ── Bulk Queue CRUD ─────────────────────────────────────────
    case 'GET_BULK_QUEUE': {
      const res = await chrome.storage.local.get(BULK_QUEUE_KEY);
      const rawQueue = Array.isArray(res[BULK_QUEUE_KEY]) ? res[BULK_QUEUE_KEY] : [];
      const queue = [];
      const seen = new Set();
      rawQueue.slice(0, 2000).forEach(rawItem => {
        const item = sanitizeBulkQueueItem(rawItem);
        if (item && !seen.has(item.url)) { seen.add(item.url); queue.push(item); }
      });
      return { success: true, queue };
    }
    case 'CHECK_BULK_QUEUE': {
      const normUrl = normalizeQueueUrl(msg.url || sender?.tab?.url || '');
      const res = await chrome.storage.local.get(BULK_QUEUE_KEY);
      const queue = Array.isArray(res[BULK_QUEUE_KEY]) ? res[BULK_QUEUE_KEY] : [];
      return { success: true, queued: !!normUrl && queue.some(item => normalizeQueueUrl(item?.url) === normUrl) };
    }
    case 'ADD_TO_BULK_QUEUE': {
      const normUrl = normalizeQueueUrl(msg.url || sender?.tab?.url || '');
      if (!normUrl) return { success: false, reason: 'invalid_url' };
      if (!isSupportedProductUrl(normUrl)) return { success: false, reason: 'unsupported_url' };
      if (sender?.tab?.url && normalizeQueueUrl(sender.tab.url) !== normUrl) return { success: false, reason: 'tab_url_mismatch' };
      const res2 = await chrome.storage.local.get(BULK_QUEUE_KEY);
      const q = Array.isArray(res2[BULK_QUEUE_KEY]) ? res2[BULK_QUEUE_KEY] : [];
      if (q.some(i => normalizeQueueUrl(i?.url) === normUrl)) return { success: false, reason: 'duplicate' };
      const newItem = {
        id: `q_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
        url: normUrl,
        title: sanitizeText(msg.title || normUrl),
        platform: bgDetectPlatform(normUrl),
        addedAt: Date.now(),
        checked: true,
        status: 'queued',
        attempts: 0,
        error: ''
      };
      q.push(newItem);
      await chrome.storage.local.set({ [BULK_QUEUE_KEY]: q.slice(-2000) });   // v9.15.1 — keep the NEW item when the queue is full (was dropped silently)
      broadcastMessage({ action: 'BULK_QUEUE_UPDATED', item: newItem });
      return { success: true, item: newItem };
    }
    case 'PREVIEW_BULK_QUEUE': {
      // Read-only classification for the import preview (mirrors ADD_BULK_QUEUE_ITEMS, no write).
      const existing = await chrome.storage.local.get(BULK_QUEUE_KEY);
      const queue = Array.isArray(existing[BULK_QUEUE_KEY]) ? existing[BULK_QUEUE_KEY] : [];
      const known = new Set(queue.map(item => normalizeQueueUrl(item?.url || '')).filter(Boolean));
      const seen = new Set();
      const accepted = [], duplicate = [], unsupported = [];
      for (const raw of (Array.isArray(msg.items) ? msg.items : []).slice(0, 2000)) {
        const originalUrl = String(raw?.url || '');
        const url = normalizeQueueUrl(originalUrl);
        const base = { originalUrl, url: url || originalUrl, title: sanitizeText(raw?.title || ''), platform: url ? bgDetectPlatform(url) : '' };
        if (!url || !isSupportedProductUrl(url)) { unsupported.push({ ...base, reason: 'unsupported_url' }); continue; }
        if (known.has(url)) { duplicate.push({ ...base, reason: 'already_queued' }); continue; }
        if (seen.has(url)) { duplicate.push({ ...base, reason: 'repeated_in_batch' }); continue; }
        seen.add(url); accepted.push(base);
      }
      return { success: true, accepted, duplicate, unsupported, total: queue.length };
    }
    case 'ADD_BULK_QUEUE_ITEMS':
      return await addBulkQueueItems(msg.items);
    case 'REMOVE_FROM_BULK_QUEUE': {
      const res3 = await chrome.storage.local.get(BULK_QUEUE_KEY);
      const q3 = (res3[BULK_QUEUE_KEY] || []).filter(i => i.id !== msg.id);
      await chrome.storage.local.set({ [BULK_QUEUE_KEY]: q3 });
      return { success: true };
    }
    case 'UPDATE_BULK_QUEUE': {
      // Full replace — popup sends updated array (check/uncheck, reorder).
      if (!Array.isArray(msg.queue)) return { success: false, reason: 'invalid_queue' };
      const cleanQueue = [];
      const seen = new Set();
      for (const rawItem of msg.queue.slice(0, 2000)) {
        const item = sanitizeBulkQueueItem(rawItem);
        if (!item || seen.has(item.url)) continue;
        seen.add(item.url);
        cleanQueue.push(item);
      }
      await chrome.storage.local.set({ [BULK_QUEUE_KEY]: cleanQueue });
      return { success: true, count: cleanQueue.length };
    }
    case 'CLEAR_BULK_QUEUE': {
      await chrome.storage.local.set({ [BULK_QUEUE_KEY]: [] });
      return { success: true };
    }

    default: return { success: false, reason: 'unknown_action' };
  }
}

// ── Lifecycle ────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.local.get(STORAGE_KEY);
  if (!existing[STORAGE_KEY]) {
    await chrome.storage.local.set({ [STORAGE_KEY]: JSON.parse(JSON.stringify(DEFAULT_DATA)) });
  } else {
    const data = await getData();
    let migrated = false;
    data.links = data.links.map(link => {
      let changed = false;
      const u = { ...link };
      if (Array.isArray(u.images)) {
        const filteredImages = u.images.filter(i => typeof i === 'string' && isValidURL(i));
        if (filteredImages.length !== u.images.length) { u.images = filteredImages; changed = true; }
      } else {
        u.images = [];
        changed = true;
      }
      if (u.base64Image) {
        delete u.base64Image;
        changed = true;
      }
      if (!Array.isArray(u.imageUrls))  { u.imageUrls = []; changed = true; }
      if (typeof u.price    === 'undefined') { u.price = ''; changed = true; }
      if (typeof u.videoUrl === 'undefined') { u.videoUrl = ''; changed = true; }
      if (!Array.isArray(u.videos))     { u.videos = []; changed = true; }
      if (typeof u.enrichmentStatus === 'undefined') { u.enrichmentStatus = ''; changed = true; }
      if (changed) migrated = true;
      return u;
    });
    if (!data.settings.bulkSheetColumns) {
      data.settings.bulkSheetColumns = JSON.parse(JSON.stringify(DEFAULT_DATA.settings.bulkSheetColumns));
      migrated = true;
    }
    if (!data.settings.productSheetColumns) {
      data.settings.productSheetColumns = JSON.parse(JSON.stringify(DEFAULT_DATA.settings.productSheetColumns));
      migrated = true;
    }
    if (!Array.isArray(data.settings.customProductColumns)) {
      data.settings.customProductColumns = [];
      migrated = true;
    }
    if (typeof data.settings.autoSkipDuplicates === 'undefined') {
      data.settings.autoSkipDuplicates = true;
      migrated = true;
    }
    // Migrate imageFormat setting
    if (typeof data.settings.imageFormat === 'undefined') {
      data.settings.imageFormat = 'jpg';
      migrated = true;
    }
    if (migrated) await saveData(data);
  }

  const migFlag = await chrome.storage.local.get('zhunter_v76_migrated');
  if (!migFlag.zhunter_v76_migrated) {
    await chrome.storage.local.remove(['zhunterMasterSheet', 'zhunterMasterBatches']);
    await chrome.storage.local.set({ zhunter_v76_migrated: true });
  }

  setupContextMenus();
  await updateBadge();
});

chrome.runtime.onStartup.addListener(() => {
  updateBadge();
  setupContextMenus();
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'save-current-tab') {
    // Ctrl+Shift+S: add the current tab to the bulk queue.
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url || !isValidURL(tab.url)) return;
    if (!isSupportedProductUrl(tab.url)) { broadcastToast('Not a supported product page', 'warn'); return; }
    const r = await addBulkQueueItems([{ url: tab.url, title: tab.title || tab.url }]);
    const text = r.addedCount ? `Added to ZHunter queue (${r.total} waiting)` : 'Already in the ZHunter queue';
    if (r.addedCount) await flashBadgeSuccess();
    broadcastToast(text, r.addedCount ? 'ok' : 'warn');
    chrome.tabs.sendMessage(tab.id, { action: 'ZH_PAGE_TOAST', text, type: r.addedCount ? 'ok' : 'warn' }).catch(() => {});
  }
});

chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes.zhunterMasterSheet) updateBadge(); });
chrome.alarms.create('badgeSync', { periodInMinutes: 5 });
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'badgeSync')       await updateBadge();
  // FIX: Handle the badge flash reset alarm set by flashBadgeSuccess()
  if (alarm.name === 'badgeFlashReset') await updateBadge();
});

// FIX: Removed the redundant action.onClicked listener.
// When openPanelOnActionClick: true, Chrome does NOT fire action.onClicked,
// so the listener below was dead code that would cause a double-open bug
// if Chrome's behaviour ever changes.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

// ── Auto-Capture: add product pages to Bulk Queue as user browses ─────────
// ═══ v9.5.0 — "ZHunter" tab group: product tabs ek group mein ═══
// Sirf UNGROUPED tabs ko chhua jata hai (user ke apne groups ko nahi). Group khali hone par Chrome
// usse khud hata deta hai. Pinned tabs group nahi ho sakte → skip.
const ZH_GROUP_TITLE = 'ZHunter';
const ZH_GROUP_COLOR = 'cyan';
async function bgFindZhGroup(windowId) {
  try {
    if (!chrome.tabGroups) return null;
    const q = windowId != null ? { windowId, title: ZH_GROUP_TITLE } : { title: ZH_GROUP_TITLE };
    const gs = await chrome.tabGroups.query(q);
    return gs && gs[0] ? gs[0].id : null;
  } catch (_) { return null; }
}
async function bgGroupTabs(tabIds, { force = false } = {}) {
  try {
    if (!chrome.tabGroups || !chrome.tabs.group) return { success: false, reason: 'no_api' };
    const ids = [...new Set((tabIds || []).map(Number).filter(Number.isFinite))];
    if (!ids.length) return { success: true, grouped: 0 };
    const tabs = (await Promise.all(ids.map(id => chrome.tabs.get(id).catch(() => null)))).filter(Boolean);
    // group per window; only ungrouped (or, with force, any non-ZHunter group) + not pinned
    const byWin = new Map();
    for (const t of tabs) {
      if (t.pinned) continue;
      const gid = await bgFindZhGroup(t.windowId);
      if (gid != null && t.groupId === gid) continue;              // already in ZHunter group
      if (!force && t.groupId != null && t.groupId !== -1) continue; // user's own group — leave it
      if (!byWin.has(t.windowId)) byWin.set(t.windowId, { gid, ids: [] });
      byWin.get(t.windowId).ids.push(t.id);
    }
    let grouped = 0;
    for (const [windowId, { gid, ids: wid }] of byWin) {
      if (!wid.length) continue;
      let groupId = gid;
      if (groupId != null) {
        try { await chrome.tabs.group({ tabIds: wid, groupId }); }
        catch (_) { groupId = null; } // stale group id → make a fresh one
      }
      if (groupId == null) {
        groupId = await chrome.tabs.group({ tabIds: wid, createProperties: { windowId } });
        try { await chrome.tabGroups.update(groupId, { title: ZH_GROUP_TITLE, color: ZH_GROUP_COLOR, collapsed: false }); } catch (_) {}
      }
      grouped += wid.length;
    }
    return { success: true, grouped };
  } catch (e) { return { success: false, reason: e?.message || String(e) }; }
}
async function bgGroupAllProductTabs(windowId) {
  try {
    const tabs = await chrome.tabs.query(windowId != null ? { windowId } : {});
    const ids = tabs.filter(t => t.url && t.url.startsWith('http') && bgDetectPlatform(t.url)).map(t => t.id);
    return await bgGroupTabs(ids);
  } catch (e) { return { success: false, reason: e?.message || String(e) }; }
}

// Fires when a tab finishes loading. If the URL matches a known sourcing
// platform, the URL is appended to the persistent Bulk Queue (deduped).
// A message is broadcast so open popup/sidepanel panels refresh their list.
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  const url = tab.url || '';
  if (!url.startsWith('http')) return;
  if (!bgDetectPlatform(url)) return;

  const stored = await chrome.storage.local.get(['zakLinkCollectorData', BULK_QUEUE_KEY]);
  const settings = stored['zakLinkCollectorData']?.settings || {};

  // v9.15.1 — tabs are NOT grouped while you just browse any more; the side panel groups the hunted tabs when a hunt starts
  // (GROUP_PRODUCT_TABS, setting "Keep product tabs in a ZHunter tab group").

  // Exclude seller portals from auto-capture (they are not product pages to hunt)
  if (/seller\.(temu|walmart|amazon|ebay|alibaba|etsy)\.|sellercentral\.|vendorcentral\./i.test(url)) return;

  // Check auto-capture enabled setting (default: true)
  if (settings.bulkQueueAutoCapture !== true) return; // v8: off unless the user turns it on
  if (!ZhGate.isProductUrl(url)) return;              // v9.14 — never auto-queue home / store / mall / search pages

  // v9.15.1 — same safe path as every other queue write: write lock, normalized URL (no tracking/variant duplicates),
  // 2000-item limit (before: unlocked write, raw URL and the whole queue cut to 500 → older queued links were lost).
  // addBulkQueueItems skips duplicates and notifies the side panel itself.
  try { await withWriteLock(() => addBulkQueueItems([{ url, title: tab.title || url }])); } catch (_) {}
});

// ============================================================
// Google Flow — Chrome DevTools Protocol (CDP) trusted click
// Bypasses synthetic event detection without permanent debugging banner
// ============================================================
const _cdpAttached = new Set();
try {
  chrome.debugger.onDetach.addListener((source) => {
    if (source?.tabId) _cdpAttached.delete(source.tabId);
  });
  chrome.tabs.onRemoved.addListener((id) => { _cdpAttached.delete(id); });
  // Clean up any stale debugger attachments from Flow tabs so no banner or bot flags remain
  chrome.tabs.query({ url: '*://flow.google.com/*' }, (tabs) => {
    (tabs || []).forEach(t => {
      try {
        chrome.debugger.detach({ tabId: t.id }, () => {
          if (chrome.runtime.lastError) {} // silence harmless 'not attached' error
        });
      } catch (_) {}
    });
    _cdpAttached.clear();
  });
} catch (_) {}

async function cdpEnsureAttached(tabId) {
  if (_cdpAttached.has(tabId)) return true;
  try {
    await chrome.debugger.attach({ tabId }, '1.3');
    _cdpAttached.add(tabId);
    return true;
  } catch (e) {
    const m = String(e?.message || e);
    // After a service-worker restart the set is empty but we may still be attached.
    if (/already attached/i.test(m)) { _cdpAttached.add(tabId); return true; }
    console.warn('[ZHunter CDP] Attach failed:', m);
    return false;
  }
}

async function cdpDetach(tabId) {
  _cdpAttached.delete(tabId);
  try { await chrome.debugger.detach({ tabId }); } catch (_) {}
}

const _cdpRnd = (a, b) => a + Math.random() * (b - a);
const _cdpSleep = (ms) => new Promise(r => setTimeout(r, ms));
async function cdpMouseClick(tabId, x, y) {
  // v9.15.0 — human-like: mouse glides in over a few random steps, random hesitation before pressing,
  // random press length. No two clicks have the same timing or path.
  const send = (o) => chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', { modifiers: 0, pointerType: 'mouse', ...o });
  const steps = 2 + Math.floor(Math.random() * 3);
  let cx = x + _cdpRnd(-90, 90), cy = y + _cdpRnd(-60, 60);
  for (let i = 0; i < steps; i++) {
    const t = (i + 1) / (steps + 1);
    await send({ type: 'mouseMoved', button: 'none', buttons: 0, x: Math.round(cx + (x - cx) * t), y: Math.round(cy + (y - cy) * t) });
    await _cdpSleep(_cdpRnd(25, 90));
  }
  const base = { x: Math.round(x), y: Math.round(y) };
  await send({ ...base, type: 'mouseMoved', button: 'none', buttons: 0 });
  await _cdpSleep(_cdpRnd(300, 1200));
  await send({ ...base, type: 'mousePressed', button: 'left', buttons: 1, clickCount: 1 });
  await _cdpSleep(_cdpRnd(55, 170));
  await send({ ...base, type: 'mouseReleased', button: 'left', buttons: 0, clickCount: 1 });
}

// Trusted click at viewport CSS-pixel coordinates (computed by the content script).
async function cdpClickAt(tabId, x, y) {
  if (!(await cdpEnsureAttached(tabId))) return false;
  try {
    await cdpMouseClick(tabId, x, y);
    return true;
  } catch (e) {
    const m = String(e?.message || e);
    // Stale attachment (e.g. user closed the debugging bar) — re-attach once and retry.
    if (/not attached|detached/i.test(m)) {
      _cdpAttached.delete(tabId);
      if (await cdpEnsureAttached(tabId)) {
        try { await cdpMouseClick(tabId, x, y); return true; } catch (_) {}
      }
    }
    console.warn('[ZHunter CDP] Click error:', m);
    return false;
  }
}

async function cdpClickSelector(tabId, selector) {
  if (!selector) return false;
  if (!(await cdpEnsureAttached(tabId))) return false;
  try {
    // Chrome's debugger infobar can resize the viewport. Let layout settle first.
    await new Promise(resolve => setTimeout(resolve, 350));
    const evalResult = await chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', {
      expression: `(() => {
        const el = Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(candidate => {
          const box = candidate.getBoundingClientRect();
          return box.width > 0 && box.height > 0 && !candidate.closest('flow-agent-panel');
        });
        if (!el) return null;
        if (el.disabled || el.getAttribute('aria-disabled') === 'true') return null;
        el.scrollIntoView({ block: 'center', inline: 'center' });
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return null;
        const x = r.left + r.width * (0.3 + Math.random() * 0.4), y = r.top + r.height * (0.3 + Math.random() * 0.4);
        const hit = document.elementFromPoint(x, y);
        if (!hit || (hit !== el && !el.contains(hit))) return null;
        return { x, y };
      })()`,
      returnByValue: true
    });
    const coords = evalResult?.result?.value;
    if (!coords) return false;
    return await cdpClickAt(tabId, coords.x, coords.y);
  } catch (e) {
    console.warn('[ZHunter CDP] Selector click error:', e?.message || e);
    return false;
  }
}

// built-in Google Sheet: connect by itself in every new Chrome profile (no manual setup)
async function zhSourcingAutoConnect() {
  try {
    const d = self.ZH_SOURCING_DEFAULT; if (!d) return;
    const have = (await chrome.storage.local.get('zhSourcingConnection')).zhSourcingConnection;
    if (have) return;
    await chrome.storage.local.set({ zhSourcingConnection: { endpoint: zhSourcingEndpoint(d.endpoint), token: d.token, spreadsheetId: zhSourcingSheetId(d.spreadsheetId) } });
    try { zhSourcingRetry(false); } catch (_) {}
  } catch (e) { console.warn('[ZHunter] auto sheet connect failed', e?.message || e); }
}
zhSourcingAutoConnect();
try { chrome.runtime.onInstalled.addListener(() => zhSourcingAutoConnect()); chrome.runtime.onStartup.addListener(() => zhSourcingAutoConnect()); } catch (_) {}
