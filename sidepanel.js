// ============================================================
// ZHunter Iras v9.7.5 — Side Panel Controller
// Fixes: API key removed, async tag race fixed, video support,
//        clipboard guard, Daraz/Shein scrapers
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
  if (mode === 'fallback') {
    img.style.display = 'none';
    const fallback = img.nextElementSibling;
    if (fallback?.classList.contains('row-thumb-fallback')) fallback.style.display = 'block';
  } else if (mode === 'hide') {
    img.style.display = 'none';
  } else if (mode === 'thumb' && parent) {
    parent.classList.add('thumb-err');
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

const UI_KEY = 'zakUIState';
const APP_VERSION = chrome.runtime.getManifest().version;

// ── State ────────────────────────────────────────────────────
const State = {
  data: { links: [], folders: [], tags: [], settings: {} },
  view: 'list',
  inputMode: 'manual', // v8.3.1: the auto 'Review before saving' modal is off; Hunt tab + Bulk are the workflow
  theme: 'dark',
  selectedTags: [],
  editTags: [],
  editImages: [],
  collectImages: [],
  collectVideoUrl: '',      // video URL for current product
  collectVideos: [],        // multiple product videos
  openFolders: new Set(),
  confirmCb: null,
  bulkMode: false,
  selectedIds: new Set(),
  folderSearch: '',
  imageUrlTarget: 'collect', // 'collect' or 'edit'
  renderPage: 0,
  PAGE_SIZE: 30
};


function applyDynamicVersion() {
  const version = `v${APP_VERSION}`;
  document.querySelectorAll('.brand-version, [data-version]').forEach(el => { el.textContent = version; });
}

function updateStatusLine() {
  const textEl  = $('statusLineText');
  const rightEl = $('statusLineRight');
  if (!textEl) return;
  // Use MasterUIState.allRows — the live in-memory library array
  const count = (typeof MasterUIState !== 'undefined' && Array.isArray(MasterUIState.allRows))
    ? MasterUIState.allRows.length : 0;
  if (count > 0) {
    textEl.textContent = `Library \u2014 ${count} product${count !== 1 ? 's' : ''}`;
  } else {
    textEl.textContent = 'Local storage';
  }
  if (rightEl) {
    const now = new Date();
    rightEl.textContent = `Synced ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  }
}

// ── DOM Helper ───────────────────────────────────────────────
function $(id) { return document.getElementById(id); }

// ── Message Helper & Persistent Port Keepalive ───────────────
let _keepAlivePort = null;
function acquireKeepAlive() {
  try {
    if (!_keepAlivePort) {
      _keepAlivePort = chrome.runtime.connect({ name: 'zhunter-keepalive' });
      _keepAlivePort.onDisconnect.addListener(() => { _keepAlivePort = null; });
    }
  } catch (_) {}
}
function releaseKeepAlive() {
  try {
    if (_keepAlivePort) {
      _keepAlivePort.disconnect();
      _keepAlivePort = null;
    }
  } catch (_) {}
}

function msg(payload) {
  if (payload?.action === 'START_KEEPALIVE') acquireKeepAlive();
  else if (payload?.action === 'STOP_KEEPALIVE') releaseKeepAlive();
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(payload, res => {
      if (chrome.runtime.lastError) {
        resolve({ success: false, error: chrome.runtime.lastError.message });
      } else {
        resolve(res || { success: false, error: 'no_response' });
      }
    });
  });
}

// ── Utility Functions ────────────────────────────────────────
function isValidURL(s) {
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch { return false; }
}

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Unicode-safe base64 encode/decode (btoa crashes on non-ASCII)
function safeEncode(obj) {
  return btoa(unescape(encodeURIComponent(JSON.stringify(obj))));
}
function safeDecode(str) {
  return JSON.parse(decodeURIComponent(escape(atob(str))));
}

function safeHref(url) {
  try {
    const u = new URL(url);
    if (u.protocol === 'http:' || u.protocol === 'https:') return esc(url);
  } catch (_) {}
  return '#';
}

function trunc(s, n) {
  s = String(s || '');
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function csvEsc(v) {
  const s = String(v || '');
  return (s.includes(',') || s.includes('"') || s.includes('\n'))
    ? `"${s.replace(/"/g, '""')}"` : s;
}

function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

function fmtDate(iso) {
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: '2-digit'
    });
  } catch { return ''; }
}

// ── Save a Blob with a real filename ─────────────────────────
// The library's writeFile inside the side panel produced a uuid-named download.
// chrome.downloads keeps the filename; falls back to an anchor if needed.
async function zhSaveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const cleanup = () => setTimeout(() => URL.revokeObjectURL(url), 60000);
  try {
    if (chrome?.downloads?.download) {
      await chrome.downloads.download({ url, filename, conflictAction: 'uniquify' });
      cleanup();
      return;
    }
  } catch (_) {}
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 1000);
}

function dlFile(content, name, mime) {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), {
    href: url, download: name, style: 'display:none'
  });
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
}

function makeBtn(className, title, svgHTML) {
  const btn = document.createElement('button');
  btn.className = className;
  btn.title = title;
  btn.setAttribute('aria-label', title);
  btn.type = 'button';
  btn.innerHTML = svgHTML;
  return btn;
}

function detectCat(url) {
  try {
    const h = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    const map = {
      'amazon': 'Amazon', 'youtube': 'YouTube', 'youtu.be': 'YouTube',
      'github': 'GitHub', 'twitter': 'Twitter/X', 'x.com': 'Twitter/X',
      'reddit': 'Reddit', 'linkedin': 'LinkedIn', 'instagram': 'Instagram',
      'facebook': 'Facebook', 'wikipedia': 'Wikipedia',
      'stackoverflow': 'Stack Overflow', 'medium': 'Medium',
      'netflix': 'Netflix', 'google': 'Google', 'twitch': 'Twitch',
      'tiktok': 'TikTok', 'pinterest': 'Pinterest', 'ebay': 'eBay',
      'etsy': 'Etsy', 'apple': 'Apple', 'microsoft': 'Microsoft',
      'figma': 'Figma', 'notion': 'Notion', 'temu': 'Temu',
      'aliexpress': 'AliExpress', 'walmart': 'Walmart',
      'shopify': 'Shopify', 'shein': 'Shein', 'daraz': 'Daraz', 'faire': 'Faire', 'samsclub': "Sam's Club",
      'alibaba': 'Alibaba', 'bjs': "BJ's Wholesale"
    };
    // Try exact host or subdomain match first
    for (const [k, v] of Object.entries(map)) {
      if (h === k || h === `${k}.com` || h.endsWith(`.${k}`) || h.endsWith(`.${k}.com`)) return v;
    }
    // Fallback: derive a clean name from the registrable domain
    const parts = h.split('.');
    // For 'product.walmart.com' → 'walmart'; for 'walmart.com' → 'walmart'
    const root = parts.length >= 2 ? parts[parts.length - 2] : parts[0];
    if (root && map[root]) return map[root];
    return root ? root.charAt(0).toUpperCase() + root.slice(1) : 'Other';
  } catch { return 'Other'; }
}

function catClass(cat) {
  const m = {
    'Amazon': 'cc-amazon', 'YouTube': 'cc-youtube', 'GitHub': 'cc-github',
    'Twitter/X': 'cc-twitter', 'Reddit': 'cc-reddit', 'LinkedIn': 'cc-linkedin',
    'Instagram': 'cc-instagram', 'Facebook': 'cc-facebook', 'Temu': 'cc-temu',
    'AliExpress': 'cc-aliexpress', 'eBay': 'cc-ebay', 'Etsy': 'cc-etsy',
    'Shein': 'cc-shein', 'Daraz': 'cc-daraz', 'Faire': 'cc-faire', "Sam's Club": 'cc-sams',
    "BJ's Wholesale": 'cc-bjs'
  };
  return m[cat] || 'cc-default';
}

function getFav(url) {
  try {
    return `https://www.google.com/s2/favicons?domain=${new URL(url).hostname}&sz=64`;
  } catch { return ''; }
}

// ── Ripple Effect ────────────────────────────────────────────
function addRipple(btn) {
  if (btn.dataset.hasRipple) return;
  btn.dataset.hasRipple = '1';
  btn.addEventListener('click', function (e) {
    const ripple = document.createElement('span');
    ripple.className = 'ripple';
    const rect = this.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height);
    ripple.style.cssText = `
      width:${size}px; height:${size}px;
      left:${e.clientX - rect.left - size / 2}px;
      top:${e.clientY - rect.top - size / 2}px;
    `;
    this.appendChild(ripple);
    setTimeout(() => ripple.remove(), 600);
  });
}

function applyRipples() {
  document.querySelectorAll('.btn, .btn-hunt-main, .btn-ai-magic, .quick-btn')
    .forEach(addRipple);
}

// ── Hunt Progress UI ───────────────────────────────────────
function showProgress(label, pct) {
  const el = $('huntProgress');
  const fill = $('fpFill');
  const lbl = $('fpLabel');
  if (!el) return;
  el.classList.remove('hidden');
  if (fill) fill.style.width = `${Math.min(100, pct)}%`;
  if (lbl) lbl.textContent = label;
}

function hideProgress() {
  $('huntProgress')?.classList.add('hidden');
  const fill = $('fpFill');
  if (fill) fill.style.width = '0%';
}

// ── Video Helpers ────────────────────────────────────────────
function extractYouTubeId(url) {
  try {
    const u = new URL(url);
    const h = u.hostname.toLowerCase();
    if (h.includes('youtu.be')) return u.pathname.split('/').filter(Boolean)[0] || null;
    if (h.includes('youtube.com')) {
      if (u.searchParams.get('v')) return u.searchParams.get('v');
      const parts = u.pathname.split('/').filter(Boolean);
      for (const key of ['embed', 'shorts', 'live']) {
        const idx = parts.indexOf(key);
        if (idx >= 0 && parts[idx + 1]) return parts[idx + 1];
      }
    }
  } catch {}
  return null;
}

function getYouTubeEmbedUrl(videoId) {
  return `https://www.youtube.com/embed/${videoId}`;
}

function getYouTubeWatchUrl(videoId) {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

function getYouTubeThumbnail(videoId) {
  return `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;
}

function detectVideoUrl(scrapedData, pageUrl) {
  // 1. Explicit video URL from scraper
  if (scrapedData.videoUrl) return scrapedData.videoUrl;

  // 2. YouTube detection from page URL — save watch URL, not embed, to avoid Error 153 in exported HTML
  const ytId = extractYouTubeId(pageUrl);
  if (ytId) return getYouTubeWatchUrl(ytId);

  // 3. Check for video elements in scraped data
  if (scrapedData.videos && scrapedData.videos.length > 0) {
    return scrapedData.videos[0];
  }

  return '';
}

// ── Scraper (injected into page) ─────────────────────────────
function scrapePageData() {
  try {
    const data = { title: document.title || '', url: location.href, images: [], videos: [], videoUrl: '', price: '', variants: [] };
    const abs = (u) => { try { return new URL(u, location.href).href; } catch { return u || ''; } };
    const txt = (el) => (el?.innerText || el?.textContent || el?.getAttribute?.('aria-label') || el?.getAttribute?.('content') || '').trim();
    const addUnique = (arr, val) => { val = abs(String(val || '').trim()); if (val && !val.startsWith('data:') && !val.startsWith('blob:') && !arr.includes(val)) arr.push(val); };
    const cleanPrice = (raw) => {
      let s = String(raw || '')
        .replace(/[-−]\s*\d{1,3}\s*%/g, ' ')
        .replace(/\d{1,3}\s*%\s*(off|save)?/gi, ' ')
        .replace(/(was|list price|typical price|original price|save|discount)\s*:?/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      const patterns = [
        /(?:US\s*)?[$£€¥₹₩]\s*\d+(?:[.,]\d{3})*(?:[.,]\d{1,2})?/,
        /(?:USD|CAD|AUD|GBP|EUR|PKR|INR)\s*\d+(?:[.,]\d{3})*(?:[.,]\d{1,2})?/i,
        /\d+(?:[.,]\d{3})*(?:[.,]\d{1,2})?\s*(?:USD|CAD|AUD|GBP|EUR|PKR|INR|[$£€¥₹₩])/i,
        /\d+(?:[.,]\d{3})*(?:[.,]\d{1,2})?/
      ];
      for (const p of patterns) { const m = s.match(p); if (m) return m[0].replace(/\s+/g, ' ').trim(); }
      return '';
    };
    const firstPrice = (selectors) => {
      for (const sel of selectors) {
        for (const el of document.querySelectorAll(sel)) {
          const v = cleanPrice(el.getAttribute('content') || el.getAttribute('aria-label') || el.innerText || el.textContent);
          if (v) return v;
        }
      }
      return '';
    };
    // Helper: auto-crop Amazon size tokens to yield tight 1500px HD image (removes excess white margins)
    const upscaleAmazonUrl = (src) => {
      if (!src) return '';
      let s = src.split('?')[0];
      let clean = s.replace(/\._[A-Za-z0-9_.,-]+(?:\.[a-z]+)?(?=\.[a-z]+$)/i, '');
      return clean.replace(/(\.[a-zA-Z0-9]+)$/i, '._AC_SL1500_$1');
    };

    const addImgs = (selector, limit = 14) => document.querySelectorAll(selector).forEach(i => {
      // Prioritise hi-res data attributes before falling back to img.src (which may be a small thumbnail)
      let src = i.getAttribute('data-old-hires') || i.getAttribute('data-zoom-image') ||
                i.getAttribute('data-large-image') || i.getAttribute('data-src') ||
                i.getAttribute('data-image') || i.getAttribute('src') || i.src || '';
      if (!src && i.getAttribute('srcset')) src = i.getAttribute('srcset').split(',').pop().trim().split(/\s+/)[0];
      // Try data-a-dynamic-image (Amazon: JSON map of url→[width,height], pick largest)
      const dynRaw = i.getAttribute('data-a-dynamic-image');
      if (dynRaw && dynRaw.startsWith('{')) {
        try {
          const entries = Object.entries(JSON.parse(dynRaw));
          entries.sort((a, b) => (b[1]?.[0] || 0) - (a[1]?.[0] || 0));
          if (entries[0]?.[0]) src = entries[0][0];
        } catch (_) {}
      }
      src = upscaleAmazonUrl(abs(src));
      if (src && !/sprite|pixel|blank|placeholder|\.svg|logo|favicon|banner|\bicon\b/i.test(src)) addUnique(data.images, src);
      if (data.images.length >= limit) return;
    });
    const addVideos = () => {
      document.querySelectorAll('video, video source').forEach(v => addUnique(data.videos, v.currentSrc || v.src || v.getAttribute('src')));
      document.querySelectorAll('meta[property="og:video"],meta[property="og:video:url"],meta[name="twitter:player"]').forEach(m => addUnique(data.videos, m.content));
      document.querySelectorAll('iframe[src*="youtube.com"],iframe[src*="vimeo.com"]').forEach(f => addUnique(data.videos, f.src));
    };
    const ytIdFromUrl = (url) => { try { const u = new URL(url); const parts = u.pathname.split('/').filter(Boolean); if (u.hostname.includes('youtu.be')) return parts[0]; if (u.searchParams.get('v')) return u.searchParams.get('v'); for (const k of ['embed','shorts','live']) { const idx = parts.indexOf(k); if (idx >= 0 && parts[idx+1]) return parts[idx+1]; } return null; } catch { return null; } };

    document.querySelectorAll('meta[property="og:image"], meta[name="twitter:image"]').forEach(m => {
      if (m.content && !/logo|favicon|icon|banner|sprite|placeholder/i.test(m.content)) addUnique(data.images, m.content);
    });
    addVideos();

    document.querySelectorAll('script[type="application/ld+json"]').forEach(s => {
      try {
        const json = JSON.parse(s.textContent || '{}');
        const stack = Array.isArray(json) ? [...json] : [json];
        while (stack.length) {
          const item = stack.shift(); if (!item || typeof item !== 'object') continue;
          if (item.name && !data.title) data.title = String(item.name).trim();
          if (item.image) (Array.isArray(item.image) ? item.image : [item.image]).forEach(x => addUnique(data.images, typeof x === 'string' ? x : x.url));
          const offer = Array.isArray(item.offers) ? item.offers[0] : item.offers;
          if (offer && !data.price) data.price = cleanPrice(`${offer.priceCurrency || ''} ${offer.price || offer.lowPrice || ''}`);
          const video = Array.isArray(item.video) ? item.video : (item.video ? [item.video] : []);
          video.forEach(v => addUnique(data.videos, v.contentUrl || v.embedUrl || v.url || v.thumbnailUrl));
          Object.values(item).forEach(v => { if (v && typeof v === 'object') Array.isArray(v) ? stack.push(...v) : stack.push(v); });
        }
      } catch {}
    });

    const h = location.hostname.toLowerCase();
    const ytId = ytIdFromUrl(location.href);
    if (ytId) {
      data.videoUrl = `https://www.youtube.com/watch?v=${ytId}`;
      addUnique(data.images, `https://img.youtube.com/vi/${ytId}/maxresdefault.jpg`);
      data.title = txt(document.querySelector('h1.ytd-watch-metadata, h1.title')) || data.title || document.title;
    }

    if (h.includes('amazon.')) {
      data.title = txt(document.querySelector('#productTitle, #title span, h1')) || data.title;
      data.price = data.price || firstPrice(['#corePrice_feature_div .a-price:not(.a-text-price) .a-offscreen','.priceToPay .a-offscreen','.apexPriceToPay .a-offscreen','#apex_offerDisplay_desktop .a-price .a-offscreen','#priceblock_ourprice','#priceblock_dealprice','input[name="priceValue"]']);

      // ── AMAZON IMAGE FIX (bulk hunt) ──────────────────────────────────────
      // Root cause of duplicates:
      //   og:image and JSON-LD images are collected ABOVE (lines 323-343) before
      //   the Amazon-specific block runs. They are small/medium-size URLs.
      //   colorImages JSON then adds the SAME images but upscaled — different URL
      //   strings, so addUnique() exact-match dedup doesn't catch them.
      //
      // Fix: reset data.images for Amazon pages (colorImages JSON is always
      // superior in quality and completeness). Use a canonical-key Set so the
      // same base image is never added twice regardless of size token.

      data.images = []; // discard og:image / JSON-LD images — colorImages is better

      const amazonSeenKeys = new Set();
      const addAmazonImg = (rawUrl) => {
        if (!rawUrl || typeof rawUrl !== 'string' || !rawUrl.startsWith('http')) return;
        const norm = upscaleAmazonUrl(abs(rawUrl));
        // Canonical key: hostname + path with ALL size tokens stripped
        let key = norm;
        try { key = new URL(norm).hostname + new URL(norm).pathname.replace(/\._[A-Z0-9_,]+_\./gi, '.').toLowerCase(); } catch (_) {}
        if (amazonSeenKeys.has(key)) return;
        amazonSeenKeys.add(key);
        if (!data.images.includes(norm)) data.images.push(norm);
      };

      // Strategy 1: colorImages JSON from inline scripts — ONLY "initial" variant
      // Raw regex over entire script collects hiRes/large from ALL color variants.
      // Fix: parse colorImages JSON and read only the "initial" (active) variant.
      document.querySelectorAll('script:not([src])').forEach(s => {
        const t = s.textContent || '';
        if (!t.includes('colorImages') && !t.includes('hiRes') && !t.includes('ImageBlockATF')) return;

        // Try JSON parse first — extract only colorImages.initial
        const ciMatch = t.match(/['"]?colorImages['"]?\s*:\s*(\{[^;]{20,}?\}\s*[,;])/s)
                     || t.match(/P\.colorImages\s*=\s*(\{[^;]{20,}?\}\s*;)/s);
        if (ciMatch) {
          try {
            const ci = JSON.parse(ciMatch[1].trimEnd().replace(/[,;]$/, ''));
            const initial = Array.isArray(ci.initial) ? ci.initial : [];
            initial.forEach(entry => {
              if (typeof entry !== 'object' || !entry) return;
              const url = entry.hiRes || entry.large || '';
              if (url && typeof url === 'string' && url.startsWith('http')) addAmazonImg(url);
            });
            if (data.images.length > 0) return;
          } catch (_) {}
        }

        // Regex fallback scoped to "initial" block only
        const initM = t.match(/"initial"\s*:\s*(\[\s*\{[\s\S]*?\}\s*\])/);
        const scope = initM ? initM[1] : t;
        (scope.match(/"hiRes"\s*:\s*"(https?:[^"]+)"/g) || []).forEach(m => {
          const u = (m.match(/"hiRes"\s*:\s*"(https?:[^"]+)"/) || [])[1];
          if (u) addAmazonImg(u);
        });
        (scope.match(/"large"\s*:\s*"(https?:[^"]+)"/g) || []).forEach(m => {
          const u = (m.match(/"large"\s*:\s*"(https?:[^"]+)"/) || [])[1];
          if (u) addAmazonImg(u);
        });
      });

      // Strategy 2: DOM scan — only when colorImages JSON found nothing
      if (data.images.length === 0) {
        addImgs('#landingImage, #imgBlkFront, #altImages img, #imageBlock img, img[data-old-hires]');
      }
      // ── END AMAZON IMAGE FIX ─────────────────────────────────────────────

      document.querySelectorAll('#twister [class*="swatch"], #variation_color_name li, #variation_size_name li').forEach(v => { const val = txt(v); if (val && !data.variants.includes(val)) data.variants.push(val); });
    } else if (h.includes('walmart.')) {
      data.title = txt(document.querySelector('h1[itemprop="name"], [data-automation-id="product-title"], h1')) || data.title;
      data.price = data.price || firstPrice(['[itemprop="price"]','[data-testid="price-wrap"] [itemprop="price"]','[data-automation-id="product-price"]','span[aria-label*="$"]','div[aria-label*="current price"]','[class*="price"]']);
      // Walmart CDN upscaler: strip ?odnWidth= and similar size-capping params
      const wmUp = (src) => src ? src.split('?')[0] : src;
      // Strategy 1: __NEXT_DATA__ JSON — targeted paths + canonical dedup (prevents recommendation images)
      const wmNextEl = document.getElementById('__NEXT_DATA__');
      if (wmNextEl) {
        try {
          const wmNd = JSON.parse(wmNextEl.textContent || '{}');
          const wmSeen = new Set();
          const addWmImg2 = (raw) => { if (!raw) return; const c = wmUp(raw); const k = c.replace(/^https?:\/\//, '').split('?')[0].toLowerCase(); if (!wmSeen.has(k)) { wmSeen.add(k); addUnique(data.images, c); } };
          const extractWm = (info) => {
            if (!info || !Array.isArray(info.allImages)) return false;
            info.allImages.forEach(img => {
              let url = img.url || '';
              if (Array.isArray(img.assetSizeList) && img.assetSizeList.length) { const last = img.assetSizeList[img.assetSizeList.length - 1]; if (last?.url) url = last.url; }
              addWmImg2(url);
            });
            return info.allImages.length > 0;
          };
          const wmRoot = wmNd?.props?.pageProps?.initialData?.data?.product || wmNd?.pageProps?.initialData?.data?.product || wmNd?.initialData?.data?.product;
          if (wmRoot) { extractWm(wmRoot.imageInfo); if (data.images.length === 0) extractWm(wmRoot.primaryOffer?.imageInfo); }
          if (data.images.length === 0) {
            const dfsWm = (o, d) => { if (!o || typeof o !== 'object' || d > 6) return false; if (o.imageInfo && Array.isArray(o.imageInfo.allImages)) return extractWm(o.imageInfo); for (const v of Object.values(o)) { if (v && typeof v === 'object' && dfsWm(v, d + 1)) return true; } return false; };
            dfsWm(wmNd, 0);
          }
        } catch (_) {}
      }

      // Strategy 2: DOM fallback
      if (data.images.length === 0) {
        addImgs('[data-testid="media-thumbnail"] img, [data-automation-id="hero-image"] img, [data-testid="product-image"] img, picture img, img[src*="i5.walmartimages.com"]');
      }
      document.querySelectorAll('[data-testid*="variant"], [data-automation-id*="variant"], button[aria-label*="Size"], button[aria-label*="Color"]').forEach(v => { const val = txt(v); if (val && val.length < 80 && !data.variants.includes(val)) data.variants.push(val); });
    } else if (h.includes('samsclub.com')) {
      data.title = txt(document.querySelector('h1[data-testid="product-title"], h1.sc-product-title, h1')) || data.title;
      data.price = data.price || firstPrice(['[data-testid="price"]','[itemprop="price"]','.Price-characteristic','span[aria-label*="$"]','[class*="Price"]','[class*="price"]']);
      // Sam's Club scene7 CDN upscaler: strip $SC_Item_Medium_Image$ qualifiers and ?wid= params
      const scUp = (src) => {
        if (!src) return src;
        if (/scene7\.samsclub\.com/i.test(src)) return src.split('?')[0].replace(/\$SC_Item[^$]*\$/, '').replace(/\$[^$]+\$/, '');
        return src.split('?')[0];
      };
      // Strategy 1: __NEXT_DATA__ JSON — zoomImage is highest resolution
      const scNextEl = document.getElementById('__NEXT_DATA__');
      if (scNextEl) {
        try {
          const scNd = JSON.parse(scNextEl.textContent || '{}');
          const scSeen2 = new Set();
          const addScImg2 = (raw) => { if (!raw) return; const c = scUp(raw); const k = c.replace(/^https?:\/\//, '').split('?')[0].toLowerCase(); if (!scSeen2.has(k)) { scSeen2.add(k); addUnique(data.images, c); } };
          const extractSc = (assets) => { if (!Array.isArray(assets) || !assets.length || (!assets[0].largeImage && !assets[0].zoomImage)) return false; assets.forEach(a => addScImg2(a.zoomImage || a.largeImage || '')); return true; };
          const scRoot = scNd?.props?.pageProps?.initialData?.data?.product || scNd?.pageProps?.initialData?.data?.product;
          if (scRoot) { extractSc(scRoot.assets); if (data.images.length === 0) extractSc(scRoot.imageAssets || scRoot.images); }
          if (data.images.length === 0) {
            const dfsSc = (o, d) => { if (!o || typeof o !== 'object' || d > 6) return false; if (extractSc(o.assets)) return true; for (const v of Object.values(o)) { if (v && typeof v === 'object' && dfsSc(v, d + 1)) return true; } return false; };
            dfsSc(scNd, 0);
          }
        } catch (_) {}
      }
      // Strategy 2: DOM fallback
      if (data.images.length === 0) {
        document.querySelectorAll('[data-testid="product-image"] img, .sc-product-image img, picture img, img[src*="scene7.samsclub.com"]').forEach(img => {
          const src = img.getAttribute('data-old-hires') || img.getAttribute('data-zoom-image') || img.getAttribute('data-src') || img.src || '';
          if (src && !/logo|icon|badge/i.test(src)) addUnique(data.images, scUp(src));
        });
      }
      document.querySelectorAll('[data-testid*="variant"], button[aria-label*="Size"], button[aria-label*="Color"]').forEach(v => { const val = txt(v); if (val && val.length < 80 && !data.variants.includes(val)) data.variants.push(val); });
    } else if (h.includes('faire.com')) {
      data.title = txt(document.querySelector('h1, [data-testid*="product-title"], [class*="ProductTitle"]')) || data.title;
      data.price = data.price || firstPrice(['[data-testid*="price"]','[class*="Price"]','[class*="price"]','span[aria-label*="$"]']);
      addImgs('picture img, [data-testid*="image"] img, [class*="carousel"] img, [class*="gallery"] img, [class*="Product"] img');
      document.querySelectorAll('[class*="variant"], [data-testid*="variant"], button[aria-label]').forEach(v => { const val = txt(v); if (val && val.length < 80 && !data.variants.includes(val)) data.variants.push(val); });
    } else if (h.includes('aliexpress.')) {
      data.title = txt(document.querySelector('[data-pl="product-title"], h1')) || data.title;
      data.price = data.price || firstPrice(['.product-price-current','.price-current','[class*="price"]']);
      addImgs('.slider--item img, .images--item img, .product-img, picture img');
    } else if (h.includes('alibaba.')) {
      data.title = txt(document.querySelector('h1, [class*="product-title"], [data-testid*="title"]')) || data.title;
      data.price = data.price || firstPrice(['[class*="price"]','[data-testid*="price"]','span[aria-label*="$"]']);
      addImgs('[class*="main-image"] img, [class*="gallery"] img, [class*="thumb"] img, picture img');
    }

    if (!data.price) data.price = firstPrice(['meta[property="product:price:amount"]','meta[itemprop="price"]','[itemprop="price"]','[aria-label*="$"]']);
    if (data.images.length < 2) {
      // Generic fallback: only grab large images (product images are typically big)
      document.querySelectorAll('img').forEach(i => {
        if (data.images.length >= 12) return;
        const w = i.naturalWidth || parseInt(i.getAttribute('width') || '0');
        const h2 = i.naturalHeight || parseInt(i.getAttribute('height') || '0');
        if ((w && w < 200) || (h2 && h2 < 200)) return; // skip tiny images
        let src = i.getAttribute('data-old-hires') || i.getAttribute('data-zoom-image') ||
                  i.getAttribute('data-src') || i.getAttribute('src') || i.src || '';
        if (!src) return;
        src = upscaleAmazonUrl(abs(src));
        if (/sprite|pixel|blank|placeholder|\.svg|logo|favicon|banner|icon/i.test(src)) return;
        if (!src.startsWith('data:') && !src.startsWith('blob:')) addUnique(data.images, src);
      });
    }
    if (!data.videoUrl && data.videos.length) data.videoUrl = data.videos[0];
    data.images = [...new Set(data.images)].slice(0, 12);
    data.videos = [...new Set(data.videos)].slice(0, 8);
    data.variants = [...new Set(data.variants)].slice(0, 12);
    return data;
  } catch (e) {
    return { title: document.title || '', url: location.href, images: [], videos: [], videoUrl: '', price: '', variants: [] };
  }
}

// ── Data Loading ─────────────────────────────────────────────
async function loadData() {
  try {
    const d = await msg({ action: 'GET_DATA' });
    State.data = {
      links:    Array.isArray(d?.links)   ? d.links   : [],
      folders:  Array.isArray(d?.folders) ? d.folders : ['General'],
      tags:     Array.isArray(d?.tags)    ? d.tags    : [],
      settings: d?.settings || {}
    };
    const ui = await chrome.storage.local.get(UI_KEY);
    if (ui?.[UI_KEY]) {
      const s = ui[UI_KEY];
      if (['list', 'grid'].includes(s.viewMode)) State.view = s.viewMode;
      State.inputMode = 'manual';
      if (['dark', 'light'].includes(s.theme)) State.theme = s.theme;
    }
  } catch (_) {
    State.data = { links: [], folders: ['General'], tags: [], settings: {} };
  }
}

async function saveUIState() {
  try {
    const current = await chrome.storage.local.get(UI_KEY);
    await chrome.storage.local.set({
      [UI_KEY]: {
        ...(current?.[UI_KEY] || {}),
        viewMode: State.view,
        inputMode: State.inputMode,
        theme: State.theme
      }
    });
  } catch (_) {}
}

async function refresh() {
  await loadData();
  renderAll();
}

// ── Theme ────────────────────────────────────────────────────
function initTheme() {
  applyTheme(State.theme);

  const btn = $('themeToggleBtn');
  if (btn) {
    btn.addEventListener('click', async () => {
      State.theme = State.theme === 'dark' ? 'light' : 'dark';
      applyTheme(State.theme);
      await saveUIState();
      toast(`${State.theme === 'light' ? '☀️ Light' : '🌙 Dark'} mode activated`, 'info');
    });
  }

  // Keep the popup in sync when the Settings page changes Day/Night mode.
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !changes[UI_KEY]) return;
    const nextTheme = changes[UI_KEY].newValue?.theme;
    if (!['dark', 'light'].includes(nextTheme) || nextTheme === State.theme) return;
    State.theme = nextTheme;
    applyTheme(State.theme);
  });
}

function applyTheme(theme = State.theme) {
  State.theme = theme === 'light' ? 'light' : 'dark';
  const isLight = State.theme === 'light';

  // Apply to both roots so every selector path updates immediately.
  document.documentElement.classList.toggle('light-mode', isLight);
  document.documentElement.dataset.theme = State.theme;
  document.body?.classList.toggle('light-mode', isLight);
  document.body?.setAttribute('data-theme', State.theme);

  const btn = $('themeToggleBtn');
  if (!btn) return;
  btn.classList.toggle('theme-light-active', isLight);
  btn.title = isLight ? 'Switch to Dark Mode' : 'Switch to Light Mode';
  btn.setAttribute('aria-label', btn.title);
}

// ── Tab System ───────────────────────────────────────────────
function initTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.tab;
      document.querySelectorAll('.tab-btn').forEach(b => {
        b.classList.remove('active');
        b.setAttribute('aria-selected', 'false');
      });
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      btn.setAttribute('aria-selected', 'true');
      $(`tab-${id}`)?.classList.add('active');
      if (id === 'links')   renderLinksTab();
      if (id === 'folders') renderFolderAccordion();
      if (id === 'export')  updateExportStats();
      if (id === 'images') {
        const activeSub = document.querySelector('.hunt-sub-btn.active')?.dataset.sub;
        if (activeSub === 'videos') {
          if (typeof VidTabState !== 'undefined' && !VidTabState.videos.length && !VidTabState.isScanning) {
            setTimeout(() => scanVideos(), 120);
          }
        } else {
          scanPageImages();
        }
      }
      if (id === 'videos' && typeof VidTabState !== 'undefined' && !VidTabState.videos.length && !VidTabState.isScanning) {
        setTimeout(() => scanVideos(), 120);
      }
    });
  });
  initHuntSubTabs();
}

// ── Hunt Sub-Tabs (Images | Videos) ──────────────────────────
function initHuntSubTabs() {
  document.querySelectorAll('.hunt-sub-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const sub = btn.dataset.sub;
      document.querySelectorAll('.hunt-sub-btn').forEach(b => {
        b.classList.toggle('active', b === btn);
        b.setAttribute('aria-selected', b === btn ? 'true' : 'false');
      });
      const imgPane = $('hunt-images-pane');
      const vidPane = $('hunt-videos-pane');
      if (imgPane) imgPane.hidden = (sub !== 'images');
      if (vidPane) vidPane.hidden = (sub !== 'videos');
      if (sub === 'videos' && typeof VidTabState !== 'undefined' && !VidTabState.videos.length && !VidTabState.isScanning) {
        setTimeout(() => scanVideos(), 120);
      }
    });
  });
}

// ── Render All ───────────────────────────────────────────────
function renderAll() {
  updateHeaderCount();
  updateStatsDashboard();
  renderLinksTab();
  renderFolderAccordion();
  renderTagsManage();
  renderTagsPicker('tagsSelector', State.selectedTags);
  syncFolderSelect('folderSelect');
  syncFilterDropdowns();
  updateExportStats();
  syncViewButtons();
}

function updateHeaderCount() {
  const el = $('totalCount');
  if (!el) return;
  // Header pill = products in the Library (master sheet), not the legacy links store.
  getMasterRows().then(rows => { el.textContent = String(rows.length); }).catch(() => {});
}

function updateStatsDashboard() {
  if (!$('dashTotalProducts')) return;
  $('dashTotalProducts').textContent = State.data.links.length;
  $('dashTotalFolders').textContent = State.data.folders.length;
  $('dashTotalTags').textContent = State.data.tags.length;
  
  if (chrome.storage && chrome.storage.local && chrome.storage.local.getBytesInUse) {
    chrome.storage.local.getBytesInUse(null, bytes => {
      let size = bytes || 0;
      let unit = 'B';
      if (size > 1024 * 1024) {
        size = (size / (1024 * 1024)).toFixed(1);
        unit = 'MB';
      } else if (size > 1024) {
        size = (size / 1024).toFixed(1);
        unit = 'KB';
      }
      const sizeEl = $('dashStorageUsed');
      if (sizeEl) sizeEl.textContent = `${size} ${unit}`;
    });
  }
}

function syncViewButtons() {
  $('viewList')?.classList.toggle('active', State.view === 'list');
  $('viewGrid')?.classList.toggle('active', State.view === 'grid');
  $('viewList')?.setAttribute('aria-pressed', State.view === 'list' ? 'true' : 'false');
  $('viewGrid')?.setAttribute('aria-pressed', State.view === 'grid' ? 'true' : 'false');
}

// ── Collect Tab ──────────────────────────────────────────────
function initCollectTab() {
  const modeSelect = $('inputMode');
  const urlInput   = $('urlInput');
  const titleInput = $('titleInput');

  // Mode
  if (modeSelect) {
    modeSelect.value = State.inputMode;
    modeSelect.addEventListener('change', () => {
      State.inputMode = modeSelect.value;
      saveUIState();
      if (State.inputMode === 'auto') {
        huntCurrentTab();
        toast('Auto-hunting active tab', 'info');
      } else {
        if (urlInput) urlInput.value = '';
        if (titleInput) titleInput.value = '';
        updateCatDisplay('');
        urlInput?.focus();
        toast('Manual mode ready', 'info');
      }
    });
  }

  // ── Supported e-commerce domains for auto-scrape ────────────
  const AUTO_SCRAPE_HOSTS = [
    'amazon.', 'walmart.', 'samsclub.com', 'temu.', 'ebay.',
    'etsy.com', 'aliexpress.', 'alibaba.com', 'faire.com',
    'shein.com', 'daraz.', 'flipkart.com', 'noon.com',
    'worldwidegolfballs.com', 'worldwidegolfshops.com',
    'worldgolfshop.com', 'golf.com', 'rockbottomgolf.com'
  ];

  function isSupportedEcomPage(url) {
    try {
      const h = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
      return AUTO_SCRAPE_HOSTS.some(p => h.includes(p));
    } catch { return false; }
  }

  // Track last auto-hunted URL to avoid re-scraping same page
  let _lastAutoHuntUrl = '';

  function huntCurrentTab() {
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      const tab = tabs?.[0];
      if (tab?.url && isValidURL(tab.url) && !tab.url.startsWith('chrome://')) {
        if (urlInput) urlInput.value = tab.url;
        if (titleInput) titleInput.value = tab.title || '';
        updateCatDisplay(tab.url);
      }
    });
  }

  // ── Auto-scrape: fires when panel opens on a supported page ──
  async function autoScrapeCurrentTab() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.url || !isValidURL(tab.url) || tab.url.startsWith('chrome://')) return;
      if (!isSupportedEcomPage(tab.url)) return;          // not a supported store
      if (_lastAutoHuntUrl === tab.url) return;           // already scraped this URL

      // Fill URL/title immediately
      if (urlInput)   urlInput.value   = tab.url;
      if (titleInput) titleInput.value = tab.title || '';
      updateCatDisplay(tab.url);

      // Show subtle progress so user knows it's working
      showProgress('Auto-scanning product…', 30);

      const scraped = await new Promise(resolve => {
        let done = false;
        const finish = v => { if (!done) { done = true; resolve(v); } };
        const t = setTimeout(() => finish(null), 8000);
        chrome.tabs.sendMessage(tab.id, { action: 'SCRAPE_PAGE' }, res => {
          clearTimeout(t);
          if (chrome.runtime.lastError || !res?.success || !res?.data) finish(null);
          else finish(res.data);
        });
      });

      hideProgress();

      if (!scraped) return; // silent fail — user can still click Hunt manually

      _lastAutoHuntUrl = tab.url; // mark as done
      openHuntPreviewModal(scraped, tab);
      toast('Product auto-scanned! Review and save 🛍️', 'ok');

    } catch (_) {
      hideProgress();
    }
  }

  if (State.inputMode === 'auto') {
    huntCurrentTab();
    // Slight delay so DOM is ready before modal opens
    setTimeout(() => autoScrapeCurrentTab(), 500);
  }

  // URL input → category
  urlInput?.addEventListener('input', debounce(() => {
    updateCatDisplay(urlInput.value.trim());
  }, 280));

  // Copy URL
  $('copyBtn')?.addEventListener('click', async () => {
    const val = urlInput?.value.trim();
    if (!val) { toast('Nothing to copy', 'warn'); return; }
    try {
      await navigator.clipboard.writeText(val);
      toast('URL copied!', 'ok');
    } catch { toast('Failed to copy', 'err'); }
  });

  // Char counter for notes
  $('notesInput')?.addEventListener('input', () => {
    const len = $('notesInput').value.length;
    const el = $('charCount');
    if (el) el.textContent = len;
  });

  // ── Hunt Product (opens preview modal — user reviews, then saves) ──
  $('autoHuntBtn')?.addEventListener('click', async () => {
    const btn = $('autoHuntBtn');
    const textEl = btn.querySelector('.hunt-title') || btn.querySelector('.hunt-text');
    const origText = textEl?.textContent;
    if (textEl) textEl.textContent = 'Scraping page…';
    btn.disabled = true;
    btn.classList.add('loading');
    showProgress('Connecting to page…', 15);

    const releaseBtn = () => {
      btn.disabled = false;
      btn.classList.remove('loading');
      if (textEl) textEl.textContent = origText || 'Hunt Product';
    };

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) throw new Error('no_tab');

      showProgress('Scraping product data…', 50);

      const scraped = await new Promise((resolve) => {
        let done = false;
        const finish = (v) => { if (!done) { done = true; resolve(v); } };
        const t = setTimeout(() => finish(null), 8000);
        chrome.tabs.sendMessage(tab.id, { action: 'SCRAPE_PAGE' }, (results) => {
          clearTimeout(t);
          if (chrome.runtime.lastError || !results?.success || !results?.data) finish(null);
          else finish(results.data);
        });
      });

      if (!scraped) {
        toast('Cannot hunt this page. Refresh once and try again.', 'warn');
        hideProgress();
        releaseBtn();
        return;
      }

      hideProgress();
      releaseBtn();

      // Open the preview modal pre-populated with scraped data
      openHuntPreviewModal(scraped, tab);

    } catch (e) {
      hideProgress();
      releaseBtn();
      toast('Hunt failed — try manual mode', 'err');
    }
  });

  // ── Image Management (Collect) ───────────────────────────────
  $('addImageUrlBtn')?.addEventListener('click', () => {
    State.imageUrlTarget = 'collect';
    openImageUrlModal();
  });

  $('clearImagesBtn')?.addEventListener('click', () => {
    if (!State.collectImages.length) return;
    showConfirm('Clear Images', 'Remove all product images?', 'Clear', () => {
      State.collectImages = [];
      renderCollectImages();
      toast('Images cleared', 'info');
    });
  });

  // ── Video Management ─────────────────────────────────────────
  $('clearVideoBtn')?.addEventListener('click', () => {
    State.collectVideoUrl = '';
    renderVideoPreview();
    toast('Video removed', 'info');
  });

  // ── Save Link ───────────────────────────────────────────────
  $('addLinkBtn')?.addEventListener('click', handleAddLink);
  urlInput?.addEventListener('keydown', e => {
    if (e.key === 'Enter') handleAddLink();
  });

  // ── Save All Tabs ───────────────────────────────────────────
  $('saveAllTabsBtn')?.addEventListener('click', async () => {
    const folder = $('folderSelect')?.value || 'General';
    showFeedback('Saving all open tabs…', 'info');
    try {
      const res = await msg({ action: 'SAVE_ALL_TABS', folder, tags: [...State.selectedTags] });
      if (res?.success) {
        const saved = res.results?.filter(r => r.success).length || 0;
        await refresh();
        showFeedback(`✓ ${saved} tabs saved to "${folder}"`, 'ok');
        toast(`Saved ${saved} tabs`, 'ok');
      }
    } catch { showFeedback('Failed to save tabs', 'err'); }
  });

  // ── Copy All Tab URLs ───────────────────────────────────────
  $('copyAllTabsBtn')?.addEventListener('click', async () => {
    try {
      const res = await msg({ action: 'COPY_ALL_TABS' });
      if (res?.success && res.urls?.length) {
        await navigator.clipboard.writeText(res.urls.join('\n'));
        toast(`${res.urls.length} URLs copied!`, 'ok');
      } else {
        toast('No valid URLs found', 'warn');
      }
    } catch { toast('Failed to copy URLs', 'err'); }
  });

  // ── Open Clipboard Links ────────────────────────────────────
  $('openClipboardLinksBtn')?.addEventListener('click', async () => {
    try {
      // FIXED: Check clipboard permission before reading
      let permState = 'prompt';
      try {
        const perm = await navigator.permissions.query({ name: 'clipboard-read' });
        permState = perm.state;
      } catch (e) {
        // Some browsers don't support querying clipboard-read
      }
      if (permState === 'denied') {
        toast('Clipboard permission denied. Please allow clipboard access.', 'err');
        return;
      }

      const text = await navigator.clipboard.readText();
      if (!text?.trim()) { toast('Clipboard is empty', 'warn'); return; }
      const lines = text.split('\n').map(l => l.trim()).filter(l => isValidURL(l));
      if (!lines.length) { toast('No valid URLs in clipboard', 'warn'); return; }
      showConfirm(
        'Open Clipboard Links',
        `Open ${lines.length} URL(s) in new tabs?`,
        'Open All',
        () => {
          lines.forEach(url => chrome.tabs.create({ url, active: false }));
          toast(`Opened ${lines.length} tabs`, 'ok');
        }
      );
    } catch { toast('Cannot read clipboard', 'err'); }
  });

  // Apply ripples to all action buttons
  applyRipples();
}

// ── Video Preview Renderer ───────────────────────────────────
function renderVideoPreview() {
  const preview = $('videoPreview');
  const empty = $('videoEmpty');
  const thumb = $('videoThumb');
  const title = $('videoTitle');

  if (!preview || !empty) return;

  if (!State.collectVideoUrl) {
    preview.classList.add('hidden');
    empty.style.display = 'flex';
    if (thumb) thumb.src = '';
    return;
  }

  empty.style.display = 'none';
  preview.classList.remove('hidden');

  // Determine thumbnail
  const ytId = extractYouTubeId(State.collectVideoUrl);
  if (ytId && thumb) {
    thumb.src = getYouTubeThumbnail(ytId);
    if (title) title.textContent = 'YouTube Video';
  } else {
    if (thumb) thumb.src = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360"><rect width="640" height="360" fill="#050816"/><circle cx="320" cy="180" r="58" fill="#06b6d4" opacity=".92"/><path d="M300 145v70l62-35z" fill="white"/></svg>');
    if (title) title.textContent = 'Product Video';
  }
}

// ── Collect Images Renderer ──────────────────────────────────
function renderCollectImages() {
  const grid = $('imagesGrid');
  const emptyState = $('imgEmptyState');
  if (!grid) return;

  Array.from(grid.children).forEach(c => {
    if (c !== emptyState) c.remove();
  });

  if (!State.collectImages.length) {
    if (emptyState) emptyState.style.display = 'flex';
    return;
  }
  if (emptyState) emptyState.style.display = 'none';

  State.collectImages.forEach((imgSrc, idx) => {
    const thumb = buildImageThumb(imgSrc, idx, (i) => {
      State.collectImages.splice(i, 1);
      renderCollectImages();
    });
    grid.appendChild(thumb);
  });
}

function buildImageThumb(imgSrc, idx, onRemove) {
  const wrap = document.createElement('div');
  wrap.className = 'img-thumb-wrap';
  if (idx === 0) wrap.classList.add('img-thumb-primary');

  const img = document.createElement('img');
  img.className = 'img-thumb';
  img.loading = 'lazy';
  img.alt = `Product image ${idx + 1}`;
  if (typeof imgSrc === 'string' && (imgSrc.startsWith('data:image') || imgSrc.startsWith('https'))) {
    img.src = imgSrc;
  }

  const removeBtn = document.createElement('button');
  removeBtn.className = 'img-thumb-remove';
  removeBtn.type = 'button';
  removeBtn.setAttribute('aria-label', `Remove image ${idx + 1}`);
  removeBtn.innerHTML = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
  removeBtn.addEventListener('click', e => {
    e.stopPropagation();
    onRemove(idx);
  });

  if (idx === 0) {
    const badge = document.createElement('span');
    badge.className = 'img-primary-badge';
    badge.textContent = 'Main';
    wrap.appendChild(badge);
  }

  wrap.appendChild(img);
  wrap.appendChild(removeBtn);
  return wrap;
}

// ── Image URL Modal ──────────────────────────────────────────
function openImageUrlModal() {
  const input = $('imageUrlInput');
  if (input) input.value = '';
  $('imageUrlModal')?.classList.remove('hidden');
  setTimeout(() => input?.focus(), 100);
}

function initImageUrlModal() {
  $('closeImageUrlModal')?.addEventListener('click', () => {
    $('imageUrlModal')?.classList.add('hidden');
  });
  $('cancelImageUrl')?.addEventListener('click', () => {
    $('imageUrlModal')?.classList.add('hidden');
  });
  $('confirmImageUrl')?.addEventListener('click', async () => {
    const url = $('imageUrlInput')?.value.trim();
    if (!url || !isValidURL(url)) { toast('Enter a valid image URL', 'warn'); return; }

    const btn = $('confirmImageUrl');
    btn.disabled = true;
    btn.textContent = 'Hunting…';

    const res = await msg({ action: 'FETCH_BASE64', url });
    btn.disabled = false;
    btn.textContent = 'Add Image';
    $('imageUrlModal')?.classList.add('hidden');

    if (res?.success && res.base64) {
      if (State.imageUrlTarget === 'collect') {
        if (State.collectImages.length >= 10) {
          toast('Maximum 10 images allowed', 'warn');
          return;
        }
        State.collectImages.push(res.base64);
        renderCollectImages();
        toast('Image added!', 'ok');
      } else if (State.imageUrlTarget === 'edit') {
        if (State.editImages.length >= 10) {
          toast('Maximum 10 images allowed', 'warn');
          return;
        }
        State.editImages.push(res.base64);
        renderEditImages();
        toast('Image added!', 'ok');
      }
    } else {
      toast('Could not load image — check URL', 'err');
    }
  });

  $('imageUrlInput')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') $('confirmImageUrl')?.click();
  });
}

// ── Category Display ─────────────────────────────────────────
function updateCatDisplay(url) {
  const el = $('detectedCategory');
  if (!el) return;
  if (url && isValidURL(url)) {
    const cat = detectCat(url);
    el.textContent = cat;
    el.className = `cat-badge ${catClass(cat)}`;
  } else {
    el.textContent = 'Auto';
    el.className = 'cat-badge';
  }
}

// ── Feedback ─────────────────────────────────────────────────
function showFeedback(text, type) {
  const el = $('feedback');
  if (!el) return;
  el.textContent = text;
  el.className = `feedback-box visible ${type}`;
  if (type !== 'err') {
    setTimeout(() => { el.className = 'feedback-box'; }, 3500);
  }
}

// ── Handle Add Link ──────────────────────────────────────────
async function handleAddLink() {
  const url    = $('urlInput')?.value.trim();
  const title  = $('titleInput')?.value.trim();
  const notes  = $('notesInput')?.value.trim();
  const price  = $('priceInput')?.value.trim();
  const folder = $('folderSelect')?.value || 'General';

  if (!url) { showFeedback('Please enter a URL', 'err'); return; }
  if (!isValidURL(url)) { showFeedback('Invalid URL — must be http/https', 'err'); return; }

  const btn = $('addLinkBtn');
  btn.disabled = true;
  btn.classList.add('loading');

  try {
    const res = await msg({
      action: 'ADD_LINK',
      url, title, folder, notes,
      tags: [...State.selectedTags],
      images: [...State.collectImages],
      videoUrl: State.collectVideoUrl || '',
      videos: State.collectVideos || [],
      price: price || ''
    });

    if (res?.success) {
      // Reset form completely
      ['urlInput', 'titleInput', 'notesInput', 'priceInput'].forEach(id => {
        const el = $(id);
        if (el) el.value = '';
      });
      State.selectedTags = [];
      State.collectImages = [];
      State.collectVideoUrl = '';
      State.collectVideos = [];
      updateCatDisplay('');
      renderTagsPicker('tagsSelector', State.selectedTags);
      renderCollectImages();
      renderVideoPreview(); // FIXED: clear video preview
      const charEl = $('charCount');
      if (charEl) charEl.textContent = '0';

      await refresh();
      showFeedback(`✓ Product saved to "${folder}"`, 'ok');
      toast('Product saved! 🛍️', 'ok');
      State.openFolders.add(folder);

      // Re-hunt current tab in auto mode
      if (State.inputMode === 'auto') {
        chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
          const tab = tabs?.[0];
          if (tab?.url && isValidURL(tab.url)) {
            const uEl = $('urlInput');
            const tEl = $('titleInput');
            if (uEl) uEl.value = tab.url;
            if (tEl) tEl.value = tab.title || '';
            updateCatDisplay(tab.url);
          }
        });
      }
    } else if (res?.reason === 'duplicate') {
      showFeedback('This link is already saved', 'err');
      toast('Duplicate product', 'warn');
    } else {
      showFeedback('Error saving — try again', 'err');
    }
  } catch (e) {
    showFeedback('Unexpected error', 'err');
  }

  btn.disabled = false;
  btn.classList.remove('loading');
}

// ── Tags Picker ──────────────────────────────────────────────
function renderTagsPicker(containerId, selectedArr, onChangeCb) {
  const container = $(containerId);
  if (!container) return;
  container.innerHTML = '';
  if (!State.data.tags.length) {
    container.innerHTML = '<span class="tags-empty">No tags yet — create some in Folders tab</span>';
    return;
  }
  State.data.tags.forEach(tag => {
    const chip = document.createElement('div');
    chip.className = `tag-chip ${selectedArr.includes(tag) ? 'on' : 'off'}`;
    chip.textContent = tag;
    chip.setAttribute('role', 'checkbox');
    chip.setAttribute('aria-checked', selectedArr.includes(tag) ? 'true' : 'false');
    chip.tabIndex = 0;
    chip.addEventListener('click', () => toggleTag(chip, tag, selectedArr, onChangeCb));
    chip.addEventListener('keydown', e => {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        toggleTag(chip, tag, selectedArr, onChangeCb);
      }
    });
    container.appendChild(chip);
  });
}

function toggleTag(chip, tag, selectedArr, onChangeCb) {
  const idx = selectedArr.indexOf(tag);
  if (idx === -1) selectedArr.push(tag);
  else selectedArr.splice(idx, 1);
  const isOn = selectedArr.includes(tag);
  chip.className = `tag-chip ${isOn ? 'on' : 'off'}`;
  chip.setAttribute('aria-checked', isOn ? 'true' : 'false');
  if (onChangeCb) onChangeCb([...selectedArr]);
}

function syncFolderSelect(selId) {
  const sel = $(selId);
  if (!sel) return;
  const prev = sel.value;
  sel.innerHTML = '';
  State.data.folders.forEach(f => {
    const o = document.createElement('option');
    o.value = f;
    o.textContent = f;
    if (f === prev) o.selected = true;
    sel.appendChild(o);
  });
}

// ── Links Tab ────────────────────────────────────────────────
function initLinksTab() {
  $('searchInput')?.addEventListener('input', debounce(() => {
    const v = $('searchInput')?.value;
    $('searchClear')?.classList.toggle('hidden', !v);
    State.renderPage = 0;
    renderLinksTab();
  }, 220));

  $('searchClear')?.addEventListener('click', () => {
    const si = $('searchInput');
    if (si) si.value = '';
    $('searchClear')?.classList.add('hidden');
    State.renderPage = 0;
    renderLinksTab();
  });

  ['filterCategory', 'filterFolder', 'filterTag'].forEach(id => {
    $(id)?.addEventListener('change', () => {
      State.renderPage = 0;
      renderLinksTab();
    });
  });

  $('viewList')?.addEventListener('click', () => {
    State.view = 'list';
    syncViewButtons();
    saveUIState();
    renderLinksTab();
  });
  $('viewGrid')?.addEventListener('click', () => {
    State.view = 'grid';
    syncViewButtons();
    saveUIState();
    renderLinksTab();
  });

  $('bulkSelectBtn')?.addEventListener('click', () => {
    State.bulkMode = !State.bulkMode;
    if (!State.bulkMode) {
      State.selectedIds.clear();
      $('bulkBar')?.classList.add('hidden');
    }
    $('bulkSelectBtn')?.classList.toggle('active', State.bulkMode);
    $('bulkSelectBtn')?.setAttribute('aria-pressed', State.bulkMode ? 'true' : 'false');
    renderLinksTab();
  });

  $('linksBulkCancelBtn')?.addEventListener('click', () => {
    State.bulkMode = false;
    State.selectedIds.clear();
    $('bulkBar')?.classList.add('hidden');
    $('bulkSelectBtn')?.classList.remove('active');
    $('bulkSelectBtn')?.setAttribute('aria-pressed', 'false');
    renderLinksTab();
  });

  $('bulkDeleteBtn')?.addEventListener('click', () => {
    if (!State.selectedIds.size) return;
    showConfirm(
      'Delete Selected',
      `Permanently delete ${State.selectedIds.size} product(s)?`,
      'Delete',
      async () => {
        const ids = [...State.selectedIds];
        await Promise.all(ids.map(id => msg({ action: 'REMOVE_LINK', id })));
        State.selectedIds.clear();
        State.bulkMode = false;
        $('bulkBar')?.classList.add('hidden');
        $('bulkSelectBtn')?.classList.remove('active');
        await refresh();
        toast(`${ids.length} product(s) deleted`, 'info');
      }
    );
  });

  $('bulkExportBtn')?.addEventListener('click', () => {
    if (!State.selectedIds.size) return;
    const selected = State.data.links.filter(l => State.selectedIds.has(l.id));
    exportLinksAsHtml(selected, 'zhunter-selected-products.html');
    toast(`Exported ${selected.length} products`, 'ok');
  });

  $('clearAllBtn')?.addEventListener('click', () => {
    if (!State.data.links.length) return;
    showConfirm(
      'Clear All Products',
      `This will permanently delete all ${State.data.links.length} saved products. This cannot be undone.`,
      'Delete All',
      async () => {
        await msg({ action: 'CLEAR_ALL' });
        await refresh();
        toast('All products cleared', 'info');
      }
    );
  });
}

// ── Filter Logic ─────────────────────────────────────────────
function getFiltered() {
  const q   = $('searchInput')?.value.toLowerCase().trim() || '';
  const cat = $('filterCategory')?.value || '';
  const fol = $('filterFolder')?.value || '';
  const tag = $('filterTag')?.value || '';

  return State.data.links.filter(l => {
    const matchQ = !q || (
      (l.title || '').toLowerCase().includes(q) ||
      (l.url || '').toLowerCase().includes(q) ||
      (l.category || '').toLowerCase().includes(q) ||
      (l.notes || '').toLowerCase().includes(q) ||
      (l.price || '').toLowerCase().includes(q) ||
      (l.tags || []).some(t => t.toLowerCase().includes(q))
    );
    return matchQ &&
      (!cat || l.category === cat) &&
      (!fol || l.folder === fol) &&
      (!tag || (l.tags || []).includes(tag));
  });
}

// ── Links Renderer (paginated) ───────────────────────────────
function renderLinksTab() {
  const container  = $('linksContainer');
  const emptyState = $('emptyState');
  const countEl    = $('resultsCount');
  if (!container) return;

  const filtered = getFiltered();
  if (countEl) countEl.textContent = `${filtered.length} product${filtered.length !== 1 ? 's' : ''}`;

  // Clear old cards but keep emptyState
  Array.from(container.children).forEach(c => {
    if (c.id !== 'emptyState') c.remove();
  });

  if (!filtered.length) {
    if (emptyState) emptyState.style.display = 'flex';
    return;
  }
  if (emptyState) emptyState.style.display = 'none';

  // FIXED: apply grid class to container directly
  container.classList.toggle('grid', State.view === 'grid');
  container.classList.toggle('bulk-mode', State.bulkMode);

  const visible = filtered.slice(0, (State.renderPage + 1) * State.PAGE_SIZE);
  const frag = document.createDocumentFragment();
  visible.forEach(link => frag.appendChild(buildLinkCard(link)));

  if (visible.length < filtered.length) {
    const more = document.createElement('button');
    more.className = 'load-more-btn';
    more.type = 'button';
    more.textContent = `Load more (${filtered.length - visible.length} remaining)`;
    more.addEventListener('click', () => {
      State.renderPage++;
      renderLinksTab();
    });
    frag.appendChild(more);
  }

  container.appendChild(frag);
  updateBulkBar();
}

function updateBulkBar() {
  const count = State.selectedIds.size;
  const bulkCountEl = $('bulkCount');
  if (bulkCountEl) bulkCountEl.textContent = `${count} selected`;
  const bulkBar = $('bulkBar');
  if (!State.bulkMode || count === 0) {
    bulkBar?.classList.add('hidden');
  } else {
    bulkBar?.classList.remove('hidden');
  }
}

// ── Link Card Builder ─────────────────────────────────────────
function buildLinkCard(link) {
  const card = document.createElement('div');
  card.className = `link-card${State.selectedIds.has(link.id) ? ' selected' : ''}`;
  card.dataset.id = link.id;
  card.setAttribute('role', 'listitem');

  // Checkbox
  const cbWrap = document.createElement('div');
  cbWrap.className = 'lc-cb-wrap';
  const cb = document.createElement('div');
  cb.className = `lc-cb${State.selectedIds.has(link.id) ? ' checked' : ''}`;
  cb.setAttribute('role', 'checkbox');
  cb.setAttribute('aria-checked', State.selectedIds.has(link.id) ? 'true' : 'false');
  cb.setAttribute('aria-label', `Select ${link.title}`);
  cb.tabIndex = 0;

  const toggleSelect = e => {
    e?.stopPropagation();
    if (State.selectedIds.has(link.id)) {
      State.selectedIds.delete(link.id);
      cb.classList.remove('checked');
      card.classList.remove('selected');
      cb.setAttribute('aria-checked', 'false');
    } else {
      State.selectedIds.add(link.id);
      cb.classList.add('checked');
      card.classList.add('selected');
      cb.setAttribute('aria-checked', 'true');
    }
    updateBulkBar();
  };
  cb.addEventListener('click', toggleSelect);
  cb.addEventListener('keydown', e => {
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggleSelect(); }
  });
  cbWrap.appendChild(cb);



  // Body
  const body = document.createElement('div');
  body.className = 'lc-body';

  const titleEl = document.createElement('div');
  titleEl.className = 'lc-title';
  titleEl.textContent = trunc(link.title || link.url, 60);
  titleEl.addEventListener('click', () => chrome.tabs.create({ url: link.url }));

  const urlEl = document.createElement('div');
  urlEl.className = 'lc-url';
  urlEl.textContent = trunc(link.url, 55);
  urlEl.title = link.url;

  const meta = document.createElement('div');
  meta.className = 'lc-meta';

  const foldPill = document.createElement('span');
  foldPill.className = 'meta-pill mp-fold';
  foldPill.textContent = `📁 ${link.folder}`;
  meta.appendChild(foldPill);

  if (link.price) {
    const pricePill = document.createElement('span');
    pricePill.className = 'meta-pill mp-price';
    pricePill.textContent = `💰 ${link.price}`;
    meta.appendChild(pricePill);
  }

  // Video badge
  if (link.videoUrl) {
    const vidPill = document.createElement('span');
    vidPill.className = 'meta-pill mp-video';
    vidPill.textContent = '▶ Video';
    meta.appendChild(vidPill);
  }

  (link.tags || []).slice(0, 3).forEach(t => {
    const tp = document.createElement('span');
    tp.className = 'meta-pill mp-tag';
    tp.textContent = t;
    meta.appendChild(tp);
  });

  const dateEl = document.createElement('span');
  dateEl.className = 'lc-date';
  dateEl.textContent = fmtDate(link.dateAdded);
  meta.appendChild(dateEl);

  body.appendChild(titleEl);
  body.appendChild(urlEl);

  if (link.notes) {
    const notesEl = document.createElement('div');
    notesEl.className = 'lc-notes';
    notesEl.textContent = trunc(link.notes, 100);
    body.appendChild(notesEl);
  }
  body.appendChild(meta);

  // Actions
  const actions = document.createElement('div');
  actions.className = 'lc-actions';

  const SVG = {
    open: `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`,
    edit: `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`,
    share:`<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>`,
    down: `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`,
    del:  `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>`
  };

  const openBtn = makeBtn('lc-btn open', 'Open URL', SVG.open);
  openBtn.addEventListener('click', e => {
    e.stopPropagation();
    chrome.tabs.create({ url: link.url });
  });
  openBtn.addEventListener('focus', () => {});

  const editBtn = makeBtn('lc-btn edit', 'Edit Product', SVG.edit);
  editBtn.addEventListener('click', e => { e.stopPropagation(); openEditModal(link); });

  const shareBtn = makeBtn('lc-btn share', 'Share Product', SVG.share);
  shareBtn.addEventListener('click', async e => {
    e.stopPropagation();
    const text = `${link.title}\nPrice: ${link.price || 'N/A'}\n${link.url}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: link.title, url: link.url, text: `Check out this product: ${link.price || ''}` });
      } else {
        await navigator.clipboard.writeText(text);
        toast('Copied to clipboard', 'ok');
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        try {
          await navigator.clipboard.writeText(text);
          toast('Copied to clipboard', 'ok');
        } catch {
          toast('Failed to share', 'err');
        }
      }
    }
  });

  const downBtn = makeBtn('lc-btn down', 'Export Product', SVG.down);
  downBtn.addEventListener('click', e => {
    e.stopPropagation();
    exportLinksAsHtml([link], `product-${link.id.slice(0, 8)}.html`);
    toast('Product exported', 'ok');
  });

  const delBtn = makeBtn('lc-btn del', 'Delete Product', SVG.del);
  delBtn.addEventListener('click', e => {
    e.stopPropagation();
    showConfirm(
      'Delete Product',
      `Delete "${trunc(link.title, 50)}"?`,
      'Delete',
      async () => {
        await msg({ action: 'REMOVE_LINK', id: link.id });
        await refresh();
        toast('Product deleted', 'info');
      }
    );
  });

  // Focus-visible on all action buttons
  [openBtn, editBtn, shareBtn, downBtn, delBtn].forEach(b => {
    b.addEventListener('focus', () => b.classList.add('focus-visible'));
    b.addEventListener('blur', () => b.classList.remove('focus-visible'));
  });

  actions.append(openBtn, editBtn, shareBtn, downBtn, delBtn);
  card.append(cbWrap, body, actions);
  return card;
}

// ── Filter Dropdowns ─────────────────────────────────────────
function syncFilterDropdowns() {
  const cats = [...new Set(State.data.links.map(l => l.category).filter(Boolean))].sort();
  const fols = [...new Set(State.data.links.map(l => l.folder).filter(Boolean))].sort();
  const tags = [...new Set(State.data.links.flatMap(l => l.tags || []).filter(Boolean))].sort();
  syncFilter('filterCategory', cats, 'All Categories');
  syncFilter('filterFolder',   fols, 'All Folders');
  syncFilter('filterTag',      tags, 'All Tags');
}

function syncFilter(selId, values, placeholder) {
  const sel = $(selId);
  if (!sel) return;
  const prev = sel.value;
  sel.innerHTML = `<option value="">${placeholder}</option>`;
  values.forEach(v => {
    const o = document.createElement('option');
    o.value = v;
    o.textContent = v;
    if (v === prev) o.selected = true;
    sel.appendChild(o);
  });
}

// ── Folders Tab ───────────────────────────────────────────────
function initFoldersTab() {
  // New Folder — inline
  const confirmFolder = async () => {
    const name = $('newFolderInput')?.value.trim();
    if (!name) { toast('Enter a folder name', 'warn'); return; }
    const res = await msg({ action: 'ADD_FOLDER', folder: name });
    const el = $('newFolderInput');
    if (el) el.value = '';
    if (res?.success) {
      State.openFolders.add(name);
      await refresh();
      toast(`Folder "${name}" created`, 'ok');
    } else {
      toast(res?.reason === 'duplicate' ? 'Folder already exists' : 'Error creating folder', 'err');
    }
  };
  $('newFolderBtn')?.addEventListener('click', confirmFolder);
  $('newFolderInput')?.addEventListener('keydown', e => { if (e.key === 'Enter') confirmFolder(); });

  // New Tag — inline
  const confirmTag = async () => {
    const name = $('newTagInput')?.value.trim();
    if (!name) { toast('Enter a tag name', 'warn'); return; }
    const res = await msg({ action: 'ADD_TAG', tag: name });
    const el = $('newTagInput');
    if (el) el.value = '';
    if (res?.success) {
      await refresh();
      toast(`Tag "${name}" added`, 'ok');
    } else {
      toast(res?.reason === 'duplicate' ? 'Tag already exists' : 'Error adding tag', 'err');
    }
  };
  $('newTagBtn')?.addEventListener('click', confirmTag);
  $('newTagInput')?.addEventListener('keydown', e => { if (e.key === 'Enter') confirmTag(); });

  // Search
  $('folderLinkSearch')?.addEventListener('input', debounce(() => {
    State.folderSearch = $('folderLinkSearch')?.value.toLowerCase().trim() || '';
    renderFolderAccordion();
  }, 220));
}

// ── Folder Accordion ──────────────────────────────────────────
function renderFolderAccordion() {
  const container = $('folderAccordion');
  if (!container) return;
  container.innerHTML = '';

  State.data.folders.forEach(folderName => {
    const allLinks    = State.data.links.filter(l => l.folder === folderName);
    const isProtected = folderName === 'General';
    const isOpen      = State.openFolders.has(folderName);
    const filtered    = State.folderSearch
      ? allLinks.filter(l =>
          (l.title || '').toLowerCase().includes(State.folderSearch) ||
          (l.url || '').toLowerCase().includes(State.folderSearch) ||
          (l.tags || []).some(t => t.toLowerCase().includes(State.folderSearch))
        )
      : allLinks;

    const item = document.createElement('div');
    item.className = `folder-item${isOpen ? ' open' : ''}`;
    item.dataset.folder = folderName;
    item.setAttribute('role', 'listitem');

    const header = document.createElement('div');
    header.className = 'folder-header';

    const chevron = document.createElement('div');
    chevron.className = 'folder-chevron';
    chevron.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>`;

    const ico = document.createElement('div');
    ico.className = 'folder-ico-badge';
    ico.textContent = '📁';

    const meta = document.createElement('div');
    meta.className = 'folder-meta';
    const lbl = document.createElement('div');
    lbl.className = 'folder-label';
    lbl.textContent = folderName;
    const ct = document.createElement('div');
    ct.className = 'folder-ct-badge';
    ct.textContent = allLinks.length;
    meta.append(lbl, ct);

    const acts = document.createElement('div');
    acts.className = 'folder-acts';

    const dlBtn = document.createElement('button');
    dlBtn.className = 'folder-act-btn dl-btn';
    dlBtn.type = 'button';
    dlBtn.title = 'Export folder';
    dlBtn.setAttribute('aria-label', `Export ${folderName} folder`);
    dlBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;
    dlBtn.addEventListener('click', e => {
      e.stopPropagation();
      if (!allLinks.length) { toast('Folder is empty', 'warn'); return; }
      exportLinksAsHtml(allLinks, `zhunter-${folderName.replace(/\s+/g, '-')}.html`);
      toast('Folder exported!', 'ok');
    });
    acts.appendChild(dlBtn);

    if (!isProtected) {
      const delBtn = document.createElement('button');
      delBtn.className = 'folder-act-btn del-btn';
      delBtn.type = 'button';
      delBtn.title = 'Delete folder';
      delBtn.setAttribute('aria-label', `Delete ${folderName} folder`);
      delBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
      delBtn.addEventListener('click', e => {
        e.stopPropagation();
        showConfirm(
          'Delete Folder',
          `Delete "${folderName}"? All ${allLinks.length} products will move to General.`,
          'Delete',
          async () => {
            await msg({ action: 'REMOVE_FOLDER', folder: folderName });
            State.openFolders.delete(folderName);
            await refresh();
            toast('Folder deleted', 'info');
          }
        );
      });
      acts.appendChild(delBtn);
    }

    header.append(chevron, ico, meta, acts);
    header.addEventListener('click', e => {
      if (e.target.closest('.folder-acts')) return;
      if (State.openFolders.has(folderName)) {
        State.openFolders.delete(folderName);
        item.classList.remove('open');
      } else {
        State.openFolders.add(folderName);
        item.classList.add('open');
      }
    });

    const content = document.createElement('div');
    content.className = 'folder-content';

    const toolbar = document.createElement('div');
    toolbar.className = 'folder-toolbar';
    const tbCount = document.createElement('span');
    tbCount.className = 'folder-tb-count';
    tbCount.textContent = `${allLinks.length} product${allLinks.length !== 1 ? 's' : ''}`;
    const tbDl = document.createElement('button');
    tbDl.className = 'folder-dl-btn';
    tbDl.type = 'button';
    tbDl.textContent = 'Export Folder';
    tbDl.addEventListener('click', () => {
      if (!allLinks.length) return;
      exportLinksAsHtml(allLinks, `zhunter-${folderName.replace(/\s+/g, '-')}.html`);
      toast('Exported!', 'ok');
    });
    toolbar.append(tbCount, tbDl);
    content.appendChild(toolbar);

    const list = document.createElement('div');
    list.className = 'folder-links-list';
    if (!filtered.length) {
      const empty = document.createElement('div');
      empty.className = 'folder-empty-msg';
      empty.textContent = State.folderSearch ? 'No matching products' : 'No products in this folder';
      list.appendChild(empty);
    } else {
      filtered.forEach(link => list.appendChild(buildFolderLinkRow(link)));
    }
    content.appendChild(list);
    item.append(header, content);
    container.appendChild(item);
  });
}

function buildFolderLinkRow(link) {
  const row = document.createElement('div');
  row.className = 'folder-link-row';
  row.setAttribute('role', 'listitem');

  const images = Array.isArray(link.images) && link.images.length > 0 ? link.images : [];
  const imgSrc = images[0] || link.base64Image || (Array.isArray(link.imageUrls) && link.imageUrls[0]) || link.favicon || '';

  const fav = document.createElement('img');
  fav.className = 'flr-fav';
  fav.loading = 'lazy';
  fav.alt = '';
  fav.onerror = () => { fav.style.display = 'none'; };
  if (imgSrc && (imgSrc.startsWith('data:image') || imgSrc.startsWith('https') || imgSrc.startsWith('http'))) {
    fav.src = imgSrc;
  }

  const info = document.createElement('div');
  info.className = 'flr-info';
  const titleEl = document.createElement('div');
  titleEl.className = 'flr-title';
  titleEl.textContent = trunc(link.title || link.url, 42);
  titleEl.addEventListener('click', () => chrome.tabs.create({ url: link.url }));
  const urlEl = document.createElement('div');
  urlEl.className = 'flr-url';
  urlEl.textContent = trunc(link.url, 40);
  info.append(titleEl, urlEl);

  const btns = document.createElement('div');
  btns.className = 'flr-btns';

  const editBtn = makeBtn('flr-btn edit', 'Edit', `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`);
  editBtn.addEventListener('click', () => openEditModal(link));

  const delBtn = makeBtn('flr-btn del', 'Delete', `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>`);
  delBtn.addEventListener('click', () => {
    showConfirm('Delete Product', `Delete "${trunc(link.title, 40)}"?`, 'Delete', async () => {
      await msg({ action: 'REMOVE_LINK', id: link.id });
      await refresh();
      toast('Deleted', 'info');
    });
  });

  btns.append(editBtn, delBtn);
  row.append(fav, info, btns);
  return row;
}

// ── Tags Manage ───────────────────────────────────────────────
function renderTagsManage() {
  const list = $('tagsManageList');
  if (!list) return;
  list.innerHTML = '';

  // Wire up "Clear All Tags" button every render
  const clearAllBtn = $('clearAllTagsBtn');
  if (clearAllBtn) {
    // Remove old listener to prevent duplicates
    clearAllBtn.replaceWith(clearAllBtn.cloneNode(true));
    const freshBtn = $('clearAllTagsBtn');
    freshBtn.addEventListener('click', () => {
      if (!State.data.tags.length) { toast('No tags to delete', 'warn'); return; }
      showConfirm(
        'Clear All Tags',
        `Delete all ${State.data.tags.length} tags? This will remove them from every product too.`,
        'Delete All',
        async () => {
          const tagsToDelete = [...State.data.tags];
          for (const tag of tagsToDelete) {
            await msg({ action: 'REMOVE_TAG', tag });
          }
          await refresh();
          toast(`All ${tagsToDelete.length} tags deleted`, 'ok');
        }
      );
    });
  }

  if (!State.data.tags.length) {
    list.innerHTML = '<div class="folder-empty-msg">No tags yet — create your first tag above</div>';
    return;
  }
  State.data.tags.forEach(tag => {
    const pill = document.createElement('div');
    pill.className = 'tag-pill';
    pill.setAttribute('role', 'listitem');
    const span = document.createElement('span');
    span.textContent = `🏷 ${tag}`;
    const del = document.createElement('button');
    del.className = 'tag-del';
    del.type = 'button';
    del.setAttribute('aria-label', `Delete tag ${tag}`);
    del.textContent = '✕';
    del.addEventListener('click', () => {
      showConfirm('Delete Tag', `Remove tag "${tag}" from all products?`, 'Delete', async () => {
        await msg({ action: 'REMOVE_TAG', tag });
        await refresh();
        toast(`Tag "${tag}" removed`, 'info');
      });
    });
    pill.append(span, del);
    list.appendChild(pill);
  });
}

// ── Export Tab ────────────────────────────────────────────────
function initExportTab() {
  $('exportHtmlBtn')?.addEventListener('click', () => doExportHtml());
  $('exportTxtBtn')?.addEventListener('click', () => doExportTxt());

  $('exportJsonBtn')?.addEventListener('click', () => doExportJson());
  $('exportMdBtn')?.addEventListener('click', () => doExportMd());
  $('copyAllBtn')?.addEventListener('click', () => doCopyAll());
}

function updateExportStats() {
  const el1 = $('expTotal');
  const el2 = $('expFolders');
  const el3 = $('expCats');
  if (el1) el1.textContent = State.data.links.length;
  if (el2) el2.textContent = State.data.folders.length;
  if (el3) el3.textContent = new Set(State.data.links.map(l => l.category)).size;
}

function doExportTxt() {
  if (!State.data.links.length) { toast('No products to export', 'warn'); return; }
  let txt = `ZHunter Iras — Product Collection\nExported: ${new Date().toLocaleString()}\n${'─'.repeat(50)}\n\n`;
  State.data.links.forEach((l, i) => {
    txt += `[${i + 1}] ${l.title}\n`;
    txt += `URL: ${l.url}\n`;
    if (l.price) txt += `Price: ${l.price}\n`;
    txt += `Folder: ${l.folder} | Category: ${l.category}\n`;
    if (l.tags?.length) txt += `Tags: ${l.tags.join(', ')}\n`;
    if (l.videoUrl) txt += `Video: ${l.videoUrl}\n`;
    if (l.notes) txt += `Notes: ${l.notes}\n`;
    txt += `Saved: ${fmtDate(l.dateAdded)}\n\n`;
  });
  dlFile(txt, 'zhunter-products.txt', 'text/plain');
  toast('TXT exported', 'ok');
}


function doExportJson() {
  if (!State.data.links.length) { toast('No products to export', 'warn'); return; }
  const clean = State.data.links.map(l => ({
    ...l,
    images: (l.images || []).map((_, i) => `[image_${i + 1}_base64_omitted]`),
    base64Image: l.base64Image ? '[base64_omitted]' : ''
  }));
  dlFile(
    JSON.stringify({
      exported: new Date().toISOString(),
      version: `v${APP_VERSION}`,
      links: clean,
      folders: State.data.folders,
      tags: State.data.tags
    }, null, 2),
    'zhunter-products.json',
    'application/json'
  );
  toast('JSON exported', 'ok');
}

function doExportMd() {
  if (!State.data.links.length) { toast('No products to export', 'warn'); return; }
  let md = `# ZHunter Iras — Product Collection\n\n> Exported: ${new Date().toLocaleString()}\n\n`;
  const byFolder = {};
  State.data.links.forEach(l => { (byFolder[l.folder] = byFolder[l.folder] || []).push(l); });
  Object.entries(byFolder).forEach(([folder, links]) => {
    md += `## 📁 ${folder}\n\n`;
    links.forEach(l => {
      md += `### [${l.title}](${l.url})\n`;
      if (l.price) md += `**Price:** ${l.price}  \n`;
      md += `**Category:** ${l.category} | **Saved:** ${fmtDate(l.dateAdded)}  \n`;
      if (l.tags?.length) md += `**Tags:** ${l.tags.map(t => `\`${t}\``).join(' ')}  \n`;
      if (l.videoUrl) md += `**Video:** [Watch](${l.videoUrl})  \n`;
      if (l.notes) md += `\n${l.notes}\n`;
      md += '\n---\n\n';
    });
  });
  dlFile(md, 'zhunter-products.md', 'text/markdown');
  toast('Markdown exported', 'ok');
}

async function doCopyAll() {
  if (!State.data.links.length) { toast('No URLs to copy', 'warn'); return; }
  await navigator.clipboard.writeText(State.data.links.map(l => l.url).join('\n'));
  toast(`${State.data.links.length} URLs copied!`, 'ok');
}

function doExportHtml() {
  if (!State.data.links.length) { toast('No products to export', 'warn'); return; }
  exportLinksAsHtml(State.data.links, 'zhunter-catalog.html');
}

// ── HTML Export Engine ────────────────────────────────────────
function exportLinksAsHtml(linksArr, filename) {
  const byFolder = {};
  linksArr.forEach(l => { (byFolder[l.folder] = byFolder[l.folder] || []).push(l); });

  const folderSections = Object.entries(byFolder).map(([folder, fLinks]) => {
    const cards = fLinks.map(l => {
      const images = Array.isArray(l.imageUrls) && l.imageUrls.length > 0
        ? l.imageUrls
        : Array.isArray(l.images) && l.images.length > 0
          ? l.images
          : (l.base64Image ? [l.base64Image] : []);
      const safeUrl   = safeHref(l.url);
      const safeTitle = esc(l.title || l.url);
      const safeNotes = esc(l.notes || '').replace(/\n/g, '<br>');
      const safePrice = esc(l.price || '');
      const safeCat   = esc(l.category || 'Other');
      const safeTags  = (l.tags || []).map(t => `<span class="tag">${esc(t)}</span>`).join('');
      const safeDate  = esc(fmtDate(l.dateAdded));
      const safeVideoUrl = l.videoUrl ? esc(l.videoUrl) : '';

      // Image gallery — omit huge base64 from src to keep file manageable
      const imgGallery = images.length > 0
        ? `<div class="img-gallery">
            <div class="img-main-wrap">
              <img class="img-main" src="${esc(images[0])}" alt="${safeTitle}" loading="lazy" onerror="this.style.display='none'"/>
            </div>
            ${images.length > 1
              ? `<div class="img-thumbs">${images.slice(1, 6).map((src, i) =>
                  `<img class="img-thumb-exp" src="${esc(src)}" alt="Image ${i + 2}" loading="lazy"
                   onclick="switchImg(this,'${esc(images[0])}')" onerror="this.style.display='none'"/>`
                ).join('')}</div>`
              : ''}
           </div>`
        : `<div class="img-placeholder"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#475569" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg><span>No Image</span></div>`;

      // Video section — YouTube uses thumbnail + button to avoid embed Error 153
      let videoSection = '';
      if (safeVideoUrl) {
        const ytMatch = (safeVideoUrl.match(/[?&]v=([^&]+)/) || safeVideoUrl.match(/youtu\.be\/([^?&/]+)/) || safeVideoUrl.match(/embed\/([^?&/]+)/) || safeVideoUrl.match(/shorts\/([^?&/]+)/));
        const isYT = !!ytMatch || safeVideoUrl.includes('youtube.com') || safeVideoUrl.includes('youtu.be');
        if (isYT) {
          const ytId = ytMatch ? ytMatch[1] : '';
          const thumbUrl = ytId ? `https://img.youtube.com/vi/${ytId}/hqdefault.jpg` : '';
          videoSection = `
          <div class="video-section yt-video-card">
            ${thumbUrl ? `<img class="yt-video-thumb" src="${thumbUrl}" alt="YouTube thumbnail" loading="lazy"/>` : ''}
            <a class="yt-play-btn" href="${safeVideoUrl}" target="_blank" rel="noopener">▶ Watch Video on YouTube</a>
          </div>`;
        } else {
          videoSection = `
          <div class="video-section">
            <video controls class="video-player" preload="metadata" poster="${images[0] ? esc(images[0]) : ''}">
              <source src="${safeVideoUrl}" />
              Your browser does not support video playback.
            </video>
          </div>`;
        }
      }

      // Download buttons - user can choose: ZIP or individual files
      const downloadableImgs = images.filter(s => typeof s === 'string' && s.length > 0);
      const safeName = (l.title || 'product').substring(0, 40)
        .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'product';
      const encodedImgs = safeEncode(downloadableImgs);
      const dlAllBtn = downloadableImgs.length > 0
        ? '<div class="dl-btn-row">'
          + '<button class="btn btn-dl btn-zip" onclick="downloadCardImagesAsZip(this, safeDecode(\'' + encodedImgs + '\'),' + " '" + safeName + "'" + ')">ZIP (' + downloadableImgs.length + ')</button>'
          + '<button class="btn btn-dl btn-individual" onclick="downloadCardImages(this, safeDecode(\'' + encodedImgs + '\'),' + " '" + safeName + "'" + ')">Individual (' + downloadableImgs.length + ')</button>'
          + '</div>'
        : '';

      return `
      <div class="card" id="card-${esc(l.id)}">
        ${imgGallery}
        ${videoSection}
        <div class="card-body">
          <div class="card-cat">${safeCat}</div>
          <div class="card-title-row">
            <a href="${safeUrl}" target="_blank" rel="noopener noreferrer" class="card-title">${safeTitle}</a>
            <button class="copy-btn" data-copy-text="${esc(l.title || l.url).replace(/\r/g, '&#13;').replace(/\n/g, '&#10;')}" title="Copy title">📋</button>
          </div>
          ${safePrice ? `<div class="card-price">${safePrice}</div>` : ''}
          ${safeNotes
            ? `<div class="card-notes-wrap">
                <div class="card-notes" id="notes-${esc(l.id)}">${safeNotes}</div>
                <button class="copy-desc-btn" onclick="copyText(document.getElementById('notes-${esc(l.id)}').innerText, this)">📋 Copy Description</button>
               </div>`
            : ''}
          ${safeTags ? `<div class="card-tags">${safeTags}</div>` : ''}
          <div class="card-meta">
            <span>📅 ${safeDate}</span>
            <span>📁 ${esc(l.folder)}</span>
            ${safeVideoUrl ? '<span>▶ Has Video</span>' : ''}
          </div>
          <div class="btn-row">
            <a href="${safeUrl}" target="_blank" rel="noopener noreferrer" class="btn btn-view">🔗 View Product</a>
            ${dlAllBtn}
            <button onclick="removeCard('${esc(l.id)}')" class="btn btn-rm">✕ Remove</button>
          </div>
        </div>
      </div>`;
    }).join('');

    return `
    <section class="folder-section" data-folder="${esc(folder)}">
      <div class="folder-header-exp">
        <span class="folder-icon">📁</span>
        <h2>${esc(folder)}</h2>
        <span class="folder-count">${fLinks.length} product${fLinks.length !== 1 ? 's' : ''}</span>
      </div>
      <div class="cards-grid">${cards}</div>
    </section>`;
  }).join('');

  const totalProducts = linksArr.length;
  const totalFolders  = Object.keys(byFolder).length;
  const totalCats     = new Set(linksArr.map(l => l.category)).size;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>ZHunter Iras — Product Catalog</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#050816;--surface:#0a0f24;--card:#0e1530;--border:#1a2347;
  --theme:#06b6d4;--theme-soft:rgba(6,182,212,0.12);--theme-glow:rgba(6,182,212,0.35);
  --text1:#fafafa;--text2:#d4d4d8;--text3:#a1a1aa;--text4:#71717a;
  --green:#10b981;--blue:#3b82f6;--red:#ef4444;--orange:#f59e0b;
}
body{font-family:system-ui,-apple-system,sans-serif;background:var(--bg);color:var(--text1);min-height:100vh}
a{color:inherit;text-decoration:none}
.site-header{background:linear-gradient(135deg,#0f0f1a,#1a0a12);border-bottom:1px solid var(--border);padding:24px 40px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:16px}
.site-title{font-size:26px;font-weight:900;background:linear-gradient(135deg,#ffffff,#67e8f9,#06b6d4);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.site-meta{font-size:12px;color:var(--text3);margin-top:4px}
.site-stats{display:flex;gap:16px;flex-wrap:wrap}
.stat-box{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:10px 18px;text-align:center}
.stat-box .num{font-size:22px;font-weight:900;color:var(--theme)}
.stat-box .lbl{font-size:10px;color:var(--text4);text-transform:uppercase;letter-spacing:1px}
.search-bar{padding:16px 40px;background:var(--surface);border-bottom:1px solid var(--border);display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.search-inp{flex:1;min-width:200px;padding:10px 16px;background:var(--card);border:1px solid var(--border);border-radius:10px;color:var(--text1);font-size:13px;outline:none}
.search-inp:focus{border-color:var(--theme)}
.filter-sel{padding:10px 12px;background:var(--card);border:1px solid var(--border);border-radius:10px;color:var(--text1);font-size:12px;cursor:pointer;outline:none}
.container{max-width:1400px;margin:0 auto;padding:28px 40px}
.folder-section{margin-bottom:44px}
.folder-header-exp{display:flex;align-items:center;gap:10px;margin-bottom:18px;padding-bottom:12px;border-bottom:1px solid var(--border)}
.folder-icon{font-size:20px}
.folder-header-exp h2{font-size:18px;font-weight:800;color:var(--text1)}
.folder-count{background:var(--theme-soft);color:var(--theme);border:1px solid var(--theme-glow);padding:2px 10px;border-radius:999px;font-size:11px;font-weight:700;margin-left:auto}
.cards-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:18px}
.card{background:var(--card);border:1px solid var(--border);border-radius:16px;overflow:hidden;display:flex;flex-direction:column;transition:all 0.25s}
.card:hover{border-color:rgba(225,29,72,0.35);box-shadow:0 8px 32px rgba(225,29,72,0.12);transform:translateY(-2px)}
.card.removing{animation:cardRemove 0.35s ease forwards}
@keyframes cardRemove{to{opacity:0;transform:scale(0.92) translateY(10px)}}
.img-gallery{background:#0a0a0f}
.img-main-wrap{width:100%;aspect-ratio:4/3;overflow:hidden;background:#0d0d14;display:flex;align-items:center;justify-content:center}
.img-main{width:100%;height:100%;object-fit:contain;transition:transform 0.3s;cursor:zoom-in}
.img-main:hover{transform:scale(1.05)}
.img-thumbs{display:flex;gap:5px;padding:6px;background:#0d0d14;overflow-x:auto;scrollbar-width:thin}
.img-thumb-exp{width:52px;height:52px;object-fit:cover;border-radius:6px;cursor:pointer;border:2px solid transparent;transition:all 0.2s;flex-shrink:0}
.img-thumb-exp:hover{border-color:var(--theme)}
.img-placeholder{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:36px;background:#0d0d14;color:var(--text4);font-size:11px}
.video-section{background:#0a0a0f;padding:6px}
.video-iframe{width:100%;aspect-ratio:16/9;border-radius:8px;display:block}
.video-player{width:100%;aspect-ratio:16/9;border-radius:8px;background:#000;display:block}
.card-body{padding:14px;display:flex;flex-direction:column;gap:8px;flex:1}
.card-cat{display:inline-block;padding:2px 9px;border-radius:999px;font-size:9px;font-weight:700;background:var(--theme-soft);color:var(--theme);border:1px solid var(--theme-glow);width:fit-content}
.card-title-row{display:flex;align-items:flex-start;gap:8px}
.card-title{font-size:14px;font-weight:700;color:var(--text1);line-height:1.4;flex:1;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.card-title:hover{color:#67e8f9}
.copy-btn{background:none;border:none;cursor:pointer;font-size:13px;padding:2px 4px;border-radius:4px;color:var(--text3);flex-shrink:0;transition:all 0.15s}
.copy-btn:hover{background:rgba(255,255,255,0.08);color:var(--text1)}
.card-price{font-size:17px;font-weight:800;color:var(--green)}
.card-notes-wrap{background:rgba(255,255,255,0.03);border-radius:8px;padding:8px 10px;border:1px solid var(--border)}
.card-notes{font-size:12px;color:var(--text2);line-height:1.6;display:-webkit-box;-webkit-line-clamp:5;-webkit-box-orient:vertical;overflow:hidden;white-space:pre-wrap;margin-bottom:6px}
.copy-desc-btn{background:rgba(6,182,212,0.1);border:1px solid rgba(6,182,212,0.25);color:#67e8f9;border-radius:6px;padding:4px 10px;font-size:10px;font-weight:700;cursor:pointer;transition:all 0.15s;width:100%}
.copy-desc-btn:hover{background:rgba(225,29,72,0.2)}
.card-tags{display:flex;flex-wrap:wrap;gap:4px}
.tag{padding:2px 8px;border-radius:999px;font-size:10px;font-weight:600;background:rgba(6,182,212,0.12);color:#67e8f9;border:1px solid rgba(6,182,212,0.22)}
.card-meta{display:flex;gap:10px;font-size:10px;color:var(--text4);margin-top:auto;padding-top:6px;border-top:1px solid var(--border);flex-wrap:wrap}
.btn-row{display:flex;gap:6px;flex-wrap:wrap}
.btn{display:inline-flex;align-items:center;justify-content:center;padding:7px 12px;border-radius:7px;font-size:11px;font-weight:700;cursor:pointer;border:none;transition:all 0.2s;text-decoration:none;white-space:nowrap}
.btn-view{background:linear-gradient(135deg,var(--theme),#0e7490);color:white;flex:1}
.btn-view:hover{opacity:0.9;transform:translateY(-1px)}
.btn-dl{background:rgba(16,185,129,0.12);color:var(--green);border:1px solid rgba(16,185,129,0.28)}
.btn-dl:hover{background:rgba(16,185,129,0.22)}
.dl-btn-row{display:flex;gap:6px;flex-wrap:wrap;margin-top:4px}
.btn-zip{background:rgba(6,182,212,0.12);color:#67e8f9;border:1px solid rgba(6,182,212,0.28);flex:1}
.btn-zip:hover{background:rgba(6,182,212,0.22);transform:translateY(-1px)}
.btn-individual{background:rgba(16,185,129,0.12);color:var(--green);border:1px solid rgba(16,185,129,0.28);flex:1}
.btn-individual:hover{background:rgba(16,185,129,0.22);transform:translateY(-1px)}
.btn-rm{background:rgba(239,68,68,0.10);color:#f87171;border:1px solid rgba(239,68,68,0.22);padding:7px 9px}
.btn-rm:hover{background:rgba(239,68,68,0.22)}
.card.hidden{display:none!important}
.folder-section.hidden{display:none!important}
.site-footer{text-align:center;padding:28px;color:var(--text4);font-size:11px;border-top:1px solid var(--border);margin-top:16px}
.save-all-fab{position:fixed;top:20px;right:20px;z-index:9998;background:linear-gradient(135deg,#06b6d4,#0e7490);color:#050816;border:none;border-radius:999px;padding:12px 22px;font-size:14px;font-weight:800;cursor:pointer;display:flex;align-items:center;gap:8px;box-shadow:0 6px 20px rgba(6,182,212,0.45),0 0 0 1px rgba(255,255,255,0.12),0 0 28px rgba(6,182,212,0.30);transition:transform 0.2s,box-shadow 0.2s,filter 0.2s}
.save-all-fab:hover{transform:translateY(-2px);filter:brightness(1.1);box-shadow:0 10px 28px rgba(6,182,212,0.6),0 0 0 1px rgba(255,255,255,0.2),0 0 40px rgba(6,182,212,0.5)}
.save-all-fab:active{transform:translateY(0)}
.save-all-panel{position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.7);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;padding:20px;animation:fadeIn 0.2s}
.save-all-panel.hidden{display:none}
.save-all-card{background:var(--card);border:1px solid var(--border);border-radius:16px;width:100%;max-width:480px;box-shadow:0 24px 60px rgba(0,0,0,0.5);overflow:hidden}
.save-all-head{display:flex;align-items:center;justify-content:space-between;padding:20px 24px;border-bottom:1px solid var(--border);background:linear-gradient(135deg,rgba(225,29,72,0.08),rgba(225,29,72,0))}
.save-all-head h3{font-size:18px;font-weight:800;color:var(--text1)}
.save-all-close{background:none;border:none;color:var(--text3);font-size:18px;cursor:pointer;padding:4px 10px;border-radius:6px;transition:all 0.15s}
.save-all-close:hover{background:rgba(255,255,255,0.06);color:var(--text1)}
.save-all-body{padding:24px}
.save-all-desc{color:var(--text2);font-size:13px;line-height:1.6;margin-bottom:16px}
.save-all-info{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:14px 16px;margin-bottom:16px;font-size:13px;color:var(--text2)}
.save-all-info strong{color:var(--theme);font-size:16px;font-weight:800}
.save-all-progress{margin-bottom:16px}
.save-all-progress.hidden{display:none}
.save-all-bar{height:8px;background:var(--surface);border-radius:999px;overflow:hidden;border:1px solid var(--border)}
.save-all-bar-fill{height:100%;background:linear-gradient(90deg,#06b6d4,#67e8f9,#06b6d4);background-size:200% 100%;width:0%;transition:width 0.3s;border-radius:999px;box-shadow:0 0 12px rgba(6,182,212,0.6);animation:zh-export-flow 1.6s linear infinite}
@keyframes zh-export-flow{0%{background-position:0% 50%}100%{background-position:200% 50%}}
.save-all-status{font-size:12px;color:var(--text3);margin-top:8px;text-align:center}
.save-all-actions{display:flex;gap:8px;flex-wrap:wrap}
.save-all-btn{padding:10px 16px;border-radius:10px;border:1px solid var(--border);font-size:13px;font-weight:600;cursor:pointer;transition:all 0.15s;flex:1;min-width:100px}
.save-all-btn.hidden{display:none}
.save-all-btn-primary{background:linear-gradient(135deg,#06b6d4,#0e7490);color:#050816;border-color:transparent;font-weight:800}
.save-all-btn-primary:hover{filter:brightness(1.1);transform:translateY(-1px)}
.save-all-btn-primary:disabled{opacity:0.5;cursor:not-allowed;transform:none}
.save-all-btn-stop{background:rgba(239,68,68,0.12);color:#f87171;border-color:rgba(239,68,68,0.3)}
.save-all-btn-stop:hover{background:rgba(239,68,68,0.22)}
.save-all-btn-ghost{background:transparent;color:var(--text2)}
.save-all-btn-ghost:hover{background:var(--surface);color:var(--text1)}
.save-all-note{margin-top:14px;padding-top:14px;border-top:1px solid var(--border);color:var(--text4);font-size:11px;line-height:1.5}
@keyframes fadeIn{from{opacity:0}to{opacity:1}}
@media(max-width:768px){
  .site-header,.container,.search-bar{padding-left:14px;padding-right:14px}
  .cards-grid{grid-template-columns:1fr}
}
@media(max-width:520px){.save-all-fab{padding:10px 16px;font-size:12px;top:12px;right:12px}.save-all-fab span:last-child{display:none}}
@media print{.btn-rm,.search-bar,.save-all-fab,.save-all-panel{display:none!important}}
</style>
</head>
<body>
<header class="site-header">
  <div>
    <div class="site-title">🛍️ ZHunter Iras Catalog</div>
    <div class="site-meta">Exported ${new Date().toLocaleString()} · v${APP_VERSION}</div>
  </div>
  <div class="site-stats">
    <div class="stat-box"><div class="num">${totalProducts}</div><div class="lbl">Products</div></div>
    <div class="stat-box"><div class="num">${totalFolders}</div><div class="lbl">Folders</div></div>
    <div class="stat-box"><div class="num">${totalCats}</div><div class="lbl">Categories</div></div>
  </div>
</header>

<!-- Floating master "Save All Images" button -->
<button id="saveAllImagesBtn" class="save-all-fab" onclick="openSaveAllPanel()">
  <span style="font-size:18px">💾</span>
  <span>Save All Images</span>
</button>

<!-- Save-all panel (popup overlay) -->
<div id="saveAllPanel" class="save-all-panel hidden">
  <div class="save-all-card">
    <div class="save-all-head">
      <h3>💾 Save All Images</h3>
      <button class="save-all-close" onclick="closeSaveAllPanel()">✕</button>
    </div>
    <div class="save-all-body">
      <p class="save-all-desc">Download every product image to your computer, one by one. Your browser will save them all to your Downloads folder.</p>
      <div class="save-all-info">
        <div><strong id="saveAllTotal">0</strong> images across <strong id="saveAllProducts">0</strong> products</div>
      </div>
      <div class="save-all-progress hidden" id="saveAllProgressWrap">
        <div class="save-all-bar">
          <div class="save-all-bar-fill" id="saveAllBarFill"></div>
        </div>
        <div class="save-all-status" id="saveAllStatus">Starting…</div>
      </div>
      <div class="save-all-actions">
        <button id="saveAllStartBtn" class="save-all-btn save-all-btn-primary" onclick="startSaveAll()">Start Downloading</button>
        <button id="saveAllStopBtn" class="save-all-btn save-all-btn-stop hidden" onclick="stopSaveAll()">Stop</button>
        <button class="save-all-btn save-all-btn-ghost" onclick="closeSaveAllPanel()">Close</button>
      </div>
      <div class="save-all-note">
        <small>💡 Browser may ask permission for multiple downloads — click "Allow" once.</small>
      </div>
    </div>
  </div>
</div>

<div class="search-bar">
  <input class="search-inp" type="search" id="liveSearch" placeholder="🔍 Search products, titles, tags, notes…" oninput="filterCards(this.value)" autocomplete="off"/>
  <select class="filter-sel" onchange="filterByFolder(this.value)">
    <option value="">All Folders</option>
    ${Object.keys(byFolder).map(f => `<option value="${esc(f)}">${esc(f)}</option>`).join('')}
  </select>
</div>
<div class="container" id="mainContainer">${folderSections}</div>
<footer class="site-footer">Generated by ZHunter Iras v${APP_VERSION}</footer>
<script>
document.addEventListener('click', function(event) {
  const button = event.target.closest('button[data-copy-text]');
  if (button) copyText(button.dataset.copyText, button);
});
function copyText(text, btn) {
  navigator.clipboard.writeText(text).then(() => {
    const orig = btn.textContent;
    btn.textContent = '✓ Copied!';
    btn.style.color = '#10b981';
    setTimeout(() => { btn.textContent = orig; btn.style.color = ''; }, 2000);
  }).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); ta.remove();
    btn.textContent = '✓ Copied!';
    setTimeout(() => { btn.textContent = btn.dataset.orig || '📋'; }, 2000);
  });
}
function removeCard(id) {
  const card = document.getElementById('card-' + id);
  if (!card) return;
  card.classList.add('removing');
  setTimeout(() => card.remove(), 350);
}
function filterCards(q) {
  q = q.toLowerCase().trim();
  document.querySelectorAll('.card').forEach(card => {
    const text = card.textContent.toLowerCase();
    card.classList.toggle('hidden', q.length > 0 && !text.includes(q));
  });
}
function filterByFolder(folder) {
  document.querySelectorAll('.folder-section').forEach(sec => {
    if (!folder) { sec.classList.remove('hidden'); return; }
    sec.classList.toggle('hidden', sec.dataset.folder !== folder);
  });
}
function switchImg(thumb, defaultSrc) {
  const gallery = thumb.closest('.img-gallery');
  const main = gallery ? gallery.querySelector('.img-main') : null;
  if (main) main.src = thumb.src;
  gallery.querySelectorAll('.img-thumb-exp').forEach(t => t.style.borderColor = 'transparent');
  thumb.style.borderColor = '#06b6d4';
}
document.querySelectorAll('.img-thumb-exp').forEach(t => {
  t.addEventListener('click', function() { switchImg(this); });
});

// ── Per-card downloader: download all images of one product ─
async function downloadCardImages(btn, urls, safeName) {
  if (!urls || !urls.length) return;
  const orig = btn ? btn.textContent : '';
  if (btn) btn.disabled = true;

  for (let i = 0; i < urls.length; i++) {
    if (btn) btn.textContent = '⬇ ' + (i+1) + ' of ' + urls.length + '…';
    
    const urlPath = urls[i].split('?')[0];
    const lastPart = urlPath.split('.').pop().toLowerCase();
    const validImgExts  = ['jpg','jpeg','png','gif','webp'];
    const validVidExts  = ['mp4','mov','webm','avi','mkv'];
    const allValidExts  = [...validImgExts, ...validVidExts];
    const ext = allValidExts.includes(lastPart) ? lastPart
              : validVidExts.some(v => urls[i].toLowerCase().includes(v)) ? 'mp4'
              : 'jpg';
    // Smart naming: product-name-1.jpg
    const filename = (safeName || 'product') + '-' + (i+1) + '.' + ext;

    let downloaded = false;
    try {
      const response = await fetch(urls[i]);
      if (response.ok) {
        const blob = await response.blob();
        if (blob.size > 0) {
          const blobUrl = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = blobUrl;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
          downloaded = true;
        }
      }
    } catch(e) {
      downloaded = false;
    }

    if (!downloaded) {
      const a = document.createElement('a');
      a.href = urls[i];
      a.download = filename;
      a.target = '_blank';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }

    await new Promise(r => setTimeout(r, 800));
  }

  if (btn) {
    btn.textContent = '✓ Done ' + urls.length + ' images';
    btn.disabled = false;
    setTimeout(() => { btn.textContent = orig; }, 3000);
  }
}

// ── ZIP Download ─────────────────────────────────────────────
async function downloadCardImagesAsZip(btn, urls, safeName) {
  if (!urls || !urls.length) return;
  if (typeof JSZip === 'undefined') {
    toast('JSZip not loaded', 'err');
    return;
  }

  const orig = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = 'Preparing ZIP...'; }

  const zip = new JSZip();
  const folder = zip.folder(safeName || 'images');
  let added = 0;

  for (let i = 0; i < urls.length; i++) {
    if (btn) btn.textContent = 'Fetching ' + (i+1) + '/' + urls.length + '...';
    
    const urlPath = urls[i].split('?')[0];
    const lastPart = urlPath.split('.').pop().toLowerCase();
    const validExts = ['jpg','jpeg','png','gif','webp'];
    const ext = validExts.includes(lastPart) ? lastPart : 'jpg';
    // Smart naming: product-name-1.jpg
    const filename = (safeName || 'product') + '-' + (i+1) + '.' + ext;

    try {
      const response = await fetch(urls[i]);
      if (response.ok) {
        const blob = await response.blob();
        if (blob.size > 0) {
          folder.file(filename, blob);
          added++;
        }
      }
    } catch(e) {
      console.warn('ZHunter ZIP: could not fetch', urls[i]);
    }
  }

  if (added === 0) {
    toast('Could not fetch any images for ZIP', 'err');
    if (btn) { btn.disabled = false; btn.textContent = orig; }
    return;
  }

  if (btn) btn.textContent = 'Generating ZIP...';

  try {
    const content = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 3 } });
    const objUrl = URL.createObjectURL(content);
    const a = document.createElement('a');
    a.href = objUrl;
    a.download = (safeName || 'images') + '.zip';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(objUrl), 1000);
    toast('ZIP saved: ' + added + ' images', 'ok');
  } catch(e) {
    toast('ZIP generation failed', 'err');
  }

  if (btn) {
    btn.disabled = false;
    btn.textContent = 'Done ZIP (' + added + ')';
    setTimeout(() => { btn.textContent = orig; }, 3000);
  }
}

// ── Save All Images — sequential downloader (master button) ─
let _saveAllStop = false;
let _saveAllRunning = false;

function collectAllImages() {
  const all = [];
  document.querySelectorAll('.card').forEach(card => {
    const id = card.id.replace('card-', '');
    const titleEl = card.querySelector('.card-title');
    const safeTitle = (titleEl ? titleEl.textContent : 'product')
      .replace(/[^a-zA-Z0-9 _-]/g, '').trim().slice(0, 30).replace(/\\s+/g, '_') || 'product';
    const imgs = card.querySelectorAll('img.img-main, img.img-thumb-exp');
    const seen = new Set();
    let n = 1;
    imgs.forEach(im => {
      const src = im.src || im.getAttribute('src');
      if (!src || seen.has(src)) return;
      seen.add(src);
      all.push({ src, name: safeTitle + '_img' + n + extFromSrc(src), card: id });
      n++;
    });
  });
  return all;
}
function extFromSrc(src) {
  if (src.startsWith('data:image/png')) return '.png';
  if (src.startsWith('data:image/webp')) return '.webp';
  if (src.startsWith('data:image/gif')) return '.gif';
  const m = src.match(/\\.(jpg|jpeg|png|webp|gif|avif)(?:\\?|#|$)/i);
  return m ? '.' + m[1].toLowerCase() : '.jpg';
}

function openSaveAllPanel() {
  const all = collectAllImages();
  const totalImgs = all.length;
  const totalCards = document.querySelectorAll('.card').length;
  const t = document.getElementById('saveAllTotal'); if (t) t.textContent = totalImgs;
  const p = document.getElementById('saveAllProducts'); if (p) p.textContent = totalCards;
  document.getElementById('saveAllPanel').classList.remove('hidden');
  document.getElementById('saveAllProgressWrap').classList.add('hidden');
  document.getElementById('saveAllStartBtn').classList.remove('hidden');
  document.getElementById('saveAllStopBtn').classList.add('hidden');
  document.getElementById('saveAllStartBtn').disabled = (totalImgs === 0);
  document.getElementById('saveAllStartBtn').textContent = totalImgs === 0 ? 'No images to save' : 'Start Downloading';
}
function closeSaveAllPanel() {
  if (_saveAllRunning) {
    if (!confirm('A download is in progress. Stop and close?')) return;
    _saveAllStop = true;
  }
  document.getElementById('saveAllPanel').classList.add('hidden');
}
function stopSaveAll() {
  _saveAllStop = true;
  document.getElementById('saveAllStatus').textContent = 'Stopping…';
}
async function downloadOne(src, name) {
  return new Promise((resolve) => {
    try {
      const a = document.createElement('a');
      a.href = src;
      a.download = name;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { a.remove(); resolve(true); }, 50);
    } catch (e) {
      resolve(false);
    }
  });
}
async function startSaveAll() {
  if (_saveAllRunning) return;
  const all = collectAllImages();
  if (!all.length) return;

  _saveAllRunning = true;
  _saveAllStop = false;

  document.getElementById('saveAllStartBtn').classList.add('hidden');
  document.getElementById('saveAllStopBtn').classList.remove('hidden');
  document.getElementById('saveAllProgressWrap').classList.remove('hidden');

  const fill = document.getElementById('saveAllBarFill');
  const status = document.getElementById('saveAllStatus');

  let ok = 0, fail = 0;
  for (let i = 0; i < all.length; i++) {
    if (_saveAllStop) break;
    const item = all[i];
    status.textContent = 'Downloading ' + (i + 1) + ' of ' + all.length + ' — ' + item.name;
    fill.style.width = ((i / all.length) * 100).toFixed(1) + '%';
    const res = await downloadOne(item.src, item.name);
    res ? ok++ : fail++;
    // 300ms delay so the browser doesn't cancel a wave of downloads
    await new Promise(r => setTimeout(r, 300));
  }

  fill.style.width = '100%';
  status.textContent = _saveAllStop
    ? ('Stopped — ' + ok + ' saved, ' + (all.length - ok) + ' skipped')
    : ('Done! ' + ok + ' saved' + (fail ? ', ' + fail + ' failed' : ''));

  document.getElementById('saveAllStopBtn').classList.add('hidden');
  document.getElementById('saveAllStartBtn').classList.remove('hidden');
  document.getElementById('saveAllStartBtn').textContent = 'Download Again';

  _saveAllRunning = false;
}
<\/script>
</body>
</html>`;

  dlFile(html, filename, 'text/html');
  toast('Professional HTML catalog exported! ✨', 'ok');
}

// ── Lightbox Preview ──────────────────────────────────────────
let currentLightboxSrc = '';
let currentLightboxTitle = '';
let currentLightboxList = [];
let currentLightboxIdx = 0;

function openLightbox(src, title = '', imagesList = [], currentIdx = 0) {
  const modal = $('lightboxModal');
  const img = $('lightboxImg');
  const titleEl = $('lightboxTitle');
  const link = $('lightboxOpenLink');
  const imgArea = modal?.querySelector('.lightbox-img-area');
  if (!modal || !img || !src) return;

  currentLightboxSrc = src;
  currentLightboxTitle = title;
  currentLightboxList = Array.isArray(imagesList) && imagesList.length ? imagesList : [src];
  currentLightboxIdx = currentIdx >= 0 ? currentIdx : currentLightboxList.indexOf(src);
  if (currentLightboxIdx < 0) currentLightboxIdx = 0;

  img.src = src;
  if (imgArea) imgArea.classList.remove('zoomed');
  if (titleEl) {
    const counter = currentLightboxList.length > 1 ? ` (${currentLightboxIdx + 1} / ${currentLightboxList.length})` : '';
    titleEl.textContent = (title || 'Image Preview') + counter;
  }
  if (link) link.href = src;

  modal.style.zIndex = '5000';
  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
}

function closeLightbox() {
  const modal = $('lightboxModal');
  if (!modal) return;
  // Blur any focused element inside modal before hiding to avoid aria-hidden warning
  const focused = modal.querySelector(':focus');
  if (focused) focused.blur();
  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden', 'true');
  const img = $('lightboxImg');
  if (img) img.src = '';
  currentLightboxSrc = '';
  currentLightboxTitle = '';
  currentLightboxList = [];
}

// Default AI Studio Commercial Prompt (1:1 Hero-Shot Listing Image)
// v9.9.0 — user's e-commerce scene prompt (bump the version below whenever this changes,
// so a prompt saved from an older default gets replaced once).
const AI_IMAGE_PROMPT_VERSION = 2;
const DEFAULT_AI_COMMERCIAL_PROMPT = `Edit the provided product image into a professional, realistic e-commerce main image.

Understand the product first, then create a realistic scene that naturally shows the product in its relevant environment and use context.

Keep the original product as the main hero subject.

DO NOT change, redesign, recreate, or alter the original product.
Preserve the exact product shape, proportions, colors, packaging, branding, logo, label, text, graphics, quantity information, and important visual details.

Create a realistic lifestyle/commercial photography scene appropriate for the product.

IMPORTANT COMPOSITION RULE:

Do not leave large empty areas around the product.

Use the LEFT and RIGHT sides of the composition intentionally with relevant objects connected to the product.

Also use the foreground and middle-ground to create natural depth.

These supporting objects should make the scene feel complete and visually interesting, not simply fill empty space.

Choose the supporting objects based on the actual product and its purpose.

For example:
- For dishwashing products: naturally placed dirty dishes, plates, cups, bowls, utensils, sink elements, water, subtle soap/foam.
- For coffee products: coffee cups, naturally scattered pods/beans, serving items and relevant kitchen elements.
- For food products: realistic serving dishes, ingredients, utensils, or prepared food that naturally relates to the product.
- For cleaning products: realistic items that need cleaning, appropriate surfaces, subtle water or cleaning context.
- For kitchen tools: food preparation, ingredients, cutting boards, bowls, utensils, or other relevant kitchen objects.
- For grocery products: natural serving/use context and relevant ingredients or food items.
- For other products: determine the most natural real-world use context yourself.

The side objects should NOT be arranged in a straight line.

Use natural overlapping, spacing, different sizes, and realistic positioning.

Some relevant objects may appear partially in the foreground or near the edges of the frame, creating depth and making the scene feel naturally photographed rather than artificially arranged.

Create visual balance across the entire frame.

Do not place everything around the product symmetrically.

Do not make both sides identical.

Do not leave large blank areas unless negative space is genuinely necessary for the composition.

The supporting objects must remain secondary to the main product.

The product should still be the first thing the viewer notices.

Create a natural visual flow:
foreground elements → supporting objects → main product → background environment.

Use realistic perspective, scale, shadows, reflections, depth of field, and lighting.

The environment should feel like a real home or real commercial photography location appropriate for the product.

Make the scene interesting enough to catch attention while scrolling, but keep it professional and believable.

Do NOT overdecorate the scene.

Do NOT add random objects.

Every added object should have a logical connection to the product.

Do NOT create excessive bubbles, foam, ingredients, food, dishes, or other effects.

Use enough relevant objects to make the frame feel naturally occupied and visually rich, but avoid clutter.

Avoid:
- large empty areas
- generic empty countertops
- product floating in space
- isolated product with nothing around it
- perfectly aligned objects
- objects arranged in a straight row
- excessive symmetry
- excessive decorative props
- unrealistic quantities
- exaggerated effects
- artificial-looking staging
- obvious AI-generated appearance
- plastic-looking materials
- distorted objects
- fake text
- unnecessary graphics
- changing the original product

The final result should look like a professionally photographed commercial e-commerce image created by a real photographer and stylist.

The image should feel:
REAL
NATURAL
PROFESSIONAL
INTERESTING
PRODUCT-FOCUSED
VISUALLY FULL
NOT OVERCROWDED

The composition should use the full 1:1 square frame effectively.

Most importantly:
Do not simply place the product in an empty kitchen.

Build a believable scene around the product so the surrounding objects naturally explain the product's purpose and create visual interest.

Use the product category to decide what belongs on the sides, foreground, and background.

Keep the original product completely accurate.`;

// Saved prompt from the textarea wins — unless it was saved under an older default
// prompt version, in which case the new default replaces it once.
async function getSavedAiImagePrompt() {
  try {
    const st = await chrome.storage.local.get(['zhunterAiImagePrompt', 'zhunterAiImagePromptVersion']);
    if (st?.zhunterAiImagePromptVersion !== AI_IMAGE_PROMPT_VERSION) {
      await chrome.storage.local.set({ zhunterAiImagePrompt: DEFAULT_AI_COMMERCIAL_PROMPT, zhunterAiImagePromptVersion: AI_IMAGE_PROMPT_VERSION });
      return DEFAULT_AI_COMMERCIAL_PROMPT;
    }
    return (st?.zhunterAiImagePrompt || '').trim() || DEFAULT_AI_COMMERCIAL_PROMPT;
  } catch (_) {
    return DEFAULT_AI_COMMERCIAL_PROMPT;
  }
}

// ═════════════════════════════════════════════════════════════════
// v9.9.0 — Google Flow image jobs
// Every image sent to Flow is a JOB with its own id. flow_automation.js returns the
// generated image with that same id, and only a known job can change a product image:
//   • stepper jobs are accepted only while they are the step currently being waited on
//   • the product slot must still hold the image that was sent (no cross-overwrites)
// ═════════════════════════════════════════════════════════════════
const FlowJobs = new Map(); // jobId -> { productId, imageIndex, originalUrl, source, title }

function newFlowJobId() {
  return 'fj_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

async function focusOrOpenFlowTab() {
  const tabs = await chrome.tabs.query({ url: '*://flow.google.com/*' });
  if (tabs && tabs.length > 0) {
    // Reuse the project already open so all images land in one Flow project
    const targetTab = tabs.find(t => t.url && t.url.includes('/project/')) || tabs[0];
    await chrome.tabs.update(targetTab.id, { active: true });
    if (targetTab.windowId) chrome.windows.update(targetTab.windowId, { focused: true }).catch(() => {});
    try {
      await chrome.scripting.executeScript({ target: { tabId: targetTab.id }, files: ['flow_automation.js'] });
    } catch (_) {}
    try { await chrome.tabs.sendMessage(targetTab.id, { action: 'ZH_FLOW_EXECUTE' }); } catch (_) {}
    return 'focused';
  }
  await chrome.tabs.create({ url: 'https://flow.google.com', active: true });
  return 'opened';
}

// Flow only accepts PNG/JPEG/WEBP/GIF/HEIF — AVIF (Walmart) and others are re-encoded to JPEG.
async function toFlowSafeDataUrl(dataUrl) {
  if (/^data:image\/(png|jpe?g|webp);/i.test(dataUrl)) return dataUrl;
  try {
    const blob = await (await fetch(dataUrl)).blob();
    const bmp = await createImageBitmap(blob);
    const c = document.createElement('canvas');
    c.width = bmp.width; c.height = bmp.height;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(bmp, 0, 0);
    try { bmp.close(); } catch (_) {}
    return c.toDataURL('image/jpeg', 0.95);
  } catch (e) {
    console.warn('[ZHunter] Image convert for Flow failed:', e);
    return null;
  }
}

// v9.11.0 — download + Flow-safe convert a product image once; the stepper warms this up
// for the NEXT step while the current one is still generating.
const FlowB64Cache = new Map(); // url -> Promise<dataUrl|null>
function flowPrefetchImage(src) {
  if (!src) return Promise.resolve(null);
  if (FlowB64Cache.has(src)) return FlowB64Cache.get(src);
  const p = (async () => {
    let b64 = src.startsWith('data:') ? src : null;
    if (!b64) {
      try {
        const resp = await msg({ action: 'FETCH_BASE64', url: src, settings: { imageFormat: 'original' } });
        if (resp?.success && resp.base64) b64 = resp.base64;
      } catch (_) {}
    }
    return b64 ? await toFlowSafeDataUrl(b64) : null;
  })();
  FlowB64Cache.set(src, p);
  p.then(v => { if (!v) FlowB64Cache.delete(src); });
  if (FlowB64Cache.size > 12) FlowB64Cache.delete(FlowB64Cache.keys().next().value);
  return p;
}

// v9.11.0 — auto speed: Safe / Normal / Fast (only the pause between images changes;
// still ONE generation at a time so results can never land on the wrong product)
const FLOW_SPEEDS = {
  safe:   { min: 4000, max: 9000, label: 'Safe' },
  normal: { min: 2000, max: 4000, label: 'Normal' },
  fast:   { min: 800,  max: 1600, label: 'Fast' }
};
function flowSpeedKey() {
  const v = $('temuAiImgSpeedSel')?.value;
  return FLOW_SPEEDS[v] ? v : 'normal';
}

// Flow smart editor automation helper — returns the jobId (or null if nothing was sent)
async function triggerFlowEdit({ src, title, prompt, productId = null, imageIndex = null, source = 'single', jobId = null }) {
  if (!src) return null;
  const cleanTitle = (title || 'Product')
    .replace(/\s*\(\d+\s*\/\s*\d+\)/, '')
    .replace(/\s*[-–|].*$/, '')
    .trim();
  const flowPrompt = (prompt || '').trim() || await getSavedAiImagePrompt();

  toast('Preparing image & prompt for Flow…', 'info');

  // v9.11.0 — the next step's image is usually downloaded already (flowPrefetchImage)
  let base64 = await flowPrefetchImage(src);
  FlowB64Cache.delete(src);
  if (!base64) {
    toast('Product image download nahi hui — Flow ko nahi bheji', 'warn');
    return null;
  }
  if (!base64) {
    toast('Image format Flow ke liye convert nahi ho saka', 'warn');
    return null;
  }

  const id = jobId || newFlowJobId();
  FlowJobs.set(id, {
    productId: productId || null,
    imageIndex: imageIndex ?? null,
    originalUrl: src,
    source,
    title: cleanTitle
  });

  await chrome.storage.local.set({
    pendingFlowAction: {
      jobId: id,
      productTitle: cleanTitle,
      prompt: flowPrompt,
      imgUrl: src,
      imgBase64: base64,
      productId: productId || null,
      imageIndex: imageIndex ?? null,
      timestamp: Date.now(),
      processed: false,
      status: 'queued'
    }
  });

  const how = await focusOrOpenFlowTab();
  toast(how === 'focused' ? '✓ Flow tab — image job bheja gaya' : '✓ Google Flow khul raha hai…', 'ok');
  return id;
}
window.triggerFlowEdit = triggerFlowEdit;

// ── Product image slot helpers (same row may live in Library, Bulk results and Sheet rows)
function _imgEntryUrl(entry) {
  return typeof entry === 'string' ? entry : (entry?.url || '');
}

function _productRowsById(productId) {
  const out = [];
  if (!productId) return out;
  if (MasterUIState?.allRows) {
    const m = MasterUIState.allRows.find(x => x.id === productId);
    if (m) out.push(m);
  }
  if (typeof BulkState !== 'undefined' && Array.isArray(BulkState?.results)) {
    const b = BulkState.results.find(x => x.id === productId);
    if (b) out.push(b);
  }
  if (typeof TemuSheetRows !== 'undefined' && Array.isArray(TemuSheetRows)) {
    const s = TemuSheetRows.find(x => x.id === productId);
    if (s) out.push(s);
  }
  // v9.11.0 — Manual Board product objects
  try {
    for (const it of (ZhStudio?.items || [])) {
      if (it?.product?.id === productId && !out.includes(it.product)) out.push(it.product);
    }
  } catch (_) {}
  // v9.10.1 — the stepper's own product objects (e.g. Library rows loaded straight from storage)
  try {
    for (const q of (TemuImgStepper?.queue || [])) {
      if (q?.product?.id === productId && !out.includes(q.product)) out.push(q.product);
    }
  } catch (_) {}
  return out;
}

// Current image at productId/idx, or null if the product is gone.
function currentProductImage(productId, idx) {
  const rows = _productRowsById(productId).filter(r => Array.isArray(r.images));
  if (!rows.length) return null;
  return _imgEntryUrl(rows[0].images[idx]);
}

// Keep the first main image when editing; undo restores the original gallery.
function zhSetEditedImage(row, idx, newUrl) {
  const current = row.images[idx];
  const oldUrl = _imgEntryUrl(current);
  if (oldUrl === newUrl) return 0;
  row.images = row.images.slice();
  let shift = 0;
  if (idx === 0 && oldUrl) {
    if (row.zhOriginalMainUrl === newUrl) {
      if (_imgEntryUrl(row.images[1]) === newUrl) {
        row.images.splice(1, 1);
        shift = -1;
      }
      delete row.zhOriginalMainUrl;
    } else if (!row.zhOriginalMainUrl) {
      row.zhOriginalMainUrl = oldUrl;
      row.images.splice(1, 0, current);
      shift = 1;
    }
  }
  row.images[idx] = typeof current === 'string' ? newUrl : { ...current, url: newUrl };
  return shift;
}

function zhShiftImageEditors(productId, delta) {
  if (!delta) return;
  const move = i => i > 0 ? Math.max(1, i + delta) : i;
  for (const job of FlowJobs.values()) {
    if (job.productId === productId) job.imageIndex = move(job.imageIndex);
  }
  try {
    for (const q of TemuImgStepper.queue || []) {
      if (q.product?.id === productId) q.imgIndex = move(q.imgIndex);
    }
  } catch (_) {}
  try {
    for (const it of ZhStudio.items || []) {
      if (it.product?.id !== productId) continue;
      const slots = {};
      for (const [idx, slot] of Object.entries(it.slots || {})) {
        if (delta < 0 && Number(idx) === 1) continue;
        slots[move(Number(idx))] = slot;
      }
      it.slots = slots;
      it.picked = [...new Set(it.picked.filter(i => delta > 0 || i !== 1).map(move))];
      it.pasteSel = new Set([...(it.pasteSel || [])].filter(i => delta > 0 || i !== 1).map(move));
      it.active = move(it.active);
    }
  } catch (_) {}
}

// Replace ONLY if the slot still holds `expectedUrl`. Returns true if anything changed.
async function replaceProductImage(productId, idx, newUrl, expectedUrl) {
  let changed = false, oldUrl = null, pUrl = '', shift = 0;
  for (const row of new Set(_productRowsById(productId))) {
    if (!Array.isArray(row.images) || idx == null || idx < 0 || idx >= row.images.length) continue;
    const cur = _imgEntryUrl(row.images[idx]);
    if (expectedUrl && cur !== expectedUrl) continue;
    if (oldUrl == null) oldUrl = cur;
    if (!pUrl) pUrl = row.url || '';
    const delta = zhSetEditedImage(row, idx, newUrl);
    if (delta) shift = delta;
    changed = true;
  }
  if (changed && productId) {
    await _zhEditsChain;
    // v9.12.8 — fresh read-modify-write of ONLY this image, one write at a time.
    // (Pehle purani in-memory Library poori likh di jati thi, aur do saves ek saath hon to
    //  doosra pehle wale ki image mita deta tha — is liye edit hui images wapas purani ho jati thin.)
    try {
      await zhLibPatch(saved => {
        const row = saved.find(x => x.id === productId) || (pUrl ? saved.find(x => x.url === pUrl) : null);
        if (!row || !Array.isArray(row.images) || idx < 0 || idx >= row.images.length) return false;
        const cur = _imgEntryUrl(row.images[idx]);
        if (cur === newUrl) return false;
        if (expectedUrl && cur !== expectedUrl && cur !== oldUrl) return false;
        zhSetEditedImage(row, idx, newUrl);
        return true;
      });
    } catch (e) { console.warn('[ZHunter] Library save after replace failed:', e); }
    if (shift) {
      zhShiftImageEditors(productId, shift);
      const edits = await zhEditsLoad();
      const shifted = [];
      for (const [key, edit] of Object.entries(edits)) {
        if (edit.idx > 0 && ((edit.id && edit.id === productId) || (pUrl && edit.url === pUrl))) {
          delete edits[key];
          if (shift < 0 && edit.idx === 1) continue;
          edit.idx += shift;
          shifted.push(edit);
        }
      }
      for (const edit of shifted) edits[`${edit.url || edit.id}#${edit.idx}`] = edit;
    }
    await zhEditsRecord(productId, idx, oldUrl, newUrl, pUrl);
  }
  return changed;
}

// ═══ v9.12.8 — safe Library writes + edited-image journal ═══
// Every replaced image is also written to its own record (zhImgEdits). Products shown in the
// review / export / next edit run get these images back even after an error, a closed stepper,
// a stale Library copy or a side-panel reload.
let _zhLibChain = Promise.resolve();
function zhLibPatch(fn) {
  const p = _zhLibChain.then(async () => {
    const saved = await getMasterRows();
    if (fn(saved)) await setMasterRows(saved);
  });
  _zhLibChain = p.catch(() => {});
  return p;
}

const ZH_EDITS_KEY = 'zhImgEdits';
let ZhEdits = null;
let _zhEditsChain = Promise.resolve();
async function zhEditsLoad() {
  if (ZhEdits) return ZhEdits;
  try { ZhEdits = (await chrome.storage.local.get([ZH_EDITS_KEY]))?.[ZH_EDITS_KEY] || {}; } catch (_) { ZhEdits = {}; }
  return ZhEdits;
}
function zhEditsRecord(productId, idx, oldUrl, newUrl, productUrl) {
  if ((!productId && !productUrl) || idx == null || !newUrl) return _zhEditsChain;
  _zhEditsChain = _zhEditsChain.then(async () => {
    const E = await zhEditsLoad();
    const key = `${productUrl || productId}#${idx}`;
    const prev = E[key];
    const orig = prev ? prev.orig : oldUrl;
    if (!orig || newUrl === orig) delete E[key];            // undo → back to original
    else {
      const via = prev ? [...(prev.via || []), prev.newUrl].filter(u => u && u !== newUrl && u !== orig).slice(-3) : [];
      E[key] = { id: productId || '', url: productUrl || '', idx, orig, newUrl, via, at: Date.now() };
    }
    const cutoff = Date.now() - 30 * 864e5;
    for (const k of Object.keys(E)) if ((E[k].at || 0) < cutoff) delete E[k];
    const keys = Object.keys(E);
    if (keys.length > 600) keys.sort((a, b) => E[a].at - E[b].at).slice(0, keys.length - 600).forEach(k => delete E[k]);
    await chrome.storage.local.set({ [ZH_EDITS_KEY]: E });
  }).catch(e => console.warn('[ZHunter] edit journal save failed', e));
  return _zhEditsChain;
}
async function zhApplyImgEdits(rows) {
  if (!Array.isArray(rows)) return rows;
  const list = Object.values(await zhEditsLoad());
  if (!list.length) return rows;
  for (const r of rows) {
    if (!r || !Array.isArray(r.images)) continue;
    for (const e of list.slice().sort((a, b) => a.idx - b.idx)) {
      if (!((e.id && r.id === e.id) || (e.url && r.url === e.url))) continue;
      if (e.idx < 0 || e.idx >= r.images.length) continue;
      const cur = _imgEntryUrl(r.images[e.idx]);
      if (cur === e.newUrl) continue;
      if (cur === e.orig || (e.via || []).includes(cur)) {
        zhSetEditedImage(r, e.idx, e.newUrl);
      }
    }
  }
  return rows;
}

// Compress base64 or blob data URL before public upload.
// Keeps resolution crisp up to 1500px (standard e-commerce HD zoom),
// converts to JPEG at 0.92 quality (reduces 6MB PNG to ~150-250KB in milliseconds).
async function compressBase64Image(dataUrlOrBlob, maxDim = 1500, quality = 0.92) {
  try {
    return await new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        let w = img.naturalWidth || img.width;
        let h = img.naturalHeight || img.height;
        if (!w || !h) return resolve(dataUrlOrBlob);

        if (w > maxDim || h > maxDim) {
          if (w > h) {
            h = Math.round((h * maxDim) / w);
            w = maxDim;
          } else {
            w = Math.round((w * maxDim) / h);
            h = maxDim;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);

        const compressed = canvas.toDataURL('image/jpeg', quality);
        resolve(compressed);
      };
      img.onerror = () => resolve(dataUrlOrBlob);
      img.src = dataUrlOrBlob;
    });
  } catch (_) {
    return dataUrlOrBlob;
  }
}
window.compressBase64Image = compressBase64Image;

// Helper to upload base64 or blob images to a public HTTPS host for Temu
async function uploadImageToPublicHost(source) {
  if (!source || typeof source !== 'string') return source;
  // v9.9.0 — Flow's signed flow-content.google links expire (~1h): download + re-host them too.
  if (/^https:\/\/flow-content\.google\//i.test(source)) {
    try {
      const r = await msg({ action: 'FETCH_FLOW_IMAGE', url: source });
      if (r?.success && r.base64) source = r.base64;
      else return source;
    } catch (_) { return source; }
  }
  if (/^https?:\/\//i.test(source) && !source.startsWith('http://localhost') && !source.startsWith('http://127.0.0.1')) {
    return source;
  }
  try {
    let cleanB64 = '';
    let processedSource = source;
    if (source.startsWith('data:image/') || source.startsWith('blob:')) {
      processedSource = await compressBase64Image(source, 1500, 0.92);
    }

    if (processedSource.startsWith('data:image/')) {
      cleanB64 = processedSource.split(',')[1] || '';
    } else if (processedSource.startsWith('blob:')) {
      const resp = await fetch(processedSource);
      const blob = await resp.blob();
      cleanB64 = await new Promise((res, rej) => {
        const reader = new FileReader();
        reader.onload = () => res((reader.result || '').split(',')[1] || '');
        reader.onerror = rej;
        reader.readAsDataURL(blob);
      });
    }
    if (!cleanB64) return source;

    const postData = 'key=6d207e02198a847aa98d0a2a901485a5&action=upload&source=' + encodeURIComponent(cleanB64) + '&format=json';

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    const uploadRes = await fetch('https://freeimage.host/api/1/upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: postData,
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (uploadRes.ok) {
      const json = await uploadRes.json();
      if (json?.image?.url) {
        return json.image.url;
      }
    }
  } catch (err) {
    console.warn('[ZHunter] Public image upload error:', err);
  }
  return source;
}
window.uploadImageToPublicHost = uploadImageToPublicHost;

function temuStepSetStatus(text, kind = 'info') {
  const el = $('temuStepStatus');
  if (!el) return;
  el.textContent = text;
  el.classList.toggle('is-error', kind === 'error');
  el.classList.toggle('is-ok', kind === 'ok');
}

function isActiveStepperJob(jobId) {
  return !!jobId && TemuImgStepper?.activeJobId === jobId;
}

// Progress / errors from the Flow tab
const FlowGenInfo = new Map();
const FlowSendSnap = new Map(); // jobId -> { ids:Set, at } grid snapshot taken right before sending // jobId -> { before:Set, ref:Set, at } (ids present when generation started)
function onFlowStatus(m) {
  if (!m?.jobId || !FlowJobs.has(m.jobId)) return;
  if (m.phase === 'generating' && Array.isArray(m.beforeIds)) {
    FlowGenInfo.set(m.jobId, { before: new Set(m.beforeIds), ref: new Set(m.refIds || []), at: Date.now() });
  }
  if (isActiveStepperJob(m.jobId)) {
    temuStepSetStatus((m.error ? '⚠️ ' : '⏳ ') + (m.text || m.phase || ''), m.error ? 'error' : 'info');
  }
  if (m.error) {
    // v9.11.0 — Google flagged the account: drop back to Safe pacing automatically
    const unusual = /unusual activity/i.test(m.text || '');
    if (unusual && flowSpeedKey() !== 'safe') {
      const sel = $('temuAiImgSpeedSel');
      if (sel) { sel.value = 'safe'; chrome.storage.local.set({ zhunterFlowSpeed: 'safe' }); }
      toast('⚠️ Google ne "unusual activity" kaha — speed Safe kar di.', 'warn');
    }
    FlowJobs.delete(m.jobId);
    if (isActiveStepperJob(m.jobId)) {
      TemuImgStepper.activeJobId = null;
      const current = TemuImgStepper.queue[TemuImgStepper.currentIndex];
      if (current) current.sentAt = null;
      if (unusual && TemuImgStepper.engine === 'flow') flowAutoNewProject();   // v9.12.6
      else { toast('Flow: ' + (m.text || 'error') + ' — "Send Again", "Skip" ya neeche Manual buttons', 'warn'); temuStepManualAttn(true); }
    } else {
      toast('Flow: ' + (m.text || 'error'), 'warn');
    }
  }
}

// Generated image from the Flow tab
const FlowHandledResults = new Set();
// Let the Flow tab stop waiting (it would otherwise hold the next job up to 3 min)
async function _markFlowJobDone(jobId, newImgUrl) {
  try {
    const cur = (await chrome.storage.local.get(['pendingFlowAction']))?.pendingFlowAction;
    if (cur && cur.jobId === jobId && !(cur.processed && cur.status === 'done')) {
      await chrome.storage.local.set({ pendingFlowAction: { ...cur, processed: true, status: 'done', newImgUrl: newImgUrl || cur.newImgUrl, finishedAt: Date.now(), by: 'panel' } });
    }
  } catch (_) {}
} // jobIds already applied (message + storage both deliver)
async function onFlowResult(m) {
  if (!m?.jobId || FlowHandledResults.has(m.jobId)) return;
  let job = FlowJobs.get(m.jobId) || null;
  // v9.10.1 — the current stepper job is always known to the stepper itself, even if
  // FlowJobs lost it (e.g. the result arrived twice or the map was reset).
  if (!job && m?.jobId && isActiveStepperJob(m.jobId)) {
    const cur = TemuImgStepper.queue?.[TemuImgStepper.currentIndex];
    if (cur && cur.jobId === m.jobId) {
      job = { productId: cur.product?.id, imageIndex: cur.imgIndex, originalUrl: cur.imgUrl, source: 'stepper', title: cur.product?.title };
      FlowJobs.set(m.jobId, job);
    }
  }
  if (!job) {
    console.warn('[ZHunter] Flow result for unknown/old job ignored:', m?.jobId);
    return;
  }
  if (job.source === 'stepper') {
    // Only the runner that submitted this job can deliver its verified result.
    const cur = TemuImgStepper.queue?.[TemuImgStepper.currentIndex];
    if (!isActiveStepperJob(m.jobId) || !cur || cur.done || !m.newImgUrl) return;
    FlowHandledResults.add(m.jobId);
    cur.done = true;
    await temuStepApplyManualImage(m.newImgUrl, 'Auto');
    return;
  }
  FlowHandledResults.add(m.jobId);
  FlowGenInfo.delete(m.jobId);
  console.log('[ZHunter] Flow result received', m.jobId, m.newImgUrl);
  _markFlowJobDone(m.jobId, m.newImgUrl);
  if (job.source === 'stepper' && !isActiveStepperJob(m.jobId)) {
    console.warn('[ZHunter] Flow result is not for the current step — ignored:', m.jobId);
    FlowJobs.delete(m.jobId);
    return;
  }
  FlowJobs.delete(m.jobId);

  // Always trust the job record, never ids echoed back from the page
  let { productId, imageIndex, originalUrl, title } = job;
  const isStep = job.source === 'stepper';
  if (isStep && !productId) {
    const sc = (TemuImgStepper.queue || []).find(q => q.jobId === m.jobId);
    if (sc?.product) productId = _ensureRowIds([sc.product])[0].id;
  }

  if (!productId || imageIndex == null) {
    toast('✓ Flow image ban gayi (yeh image kisi product se linked nahi thi)', 'ok');
    return;
  }

  // v9.10.1 — the same product can exist twice (Library copy + Bulk/Sheet copy) with different
  // image links. Check the stepper's own product object first, then any copy.
  let cur = currentProductImage(productId, imageIndex);
  const stepCur = isStep ? (TemuImgStepper.queue || []).find(q => q.jobId === m.jobId) : null;
  if (stepCur) cur = _imgEntryUrl(stepCur.product?.images?.[imageIndex]);
  else if (cur !== originalUrl && _productRowsById(productId).some(r => _imgEntryUrl(r.images?.[imageIndex]) === originalUrl)) cur = originalUrl;
  if (cur === null || cur !== originalUrl) {
    const why = cur === null ? 'product ab list mein nahi' : 'us jagah image pehle hi badal chuki hai';
    toast(`⚠️ ${trunc(title || 'Product', 30)} · Image #${imageIndex + 1} replace nahi ki — ${why}`, 'warn');
    if (isStep) {
      TemuImgStepper.stats.skipped++;
      temuStepSetStatus(`⚠️ Replace skip: ${why}. Agle step pe ja raha hoon…`, 'error');
      TemuImgStepper.activeJobId = null;
      setTimeout(() => temuStepAdvance(), 1500);
    }
    return;
  }

  if (isStep) temuStepSetStatus('✓ Image mili — Temu ke liye public link bana raha hoon…', 'ok');

  // Re-host (Flow link expires) — the product only gets the new image once we have a stable copy
  let finalUrl = await uploadImageToPublicHost(m.newImgUrl);
  if (!finalUrl || /^https:\/\/flow-content\.google\//i.test(finalUrl)) {
    // Couldn't download or re-host: keep a local copy so nothing expires under the user
    try {
      const r = await msg({ action: 'FETCH_FLOW_IMAGE', url: m.newImgUrl });
      if (r?.success && r.base64) finalUrl = r.base64;
    } catch (_) {}
  }
  if (!finalUrl) finalUrl = m.newImgUrl;
  const isPublic = /^https?:\/\//i.test(finalUrl) && !/flow-content\.google/i.test(finalUrl);

  const ok = await replaceProductImage(productId, imageIndex, finalUrl, originalUrl);
  if (!ok) {
    if (isStep) TemuImgStepper.stats.skipped++;
    toast(`⚠️ ${trunc(title || 'Product', 30)} · Image #${imageIndex + 1} replace nahi hui`, 'warn');
  } else {
    if (isStep) TemuImgStepper.stats.done++;
    await temuRenderReview();
    toast(isPublic
      ? `✓ ${trunc(title || 'Product', 30)} · Image #${imageIndex + 1} replaced · Temu link ready`
      : `✓ Image #${imageIndex + 1} replaced — public link nahi bana (export se pehle dobara try hoga)`, isPublic ? 'ok' : 'warn');
  }

  if (isStep && isActiveStepperJob(m.jobId)) {
    TemuImgStepper.activeJobId = null;
    temuStepScheduleNext();
  }
}

// v9.10.1 — human-like pacing between Flow jobs (random 4–9 s) so the account doesn't
// fire generations back-to-back like a bot.
function temuStepScheduleNext() {
  if (!TemuImgStepper.running) return;
  const more = TemuImgStepper.queue[TemuImgStepper.currentIndex]?.continueStage || TemuImgStepper.currentIndex + 1 < TemuImgStepper.queue.length;
  if (!more) {
    const session = TemuImgStepper, idx = session.currentIndex;
    setTimeout(() => {
      if (TemuImgStepper === session && session.running && session.currentIndex === idx && !session.activeJobId) temuStepAdvance();
    }, 800);
    return;
  }
  const sp = FLOW_SPEEDS[flowSpeedKey()];
  const wait = sp.min + Math.floor(Math.random() * (sp.max - sp.min));
  temuStepSetStatus(`✓ Replaced — agla image ${Math.round(wait / 1000)}s mein…`, 'ok');
  const idx = TemuImgStepper.currentIndex;
  const session = TemuImgStepper;
  setTimeout(() => {
    if (TemuImgStepper === session && session.running && session.currentIndex === idx && !session.activeJobId) temuStepAdvance();
  }, wait);
}

// v9.10.1 — watchdog: while a step waits on Flow, read the job record from storage.
// Works even if the runtime message from the Flow tab never reached the side panel.
setInterval(async () => {
  try {
    const id = TemuImgStepper?.running ? TemuImgStepper.activeJobId : null;
    if (!id) return;
    const pfa = (await chrome.storage.local.get(['pendingFlowAction']))?.pendingFlowAction;
    if (!pfa || pfa.jobId !== id) return;
    if (pfa.status === 'done' && pfa.newImgUrl && !FlowHandledResults.has(id)) {
      console.log('[ZHunter] Watchdog picked up Flow result from storage', id);
      await onFlowResult({ action: 'ZH_REPLACE_IMAGE_FROM_FLOW', jobId: id, newImgUrl: pfa.newImgUrl, mediaId: pfa.mediaId });
    } else if (pfa.status === 'error' && pfa.error && FlowJobs.has(id)) {
      onFlowStatus({ jobId: id, error: true, text: pfa.error });
    }
  } catch (e) { console.warn('[ZHunter] Flow watchdog error:', e); }
}, 2500);

// v9.10.1 — manual image for the current step (paste / drop / "Flow se latest")
async function temuStepApplyManualImage(src, how = 'manual') {
  if (!TemuImgStepper?.running) return false;
  const current = TemuImgStepper.queue?.[TemuImgStepper.currentIndex];
  if (!current || !src) return false;
  current.done = true;
  // A late automatic result for this step must not overwrite the manual one
  if (TemuImgStepper.activeJobId) {
    FlowHandledResults.add(TemuImgStepper.activeJobId);
    _markFlowJobDone(TemuImgStepper.activeJobId, /^https?:/i.test(src) ? src : null);
  }
  temuStepCancelActiveJob();
  temuStepSetStatus(`⏳ ${how}: image laga raha hoon…`);

  // v9.11.0 — local copy first (fast); the public Temu link is made in the background below,
  // so the next step no longer waits for the upload.
  let finalUrl = src;
  if (/^https:\/\/flow-content\.google\//i.test(src)) {
    try {
      const r = await msg({ action: 'FETCH_FLOW_IMAGE', url: src });
      if (r?.success && r.base64) finalUrl = r.base64;
    } catch (_) {}
    if (finalUrl === src) finalUrl = (await uploadImageToPublicHost(src)) || src;
  }
  const pid = current.product?.id, idx = current.imgIndex;
  const oldImg = _imgEntryUrl(current.product?.images?.[idx]);
  let ok = await replaceProductImage(pid, idx, finalUrl, null);
  if (Array.isArray(current.product?.images)) {
    const e = current.product.images[idx];
    current.product.images[idx] = typeof e === 'string' || e == null ? finalUrl : { ...e, url: finalUrl };
    ok = true;
  }
  if (ok) zhEditsRecord(pid, idx, oldImg, finalUrl, current.product?.url || '');   // v9.12.8
  if (!ok) { temuStepSetStatus('⚠️ Image nahi lagi — product list mein nahi mila', 'error'); return false; }
  const moreStages = current.stages && current.stageIndex + 1 < current.stages.length;
  if (moreStages) {
    current.imgUrl = finalUrl;
    current.stageIndex++;
    current.prompt = current.stages[current.stageIndex];
    current.continueStage = true;
    current.sentAt = null;
  } else {
    TemuImgStepper.stats.done++;
  }
  try { await temuRenderReview(); } catch (_) {}
  toast(`✓ ${trunc(current.product?.title || 'Product', 30)} · Image #${idx + 1} replaced (${how})`, 'ok');

  // data: image → public link in the background (Temu needs a URL)
  if (/^data:image\//i.test(finalUrl)) {
    (async () => {
      const pub = await uploadImageToPublicHost(finalUrl);
      if (pub && /^https?:\/\//i.test(pub)) {
        await replaceProductImage(pid, idx, pub, finalUrl);
        zhEditsRecord(pid, idx, finalUrl, pub, current.product?.url || '');
        const e = current.product?.images?.[idx];
        if (e === finalUrl) current.product.images[idx] = pub;
        else if (e && e.url === finalUrl) current.product.images[idx] = { ...e, url: pub };
      }
    })();
  }
  temuStepScheduleNext();
  return true;
}

function _fileToDataUrl(file) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
}

function temuStepModalOpen() {
  const m = $('temuImgStepperModal');
  return !!(m && !m.classList.contains('hidden') && TemuImgStepper?.running);
}

document.addEventListener('paste', async (e) => {
  if (!temuStepModalOpen()) return;
  const item = Array.from(e.clipboardData?.items || []).find(i => i.kind === 'file' && i.type.startsWith('image/'));
  if (!item) return;
  e.preventDefault();
  const f = item.getAsFile();
  if (f) await temuStepApplyManualImage(await _fileToDataUrl(f), 'Paste');
});

(function initTemuStepPasteZone() {
  const z = $('temuStepPasteZone');
  if (!z) return;
  z.addEventListener('click', () => z.focus());
  z.addEventListener('dragover', (e) => { e.preventDefault(); z.style.borderColor = '#00E5FF'; });
  z.addEventListener('dragleave', () => { z.style.borderColor = ''; });
  z.addEventListener('drop', async (e) => {
    e.preventDefault(); z.style.borderColor = '';
    const f = Array.from(e.dataTransfer?.files || []).find(x => x.type.startsWith('image/'));
    if (f) return temuStepApplyManualImage(await _fileToDataUrl(f), 'Drop');
    const url = e.dataTransfer?.getData('text/uri-list') || e.dataTransfer?.getData('text/plain') || '';
    if (/^https?:\/\//i.test(url.trim())) temuStepApplyManualImage(url.trim(), 'Drop');
  });
})();

// v9.10.1 — list every Flow media image in the project grid (DOM order = newest first)
async function flowScanImages() {
  const tabs = await chrome.tabs.query({ url: '*://flow.google.com/*' });
  const tab = tabs.find(t => /\/project\//.test(t.url || '')) || tabs[0];
  if (!tab) return null;
  try {
    const [r] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const re = /^https:\/\/flow-content\.google\/image\/([\w-]+)/i;
        const out = [];
        for (const img of document.querySelectorAll('img')) {
          const s = img.currentSrc || img.src || '';
          const m = s.match(re);
          if (!m) continue;
          if (img.closest('flow-base-prompt-box, flow-add-menu-popover-content, flow-agent-panel, .cdk-overlay-container')) continue;
          const t = (img.closest('flow-grid-tile-container, [aria-label]')?.getAttribute('aria-label') || '').trim();
          const holder = img.closest('flow-grid-tile-container');
          const generated = !!holder?.querySelector('button[aria-label="Reuse prompt"]') && !holder.querySelector('flow-pending-tile');
          out.push({ id: img.getAttribute('data-media-id') || m[1], src: s, title: t, generated, loaded: img.complete && img.naturalWidth > 0 });
        }
        return out;
      }
    });
    return r?.result || [];
  } catch (e) {
    // Navigation invalidates the old frame; the next polling cycle scans the new one.
    if (!/frame.*removed|no frame|no tab|cannot access|tab.*closed/i.test(String(e?.message || e))) {
      console.warn('[ZHunter] Flow scan failed:', e);
    }
    return null;
  }
}
const _flowUploadTitle = (t) => /\.(png|jpe?g|webp|gif|avif|heic)$/i.test(t || '') || /^zhunter_/i.test(t || '');

// Auto: while the active step is generating, look for the new image ourselves (same method
// as "Flow se latest", which works on every Flow build).
// v9.10.1 — ONE auto path, identical to the working "Flow se latest" button:
// per step, remember which Flow images existed when the step was sent; the first new
// (non-upload) image in the grid is this step's result → temuStepApplyManualImage.
let _flowPollBusy = false;
setInterval(async () => {
  if (_flowPollBusy) return;
  const S = TemuImgStepper;
  if (!S?.running || S.engine !== 'flow') return;
  const cur = S.queue?.[S.currentIndex];
  if (!cur || cur.done || !cur.sentAt) return;
  _flowPollBusy = true;
  try {
    const list = await flowScanImages();
    if (!Array.isArray(list)) { temuStepSetStatus('⚠️ Flow tab nahi mila / scan nahi hua — Flow tab khula rakhein', 'error'); return; }
    if (!cur.snap) { cur.snap = new Set(list.map(g => g.id)); return; }
    const info = FlowGenInfo.get(S.activeJobId);
    const hit = info && list.find(g => g.generated && g.loaded && !info.before.has(g.id) && !info.ref.has(g.id));
    if (hit && !cur.done && S.queue[S.currentIndex] === cur) {
      console.log('[ZHunter] Auto: new Flow image', hit.id, hit.title);
      await onFlowResult({ jobId: S.activeJobId, newImgUrl: hit.src });
    } else if (!hit) {
      const secs = Math.round((Date.now() - cur.sentAt) / 1000);
      const el = $('temuStepStatus');
      if (el && !/⚠️|✓|✅/.test(el.textContent)) el.textContent = `⏳ Generating… ${secs}s (Flow mein ${list.length} images, nayi abhi nahi)`;
    }
  } catch (e) { console.warn('[ZHunter] Auto poll error:', e); }
  finally { _flowPollBusy = false; }
}, 1500);

// Newest generated image in the open Flow project (skips uploads and prompt-box chips)
async function temuStepGrabLatestFromFlow() {
  const tabs = await chrome.tabs.query({ url: '*://flow.google.com/*' });
  const tab = tabs.find(t => /\/project\//.test(t.url || '')) || tabs[0];
  if (!tab) { toast('Flow tab khula nahi', 'warn'); return; }
  let src = null;
  try {
    const [r] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const re = /^https:\/\/flow-content\.google\/image\/([\w-]+)/i;
        const chipIds = new Set(Array.from(document.querySelectorAll('flow-base-prompt-box img'))
          .map(i => ((i.currentSrc || i.src || '').match(re) || [])[1]).filter(Boolean));
        for (const img of document.querySelectorAll('img')) {
          const s = img.currentSrc || img.src || '';
          const m = s.match(re);
          if (!m || chipIds.has(m[1])) continue;
          if (img.closest('flow-base-prompt-box, flow-add-menu-popover-content, flow-agent-panel, .cdk-overlay-container')) continue;
          const t = (img.closest('flow-grid-tile-container, [aria-label]')?.getAttribute('aria-label') || '').trim();
          if (/\.(png|jpe?g|webp|gif|avif|heic)$/i.test(t) || /^zhunter_/i.test(t)) continue;
          return s;
        }
        return null;
      }
    });
    src = r?.result || null;
  } catch (e) { console.warn('[ZHunter] Grab from Flow failed:', e); }
  if (!src) { toast('Flow mein koi generated image nahi mili', 'warn'); return; }
  await temuStepApplyManualImage(src, 'Flow latest');
}
$('temuStepGrabFlowBtn')?.addEventListener('click', () => temuStepGrabLatestFromFlow());

// v9.10.1 — backup delivery: the Flow tab also writes the result into storage.
// onFlowResult removes the job synchronously, so a result is never applied twice.
try {
  chrome.storage.onChanged.addListener((changes, area) => {
    const nv = area === 'local' ? changes.pendingFlowAction?.newValue : null;
    if (nv?.status === 'done' && nv.newImgUrl && nv.jobId && FlowJobs.has(nv.jobId)) {
      onFlowResult({ action: 'ZH_REPLACE_IMAGE_FROM_FLOW', jobId: nv.jobId, newImgUrl: nv.newImgUrl, mediaId: nv.mediaId })
        .catch(e => console.warn('[ZHunter] Replace from Flow (storage) error:', e));
    }
  });
} catch (_) {}

chrome.runtime.onMessage.addListener((m) => {
  if (m?.action === 'ZH_FLOW_STATUS' || m?.action === 'ZH_REPLACE_IMAGE_FROM_FLOW') {
    console.log('[ZHunter] Flow msg', m.action, m.jobId, m.phase || '', '| active:', TemuImgStepper?.activeJobId, '| known:', FlowJobs.has(m.jobId));
  }
  if (m?.action === 'ZH_FLOW_STATUS') onFlowStatus(m);
  else if (m?.action === 'ZH_REPLACE_IMAGE_FROM_FLOW' && m.newImgUrl) {
    onFlowResult(m).catch(e => console.warn('[ZHunter] Replace from Flow error:', e));
  }
});

function initLightbox() {
  $('lightboxCloseBtn')?.addEventListener('click', closeLightbox);
  $('lightboxBackdrop')?.addEventListener('click', closeLightbox);

  const imgArea = document.querySelector('.lightbox-img-area');
  imgArea?.addEventListener('click', (e) => {
    if (e.target.tagName === 'IMG' || e.target === imgArea) {
      imgArea.classList.toggle('zoomed');
    }
  });

  $('lightboxDownloadBtn')?.addEventListener('click', () => {
    if (!currentLightboxSrc) return;
    const filename = `zhunter_preview_${Date.now()}.jpg`;
    chrome.downloads.download({ url: currentLightboxSrc, filename, saveAs: false }, () => {
      if (chrome.runtime.lastError) {
        window.open(currentLightboxSrc, '_blank');
      } else {
        toast('Image downloaded!', 'ok');
      }
    });
  });

  // Edit with Flow button
  $('lightboxFlowBtn')?.addEventListener('click', () => {
    triggerFlowEdit({
      src: currentLightboxSrc,
      title: currentLightboxTitle
    });
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!$('lightboxModal')?.classList.contains('hidden')) closeLightbox();
      if (!$('shortcutsModal')?.classList.contains('hidden')) closeShortcutsModal();
    }
    if (!$('lightboxModal')?.classList.contains('hidden') && currentLightboxList.length > 1) {
      if (e.key === 'ArrowLeft') {
        currentLightboxIdx = (currentLightboxIdx - 1 + currentLightboxList.length) % currentLightboxList.length;
        const nextSrc = currentLightboxList[currentLightboxIdx];
        openLightbox(nextSrc, currentLightboxTitle.replace(/\s*\(\d+\s*\/\s*\d+\)/, ''), currentLightboxList, currentLightboxIdx);
      } else if (e.key === 'ArrowRight') {
        currentLightboxIdx = (currentLightboxIdx + 1) % currentLightboxList.length;
        const nextSrc = currentLightboxList[currentLightboxIdx];
        openLightbox(nextSrc, currentLightboxTitle.replace(/\s*\(\d+\s*\/\s*\d+\)/, ''), currentLightboxList, currentLightboxIdx);
      }
    }
    if (e.key === '?' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) {
      toggleShortcutsModal();
    }
  });
}

// ── Shortcuts Modal ───────────────────────────────────────────
function toggleShortcutsModal() {
  const m = $('shortcutsModal');
  if (!m) return;
  if (m.classList.contains('hidden')) {
    m.classList.remove('hidden');
    m.setAttribute('aria-hidden', 'false');
  } else {
    closeShortcutsModal();
  }
}

function closeShortcutsModal() {
  const m = $('shortcutsModal');
  if (!m) return;
  const focused = m.querySelector(':focus');
  if (focused) focused.blur();
  m.classList.add('hidden');
  m.setAttribute('aria-hidden', 'true');
}

function initShortcutsModal() {
  $('shortcutsCloseBtn')?.addEventListener('click', closeShortcutsModal);
  $('shortcutsBackdrop')?.addEventListener('click', closeShortcutsModal);
}

// ── Modals ────────────────────────────────────────────────────
function initModals() {
  initLightbox();
  initShortcutsModal();
  $('closeEditModal')?.addEventListener('click', closeEdit);
  $('cancelEditBtn')?.addEventListener('click', closeEdit);
  $('saveEditBtn')?.addEventListener('click', handleSaveEdit);
  $('editAddImageBtn')?.addEventListener('click', () => {
    State.imageUrlTarget = 'edit';
    openImageUrlModal();
  });

  $('confirmCancel')?.addEventListener('click', () => {
    $('confirmModal')?.classList.add('hidden');
    State.confirmCb = null;
  });
  $('confirmOk')?.addEventListener('click', () => {
    $('confirmModal')?.classList.add('hidden');
    if (State.confirmCb) { State.confirmCb(); State.confirmCb = null; }
  });

  ['editModal', 'confirmModal', 'imageUrlModal', 'huntPreviewModal', 'huntBulkModal', 'queueImportPreviewModal'].forEach(id => {
    $(id)?.addEventListener('click', e => {
      if (e.target === $(id)) {
        const box = $(id).querySelector('.modal-box');
        if (box) {
          box.classList.add('closing');
          setTimeout(() => {
            $(id).classList.add('hidden');
            box.classList.remove('closing');
          }, 150);
        } else {
          $(id).classList.add('hidden');
        }
        if (id === 'editModal') State.confirmCb = null;
        if (id === 'queueImportPreviewModal') closeQueueImportPreview();
      }
    });
  });

  document.addEventListener('keydown', e => {
    const activeTag = document.activeElement?.tagName?.toLowerCase();
    const isTyping = activeTag === 'input' || activeTag === 'textarea' || document.activeElement?.isContentEditable;

    // Search Shortcut: Ctrl+F
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      $('searchQuery')?.focus();
    }

    // Help Shortcut: ?
    if (e.key === '?' && !isTyping) {
      e.preventDefault();
      const sm = $('shortcutsModal');
      if (sm) sm.classList.toggle('hidden');
    }

    // Quick Tab Switching: 1-4
    if (!isTyping && !e.ctrlKey && !e.altKey && !e.metaKey && ['1','2','3','4'].includes(e.key)) {
      const tabMap = { '1': 'tab-btn-images', '2': 'tab-btn-bulk', '3': 'tab-btn-library', '4': 'tab-btn-settings' };
      $(tabMap[e.key])?.click();
    }

    // Escape handler
    if (e.key === 'Escape') {
      let closedModal = false;
      ['shortcutsModal', 'editModal', 'confirmModal', 'imageUrlModal', 'huntPreviewModal', 'huntBulkModal', 'queueImportPreviewModal'].forEach(id => {
        const m = $(id);
        if (m && !m.classList.contains('hidden')) {
          const box = m.querySelector('.modal-box');
          if (box) {
            box.classList.add('closing');
            setTimeout(() => {
              m.classList.add('hidden');
              box.classList.remove('closing');
            }, 150);
          } else {
            m.classList.add('hidden');
          }
          if (id === 'queueImportPreviewModal') closeQueueImportPreview();
          closedModal = true;
        }
      });
      // Clear bulk selection if no modal is open
      if (!closedModal && State.selectedIds && State.selectedIds.size > 0) {
        State.selectedIds.clear();
        renderLinksTab();
      }
    }
  });

  // Close shortcuts modal on close button or click outside
  $('shortcutsModalClose')?.addEventListener('click', () => {
    $('shortcutsModal')?.classList.add('hidden');
  });
  $('shortcutsModal')?.addEventListener('click', e => {
    if (e.target === $('shortcutsModal')) $('shortcutsModal').classList.add('hidden');
  });
}

// ── Hunt Preview Modal ───────────────────────────────────────
// Pre-save review: lets user pick which scraped images to keep
// and edit all fields before committing the save.
const HuntState = {
  url:      '',
  imageUrls: [],
  selected:  new Set(),    // indices of huntImageUrls that are checked
  tags:      [],
  videos:    [],
  bullets:   []
};

function openHuntPreviewModal(scraped, tab) {
  HuntState.url       = scraped.url || tab?.url || '';
  HuntState.imageUrls = (Array.isArray(scraped.images) ? scraped.images : []).slice(0, 15);
  HuntState.selected  = new Set(HuntState.imageUrls.map((_, i) => i));
  HuntState.tags      = [];
  HuntState.videos    = (Array.isArray(scraped.videos) ? scraped.videos : []).slice(0, 12);

  const setVal = (id, val) => { const el = $(id); if (el) el.value = val || ''; };
  setVal('huntUrl',      HuntState.url);
  setVal('huntTitle',    scraped.title || tab?.title || '');
  setVal('huntPrice',    scraped.price || '');
  setVal('huntCategory', detectCat(HuntState.url));
  setVal('huntVideoUrl', HuntState.videos[0] || '');
  setVal('huntNotes',    '');
  // v8.4.0: auto-detected details (editable)
  setVal('huntBrand',   scraped.brand  || '');
  setVal('huntColor',   scraped.color  || '');
  setVal('modalWeight', scraped.weight || '');
  setVal('modalLength', scraped.dimL   || '');
  setVal('modalWidth',  scraped.dimW   || '');
  setVal('modalHeight', scraped.dimH   || '');
  HuntState.bullets = Array.isArray(scraped.bullets) ? scraped.bullets : [];

  // Folder dropdown
  const folderSel = $('huntFolder');
  if (folderSel) {
    folderSel.innerHTML = '';
    const folders = State.data?.folders || ['General'];
    const lastFolder = State.data?.settings?.lastFolder || 'General';
    folders.forEach(f => {
      const opt = document.createElement('option');
      opt.value = f;
      opt.textContent = f;
      if (f === lastFolder) opt.selected = true;
      folderSel.appendChild(opt);
    });
  }

  renderHuntImages();
  renderHuntTags();
  $('huntPreviewModal')?.classList.remove('hidden');
}

function closeHuntPreviewModal() {
  $('huntPreviewModal')?.classList.add('hidden');
}

function renderHuntImages() {
  const grid = $('huntImagesGrid');
  if (!grid) return;
  grid.innerHTML = '';

  if (HuntState.imageUrls.length === 0) {
    grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:var(--text3);padding:24px;font-size:12px">No images scraped from this page</div>';
    updateHuntCounter();
    return;
  }

  HuntState.imageUrls.forEach((url, i) => {
    const card = document.createElement('div');
    card.className = 'hunt-img-card' + (HuntState.selected.has(i) ? ' selected' : '');
    card.dataset.idx = i;
    card.title = HuntState.selected.has(i) ? 'Click to skip this image' : 'Click to include this image';
    card.innerHTML = `
      <img src="${url}" alt="Image ${i + 1}" loading="lazy"
           data-onerror="broken" />
      <div class="hunt-img-mark"></div>`;
    card.addEventListener('click', () => {
      const idx = parseInt(card.dataset.idx, 10);
      if (HuntState.selected.has(idx)) HuntState.selected.delete(idx);
      else HuntState.selected.add(idx);
      card.classList.toggle('selected');
      card.title = HuntState.selected.has(idx) ? 'Click to skip this image' : 'Click to include this image';
      updateHuntCounter();
    });
    // If image fails to load, auto-deselect it
    const imgEl = card.querySelector('img');
    if (imgEl) {
      imgEl.addEventListener('error', () => {
        const idx = parseInt(card.dataset.idx, 10);
        HuntState.selected.delete(idx);
        card.classList.remove('selected');
        updateHuntCounter();
      });
    }
    grid.appendChild(card);
  });
  updateHuntCounter();
}

function updateHuntCounter() {
  const el = $('huntImgCounter');
  if (el) el.textContent = `${HuntState.selected.size}/${HuntState.imageUrls.length} selected`;
}

function renderHuntTags() {
  // Reuse the existing global tag picker helper for consistent style + behavior
  renderTagsPicker('huntTagsSelector', HuntState.tags);
}

// Wire up modal buttons (run on DOMContentLoaded inside the main IIFE)
function initHuntPreviewModal() {
  $('closeHuntModal')?.addEventListener('click', closeHuntPreviewModal);
  $('cancelHuntBtn')?.addEventListener('click', closeHuntPreviewModal);

  $('huntSelectAllBtn')?.addEventListener('click', () => {
    HuntState.selected = new Set(HuntState.imageUrls.map((_, i) => i));
    renderHuntImages();
  });
  $('huntDeselectAllBtn')?.addEventListener('click', () => {
    HuntState.selected = new Set();
    renderHuntImages();
  });

  $('confirmHuntSaveBtn')?.addEventListener('click', async () => {
    const btn = $('confirmHuntSaveBtn');
    btn.disabled = true;
    const origText = btn.textContent;
    btn.textContent = 'Saving…';

    try {
      const url      = ($('huntUrl')?.value      || HuntState.url || '').trim();
      const title    = ($('huntTitle')?.value    || '').trim();
      const price    = ($('huntPrice')?.value    || '').trim();
      const category = ($('huntCategory')?.value || '').trim();
      const folder   = $('huntFolder')?.value    || 'General';
      const videoUrl = ($('huntVideoUrl')?.value || HuntState.videos?.[0] || '').trim();
      const notes    = ($('huntNotes')?.value    || '').trim();
      const brand    = ($('huntBrand')?.value    || '').trim();
      const color    = ($('huntColor')?.value    || '').trim();
      const weight   = ($('modalWeight')?.value  || '').trim();
      const dimL     = ($('modalLength')?.value  || '').trim();
      const dimW     = ($('modalWidth')?.value   || '').trim();
      const dimH     = ($('modalHeight')?.value  || '').trim();

      // Picked images only
      const pickedUrls = HuntState.imageUrls.filter((_, i) => HuntState.selected.has(i));

      const fastRes = await msg({
        action:   'ADD_LINK_FAST',
        url, title, folder, notes, price,
        tags:     [...HuntState.tags],
        imageUrls: pickedUrls,
        videos:    HuntState.videos,
        videoUrl,
        brand, color, weight, dimL, dimW, dimH, bullets: HuntState.bullets || []
      });

      if (!fastRes?.success) {
        btn.disabled = false;
        btn.textContent = origText;
        if (fastRes?.reason === 'duplicate') {
          toast('This product is already saved', 'warn');
        } else {
          toast('Save failed — please try again', 'err');
        }
        return;
      }

      // If user picked a custom category that's different from auto-detected,
      // patch it via UPDATE_LINK
      if (category && fastRes.link.category !== category) {
        msg({ action: 'UPDATE_LINK', id: fastRes.link.id, updates: { category } }).catch(() => {});
      }

      closeHuntPreviewModal();
      State.openFolders.add(folder);
      await refresh();
      toast('Product saved! 🛍️ Images loading in background…', 'ok');

      // Background enrichment (base64 images)
      msg({ action: 'ENRICH_LINK', linkId: fastRes.link.id }).catch(() => {});

    } finally {
      const b = $('confirmHuntSaveBtn');
      if (b) {
        b.disabled = false;
        b.textContent = origText;
      }
    }
  });

  // Click outside to close
  $('huntPreviewModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'huntPreviewModal') closeHuntPreviewModal();
  });
}

function openEditModal(link) {
  State.editTags   = [...(link.tags || [])];
  State.editImages = Array.isArray(link.images) && link.images.length > 0
    ? [...link.images]
    : link.base64Image ? [link.base64Image] : [];
  State.editIsMasterRow = !!link._masterRow;

  const setVal = (id, val) => { const el = $(id); if (el) el.value = val || ''; };
  setVal('editLinkId',   link.id);
  setVal('editUrl',      link.url);
  setVal('editTitle',    link.title);
  setVal('editNotes',    link.notes || '');
  setVal('editPrice',    link.price || '');
  setVal('editCategory', link.category || '');
  setVal('editVideoUrl', link.videoUrl || '');

  syncFolderSelect('editFolder');
  const ef = $('editFolder');
  if (ef) ef.value = link.folder;

  renderTagsPicker('editTagsSelector', State.editTags);
  renderEditImages();

  $('editModal')?.classList.remove('hidden');
  setTimeout(() => $('editTitle')?.focus(), 100);
}

function renderEditImages() {
  const grid = $('editImagesGrid');
  if (!grid) return;
  grid.innerHTML = '';
  if (!State.editImages.length) {
    grid.innerHTML = '<div class="edit-imgs-empty">No images — click Add Image to upload</div>';
    return;
  }
  State.editImages.forEach((imgSrc, idx) => {
    const thumb = buildImageThumb(imgSrc, idx, (i) => {
      State.editImages.splice(i, 1);
      renderEditImages();
    });
    grid.appendChild(thumb);
  });
}

function closeEdit() {
  $('editModal')?.classList.add('hidden');
}

async function handleSaveEdit() {
  const id  = $('editLinkId')?.value;
  const url = $('editUrl')?.value.trim();
  if (!id) return;
  if (!url || !isValidURL(url)) {
    toast('Please enter a valid URL', 'err');
    return;
  }

  const btn = $('saveEditBtn');
  btn.disabled = true;
  btn.textContent = 'Saving…';

  if (State.editIsMasterRow) {
    // Save into master-rows storage
    const rows = await getMasterRows();
    const idx  = rows.findIndex(rx => rx.id === id);
    if (idx !== -1) {
      rows[idx].url   = url;
      rows[idx].title = $('editTitle')?.value.trim() || url;
      rows[idx].price = $('editPrice')?.value.trim() || rows[idx].price || '';
      Object.assign(rows[idx], zhLibraryPriceFields(rows[idx]));
    }
    await setMasterRows(rows);
    btn.disabled = false;
    btn.textContent = 'Save Changes';
    closeEdit();
    renderMasterRows(rows);          // re-render list with updated data
    toast('Product updated!', 'ok');
    return;
  }

  const updates = {
    url,
    title:    $('editTitle')?.value.trim() || url,
    notes:    $('editNotes')?.value.trim() || '',
    price:    $('editPrice')?.value.trim() || '',
    folder:   $('editFolder')?.value || 'General',
    category: $('editCategory')?.value.trim() || '',
    tags:     [...State.editTags],
    images:   [...State.editImages],
    videoUrl: $('editVideoUrl')?.value.trim() || ''
  };

  await msg({ action: 'UPDATE_LINK', id, updates });
  btn.disabled = false;
  btn.textContent = 'Save Changes';
  closeEdit();
  await refresh();
  toast('Product updated!', 'ok');
}

function showConfirm(title, message, btnLabel, cb) {
  const tEl = $('confirmTitle');
  const mEl = $('confirmMessage');
  const oEl = $('confirmOk');
  const modal = $('confirmModal');
  if (tEl) tEl.textContent = title;
  if (mEl) mEl.textContent = message;
  if (oEl) oEl.textContent = btnLabel;
  State.confirmCb = cb;
  if (modal) {
    modal.style.zIndex = '999999';
    modal.classList.remove('hidden');
  }
  setTimeout(() => $('confirmOk')?.focus(), 100);
}

// ── Toast ─────────────────────────────────────────────────────
function toast(message, type = 'info') {
  const stack = $('toastStack');
  if (!stack) return;
  while (stack.children.length >= 4) {
    stack.firstChild?.remove();
  }
  const item = document.createElement('div');
  item.className = `toast-item ${type}`;
  const icons = { ok: '✅', err: '❌', warn: '⚠️', info: 'ℹ️' };
  item.innerHTML = `<span class="toast-icon">${icons[type] || 'ℹ️'}</span><span>${esc(message)}</span>`;
  stack.appendChild(item);
  item.getBoundingClientRect(); // force reflow
  item.classList.add('visible');
  setTimeout(() => {
    item.classList.add('leaving');
    setTimeout(() => item.remove(), 320);
  }, 3200);
}

// ── Header Buttons ────────────────────────────────────────────
function initHeaderButtons() {
  $('settingsBtn')?.addEventListener('click', () => {
    $('tab-btn-settings')?.click();
  });
}

// ── Tab Visibility Management ─────────────────────────────────
function applyTabVisibility() {
  const s = State.data?.settings || {};
  const tabConfigs = [
    { key: 'showTabHunt', btnId: 'tab-btn-images' },
    { key: 'showTabBulk', btnId: 'tab-btn-bulk' },
    { key: 'showTabLibrary', btnId: 'tab-btn-library' },
    { key: 'showTabSettings', btnId: 'tab-btn-settings' }
  ];

  tabConfigs.forEach(t => {
    const isVisible = s[t.key] !== undefined ? !!s[t.key] : true;
    const btn = $(t.btnId);
    if (btn) {
      btn.classList.toggle('hidden', !isVisible);
    }
  });

  // If currently active tab is hidden, switch to the first visible tab
  const activeBtn = document.querySelector('.tab-nav .tab-btn.active');
  if (activeBtn && activeBtn.classList.contains('hidden')) {
    const firstVisible = document.querySelector('.tab-nav .tab-btn:not(.hidden)');
    if (firstVisible) {
      firstVisible.click();
    }
  }

  setTimeout(() => window.dispatchEvent(new Event('resize')), 50);
}

// ── Sidepanel Settings Panel ──────────────────────────────────
function initSettingsPanel() {
  const syncSettingsUI = () => {
    const s = State.data?.settings || {};
    document.querySelectorAll('#tab-settings [data-setting]').forEach(el => {
      const k = el.dataset.setting;
      if (el.type === 'checkbox') {
        el.checked = s[k] !== undefined ? !!s[k] : el.checked;
      } else if (el.type === 'number') {
        el.value = s[k] !== undefined ? s[k] : (el.value || 0);
      } else {
        el.value = s[k] !== undefined ? s[k] : el.value;
      }
    });

    const curTheme = State.theme || 'dark';
    document.querySelectorAll('#themeSeg button').forEach(b => {
      b.classList.toggle('active', b.dataset.theme === curTheme);
    });

    applyTabVisibility();
    updateStorageDisplay();
  };

  document.querySelectorAll('#themeSeg button').forEach(btn => {
    btn.addEventListener('click', async () => {
      const t = btn.dataset.theme;
      if (!['dark', 'light'].includes(t)) return;
      State.theme = t;
      applyTheme(t);
      await saveUIState();
      document.querySelectorAll('#themeSeg button').forEach(b => {
        b.classList.toggle('active', b.dataset.theme === t);
      });
      toast(`${t === 'light' ? '☀️ Light' : '🌙 Dark'} mode activated`, 'info');
    });
  });

  document.querySelectorAll('#tab-settings [data-setting]').forEach(el => {
    const handler = async () => {
      const k = el.dataset.setting;
      let val;
      if (el.type === 'checkbox') val = el.checked;
      else if (el.type === 'number') val = parseFloat(el.value) || 0;
      else val = el.value.trim();

      // Guard: Ensure at least one tab remains enabled
      if (k.startsWith('showTab') && !val) {
        const s = State.data?.settings || {};
        const tabKeys = ['showTabHunt', 'showTabBulk', 'showTabLibrary', 'showTabSettings'];
        const remaining = tabKeys.filter(key => {
          if (key === k) return false;
          return s[key] !== undefined ? !!s[key] : true;
        });
        if (remaining.length === 0) {
          el.checked = true;
          toast('At least one tab must remain enabled', 'warn');
          return;
        }
      }

      const patch = { [k]: val };
      if (!State.data.settings) State.data.settings = {};
      const previous = State.data.settings[k];
      try {
        const result = await msg({ action: 'UPDATE_SETTINGS', settings: patch });
        if (!result?.success) throw new Error(result?.error || 'Setting save failed');
        State.data.settings[k] = val;
        if (k === 'bulkSkipImageDownload') {
          toast(val ? 'Fast mode ON — skip image downloads' : 'Fast mode OFF — download images', 'ok');
        } else {
          toast('Setting saved', 'ok');
        }
      } catch (e) { State.data.settings[k] = previous; if (el.type === 'checkbox') el.checked = previous !== false; toast(e.message, 'err'); return; }

      if (k.startsWith('showTab')) {
        applyTabVisibility();
      }
    };

    if (el.type === 'checkbox' || el.tagName === 'SELECT') {
      el.addEventListener('change', handler);
    } else {
      el.addEventListener('change', handler);
    }
  });

  const ef = $('zhExportFolderToggle');
  if (ef) {
    chrome.storage.local.get('zhExportFolder', x => {
      ef.checked = x?.zhExportFolder !== false;
    });
    ef.addEventListener('change', () => {
      chrome.storage.local.set({ zhExportFolder: ef.checked });
      toast(ef.checked ? 'Downloads → ZHunter Export/<date>/' : 'Downloads → default folder', 'ok');
    });
  }

  // ── Page Frame Controls ──
  {
    const sendToActiveTab = (payload) => {
      try {
        chrome.tabs.query({ active: true }, tabs => {
          (tabs || []).forEach(tab => {
            if (tab && tab.id) {
              chrome.tabs.sendMessage(tab.id, { action: 'zhUpdateFrame', ...payload }).catch(() => {});
            }
          });
        });
      } catch (_) {}
    };

    const pf = $('zhPageFrameToggle');
    if (pf) {
      chrome.storage.local.get('zhPageFrame', x => { pf.checked = x?.zhPageFrame !== false; });
      pf.addEventListener('change', () => {
        chrome.storage.local.set({ zhPageFrame: pf.checked });
        sendToActiveTab({ enabled: pf.checked });
        toast(pf.checked ? 'Page frame ON' : 'Page frame OFF', 'ok');
      });
    }

    const updateFrameColor = (color) => {
      chrome.storage.local.set({ zhFrameColor: color });
      if ($('zhFrameColorPicker') && color !== 'rainbow') $('zhFrameColorPicker').value = color;
      document.querySelectorAll('.zh-fcol-preset').forEach(btn => {
        const isSel = (btn.dataset.color || '').toLowerCase() === color.toLowerCase();
        btn.classList.toggle('zh-fcol-active', isSel);
      });
      sendToActiveTab({ color });
      toast(color === 'rainbow' ? '🌈 Colorful Rainbow Border' : `Border color: ${color}`, 'ok');
    };

    const updateFrameMoving = (moving) => {
      chrome.storage.local.set({ zhFrameMoving: !!moving });
      const mt = $('zhFrameMovingToggle');
      if (mt) mt.checked = !!moving;
      sendToActiveTab({ moving: !!moving });
      toast(moving ? '⚡ Moving Animated Border ON' : 'Moving Border OFF', 'ok');
    };

    const updateFrameStyle = (style) => {
      chrome.storage.local.set({ zhFrameStyle: style });
      document.querySelectorAll('.zh-style-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.style === style);
      });
      sendToActiveTab({ style });
      const names = { laser: '⚡ Laser Comet', dual: '💫 Dual Beams', wave: '🌊 Fluid Rainbow Wave' };
      toast(`Style: ${names[style] || style}`, 'ok');
    };

    const updateFrameSpeed = (speed) => {
      const num = parseFloat(speed) || 3.5;
      chrome.storage.local.set({ zhFrameSpeed: num });
      if ($('zhFrameSpeedVal')) $('zhFrameSpeedVal').textContent = `${num}s`;
      if ($('zhFrameSpeedSlider')) $('zhFrameSpeedSlider').value = num;
      sendToActiveTab({ speed: num });
    };

    const updateFrameCorners = (corner) => {
      chrome.storage.local.set({ zhFrameCorners: corner });
      document.querySelectorAll('.zh-corner-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.corner === corner);
      });
      sendToActiveTab({ corners: corner });
      toast(`Border corners: ${corner}`, 'ok');
    };

    const updateFrameWidth = (w) => {
      const num = parseFloat(w) || 5.5;
      chrome.storage.local.set({ zhFrameWidth: num });
      if ($('zhFrameWidthVal')) $('zhFrameWidthVal').textContent = `${num}px`;
      if ($('zhFrameWidthSlider')) $('zhFrameWidthSlider').value = num;
      sendToActiveTab({ width: num });
    };

    const updateFrameBright = (b) => {
      const num = parseInt(b, 10) || 100;
      chrome.storage.local.set({ zhFrameBrightness: num });
      if ($('zhFrameBrightVal')) $('zhFrameBrightVal').textContent = `${num}%`;
      if ($('zhFrameBrightSlider')) $('zhFrameBrightSlider').value = num;
      sendToActiveTab({ brightness: num });
    };

    chrome.storage.local.get(['zhFrameColor', 'zhFrameWidth', 'zhFrameBrightness', 'zhFrameCorners', 'zhFrameMoving', 'zhFrameStyle', 'zhFrameSpeed'], x => {
      const col = x?.zhFrameColor || '#FF1E56';
      if ($('zhFrameColorPicker') && col !== 'rainbow') $('zhFrameColorPicker').value = col;
      document.querySelectorAll('.zh-fcol-preset').forEach(btn => {
        btn.classList.toggle('zh-fcol-active', (btn.dataset.color || '').toLowerCase() === col.toLowerCase());
      });

      const w = x?.zhFrameWidth != null ? x.zhFrameWidth : 5.5;
      if ($('zhFrameWidthSlider')) $('zhFrameWidthSlider').value = w;
      if ($('zhFrameWidthVal')) $('zhFrameWidthVal').textContent = `${w}px`;

      const br = x?.zhFrameBrightness != null ? x.zhFrameBrightness : 100;
      if ($('zhFrameBrightSlider')) $('zhFrameBrightSlider').value = br;
      if ($('zhFrameBrightVal')) $('zhFrameBrightVal').textContent = `${br}%`;

      const c = x?.zhFrameCorners || 'square';
      document.querySelectorAll('.zh-corner-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.corner === c);
      });

      const moving = !!x?.zhFrameMoving;
      if ($('zhFrameMovingToggle')) $('zhFrameMovingToggle').checked = moving;

      const style = x?.zhFrameStyle || 'laser';
      document.querySelectorAll('.zh-style-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.style === style);
      });

      const speed = x?.zhFrameSpeed != null ? x.zhFrameSpeed : 3.5;
      if ($('zhFrameSpeedSlider')) $('zhFrameSpeedSlider').value = speed;
      if ($('zhFrameSpeedVal')) $('zhFrameSpeedVal').textContent = `${speed}s`;
    });

    $('zhFrameColorPicker')?.addEventListener('input', e => updateFrameColor(e.target.value));
    $('zhFrameMovingToggle')?.addEventListener('change', e => updateFrameMoving(e.target.checked));
    $('zhFrameSpeedSlider')?.addEventListener('input', e => updateFrameSpeed(e.target.value));
    $('zhFrameWidthSlider')?.addEventListener('input', e => updateFrameWidth(e.target.value));
    $('zhFrameBrightSlider')?.addEventListener('input', e => updateFrameBright(e.target.value));

    document.addEventListener('click', e => {
      const preset = e.target.closest('.zh-fcol-preset');
      if (preset && preset.dataset.color) {
        updateFrameColor(preset.dataset.color);
      }
      const cornerBtn = e.target.closest('.zh-corner-btn');
      if (cornerBtn && cornerBtn.dataset.corner) {
        updateFrameCorners(cornerBtn.dataset.corner);
      }
      const styleBtn = e.target.closest('.zh-style-btn');
      if (styleBtn && styleBtn.dataset.style) {
        updateFrameStyle(styleBtn.dataset.style);
      }
    });
  }

  function updateStorageDisplay() {
    const el = $('spStorageDesc');
    if (!el) return;
    if (chrome.storage?.local?.getBytesInUse) {
      chrome.storage.local.getBytesInUse(null, bytes => {
        if (bytes < 1024) el.textContent = `${bytes} B used`;
        else if (bytes < 1024 * 1024) el.textContent = `${(bytes / 1024).toFixed(1)} KB used`;
        else el.textContent = `${(bytes / (1024 * 1024)).toFixed(2)} MB used`;
      });
    } else {
      el.textContent = 'Local storage active';
    }
  }

  $('spRefreshStorageBtn')?.addEventListener('click', () => {
    updateStorageDisplay();
    toast('Storage stats refreshed', 'info');
  });

  $('spBackupDataBtn')?.addEventListener('click', async () => {
    try { const result = await msg({ action: 'BACKUP_EXPORT' }); if (!result?.success) throw new Error(result?.error || 'Backup failed'); zhSaveBlob(new Blob([JSON.stringify(result.backup, null, 2)], { type: 'application/json' }), 'zhunter_backup_' + new Date().toISOString().slice(0, 10) + '.json'); toast('Complete backup downloaded', 'ok'); } catch (e) { toast(e.message, 'err'); }
  });
  $('spResetLibraryBtn')?.addEventListener('click', resetMasterSheet);
  $('spWipeAllBtn')?.addEventListener('click', async () => {
    if (!confirm('Delete all products, queue, history, edits and pending sourcing records? Store configuration and connection keys remain.')) return;
    try { const result = await msg({ action: 'MASTER_RESET', wipe: true }); if (!result?.success) throw new Error(result?.error || 'Wipe failed'); MasterUIState.allRows = []; MasterUIState.selectedIds.clear(); BulkState.results = []; TemuLast = null; await updateMasterStats(); await loadBulkQueue(); await refresh(); toast('Data cleared', 'ok'); } catch (e) { toast(e.message, 'err'); }
  });

  syncSettingsUI();
}

// ═════════════════════════════════════════════════════════════════
// ═══ UPGRADE B: Groq AI Studio Engine ═══
// ═════════════════════════════════════════════════════════════════
const GROQ_API_KEYS = []; // Configure your private keys in Settings; never bundle credentials. // Configure private API keys in Settings; never publish credentials.
let _groqKeyIdx = 0;
const DEFAULT_GROQ_API_KEY = GROQ_API_KEYS[0];
const DEFAULT_GROQ_MODEL = 'qwen/qwen3.8-27b';

function parseGroqKeys(text) {
  const keys = [...new Set(String(text || '').split(/[\s,;]+/).map(k => k.trim()).filter(Boolean))];
  if (keys.some(key => !/^gsk_[A-Za-z0-9]+$/.test(key))) throw new Error('Groq keys gsk_ se shuru hon; har key alag line mein paste karein');
  return keys;
}

async function getGroqConfig() {
  const res = await chrome.storage.local.get(['groqApiKeys', 'groqKeyMode', 'groqModel']);
  // Replace the deleted legacy key on migration. Saved [] explicitly disables AI.
  const keys = Array.isArray(res.groqApiKeys) ? parseGroqKeys(res.groqApiKeys.join('\n')) : [...GROQ_API_KEYS];
  if (!Array.isArray(res.groqApiKeys)) {
    await chrome.storage.local.set({ groqApiKeys: keys, groqKeyMode: 'multiple' });
    await chrome.storage.local.remove('groqApiKey');
  }
  let model = res.groqModel || DEFAULT_GROQ_MODEL;
  if (model.includes('llama') || model.includes('mixtral') || model.includes('gpt-oss')) model = DEFAULT_GROQ_MODEL;
  const mode = res.groqKeyMode || 'multiple';
  return { apiKeys: mode === 'single' ? keys.slice(0, 1) : keys, allKeys: keys, keyMode: mode, model };
}

let _groqRequestQueue = Promise.resolve();
const _groqKeyCooldowns = new Map();
const _groqInvalidKeys = new Set(); // 401 keys stay disabled until the panel reloads
function callGroqAPI(args) {
  const request = _groqRequestQueue.then(() => callGroqAPIRequest(args));
  _groqRequestQueue = request.catch(() => {});
  return request;
}

function groqRetryDelayMs(response, message) {
  const retry = response.headers?.get('retry-after');
  const seconds = Number(retry);
  const hint = String(message || '').match(/try again in\s+([\d.]+)\s*s/i);
  const dateDelay = retry && !Number.isFinite(seconds) ? Date.parse(retry) - Date.now() : 0;
  return Math.max(2000, Math.ceil(Math.max(Number.isFinite(seconds) ? seconds * 1000 : 0, hint ? Number(hint[1]) * 1000 : 0, dateDelay || 0, !retry && !hint ? 10000 : 0) + 1000));
}

async function callGroqAPIRequest({ prompt, systemPrompt, temperature = 0.3, max_tokens = 150 }) {
  const cfg = await getGroqConfig();
  let model = cfg.model || DEFAULT_GROQ_MODEL;
  if (model.includes('llama') || model.includes('mixtral') || model.includes('gpt-oss')) {
    model = DEFAULT_GROQ_MODEL;
    chrome.storage.local.set({ groqModel: DEFAULT_GROQ_MODEL });
  }

  // Active key pool: bundled keys + custom configured key if different
  const activeKeys = [...cfg.apiKeys];
  if (!activeKeys.length) throw new Error('AI keys clear hain. Settings mein valid Groq key save karein.');

  // Round-robin selection: each request uses the next key to distribute load
  const startIdx = _groqKeyIdx % activeKeys.length;
  _groqKeyIdx = (_groqKeyIdx + 1) % activeKeys.length;

  let lastError = null;
  let rateRetries = 0;
  // Failover loop: if a key hits rate limit or error, switch immediately to next key
  const unavailableKeys = new Set(_groqInvalidKeys);
  for (let attempt = 0; attempt < activeKeys.length * 3; attempt++) {
    let keyIdx = (startIdx + attempt) % activeKeys.length;
    const availableIdx = activeKeys.map((_, offset) => (keyIdx + offset) % activeKeys.length)
      .find(index => !unavailableKeys.has(activeKeys[index]) && (_groqKeyCooldowns.get(activeKeys[index]) || 0) <= Date.now());
    if (availableIdx !== undefined) keyIdx = availableIdx;
    const currentKey = activeKeys[keyIdx];
    if (availableIdx === undefined) {
      const usableKeys = activeKeys.filter(key => !unavailableKeys.has(key));
      if (!usableKeys.length) {
        // Fallback to bundled working keys if user keys failed/invalid
        const fallbackKeys = GROQ_API_KEYS.filter(k => !unavailableKeys.has(k) && !activeKeys.includes(k));
        if (fallbackKeys.length) {
          activeKeys.push(...fallbackKeys);
          continue;
        }
        break;
      }
      const delay = Math.min(...usableKeys.map(key => _groqKeyCooldowns.get(key) || 0)) - Date.now();
      if (rateRetries >= 2 || delay > 60000) {
        const error = new Error('Sab available Groq keys limited hain: thora ruk kar dobara try karein');
        error.rateLimit = true; throw error;
      }
      rateRetries++;
      toast(`Sab AI keys cooldown mein · ${Math.ceil(delay / 1000)}s wait, phir retry`, 'info');
      await new Promise(resolve => setTimeout(resolve, Math.max(0, delay)));
      attempt--;
      continue;
    }

    try {
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${currentKey}`
        },
        signal: AbortSignal.timeout(45000),
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt || 'You are an expert e-commerce catalog optimizer. Return only the requested output without conversational filler.' },
            { role: 'user', content: prompt }
          ],
          temperature,
          max_tokens: Math.min(Number(max_tokens) || 150, 2200)
        })
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        const msg = errData?.error?.message || `HTTP ${response.status}: ${response.statusText}`;

        // Auto-recovery for model name
        if (model !== DEFAULT_GROQ_MODEL && (msg.includes('does not exist') || msg.includes('do not have access'))) {
          console.warn(`Model ${model} unavailable, switching to ${DEFAULT_GROQ_MODEL}`);
          await new Promise(r => chrome.storage.local.set({ groqModel: DEFAULT_GROQ_MODEL }, r));
          const badge = $('aiActiveModelBadge');
          if (badge) badge.textContent = 'qwen-27b';
          model = DEFAULT_GROQ_MODEL;
          attempt--;
          continue;
        }

        if (response.status === 429 || /rate limit/i.test(msg)) {
          const delay = groqRetryDelayMs(response, msg);
          _groqKeyCooldowns.set(currentKey, Date.now() + delay);
          lastError = new Error('Groq key cooldown: next available key try ho rahi hai');
          lastError.rateLimit = true;
          continue;
        }
        // Authentication failure can use another configured key.
        if (response.status === 401 || response.status === 403 || /quota|exceeded/i.test(msg)) {
          unavailableKeys.add(currentKey);
          if (response.status === 401) _groqInvalidKeys.add(currentKey);
          const reason = response.status === 401 ? 'Authentication failed: key invalid/revoked' : response.status === 403 ? 'Access denied: check model/account permissions' : 'Quota unavailable';
          console.warn(`[Groq AI] Key #${keyIdx + 1}: ${reason} (HTTP ${response.status}); skipping key.`);
          lastError = new Error(`Groq key #${keyIdx + 1}: ${reason}`);
          continue;
        }

        throw new Error(`Groq API error: ${msg}`);
      }

      const data = await response.json();
      _groqKeyCooldowns.delete(currentKey);
      if (data.choices?.[0]?.finish_reason === 'length') throw new Error('AI response truncated; reduce requested fields or retry');
      return data.choices?.[0]?.message?.content || '';
    } catch (err) {
      if (err.rateLimit) throw err;
      lastError = err;
      console.warn(`[Groq AI] Attempt with key #${keyIdx + 1} failed:`, err?.message || err);
    }
  }

  throw lastError || new Error('Koi usable Groq key nahi: configured keys authentication fail kar rahi hain. Valid key save karein.');
}

async function runGroqBatchOptimization(actionOrInstruction) {
  const selected = MasterUIState.selectedIds.size > 0 
    ? (MasterUIState.allRows || []).filter(r => MasterUIState.selectedIds.has(r.id))
    : (MasterUIState.visibleRows || []);

  if (!selected.length) {
    toast('No products to optimize. Select products or hunt some first!', 'warn');
    return;
  }

  let instruction = actionOrInstruction;
  if (actionOrInstruction === 'clean-brand') {
    instruction = 'Strip all brand names, trademark symbols, store names, SKU codes, and promotional words (e.g. HOT, NEW 2024, BEST, SALE). Keep only the essential, descriptive product keywords.';
  } else if (actionOrInstruction === 'seo-title') {
    instruction = 'Write a high-converting, professional e-commerce product title under 80 characters. Highlight key features, material, and type.';
  } else if (actionOrInstruction === 'uppercase-words') {
    instruction = 'Format the title in proper Title Case (capitalize first letter of each major word). Fix any ALL-CAPS or all-lowercase text.';
  } else if (actionOrInstruction === 'temu-bullet') {
    instruction = 'Optimize for Temu: concise, accurate, strictly under 60 characters, no brand names, title-cased.';
  }

  MasterUIState.lastAiUndo = selected.map(r => ({ id: r.id, title: r.title }));
  $('aiUndoBtn')?.classList.remove('hidden');

  const progressStrip = $('aiStatusProgress');
  const progressFill = $('aiProgressBarFill');
  const progressText = $('aiProgressText');
  if (progressStrip) progressStrip.classList.remove('hidden');

  const changes = [];
  const total = selected.length;
  let processed = 0;
  const batchSize = 4;

  toast(`⚡ Running Groq AI on ${total} products...`, 'run');

  for (let i = 0; i < total; i += batchSize) {
    const batch = selected.slice(i, i + batchSize);
    const batchInput = batch.map(b => ({ id: b.id, title: b.title || '(untitled)', facts: zhProductEvidence(b) }));

    const prompt = `Shared factual title and contextual claim rules:
${JSON.stringify(ZH_TITLE_OPTIMIZER_RULES.title_optimization)}
${JSON.stringify(ZH_TITLE_OPTIMIZER_RULES.restricted_content)}
${JSON.stringify(ZH_TITLE_OPTIMIZER_RULES.context_rule)}
Instruction (subject to the shared rules): ${instruction}

Input JSON list of products:
${JSON.stringify(batchInput, null, 2)}

Respond with ONLY a valid JSON array of objects with the exact structure:
[
  {"id": "...", "new_title": "..."}
]
Do not wrap in markdown quotes if possible, return raw JSON array only.`;

    try {
      const rawRes = await callGroqAPI({
        prompt,
        systemPrompt: 'You are an automated e-commerce optimization engine. You ONLY output valid JSON arrays. Never include explanations, pleasantries, or markdown wrappers.'
      });

      const cleaned = rawRes.replace(/```json/gi, '').replace(/```/g, '').trim();
      const results = JSON.parse(cleaned);

      if (Array.isArray(results)) {
        results.forEach(item => {
          if (item?.id && item?.new_title) {
            const target = batch.find(r => r.id === item.id);
            if (target) {
              const title = cleanTemuTitleResult(item.new_title);
              zhAssertProductContent(title, zhProductEvidence(target), temuGetCfg().title_remove_words || []);
              changes.push({ id: target.id, url: target.url, old: target.title, title });
              target.title = title;
            }
          }
        });
      }
    } catch (err) {
      console.warn('Groq batch error:', err);
      toast(`AI error on batch: ${err.message}`, 'warn');
    }

    processed += batch.length;
    const pct = Math.min(100, Math.round((processed / total) * 100));
    if (progressFill) progressFill.style.width = `${pct}%`;
    if (progressText) progressText.textContent = `Optimized ${processed}/${total} products (${pct}%)`;
  }

  if (changes.length) await temuSaveTitles(changes);
  filterAndRenderMasterRows();

  if (progressText) progressText.textContent = `✓ Done! Optimized ${total} products.`;
  setTimeout(() => {
    if (progressStrip) progressStrip.classList.add('hidden');
  }, 2500);
  toast(`✓ AI optimization completed!`, 'ok');
}

function initGroqStudio() {
  const syncKeyMode = () => {
    const multiple = $('groqKeyMode')?.value === 'multiple';
    $('groqApiKeyInput')?.classList.toggle('hidden', multiple);
    $('groqApiKeysInput')?.classList.toggle('hidden', !multiple);
  };
  getGroqConfig().then(cfg => {
    const keyInp = $('groqApiKeyInput');
    const modelSel = $('groqModelSel');
    const badge = $('aiActiveModelBadge');
    const key = cfg.allKeys[0] || '';
    let model = cfg.model;
    if (model.includes('llama') || model.includes('mixtral') || model.includes('gpt-oss')) model = DEFAULT_GROQ_MODEL;
    if (keyInp) keyInp.value = key;
    if ($('groqApiKeysInput')) $('groqApiKeysInput').value = cfg.allKeys.join('\n');
    if ($('groqKeyMode')) $('groqKeyMode').value = cfg.keyMode;
    if ($('groqKeyStatus')) $('groqKeyStatus').textContent = `${cfg.apiKeys.length} active keys`;
    syncKeyMode();
    if (modelSel) modelSel.value = model;
    if (badge) badge.textContent = model.includes('qwen') ? 'qwen-27b' : (model.includes('120b') ? 'gpt-oss-120b' : 'qwen-27b');
  }).catch(e => toast('AI settings: ' + e.message, 'warn'));
  $('groqKeyMode')?.addEventListener('change', syncKeyMode);
  $('groqShowKeysBtn')?.addEventListener('click', () => {
    const single = $('groqApiKeyInput'), multi = $('groqApiKeysInput');
    const show = single?.type === 'password';
    if (single) single.type = show ? 'text' : 'password';
    multi?.classList.toggle('keys-masked', !show);
    $('groqShowKeysBtn').textContent = show ? 'Hide' : 'Show';
  });

  $('testGroqKeysBtn')?.addEventListener('click', async () => {
    const btn = $('testGroqKeysBtn');
    const out = $('groqKeyTestOutput');
    const mode = $('groqKeyMode')?.value || 'single';
    let textKeys = mode === 'multiple' ? $('groqApiKeysInput')?.value : $('groqApiKeyInput')?.value;
    let keys = [];
    try {
      keys = parseGroqKeys(textKeys);
    } catch (_) {}
    if (!keys.length) {
      const cfg = await getGroqConfig();
      keys = cfg.allKeys || [];
    }
    if (!keys.length) {
      toast('Test ke liye koi Groq key mojud nahi hai', 'warn');
      return;
    }

    if (btn) { btn.disabled = true; btn.textContent = '⏳ Testing...'; }
    if (out) {
      out.style.display = 'block';
      out.innerHTML = `<div style="color:var(--text-sec,#94a3b8);font-weight:600;margin-bottom:4px;">🔍 Testing ${keys.length} Groq key(s)...</div>`;
    }

    const results = [];
    const deadKeys = [];
    const activeKeys = [];

    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      const masked = '...' + k.slice(-6);
      try {
        const res = await fetch('https://api.groq.com/openai/v1/models', {
          headers: { 'Authorization': `Bearer ${k}` }
        });
        if (res.ok) {
          results.push(`<div style="color:#10b981;">✓ Key #${i + 1} (${masked}): <b>Active (200 OK)</b></div>`);
          activeKeys.push(k);
        } else if (res.status === 401) {
          results.push(`<div style="color:#ef4444;">✗ Key #${i + 1} (${masked}): <b>Invalid / Expired (401)</b></div>`);
          deadKeys.push(k);
        } else if (res.status === 429) {
          results.push(`<div style="color:#f59e0b;">⏳ Key #${i + 1} (${masked}): <b>Rate limit / Cooldown (429)</b></div>`);
          activeKeys.push(k);
        } else {
          results.push(`<div style="color:#f59e0b;">! Key #${i + 1} (${masked}): HTTP ${res.status}</div>`);
          activeKeys.push(k);
        }
      } catch (err) {
        results.push(`<div style="color:#ef4444;">✗ Key #${i + 1} (${masked}): Network error (${err.message})</div>`);
      }
    }

    let summaryHtml = results.join('');
    if (deadKeys.length > 0) {
      summaryHtml += `<div style="margin-top:8px;padding-top:6px;border-top:1px solid rgba(255,255,255,0.08);display:flex;gap:8px;align-items:center;">
        <button type="button" id="groqRemoveDeadKeysBtn" class="btn btn-warn btn-xs">🗑️ Remove ${deadKeys.length} Dead Key(s)</button>
        <span style="font-size:10px;color:var(--text-sec,#94a3b8);">Kharab keys list se hatakar save karein</span>
      </div>`;
    }

    if (out) {
      out.innerHTML = summaryHtml;
      $('groqRemoveDeadKeysBtn')?.addEventListener('click', async () => {
        const remaining = keys.filter(k => !deadKeys.includes(k));
        const finalKeys = remaining.length ? remaining : [...GROQ_API_KEYS];
        await chrome.storage.local.set({ groqApiKeys: finalKeys });
        _groqInvalidKeys.clear();
        _groqKeyCooldowns.clear();
        if ($('groqApiKeyInput')) $('groqApiKeyInput').value = finalKeys[0] || '';
        if ($('groqApiKeysInput')) $('groqApiKeysInput').value = finalKeys.join('\n');
        if ($('groqKeyStatus')) $('groqKeyStatus').textContent = `${finalKeys.length} active keys`;
        out.innerHTML = `<div style="color:#10b981;font-weight:600;">✓ Dead keys remove ho gayin! Ab ${finalKeys.length} active key(s) hain.</div>`;
        toast(`${deadKeys.length} dead keys remove ho gayin!`, 'ok');
      });
    }

    if (btn) { btn.disabled = false; btn.textContent = '🧪 Test Keys'; }
    toast(`Key test mukammal: ${activeKeys.length} active, ${deadKeys.length} invalid`, activeKeys.length ? 'ok' : 'warn');
  });


  $('saveGroqKeyBtn')?.addEventListener('click', async () => {
    const mode = $('groqKeyMode')?.value || 'single';
    let keys;
    try {
      keys = parseGroqKeys(mode === 'multiple' ? $('groqApiKeysInput')?.value : $('groqApiKeyInput')?.value);
      if (!keys.length || (mode === 'single' && keys.length !== 1)) throw new Error('Single mode mein 1 key, multiple mein har key alag line mein paste karein');
    } catch (e) { toast(e.message, 'warn'); return; }
    const model = $('groqModelSel')?.value || DEFAULT_GROQ_MODEL;
    await chrome.storage.local.set({ groqApiKeys: keys, groqKeyMode: mode, groqModel: model });
    await chrome.storage.local.remove('groqApiKey');
    _groqInvalidKeys.clear(); _groqKeyCooldowns.clear(); _groqKeyIdx = 0;
    $('groqApiKeyInput').value = keys[0];
    $('groqApiKeysInput').value = keys.join('\n');
    $('groqKeyStatus').textContent = `${keys.length} active keys`;
    const badge = $('aiActiveModelBadge');
    if (badge) badge.textContent = model.includes('qwen') ? 'qwen-27b' : (model.includes('120b') ? 'gpt-oss-120b' : 'qwen-27b');
    toast(`${keys.length} API keys saved — old pool replaced`, 'ok');
  });
  $('clearGroqKeysBtn')?.addEventListener('click', async () => {
    await chrome.storage.local.set({ groqApiKeys: [] });
    await chrome.storage.local.remove('groqApiKey');
    _groqInvalidKeys.clear(); _groqKeyCooldowns.clear();
    $('groqApiKeyInput').value = ''; $('groqApiKeysInput').value = '';
    $('groqKeyStatus').textContent = '0 active keys';
    toast('API keys cleared — AI disabled until new keys saved', 'info');
  });

  $('groqModelSel')?.addEventListener('change', async e => {
    const model = e.target.value;
    await new Promise(r => chrome.storage.local.set({ groqModel: model }, r));
    const badge = $('aiActiveModelBadge');
    if (badge) badge.textContent = model.includes('qwen') ? 'qwen-27b' : (model.includes('120b') ? 'gpt-oss-120b' : 'qwen-27b');
  });

  $('aiApplyBtn')?.addEventListener('click', () => {
    const customPrompt = $('aiPromptInput')?.value?.trim();
    if (!customPrompt) {
      toast('Please enter an instruction in the prompt box', 'warn');
      $('aiPromptInput')?.focus();
      return;
    }
    runGroqBatchOptimization(customPrompt);
  });

  $('aiPromptInput')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') $('aiApplyBtn')?.click();
  });

  document.querySelectorAll('#masterAiPromptBar .ai-quick-btn[data-ai-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.aiAction;
      runGroqBatchOptimization(action);
    });
  });

  $('aiUndoBtn')?.addEventListener('click', async () => {
    if (!MasterUIState.lastAiUndo || !MasterUIState.lastAiUndo.length) return;
    MasterUIState.lastAiUndo.forEach(snap => {
      const target = MasterUIState.allRows.find(r => r.id === snap.id);
      if (target) target.title = snap.title;
    });
    await temuSaveTitles(MasterUIState.lastAiUndo.map(snap => ({ id: snap.id, url: MasterUIState.allRows.find(r => r.id === snap.id)?.url, title: snap.title })));
    filterAndRenderMasterRows();
    $('aiUndoBtn')?.classList.add('hidden');
    toast('Reverted AI changes', 'ok');
  });
}

// ── DOMContentLoaded ──────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  applyDynamicVersion();
  await loadData();
  initTheme();
  initTabs();
  initHeaderButtons();
  initModals();
  initImageUrlModal();
  initHuntPreviewModal();
  initBulkTab();
  renderAll();
  applyRipples();
  initImagesTab();
  initGroqStudio();
  initSettingsPanel();
  updateStatusLine();

  // ── Check for pending image hunt from right-click context menu ──
  setTimeout(async () => {
    try {
      const res = await msg({ action: 'GET_PENDING_IMAGE_HUNT' });
      if (res?.success && res.pending) {
        const pending = res.pending;
        // Switch to Images tab
        document.querySelector('[data-tab="images"]')?.click();
        // Scrape the tab if still open
        let scraped = null;
        if (pending.tabId) {
          scraped = await new Promise(resolve => {
            let done = false;
            const finish = v => { if (!done) { done = true; resolve(v); } };
            const t = setTimeout(() => finish(null), 6000);
            chrome.tabs.sendMessage(pending.tabId, { action: 'SCRAPE_PAGE' }, res2 => {
              clearTimeout(t);
              if (chrome.runtime.lastError || !res2?.success || !res2?.data) finish(null);
              else finish(res2.data);
            });
          });
        }
        if (!scraped) {
          // Fallback: open modal with just the page URL and the image
          scraped = { title: pending.tabTitle || '', url: pending.tabUrl, price: '', images: pending.imageUrl ? [pending.imageUrl] : [], videos: [], variants: [] };
        } else if (pending.imageUrl) {
          // Ensure the right-clicked image is first in the list
          const imgList = scraped.images || [];
          const withoutDup = imgList.filter(u => u !== pending.imageUrl);
          scraped.images = [pending.imageUrl, ...withoutDup].slice(0, 15);
        }
        const fakeTab = { id: pending.tabId, url: pending.tabUrl, title: pending.tabTitle };
        openHuntPreviewModal(scraped, fakeTab);
        toast('Right-click image hunt ready — review and save!', 'info');
      }
    } catch (_) {}
  }, 300);

  // Listen for background messages
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.action === 'LINK_ADDED') {
      refresh();
      toast('Product saved via context menu!', 'ok');
    }
    if (message.action === 'LINK_UPDATED') {
      // Background enrichment finished (images base64).
      // Update local state silently — no toast spam.
      if (message.link?.id && Array.isArray(State.data?.links)) {
        const i = State.data.links.findIndex(l => l.id === message.link.id);
        if (i !== -1) {
          State.data.links[i] = message.link;
          renderAll();
        } else {
          refresh();
        }
      } else {
        refresh();
      }
    }
    if (message.action === 'SHOW_TOAST') {
      toast(message.message, message.type || 'info');
    }
    return true;
  });
});
// ── Queue Import Preview (v7.11.0) ─────────────────────────────
// Classifies candidates via the background (no write), lets the user
// review accepted / duplicate / unsupported groups and untick rows,
// then adds only the checked accepted rows.
const QueueImportPreviewState = { accepted: [], source: 'manual', resolve: null, previewAction: 'PREVIEW_BULK_QUEUE', adder: null };

function qipPlatformLabel(p) {
  const map = { amazon: 'Amazon', walmart: 'Walmart', samsclub: "Sam's Club", faire: 'Faire' };
  return map[String(p || '').toLowerCase()] || (p ? String(p) : 'Web');
}

function qipReasonLabel(r) {
  return r === 'already_queued' ? 'already in queue'
    : r === 'repeated_in_batch' ? 'repeated in this import'
    : r === 'unsupported_url' ? 'not a supported product page'
    : (r || '');
}

function qipRenderGroup(title, rows, opts = {}) {
  if (!rows.length) return '';
  const { checkable = false, open = true, cls = '' } = opts;
  const items = rows.map((row, i) => {
    const label = esc(row.title || row.url);
    const sub = esc(row.url);
    const reason = row.reason ? `<span class="qip-reason">${esc(qipReasonLabel(row.reason))}</span>` : '';
    const plat = `<span class="qip-plat">${esc(qipPlatformLabel(row.platform))}</span>`;
    const box = checkable ? `<input type="checkbox" class="qip-check" data-idx="${i}" checked>` : '';
    return `<label class="qip-row ${cls}">${box}<div class="qip-row-main"><div class="qip-row-title" title="${sub}">${label}</div><div class="qip-row-sub">${plat}${reason}</div></div></label>`;
  }).join('');
  return `<details class="qip-group ${cls}" ${open ? 'open' : ''}><summary>${esc(title)} <span class="qip-count">${rows.length}</span></summary>${items}</details>`;
}

function qipUpdateConfirm() {
  const n = document.querySelectorAll('#qipGroups .qip-check:checked').length;
  const btn = $('qipConfirmBtn');
  if (btn) { btn.textContent = `Add ${n} to queue`; btn.disabled = n === 0; }
}

function closeQueueImportPreview(result) {
  $('queueImportPreviewModal')?.classList.add('hidden');
  const r = QueueImportPreviewState.resolve;
  QueueImportPreviewState.resolve = null;
  if (r) r(result || { success: false, addedCount: 0, rejected: [] });
}

async function showQueueImportPreview(items, source = 'manual', opts = {}) {
  QueueImportPreviewState.previewAction = opts.previewAction || 'PREVIEW_BULK_QUEUE';
  QueueImportPreviewState.adder = typeof opts.adder === 'function' ? opts.adder : null;
  const payload = items.map(item => typeof item === 'string' ? { url: item, source } : { ...item, source: item.source || source });
  if (!payload.length) { toast('Nothing to import.', 'warn'); return { success: false, addedCount: 0, rejected: [] }; }
  const preview = await msg({ action: QueueImportPreviewState.previewAction, items: payload });
  if (!preview?.success) {
    toast(preview?.error || 'Could not check links.', 'err');
    return { success: false, addedCount: 0, rejected: [] };
  }
  const { accepted = [], duplicate = [], unsupported = [] } = preview;
  if (!accepted.length && !duplicate.length && !unsupported.length) {
    toast('Nothing to import.', 'warn');
    return { success: false, addedCount: 0, rejected: [] };
  }
  QueueImportPreviewState.accepted = accepted;
  QueueImportPreviewState.source = source;

  const parts = [];
  parts.push(`<b class="qip-ok">${accepted.length}</b> ready`);
  if (duplicate.length) parts.push(`<b class="qip-dup">${duplicate.length}</b> duplicate`);
  if (unsupported.length) parts.push(`<b class="qip-bad">${unsupported.length}</b> unsupported`);
  if ($('qipSummary')) $('qipSummary').innerHTML = parts.join(' <span class="qip-sep">·</span> ');

  if ($('qipGroups')) {
    $('qipGroups').innerHTML =
      qipRenderGroup('Ready to add', accepted, { checkable: true, open: true, cls: 'ok' }) +
      qipRenderGroup('Duplicates (skipped)', duplicate, { open: false, cls: 'dup' }) +
      qipRenderGroup('Unsupported (skipped)', unsupported, { open: false, cls: 'bad' }) ||
      '<div class="bulk-empty"><p>No supported product pages were found.</p></div>';
    $('qipGroups').querySelectorAll('.qip-check').forEach(cb => cb.addEventListener('change', qipUpdateConfirm));
  }
  qipUpdateConfirm();
  $('queueImportPreviewModal')?.classList.remove('hidden');
  return new Promise(resolve => { QueueImportPreviewState.resolve = resolve; });
}

async function confirmQueueImportPreview() {
  const checked = [...document.querySelectorAll('#qipGroups .qip-check:checked')]
    .map(cb => QueueImportPreviewState.accepted[Number(cb.dataset.idx)])
    .filter(Boolean)
    .map(row => ({ url: row.url, title: row.title || '', source: QueueImportPreviewState.source }));
  if (!checked.length) { closeQueueImportPreview(); return; }
  const btn = $('qipConfirmBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Adding…'; }
  const adder = QueueImportPreviewState.adder;
  if (!adder) { closeQueueImportPreview(); return; }
  const result = await adder(checked, QueueImportPreviewState.source);
  closeQueueImportPreview(result);
}

// ============================================================
// v7.6.1 — BULK HUNT MODULE
// All open tabs → checkbox select → parallel scrape → sheet + ZIP
// ============================================================

const PLATFORM_PATTERNS = {
  'walmart.com':              { name: 'Walmart',          tag: 'WMT' },
  'amazon.':                  { name: 'Amazon',           tag: 'AMZ' },
  'samsclub.com':             { name: "Sam's Club",       tag: "SAM" },
  'faire.com':                { name: 'Faire',            tag: 'FAR' },
  'aliexpress.':              { name: 'AliExpress',       tag: 'ALI' },
  'alibaba.com':              { name: 'Alibaba',          tag: 'ALB' },
  'temu.':                    { name: 'Temu',             tag: 'TMU' },
  'ebay.':                    { name: 'eBay',             tag: 'EBY' },
  'etsy.com':                 { name: 'Etsy',             tag: 'ETY' },
  'shein.com':                { name: 'Shein',            tag: 'SHN' },
  'daraz.':                   { name: 'Daraz',            tag: 'DRZ' },
  'worldwidegolfballs.com':   { name: 'WW Golf Balls',   tag: 'WGB' },
  'worldwidegolfshops.com':   { name: 'WW Golf Shops',   tag: 'WGS' }
};

// v8.9.2: only real Temu PRODUCT pages are huntable — seller center,
// home, search and every other Temu page is excluded from the tab list.
function isTemuProductUrl(url) {
  try {
    const u = new URL(url);
    if (!/(^|\.)temu\.com$/i.test(u.hostname)) return false;
    if (/^seller\./i.test(u.hostname)) return false;
    return /-g-\d{8,}\.html/i.test(u.pathname) || /goods\.html/i.test(u.pathname) || /goods_id=\d{6,}/i.test(u.search);
  } catch (_) { return false; }
}

function detectTabPlatform(url) {
  if (!url) return null;
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host.includes('temu.')) return isTemuProductUrl(url) ? PLATFORM_PATTERNS['temu.'] : null;
    for (const [pat, info] of Object.entries(PLATFORM_PATTERNS)) {
      if (host.includes(pat)) return info;
    }
  } catch (_) {
    // Fallback to broad URL substring matching if URL parsing fails
    const lower = url.toLowerCase();
    for (const [pat, info] of Object.entries(PLATFORM_PATTERNS)) {
      if (lower.includes(pat)) return info;
    }
  }
  return null;
}

const BulkState = {
  tabs:        [],   // [{tabId, url, title, platform}]
  selectedIds: new Set(),
  view:        'tabs', // 'queue' | 'tabs' | 'master'
  isHunting:   false,
  isPaused:    false,
  isCancelled: false,
  results:     [],   // [{tabId, status, data, error}]
  currentBatchId: null,
  huntStartTime:  null, // for live speed/ETA stats

  // Tunables — maximum speed pipeline
  PARALLEL:    14,   // 14 concurrent workers
  CHUNK_SIZE:  40,   // 40 tabs per chunk
  TAB_TIMEOUT: 4000, // 4s per tab — fail fast, fallback is instant
  CHUNK_PAUSE: 200,  // 0.2s between chunks
  MAX_RETRIES: 1,    // 1 retry
  AUTO_CLOSE_TABS: true, // close each tab immediately after successful scrape
  TAB_GROUP: true        // v9.5.0: product tabs → 'ZHunter' tab group
};

const HUNT_STATE_KEY = 'zhunterHuntState'; // for auto-resume

const BULK_QUEUE_KEY = 'zhunterBulkQueue'; // persistent queue of URLs to hunt sequentially

const MASTER_KEY  = 'zhunterMasterSheet';
const BATCHES_KEY = 'zhunterMasterBatches';

// ── Init ─────────────────────────────────────────────────────
function initBulkTab() {
  // View switching and Open Tabs controls.
  $('bulkViewTabsBtn')?.addEventListener('click', () => switchBulkView('tabs'));
  $('bulkViewQueueBtn')?.addEventListener('click', () => switchBulkView('queue'));
  $('bulkViewMasterBtn')?.addEventListener('click', () => switchBulkView('master'));
  $('bulkRefreshTabsBtn')?.addEventListener('click', loadBulkTabs);
  $('bulkSelectAllBtn')?.addEventListener('click', () => toggleAllBulkTabs(true));
  $('bulkDeselectAllBtn')?.addEventListener('click', () => toggleAllBulkTabs(false));
  $('bulkResumeBtn')?.addEventListener('click', resumePendingHunt);
  $('bulkDiscardBtn')?.addEventListener('click', discardPendingHunt);
  $('bulkFailedToggle')?.addEventListener('click', toggleFailedList);
  // v9.10 — pending links: per-link Retry + Retry all
  $('bulkPendingList')?.addEventListener('click', (e) => {
    const b = e.target.closest('.bp-pend-retry');
    if (!b) return;
    const id = b.closest('.bp-pend-item')?.dataset.id;
    if (id) huntManualRetry(id);
  });
  $('bulkRetryAllBtn')?.addEventListener('click', huntRetryAll);
  $('bulkColumnsToggleBtn')?.addEventListener('click', toggleBulkColumnsPanel);
  $('bulkAddAllTabsToQueueBtn')?.addEventListener('click', async () => {
    await loadBulkTabs();
    const candidates = BulkState.tabs.filter(tab => tab.platform);
    toggleAllBulkTabs(true);
    if (!candidates.length) {
      toast('No supported product tabs found.', 'warn');
      return;
    }
    const result = await msg({
      action: 'ADD_BULK_QUEUE_ITEMS',
      items: candidates.map(tab => ({ url: tab.url, title: tab.title, platform: tab.platform.name }))
    });
    await loadBulkQueue();
    toast(`${result?.addedCount || 0} new open product tab(s) added to the queue; ${candidates.length} selected for this hunt.`, 'ok');
  });
  $('bulkAutoCloseToggle')?.addEventListener('change', e => {
    BulkState.AUTO_CLOSE_TABS = !!e.target.checked;
    msg({ action: 'UPDATE_SETTINGS', settings: { bulkAutoCloseTabs: BulkState.AUTO_CLOSE_TABS } }).catch(() => {});
  });
  // v9.5.0 — 'ZHunter' tab group toggle (on → abhi khule product tabs bhi group mein)
  $('bulkTabGroupToggle')?.addEventListener('change', async e => {
    BulkState.TAB_GROUP = !!e.target.checked;
    await msg({ action: 'UPDATE_SETTINGS', settings: { bulkTabGroup: BulkState.TAB_GROUP } }).catch(() => {});
    if (BulkState.TAB_GROUP) {
      const r = await msg({ action: 'GROUP_PRODUCT_TABS', all: true }).catch(() => null);
      if (r?.success) toast(r.grouped ? `${r.grouped} product tab(s) → "ZHunter" group` : 'Product tabs already grouped', 'ok');
      else toast('Tab group nahi bana (' + (r?.reason || 'error') + ')', 'warn');
    }
  });
  // Restore the persisted preference.
  msg({ action: 'GET_DATA' }).then(d => {
    const v = d?.settings?.bulkAutoCloseTabs;
    if (v !== undefined) {
      BulkState.AUTO_CLOSE_TABS = v !== false;
      const chk = $('bulkAutoCloseToggle'); if (chk) chk.checked = BulkState.AUTO_CLOSE_TABS;
    }
    BulkState.TAB_GROUP = d?.settings?.bulkTabGroup !== false;
    const g = $('bulkTabGroupToggle'); if (g) g.checked = BulkState.TAB_GROUP;
  }).catch(() => {});
  $('bulkHuntStartBtn')?.addEventListener('click', () => startBulkHunt());

  // Master Sheet exports and actions.
  $('masterDlXlsxBtn')?.addEventListener('click', () => downloadMasterSheet('xlsx'));
  $('masterDlZipBtn')?.addEventListener('click', downloadLibraryZip);
  // v9.6.1 — Library → Temu: selected products (ya sab) ko Temu Export window mein bhejo; store wahan choose karein
  $('masterTemuBtn')?.addEventListener('click', async () => {
    const all = await getMasterRows();
    if (!all.length) { toast('Library is empty', 'warn'); return; }
    const ids = MasterUIState.selectedIds.size ? new Set(MasterUIState.selectedIds) : null;
    TemuLibPick = ids ? { ids, n: all.filter(r => ids.has(r.id)).length } : null;
    await openTemuModal();
    const sel = $('temuSource');
    if (sel) {
      const o = sel.querySelector('option[value="library_sel"]');
      if (TemuLibPick) { if (o) { o.hidden = false; o.textContent = `Library — selected (${TemuLibPick.n})`; } sel.value = 'library_sel'; }
      else { if (o) o.hidden = true; sel.value = 'master'; }
    }
    temuUpdateSrcInfo();
    toast(TemuLibPick ? `${TemuLibPick.n} selected products → Temu. Store choose karein, phir Export + Upload.` : `Poori Library → Temu. Store choose karein, phir Export + Upload.`, 'ok');
  });
  $('masterDlCsvBtn')?.addEventListener('click', () => downloadMasterSheet('csv'));
  $('masterDlHtmlBtn')?.addEventListener('click', () => downloadMasterSheet('html'));
  $('masterCopyTsvBtn')?.addEventListener('click', () => {
    if (typeof copyMasterSheetToClipboard === 'function') copyMasterSheetToClipboard();
    else toast('Clipboard export is not available in this build.', 'warn');
  });
  $('masterDlPdfBtn')?.addEventListener('click', () => downloadMasterSheet('pdf'));
  $('masterResetBtn')?.addEventListener('click', resetMasterSheet);
  $('masterImportBtn')?.addEventListener('click', () => $('masterImportFile')?.click());
  $('masterImportFile')?.addEventListener('change', e => {
    const file = e.target.files?.[0];
    if (file) doImport(file);
    e.target.value = '';
  });
  $('masterSelectAllBtn')?.addEventListener('click', (e) => { e.preventDefault(); masterSelectAll(); });
  $('masterSelectFailedBtn')?.addEventListener('click', (e) => { e.preventDefault(); masterSelectByStatus('fail'); });
  $('masterSelectPartialBtn')?.addEventListener('click', (e) => { e.preventDefault(); masterSelectByStatus('partial'); });
  $('masterDeselectAllBtn')?.addEventListener('click', (e) => { e.preventDefault(); masterDeselectAll(); });
  document.querySelectorAll('#masterViewSwitcher .zh-view-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const v = btn.dataset.view;
      setMasterLibraryViewMode(v);
      toast(v === 'dense' ? 'Dense Spreadsheet View active' : 'Card View active', 'ok');
    });
  });
  $('masterBulkDeleteBtn')?.addEventListener('click', bulkDeleteMasterRows);
  $('masterBulkCancelBtn')?.addEventListener('click', masterDeselectAll);
  $('masterBulkExportBtn')?.addEventListener('click', () => $('masterExportMenuBtn')?.click());
  $('masterBulkZipBtn')?.addEventListener('click', () => $('masterDlZipBtn')?.click());
  $('masterSortSel')?.addEventListener('change', (e) => {
    MasterUIState.sortBy = e.target.value;
    filterAndRenderMasterRows();
  });
  $('masterSearchInp')?.addEventListener('input', (e) => {
    MasterUIState.searchQuery = e.target.value;
    MasterUIState.filterBatchId = null; // clear batch filter when user searches manually
    filterAndRenderMasterRows();
  });
  document.querySelectorAll('#masterFilterChips .filter-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.id === 'compactModeToggle') {
        const isCompact = document.body.classList.toggle('compact-mode');
        btn.classList.toggle('active', isCompact);
        chrome.storage.local.set({ compactMode: isCompact });
        return;
      }
      document.querySelectorAll('#masterFilterChips .filter-chip:not(#compactModeToggle)').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      MasterUIState.filterBatchId = null;
      MasterUIState.filterPlatform = btn.dataset.filter || 'all';
      filterAndRenderMasterRows();
    });
  });

  // Restore compact mode preference
  chrome.storage.local.get('compactMode', res => {
    if (res?.compactMode) {
      document.body.classList.add('compact-mode');
      $('compactModeToggle')?.classList.add('active');
    }
  });

  // Progress modal and result downloads.
  $('bulkPauseBtn')?.addEventListener('click', toggleBulkPause);
  $('bulkCancelBtn')?.addEventListener('click', cancelBulkHunt);
  $('bulkProgressCloseBtn')?.addEventListener('click', closeBulkProgressModal);
  $('bulkResultDoneBtn')?.addEventListener('click', closeBulkProgressModal);
  $('bulkDlXlsxBtn')?.addEventListener('click', () => downloadBatchSheet('xlsx'));
  $('bulkDlZipBtn')?.addEventListener('click', downloadBatchZip);
  $('bulkDlSeqBtn')?.addEventListener('click', downloadBatchSequential);
  $('bulkDlPdfBtn')?.addEventListener('click', () => downloadPdfCatalog(BulkState.results.filter(r => r.status !== 'fail'), 'Bulk Hunt Catalog'));

  // Queue view controls.
  $('queueAddBtn')?.addEventListener('click', onQueueAddUrl);
  $('queueAddInput')?.addEventListener('keydown', e => { if (e.key === 'Enter') onQueueAddUrl(); });
  $('queueSelectAllBtn')?.addEventListener('click', () => toggleAllQueue(true));
  $('queueDeselectAllBtn')?.addEventListener('click', () => toggleAllQueue(false));
  $('queueClearDoneBtn')?.addEventListener('click', clearHuntedQueueItems);
  $('queueClearAllBtn')?.addEventListener('click', clearAllQueue);
  $('queueRetryProblemsBtn')?.addEventListener('click', retryProblemQueueItems);
  $('queueSearchInput')?.addEventListener('input', e => { QueueState.search = e.target.value || ''; renderBulkQueueList(); });
  $('queueStatusFilter')?.addEventListener('change', e => { QueueState.statusFilter = e.target.value || 'all'; renderBulkQueueList(); });
  $('bulkQueueHuntBtn')?.addEventListener('click', startQueueHunt);
  $('queueExportXlsxBtn')?.addEventListener('click', () => downloadBatchSheet('xlsx'));
  $('queueExportCsvBtn')?.addEventListener('click', downloadQueueCsv);
  $('queueExportHtmlBtn')?.addEventListener('click', downloadBatchHtmlCatalog);
  $('queueExportPdfBtn')?.addEventListener('click', downloadQueuePdf);
  $('queueExportZipBtn')?.addEventListener('click', downloadBatchZip);
  $('queueAutoCaptureToggle')?.addEventListener('change', e => msg({ action: 'GET_DATA' }).then(d => {
    const settings = d?.settings || {};
    settings.bulkQueueAutoCapture = e.target.checked;
    return msg({ action: 'UPDATE_SETTINGS', settings });
  }));

  chrome.runtime.onMessage.addListener(m => {
    if (m?.action === 'BULK_QUEUE_UPDATED') loadBulkQueue();
    if (m?.action === 'BULK_PRODUCT_QUEUE_UPDATED') updateMasterStats();
  });
  document.querySelector('[data-tab="bulk"]')?.addEventListener('click', () => {
    if (BulkState.view === 'tabs') loadBulkTabs();
    else if (BulkState.view === 'queue') loadBulkQueue();
    else updateMasterStats();
  });

  const closeToggle = $('bulkAutoCloseToggle');
  if (closeToggle) closeToggle.checked = BulkState.AUTO_CLOSE_TABS;
  switchBulkView('tabs');
  loadBulkQueue();
  updateQueueExportButtons();
  updateMasterStats();
  checkPendingHunt();
  msg({ action: 'GET_DATA' }).then(d => {
    const v = d?.settings?.bulkQueueAutoCapture;
    const chk = $('queueAutoCaptureToggle');
    if (chk) chk.checked = v === true;
  });
}

function switchBulkView(view = 'tabs') {
  BulkState.view = ['tabs', 'queue', 'master'].includes(view) ? view : 'tabs';
  $('bulkViewTabsBtn')?.classList.toggle('active', BulkState.view === 'tabs');
  $('bulkViewQueueBtn')?.classList.toggle('active', BulkState.view === 'queue');
  $('bulkViewMasterBtn')?.classList.toggle('active', BulkState.view === 'master');
  $('bulkTabsView')?.classList.toggle('active', BulkState.view === 'tabs');
  $('bulkQueueView')?.classList.toggle('active', BulkState.view === 'queue');
  $('bulkMasterView')?.classList.toggle('active', BulkState.view === 'master');
  if (BulkState.view === 'tabs') loadBulkTabs();
  if (BulkState.view === 'queue') loadBulkQueue();
  if (BulkState.view === 'master') updateMasterStats();
}

// ══════════════════════════════════════════════════════════════
// BULK QUEUE — persistent URL queue + sequential hunt
// ══════════════════════════════════════════════════════════════

const QueueState = { items: [], search: '', statusFilter: 'all' };

async function loadBulkQueue() {
  try {
    const res = await msg({ action: 'GET_BULK_QUEUE' });
    QueueState.items = Array.isArray(res?.queue) ? res.queue : [];
    renderBulkQueueList();
  } catch { toast('Failed to load queue', 'err'); }
}

function renderBulkQueueList() {
  const list = $('bulkQueueList');
  if (!list) return;
  const items = QueueState.items;
  const query = QueueState.search.trim().toLowerCase();
  const filtered = items.filter(item => {
    const status = item.status || (item.hunted ? 'complete' : 'queued');
    const matchesStatus = QueueState.statusFilter === 'all' || status === QueueState.statusFilter;
    const haystack = `${item.title || ''} ${item.url || ''} ${item.platform || ''}`.toLowerCase();
    return matchesStatus && (!query || haystack.includes(query));
  });
  if (items.length === 0 || filtered.length === 0) {
    list.innerHTML = items.length === 0
      ? `<div class="bulk-empty"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M9 9h6M9 12h6M9 15h4"/></svg><p>Queue is empty — browse product pages<br>or paste a URL above to add them.</p></div>`
      : `<div class="bulk-empty"><p>No queue items match the current filter.</p></div>`;
    updateQueueSummary();
    return;
  }
  list.innerHTML = '';
  filtered.forEach(item => {
    const isChecked = !!item.checked;
    const isHunted  = !!item.hunted;
    const status = item.status || (isHunted ? 'complete' : 'queued');
    const platLabel = item.platform
      ? `<span class="bulk-tab-platform">${esc(item.platform.substring(0,3).toUpperCase())}</span>`
      : `<span class="bulk-tab-platform unknown">?</span>`;
    const huntedBadge = isHunted ? `<span class="bulk-tab-dup-badge" title="Already hunted">✅</span>` : '';
    const shortUrl = (() => { try { const u = new URL(item.url); return u.hostname.replace(/^www\./, '') + u.pathname.slice(0,35); } catch { return item.url.slice(0,50); } })();
    const row = document.createElement('div');
    row.className = 'bulk-tab-row' + (isChecked ? ' checked' : '') + (isHunted ? ' duplicate' : '');
    row.dataset.queueId = item.id;
    const retryButton = (status === 'needs_retry' || status === 'error')
      ? `<button class="queue-retry-btn" data-id="${esc(item.id)}" title="Retry this product">&#8635; Retry</button>` : '';
    // Stage progress bar for active items
    const isActive = status === 'loading' || status === 'scraping' || status === 'processing' || status === 'retrying';
    const stagePct = status === 'loading' ? 25 : status === 'scraping' ? 55 : status === 'processing' ? 75 : status === 'retrying' ? 40 : 0;
    const stageBar = isActive
      ? `<div class="pq-stage-bar"><div class="pq-stage-fill" style="width:${stagePct}%"></div></div>`
      : '';
    // Stage label upgrade
    const stageLabel = status === 'loading' ? '&#x23F3; Loading page…'
      : status === 'scraping' ? '&#x1F50D; Scraping data…'
      : status === 'processing' ? '&#x2699;&#xFE0F; Processing…'
      : status === 'retrying' ? '&#x21BB; Retrying…'
      : status === 'needs_retry' ? '&#x26A0; Needs Retry'
      : status === 'error' ? '&#x26A0; Error'
      : status === 'complete' || isHunted ? '&#x2705; Done' : '&#x23F8; Queued';
    // Hero image (first image from scraped images if available)
    const heroImg = Array.isArray(item.images) && item.images.length
      ? `<img class="pq-hero-thumb" src="${esc(typeof item.images[0]==='string'?item.images[0]:item.images[0]?.url||'')}" alt="" data-onerror="hide">`
      : '';
    row.innerHTML = `<div class="bulk-tab-checkbox"></div>${platLabel}<div class="bulk-tab-info">${heroImg}<div class="bulk-tab-platform-lbl">${esc(item.title ? trunc(item.title,50) : shortUrl)}${huntedBadge}</div><div class="bulk-tab-title">${esc(shortUrl)}</div>${stageBar}<div class="pq-stage-label">${stageLabel}</div>${item.error && (status === 'needs_retry' || status === 'error') ? `<div class="pq-error-msg">&#9888; ${esc(item.error)}</div>` : ''}</div>${retryButton}<button class="queue-remove-btn" data-id="${esc(item.id)}" title="Remove from queue">&#10005;</button>`;
    row.addEventListener('click', e => {
      if (e.target.closest('.queue-remove-btn')) return;
      item.checked = !item.checked;
      saveBulkQueue();
      renderBulkQueueList();
    });
    row.querySelector('.queue-remove-btn').addEventListener('click', e => {
      e.stopPropagation();
      removeQueueItem(item.id);
    });
    row.querySelector('.queue-retry-btn')?.addEventListener('click', e => {
      e.stopPropagation();
      retrySingleQueueItem(item.id);
    });
    list.appendChild(row);
  });
  updateQueueSummary();
}

function updateQueueSummary() {
  const checked = QueueState.items.filter(i => i.checked && !i.hunted).length;
  const total   = QueueState.items.length;
  const cnt = $('bulkQueueCount');
  const eta = $('bulkQueueEta');
  const btn = $('bulkQueueHuntBtn');
  const summaryBox = $('bulkQueueSummary');
  const done = QueueState.items.filter(i => i.hunted || i.status === 'complete').length;
  const failed = QueueState.items.filter(i => i.status === 'needs_retry' || i.status === 'error').length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  if (summaryBox) {
    summaryBox.classList.toggle('hunting-active', !!BulkState.isHunting);
  }

  if (cnt) cnt.textContent = BulkState.isHunting
    ? `${done}/${total} done (${pct}%) · ${checked} remaining${failed ? ' · ' + failed + ' failed' : ''}`
    : `${total} queued · ${checked} selected${failed ? ' · ' + failed + ' failed' : ''}`;

  if (eta) {
    if (checked === 0) {
      eta.innerHTML = '';
    } else if (BulkState.isHunting && BulkState.huntStartTime && done > 0) {
      const elapsed = (Date.now() - BulkState.huntStartTime) / 1000;
      const speed = elapsed > 2 ? Math.round((done / elapsed) * 60) : 0;
      const secRemain = speed > 0 ? Math.ceil((checked / speed) * 60) : checked * 8;
      const m = Math.floor(secRemain / 60), s = secRemain % 60;
      eta.innerHTML = `${speed > 0 ? `<span class="bulk-speed-badge">⚡ ${speed}/min</span> ` : ''}~${m ? m + 'm ' : ''}${s}s`;
    } else {
      const sec = checked * 8; const m = Math.floor(sec/60), s = sec%60; eta.textContent = '~' + (m ? m+'m ' : '') + s + 's';
    }
  }
  if (btn) btn.disabled = (checked === 0 || BulkState.isHunting);
}

function saveBulkQueue() { msg({ action: 'UPDATE_BULK_QUEUE', queue: QueueState.items }).catch(() => {}); }

function removeQueueItem(id) {
  QueueState.items = QueueState.items.filter(i => i.id !== id);
  saveBulkQueue(); renderBulkQueueList();
}

function toggleAllQueue(selectAll) {
  QueueState.items.forEach(i => { i.checked = selectAll; });
  saveBulkQueue(); renderBulkQueueList();
}

function clearHuntedQueueItems() {
  QueueState.items = QueueState.items.filter(i => !i.hunted);
  saveBulkQueue(); renderBulkQueueList();
}

function clearAllQueue() {
  QueueState.items = []; saveBulkQueue(); renderBulkQueueList();
}

function retrySingleQueueItem(id) {
  const item = QueueState.items.find(entry => entry.id === id);
  if (!item) return;
  item.hunted = false;
  item.checked = true;
  item.status = 'queued';
  item.attempts = 0;
  item.error = '';
  saveBulkQueue();
  renderBulkQueueList();
  toast('Product queued for retry', 'ok');
}

function retryProblemQueueItems() {
  QueueState.items.forEach(item => {
    const status = item.status || (item.hunted ? 'complete' : 'queued');
    if (status === 'needs_retry' || status === 'error') {
      item.hunted = false;
      item.checked = true;
      item.status = 'queued';
      item.attempts = 0;
      item.error = '';
    }
  });
  saveBulkQueue();
  renderBulkQueueList();
}

function onQueueAddUrl() {
  const input = $('queueAddInput');
  const raw = (input?.value || '').trim();
  if (!raw) return;
  let normUrl;
  try { normUrl = new URL(raw).href.split('#')[0]; } catch { toast('Invalid URL', 'err'); return; }
  const platform = detectTabPlatform(normUrl);
  msg({ action: 'ADD_TO_BULK_QUEUE', url: normUrl, title: normUrl, platform: platform?.name || null })
    .then(res => {
      if (res?.success) { if (input) input.value = ''; loadBulkQueue(); toast('Added to queue', 'ok'); }
      else if (res?.reason === 'duplicate') toast('Already in queue', 'warn');
      else toast('Failed to add URL', 'err');
    }).catch(() => toast('Failed to add URL', 'err'));
}

// ── Bulk Paste Feature ───────────────────────────────────────
(function initBulkPaste() {
  function openBulkPasteModal() {
    const modal = $('bulkPasteModal');
    const ta = $('bulkPasteTextarea');
    const preview = $('bulkPastePreview');
    const addBtn = $('bulkPasteAddBtn');
    if (!modal) return;
    if (ta) ta.value = '';
    if (preview) preview.classList.add('hidden');
    if (addBtn) addBtn.disabled = true;
    modal.classList.remove('hidden');
    setTimeout(() => ta?.focus(), 80);
  }

  function closeBulkPasteModal() {
    $('bulkPasteModal')?.classList.add('hidden');
  }

  // Parse lines from textarea → classify each URL
  function parsePastedLinks() {
    const ta = $('bulkPasteTextarea');
    const raw = ta?.value || '';
    const existingUrls = new Set(
      (QueueState.items || []).map(i => (i.url || '').toLowerCase().split('#')[0])
    );

    const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
    const results = [];

    for (const line of lines) {
      let url;
      try { url = new URL(line).href.split('#')[0]; } catch {
        results.push({ raw: line, status: 'bad', reason: 'Invalid URL', platform: null, url: null });
        continue;
      }
      // Remove common tracking params
      try {
        const u = new URL(url);
        ['utm_source','utm_medium','utm_campaign','utm_content','utm_term','gclid','fbclid','msclkid','ref'].forEach(p => u.searchParams.delete(p));
        url = u.href;
      } catch {}

      const platform = detectTabPlatform(url);
      if (!platform) {
        results.push({ raw: line, status: 'bad', reason: 'Unsupported site', platform: null, url });
        continue;
      }
      if (existingUrls.has(url.toLowerCase())) {
        results.push({ raw: line, status: 'dup', reason: 'Already in queue', platform: platform.name, url });
        continue;
      }
      existingUrls.add(url.toLowerCase()); // prevent same-list duplicates
      results.push({ raw: line, status: 'ok', reason: '', platform: platform.name, url });
    }
    return results;
  }

  function renderBulkPastePreview(results) {
    const preview = $('bulkPastePreview');
    const list = $('bulkPasteList');
    const addBtn = $('bulkPasteAddBtn');
    if (!preview || !list) return;

    const ok  = results.filter(r => r.status === 'ok');
    const dup = results.filter(r => r.status === 'dup');
    const bad = results.filter(r => r.status === 'bad');

    const cOk = $('bpCountOk'), cDup = $('bpCountDup'), cBad = $('bpCountBad');
    if (cOk)  cOk.textContent  = ok.length;
    if (cDup) cDup.textContent = dup.length;
    if (cBad) cBad.textContent = bad.length;

    list.innerHTML = '';
    results.forEach(r => {
      const row = document.createElement('div');
      row.className = `bpl-row bpl-${r.status}`;
      const badgeText = r.status === 'ok' ? 'valid' : r.status === 'dup' ? 'dup' : 'skip';
      const platHtml = r.platform ? `<span class="bpl-plat">${esc(r.platform)}</span>` : '';
      row.innerHTML = `<span class="bpl-badge">${badgeText}</span>${platHtml}<span class="bpl-url" title="${esc(r.url || r.raw)}">${esc(r.url || r.raw)}</span>`;
      list.appendChild(row);
    });

    preview.classList.remove('hidden');
    if (addBtn) {
      addBtn.disabled = ok.length === 0;
      addBtn.textContent = ok.length > 0 ? `Add ${ok.length} link${ok.length !== 1 ? 's' : ''} to queue` : 'Add to queue';
    }
  }

  async function addBulkPastedLinks() {
    const results = parsePastedLinks();
    const valid = results.filter(r => r.status === 'ok');
    if (!valid.length) { toast('No valid links to add', 'warn'); return; }

    const addBtn = $('bulkPasteAddBtn');
    if (addBtn) { addBtn.disabled = true; addBtn.classList.add('is-busy'); }

    try {
      const items = valid.map(r => ({ url: r.url, title: r.url, platform: r.platform }));
      const res = await msg({ action: 'ADD_BULK_QUEUE_ITEMS', items });
      await loadBulkQueue();
      closeBulkPasteModal();
      toast(`${res?.addedCount || valid.length} links added to queue`, 'ok');
    } catch {
      toast('Failed to add links', 'err');
    } finally {
      if (addBtn) { addBtn.disabled = false; addBtn.classList.remove('is-busy'); }
    }
  }

  // ── Store Copy & Sheet Metadata ──────────────────────────────
  const SHEET_META_KEY = 'zhunterSheetMeta';
  let _sheetMetaCache = null;
  async function sheetMetaFor(url) {
    try {
      if (!_sheetMetaCache) _sheetMetaCache = await new Promise(res => chrome.storage.local.get(SHEET_META_KEY, x => res(x?.[SHEET_META_KEY] || {})));
      let key; try { key = new URL(url).href.split('#')[0].toLowerCase(); } catch (_) { return null; }
      return _sheetMetaCache[key] || null;
    } catch (_) { return null; }
  }
  window.sheetMetaFor = sheetMetaFor;

  function parseTemuStoreExport(rows) {
    const hi = rows.findIndex(r => r.some(c => /^product name$/i.test(c)) && r.some(c => /^contribution goods$/i.test(c)));
    if (hi < 0) return null;
    const h = rows[hi].map(c => c.toLowerCase().trim());
    const col = re => h.findIndex(c => re.test(c));
    const cTitle = col(/^product name$/), cGoods = col(/^contribution goods$/), cGid = col(/^goods id$/), cVar = col(/^variation$/), cPrice = col(/^base price$/), cCat = col(/^category$/), cQty = col(/^quantity$/), cStatus = col(/^status$/);
    const out = [], seen = new Set();
    rows.slice(hi + 1).forEach(r => {
      const title = r[cTitle] || ''; const goods = r[cGoods] || ''; if (!title || !goods) return;
      const sid = goods.replace(/^[A-Za-z]{1,8}-/, '').trim();
      let url = '', alt = '';
      if (cGid >= 0 && /^\d{12,}$/.test(r[cGid] || '')) url = `https://www.temu.com/goods.html?goods_id=${r[cGid]}`;
      if (/^[A-Z0-9]{10}$/.test(sid) && /^B0/.test(sid)) alt = `https://www.amazon.com/dp/${sid}`;
      else if (/^\d{6,13}$/.test(sid)) alt = `https://www.walmart.com/ip/${sid}`;
      if (!url) url = alt;
      if (!url || seen.has(url)) return; seen.add(url);
      out.push({ url, alt, title, sid, goodsId: cGid >= 0 ? r[cGid] : '', color: cVar >= 0 ? r[cVar] : '', price: cPrice >= 0 ? String(r[cPrice]).replace(/[^\d.]/g, '') : '',
        cat: cCat >= 0 ? String(r[cCat]).split('/').pop().trim() : '', qty: cQty >= 0 ? r[cQty] : '', status: cStatus >= 0 ? r[cStatus] : '' });
    });
    return out;
  }
  window.parseTemuStoreExport = parseTemuStoreExport;

  async function importStoreCopy(list, fileName, say) {
    const meta = {};
    list.forEach(it => { let key; try { key = new URL(it.url).href.split('#')[0].toLowerCase(); } catch (_) { return; }
      meta[key] = { title: it.title, price: it.price, color: it.color, cat: it.cat, goodsId: it.goodsId, alt: it.alt || '', copy: true }; });
    const old = await new Promise(res => chrome.storage.local.get(SHEET_META_KEY, x => res(x?.[SHEET_META_KEY] || {})));
    const merged = { ...old, ...meta }; const keys = Object.keys(merged); if (keys.length > 5000) keys.slice(0, keys.length - 5000).forEach(k => delete merged[k]);
    await new Promise(res => chrome.storage.local.set({ [SHEET_META_KEY]: merged }, res));
    _sheetMetaCache = null;
    const ta = $('bulkPasteTextarea'); if (ta) { ta.value = list.map(i => i.url).join('\n'); ta.dispatchEvent(new Event('input', { bubbles: true })); }
    const rw = $('bulkCopyRemoveWrap'); if (rw) rw.hidden = false;
    const nt = list.filter(i => /temu\.com/.test(i.url)).length, no = list.length - nt;
    if (typeof say === 'function') say(`✓ Store Copy: ${list.length} products (${fileName}) — ${nt} Temu live page se (exact copy: edited images/title)${no ? `, ${no} source page se` : ''}. Queue mein add ho gaye — Bulk → "Hunt all" dabayen. Base price / variation / category Temu sheet se.`, 'ok');
    try { renderBulkPastePreview(parsePastedLinks()); } catch (_) {}
    try { document.querySelector('[data-tab="bulk"]')?.click(); } catch (_) {}
    try { await addBulkPastedLinks(); } catch (_) {}
    toast(`Store Copy: ${list.length} products queue mein — ab Bulk mein "Hunt all" dabayen, phir Temu Export`, 'ok');
  }
  window.importStoreCopy = importStoreCopy;

  async function importLinksSheet(file) {
    const m = $('bulkPasteImportMsg'); const say = (t, k) => { if (m) { m.textContent = t; m.className = 'temu-inline-msg' + (k ? ' ' + k : ''); } };
    try {
      say('⏳ Sheet parh raha hoon…');
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }).map(r => (r || []).map(c => String(c ?? '').trim()));
      if (!rows.length) { say('✗ Sheet khali hai', 'bad'); return; }
      {
        const sc = parseTemuStoreExport(rows);
        if (sc) {
          if (!sc.length) { say('✗ Temu export mein koi product nahi (Contribution Goods khali?)', 'bad'); return; }
          await importStoreCopy(sc, file.name, say);
          return;
        }
      }
      const ncol = Math.max(...rows.map(r => r.length));
      const cnt = Array(ncol).fill(0);
      rows.forEach(r => r.forEach((c, i) => { if (/^https?:\/\//i.test(c)) cnt[i]++; }));
      const urlCol = cnt.indexOf(Math.max(...cnt));
      if (cnt[urlCol] === 0) { say('✗ Sheet mein koi link column nahi mila', 'bad'); return; }
      const headerIdx = rows.findIndex(r => r.some(c => /^https?:\/\//i.test(c))) - 1;
      const header = headerIdx >= 0 ? rows[headerIdx].map(c => c.toLowerCase()) : [];
      const findCol = (re) => header.findIndex(c => re.test(c));
      let titleCol = findCol(/tit|name|product/), priceCol = findCol(/price|cost|\$/);
      if (titleCol < 0) {
        const len = Array(ncol).fill(0); rows.forEach(r => r.forEach((c, i) => { if (i !== urlCol && !/^https?:/i.test(c) && !/^[\d.,$]+$/.test(c)) len[i] += c.length; })); titleCol = len.indexOf(Math.max(...len)); if (len[titleCol] === 0) titleCol = -1;
      }
      if (priceCol < 0) {
        const num = Array(ncol).fill(0); rows.forEach(r => r.forEach((c, i) => { if (i !== urlCol && /^\$?\d+(\.\d{1,2})?$/.test(c) && parseFloat(c) > 0 && parseFloat(c) < 100000 && !/^\d{1,4}$/.test(c)) num[i]++; })); priceCol = num.indexOf(Math.max(...num)); if (num[priceCol] === 0) priceCol = -1;
      }
      const meta = {}; const links = [];
      rows.forEach(r => {
        const u = r[urlCol]; if (!/^https?:\/\//i.test(u)) return;
        let key; try { key = new URL(u).href.split('#')[0].toLowerCase(); } catch (_) { return; }
        links.push(u.split('#')[0]);
        meta[key] = { title: titleCol >= 0 ? r[titleCol] : '', price: priceCol >= 0 ? r[priceCol].replace(/[^\d.]/g, '') : '' };
      });
      const old = await new Promise(res => chrome.storage.local.get(SHEET_META_KEY, x => res(x?.[SHEET_META_KEY] || {})));
      const merged = { ...old, ...meta }; const keys = Object.keys(merged); if (keys.length > 5000) keys.slice(0, keys.length - 5000).forEach(k => delete merged[k]);
      await new Promise(res => chrome.storage.local.set({ [SHEET_META_KEY]: merged }, res));
      const ta = $('bulkPasteTextarea'); if (ta) { ta.value = (ta.value.trim() ? ta.value.trim() + '\n' : '') + links.join('\n'); ta.dispatchEvent(new Event('input', { bubbles: true })); }
      say(`✓ ${links.length} links (${file.name})${titleCol >= 0 ? ' · title' : ''}${priceCol >= 0 ? ' · price fallback' : ''}`, 'ok');
      renderBulkPastePreview(parsePastedLinks());
    } catch (e) { say('✗ ' + (e?.message || e), 'bad'); }
  }

  // Wire up listeners after DOM ready
  document.addEventListener('DOMContentLoaded', () => {
    $('queueBulkPasteBtn')?.addEventListener('click', openBulkPasteModal);
    $('bulkPasteClose')?.addEventListener('click', closeBulkPasteModal);
    $('bulkPasteCancelBtn')?.addEventListener('click', closeBulkPasteModal);
    $('bulkPastePreviewBtn')?.addEventListener('click', () => renderBulkPastePreview(parsePastedLinks()));
    $('bulkPasteAddBtn')?.addEventListener('click', addBulkPastedLinks);
    $('bulkPasteImportBtn')?.addEventListener('click', () => $('bulkPasteFile')?.click());
    $('bulkPasteFile')?.addEventListener('change', e => { const f = e.target.files?.[0]; if (f) importLinksSheet(f); e.target.value = ''; });
    // Close on backdrop click
    $('bulkPasteModal')?.addEventListener('click', e => { if (e.target === $('bulkPasteModal')) closeBulkPasteModal(); });
    // Auto-preview on typing (debounced)
    let _bpTimer;
    $('bulkPasteTextarea')?.addEventListener('input', () => {
      clearTimeout(_bpTimer);
      _bpTimer = setTimeout(() => {
        const val = $('bulkPasteTextarea')?.value || '';
        if (val.trim()) renderBulkPastePreview(parsePastedLinks());
        else {
          $('bulkPastePreview')?.classList.add('hidden');
          const addBtn = $('bulkPasteAddBtn');
          if (addBtn) addBtn.disabled = true;
        }
      }, 400);
    });
  });
})();



// ── Sequential queue hunt — one reusable inactive worker tab
let queueWorkerTabId = null;

async function ensureQueueWorkerTab() {
  if (queueWorkerTabId) {
    try {
      const existing = await new Promise(resolve => chrome.tabs.get(queueWorkerTabId, tab => resolve(chrome.runtime.lastError ? null : tab)));
      if (existing?.id) return existing;
    } catch (_) {}
  }
  const created = await chrome.tabs.create({ url: 'about:blank', active: false });
  queueWorkerTabId = created.id;
  return created;
}

async function closeQueueWorkerTab() {
  const id = queueWorkerTabId;
  queueWorkerTabId = null;
  if (!id) return;
  try { await chrome.tabs.remove(id); } catch (_) {}
}

async function waitForQueueTabReady(tabId, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && !BulkState.isCancelled) {
    try {
      const tab = await new Promise(resolve => chrome.tabs.get(tabId, t => resolve(chrome.runtime.lastError ? null : t)));
      if (!tab) return false;
      if (tab.status === 'complete') return true;
    } catch (_) { return false; }
    await sleep(250);
  }
  return false;
}

async function sendQueueScrape(tabId) {
  return await new Promise(resolve => {
    let done = false;
    const finish = value => { if (!done) { done = true; clearTimeout(timer); resolve(value); } };
    const timer = setTimeout(() => finish(null), 30000);
    try {
      chrome.tabs.sendMessage(tabId, { action: 'SCRAPE_PAGE' }, response => {
        if (chrome.runtime.lastError || !response?.success || !response?.data) finish(null);
        else finish(response.data);
      });
    } catch (_) { finish(null); }
  });
}

function getMaxHuntImages() {
  const custom = parseInt(State?.data?.settings?.maxHuntImages, 10);
  return (Number.isFinite(custom) && custom > 0) ? custom : 7;
}
window.getMaxHuntImages = getMaxHuntImages;

// ═════════════════════════════════════════════════════════════════
// v9.10 — "No link skipped" hunt recovery
// complete = title + price. Anything less is retried: first pass continues with the
// rest of the links, then up to 3 recovery rounds (each stronger), then the link stays
// in the result popup with ↻ Retry / ↗ Open until the user resolves it.
// ═════════════════════════════════════════════════════════════════
const HUNT_RECOVERY_ROUNDS = 3;
const HUNT_ERR_LABELS = {
  missing_price: 'price nahi mili',
  missing_title: 'title nahi mila',
  missing_title_price: 'title + price nahi mile',
  page_timeout: 'page load nahi hua',
  no_response: 'page ne jawab nahi diya',
  tab_closed: 'tab band ho gaya',
  queue_worker_error: 'worker error'
};

function huntMissingCode(title, price) {
  if (!title && !price) return 'missing_title_price';
  if (!title) return 'missing_title';
  if (!price) return 'missing_price';
  return '';
}

function huntErrLabel(code) {
  return HUNT_ERR_LABELS[code] || (code ? String(code).replace(/_/g, ' ') : 'failed');
}

// Higher = more useful data. Used to keep the best of several attempts and for Library upserts.
function huntResultScore(r) {
  if (!r) return -1;
  const imgs = Array.isArray(r.images) ? r.images.length : (Number(r.imageCount) || 0);
  let sc = 0;
  if (r.title && !/^https?:\/\//i.test(r.title)) sc += 2;
  if (r.price) sc += 2;
  if (imgs > 0) sc += 1 + Math.min(imgs, 10) / 100;
  if (r.status === 'ok') sc += 10;
  return sc;
}

function latestHuntResult(id) {
  for (let j = BulkState.results.length - 1; j >= 0; j--) if (BulkState.results[j].tabId === id) return BulkState.results[j];
  return null;
}

function huntNeedsRetry(id) {
  const r = latestHuntResult(id);
  return !r || r.status !== 'ok';
}

// After a retry: if the new attempt is worse than what we had, put the better one back.
function huntKeepBest(id, prev) {
  const cur = latestHuntResult(id);
  if (!prev) return cur;
  if (!cur || huntResultScore(prev) > huntResultScore(cur)) {
    for (let j = BulkState.results.length - 1; j >= 0; j--) if (BulkState.results[j].tabId === id) BulkState.results.splice(j, 1);
    BulkState.results.push(prev);
    setBulkRowStatus(id, prev.status, { images: (prev.images || []).length, error: prev.error });
    updateBulkProgressBar();
    return prev;
  }
  return cur;
}

// Wait until a navigation we just started has really begun, then until it finishes.
// (Checking only status==='complete' right after tabs.update can still see the OLD page.)
async function huntWaitTabLoaded(tabId, prevUrl, timeoutMs = 60000) {
  const getTab = () => new Promise(res => chrome.tabs.get(tabId, t => res(chrome.runtime.lastError ? null : t)));
  const startBy = Date.now() + 5000;
  while (Date.now() < startBy && !BulkState.isCancelled) {
    const t = await getTab();
    if (!t) return false;
    if (t.status === 'loading' || (t.pendingUrl && t.pendingUrl !== prevUrl) || (prevUrl && t.url && t.url !== prevUrl)) break;
    await sleep(120);
  }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && !BulkState.isCancelled) {
    const t = await getTab();
    if (!t) return false;
    if (t.status === 'complete') return true;
    await sleep(250);
  }
  return false;
}

// ── Queue mode: one recovery attempt at a given strength (1..3; manual retry uses 3)
async function huntRetryQueueItem(item, level) {
  const prev = latestHuntResult(item.id);
  setBulkRowStatus(item.id, 'active');
  const label = level >= 3 ? 'Visible tab mein dobara' : level === 2 ? 'Fresh tab, lamba intezaar' : 'Dobara load';
  setBulkRowMeta(item.id, `${label}…`);
  try {
    if (level >= 3) {
      // Some sites only render prices when the page is actually visible
      const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
      const vis = await chrome.tabs.create({ url: 'about:blank', active: true });
      try {
        await scrapeQueueItem(item, vis.id, { readyTimeout: 90000, settleMs: 4500, noImmediateRetry: true });
      } finally {
        try { await chrome.tabs.remove(vis.id); } catch (_) {}
        if (active?.id) { try { await chrome.tabs.update(active.id, { active: true }); } catch (_) {} }
      }
    } else {
      if (level === 2) await closeQueueWorkerTab();
      const worker = await ensureQueueWorkerTab();
      await scrapeQueueItem(item, worker.id, {
        readyTimeout: level === 2 ? 90000 : 60000,
        settleMs: level === 2 ? 3000 : 1500,
        noImmediateRetry: true
      });
    }
  } catch (e) {
    console.warn('[ZHunter] queue recovery error', e);
  }
  return huntKeepBest(item.id, prev);
}

// ── Open-tabs mode: one recovery attempt at a given strength
async function huntEnsureTab(t) {
  const alive = await new Promise(res => chrome.tabs.get(t.tabId, x => res(chrome.runtime.lastError ? null : x)));
  if (alive) return alive;
  // Tab was closed — reopen the link and move the row + results to the new tab id
  const created = await chrome.tabs.create({ url: t.url, active: false });
  const oldId = t.tabId;
  const row = document.querySelector(`.bulk-prog-row[data-tab-id="${oldId}"]`);
  if (row) row.dataset.tabId = created.id;
  BulkState.results.forEach(r => { if (r.tabId === oldId) r.tabId = created.id; });
  t.tabId = created.id;
  t._reopened = true;   // v9.12.4 — we opened it, so we also close it
  t._closed = false;
  await huntWaitTabLoaded(created.id, 'about:blank', 60000);
  return created;
}

// v9.12.4 — close a hunted tab once its link is complete (first pass, recovery rounds and manual retry)
async function huntCloseTab(t) {
  if (!t || !BulkState.AUTO_CLOSE_TABS || !Number.isFinite(t.tabId) || t._closed) return false;
  const alive = await new Promise(res => chrome.tabs.get(t.tabId, x => res(chrome.runtime.lastError ? null : x)));
  if (!alive) { t._closed = true; return false; }
  try { await chrome.tabs.remove(t.tabId); } catch (_) { return false; }
  t._closed = true;
  BulkState.tabsClosed = (BulkState.tabsClosed || 0) + 1;
  markBulkRowClosed(t.tabId);
  return true;
}

// After the recovery rounds: complete links close; tabs the extension re-opened close too (↗ Open brings them back).
// Tabs the user opened that are still incomplete stay open so they can be checked.
async function huntCloseFinishedTabs(items) {
  for (const t of items) {
    if (!huntNeedsRetry(t.tabId) || t._reopened) await huntCloseTab(t);
  }
}

function huntItemName(it, id) {
  const isUrl = v => /^https?:\/\//i.test(v || '');
  const r = latestHuntResult(id);
  if (r?.title && !isUrl(r.title)) return r.title;
  if (it?.title && !isUrl(it.title)) return it.title;
  return safeHost(it?.url) || it?.url || '—';
}

async function huntRetryTabItem(t, level) {
  const prev = latestHuntResult(t.tabId);
  setBulkRowStatus(t.tabId, 'active');
  setBulkRowMeta(t.tabId, level >= 3 ? 'Tab saamne la kar dobara…' : level === 2 ? 'Hard reload, lamba intezaar…' : 'Reload…');
  let restoreTo = null;
  try {
    const tab = await huntEnsureTab(t);
    const prevUrl = tab.url;
    if (level >= 3) {
      const [active] = await chrome.tabs.query({ active: true, windowId: tab.windowId });
      restoreTo = active?.id && active.id !== t.tabId ? active.id : null;
      await chrome.tabs.update(t.tabId, { active: true });
    }
    await new Promise(res => chrome.tabs.reload(t.tabId, { bypassCache: level >= 2 }, () => { void chrome.runtime.lastError; res(); }));
    await huntWaitTabLoaded(t.tabId, prevUrl, level >= 2 ? 90000 : 45000);
    await sleep(level >= 3 ? 4500 : level === 2 ? 3000 : 1500);
    try { await chrome.scripting.executeScript({ target: { tabId: t.tabId }, files: ['content.js'] }); } catch (_) {}
    await sleep(300);
    t._retried = true; // no extra inner auto-retry — the rounds handle that
    await scrapeOneTab(t);
  } catch (e) {
    console.warn('[ZHunter] tab recovery error', e);
  } finally {
    if (restoreTo) { try { await chrome.tabs.update(restoreTo, { active: true }); } catch (_) {} }
  }
  return huntKeepBest(t.tabId, prev);
}

// Automatic rounds after the first pass. items: queue items or tab infos.
async function huntRecoveryRounds(mode, items) {
  const idOf = it => (mode === 'queue' ? it.id : it.tabId);
  const leftNow = () => items.filter(it => huntNeedsRetry(idOf(it))).length;
  for (let round = 1; round <= HUNT_RECOVERY_ROUNDS; round++) {
    const pending = items.filter(it => huntNeedsRetry(idOf(it)));
    if (!pending.length || BulkState.isCancelled) break;
    bpSetPhase('recover');
    bpRecoverShow(round, pending.length);
    updateBulkProgressTitle('Auto-recovering', `Round ${round}/${HUNT_RECOVERY_ROUNDS} · ${pending.length} link${pending.length > 1 ? 's' : ''} dobara hunt ho rahe hain`);
    pending.forEach(it => { setBulkRowStatus(idOf(it), 'waiting'); setBulkRowMeta(idOf(it), `round ${round} queue`); markBulkRowRetry(idOf(it), true); });
    bpPinRowsTop(pending.map(idOf));
    updateBulkProgressBar();
    let k = 0;
    for (const it of pending) {
      while (BulkState.isPaused && !BulkState.isCancelled) await sleep(300);
      if (BulkState.isCancelled) break;
      k++;
      bpRecoverStep(k, pending.length, huntItemName(it, idOf(it)));
      if (mode === 'queue') await huntRetryQueueItem(it, round);
      else await huntRetryTabItem(it, round);
      const still = huntNeedsRetry(idOf(it));
      markBulkRowRetry(idOf(it), still);
      if (mode === 'tabs' && !still) await huntCloseTab(it);
      bpRecoverTick(k, pending.length, !still, leftNow());
      updateBulkProgressBar();
      await sleep(round * 400);
    }
  }
  if (mode === 'queue') await closeQueueWorkerTab();
  else if (!BulkState.isCancelled) await huntCloseFinishedTabs(items);
  bpRecoverHide();
}

// Download images for one result (used after a manual retry; the bulk phase already ran)
async function huntDownloadImagesFor(r) {
  if (!r || !r.images?.length || r.status === 'fail' || isBulkFastMode()) return;
  try {
    const batchRes = await msg({ action: 'FETCH_BASE64_BATCH', urls: r.images.slice(0, getMaxHuntImages()) });
    r.imagesBase64 = (batchRes?.success && Array.isArray(batchRes.results))
      ? batchRes.results.filter(x => x?.success && x.base64).map(x => x.base64) : [];
  } catch (_) { r.imagesBase64 = []; }
}

// Flush rows collected outside the hunt loop (manual retries)
async function huntFlushNow() {
  const rows = BulkState.pendingFlush.splice(0);
  if (rows.length) await appendToMasterSheet(rows);
}

async function scrapeQueueItem(queueItem, workerTabId, opts = {}) {
  const fakeId = queueItem.id;
  setBulkRowStatus(fakeId, 'active');
  if (BulkState.isCancelled) { setBulkRowStatus(fakeId, 'fail'); return; }

  let scraped = null;
  let errorCode = '';
  try {
    const before = await new Promise(res => chrome.tabs.get(workerTabId, t => res(chrome.runtime.lastError ? null : t)));
    if (!before) throw new Error('tab_closed');
    await chrome.tabs.update(workerTabId, { url: queueItem.url });
    setBulkRowMeta(fakeId, opts.readyTimeout > 60000 ? 'Loading (lamba intezaar)…' : 'Loading in background…');
    const ready = await huntWaitTabLoaded(workerTabId, before.url, opts.readyTimeout || 60000);
    if (!ready) throw new Error(BulkState.isCancelled ? 'cancelled' : 'page_timeout');
    await sleep(opts.settleMs ?? 800); // let late scripts render price / gallery

    setBulkRowMeta(fakeId, 'Injecting…');
    try { await chrome.scripting.executeScript({ target: { tabId: workerTabId }, files: ['content.js'] }); }
    catch (_) { /* The script may already be present after navigation. */ }
    await sleep(500);

    setBulkRowMeta(fakeId, 'Scraping…');
    scraped = await sendQueueScrape(workerTabId);
    if (!scraped) throw new Error('no_response');
  } catch (error) {
    errorCode = error?.message || 'queue_worker_error';
  }

  // One quick retry here; slower strategies run later in the recovery rounds
  const shouldRetryQueue = State?.data?.settings?.bulkAutoRetry !== false;
  const currentAttempts = Number(queueItem._retryCount || 0);
  const MAX_ITEM_RETRIES = opts.noImmediateRetry ? 0 : 1;
  if (shouldRetryQueue && !scraped && currentAttempts < MAX_ITEM_RETRIES && !BulkState.isCancelled && errorCode !== 'cancelled') {
    queueItem._retryCount = currentAttempts + 1;
    setBulkRowMeta(fakeId, `Retrying (${queueItem._retryCount}/${MAX_ITEM_RETRIES})…`);
    await sleep(1500);
    return await scrapeQueueItem(queueItem, workerTabId, opts);
  }

  const sMeta = await sheetMetaFor(queueItem.url);
  const resultItem = {
    tabId: fakeId,
    url: scraped?.url || queueItem.url,
    title: scraped?.title || queueItem.title || queueItem.url,
    price: scraped?.price || sMeta?.price || '',
    ...zhLibraryPriceFields(scraped?.price ? scraped : { price: sMeta?.price || '' }),
    copy: sMeta?.copy ? sMeta : null,
    platform: typeof queueItem.platform === 'string' ? queueItem.platform : (queueItem.platform?.name || 'Other'),
    images: (Array.isArray(scraped?.images) ? scraped.images : []).slice(0, getMaxHuntImages()), imagesBase64: [],
    videos: [], variants: scraped?.variants || [],
    description: scraped?.description || '',
    brand: scraped?.brand || '', color: scraped?.color || '', weight: scraped?.weight || '', dimL: scraped?.dimL || '', dimW: scraped?.dimW || '', dimH: scraped?.dimH || '', bullets: Array.isArray(scraped?.bullets) ? scraped.bullets : [],
    status: 'fail',
    error: '',
    scrapedAt: new Date().toISOString()
  };
  if (resultItem.copy) {
    const cp = resultItem.copy; let t = cp.title || resultItem.title;
    const extra = String($('bulkCopyRemoveWords')?.value || '').split(',').map(w => w.trim()).filter(Boolean);
    extra.forEach(w => { t = t.replace(new RegExp('\\b' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'gi'), ' '); });
    resultItem.title = t.replace(/\s+/g, ' ').trim();
    if (cp.price) resultItem.temuBase = cp.price;
    if (cp.color) resultItem.copyColor = cp.color;
    if (cp.cat) resultItem.copyCat = cp.cat;
    resultItem.copyGoodsId = cp.goodsId || '';
  }

  // v9.10 — complete = real title + price (the queued URL is not a title)
  const realTitle = scraped?.title || (resultItem.copy ? resultItem.title : '');
  const realPrice = resultItem.price || resultItem.temuBase || '';
  let status;
  if (scraped || realTitle) status = (realTitle && realPrice) ? 'ok' : 'partial';
  else status = 'fail';
  resultItem.status = status;
  resultItem.error = status === 'ok' ? '' : (status === 'partial' ? huntMissingCode(realTitle, realPrice) : (errorCode || 'no_response'));

  if (BulkState.isCancelled && !scraped) { setBulkRowStatus(fakeId, 'fail', { error: 'cancelled' }); return; }

  // Same link's older attempt is replaced (the recovery keeps the best one)
  for (let j = BulkState.results.length - 1; j >= 0; j--) if (BulkState.results[j].tabId === fakeId) BulkState.results.splice(j, 1);
  BulkState.results.push(resultItem);
  if (status !== 'fail') BulkState.pendingFlush.push(resultItem);

  const qi = QueueState.items.find(i => i.id === fakeId);
  if (qi) {
    qi.hunted = status === 'ok';
    qi.status = status === 'ok' ? 'complete' : 'needs_retry';
    qi.error = status === 'ok' ? '' : huntErrLabel(resultItem.error);
    qi.attempts = Number(qi.attempts || 0) + 1;
  }
  setBulkRowStatus(fakeId, status, { images: Array.isArray(resultItem.images) ? resultItem.images.length : 0, error: resultItem.error });
  updateBulkProgressBar();
}

async function processQueueSequential(items) {
  let worker = null;
  try {
    worker = await ensureQueueWorkerTab();
    for (const item of items) {
      while (BulkState.isPaused && !BulkState.isCancelled) await sleep(300);
      if (BulkState.isCancelled) break;
      worker = await ensureQueueWorkerTab();
      await scrapeQueueItem(item, worker.id);
      // Small cooldown prevents rapid navigation bursts on slow connections.
      if (!BulkState.isCancelled) await sleep(500);
    }
  } finally {
    await closeQueueWorkerTab();
  }
}

function queueResultRows() {
  return BulkState.results
    .filter(result => result.status !== 'fail')
    .sort((a, b) => (a.originalIndex ?? 0) - (b.originalIndex ?? 0));
}

function updateQueueExportButtons() {
  const enabled = queueResultRows().length > 0;
  for (const id of ['queueExportXlsxBtn', 'queueExportCsvBtn', 'queueExportHtmlBtn', 'queueExportPdfBtn', 'queueExportZipBtn']) {
    const button = $(id);
    if (button) button.disabled = !enabled;
  }
}

function downloadQueueCsv() {
  const rows = queueResultRows();
  if (!rows.length) { toast('No completed queue results to export.', 'warn'); return; }
  downloadCsvRich(buildRichSheetData(rows), buildFilename('csv', '_queue'));
  toast(`Downloaded queue CSV (${rows.length} products)`, 'ok');
}

function downloadQueuePdf() {
  const rows = queueResultRows();
  if (!rows.length) { toast('No completed queue results to export.', 'warn'); return; }
  downloadPdfCatalog(rows, 'Queue Hunt Catalog');
}

async function startQueueHunt() {
  if (BulkState.isHunting) return;
  const toHunt = QueueState.items.filter(i => i.checked && !i.hunted);
  if (toHunt.length === 0) { toast('No items selected in queue', 'warn'); return; }
  BulkState.isHunting = true; BulkState.isPaused = false; BulkState.isCancelled = false;
  { const cb = $('bulkCancelBtn'); if (cb) { cb.disabled = false; cb.textContent = 'Cancel'; } const pb = $('bulkPauseBtn'); if (pb) { pb.disabled = false; pb.textContent = 'Pause'; } }
  BulkState.results = []; BulkState.pendingFlush = []; BulkState._flushActive = false;
  document.getElementById('bpLiveBadge')?.classList.remove('off');
  BulkState.currentBatchId = `queue_${Date.now()}`; BulkState.huntStartTime = Date.now();
  const fakeTabs = toHunt.map(i => ({ tabId: i.id, url: i.url, title: i.title || i.url,
    platform: typeof i.platform === 'string' ? { name: i.platform, tag: i.platform.substring(0,3).toUpperCase() } : (i.platform ? { name: i.platform, tag: String(i.platform).substring(0,3).toUpperCase() } : null) }));
  BulkState.huntTotal = fakeTabs.length;
  openBulkProgressModal(fakeTabs);
  $('bulkQueueHuntBtn').disabled = true;
  await savePendingHunt(fakeTabs);
  msg({ action: 'START_KEEPALIVE' }).catch(() => {});
  const flushLoop = async () => {
    BulkState._flushActive = true;
    while (BulkState.isHunting || BulkState.pendingFlush.length > 0) {
      if (BulkState.pendingFlush.length > 0) { const rows = BulkState.pendingFlush.splice(0, 50); await appendToMasterSheet(rows); }
      else await sleep(500);
    }
    BulkState._flushActive = false;
  };
  flushLoop();
  try {
    bpSetPhase('hunt');
    updateBulkProgressTitle('Hunting products', `Processing ${toHunt.length} queued links…`);
    await processQueueSequential(toHunt);

    // v9.10 — recovery rounds: nothing is skipped (complete = title + price)
    BulkState.lastHunt = { mode: 'queue', items: toHunt };
    if (!BulkState.isCancelled) await huntRecoveryRounds('queue', toHunt);

    if (!BulkState.isCancelled && !isBulkFastMode()) { bpSetPhase('download'); await imageDownloadPhase(); }
  } catch (e) { toast('Queue hunt error: ' + (e?.message || 'unknown'), 'err'); }
  BulkState.isHunting = false;
  const flushDeadline = Date.now() + 10000;
  while (BulkState._flushActive && Date.now() < flushDeadline) await sleep(100);
  BulkState._flushActive = false;
  saveBulkQueue();
  await clearPendingHunt();
  finishBulkHunt();
  updateQueueExportButtons();
  loadBulkQueue();
}


// ── Tab list loading ────────────────────────────────────────
async function loadBulkTabs() {
  try {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const masterRows = await getMasterRows();
    const masterUrls = new Set(masterRows.map(r => (r.url || '').toLowerCase()));

    BulkState.tabs = tabs
      .filter(t => t.url && /^https?:/.test(t.url))
      .map(t => ({
        tabId:      t.id,
        url:        t.url,
        title:      t.title || t.url,
        favIconUrl: t.favIconUrl || '',
        platform:   detectTabPlatform(t.url),
        isDuplicate: masterUrls.has((t.url || '').toLowerCase())
      }))
      .filter(t => !!t.platform);

    // Pre-select all product-detected tabs (skip duplicates if setting is on)
    const skipDup = State.data?.settings?.autoSkipDuplicates !== false;
    BulkState.selectedIds = new Set(
      BulkState.tabs
        .filter(t => !skipDup || !t.isDuplicate)
        .map(t => t.tabId)
    );
    renderBulkTabsList();
  } catch (e) {
    toast('Failed to load tabs', 'err');
  }
}

function renderBulkTabsList() {
  const list = $('bulkTabsList');
  if (!list) return;

  if (BulkState.tabs.length === 0) {
    list.innerHTML = `
      <div class="bulk-empty">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
        <p>No product tabs open in this window</p>
      </div>`;
    updateBulkSummary();
    return;
  }

  // Banner: live count of product tabs
  const productTabs = BulkState.tabs.length;
  const sub = document.querySelector('#tab-bulk .section-banner-sub');
  if (sub) sub.textContent = `${productTabs} product tab${productTabs !== 1 ? 's' : ''} open → one sheet + ZIP`;

  list.innerHTML = '';
  BulkState.tabs.forEach(t => {
    const isProduct = !!t.platform;
    const isChecked = BulkState.selectedIds.has(t.tabId);
    const isDup     = !!t.isDuplicate;
    const row = document.createElement('div');
    row.className = 'bulk-tab-row'
      + (isChecked ? ' checked' : '')
      + (!isProduct ? ' disabled' : '')
      + (isDup ? ' duplicate' : '');
    row.dataset.tabId = t.tabId;
    if (isDup) row.title = 'Already in Master Sheet — re-saving will create a duplicate row';

    const platName = isProduct ? esc(t.platform.name) : 'Other';
    const platTag  = t.platform?.tag ? t.platform.tag.toLowerCase() : 'oth';
    const titleText = esc(trunc(t.title, 80));
    const dupBadge = isDup ? `<span class="bulk-tab-dup-badge" title="Already in Master Sheet">🔁</span>` : '';

    const favIcon = t.favIconUrl
      ? `<img class="row-thumb-img row-fav-img" src="${esc(t.favIconUrl)}" alt="${platName}" data-onerror="fallback"><span class="row-thumb-fallback" style="display:none;">${esc(platName.slice(0, 2))}</span>`
      : `<span class="row-thumb-fallback">${esc(platName.slice(0, 2))}</span>`;

    row.innerHTML = `
      <div class="bulk-tab-checkbox"></div>
      <div class="row-thumb-wrap">${favIcon}</div>
      <div class="bulk-tab-info">
        <div class="bulk-tab-platform-row">
          <span class="plat-pill" data-plat="${esc(platTag)}">${platName}</span>
          ${dupBadge}
        </div>
        <div class="bulk-tab-title" title="${esc(t.title)}">${titleText}</div>
      </div>
      <div class="row-quick-actions">
        <button class="row-act-btn act-open" title="Jump to this tab" type="button">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
        </button>
        <button class="row-act-btn act-copy" title="Copy URL" type="button">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        </button>
      </div>`;

    row.querySelector('.act-open')?.addEventListener('click', (e) => {
      e.stopPropagation();
      chrome.tabs.update(t.tabId, { active: true });
    });
    row.querySelector('.act-copy')?.addEventListener('click', (e) => {
      e.stopPropagation();
      navigator.clipboard.writeText(t.url);
      toast('Copied link', 'ok');
    });
    row.querySelector('.row-thumb-wrap')?.addEventListener('click', (e) => {
      if (t.favIconUrl) {
        e.stopPropagation();
        openLightbox(t.favIconUrl, `${platName} — ${t.title || 'Store'}`);
      }
    });

    row.addEventListener('click', (e) => {
      if (e.target.closest('.row-act-btn') || e.target.closest('.row-thumb-wrap')) return;
      if (BulkState.selectedIds.has(t.tabId)) {
        BulkState.selectedIds.delete(t.tabId);
        row.classList.remove('checked');
      } else {
        BulkState.selectedIds.add(t.tabId);
        row.classList.add('checked');
      }
      updateBulkSummary();
    });

    list.appendChild(row);
  });
  updateBulkSummary();
}

function toggleAllBulkTabs(selectAll) {
  if (selectAll) {
    BulkState.selectedIds = new Set(
      BulkState.tabs.filter(t => t.platform).map(t => t.tabId)
    );
  } else {
    BulkState.selectedIds = new Set();
  }
  renderBulkTabsList();
}

function updateBulkSummary() {
  const n = BulkState.selectedIds.size;
  const cnt = $('bulkSelectedCount');
  const eta = $('bulkTimeEstimate');
  if (cnt) cnt.textContent = n + (n === 1 ? ' tab selected' : ' tabs selected');
  if (eta) {
    if (n === 0) eta.textContent = '';
    else {
      // ~2.5s per tab (aggressive pipeline) / PARALLEL + chunk pause
      const chunks = Math.ceil(n / BulkState.CHUNK_SIZE);
      const sec = Math.ceil((n * 2.5) / BulkState.PARALLEL) + (chunks - 1) * Math.ceil(BulkState.CHUNK_PAUSE / 1000);
      const m = Math.floor(sec / 60), s = sec % 60;
      eta.textContent = '~' + (m ? m + 'm ' : '') + s + 's estimated';
    }
  }
  const btn = $('bulkHuntStartBtn');
  if (btn) btn.disabled = (n === 0 || BulkState.isHunting);

  // ── Update stats bar ──
  const totalTabs = BulkState.tabs ? BulkState.tabs.length : 0;
  const queue = Array.isArray(BulkState.queue) ? BulkState.queue : [];
  const done  = queue.filter(q => q.status === 'complete').length;
  const fail  = queue.filter(q => q.status === 'needs_retry' || q.status === 'error').length;
  const stTabs = $('bulkStatTabs'), stDone = $('bulkStatDone'), stFail = $('bulkStatFail');
  if (stTabs) stTabs.textContent = totalTabs;
  if (stDone) stDone.textContent = done;
  if (stFail) stFail.textContent = fail;
}


// ── Bulk Hunt main pipeline ─────────────────────────────────
async function startBulkHunt(tabsOverride) {
  if (BulkState.isHunting) return;
  if (!tabsOverride && BulkState.selectedIds.size === 0) return;

  BulkState.isHunting   = true;
  BulkState.isPaused    = false;
  BulkState.isCancelled = false;
  BulkState.results     = [];
  BulkState.pendingFlush = [];
  BulkState._flushActive = false;
  BulkState.currentBatchId = `batch_${Date.now()}`;
  BulkState.huntStartTime  = Date.now();
  BulkState.batchLabel = ($('temuBatchNameInp')?.value?.trim()) || '';

  const selectedTabs = (Array.isArray(tabsOverride) ? tabsOverride : null)
    || BulkState.tabs.filter(t => BulkState.selectedIds.has(t.tabId));
  // ── Stamp each tab with its original position NOW, before parallel execution
  // reorders them. This index is carried through to the result and used to
  // sort both the sheet rows and the ZIP folders so they always match.
  selectedTabs.forEach((t, i) => { t.originalIndex = i; });
  BulkState.huntTotal = selectedTabs.length; // v9.5.1: progress "N / M" ka M — is hunt ke tabs, selectedIds nahi

  openBulkProgressModal(selectedTabs);
  updateBulkSummary();

  // v9.5.0 — hunt start: selected tabs → 'ZHunter' tab group (fire & forget)
  if (BulkState.TAB_GROUP !== false) {
    const ids = selectedTabs.map(t => t.tabId).filter(id => Number.isFinite(id));
    if (ids.length) msg({ action: 'GROUP_PRODUCT_TABS', tabIds: ids }).catch(() => {});
  }

  // Save hunt state for auto-resume
  await savePendingHunt(selectedTabs);

  // Keep the MV3 service worker alive for the duration of the bulk hunt
  // (it terminates after ~30s of inactivity otherwise, aborting all FETCH_BASE64 calls)
  msg({ action: 'START_KEEPALIVE' }).catch(() => {});

  const flushLoop = async () => {
    BulkState._flushActive = true;
    while (BulkState.isHunting || BulkState.pendingFlush.length > 0) {
      if (BulkState.pendingFlush.length > 0) {
        const rows = BulkState.pendingFlush.splice(0, 50);
        await appendToMasterSheet(rows);
      } else {
        // Only sleep when nothing to flush — exits promptly when hunt ends
        await sleep(500);
      }
    }
    BulkState._flushActive = false;
  };
  flushLoop();

  // v9.11.0 — Chrome must not put the hunted tabs back to sleep while we work
  const huntTabIds = selectedTabs.map(t => t.tabId).filter(id => Number.isFinite(id));
  huntTabIds.forEach(id => chrome.tabs.update(id, { autoDiscardable: false }, () => { void chrome.runtime.lastError; }));

  try {
    bpSetPhase('hunt');
    updateBulkProgressTitle('Hunting products', `Processing ${selectedTabs.length} tabs…`);
    await processSmartQueue(selectedTabs); // Phase 1: scrape all tabs

    // v9.10 — recovery rounds: nothing is skipped (complete = title + price)
    BulkState.lastHunt = { mode: 'tabs', items: selectedTabs };
    if (!BulkState.isCancelled) await huntRecoveryRounds('tabs', selectedTabs);

    // Phase 2: download images after all tabs scraped
    if (!BulkState.isCancelled && !isBulkFastMode()) {
      bpSetPhase('download');
      await imageDownloadPhase();
    }
  } catch (e) {
    toast('Bulk hunt error: ' + (e?.message || 'unknown'), 'err');
  }
  huntTabIds.forEach(id => chrome.tabs.update(id, { autoDiscardable: true }, () => { void chrome.runtime.lastError; }));

  BulkState.isHunting = false;
  // Wait for flush loop to finish — 10s safety timeout so we never hang
  const flushDeadline = Date.now() + 10000;
  while (BulkState._flushActive && Date.now() < flushDeadline) await sleep(100);
  BulkState._flushActive = false; // force-clear in case of timeout

  await clearPendingHunt();
  finishBulkHunt();
}

function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// ── Auto-Resume: Save / Clear / Check pending hunt ────────────
async function savePendingHunt(tabs) {
  const state = {
    tabs: tabs.map(t => ({ tabId: t.tabId, url: t.url, title: t.title, platform: t.platform })),
    savedAt: Date.now()
  };
  chrome.storage.local.set({ [HUNT_STATE_KEY]: state });
}

async function clearPendingHunt() {
  chrome.storage.local.remove(HUNT_STATE_KEY);
  $('bulkResumeBar')?.classList.add('hidden');
}

async function checkPendingHunt() {
  chrome.storage.local.get(HUNT_STATE_KEY, (res) => {
    const state = res[HUNT_STATE_KEY];
    if (!state || !state.tabs || !state.tabs.length) return;
    const ageMs = Date.now() - (state.savedAt || 0);
    if (ageMs > 3 * 24 * 60 * 60 * 1000) { // keep an unfinished hunt for 3 days
      chrome.storage.local.remove(HUNT_STATE_KEY);
      return;
    }
    const n = state.tabs.length;
    const bar = $('bulkResumeBar');
    const msg2 = $('bulkResumeMsg');
    if (bar) bar.classList.remove('hidden');
    if (msg2) msg2.textContent = `Unfinished hunt — ${n} tab${n !== 1 ? 's' : ''} remaining`;
    BulkState._pendingResumeTabs = state.tabs;
  });
}

async function resumePendingHunt() {
  const saved = BulkState._pendingResumeTabs;
  if (!saved || !saved.length) return;
  $('bulkResumeBar')?.classList.add('hidden');
  BulkState._pendingResumeTabs = null;

  // After a browser restart the old tab ids are gone. Reuse a tab only if it
  // still exists and still shows the same URL; otherwise reopen the URL in a
  // background tab and wait for it to load before hunting.
  const sameUrl = (a, b) => { try { const x = new URL(a), y = new URL(b); return x.host === y.host && x.pathname === y.pathname; } catch { return a === b; } };
  const waitLoaded = tabId => new Promise(resolve => {
    const started = Date.now();
    const tick = () => chrome.tabs.get(tabId, t => {
      if (chrome.runtime.lastError || !t) return resolve(false);
      if (t.status === 'complete' || Date.now() - started > 20000) return resolve(true);
      setTimeout(tick, 400);
    });
    tick();
  });
  const tabs = [];
  let reopened = 0;
  for (const t of saved) {
    let live = null;
    if (t.tabId != null) live = await new Promise(r => chrome.tabs.get(t.tabId, x => r(chrome.runtime.lastError ? null : x)));
    if (live && live.url && sameUrl(live.url, t.url)) { tabs.push({ ...t, tabId: live.id }); continue; }
    try {
      const created = await chrome.tabs.create({ url: t.url, active: false });
      reopened++;
      await waitLoaded(created.id);
      tabs.push({ ...t, tabId: created.id });
    } catch (_) { /* skip tabs that cannot be reopened */ }
  }
  if (!tabs.length) { toast('Could not reopen the remaining tabs.', 'err'); return; }
  if (reopened) toast(`Reopened ${reopened} tab${reopened !== 1 ? 's' : ''} — resuming hunt`, 'ok');
  await startBulkHunt(tabs);
}

async function discardPendingHunt() {
  await clearPendingHunt();
  BulkState._pendingResumeTabs = null;
}

function toggleFailedList() {
  const list = $('bulkFailedList');
  const btn  = $('bulkFailedToggle');
  if (!list || !btn) return;
  const hidden = list.classList.toggle('hidden');
  btn.textContent = (hidden ? 'Show' : 'Hide') + ' failed tabs';
}

// v9.11.0 — wait until a tab has really finished loading (sleeping tabs need a full load)
async function huntWaitComplete(tabId, timeoutMs = 25000) {
  const deadline = Date.now() + timeoutMs;
  let sawLoading = false;
  while (Date.now() < deadline && !BulkState.isCancelled) {
    const t = await new Promise(r => chrome.tabs.get(tabId, x => r(chrome.runtime.lastError ? null : x)));
    if (!t) return false;
    if (t.status === 'loading') sawLoading = true;
    if (t.status === 'complete' && !t.discarded && (sawLoading || Date.now() > deadline - timeoutMs + 600)) return true;
    await sleep(200);
  }
  return false;
}
// Sites that fill price/images late — a short settle after load
const huntSettleMs = (url) => /walmart\.com|samsclub\.com|amazon\.|faire\.com|target\.com/i.test(url || '') ? 900 : 400;

// v9.11.0 — how many SLEEPING / loading tabs may wake at once (Settings → Bulk hunt).
// Tabs that are already loaded don't wait for this: they're scraped straight away.
function huntWakeLimit() {
  const v = parseInt(State?.data?.settings?.bulkParallelTabs, 10);
  return v >= 1 && v <= 12 ? v : 3;
}

async function processSmartQueue(tabs) {
  const activeDomains = {};
  const running = new Set();
  const WAKE_LIMIT = huntWakeLimit();
  const MAX_GLOBAL = Math.max(8, WAKE_LIMIT);
  const MAX_PER_DOMAIN = Math.max(3, WAKE_LIMIT);
  let waking = 0;
  // Which tabs need a (re)load? Loaded ones go first so their data comes in immediately.
  await Promise.all(tabs.map(async t => {
    const d = await new Promise(r => chrome.tabs.get(t.tabId, x => r(chrome.runtime.lastError ? null : x)));
    t._heavy = !d || d.discarded || d.status !== 'complete';
  }));
  tabs.sort((a, b) => (a._heavy ? 1 : 0) - (b._heavy ? 1 : 0));

  // Returns true if there are any tabs not yet started
  const hasUnstarted = () => tabs.some(t => !t._started);

  while (hasUnstarted() || running.size > 0) {
    if (BulkState.isCancelled) break;
    while (BulkState.isPaused && !BulkState.isCancelled) await sleep(300);

    // Fill up to MAX_GLOBAL slots with eligible tabs
    let startedAny = true;
    while (startedAny && running.size < MAX_GLOBAL && hasUnstarted()) {
      startedAny = false;
      for (let i = 0; i < tabs.length; i++) {
        if (tabs[i]._started) continue;
        if (running.size >= MAX_GLOBAL) break;
        const host = safeHost(tabs[i].url);
        if ((activeDomains[host] || 0) >= MAX_PER_DOMAIN) continue;
        if (tabs[i]._heavy && waking >= WAKE_LIMIT) continue;

        const tab = tabs[i];
        tab._started = true;
        if (tab._heavy) waking++;
        activeDomains[host] = (activeDomains[host] || 0) + 1;
        startedAny = true;

        const p = (async () => {
          try {
            await scrapeOneTab(tab);
            tab._done = true;
            if (!BulkState.isCancelled) {
              for (let attempt = 2; attempt <= BulkState.MAX_RETRIES + 1; attempt++) {
                if (BulkState.isCancelled) break;

                // Small delay so scrapeOneTab can push its result before we check
                await sleep(100);

                let lastResIndex = -1;
                for (let j = BulkState.results.length - 1; j >= 0; j--) {
                  if (BulkState.results[j].tabId === tab.tabId) { lastResIndex = j; break; }
                }
                if (lastResIndex === -1) break;
                const res = BulkState.results[lastResIndex];
                if (res.status !== 'fail' && res.status !== 'partial') break;

                BulkState.results.splice(lastResIndex, 1);
                setBulkRowMeta(tab.tabId, `Retry ${attempt}/${BulkState.MAX_RETRIES + 1}…`);

                try {
                  const td = await new Promise(r => chrome.tabs.get(tab.tabId, t => r(chrome.runtime.lastError ? null : t)));
                  if (td && (td.discarded || td.status !== 'complete')) {
                    if (td.discarded) chrome.tabs.reload(tab.tabId, {}, () => { void chrome.runtime.lastError; });
                    await huntWaitComplete(tab.tabId, 25000);
                    await sleep(huntSettleMs(tab.url));
                  }
                } catch (_) {}

                try {
                  await chrome.scripting.executeScript({ target: { tabId: tab.tabId }, files: ['content.js'] });
                  await sleep(300);
                } catch (_) {}

                if (!BulkState.isCancelled) await scrapeOneTab(tab);
              }
            }

            // ── Auto-close tab after successful scrape ──
            if (BulkState.AUTO_CLOSE_TABS && !BulkState.isCancelled) {
              const finalRes = BulkState.results.find(r => r.tabId === tab.tabId);
              if (finalRes && finalRes.status === 'ok') await huntCloseTab(tab);
            }
          } finally {
            tab._done = true;
            if (tab._heavy) waking--;
            activeDomains[host]--;
            running.delete(p);
          }
        })();

        running.add(p);
      }
    }

    if (running.size > 0) {
      // Wait for at least one worker to finish before re-filling slots
      await Promise.race(running);
      // Persist what is still left so a browser close/crash can resume from here.
      const remaining = tabs.filter(t => !t._done);
      if (remaining.length) savePendingHunt(remaining); else clearPendingHunt();
    } else if (hasUnstarted()) {
      // All slots blocked by domain limits but tabs remain — wait briefly and retry
      await sleep(200);
    } else {
      break; // truly done
    }
    await sleep(50);
  }
}

async function scrapeOneTab(tabInfo) {
  setBulkRowStatus(tabInfo.tabId, 'active');

  let scraped = null;
  let error = null;

  // Early exit if cancelled
  if (BulkState.isCancelled) { setBulkRowStatus(tabInfo.tabId, 'fail'); return; }

  try {
    // ── Wait for tab to load / Wake discarded tabs ──
    let tabDetails = await new Promise(resolve => chrome.tabs.get(tabInfo.tabId, t => resolve(chrome.runtime.lastError ? null : t)));
    if (tabDetails) {
      // v9.11.0 — a sleeping tab is loaded ONCE and we wait until it's really ready
      // (before: 2s wait → scrape failed → reload again, 3–4 reloads per tab)
      if (tabDetails.discarded) {
        setBulkRowMeta(tabInfo.tabId, 'Waking tab…');
        chrome.tabs.reload(tabInfo.tabId, {}, () => { void chrome.runtime.lastError; });
      }
      if (tabDetails.discarded || tabDetails.status !== 'complete') {
        setBulkRowMeta(tabInfo.tabId, 'Loading…');
        await huntWaitComplete(tabInfo.tabId, 25000);
        if (BulkState.isCancelled) { setBulkRowStatus(tabInfo.tabId, 'fail', { error: 'cancelled' }); return; }
        await sleep(huntSettleMs(tabInfo.url));
        setBulkRowMeta(tabInfo.tabId, 'Scraping…');
      }
    }

    // PING first — only inject content script if not already alive
    const isPingAlive = await new Promise((resolve) => {
      try {
        chrome.tabs.sendMessage(tabInfo.tabId, { action: 'PING' }, (res) => {
          if (chrome.runtime.lastError || !res?.ready) { resolve(false); return; }
          resolve(true);
        });
      } catch (_) { resolve(false); }
    });

    if (!isPingAlive) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tabInfo.tabId },
          files: ['content.js']
        });
        await sleep(100);
      } catch (_) {}
    }

    // ── Temu: direct executeScript scrape (bypasses SPA background-tab issue) ──
    // Temu is a heavy SPA that never hydrates in background tabs, so the normal
    // SCRAPE_PAGE message always times out (30s wait for nothing).
    // Instead: executeScript in MAIN world so we can read page globals AND inline
    // scripts that are always present, even in background tabs.
    const isTemuTab = /temu\./i.test(tabInfo.url);
    const isWgsTab  = /worldwidegolfshops\.com|worldwidegolfballs\.com/i.test(tabInfo.url);
    if (isTemuTab || isWgsTab) {
      // Check cancel before starting
      if (BulkState.isCancelled) { error = 'cancelled'; scraped = null; throw new Error('cancelled'); }

      try {
        const temuResults = await Promise.race([
          chrome.scripting.executeScript({
            target: { tabId: tabInfo.tabId },
            world: 'MAIN',   // access page-scope globals like window.__init_data__
            func: () => {
              const h = location.hostname.toLowerCase();
              const isWgs = h.includes('worldwidegolfshops.com') || h.includes('worldwidegolfballs.com');

              const result = { title: '', price: '', images: [], videos: [], variants: [], url: location.href };

              // ── TITLE (works for both Temu and Shopify) ────────────────
              const titleEl = document.querySelector(
                'h1.product__title, h1.product-single__title, h1.product-title,' +
                '[class*="goods-name"], [class*="GoodsName"], [class*="ProductTitle"],' +
                '[class*="product-title"], [class*="detail-title"],' +
                '[data-testid*="product-name"], [data-testid*="title"], h1'
              );
              if (titleEl) result.title = titleEl.innerText.trim();
              if (!result.title) {
                const og = document.querySelector('meta[property="og:title"]');
                result.title = og?.content || document.title || '';
              }

              if (isWgs) {
                // ══ WGS / Worldwide Golf Shops — Shopify scraper ══

                // Price — Strategy 1: itemprop="price" content attr (most reliable on Shopify)
                const priceItemprop = document.querySelector('[itemprop="price"]');
                if (priceItemprop) {
                  const raw = priceItemprop.getAttribute('content') || priceItemprop.innerText || priceItemprop.textContent || '';
                  const num = parseFloat(raw.replace(/[^0-9.]/g, ''));
                  if (num > 0) result.price = '$' + num.toFixed(2);
                }

                // Price — Strategy 2: meta og:price:amount
                if (!result.price) {
                  const ogPrice = document.querySelector('meta[property="og:price:amount"], meta[property="product:price:amount"]');
                  if (ogPrice && ogPrice.content) {
                    const num = parseFloat(ogPrice.content.replace(/[^0-9.]/g, ''));
                    if (num > 0) result.price = '$' + num.toFixed(2);
                  }
                }

                // Price — Strategy 3: Shopify inline JSON (window.ShopifyAnalytics or similar)
                if (!result.price) {
                  for (const s of document.querySelectorAll('script:not([src])')) {
                    const t = s.textContent || '';
                    if (t.length < 20 || t.length > 2000000) continue;
                    // Shopify stores price in cents: "price":5999
                    const cm = t.match(/"price"\s*:\s*(\d{3,7})(?![.\d])/);
                    if (cm) {
                      const cents = parseInt(cm[1]);
                      if (cents > 0 && cents < 10000000) { result.price = '$' + (cents / 100).toFixed(2); break; }
                    }
                    // Sometimes as float string: "price":"59.99"
                    const fm = t.match(/"price"\s*:\s*"(\d+\.\d{1,2})"/);
                    if (fm) { const v = parseFloat(fm[1]); if (v > 0) { result.price = '$' + v.toFixed(2); break; } }
                  }
                }

                // Price — Strategy 4: DOM selectors
                if (!result.price) {
                  const priceSels = [
                    '.price-item--sale', '.price-item--regular',
                    '.product__price .price', '[class*="product-price"]',
                    '.price', '[data-product-price]'
                  ];
                  for (const sel of priceSels) {
                    const el = document.querySelector(sel);
                    if (!el) continue;
                    const raw = (el.getAttribute('content') || el.innerText || el.textContent || '').trim();
                    // Remove discount noise (e.g. "$59.99 $79.99" — take first price)
                    const m = raw.match(/\$\s*(\d+(?:[.,]\d{1,2})?)/);
                    if (m) { result.price = '$' + m[1].replace(',', '.'); break; }
                    const plain = raw.match(/\b(\d+\.\d{1,2})\b/);
                    if (plain) { result.price = '$' + plain[1]; break; }
                  }
                }

                // WGS Images — Pure DOM Gallery Scraper (VTEX)
                // We skip JSON-LD to avoid grabbing "Related Products" which WGS injects heavily
                const scope = document.querySelector(
                  '[class*="productImages"], [class*="carouselGallery"],' +
                  '.product__media-wrapper, .product-single__photos,' +
                  '[class*="product-gallery"], [class*="ProductGallery"],' +
                  '.product-images, .product__images'
                );
                const imgs = scope ? scope.querySelectorAll('img') : document.querySelectorAll('img');
                imgs.forEach(img => {
                  const src = img.getAttribute('data-src') || img.getAttribute('data-zoom-image') || img.src || '';
                  if (!src || !src.startsWith('http')) return;
                  if (/logo|icon|badge|sprite|nav|header|footer|payment|trust|related|recommend/i.test(src)) return;
                  const w = img.naturalWidth || img.width || 0;
                  if (w > 0 && w < 120) return;

                  // If we had to fall back to the whole document, be strictly limited to product images
                  if (!scope) {
                    const cls = (img.className || '') + ' ' + ((img.parentElement && img.parentElement.className) || '');
                    if (!/productImage|carouselThumb/i.test(cls)) return;
                  }

                  // Upsize Shopify thumbnails (if they ever switch back)
                  let large = src
                    .replace(/_(\d+)x(\d+)(\.[a-z]+)(\?|$)/i, '_1200x$3$4')
                    .replace(/_(\d+)x(\.[a-z]+)(\?|$)/i, '_1200x$2$3');
                  
                  // Upsize VTEX thumbnails and STRIP query parameters to prevent duplicates!
                  if (large.includes('.vtexassets.com/arquivos/ids/')) {
                    const idMatch = large.match(/\/ids\/(\d+)/);
                    if (idMatch) large = `https://worldwidegolf.vtexassets.com/arquivos/ids/${idMatch[1]}`;
                  }
                  large = large.split('?')[0]; // Strip query strings like ?v=...&width=... to prevent duplicates

                  if (!result.images.includes(large)) result.images.push(large);
                });

                // OG image fallback
                const ogImg = document.querySelector('meta[property="og:image"]');
                if (ogImg && ogImg.content && !result.images.includes(ogImg.content)) {
                  result.images.unshift(ogImg.content);
                }

              } else {
                // ══ TEMU scraper (existing logic) ══

                // Price: Strategy 1 — window.__init_data__
                try {
                  const initData = (typeof __init_data__ !== 'undefined' && __init_data__) // eslint-disable-line no-undef
                                || window.__init_data__ || null;
                  if (initData) {
                    const walkInit = (obj, depth) => {
                      if (!obj || typeof obj !== 'object' || depth > 15) return '';
                      const centKeys = ['sale_price','salePrice','actual_price','actualPrice',
                                        'promotion_price','promotionPrice','min_price','minPrice'];
                      for (const k of centKeys) {
                        if (k in obj && typeof obj[k] === 'number' && obj[k] > 0)
                          return '$' + (obj[k] >= 100 ? (obj[k] / 100).toFixed(2) : obj[k].toFixed(2));
                        if (k in obj && typeof obj[k] === 'string' && /\d/.test(obj[k])) {
                          const m = obj[k].match(/[$£€¥₹₩]?\s*\d+(?:[.,]\d+)?/);
                          if (m) return m[0];
                        }
                      }
                      const imgKeys = ['origin_url','original_img_url','img_url','thumbnail_url'];
                      for (const k of imgKeys) {
                        if (k in obj && typeof obj[k] === 'string' && obj[k].startsWith('http'))
                          if (!result.images.includes(obj[k])) result.images.push(obj[k]);
                      }
                      for (const v of Object.values(obj)) {
                        if (v && typeof v === 'object') { const r2 = walkInit(v, depth + 1); if (r2) return r2; }
                      }
                      return '';
                    };
                    const p = walkInit(initData, 0);
                    if (p) result.price = p;
                  }
                } catch (_) {}

                // Price: Strategy 2 — inline script regex
                if (!result.price) {
                  for (const s of document.querySelectorAll('script:not([src])')) {
                    const t = s.textContent || '';
                    if (t.length < 50 || t.length > 5000000) continue;
                    if (!/sale_price|actual_price|display_price|price_str|priceStr/.test(t)) continue;
                    const c = t.match(/"(?:sale_price|actual_price|promotion_price|salePrice|actualPrice)"\s*:\s*(\d{2,7})(?![.\d])/);
                    if (c) { const cents = parseInt(c[1]); if (cents > 0) { result.price = '$' + (cents / 100).toFixed(2); break; } }
                    const sp = t.match(/"(?:display_price|price_str|priceStr|formatted_price)"\s*:\s*"([^"]+)"/);
                    if (sp) { const pm = sp[1].match(/[$£€¥₹₩]\s*\d[\d.,]*/); if (pm) { result.price = pm[0]; break; } }
                    const fp = t.match(/"(?:price|salePrice)"\s*:\s*(\d+\.\d{1,2})(?!\d)/);
                    if (fp) { const v = parseFloat(fp[1]); if (v > 0) { result.price = '$' + v.toFixed(2); break; } }
                  }
                }

                // Price: Strategy 3 — DOM selectors
                if (!result.price) {
                  const pSels = ['[data-testid="price"]','[data-testid="selling-price"]','[class*="price-sale"]','[class*="priceSale"]','[class*="price-current"]','[aria-label*="price" i]'];
                  for (const sel of pSels) {
                    const el = document.querySelector(sel);
                    if (!el) continue;
                    const m = (el.innerText || el.textContent || '').match(/[$£€¥₹₩]\s*\d[\d.,]*/);
                    if (m) { result.price = m[0]; break; }
                  }
                }

                // Images: inline scripts
                if (result.images.length === 0) {
                  for (const s of document.querySelectorAll('script:not([src])')) {
                    const t = s.textContent || '';
                    if (!t.includes('origin_url') && !t.includes('img_url') && !t.includes('goods_gallery')) continue;
                    for (const m of t.matchAll(/"origin_url"\s*:\s*"(https?:[^"]+)"/g)) { const u = m[1].replace(/\\/g, ''); if (!result.images.includes(u)) result.images.push(u); }
                    for (const m of t.matchAll(/"original_img_url"\s*:\s*"(https?:[^"]+)"/g)) { const u = m[1].replace(/\\/g, ''); if (!result.images.includes(u)) result.images.push(u); }
                    for (const m of t.matchAll(/"img_url"\s*:\s*"(https?:[^"]+)"/g)) { const u = m[1].replace(/\\/g, ''); if (!result.images.includes(u)) result.images.push(u); }
                  }
                }

                // Images: DOM fallback
                if (result.images.length === 0) {
                  const gallery = document.querySelector('[class*="goods-gallery"],[class*="GoodsGallery"],[class*="image-view"],[class*="swiper-wrapper"],[data-testid*="gallery"],[data-testid*="image"]') || document.body;
                  gallery.querySelectorAll('img').forEach(img => {
                    const src = img.src || img.dataset.src || img.dataset.lazySrc || '';
                    if (!src || !src.startsWith('http')) return;
                    const w = img.naturalWidth || img.width || 0;
                    const h = img.naturalHeight || img.height || 0;
                    if (w > 0 && w < 100) return;
                    if (/logo|icon|badge|nav|platform|header/i.test(src)) return;
                    const clean = src.replace(/\/thumbnail\/\d+x\d+/, '/origin');
                    if (!result.images.includes(clean)) result.images.push(clean);
                  });
                }

                // OG image fallback
                const ogImg2 = document.querySelector('meta[property="og:image"]');
                if (ogImg2 && ogImg2.content && !result.images.includes(ogImg2.content)) {
                  result.images.unshift(ogImg2.content);
                }
              }

              result.images = result.images.slice(0, 15);
              return result;
            }
          }),
          // If executeScript hangs for any reason, time out after 12s
          new Promise((_, reject) => {
            let elapsed = 0;
            const iv = setInterval(() => {
              elapsed += 200;
              if (BulkState.isCancelled) {
                clearInterval(iv);
                reject(new Error('cancelled'));
              } else if (elapsed >= 12000) {
                clearInterval(iv);
                reject(new Error('temu_exec_timeout'));
              }
            }, 200);
          })
        ]);

        if (temuResults?.[0]?.result) {
          scraped = temuResults[0].result;
          if (scraped.url && scraped.url !== tabInfo.url) scraped.url = tabInfo.url;
        }
      } catch (execErr) {
        const isCancelled = execErr?.message === 'cancelled';
        error = isCancelled ? 'cancelled'
              : execErr?.message === 'temu_exec_timeout' ? 'timeout'
              : (execErr?.message || 'exec_failed');
        scraped = null;

        // ── AUTO-REFRESH on Temu/WGS executeScript timeout ────────────────
        if (!isCancelled && !BulkState.isCancelled && error === 'timeout') {
          setBulkRowMeta(tabInfo.tabId, 'Not responding — refreshing…');
          try { await new Promise(r => chrome.tabs.reload(tabInfo.tabId, {}, r)); } catch (_) {}
          let reloadDetails = null;
          for (let i = 0; i < 30; i++) {               // 30 × 500ms = 15s max
            if (BulkState.isCancelled) break;
            reloadDetails = await new Promise(r => chrome.tabs.get(tabInfo.tabId, t => r(chrome.runtime.lastError ? null : t)));
            if (!reloadDetails || reloadDetails.status === 'complete') break;
            await sleep(500);
          }
          if (reloadDetails) await sleep(1500);

          if (!BulkState.isCancelled) {
            setBulkRowMeta(tabInfo.tabId, 'Retrying after refresh…');
            try {
              const retryResults = await Promise.race([
                chrome.scripting.executeScript({
                  target: { tabId: tabInfo.tabId },
                  world: 'MAIN',
                  func: () => { /* same inline func reused via closure — injected in retry */ return null; }
                }),
                new Promise((_, reject) => setTimeout(() => reject(new Error('temu_exec_timeout')), 12000))
              ]);
              if (retryResults?.[0]?.result) {
                scraped = retryResults[0].result;
                error = null;
              } else {
                setBulkRowMeta(tabInfo.tabId, 'Skipped (no response after refresh)');
                error = 'no_response_after_refresh';
              }
            } catch (_) {
              setBulkRowMeta(tabInfo.tabId, 'Skipped (no response after refresh)');
              error = 'no_response_after_refresh';
            }
          }
        }
        // ── END AUTO-REFRESH ─────────────────────────────────────────────
      }
    } else {
      // ── Normal path: isLazy wake + SCRAPE_PAGE message ──────────────────
      const isLazy = /faire\.com|samsclub\.com|worldwidegolfshops\.com|worldwidegolfballs\.com|amazon\.|walmart\.com/i.test(tabInfo.url);
      if (isLazy) {
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tabInfo.tabId },
            func: () => {
              window.dispatchEvent(new Event('scroll'));
              window.dispatchEvent(new Event('resize'));
              document.dispatchEvent(new Event('visibilitychange'));
            }
          });
          await sleep(300); // PERF: events fire synchronously, 300ms is plenty
        } catch (_) {}
      }

      // Check cancel before sending SCRAPE_PAGE
      if (BulkState.isCancelled) { error = 'cancelled'; scraped = null; throw new Error('cancelled'); }

      // Send SCRAPE_PAGE message with strict timeout
      scraped = await new Promise((resolve) => {
        let done = false;
        let finish = (v) => { if (!done) { done = true; resolve(v); } };
        // Check cancelled flag every 200ms so cancel responds quickly
        let cancelCheck = setInterval(() => { if (BulkState.isCancelled) finish(null); }, 200);
        const t = setTimeout(() => finish(null), BulkState.TAB_TIMEOUT);
        const origFinish = finish;
        finish = (v) => { clearTimeout(t); clearInterval(cancelCheck); origFinish(v); };
        try {
          chrome.tabs.sendMessage(tabInfo.tabId, { action: 'SCRAPE_PAGE' }, (res) => {
            clearTimeout(t);
            if (chrome.runtime.lastError) { finish(null); return; }
            if (!res?.success || !res?.data) { finish(null); return; }
            finish(res.data);
          });
        } catch (e) { finish(null); }
      });

      // ── AUTO-REFRESH on no-response ──────────────────────────────────────
      // If the tab didn't respond (timed out, frozen, or content script wasn't
      // injected), refresh the tab and try exactly one more time before skipping.
      if (!scraped && !BulkState.isCancelled) {
        setBulkRowMeta(tabInfo.tabId, 'Not responding — refreshing…');

        // Refresh the tab and wait for it to finish loading (up to 15 seconds)
        try { await new Promise(r => chrome.tabs.reload(tabInfo.tabId, {}, r)); } catch (_) {}
        let reloadDetails = null;
        await huntWaitComplete(tabInfo.tabId, 25000);
        reloadDetails = await new Promise(r => chrome.tabs.get(tabInfo.tabId, t => r(chrome.runtime.lastError ? null : t)));
        if (reloadDetails) await sleep(huntSettleMs(tabInfo.url));

        if (!BulkState.isCancelled) {
          setBulkRowMeta(tabInfo.tabId, 'Retrying after refresh…');

          // Re-inject content script after reload
          try {
            await chrome.scripting.executeScript({ target: { tabId: tabInfo.tabId }, files: ['content.js'] });
            await sleep(400);
          } catch (_) {}

          // Lazy-wake events (for SPA sites that need scroll to hydrate)
          if (isLazy) {
            try {
              await chrome.scripting.executeScript({
                target: { tabId: tabInfo.tabId },
                func: () => {
                  window.dispatchEvent(new Event('scroll'));
                  window.dispatchEvent(new Event('resize'));
                  document.dispatchEvent(new Event('visibilitychange'));
                }
              });
              await sleep(500);
            } catch (_) {}
          }

          // Single retry attempt after refresh
          scraped = await new Promise((resolve) => {
            let done = false;
            let finish = (v) => { if (!done) { done = true; resolve(v); } };
            let cancelCheck = setInterval(() => { if (BulkState.isCancelled) finish(null); }, 200);
            const t = setTimeout(() => finish(null), BulkState.TAB_TIMEOUT);
            const origFinish = finish;
            finish = (v) => { clearTimeout(t); clearInterval(cancelCheck); origFinish(v); };
            try {
              chrome.tabs.sendMessage(tabInfo.tabId, { action: 'SCRAPE_PAGE' }, (res) => {
                clearTimeout(t);
                if (chrome.runtime.lastError) { finish(null); return; }
                if (!res?.success || !res?.data) { finish(null); return; }
                finish(res.data);
              });
            } catch (e) { finish(null); }
          });

          if (!scraped) {
            // Still no response after refresh — skip this tab
            setBulkRowMeta(tabInfo.tabId, 'Skipped (no response after refresh)');
            error = 'no_response_after_refresh';
          }
        }
      }
      // ── END AUTO-REFRESH ─────────────────────────────────────────────────
    }


    if (!scraped) {
      error = 'no_response';
    } else {
      // ── DATA INTEGRITY CHECK ──────────────────────────────────
      // Verify the scraped data actually belongs to the tab we scraped.
      // Use BOTH hostname AND path comparison so that same-domain but
      // different-product URLs (e.g. two Amazon ASINs) are caught.
      const tabUrlNow = await getTabUrl(tabInfo.tabId);
      const scrapedHost  = safeHost(scraped.url);
      const expectedHost = safeHost(tabInfo.url);
      const currentHost  = safeHost(tabUrlNow);

      // Sam's Club rewrites its URL after load (removes ?from=/search etc.)
      // Temu: URL set directly from location.href inside executeScript — always correct.
      const isSamsClub = /samsclub\.com/i.test(tabInfo.url);
      const isTemuScrape = /temu\./i.test(tabInfo.url);
      const isGolfSite = /worldwidegolfshops\.com|worldwidegolfballs\.com/i.test(tabInfo.url);

      if (!isSamsClub && !isTemuScrape && !isGolfSite) {
        // Hostname mismatch — definitely wrong page
        if (scrapedHost && expectedHost && scrapedHost !== expectedHost) {
          error = 'url_mismatch';
          scraped = null;
        } else if (currentHost && expectedHost && currentHost !== expectedHost) {
          error = 'tab_navigated';
          scraped = null;
        } else {
          // ── PATH-LEVEL CHECK (catches same-domain different-product) ──
          // Compare the meaningful path segments (product ID portion).
          // For Amazon, Walmart, eBay, etc. the product ID is a distinct
          // path segment; if the scraped URL has a different path than the
          // tab URL, the content script returned stale data from a previous
          // navigation.
          const expectedPath = safePathKey(tabInfo.url);
          const scrapedPath  = safePathKey(scraped.url);
          if (expectedPath && scrapedPath && expectedPath !== scrapedPath) {
            error = 'product_mismatch';
            scraped = null;
          }
        }
      }
    }
  } catch (e) {
    error = e?.message || 'scrape_error';
  }

  // Determine final status — v9.10: complete = title + price (user rule)
  let status;
  if (!scraped) {
    status = 'fail';
  } else if (!scraped.title || !scraped.price) {
    status = 'partial';
    if (!error) error = huntMissingCode(scraped.title, scraped.price);
  } else {
    status = 'ok';
  }

  // Smart auto-retry on failure (1 attempt with tab reload)
  const shouldRetryTab = State?.data?.settings?.bulkAutoRetry !== false;
  if (shouldRetryTab && status === 'fail' && !tabInfo._retried && !BulkState.isCancelled && error !== 'cancelled') {
    tabInfo._retried = true;
    setBulkRowMeta(tabInfo.tabId, 'Retrying (1/1)…');
    await sleep(300);
    try {
      chrome.tabs.reload(tabInfo.tabId, {}, () => { void chrome.runtime.lastError; });
      await huntWaitComplete(tabInfo.tabId, 25000);
      await sleep(huntSettleMs(tabInfo.url));
    } catch (_) {}
    return await scrapeOneTab(tabInfo);
  }

  // PERF: Image download deferred to imageDownloadPhase() after all tabs scraped.
  const imagesBase64 = [];

  const cappedImages = (Array.isArray(scraped?.images) ? scraped.images : []).slice(0, getMaxHuntImages());

  const result = {
    tabId:    tabInfo.tabId,
    url:      tabInfo.url,
    title:    scraped?.title || '',
    price:    scraped?.price || '',
    ...zhLibraryPriceFields(scraped || {}),
    platform: tabInfo.platform?.name || 'Other',
    images:   cappedImages,
    imagesBase64,
    videos:   [],
    variants: scraped?.variants || [],
    description: scraped?.description || '',
    brand: scraped?.brand || '', color: scraped?.color || '', weight: scraped?.weight || '', dimL: scraped?.dimL || '', dimW: scraped?.dimW || '', dimH: scraped?.dimH || '', bullets: Array.isArray(scraped?.bullets) ? scraped.bullets : [],
    status,
    error,
    scrapedAt: new Date().toISOString(),
    originalIndex: tabInfo.originalIndex ?? BulkState.results.length // fallback: append order
  };

  if (error === 'cancelled' || BulkState.isCancelled) {
    setBulkRowStatus(tabInfo.tabId, 'fail', { error: 'cancelled' });
    return;
  }

  // v9.5.1: same tab ka purana result (retry / resume race) hata do — duplicate rows na banein
  for (let j = BulkState.results.length - 1; j >= 0; j--) if (BulkState.results[j].tabId === tabInfo.tabId) BulkState.results.splice(j, 1);
  // Lightweight stub — must include images (for imageDownloadPhase) and price (for export)
  BulkState.results.push({
    tabId:       result.tabId,
    url:         result.url,
    title:       result.title,
    price:       result.price,
    ...zhLibraryPriceFields(result),
    platform:    result.platform,
    status:      result.status,
    error:       result.error,
    images:      result.images || [],
    imagesBase64: [],
    videos:      [],
    variants:    result.variants || [],
    description: result.description || '',
    brand: result.brand || '', color: result.color || '', weight: result.weight || '', dimL: result.dimL || '', dimW: result.dimW || '', dimH: result.dimH || '', bullets: result.bullets || [],
    scrapedAt:   result.scrapedAt,
    originalIndex: result.originalIndex
  });

  if (status !== 'fail') {
    BulkState.pendingFlush.push(result);
  }
  setBulkRowStatus(tabInfo.tabId, status, {
    images: (result.images || []).length, // v9.5.1: URL count (download phase 2 mein hota hai)
    error
  });
  updateBulkProgressBar();
}

// Helper: Determine if Fast Mode is active
function isBulkFastMode() {
  const el = $('zhFastModeToggle') || document.querySelector('[data-setting="bulkSkipImageDownload"]');
  if (el) return !!el.checked;
  return Boolean(State?.data?.settings?.bulkSkipImageDownload);
}

// ── Phase 2: Image Download (runs after all tabs scraped) ─────────────────
async function imageDownloadPhase() {
  const pending = BulkState.results.filter(r => r.images?.length > 0 && r.status !== 'fail');
  if (!pending.length) return;

  // Fast mode check: skip downloading base64 if Fast Mode is active
  if (isBulkFastMode()) {
    pending.forEach(r => {
      r.imagesBase64 = [];
      r.imgDlSkipped = true;
      setBulkRowMeta(r.tabId, `${r.images.length} img URLs`);
      setBulkRowStatus(r.tabId, r.status, { images: r.images.length, error: r.error });
    });
    return;
  }

  updateBulkProgressTitle('Downloading images', `${pending.length} products — saving pictures`);

  let cursor = 0;
  const CONCUR = 4; // 4 parallel image batches (was 2) — 2x faster image phase

  const workers = Array.from({ length: CONCUR }, async () => {
    while (cursor < pending.length && !BulkState.isCancelled) {
      const r = pending[cursor++];
      if (!r) break;
      try {
        const urls = (r.images || []).slice(0, getMaxHuntImages());
        const batchRes = await msg({ action: 'FETCH_BASE64_BATCH', urls });
        if (batchRes?.success && Array.isArray(batchRes.results)) {
          r.imagesBase64 = batchRes.results.filter(x => x?.success && x.base64).map(x => x.base64);
        } else {
          r.imagesBase64 = [];
        }
      } catch (_) {
        r.imagesBase64 = [];
      }
      const imgCount = r.imagesBase64?.length || 0;
      setBulkRowMeta(r.tabId, `${imgCount} imgs`);
      if (r.status === 'ok' && r.images?.length > 0 && imgCount === 0) {
        r.status = 'partial'; r.error = 'img_fetch_failed';
        setBulkRowStatus(r.tabId, 'partial', { images: 0, error: 'img_fetch_failed' });
      } else {
        setBulkRowStatus(r.tabId, r.status, { images: imgCount, error: r.error });
      }
    }
  });
  await Promise.all(workers);
}

function getTabUrl(tabId) {
  return new Promise(resolve => {
    chrome.tabs.get(tabId, t => {
      if (chrome.runtime.lastError) resolve('');
      else resolve(t?.url || '');
    });
  });
}

function safeHost(url) {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); }
  catch { return ''; }
}

// Returns a short product-identity key from the URL path so we can detect
// when the scraped data belongs to a DIFFERENT product on the same domain.
// For Amazon: the ASIN; for Walmart/Sam's: the numeric item ID; for eBay:
// the item number; for generic sites: the last path segment.
function safePathKey(url) {
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean);
    // Amazon: /dp/ASIN or /gp/product/ASIN
    const dpIdx = parts.indexOf('dp');
    if (dpIdx >= 0 && parts[dpIdx + 1]) return parts[dpIdx + 1].toLowerCase();
    const gpIdx = parts.indexOf('product');
    if (gpIdx >= 0 && parts[gpIdx + 1]) return parts[gpIdx + 1].toLowerCase();
    // eBay: /itm/ITEM_ID
    const itmIdx = parts.indexOf('itm');
    if (itmIdx >= 0 && parts[itmIdx + 1]) return parts[itmIdx + 1].toLowerCase();
    // Walmart/Sam's Club/Daraz: last all-digit segment of length 6+
    const numPart = [...parts].reverse().find(p => /^\d{6,}$/.test(p));
    if (numPart) return numPart;
    // AliExpress / Faire: last segment before query string
    return (parts[parts.length - 1] || '').toLowerCase().split('?')[0];
  } catch { return ''; }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Progress UI ──────────────────────────────────────────────
function openBulkProgressModal(tabs) {
  const list = $('bulkProgList');
  if (list) {
    list.innerHTML = '';
    tabs.forEach((t, i) => {
      const row = document.createElement('div');
      row.className = 'bulk-prog-row waiting bp-row-in';
      row.style.setProperty('--i', String(Math.min(i, 14)));
      row.dataset.tabId = t.tabId;
      const platName = t.platform?.name || 'Other';
      const platTag  = t.platform?.tag ? t.platform.tag.toLowerCase() : 'oth';
      const itemUrl = t.url || '';
      row.innerHTML = `
        <span class="bulk-prog-status">⌛</span>
        <span class="plat-pill plat-pill-sm" data-plat="${esc(platTag)}">${esc(platName)}</span>
        <span class="bulk-prog-name" title="${esc(t.title || itemUrl)}">${esc(trunc(t.title, 55))}</span>
        <span class="bulk-prog-meta"></span>
        ${itemUrl ? `<a href="${esc(itemUrl)}" target="_blank" rel="noopener noreferrer" class="bp-open-btn" title="Open product page in new tab" onclick="event.stopPropagation()">↗</a>` : ''}`;
      list.appendChild(row);
    });
  }

  $('bulkResultSummary')?.classList.add('hidden');
  $('bulkPendingBox')?.classList.add('hidden');
  $('bpHero')?.classList.remove('hidden');
  BulkState.tabsClosed = 0;
  bpRecoverHide();
  { // v9.12.4 — list goes back under "Now" (on finish it moves into the result screen)
    const lw = $('bpListWrap'), cur = $('bpsCurrent');
    if (lw && cur && cur.nextElementSibling !== lw) cur.after(lw);
    if (lw) lw.open = true;
  }
  bpBindFilter();
  bpSetFilter('all');
  bpSetPhase('hunt');
  $('bulkProgressModal')?.classList.remove('bp-celebrate');
  bpCountState.clear();
  $('bpListWrap')?.classList.remove('hidden');
  $('bpsCurrent')?.classList.remove('hidden');
  $('bulkProgressFoot')?.classList.remove('hidden');
  $('bulkProgressCloseBtn')?.classList.add('hidden');
  { const pb = $('bulkPauseBtn'); if (pb) pb.textContent = 'Pause'; }
  { const f = $('bulkProgFill'); if (f) { f.style.width = '0%'; f.classList.remove('complete'); f.style.background = ''; } }
  bpSetRing(0, '');
  { const d = $('bpDone'), t = $('bpTotal'); if (d) d.textContent = '0'; if (t) t.textContent = String(tabs.length); }
  { const pt = $('bulkProgText'); if (pt) pt.textContent = 'products done'; }
  { const ll = $('bpListLabel'); if (ll) ll.textContent = `All tabs (${tabs.length})`; }
  { const cur = $('bpsCurrent'); if (cur) { cur.textContent = ''; cur.style.display = ''; } }
  { const eta = $('bpsEta'); if (eta) eta.textContent = 'Calculating time left…'; }
  { const ff = $('bpsFailed'); if (ff) ff.classList.remove('on'); }
  updateBulkProgressTitle('Hunting products', 'Reading product pages…');

  $('bulkProgressModal')?.classList.remove('hidden');
}

// ring: 0..100
function bpSetRing(pct, state) {
  const r = $('bulkRingFill'), p = $('bulkRingPct');
  const C = 263.9;
  if (r) { r.style.strokeDashoffset = String(C - (C * Math.max(0, Math.min(100, pct)) / 100)); r.classList.toggle('done', state === 'done'); r.classList.toggle('warn', state === 'warn'); }
  if (p) p.textContent = Math.round(pct) + '%';
}

// v9.10 — popup motion helpers
function bpSetPhase(phase) {
  const m = $('bulkProgressModal');
  if (m) m.dataset.phase = phase;
}

const bpCountState = new Map();
// Smoothly count a number element up/down to `to` (respects reduced motion)
function bpAnimateNumber(el, to) {
  if (!el) return;
  to = Number(to) || 0;
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const from = bpCountState.has(el) ? bpCountState.get(el).value : (parseFloat(el.textContent) || 0);
  const prev = bpCountState.get(el);
  if (prev?.raf) cancelAnimationFrame(prev.raf);
  if (reduce || from === to) { el.textContent = String(to); bpCountState.set(el, { value: to }); return; }
  const t0 = performance.now(), dur = 450;
  const st = { value: from, raf: 0 };
  bpCountState.set(el, st);
  const step = (now) => {
    const k = Math.min(1, (now - t0) / dur);
    const e = 1 - Math.pow(1 - k, 3);
    st.value = Math.round(from + (to - from) * e);
    el.textContent = String(st.value);
    if (k < 1) st.raf = requestAnimationFrame(step); else { st.value = to; st.raf = 0; }
  };
  st.raf = requestAnimationFrame(step);
  if (to > from) { el.classList.remove('bp-bump'); void el.offsetWidth; el.classList.add('bp-bump'); }
}

function markBulkRowRetry(tabId, on) {
  const row = document.querySelector(`.bulk-prog-row[data-tab-id="${tabId}"]`);
  if (row) row.classList.toggle('retrying', !!on);
  bpUpdateFilterCounts();
}

function closeBulkProgressModal() {
  $('bulkProgressModal')?.classList.add('hidden');
}

function updateBulkProgressTitle(text, sub) {
  const el = $('bulkProgressTitle');
  if (el) el.textContent = String(text || '').replace(/^[^\w]+\s*/, '');   // strip legacy emoji prefixes
  if (sub !== undefined) { const se = $('bulkProgressSub'); if (se) se.textContent = sub; }
}

function setBulkRowStatus(tabId, status, opts = {}) {
  const row = document.querySelector(`.bulk-prog-row[data-tab-id="${tabId}"]`);
  if (!row) return;
  const prevStatus = ['waiting', 'active', 'ok', 'partial', 'fail'].find(c => row.classList.contains(c));
  row.classList.remove('waiting', 'active', 'ok', 'partial', 'fail', 'bp-pop');
  row.classList.add(status);
  if (prevStatus !== status && (status === 'ok' || status === 'partial' || status === 'fail')) {
    void row.offsetWidth; row.classList.add('bp-pop');
  }
  if (status === 'active') {
    const list = $('bulkProgList');
    // follow the active row unless the user is reading the list
    if (list && !list.matches(':hover') && $('bpListWrap')?.open) {
      const top = row.offsetTop - list.offsetTop - list.clientHeight / 2 + row.clientHeight / 2;
      list.scrollTo({ top: Math.max(0, top), behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    }
  }
  const statusEl = row.querySelector('.bulk-prog-status');
  const metaEl   = row.querySelector('.bulk-prog-meta');
  if (statusEl) {
    statusEl.textContent = ({
      'waiting': '·',
      'active':  '',
      'ok':      '✓',
      'partial': '◐',
      'fail':    '✗'
    })[status] ?? '·';
  }
  if (metaEl) {
    if (status === 'ok')      metaEl.textContent = `${opts.images || 0} imgs`;
    else if (status === 'partial') metaEl.textContent = HUNT_ERR_LABELS[opts.error] || 'partial';
    else if (status === 'fail') {
      const errMap = {
        ...HUNT_ERR_LABELS,
        'cancelled':       'cancelled',
        'no_response':     'timeout',
        'timeout':         'timeout',
        'no_product':      'not a product page',
        'img_fetch_failed':'images failed',
        'url_mismatch':    'wrong page loaded',
        'tab_navigated':   'tab navigated away',
        'product_mismatch':'data mismatch',
        'scrape_error':    'scrape error',
        'tab_closed':      'tab closed',
        'no_script':       'no script access',
        'network_error':   'network error',
      };
      const raw = opts.error || '';
      const label = errMap[raw] || (raw ? raw.replace(/_/g,' ') : 'failed');
      metaEl.textContent = label;
    }
  }
  bpUpdateFilterCounts();
}

// v9.12.4 — closed-tab marker, list filter, pin retry rows, recovery card
function markBulkRowClosed(tabId) {
  const row = document.querySelector(`.bulk-prog-row[data-tab-id="${tabId}"]`);
  if (!row) return;
  row.classList.add('tab-closed');
  row.title = 'Tab band kar diya (link complete)';
}

function bpPinRowsTop(ids) {
  const list = $('bulkProgList');
  if (!list) return;
  [...ids].reverse().forEach(id => {
    const row = list.querySelector(`.bulk-prog-row[data-tab-id="${id}"]`);
    if (!row) return;
    list.prepend(row);
    row.classList.remove('bp-row-in', 'bp-pin'); void row.offsetWidth; row.classList.add('bp-pin');
  });
  list.scrollTo({ top: 0, behavior: 'smooth' });
}

function bpUpdateFilterCounts() {
  const list = $('bulkProgList');
  if (!list) return;
  const rows = list.querySelectorAll('.bulk-prog-row');
  const ok = list.querySelectorAll('.bulk-prog-row.ok').length;
  const pend = list.querySelectorAll('.bulk-prog-row.partial, .bulk-prog-row.fail, .bulk-prog-row.retrying').length;
  const set = (id, n) => { const e = $(id); if (e) e.textContent = String(n); };
  set('bpfAll', rows.length); set('bpfOk', ok); set('bpfPend', pend);
}

function bpSetFilter(f) {
  const list = $('bulkProgList');
  if (list) list.dataset.f = f;
  document.querySelectorAll('#bpFilter button').forEach(b => b.classList.toggle('on', b.dataset.f === f));
  bpUpdateFilterCounts();
}

function bpBindFilter() {
  const bar = $('bpFilter');
  if (bar && !bar.dataset.bound) {
    bar.dataset.bound = '1';
    bar.addEventListener('click', e => {
      const b = e.target.closest('button[data-f]');
      if (b) { e.preventDefault(); bpSetFilter(b.dataset.f); }
    });
  }
  const stats = document.querySelector('#bulkResultSummary .bulk-result-stats');
  if (stats && !stats.dataset.bound) {
    stats.dataset.bound = '1';
    stats.addEventListener('click', e => {
      const tile = e.target.closest('.bulk-rs-item');
      if (!tile) return;
      const lw = $('bpListWrap');
      if (lw) { lw.open = true; lw.classList.remove('hidden'); }
      bpSetFilter(tile.classList.contains('ok') ? 'ok' : 'pend');
      lw?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }
}

const BpRec = { fixed: 0 };
function bpRecoverShow(round, n) {
  const box = $('bpRecover');
  if (!box) return;
  if (round === 1) BpRec.fixed = 0;
  box.classList.remove('hidden', 'bp-rec-in');
  void box.offsetWidth;
  box.classList.add('bp-rec-in');
  $('bpRecRounds')?.querySelectorAll('i').forEach((d, i) => {
    d.className = i + 1 < round ? 'done' : i + 1 === round ? 'on' : '';
  });
  const sub = $('bpRecSub');
  if (sub) sub.textContent = `Round ${round}/${HUNT_RECOVERY_ROUNDS} · ${n} link${n > 1 ? 's' : ''} · koi skip nahi hoga`;
  const k = $('bpRecK'); if (k) k.textContent = `Link 0/${n}`;
  const nm = $('bpRecName'); if (nm) nm.textContent = 'Shuru ho raha hai…';
  const bar = $('bpRecBar'); if (bar) bar.style.width = '0%';
  bpRecFoot(n);
}
function bpRecoverStep(k, n, name) {
  const kEl = $('bpRecK'); if (kEl) kEl.textContent = `Link ${k}/${n}`;
  const nm = $('bpRecName');
  if (nm) { nm.textContent = trunc(name || '—', 70); nm.classList.remove('bp-rec-swap'); void nm.offsetWidth; nm.classList.add('bp-rec-swap'); }
  const bar = $('bpRecBar'); if (bar) bar.style.width = Math.round(((k - 1) / n) * 100) + '%';
  $('bpRecover')?.classList.add('working');
}
function bpRecoverTick(k, n, fixed, left) {
  if (fixed) {
    BpRec.fixed++;
    const box = $('bpRecover');
    if (box) { box.classList.remove('bp-rec-win'); void box.offsetWidth; box.classList.add('bp-rec-win'); }
  }
  const bar = $('bpRecBar'); if (bar) bar.style.width = Math.round((k / n) * 100) + '%';
  bpRecFoot(left);
}
function bpRecFoot(left) {
  const f = $('bpRecFixed'); if (f) f.textContent = `✓ ${BpRec.fixed} theek hue`;
  const l = $('bpRecLeft'); if (l) l.textContent = `${left} baqi`;
}
function bpRecoverHide() {
  const box = $('bpRecover');
  if (box) box.classList.add('hidden'), box.classList.remove('working');
}

function setBulkRowMeta(tabId, text) {
  const row = document.querySelector(`.bulk-prog-row[data-tab-id="${tabId}"]`);
  const meta = row?.querySelector('.bulk-prog-meta');
  if (meta) meta.textContent = text;
}

function updateBulkProgressBar(currentItemTitle) {
  // v9.5.1: total = is hunt ke tabs; done = unique tabs (ek tab ka dobara result count na ho)
  const total   = BulkState.huntTotal || BulkState.selectedIds.size;
  const done    = Math.min(total || Infinity, new Set(BulkState.results.map(r => r.tabId)).size);
  const failed  = BulkState.results.filter(r => r.status === 'fail' || r.status === 'error' || r.status === 'needs_retry').length;
  // v9.12.4 — during recovery the ring counts COMPLETE links (not "touched"), so it never sits at a fake 100%
  const recovering = $('bulkProgressModal')?.dataset.phase === 'recover' && BulkState.lastHunt;
  const okDone  = recovering ? BulkState.lastHunt.items.filter(it => !huntNeedsRetry(huntItemId(it))).length : done;
  const shown   = recovering ? okDone : done;
  const pct     = total ? Math.round((shown / total) * 100) : 0;
  const fill    = $('bulkProgFill');
  if (fill) { fill.style.width = pct + '%'; fill.style.background = ''; }
  bpSetRing(pct, (!recovering && failed > 0 && done === total) ? 'warn' : '');
  { const d = $('bpDone'), t = $('bpTotal'); bpAnimateNumber(d, shown); if (t) t.textContent = String(total); }
  { const pt = $('bulkProgText'); if (pt) pt.textContent = recovering ? `complete · ${total - okDone} recovery mein` : failed ? `products done · ${failed} failed` : 'products done'; }

  // Live stats
  const elapsedSec = BulkState.huntStartTime ? (Date.now() - BulkState.huntStartTime) / 1000 : 0;
  const speed      = elapsedSec > 1 ? (done / elapsedSec).toFixed(1) : '—';
  const totalImgs  = BulkState.results.reduce((s, r) => s + (Array.isArray(r.images) ? r.images.length : (r.imageCount || 0)), 0);
  const remaining  = total - done;
  let etaStr = '';
  if (elapsedSec > 2 && done > 0 && remaining > 0) {
    const secLeft = Math.ceil(remaining * (elapsedSec / done));
    const m = Math.floor(secLeft / 60), sN = secLeft % 60;
    etaStr = m > 0 ? `${m}m ${sN}s` : `${sN}s`;
  }
  const chip = (id, n) => { const e = $(id); if (!e) return; const sp = e.querySelector('span'); const tgt = sp || e; if (typeof n === 'number') bpAnimateNumber(tgt, n); else tgt.textContent = String(n); };
  chip('bpsImages', totalImgs); chip('bpsFailed', failed); chip('bpsSpeed', speed);
  { const ff = $('bpsFailed'); if (ff) ff.classList.toggle('on', failed > 0); }
  { const eta = $('bpsEta'); if (eta) eta.textContent = recovering ? 'Incomplete links dobara hunt ho rahe hain…' : remaining <= 0 && total > 0 ? 'Finishing up…' : (etaStr ? `About ${etaStr} left` : 'Calculating time left…'); }

  // Currently processing item
  const curEl = $('bpsCurrent');
  if (curEl) {
    if (recovering) {
      curEl.style.display = 'none';   // the recovery card shows the current link
    } else if (currentItemTitle) {
      curEl.innerHTML = `<span class="bpc-k">Now</span>${esc(trunc(currentItemTitle, 70))}`;
      curEl.style.display = 'block';
    } else if (done === total && total > 0) {
      curEl.innerHTML = `<span class="bpc-k">Done</span>All tabs processed`;
      curEl.style.display = 'block';
    } else {
      curEl.style.display = 'none';
    }
  }
}

function toggleBulkPause() {
  BulkState.isPaused = !BulkState.isPaused;
  const btn = $('bulkPauseBtn');
  if (btn) btn.textContent = BulkState.isPaused ? 'Resume' : 'Pause';
  updateBulkProgressTitle(BulkState.isPaused ? 'Paused' : 'Hunting products', BulkState.isPaused ? 'Click Resume to continue' : 'Reading product pages…');
  // Actually pause/resume the background queue worker
}

function cancelBulkHunt() {
  if (!BulkState.isHunting) {
    closeBulkProgressModal();
    return;
  }
  showConfirm(
    'Cancel Bulk Hunt?',
    'Saved data so far will still be available.',
    'Yes, Cancel',
    () => {
      updateBulkProgressTitle('Cancelling…', 'Stopping after the current tab');
      BulkState.isCancelled = true;
      BulkState.isPaused = false;
      const cb = $('bulkCancelBtn'); if (cb) { cb.disabled = true; cb.textContent = 'Cancelling…'; }
      const pb = $('bulkPauseBtn'); if (pb) pb.disabled = true;
      const cur = $('bpsCurrent'); if (cur) cur.innerHTML = '<span class="bpc-k">Wait</span>Stopping after the current tab…';
    }
  );
}

// ── Hunt finished ────────────────────────────────────────────
async function finishBulkHunt() {
  msg({ action: 'STOP_KEEPALIVE' }).catch(() => {});

  // Compute hunt duration for summary
  const durMs  = BulkState.huntStartTime ? Date.now() - BulkState.huntStartTime : 0;
  const durSec = Math.round(durMs / 1000);
  BulkState.huntDurStr = durSec >= 60 ? `${Math.floor(durSec/60)}m ${durSec%60}s` : `${durSec}s`;

  // Mark progress complete
  const fill = $('bulkProgFill');
  if (fill) { fill.style.width = '100%'; fill.classList.add('complete'); }

  // Show result summary
  $('bulkResultSummary')?.classList.remove('hidden');
  $('bpHero')?.classList.add('hidden');
  bpRecoverHide();
  { // v9.12.4 — every link stays visible in the result (closed by default), above "What next?"
    const lw = $('bpListWrap'), acts = document.querySelector('#bulkResultSummary .bulk-result-actions');
    if (lw && acts) { acts.before(lw); lw.open = false; lw.classList.remove('hidden'); }
    const ll = $('bpListLabel'); if (ll) ll.textContent = 'Har link ka haal';
    bpSetFilter('all');
  }
  $('bpsCurrent')?.classList.add('hidden');
  $('bulkProgressFoot')?.classList.add('hidden');
  $('bulkProgressCloseBtn')?.classList.remove('hidden');

  const pending = huntRefreshSummary();
  if (!pending && !BulkState.isCancelled) {
    const m = $('bulkProgressModal');
    if (m) { m.classList.remove('bp-celebrate'); void m.offsetWidth; m.classList.add('bp-celebrate'); }
    bpConfetti();
  }

  updateMasterStats();
  updateBulkSummary();
  updateQueueExportButtons();
  // Update status footer with new library count
  setTimeout(updateStatusLine, 800);

  // v8.3.2: no automatic download — the result modal is where the user picks what to save.
}

// v9.10 — result numbers + the "pending" list (links that are still not complete).
// Returns how many links are pending.
function huntRefreshSummary() {
  const ok      = BulkState.results.filter(r => r.status === 'ok').length;
  const partial = BulkState.results.filter(r => r.status === 'partial').length;
  const fail    = BulkState.results.filter(r => r.status === 'fail').length;
  const totalImgs = BulkState.results.reduce((s, r) => s + (r.imagesBase64?.length || r.images?.length || r.imageCount || 0), 0);

  bpAnimateNumber($('bulkRsOk'), ok);
  bpAnimateNumber($('bulkRsPartial'), partial);
  bpAnimateNumber($('bulkRsFail'), fail);
  // v9.12.4 — coverage strip: proof that no link was skipped
  const lhItems = BulkState.lastHunt?.items || [];
  const covTotal = lhItems.length || BulkState.results.length;
  const covHunted = lhItems.length ? lhItems.filter(it => latestHuntResult(huntItemId(it))).length : BulkState.results.length;
  const skipped = Math.max(0, covTotal - covHunted);
  const metaEl = $('bulkResultMeta');
  if (metaEl) {
    const parts = [
      `<span class="bp-cov ${skipped ? 'warn' : 'ok'}">${skipped ? '!' : '✓'} ${covHunted}/${covTotal} links hunt hue</span>`,
      `<span class="bp-cov ${skipped ? 'warn' : ''}">${skipped} skip</span>`
    ];
    if (BulkState.lastHunt?.mode === 'tabs') parts.push(`<span class="bp-cov">${BulkState.tabsClosed || 0} tabs band</span>`);
    metaEl.innerHTML = parts.join('');
  }
  [['bulkRsOk', ok], ['bulkRsPartial', partial], ['bulkRsFail', fail]].forEach(([id, n]) => $(id)?.closest('.bulk-rs-item')?.classList.toggle('zero', !n));

  const pending = renderHuntPending();
  bpSetRing(100, pending ? 'warn' : 'done');
  bpSetPhase(pending ? 'attention' : 'done');

  const total = BulkState.results.length;
  const title = BulkState.isCancelled ? 'Hunt cancelled' : pending ? 'Hunt complete — kuch links baqi' : 'Hunt complete';
  updateBulkProgressTitle(title,
    BulkState.isCancelled ? `${total} product${total === 1 ? '' : 's'} hunt hue` : pending ? `${pending} link${pending > 1 ? 's' : ''} ko Retry chahiye — skip nahi kiye` : 'Har link complete — koi skip nahi');
  const doneBtn = $('bulkResultDoneBtn');
  if (doneBtn) doneBtn.textContent = pending ? `Close (${pending} pending)` : 'Done';
  // v9.10.2 — result hero
  const ready = ok + partial;
  const pct = total ? Math.round((ok / total) * 100) : 0;
  const hero = $('bpDoneHero');
  if (hero) hero.dataset.state = BulkState.isCancelled ? 'cancel' : (fail || pending) ? 'warn' : 'ok';
  const ico = $('bpDoneIco');
  if (ico) {
    if (BulkState.isCancelled) ico.textContent = '■';
    else if (fail || pending) ico.textContent = '!';
    else ico.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
    ico.classList.remove('bp-ico-in'); void ico.offsetWidth; ico.classList.add('bp-ico-in');
  }
  const hd = $('bpDoneHead'); if (hd) hd.textContent = BulkState.isCancelled ? 'Hunt cancelled' : `${ready}/${total} products ready`;
  const sb = $('bpDoneSub'); if (sb) sb.textContent = `${totalImgs} images · ${BulkState.huntDurStr || '—'}` + (pending ? ` · ${pending} retry chahiye` : fail ? ` · ${fail} failed` : ' · sab complete 🎉');
  const bar = $('bpDoneBar'); if (bar) requestAnimationFrame(() => { bar.style.width = pct + '%'; });
  $('bpLiveBadge')?.classList.add('off');
  return pending;
}

// v9.12.4 — small confetti burst on a clean finish (CSS turns it off for reduced motion)
function bpConfetti() {
  const hero = $('bpDoneHero');
  if (!hero || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  hero.querySelectorAll('.bp-confetti').forEach(n => n.remove());
  const wrap = document.createElement('div');
  wrap.className = 'bp-confetti';
  const colors = ['#10B981', '#00E5FF', '#F59E0B', '#A78BFA', '#F472B6', '#FDE68A'];
  for (let i = 0; i < 22; i++) {
    const p = document.createElement('i');
    const ang = (Math.PI * 2 * i) / 22 + Math.random() * 0.3;
    const dist = 60 + Math.random() * 80;
    p.style.setProperty('--x', `${Math.cos(ang) * dist}px`);
    p.style.setProperty('--y', `${Math.sin(ang) * dist * 0.6 - 20}px`);
    p.style.setProperty('--r', `${Math.round(Math.random() * 540 - 270)}deg`);
    p.style.setProperty('--d', `${Math.round(Math.random() * 120)}ms`);
    p.style.background = colors[i % colors.length];
    wrap.appendChild(p);
  }
  hero.appendChild(wrap);
  setTimeout(() => wrap.remove(), 1800);
}

function huntItemId(item) {
  return BulkState.lastHunt?.mode === 'queue' ? item.id : item.tabId;
}

function renderHuntPending() {
  const box = $('bulkPendingBox'), list = $('bulkPendingList'), cnt = $('bulkPendingCount');
  const lh = BulkState.lastHunt;
  if (!box || !list || !lh) { box?.classList.add('hidden'); return 0; }
  const pend = lh.items.filter(it => huntNeedsRetry(huntItemId(it)));
  box.classList.toggle('hidden', !pend.length);
  if (cnt) cnt.textContent = String(pend.length);
  const isUrl = v => /^https?:\/\//i.test(v || '');
  list.innerHTML = pend.map((it, i) => {
    const id = huntItemId(it);
    const r = latestHuntResult(id);
    const name = (r?.title && !isUrl(r.title)) ? r.title : ((it.title && !isUrl(it.title)) ? it.title : it.url);
    const host = safeHost(it.url) || it.url;
    const reason = r ? huntErrLabel(r.error) : 'abhi hunt nahi hua';
    const st = r?.status || 'fail';
    return `<div class="bp-pend-item ${it._busy ? 'busy' : ''}" data-id="${esc(String(id))}" style="--i:${Math.min(i, 12)}">
      <span class="bp-pend-dot ${esc(st)}"></span>
      <div class="bp-pend-txt">
        <div class="bp-pend-title" title="${esc(it.url)}">${esc(trunc(name, 64))}</div>
        <div class="bp-pend-reason">${esc(host)} · ${esc(reason)}</div>
      </div>
      <button class="bp-pend-retry" type="button" title="Isi link ko dobara hunt karein" ${it._busy ? 'disabled' : ''}>${it._busy ? '<i class="bp-spin"></i>' : '↻'} Retry</button>
      <a class="bp-open-btn" href="${esc(it.url)}" target="_blank" rel="noopener noreferrer" title="Page kholein">↗</a>
    </div>`;
  }).join('');
  return pend.length;
}

async function huntManualRetry(id) {
  const lh = BulkState.lastHunt;
  const it = lh?.items.find(x => String(huntItemId(x)) === String(id));
  if (!it || it._busy) return null;
  if (BulkState._retryBusy) { toast('Ek retry pehle se chal raha hai — thora intezaar karein', 'info'); return null; }
  if (BulkState.isHunting) { toast('Hunt abhi chal raha hai — khatam hone dein', 'warn'); return null; }
  BulkState._retryBusy = true;
  it._busy = true;
  renderHuntPending();
  BulkState.isCancelled = false;
  BulkState.isPaused = false;
  const wasHunting = BulkState.isHunting;
  BulkState.isHunting = true; // blocks a new hunt from starting meanwhile
  let r = null;
  try {
    r = lh.mode === 'queue' ? await huntRetryQueueItem(it, 3) : await huntRetryTabItem(it, 3);
    if (lh.mode === 'tabs' && (r?.status === 'ok' || it._reopened)) await huntCloseTab(it);
    markBulkRowRetry(huntItemId(it), r?.status !== 'ok');
    await huntDownloadImagesFor(r);
    await huntFlushNow();
    if (lh.mode === 'queue') { saveBulkQueue(); try { loadBulkQueue(); } catch (_) {} }
  } catch (e) {
    console.warn('[ZHunter] manual retry error', e);
  } finally {
    it._busy = false;
    BulkState._retryBusy = false;
    BulkState.isHunting = wasHunting;
    if (lh.mode === 'queue') await closeQueueWorkerTab();
  }
  const name = trunc((r?.title && !/^https?:/i.test(r.title)) ? r.title : safeHost(it.url), 40);
  if (r?.status === 'ok') toast(`✓ ${name} — ab complete, Library mein update`, 'ok');
  else toast(`${name} — abhi bhi: ${huntErrLabel(r?.error)}. Page khol kar check karein ya phir Retry.`, 'warn');
  const pending = huntRefreshSummary();
  updateMasterStats();
  if (!pending) {
    const m = $('bulkProgressModal');
    if (m) { m.classList.remove('bp-celebrate'); void m.offsetWidth; m.classList.add('bp-celebrate'); }
  }
  return r;
}

async function huntRetryAll() {
  const lh = BulkState.lastHunt;
  if (!lh) return;
  const btn = $('bulkRetryAllBtn');
  if (btn?.disabled) return;
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="bp-spin"></i> Retrying…'; }
  BulkState._manualRetry = true;
  try {
    const ids = lh.items.filter(it => huntNeedsRetry(huntItemId(it))).map(huntItemId);
    for (const id of ids) {
      if (!BulkState._manualRetry) break;
      await huntManualRetry(id);
    }
  } finally {
    BulkState._manualRetry = false;
    if (btn) { btn.disabled = false; btn.textContent = '↻ Retry all'; }
  }
}

// ── Master Sheet storage ─────────────────────────────────────
function zhCaptureSourceFacts(row) { return JSON.parse(JSON.stringify({ title: row.title, description: row.description, bullets: row.bullets, brand: row.brand, color: row.color, size: row.size, material: row.material, weight: row.weight, variants: row.variants, images: row.images })); }
// Currency metadata is explicit evidence only; never infer USD from a bare price/platform.
function zhLibraryPriceFields(row = {}) {
  const raw = String(row.price ?? '').trim();
  const scalar = raw.match(/^(?:([A-Z]{3}|US\$|CA\$|AU\$|[$\u00a3\u20ac\u00a5\u20b9\u20a9])\s*)?(\d+(?:,\d{3})*(?:\.\d+)?)(?:\s*([A-Z]{3}|[$\u00a3\u20ac\u00a5\u20b9\u20a9]))?$/i);
  const token = scalar?.[1] || scalar?.[3] || '';
  const currencyInPrice = /^[A-Z]{3}$/i.test(token) ? token.toUpperCase() : '';
  const symbolInPrice = token && !currencyInPrice ? token : '';
  const symbolCodes = { 'US$': 'USD', 'CA$': 'CAD', 'AU$': 'AUD' };
  let currency = currencyInPrice || symbolCodes[symbolInPrice] || (/^[A-Z]{3}$/i.test(row.priceCurrency || '') ? row.priceCurrency.toUpperCase() : '');
  const knownSymbols = { USD: '$', CAD: 'CA$', AUD: 'AU$', GBP: '\u00a3', EUR: '\u20ac', JPY: '\u00a5', INR: '\u20b9', KRW: '\u20a9' };
  if (!currencyInPrice && !symbolCodes[symbolInPrice] && symbolInPrice && knownSymbols[currency] && symbolInPrice !== knownSymbols[currency] && !(symbolInPrice === '$' && ['CAD','AUD'].includes(currency))) currency = '';
  const storedAmount = String(row.priceAmount ?? '');
  const amount = scalar ? scalar[2].replace(/,/g, '') : !raw && /^\d+(?:\.\d+)?$/.test(storedAmount) ? storedAmount : '';
  return { priceAmount: amount, priceCurrency: amount ? currency : '',
    priceSymbol: amount ? (symbolInPrice || knownSymbols[currency] || row.priceSymbol || '') : '' };
}

function formatLibraryPrice(row) {
  const info = zhLibraryPriceFields(row);
  if (info.priceAmount && info.priceCurrency) {
    try {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: info.priceCurrency,
        maximumFractionDigits: Math.min(20, Math.max(2, info.priceAmount.split('.')[1]?.length || 0)) }).format(Number(info.priceAmount));
    } catch (_) { return info.priceCurrency + ' ' + info.priceAmount; }
  }
  // Keep legacy/unknown currency text intact, including bare numbers and ranges.
  const raw = String(row.price ?? '').trim();
  return raw || (info.priceAmount ? info.priceSymbol + info.priceAmount : '\u2014');
}

const ZhMasterBaselines = new WeakMap();
async function getMasterRows() {
  const saved = await chrome.storage.local.get([MASTER_KEY, 'zhTextEdits']);
  const rows = saved[MASTER_KEY] || [];
  ZhMasterBaselines.set(rows, JSON.parse(JSON.stringify(rows)));
  for (const row of rows) if (!row._sourceFacts) {
    const journal = saved.zhTextEdits?.[row.url || row.id];
    row._sourceFacts = JSON.parse(JSON.stringify({ title: journal?.fields?.title?.previous?.[0] ?? row.title, description: journal?.fields?.description?.previous?.[0] ?? row.description, bullets: journal?.fields?.bullets?.previous?.[0] ?? row.bullets, brand: row.brand, color: row.color, size: row.size, material: row.material, weight: row.weight, variants: row.variants, images: row.images }));
  }
  return rows;
}
async function setMasterRows(rows, original = rows) {
  const baseline = ZhMasterBaselines.get(original);
  if (!baseline) throw new Error('Unsafe Library save blocked; reload Library and retry');
  const result = await msg({ action: 'MASTER_COMMIT', baseline, rows });
  if (!result?.success) throw new Error(result?.error || 'Library save failed');
  ZhMasterBaselines.set(rows, JSON.parse(JSON.stringify(rows)));
}

async function getMasterBatches() {
  return new Promise(resolve => {
    chrome.storage.local.get(BATCHES_KEY, res => resolve(res[BATCHES_KEY] || []));
  });
}

async function setMasterBatches(batches) {
  await chrome.storage.local.set({ [BATCHES_KEY]: batches });
}

async function appendToMasterSheet(rows) {
  // Strip base64 images from master storage (would explode storage)
  const existing = await getMasterRows();
  const byUrl = new Map(existing.map(r => [(r.url || '').toLowerCase(), r]));
  // v9.10 — upsert: a better result for a URL we already have (e.g. partial → complete)
  // updates that row in place; user-filled fields (labelCost, listPrice, id) are kept.
  let upgraded = 0;
  const newRows = [];
  const seenNew = new Set();
  for (const r of rows) {
    const key = (r.url || '').toLowerCase();
    const ex = byUrl.get(key);
    if (!ex) { if (!seenNew.has(key)) { seenNew.add(key); newRows.push(r); } continue; }
    ex.batchIds = [...new Set([...(ex.batchIds || []), ex.batchId, BulkState.currentBatchId].filter(Boolean))].slice(-50);
    upgraded++;
    if (huntResultScore(r) > huntResultScore(ex)) {
      Object.assign(ex, {
        title: ex.title,
        price: r.price || ex.price,
        ...zhLibraryPriceFields(r.price ? r : ex),
        platform: r.platform || ex.platform,
        description: ex.description,
        variants: (r.variants || []).length ? r.variants.join(', ') : ex.variants,
        imageCount: Array.isArray(r.images) && r.images.length ? r.images.length : ex.imageCount,
        images: ex.images,
        brand: r.brand || ex.brand, color: r.color || ex.color, weight: r.weight || ex.weight,
        dimL: r.dimL || ex.dimL, dimW: r.dimW || ex.dimW, dimH: r.dimH || ex.dimH,
        bullets: ex.bullets,
        _sourceFacts: zhCaptureSourceFacts(r),
        status: r.status,
        lastRehunted: new Date().toISOString()
      });
      upgraded++;
    }
  }

  if (newRows.length === 0) {
    if (upgraded) await setMasterRows(existing);
    await zhRecordHuntBatch(rows);
    return;
  }

  const lean = newRows.map(r => ({
    id:           `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    batchId:      BulkState.currentBatchId || null,
    _sourceFacts: zhCaptureSourceFacts(r),
    title:        r.title,
    url:          r.url,
    platform:     r.platform,
    price:        r.price,
    ...zhLibraryPriceFields(r),
    labelCost:    '',                                     // empty — user fills
    listPrice:    '',                                     // empty — user fills
    description:  r.description,
    tags:         Array.isArray(r.tags) ? r.tags.join(', ') : '',
    variants:     (r.variants || []).join(', '),
    imageCount:   Array.isArray(r.images) ? r.images.length : 0,
    videoCount:   Array.isArray(r.videos) ? r.videos.length : 0,
    images:       Array.isArray(r.images) ? r.images.slice(0, 10) : [],  // raw URLs (10 = sheet Image 1-10)
    brand: r.brand || '', color: r.color || '', weight: r.weight || '', dimL: r.dimL || '', dimW: r.dimW || '', dimH: r.dimH || '',
    bullets:      Array.isArray(r.bullets) ? r.bullets.slice(0, 6) : [],
    videos:       Array.isArray(r.videos) ? r.videos.slice(0, 4) : [],
    status:       r.status,
    scrapedAt:    r.scrapedAt,
    lastRehunted: ''
  }));
  await setMasterRows([...existing, ...lean], existing);

  await zhRecordHuntBatch(rows);
}

async function zhRecordHuntBatch(rows) {
  if (!BulkState.currentBatchId) return;
  const result = await msg({ action: 'MASTER_BATCH_ADD', batch: { id: BulkState.currentBatchId, label: BulkState.batchLabel || '', date: new Date().toISOString(), urls: rows.map(r => r.url), platforms: rows.map(r => r.platform).filter(Boolean) } });
  if (!result?.success) throw new Error(result?.error || 'Hunt history save failed');
}
async function updateMasterStats() {
  const list = $('masterRowsList');
  if (list && (!MasterUIState.allRows || !MasterUIState.allRows.length)) {
    list.innerHTML = `
      <div class="skel"><i></i><i></i><i></i></div>
      <div class="skel"><i></i><i></i><i></i></div>
      <div class="skel"><i></i><i></i><i></i></div>
    `;
  }
  const rows = await getMasterRows();
  const batches = await getMasterBatches();
  $('masterRowCount').textContent  = rows.length;
  $('masterBatchCount').textContent = batches.length;
  if (batches.length === 0) {
    $('masterStartDate').textContent = '—';
  } else {
    const oldest = batches[batches.length - 1];
    const d = new Date(oldest.date);
    $('masterStartDate').textContent = d.toLocaleDateString();
  }

  updateHeaderCount();
  const dlEnabled = rows.length > 0;
  $('masterDlXlsxBtn').disabled = !dlEnabled;
  if ($('masterDlCsvBtn'))  $('masterDlCsvBtn').disabled  = !dlEnabled;
  if ($('masterDlHtmlBtn')) $('masterDlHtmlBtn').disabled = !dlEnabled;
  if ($('masterCopyTsvBtn')) $('masterCopyTsvBtn').disabled = !dlEnabled;
  if ($('masterDlPdfBtn'))  $('masterDlPdfBtn').disabled  = !dlEnabled;
  if ($('masterDlZipBtn'))  $('masterDlZipBtn').disabled  = !dlEnabled;
  if ($('masterTemuBtn'))   $('masterTemuBtn').disabled   = !dlEnabled; // v9.6.1

  $('masterWarning')?.classList.toggle('hidden', rows.length < 200);

  renderMasterBatches(batches);
  MasterUIState.allRows = rows;
  MasterUIState.batches = batches;
  filterAndRenderMasterRows();
}

// Master sheet UI state — selection set + filters
const MasterUIState = {
  selectedIds: new Set(),
  searchQuery: '',
  filterPlatform: 'all',
  sortBy: 'newest',
  allRows: []
};

async function toggleStarRow(id) {
  const rows = MasterUIState.allRows || [];
  const r = rows.find(x => x.id === id);
  if (!r) return;
  r.starred = !r.starred;
  const existing = await getMasterRows();
  const target = existing.find(x => x.id === id);
  if (target) {
    target.starred = r.starred;
    await setMasterRows(existing);
  }
  filterAndRenderMasterRows();
  toast(r.starred ? 'Product starred ★' : 'Removed from starred', 'ok');
}

// Older Library rows omitted batchId. Recover only an unambiguous full batch.
function masterRowsForBatch(rows, batch, batches) {
  if (!batch?.id) return [];
  const direct = rows.filter(r => r.batchId === batch.id || r.batchIds?.includes(batch.id) || batch.urls?.includes(r.url));
  const startFor = b => {
    const match = /^(?:batch|queue)_(\d+)$/.exec(b.id || '');
    return match ? Number(match[1]) : NaN;
  };
  const start = startFor(batch);
  if (!Number.isFinite(start)) return direct;
  const next = Math.min(...(batches || []).map(startFor).filter(t => t > start));
  const candidates = rows.filter(r => {
    if (r.batchId || r.batchIds || batch.urls) return direct.includes(r);
    const time = typeof r.scrapedAt === 'number' ? r.scrapedAt : Date.parse(r.scrapedAt);
    return Number.isFinite(time) && time >= start && time < next;
  });
  return candidates.length === Number(batch.count) ? candidates : direct;
}

function filterAndRenderMasterRows() {
  let rows = MasterUIState.allRows || [];
  const q = (MasterUIState.searchQuery || '').trim().toLowerCase();
  const plat = MasterUIState.filterPlatform || 'all';
  const sort = MasterUIState.sortBy || 'newest';

  // Update problems count
  const isProblem = r => (r.status && r.status !== 'ok') || !r.price || r.price === '—' || !r.images?.length || r.duplicate;
  const problemCount = (MasterUIState.allRows || []).filter(isProblem).length;
  const probBadge = $('masterProblemCount');
  if (probBadge) probBadge.textContent = problemCount;

  if (plat === 'problems') {
    rows = rows.filter(isProblem);
  } else if (plat === 'starred') {
    rows = rows.filter(r => !!r.starred);
  } else if (plat === 'tagged') {
    rows = rows.filter(r => Array.isArray(r.tags) && r.tags.length > 0);
  } else if (plat !== 'all') {
    rows = rows.filter(r => {
      const p = (r.platform || '').toLowerCase();
      const tagInfo = (PLATFORM_PATTERNS[(Object.keys(PLATFORM_PATTERNS).find(k => p.includes(k.split('.')[0])) || '')]) || null;
      const tag = tagInfo?.tag ? tagInfo.tag.toLowerCase() : p.slice(0, 3);
      return tag === plat || p.includes(plat);
    });
  }

  if (q) {
    rows = rows.filter(r => {
      return (r.title || '').toLowerCase().includes(q) ||
             (r.platform || '').toLowerCase().includes(q) ||
             (r.price || '').toLowerCase().includes(q) ||
             (r.url || '').toLowerCase().includes(q);
    });
  }

  // Batch ID filter (from Recent Hunts Filter button)
  if (MasterUIState.filterBatchId) {
    const batch = (MasterUIState.batches || []).find(b => b.id === MasterUIState.filterBatchId);
    rows = masterRowsForBatch(rows, batch || { id: MasterUIState.filterBatchId }, MasterUIState.batches);
  }

  // Sort rows
  rows = [...rows];
  if (sort === 'newest') {
    rows.sort((a, b) => (Date.parse(b.scrapedAt) || Number(b.scrapedAt) || 0) - (Date.parse(a.scrapedAt) || Number(a.scrapedAt) || 0));
  } else if (sort === 'oldest') {
    rows.sort((a, b) => (Date.parse(a.scrapedAt) || Number(a.scrapedAt) || 0) - (Date.parse(b.scrapedAt) || Number(b.scrapedAt) || 0));
  } else if (sort === 'price-desc') {
    const parsePrice = p => parseFloat(String(p || '').replace(/[^0-9.]/g, '')) || 0;
    rows.sort((a, b) => parsePrice(b.price) - parsePrice(a.price));
  } else if (sort === 'price-asc') {
    const parsePrice = p => parseFloat(String(p || '').replace(/[^0-9.]/g, '')) || 0;
    rows.sort((a, b) => parsePrice(a.price) - parsePrice(b.price));
  } else if (sort === 'platform') {
    rows.sort((a, b) => (a.platform || '').localeCompare(b.platform || ''));
  } else if (sort === 'images') {
    rows.sort((a, b) => (b.imageCount || b.images?.length || 0) - (a.imageCount || a.images?.length || 0));
  }

  MasterUIState.visibleRows = rows; // v9.7.3
  renderMasterRows(rows);
  if (typeof updateTopTemuStorePill === 'function') updateTopTemuStorePill();
}

function setMasterLibraryViewMode(view) {
  const list = $('masterRowsList');
  const switcher = $('masterViewSwitcher');
  const isDense = (view === 'dense');
  if (list) {
    list.classList.toggle('master-dense-view', isDense);
  }
  if (switcher) {
    switcher.querySelectorAll('.zh-view-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.view === (isDense ? 'dense' : 'card'));
    });
  }
  localStorage.setItem('zh_lib_view', isDense ? 'dense' : 'card');
}

function renderMasterRows(rows) {
  const list = $('masterRowsList');
  if (!list) return;
  const libView = localStorage.getItem('zh_lib_view') || 'card';
  list.classList.toggle('master-dense-view', libView === 'dense');
  const switcher = $('masterViewSwitcher');
  if (switcher) {
    switcher.querySelectorAll('.zh-view-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.view === libView);
    });
  }
  const panel = $('tab-library');
  const prevPanelScroll = panel ? panel.scrollTop : 0;
  const prevListScroll = list.scrollTop;

  if (!rows || rows.length === 0) {
    list.innerHTML = '<div class="bulk-empty"><p>No products yet. Hunt some tabs first!</p></div>';
    updateMasterBulkBar();
    if (panel) panel.scrollTop = prevPanelScroll;
    return;
  }

  list.innerHTML = '';
  // Order already determined by filterAndRenderMasterRows sorting
  const display = [...rows];
  // ── Duplicate detection: find products sharing same URL across different rows
  const urlCount = {};
  display.forEach(r => { const key = r.url || r.id; urlCount[key] = (urlCount[key] || 0) + 1; });
  const dupUrls = new Set(Object.keys(urlCount).filter(k => urlCount[k] > 1));
  display.forEach(r => {
    const sel = MasterUIState.selectedIds.has(r.id);
    const status = r.status || 'ok';
    const date = r.scrapedAt ? new Date(r.scrapedAt) : null;
    const dateStr = date ? `${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')} ${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}` : '—';
    const priceStr = formatLibraryPrice(r);
    const tagInfo = (PLATFORM_PATTERNS[(Object.keys(PLATFORM_PATTERNS).find(k => (r.platform || '').toLowerCase().includes(k.split('.')[0])) || '')]) || null;
    const platName = tagInfo?.name || r.platform || 'Other';
    const platTag = tagInfo?.tag ? tagInfo.tag.toLowerCase() : (r.platform ? r.platform.slice(0, 3).toLowerCase() : 'oth');

    const thumbUrl = (Array.isArray(r.images) && r.images.length && typeof r.images[0] === 'string')
      ? r.images[0]
      : (r.images?.[0]?.url || '');
    const thumbHtml = thumbUrl
      ? `<img class="row-thumb-img" src="${esc(thumbUrl)}" alt="${esc(r.title || '')}" loading="lazy" data-onerror="thumb"><span class="row-thumb-fallback" style="display:none;">${esc(platName.slice(0, 2))}</span>`
      : `<span class="row-thumb-fallback">${esc(platName.slice(0, 2))}</span>`;

    const isDup = dupUrls.has(r.url || r.id);
    const row = document.createElement('div');
    row.className = 'master-row' + (sel ? ' selected' : '') + ' status-' + status + (isDup ? ' is-dup' : '');
    row.dataset.id = r.id;

    row.innerHTML = `
      <div class="master-row-check"></div>
      <div class="row-thumb-wrap">${thumbHtml}</div>
      <div class="master-row-info">
        <div class="master-row-top">
          <button class="star-btn ${r.starred ? 'starred' : ''}" data-id="${esc(r.id)}" title="${r.starred ? 'Unstar' : 'Star'}" type="button">${r.starred ? '★' : '☆'}</button>
          <span class="plat-pill" data-plat="${esc(platTag)}">${esc(platName)}</span>
          <span class="m-price">${esc(priceStr)}</span>
          <span class="m-dup-badge">DUP</span>
          ${status !== 'ok' ? `<span class="m-status ${esc(status)}">${esc(status)}</span>` : ''}
          ${r.lastRehunted ? `<span class="m-rehunted" title="Re-fetched ${new Date(r.lastRehunted).toLocaleString()}">↻</span>` : ''}
        </div>
        <div class="master-row-title" title="${esc(r.title || '')}">${esc(trunc(r.title || '(untitled)', 65))}</div>
        <div class="master-row-meta">
          <span class="m-date">${esc(dateStr)}</span>
          ${r.imageCount ? `<span class="m-sep">·</span><span class="m-imgs">${r.imageCount} imgs</span>` : ''}
        </div>
      </div>
      <div class="row-quick-actions">
        <button class="row-act-btn act-open" title="Open product page" type="button">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
        </button>
        <button class="row-act-btn act-edit" title="Edit title / price" type="button">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="row-act-btn act-copy" title="Copy product link" type="button">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        </button>
        <button class="row-act-btn act-rehunt" title="Re-fetch latest data" type="button">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M3 12a9 9 0 0 1 14.85-6.85L21 8"/><path d="M3 4v4h4"/><path d="M21 12a9 9 0 0 1-14.85 6.85L3 16"/><path d="M21 20v-4h-4"/></svg>
        </button>
        <button class="row-act-btn act-del" title="Delete product" type="button">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        </button>
      </div>`;

    row.querySelector('.act-open')?.addEventListener('click', (e) => {
      e.stopPropagation();
      chrome.tabs.create({ url: r.url });
    });
    row.querySelector('.act-edit')?.addEventListener('click', (e) => {
      e.stopPropagation();
      openEditModal({ id: r.id, url: r.url, title: r.title || '', price: r.price || '',
        notes: '', folder: 'General', category: '', tags: [], images: r.images || [], videoUrl: '',
        _masterRow: true });
    });
    row.querySelector('.act-copy')?.addEventListener('click', (e) => {
      e.stopPropagation();
      navigator.clipboard.writeText(r.url);
      toast('Copied link', 'ok');
    });
    row.querySelector('.act-rehunt')?.addEventListener('click', (e) => {
      e.stopPropagation();
      reHuntMasterRow(r.id);
    });
    row.querySelector('.act-del')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      const existing = await getMasterRows();
      const filtered = existing.filter(item => item.id !== r.id);
      await setMasterRows(filtered, existing);
      MasterUIState.selectedIds.delete(r.id);
      renderMasterRows(filtered);
      await updateMasterStats();
      toast('Product deleted', 'ok');
    });
    row.querySelector('.row-thumb-wrap')?.addEventListener('click', (e) => {
      if (thumbUrl) {
        e.stopPropagation();
        openLightbox(thumbUrl, `${platName} — ${r.title || 'Product'}`);
      }
    });

    row.querySelector('.star-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleStarRow(r.id);
    });

    // Click row → toggle selection (but ignore quick action, star, or thumbnail clicks)
    row.addEventListener('click', (e) => {
      if (e.target.closest('.row-act-btn') || e.target.closest('.row-thumb-wrap') || e.target.closest('.star-btn')) return;
      e.preventDefault();
      const p = $('tab-library');
      const st = p ? p.scrollTop : 0;
      if (MasterUIState.selectedIds.has(r.id)) {
        MasterUIState.selectedIds.delete(r.id);
        row.classList.remove('selected');
      } else {
        MasterUIState.selectedIds.add(r.id);
        row.classList.add('selected');
      }
      updateMasterBulkBar();
      if (p) p.scrollTop = st;
    });

    list.appendChild(row);
  });
  updateMasterBulkBar();
  if (panel) panel.scrollTop = prevPanelScroll;
  if (list) list.scrollTop = prevListScroll;
  updateStatusLine();
}

function updateMasterBulkBar() {
  const bar = $('masterBulkBar');
  const cnt = $('masterBulkSelCount');
  const n = MasterUIState.selectedIds.size;
  if (!bar) return;
  if (n === 0) {
    bar.classList.add('hidden');
  } else {
    bar.classList.remove('hidden');
    if (cnt) cnt.textContent = `${n} selected`;
  }
}

async function masterSelectByStatus(targetStatus) {
  const panel = $('tab-library');
  const prevPanelScroll = panel ? panel.scrollTop : 0;
  const rows = await getMasterRows();
  rows.forEach(r => {
    if (r.status === targetStatus) MasterUIState.selectedIds.add(r.id);
  });
  renderMasterRows(rows);
  if (panel) panel.scrollTop = prevPanelScroll;
}

async function masterSelectAll() {
  const panel = $('tab-library');
  const prevPanelScroll = panel ? panel.scrollTop : 0;
  // v9.7.3: "All" = sirf jo abhi filter/search mein dikh rahe hain (poori Library nahi)
  const rows = Array.isArray(MasterUIState.visibleRows) ? MasterUIState.visibleRows : await getMasterRows();
  rows.forEach(r => MasterUIState.selectedIds.add(r.id));
  renderMasterRows(rows);
  if (panel) panel.scrollTop = prevPanelScroll;
}

function masterDeselectAll() {
  const panel = $('tab-library');
  const prevPanelScroll = panel ? panel.scrollTop : 0;
  MasterUIState.selectedIds.clear();
  const rows = Array.isArray(MasterUIState.visibleRows) ? MasterUIState.visibleRows : null;
  if (rows) {
    renderMasterRows(rows);
  } else {
    updateMasterStats();
  }
  if (panel) panel.scrollTop = prevPanelScroll;
}

// ── Bulk tab inline columns panel ───────────────────────────
function toggleBulkColumnsPanel() {
  const panel = $('bulkColumnsPanel');
  if (!panel) return;
  const isHidden = panel.classList.contains('hidden');
  if (isHidden) {
    renderBulkColumnsGrid();
    panel.classList.remove('hidden');
  } else {
    panel.classList.add('hidden');
  }
}

function renderBulkColumnsGrid() {
  const grid = $('bulkColumnsGrid');
  if (!grid) return;
  const prefs = State.data?.settings?.bulkSheetColumns || {};
  grid.innerHTML = '';
  const allCols = [...ALL_BULK_COLS, ...(State.data?.settings?.customBulkColumns || [])];

  // Preset bar
  const bar = document.createElement('div');
  bar.className = 'bulk-col-presets';
  bar.innerHTML = `<span class="bulk-col-presets-label">Presets:</span>
    <button type="button" class="btn btn-ghost btn-xs" data-preset="temu" title="Columns needed by the Temu converter">Temu</button>
    <button type="button" class="btn btn-ghost btn-xs" data-preset="all">All</button>
    <button type="button" class="btn btn-ghost btn-xs" data-preset="minimal">Minimal</button>
    <span class="bulk-col-count"></span>`;
  bar.querySelectorAll('[data-preset]').forEach(btn => btn.addEventListener('click', async () => {
    const preset = btn.dataset.preset;
    const on = new Set(preset === 'all' ? allCols.map(c => c.key) : COLUMN_PRESETS[preset]);
    const newPrefs = {};
    allCols.forEach(c => { newPrefs[c.key] = on.has(c.key); });
    const updated = await msg({ action: 'UPDATE_SETTINGS', settings: { bulkSheetColumns: newPrefs } });
    if (updated?.success) { State.data.settings.bulkSheetColumns = newPrefs; renderBulkColumnsGrid(); toast(`Columns preset: ${preset}`, 'ok'); }
  }));
  grid.appendChild(bar);
  const onCount = allCols.filter(c => isColOn(c.key, prefs)).length;
  bar.querySelector('.bulk-col-count').textContent = `${onCount}/${allCols.length} on`;

  allCols.forEach(col => {
    const checked = isColOn(col.key, prefs);
    const item = document.createElement('label');
    item.className = 'bulk-col-toggle' + (checked ? ' on' : '');
    item.innerHTML = `
      <span class="bulk-col-checkbox"></span>
      <span class="bulk-col-label">${esc(col.label)}</span>`;
    item.addEventListener('click', async (e) => {
      e.preventDefault();
      const newPrefs = { ...prefs };
      newPrefs[col.key] = !isColOn(col.key, prefs); // flip
      // Persist
      const updated = await msg({
        action: 'UPDATE_SETTINGS',
        settings: { bulkSheetColumns: newPrefs }
      });
      if (updated?.success) {
        State.data.settings.bulkSheetColumns = newPrefs;
        renderBulkColumnsGrid();
      }
    });
    grid.appendChild(item);
  });
}

async function bulkDeleteMasterRows() {
  const ids = [...MasterUIState.selectedIds];
  if (ids.length === 0) return;

  // Get a few sample titles for the confirm dialog
  const rows = await getMasterRows();
  const samples = rows.filter(r => ids.includes(r.id)).slice(0, 3).map(r => trunc(r.title || '(untitled)', 40));
  const more = ids.length > 3 ? `\n  …and ${ids.length - 3} more` : '';
  const preview = samples.map(s => `  • ${s}`).join('\n');

  showConfirm(
    'Delete from Master Sheet',
    `Delete ${ids.length} product${ids.length === 1 ? '' : 's'} from Master Sheet?\n\n${preview}${more}\n\nThis cannot be undone.`,
    'Delete',
    async () => {
      const remaining = rows.filter(r => !ids.includes(r.id));
      await setMasterRows(remaining, rows);
      MasterUIState.selectedIds.clear();
      await updateMasterStats();
      toast(`Deleted ${ids.length} product${ids.length === 1 ? '' : 's'}`, 'ok');
    }
  );
}

// ── Quick Re-hunt ────────────────────────────────────────────
async function reHuntMasterRow(rowId) {
  const rows = await getMasterRows();
  const target = rows.find(r => r.id === rowId);
  if (!target) { toast('Row not found', 'err'); return; }

  // Visual feedback
  const rowEl = document.querySelector(`.master-row[data-id="${esc(rowId)}"]`);
  const rehuntBtn = rowEl?.querySelector('.master-row-rehunt');
  if (rowEl) rowEl.classList.add('rehunting');
  if (rehuntBtn) rehuntBtn.classList.add('spinning');

  toast(`Re-fetching: ${trunc(target.title, 30)}…`, 'info');

  let scraped = null;
  let newTab = null;
  try {
    // Open the URL in a NEW background tab (active: false to avoid focus shift)
    newTab = await chrome.tabs.create({ url: target.url, active: false });

    // Wait for the page to load (poll for status='complete' up to 10s)
    const waitLoad = async () => {
      for (let i = 0; i < 50; i++) {
        await new Promise(r => setTimeout(r, 200));
        try {
          const t = await chrome.tabs.get(newTab.id);
          if (t.status === 'complete') return;
        } catch { return; }
      }
    };
    await waitLoad();

    // For lazy-loaded sites (Faire, Sam's), briefly activate the tab
    const isLazy = /faire\.com|samsclub\.com|amazon\.|walmart\.com/i.test(target.url);
    if (isLazy) {
      try {
        await chrome.tabs.update(newTab.id, { active: true });
        await new Promise(r => setTimeout(r, 1200));
      } catch {}
    }

    // Inject content script (idempotent)
    try {
      await chrome.scripting.executeScript({ target: { tabId: newTab.id }, files: ['content.js'] });
    } catch {}
    await new Promise(r => setTimeout(r, 200));

    // Send scrape message with timeout
    scraped = await new Promise(resolve => {
      let done = false;
      const finish = (v) => { if (!done) { done = true; resolve(v); } };
      const t = setTimeout(() => finish(null), 18000);
      try {
        chrome.tabs.sendMessage(newTab.id, { action: 'SCRAPE_PAGE' }, (res) => {
          clearTimeout(t);
          if (chrome.runtime.lastError || !res?.success || !res?.data) finish(null);
          else finish(res.data);
        });
      } catch { finish(null); }
    });
  } catch (err) {
    // continue to cleanup
  } finally {
    if (newTab?.id) {
      try { await chrome.tabs.remove(newTab.id); } catch {}
    }
  }

  if (rowEl) rowEl.classList.remove('rehunting');
  if (rehuntBtn) rehuntBtn.classList.remove('spinning');

  if (!scraped) {
    toast('Re-hunt failed — try again later', 'err');
    return;
  }

  // Update the master row in place
  const updatedRows = rows.map(r => {
    if (r.id !== rowId) return r;
    return {
      ...r,
      title:        r.title,
      price:        scraped.price || r.price,
      ...zhLibraryPriceFields(scraped.price ? scraped : r),
      description:  r.description,
      variants:     Array.isArray(scraped.variants) ? scraped.variants.join(', ') : r.variants,
      imageCount:   Array.isArray(scraped.images) ? scraped.images.length : r.imageCount,
      videoCount:   Array.isArray(scraped.videos) ? scraped.videos.length : r.videoCount,
      images:       r.images,
      brand: scraped.brand || r.brand || '', color: scraped.color || r.color || '', weight: scraped.weight || r.weight || '',
      dimL: scraped.dimL || r.dimL || '', dimW: scraped.dimW || r.dimW || '', dimH: scraped.dimH || r.dimH || '',
      bullets:      r.bullets || [],
      _sourceFacts: zhCaptureSourceFacts(scraped),
      videos:       Array.isArray(scraped.videos) ? scraped.videos.slice(0, 4) : r.videos,
      status:       'ok',
      lastRehunted: new Date().toISOString()
    };
  });
  await setMasterRows(updatedRows, rows);
  await updateMasterStats();
  toast('✓ Updated with latest data', 'ok');
}

function renderMasterBatches(batches) {
  const list = $('masterBatchList');
  if (!list) return;
  if (!batches || batches.length === 0) {
    list.innerHTML = '<div class="rh-empty"><p>No hunts yet — Hunt some tabs first!</p></div>';
    return;
  }
  list.innerHTML = '';

  // Platform icon map
  const platIco = (platStr) => {
    const s = (platStr || '').toLowerCase();
    if (s.includes('walmart'))    return `<svg viewBox="0 0 24 24"><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z" fill="#0071CE"/></svg>`;
    if (s.includes('amazon'))     return `<svg viewBox="0 0 24 24"><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2z" fill="#FF9900"/></svg>`;
    if (s.includes('temu'))       return `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#FA5131"/></svg>`;
    if (s.includes('aliexpress')) return `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#E62E00"/></svg>`;
    if (s.includes('sams'))       return `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#0067A0"/></svg>`;
    return `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="rgba(0,229,255,0.4)"/></svg>`;
  };

  batches.slice(0, 20).forEach((b, idx) => {
    const d = new Date(b.date);
    const now = new Date();
    const diffMs = now - d;
    const diffH = Math.floor(diffMs / 3600000);
    const diffD = Math.floor(diffMs / 86400000);
    let timeAgo;
    if (diffH < 1)       timeAgo = 'Just now';
    else if (diffH < 24) timeAgo = `${diffH}h ago`;
    else if (diffD < 7)  timeAgo = `${diffD}d ago`;
    else timeAgo = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

    const timeExact = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const dateFull  = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const plats = (b.platforms || []).filter(Boolean);
    const platLabel = plats.length ? plats.join(' · ') : 'Mixed';
    const firstPlat = plats[0] || '';
    const isLatest = (idx === 0);
    const count = b.count || 0;

    const card = document.createElement('div');
    card.className = 'rh-card' + (isLatest ? ' rh-card-latest' : '');

    card.innerHTML = `
      <div class="rh-card-accent"></div>
      <div class="rh-plat-ico">${platIco(firstPlat)}</div>
      <div class="rh-card-body">
        <div class="rh-card-top">
          <span class="rh-date-chip" title="${dateFull} ${timeExact}">
            <svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            ${dateFull} · ${timeExact}
          </span>
          ${isLatest ? `<span class="rh-latest-chip">● Latest</span>` : `<span class="rh-ago">${timeAgo}</span>`}
        </div>
        <div class="rh-card-mid">
          <span class="rh-count">${count}</span>
          <span class="rh-count-lbl">product${count !== 1 ? 's' : ''}</span>
          <span class="rh-plat-tag">${esc(platLabel)}</span>
          ${b.label ? `<span class="rh-batch-lbl">${esc(b.label)}</span>` : ''}
        </div>
      </div>
      <button class="rh-view-btn" type="button" title="Filter these products in Library">
        <svg viewBox="0 0 24 24"><polyline points="22 3 2 3 10 12.5 10 19 14 21 14 12.5 22 3"/></svg>
        <span>Filter</span>
      </button>`;

    card.querySelector('.rh-view-btn')?.addEventListener('click', () => {
      // Switch to Library tab
      $('tab-btn-library')?.click();
      const clear = MasterUIState.filterBatchId === b.id;
      const matched = masterRowsForBatch(MasterUIState.allRows || [], b, MasterUIState.batches || batches);
      if (!clear && !matched.length) {
        toast('Is hunt ke saved products nahi mile. Library filter change nahi kiya.', 'warn');
        return;
      }
      MasterUIState.filterBatchId = clear ? null : b.id;
      MasterUIState.filterPlatform = 'all';
      MasterUIState.searchQuery = '';
      if ($('masterSearchInp')) $('masterSearchInp').value = '';
      document.querySelectorAll('#masterPlatBar .plat-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.plat === 'all'));
      document.querySelectorAll('#masterFilterChips .filter-chip:not(#compactModeToggle)').forEach(btn => btn.classList.toggle('active', btn.dataset.filter === 'all'));
      filterAndRenderMasterRows();
      toast(clear ? 'All Library products' : `Batch filter: ${matched.length} products`, 'info');
    });

    list.appendChild(card);
  });
}

async function resetMasterSheet() {
  showConfirm(
    'Reset Master Sheet',
    'Delete all master sheet data? This cannot be undone.',
    'Delete All',
    async () => {
      const reset = await msg({ action: 'MASTER_RESET' }); if (!reset?.success) throw new Error(reset?.error || 'Reset failed');
      await setMasterBatches([]);
      toast('Master sheet reset', 'ok');
      updateMasterStats();
    }
  );
}

// ── Filename helper ──────────────────────────────────────────
function buildFilename(ext, suffix = '') {
  const prefix = (State.data?.settings?.bulkFilenamePrefix || 'zhunter_').trim();
  const d = new Date();
  const ymd = d.toISOString().slice(0, 10);
  const hm = `${String(d.getHours()).padStart(2,'0')}${String(d.getMinutes()).padStart(2,'0')}`;
  return `${prefix}${ymd}_${hm}${suffix}.${ext}`;
}

// ── Sheet generation ─────────────────────────────────────────
// All possible columns. `defaultOn` matches background.js DEFAULT_DATA.settings.bulkSheetColumns.
const ALL_BULK_COLS = [
  { key: 'no',          label: '#'              },
  { key: 'title',       label: 'Title'          },
  { key: 'url',         label: 'Sourcing link'  },  // hyperlink
  { key: 'platform',    label: 'Platform'       },
  { key: 'brand',       label: 'Brand'          },
  { key: 'color',       label: 'Color'          },
  { key: 'price',       label: 'Price'          },  // numeric
  { key: 'labelCost',   label: 'Label Cost'     },  // empty for user
  { key: 'listPrice',   label: 'List Price'     },  // empty for user
  { key: 'profit',      label: 'Profit'         },  // formula
  { key: 'weight',      label: 'Weight'         },
  { key: 'dimL',        label: 'Length'         },
  { key: 'dimW',        label: 'Width'          },
  { key: 'dimH',        label: 'Height'         },
  { key: 'variants',    label: 'Variants'       },
  { key: 'imageCount',  label: 'Image Count'    },
  { key: 'videoCount',  label: 'Video Count'    },
  { key: 'videoUrl',    label: 'Video URL'      },
  { key: 'img1',        label: 'Image 1'        },
  { key: 'img2',        label: 'Image 2'        },
  { key: 'img3',        label: 'Image 3'        },
  { key: 'img4',        label: 'Image 4'        },
  { key: 'img5',        label: 'Image 5'        },
  { key: 'img6',        label: 'Image 6'        },
  { key: 'img7',        label: 'Image 7'        },
  { key: 'img8',        label: 'Image 8'        },
  { key: 'img9',        label: 'Image 9'        },
  { key: 'img10',       label: 'Image 10'       },
  { key: 'description', label: 'Description'    },
  { key: 'bullets',     label: 'Bullet Points'  },
  { key: 'tags',        label: 'Tags'           },
  { key: 'status',      label: 'Status'         },
  { key: 'scrapedAt',   label: 'Date Added'     }
];

// Columns that are OFF by default (must be explicitly enabled by user)
// Default sheet has only 3 columns: Title, Sourcing Link, Price
const OPT_IN_COLS = new Set([
  'no', 'platform', 'labelCost', 'listPrice', 'profit',
  'weight', 'dimL', 'dimW', 'dimH', 'variants',
  'imageCount', 'videoCount', 'videoUrl',
  'img1','img2','img3','img4','img5','img6','img7','img8','img9','img10',
  'description', 'tags', 'status', 'scrapedAt'
]);

// Columns ON by default (everything else is OFF unless user enables it)
// v8.4.0: default sheet is "Temu-ready" — everything the Temu converter needs.
const DEFAULT_ON_COLS = new Set(['no', 'title', 'url', 'platform', 'brand', 'color', 'price',
  'weight', 'dimL', 'dimW', 'dimH', 'img1','img2','img3','img4','img5','img6','img7','img8','img9','img10']);

// Column presets (Bulk → Columns panel)
const COLUMN_PRESETS = {
  temu:    [...DEFAULT_ON_COLS],
  minimal: ['title', 'url', 'price'],
  all:     null // filled at runtime = every column
};

// Single source of truth for "is this column on?" (used by picker AND export)
function isColOn(key, prefs) {
  if (prefs && prefs[key] === true)  return true;
  if (prefs && prefs[key] === false) return false;
  return DEFAULT_ON_COLS.has(key);
}

function getEnabledColumns() {
  const prefs = State.data?.settings?.bulkSheetColumns || {};
  const customCols = State.data?.settings?.customBulkColumns || [];
  const fullCols = [...ALL_BULK_COLS, ...customCols];
  const enabled = fullCols.filter(c => isColOn(c.key, prefs));

  // Safety: always return at least title, url, price
  return enabled.length ? enabled : fullCols.filter(c => DEFAULT_ON_COLS.has(c.key));
}

// Spreadsheet column letter from 0-based index. 0 → A, 25 → Z, 26 → AA
function colLetter(idx) {
  let s = '';
  let n = idx;
  while (n >= 0) {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  }
  return s;
}

// Strip currency symbols and commas, return number or empty string
function parsePriceNum(raw) {
  if (raw === null || typeof raw === 'undefined') return '';
  const s = String(raw).replace(/[^\d.]/g, '');
  if (!s || isNaN(parseFloat(s))) return '';
  return parseFloat(s);
}

function formatDateShort(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
  } catch { return ''; }
}

// Build a 2D representation of rows that includes both cell values AND
// hyperlink/formula metadata. The XLSX writer reads this rich form;
// the CSV writer flattens it.
function buildRichSheetData(rows) {
  const cols = getEnabledColumns();
  const header = cols.map(c => ({ value: c.label }));
  const out = [header];

  // ── Sort by originalIndex to match folder numbering ──
  // (remove platform-grouping sort — it mismatches folder numbers)
  const sortedRows = [...rows].sort((a, b) => (a.originalIndex ?? 0) - (b.originalIndex ?? 0));

  // Determine spreadsheet column letters for formula references
  const idxOf = {};
  cols.forEach((c, i) => { idxOf[c.key] = i; });

  sortedRows.forEach((r, rowIdx) => {
    const sheetRow = rowIdx + 2; // header is row 1 in spreadsheet

    const cellsByKey = {};

    cellsByKey.no       = { value: rowIdx + 1 };
    cellsByKey.title    = { value: r.title || '' };  // plain text, no hyperlink
    cellsByKey.url      = r.url
      ? { value: r.url, hyperlink: r.url, type: 'url' }
      : { value: '' };
    cellsByKey.platform = { value: r.platform || '' };
    cellsByKey.brand    = { value: r.brand || '' };
    cellsByKey.color    = { value: r.color || '' };
    cellsByKey.bullets  = { value: Array.isArray(r.bullets) ? r.bullets.join(' | ') : (r.bullets || '') };

    const priceNum = parsePriceNum(r.price);
    cellsByKey.price = priceNum === ''
      ? { value: r.price || '' }
      : { value: priceNum, type: 'price' };

    cellsByKey.labelCost = { value: '', type: 'price' }; // empty
    cellsByKey.listPrice = { value: '', type: 'price' }; // empty

    // Profit formula: =IF(<List>="","",<List>-<Source>-<Label>)
    // Only emit when all three columns are visible
    if (idxOf.listPrice !== undefined && idxOf.price !== undefined && idxOf.labelCost !== undefined) {
      const listCol  = colLetter(idxOf.listPrice)  + sheetRow;
      const priceCol = colLetter(idxOf.price)      + sheetRow;
      const labelCol = colLetter(idxOf.labelCost)  + sheetRow;
      cellsByKey.profit = {
        value: '',
        formula: `IF(OR(${listCol}="",${priceCol}=""),"", ${listCol}-${priceCol}-IF(${labelCol}="",0,${labelCol}))`,
        type: 'price'
      };
    } else {
      cellsByKey.profit = { value: '' };
    }

    cellsByKey.description = { value: r.description || '' };
    cellsByKey.tags        = { value: typeof r.tags === 'string' ? r.tags : (Array.isArray(r.tags) ? r.tags.join(', ') : '') };
    cellsByKey.variants    = { value: Array.isArray(r.variants) ? r.variants.join(', ') : (r.variants || '') };
    cellsByKey.imageCount  = { value: r.imageCount || (Array.isArray(r.images) ? r.images.length : 0) };
    cellsByKey.videoCount  = { value: r.videoCount || (Array.isArray(r.videos) ? r.videos.length : 0) };
    
    // New fields for Phase 1
    const numOr = v => (v !== '' && v !== null && v !== undefined && isFinite(Number(v))) ? Number(v) : (v || '');
    cellsByKey.weight      = { value: numOr(r.weight) };
    cellsByKey.dimL        = { value: numOr(r.dimL) };
    cellsByKey.dimW        = { value: numOr(r.dimW) };
    cellsByKey.dimH        = { value: numOr(r.dimH) };
    cellsByKey.videoUrl    = r.videoUrl ? { value: r.videoUrl, hyperlink: r.videoUrl, type: 'url' } : { value: '' };

    const imgs = Array.isArray(r.images) ? r.images : [];
    for (let i = 0; i < 10; i++) {
      const u = imgs[i] || '';
      cellsByKey[`img${i+1}`] = u ? { value: u, hyperlink: u, type: 'url' } : { value: '' };
    }

    cellsByKey.scrapedAt   = { value: formatDateShort(r.scrapedAt) };
    cellsByKey.status      = { value: r.status || '' };

    const sheetRowCells = cols.map(c => cellsByKey[c.key] || { value: '' });
    out.push(sheetRowCells);
  });

  return { aoa: out, cols };
}

// Shared helper — returns a styled XLSX array buffer (green header, alternating rows,
// hyperlinks, frozen row, autofilter). Used by both the direct download and Master ZIP.
function buildStyledXlsxBuffer(rows) {
  if (typeof XLSX === 'undefined') return null;
  const rich = buildRichSheetData(rows);
  const aoaPlain = rich.aoa.map(r => r.map(cell => {
    if (cell.formula) return { f: cell.formula, v: '' };
    return cell.value;
  }));
  const ws = XLSX.utils.aoa_to_sheet(aoaPlain, { cellDates: false });
  const header = rich.aoa[0];
  const statusColIdx = header.findIndex(c => String(c.value||'').toLowerCase() === 'status');
  const headerBorder = {
    top:    { style: 'thin', color: { rgb: '1A7A40' } },
    bottom: { style: 'thin', color: { rgb: '1A7A40' } },
    left:   { style: 'thin', color: { rgb: '1A7A40' } },
    right:  { style: 'thin', color: { rgb: '1A7A40' } }
  };
  const cellBorder = {
    top:    { style: 'thin', color: { rgb: 'D1D5DB' } },
    bottom: { style: 'thin', color: { rgb: 'D1D5DB' } },
    left:   { style: 'thin', color: { rgb: 'D1D5DB' } },
    right:  { style: 'thin', color: { rgb: 'D1D5DB' } }
  };
  rich.aoa.forEach((row, ri) => {
    const rowBg = ri > 0 ? (ri % 2 === 0 ? 'F2F2F2' : 'FFFFFF') : null;
    row.forEach((cell, ci) => {
      const ref = colLetter(ci) + (ri + 1);
      if (!ws[ref]) ws[ref] = { t: 's', v: cell.value };
      if (ri === 0) {
        ws[ref].s = {
          font:      { bold: true, color: { rgb: 'FFFFFF' }, sz: 11, name: 'Calibri' },
          fill:      { patternType: 'solid', fgColor: { rgb: '217346' } },
          alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
          border:    headerBorder
        };
        return;
      }
      ws[ref].s = {
        fill:      { patternType: 'solid', fgColor: { rgb: rowBg } },
        font:      { name: 'Calibri', sz: 11, color: { rgb: '1F2937' } },
        alignment: { vertical: 'top' },
        border:    cellBorder
      };
      if (cell.hyperlink) {
        ws[ref].l = { Target: cell.hyperlink, Tooltip: 'Open link' };
        ws[ref].s.font = { name: 'Calibri', sz: 11, color: { rgb: '0563C1' }, underline: true };
      }
      if (cell.formula) { ws[ref].f = cell.formula; ws[ref].t = 'n'; }
      if (cell.type === 'price') {
        ws[ref].z = '#,##0.00';
        ws[ref].s.alignment = { ...ws[ref].s.alignment, horizontal: 'right' };
      }
      if (typeof cell.value === 'number' && !cell.formula) ws[ref].t = 'n';
      if (ci === statusColIdx) {
        const sv = String(cell.value || '').toLowerCase();
        if      (sv.includes('ok') || sv === 'done')        ws[ref].s.font = { name: 'Calibri', sz: 11, color: { rgb: '16A34A' }, bold: true };
        else if (sv.includes('partial'))                    ws[ref].s.font = { name: 'Calibri', sz: 11, color: { rgb: 'D97706' }, bold: true };
        else if (sv.includes('fail') || sv.includes('err')) ws[ref].s.font = { name: 'Calibri', sz: 11, color: { rgb: 'DC2626' }, bold: true };
      }
    });
  });
  const widths = rich.aoa[0].map((_, ci) => {
    let maxLen = 8;
    rich.aoa.forEach(r => {
      const v = r[ci] && r[ci].value;
      const s = (v === '' || v === null || v === undefined) ? '' : String(v);
      if (s.length > maxLen) maxLen = s.length;
    });
    return { wch: Math.min(Math.max(maxLen + 2, 8), 60) };
  });
  ws['!cols'] = widths;
  ws['!views'] = [{ state: 'frozen', ySplit: 1, xSplit: 0, topLeftCell: 'A2' }];
  if (rich.aoa.length > 1) {
    const lastCol = colLetter(rich.aoa[0].length - 1);
    const lastRow = rich.aoa.length;
    ws['!autofilter'] = { ref: `A1:${lastCol}${lastRow}` };
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Products');
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx', cellStyles: true });
}

// XLSX with bold header, frozen top row, hyperlinks, currency format
function downloadXlsxRich(rich, filename) {
  if (typeof XLSX === 'undefined') {
    toast('XLSX library not loaded', 'err');
    return;
  }

  const aoaPlain = rich.aoa.map(r => r.map(cell => {
    if (cell.formula) return { f: cell.formula, v: '' };
    return cell.value;
  }));
  const ws = XLSX.utils.aoa_to_sheet(aoaPlain, { cellDates: false });

  const header = rich.aoa[0];
  const statusColIdx = header.findIndex(c => String(c.value||'').toLowerCase() === 'status');

  const headerBorder = {
    top:    { style: 'thin', color: { rgb: '1A7A40' } },
    bottom: { style: 'thin', color: { rgb: '1A7A40' } },
    left:   { style: 'thin', color: { rgb: '1A7A40' } },
    right:  { style: 'thin', color: { rgb: '1A7A40' } }
  };
  const cellBorder = {
    top:    { style: 'thin', color: { rgb: 'D1D5DB' } },
    bottom: { style: 'thin', color: { rgb: 'D1D5DB' } },
    left:   { style: 'thin', color: { rgb: 'D1D5DB' } },
    right:  { style: 'thin', color: { rgb: 'D1D5DB' } }
  };

  rich.aoa.forEach((row, ri) => {
    const rowBg = ri > 0 ? (ri % 2 === 0 ? 'F2F2F2' : 'FFFFFF') : null;

    row.forEach((cell, ci) => {
      const ref = colLetter(ci) + (ri + 1);
      if (!ws[ref]) ws[ref] = { t: 's', v: cell.value };

      if (ri === 0) {
        ws[ref].s = {
          font:      { bold: true, color: { rgb: 'FFFFFF' }, sz: 11 },
          fill:      { fgColor: { rgb: '00B050' } },
          alignment: { horizontal: 'center', vertical: 'center' },
          border: {
            top:    { style: 'medium', color: { rgb: '00B050' } },
            bottom: { style: 'medium', color: { rgb: '00B050' } },
            left:   { style: 'thin',   color: { rgb: '00B050' } },
            right:  { style: 'thin',   color: { rgb: '00B050' } },
          }
        };
        return;
      }

      ws[ref].s = {
        fill:      { patternType: 'solid', fgColor: { rgb: rowBg } },
        font:      { name: 'Calibri', sz: 11, color: { rgb: '1F2937' } },
        alignment: { vertical: 'top' },
        border:    cellBorder
      };

      if (cell.hyperlink) {
        ws[ref].l = { Target: cell.hyperlink, Tooltip: 'Open link' };
        ws[ref].s.font = { name: 'Calibri', sz: 11, color: { rgb: '0563C1' }, underline: true };
      }

      if (cell.formula) { ws[ref].f = cell.formula; ws[ref].t = 'n'; }

      if (cell.type === 'price') {
        ws[ref].z = '#,##0.00';   // no currency symbol
        ws[ref].s.alignment = { horizontal: 'right' };
      }

      if (typeof cell.value === 'number' && !cell.formula) ws[ref].t = 'n';

      if (ci === statusColIdx) {
        const sv = String(cell.value || '').toLowerCase();
        if      (sv.includes('ok') || sv === 'done')        ws[ref].s.font = { name: 'Calibri', sz: 11, color: { rgb: '16A34A' }, bold: true };
        else if (sv.includes('partial'))                    ws[ref].s.font = { name: 'Calibri', sz: 11, color: { rgb: 'D97706' }, bold: true };
        else if (sv.includes('fail') || sv.includes('err')) ws[ref].s.font = { name: 'Calibri', sz: 11, color: { rgb: 'DC2626' }, bold: true };
      }
    });
  });

  const widths = rich.aoa[0].map((_, ci) => {
    let maxLen = 8;
    rich.aoa.forEach(r => {
      const v = r[ci] && r[ci].value;
      const s = (v === '' || v === null || v === undefined) ? '' : String(v);
      if (s.length > maxLen) maxLen = s.length;
    });
    return { wch: Math.min(Math.max(maxLen + 2, 8), 60) };
  });
  ws['!cols'] = widths;
  ws['!views'] = [{ state: 'frozen', ySplit: 1, xSplit: 0, topLeftCell: 'A2' }];




  const wb = XLSX.utils.book_new();
  wb.Props = { Title: 'ZHunter Iras Catalog', Subject: 'Product hunt export', Author: 'ZHunter Iras', CreatedDate: new Date() };
  XLSX.utils.book_append_sheet(wb, ws, 'Products');
  zhSaveBlob(new Blob([XLSX.write(wb, { bookType: 'xlsx', type: 'array', cellStyles: true })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), filename);
}

// PDF Catalog - opens print dialog so user saves as PDF
function downloadPdfCatalog(rows, titleText) {
  if (!rows || rows.length === 0) { toast('No data to export', 'warn'); return; }

  const PLAT_COLOR = {
    'amazon':'#FFF3E0','walmart':'#E3F2FD',"sam's club":'#F3E5F5',
    'faire':'#E8F5E9','aliexpress':'#FBE9E7','alibaba':'#FBE9E7',
    'temu':'#E0F7FA','ebay':'#FFFDE7','etsy':'#FFF8E1',
    'daraz':'#FCE4EC','shein':'#FDE8F3',
  };
  function platColor(p) {
    const lp = (p||'').toLowerCase();
    for (const [k,v] of Object.entries(PLAT_COLOR)) if (lp.includes(k)) return v;
    return '#F5F5F5';
  }
  function escPdf(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  const cards = rows.map(r => {
    const bg = platColor(r.platform || r.category || '');
    const imgs = (r.imageUrls || r.images || []).slice(0,5).map(u =>
      '<a href="' + escPdf(u) + '" style="font-size:10px;color:#0563C1;word-break:break-all;display:block">' + escPdf(u) + '</a>'
    ).join('');
    return '<div class="card" style="background:' + bg + '">'
      + '<div class="card-header">'
      + (r.url ? '<a class="title" href="' + escPdf(r.url) + '">' + escPdf(r.title||r.url) + '</a>'
               : '<span class="title">' + escPdf(r.title||'Untitled') + '</span>')
      + '</div>'
      + '<div class="meta">'
      + (r.platform||r.category ? '<span class="badge">' + escPdf(r.platform||r.category) + '</span>' : '')
      + (r.price ? '<span class="price">' + escPdf(r.price) + '</span>' : '')
      + (r.scrapedAt ? '<span class="date">' + new Date(r.scrapedAt).toLocaleDateString() + '</span>' : '')
      + '</div>'
      + (r.description ? '<p class="desc">' + escPdf(r.description).slice(0,300) + (r.description.length>300?'...':'') + '</p>' : '')
      + (imgs ? '<div class="imgs"><strong>Images:</strong>' + imgs + '</div>' : '')
      + (r.videoUrl ? '<div class="vid"><strong>Video:</strong> <a href="' + escPdf(r.videoUrl) + '">' + escPdf(r.videoUrl) + '</a></div>' : '')
      + '</div>';
  }).join('');

  const html = '<!DOCTYPE html><html><head><meta charset="utf-8">'
    + '<title>' + escPdf(titleText||'ZHunter Iras Catalog') + '</title>'
    + '<style>'
    + 'body{font-family:Arial,sans-serif;font-size:12px;margin:20px;color:#111}'
    + 'h1{font-size:20px;margin-bottom:16px;color:#0E7490}'
    + '.card{border:1px solid #ccc;border-radius:6px;padding:14px 16px;margin-bottom:16px;page-break-inside:avoid}'
    + '.card-header{margin-bottom:6px}'
    + '.title{font-size:14px;font-weight:bold;color:#0563C1;text-decoration:none}'
    + '.meta{display:flex;gap:12px;align-items:center;margin-bottom:8px;flex-wrap:wrap}'
    + '.badge{background:#0E7490;color:#fff;border-radius:4px;padding:2px 8px;font-size:10px;font-weight:bold}'
    + '.price{font-weight:bold;color:#16A34A;font-size:13px}'
    + '.date{color:#666;font-size:10px}'
    + '.desc{margin:6px 0;color:#333;line-height:1.5}'
    + '.imgs{margin-top:6px}'
    + '.vid{margin-top:4px;font-size:10px;color:#555}'
    + '@media print{body{margin:10px}.card{border:1px solid #aaa}}'
    + '</style></head><body>'
    + '<h1>' + escPdf(titleText||'ZHunter Iras Catalog') + ' (' + rows.length + ' products)</h1>'
    + cards + '</body></html>';

  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const blobUrl = URL.createObjectURL(blob);
  const safeTitle = (titleText || 'catalog').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'catalog';
  const filename = 'zhunter-' + safeTitle + '-' + new Date().toISOString().slice(0,10) + '.html';

  if (typeof chrome !== 'undefined' && chrome.downloads) {
    chrome.downloads.download({ url: blobUrl, filename: filename, saveAs: false }, () => {
      setTimeout(() => URL.revokeObjectURL(blobUrl), 3000);
      toast('PDF catalog saved as HTML — open the file and press Ctrl+P to print/save as PDF', 'ok');
    });
  } else {
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(blobUrl), 3000);
    toast('PDF catalog saved — open the file and press Ctrl+P to print/save as PDF', 'ok');
  }
}

// CSV with =HYPERLINK() formulas (works in Google Sheets + Excel)
function downloadCsvRich(rich, filename) {
  const escapeCsv = (s) => {
    const v = String(s ?? '');
    if (v.includes(',') || v.includes('"') || v.includes('\n')) {
      return '"' + v.replace(/"/g, '""') + '"';
    }
    return v;
  };

  const lines = rich.aoa.map((row, ri) => row.map((cell, ci) => {
    if (ri === 0) return escapeCsv(cell.value);

    // Hyperlink as =HYPERLINK formula (Google Sheets + Excel both render)
    if (cell.hyperlink) {
      const target = cell.hyperlink.replace(/"/g, '""');
      const label  = String(cell.value || cell.hyperlink).replace(/"/g, '""');
      return `"=HYPERLINK(""${target}"",""${label}"")"`;
    }

    // Formula cell — output as Excel formula
    if (cell.formula) {
      return `"=${cell.formula.replace(/"/g, '""')}"`;
    }

    return escapeCsv(cell.value);
  }).join(','));

  const csv = lines.join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 3000);
}

function downloadBatchSheet(format) {
  const rows = BulkState.results
    .filter(r => r.status !== 'fail')
    .filter(r => (r.title && r.title.trim()) || (r.url && r.url.trim()))
    .sort((a, b) => (a.originalIndex ?? 0) - (b.originalIndex ?? 0));
  if (rows.length === 0) { toast('No data to download', 'warn'); return; }
  if (format !== 'xlsx') {
    toast('CSV export is disabled. Please download XLSX instead.', 'warn');
    return;
  }
  const rich = buildRichSheetData(rows);
  downloadXlsxRich(rich, buildFilename('xlsx'));
  toast(`Downloaded XLSX (${rows.length} products)`, 'ok');
}

async function copyMasterSheetToClipboard() {
  const rows = await getMasterRows();
  if (!rows.length) { toast('Master sheet is empty', 'warn'); return; }
  const rich = buildRichSheetData(rows);
  const tsv = rich.aoa.map(row => row.map(cell => {
    if (cell.hyperlink) return cell.hyperlink;
    if (cell.formula) return `=${cell.formula}`;
    return String(cell.value ?? '');
  }).join('\t')).join('\n');
  try {
    await navigator.clipboard.writeText(tsv);
    toast(`Copied ${rows.length} Master Sheet row(s) to clipboard`, 'ok');
  } catch (_) {
    toast('Clipboard permission denied. Download XLSX instead.', 'err');
  }
}

// ── Library import (CSV / XLSX / JSON backup) ────────────────
// Accepts: the Settings "Backup everything" JSON ({ masterSheet, batches }),
// a plain JSON array of rows, or a sheet with Title / Link / Price columns.
// v9.7.0: parser alag — Library import aur Temu "Import sheet" dono isay use karte hain
async function parseImportFile(file) {
  const name = (file.name || '').toLowerCase();
  const toRow = r => {
    const pick = (...keys) => { for (const k of keys) { const v = r[k]; if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim(); } return ''; };
    const url = pick('url', 'Link', 'link', 'URL', 'Product Link', 'Soursing link', 'Sourcing link');
    if (!/^https?:\/\//i.test(url)) return null;
    const basePx = pick('Base Price', 'base', 'temuBase', 'BasePrice');
    return {
      id: pick('id') || `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      batchId: pick('batchId') || null,
      title: pick('title', 'Product Title', 'Title', 'name') || url,
      url, platform: pick('platform', 'Platform') || bgPlatformGuess(url),
      brand: pick('brand', 'Brand'), color: pick('color', 'Color', 'Variant'),
      weight: pick('weight', 'Weight'), dimL: pick('dimL', 'Length'), dimW: pick('dimW', 'Width'), dimH: pick('dimH', 'Height'),
      bullets: Array.isArray(r.bullets) ? r.bullets : String(pick('bullets', 'Bullet Points')).split(' | ').filter(Boolean),
      price: pick('price', 'Price', 'Scraped Price') || basePx,
      ...zhLibraryPriceFields({ price: pick('price', 'Price', 'Scraped Price') || basePx, priceAmount: r.priceAmount, priceCurrency: r.priceCurrency, priceSymbol: r.priceSymbol }),
      temuBase: basePx,
      sourcingPrice: pick('sourcingPrice', 'Sourcing Price') || pick('price', 'Price', 'Scraped Price'),
      labelCost: pick('labelCost', 'Sourcing Price', 'Label Cost'), listPrice: pick('listPrice', 'List Price'),
      description: pick('description', 'Description'), tags: pick('tags', 'Tags'), variants: pick('variants', 'Variants'),
      imageCount: Number(pick('imageCount', 'Images')) || 0, videoCount: Number(pick('videoCount', 'Videos')) || 0,
      images: Array.isArray(r.images) ? r.images.slice(0, 10) : [...Array(10).keys()].map(i => pick(`img${i+1}`, `Image ${i+1}`)).filter(Boolean), videos: Array.isArray(r.videos) ? r.videos.slice(0, 4) : [],
      status: pick('status', 'Status') || 'ok', scrapedAt: pick('scrapedAt', 'Date') || new Date().toISOString(), lastRehunted: ''
    };
  };
  const bgPlatformGuess = u => { try { return new URL(u).hostname.replace(/^www\./, '').split('.')[0]; } catch { return ''; } };
  try {
    let rows = [], batches = null, rawCount = 0;
    if (name.endsWith('.json')) {
      const parsed = JSON.parse(await file.text());
      const list = Array.isArray(parsed) ? parsed : (parsed.masterSheet || parsed.rows || parsed.links || []);
      rawCount = list.length; rows = list.map(toRow).filter(Boolean);
      if (Array.isArray(parsed.batches)) batches = parsed.batches;
    } else if (name.endsWith('.csv') || name.endsWith('.tsv')) {
      if (typeof XLSX === 'undefined') throw new Error('Sheet library not loaded');
      const wb = XLSX.read(await file.text(), { type: 'string' });
      const raw = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' }); rawCount = raw.length; rows = raw.map(toRow).filter(Boolean);
    } else if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
      if (typeof XLSX === 'undefined') throw new Error('Sheet library not loaded');
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const raw = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' }); rawCount = raw.length; rows = raw.map(toRow).filter(Boolean);
    } else { toast('Use a .json, .csv or .xlsx file', 'warn'); return null; }
    if (!rows.length) { toast('No product rows with links found in that file', 'warn'); return null; }
    if (rawCount > rows.length) toast(`${rawCount - rows.length} row(s) chhor diye — un mein product link (URL) nahi tha`, 'warn');
    return { rows, batches };
  } catch (e) {
    toast('Import failed: ' + (e?.message || 'unreadable file'), 'err');
    return null;
  }
}
async function doImport(file) {
  if (/\.json$/i.test(file.name || '')) {
    try { const backup = JSON.parse(await file.text()); if (backup.format === 'zhunter-backup') {
      if (!confirm('Restore this complete backup? This replaces products, queue, history and store settings. Private connection keys stay unchanged.')) return;
      const result = await msg({ action: 'BACKUP_RESTORE', backup }); if (!result?.success) throw new Error(result?.error || 'Restore failed'); await refresh(); await updateMasterStats(); await loadBulkQueue(); toast('Backup restored', 'ok'); return;
    } } catch (e) { toast('Restore failed: ' + e.message, 'err'); return; }
  }
  const parsed = await parseImportFile(file);
  if (!parsed) return;
  const { rows, batches } = parsed;
  try {
    const existing = await getMasterRows();
    const seen = new Set(existing.map(r => (r.url || '').toLowerCase()));
    const fresh = rows.filter(r => !seen.has(r.url.toLowerCase()));
    await setMasterRows([...existing, ...fresh], existing);
    if (batches && batches.length) { const cur = await getMasterBatches(); await chrome.storage.local.set({ [BATCHES_KEY]: [...batches, ...cur].slice(0, 200) }); }
    await updateMasterStats();
    toast(`Imported ${fresh.length} product${fresh.length !== 1 ? 's' : ''}${rows.length - fresh.length ? ` (${rows.length - fresh.length} already in Library)` : ''}`, 'ok');
  } catch (e) {
    toast('Import failed: ' + (e?.message || 'unreadable file'), 'err');
  }
}

// ── Library → Master ZIP ─────────────────────────────────────
// Same layout as the bulk-hunt ZIP: products_sheet.xlsx + "Folder NN" per
// product with images and info.txt. Uses the selected rows if any are
// selected, otherwise every row in the Library. Images are re-fetched from
// their URLs (the Library only stores URLs, never image data).
async function downloadLibraryZip() {
  if (typeof JSZip === 'undefined') { toast('JSZip not loaded', 'err'); return; }
  const all = await getMasterRows();
  if (!all.length) { toast('Library is empty', 'warn'); return; }
  const picked = MasterUIState.selectedIds.size
    ? all.filter(r => MasterUIState.selectedIds.has(r.id))
    : all;
  if (!picked.length) { toast('Nothing selected', 'warn'); return; }

  const btn = $('masterExportMenuBtn');
  const originalLabel = btn ? btn.innerHTML : '';
  const setLabel = t => { if (btn) btn.textContent = t; };
  if (btn) btn.disabled = true;
  try {
    const zip = new JSZip();
    const rows = picked.map((r, i) => ({ ...r, originalIndex: i }));
    const xlsxBuf = buildStyledXlsxBuffer(rows);
    if (xlsxBuf) zip.file('products_sheet.xlsx', xlsxBuf);

    let fetched = 0;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      setLabel(`Images ${i + 1}/${rows.length}…`);
      const folder = zip.folder(`Folder ${String(i + 1).padStart(2, '0')}`);
      let b64s = [];
      const urls = (r.images || []).slice(0, 7);
      if (urls.length) {
        try {
          const res = await msg({ action: 'FETCH_BASE64_BATCH', urls });
          if (res?.success && Array.isArray(res.results)) b64s = res.results.filter(x => x?.success && x.base64).map(x => x.base64);
        } catch (_) {}
      }
      fetched += b64s.length;
      folder.file('info.txt', [
        `Title:       ${r.title || '(none)'}`,
        `URL:         ${r.url}`,
        `Platform:    ${r.platform || ''}`,
        `Price:       ${r.price || ''}`,
        `Scraped:     ${r.scrapedAt ? new Date(r.scrapedAt).toLocaleString() : ''}`,
        `Images:      ${b64s.length}`,
        `Videos:      ${r.videos?.length || 0}`,
        '',
        'Description:',
        r.description || '(none)',
        '',
        'Video URLs:',
        ...(r.videos || []).map(v => '  - ' + v)
      ].join('\n'));
      if (b64s.length) {
        b64s.forEach((b64, ii) => {
          try { folder.file(`img_${String(ii + 1).padStart(2, '0')}.${extFromBase64(b64)}`, base64ToBytes(b64)); } catch (_) {}
        });
      } else if (urls.length) {
        folder.file('image_urls.txt', urls.join('\n'));
      }
    }

    setLabel('Building ZIP…');
    const blob = await zip.generateAsync(
      { type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 3 } },
      m => setLabel(`Building ZIP… ${Math.round(m.percent)}%`)
    );
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = buildFilename('zip', '_library');
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 200);
    toast(`Library ZIP: ${rows.length} products, ${fetched} images`, 'ok');
  } catch (e) {
    toast('ZIP build failed: ' + (e?.message || ''), 'err');
  } finally {
    if (btn) { btn.innerHTML = originalLabel; btn.disabled = false; }
    updateMasterStats();
  }
}

async function downloadMasterSheet(format) {
  const rows = await getMasterRows();
  if (rows.length === 0) { toast('Master sheet is empty', 'warn'); return; }
  if (format === 'pdf') {
    downloadPdfCatalog(rows, 'Master Catalog');
    return;
  }
  const rich = buildRichSheetData(rows);
  if (format === 'xlsx') {
    downloadXlsxRich(rich, buildFilename('xlsx', '_master'));
  } else if (format === 'csv') {
    downloadCsvRich(rich, buildFilename('csv', '_master'));
  } else if (format === 'html') {
    downloadHtmlCatalog(rich, buildFilename('html', '_master'), 'Master Catalog');
  } else { return; }
  toast('Master ' + format.toUpperCase() + ' downloaded (' + rows.length + ' rows)', 'ok');
}

function downloadBatchHtmlCatalog() {
  const rows = BulkState.results
    .filter(r => r.status !== 'fail')
    .sort((a, b) => (a.originalIndex ?? 0) - (b.originalIndex ?? 0));
  if (rows.length === 0) { toast('No data to export', 'warn'); return; }
  const rich = buildRichSheetData(rows);
  downloadHtmlCatalog(rich, buildFilename('html'), 'Bulk Hunt Catalog');
  toast(`Downloaded HTML catalog (${rows.length} products)`, 'ok');
}

// Build a self-contained HTML catalog with table view + Copy-as-Sheet button.
// Uses SAME column structure as XLSX/CSV (consistent across formats).
function downloadHtmlCatalog(rich, filename, titleText) {
  const cols = rich.cols;
  const dataRows = rich.aoa.slice(1); // skip header

  // Build TSV (tab-separated) for clipboard — pastes cleanly into Google Sheets
  const tsvLines = [];
  tsvLines.push(rich.aoa[0].map(c => String(c.value || '')).join('\t'));
  dataRows.forEach((row) => {
    const cells = row.map(cell => {
      // For copy: prefer URL hyperlink as =HYPERLINK formula too
      if (cell.hyperlink) {
        return `=HYPERLINK("${cell.hyperlink}","${String(cell.value || '').replace(/"/g, "'")}")`;
      }
      if (cell.formula) {
        return `=${cell.formula}`;
      }
      return String(cell.value ?? '');
    });
    tsvLines.push(cells.join('\t'));
  });
  const tsvData = tsvLines.join('\n').replace(/`/g, '\\`'); // safe for template literal

  // Build HTML table cells
  const headerHtml = rich.aoa[0].map(c => `<th>${esc(c.value)}</th>`).join('');
  const bodyHtml = dataRows.map(row => {
    const cells = row.map((cell, ci) => {
      const colKey = cols[ci]?.key;
      let val = '';
      if (cell.hyperlink) {
        val = `<a href="${esc(cell.hyperlink)}" target="_blank" rel="noopener" class="cell-link">${esc(cell.value || cell.hyperlink)}</a>`;
      } else if (cell.formula) {
        val = `<span class="cell-formula" title="Auto-formula in XLSX/CSV">—</span>`;
      } else {
        const text = (cell.value === '' || cell.value === null || typeof cell.value === 'undefined') ? '' : String(cell.value);
        val = esc(text);
      }
      const classes = ['cell'];
      if (colKey === 'profit' || colKey === 'price' || colKey === 'listPrice' || colKey === 'labelCost') classes.push('cell-numeric');
      if (colKey === 'description') classes.push('cell-description');
      return `<td class="${classes.join(' ')}">${val}</td>`;
    }).join('');
    return `<tr>${cells}</tr>`;
  }).join('');

  const totalProducts = dataRows.length;
  const dateStr = new Date().toLocaleString();

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>ZHunter — ${esc(titleText)}</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #050816; color: #e2e8f0; padding: 24px; }
.container { max-width: 1400px; margin: 0 auto; }
.header { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 14px; padding-bottom: 18px; border-bottom: 1px solid rgba(6,182,212,0.20); margin-bottom: 22px; }
.header h1 { font-size: 22px; font-weight: 800; background: linear-gradient(135deg, #06b6d4, #67e8f9); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
.header .subtitle { font-size: 12px; color: #64748b; margin-top: 4px; }
.actions { display: flex; gap: 10px; }
.btn { padding: 10px 16px; border-radius: 8px; border: 1px solid rgba(6,182,212,0.32); background: rgba(6,182,212,0.10); color: #67e8f9; font-size: 13px; font-weight: 700; cursor: pointer; transition: all 0.2s; }
.btn:hover { background: linear-gradient(135deg, #06b6d4, #0891b2); color: #050816; box-shadow: 0 0 20px rgba(6,182,212,0.45); }
.btn.copied { background: #10b981; color: white; border-color: #10b981; }
.table-wrap { overflow-x: auto; background: #0a1020; border: 1px solid rgba(6,182,212,0.15); border-radius: 12px; padding: 0; }
table { width: 100%; border-collapse: collapse; font-size: 12px; }
thead { background: linear-gradient(135deg, #0e7490, #06b6d4); position: sticky; top: 0; z-index: 5; }
thead th { padding: 12px 14px; text-align: left; color: white; font-weight: 800; letter-spacing: 0.04em; font-size: 11px; text-transform: uppercase; border-right: 1px solid rgba(255,255,255,0.10); white-space: nowrap; }
thead th:last-child { border-right: none; }
tbody tr { border-bottom: 1px solid rgba(148,163,184,0.06); transition: background 0.15s; }
tbody tr:hover { background: rgba(6,182,212,0.04); }
tbody tr:nth-child(even) { background: rgba(255,255,255,0.012); }
tbody tr:nth-child(even):hover { background: rgba(6,182,212,0.06); }
tbody td { padding: 10px 14px; color: #cbd5e1; vertical-align: top; max-width: 280px; }
.cell-link { color: #67e8f9; text-decoration: none; border-bottom: 1px dashed rgba(103,232,249,0.40); }
.cell-link:hover { color: #06b6d4; border-bottom-color: #06b6d4; }
.cell-numeric { text-align: right; font-variant-numeric: tabular-nums; color: #67e8f9; font-weight: 600; }
.cell-formula { color: #475569; font-style: italic; font-size: 10px; }
.cell-description { font-size: 11px; color: #94a3b8; max-width: 360px; line-height: 1.5; }
.footer { margin-top: 30px; padding-top: 16px; border-top: 1px solid rgba(6,182,212,0.10); font-size: 11px; color: #475569; text-align: center; }
@media print { body { background: white; color: black; } .actions { display: none; } thead { background: #0e7490; } }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <div>
      <h1>🛍️ ZHunter — ${esc(titleText)}</h1>
      <div class="subtitle">${totalProducts} product${totalProducts === 1 ? '' : 's'} · Generated ${esc(dateStr)}</div>
    </div>
    <div class="actions">
      <button class="btn" id="copySheetBtn" type="button">📋 Copy as Sheet</button>
      <button class="btn" onclick="window.print()" type="button">🖨 Print</button>
    </div>
  </div>

  <div class="table-wrap">
    <table>
      <thead><tr>${headerHtml}</tr></thead>
      <tbody>${bodyHtml}</tbody>
    </table>
  </div>

  <div class="footer">
    Generated by ZHunter Iras · Click "Copy as Sheet" then paste into Google Sheets / Excel
  </div>
</div>

<script>
(function() {
  var TSV_DATA = \`${tsvData}\`;
  document.getElementById('copySheetBtn').addEventListener('click', function() {
    var btn = this;
    var origText = btn.textContent;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(TSV_DATA).then(function() {
        btn.classList.add('copied');
        btn.textContent = '✓ Copied! Paste into Sheets';
        setTimeout(function() { btn.classList.remove('copied'); btn.textContent = origText; }, 2500);
      }).catch(function() { fallbackCopy(); });
    } else { fallbackCopy(); }
    function fallbackCopy() {
      var ta = document.createElement('textarea');
      ta.value = TSV_DATA;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); btn.classList.add('copied'); btn.textContent = '✓ Copied!'; setTimeout(function() { btn.classList.remove('copied'); btn.textContent = origText; }, 2500); }
      catch (e) { btn.textContent = '✗ Copy failed'; }
      document.body.removeChild(ta);
    }
  });
})();
</script>
</body>
</html>`;

  const blob = new Blob([html], { type: 'text/html;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 3000);
}

// Legacy helpers kept as thin wrappers for ZIP generator
function buildSheetData(rows, includeColumns = null) {
  const rich = buildRichSheetData(rows);
  return rich.aoa.map(r => r.map(cell => cell.value));
}

function downloadXlsxFromAOA(aoa, filename) {
  // Used only by ZIP — minimal version
  if (typeof XLSX === 'undefined') return;
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const widths = aoa[0].map((_, ci) => {
    const maxLen = aoa.reduce((m, row) => Math.max(m, String(row[ci] || '').length), 0);
    return { wch: Math.min(Math.max(maxLen + 2, 8), 60) };
  });
  ws['!cols'] = widths;
  ws['!freeze'] = { xSplit: 0, ySplit: 1 };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Products');
  zhSaveBlob(new Blob([XLSX.write(wb, { bookType: 'xlsx', type: 'array', cellStyles: true })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), filename);
}

function downloadCsvFromAOA(aoa, filename) {
  const lines = aoa.map(row =>
    row.map(cell => {
      const s = String(cell ?? '');
      if (s.includes(',') || s.includes('"') || s.includes('\n')) {
        return '"' + s.replace(/"/g, '""') + '"';
      }
      return s;
    }).join(',')
  );
  const csv = lines.join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 3000);
}

// ── ZIP generation (Master ZIP) ──────────────────────────────
function safeSlug(s, max = 30) {
  return String(s || 'product')
    .replace(/[^a-zA-Z0-9 _-]/g, '')
    .trim()
    .slice(0, max)
    .replace(/\s+/g, '_') || 'product';
}

function extFromBase64(b64) {
  if (!b64) return 'jpg';
  if (b64.startsWith('data:image/png'))  return 'png';
  if (b64.startsWith('data:image/webp')) return 'webp';
  if (b64.startsWith('data:image/gif'))  return 'gif';
  if (b64.startsWith('data:image/avif')) return 'avif';
  return 'jpg';
}

function base64ToBytes(b64) {
  const comma = b64.indexOf(',');
  const data = comma >= 0 ? b64.slice(comma + 1) : b64;
  const bin = atob(data);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function downloadBatchZip() {
  if (typeof JSZip === 'undefined') { toast('JSZip not loaded', 'err'); return; }
  // Sort by originalIndex so Folder 01 == Sheet Row 1 == original tab order
  const rows = BulkState.results
    .filter(r => r.status !== 'fail')
    .sort((a, b) => (a.originalIndex ?? 0) - (b.originalIndex ?? 0));
  if (rows.length === 0) { toast('No data to ZIP', 'warn'); return; }

  const btn = $('bulkDlZipBtn');
  if (btn) { btn.disabled = true; btn.querySelector('.bulk-dl-text').textContent = 'Building ZIP…'; }

  try {
    const zip = new JSZip();

    // Styled XLSX — same green header as standalone XLSX download
    const xlsxBuf = buildStyledXlsxBuffer(rows);
    if (xlsxBuf) zip.file('products_sheet.xlsx', xlsxBuf);


    // Per-product folders — preserve ORIGINAL scraping order so Folder 01
    // always matches the first tab the user hunted (not a platform-sorted shuffle).
    // Users compare folders against their open tabs in order, so order matters.
    // Per-product folders — named by product title and numbered in scraping order
    rows.forEach((r, i) => {
      const idx = String(i + 1).padStart(2, '0');
      const cleanTitle = (r.title || 'Product')
        .replace(/[<>:"/\\|?*\x00-\x1F]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 50) || 'Product';
      const folderName = `${idx} - ${cleanTitle}`;
      const folder = zip.folder(folderName);

      // Info file
      const info = [
        `Title:       ${r.title || '(none)'}`,
        `URL:         ${r.url}`,
        `Platform:    ${r.platform || ''}`,
        `Price:       ${r.price || ''}`,
        `Status:      ${r.status}`,
        `Scraped:     ${new Date(r.scrapedAt).toLocaleString()}`,
        `Images:      ${r.imagesBase64?.length || 0}`,
        `Videos:      ${r.videos?.length || 0}`,
        ``,
        `Description:`,
        r.description || '(none)',
        ``,
        `Video URLs:`,
        ...(r.videos || []).map(v => '  - ' + v)
      ].join('\n');
      folder.file('info.txt', info);

      // Images — write base64 if available, otherwise note missing
      if (r.imagesBase64 && r.imagesBase64.length > 0) {
        r.imagesBase64.forEach((b64, ii) => {
          const ext = extFromBase64(b64);
          const num = String(ii + 1).padStart(2, '0');
          try {
            folder.file(`image_${num}.${ext}`, base64ToBytes(b64));
          } catch (_) {}
        });
      } else if (r.images && r.images.length > 0) {
        // If base64 conversion failed, save raw URLs in a txt so user can re-download manually
        folder.file('image_urls.txt', r.images.join('\n'));
      }
    });

    // Failed list
    const failed = BulkState.results.filter(r => r.status === 'fail');
    if (failed.length > 0) {
      const failedTxt = failed.map(r => `${r.url}  →  ${r.error || 'failed'}`).join('\n');
      zip.file('FAILED_URLS.txt', failedTxt);
    }

    // Generate ZIP blob (use chunked compression for memory)
    const blob = await zip.generateAsync(
      { type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 3 } },
      (m) => {
        if (btn) btn.querySelector('.bulk-dl-text').textContent = `Building ZIP… ${Math.round(m.percent)}%`;
      }
    );

    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = buildFilename('zip');
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 200);
    toast(`ZIP downloaded (${rows.length} products)`, 'ok');
  } catch (e) {
    toast('ZIP build failed: ' + (e?.message || ''), 'err');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.querySelector('.bulk-dl-text').textContent = 'Download Master ZIP';
    }
  }
}

// ── Sequential image download (browser native) ───────────────
async function downloadBatchSequential() {
  const rows = BulkState.results.filter(r =>
    r.status !== 'fail' && r.imagesBase64?.length > 0
  );
  if (rows.length === 0) { toast('No images to download', 'warn'); return; }

  let total = 0;
  rows.forEach(r => total += r.imagesBase64.length);

  showConfirm(
    'Download Images Sequentially',
    `Download ${total} images one by one? The browser may ask for download permission.`,
    `Download ${total} Images`,
    async () => {
      const btn = $('bulkDlSeqBtn');
      if (btn) { btn.disabled = true; }
      let saved = 0;

      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const idx = String(i + 1).padStart(2, '0');
        const baseName = `Folder ${idx}`;

        for (let ii = 0; ii < r.imagesBase64.length; ii++) {
          const ext = extFromBase64(r.imagesBase64[ii]);
          const num = String(ii + 1).padStart(2, '0');
          const a = document.createElement('a');
          a.href = r.imagesBase64[ii];
          a.download = `${baseName}_img_${num}.${ext}`;
          a.style.display = 'none';
          document.body.appendChild(a);
          a.click();
          setTimeout(() => a.remove(), 50);
          saved++;
          if (btn) btn.querySelector('.bulk-dl-text').textContent = `${saved}/${total}…`;
          await sleep(300);
        }
      }

      if (btn) {
        btn.disabled = false;
        btn.querySelector('.bulk-dl-text').textContent = 'Sequential';
      }
      toast(`Downloaded ${saved} images`, 'ok');
    }
  );
}

async function exportImagesAsZip(products) {
  const zip = new JSZip();
  const btn = document.getElementById('bulkZipBtn');
  const btnLabel = btn?.querySelector('.bulk-dl-text') || btn;
  if (btnLabel) btnLabel.textContent = 'Creating ZIP…';
  btn.disabled = true;

  for (const product of products) {
    // Clean folder name
    const folderName = (product.title || 'product')
      .replace(/[^a-zA-Z0-9\s-]/g, '')
      .trim()
      .substring(0, 50);
    
    const folder = zip.folder(folderName);
    const urls = product.imageUrls || product.images || [];
    
    for (let i = 0; i < urls.length; i++) {
      try {
        const response = await fetch(urls[i]);
        const blob = await response.blob();
        const ext = urls[i].includes('.png') ? 'png' : 'jpg';
        folder.file(`image_${i + 1}.${ext}`, blob);
      } catch(e) {
        console.log('Image fetch failed:', urls[i]);
      }
    }
  }

  const content = await zip.generateAsync({ type: 'blob' });
  const date = new Date().toISOString().slice(0,10);
  const url = URL.createObjectURL(content);
  const a = document.createElement('a');
  a.href = url;
  a.download = `zhunter_images_${date}.zip`;
  a.click();
  URL.revokeObjectURL(url);

  if (btnLabel) btnLabel.textContent = 'Images only';
  btn.disabled = false;
}

document.getElementById('bulkZipBtn')
  ?.addEventListener('click', () => {
    const products = BulkState.results.filter(r => r.status !== 'fail');
    exportImagesAsZip(products);
  });

// ══════════════════════════════════════════════════════════════
// IMAGES TAB — Temu Image Downloader
// Scans the active page for product images (>=100×100px),
// lets the user select them in a 3-column grid, then downloads
// each as a square-cropped PNG or JPG ready for Temu upload.
// ══════════════════════════════════════════════════════════════

// ── State ─────────────────────────────────────────────────────
const ImgState = {
  images: [],      // [{ src, w, h, role?, quality? }]
  selected: new Set(), // indices
  minSize: 0,      // 0 = all, 200 = >=200px, 500 = >=500px
  roleFilter: 'all' // 'all' | 'hero' | 'gallery' | 'variant' | 'lifestyle' | 'unknown'
};

// ── Inject into active tab via chrome.scripting ───────────────
async function scanPageImages() {
  const grid    = $('imgGrid');
  const scanner = $('imgScanningState');
  const countEl = $('imgFoundCount');

  if (!grid) return;

  grid.style.display = 'none';
  scanner?.classList.remove('hidden');
  setImgStatus('Hunting product images…', 'info');

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
      scanner?.classList.add('hidden');
      grid.style.display = '';
      showImgEmpty('Navigate to a product page on Amazon, Walmart, or Sam\'s Club first.');
      setImgStatus('', '');
      return;
    }

const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const isAmz = location.hostname.includes('amazon');
        const isWal = location.hostname.includes('walmart');
        const isSam = location.hostname.includes('samsclub');
        const isWgs = location.hostname.includes('worldwidegolf');
        const isTemu = location.hostname.includes('temu.');
        const isBjs = location.hostname.includes('bjs.com');

        let images = [];

        if (isAmz) {
          // ── amzStrip: strip ALL Amazon CDN size/quality tokens ────────────────
          // Returns the BARE URL with no size token at all.
          // This is exactly what Amazon's "Click to see full view" lightbox uses —
          // the bare URL serves the full original image at whatever resolution the
          // seller uploaded (could be 2000×2000, 3000×3000, etc.).
          // e.g. .../I/91XXXXX._AC_SL500_.jpg → .../I/91XXXXX.jpg (full original!)
          const amzStrip = (url) => {
            if (!url) return '';
            if (!url.includes('media-amazon.com') && !url.includes('images-amazon.com')) return url;
            let u = url.split('?')[0];
            let prev = '';
            while (u !== prev) { prev = u; u = u.replace(/\._[A-Z0-9_,]{2,}_\./i, '.'); }
            return u.replace(/\.{2,}/g, '.');
          };

          // Dedup by Amazon image ID + reject obvious thumbnails
          const seenIds = new Set();
          const addImg = (url, keepBare) => {
            if (!url || !url.startsWith('http')) return;
            // Reject thumbnail-sized Amazon URLs (small token = tiny image)
            // e.g. ._AC_SR38,50_. (38x50px) or ._SX48_. (48px) etc.
            if (/\._[A-Z]{2,}_S[RXY]\d{1,3}[,_]/i.test(url)) return;
            if (/\._S[XY]\d{1,3}_\./i.test(url)) return; // _SX48_, _SY60_ etc.
            const final = keepBare ? amzStrip(url) || url : url;
            const m = final.match(/\/images\/I\/([A-Za-z0-9+/]+=*)/);
            const id = m ? m[1] : final;
            if (seenIds.has(id)) return;
            seenIds.add(id);
            images.push(final);
          };

          // Upgrade a 'large' URL to ._AC_SL1500_. (reliable 500-1500px CDN version)
          // NOTE: 'large' image IDs are stored as 500px source files.
          // Stripping their token gives the same 500px. But ._AC_SL1500_. asks Amazon
          // for the best it can serve up to 1500px, which is more reliable.
          const amzUpgrade = (url) => {
            if (!url) return url;
            const bare = amzStrip(url);
            return bare.replace(/\.(jpg|jpeg|png|webp|gif|avif)$/i, '._AC_SL1500_.$1');
          };

          // ── Strategy 1: Initial gallery array from scripts ───────────────────
          let foundInitial = false;
          for (let script of document.querySelectorAll('script:not([src])')) {
            const t = script.textContent || '';
            if (!t.includes('colorImages') && !t.includes('ImageBlockATF')) continue;
            try {
              const ci = t.indexOf('colorImages');
              const ii = ci >= 0 ? t.indexOf('initial', ci) : t.indexOf('initial');
              const ab = ii >= 0 ? t.indexOf('[', ii) : -1;
              if (ab >= 0 && ab - ii < 30) {
                let depth = 0, end = -1;
                for (let i = ab; i < t.length && i < ab + 400000; i++) {
                  const ch = t[i];
                  if (ch === '[') depth++;
                  else if (ch === ']') { depth--; if (depth === 0) { end = i; break; } }
                }
                if (end > ab) {
                  const rawArr = t.slice(ab, end + 1);
                  let items = null;
                  try { items = JSON.parse(rawArr); } catch (_) {
                    try { items = JSON.parse(rawArr.replace(/\\"/g, '"').replace(/\\\\/g, '\\')); } catch (_) {}
                  }
                  if (Array.isArray(items) && items.length) {
                    items.forEach(it => {
                      const url = (it.hiRes && it.hiRes !== 'null') ? it.hiRes : (it.large || (it.main && Object.keys(it.main)[0]) || null);
                      if (url) addImg(amzUpgrade(url), false);
                    });
                    if (images.length > 0) {
                      foundInitial = true;
                      break;
                    }
                  }
                }
              }
            } catch (e) {
              console.error("Error parsing ImageBlockATF", e);
            }
          }

          // ── Strategy 2: Clean DOM Gallery Fallback (no duplicate thumbnails) ──
          if (!foundInitial) {
            // First check landingImage
            const landingImage = document.getElementById('landingImage');
            if (landingImage) {
              const dataOldHires = landingImage.getAttribute('data-old-hires');
              if (dataOldHires) addImg(amzUpgrade(dataOldHires), false);
              else if (landingImage.src && !landingImage.src.startsWith('data:')) addImg(amzUpgrade(landingImage.src), false);
            }
            // Next check thumbnails excluding videos
            const altImages = document.querySelectorAll('#altImages li:not(.video-item) img, .imageThumbnail:not(.video-item) img');
            altImages.forEach(img => {
              if (img.closest('.video-item') || /play[-_]?button|video[-_]?thumbnail/i.test(img.src || '')) return;
              const hires = img.getAttribute('data-old-hires') || img.getAttribute('data-zoom-image') || '';
              if (hires) addImg(amzUpgrade(hires), false);
              else if (img.src && !img.src.startsWith('data:')) addImg(amzUpgrade(img.src), false);
            });
          }

        } else if (isWal) {
          // Walmart: Only left thumbnail strip selectors - ignore logos
          const imgs = document.querySelectorAll('[data-testid="vertical-carousel-container"] img, [data-testid="media-thumbnail"] img');
          imgs.forEach(img => {
            let src = img.src || img.srcset?.split(' ')[0];
            if (!src) return;
            src = src.split('?')[0];
            images.push(src);
          });
        } else if (isSam) {
          // Sam's Club: Only left thumbnail strip selectors - ignore samsclub.com/content/dam/logos
          const imgs = document.querySelectorAll('[data-testid="item-page-vertical-carousel-hero-image-button"] img, [data-seo-id="hero-carousel-image"] img, [data-testid="media-thumbnail"] img');
          imgs.forEach(img => {
            let src = img.src || img.srcset?.split(' ')[0];
            if (!src) return;
            if (src.includes('samsclub.com/content/dam/logos')) return;
            src = src.split('?')[0]; // Strip ?odnHeight=117 parameters to get full size
            images.push(src);
          });
        } else if (isWgs) {
          document.querySelectorAll('img').forEach(img => {
            let src = img.getAttribute('data-src') || img.getAttribute('data-zoom-image') || img.src || '';
            if (!src || !src.startsWith('http')) return;
            if (/logo|icon|badge|sprite|nav|header|footer|payment|trust|related|recommend/i.test(src)) return;

            // EXCLUDE related products / shelves explicitly (VTEX uses product-summary and shelf)
            if (img.closest('[class*="product-summary"], [class*="shelf"], [class*="related"], [class*="recommend"]')) return;

            const isGallery = img.closest('[class*="productImages"], [class*="carouselGallery"], .product__media-wrapper, .product-single__photos, [class*="product-gallery"], [class*="ProductGallery"], .product-images, .product__images, [class*="product-media"], .product-photo-container');
            const hasClass = /productImage|carouselThumb|productImageTag|thumbGridImg/i.test(img.className || '');
            const parentHasClass = /productImage|carouselThumb/i.test((img.parentElement && img.parentElement.className) || '');
            
            if (!isGallery && !hasClass && !parentHasClass) return;

            // Upsize Shopify thumbnails
            let large = src.replace(/_(\d+)x(\d+)(\.[a-z]+)(\?|$)/i, '_1200x$3$4')
                           .replace(/_(\d+)x(\.[a-z]+)(\?|$)/i, '_1200x$2$3');
            
            // Upsize VTEX thumbnails and STRIP query parameters to prevent duplicates!
            if (large.includes('.vtexassets.com/arquivos/ids/')) {
              const idMatch = large.match(/\/ids\/(\d+)/);
              if (idMatch) large = `https://worldwidegolf.vtexassets.com/arquivos/ids/${idMatch[1]}`;
            }
            large = large.split('?')[0];
            images.push(large);
          });
        } else if (isTemu) {
          // Temu: target main gallery thumbnails and swiper images, ignore recommendations & seller icons
          const galleryImgs = document.querySelectorAll(
            '._2AOclWz7 img, ._2xl9aIvl img, [class*="_22_BWn2A"] img, [class*="_18lG-4NT"] img, ' +
            '[role="listbox"] img, [class*="goods-gallery"] img, [class*="GoodsGallery"] img'
          );
          const scope = galleryImgs.length ? galleryImgs : document.querySelectorAll('img[src*="kwcdn.com/local-goods-image/"], img[data-src*="kwcdn.com/local-goods-image/"]');
          scope.forEach(img => {
            if (img.closest('#goodsRecommend, [id*="Recommend"], .js-goods-list, [class*="Recommend"]')) return;
            let src = img.getAttribute('data-src') || img.currentSrc || img.src || '';
            if (!src || !src.startsWith('http')) return;
            if (/seller-public|upload_aimg|material-put|goods-icon|openingemail/i.test(src)) return;
            let up = src
              .replace(/\?imageView2\/2\/w\/\d+.*$/i, '?imageView2/2/w/1600/q/90/format/jpg')
              .replace(/_\d+x\d+\.(jpeg|png|webp|jpg).*$/i, '.$1');
            images.push(up);
          });
        } else if (isBjs) {
          // BJ's Wholesale Club: Scene7 product gallery only (exclude recommendations & other products)
          const bjsItemId = 
            document.querySelector('[data-cnstrc-item-id]:not([class*="rec"]):not([id*="carousel"])')?.getAttribute('data-cnstrc-item-id') ||
            document.querySelector('.cls-item-number, .cls-item')?.textContent.match(/Item:\s*(\d+)/i)?.[1] ||
            document.querySelector('#magic-scroll-id a[href*="scene7.com/is/image/bjs/"], a#prodGallery[href*="scene7.com/is/image/bjs/"]')?.href?.match(/\/bjs\/(\d+)/)?.[1] ||
            document.querySelector('#magic-scroll-id img[src*="scene7.com/is/image/bjs/"]')?.src?.match(/\/bjs\/(\d+)/)?.[1] ||
            (location.pathname.match(/\/product\/[^/]+\/(\d{5,8})(?:\/|$)/)?.[1] || '');

          const galleryEls = document.querySelectorAll(
            '#magic-scroll-id a[href*="scene7.com/is/image/bjs/"], ' +
            '#magic-scroll-id img, ' +
            '.product-gallery-wrapper a[data-zoom-id], ' +
            '.product-gallery-wrapper img.main-image-pdp, ' +
            'a#prodGallery, a#prodGallerym'
          );

          galleryEls.forEach(el => {
            let url = (el.tagName === 'A' ? (el.getAttribute('href') || el.getAttribute('data-image')) : '') ||
                      el.getAttribute('data-src') || el.currentSrc || el.src || '';
            if (!url || !url.includes('scene7.com/is/image/bjs/')) return;
            if (/OnePlusCard|Footer_|ICONS_COLOR|logo|icon|badge|upArrow|Information/i.test(url)) return;
            if (bjsItemId && !url.includes(`/bjs/${bjsItemId}`)) return;
            let up = url.replace(/\?\$bjs-[^$]+\$/i, '?$bjs-Zoom$');
            images.push(up);
          });

          if (images.length === 0) {
            const scopeImgs = document.querySelectorAll('.product-gallery-wrapper img, #pg-inner-wrap img, [class*="product-gallery"] img');
            scopeImgs.forEach(img => {
              if (img.closest('.recommendations, [class*="recommend"], .related-products, [data-automation*="recommendation"], [class*="shelf"], .fbt-wrap, .carousal-wrapper')) return;
              let src = img.getAttribute('data-src') || img.currentSrc || img.src || '';
              if (!src || !src.includes('scene7.com/is/image/bjs/')) return;
              if (/OnePlusCard|Footer_|ICONS_COLOR|logo|icon|badge/i.test(src)) return;
              if (bjsItemId && !src.includes(`/bjs/${bjsItemId}`)) return;
              let up = src.replace(/\?\$bjs-[^$]+\$/i, '?$bjs-Zoom$');
              images.push(up);
            });
          }
        } else {
          document.querySelectorAll('img').forEach(img => images.push(img.src));
        }

        // Apply Global Filters: max 20 images, no duplicates, filter out logo, icon, badge, banner
        // Apply Global Filters: max 20 images, robust duplicate removal, filter out logo, icon, badge, banner
        const finalImages = [];
        const seen = new Set();
        const badWords = ['logo', 'icon', 'badge', 'banner'];

        images.forEach(src => {
          if (!src || !src.startsWith('http')) return;
          const lower = src.toLowerCase();
          if (badWords.some(w => lower.includes(w))) return;
          
          let baseId = src;
          if (isAmz) {
            // Extract the core Amazon image ID (e.g., 71R1sB2V+AL)
            const match = src.match(/\/I\/([^.]+)/);
            if (match) baseId = match[1];
          } else if (isTemu) {
            const m = src.match(/\/([a-zA-Z0-9_-]+\.(?:png|jpg|jpeg|webp))/i);
            baseId = m ? m[1] : src.split('?')[0];
          } else if (isBjs) {
            const m = src.match(/\/bjs\/([^?]+)/);
            baseId = m ? m[1] : src.split('?')[0];
          } else {
            // Extract the core filename for Walmart/Sam's Club
            const parts = src.split('?')[0].split('/');
            baseId = parts[parts.length - 1];
          }

          if (seen.has(baseId)) return;
          seen.add(baseId);
          finalImages.push(src);
        });

        return finalImages.slice(0, 20);
      }
    });

    const scrapedUrls = results[0]?.result || [];

    scanner?.classList.add('hidden');
    grid.style.display = '';

    if (!scrapedUrls.length) {
      showImgEmpty('No product images found on this page.');
      setImgStatus('0 images found', '');
      return;
    }

    setImgStatus(`Found ${scrapedUrls.length} images. Filtering by size…`, 'info');

    // 4. Filter by Minimum Size (200x200px)
    const validImages = [];
    for (const url of scrapedUrls) {
      try {
        const dim = await measureImage(url);
        if (dim && dim.w >= 200 && dim.h >= 200) {
          validImages.push(dim);
        }
      } catch (e) {
        // Skip on error
      }
    }

    if (!validImages.length) {
      showImgEmpty('No valid product images found (all smaller than 200x200px).');
      setImgStatus('0 images found', '');
      return;
    }

    // Sort by resolution: largest first so best quality images appear at the top
    validImages.sort((a, b) => (b.w * b.h) - (a.w * a.h));

    ImgState.images = validImages;
    ImgState.selected = new Set(validImages.map((_, i) => i));

    renderImgGrid();
    setImgStatus(`${validImages.length} image${validImages.length !== 1 ? 's' : ''} found`, 'ok');

  } catch (err) {
    console.error('[ImagesTab] scan error:', err);
    scanner?.classList.add('hidden');
    grid.style.display = '';
    showImgEmpty('Scan failed — refresh the page and try again.');
    setImgStatus('Error scanning page', 'err');
  }
}

// Resolve natural dimensions of an image URL.
// NOTE: Do NOT set crossOrigin = 'anonymous' here — Amazon CDN does not send
// CORS headers, so setting that attribute causes the browser to block the load
// entirely (the image errors out and gets silently dropped).
function measureImage(src) {
  return new Promise(resolve => {
    const img = new Image();
    // No crossOrigin — we only need width/height, not pixel data

    img.onload = () => resolve({ src, w: img.naturalWidth, h: img.naturalHeight });

    img.onerror = () => {
      // Amazon CDN images often fail to load via <img> due to CORS.
      // Keep ONLY genuine product image URLs (/images/I/ path, no thumbnail tokens).
      // Thumbnail tokens: _SR38,50_, _SX48_, _SY60_, _AC_US40_, etc. (tiny sizes)
      if ((src.includes('media-amazon.com') || src.includes('images-amazon.com'))
           && src.includes('/images/I/')) {
        // Reject obvious thumbnails
        if (/\._[A-Z]{2,}_S[RXY]\d{1,3}[,_]/i.test(src)) { resolve(null); return; }
        if (/\._S[XY]\d{1,3}_\./i.test(src)) { resolve(null); return; }
        if (/\._AC_US\d{1,3}_\./i.test(src)) { resolve(null); return; }
        // Bare URL (no token) = seller's original upload = highest quality
        const isBare = !/\._[A-Z0-9_,]{2,}_\./i.test(src);
        resolve({ src, w: isBare ? 2000 : 1500, h: isBare ? 2000 : 1500 });
      } else if (src.includes('kwcdn.com/local-goods-image/')) {
        resolve({ src, w: 1600, h: 1600 });
      } else if (src.includes('bjs.scene7.com')) {
        resolve({ src, w: 2000, h: 2000 });
      } else {
        resolve(null);
      }
    };

    img.src = src;
    // Timeout — if still loading after 5s, keep it (don't drop valid images)
    setTimeout(() => {
      if (img.naturalWidth > 0) {
        resolve({ src, w: img.naturalWidth, h: img.naturalHeight });
      } else {
        // Keep Amazon, Temu, and BJ's CDN URLs on timeout
        if (src.includes('media-amazon.com') || src.includes('images-amazon.com')) {
          const isBare = !/\._[A-Z0-9_,]{2,}_\./i.test(src);
          resolve({ src, w: isBare ? 2000 : 1500, h: isBare ? 2000 : 1500 });
        } else if (src.includes('kwcdn.com/local-goods-image/')) {
          resolve({ src, w: 1600, h: 1600 });
        } else if (src.includes('bjs.scene7.com')) {
          resolve({ src, w: 2000, h: 2000 });
        } else {
          resolve(null);
        }
      }
    }, 6000);
  });
}

// ── Render grid ───────────────────────────────────────────────
function updateVisibleImgCount() {
  const countEl = $('imgFoundCount');
  if (!countEl) return;
  const cards = document.querySelectorAll('#imgGrid .img-card');
  let vis = 0;
  cards.forEach(c => { if (c.style.display !== 'none') vis++; });
  countEl.textContent = `${vis} image${vis !== 1 ? 's' : ''}`;
}

function renderImgGrid() {
  const grid      = $('imgGrid');
  const countEl   = $('imgFoundCount');
  const filterBar = $('imgFilterBar');
  if (!grid) return;

  grid.innerHTML = '';

  const actionsBar = $('imgActionsBar');
  const images = ImgState.images;
  if (!images.length) {
    showImgEmpty();
    if (countEl) countEl.textContent = '0 images';
    if (actionsBar) actionsBar.style.display = 'none';
    return;
  }
  if (actionsBar) actionsBar.style.display = 'flex';

  let visible = 0;
  const total = images.length;

  images.forEach((img, idx) => {
    const role = img.role || 'unknown';
    const card = document.createElement('div');
    card.className = 'img-card' + (ImgState.selected.has(idx) ? ' selected' : '');
    card.dataset.idx = idx;
    visible++;

    // Quality pill
    let qualityPill = '';
    if (typeof img.quality === 'number') {
      const q = Math.round(img.quality);
      const tier = q >= 70 ? 'hi' : q >= 40 ? 'md' : 'lo';
      qualityPill = `<span class="img-quality-pill" data-score-${tier}>${q}</span>`;
    }

    card.innerHTML = `
      <span class="img-role-badge img-role-${role}">${role}</span>
      ${qualityPill}
      <div class="img-card-check">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
      </div>
      <button class="img-card-zoom" title="Preview Full Size" type="button">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
          <circle cx="11" cy="11" r="8"></circle>
          <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          <line x1="11" y1="8" x2="11" y2="14"></line>
          <line x1="8" y1="11" x2="14" y2="11"></line>
        </svg>
      </button>
      <img class="img-card-thumb loading" src="${esc(img.src)}" alt="" crossorigin="anonymous" />
      <div class="img-card-label">${img.w && img.h ? img.w + '×' + img.h : ''}</div>
    `;

    // Fade in when loaded & update dimension if not known
    const thumbEl = card.querySelector('.img-card-thumb');
    thumbEl.addEventListener('load', () => {
      thumbEl.classList.remove('loading');
      if (!img.w && thumbEl.naturalWidth) img.w = thumbEl.naturalWidth;
      if (!img.h && thumbEl.naturalHeight) img.h = thumbEl.naturalHeight;
      if (img.w && img.h) {
        const lbl = card.querySelector('.img-card-label');
        if (lbl) lbl.textContent = `${img.w}×${img.h}`;
        if (ImgState.minSize > 0 && (img.w < ImgState.minSize || img.h < ImgState.minSize)) {
          if (card.style.display !== 'none') {
            card.style.display = 'none';
            updateVisibleImgCount();
          }
        }
      }
    });
    thumbEl.addEventListener('error', () => { thumbEl.style.opacity = '0.3'; thumbEl.alt = 'failed'; });

    card.querySelector('.img-card-zoom')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const label = card.querySelector('.img-card-label')?.textContent || '';
      const allSrcs = images.map(x => x.src);
      openLightbox(img.src, `Image ${idx + 1} of ${images.length} ${label ? `(${label})` : ''}`, allSrcs, idx);
    });

    card.addEventListener('click', (e) => {
      if (e.target.closest('.img-card-zoom')) return;
      if (ImgState.selected.has(idx)) {
        ImgState.selected.delete(idx);
        card.classList.remove('selected');
      } else {
        ImgState.selected.add(idx);
        card.classList.add('selected');
      }
    });

    grid.appendChild(card);
  });

  // Update count
  if (countEl) {
    countEl.textContent = `${total}`;
  }
}

function showImgEmpty(msg) {
  const grid  = $('imgGrid');
  const empty = $('imgEmptyState');
  const countEl = $('imgFoundCount');
  if (!grid) return;
  grid.innerHTML = '';
  if (countEl) countEl.textContent = '0 images';
  const el = document.createElement('div');
  el.className = 'img-tab-empty';
  el.innerHTML = `
    <div class="img-tab-empty-ico">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
        <circle cx="8.5" cy="8.5" r="1.5"/>
        <polyline points="21 15 16 10 5 21"/>
      </svg>
    </div>
    <div class="img-tab-empty-title">No product images found</div>
    <div class="img-tab-empty-sub">${msg || 'Navigate to a product page on Amazon, Walmart, or Sam\'s Club, then click Refresh.'}</div>
  `;
  grid.appendChild(el);
}

// ── Download logic ────────────────────────────────────────────
async function downloadSelectedImages() {
  const selected = [...ImgState.selected];
  if (!selected.length) {
    setImgStatus('Select at least one image first', 'err');
    return;
  }

  const fmt = $('imgFormatSel')?.value || 'original';
  const btn = $('imgDownloadBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Processing…'; }
  setImgStatus(`Processing ${selected.length} image(s)…`, 'info');
  acquireKeepAlive();

  let ok = 0, failed = 0;

  try {
    for (let i = 0; i < selected.length; i++) {
      const idx     = selected[i];
      const imgData = ImgState.images[idx];
      if (!imgData) continue;

      setImgStatus(`Processing ${i + 1}/${selected.length}…`, 'info');

      try {
        let dataUrl = null;
        let ext     = 'jpg';

        if (fmt === 'original') {
          // ── ORIGINAL MODE: fetch raw bytes via background, zero re-encoding ──
          const resp = await chrome.runtime.sendMessage({
            action: 'FETCH_BASE64',
            url:    imgData.src,
            settings: { imageFormat: 'original', imageRatio: 'original', imageBg: 'original', imageMinSize: 0, imageMax5MB: false }
          });
          if (resp?.success && resp.base64) {
            dataUrl = resp.base64;
            if (resp.base64.startsWith('data:image/png'))       ext = 'png';
            else if (resp.base64.startsWith('data:image/webp')) ext = 'webp';
            else if (resp.base64.startsWith('data:image/gif'))  ext = 'gif';
            else if (resp.base64.startsWith('data:image/avif')) ext = 'avif';
            else                                                 ext = 'jpg';
          }
        } else {
          // ── JPG / PNG / WEBP MODE: canvas conversion with CORS fallback ──
          const mime = fmt === 'png' ? 'image/png' : fmt === 'webp' ? 'image/webp' : 'image/jpeg';
          ext = fmt;
          dataUrl = await imgToDataUrl(imgData.src, mime, ext);
        }

        if (!dataUrl) { failed++; continue; }

        const a = document.createElement('a');
        a.href     = dataUrl;
        a.download = `product_image_${i + 1}.${ext}`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        ok++;

        await new Promise(r => setTimeout(r, 200));
      } catch (e) {
        console.warn('[ImagesTab] download failed:', imgData.src, e);
        failed++;
      }
    }
  } finally {
    releaseKeepAlive();
  }

  if (btn) {
    btn.disabled = false;
    btn.innerHTML = `
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="7 10 12 15 17 10"/>
        <line x1="12" y1="15" x2="12" y2="3"/>
      </svg>
      Download Selected`;
  }

  if (failed === 0) {
    setImgStatus(`✅ ${ok} image(s) downloaded`, 'ok');
    toast(`${ok} image(s) downloaded`, 'ok');
  } else {
    setImgStatus(`⚠️ ${ok} ok, ${failed} failed (CORS/blocked)`, 'err');
    toast(`${failed} image(s) failed (CORS/blocked)`, 'warn');
  }
}

// Convert image URL → data URL (JPG, PNG or WEBP), high quality, aspect ratio preserved
// Includes automatic CORS fallback to background service worker and 1:1 square auto-padding
async function imgToDataUrl(src, mime, ext = 'jpg') {
  // First attempt: fast in-panel HTML5 Canvas
  const inPanel = await new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      try {
        const ratio = State.data?.settings?.imageRatio || 'original';
        let targetW = img.naturalWidth;
        let targetH = img.naturalHeight;
        let sx = 0, sy = 0, sw = img.naturalWidth, sh = img.naturalHeight;

        if (ratio === '1:1') {
          // Smart Auto-Trim: Detect and crop out excessive empty white margins on outer borders
          try {
            const probe = document.createElement('canvas');
            probe.width = img.naturalWidth;
            probe.height = img.naturalHeight;
            const pctx = probe.getContext('2d');
            pctx.drawImage(img, 0, 0);
            const imgData = pctx.getImageData(0, 0, probe.width, probe.height);
            const d = imgData.data;
            const isWhite = (x, y) => {
              const idx = (y * probe.width + x) * 4;
              return d[idx] >= 248 && d[idx + 1] >= 248 && d[idx + 2] >= 248;
            };
            let left = 0, right = probe.width - 1, top = 0, bottom = probe.height - 1;
            const stepY = Math.max(1, Math.floor(probe.height / 80));
            const stepX = Math.max(1, Math.floor(probe.width / 80));
            while (left < right) {
              let colW = true;
              for (let y = 0; y < probe.height; y += stepY) { if (!isWhite(left, y)) { colW = false; break; } }
              if (!colW) break;
              left += 2;
            }
            while (right > left) {
              let colW = true;
              for (let y = 0; y < probe.height; y += stepY) { if (!isWhite(right, y)) { colW = false; break; } }
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
              sw = Math.min(img.naturalWidth - sx, (right - left) + pad * 2);
              sh = Math.min(img.naturalHeight - sy, (bottom - top) + pad * 2);
            }
          } catch (_) {}
          targetW = targetH = Math.max(sw, sh, 800);
        }

        const canvas = document.createElement('canvas');
        canvas.width  = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext('2d');

        // White background for JPEG, or if ratio is 1:1 square, or white padding selected
        if (mime === 'image/jpeg' || ratio === '1:1' || State.data?.settings?.imageBg === 'white') {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        }

        const drawX = Math.round((targetW - sw) / 2);
        const drawY = Math.round((targetH - sh) / 2);
        ctx.drawImage(img, sx, sy, sw, sh, drawX, drawY, sw, sh);

        const quality = (mime === 'image/jpeg' || mime === 'image/webp') ? 0.96 : 1.0;
        resolve(canvas.toDataURL(mime, quality));
      } catch (_) {
        // Tainted canvas (CORS restriction) -> fallback
        resolve(null);
      }
    };

    img.onerror = () => resolve(null);
    img.src = src;
    setTimeout(() => resolve(null), 5000);
  });

  if (inPanel) return inPanel;

  // Second attempt: CORS-bypassed background service worker fetch!
  try {
    const resp = await msg({
      action: 'FETCH_BASE64',
      url: src,
      settings: {
        imageFormat: ext || (mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg'),
        imageRatio: State.data?.settings?.imageRatio || 'original',
        imageBg: State.data?.settings?.imageBg || 'white',
        imageMax5MB: State.data?.settings?.imageMax5MB !== false
      }
    });
    if (resp?.success && resp.base64) {
      return resp.base64;
    }
  } catch (err) {
    console.warn('[ZHunter] Background image fetch fallback error:', err);
  }

  return null;
}

function setImgStatus(text, type) {
  const bar = $('imgStatusBar');
  if (!bar) return;
  bar.textContent = text;
  bar.className = `img-status-bar${type ? ' ' + type : ''}`;
}

// ── Wire up Images tab buttons ────────────────────────────────
function initImagesTab() {
  // Refresh button — re-runs the hunt
  $('imgRefreshBtn')?.addEventListener('click', () => {
    ImgState.images = [];
    ImgState.selected.clear();
    scanPageImages();
  });

  // Hunt Images button — same as Refresh but with its own loading state
  $('imgHuntBtn')?.addEventListener('click', async () => {
    const btn      = $('imgHuntBtn');
    const titleEl  = btn?.querySelector('.img-hunt-title');
    const origText = titleEl?.textContent || '🎯 Hunt Images';
    if (btn) { btn.disabled = true; btn.classList.add('loading'); }
    if (titleEl) titleEl.textContent = 'Hunting…';
    ImgState.images = [];
    ImgState.selected.clear();
    await scanPageImages();
    if (btn) { btn.disabled = false; btn.classList.remove('loading'); }
    if (titleEl) titleEl.textContent = origText;
  });

  $('imgSelectAllBtn')?.addEventListener('click', () => {
    document.querySelectorAll('#imgGrid .img-card').forEach(c => {
      if (c.style.display !== 'none') {
        const idx = Number(c.dataset.idx);
        if (!isNaN(idx)) ImgState.selected.add(idx);
        c.classList.add('selected');
      }
    });
  });

  $('imgDeselectAllBtn')?.addEventListener('click', () => {
    document.querySelectorAll('#imgGrid .img-card').forEach(c => {
      if (c.style.display !== 'none') {
        const idx = Number(c.dataset.idx);
        if (!isNaN(idx)) ImgState.selected.delete(idx);
        c.classList.remove('selected');
      }
    });
  });

  $('imgDownloadBtn')?.addEventListener('click', () => downloadSelectedImages());
}

// ============================================================
// VIDEO TAB MODULE
// ============================================================

const VidTabState = {
  videos:        [],
  isScanning:    false,
  currentTabUrl: '',
  currentAsin:   null
};

function classifyVideo(url) {
  if (!url || typeof url !== 'string') return null;
  const u = url.toLowerCase().trim();
  if (/(youtube\.com|youtu\.be)/i.test(url)) {
    let ytId = null;
    try {
      const m = url.match(/(?:v=|\/embed\/|youtu\.be\/|\/v\/|\/shorts\/)([a-zA-Z0-9_-]{11})/);
      ytId = m ? m[1] : null;
    } catch (_) {}
    const thumbnail = ytId ? `https://img.youtube.com/vi/${ytId}/hqdefault.jpg` : null;
    return { url, type: 'youtube', label: 'YouTube', thumbnail, ytId };
  }
  // Brightcove CDN domains
  if (/brightcove\.net|bcovlive\.io|players\.brightcove\.com/i.test(url))
    if (u.includes('.m3u8')) return { url, type: 'hls', label: 'Brightcove', thumbnail: null, ytId: null };
    if (/\.(mp4|mov|webm)(\?|$)/.test(u)) return { url, type: 'mp4', label: 'Brightcove', thumbnail: null, ytId: null };
    // A player page (index.html?videoId=…) is not a media file — open it like YouTube.
    return { url, type: 'embed', label: 'Player', thumbnail: null, ytId: null };
  if (u.includes('.m3u8')) return { url, type: 'hls',    label: 'HLS',   thumbnail: null, ytId: null };
  if (u.includes('.mp4'))  return { url, type: 'mp4',    label: 'MP4',   thumbnail: null, ytId: null };
  if (u.includes('.webm')) return { url, type: 'webm',   label: 'WebM',  thumbnail: null, ytId: null };
  return { url, type: 'direct', label: 'Video', thumbnail: null, ytId: null };
}

function vidExtractAsin(url) {
  if (!url) return null;
  try {
    const m = url.match(/\/dp\/([A-Z0-9]{10})/i) || url.match(/\/gp\/product\/([A-Z0-9]{10})/i);
    return m ? m[1].toUpperCase() : null;
  } catch { return null; }
}

function initVideoTab() {
  $('vidHuntBtn')?.addEventListener('click', scanVideos);
  $('vidRefreshBtn')?.addEventListener('click', scanVideos);
  $('vidCopyAllBtn')?.addEventListener('click', copyAllVideoUrls);
  $('vidDownloadZipBtn')?.addEventListener('click', downloadAllVideosAsZip);
}

async function scanVideos() {
  if (VidTabState.isScanning) return;
  VidTabState.isScanning = true;

  const huntBtn       = $('vidHuntBtn');
  const scanningState = $('vidScanningState');
  const emptyState    = $('vidEmptyState');
  const statusBar     = $('vidStatusBar');
  const countEl       = $('vidFoundCount');

  if (huntBtn)       huntBtn.disabled = true;
  if (scanningState) scanningState.classList.remove('hidden');
  if (emptyState)    emptyState.style.display = 'none';
  if (statusBar)     statusBar.textContent = 'Scanning for videos…';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('no_tab');

    VidTabState.currentTabUrl = tab.url || '';
    VidTabState.currentAsin   = vidExtractAsin(tab.url || '');

    const scraped = await new Promise(resolve => {
      let done = false;
      const finish = v => { if (!done) { done = true; resolve(v); } };
      const t = setTimeout(() => finish(null), 10000);
      chrome.tabs.sendMessage(tab.id, { action: 'SCRAPE_PAGE' }, res => {
        clearTimeout(t);
        if (chrome.runtime.lastError || !res?.success || !res?.data) finish(null);
        else finish(res.data);
      });
    });

    const rawVideos = scraped?.videos || [];
    const seen = new Set();
    VidTabState.videos = rawVideos
      .filter(v => v && typeof v === 'string')
      .map(v => classifyVideo(v))
      .filter(v => {
        if (!v || seen.has(v.url)) return false;
        seen.add(v.url);
        return true;
      });

    // MP4 first (plays everywhere), then HLS (converted to MP4 on download),
    // then WebM, then YouTube. If a WebM has an MP4 twin (same path, different
    // extension) drop the WebM — the MP4 is the one people can open.
    const rank = { mp4: 0, direct: 1, hls: 2, webm: 3, youtube: 4, embed: 5 };
    const stem = u => u.split('?')[0].replace(/\.(mp4|webm|m4v|mov)$/i, '');
    const mp4Stems = new Set(VidTabState.videos.filter(v => v.type === 'mp4').map(v => stem(v.url)));
    VidTabState.videos = VidTabState.videos
      .filter(v => !(v.type === 'webm' && mp4Stems.has(stem(v.url))))
      .sort((a, b) => (rank[a.type] ?? 9) - (rank[b.type] ?? 9));

    renderVideoCards();

    const count = VidTabState.videos.length;
    if (countEl)   countEl.textContent  = `${count} video${count !== 1 ? 's' : ''}`;
    if (statusBar) statusBar.textContent = '';

    if (count === 0) {
      if (emptyState) emptyState.style.display = 'flex';
      toast('No videos found on this page', 'info');
    } else {
      toast(`Found ${count} video${count !== 1 ? 's' : ''}! 🎬`, 'ok');
    }
  } catch (e) {
    if (emptyState) emptyState.style.display = 'flex';
    if (statusBar)  statusBar.textContent  = 'Could not scan this page';
    toast('Could not scan this page — try refreshing', 'warn');
  } finally {
    VidTabState.isScanning = false;
    if (huntBtn)       huntBtn.disabled = false;
    if (scanningState) scanningState.classList.add('hidden');
  }
}

// Render-session counter: unique IDs per renderVideoCards() call
let _vidRenderSeed = 0;

function renderVideoCards() {
  const grid       = $('vidGrid');
  const emptyState = $('vidEmptyState');
  if (!grid) return;
  Array.from(grid.children).forEach(c => { if (c.id !== 'vidEmptyState') c.remove(); });
  if (!VidTabState.videos.length) {
    if (emptyState) emptyState.style.display = 'flex';
    return;
  }
  if (emptyState) emptyState.style.display = 'none';
  const frag = document.createDocumentFragment();
  _vidRenderSeed++;
  const seed = _vidRenderSeed;
  VidTabState.videos.forEach((video, idx) => frag.appendChild(buildVideoCard(video, idx, seed)));
  grid.appendChild(frag);
}

function buildVideoCard(video, idx, seed) {
  const uid = `${seed}_${idx}`; // unique per render-session + index
  const TYPE_CLASS = {
    hls: 'vid-badge-hls', mp4: 'vid-badge-mp4', webm: 'vid-badge-webm',
    youtube: 'vid-badge-youtube', direct: 'vid-badge-direct'
  };
  const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const trunc = (s,n) => { s=String(s||''); return s.length>n ? s.slice(0,n-1)+'…':s; };

  const card = document.createElement('div');
  card.className = 'vid-card';
  card.dataset.idx = idx;

  const thumbAreaId = 'vta-' + uid;

  // YouTube: use known thumbnail URL
  // MP4: will be generated async after card is in DOM
  // HLS/WebM/other: show site favicon
  let thumbHTML;
  if (video.type === 'youtube' && video.thumbnail) {
    thumbHTML = '<img class="vid-thumb-img" src="' + esc(video.thumbnail) + '" alt="Thumbnail" loading="lazy" data-onerror="vidicon">';
  } else if (video.type === 'mp4') {
    thumbHTML = '<div class="vid-thumb-icon">&#9654;</div>';
  } else {
    // Use tab's page favicon (e.g. Amazon logo) instead of CDN domain
    try {
      const pageDomain = new URL(VidTabState.currentTabUrl || video.url).hostname;
      thumbHTML = '<img class="vid-thumb-img" src="https://www.google.com/s2/favicons?domain=' + pageDomain + '&sz=128" alt="" style="width:64px;height:64px;object-fit:contain;opacity:0.85" data-onerror="vidicon">';
    } catch(_) {
      thumbHTML = '<div class="vid-thumb-icon">&#9654;</div>';
    }
  }

  card.innerHTML = `
    <div class="vid-card-top">
      <span class="vid-type-badge ${TYPE_CLASS[video.type] || 'vid-badge-direct'}">${esc(video.label)}</span>
      <span class="vid-url-preview" title="${esc(video.url)}">${esc(trunc(video.url, 55))}</span>
    </div>
    <div class="vid-thumbnail-area" id="vta-${uid}">${thumbHTML}</div>
    <div class="vid-progress-wrap hidden" id="vp-${uid}">
      <div class="vid-progress-bar"><div class="vid-progress-fill" id="vpf-${uid}" style="width:0%"></div></div>
      <span class="vid-progress-text" id="vpt-${uid}">Preparing...</span>
    </div>
    <div class="vid-card-actions">
      <button class="vid-action-btn vid-dl-btn"   id="vdl-${uid}" type="button">Download</button>
      <button class="vid-action-btn vid-copy-btn" id="vcp-${uid}" type="button">Copy URL</button>
      <button class="vid-action-btn vid-open-btn" id="vop-${uid}" type="button">Open</button>
    </div>`;

  card.querySelector('#vdl-' + uid).addEventListener('click', () => downloadVideo(video, uid));
  card.querySelector('#vcp-' + uid).addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(video.url); toast('URL copied!', 'ok'); }
    catch (_) { toast('Failed to copy', 'err'); }
  });
  card.querySelector('#vop-' + uid).addEventListener('click', () => chrome.tabs.create({ url: video.url }));

  // Generate MP4 frame thumbnail async after card is in DOM
  if (video.type === 'mp4') {
    setTimeout(() => generateMp4Thumbnail(video.url, thumbAreaId), 100);
  }

  return card;
}

// Capture a frame from an MP4 video using hidden video + canvas
function generateMp4Thumbnail(url, areaId) {
  const area = document.getElementById(areaId);
  if (!area) return;

  const vid = document.createElement('video');
  vid.crossOrigin = 'anonymous';
  vid.muted = true;
  vid.preload = 'metadata';
  vid.style.display = 'none';
  vid.src = url;
  document.body.appendChild(vid);

  const cleanup = () => { try { document.body.removeChild(vid); } catch(_) {} };

  vid.addEventListener('loadedmetadata', () => {
    // Seek to 10% of video duration for a meaningful frame
    vid.currentTime = Math.min(vid.duration * 0.1, 5);
  });

  vid.addEventListener('seeked', () => {
    try {
      const canvas = document.createElement('canvas');
      canvas.width  = 320;
      canvas.height = 180;
      canvas.getContext('2d').drawImage(vid, 0, 0, 320, 180);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
      // Replace play icon with captured frame
      const img = document.createElement('img');
      img.className = 'vid-thumb-img';
      img.src = dataUrl;
      img.alt = 'Thumbnail';
      const freshArea = document.getElementById(areaId);
      if (freshArea) { freshArea.innerHTML = ''; freshArea.appendChild(img); }
    } catch(_) {}
    cleanup();
  });

  // Timeout: if video fails to load in 8s, give up silently
  setTimeout(cleanup, 8000);
  vid.load();
}

async function downloadVideo(video, uid) {
  const progWrap = $(`vp-${uid}`);
  const progFill = $(`vpf-${uid}`);
  const progText = $(`vpt-${uid}`);
  const dlBtn    = $(`vdl-${uid}`);
  const setP = (pct, txt) => {
    if (progFill) progFill.style.width = pct + '%';
    if (progText) progText.textContent  = txt;
  };
  if (dlBtn)    dlBtn.disabled = true;
  if (progWrap) progWrap.classList.remove('hidden');
  const base = VidTabState.currentAsin ? `${VidTabState.currentAsin}_video` : 'product_video';
  try {
    if (video.type === 'youtube' || video.type === 'embed') {
      chrome.tabs.create({ url: video.url });
      toast(video.type === 'youtube' ? 'YouTube opened in a new tab (YouTube cannot be downloaded here)' : 'Player page opened in a new tab', 'info');
      return;
    }
    if (video.type === 'hls') {
      setP(5, 'Fetching HLS manifest…');
      const tsData = await downloadHLSStream(video.url, (done, total, note) =>
        setP(Math.round(5 + done / total * 88), note || `Segment ${done}/${total}…`)
      );
      setP(100, 'Saving file…');
      await zhSaveBlob(new Blob([tsData], { type: 'video/mp4' }), `${base}.mp4`);
      toast('Video saved as MP4', 'ok');
    } else {
      setP(30, 'Downloading…');
      const urlPath = video.url.split('?')[0];
      const extRaw  = urlPath.split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '');
      const ext     = ['mp4','webm','mov','avi','mkv','m4v'].includes(extRaw) ? extRaw : 'mp4';
      let downloaded = false;
      try {
        // Fetch first so we can name the file; some CDNs need cookies → try with, then without.
        let resp = null;
        try { resp = await fetch(video.url, { credentials: 'include' }); } catch (_) {}
        if (!resp || !resp.ok) { try { resp = await fetch(video.url, { credentials: 'omit' }); } catch (_) {} }
        if (resp && resp.ok && !/text\/html/i.test(resp.headers.get('content-type') || '')) {
          const blob = await resp.blob();
          if (blob.size > 1024) { await zhSaveBlob(blob, `${base}.${ext}`); downloaded = true; }
        }
      } catch (_) {}
      if (!downloaded) {
        // Let Chrome download the URL itself (cross-origin anchors ignore the download name
        // and would just open the video in a tab).
        try { await chrome.downloads.download({ url: video.url, filename: `${base}.${ext}`, conflictAction: 'uniquify' }); downloaded = true; }
        catch (_) { chrome.tabs.create({ url: video.url }); toast('Could not download directly — opened the video in a tab', 'warn'); return; }
      }
      setP(100, 'Download started!');
      toast(ext === 'webm' ? 'Saved as WebM — this site only offers WebM for this video' : 'Video download started', ext === 'webm' ? 'warn' : 'ok');
    }
  } catch (e) {
    if (progText) progText.textContent = `Error: ${e.message || 'failed'}`;
    toast(`Download failed: ${e.message || 'Unknown error'}`, 'err');
  } finally {
    if (dlBtn) dlBtn.disabled = false;
    setTimeout(() => {
      if (progWrap) progWrap.classList.add('hidden');
      if (progFill) progFill.style.width = '0%';
    }, 3500);
  }
}

async function downloadHLSStream(m3u8Url, progressCb) {
  const MAX_SEG = 500, MAX_DEPTH = 3, CONCUR = 5;
  async function fetchSegments(url, depth) {
    if (depth > MAX_DEPTH) throw new Error('HLS playlist nested too deeply');
    const resp = await fetch(url, { credentials: 'omit' });
    if (!resp.ok) throw new Error(`Manifest fetch failed: HTTP ${resp.status}`);
    const text    = await resp.text();
    const baseUrl = url.substring(0, url.lastIndexOf('/') + 1);
    if (text.includes('#EXT-X-STREAM-INF')) {
      if (/#EXT-X-MEDIA:[^\n]*TYPE=AUDIO[^\n]*URI=/i.test(text)) separateAudio = true;
      const lines = text.split('\n');
      let bestBw = -1, bestVariant = null;
      for (let i = 0; i < lines.length; i++) {
        if (!lines[i].startsWith('#EXT-X-STREAM-INF')) continue;
        const bwM = lines[i].match(/BANDWIDTH=(\d+)/);
        const bw  = bwM ? parseInt(bwM[1]) : 0;
        const nxt = lines[i + 1]?.trim();
        if (nxt && !nxt.startsWith('#') && bw > bestBw) {
          bestBw = bw; bestVariant = nxt.startsWith('http') ? nxt : baseUrl + nxt;
        }
      }
      if (!bestVariant) throw new Error('No variants in master playlist');
      return fetchSegments(bestVariant, depth + 1);
    }
    // fMP4 playlists carry an init segment (#EXT-X-MAP). Remember it so the
    // output is a valid MP4 (init + media segments) instead of raw fragments.
    const mapM = text.match(/#EXT-X-MAP:[^\n]*URI="([^"]+)"/);
    if (mapM) initSegmentUrl = mapM[1].startsWith('http') ? mapM[1] : baseUrl + mapM[1];
    return text.split('\n').filter(l => l.trim() && !l.startsWith('#'))
      .slice(0, MAX_SEG).map(l => l.trim().startsWith('http') ? l.trim() : baseUrl + l.trim());
  }
  let initSegmentUrl = null, separateAudio = false;
  const segments = await fetchSegments(m3u8Url, 0);
  if (separateAudio) toast('This stream keeps audio in a separate track — the MP4 may be silent', 'warn');
  if (!segments.length) throw new Error('No segments found in HLS playlist');
  const buffers = new Array(segments.length);
  let completed = 0;
  for (let i = 0; i < segments.length; i += CONCUR) {
    const batch   = segments.slice(i, i + CONCUR);
    const results = await Promise.all(batch.map(async (segUrl, bi) => {
      const r = await fetch(segUrl, { credentials: 'omit' });
      if (!r.ok) throw new Error(`Segment ${i + bi} failed`);
      return { idx: i + bi, buf: await r.arrayBuffer() };
    }));
    for (const { idx, buf } of results) { buffers[idx] = buf; progressCb?.(++completed, segments.length); }
  }
  const totalLen = buffers.reduce((s, b) => s + b.byteLength, 0);
  const combined = new Uint8Array(totalLen);
  let offset = 0;
  for (const buf of buffers) { combined.set(new Uint8Array(buf), offset); offset += buf.byteLength; }

  // ── Make it a real MP4 ──────────────────────────────────────
  // Case 1: fMP4 segments → prepend the init segment; the result is a valid MP4.
  if (initSegmentUrl) {
    const r = await fetch(initSegmentUrl, { credentials: 'omit' });
    if (r.ok) {
      const init = new Uint8Array(await r.arrayBuffer());
      const out = new Uint8Array(init.byteLength + combined.byteLength);
      out.set(init, 0); out.set(combined, init.byteLength);
      return out;
    }
  }
  // Case 2: MPEG-TS segments (0x47 sync byte) → remux to MP4 with mux.js (no re-encode).
  if (combined.byteLength && combined[0] === 0x47 && typeof muxjs !== 'undefined') {
    progressCb?.(segments.length, segments.length, 'Converting to MP4…');
    return await tsToMp4(combined);
  }
  return combined;
}

// MPEG-TS → fragmented MP4 using mux.js. Lossless container change only.
function tsToMp4(tsBytes) {
  return new Promise((resolve, reject) => {
    try {
      const Transmuxer = (muxjs.mp4 && muxjs.mp4.Transmuxer) || muxjs.Transmuxer;
      const t = new Transmuxer({ remux: true, keepOriginalTimestamps: true });
      const parts = [];
      let gotInit = false;
      t.on('data', seg => {
        if (seg.initSegment && !gotInit) { parts.push(seg.initSegment); gotInit = true; }
        if (seg.data) parts.push(seg.data);
      });
      t.on('done', () => {
        if (!parts.length) { reject(new Error('Remux produced no data')); return; }
        const len = parts.reduce((n, p) => n + p.byteLength, 0);
        const out = new Uint8Array(len);
        let o = 0;
        for (const p of parts) { out.set(p, o); o += p.byteLength; }
        resolve(out);
      });
      t.on('error', e => reject(e instanceof Error ? e : new Error('Remux failed')));
      // Feed in chunks so very long streams do not block the UI.
      const CH = 2 * 1024 * 1024;
      for (let i = 0; i < tsBytes.byteLength; i += CH) t.push(tsBytes.subarray(i, i + CH));
      t.flush();
    } catch (e) { reject(e); }
  });
}

async function copyAllVideoUrls() {
  if (!VidTabState.videos.length) { toast('No videos scanned yet', 'warn'); return; }
  try {
    await navigator.clipboard.writeText(VidTabState.videos.map(v => v.url).join('\n'));
    toast(`${VidTabState.videos.length} URL${VidTabState.videos.length !== 1 ? 's' : ''} copied! 📋`, 'ok');
  } catch { toast('Failed to copy URLs', 'err'); }
}

async function downloadAllVideosAsZip() {
  if (!VidTabState.videos.length) { toast('No videos scanned yet', 'warn'); return; }
  if (typeof JSZip === 'undefined') { toast('JSZip not loaded', 'err'); return; }
  const btn = $('vidDownloadZipBtn');
  const statusBar = $('vidStatusBar');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Preparing…'; }
  const baseName     = VidTabState.currentAsin || 'product';
  const downloadable = VidTabState.videos.filter(v => v.type !== 'youtube');
  const ytVids       = VidTabState.videos.filter(v => v.type === 'youtube');
  if (!downloadable.length && ytVids.length) {
    toast('Only YouTube videos — use Copy All URLs instead', 'warn');
    if (btn) { btn.disabled = false; btn.textContent = '🗂 Download All'; }
    return;
  }
  try {
    const zip = new JSZip();
    if (ytVids.length) zip.file('youtube_links.txt', ytVids.map(v => v.url).join('\n'));
    for (let i = 0; i < downloadable.length; i++) {
      const video    = downloadable[i];
      const num      = String(i + 1).padStart(2, '0');
      const fileBase = `${baseName}_video_${num}`;
      if (statusBar) statusBar.textContent = `Processing ${i + 1}/${downloadable.length}…`;
      try {
        if (video.type === 'hls') {
          const tsData = await downloadHLSStream(video.url, (done, total, note) => {
            if (statusBar) statusBar.textContent = note ? `Video ${i + 1}: ${note}` : `Video ${i + 1}: ${done}/${total} segments…`;
          });
          zip.file(`${fileBase}.mp4`, tsData);
        } else {
          let resp = null;
          try { resp = await fetch(video.url, { credentials: 'include' }); } catch (_) {}
          if (!resp || !resp.ok) resp = await fetch(video.url, { credentials: 'omit' });
          if (resp.ok) {
            const extRaw = video.url.split('?')[0].split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '');
            const ext    = ['mp4','webm','mov'].includes(extRaw) ? extRaw : 'mp4';
            zip.file(`${fileBase}.${ext}`, await resp.arrayBuffer());
          } else {
            zip.file(`${fileBase}_url.txt`, video.url);
          }
        }
      } catch (e) {
        zip.file(`${fileBase}_failed.txt`, `Failed: ${e.message}\nURL: ${video.url}`);
      }
    }
    if (statusBar) statusBar.textContent = 'Building ZIP…';
    const blob   = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 3 } });
    await zhSaveBlob(blob, `${baseName}_videos_${new Date().toISOString().slice(0, 10)}.zip`);
    toast(`ZIP downloaded (${downloadable.length} video${downloadable.length !== 1 ? 's' : ''})`, 'ok');
    if (statusBar) statusBar.textContent = `Done`;
  } catch (e) {
    toast(`ZIP failed: ${e.message || 'Unknown error'}`, 'err');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🗂 Download All'; }
  }
}

// Init video tab on load
document.addEventListener('DOMContentLoaded', () => initVideoTab(), { once: true });
// ═══════════════════════════════════════════════════════════════
// v8.5.0 — TEMU EXPORT (built-in converter: rows → Temu general template)
// No Python needed. Template stored once in settings; config editable in modal.
// ═══════════════════════════════════════════════════════════════
// ═════════════════════════════════════════════════════════════════
// v9.12.0 — Description + bullet points for the Temu file
// Source = hunted bullets (r.bullets) → fallback: hunted description sentences.
// Clean: no links / emojis / web-UI junk / store names; short professional bullets.
// "Avoid words" (Settings): any SENTENCE containing one is dropped (removing just the
// word would break the sentence). Title "Remove words" are stripped word-by-word.
// ═════════════════════════════════════════════════════════════════
const TEMU_DESC_AVOID_DEFAULT = [
  // E-commerce & store marketing junk
  'Best Seller', 'Bestseller', '#1', 'No. 1', 'Number one', 'Top rated', 'Top-rated',
  'Free shipping', 'Add to cart', 'Add to list', 'Buy now', 'Click here', 'Limited time', 'On sale', 'Discount',
  'Customer service', 'Contact us', 'Return policy', 'Costco', 'eBay',

  // Guarantees & absolute performance claims
  'Guarantee', 'Guaranteed', 'Money back', 'Lifetime warranty', 'Warranty',
  'Satisfaction', '100% satisfaction', 'Risk-free', 'Risk free', 'Harmless',
  '100% safe', '100% effective', 'Highly effective', 'Professional-grade', 'Professional grade',

  // Health, Medical, Treatment & Disease claims (Temu high violation triggers)
  'Medical', 'Medicine', 'Medical-grade', 'Medical grade', 'Therapeutic', 'Treatment',
  'Cure', 'Cures', 'Healing', 'Diagnosis', 'Disease', 'Illness', 'Clinical', 'Therapy',
  'Pain relief', 'Anti-inflammatory', 'Infection', 'Antibacterial', 'Antiviral', 'Antifungal',
  'Rehabilitation', 'Orthopedic', 'Heals', 'Prevents disease', 'Kills germs', 'Kills 99.9%',
  'Covid', 'Coronavirus', 'Pesticide',

  // Allergy claims
  'Allergy-free', 'Allergy relief', 'Anti-allergy', 'Hypoallergenic', 'Allergen-free',
  'Prevents allergies', 'Protects against allergens',

  // Environmental claims
  'Eco-friendly', 'Eco friendly', 'Environmentally friendly', 'Sustainable',
  'Biodegradable', 'Compostable', 'Recyclable', 'Carbon-neutral', 'Non-toxic', 'Non toxic',
  'Chemical-free', 'Chemical free', 'Environmentally safe',

  // Authority & Certification claims
  'FDA approved', 'FDA cleared', 'CE certified', 'Clinically tested',
  'Laboratory tested', 'Doctor recommended', 'Professional recommended'
];
const TEMU_PLATFORM_WORDS = ['Amazon.com', 'Amazon', 'Walmart.com', 'Walmart', "Sam's Club", 'Sams Club', 'Costco', 'eBay', 'Target.com'];
// whole sentence goes if it is shop/web talk
const TEMU_JUNK_SENT_RE = /make sure this fits|model number|see more product details|https?:\/\/|www\.|\S+@\S+\.\w+|\b(visit|follow) (us|our)\b|\bour (store|shop|website)\b/i;
const TEMU_JUNK_LINE_RE = /^(about this item|product description|make sure this fits|see more|show more|read more|from the manufacturer|product details|specifications?|features?( & details)?|key features|highlights|description|overview)\b[:\s]*$/i;

function temuEscRe(w) { return String(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function temuWordRe(w) {
  const e = temuEscRe(String(w).trim());
  // \b only works next to word chars ("#1" / "100%" need custom edges)
  const a = /^\w/.test(w) ? '\\b' : '(?:^|(?<=[\\s(]))';
  const z = /\w$/.test(w) ? '\\b' : '(?=$|[\\s,.;:!)])';
  return new RegExp(a + e + z, 'i');
}

// one raw text → clean sentence-ish text (no html, links, emojis, odd brackets)
function temuCleanText(t) {
  t = String(t || '');
  t = t.replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&');
  t = t.replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}\u{2B50}\u{2705}\u{2714}\u{2716}\u{2728}]/gu, ' ');
  t = t.replace(/[【〖\[]\s*([^】〗\]]{1,60}?)\s*[】〗\]]\s*[:\-–]?\s*/g, '$1: ');   // 【SOFT】 → "SOFT: "
  t = t.replace(/^[\s•●▪◆◇■□★☆✓✔➤►▶\-–*·>]+/, '');
  t = t.replace(/[™®©]/g, '').replace(/\s*\|\s*/g, ', ');
  t = t.replace(/\s{2,}/g, ' ').trim();
  // "ULTRA SOFT MATERIAL: text" → "Ultra Soft Material: text"
  t = t.replace(/^([A-Z0-9][A-Z0-9 &'\/]{2,48}?)\s*(?::|\s[-–]\s)\s*/, (m, h) => h.toLowerCase().replace(/\b\w/g, c => c.toUpperCase()) + ': ');
  return t;
}

function temuSentences(t) {
  return String(t || '').split(/(?<=[.!?])\s+(?=[A-Z0-9"(])/).map(x => x.trim()).filter(Boolean);
}

// shorten to max chars at a sentence / clause boundary (never mid-word)
function temuShorten(t, max) {
  t = String(t || '').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const stops = [cut.lastIndexOf('. '), cut.lastIndexOf('; '), cut.lastIndexOf(', '), cut.lastIndexOf(' - ')];
  let at = Math.max(...stops);
  if (at < max * 0.5) at = cut.lastIndexOf(' ');
  return cut.slice(0, at > 0 ? at : max).replace(/[\s,;:\-–]+$/, '') + (/[.!?]$/.test(cut.slice(0, at)) ? '' : '.');
}

// strip platform/store + title-remove words; drop sentences with avoid words
function temuScrubText(t, cfg, extraBrand, evidence = t) {
  const strip = [...(cfg.title_remove_words || [])];
  if (extraBrand) strip.push(extraBrand);
  const normalize = w => String(w).toLowerCase().replace(/[ -]+/g, ' ');
  const restricted = new Set(Object.values(ZH_TITLE_OPTIMIZER_RULES.restricted_content.categories).flat().map(normalize));
  const legacy = new Set(TEMU_DESC_AVOID_DEFAULT.map(normalize));
  const avoid = [...new Set([...TEMU_PLATFORM_WORDS,
    ...TEMU_DESC_AVOID_DEFAULT.filter(w => !restricted.has(normalize(w))),
    ...(cfg.desc_avoid_words || []).filter(w => !legacy.has(normalize(w)))])];
  let out = temuSentences(t).filter(sn => !TEMU_JUNK_SENT_RE.test(sn)).join(' ');
  out = zhCleanContentClaims(out, evidence, avoid);
  strip.forEach(w => { w = String(w || '').trim(); if (w) out = out.replace(new RegExp(temuWordRe(w).source, 'gi'), ' '); });
  out = out.replace(/\(\s*\)/g, '').replace(/\s+([,.;:!?])/g, '$1').replace(/([,;:])\1+/g, '$1')
           .replace(/^[\s,.;:\-–]+/, '').replace(/\s{2,}/g, ' ').trim();
  return out;
}

// r = hunted row, title = final Temu title, brandOk = brand is mapped to the store's Temu brand
function temuBuildCopy(r, title, cfg, brandOk) {
  const BULLET_MAX = cfg.bullet_max_chars || 200, DESC_MAX = cfg.desc_max_chars || 900;
  const srcBrand = brandOk ? '' : String(r.brand || '').trim();
  const brandStrip = srcBrand && srcBrand.length > 2 ? srcBrand : '';
  let raw = Array.isArray(r.bullets) ? r.bullets.slice() : String(r.bullets || '').split(/\s*\|\s*/);
  raw = raw.map(x => String(x || '')).filter(Boolean);
  const descClean = temuCleanText(r.description || '');
  if (!raw.length && descClean) raw = temuSentences(descClean).slice(0, 8);
  const seen = new Set(), bullets = [];
  for (const b0 of raw) {
    let b = temuCleanText(b0);
    if (!b || TEMU_JUNK_LINE_RE.test(b)) continue;
    b = temuScrubText(b, cfg, brandStrip, zhProductEvidence(r));
    b = b.replace(/^[a-z]/, c => c.toUpperCase());
    if (b.length < 15 || !/[a-z]{3}/i.test(b)) continue;
    b = temuShorten(b, BULLET_MAX);
    if (!/[.!?:]$/.test(b)) b += '.';
    const key = b.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 60);
    if (seen.has(key)) continue; seen.add(key);
    bullets.push(b);
    if (bullets.length >= 6) break;
  }
  // description: cleaned hunted description, else built from the bullets
  let desc = descClean ? temuScrubText(descClean, cfg, brandStrip, zhProductEvidence(r)) : '';
  if (desc.length < 60) desc = bullets.map(b => b.replace(/^[^:]{2,40}:\s*/, '')).join(' ');
  desc = temuShorten(desc.replace(/\s{2,}/g, ' ').trim(), DESC_MAX);
  if (desc && title && desc.length < 120) desc = temuShorten(zhCleanContentClaims(title, zhProductEvidence(r), cfg.title_remove_words || []).replace(/[.\s]+$/, '') + '. ' + desc, DESC_MAX);
  return { bullets, description: desc };
}

const TEMU_DEFAULT_CONFIG = {
  sku_prefix: 'CH',
  price_multiplier: 5.0,
  list_price_multiplier: 1.25,
  price_round_to_99: true,
  price_min: 80.0,
  price_max: 999.0,
  quantity_min: 250,
  quantity_max: 500,
  max_sku_images: 7,
  defaults: {
    shipping_template: 'Main Shipping Template',
    handling_time: '2 Days',
    fulfillment_channel: 'I will ship this item myself',
    origin_country: 'United States',
    variation_theme: 'Color',
    default_color: 'White',
    weight_lb: 1.4, length_in: 7.5, width_in: 5.2, height_in: 1.5
  },
  brands: {
    'callaway': 'CALLAWAY', 'vice golf': 'VICE GOLF', 'vice ': 'VICE GOLF',
    'taylormade': 'TAYLORMADE', 'titleist': 'TITLEIST', 'wilson': 'WILSON',
    "member's mark": "MEMBER'S MARK", 'members mark': "MEMBER'S MARK", 'great value': 'GREAT VALUE'
  },
  trademarks: {
    'CALLAWAY': 'CALLAWAY', 'VICE GOLF': 'VICE GOLF', 'TAYLORMADE': 'TAYLORMADE', 'TITLEIST': 'TITLEIST',
    'WILSON': 'WILSON', "MEMBER'S MARK": "MEMBER'S MARK", 'GREAT VALUE': 'Great Value'
  },
  category_profiles: (typeof TEMU_OFFICIAL_CATEGORIES !== 'undefined' ? TEMU_OFFICIAL_CATEGORIES : {}),
  colors: ['White','Red','Black','Yellow','Grey','Gray','Blue','Green','Purple','Orange','Pink','Brown','Navy Blue','Multi Color','Mixed Color','Neon'],
  smart_variations: true,
  upload_in_background: true,
  simple_variation_values: ['Standard', 'Special', 'New', 'Classic'],
  smart_weight: true,
  max_weight_lb: 8,
  skip_listed: true,
  title_remove_words: ['Amazon', 'Amazon.com', 'Walmart', "Sam's Club", 'priced per pound', 'Prime', 'FSA Eligible', 'Best Seller'],
  // v9.12.0 — description + bullet points (item_description / item_note ×6)
  fill_description: true,
  desc_avoid_words: TEMU_DESC_AVOID_DEFAULT.slice(),
  // v9.12.0 — department pricing { "Grocery & Gourmet Food": { px, min, max } } (blank = store default)
  dept_pricing: {}
};


// ── v8.9.0 Already-listed guard ─────────────────────────────
function temuListedMap() {
  const m = State.data?.settings?.temuListed;
  return (m && typeof m === 'object') ? m : {};
}
// v9.1.1: agar auto-upload fail/unconfirmed ho to listed-history se wapas hata do (warna agli baar skip ho jate)
async function temuUnmarkListed(items) {
  const store = temuActiveStoreName() || 'default';
  const m = { ...temuListedMap() };
  let n = 0;
  (items || []).forEach(it => { const k = store + '|' + (it.url ? temuSourceIdentity(it.url) : it.sid); if (m[k]) { delete m[k]; n++; } });
  if (!n) return 0;
  const ok = await msg({ action: 'UPDATE_SETTINGS', settings: { temuListed: m } });
  if (ok?.success) State.data.settings.temuListed = m;
  return n;
}
async function temuMarkListed(items, targetStore, state = 'listed') {
  const store = targetStore || temuActiveStoreName() || 'default';
  const m = { ...temuListedMap() };
  const date = new Date();
  const now = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
  // v9.6.2: aakhri mark yaad rakho (store + source ids) taake "Unmark last upload" reload ke baad bhi chale
  try { chrome.storage.local.set({ temuLastMarked: { store, sids: (items || []).map(it => it.url ? temuSourceIdentity(it.url) : it.sid), n: (items || []).length, t: Date.now() } }); } catch (_) {}
  items.forEach(it => {
    const sid = it.sid || temuSourceId(it.url); // v9.7.1: as-is Temu file ke items mein sid SKU se aata hai
    const identity = it.url ? temuSourceIdentity(it.url) : sid;
    m[store + '|' + identity] = { t: (it.title || '').slice(0, 60), d: now, state };
  });
  // cap history at 20k entries (oldest dropped)
  const keys = Object.keys(m);
  if (keys.length > 20000) keys.slice(0, keys.length - 20000).forEach(k => delete m[k]);
  const ok = await msg({ action: 'UPDATE_SETTINGS', settings: { temuListed: m } });
  if (ok?.success) State.data.settings.temuListed = m;
}

// ── v8.8.0 Multi-store ──────────────────────────────────────
function temuStores() {
  const st = State.data?.settings?.temuStores;
  return (st && typeof st === 'object') ? st : {};
}
function temuActiveStoreName() {
  const stores = temuStores();
  const names = Object.keys(stores);
  const act = State.data?.settings?.temuActiveStore;
  if (act && stores[act]) return act;
  return names[0] || '';
}
function temuActiveStore() {
  const n = temuActiveStoreName();
  if (n) return temuStores()[n];
  // legacy single-store fallback
  const s = State.data?.settings || {};
  if (s.temuTemplateB64 || s.temuConfig) return { templateB64: s.temuTemplateB64, templateName: s.temuTemplateName, config: s.temuConfig };
  return null;
}
async function temuSaveStores(stores, active) {
  const patch = { temuStores: stores };
  if (active !== undefined) patch.temuActiveStore = active;
  const ok = await msg({ action: 'UPDATE_SETTINGS', settings: patch });
  if (ok?.success) {
    State.data.settings.temuStores = stores;
    if (active !== undefined) State.data.settings.temuActiveStore = active;
    return true;
  }
  console.warn('[Temu] temuSaveStores failed:', ok);
  return (ok && (ok.error || ok.reason)) ? String(ok.error || ok.reason) : 'save failed';
}
async function temuMigrateLegacyIfNeeded() {
  const s = State.data?.settings || {};
  if (Object.keys(temuStores()).length) return;
  if (s.temuTemplateB64 || s.temuConfig) {
    const stores = { 'Store 1': { templateB64: s.temuTemplateB64 || '', templateName: s.temuTemplateName || '', config: s.temuConfig || null } };
    await temuSaveStores(stores, 'Store 1');
  }
}
function temuRenderStoreBar() {
  const sel = $('temuStoreSel'); if (!sel) return;
  const stores = temuStores(); const act = temuActiveStoreName();
  sel.innerHTML = '';
  Object.keys(stores).forEach(n => {
    const o = document.createElement('option');
    o.value = n; o.textContent = n; if (n === act) o.selected = true;
    sel.appendChild(o);
  });
  if (!Object.keys(stores).length) {
    const o = document.createElement('option'); o.value = ''; o.textContent = '— Add store first —'; sel.appendChild(o);
  }
  temuUpdateTplStatus();
}

function temuGetCfg() {
  const base = JSON.parse(JSON.stringify(TEMU_DEFAULT_CONFIG));
  if (typeof TEMU_OFFICIAL_CATEGORIES !== 'undefined' && (!base.category_profiles || Object.keys(base.category_profiles).length <= 5)) {
    base.category_profiles = JSON.parse(JSON.stringify(TEMU_OFFICIAL_CATEGORIES));
  }
  const saved = temuActiveStore()?.config;
  if (!saved || typeof saved !== 'object' || !saved.defaults) return base;
  // merge: ensure official categories from base are always present alongside any store custom categories
  const mergedProfiles = { ...base.category_profiles, ...(saved.category_profiles || {}) };
  return { ...base, ...saved, category_profiles: mergedProfiles, defaults: { ...base.defaults, ...saved.defaults } };
}

function temuCleanTitle(t, cfg, row = null) {
  t = String(t || '').replace(/\s+/g, ' ').trim();
  ['Amazon.com :', 'Amazon.com:', 'Walmart.com:'].forEach(p => { if (t.toLowerCase().startsWith(p.toLowerCase())) t = t.slice(p.length).trim(); });
  // v8.9.0: remove banned/violation words (case-insensitive whole phrases)
  (cfg.title_remove_words || []).forEach(w => {
    w = String(w || '').trim();
    if (!w) return;
    const re = new RegExp('\\b' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'gi');
    t = t.replace(re, ' ');
  });
  t = t.replace(/\s{2,}/g, ' ').replace(/\s+([,.;:!])/g, '$1').replace(/^[\s,.;:\-–]+|[\s,.;:\-–]+$/g, '');
  const cleaned = zhCleanContentClaims(t, row ? zhProductEvidence(row) : t, cfg.title_remove_words || []);
  return cleaned.length > 180 ? cleanTemuTitleResult(cleaned) : cleaned;
}

function temuSourceIdentity(url) { try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase() + '|' + temuSourceId(url); } catch (_) { return ''; } }
function temuSourceId(url) {
  let m = String(url).match(/-g-(\d{8,})\.html/); if (m) return m[1];        // Temu product
  m = String(url).match(/goods_id=(\d{6,})/); if (m) return m[1];              // Temu goods link
  m = String(url).match(/\/dp\/([A-Z0-9]{10})/); if (m) return m[1];
  m = String(url).match(/\/ip\/(?:[^\/]+\/)?(\d{6,})/); if (m) return m[1];
  m = String(url).match(/\/(\d{6,})(?:[\/?]|$)/); if (m) return m[1];
  return String(url).replace(/\W+/g, '').slice(-12);
}

function temuColorsIn(text, cfg) {
  const tl = ' ' + String(text || '').toLowerCase() + ' ';
  const found = [];
  cfg.colors.forEach(c => {
    if (new RegExp('\\b' + c.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b').test(tl)) {
      const cc = c === 'Gray' ? 'Grey' : c;
      if (!found.includes(cc)) found.push(cc);
    }
  });
  // "Navy Blue" should not also yield "Blue"
  return found.filter(c => !found.some(o => o !== c && o.toLowerCase().includes(c.toLowerCase())));
}

// ── v9.0.1 Simple smart variations ──────────────────────────
// Temu par variation baad mein edit nahi hoti, is liye values SIMPLE rakhi jati hain (koi number/wazan nahi):
//   real color (variant/title)  → Color: Black
//   multi-pack (12 pk, 24 ct, dozen, multipack, bundle) → Style: Multipack
//   single (1 pack, single, each) → Style: 1 Pack
//   kuch na mile → Style: <cfg.simple_variation_values mein se ek — product id se fixed>  (default White, Special, New, Standard)
const TEMU_MULTIPACK_RE = /\b(\d{1,4})\s*[- ]?\s*(?:(?:mega|giant|double|triple|jumbo|super|family|large|big|regular)\s+)?(pk|pack|packs|ct|count|pcs|pieces|rolls|bags|cans|bottles|pouches|balls|bars|sheets|tablets|capsules|servings|units|sets)\b|\bpack\s+of\s+(\d{1,4})\b|\b(dozen|multipack|multi-pack|bundle|variety pack|assorted)\b/i;
const TEMU_SINGLE_RE = /\b(1|one|single)\s*[- ]?\s*(pk|pack|piece|pc|ct|count|unit|each)\b|\b(single|each)\b/i;
function temuPackKind(text) {
  const t = String(text || '');
  const m = t.match(TEMU_MULTIPACK_RE);
  if (m) {
    const n = +(m[1] || m[3] || 0);
    if (m[4]) return 'multi';
    if (n >= 2) return 'multi';
    if (n === 1) return 'single';
  }
  if (TEMU_SINGLE_RE.test(t)) return 'single';
  return '';
}
function temuHashPick(list, key) {
  if (!list.length) return '';
  let h = 0; const k = String(key || '');
  for (let i = 0; i < k.length; i++) h = (h * 31 + k.charCodeAt(i)) >>> 0;
  return list[h % list.length];
}
function temuSmartVariation(title, variantText, cfg, prof, seedKey) {
  const legacyColor = () => {
    const vc = temuColorsIn(variantText, cfg), tc = temuColorsIn(title, cfg);
    let color = vc.join('/'); if (tc.length > vc.length) color = tc.join('/');
    return color;
  };
  if (cfg.smart_variations === false) {
    return { type: cfg.defaults.variation_theme || 'Color', value: legacyColor() || (prof && prof.default_color) || cfg.defaults.default_color || 'White' };
  }
  // 1) real color wins — v9.6.4: sirf "White" (golf balls ka default rang) ko informative nahi maante,
  //    warna har listing "White" dikhti hai; us case mein Style keyword / rotation use hota hai
  const color = legacyColor();
  if (color && !/^white$/i.test(color)) return { type: 'Color', value: color };
  // 2) pack kind — simple words only, never the number
  const kind = temuPackKind(variantText) || temuPackKind(title);
  if (kind === 'multi') return { type: 'Style', value: 'Multipack' };
  if (kind === 'single') return { type: 'Style', value: '1 Pack' };
  // 3) v9.6.4: title keyword → Style (Tour / Soft / Distance / Premium / Special / New …)
  const sw = temuStyleWord(title);
  if (sw) return { type: 'Style', value: sw };
  // 4) profile default — sirf jab profile mein "fixed: true" ho (warna sab listings ek jaisi lagti hain)
  if (prof && prof.default_variation && prof.default_variation.type && prof.default_variation.fixed === true)
    return { type: prof.default_variation.type, value: prof.default_variation.value || 'Standard' };
  // 5) rotating simple value per product from the list (White nikaal kar)
  const list = (Array.isArray(cfg.simple_variation_values) ? cfg.simple_variation_values : []).map(x => String(x).trim()).filter(x => x && !/^white$/i.test(x));
  const v = temuHashPick(list.length ? list : ['Standard', 'Special', 'New', 'Classic'], seedKey || title);
  return { type: /^(red|black|yellow|grey|gray|blue|green|purple|orange|pink|brown)$/i.test(v) ? 'Color' : 'Style', value: v };
}
// v9.6.4 — title ke lafz se ek saaf Style value (Temu par variation baad mein edit nahi hoti, is liye sirf simple words)
const TEMU_STYLE_WORDS = [
  [/\b(chrome tour|tour soft|tour response|tp5|tour)\b/i, 'Tour'],
  [/\b(supersoft|super soft|speedsoft|speed soft|soft|erc soft|chrome soft)\b/i, 'Soft'],
  [/\b(velocity|distance|warbird|speed|max)\b/i, 'Distance'],
  [/\b(pro v1x?|avx|premium|prior generation|left dash)\b/i, 'Premium'],
  [/\b(ink|nfl|cinco de mayo|limited|special edition|holiday|edition)\b/i, 'Special'],
  [/\b(20(2[4-9]|3\d)|new)\b/i, 'New'],
  [/\b(organic|natural)\b/i, 'Natural'],
  [/\b(heavy duty|heavyweight|ultra|strong|commercial)\b/i, 'Heavy Duty'],
  [/\b(unscented|fragrance free|sensitive)\b/i, 'Sensitive'],
  [/\b(variety|assorted|mix)\b/i, 'Assorted']
];
function temuStyleWord(title) {
  const t = String(title || '');
  for (const [re, val] of TEMU_STYLE_WORDS) if (re.test(t)) return val;
  return '';
}

// ── v9.2.0 Smart weight (title se) ──────────────────────────
// "3.15 Lb Bag" → 3.15 lb · "24 oz" → 1.5 lb · "2 oz, 6 Count" → 12 oz · "1 Gallon" → 8.6 lb
// Packaging +10%, 0.1 lb round-up. Returns null if title mein koi wazan nahi.
function temuWeightFromTitle(title) {
  const t = ' ' + String(title || '').toLowerCase().replace(/[,;()]/g, ' ') + ' ';
  const num = '(\\d{1,4}(?:\\.\\d+)?)';
  let lb = null, m;
  if ((m = t.match(new RegExp('\\b' + num + '\\s*(?:fl\\.?\\s*oz|fluid ounces?)\\b')))) lb = +m[1] / 16 * 1.04;
  else if ((m = t.match(new RegExp('\\b' + num + '\\s*(?:lbs?|pounds?)\\b')))) lb = +m[1];
  else if ((m = t.match(new RegExp('\\b' + num + '\\s*(?:oz|ounces?)\\b')))) lb = +m[1] / 16;
  else if ((m = t.match(new RegExp('\\b' + num + '\\s*(?:kg|kilograms?)\\b')))) lb = +m[1] * 2.2046;
  else if ((m = t.match(new RegExp('\\b' + num + '\\s*(?:g|grams?)\\b')))) lb = +m[1] / 453.6;
  else if ((m = t.match(new RegExp('\\b' + num + '\\s*(?:gal|gallons?)\\b')))) lb = +m[1] * 8.6;
  else if ((m = t.match(new RegExp('\\b' + num + '\\s*(?:qt|quarts?)\\b')))) lb = +m[1] * 2.2;
  else if ((m = t.match(new RegExp('\\b' + num + '\\s*(?:l|liters?|litres?)\\b')))) lb = +m[1] * 2.3;
  else if ((m = t.match(new RegExp('\\b' + num + '\\s*(?:ml|milliliters?)\\b')))) lb = +m[1] / 473 * 1.04;
  if (lb === null || !isFinite(lb) || lb <= 0) return null;
  // per-unit weight × pack count ("2 oz, 6 Count", "16 oz 4 pack") — sirf jab result maqool ho
  const c = t.match(/\b(\d{1,3})\s*[- ]?\s*(?:ct|count|pk|pack|packs|pouches|bars|cans|bottles|jars|boxes)\b/);
  if (c) { const n = +c[1]; if (n >= 2 && n <= 48 && lb < 3) lb = lb * n; }   // heavy total → max_weight skip handles it
  lb = lb * 1.10;                          // packaging
  return Math.max(0.2, Math.ceil(lb * 10) / 10);
}

// v9.12.0 — department of a category profile ("Grocery & Gourmet Food / Snacks / …" → "Grocery & Gourmet Food")
function temuDeptOf(prof) {
  if (!prof) return '';
  if (prof.department) return String(prof.department).trim();
  const fp = String(prof.full_path || '');
  return fp ? fp.split('/')[0].trim() : '';
}
// all departments known from the category profiles (+ ones already priced)
function temuDepartments(cfg) {
  const set = new Set();
  Object.values(cfg.category_profiles || {}).forEach(p => { const d = temuDeptOf(p); if (d) set.add(d); });
  Object.keys(cfg.dept_pricing || {}).forEach(d => set.add(d));
  return [...set].sort((a, b) => a.localeCompare(b));
}
// first matching category profile for a title → [name, profile]
function temuProfileFor(title, cfg) {
  const tl = String(title || '').toLowerCase();
  for (const [name, p] of Object.entries(cfg.category_profiles || {})) {
    if ((p.exclude || []).some(m => m && tl.includes(String(m).toLowerCase()))) continue;
    if ((p.match || []).some(m => m && tl.includes(String(m).toLowerCase()))) return [name, p];
  }
  return ['', {}];
}
// v9.12.0 — which multiplier / min / max applies: category → department → store default
function temuPriceRule(cfg, prof) {
  const num = v => { const x = parseFloat(v); return isFinite(x) && x > 0 ? x : null; };
  const dept = temuDeptOf(prof);
  const dp = (dept && (cfg.dept_pricing || {})[dept]) || {};
  let px = num(cfg.price_multiplier) || 1, src = 'store';
  if (num(dp.px)) { px = num(dp.px); src = dept; }
  if (prof && num(prof.price_multiplier)) { px = num(prof.price_multiplier); src = prof.name || prof.category_keyword || 'category'; }
  const min = num(prof?.price_min) ?? num(dp.min) ?? num(cfg.price_min) ?? 80;
  const max = num(dp.max) ?? num(cfg.price_max) ?? 999;
  return { px, min, max, src, dept };
}

function temuPrice(src, cfg, prof) {
  const p = parseFloat(String(src ?? '').replace(/[$,]/g, ''));
  if (!isFinite(p) || p <= 0) return [null, null, null];
  const rule = temuPriceRule(cfg, prof);
  let base = p * rule.px;
  if (base < rule.min) base = rule.min;
  if (base > rule.max) base = rule.max;
  if (rule.min > rule.max) throw new Error('Price minimum cannot exceed maximum');
  if (cfg.price_round_to_99 !== false) {
    const rounded = Math.floor(base) + 0.99;
    base = rounded <= rule.max ? rounded : Math.floor(rule.max - 0.99) + 0.99;
    if (base < rule.min) base = rule.min;
  }
  let list = base * (cfg.list_price_multiplier || 1.25);
  if (cfg.price_round_to_99 !== false) list = Math.floor(list) + 0.99;
  return [Math.round(base * 100) / 100, Math.round(list * 100) / 100, rule];
}

// rows: bulk/master row objects → enriched Temu items + warnings
function temuEnrich(rows, cfg) {
  const items = [], usedSku = new Set(), seenSrc = new Set(), skipped = [];
  const d = cfg.defaults;
  rows.forEach(r => {
    const title = temuCleanTitle(r.title, cfg, r);
    const url = r.url || '';
    if (!title || !url) { skipped.push((!url ? 'no url: ' : 'no title: ') + String(r.title || r.url || '?').slice(0, 40)); return; } // v9.7.2: chup-chaap drop nahi
    let uhost = ''; try { uhost = new URL(url).hostname; } catch (_) {}
    if (/temu\.com$/i.test(uhost) && !isTemuProductUrl(url)) { skipped.push('not a product (Temu page): ' + title.slice(0, 40)); return; }
    if (/^Temu\s*\|/i.test(title)) { skipped.push('not a product (Temu page): ' + title.slice(0, 40)); return; }
    if (/\/s\?k=|amazon\.[a-z.]+\/s\b|walmart\.com\/search|samsclub\.com\/s(\/|\?)/i.test(url)) { skipped.push('search page: ' + title.slice(0, 40)); return; }
    const sid = temuSourceId(url);
    if (!/^[A-Z0-9]{10}$/.test(sid) && !/^\d{6,}$/.test(sid)) { skipped.push('invalid product url: ' + title.slice(0, 40)); return; }
    const identity = temuSourceIdentity(url);
    if (seenSrc.has(identity)) { skipped.push('duplicate: ' + title.slice(0, 40)); return; }
    seenSrc.add(identity);
    if (cfg.skip_listed !== false) {
      const rec = temuListedMap()[(temuActiveStoreName() || 'default') + '|' + identity] || temuListedMap()[(temuActiveStoreName() || 'default') + '|' + sid];
      if (rec) { skipped.push(`already listed (${rec.d}): ` + title.slice(0, 40)); return; }
    }

    // profile
    const tl = title.toLowerCase();
    let [profName, prof] = temuProfileFor(title, cfg);
    // brand
    // Brand: scraped brand → exact/partial match against the store's Temu brand list; fallback: title keywords
    let brand = '';
    const validBrands = {}; Object.keys(cfg.trademarks).forEach(k => { validBrands[k.toLowerCase()] = k; });
    const bcol = String(r.brand || '').toLowerCase().trim();
    if (bcol) {
      brand = validBrands[bcol]
        || (Object.entries(validBrands).find(([k]) => k.includes(bcol) || bcol.includes(k)) || [])[1]
        || '';
    }
    if (!brand) { const t2 = ' ' + tl + ' '; for (const [k, v] of Object.entries(cfg.brands)) { if (t2.includes(k)) { brand = v; break; } } }
    const tm = cfg.trademarks[brand] || brand;

    // variation: smart (Color / Quantity / Weight / Capacity / Size / fallback) — see temuSmartVariation
    const variation = temuSmartVariation(title, r.color, cfg, prof, sid);
    let vtype = variation.type, color = variation.value;
    if (r.copyColor) { color = String(r.copyColor).trim(); vtype = 'Color'; } // Store Copy override

    // (price is computed after the category is final — see below)
    let base = null, list = null, priceRule = null;
    if (r.temuBase) {
      const tb = parseFloat(String(r.temuBase).replace(/[$,]/g, ''));
      if (isFinite(tb) && tb > 0) {
        base = Math.round(tb * 100) / 100;
        list = Math.round(base * (cfg.list_price_multiplier || 1.25) * 100) / 100;
        if (cfg.price_round_to_99 !== false) list = Math.floor(list) + 0.99;
      }
    }
    const supplier = new URL(url).hostname.replace(/^www\./, '').split('.')[0].replace(/[^a-z0-9]/gi, '').toUpperCase();
    const goods = `${cfg.sku_prefix}-${supplier}-${sid}`;
    const vsfx = color.replace(/[^A-Za-z0-9]+/g, '') || 'Std';
    let sku = `${goods}-${vsfx}`;
    let n = 2; while (usedSku.has(sku)) sku = `${goods}-${vsfx}-${n++}`;
    usedSku.add(sku);

    const num = (v, def) => { const x = parseFloat(v); return isFinite(x) && x > 0 ? Math.round(x * 10) / 10 : def; };
    const images = (Array.isArray(r.images) ? r.images : []).filter(u => typeof u === 'string' && /^https?:\/\//i.test(u) && (/\.(jpe?g|png|webp)(\?|$)/i.test(u) || u.includes('iili.io') || u.includes('image'))).slice(0, cfg.max_sku_images);

    if (r.copyCat && !profName) {
      const hit = Object.entries(cfg.category_profiles || {}).find(([, p]) =>
        String(p.category_keyword || '').toLowerCase() === String(r.copyCat).toLowerCase());
      if (hit) { profName = hit[0]; prof = hit[1]; }
      else prof = { category_keyword: r.copyCat };
    }

    const customPx = base !== null;
    if (!customPx) [base, list, priceRule] = temuPrice(r.price, cfg, prof);
    const pxLabel = customPx ? '(custom price)' : priceRule ? `×${priceRule.px} (${priceRule.src === 'category' ? (profName || 'category') : priceRule.src})` : '';

    const warn = [];
    if (!images.length) warn.push('NO_IMAGES');
    if (!brand) warn.push('NO_BRAND_MATCH');
    if (base === null) warn.push('NO_PRICE');
    if (!profName && !r.copyCat) warn.push('NO_CATEGORY_PROFILE');

    // weight: profile → title (smart) → scraped (0.1–8 lb) → global default; > max → skip
    const scrapedWeight = parseFloat(r.weight);
    if (Number.isFinite(scrapedWeight) && scrapedWeight > (cfg.max_weight_lb || 8)) { skipped.push('too heavy (sourced ' + scrapedWeight + ' lb): ' + title.slice(0, 40)); return; }
    let weight = Number.isFinite(scrapedWeight) && scrapedWeight > 0 ? scrapedWeight : (prof.weight_lb ?? null), wsrc = Number.isFinite(scrapedWeight) && scrapedWeight > 0 ? 'scraped' : weight != null ? 'profile' : '';
    if (weight == null && cfg.smart_weight !== false) {
      const tw = temuWeightFromTitle(title);
      if (tw) { weight = tw; wsrc = 'title'; }
      else { const sw = parseFloat(r.weight); if (isFinite(sw) && sw >= 0.1 && sw <= (cfg.max_weight_lb || 8)) { weight = Math.round(sw * 10) / 10; wsrc = 'scraped'; } }
    }
    if (weight == null) { weight = d.weight_lb; wsrc = 'default'; }
    if (cfg.max_weight_lb && weight > cfg.max_weight_lb) { skipped.push(`too heavy (${weight} lb from ${wsrc}): ` + title.slice(0, 40)); return; }
    if (wsrc === 'default') warn.push('DEFAULT_WEIGHT');

    // v9.12.0 — description + bullet points
    const copy = cfg.fill_description !== false ? temuBuildCopy(r, title, cfg, !!brand) : { bullets: [], description: '' };
    if (cfg.fill_description !== false && !copy.bullets.length) warn.push('NO_BULLETS');

    items.push({
      title, url, goods, sku, brand, trademark: tm, color, vtype, images, wsrc,
      bullets: copy.bullets, description: copy.description, pxLabel,
      category_keyword: prof.category_keyword || '',
      keyword_attributes: prof.keyword_attributes || '',
      base, list, sourcingPrice: r.sourcingPrice !== '' && r.sourcingPrice != null ? r.sourcingPrice : (r.price ?? ''),
      qty: Math.floor(Math.random() * (cfg.quantity_max - cfg.quantity_min + 1)) + cfg.quantity_min,
      weight, dimL: num(r.dimL, prof.length_in ?? d.length_in),
      dimW: num(r.dimW, prof.width_in ?? d.width_in), dimH: num(r.dimH, prof.height_in ?? d.height_in),
      warn
    });
  });
  return { items, skipped };
}

// Fill the Temu general template (SheetJS workbook) from row 5
function temuFillTemplate(wb, items, cfg) {
  const ws = wb.Sheets['Template'];
  if (!ws) throw new Error('Template sheet not found — is this the Temu General template?');
  // header keys are in row 3 (0-based r=2)
  const range = XLSX.utils.decode_range(ws['!ref']);
  const keyCols = {}; // key -> [colIdx,...]
  for (let c = range.s.c; c <= range.e.c; c++) {
    const cell = ws[XLSX.utils.encode_cell({ r: 2, c })];
    const k = cell && String(cell.v).trim();
    if (k) { (keyCols[k] = keyCols[k] || []).push(c); }
  }
  const required = ['item_name','listing_id','seller_sku','category','main_image_url','map_price','list_price','quantity','item_weight','shipping_template'];
  const missing = required.filter(key => !keyCols[key]);
  if (missing.length) throw new Error('Incomplete Temu general template: ' + missing.join(', '));
  for (const address of Object.keys(ws)) if (!address.startsWith('!') && XLSX.utils.decode_cell(address).r >= 4) delete ws[address];
  const d = cfg.defaults;
  const put = (r, key, val, idx = 0) => {
    const cols = keyCols[key];
    if (!cols || idx >= cols.length || val === null || val === undefined || val === '') return;
    ws[XLSX.utils.encode_cell({ r, c: cols[idx] })] = { t: typeof val === 'number' ? 'n' : 's', v: val };
  };
  let r = 4; // row 5 (0-based)
  items.forEach(it => {
    put(r, 'listing_id', it.goods); put(r, 'seller_sku', it.sku);
    put(r, 'item_name', it.title); put(r, 'category', it.category_keyword);
    put(r, 'brand', it.brand); put(r, 'trademark', it.trademark);
    put(r, 'Keyword_attributes', it.keyword_attributes);
    (it.bullets || []).slice(0, 6).forEach((b, i) => put(r, 'item_note', String(b).slice(0, 700), i));
    if (it.description) put(r, 'item_description', String(it.description).slice(0, 2000));
    put(r, 'Variation_type_1', it.vtype || d.variation_theme); put(r, 'Variation_Variants_1', it.color);
    if (it.images.length) {
      put(r, 'main_image_url', it.images[0]);
      it.images.slice(1, getMaxHuntImages()).forEach((u, i) => put(r, 'other_image_url', u, i));
    }
    put(r, 'map_price', it.base); put(r, 'list_price', it.list);
    put(r, 'quantity', it.qty);
    put(r, 'item_length', it.dimL); put(r, 'item_volume_unit', 'in');
    put(r, 'item_width', it.dimW); put(r, 'item_height', it.dimH);
    put(r, 'item_weight', it.weight); put(r, 'item_weight_unit', 'lb');
    put(r, 'shipping_template', d.shipping_template); put(r, 'handling_time', d.handling_time);
    put(r, 'fulfillment_channel', d.fulfillment_channel); put(r, 'origin_country', d.origin_country);
    r++;
  });
  range.e.r = Math.max(3, r - 1);
  ws['!ref'] = XLSX.utils.encode_range(range);
  return r - 4;
}

let TemuLast = null; // { bytes, items, skipped, n } from the last export
let TemuLibPick = null; // v9.6.1: Library tab se chune huay products {ids:Set, n}
let TemuSheetRows = null; // v9.7.0: Temu window mein import ki hui sheet ke rows

function temuSourcingSnapshot() {
  return { id: TemuLast.sourcingId || (TemuLast.sourcingId = 'src_' + crypto.randomUUID()), t: Date.now(), store: TemuLast.store || temuActiveStoreName(), items: TemuLast.items.map(it => ({ title: it.title, url: it.url, sourcingPrice: it.sourcingPrice, list: it.list })) };
}

async function temuRunExport(opts = {}) {
  const rep = $('temuReport');
  const say = t => { if (rep) { rep.textContent = t; try { rep.scrollIntoView({ block: 'nearest' }); } catch (_) {} } };
  // v9.7.1: imported Temu file as-is — koi conversion nahi
  if (($('temuSource')?.value || '') === 'sheet' && TemuLast?.asIs) {
    if (!opts.forUpload) { zhSaveBlob(new Blob([TemuLast.bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'temu_upload.xlsx'); toast('Temu file download', 'ok'); }
    return;
  }
  try {
    const b64 = temuActiveStore()?.templateB64;
    if (!b64) {
      const sn = temuActiveStoreName() || '(koi store select nahi)';
      say(`✗ Store "${sn}" ke liye Temu template file select nahi hui.\n→ Upar "Template" wale box se Temu ki general template (.xlsx) ek baar select karein (Temu → Add products via upload → General template → Download).`);
      toast('Is store ka Temu template select karein', 'warn'); return;
    }
    const cfg = temuGetCfg();
    // Live-read the modal fields — whatever is visible applies, even without Save
    { const v = $('tgWords')?.value; if (v !== undefined && v !== null) cfg.title_remove_words = v.split(',').map(x => x.trim()).filter(Boolean); }
    { const sk = $('tgSkipListed'); if (sk) cfg.skip_listed = !!sk.checked; }
    { const sv = $('tgSmartVar'); if (sv) cfg.smart_variations = !!sv.checked; }
    { const bgc = $('tgBgUpload'); if (bgc) cfg.upload_in_background = !!bgc.checked; }
    { const swc = $('tgSmartWeight'); if (swc) cfg.smart_weight = !!swc.checked; }
    { const lp = parseFloat($('tgListPx')?.value); if (isFinite(lp) && lp > 0) cfg.list_price_multiplier = lp; }
    { const a = parseInt($('tgQtyMin')?.value, 10), b = parseInt($('tgQtyMax')?.value, 10); if (a > 0 && b >= a) { cfg.quantity_min = a; cfg.quantity_max = b; } }
    { const mw = parseFloat($('tgMaxW')?.value); if (isFinite(mw) && mw > 0) cfg.max_weight_lb = mw; }
    { const vv = $('tgVarValues')?.value; if (vv !== undefined && vv !== null && vv.trim()) cfg.simple_variation_values = vv.split(',').map(x => x.trim()).filter(Boolean); }
    { const px = parseFloat($('tgPx')?.value); if (isFinite(px) && px > 0) cfg.price_multiplier = px; }
    temuApplyLiveCopyPrice(cfg);
    { const num = v => { const x = parseFloat(v); return isFinite(x) && x > 0 ? x : null; };
      const w = num($('tgW')?.value), l = num($('tgL')?.value), wd = num($('tgWd')?.value), ht = num($('tgH')?.value);
      if (w) cfg.defaults.weight_lb = w; if (l) cfg.defaults.length_in = l;
      if (wd) cfg.defaults.width_in = wd; if (ht) cfg.defaults.height_in = ht; }
    const source = $('temuSource')?.value || 'bulk';
    let rows = (await temuGetQueuedRows()).filter(r => !TemuReviewExcluded.has(r.id));
    rows = JSON.parse(JSON.stringify(rows));
    if (!rows.length) { say('✗ Export ke liye koi product nahi mila.\n→ Bulk tab → "Hunt all open tabs" chalayen (ya data source "Library" karein), phir dobara try karein.'); toast('No products — pehle hunt karein', 'warn'); return; }
    say('Checking images & converting ' + rows.length + ' products…');

    // Ensure any pasted or edited base64/blob images are converted to public HTTPS URLs for Temu (Fast Parallel)
    const pendingUploads = [];
    rows.forEach(r => {
      if (Array.isArray(r.images)) {
        r.images.forEach((img, idx) => {
          if (typeof img === 'string' && (img.startsWith('data:image/') || img.startsWith('blob:') || /^https:\/\/flow-content\.google\//i.test(img))) {
            pendingUploads.push({ row: r, index: idx, img });
          }
        });
      }
    });

    if (pendingUploads.length > 0) {
      say(`Uploading ${pendingUploads.length} edited image(s) to cloud for Temu…`);
      let doneCount = 0;
      const CONCURRENCY = 4;
      for (let i = 0; i < pendingUploads.length; i += CONCURRENCY) {
        const chunk = pendingUploads.slice(i, i + CONCURRENCY);
        await Promise.all(chunk.map(async (item) => {
          try {
            const pub = await uploadImageToPublicHost(item.img);
            if (!pub || !/^https?:\/\//i.test(pub) || /^https:\/\/flow-content\.google\//i.test(pub)) throw new Error('Edited image is not on a public host');
            item.row.images[item.index] = pub;
          } catch (e) { throw new Error('Image upload failed for ' + item.row.title + ': ' + e.message); }
          doneCount++;
          say(`Cloud image upload: ${doneCount}/${pendingUploads.length} done…`);
        }));
      }
      await zhLibPatch(saved => { let changed = false; for (const row of rows) { const m = saved.find(x => x.id === row.id || x.url === row.url); if (m) { m.images = [...row.images]; changed = true; } } return changed; });
    }

    const { items, skipped } = temuEnrich(rows, cfg);
    if (!items.length) {
      say('Koi naya product nahi:\n' + (skipped.length ? skipped.map(x => '• ' + x).join('\n') : '(list khali hai)') +
        '\n\nAgar dobara list karna hai to "Pehle se listed" checkbox off karein.');
      return;
    }
    const blockers = items.filter(it => it.warn.some(w => ['NO_IMAGES', 'NO_PRICE', 'NO_CATEGORY_PROFILE'].includes(w)));
    if (blockers.length) throw new Error('Export blocked: ' + blockers.map(it => it.title.slice(0, 45) + ': ' + it.warn.filter(w => ['NO_IMAGES','NO_PRICE','NO_CATEGORY_PROFILE'].includes(w)).join(', ')).join(' | '));
    const wb = XLSX.read(b64, { type: 'base64', cellStyles: true });
    const n = temuFillTemplate(wb, items, cfg);
    const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx', cellStyles: true });
    TemuLast = { bytes: out, items, skipped, n, marked: false, store: temuActiveStoreName(), sourcingId: 'src_' + crypto.randomUUID() };
    // v9.3.1: listed-history ab sirf CONFIRMED upload ke baad mark hoti hai (export-only par nahi).
    { const mb = $('temuMarkListedBtn'); if (mb) { mb.hidden = !!opts.forUpload; mb.textContent = `Mark ${n} as listed`; } }
    zhSaveBlob(new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'temu_upload.xlsx');
    if (!opts.forUpload) { try { await temuHistAdd({ kind: 'export', store: temuActiveStoreName() || '—', n, skipped: skipped.length, source: $('temuSource')?.selectedOptions?.[0]?.textContent || '', items: temuHistItems(items), skippedList: skipped.slice(0, 300) }); } catch (_) {} }
    const lines = items.map(it => `${it.sku}  ${it.brand || '—'}  ${it.vtype || 'Color'}: ${it.color}  ${it.weight}lb(${it.wsrc || '?'})  img=${it.images.length}  $${it.base ?? '—'}${it.pxLabel ? ' ' + it.pxLabel : ''}  bullets=${(it.bullets || []).length}${it.warn.length ? '  ⚠ ' + it.warn.join(',') : ''}`);
    say(`✓ ${n} products → temu_upload.xlsx\n` + (skipped.length ? `Skipped: ${skipped.length} (${skipped.slice(0,3).join('; ')}${skipped.length>3?'…':''})\n` : '') + lines.join('\n'));
    toast(`Temu file ready — ${n} products`, 'ok');
    temuUpdateSrcInfo();
  } catch (e) {
    say('ERROR: ' + (e?.message || e));
    toast('Temu export failed', 'err');
  }
}


let TemuUploadBusy = false;
async function temuAutoUpload() {
  if (TemuUploadBusy) { toast('Upload already running', 'info'); return; }
  TemuUploadBusy = true;
  const button = $('temuAutoBtn'); if (button) button.disabled = true;
  try { await temuAutoUploadJob(); }
  finally { TemuUploadBusy = false; if (button) button.disabled = false; }
}
async function temuAutoUploadJob() {
  const rep = $('temuReport');
  const say = t => { if (rep) { rep.textContent = t; try { rep.scrollIntoView({ block: 'nearest' }); rep.scrollTop = rep.scrollHeight; } catch (_) {} } };
  // Build fresh if nothing exported yet in this session
  if (!TemuLast?.asIs) { TemuLast = null; await temuRunExport({ forUpload: true }); }
  if (!TemuLast) return;
  { const mb = $('temuMarkListedBtn'); if (mb) mb.hidden = true; }
  const sourcingSnapshot = temuSourcingSnapshot();
  const uploadSnapshot = { ...TemuLast, bytes: new Uint8Array(TemuLast.bytes).slice(), items: JSON.parse(JSON.stringify(TemuLast.items)), skipped: [...(TemuLast.skipped || [])] };
  const bg = temuGetCfg().upload_in_background !== false;
  say((rep?.textContent || '') + (bg ? '\n\nTemu tab khul raha hai — processing poori hote hi focus wapas aap ke tab par aa jayega…' : '\n\nTemu page khul raha hai…'));
  try {
    const u8 = new Uint8Array(uploadSnapshot.bytes);
    let bin = '';
    for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    const b64 = btoa(bin);
    // v9.1.0: poora kaam background service worker karta hai (TEMU_AUTO_UPLOAD) — side panel
    // sirf result dikhata hai. Tab inactive khulta hai; zaroorat par 1-2 sec ke liye saamne aata hai.
    // v9.4.3 — live progress line (⏳ …) from the Temu tab while the background worker waits
    const base = rep?.textContent || '';
    const fmtProg = (p) => {
      const t = p.secs != null ? ` · ${p.secs}s` : '';
      const id = p.uploadId ? ` · ID ${String(p.uploadId).slice(-6)}` : '';
      if (p.phase === 'uploading')  return `⏳ File Temu par upload ho rahi hai${t}…`;
      if (p.phase === 'accepted')   return `⏳ Temu ne file uthaa li${id} — processing shuru…`;
      if (p.phase === 'processing') return `⏳ Processing data ${p.pct != null ? p.pct : 0}%${id}${t}…`;
      if (p.phase === 'finishing')  return `⏳ Processing khatam — result parh raha hoon${id}${t}…`;
      return `⏳ ${p.phase}${t}…`;
    };
    const onProg = (m) => { if (m?.action === 'TEMU_UPLOAD_PROGRESS' && rep) rep.textContent = base + '\n' + fmtProg(m); };
    try { chrome.runtime.onMessage.addListener(onProg); } catch (_) {}
    let result;
    try { result = await msg({ action: 'TEMU_AUTO_UPLOAD', b64, filename: 'temu_upload.xlsx', expectStore: sourcingSnapshot.store, background: bg, sourcing: sourcingSnapshot }); }
    finally { try { chrome.runtime.onMessage.removeListener(onProg); } catch (_) {} }
    if (result?.recoveryRequired) {
      say('Previous upload was interrupted. Check Temu upload history before retrying.');
      if (confirm('Check the previous upload in Temu first. Have you reviewed its result? This unlocks future uploads without resending this file.')) {
        const acknowledged = await msg({action:'TEMU_UPLOAD_REVIEWED'});
        if (!acknowledged?.success) throw new Error(acknowledged?.error || 'Could not unlock upload');
        say('Previous upload review saved. Select only products that still need uploading.');
      }
      return;
    }
    if (rep) rep.textContent = base; // drop the live ⏳ line
    // v9.4.3 — result numbers from the report ("Completed: 28 records processed, 28 added, 0 errors")
    const rl = (result?.report || []).join('\n');
    const rm = rl.match(/(\d+) records processed, (\d+) added, (\d+) errors/);
    const summary = result?.success
      ? (result?.confirmed
          ? (rm ? `→ Upload ho gaya: ${rm[2]} products add huay${+rm[3] > 0 ? `, ${rm[3]} mein error (Temu tab → "View processing results")` : ', 0 errors'}.`
                : '→ Upload ho gaya. Temu tab peeche khula hai — Upload history mein result wahan dekhein.')
          : '→ File attach ho gayi lekin confirm nahi hua — Temu tab check karein; complete ho jaye to "Mark as listed" daba dein.')
      : '→ Manually upload kar lein (file Download folder mein hai).';
    say((rep?.textContent || '') + '\n' + (result?.report || []).join('\n') + '\n' + summary);
    // v9.7.0: history record
    try {
      const idm = rl.match(/ID (\d{13,20})/);
      await temuHistAdd({ kind: 'upload', store: uploadSnapshot.store, n: uploadSnapshot.items.length, skipped: (uploadSnapshot.skipped || []).length,
        source: $('temuSource')?.selectedOptions?.[0]?.textContent || '', confirmed: !!(result?.success && result?.confirmed), uploadId: idm ? idm[1] : '',
        added: result?.added ?? (rm ? +rm[2] : null), errors: result?.errors ?? (rm ? +rm[3] : null), items: temuHistItems(uploadSnapshot.items), skippedList: (uploadSnapshot.skipped || []).slice(0, 300) });
    } catch (_) {}
    const completeBatch = result?.success && result?.confirmed && result.status === 'Completed' && result.errors === 0 && result.processed === uploadSnapshot.items.length && result.added === uploadSnapshot.items.length;
    if (completeBatch) {
      if (!uploadSnapshot.marked) { await temuMarkListed(uploadSnapshot.items, uploadSnapshot.store, 'accepted'); uploadSnapshot.marked = true; }
      say((rep?.textContent || '') + `\n✓ ${uploadSnapshot.items.length} products accepted-history mein save (live listing status Temu par verify karein)`);
      temuUpdateSrcInfo();
      // v9.6.0: errors hon to Temu ka "View failed details" khud parh kar wajah dikhao
      if (rm && +rm[3] > 0) {
        const idm = rl.match(/ID (\d{13,20})/);
        say((rep?.textContent || '') + '\n⏳ Failed details parh raha hoon…');
        await temuReadFailed({ tabId: result.tabId ?? null, uploadId: idm ? idm[1] : null, silent: true });
        if (rep && rep.textContent.includes('⏳ Failed details parh raha hoon…')) {
          rep.textContent = rep.textContent.replace('⏳ Failed details parh raha hoon…', '✓ Failed details checking mukammal.');
        }
      }
    } else {
      say((rep?.textContent || '') + '\n(Products listed mark NAHI kiye — upload confirm nahi hua; agli export mein dobara aa jayenge)');
      const mb = $('temuMarkListedBtn'); if (mb) { mb.hidden = true; mb.textContent = `Mark ${uploadSnapshot.items.length} as listed`; }
    }
    toast(completeBatch ? 'Temu accepted all products; verify listing status' : result?.success ? 'Upload needs review; check Temu before retrying' : 'Auto-upload fail — file download ho chuki hai', completeBatch ? 'ok' : 'warn');
  } catch (e) {
    say((rep?.textContent || '') + '\n✗ ' + (e?.message || e));
  }
}

// ── v9.0.0 Fix drafts: drive Temu's "Complete product details" page ──
// Builds attribute rules from category profiles: profile.attributes {Label: Value}
// or, if missing, derived from keyword_attributes ("Rubber, 14 Years+" → Material / Age Group).
function temuDraftRules(cfg) {
  const rules = [];
  for (const [name, p] of Object.entries(cfg.category_profiles || {})) {
    let attrs = (p.attributes && typeof p.attributes === 'object') ? { ...p.attributes } : {};
    if (Object.keys(attrs).length) rules.push({ name, match: p.match || [], attributes: attrs });
  }
  return rules;
}
// Reconnect tabs that were already open when the extension was updated.
async function temuEnsurePageReady(tabId, say = () => {}) {
  const ping = () => new Promise(resolve => {
    const timer = setTimeout(() => resolve(false), 1500);
    try {
      chrome.tabs.sendMessage(tabId, { action: 'PING' }, r => {
        const error = chrome.runtime.lastError;
        clearTimeout(timer);
        resolve(!error && r?.ready === true);
      });
    } catch (_) { clearTimeout(timer); resolve(false); }
  });
  if (await ping()) return true;
  say('Temu page se connection dobara bana raha hoon…');
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    if (await ping()) return true;
  } catch (_) {}
  say('Temu page automatically refresh kar raha hoon — phir drafts fix honge…');
  await chrome.tabs.reload(tabId);
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 500));
    const tab = await chrome.tabs.get(tabId);
    if (tab.status !== 'complete') continue;
    if (await ping()) return true;
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
      if (await ping()) return true;
    } catch (_) {}
  }
  return false;
}
async function temuFixDrafts() {
  const rep = $('temuReport');
  const say = t => { if (rep) rep.textContent = t; };
  const cfg = temuGetCfg();
  const rules = temuDraftRules(cfg);
  const defaults = (cfg.draft_default_attributes && typeof cfg.draft_default_attributes === 'object') ? cfg.draft_default_attributes : {};
  // v9.5.2 & v9.12.11: rules na hon tab bhi chalao — khali required fields fallback se bharte hain, bhare huay drafts Submit hote hain
  try {
    // 1. Find an open "product-action.html" (modern) or "products-excel-multiple-edit.html" tab
    let tabs = await chrome.tabs.query({ url: [
      'https://seller.temu.com/product-action.html*',
      'https://seller.temu.com/*product-action*',
      'https://seller.temu.com/products-excel-multiple-edit.html*',
      'https://seller.temu.com/*products-excel-multiple-edit*'
    ] });
    let tab = tabs.find(t => t.active) || tabs[0];

    // 2. If not open, check if "upload-goods-multiple.html" (Upload history) is open and click "Complete product information" / "Edit and submit"
    if (!tab) {
      const upTabs = await chrome.tabs.query({ url: ['https://seller.temu.com/upload-goods-multiple.html*'] });
      const upTab = upTabs.find(t => t.active) || upTabs[0];
      if (upTab) {
        say('Temu upload history tab par "Complete product information" dhoond kar click kar raha hoon…');
        await chrome.tabs.update(upTab.id, { active: true });
        if (!(await temuEnsurePageReady(upTab.id, say))) {
          say('✗ Automatic reconnect aur refresh ke baad bhi Temu se connection nahi bana. Extension ki site access check karein.');
          return;
        }
        const clicked = await new Promise(res => {
          chrome.tabs.sendMessage(upTab.id, { action: 'TEMU_CLICK_ACTION_REQUIRED' }, r => {
            const error = chrome.runtime.lastError;
            res(!error && r?.success);
          });
        });
        if (clicked) {
          await new Promise(r => setTimeout(r, 2500));
          tabs = await chrome.tabs.query({ url: ['https://seller.temu.com/product-action.html*', 'https://seller.temu.com/*product-action*'] });
          tab = tabs.find(t => t.active) || tabs[0];
        }
      }
    }

    if (!tab) {
      say('"Product action required" ya "Complete product details" page khula nahi hai.\n\n1) Temu tab par "Complete product information" ya "Edit and submit" dabayen\n2) Phir yahan dobara "Fix drafts" dabayen.');
      await chrome.tabs.create({ url: 'https://seller.temu.com/upload-goods-multiple.html', active: true });
      toast('Temu upload page khol diya — "Complete product information" dabayen', 'warn');
      return;
    }
    await chrome.tabs.update(tab.id, { active: true });
    say(`Drafts fix ho rahe hain… (${rules.map(r => r.name).join(', ') || 'defaults'})`);
    const ready = await temuEnsurePageReady(tab.id, say);
    if (!ready) { say('✗ Automatic reconnect aur refresh ke baad bhi Temu se connection nahi bana. Extension ki site access check karein.'); return; }
    say('Temu connected — required draft fields fix ho rahe hain…');
    const result = await new Promise(res => chrome.tabs.sendMessage(tab.id,
      { action: 'TEMU_FIX_DRAFTS', rules, defaults, autoSubmit: cfg.draft_auto_submit !== false, expectStore: temuActiveStoreName() },
      r => res(chrome.runtime.lastError ? { success: false, report: ['✗ ' + chrome.runtime.lastError.message] } : r)));
    say((result?.report || []).join('\n'));
    toast(result?.success ? (result.stillEmpty ? `${result.stillEmpty} field(s) khali — report dekhein` : `Drafts: ${result.changed ?? 0} fields set; ${result.submitted ?? 0} submit clicks ? Temu result verify karein`) : 'Fix drafts fail — report dekhein', result?.success && !result.stillEmpty ? 'ok' : 'warn');
  } catch (e) {
    say('✗ ' + (e?.message || e));
  }
}

// ── v9.6.0 Failed details: Temu ke "View failed details" popup se har failed product ki wajah ──
// Duplicate ("Contribution SKU duplicated") wale products = store mein pehle se listed → listed-history mein mark.
const temuNormTitle = t => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
async function temuReadFailed({ tabId = null, uploadId = null, silent = false } = {}) {
  const rep = $('temuReport');
  const say = t => { if (rep) { rep.textContent = t; try { rep.scrollTop = rep.scrollHeight; } catch (_) {} } };
  const add = t => say((rep?.textContent || '') + '\n' + t);
  if (rep && rep.textContent.includes('⏳ Failed details parh raha hoon…')) {
    rep.textContent = rep.textContent.replace('⏳ Failed details parh raha hoon…', '• Checking failed details…');
  }
  try {
    // v9.6.3: kai Temu upload tabs (mukhtalif stores) khule ho sakte hain — us tab ko dhoondo jis ka mall name active store se match kare
    const expectStore = temuActiveStoreName() || '';
    let cands = [];
    if (tabId != null) { const t = await new Promise(r => chrome.tabs.get(tabId, x => r(chrome.runtime.lastError ? null : x))); if (t) cands.push(t); }
    const all = await chrome.tabs.query({ url: ['https://seller.temu.com/upload-goods-multiple.html*'] });
    all.sort((a, b) => (b.active ? 1 : 0) - (a.active ? 1 : 0));
    for (const t of all) if (!cands.some(c => c.id === t.id)) cands.push(t);
    if (!cands.length) {
      if (!silent) { add('"Add products via upload" page khula nahi hai — Temu tab khol raha hoon, phir dobara "Failed details" dabayen.'); await chrome.tabs.create({ url: 'https://seller.temu.com/upload-goods-multiple.html', active: true }); }
      return null;
    }
    const pingOk = id => new Promise(res => { let n = 0; const ping = () => chrome.tabs.sendMessage(id, { action: 'PING' }, r => { if (!chrome.runtime.lastError && r?.ready) return res(true); if (++n > 10) return res(false); setTimeout(ping, 400); }); ping(); });
    let result = null, tab = null;
    for (const t of cands) {
      if (!(await pingOk(t.id))) { add(`• Tab ${t.id}: page se rabta nahi (reload karein)`); continue; }
      const r = await new Promise(res => chrome.tabs.sendMessage(t.id, { action: 'TEMU_READ_FAILED', uploadId, expectStore }, x => res(chrome.runtime.lastError ? { success: false, report: ['✗ ' + chrome.runtime.lastError.message] } : x)));
      if (r?.wrongStore) { add(`• Tab "${r.mall}" skip (active store: ${expectStore})`); continue; }
      result = r; tab = t; break;
    }
    if (!result) { add(`✗ Store "${expectStore}" ka "Add products via upload" tab nahi mila — us store ka Temu upload page kholein`); return null; }
    try { await chrome.tabs.update(tab.id, { active: true }); } catch (_) {}
    (result?.report || []).forEach(add);
    if (!result?.success) return result;
    const failed = result.failed || [];
    if (!failed.length) return result;
    const items = (TemuLast?.items || []);
    const byTitle = new Map(items.map(it => [temuNormTitle(it.title), it]));
    const dupItems = [];
    for (const f of failed) {
      const it = byTitle.get(temuNormTitle(f.name)) || items.find(it => temuNormTitle(it.title).startsWith(temuNormTitle(f.name).slice(0, 40)));
      const tag = f.duplicate ? 'DUPLICATE — store mein pehle se hai' + (f.dupGoodsId ? ` (Goods ${f.dupGoodsId})` : '') : f.reason;
      add(`✗ ${f.name.slice(0, 55)} → ${tag}${it ? '' : '  (is export ke items mein match nahi)'}`);
      if (f.duplicate && it) dupItems.push(it);
    }
    if (dupItems.length) {
      await temuMarkListed(dupItems);
      add(`✓ ${dupItems.length} duplicate product(s) listed-history mein mark — agli export mein skip honge`);
      temuUpdateSrcInfo();
    }
    const other = failed.filter(f => !f.duplicate).length;
    if (other) add(`• ${other} product(s) ki wajah upar likhi hai — Temu par "Complete product infomation" / "Edit product" se theek karein, ya Categories tab ke profile mein woh attribute likh dein`);
    return result;
  } catch (e) { add('✗ ' + (e?.message || e)); return null; }
}

// ── v9.7.0 Temu upload history (chrome.storage.local.temuUploadHistory, max 100) ──
async function temuHistGet() { return new Promise(r => chrome.storage.local.get('temuUploadHistory', x => r(Array.isArray(x?.temuUploadHistory) ? x.temuUploadHistory : []))); }
async function temuHistAdd(entry) {
  const list = await temuHistGet();
  list.unshift({ id: 'h_' + Date.now().toString(36), t: Date.now(), ...entry });
  await new Promise(r => chrome.storage.local.set({ temuUploadHistory: list.slice(0, 100) }, r));
  temuRenderHistory();
}
let TemuHistFilter = 'all';

async function temuRenderHistory() {
  const box = $('temuHistList'); if (!box) return;
  const list = await temuHistGet();
  { const c = $('temuHistCount'); if (c) c.textContent = list.length ? String(list.length) : ''; }

  // 1. Calculate Today's Progress
  const now = new Date();
  const dayKey = value => { const d = new Date(value); return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-'); };
  const todayStr = dayKey(now);
  const selectedHistoryStore = $('temuHistStoreFilter')?.value || '';
  const scopedList = selectedHistoryStore ? list.filter(h => h.store === selectedHistoryStore) : list;
  const dayNameDate = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const dateEl = $('temuTodayDate'); if (dateEl) dateEl.textContent = dayNameDate;

  // Read saved daily target
  let dailyTarget = 50;
  try {
    const res = await new Promise(r => chrome.storage.local.get('temuDailyTarget', r));
    if (res?.temuDailyTarget) dailyTarget = parseInt(res.temuDailyTarget, 10) || 50;
  } catch (_) {}
  const dtInp = $('temuDailyTarget'); if (dtInp && document.activeElement !== dtInp) dtInp.value = dailyTarget;

  const isToday = (t) => {
    if (!t) return false;
    return dayKey(t) === todayStr;
  };

  const listedMap = Object.fromEntries(Object.entries(temuListedMap()).filter(([key]) => !selectedHistoryStore || key.startsWith(selectedHistoryStore + '|')));
  let todayListedCount = Object.values(listedMap).filter(x => x && x.d === todayStr).length;
  
  let todayUploadsCount = 0;
  let todayErrorsCount = 0;
  let uploadItemsToday = 0;

  for (const h of scopedList) {
    if (isToday(h.t)) {
      if (h.kind === 'upload') {
        if (h.confirmed) {
          todayUploadsCount++;
          uploadItemsToday += (h.added != null ? h.added : (h.items?.length || h.n || 0));
        }
        if (h.errors || !h.confirmed) todayErrorsCount += (h.errors || 1);
      }
    }
  }

  const finalListed = todayListedCount;
  const remaining = Math.max(0, dailyTarget - finalListed);
  const pct = Math.min(100, Math.round((finalListed / dailyTarget) * 100));

  if ($('temuMetricListed')) $('temuMetricListed').textContent = String(finalListed);
  if ($('temuMetricUploads')) $('temuMetricUploads').textContent = String(todayUploadsCount);
  if ($('temuMetricErrors')) $('temuMetricErrors').textContent = String(todayErrorsCount);
  if ($('temuMetricRemaining')) $('temuMetricRemaining').textContent = String(remaining);

  const bar = $('temuProgressBar');
  if (bar) bar.style.width = pct + '%';

  const stat = $('temuProgressStatus');
  if (stat) {
    if (finalListed === 0) {
      stat.textContent = 'Aaj abhi kuch listed nahi';
    } else {
      stat.textContent = `${finalListed} of ${dailyTarget} accepted/marked today (${pct}%)`;
    }
  }

  // Last 7 days tracker
  const weekBox = $('temuWeekDays');
  if (weekBox) {
    weekBox.innerHTML = '';
    const dayLetters = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dStr = dayKey(d);
      const isCur = i === 0;
      const dayIdx = d.getDay();
      const letter = dayLetters[dayIdx];

      const dayUploads = scopedList.filter(h => dayKey(h.t) === dStr);
      const dayListed = Object.values(listedMap).filter(x => x && x.d === dStr).length;
      const hasActivity = dayUploads.length > 0 || dayListed > 0;

      const col = document.createElement('div');
      col.className = 'temu-day-col' + (isCur ? ' today' : '');
      col.innerHTML = `
        <div class="temu-day-box${isCur ? ' today' : ''}">
          ${hasActivity ? `<div class="temu-day-bar" style="height:${Math.min(100, Math.max(25, (dayListed || dayUploads.length) * 15))}%"></div>` : ''}
        </div>
        <span class="temu-day-lbl">${letter}</span>
      `;
      weekBox.appendChild(col);
    }
  }

  // Populate Store Filter dropdown
  const storeSel = $('temuHistStoreFilter');
  if (storeSel) {
    const curVal = storeSel.value;
    const stores = Object.keys(temuStores());
    list.forEach(h => { if (h.store && !stores.includes(h.store)) stores.push(h.store); });
    storeSel.innerHTML = '<option value="">All Stores</option>' + stores.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
    storeSel.value = curVal || '';
  }

  // 2. Filter records list
  const search = ($('temuHistSearch')?.value || '').trim().toLowerCase();
  const selectedStore = $('temuHistStoreFilter')?.value || '';

  const filtered = list.filter(h => {
    if (selectedStore && (h.store || '') !== selectedStore) return false;
    if (TemuHistFilter === 'success') {
      if (h.kind !== 'upload' || !h.confirmed || (h.errors && h.errors > 0)) return false;
    } else if (TemuHistFilter === 'errors') {
      if (!h.errors && h.confirmed) return false;
    } else if (TemuHistFilter === 'file') {
      if (h.kind !== 'export') return false;
    }
    if (search) {
      const matchStore = (h.store || '').toLowerCase().includes(search);
      const matchUpId = (h.uploadId || '').toLowerCase().includes(search);
      const matchItems = (h.items || []).some(it => (it.sku || '').toLowerCase().includes(search) || (it.title || '').toLowerCase().includes(search));
      if (!matchStore && !matchUpId && !matchItems) return false;
    }
    return true;
  });

  box.innerHTML = '';
  if (!filtered.length) {
    box.innerHTML = '<div class="temu-hist-empty">Koi matching Temu upload record nahi mila.</div>';
    return;
  }

  for (const h of filtered) {
    const d = new Date(h.t);
    const when = d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    let statusBadge = '';
    if (h.kind === 'export') {
      statusBadge = '<span class="temu-hist-badge temu-hist-badge-file">📁 Export File</span>';
    } else if (h.kind === 'manual') {
      statusBadge = '<span class="temu-hist-badge temu-hist-badge-ok">✓ Listed</span>';
    } else if (h.confirmed && !h.errors) {
      statusBadge = '<span class="temu-hist-badge temu-hist-badge-ok">✓ Confirmed</span>';
    } else if (h.confirmed && h.errors) {
      statusBadge = `<span class="temu-hist-badge temu-hist-badge-warn">⚠️ ${h.errors} Errors</span>`;
    } else {
      statusBadge = '<span class="temu-hist-badge temu-hist-badge-bad">✗ Failed</span>';
    }

    let chipsHtml = '';
    if (h.uploadId) {
      chipsHtml += `<span class="temu-hist-chip" title="Upload ID">ID ${esc(h.uploadId)}</span>`;
    }
    if (h.added != null) {
      chipsHtml += `<span class="temu-hist-chip temu-chip-ok">+${h.added} added</span>`;
    }
    if (h.errors) {
      chipsHtml += `<span class="temu-hist-chip temu-chip-err">${h.errors} errors</span>`;
    }
    if (h.skipped) {
      chipsHtml += `<span class="temu-hist-chip temu-chip-warn">${h.skipped} skipped</span>`;
    }
    if (h.source) {
      chipsHtml += `<span class="temu-hist-chip">Source: ${esc(h.source)}</span>`;
    }

    const el = document.createElement('div');
    el.className = 'temu-hist';
    el.innerHTML = `
      <div class="temu-hist-card-inner">
        <div class="temu-hist-info-col">
          <div class="temu-hist-header-line">
            ${statusBadge}
            <span class="temu-hist-store-pill">${esc(h.store || 'Default')}</span>
          </div>
          <div class="temu-hist-meta-line">
            <span class="temu-hist-date">${esc(when)}</span>
            <span class="temu-hist-qty-badge">${h.n} items</span>
          </div>
          ${chipsHtml ? `<details class="temu-hist-details"><summary>Upload details</summary><div class="temu-hist-chips-line">${chipsHtml}</div></details>` : ''}
        </div>
        <div class="temu-hist-acts">
          <button class="btn btn-ghost btn-xs temu-hist-csv-btn" type="button" data-act="csv" title="Download record CSV">CSV</button>
          <button class="btn btn-ghost btn-xs btn-danger temu-hist-del-btn" type="button" data-act="del" title="Delete this history record">Delete</button>
        </div>
      </div>
    `;

    el.querySelector('[data-act="csv"]').addEventListener('click', () => {
      const lines = [['SKU', 'Title', 'URL', 'Base Price', 'Variation'].join(',')].concat((h.items || []).map(it => [it.sku, it.title, it.url, it.base, it.variation].map(v => '"' + String(v ?? '').replace(/"/g, '""') + '"').join(',')));
      zhSaveBlob(new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv' }), `temu_upload_${h.store || 'store'}_${d.toISOString().slice(0, 16).replace(/[:T]/g, '-')}.csv`);
    });

    el.querySelector('[data-act="del"]').addEventListener('click', async () => {
      if (!confirm(`Is upload record (${when} · ${h.store || 'store'} · ${h.n} products) ko delete karein?`)) return;
      const allHist = await temuHistGet();
      const nextHist = allHist.filter(x => (h.id ? x.id !== h.id : x.t !== h.t));
      await new Promise(r => chrome.storage.local.set({ temuUploadHistory: nextHist }, r));
      temuRenderHistory();
      toast('History record delete ho gaya ✓', 'ok');
    });

    box.appendChild(el);
  }
}

async function temuExportAllHistoryCsv() {
  const list = await temuHistGet();
  if (!list.length) { toast('History khali hai', 'warn'); return; }
  const allItems = [];
  list.forEach(h => {
    (h.items || []).forEach(it => {
      allItems.push({
        date: new Date(h.t).toISOString(),
        store: h.store || '',
        uploadId: h.uploadId || '',
        status: h.confirmed ? 'Confirmed' : 'Failed',
        sku: it.sku || '',
        title: it.title || '',
        url: it.url || '',
        base: it.base || '',
        variation: it.variation || ''
      });
    });
  });
  if (!allItems.length) { toast('Koi products history mein nahi hain', 'warn'); return; }
  const headers = ['Date', 'Store', 'Upload ID', 'Status', 'SKU', 'Title', 'URL', 'Base Price', 'Variation'];
  const lines = [headers.join(',')].concat(
    allItems.map(it => [it.date, it.store, it.uploadId, it.status, it.sku, it.title, it.url, it.base, it.variation]
      .map(v => '"' + String(v ?? '').replace(/"/g, '""') + '"').join(','))
  );
  zhSaveBlob(new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv' }), `temu_all_history_${new Date().toISOString().slice(0, 10)}.csv`);
  toast(`Exported ${allItems.length} records to CSV`, 'ok');
}
const temuHistItems = items => (items || []).map(it => ({ sku: it.sku, title: it.title || '', url: it.url, base: it.base, sourcingPrice: it.sourcingPrice ?? '', list: it.list ?? '', variation: `${it.vtype || 'Color'}: ${it.color}` }));

// v9.7.1 — Temu general-template file (temu_upload.xlsx) pehchano: row 3 mein keys (seller_sku, item_name), data row 5 se
function temuParseTemuFile(buf) {
  if (typeof XLSX === 'undefined') return null;
  let wb; try { wb = XLSX.read(buf, { type: 'array' }); } catch (_) { return null; }
  const ws = wb.Sheets['Template'] || wb.Sheets[wb.SheetNames[0]]; if (!ws) return null;
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  const keys = (aoa[2] || []).map(x => String(x || '').trim());
  const ki = k => keys.indexOf(k);
  if (ki('seller_sku') < 0 || ki('item_name') < 0) return null;
  const items = [];
  for (let r = 4; r < aoa.length; r++) {
    const row = aoa[r] || []; const sku = String(row[ki('seller_sku')] || '').trim(); const title = String(row[ki('item_name')] || '').trim();
    if (!sku && !title) continue;
    const m = sku.match(/^[A-Za-z]+-([^-]+)-/);
    items.push({ sku, title, sid: m ? m[1] : sku, url: '', base: row[ki('map_price')] ?? '', color: String(row[ki('Variation_Variants_1')] || ''), vtype: String(row[ki('Variation_type_1')] || 'Color'), brand: String(row[ki('brand')] || ''), images: [], warn: [], weight: '' });
  }
  return items.length ? items : null;
}
async function temuImportSheet(file) {
  const rep = $('temuReport');
  const name = (file.name || '').toLowerCase();
  if (name.endsWith('.xlsx') || name.endsWith('.xls') || name.endsWith('.csv')) {
    try {
      const buf2 = await file.arrayBuffer(); const wb2 = XLSX.read(buf2, { type: 'array' }); const ws2 = wb2.Sheets[wb2.SheetNames[0]];
      const rows2 = XLSX.utils.sheet_to_json(ws2, { header: 1, defval: '' }).map(r => (r || []).map(c => String(c ?? '').trim()));
      const sc = (typeof parseTemuStoreExport === 'function') ? parseTemuStoreExport(rows2) : null;
      if (sc) {
        if (!sc.length) { if (rep) rep.textContent = '✗ Temu export mein koi product nahi'; return; }
        await importStoreCopy(sc, file.name, (t) => { if (rep) rep.textContent = t + '\n\nAgla qadam: Bulk tab → "Hunt all" dabayen → wapas Temu Export → "Export + Upload to Temu".'; });
        return;
      }
    } catch (_) {}
  }
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    const buf = await file.arrayBuffer();
    const items = temuParseTemuFile(buf);
    if (items) {
      // Temu file as-is: koi conversion nahi, wahi file upload hogi
      TemuSheetRows = null;
      TemuLast = { bytes: buf, items, skipped: [], n: items.length, marked: false, asIs: true, name: file.name };
      const sel = $('temuSource');
      if (sel) { const o = sel.querySelector('option[value="sheet"]'); if (o) { o.hidden = false; o.textContent = `Temu file — ${file.name} (${items.length}) · as-is`; } sel.value = 'sheet'; }
      { const mb = $('temuMarkListedBtn'); if (mb) { mb.hidden = false; mb.textContent = `Mark ${items.length} as listed`; } }
      temuUpdateSrcInfo();
      if (rep) rep.textContent = `✓ Temu file: ${file.name} — ${items.length} products (as-is, koi conversion nahi; already-listed skip bhi nahi).\nStore check karein, phir "Export + Upload to Temu".\n` + items.slice(0, 60).map(it => `${it.sku}  ${it.vtype}: ${it.color}  $${it.base}`).join('\n');
      toast(`Temu file ready — ${items.length} products, as-is upload`, 'ok');
      return;
    }
  }
  const parsed = await parseImportFile(file);
  if (!parsed) return;
  TemuSheetRows = parsed.rows;
  TemuLast = null;
  { const mb = $('temuMarkListedBtn'); if (mb) mb.hidden = true; }
  const sel = $('temuSource');
  if (sel) { const o = sel.querySelector('option[value="sheet"]'); if (o) { o.hidden = false; o.textContent = `Imported sheet — ${file.name} (${TemuSheetRows.length})`; } sel.value = 'sheet'; }
  temuUpdateSrcInfo();
  if (rep) rep.textContent = `✓ Sheet import: ${file.name} — ${TemuSheetRows.length} products. Store check karein, phir "Export + Upload to Temu".`;
  toast(`${TemuSheetRows.length} products sheet se — ab Export + Upload`, 'ok');
}

function temuUpdateTplStatus() {
  const el = $('temuTplStatus');
  const store = temuActiveStore();
  const n = temuActiveStoreName();
  const name = store?.templateName;
  const hasStore = Boolean(n && n.trim() && Object.keys(temuStores()).length);
  const hasTemplate = Boolean(hasStore && name && name.trim());

  if (el) {
    el.textContent = hasStore
      ? (hasTemplate ? `✓ ${name}` : `${n}: Select .xlsx template`)
      : 'Pehle store add karein';
    el.style.color = hasTemplate ? '#4ade80' : '#e8a33d';
  }

  // Step 1 UI
  const s1Row = $('temuStep1Row');
  const s1Icon = $('temuStep1Icon');
  const s1Wrap = $('temuStepStoreWrap');
  const s1Desc = $('temuStep1Desc');
  const s1Title = $('temuStep1Title');

  if (s1Row && s1Icon && s1Wrap && s1Desc) {
    if (hasStore) {
      s1Row.classList.add('is-complete');
      s1Row.classList.remove('is-active');
      s1Icon.textContent = '✓';
      s1Wrap.style.display = 'inline-flex';
      if (s1Title) s1Title.textContent = 'Store';
      s1Desc.textContent = 'Linked to Temu Seller Center';
    } else {
      s1Row.classList.remove('is-complete');
      s1Row.classList.add('is-active');
      s1Icon.textContent = '1';
      s1Wrap.style.display = 'none';
      if (s1Title) s1Title.textContent = 'Add your store';
      s1Desc.textContent = 'Naam bilkul wahi jo Temu Seller Center mein upar-right dikhta hai';
    }
  }

  // Step 2 UI
  const s2Row = $('temuStep2Row');
  const s2Icon = $('temuStep2Icon');
  const s2Title = $('temuStep2Title');
  const s2Desc = $('temuStep2Desc');
  const tplBtnTxt = $('temuTplBtnTxt');

  if (s2Row && s2Icon && s2Title && s2Desc) {
    if (hasTemplate) {
      s2Row.classList.add('is-complete');
      s2Row.classList.remove('is-active');
      s2Icon.textContent = '✓';
      s2Title.textContent = name ? `Template: ${trunc(name, 22)}` : 'Template linked';
      s2Desc.textContent = 'Active general upload template';
      if (tplBtnTxt) tplBtnTxt.textContent = 'Change .xlsx';
    } else {
      s2Row.classList.remove('is-complete');
      s2Title.textContent = 'Select a Temu template';
      if (tplBtnTxt) tplBtnTxt.textContent = 'Select .xlsx';

      if (hasStore) {
        s2Row.classList.add('is-active');
        s2Icon.textContent = '2';
        s2Desc.textContent = 'Temu Seller Center → Upload products → General template → Select that file';
      } else {
        s2Row.classList.remove('is-active');
        s2Icon.textContent = '2';
        s2Desc.textContent = 'Step 1 mein pehle store add karein';
      }
    }
  }

  // v9.11.0 — once both steps are done the card shrinks to one line
  const card = $('temuSetupCard');
  if (card) {
    const ready = hasStore && hasTemplate;
    card.classList.toggle('is-ready', ready);
    if (!ready) card.classList.remove('expanded');
    const a = $('tscStore'), b = $('tscTpl');
    if (a) a.textContent = n || '—';
    if (b) { b.textContent = name ? trunc(name, 26) : '—'; b.title = name || ''; }
  }

  // Setup Progress Badge
  const badge = $('temuSetupBadge');
  if (badge) {
    if (hasStore && hasTemplate) {
      badge.textContent = '✓ Ready to Export';
      badge.className = 'temu-setup-badge step-complete';
    } else if (hasStore || hasTemplate) {
      badge.textContent = '1/2 Steps Done';
      badge.className = 'temu-setup-badge step-partial';
    } else {
      badge.textContent = '0/2 Setup';
      badge.className = 'temu-setup-badge';
    }
  }
}

async function temuSaveCfg(cfg) {
  const stores = temuStores(); const n = temuActiveStoreName();
  if (!n) { toast('Pehle store add karein', 'warn'); return 'no active store'; }
  stores[n] = { ...(stores[n] || {}), config: cfg };
  return temuSaveStores(stores);
}

let TemuExpandedProfiles = new Set(['golf_balls']);
let TemuCatPage = 1;
const TEMU_CAT_PAGE_SIZE = 15;
let TemuCatActiveDept = 'all';
let TemuCatSelected = new Set(); // bulk-select tracking

function temuCatUpdateBulkBar() {
  const bar = $('temuCatBulkBar');
  const countEl = $('temuCatBulkCount');
  const n = TemuCatSelected.size;
  if (bar) bar.classList.toggle('hidden', n === 0);
  if (countEl) countEl.textContent = n;
}

function temuGetCategoryDept(p) {
  const path = (p?.full_path || '').toLowerCase();
  if (path.includes('grocery')) return 'Grocery';
  if (path.includes('home & kitchen') || path.includes('patio') || path.includes('kitchen') || path.includes('home')) return 'Home & Kitchen';
  if (path.includes('toys') || path.includes('games')) return 'Toys';
  if (path.includes('sports') || path.includes('outdoor')) return 'Sports';
  if (path.includes('health') || path.includes('household')) return 'Health';
  if (path.includes('electronic') || path.includes('office')) return 'Electronics';
  return 'other';
}

const TEMU_CATALOG_PRESETS = [
  { id: 'golf_balls', name: 'Golf Balls', cat: 'Standard Balls', match: ['golf ball', 'golf balls', 'dozen balls', 'golf', 'chrome tour', 'chrome soft', 'pro v1', 'tp5', 'avx', 'velocity', 'supersoft', 'tour response', 'speedsoft', 'warbird', 'erc soft'], attrs: 'Rubber, 14 Years+', w: 1.4, l: 7.5, wd: 5.2, h: 1.5 },
  { id: 'towels', name: 'Towels', cat: 'Bath Towels', match: ['bath towel', 'hand towel', 'beach towel', 'washcloth', 'towel set'], exclude: ['paper towel', 'kitchen towel roll', 'shop towel'], attrs: '100% Cotton', w: 2.0, l: 12, wd: 10, h: 4 },
  { id: 'swim_diapers', name: 'Swim Diapers', cat: 'Swim Diapers', match: ['swim diaper', 'swim diapers', 'swim pants', 'reusable swim diaper'], attrs: 'Waterproof, Polyester', w: 0.8, l: 9, wd: 7, h: 2 },
  { id: 'diapers', name: 'Diapers', cat: 'Baby Diapers', match: ['baby diaper', 'baby diapers', 'diapers', 'pull-ups', 'training pants'], attrs: 'Cotton, Disposable', w: 3.5, l: 14, wd: 10, h: 8 },
  { id: 'disinfectant_wipes', name: 'Disinfectant Wipes', cat: 'Disinfectant Wipes', match: ['disinfectant wipe', 'disinfectant wipes', 'sanitizing wipes', 'surface wipes', 'antibacterial wipes', 'cleaning wipes'], attrs: 'Bleach-free, Disposable', w: 1.8, l: 8, wd: 4.5, h: 4.5 },
  { id: 'yoga_mats', name: 'Yoga Mats', cat: 'Yoga Mats', match: ['yoga mat', 'exercise mat', 'pilates mat', 'fitness mat', 'workout mat'], attrs: 'TPE, Non-slip', w: 2.5, l: 24, wd: 6, h: 6 },
  { id: 'resistance_bands', name: 'Resistance Bands', cat: 'Resistance Bands', match: ['resistance band', 'exercise band', 'workout band', 'loop band', 'booty band'], attrs: 'Natural Latex, Elastic', w: 0.6, l: 8, wd: 6, h: 2 },
  { id: 'water_bottles', name: 'Water Bottles', cat: 'Insulated Bottles', match: ['water bottle', 'sports bottle', 'stainless bottle', 'insulated tumbler', 'vacuum flask'], attrs: 'Stainless Steel, BPA Free', w: 1.1, l: 11, wd: 3.5, h: 3.5 },
  { id: 'phone_cases', name: 'Phone Cases', cat: 'Phone Cases', match: ['phone case', 'silicone case', 'shockproof cover', 'iphone case', 'samsung case', 'clear case'], attrs: 'TPU Silicone, Shockproof', w: 0.2, l: 6.5, wd: 3.5, h: 0.6 },
  { id: 'athletic_socks', name: 'Athletic Socks', cat: 'Athletic Socks', match: ['ankle socks', 'crew socks', 'athletic socks', 'running socks', 'cushioned socks'], attrs: 'Cotton Blend, Breathable', w: 0.5, l: 9, wd: 4, h: 2 },
  { id: 'bed_sheets', name: 'Bed Sheets', cat: 'Bed Sheet Sets', match: ['bed sheet', 'fitted sheet', 'sheet set', 'flat sheet', 'bedspread'], attrs: 'Microfiber, Deep Pocket', w: 3.2, l: 12, wd: 10, h: 4 },
  { id: 'pillowcases', name: 'Pillowcases', cat: 'Pillow Covers', match: ['pillowcase', 'pillow cover', 'throw pillow cover', 'cushion cover'], attrs: 'Linen Blend, Washable', w: 0.7, l: 8, wd: 6, h: 1.5 },
  { id: 'kitchen_sponges', name: 'Kitchen Sponges', cat: 'Cleaning Sponges', match: ['kitchen sponge', 'scrub sponge', 'dish sponge', 'scouring pad', 'cleaning sponge'], attrs: 'Cellulose, Dual-sided', w: 0.4, l: 6, wd: 4, h: 3 },
  { id: 'dog_toys', name: 'Dog Toys', cat: 'Pet Toys', match: ['dog toy', 'chew toy', 'squeaky toy', 'puppy toy', 'dog ball', 'rope toy'], attrs: 'Non-toxic Rubber', w: 0.9, l: 7, wd: 4, h: 3 },
  { id: 'cat_toys', name: 'Cat Toys', cat: 'Cat Playthings', match: ['cat toy', 'cat teaser', 'catnip toy', 'scratcher toy', 'feather wand'], attrs: 'Plush, Catnip Infused', w: 0.3, l: 8, wd: 4, h: 2 },
  { id: 'sunglasses', name: 'Sunglasses', cat: 'Fashion Sunglasses', match: ['sunglasses', 'polarized glasses', 'uv400 sunglasses', 'retro sunglasses', 'aviator glasses'], attrs: 'UV400, Polarized TAC', w: 0.3, l: 6.5, wd: 2.5, h: 2 },
  { id: 'makeup_brushes', name: 'Makeup Brushes', cat: 'Cosmetic Brushes', match: ['makeup brush', 'foundation brush', 'eyeshadow brush', 'cosmetic brush set', 'blush brush'], attrs: 'Synthetic Hair, Aluminum', w: 0.5, l: 8, wd: 4, h: 2 },
  { id: 'hair_clips', name: 'Hair Clips', cat: 'Hair Claws', match: ['hair claw', 'hair clip', 'hairpin', 'barrette', 'hair jaw', 'jaw clip'], attrs: 'Matte Acrylic, Strong Hold', w: 0.2, l: 5, wd: 3, h: 2 },
  { id: 'coffee_mugs', name: 'Coffee Mugs', cat: 'Ceramic Mugs', match: ['coffee mug', 'ceramic cup', 'tea mug', 'travel mug', 'ceramic mug'], attrs: 'Ceramic, Microwave Safe', w: 1.2, l: 5, wd: 4, h: 4.5 },
  { id: 'cutlery_sets', name: 'Cutlery Sets', cat: 'Flatware Sets', match: ['flatware set', 'cutlery set', 'silverware', 'fork spoon knife set'], attrs: 'Stainless Steel 304', w: 1.8, l: 9.5, wd: 3, h: 2 },
  { id: 'kitchen_knives', name: 'Kitchen Knives', cat: 'Chef Knives', match: ['kitchen knife', 'chef knife', 'santoku knife', 'paring knife', 'utility knife'], attrs: 'High Carbon Steel', w: 0.8, l: 13, wd: 2.5, h: 1 },
  { id: 'cutting_boards', name: 'Cutting Boards', cat: 'Chopping Boards', match: ['cutting board', 'chopping board', 'bamboo board', 'kitchen board'], attrs: 'Natural Bamboo, BPA Free', w: 2.2, l: 14, wd: 10, h: 0.8 },
  { id: 'scented_candles', name: 'Scented Candles', cat: 'Aromatherapy Candles', match: ['scented candle', 'soy candle', 'aromatherapy candle', 'jar candle'], attrs: 'Natural Soy Wax, Cotton Wick', w: 1.2, l: 4, wd: 4, h: 4.5 },
  { id: 'blankets', name: 'Throw Blankets', cat: 'Fleece Blankets', match: ['throw blanket', 'fleece blanket', 'plush blanket', 'bed throw', 'sherpa blanket'], attrs: 'Flannel Fleece, Warm', w: 2.5, l: 14, wd: 11, h: 4 },
  { id: 'bath_mats', name: 'Bath Mats', cat: 'Bathroom Rugs', match: ['bath mat', 'bathroom rug', 'shower mat', 'absorbent rug'], attrs: 'Memory Foam, Non-slip', w: 1.1, l: 15, wd: 10, h: 2 },
  { id: 'shower_curtains', name: 'Shower Curtains', cat: 'Bath Curtains', match: ['shower curtain', 'waterproof curtain', 'fabric shower curtain'], attrs: 'Water Repellent Polyester', w: 0.9, l: 11, wd: 8, h: 1.5 },
  { id: 'backpacks', name: 'Backpacks', cat: 'Casual Backpacks', match: ['backpack', 'daypack', 'travel backpack', 'laptop backpack', 'school bag'], attrs: 'Waterproof Oxford, Padded', w: 1.8, l: 17, wd: 12, h: 5 },
  { id: 'crossbody_bags', name: 'Crossbody Bags', cat: 'Shoulder Bags', match: ['crossbody bag', 'shoulder bag', 'messenger bag', 'sling bag', 'waist bag'], attrs: 'PU Leather, Adjustable Strap', w: 0.9, l: 10, wd: 7, h: 3 },
  { id: 'wallets', name: 'Wallets', cat: 'RFID Wallets', match: ['leather wallet', 'rfid wallet', 'card holder', 'bifold wallet', 'slim wallet'], attrs: 'RFID Blocking, Genuine Leather', w: 0.3, l: 4.5, wd: 3.5, h: 0.8 },
  { id: 't_shirts', name: 'T-Shirts', cat: 'Men & Women Tees', match: ['t-shirt', 'tee shirt', 'graphic tee', 'crewneck t-shirt', 'v-neck t-shirt'], attrs: '100% Ring-spun Cotton', w: 0.5, l: 10, wd: 8, h: 1 },
  { id: 'hoodies', name: 'Hoodies', cat: 'Pullover Hoodies', match: ['hoodie', 'sweatshirt', 'pullover hoodie', 'fleece sweatshirt'], attrs: 'Fleece Blend, Drawstring', w: 1.4, l: 13, wd: 11, h: 3 },
  { id: 'leggings', name: 'Leggings', cat: 'Workout Leggings', match: ['leggings', 'yoga pants', 'workout leggings', 'compression tights'], attrs: 'Spandex Blend, High Waist', w: 0.6, l: 9, wd: 7, h: 1.5 },
  { id: 'baseball_caps', name: 'Baseball Caps', cat: 'Hats & Caps', match: ['baseball cap', 'snapback hat', 'dad hat', 'trucker cap', 'sun hat'], attrs: 'Cotton Twill, Adjustable', w: 0.3, l: 8, wd: 7, h: 4.5 },
  { id: 'underwear', name: 'Underwear', cat: 'Undergarments', match: ['boxer briefs', 'boxers', 'briefs', 'panties', 'seamless underwear'], attrs: 'Modal Cotton, Breathable', w: 0.4, l: 7, wd: 5, h: 1.5 },
  { id: 'charging_cables', name: 'Charging Cables', cat: 'USB Cables', match: ['charging cable', 'usb-c cable', 'lightning cable', 'fast charging cord'], attrs: 'Braided Nylon, 60W', w: 0.2, l: 6, wd: 3, h: 0.8 },
  { id: 'wireless_earbuds', name: 'Wireless Earbuds', cat: 'Bluetooth Earphones', match: ['earbuds', 'wireless earphones', 'bluetooth earbuds', 'noise cancelling earbuds'], attrs: 'Bluetooth 5.3, Waterproof', w: 0.3, l: 4, wd: 4, h: 1.5 },
  { id: 'smartwatch_bands', name: 'Smartwatch Bands', cat: 'Watch Straps', match: ['watch band', 'apple watch band', 'silicone strap', 'metal watch band'], attrs: 'Silicone / Stainless Steel', w: 0.15, l: 6, wd: 2, h: 0.5 },
  { id: 'screen_protectors', name: 'Screen Protectors', cat: 'Tempered Glass', match: ['screen protector', 'tempered glass', 'privacy screen', 'camera protector'], attrs: '9H Tempered Glass', w: 0.2, l: 7, wd: 4, h: 0.5 },
  { id: 'car_mounts', name: 'Car Phone Mounts', cat: 'Car Holders', match: ['car phone mount', 'car holder', 'dashboard mount', 'air vent holder', 'magnetic car mount'], attrs: 'Strong Magnetic, 360 Rotation', w: 0.4, l: 4.5, wd: 3.5, h: 2.5 },
  { id: 'cable_organizers', name: 'Cable Organizers', cat: 'Cord Management', match: ['cable organizer', 'cable clips', 'cord holder', 'wire management'], attrs: 'Silicone, Adhesive Back', w: 0.2, l: 5, wd: 3, h: 1 },
  { id: 'hangers', name: 'Velvet Hangers', cat: 'Clothes Hangers', match: ['velvet hangers', 'clothes hanger', 'coat hanger', 'suit hangers', 'non-slip hangers'], attrs: 'Velvet Non-slip, Swivel Hook', w: 2.2, l: 17.5, wd: 9, h: 3 },
  { id: 'storage_bins', name: 'Storage Bins', cat: 'Storage Organizers', match: ['storage bin', 'closet organizer', 'fabric storage basket', 'folding organizer'], attrs: 'Reinforced Fabric, Handles', w: 1.5, l: 15, wd: 10, h: 9 },
  { id: 'pet_brushes', name: 'Pet Grooming Brushes', cat: 'Pet Grooming', match: ['dog brush', 'cat brush', 'pet grooming comb', 'deshedding brush', 'slicker brush'], attrs: 'Self-cleaning, Stainless Pins', w: 0.5, l: 8, wd: 4, h: 2.5 },
  { id: 'pet_leashes', name: 'Pet Leashes', cat: 'Dog Leashes', match: ['dog leash', 'retractable leash', 'training leash', 'dog lead'], attrs: 'Reflective Nylon, Heavy Duty', w: 0.7, l: 8, wd: 4, h: 2 },
  { id: 'lip_balms', name: 'Lip Gloss & Balms', cat: 'Lip Care', match: ['lip balm', 'lip gloss', 'lip oil', 'tinted lip balm', 'chapstick'], attrs: 'Moisturizing, Shea Butter', w: 0.15, l: 3.5, wd: 1.5, h: 1 },
  { id: 'makeup_sponges', name: 'Makeup Sponges', cat: 'Beauty Blenders', match: ['makeup sponge', 'beauty sponge', 'blending sponge', 'powder puff'], attrs: 'Latex-free Foam, Soft', w: 0.2, l: 4, wd: 3, h: 2.5 },
  { id: 'nail_files', name: 'Nail Files & Buffers', cat: 'Manicure Tools', match: ['nail file', 'nail buffer', 'emery boards', 'glass nail file', 'manicure set'], attrs: 'Double Sided Grit, Washable', w: 0.2, l: 7, wd: 2, h: 0.5 },
  { id: 'dental_floss', name: 'Dental Flossers', cat: 'Oral Hygiene', match: ['floss picks', 'dental floss', 'interdental brush', 'flosser picks'], attrs: 'Shred Resistant, Mint Flavor', w: 0.3, l: 6, wd: 4, h: 2 },
  { id: 'dish_towels', name: 'Kitchen Dish Towels', cat: 'Tea Towels', match: ['dish towel', 'tea towel', 'kitchen cloth', 'bar mop towels'], attrs: '100% Ring Spun Cotton', w: 1.0, l: 10, wd: 8, h: 2.5 },
  { id: 'silicone_spatulas', name: 'Silicone Spatulas', cat: 'Baking Utensils', match: ['silicone spatula', 'rubber spatula', 'cooking spatula', 'baking scraper'], attrs: 'Heat Resistant 600°F, Food Grade', w: 0.5, l: 11, wd: 2.5, h: 1 },
  { id: 'ice_cube_trays', name: 'Ice Cube Trays', cat: 'Kitchen Moulds', match: ['ice cube tray', 'silicone ice mold', 'whiskey ice ball', 'large ice cube'], attrs: 'Food Grade Silicone, Easy Release', w: 0.6, l: 8, wd: 5, h: 2 },
  { id: 'oven_mitts', name: 'Oven Mitts', cat: 'Heat Resistant Gloves', match: ['oven mitts', 'potholders', 'silicone oven gloves', 'heat resistant mitts'], attrs: 'Silicone Grip, Cotton Lined', w: 0.8, l: 12, wd: 7, h: 2 }
];

function temuRenderProfiles() {
  const box = $('temuProfileList'); if (!box) return;
  const cfg = temuGetCfg();
  box.innerHTML = '';
  const entries = Object.entries(cfg.category_profiles || {});
  
  // 1. Calculate department counts across ALL entries
  const deptCounts = { all: entries.length, Grocery: 0, 'Home & Kitchen': 0, Toys: 0, Sports: 0, Health: 0, Electronics: 0, other: 0 };
  entries.forEach(([, p]) => {
    const d = temuGetCategoryDept(p);
    if (deptCounts[d] !== undefined) deptCounts[d]++;
    else deptCounts.other++;
  });

  const setTxt = (id, val) => { const el = $(id); if (el) el.textContent = String(val); };
  setTxt('temuCatCountAll', deptCounts.all);
  setTxt('temuCatCountGrocery', deptCounts.Grocery);
  setTxt('temuCatCountHome', deptCounts['Home & Kitchen']);
  setTxt('temuCatCountToys', deptCounts.Toys);
  setTxt('temuCatCountSports', deptCounts.Sports);
  setTxt('temuCatCountHealth', deptCounts.Health);
  setTxt('temuCatCountElec', deptCounts.Electronics);
  setTxt('temuCatCountOther', deptCounts.other);
  const cnt = $('temuCatCount'); if (cnt) cnt.textContent = entries.length ? String(entries.length) : '';

  // Update active state on dept buttons
  document.querySelectorAll('#temuCatDeptBar .temu-cat-dept-btn').forEach(btn => {
    btn.classList.toggle('active', (btn.dataset.dept || 'all') === TemuCatActiveDept);
  });

  const search = ($('temuCatSearch')?.value || '').trim().toLowerCase();
  const searchClearBtn = $('temuCatSearchClear');
  if (searchClearBtn) searchClearBtn.classList.toggle('hidden', !search);
  
  const filtered = entries.filter(([name, p]) => {
    if (TemuCatActiveDept !== 'all') {
      const d = temuGetCategoryDept(p);
      if (d !== TemuCatActiveDept) return false;
    }
    if (!search) return true;
    if (name.toLowerCase().includes(search)) return true;
    if ((p.name || '').toLowerCase().includes(search)) return true;
    if ((p.category_keyword || '').toLowerCase().includes(search)) return true;
    if ((p.full_path || '').toLowerCase().includes(search)) return true;
    if ((p.match || []).some(m => String(m).toLowerCase().includes(search))) return true;
    if ((p.keyword_attributes || '').toLowerCase().includes(search)) return true;
    return false;
  });

  // 2. Pagination calculation
  const totalItems = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / TEMU_CAT_PAGE_SIZE));
  if (TemuCatPage > totalPages) TemuCatPage = totalPages;
  if (TemuCatPage < 1) TemuCatPage = 1;

  const startIdx = (TemuCatPage - 1) * TEMU_CAT_PAGE_SIZE;
  const endIdx = Math.min(startIdx + TEMU_CAT_PAGE_SIZE, totalItems);
  const pageItems = filtered.slice(startIdx, endIdx);

  const pagWrap = $('temuCatPagination');
  const infoEl = $('temuCatPageInfo');
  const curEl = $('temuCatPageCur');
  const prevBtn = $('temuCatPrevBtn');
  const nextBtn = $('temuCatNextBtn');

  if (pagWrap) {
    if (totalItems <= TEMU_CAT_PAGE_SIZE && totalItems > 0) {
      pagWrap.style.display = 'flex';
      if (infoEl) infoEl.textContent = `Showing 1–${totalItems} of ${totalItems}`;
      if (curEl) curEl.textContent = `Page 1 / 1`;
      if (prevBtn) prevBtn.disabled = true;
      if (nextBtn) nextBtn.disabled = true;
    } else if (totalItems === 0) {
      pagWrap.style.display = 'none';
    } else {
      pagWrap.style.display = 'flex';
      if (infoEl) infoEl.textContent = `Showing ${startIdx + 1}–${endIdx} of ${totalItems}`;
      if (curEl) curEl.textContent = `Page ${TemuCatPage} / ${totalPages}`;
      if (prevBtn) prevBtn.disabled = (TemuCatPage <= 1);
      if (nextBtn) nextBtn.disabled = (TemuCatPage >= totalPages);
    }
  }

  if (!filtered.length) {
    if (search) {
      box.innerHTML = `<div class="temu-hist-empty">Koi matching category nahi mili "${esc(search)}" ke liye</div>`;
    } else {
      box.innerHTML = `<div class="temu-hist-empty">Is department mein koi category nahi mili</div>`;
    }
    return;
  }

  pageItems.forEach(([name, p]) => {
    const isExpanded = TemuExpandedProfiles.has(name);
    const isSel = TemuCatSelected.has(name);
    const item = document.createElement('div');
    item.className = 'temu-cat-item' + (isExpanded ? ' expanded' : ' collapsed') + (isSel ? ' cat-sel' : '');
    item.dataset.catName = name;
    const displayName = p.name || name.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    const catBadge = p.category_keyword || 'Auto Category';
    const breadcrumb = p.full_path ? p.full_path.split(' / ').slice(0, -1).join(' › ') : '';
    
    const dims = [p.length_in, p.width_in, p.height_in].every(v => v != null) ? `${p.length_in}×${p.width_in}×${p.height_in} in` : null;
    const wt = p.weight_lb != null ? `${p.weight_lb} lb` : null;

    let chipsHtml = '';
    (p.match || []).forEach(kw => {
      const cleanKw = String(kw).split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
      chipsHtml += `<span class="temu-chip temu-chip-kw" title="Keyword match"><svg class="i" viewBox="0 0 24 24"><circle cx="7.5" cy="15.5" r="4.5"></circle><path d="M21 3l-9.5 9.5"></path><path d="M15.5 7.5L18 10"></path></svg><span>${esc(cleanKw)}</span></span>`;
    });
    (p.exclude || []).forEach(ex => {
      const cleanEx = String(ex).split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
      chipsHtml += `<span class="temu-chip temu-chip-ex" title="Exclude word"><svg class="i" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"></circle><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line></svg><span>${esc(cleanEx)}</span></span>`;
    });
    if (p.keyword_attributes) {
      chipsHtml += `<span class="temu-chip temu-chip-attr" title="Attributes"><svg class="i" viewBox="0 0 24 24"><line x1="4" y1="21" x2="4" y2="14"></line><line x1="4" y1="10" x2="4" y2="3"></line><line x1="12" y1="21" x2="12" y2="12"></line><line x1="12" y1="8" x2="12" y2="3"></line><line x1="20" y1="21" x2="20" y2="16"></line><line x1="20" y1="12" x2="20" y2="3"></line><line x1="1" y1="14" x2="7" y2="14"></line><line x1="9" y1="8" x2="15" y2="8"></line><line x1="17" y1="16" x2="23" y2="16"></line></svg><span>${esc(p.keyword_attributes)}</span></span>`;
    }
    if (p.price_multiplier) {
      chipsHtml += `<span class="temu-chip temu-chip-px" title="Price multiplier"><svg class="i" viewBox="0 0 24 24"><line x1="12" y1="1" x2="12" y2="23"></line><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg><span>×${esc(p.price_multiplier)}${p.price_min ? ' · min $' + esc(p.price_min) : ''}</span></span>`;
    }
    if (wt) {
      chipsHtml += `<span class="temu-chip temu-chip-dim" title="Weight"><svg class="i" viewBox="0 0 24 24"><path d="M12 3v18"></path><path d="M6 8l-3 7h6l-3-7"></path><path d="M18 8l-3 7h6l-3-7"></path><path d="M3 8h18"></path></svg><span>${esc(wt)}</span></span>`;
    }
    if (dims) {
      chipsHtml += `<span class="temu-chip temu-chip-dim" title="Dimensions"><svg class="i" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="3" y1="9" x2="9" y2="3"></line></svg><span>${esc(dims)}</span></span>`;
    }

    const showDiffBadge = catBadge && catBadge.toLowerCase() !== displayName.toLowerCase();
    const idBadge = p.id ? `<span class="temu-cat-id-badge" title="Temu Category ID"><span class="temu-cat-id-lbl">ID</span><span class="temu-cat-id-num">${esc(p.id)}</span></span>` : '';
    const diffBadge = showDiffBadge ? `<span class="temu-cat-diff-badge" title="Category Keyword"><svg class="i" viewBox="0 0 24 24"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path><line x1="7" y1="7" x2="7.01" y2="7"></line></svg><span>${esc(catBadge)}</span></span>` : '';

    item.innerHTML = `
      <div class="temu-cat-head">
        <div class="temu-cat-head-left">
          <button class="temu-cat-chk" type="button" title="Select for bulk action" aria-label="Select ${esc(displayName)}">
            ${isSel ? '<svg class="i" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="3" fill="rgba(0,229,255,0.15)" stroke="var(--accent)" stroke-width="2"/><polyline points="6 12 10 16 18 8" stroke="var(--accent)" stroke-width="2" fill="none"/></svg>' : '<svg class="i" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="3" fill="none" stroke="var(--ink-4)" stroke-width="1.5"/></svg>'}
          </button>
          <span class="temu-cat-arrow" aria-hidden="true">
            <svg class="i" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"></polyline></svg>
          </span>
          <div class="temu-cat-info">
            <div class="temu-cat-top-line">
              <span class="temu-cat-title">${esc(displayName)}</span>
              ${idBadge}
              ${diffBadge}
            </div>
            ${breadcrumb ? `<div class="temu-cat-breadcrumb" title="${esc(breadcrumb)}"><svg class="i temu-cat-folder-ico" viewBox="0 0 24 24"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg><span>${esc(breadcrumb)}</span></div>` : ''}
          </div>
        </div>
        <div class="temu-cat-actions">
          <button class="temu-cat-action-btn temu-cat-action-edit" data-edit="${esc(name)}" type="button" title="Edit category profile">
            <svg class="i" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
            <span>Edit</span>
          </button>
          <button class="temu-cat-action-btn temu-cat-action-del" data-del="${esc(name)}" type="button" title="Delete category profile">
            <svg class="i" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
          </button>
        </div>
      </div>
      <div class="temu-cat-body">
        <div class="temu-cat-chips">${chipsHtml}</div>
      </div>
    `;

    // Inject keyword preview pills (visible when collapsed)
    const kwPreview = document.createElement('div');
    kwPreview.className = 'temu-cat-kw-preview';
    (p.match || []).slice(0, 4).forEach(kw => {
      const label = String(kw).split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
      const pill = document.createElement('span');
      pill.className = 'temu-cat-kw-pill';
      pill.textContent = label;
      kwPreview.appendChild(pill);
    });
    if ((p.match || []).length > 4) {
      const more = document.createElement('span');
      more.className = 'temu-cat-kw-pill';
      more.style.color = 'var(--ink-4)';
      more.textContent = `+${(p.match || []).length - 4} more`;
      kwPreview.appendChild(more);
    }
    const head = item.querySelector('.temu-cat-head');
    const body = item.querySelector('.temu-cat-body');
    if (head && body) item.insertBefore(kwPreview, body);

    item.querySelector('.temu-cat-head').addEventListener('click', (e) => {
      if (e.target.closest('.temu-cat-actions')) return;
      if (TemuExpandedProfiles.has(name)) {
        TemuExpandedProfiles.delete(name);
        item.classList.add('collapsed');
      } else {
        TemuExpandedProfiles.add(name);
        item.classList.remove('collapsed');
      }
      item.classList.toggle('expanded', TemuExpandedProfiles.has(name));
    });

    item.querySelector('[data-edit]').addEventListener('click', (e) => {
      e.stopPropagation();
      $('tcName').value = name; $('tcCat').value = p.category_keyword || '';
      $('tcMatch').value = (p.match||[]).join(', '); $('tcExclude').value = (p.exclude||[]).join(', ');
      $('tcAttrs').value = p.keyword_attributes || '';
      $('tcW').value = p.weight_lb ?? ''; $('tcL').value = p.length_in ?? '';
      $('tcWd').value = p.width_in ?? ''; $('tcH').value = p.height_in ?? '';
      if ($('tcPx')) $('tcPx').value = p.price_multiplier ?? '';
      if ($('tcMinPx')) $('tcMinPx').value = p.price_min ?? '';
      const ft = $('tcFormTitle'); if (ft) ft.textContent = `Edit category: ${displayName}`;
      const form = $('temuCatForm');
      if (form) {
        form.classList.remove('hidden');
        form.classList.add('editing');
      }
      temuCatMsg('');
      try { $('temuCatForm').scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (_) {}
    });

    item.querySelector('[data-del]').addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm(`Category "${displayName}" delete karein?`)) return;
      const cfg2 = temuGetCfg(); delete cfg2.category_profiles[name];
      const r = await temuSaveCfg(cfg2);
      if (r === true) { temuRenderProfiles(); temuCatMsg(`Category "${displayName}" removed`, 'ok'); }
      else temuCatMsg('Delete fail: ' + (r || 'save error'), 'bad');
    });

    box.appendChild(item);
  });
}

async function temuFetchFromTemuTab() {
  toast('Temu tab se category detect ho rahi hai…', 'info');
  try {
    const tabs = await new Promise(r => chrome.tabs.query({}, r));
    const temuTab = tabs.find(t => /seller\.temu\.com|temu\.com/i.test(t.url));
    if (!temuTab) {
      toast('Koi open Temu tab nahi mila! Pehle Temu tab open karein.', 'warn');
      return;
    }
    chrome.tabs.sendMessage(temuTab.id, { action: 'TEMU_GET_PAGE_CATEGORY' }, (resp) => {
      if (chrome.runtime.lastError || !resp || !resp.success) {
        toast('Temu tab se category detect nahi hui. Product ya Seller Center page open karein.', 'warn');
        return;
      }
      const cat = (resp.category || '').trim();
      const title = (resp.title || '').trim();
      if (!cat && !title) {
        toast('Temu page par category nahi mili.', 'warn');
        return;
      }
      const rawName = cat || title.split(/[-–—|:]/)[0].trim();
      const safeName = rawName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
      
      if ($('tcName')) $('tcName').value = safeName;
      if ($('tcCat')) $('tcCat').value = cat || rawName;
      if ($('tcMatch')) $('tcMatch').value = rawName.toLowerCase();
      
      const form = $('temuCatForm');
      if (form) {
        form.classList.remove('hidden');
        form.classList.add('editing');
        const ft = $('tcFormTitle'); if (ft) ft.textContent = `Add from Temu: ${rawName}`;
        try { form.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (_) {}
      }
      toast(`✓ Temu se category mil gayi: "${cat || rawName}"`, 'ok');
    });
  } catch (e) {
    toast('Error: ' + e?.message, 'bad');
  }
}

function temuOpenCatalogModal() {
  const modal = $('temuCatalogModal');
  if (!modal) return;
  modal.classList.remove('hidden');
  temuRenderCatalogGrid();
}

function temuRenderCatalogGrid() {
  const grid = $('temuCatalogGrid');
  if (!grid) return;
  const q = ($('temuCatalogSearch')?.value || '').trim().toLowerCase();
  const cfg = temuGetCfg();
  const existing = cfg.category_profiles || {};

  grid.innerHTML = '';
  const filtered = TEMU_CATALOG_PRESETS.filter(p => {
    if (!q) return true;
    return p.name.toLowerCase().includes(q) || p.cat.toLowerCase().includes(q) || p.match.some(m => m.toLowerCase().includes(q));
  });

  filtered.forEach(p => {
    const isAdded = !!existing[p.id];
    const card = document.createElement('div');
    card.className = 'temu-catalog-card';
    card.innerHTML = `
      <div class="temu-cat-c-head">
        <span class="temu-cat-c-name">${esc(p.name)}</span>
        <span class="temu-cat-c-badge">${esc(p.cat)}</span>
      </div>
      <div class="temu-cat-c-desc">
        <b>Keywords:</b> ${esc(p.match.slice(0, 4).join(', '))}${p.match.length > 4 ? '…' : ''}
        ${p.attrs ? `<br><b>Attrs:</b> ${esc(p.attrs)}` : ''}
      </div>
      <div class="temu-cat-c-foot">
        <span class="temu-cat-c-meta">${p.w} lb · ${p.l}×${p.wd}×${p.h} in</span>
        <button class="btn ${isAdded ? 'btn-ghost' : 'btn-primary'} btn-xs temu-cat-c-add" type="button" ${isAdded ? 'disabled' : ''}>
          ${isAdded ? '✓ Added' : '+ Add'}
        </button>
      </div>
    `;

    card.querySelector('.temu-cat-c-add').addEventListener('click', async () => {
      const cfg2 = temuGetCfg();
      cfg2.category_profiles = cfg2.category_profiles || {};
      cfg2.category_profiles[p.id] = {
        category_keyword: p.cat,
        match: p.match,
        exclude: p.exclude || [],
        keyword_attributes: p.attrs || '',
        weight_lb: p.w,
        length_in: p.l,
        width_in: p.wd,
        height_in: p.h
      };
      await temuSaveCfg(cfg2);
      temuRenderProfiles();
      temuRenderCatalogGrid();
      toast(`Category "${p.name}" add ho gayi!`, 'ok');
    });

    grid.appendChild(card);
  });
}

async function temuImportAllCatalog() {
  if (!confirm('Catalog ke tamam 50+ categories import karein?')) return;
  const cfg = temuGetCfg();
  cfg.category_profiles = cfg.category_profiles || {};
  let count = 0;
  TEMU_CATALOG_PRESETS.forEach(p => {
    if (!cfg.category_profiles[p.id]) {
      cfg.category_profiles[p.id] = {
        category_keyword: p.cat,
        match: p.match,
        exclude: p.exclude || [],
        keyword_attributes: p.attrs || '',
        weight_lb: p.w,
        length_in: p.l,
        width_in: p.wd,
        height_in: p.h
      };
      count++;
    }
  });
  await temuSaveCfg(cfg);
  temuRenderProfiles();
  temuRenderCatalogGrid();
  toast(`${count} new categories catalog se add ho gayin!`, 'ok');
}

async function temuImportTemplateCategory(file) {
  if (!file) return;
  try {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const ws = wb.Sheets['Template'] || wb.Sheets[wb.SheetNames[0]];
    if (!ws) { toast('Invalid Excel template file', 'bad'); return; }
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    let foundCat = '';
    for (let r = 0; r < Math.min(5, aoa.length); r++) {
      for (let c = 0; c < (aoa[r] || []).length; c++) {
        const val = String(aoa[r][c] || '').trim();
        if (/category/i.test(val) && val.length > 5) {
          foundCat = val.replace(/.*category[:\s]*/i, '').trim();
          break;
        }
      }
      if (foundCat) break;
    }
    if (!foundCat) {
      foundCat = file.name.replace(/\.xlsx$/i, '').replace(/temu[_-]?upload[_-]?/i, '').replace(/[_-]/g, ' ').trim() || 'Template Category';
    }
    const safeName = foundCat.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    const cfg = temuGetCfg();
    cfg.category_profiles = cfg.category_profiles || {};
    cfg.category_profiles[safeName] = {
      category_keyword: foundCat,
      match: [foundCat.toLowerCase()],
      weight_lb: 1.0, length_in: 8, width_in: 6, height_in: 2
    };
    await temuSaveCfg(cfg);
    temuRenderProfiles();
    toast(`✓ Category "${foundCat}" template se import ho gayi!`, 'ok');
  } catch (err) {
    toast('Template read error: ' + err?.message, 'bad');
  }
}

function temuCatMsg(text, kind) {
  const el = $('tcMsg'); if (!el) return;
  el.textContent = text || ''; el.className = 'temu-inline-msg' + (kind ? ' ' + kind : '');
  if (text && kind === 'ok') setTimeout(() => { if (el.textContent === text) { el.textContent = ''; el.className = 'temu-inline-msg'; } }, 4000);
}
function temuCatFormReset() {
  ['tcName','tcCat','tcMatch','tcExclude','tcAttrs','tcW','tcL','tcWd','tcH','tcPx','tcMinPx'].forEach(id => { const el = $(id); if (el) el.value = ''; });
  const ft = $('tcFormTitle'); if (ft) ft.textContent = 'Add category';
  const form = $('temuCatForm');
  if (form) {
    form.classList.remove('editing');
    form.classList.add('hidden');
  }
}

async function temuSaveProfileFromForm() {
  const rawName = ($('tcName')?.value || '').trim();
  const name = rawName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const match = ($('tcMatch')?.value || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
  const exclude = ($('tcExclude')?.value || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
  if (!name) { temuCatMsg('Name likhein (e.g. cat_food)', 'bad'); $('tcName')?.focus(); return; }
  if (!match.length) { temuCatMsg('Kam az kam ek title keyword likhein', 'bad'); $('tcMatch')?.focus(); return; }
  if (!temuActiveStoreName()) { temuCatMsg('Pehle Upload tab mein store add/select karein', 'bad'); return; }
  const num = v => { const x = parseFloat(v); return isFinite(x) && x > 0 ? x : undefined; };
  const cfg = temuGetCfg();
  const prev = cfg.category_profiles[name] || {};
  const prof = {
    ...prev,
    match, exclude,
    category_keyword: ($('tcCat')?.value || '').trim(),
    keyword_attributes: ($('tcAttrs')?.value || '').trim(),
    weight_lb: num($('tcW')?.value), length_in: num($('tcL')?.value),
    width_in: num($('tcWd')?.value), height_in: num($('tcH')?.value),
    price_multiplier: num($('tcPx')?.value), price_min: num($('tcMinPx')?.value)
  };
  Object.keys(prof).forEach(k => { if (prof[k] === undefined || (Array.isArray(prof[k]) && !prof[k].length && k === 'exclude')) delete prof[k]; });
  cfg.category_profiles[name] = prof;
  temuCatMsg('Saving…');
  const r = await temuSaveCfg(cfg);
  if (r === true) {
    temuCatFormReset();
    temuRenderProfiles();
    temuCatMsg(`✓ Category "${name}" saved`, 'ok');
  } else {
    temuCatMsg('Save fail: ' + (r || 'unknown error') + ' — dobara try karein', 'bad');
  }
}

// Fill every modal field from the active store's config
function temuFillForm() {
  const cfg = temuGetCfg(); const d = cfg.defaults || {};
  const set = (id, v) => { const el = $(id); if (el) el.value = (v === null || v === undefined) ? '' : v; };
  const chk = (id, v) => { const el = $(id); if (el) el.checked = !!v; };
  set('tgW', d.weight_lb); set('tgL', d.length_in); set('tgWd', d.width_in); set('tgH', d.height_in);
  set('tgPx', cfg.price_multiplier); set('tgPx2', cfg.price_multiplier);
  set('tgListPx', cfg.list_price_multiplier ?? 1.25);
  set('tgMinPx', cfg.price_min ?? 80); set('tgMaxPx', cfg.price_max ?? 999);
  set('tgQtyMin', cfg.quantity_min ?? 250); set('tgQtyMax', cfg.quantity_max ?? 500);
  set('tgMaxW', cfg.max_weight_lb ?? 8);
  set('tgWords', (cfg.title_remove_words || []).join(', '));
  set('tgVarValues', (cfg.simple_variation_values || []).join(', '));
  chk('tgSkipListed', cfg.skip_listed !== false);
  chk('tgSmartVar', cfg.smart_variations !== false);
  chk('tgBgUpload', cfg.upload_in_background !== false);
  chk('tgSmartWeight', cfg.smart_weight !== false);
  chk('tgDescOn', cfg.fill_description !== false);
  set('tgAvoidWords', (cfg.desc_avoid_words || []).join(', '));
  temuRenderDeptTable(cfg);
  temuUpdateSrcInfo();
}

// v9.12.0 — department pricing table (Settings)
function temuRenderDeptTable(cfg) {
  const box = $('tgDeptTable'); if (!box) return;
  cfg = cfg || temuGetCfg();
  const dp = cfg.dept_pricing || {};
  // user is typing in the table (auto-save just ran) → don't rebuild, keep the cursor
  if (box.contains(document.activeElement)) { const cnt = $('tgDeptCount'); if (cnt) cnt.textContent = `${Object.keys(dp).length} set`; return; }
  const esc = v => String(v ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const counts = {};
  Object.values(cfg.category_profiles || {}).forEach(p => { const d = temuDeptOf(p); if (d) counts[d] = (counts[d] || 0) + 1; });
  const ph = { px: cfg.price_multiplier ?? 5, min: cfg.price_min ?? 80, max: cfg.price_max ?? 999 };
  const rows = temuDepartments(cfg).map(d => {
    const v = dp[d] || {};
    const on = v.px || v.min || v.max;
    return `<div class="tg-dept-row${on ? ' on' : ''}" data-dept="${esc(d)}">
      <span class="tg-dept-name" title="${esc(d)}">${esc(d)}<small>${counts[d] || 0} categories</small></span>
      <input class="inp" data-k="px" inputmode="decimal" placeholder="${esc(ph.px)}" value="${esc(v.px ?? '')}" />
      <input class="inp" data-k="min" inputmode="decimal" placeholder="${esc(ph.min)}" value="${esc(v.min ?? '')}" />
      <input class="inp" data-k="max" inputmode="decimal" placeholder="${esc(ph.max)}" value="${esc(v.max ?? '')}" />
    </div>`;
  }).join('');
  box.innerHTML = '<div class="tg-dept-row tg-dept-th"><span>Department</span><span>Price ×</span><span>Min $</span><span>Max $</span></div>' + rows;
  const cnt = $('tgDeptCount'); if (cnt) cnt.textContent = `${Object.keys(dp).length} set`;
}
// read the table → { dept: {px,min,max} } (only filled rows)
function temuReadDeptTable() {
  const out = {};
  document.querySelectorAll('#tgDeptTable .tg-dept-row[data-dept]').forEach(row => {
    const v = {};
    row.querySelectorAll('input[data-k]').forEach(i => { const x = parseFloat(i.value); if (isFinite(x) && x > 0) v[i.dataset.k] = x; });
    row.classList.toggle('on', Object.keys(v).length > 0);
    if (Object.keys(v).length) out[row.dataset.dept] = v;
  });
  return out;
}
// Settings pane fields that the export reads live (no Save needed)
function temuApplyLiveCopyPrice(cfg) {
  const dc = $('tgDescOn'); if (dc) cfg.fill_description = !!dc.checked;
  const aw = $('tgAvoidWords'); if (aw) cfg.desc_avoid_words = aw.value.split(',').map(x => x.trim()).filter(Boolean);
  if ($('tgDeptTable')?.querySelector('.tg-dept-row[data-dept]')) cfg.dept_pricing = temuReadDeptTable();
  return cfg;
}
// "N products ready" line under the source selector
async function temuUpdateSrcInfo() {
  temuSyncSrcSeg();
  const el = $('temuSrcInfo'); if (!el) return;
  try {
    const source = $('temuSource')?.value || 'bulk';
    if (source === 'sheet' && TemuLast?.asIs) { el.textContent = `${TemuLast.n} products — Temu file as-is (${TemuLast.name}) · store: ${temuActiveStoreName() || '—'}`; return; }
    let rows = [];
    if (source === 'bulk') rows = (BulkState?.results || []).filter(x => x.status !== 'fail');
    else if (source === 'library_sel' && TemuLibPick?.ids) rows = (await getMasterRows()).filter(r => TemuLibPick.ids.has(r.id));
    else if (source === 'sheet' && TemuSheetRows) rows = TemuSheetRows;
    else rows = await getMasterRows();
    const n = rows.length;
    if (!n) { el.textContent = source === 'bulk' ? '0 products — pehle Bulk → Hunt all open tabs chalayen' : '0 products in Library'; return; }
    const cfg = temuGetCfg();
    const store = temuActiveStoreName() || 'default';
    const skipOn = $('tgSkipListed') ? !!$('tgSkipListed').checked : cfg.skip_listed !== false; // v9.7.4: export ki tarah live checkbox
    const listed = rows.filter(r => temuListedMap()[store + '|' + temuSourceIdentity(r.url || '')]).length;
    el.textContent = `${n} products ready` + (listed ? ` · ${listed} already listed (${skipOn ? 'skip' : 'skip OFF — dobara jayenge!'})` : '') + ` · store: ${temuActiveStoreName() || '—'}`;
  } catch (_) { el.textContent = '—'; }
}
function temuSwitchTab(name) {
  document.querySelectorAll('#temuModal .temu-tab').forEach(b => b.classList.toggle('active', b.dataset.ttab === name));
  document.querySelectorAll('#temuModal .temu-pane').forEach(p => p.classList.toggle('active', p.dataset.tpane === name));
}
function temuSaveMsg(text, kind) {
  const el = $('tgSaveMsg'); if (!el) return;
  el.textContent = text || ''; el.className = 'temu-inline-msg' + (kind ? ' ' + kind : '');
  if (text && kind === 'ok') setTimeout(() => { if (el.textContent === text) { el.textContent = ''; el.className = 'temu-inline-msg'; } }, 4000);
}

// ═════════════════════════════════════════════════════════════════
// ═══ Product Review Studio ═══
// ═════════════════════════════════════════════════════════════════
const TemuReviewExcluded = new Set(); // product IDs excluded from upload
let TemuImgStepper = {
  queue: [],
  currentIndex: 0,
  engine: 'flow',
  prompt: '',
  activeJobId: null,   // Flow job the stepper is waiting on (only this result is accepted)
  stats: { done: 0, skipped: 0 }
};

// v9.9.0 — image-edit selection, independent from "Include in upload"
const TemuImgEditSelected = new Set(); // product IDs picked for AI image editing (default: none)
const TemuImgPick = new Map();         // productId -> Set(image indexes) chosen with the per-image "AI" boxes


function temuUpdateReviewCount(rows) {
  const countEl = $('temuReviewCount');
  if (!countEl) return;
  const included = rows.filter(r => !TemuReviewExcluded.has(r.id)).length;
  countEl.textContent = `${included} / ${rows.length}`;
  const bulkBtn = $('temuAiBulkRewriteBtn');
  if (bulkBtn && !bulkBtn.disabled) {
    bulkBtn.textContent = `AI Title Rewrite (${included})`;
  }
  temuUpdateImgEditCount(rows);
}

function _thumbUrl(r) {
  if (Array.isArray(r.images) && r.images.length) {
    if (typeof r.images[0] === 'string') return r.images[0];
    if (r.images[0]?.url) return r.images[0].url;
  }
  return '';
}

function _allImgUrls(r) {
  if (!Array.isArray(r.images)) return [];
  return r.images.map(img => (typeof img === 'string' ? img : img?.url || '')).filter(Boolean);
}

async function temuRenderReview() {
  const list = $('temuReviewList');
  const countEl = $('temuReviewCount');
  if (!list) return;
  const rows = await temuGetQueuedRows();
  if (countEl) temuUpdateReviewCount(rows);
  if (list.classList.contains('hidden')) return; // collapsed — no render needed

  if (!rows.length) {
    list.innerHTML = '<div class="temu-review-empty">Koi products nahi — pehle hunt karein.</div>';
    return;
  }

  const cfg = temuGetCfg();
  const px = parseFloat($('tgPx')?.value || $('tgPx2')?.value || cfg.price_multiplier);
  if (isFinite(px) && px > 0) cfg.price_multiplier = px;

  list.innerHTML = '';
  { // v9.12.5 — sticky mini toolbar (list now scrolls inside its own box)
    const tools = document.createElement('div');
    tools.className = 'temu-rv-tools';
    tools.innerHTML = `<span class="temu-rv-tools-n">${rows.length} products</span>
      <div class="temu-rv-tools-right">
        <button type="button" class="temu-rv-chip" data-t="upd" title="Show only products whose titles were rewritten by AI">
          <svg viewBox="0 0 24 24"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3z"/></svg>
          AI Updated
        </button>
        <button type="button" class="temu-rv-icon-btn" data-t="close" title="Collapse all expanded product cards">
          <svg viewBox="0 0 24 24"><polyline points="18 15 12 9 6 15"/></svg>
          Collapse All
        </button>
      </div>`;
    tools.addEventListener('click', e => {
      const b = e.target.closest('button[data-t]');
      if (!b) return;
      if (b.dataset.t === 'close') {
        list.querySelectorAll('.temu-rv-card.open').forEach(c => {
          c.classList.remove('open');
          c.querySelector('.temu-rv-expanded')?.classList.add('hidden');
          const ch = c.querySelector('.temu-rv-chev'); if (ch) ch.style.transform = '';
        });
        list.scrollTo({ top: 0, behavior: 'smooth' });
      } else {
        const on = list.classList.toggle('only-upd');
        b.classList.toggle('on', on);
      }
    });
    list.appendChild(tools);
  }
  rows.forEach((r, idx) => {
    const thumb = _thumbUrl(r);
    const allImgs = _allImgUrls(r);
    const title = r.title || '';
    const rawPrice = r.temuBase || r.price;
    const [calcBase] = temuPrice(rawPrice, cfg, temuProfileFor(temuCleanTitle(title, cfg), cfg)[1]);
    const displayPrice = calcBase !== null ? calcBase.toFixed(2) : (r.price ? String(r.price).replace(/^[^\d.]*/, '') : '—');
    const len = title.length;
    const lenCls = len <= 140 ? 'ok' : len <= 180 ? 'warn' : 'over';
    const excluded = TemuReviewExcluded.has(r.id);

    const card = document.createElement('div');
    card.className = 'temu-rv-card' + (excluded ? ' excluded' : '') + (TemuImgEditSelected.has(r.id) ? ' img-edit-on' : '');
    card.dataset.idx = idx;
    card.dataset.id = r.id || '';
    card.dataset.rawPrice = r.price || '';

    // Image gallery HTML (compact, fixed height, horizontal scroll)
    const pickedIdx = new Set(temuImgTargetIndices(r));
    const editSel = TemuImgEditSelected.has(r.id);
    const imgHtml = allImgs.map((url, iIdx) => `
      <div class="temu-rv-img-item" data-iidx="${iIdx}">
        <img src="${esc(url)}" class="temu-rv-img-thumb${iIdx === 0 ? ' main-img' : ''}" loading="lazy" alt="img${iIdx+1}" title="Click to Zoom & Inspect" />
        <label class="temu-rv-img-chk-lbl" title="Select for AI Generation">
          <input type="checkbox" class="temu-rv-img-chk" data-iidx="${iIdx}" ${pickedIdx.has(iIdx) ? 'checked' : ''} />
          <span>AI</span>
        </label>
        <div class="temu-rv-img-actions">
          ${iIdx !== 0 ? `<button class="temu-rv-img-btn" data-action="setmain" data-iidx="${iIdx}" title="Set as main image">★</button>` : '<span class="temu-rv-img-main-lbl">Main</span>'}
          <button class="temu-rv-img-btn zoom-btn" data-action="zoom" data-iidx="${iIdx}" data-url="${esc(url)}" title="Zoom & Inspect">🔍</button>
          <button class="temu-rv-img-btn danger" data-action="delimg" data-iidx="${iIdx}" title="Delete image">🗑</button>
          <button class="temu-rv-img-btn gemini" data-action="gemini" data-iidx="${iIdx}" data-url="${esc(url)}" title="Edit in Flow / Gemini">✨</button>
          <button class="temu-rv-img-btn paste" data-action="paste_img" data-iidx="${iIdx}" title="Paste Edited Image from Clipboard">📋</button>
          <button class="temu-rv-img-btn" data-action="device_img" data-iidx="${iIdx}" title="Device se image replace karein" aria-label="Device se image replace karein">📂</button>
        </div>
      </div>
    `).join('');

    const imgSection = allImgs.length
      ? `<div class="temu-rv-gallery-wrap"><div class="temu-rv-gallery">${imgHtml}</div></div>`
      : `<div class="temu-rv-no-img">No images</div>`;

    card.innerHTML = `
      <div class="temu-rv-collapsed-row">
        <label class="temu-rv-chk-wrap" title="Include in upload">
          <input type="checkbox" class="temu-rv-chk" ${excluded ? '' : 'checked'} />
        </label>
        <label class="temu-rv-edit-wrap" title="AI image edit ke liye select (upload se alag)">
          <input type="checkbox" class="temu-rv-edit-chk" ${editSel ? 'checked' : ''} />
          <span>✨</span>
        </label>
        ${thumb ? `<img class="temu-rv-thumb" src="${esc(thumb)}" alt="" loading="lazy" />` : `<span class="temu-rv-thumb temu-rv-no-thumb">📦</span>`}
        <span class="temu-rv-title-snippet">${esc(title)}</span>
        <span class="temu-rv-price-badge">${calcBase !== null ? '$' + displayPrice : '—'}</span>
        <button class="temu-rv-del-btn" title="Product delete karein" type="button">🗑</button>
        <svg class="i temu-rv-chev" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>
      </div>
      <div class="temu-rv-expanded hidden">
        <div class="temu-rv-fields">
          <div class="temu-rv-field-group">
            <label class="temu-lbl">Title</label>
            <div class="temu-rv-title-row">
              <input type="text" class="inp temu-rv-title-inp" value="${esc(title)}" placeholder="Product title..." />
              <span class="temu-ai-char-badge ${lenCls}">${len}/180</span>
              <button class="btn btn-ghost btn-xs temu-rv-ai-btn" title="AI Rewrite this title">⚡ AI</button>
            </div>
          </div>
          <div class="temu-rv-field-group temu-rv-price-group">
            <label class="temu-lbl">Temu Price ($)</label>
            <input type="text" class="inp temu-rv-price-inp" value="${calcBase !== null ? displayPrice : esc(String(r.price || ''))}" placeholder="0.00" inputmode="decimal" />
          </div>
        </div>
        <div class="temu-rv-imgs-section">
          <label class="temu-lbl">Images (${allImgs.length})</label>
          ${imgSection}
        </div>
      </div>
    `;

    // Checkbox toggle
    const chk = card.querySelector('.temu-rv-chk');
    chk?.addEventListener('change', () => {
      if (chk.checked) TemuReviewExcluded.delete(r.id);
      else TemuReviewExcluded.add(r.id);
      card.classList.toggle('excluded', !chk.checked);
      TemuLast = null;
      temuUpdateReviewCount(rows);
    });

    // v9.9.0 — AI image edit selection (separate from upload)
    const editChk = card.querySelector('.temu-rv-edit-chk');
    editChk?.addEventListener('change', () => {
      if (editChk.checked) TemuImgEditSelected.add(r.id);
      else TemuImgEditSelected.delete(r.id);
      card.classList.toggle('img-edit-on', editChk.checked);
      temuUpdateImgEditCount(rows);
    });
    card.querySelectorAll('.temu-rv-img-chk').forEach(ic => {
      ic.addEventListener('change', () => {
        const set = new Set();
        card.querySelectorAll('.temu-rv-img-chk').forEach(x => { if (x.checked) set.add(parseInt(x.dataset.iidx, 10)); });
        TemuImgPick.set(r.id, set);
        // Ticking an image implies you want this product edited
        if (set.size && !TemuImgEditSelected.has(r.id)) {
          TemuImgEditSelected.add(r.id);
          if (editChk) editChk.checked = true;
          card.classList.add('img-edit-on');
        }
        temuUpdateImgEditCount(rows);
      });
    });

    // Delete product button
    const delBtn = card.querySelector('.temu-rv-del-btn');
    delBtn?.addEventListener('click', async e => {
      e.stopPropagation();
      const source = $('temuSource')?.value || 'bulk';
      if (source === 'bulk' && BulkState?.results) {
        BulkState.results = BulkState.results.filter(x => x.id !== r.id && x.url !== r.url);
      }
      if (source === 'sheet' && TemuSheetRows) {
        TemuSheetRows = TemuSheetRows.filter(x => x.id !== r.id && x.url !== r.url);
      }
      try {
        const existing = await getMasterRows();
        const filtered = existing.filter(x => x.id !== r.id && x.url !== r.url);
        if (filtered.length !== existing.length) {
          await setMasterRows(filtered, existing);
          if (MasterUIState?.allRows) MasterUIState.allRows = filtered;
        }
      } catch (_) {}

      TemuReviewExcluded.delete(r.id);
      card.style.transition = 'all 0.2s ease';
      card.style.opacity = '0';
      card.style.transform = 'scale(0.95)';
      setTimeout(async () => {
        card.remove();
        const remaining = await temuGetQueuedRows();
        temuUpdateReviewCount(remaining);
        temuUpdateSrcInfo();
        toast('Product deleted ✓', 'ok');
      }, 200);
    });

    // Title input live char count
    const titleInp = card.querySelector('.temu-rv-title-inp');
    const badge = card.querySelector('.temu-ai-char-badge');
    titleInp?.addEventListener('input', e => {
      const v = e.target.value; r.title = v;
      const l = v.length;
      badge.textContent = `${l}/180`;
      badge.className = 'temu-ai-char-badge ' + (l <= 140 ? 'ok' : l <= 180 ? 'warn' : 'over');
    });
    titleInp?.addEventListener('change', async e => {
      r.title = e.target.value;
      const sn = card.querySelector('.temu-rv-title-snippet'); if (sn) sn.textContent = r.title;
      await temuSaveTitles([{ id: r.id, url: r.url, title: r.title }]); // v9.12.3 safe save
    });

    // Price input save
    const priceInp = card.querySelector('.temu-rv-price-inp');
    priceInp?.addEventListener('change', async e => {
      const val = parseFloat(e.target.value.replace(/[$,]/g, ''));
      if (isFinite(val) && val > 0) {
        r.temuBase = val;
        card.dataset.customPrice = '1';
        const b = card.querySelector('.temu-rv-price-badge');
        if (b) b.textContent = '$' + val.toFixed(2);
      }
      if (!isFinite(val) || val <= 0) { delete r.temuBase; }
      const override = r.temuBase ?? '';
      for (const copy of _productRowsById(r.id)) copy.temuBase = override;
      await zhLibPatch(saved => { const m = saved.find(x => x.id === r.id || x.url === r.url); if (!m) return false; m.temuBase = override; return true; });
      TemuLast = null;
    });

    // Per-product AI Rewrite
    const aiBtn = card.querySelector('.temu-rv-ai-btn');
    aiBtn?.addEventListener('click', async () => {
      aiBtn.textContent = '⏳';
      aiBtn.disabled = true;
      try {
        const userPrompt = temuTitlePreferences();
        const instruction = getTemuOptimizerInstruction(userPrompt);
        const currentTitle = titleInp?.value || r.title || '';
        const cleaned = await rewriteValidatedTemuTitle(r, currentTitle, instruction, !userPrompt);
        if (cleaned && titleInp) {
          titleInp.value = cleaned; r.title = cleaned;
          const l = cleaned.length;
          if (badge) {
            badge.textContent = `${l}/180`;
            badge.className = 'temu-ai-char-badge ' + (l <= 140 ? 'ok' : l <= 180 ? 'warn' : 'over');
          }
          const snippet = card.querySelector('.temu-rv-title-snippet');
          if (snippet) snippet.textContent = cleaned;
          const same = temuNormTitle(cleaned) === temuNormTitle(currentTitle);
          temuMarkCardUpdated(card, currentTitle, cleaned, same);
          const v = await temuSaveTitles([{ id: r.id, url: r.url, title: cleaned }]);
          toast(same ? 'AI ne wahi title diya (koi farq nahi)' : (v.inFile ? 'Title rewritten ✓ (saved)' : 'Title badla lekin save confirm nahi hua'), same ? 'info' : (v.inFile ? 'ok' : 'warn'));
        }
      } catch (err) { toast('AI error: ' + err.message, 'warn'); }
      aiBtn.textContent = '⚡ AI'; aiBtn.disabled = false;
    });

    // Thumbnail click to Zoom & Inspect
    card.querySelectorAll('.temu-rv-img-thumb').forEach((thumbEl, iIdx) => {
      thumbEl.addEventListener('click', e => {
        e.stopPropagation();
        openLightbox(allImgs[iIdx], r.title || 'Product', allImgs, iIdx);
      });
    });

    // Image action buttons (set main, zoom, delete, gemini/flow)
    card.querySelectorAll('.temu-rv-img-btn').forEach(btn => {
      btn.addEventListener('click', async e => {
        e.stopPropagation();
        const action = btn.dataset.action;
        const iIdx = parseInt(btn.dataset.iidx, 10);
        if (action === 'setmain') {
          if (!Array.isArray(r.images) || iIdx >= r.images.length) return;
          const moved = r.images.splice(iIdx, 1)[0];
          r.images.unshift(moved);
          const images = [...r.images];
          for (const copy of _productRowsById(r.id)) copy.images = [...images];
          await zhLibPatch(saved => { const m = saved.find(x => x.id === r.id || x.url === r.url); if (!m) return false; m.images = [...images]; return true; });
          TemuLast = null;
          await temuRenderReview();
        } else if (action === 'zoom') {
          const imgUrl = btn.dataset.url || '';
          openLightbox(imgUrl, r.title || 'Product', allImgs, iIdx);
        } else if (action === 'delimg') {
          if (!Array.isArray(r.images) || r.images.length <= 1) { toast('Kam az kam ek image zaruri hai', 'warn'); return; }
          r.images.splice(iIdx, 1);
          const images = [...r.images];
          for (const copy of _productRowsById(r.id)) copy.images = [...images];
          await zhLibPatch(saved => { const m = saved.find(x => x.id === r.id || x.url === r.url); if (!m) return false; m.images = [...images]; return true; });
          TemuLast = null;
          await temuRenderReview();
        } else if (action === 'gemini') {
          const imgUrl = btn.dataset.url || '';
          temuOpenGeminiModal(imgUrl, r.title || '', r.id, iIdx);
        } else if (action === 'device_img') {
          const input = document.createElement('input');
          input.type = 'file'; input.accept = 'image/png,image/jpeg,image/webp';
          input.onchange = async () => {
            const file = input.files?.[0];
            if (!file) return;
            if (!/^image\/(png|jpeg|webp)$/i.test(file.type)) {
              toast('PNG, JPG ya WebP image select karein', 'warn'); return;
            }
            try {
              const src = await _fileToDataUrl(file);
              if (!(await replaceProductImage(r.id, iIdx, src, null))) {
                toast('Product image nahi mili', 'warn'); return;
              }
              if (Array.isArray(r.images)) {
                const previous = r.images[iIdx];
                r.images[iIdx] = typeof previous === 'object' && previous !== null
                  ? { ...previous, url: src } : src;
              }
              await temuRenderReview();
              toast('Device image replaced', 'ok');
              const pub = await uploadImageToPublicHost(src);
              if (pub && /^https?:\/\//i.test(pub)) {
                await replaceProductImage(r.id, iIdx, pub, src);
                const current = r.images?.[iIdx];
                if (current === src) r.images[iIdx] = pub;
                else if (current?.url === src) r.images[iIdx] = { ...current, url: pub };
                await temuRenderReview();
              }
            } catch (err) { toast('Image nahi lagi: ' + (err?.message || err), 'warn'); }
          };
          input.click();
        } else if (action === 'paste_img') {
          // Try direct clipboard first (works if sidepanel is focused)
          let base64FromClipboard = null;
          try {
            const items = await navigator.clipboard.read();
            for (const item of items) {
              const type = item.types.find(t => t.startsWith('image/'));
              if (type) {
                const blob = await item.getType(type);
                base64FromClipboard = await new Promise(res => {
                  const rd = new FileReader();
                  rd.onload = () => res(rd.result);
                  rd.readAsDataURL(blob);
                });
                break;
              }
            }
          } catch (_) { /* fallback below */ }

          // Fallback: read clipboard via Flow tab (has focus & clipboard permission)
          if (!base64FromClipboard) {
            try {
              const tabs = await chrome.tabs.query({});
              const flowTab = tabs.find(t => t.url && t.url.includes('flow.google.com'));
              if (flowTab) {
                const results = await chrome.scripting.executeScript({
                  target: { tabId: flowTab.id },
                  func: async () => {
                    try {
                      const items = await navigator.clipboard.read();
                      for (const item of items) {
                        const type = item.types.find(t => t.startsWith('image/'));
                        if (type) {
                          const blob = await item.getType(type);
                          return await new Promise(res => {
                            const rd = new FileReader();
                            rd.onload = () => res(rd.result);
                            rd.readAsDataURL(blob);
                          });
                        }
                      }
                    } catch (e) { return null; }
                    return null;
                  }
                });
                base64FromClipboard = results?.[0]?.result || null;
              }
            } catch (e2) { console.warn('[ZHunter] Flow tab clipboard error:', e2); }
          }

          if (base64FromClipboard) {
            if (!(await replaceProductImage(r.id, iIdx, base64FromClipboard, null))) {
              toast('Product image nahi mili', 'warn'); return;
            }
            await temuRenderReview();
            toast('✓ Image pasted! Uploading link for Temu...', 'info');
            (async () => {
              const pub = await uploadImageToPublicHost(base64FromClipboard);
              if (pub && pub.startsWith('http')) {
                await replaceProductImage(r.id, iIdx, pub, base64FromClipboard);
                toast('✓ Temu image link ready!', 'ok');
              }
            })();
          } else {
            toast('Clipboard me image nahi mili. Flow me image par right-click → "Copy Image" karein, phir 📋 click karein!', 'warn');
          }
        }
      });
    });

    // Expand/collapse on row click (not checkbox or buttons)
    const collapsedRow = card.querySelector('.temu-rv-collapsed-row');
    const expanded = card.querySelector('.temu-rv-expanded');
    const chev = card.querySelector('.temu-rv-chev');
    collapsedRow?.addEventListener('click', e => {
      if (e.target.closest('.temu-rv-chk-wrap') || e.target.closest('.temu-rv-edit-wrap') || e.target.closest('.temu-rv-del-btn')) return;
      expanded?.classList.toggle('hidden');
      card.classList.toggle('open');
      if (chev) chev.style.transform = card.classList.contains('open') ? 'rotate(180deg)' : '';
    });

    list.appendChild(card);
  });
}

function temuRefreshReviewPrices() {
  const cfg = temuGetCfg();
  const px = parseFloat($('tgPx')?.value || $('tgPx2')?.value || cfg.price_multiplier);
  if (isFinite(px) && px > 0) cfg.price_multiplier = px;
  document.querySelectorAll('.temu-rv-card').forEach(card => {
    if (card.dataset.customPrice) return;
    const rawPrice = card.dataset.rawPrice;
    if (!rawPrice) return;
    const ttl = card.querySelector('.temu-rv-title-inp')?.value || '';
    const [calcBase] = temuPrice(rawPrice, cfg, temuProfileFor(temuCleanTitle(ttl, cfg), cfg)[1]);
    if (calcBase !== null) {
      const b = card.querySelector('.temu-rv-price-badge');
      if (b) b.textContent = '$' + calcBase.toFixed(2);
      const inp = card.querySelector('.temu-rv-price-inp');
      if (inp) inp.value = calcBase.toFixed(2);
    }
  });
}

const ECOM_JUNK_RE = /\b(add to cart|add to list|add to registry|buy now|in stock|out of stock|free shipping|free delivery|pickup today|popular pick|best seller|sold & shipped by|sponsored|ratings?|reviews?)\b/gi;

function getTemuOptimizerInstruction(userPrompt) {
  return zhTitleRulesPrompt(userPrompt || '');
}

function buildProductAiPrompt(r, currentTitle, instruction) {
  const rawBase = (r._rawTitle || r.title || currentTitle || '').replace(ECOM_JUNK_RE, '').trim();

  const parts = [];
  parts.push(`Original Product Base: "${rawBase}"`);
  if (currentTitle && currentTitle !== rawBase) parts.push(`Current product title / pack details: "${currentTitle}"`);
  if (r.brand && !rawBase.toLowerCase().includes(r.brand.toLowerCase())) {
    parts.push(`Brand: ${r.brand}`);
  }

  let varTxt = r.color || (Array.isArray(r.variants) ? r.variants.join(', ') : r.variants) || '';
  if (varTxt) parts.push(`Product Variation / Color / Style: ${varTxt}`);

  if (Array.isArray(r.bullets) && r.bullets.length) {
    const keyBullets = r.bullets
      .map(b => String(b).replace(ECOM_JUNK_RE, '').trim())
      .filter(b => b.length > 3)
      .slice(0, 3)
      .join('; ');
    if (keyBullets) parts.push(`Key Features: ${keyBullets}`);
  }

  let finalPrompt = `${instruction}\n\nProduct Information:\n${parts.join('\n')}`;
  finalPrompt += `\n\nGenerate the complete optimized title now using commas between the structure groups. Maximum length 180 characters. Output ONLY the title text.`;
  return finalPrompt;
}

function cleanTemuTitleResult(raw, currentTitle, useDefaultLength) {
  let title = String(raw || '').trim();
  if (!title) throw new Error('AI ne empty title diya');
  // Strip code fences if present
  title = title.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  // If JSON object or array was returned accidentally, extract string
  if (/^[{\[]/.test(title)) {
    try {
      const parsed = JSON.parse(title);
      if (Array.isArray(parsed)) {
        title = String(parsed[0]?.title || parsed[0]?.new_title || parsed[0] || '').trim();
      } else if (parsed && typeof parsed === 'object') {
        const c = Array.isArray(parsed.titles) ? parsed.titles[0] : (parsed.title || parsed.new_title || '');
        if (c) title = String(c).trim();
      }
    } catch (_) {}
  }
  // Strip website button noise that might have leaked
  title = title.replace(ECOM_JUNK_RE, '');
  // Strip unwanted markdown, newlines, and surrounding quotes
  title = title.replace(/^#+\s*/, '').replace(/^\*+|\*+$/g, '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
  title = title.replace(/^["'`]|["'`]$/g, '').trim();
  title = title.replace(/^(?:optimized\s+(?:product\s+)?title|product\s+title|title)\s*:\s*/i, '').trim();
  // Clean up any double commas or leading/trailing commas
  title = title.replace(/,\s*,+/g, ',').replace(/^,\s*|,\s*$/g, '').trim();

  if (!title || /^(?:DONE|TITLE ONLY|\[object Object\])$/i.test(title)) throw new Error('AI ne valid product title return nahi kiya');

  // Enforce Temu maximum title limit of 180 characters gracefully without cutting words awkwardly
  if (title.length > 180) {
    const cut = title.slice(0, 180);
    const lastSpace = cut.lastIndexOf(' ');
    title = lastSpace > 120 ? cut.slice(0, lastSpace).trim() : cut.trim();
  }
  return title;
}

function selectTemuTitleCandidate(raw) {
  return cleanTemuTitleResult(raw);
}

async function rewriteValidatedTemuTitle(r, currentTitle, instruction, useDefaultLength = true) {
  const base = buildProductAiPrompt(r, currentTitle, instruction);
  const maxLength = temuTitleMaxLength(instruction);
  let lastErr = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await callGroqAPI({
        prompt: base + (lastErr ? '\nCorrect this error: ' + lastErr.message : '') + `\nMaximum length: ${maxLength} characters. Return ONLY the single final optimized title text. No quotes, no markdown, no explanations.`,
        systemPrompt: 'You are an expert Temu Product Title Optimization Engine. Return ONLY the single final optimized title text without conversational filler, markdown formatting, or quotes.',
        temperature: 0.3
      });
      const cleaned = temuLimitTitle(cleanTemuTitleResult(raw, currentTitle, useDefaultLength), maxLength);
      if (cleaned) {
        zhAssertProductContent(cleaned, zhProductEvidence(r), temuGetCfg().title_remove_words || []);
        return cleaned;
      }
    } catch (e) {
      lastErr = e;
      if (e.rateLimit) throw e;
    }
  }
  throw lastErr || new Error('Title rewrite complete nahi hua');
}

// Rewrite follows the shared user title rules. Focused actions never become sticky presets.
function temuTitlePreferences() {
  return $('temuAiPromptInp')?.value?.trim() || '';
}
function temuTitleActionInstruction(action) {
  if (action === 'shorten') return 'Focused edit: shorten the CURRENT TITLE to maximum 60 characters. Preserve its product identity and most important provided specifications. Do not add keywords, benefits, audience or features. Return only the shortened title.';
  if (action === 'removeBrand') return 'Focused edit: remove only brand names from the CURRENT TITLE. Preserve all remaining wording, order, quantities and specifications. If there is no brand name, return the current title unchanged. Do not shorten, expand or restructure the title. Return only the edited title.';
  return getTemuOptimizerInstruction(temuTitlePreferences());
}
function temuTitleMaxLength(instruction = '') {
  const match = String(instruction).match(/(?:max(?:imum)?|up to|under|at most)\s*(\d{2,3})\s*(?:characters?|chars?)/i);
  return match ? Math.max(10, Math.min(180, Number(match[1]))) : 180;
}
function temuLimitTitle(title, max = 180) {
  if (title.length <= max) return title;
  const cut = title.slice(0, max), boundary = Math.max(cut.lastIndexOf(' '), cut.lastIndexOf(','));
  return (boundary > 0 ? cut.slice(0, boundary) : cut).replace(/[\s,;:.-]+$/, '');
}
(function initTemuTitleOptions() {
  const inp = $('temuAiPromptInp');
  const save = () => chrome.storage.local.set({ zhunterTitleOptimizerInstruction: inp?.value || '' }).catch(() => {});
  chrome.storage.local.get(['zhunterTitleOptimizerInstruction']).then(saved => {
    if (!inp || inp.value.trim()) return;
    inp.value = saved.zhunterTitleOptimizerInstruction || '';
    const legacy = ['Brand name hata do, generic Temu style title','Short aur clear title, max 60 characters','SEO keywords add karo, brand + product type + size shuru mein','Target audience aur use case add karo'];
    for (const phrase of legacy) inp.value = inp.value.split(phrase).join('');
    inp.value = inp.value.replace(/^[\s;]+|[\s;]+$/g, '').replace(/;\s*;/g, ';');
    save();
  }).catch(() => {});
  inp?.addEventListener('input', save);
  inp?.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); temuAiBulkRewrite(); } });
})();

// Bulk AI Rewrite for checked products only
let TemuRewriteBusy = false;
async function temuAiBulkRewrite(action = 'rewrite') {
  const bulkBtn = $('temuAiBulkRewriteBtn');
  if (!bulkBtn || bulkBtn.disabled || TemuRewriteBusy) return;
  TemuRewriteBusy = true;           // v9.12.3 — set before any await (double-click / double-listener safe)
  bulkBtn.disabled = true;
  for (const id of ['temuTitleShortenBtn','temuTitleRemoveBrandBtn']) if ($(id)) $(id).disabled = true;
  let rows = [];
  const changes = [], failures = [];
  let sameCount = 0;
  try {
    rows = await temuGetQueuedRows();
    // Filter ONLY products whose checkbox is checked!
    const targetRows = rows.filter(r => !TemuReviewExcluded.has(r.id));
    if (!targetRows.length) {
      toast('Koi checked product select nahi he! Pehle checkbox select karein.', 'warn');
      return;
    }
    const userPrompt = temuTitlePreferences();
    const instruction = temuTitleActionInstruction(action);

    for (let i = 0; i < targetRows.length; i++) {
      const r = targetRows[i];
      bulkBtn.innerHTML = `⏳ ${i + 1}/${targetRows.length}...`;
      const card = document.querySelector(`.temu-rv-card[data-id="${r.id}"]`);
      const oldTitle = card?.querySelector('.temu-rv-title-inp')?.value || r.title || '';
      try {
        const cleaned = await rewriteValidatedTemuTitle(r, oldTitle, instruction, action === 'rewrite' && !userPrompt);
        if (!cleaned) throw new Error('AI ne title nahi diya');
        const same = temuNormTitle(cleaned) === temuNormTitle(oldTitle);
        if (same) sameCount++;
        r.title = cleaned;
        changes.push({ id: r.id, url: r.url, title: cleaned, old: oldTitle, same });
        if (card) {
          const titleInp = card.querySelector('.temu-rv-title-inp');
          const snippet = card.querySelector('.temu-rv-title-snippet');
          const badge = card.querySelector('.temu-ai-char-badge');
          if (titleInp) titleInp.value = cleaned;
          if (snippet) snippet.textContent = cleaned;
          if (badge) {
            const l = cleaned.length;
            badge.textContent = `${l}/180`;
            badge.className = 'temu-ai-char-badge ' + (l <= 140 ? 'ok' : l <= 180 ? 'warn' : 'over');
          }
          temuMarkCardUpdated(card, oldTitle, cleaned, same);
        }
      } catch (err) {
        failures.push({ title: oldTitle, reason: err?.message || 'Rewrite failed' });
        console.warn('[ZHunter AI] Single title rewrite error:', err);
        if (err?.rateLimit) {
          for (const pending of targetRows.slice(i + 1)) failures.push({ title: pending.title, reason: 'Rate limit: try nahi hua, original title rakha' });
          break;
        }
      }
      if (i < targetRows.length - 1) await new Promise(resolve => setTimeout(resolve, 500));
    }

    // save everywhere + verify (Library + the rows the upload file is built from)
    const v = changes.length ? await temuSaveTitles(changes) : { inFile: 0, inLib: 0, savedLib: 0 };
    const updated = changes.length - sameCount;
    const short = t => { t = String(t || ''); return t.length > 70 ? t.slice(0, 68) + '…' : t; };
    const lines = [`✨ AI titles: ${updated} updated` + (sameCount ? ` · ${sameCount} same rahe` : '') + (failures.length ? ` · ${failures.length} failed` : '')];
    changes.forEach((c, i) => {
      lines.push(`${i + 1}. ${c.same ? '(same) ' : ''}${short(c.old)}`);
      if (!c.same) lines.push(`   → ${short(c.title)}`);
    });
    failures.forEach(f => lines.push(`✗ ${short(f.title)}: ${f.reason}`));
    if (changes.length) {
      lines.push((v.inFile === changes.length ? '✓' : '✗') + ` Upload file mein naye titles: ${v.inFile}/${changes.length}`);
      lines.push(v.inLib ? ((v.savedLib === v.inLib ? '✓' : '✗') + ` Library mein save: ${v.savedLib}/${v.inLib}`) : '• Library mein ye products nahi (sirf is list mein update)');
    }
    const report = $('temuReport');
    if (report) { report.textContent = (report.textContent ? report.textContent + '\n\n' : '') + lines.join('\n'); try { report.scrollTop = report.scrollHeight; } catch (_) {} }
    temuShowTitleChanges(changes, failures);
    const okSave = !changes.length || v.inFile === changes.length;
    toast(okSave
      ? `✓ ${updated} titles updated` + (sameCount ? ` · ${sameCount} same` : '') + (failures.length ? ` · ${failures.length} failed` : '')
      : `⚠ Titles badle lekin ${changes.length - v.inFile} save nahi huay — Activity dekhein`, okSave && !failures.length ? 'ok' : 'warn');
  } catch (err) {
    toast('AI error: ' + (err?.message || 'Failed'), 'warn');
  } finally {
    TemuRewriteBusy = false;
    bulkBtn.disabled = false;
    for (const id of ['temuTitleShortenBtn','temuTitleRemoveBrandBtn']) if ($(id)) $(id).disabled = false;
    temuUpdateReviewCount(rows);
  }
}

// ── v9.12.3 — title helpers ─────────────────────────────────────
// card: "✨ Updated" badge + open it so the full new title is visible + "Pehle:" line
function temuMarkCardUpdated(card, oldTitle, newTitle, same) {
  if (!card) return;
  card.classList.remove('rv-updated', 'rv-same');
  void card.offsetWidth;
  card.classList.add(same ? 'rv-same' : 'rv-updated');
  const row = card.querySelector('.temu-rv-collapsed-row');
  let tag = card.querySelector('.temu-rv-upd-tag');
  if (!tag && row) {
    tag = document.createElement('span');
    tag.className = 'temu-rv-upd-tag';
    row.querySelector('.temu-rv-price-badge')?.before(tag);
  }
  if (tag) {
    tag.textContent = same ? '= Same' : '✨ Updated ▾';
    tag.title = same ? 'AI ne wahi title diya' : 'Click: pehle vs naya title dekhein';
    if (!tag.dataset.bound) {
      tag.dataset.bound = '1';
      tag.addEventListener('click', e => {   // v9.12.5 — small compare under the row, card stays closed
        e.stopPropagation();
        const d = card.querySelector('.temu-rv-diff');
        if (!d || card.classList.contains('rv-same')) return;
        d.classList.toggle('hidden');
        tag.textContent = d.classList.contains('hidden') ? '✨ Updated ▾' : '✨ Updated ▴';
      });
    }
  }
  // v9.12.5 — the card is NOT opened any more (bulk rewrite made the list very long).
  const snip = card.querySelector('.temu-rv-title-snippet');
  if (snip) snip.title = same ? newTitle : `Naya: ${newTitle}\nPehle: ${oldTitle}`;
  let diff = card.querySelector('.temu-rv-diff');
  if (!diff && row) { diff = document.createElement('div'); diff.className = 'temu-rv-diff hidden'; row.after(diff); }
  if (diff) {
    diff.textContent = '';
    if (!same) {
      const a = document.createElement('div'); a.className = 'temu-rv-new-line'; a.textContent = 'Naya: ' + newTitle;
      const b = document.createElement('div'); b.className = 'temu-rv-old-line'; b.textContent = 'Pehle: ' + oldTitle;
      diff.append(a, b);
    }
    diff.classList.add('hidden');
  }
  const grp = card.querySelector('.temu-rv-title-row')?.parentElement;
  if (grp) {
    let old = grp.querySelector('.temu-rv-old-title');
    if (!old) { old = document.createElement('div'); old.className = 'temu-rv-old-title'; grp.appendChild(old); }
    old.textContent = '';
    if (same) old.textContent = 'AI ne wahi title diya — koi farq nahi.';
    else {
      const nw = document.createElement('div'); nw.className = 'temu-rv-new-line'; nw.textContent = 'Naya: ' + newTitle;
      const ol = document.createElement('div'); ol.className = 'temu-rv-old-line'; ol.textContent = 'Pehle: ' + oldTitle;
      old.append(nw, ol);
    }
  }
}

// v9.12.5 — compact "Title changes" panel above the review list (closed by default, own scroll)
function temuShowTitleChanges(changes, failures = []) {
  const list = $('temuReviewList');
  if (!list) return;
  let box = $('temuTitleChanges');
  if (!box) {
    box = document.createElement('div');
    box.id = 'temuTitleChanges';
    box.className = 'temu-tc';
    list.before(box);
    box.addEventListener('click', e => {
      if (e.target.closest('.temu-tc-x')) { box.remove(); return; }
      if (e.target.closest('.temu-tc-tgl')) { box.classList.toggle('open'); return; }
      const rowBtn = e.target.closest('.temu-tc-row');
      if (rowBtn) temuJumpToCard(rowBtn.dataset.id);
    });
  }
  const upd = changes.filter(c => !c.same);
  const same = changes.length - upd.length;
  const head = `✨ ${upd.length} title${upd.length === 1 ? '' : 's'} updated` + (same ? ` · ${same} same` : '') + (failures.length ? ` · ${failures.length} failed` : '');
  const rows = upd.map((c, i) => `
    <button type="button" class="temu-tc-row" data-id="${esc(String(c.id || ''))}" title="Card par jayein" style="--i:${Math.min(i, 10)}">
      <span class="temu-tc-n">${i + 1}</span>
      <span class="temu-tc-txt"><span class="temu-tc-new">${esc(c.title)}</span><span class="temu-tc-old">${esc(c.old)}</span></span>
    </button>`).join('');
  const fails = failures.map(f => `<div class="temu-tc-fail">✗ ${esc(trunc(f.title || '', 60))} — ${esc(f.reason || '')}</div>`).join('');
  box.innerHTML = `
    <div class="temu-tc-head">
      <span class="temu-tc-title">${head}</span>
      ${upd.length || failures.length ? '<button type="button" class="temu-tc-tgl">Compare <i>▾</i></button>' : ''}
      <button type="button" class="temu-tc-x" title="Band karein" aria-label="Band karein">✕</button>
    </div>
    <div class="temu-tc-list">${rows}${fails}</div>`;
  box.classList.remove('open', 'temu-tc-in'); void box.offsetWidth; box.classList.add('temu-tc-in');
}

function temuJumpToCard(id) {
  const card = id && document.querySelector(`.temu-rv-card[data-id="${CSS.escape(id)}"]`);
  if (!card) return;
  const list = $('temuReviewList');
  if (list?.classList.contains('only-upd') && !card.matches('.rv-updated, .rv-same')) list.classList.remove('only-upd');
  card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  card.classList.remove('rv-jump'); void card.offsetWidth; card.classList.add('rv-jump');
  const d = card.querySelector('.temu-rv-diff'); const tag = card.querySelector('.temu-rv-upd-tag');
  if (d && d.childElementCount) { d.classList.remove('hidden'); if (tag) tag.textContent = '✨ Updated ▴'; }
}

// Save new titles everywhere WITHOUT overwriting the Library with a stale in-memory copy.
// changes: [{ id, url, title }]. Returns { inFile, inLib, savedLib } (verified by reading back).
async function temuSaveTitles(changes) {
  if (typeof zhSaveTextChanges === 'function') {
    const result = await zhSaveTextChanges(changes.map(c => ({ id: c.id, url: c.url, before: c.old ? { title: c.old } : undefined, patch: { title: c.title } })));
    try { if (MasterUIState?.allRows?.length) filterAndRenderMasterRows(); } catch (_) {}
    return result;
  }
  throw new Error('Content save module load nahi hua; extension reload karein');
}

// Global review toggle
function temuInitReviewToggle() {
  const btn = $('temuReviewToggleBtn');
  const list = $('temuReviewList');
  const aiBar = $('temuReviewAiBar');
  const imgBar = $('temuReviewImgBar');
  const chev = btn?.querySelector('.temu-review-chev');
  if (!btn || !list) return;
  // v9.12.3 — openTemuModal() calls this on every open; bind the listeners only ONCE
  // (pehle har open par ek aur listener lagta tha → Rewrite 2-3 dafa chalta, toggles ulat jate)
  if (temuInitReviewToggle._done) return;
  temuInitReviewToggle._done = true;
  btn.addEventListener('click', async e => {
    if (e.target.closest('.temu-sel-all-wrap')) return;
    const isHidden = list.classList.toggle('hidden');
    if (aiBar) aiBar.classList.toggle('hidden', isHidden);
    if (imgBar) imgBar.classList.toggle('hidden', isHidden);
    if (chev) chev.style.transform = isHidden ? '' : 'rotate(180deg)';
    if (!isHidden) await temuRenderReview();
  });
  // Select All checkbox
  const selAll = $('temuReviewSelectAll');
  selAll?.addEventListener('change', async () => {
    const rows = await temuGetQueuedRows();
    TemuReviewExcluded.clear();
    if (!selAll.checked) rows.forEach(r => TemuReviewExcluded.add(r.id));
    temuUpdateReviewCount(rows);
    if (!list.classList.contains('hidden')) await temuRenderReview();
  });
  // Bulk AI Rewrite Button
  const bulkBtn = $('temuAiBulkRewriteBtn');
  bulkBtn?.addEventListener('click', () => temuAiBulkRewrite('rewrite'));
  $('temuTitleShortenBtn')?.addEventListener('click', () => temuAiBulkRewrite('shorten'));
  $('temuTitleRemoveBrandBtn')?.addEventListener('click', () => temuAiBulkRewrite('removeBrand'));

  // Bulk AI Image Studio
  const imgPromptInp = $('temuAiImgPromptInp');
  if (imgPromptInp && !imgPromptInp.value) {
    getSavedAiImagePrompt().then(v => { imgPromptInp.value = v; });
    imgPromptInp.addEventListener('input', () => {
      chrome.storage.local.set({ zhunterAiImagePrompt: imgPromptInp.value });
    });
  }
  $('temuAiImgPromptToggleBtn')?.addEventListener('click', () => {
    $('temuAiImgPromptWrap')?.classList.toggle('hidden');
  });
  $('temuAiImgCountSel')?.addEventListener('change', async () => {
    const rows = await temuGetQueuedRows();
    temuUpdateReviewCount(rows);
    if (!list.classList.contains('hidden')) await temuRenderReview();
  });
  $('temuAiBulkImgBtn')?.addEventListener('click', () => zhChooseEditMode());
  // v9.9.0 — pick products for image editing without touching the upload selection
  const imgSelAll = async (on) => {
    const rows = await temuGetQueuedRows();
    TemuImgEditSelected.clear();
    if (on) rows.forEach(r => { if (_allImgUrls(r).length) TemuImgEditSelected.add(r.id); });
    temuUpdateImgEditCount(rows);
    if (!list.classList.contains('hidden')) await temuRenderReview();
  };
  $('temuImgSelAllBtn')?.addEventListener('click', () => imgSelAll(true));
  $('temuImgSelNoneBtn')?.addEventListener('click', () => imgSelAll(false));
}

// ═════════════════════════════════════════════════════════════════
// ═══ Bulk AI Image Studio Pipeline ═══
// ═════════════════════════════════════════════════════════════════
function temuBatchStages(mode, quantity, backgroundPrompt) {
  const n = Number(quantity);
  if (!['background', 'pack', 'pack_background'].includes(mode)) throw new Error('Invalid image mode');
  if (mode !== 'background' && (!Number.isInteger(n) || n < 2 || n > 24)) throw new Error('Pack quantity 2 se 24 honi chahiye');
  const background = `${backgroundPrompt}\nChange only the background and scene. Preserve the exact product, packaging, labels and number of units shown in the reference. Do not add or remove units.`;
  const pack = `Create exactly ${n} identical units of the reference product together. Preserve the exact packaging, logo, colors and text. Keep the original background and scene style; do not replace it. No extra text or badges.`;
  return mode === 'background' ? [background] : mode === 'pack' ? [pack] : [pack, background];
}

function temuConfigureBatch(queue, backgroundPrompt) {
  return new Promise(resolve => {
    const modal = document.createElement('div');
    modal.className = 'modal-back flow-batch-modal';
    modal.style.zIndex = '100020';
    modal.innerHTML = `<div class="modal-box flow-batch-box">
      <div class="batch-header"><h3>Flow batch setup</h3>
      <p>Nano Banana 2 · 1:1 · x1</p></div>
      <div class="batch-tools">
        <input class="batch-search" type="search" placeholder="Search products…" aria-label="Search products">
        <div class="batch-selection"><button type="button" class="btn btn-ghost batch-select-all">Select visible</button><button type="button" class="btn btn-ghost batch-select-none">Clear selection</button><span class="batch-selected-count"></span></div>
        <div class="batch-bulk-controls"><select class="batch-bulk-mode" aria-label="Bulk image task"><option value="background">Background only</option><option value="pack">Pack only</option><option value="pack_background">Pack → Background</option><option value="skip">Skip / keep original</option></select>
        <label>Qty <input class="batch-bulk-qty" type="number" min="2" max="24" value="2" disabled aria-label="Bulk pack quantity"></label></div>
        <div class="batch-selection"><button type="button" class="btn btn-primary batch-apply-selected">Apply to selected</button><button type="button" class="btn btn-ghost batch-apply-all">Apply to all</button></div>
      </div>
      <div class="batch-items">${queue.map((q, i) => `<div data-batch="${i}" class="batch-item">
        <div class="batch-item-heading"><input type="checkbox" class="batch-pick" aria-label="Select image ${i + 1}"><img src="${esc(q.imgUrl)}" loading="lazy" alt=""><span title="${esc(q.product.title || '')}">${esc(trunc(q.product.title || 'Product', 65))}<small>Image #${q.imgIndex + 1}</small></span><button class="btn btn-ghost batch-product" type="button" title="Is product ki sab images select karein">Product</button></div>
        <div class="batch-item-settings">
        <select class="batch-mode" aria-label="Image task"><option value="background">Background only</option><option value="pack">Pack only</option><option value="pack_background">Pack → Background</option></select>
        <label>Qty <input class="batch-qty" type="number" min="2" max="24" value="2" disabled aria-label="Pack quantity"></label></div>
      </div>`).join('')}<p class="batch-empty" hidden>No matching products</p></div>
      <div class="batch-footer"><p class="batch-summary"></p>
      <p class="batch-help">No pack? Choose Background only. No edits? Choose Skip. Pack → Background uses 2 generations.</p>
      <p class="batch-error" role="alert"></p>
      <div class="batch-footer-actions"><button type="button" class="btn btn-ghost batch-cancel">Cancel</button><button type="button" class="btn btn-primary batch-start">Start batch</button></div></div>
    </div>`;
    document.body.appendChild(modal);
    const entries = [...modal.querySelectorAll('[data-batch]')];
    entries.forEach(row => {
      row.querySelector('.batch-mode').add(new Option('Skip / keep original', 'skip'));
      row.querySelector('.batch-product').onclick = () => {
        const pid = queue[Number(row.dataset.batch)].product.id;
        const on = !row.querySelector('.batch-pick').checked;
        entries.forEach(other => { if (queue[Number(other.dataset.batch)].product.id === pid) other.querySelector('.batch-pick').checked = on; });
        update();
      };
    });
    const update = () => {
      let steps = 0, active = 0;
      entries.forEach(row => {
        const mode = row.querySelector('.batch-mode').value;
        row.querySelector('.batch-qty').disabled = mode === 'background' || mode === 'skip';
        row.classList.toggle('batch-skipped', mode === 'skip');
        row.classList.toggle('batch-selected', row.querySelector('.batch-pick').checked);
        if (mode !== 'skip') { active++; steps += mode === 'pack_background' ? 2 : 1; }
      });
      modal.querySelector('.batch-summary').textContent = `${active}/${queue.length} images · ${steps} generations · ${queue.length - active} skipped`;
      modal.querySelector('.batch-selected-count').textContent = `${entries.filter(row => row.querySelector('.batch-pick').checked).length} selected`;
      modal.querySelector('.batch-start').disabled = !active;
      const bulkMode = modal.querySelector('.batch-bulk-mode').value;
      modal.querySelector('.batch-bulk-qty').disabled = bulkMode === 'background' || bulkMode === 'skip';
    };
    modal.querySelector('.batch-search').oninput = e => {
      const term = e.target.value.trim().toLowerCase();
      entries.forEach(row => { row.hidden = !String(queue[Number(row.dataset.batch)].product.title || '').toLowerCase().includes(term); });
      modal.querySelector('.batch-empty').hidden = entries.some(row => !row.hidden);
    };
    modal.querySelector('.batch-select-all').onclick = () => { entries.forEach(row => { if (!row.hidden) row.querySelector('.batch-pick').checked = true; }); update(); };
    modal.querySelector('.batch-select-none').onclick = () => { entries.forEach(row => row.querySelector('.batch-pick').checked = false); update(); };
    const apply = all => {
      const targets = entries.filter(row => all || row.querySelector('.batch-pick').checked);
      const error = modal.querySelector('.batch-error'); error.textContent = '';
      if (!targets.length) { error.textContent = 'Pehle images ya Product select karein'; return; }
      const mode = modal.querySelector('.batch-bulk-mode').value;
      const qty = Number(modal.querySelector('.batch-bulk-qty').value);
      try { if (mode !== 'skip') temuBatchStages(mode, qty, backgroundPrompt); }
      catch (e) { error.textContent = e.message; return; }
      targets.forEach(row => { row.querySelector('.batch-mode').value = mode; row.querySelector('.batch-qty').value = qty; });
      update();
    };
    modal.querySelector('.batch-apply-selected').onclick = () => apply(false);
    modal.querySelector('.batch-apply-all').onclick = () => apply(true);
    modal.addEventListener('change', update); update();
    modal.querySelector('.batch-cancel').onclick = () => { modal.remove(); resolve(false); };
    modal.querySelector('.batch-start').onclick = () => {
      try {
        const activeEntries = entries.filter(row => row.querySelector('.batch-mode').value !== 'skip');
        if (!activeEntries.length) throw new Error('Kam az kam ek image ka task choose karein');
        const settings = activeEntries.map(row => {
          const mode = row.querySelector('.batch-mode').value;
          const qty = Number(row.querySelector('.batch-qty').value);
          return { index: Number(row.dataset.batch), mode, qty, stages: temuBatchStages(mode, qty, backgroundPrompt) };
        });
        const activeQueue = settings.map(s => Object.assign(queue[s.index], { batchMode: s.mode, packQty: s.qty, stages: s.stages, stageIndex: 0, prompt: s.stages[0] }));
        queue.splice(0, queue.length, ...activeQueue);
        modal.remove(); resolve(true);
      } catch (e) { modal.querySelector('.batch-error').textContent = e.message; }
    };
  });
}

function temuImgTargetIndices(r) {
  const allImgs = _allImgUrls(r);
  if (!allImgs.length) return [];
  const picks = TemuImgPick.get(r.id);
  if (picks && picks.size) return [...picks].filter(i => i >= 0 && i < allImgs.length).sort((x, y) => x - y);
  const countMode = $('temuAiImgCountSel')?.value || '1';
  const n = countMode === 'all' ? allImgs.length : Math.min(allImgs.length, parseInt(countMode, 10) || 1);
  return allImgs.slice(0, n).map((_, i) => i);
}

function temuUpdateImgEditCount(rows) {
  const ids = new Set(rows.map(r => r.id));
  // Forget selections for products that are no longer in the list
  for (const id of [...TemuImgEditSelected]) if (!ids.has(id)) TemuImgEditSelected.delete(id);
  const sel = rows.filter(r => TemuImgEditSelected.has(r.id));
  const imgs = sel.reduce((n, r) => n + temuImgTargetIndices(r).length, 0);
  const cnt = $('temuImgEditCount');
  if (cnt) cnt.textContent = `✨ ${sel.length} / ${rows.length} products · ${imgs} images`;
  const lbl = $('temuImgEditBtnLabel');
  if (lbl) lbl.textContent = sel.length ? `Edit Images (${imgs})` : 'Edit Images';
  const btn = $('temuAiBulkImgBtn');
  if (btn && !TemuImgStepper.running) btn.disabled = !sel.length;
}

async function temuStartBulkImageEdit(opts = {}) {
  if (TemuImgStepper.running) {
    // v9.10.1 — an old (often stuck) session used to re-open here with its old products.
    // Now: stop it and start fresh with what is selected right now.
    temuStepCancelActiveJob();
    TemuImgStepper.running = false;
    toast('Purana session band — naye selected products se shuru', 'info');
  }
  const rows = await temuGetQueuedRows();
  const selRows = rows.filter(r => TemuImgEditSelected.has(r.id));
  if (!selRows.length) {
    toast('Pehle ✨ checkbox se products select karein (ya "Select all")', 'warn');
    return;
  }

  const engine = $('temuAiImgEngineSel')?.value || 'flow';
  const prompt = opts.prompt || ($('temuAiImgPromptInp')?.value || '').trim() || await getSavedAiImagePrompt();

  // Queue of { product, imgUrl, imgIndex } — the exact slot each result must go back to
  const queue = [];
  const seen = new Set();
  selRows.forEach(r => {
    const allImgs = _allImgUrls(r);
    (opts.mainOnly ? [0] : temuImgTargetIndices(r)).forEach(idx => {
      const key = r.id + '#' + idx;
      if (!allImgs[idx] || seen.has(key)) return;
      seen.add(key);
      queue.push({ product: r, imgUrl: allImgs[idx], imgIndex: idx, jobId: null });
    });
  });

  if (!queue.length) {
    toast('Selected products me koi images nahi mili', 'warn');
    return;
  }

  if (engine === 'flow' && !(await temuConfigureBatch(queue, prompt))) return;

  TemuImgStepper = {
    queue,
    currentIndex: 0,
    engine,
    prompt,
    activeJobId: null,
    running: true,
    stats: { done: 0, skipped: 0 }
  };

  temuStepOpenModal();
  await temuStepProcessCurrent();
}

function temuStepCancelActiveJob() {
  if (TemuImgStepper.activeJobId) FlowJobs.delete(TemuImgStepper.activeJobId);
  TemuImgStepper.activeJobId = null;
  TemuImgStepper.npToken = null;   // v9.12.6 — stops a running "naya project" countdown
  temuStepManualAttn(false);
}

// ═══ v9.12.6 — "unusual activity": wait, open a NEW Flow project, resend the same image ═══
const FLOW_NP_MAX = 2;        // per run; after that → manual
const FLOW_NP_WAIT_S = 60;    // pause before the new project (less bot-like)
async function flowAutoNewProject() {
  const S = TemuImgStepper;
  if (!S?.running) return;
  if ((S.npCount || 0) >= FLOW_NP_MAX) {
    temuStepSetStatus(`⚠️ Google ne ${FLOW_NP_MAX + 1} dafa rok diya — auto band. Neeche se manual karein (📋 Image / ⚡ Paste in Flow / ✋ Manual Studio) ya kuch der baad "Send Again".`, 'error');
    temuStepManualAttn(true);
    toast('Flow auto ruk gaya — isi step se manual continue karein', 'warn');
    return;
  }
  S.npCount = (S.npCount || 0) + 1;
  const n = S.npCount, token = {};
  S.npToken = token;
  temuStepManualAttn(true);
  for (let s = FLOW_NP_WAIT_S; s > 0; s--) {
    if (S.npToken !== token || !temuStepModalOpen()) return;
    temuStepSetStatus(`⚠️ Google: "unusual activity" — ${s}s baad naya Flow project bana kar yahi image dobara (${n}/${FLOW_NP_MAX}). Chahein to neeche se manual karein.`, 'error');
    await sleep(1000);
  }
  if (S.npToken !== token || !temuStepModalOpen()) return;
  S.npToken = null;
  temuStepManualAttn(false);
  temuStepSetStatus('🆕 Naya Flow project ban raha hai…');
  await flowGoHomeForNewProject();
  if (!temuStepModalOpen() || S !== TemuImgStepper) return;
  toast(`🆕 Naya Flow project (${n}/${FLOW_NP_MAX}) — yahi image dobara bhej raha hoon`, 'info');
  await temuStepSendCurrent();   // Flow home → content script clicks "+ New project" → job runs there
}

async function flowGoHomeForNewProject() {
  try {
    const tabs = await chrome.tabs.query({ url: '*://flow.google.com/*' });
    const tab = tabs.find(t => /\/project\//.test(t.url || '')) || tabs[0];
    if (!tab) return false;   // focusOrOpenFlowTab() will open Flow home
    const home = (tab.url || '').split('/project/')[0] || 'https://flow.google.com';
    await chrome.tabs.update(tab.id, { url: home });
    const end = Date.now() + 25000;
    while (Date.now() < end) {
      await sleep(400);
      const t = await new Promise(r => chrome.tabs.get(tab.id, x => r(chrome.runtime.lastError ? null : x)));
      if (!t) return false;
      if (t.status === 'complete' && !/\/project\//.test(t.url || '')) break;
    }
    await sleep(1500);
    return true;
  } catch (e) { console.warn('[ZHunter] Flow new project nav failed', e); return false; }
}

function temuStepManualAttn(on) {
  $('temuStepManualRow')?.classList.toggle('attn', !!on);
}

// Manual tools for the current step
async function temuStepManualAction(act) {
  const S = TemuImgStepper;
  const cur = S?.queue?.[S.currentIndex];
  if (!cur) return;
  const prompt = cur.prompt || S.prompt || '';
  if (act === 'img') {
    toast('📋 Image copy ho rahi hai…', 'info');
    if (await zhCopyImage(cur.imgUrl)) toast('📋 Image copied — Flow ke prompt box mein Ctrl+V', 'ok');
    else toast('Copy nahi hui — side panel par ek dafa click karke dobara try karein', 'warn');
  } else if (act === 'prompt') {
    if (await zhCopyText(prompt)) toast('📝 Prompt copied', 'ok'); else toast('Prompt copy nahi hua', 'warn');
  } else if (act === 'flow') {
    temuStepCancelActiveJob();   // auto stops for this step; result comes via Ctrl+V / "Flow se latest"
    const btn = $('temuStepPasteFlowBtn');
    if (btn) btn.disabled = true;
    try {
      const b64 = await flowPrefetchImage(cur.imgUrl);
      if (!b64) { toast('Image download nahi hui', 'warn'); return; }
      const tabs = await chrome.tabs.query({ url: '*://flow.google.com/*' });
      const tab = tabs.find(t => /\/project\//.test(t.url || ''));
      if (!tab) {
        toast('Flow mein ek project kholein (+ New project), phir dobara "⚡ Paste in Flow"', 'warn');
        if (!tabs.length) chrome.tabs.create({ url: 'https://flow.google.com', active: true });
        else chrome.tabs.update(tabs[0].id, { active: true });
        return;
      }
      await chrome.tabs.update(tab.id, { active: true });
      if (tab.windowId) chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
      try { await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['flow_automation.js'] }); } catch (_) {}
      const res = await chrome.tabs.sendMessage(tab.id, { action: 'ZH_FLOW_MANUAL_ATTACH', images: [b64], prompt, clear: true })
        .catch(e => ({ ok: false, error: e?.message }));
      if (res?.ok) {
        temuStepSetStatus('✋ Manual: Flow mein image + prompt lag gaye — Generate dabayein, phir "⬇ Flow se latest" ya image copy karke yahan Ctrl+V.');
        toast('✓ Flow mein lag gaya — Generate dabayein', 'ok');
      } else toast('Flow: ' + (res?.error || 'image nahi lagi'), 'warn');
    } finally { if (btn) btn.disabled = false; }
  } else if (act === 'studio') {
    const pid = cur.product?.id;
    temuStepCancelActiveJob();
    S.running = false;
    $('temuImgStepperModal')?.classList.add('hidden');
    await zhStudioOpen(pid);
    toast('✋ Manual Studio — isi product se shuru', 'info');
  }
}

async function temuStepAdvance() {
  const current = TemuImgStepper.queue[TemuImgStepper.currentIndex];
  if (current?.continueStage) current.continueStage = false;
  else TemuImgStepper.currentIndex++;
  if (TemuImgStepper.currentIndex < TemuImgStepper.queue.length) {
    await temuStepProcessCurrent();
  } else {
    await temuStepFinish();
  }
}

function temuStepOpenModal() {
  const modal = $('temuImgStepperModal');
  if (!modal) return;
  modal.classList.remove('hidden');

  // Close = stop the session (a late Flow result is ignored, nothing gets overwritten)
  const closeBtn = $('temuStepCloseBtn');
  if (closeBtn) {
    closeBtn.onclick = () => {
      temuStepCancelActiveJob();
      TemuImgStepper.running = false;
      modal.classList.add('hidden');
      temuGetQueuedRows().then(temuUpdateImgEditCount);
      const d = TemuImgStepper.stats?.done || 0;
      toast(d ? `Image editing band — ${d} badli hui image${d > 1 ? 's' : ''} save hain ✓` : 'Image editing band — dobara "Edit Images" se shuru karein', 'info');
    };
  }

  const skipBtn = $('temuStepSkipBtn');
  const deviceInput = $('temuStepDeviceInput');
  const deviceBtn = $('temuStepDeviceBtn');
  if (deviceBtn && deviceInput) {
    deviceBtn.onclick = () => { deviceInput.value = ''; deviceInput.click(); };
    deviceInput.onchange = async () => {
      const file = deviceInput.files?.[0];
      if (!file || !temuStepModalOpen()) return;
      if (!/^image\/(png|jpeg|webp)$/i.test(file.type)) {
        toast('PNG, JPG ya WebP image select karein', 'warn'); return;
      }
      deviceBtn.disabled = true;
      try { await temuStepApplyManualImage(await _fileToDataUrl(file), 'Device'); }
      catch (e) { toast('Image nahi lagi: ' + (e?.message || e), 'warn'); }
      finally { deviceBtn.disabled = false; deviceInput.value = ''; }
    };
  }
  if (skipBtn) {
    skipBtn.onclick = async () => {
      temuStepCancelActiveJob();
      const current = TemuImgStepper.queue[TemuImgStepper.currentIndex];
      if (current) current.continueStage = false;
      TemuImgStepper.stats.skipped++;
      await temuStepAdvance();
    };
  }

  $('temuStepManualRow')?.querySelectorAll('button[data-m]').forEach(b => { b.onclick = () => temuStepManualAction(b.dataset.m); });
  const againBtn = $('temuStepSendAgainBtn');
  if (againBtn) {
    againBtn.onclick = async () => {
      await temuStepSendCurrent();
    };
  }

  const pasteBtn = $('temuStepPasteNextBtn');
  if (pasteBtn) {
    pasteBtn.onclick = async () => {
      await temuStepHandlePasteNext();
    };
  }
}

async function temuStepProcessCurrent() {
  const { queue, currentIndex } = TemuImgStepper;
  if (currentIndex >= queue.length) {
    await temuStepFinish();
    return;
  }

  const current = queue[currentIndex];
  const total = queue.length;

  const titleEl = $('temuStepTitle');
  const subEl = $('temuStepSub');
  const imgEl = $('temuStepImg');
  const nameEl = $('temuStepProdName');

  if (titleEl) titleEl.textContent = `AI Image Studio · Step ${currentIndex + 1}/${total}`;
  if (subEl) subEl.textContent = `Product: ${trunc(current.product.title, 40)} · Image #${current.imgIndex + 1}`;
  if (subEl && current.stages) subEl.textContent += ` · ${current.batchMode === 'background' || current.stageIndex === 1 ? 'Background' : 'Pack ' + current.packQty} · ${current.stageIndex + 1}/${current.stages.length}`;
  if (imgEl) imgEl.src = current.imgUrl;
  if (nameEl) nameEl.textContent = current.product.title || 'Product';
  temuStepSetStatus(`Opening in ${TemuImgStepper.engine === 'flow' ? 'Google Flow (Nano Banana 2)' : TemuImgStepper.engine}...`);

  // Paste & Next is only for the manual engines
  $('temuStepPasteNextBtn')?.classList.remove('hidden'); // v9.10.1 — manual fallback for Flow too

  await temuStepSendCurrent();
}

async function temuStepSendCurrent() {
  const { queue, currentIndex, engine, prompt } = TemuImgStepper;
  const current = queue[currentIndex];
  if (!current) return;

  const statusEl = $('temuStepStatus');

  if (engine === 'flow') {
    // New job for this exact product/image slot; any earlier job of this step is dropped
    temuStepCancelActiveJob();
    const jobId = newFlowJobId();
    TemuImgStepper.activeJobId = jobId;
    current.jobId = jobId;
    temuStepSetStatus('⏳ Flow ko bhej raha hoon…');
    // v9.10.1 — remember which Flow images already exist, so the side panel can spot the new
    // result by itself (no dependency on messages from the Flow tab)
    current.done = false;
    current.snap = null;
    try {
      const snap = await flowScanImages();
      if (Array.isArray(snap)) current.snap = new Set(snap.map(g => g.id));
    } catch (_) {}
    current.sentAt = Date.now();
    const sent = await triggerFlowEdit({
      src: current.imgUrl,
      title: current.product.title,
      prompt: current.prompt || prompt,
      productId: current.product.id,
      imageIndex: current.imgIndex,
      source: 'stepper',
      jobId
    });
    if (!sent) {
      if (TemuImgStepper.activeJobId === jobId) TemuImgStepper.activeJobId = null;
      temuStepSetStatus('⚠️ Image Flow ko nahi gayi — "Send Again" ya "Skip" dabayein', 'error');
      return;
    }
    if (TemuImgStepper.activeJobId === jobId) {
      temuStepSetStatus('⏳ Flow: image attach → prompt → generate. Result khud aa jayega aur agla step shuru hoga.');
    }
    // v9.11.0 — download the next step's image while this one generates
    const nxt = queue[currentIndex + 1];
    if (nxt?.imgUrl) flowPrefetchImage(nxt.imgUrl);
  } else if (engine === 'gemini') {
    let base64Data = current.imgUrl;
    if (current.imgUrl && !current.imgUrl.startsWith('data:')) {
      try {
        const resp = await fetch(current.imgUrl);
        const blob = await resp.blob();
        base64Data = await new Promise(res => {
          const rd = new FileReader();
          rd.onload = () => res(rd.result);
          rd.readAsDataURL(blob);
        });
      } catch (_) {}
    }
    await chrome.storage.local.set({
      pendingGeminiAction: {
        imgBase64: base64Data,
        prompt: prompt,
        timestamp: Date.now(),
        processed: false
      }
    });
    chrome.tabs.query({ url: '*://gemini.google.com/*' }, (existingTabs) => {
      if (existingTabs && existingTabs.length > 0) {
        chrome.tabs.update(existingTabs[0].id, { active: true });
        chrome.scripting.executeScript({ target: { tabId: existingTabs[0].id }, files: ['gemini_automation.js'] }).catch(() => {});
        chrome.tabs.sendMessage(existingTabs[0].id, { action: 'TRIGGER_GEMINI_IMAGE' }).catch(() => {});
      } else {
        chrome.tabs.create({ url: 'https://gemini.google.com/app', active: true });
      }
    });
    if (statusEl) statusEl.textContent = '✓ Gemini opened with image & prompt! Generate karke copy karein, phir "Paste & Next" click karein.';
  } else if (engine === 'chatgpt') {
    let base64Data = current.imgUrl;
    if (current.imgUrl && !current.imgUrl.startsWith('data:')) {
      try {
        const resp = await fetch(current.imgUrl);
        const blob = await resp.blob();
        base64Data = await new Promise(res => {
          const rd = new FileReader();
          rd.onload = () => res(rd.result);
          rd.readAsDataURL(blob);
        });
      } catch (_) {}
    }
    await chrome.storage.local.set({
      pendingGptAction: {
        imgBase64: base64Data,
        prompt: prompt,
        timestamp: Date.now(),
        processed: false
      }
    });
    chrome.tabs.query({ url: '*://chatgpt.com/*' }, (existingTabs) => {
      if (existingTabs && existingTabs.length > 0) {
        chrome.tabs.update(existingTabs[0].id, { active: true });
        chrome.scripting.executeScript({ target: { tabId: existingTabs[0].id }, files: ['gpt_automation.js'] }).catch(() => {});
        chrome.tabs.sendMessage(existingTabs[0].id, { action: 'TRIGGER_GPT_IMAGE' }).catch(() => {});
      } else {
        chrome.tabs.create({ url: 'https://chatgpt.com/', active: true });
      }
    });
    if (statusEl) statusEl.textContent = '✓ ChatGPT opened with image & prompt! Generate karke copy karein, phir "Paste & Next" click karein.';
  }
}

async function temuStepHandlePasteNext() {
  const { queue, currentIndex } = TemuImgStepper;
  const current = queue[currentIndex];
  if (!current) return;

  const btn = $('temuStepPasteNextBtn');
  if (btn) btn.disabled = true;

  // Try direct clipboard first
  let base64FromClipboard = null;
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const type = item.types.find(t => t.startsWith('image/'));
      if (type) {
        const blob = await item.getType(type);
        base64FromClipboard = await new Promise(res => {
          const rd = new FileReader();
          rd.onload = () => res(rd.result);
          rd.readAsDataURL(blob);
        });
        break;
      }
    }
  } catch (_) {}

  // Fallback: read clipboard via Flow tab
  if (!base64FromClipboard) {
    try {
      const tabs = await chrome.tabs.query({});
      const flowTab = tabs.find(t => t.url && t.url.includes('flow.google.com'));
      if (flowTab) {
        const results = await chrome.scripting.executeScript({
          target: { tabId: flowTab.id },
          func: async () => {
            try {
              const items = await navigator.clipboard.read();
              for (const item of items) {
                const type = item.types.find(t => t.startsWith('image/'));
                if (type) {
                  const blob = await item.getType(type);
                  return await new Promise(res => {
                    const rd = new FileReader();
                    rd.onload = () => res(rd.result);
                    rd.readAsDataURL(blob);
                  });
                }
              }
            } catch (e) { return null; }
            return null;
          }
        });
        base64FromClipboard = results?.[0]?.result || null;
      }
    } catch (_) {}
  }

  if (base64FromClipboard && TemuImgStepper.engine === 'flow') {
    if (btn) btn.disabled = false;
    await temuStepApplyManualImage(base64FromClipboard, 'Paste');
    return;
  }
  if (base64FromClipboard) {
    await replaceProductImage(current.product.id, current.imgIndex, base64FromClipboard, null);
    toast(`✓ Image #${current.imgIndex + 1} updated!`, 'ok');

    // Async upload to public host for Temu template
    (async () => {
      const pub = await uploadImageToPublicHost(base64FromClipboard);
      if (pub && pub.startsWith('http')) {
        await replaceProductImage(current.product.id, current.imgIndex, pub, base64FromClipboard);
      }
    })();

    TemuImgStepper.currentIndex++;
    if (btn) btn.disabled = false;
    if (TemuImgStepper.currentIndex < queue.length) {
      await temuStepProcessCurrent();
    } else {
      temuStepFinish();
    }
  } else {
    if (btn) btn.disabled = false;
    toast('Clipboard me image nahi mili! Generated image par Right Click > Copy Image karein, phir Paste & Next click karein.', 'warn');
  }
}

async function temuStepFinish() {
  temuStepCancelActiveJob();
  const { stats, queue } = TemuImgStepper;
  TemuImgStepper.running = false;
  if (TemuImgStepper.engine === 'flow') {
    const sk = stats?.skipped || 0;
    temuStepSetStatus(`✅ Done! ${stats?.done || 0}/${queue.length} images replaced${sk ? ` · ${sk} skipped` : ''}`, 'ok');
    const t = $('temuStepTitle'); if (t) t.textContent = `AI Image Studio · Done ✅`;
    await new Promise(r => setTimeout(r, 2500));
  }
  if (!TemuImgStepper.running) $('temuImgStepperModal')?.classList.add('hidden');
  await temuRenderReview();
  if (TemuImgStepper.engine === 'flow') {
    const skipped = stats?.skipped || 0;
    toast(`🎉 Image editing complete: ${stats?.done || 0} replaced${skipped ? ` · ${skipped} skipped` : ''} (${queue.length} total)`, 'ok');
  } else {
    toast('🎉 All selected images processed successfully!', 'ok');
  }
}

// Gemini image open modal
async function temuOpenGeminiModal(imgUrl, productTitle, productId = null, imageIndex = null) {
  const modal = $('temuGeminiModal');
  const preview = $('temuGeminiPreviewImg');
  const promptTxt = $('temuGeminiPromptTxt');
  if (!modal) return;
  if (preview) preview.src = imgUrl;

  try {
    const promptVal = await getSavedAiImagePrompt();
    if (promptTxt) promptTxt.value = promptVal;
  } catch (_) {
    if (promptTxt) promptTxt.value = DEFAULT_AI_COMMERCIAL_PROMPT;
  }

  // Setup auto-save listener on prompt changes
  if (promptTxt && !promptTxt._boundAutoSave) {
    promptTxt._boundAutoSave = true;
    promptTxt.addEventListener('input', () => {
      chrome.storage.local.set({ zhunterAiImagePrompt: promptTxt.value });
    });
  }

  modal.style.zIndex = '2000';
  modal.classList.remove('hidden');
  // Store current img url & product title for Flow/Gemini actions
  modal._currentImgUrl = imgUrl;
  modal._productTitle = productTitle || '';
  modal._productId = productId;
  modal._imageIndex = imageIndex;
}


// v9.10.1 — bulk-hunt / sheet rows had NO id: every product looked like the same one
// (image queue collapsed to 1, results could not find their product). Give each a stable id.
function _ensureRowIds(rows) {
  (rows || []).forEach((r, i) => {
    if (r && !r.id) {
      const key = String(r.tabId ?? '') + '|' + String(r.url || r.title || i);
      let h = 0;
      for (let k = 0; k < key.length; k++) h = (h * 31 + key.charCodeAt(k)) | 0;
      r.id = 'zr_' + (h >>> 0).toString(36) + '_' + (r.tabId ?? i);
    }
  });
  return rows;
}

async function temuGetQueuedRows() {
  const source = $('temuSource')?.value || 'bulk';
  let rows;
  if (source === 'bulk') rows = _ensureRowIds((BulkState?.results || []).filter(x => x.status !== 'fail'));
  else if (source === 'library_sel' && TemuLibPick?.ids) rows = _ensureRowIds((await getMasterRows()).filter(r => TemuLibPick.ids.has(r.id)));
  else if (source === 'sheet' && TemuSheetRows) rows = _ensureRowIds(TemuSheetRows);
  else rows = _ensureRowIds(await getMasterRows());
  await zhApplyImgEdits(rows);
  return typeof zhApplyTextEdits === 'function' ? zhApplyTextEdits(rows) : rows;
}

// ── Auto Detect & Sync Store from Temu Seller Tab ─────────────────
async function temuDetectStoreFromTab() {
  try {
    const tabs = await chrome.tabs.query({
      url: [
        '*://seller.temu.com/*',
        '*://seller.kuajingmaihuo.com/*',
        '*://*.temu.com/*',
        '*://*.kuajingmaihuo.com/*'
      ]
    });
    if (!tabs || tabs.length === 0) return null;
    const sellerTabs = tabs.filter(t => /seller\.(temu|kuajingmaihuo)\.com/i.test(t.url || ''));
    const targetTab = sellerTabs.find(t => t.active) || sellerTabs[0] || tabs.find(t => t.active) || tabs[0];
    if (!targetTab?.id) return null;

    const [res] = await chrome.scripting.executeScript({
      target: { tabId: targetTab.id },
      func: () => {
        const selectors = [
          '[class*="mall_name"]',
          '[class*="mallName"]',
          '#mms-layout-user-setting [class*="mall_name"]',
          '#mms-layout-user-setting',
          '[class*="store-name"]',
          '[class*="storeName"]',
          '.user-info [class*="name"]',
          '[data-testid*="store"]'
        ];
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el) {
            let txt = (el.innerText || el.textContent || '').trim();
            txt = txt.replace(/\s*copy\s*$/i, '').split('\n')[0].trim();
            if (txt && txt.length > 1 && txt.length < 50 && !/^(messages|orders|settings|notifications)$/i.test(txt)) {
              return txt;
            }
          }
        }
        return '';
      }
    });
    const detected = res?.result;
    if (detected && typeof detected === 'string' && detected.trim()) {
      return detected.trim();
    }
  } catch (err) {
    // Non-blocking catch
  }
  return null;
}

async function temuAutoSyncActiveStoreFromTab(promptIfNew = false) {
  const detected = await temuDetectStoreFromTab();
  if (!detected) return;

  const current = temuActiveStoreName();
  const stores = temuStores();

  // If detected store matches current active store, nothing to do
  if (current && current.toLowerCase() === detected.toLowerCase()) return;

  // Case 1: Detected store is already in our stores list
  const existingKey = Object.keys(stores).find(k => k.toLowerCase() === detected.toLowerCase());
  if (existingKey) {
    if (existingKey !== current) {
      await temuSaveStores(stores, existingKey);
      TemuLast = null;
      temuRenderStoreBar();
      temuUpdateTplStatus();
      temuRenderProfiles();
      temuFillForm();
      updateTopTemuStorePill();
      toast(`⚡ Auto-switched to active store: ${existingKey}`, 'ok');
    }
    return;
  }

  // Case 2: New store detected from tab
  if (promptIfNew) {
    showConfirm(
      'New Store Detected',
      `Active tab par Temu store "${detected}" detect hua hai. Kya is store ko ZHunter mein add karna chahein?`,
      'Add Store',
      async () => {
        stores[detected] = { templateB64: '', templateName: '', config: null };
        await temuSaveStores(stores, detected);
        temuRenderStoreBar();
        temuUpdateTplStatus();
        temuRenderProfiles();
        updateTopTemuStorePill();
        toast(`✓ Store "${detected}" added & activated`, 'ok');
      }
    );
  }
}

async function openTemuModal() {
  const m = $('temuModal'); if (!m) return;
  m.style.zIndex = '1000';
  await temuMigrateLegacyIfNeeded();
  try { await temuAutoSyncActiveStoreFromTab(true); } catch (_) {}
  temuRenderStoreBar();
  temuUpdateTplStatus();
  temuRenderProfiles();
  temuFillForm();
  temuCatFormReset();
  temuSwitchTab('upload');
  temuRenderHistory();
  temuInitReviewToggle();
  // Update review count on open
  temuGetQueuedRows().then(rows => temuUpdateReviewCount(rows)).catch(() => {});
  // v9.7.2: purana Activity log wapas
  try { const rep = $('temuReport'); if (rep && !(rep.textContent || '').trim()) chrome.storage.local.get('temuReportText', x => { if (x?.temuReportText && rep && !(rep.textContent || '').trim()) rep.textContent = x.temuReportText; }); } catch (_) {}
  { const wp = $('temuActivityWrap'); if (wp) wp.open = false; }
  m.classList.remove('hidden');
}

// Activity summary: last meaningful line of #temuReport → one-line status; auto-open on errors
function temuInitActivitySummary() {
  const rep = $('temuReport'), sum = $('temuActivityLast'), wrap = $('temuActivityWrap');
  if (!rep || !sum) return;
  const sync = () => {
    const lines = (rep.textContent || '').split('\n').map(x => x.trim()).filter(Boolean);
    if (!lines.length) { sum.textContent = 'Ready'; sum.className = 'temu-activity-status'; return; }
    // status lines start with ✓ / ✗ / → (product rows like "CH-B0…  CALLAWAY …" are skipped)
    const cands = lines.filter(l => /^(✓|✗|→|⏳)/.test(l) || /^Koi naya product/i.test(l));
    const pick = cands.length ? cands[cands.length - 1] : lines[lines.length - 1];
    const txt = pick.replace(/^[→•⏳]\s*/, '');
    sum.textContent = txt.length > 90 ? txt.slice(0, 88) + '…' : txt;
    const isBad = /^✗/.test(pick) || /fail|nahi (hua|mila|hui)|error/i.test(pick);
    const isOk = /^✓/.test(pick) || /ho gaya|ready|saved/i.test(pick);
    const isRun = /^⏳/.test(pick) || /…$/.test(pick) || /raha|rahi|rahe/.test(pick);
    sum.className = 'temu-activity-status' + (isBad ? ' bad' : isOk ? ' ok' : isRun ? ' run' : '');
    if (isBad && wrap && !wrap.open) wrap.open = true;
  };
  // v9.7.2: Activity text ko save rakho (reload / panel band hone par bhi rahe)
  let saveT = null;
  const persist = () => { clearTimeout(saveT); saveT = setTimeout(() => { try { chrome.storage.local.set({ temuReportText: (rep.textContent || '').slice(-60000) }); } catch (_) {} }, 400); };
  try { new MutationObserver(() => { sync(); persist(); }).observe(rep, { childList: true, characterData: true, subtree: true }); } catch (_) {}
  sync();
}

async function updateTopTemuStorePill() {
  const pill = $('topTemuStorePill');
  if (!pill) return;
  const store = temuActiveStoreName();
  const temuIco = `<span class="temu-pill-ico"><svg class="i" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg></span>`;

  if (!store) {
    pill.innerHTML = `
      ${temuIco}
      <span class="temu-pill-name">Temu Export</span>
    `;
    pill.title = 'Open Temu Export (No store added)';
    return;
  }

  let readyCount = 0;
  try {
    const rows = await getMasterRows();
    readyCount = rows.length;
  } catch (_) {}

  pill.innerHTML = `
    <span class="temu-dot-live"></span>
    <span class="temu-pill-name">${esc(store)}</span>
    <span class="temu-pill-divider"></span>
    <span class="temu-pill-count">${readyCount}/50</span>
  `;
  pill.title = `Open Temu Export — Store: ${store} (${readyCount} ready)`;
}

function initTemuExport() {
  temuInitActivitySummary();
  updateTopTemuStorePill();
  try {
    temuAutoSyncActiveStoreFromTab(false);
    chrome.tabs?.onActivated?.addListener(() => {
      temuAutoSyncActiveStoreFromTab(false);
    });
  } catch (_) {}
  document.addEventListener('change', e => {
    if (e.target && e.target.id === 'tgSkipListed') temuUpdateSrcInfo();
    if (e.target && e.target.id === 'temuSource') { 
      if (TemuLast?.asIs && e.target.value !== 'sheet') { TemuLast = null; const mb = $('temuMarkListedBtn'); if (mb) mb.hidden = true; } 
      temuUpdateSrcInfo(); 
      temuGetQueuedRows().then(rows => {
        temuUpdateReviewCount(rows);
        const rl = $('temuReviewList');
        if (rl && !rl.classList.contains('hidden')) temuRenderReviewList(rows);
      }).catch(() => {});
    }
    if (e.target && e.target.id === 'temuSheetFile') { const f = e.target.files?.[0]; if (f) temuImportSheet(f); e.target.value = ''; }
    if (e.target && e.target.id === 'temuCatTplFile') { const f = e.target.files?.[0]; if (f) temuImportTemplateCategory(f); e.target.value = ''; }
    if (e.target && e.target.id === 'tgPx') { const o = $('tgPx2'); if (o) o.value = e.target.value; temuRefreshReviewPrices(); }
    if (e.target && e.target.id === 'tgPx2') { const o = $('tgPx'); if (o) o.value = e.target.value; temuRefreshReviewPrices(); }
    if (e.target && e.target.id === 'temuDailyTarget') {
      const val = parseInt(e.target.value, 10) || 50;
      chrome.storage.local.set({ temuDailyTarget: val }, () => temuRenderHistory());
    }
    if (e.target && e.target.id === 'temuHistStoreFilter') temuRenderHistory();
    if (e.target && e.target.id === 'temuStoreSel') (async () => {
      if ((await temuSaveStores(temuStores(), e.target.value)) === true) {
        TemuLast = null;
        temuUpdateTplStatus(); temuRenderProfiles(); temuFillForm();
        updateTopTemuStorePill();
        toast(`Active store: ${e.target.value}`, 'ok');
      }
    })();
  });
  document.addEventListener('input', e => {
    if (e.target && (e.target.id === 'tgPx' || e.target.id === 'tgPx2')) temuRefreshReviewPrices();
    if (e.target && e.target.id === 'temuCatSearch') { TemuCatPage = 1; temuRenderProfiles(); }
    if (e.target && e.target.id === 'temuCatalogSearch') temuRenderCatalogGrid();
    if (e.target && e.target.id === 'temuHistSearch') temuRenderHistory();
    if (e.target && e.target.id === 'temuDailyTarget') {
      const val = parseInt(e.target.value, 10) || 50;
      chrome.storage.local.set({ temuDailyTarget: val }, () => temuRenderHistory());
    }
  });
  // Delegated clicks — survive any re-render and any modal stacking
  document.addEventListener('click', e => {
    const tb = e.target.closest('#temuModal .temu-tab'); if (tb) { temuSwitchTab(tb.dataset.ttab); return; }
    if (e.target.closest('#temuReportClear')) { const r = $('temuReport'); if (r) r.textContent = ''; const wp = $('temuActivityWrap'); if (wp) wp.open = false; try { chrome.storage.local.remove('temuReportText'); } catch (_) {} }
    if (e.target.closest('#tcCancelBtn')) { temuCatFormReset(); temuCatMsg(''); }
    if (e.target.closest('#bulkTemuBtn') || e.target.closest('#queueTemuBtn') || e.target.closest('#bulkTemuOpenBtn') || e.target.closest('#topTemuStorePill')) { e.preventDefault(); openTemuModal(); } // v9.5.3: Bulk tab ka 'Temu' button — bina hunt ke bhi

    // Categories & Catalog events
    const deptBtn = e.target.closest('#temuCatDeptBar .temu-cat-dept-btn');
    if (deptBtn) {
      TemuCatActiveDept = deptBtn.dataset.dept || 'all';
      TemuCatPage = 1;
      temuRenderProfiles();
      return;
    }
    if (e.target.closest('#temuCatPrevBtn')) {
      if (TemuCatPage > 1) {
        TemuCatPage--;
        temuRenderProfiles();
      }
      return;
    }
    if (e.target.closest('#temuCatNextBtn')) {
      TemuCatPage++;
      temuRenderProfiles();
      return;
    }

    // ── Category bulk bar buttons ──
    if (e.target.closest('#temuCatBulkSelAll')) {
      const cfg = temuGetCfg();
      Object.keys(cfg.category_profiles || {}).forEach(n => TemuCatSelected.add(n));
      temuCatUpdateBulkBar();
      temuRenderProfiles();
      return;
    }
    if (e.target.closest('#temuCatBulkCancel')) {
      TemuCatSelected.clear();
      temuCatUpdateBulkBar();
      temuRenderProfiles();
      return;
    }
    if (e.target.closest('#temuCatBulkDelete')) {
      if (!TemuCatSelected.size) return;
      const names = [...TemuCatSelected];
      const cfg = temuGetCfg();
      names.forEach(n => { delete cfg.category_profiles[n]; });
      temuSaveCfg(cfg);
      TemuCatSelected.clear();
      temuCatUpdateBulkBar();
      temuRenderProfiles();
      toast(`${names.length} categor${names.length > 1 ? 'ies' : 'y'} deleted`, 'ok');
      return;
    }
    // ── Category item checkbox toggle ──
    const chk = e.target.closest('.temu-cat-chk');
    if (chk) {
      e.stopPropagation();
      const catName = chk.closest('.temu-cat-item')?.dataset?.catName;
      if (catName) {
        if (TemuCatSelected.has(catName)) TemuCatSelected.delete(catName);
        else TemuCatSelected.add(catName);
        temuCatUpdateBulkBar();
        temuRenderProfiles();
      }
      return;
    }

    if (e.target.closest('#temuAddCategoryTopBtn')) {
      const form = $('temuCatForm');
      if (form) {
        const isHidden = form.classList.toggle('hidden');
        if (!isHidden) {
          $('tcName')?.focus();
          try { form.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (_) {}
        }
      }
    }
    if (e.target.closest('#temuPickCatalogTopBtn') || e.target.closest('#temuPickCatalogBtn')) temuOpenCatalogModal();
    if (e.target.closest('#temuCatSearchClear')) {
      const inp = $('temuCatSearch');
      if (inp) {
        inp.value = '';
        TemuCatPage = 1;
        temuRenderProfiles();
        inp.focus();
      }
    }
    if (e.target.closest('#temuFetchFromTabBtn')) temuFetchFromTemuTab();
    if (e.target.closest('#temuCatalogClose')) $('temuCatalogModal')?.classList.add('hidden');
    if (e.target.closest('#temuCatalogImportAllBtn')) temuImportAllCatalog();
    if (e.target.closest('#temuImportTplCatBtn')) $('temuCatTplFile')?.click();
    // Gemini modal
    if (e.target.closest('#temuGeminiClose')) $('temuGeminiModal')?.classList.add('hidden');
    if (e.target.closest('#temuGeminiModal.modal-back') && !e.target.closest('.modal-box')) $('temuGeminiModal')?.classList.add('hidden');
    if (e.target.closest('#temuGeminiCopyPromptBtn')) {
      const txt = $('temuGeminiPromptTxt')?.value || '';
      navigator.clipboard.writeText(txt).then(() => toast('Prompt copied! ✓', 'ok')).catch(() => { const ta = document.createElement('textarea'); ta.value = txt; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); toast('Prompt copied!', 'ok'); });
    }
    if (e.target.closest('#temuGeminiOpenBtn')) {
      (async () => {
        const modal = $('temuGeminiModal');
        const imgSrc = modal?._currentImgUrl || $('temuGeminiPreviewImg')?.src || '';

        // Convert to base64 first (if it's a URL)
        let base64Data = imgSrc;
        if (imgSrc && !imgSrc.startsWith('data:')) {
          try {
            const resp = await fetch(imgSrc);
            const blob = await resp.blob();
            base64Data = await new Promise(res => {
              const rd = new FileReader();
              rd.onload = () => res(rd.result);
              rd.readAsDataURL(blob);
            });
          } catch (_) { base64Data = imgSrc; }
        }

        if (base64Data) {
          await new Promise(r => chrome.storage.local.set({
            pendingGeminiAction: {
              imgBase64: base64Data,
              timestamp: Date.now(),
              processed: false
            }
          }, r));
          toast('Gemini khul raha he, image auto-paste ho rahi he...', 'info');
        }

        chrome.tabs.query({ url: '*://gemini.google.com/*' }, (existingTabs) => {
          if (existingTabs && existingTabs.length > 0) {
            const tab = existingTabs[0];
            chrome.tabs.update(tab.id, { active: true });
            chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['gemini_automation.js'] }).catch(() => {});
            chrome.tabs.sendMessage(tab.id, { action: 'TRIGGER_GEMINI_IMAGE' }).catch(() => {});
          } else {
            chrome.tabs.create({ url: 'https://gemini.google.com/app', active: true }, (tab) => {
              if (tab?.id) {
                const onTabLoaded = (tabId, info) => {
                  if (tabId === tab.id && info.status === 'complete') {
                    chrome.tabs.onUpdated.removeListener(onTabLoaded);
                    chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['gemini_automation.js'] }).catch(() => {});
                  }
                };
                chrome.tabs.onUpdated.addListener(onTabLoaded);
                setTimeout(() => chrome.tabs.onUpdated.removeListener(onTabLoaded), 25000);
              }
            });
          }
        });
        modal?.classList.add('hidden');
      })();
    }
    if (e.target.closest('#temuGptOpenBtn')) {
      (async () => {
        const modal = $('temuGeminiModal');
        const imgSrc = modal?._currentImgUrl || $('temuGeminiPreviewImg')?.src || '';

        // Convert to base64 first (if it's a URL)
        let base64Data = imgSrc;
        if (imgSrc && !imgSrc.startsWith('data:')) {
          try {
            const resp = await fetch(imgSrc);
            const blob = await resp.blob();
            base64Data = await new Promise(res => {
              const rd = new FileReader();
              rd.onload = () => res(rd.result);
              rd.readAsDataURL(blob);
            });
          } catch (_) { base64Data = imgSrc; }
        }

        if (base64Data) {
          await new Promise(r => chrome.storage.local.set({
            pendingGptAction: {
              imgBase64: base64Data,
              timestamp: Date.now(),
              processed: false
            }
          }, r));
          toast('ChatGPT khul raha he, image auto-paste ho rahi he...', 'info');
        }

        chrome.tabs.query({ url: '*://chatgpt.com/*' }, (existingTabs) => {
          if (existingTabs && existingTabs.length > 0) {
            const tab = existingTabs[0];
            chrome.tabs.update(tab.id, { active: true });
            chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['gpt_automation.js'] }).catch(() => {});
            chrome.tabs.sendMessage(tab.id, { action: 'TRIGGER_GPT_IMAGE' }).catch(() => {});
          } else {
            chrome.tabs.create({ url: 'https://chatgpt.com/', active: true }, (tab) => {
              if (tab?.id) {
                const onTabLoaded = (tabId, info) => {
                  if (tabId === tab.id && info.status === 'complete') {
                    chrome.tabs.onUpdated.removeListener(onTabLoaded);
                    chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['gpt_automation.js'] }).catch(() => {});
                  }
                };
                chrome.tabs.onUpdated.addListener(onTabLoaded);
                setTimeout(() => chrome.tabs.onUpdated.removeListener(onTabLoaded), 25000);
              }
            });
          }
        });
        modal?.classList.add('hidden');
      })();
    }
    if (e.target.closest('#temuFlowOpenBtn')) {
      const modal = $('temuGeminiModal');
      const imgUrl = modal?._currentImgUrl || $('temuGeminiPreviewImg')?.src || '';
      const prompt = $('temuGeminiPromptTxt')?.value || '';
      const activeTitle = modal?._productTitle || $('temuModal')?.querySelector('.temu-rv-title-inp')?.value || 'Product';
      if (!imgUrl) {
        toast('Image URL not found!', 'warn');
        return;
      }
      triggerFlowEdit({
        src: imgUrl,
        title: activeTitle,
        prompt: prompt,
        productId: modal?._productId,
        imageIndex: modal?._imageIndex
      });
      modal?.classList.add('hidden');
    }

    // History filter buttons
    const hfBtn = e.target.closest('.temu-hist-fbtn');
    if (hfBtn) {
      document.querySelectorAll('.temu-hist-fbtn').forEach(b => b.classList.remove('active'));
      hfBtn.classList.add('active');
      TemuHistFilter = hfBtn.dataset.hfilter || 'all';
      temuRenderHistory();
    }
    if (e.target.closest('#temuHistExportAll')) temuExportAllHistoryCsv();

    if (e.target.closest('#temuModalClose')) $('temuModal')?.classList.add('hidden');
    if (e.target.closest('#temuExportBtn')) temuRunExport({ forUpload: false });
    if (e.target.closest('#temuMarkListedBtn')) (async () => {
      if (!TemuLast?.items?.length) return;
      if (!confirm(`${TemuLast.items.length} products ko "listed" mark karein? (Sirf tab jab aap ne ye file Temu par khud upload kar di ho)`)) return;
      await temuMarkListed(TemuLast.items); TemuLast.marked = true;
      try {
        const queued = await msg({ action: 'SOURCING_QUEUE', snapshot: temuSourcingSnapshot() });
        if (queued?.success) await msg({ action: 'SOURCING_RETRY' });
        else toast(queued?.error || 'Sourcing record missing', 'warn');
      } catch (e) { toast('Sourcing sync pending: ' + e.message, 'warn'); }
      try { await temuHistAdd({ kind: 'manual', store: temuActiveStoreName() || '—', n: TemuLast.items.length, items: temuHistItems(TemuLast.items) }); } catch (_) {}
      const mb = $('temuMarkListedBtn'); if (mb) mb.hidden = true;
      const rep = $('temuReport'); if (rep) rep.textContent += `\n✓ ${TemuLast.items.length} products listed mark kiye`;
      temuUpdateSrcInfo();
    })();
    if (e.target.closest('#temuAutoBtn')) temuAutoUpload();
    if (e.target.closest('#temuFixDraftsBtn')) temuFixDrafts();
    if (e.target.closest('#temuFailedBtn')) temuReadFailed({});
    if (e.target.closest('#temuSheetBtn')) $('temuSheetFile')?.click();
    if (e.target.closest('#temuHistClear')) (async () => { if (!confirm('Temu upload history clear karein?')) return; await new Promise(r => chrome.storage.local.set({ temuUploadHistory: [] }, r)); temuRenderHistory(); })();
    if (e.target.closest('#tcSaveBtn')) temuSaveProfileFromForm();
    if (e.target.closest('#tgUnmarkLast')) (async () => {
      const lm = await new Promise(r => chrome.storage.local.get('temuLastMarked', x => r(x?.temuLastMarked || null)));
      if (!lm || !lm.sids?.length) { temuSaveMsg('Koi aakhri upload record nahi', 'warn'); return; }
      const when = new Date(lm.t).toLocaleString();
      if (!confirm(`${lm.n} products (${when}) ko store "${lm.store}" ki listed-history se wapas nikaalein?`)) return;
      const m = { ...temuListedMap() }; let n = 0;
      lm.sids.forEach(sid => { const k = lm.store + '|' + sid; if (m[k]) { delete m[k]; n++; } });
      const ok2 = await msg({ action: 'UPDATE_SETTINGS', settings: { temuListed: m } });
      if (ok2?.success) { State.data.settings.temuListed = m; try { chrome.storage.local.remove('temuLastMarked'); } catch (_) {} temuSaveMsg(`${n} products unmark (store ${lm.store})`, 'ok'); temuUpdateSrcInfo(); }
      else temuSaveMsg('Unmark fail', 'warn');
    })();
    if (e.target.closest('#tgClearListed')) (async () => {
      if (!confirm('Listed history clear karein? (Extension bhool jayegi kaun se products pehle upload huay)')) return;
      const ok2 = await msg({ action: 'UPDATE_SETTINGS', settings: { temuListed: {} } });
      if (ok2?.success) { State.data.settings.temuListed = {}; toast('Listed history cleared', 'ok'); }
    })();
    if (e.target.closest('#temuTestConnBtn')) (async () => {
      const btn = $('temuTestConnBtn');
      if (btn) btn.disabled = true;
      try {
        const detected = await temuDetectStoreFromTab();
        if (detected) {
          await temuAutoSyncActiveStoreFromTab(true);
          toast(`✅ Synced with active tab: ${detected}`, 'ok');
        } else {
          toast('⚠️ Temu Seller tab not detected or store name not found. Open seller.temu.com first.', 'warn');
        }
      } catch (err) {
        toast('Connection test error: ' + (err?.message || 'failed'), 'err');
      } finally {
        if (btn) btn.disabled = false;
      }
    })();
    if (e.target.closest('#temuStoreAddBtn')) (async () => {
      let detectedName = '';
      try {
        const tabs = await chrome.tabs.query({
          url: [
            '*://seller.temu.com/*',
            '*://seller.kuajingmaihuo.com/*',
            '*://*.temu.com/*',
            '*://*.kuajingmaihuo.com/*'
          ]
        });
        if (tabs && tabs.length > 0) {
          const sellerTabs = tabs.filter(t => /seller\.(temu|kuajingmaihuo)\.com/i.test(t.url || ''));
          const targetTab = sellerTabs.find(t => t.active) || sellerTabs[0] || tabs.find(t => t.active) || tabs[0];
          if (targetTab?.id) {
            const [res] = await chrome.scripting.executeScript({
              target: { tabId: targetTab.id },
              func: () => {
                const el = document.querySelector('[class*="mall_name"]') ||
                           document.querySelector('#mms-layout-user-setting [class*="mall_name"]') ||
                           document.querySelector('#mms-layout-user-setting');
                if (!el) return '';
                if (el.matches && el.matches('[class*="mall_name"]')) {
                  return (el.textContent || '').trim();
                }
                const child = el.querySelector('[class*="mall_name"]');
                if (child) return (child.textContent || '').trim();
                let txt = (el.innerText || el.textContent || '').trim();
                return txt.replace(/\s*copy\s*$/i, '').split('\n')[0].trim();
              }
            });
            if (res?.result && typeof res.result === 'string') {
              detectedName = res.result.trim();
            }
          }
        }
      } catch (err) {
        console.warn('[Temu] Store auto-detect error:', err);
      }

      let storeName = detectedName;
      if (!storeName || e.shiftKey) {
        const input = prompt(
          storeName
            ? `Store ka naam (${storeName} detect hua, edit karna chahein to karein):`
            : 'Store ka naam (bilkul wahi jo Temu Seller Center mein upar dikhta hai, e.g. HQ TWO):',
          storeName || ''
        );
        if (!input || !input.trim()) return;
        storeName = input.trim();
      }

      const stores = temuStores();
      if (!stores[storeName]) stores[storeName] = { templateB64: '', templateName: '', config: null };
      if ((await temuSaveStores(stores, storeName)) === true) {
        temuRenderStoreBar();
        temuUpdateTplStatus();
        temuRenderProfiles();
        toast(`✓ Store: ${storeName}`, 'ok');
        // Automatically open the template file picker for this store
        setTimeout(() => {
          $('temuTplFile')?.click();
        }, 150);
      }
    })();
    if (e.target.closest('#temuStoreDelBtn')) (async () => {
      const btn = $('temuStoreDelBtn');
      const n = temuActiveStoreName(); if (!n) return;
      if (!btn.dataset.confirming) {
        btn.dataset.confirming = '1';
        btn.textContent = 'Confirm?';
        btn.style.fontSize = '10px';
        btn.style.color = '#ef4444';
        setTimeout(() => {
          if (btn.dataset.confirming) {
            delete btn.dataset.confirming;
            btn.textContent = '✕';
            btn.style.fontSize = '';
            btn.style.color = '';
          }
        }, 3000);
        return;
      }
      delete btn.dataset.confirming;
      btn.textContent = '✕';
      btn.style.fontSize = '';
      btn.style.color = '';

      const stores = temuStores(); delete stores[n];
      const nextStore = Object.keys(stores)[0] || '';
      if ((await temuSaveStores(stores, nextStore)) === true) {
        temuRenderStoreBar();
        temuUpdateTplStatus();
        temuRenderProfiles();
        updateTopTemuStorePill();
        toast(`Store "${n}" deleted ✓`, 'ok');
      }
    })();
    if (e.target.closest('#tgSaveBtn')) (async () => {
      const num = v => { const x = parseFloat(v); return isFinite(x) && x > 0 ? x : null; };
      const px = num($('tgPx2')?.value ?? $('tgPx')?.value);
      const w = num($('tgW')?.value), l = num($('tgL')?.value), wd = num($('tgWd')?.value), ht = num($('tgH')?.value);
      if (px === null) { temuSaveMsg('Price × mein number likhein', 'bad'); temuSwitchTab('settings'); $('tgPx2')?.focus(); return; }
      if ([w, l, wd, ht].some(x => x === null)) { temuSaveMsg('Default package ke charon boxes mein number likhein', 'bad'); return; }
      const cfg = temuGetCfg();
      cfg.price_multiplier = px;
      { const lp = num($('tgListPx')?.value); if (lp) cfg.list_price_multiplier = lp; }
      { const minP = num($('tgMinPx')?.value); if (minP) cfg.price_min = minP; }
      { const maxP = num($('tgMaxPx')?.value); if (maxP) cfg.price_max = maxP; }
      { const a = parseInt($('tgQtyMin')?.value, 10), b = parseInt($('tgQtyMax')?.value, 10);
        if (a > 0 && b >= a) { cfg.quantity_min = a; cfg.quantity_max = b; } }
      { const mw = num($('tgMaxW')?.value); if (mw) cfg.max_weight_lb = mw; }
      cfg.title_remove_words = ($('tgWords')?.value || '').split(',').map(x => x.trim()).filter(Boolean);
      cfg.skip_listed = !!$('tgSkipListed')?.checked;
      cfg.smart_variations = !!$('tgSmartVar')?.checked;
      cfg.upload_in_background = !!$('tgBgUpload')?.checked;
      cfg.smart_weight = !!$('tgSmartWeight')?.checked;
      temuApplyLiveCopyPrice(cfg);
      { const vv = ($('tgVarValues')?.value || '').split(',').map(x => x.trim()).filter(Boolean); if (vv.length) cfg.simple_variation_values = vv; }
      cfg.defaults.weight_lb = w; cfg.defaults.length_in = l; cfg.defaults.width_in = wd; cfg.defaults.height_in = ht;
      TemuLast = null;
      temuSaveMsg('Saving…');
      const r = await temuSaveCfg(cfg);
      if (r === true) { temuSaveMsg(`✓ Saved for ${temuActiveStoreName()}`, 'ok'); temuFillForm(); }
      else temuSaveMsg('Save fail: ' + r, 'bad');
    })();
  });
  $('temuTplFile')?.addEventListener('change', async e => {
    const f = e.target.files?.[0]; if (!f) return;
    const buf = await f.arrayBuffer();
    let bin = ''; const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    const b64 = btoa(bin);
    const stores = temuStores(); const n = temuActiveStoreName();
    if (!n) { toast('Pehle store add karein (Store dropdown ke paas + button)', 'warn'); return; }
    stores[n] = { ...(stores[n] || {}), templateB64: b64, templateName: f.name };
    const r = await temuSaveStores(stores);
    if (r === true) { temuUpdateTplStatus(); toast(`Template saved for ${n}`, 'ok'); }
    else { const st = $('temuTplStatus'); if (st) { st.textContent = '✗ Template save fail: ' + r; st.style.color = 'var(--bad)'; } }
    e.target.value = '';
  });
}
try { document.addEventListener('DOMContentLoaded', initTemuExport); if (document.readyState !== 'loading') initTemuExport(); } catch (_) {}

// ═════════════════════════════════════════════════════════════════
// v9.11.0 — EDIT STUDIO (manual)
// "Edit Images" → choose Manual studio / Auto. The studio shows ONE product per page:
// title (editable) · pack chips (adds "N Pack - " in front) · image / pack prompt to copy ·
// the images picked for editing, each with Copy, a result slot (Ctrl+V) and "Flow se lo".
// "Paste in Flow" puts the ticked images (+ prompt) into Flow's prompt box — no generate.
// ═════════════════════════════════════════════════════════════════
let ZhStudio = { items: [], page: 0, open: false, basePrompt: '', usedFlowIds: new Set(), withPrompt: true };
const ZS_PACKS = [1, 2, 3, 4, 6, 8, 10, 12];
const PACK_PREFIX_RE = /^\s*(?:\d+\s*[- ]?\s*pack|pack\s+of\s+\d+)\s*[-–|:]?\s*/i;

function packTitle(title, n) {
  const base = String(title || '').replace(PACK_PREFIX_RE, '').trim();
  return n > 1 ? `${n} Pack - ${base}`.slice(0, 180) : base;
}
function packFromTitle(title) {
  const m = String(title || '').match(/^\s*(\d+)\s*[- ]?\s*pack\b/i) || String(title || '').match(/^\s*pack\s+of\s+(\d+)/i);
  return m ? parseInt(m[1], 10) : 1;
}
function packImagePrompt(n) {
  return `Create a ${n} pack of this product. Show ${n} identical units of this exact product together on a clean white background. Keep the packaging, logo, colors and all text exactly the same as the reference. No extra text or badges.`;
}

async function zhImageToPngBlob(src) {
  let dataUrl = src;
  if (!/^data:/i.test(src)) {
    const r = /^https:\/\/flow-content\.google\//i.test(src)
      ? await msg({ action: 'FETCH_FLOW_IMAGE', url: src })
      : await msg({ action: 'FETCH_BASE64', url: src, settings: { imageFormat: 'original' } });
    if (r?.success && r.base64) dataUrl = r.base64;
  }
  if (!/^data:/i.test(dataUrl)) throw new Error('image download nahi hui');
  const blob = await (await fetch(dataUrl)).blob();
  if (blob.type === 'image/png') return blob;
  const bmp = await createImageBitmap(blob);
  const c = document.createElement('canvas');
  c.width = bmp.width; c.height = bmp.height;
  c.getContext('2d').drawImage(bmp, 0, 0);
  try { bmp.close(); } catch (_) {}
  return await new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error('png convert fail')), 'image/png'));
}
async function zhCopyImage(src) {
  try {
    // Promise inside ClipboardItem keeps the click's permission while the image downloads
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': zhImageToPngBlob(src) })]);
    return true;
  } catch (e) { console.warn('[ZHunter] Copy image failed:', e); return false; }
}
async function zhCopyText(t) {
  try { await navigator.clipboard.writeText(t); return true; } catch (_) { return false; }
}

// Newest generated image in the open Flow project that this studio hasn't used yet
async function flowLatestGenerated(excludeIds = new Set()) {
  const list = await flowScanImages();
  if (!Array.isArray(list)) return null;
  return list.find(g => g.loaded !== false && !excludeIds.has(g.id) && !_flowUploadTitle(g.title)) || null;
}

// ── mode chooser ────────────────────────────────────────────────
function zhChooseEditMode() {
  const rowsSel = TemuImgEditSelected.size;
  if (!rowsSel) { toast('Pehle ✨ checkbox se products select karein (ya "Select all")', 'warn'); return; }
  $('zhModeModal')?.classList.remove('hidden');
}
(function initZhMode() {
  const close = () => $('zhModeModal')?.classList.add('hidden');
  $('zhModeCloseBtn')?.addEventListener('click', close);
  $('zhModeManualBtn')?.addEventListener('click', () => { close(); zhStudioOpen(); });
  $('zhModeAutoBtn')?.addEventListener('click', () => { close(); temuStartBulkImageEdit(); });
})();

// ── studio ──────────────────────────────────────────────────────
async function zhStudioOpen(startProductId = null) {
  const rows = await temuGetQueuedRows();
  const selRows = rows.filter(r => TemuImgEditSelected.has(r.id));
  if (!selRows.length) { toast('Pehle ✨ checkbox se products select karein', 'warn'); return; }
  const basePrompt = ($('temuAiImgPromptInp')?.value || '').trim() || await getSavedAiImagePrompt();
  const items = selRows.map((r, i) => {
    const all = _allImgUrls(r);
    const picked = temuImgTargetIndices(r).filter(x => all[x]);
    const pack = packFromTitle(r.title);
    return {
      product: r, pNo: i + 1, picked, showAll: false, pack,
      promptMode: pack > 1 ? 'pack' : 'image',
      prompts: { image: basePrompt, pack: packImagePrompt(Math.max(2, pack)) },
      slots: {}, pasteSel: new Set(picked), active: picked[0] ?? 0
    };
  });
  const startPage = startProductId ? Math.max(0, items.findIndex(x => x.product.id === startProductId)) : 0;   // v9.12.6
  ZhStudio = { ...ZhStudio, items, page: startPage, open: true, basePrompt, usedFlowIds: new Set() };
  try { const st = await chrome.storage.local.get(['zhStudioWithPrompt']); if (typeof st?.zhStudioWithPrompt === 'boolean') ZhStudio.withPrompt = st.zhStudioWithPrompt; } catch (_) {}
  $('zhStudioModal')?.classList.remove('hidden');
  zhStudioRender(startPage);
}

function zhStudioClose() {
  ZhStudio.open = false;
  $('zhStudioModal')?.classList.add('hidden');
  temuSaveTitles(ZhStudio.items.map(it => ({ id: it.product.id, url: it.product.url, title: it.product.title }))).catch(e => toast(e.message, 'warn'));
  temuRenderReview().catch(() => {});
}

const zsCur = () => ZhStudio.items[ZhStudio.page];
function zsShownIdx(it) {
  const all = _allImgUrls(it.product);
  return it.showAll ? all.map((_, i) => i).filter(i => all[i]) : it.picked;
}
function zsStats() {
  let done = 0, total = 0;
  for (const it of ZhStudio.items) { total += it.picked.length; done += it.picked.filter(i => it.slots[i]?.newUrl).length; }
  return { done, total };
}

function zhStudioRender(dir = 0) {
  const it = zsCur();
  const body = $('zhStudioBody');
  if (!it || !body) return;
  const { done, total } = zsStats();
  const n = ZhStudio.items.length;
  $('zhStudioSub').textContent = `Product ${ZhStudio.page + 1} / ${n} · ${done}/${total} images replaced`;
  $('zhStudioBar').style.width = `${total ? Math.round(done / total * 100) : 0}%`;
  $('zhStudioPrevBtn').disabled = ZhStudio.page === 0;
  const nx = $('zhStudioNextBtn');
  nx.innerHTML = ZhStudio.page === n - 1 ? '✓ Done' : 'Next ›';

  const all = _allImgUrls(it.product);
  const shown = zsShownIdx(it);
  const title = it.product.title || '';
  const prompt = it.prompts[it.promptMode];
  const extra = all.filter(Boolean).length - it.picked.length;

  body.innerHTML = `
    <div class="zs-anim ${dir > 0 ? 'from-r' : dir < 0 ? 'from-l' : ''}">
      <div class="zs-sec">
        <div class="zs-lbl"><span>Title</span><span style="display:flex;align-items:center;gap:8px;">
          <span class="zs-cnt ${title.length > 180 ? 'over' : ''}" id="zsTitleCnt">${title.length}/180</span>
          <button type="button" class="zs-ai" id="zsAiTitle" title="AI se title rewrite (pack wala hissa aage hi rahega)">✨ AI rewrite</button></span></div>
        <textarea id="zsTitle" class="zs-title" rows="2" spellcheck="false">${esc(title)}</textarea>
        <div class="zs-lbl" style="margin:10px 0 6px">Pack size</div>
        <div class="zs-packs">
          ${ZS_PACKS.map(p => `<button type="button" class="zs-chip${it.pack === p ? ' on' : ''}" data-pack="${p}" title="${p === 1 ? 'Single product (pack hatao)' : p + ' Pack - title'}">
            <b>${p === 1 ? '1' : p + '×'}</b><small>${p === 1 ? 'Single' : 'Pack'}</small></button>`).join('')}
        </div>
      </div>
      <div class="zs-sec">
        <div class="zs-row">
          <div class="zs-seg">
            <button type="button" data-pm="image" class="${it.promptMode === 'image' ? 'on' : ''}">Image prompt</button>
            <button type="button" data-pm="pack" class="${it.promptMode === 'pack' ? 'on' : ''}">Pack prompt${it.pack > 1 ? ` (${it.pack})` : ''}</button>
          </div>
          <button type="button" class="zs-btn" id="zsCopyPrompt">📝 Copy prompt</button>
        </div>
        <textarea id="zsPrompt" class="zs-prompt" rows="3" spellcheck="false">${esc(prompt)}</textarea>
      </div>
      <div class="zs-sec">
        <div class="zs-row">
          <span class="zs-lbl" style="margin:0">Images · ${it.picked.length} for editing</span>
          ${extra > 0 ? `<button type="button" class="zs-link" id="zsShowAll">${it.showAll ? 'Sirf selected' : `+ Sab images (${all.filter(Boolean).length})`}</button>` : ''}
        </div>
        <div class="zs-imgs">
          ${shown.map(i => {
            const s = it.slots[i] || {};
            const isPick = it.picked.includes(i);
            return `
            <div class="zs-img${i === it.active ? ' active' : ''}${s.newUrl ? ' done' : ''}" data-i="${i}">
              <div class="zs-img-top">
                <label class="zs-tick" title="Paste in Flow ke liye"><input type="checkbox" data-paste="${i}" ${it.pasteSel.has(i) ? 'checked' : ''}/> #${i + 1}${i === 0 ? ' · Main' : ''}</label>
              </div>
              <div class="zs-pair">
                <img class="zs-orig" src="${esc(all[i])}" alt="" />
                ${isPick || s.newUrl ? `<div class="zs-slot" data-act="select">
                  ${s.busy ? '<span class="zs-hint">⏳</span>'
                    : s.newUrl ? `<img src="${esc(s.newUrl)}" alt="" /><span class="zs-ok">✓</span>`
                    : '<span class="zs-hint">Click =<br>Paste</span>'}
                </div>` : ''}
              </div>
              <div class="zs-img-btns">
                <button type="button" class="zs-btn sm" data-act="copy" title="Image copy — Flow mein Ctrl+V">📋 Copy</button>
                ${isPick || s.newUrl ? `<button type="button" class="zs-btn sm paste" data-act="paste" title="Clipboard ki image isi slot mein (Ctrl+V ki zaroorat nahi)">📥 Paste</button>` : ''}
                ${isPick || s.newUrl ? `<button type="button" class="zs-btn sm" data-act="flow" title="Flow ki sab se nayi bani image is slot mein">⬇ Flow se lo</button>` : ''}
                ${s.newUrl ? `<button type="button" class="zs-btn sm" data-act="undo" title="Original wapis">↩</button>` : ''}
              </div>
            </div>`;
          }).join('')}
        </div>
      </div>
      <div class="zs-flowbar">
        <button type="button" class="zs-btn primary" id="zsPasteFlow">⚡ Paste in Flow (${it.pasteSel.size})</button>
        <label class="zs-tick"><input type="checkbox" id="zsWithPrompt" ${ZhStudio.withPrompt ? 'checked' : ''}/> + prompt</label>
        <button type="button" class="zs-btn" id="zsOpenFlow">↗ Open Flow</button>
      </div>
    </div>`;
}

// title edits → product rows + review card (saved when studio page changes / closes)
function zsSetTitle(it, t) {
  it.product.title = t;
  for (const x of _productRowsById(it.product.id)) x.title = t;
  const card = document.querySelector(`.temu-rv-card[data-id="${it.product.id}"]`);
  if (card) {
    const inp = card.querySelector('.temu-rv-title-inp'); if (inp) inp.value = t;
    const sn = card.querySelector('.temu-rv-title-snippet'); if (sn) sn.textContent = t;
  }
}

// AI title rewrite — same optimizer as the bulk "AI" button; the "N Pack - " prefix is kept
async function zsAiRewriteTitle(it) {
  const btn = $('zsAiTitle');
  if (btn?.classList.contains('busy')) return;
  if (btn) { btn.classList.add('busy'); btn.textContent = '⏳ Rewriting…'; }
  try {
    const cur = it.product.title || '';
    const base = cur.replace(PACK_PREFIX_RE, '').trim();
    const instruction = getTemuOptimizerInstruction(temuTitlePreferences());
    const out = await rewriteValidatedTemuTitle(it.product, base, instruction);
    let t = out.replace(PACK_PREFIX_RE, '');
    if (!t) throw new Error('khali jawab');
    t = cleanTemuTitleResult(packTitle(t, it.pack));
    zsSetTitle(it, t);
    await temuSaveTitles([{ id: it.product.id, url: it.product.url, title: t }]);
    zhStudioRender();
    toast('✨ Title rewrite ho gaya', 'ok');
  } catch (e) {
    toast('AI title error: ' + (e?.message || e), 'warn');
    if (btn) { btn.classList.remove('busy'); btn.textContent = '✨ AI rewrite'; }
  }
}

// Clipboard image as data URL (side panel first, then via the Flow tab as a fallback)
async function zsReadClipboardImage() {
  const read = async () => {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const type = item.types.find(x => x.startsWith('image/'));
      if (type) {
        const blob = await item.getType(type);
        return await new Promise(res => { const rd = new FileReader(); rd.onload = () => res(rd.result); rd.readAsDataURL(blob); });
      }
    }
    return null;
  };
  try { const v = await read(); if (v) return v; } catch (e) { console.warn('[ZHunter] clipboard read:', e); }
  try {
    const tabs = await chrome.tabs.query({ url: '*://flow.google.com/*' });
    const tab = tabs.find(x => /\/project\//.test(x.url || '')) || tabs[0];
    if (!tab) return null;
    const [r] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: async () => {
      try {
        for (const item of await navigator.clipboard.read()) {
          const type = item.types.find(x => x.startsWith('image/'));
          if (type) { const b = await item.getType(type); return await new Promise(res => { const rd = new FileReader(); rd.onload = () => res(rd.result); rd.readAsDataURL(b); }); }
        }
      } catch (_) {}
      return null;
    } });
    return r?.result || null;
  } catch (_) { return null; }
}

async function zsApply(it, i, src, how = 'Paste') {
  const s = it.slots[i] || (it.slots[i] = {});
  if (!src || s.busy) return;
  const all = _allImgUrls(it.product);
  if (!s.orig) s.orig = all[i];
  s.busy = true; zhStudioRender();
  try {
    let finalUrl = src;
    if (/^https:\/\/flow-content\.google\//i.test(src)) {
      try { const r = await msg({ action: 'FETCH_FLOW_IMAGE', url: src }); if (r?.success && r.base64) finalUrl = r.base64; } catch (_) {}
    }
    const pid = it.product.id;
    await replaceProductImage(pid, i, finalUrl, null);
    if (Array.isArray(it.product.images)) {
      const e = it.product.images[i];
      it.product.images[i] = typeof e === 'string' || e == null ? finalUrl : { ...e, url: finalUrl };
    }
    s.newUrl = finalUrl;
    if (!it.picked.includes(i)) it.picked.push(i), it.picked.sort((a, b) => a - b);
    toast(`✓ P${it.pNo} · Image #${i + 1} replaced (${how})`, 'ok');
    if (/^data:image\//i.test(finalUrl)) {
      (async () => {
        const pub = await uploadImageToPublicHost(finalUrl);
        if (pub && /^https?:\/\//i.test(pub) && s.newUrl === finalUrl) {
          await replaceProductImage(pid, i, pub, finalUrl);
          const e = it.product.images?.[i];
          if (e === finalUrl) it.product.images[i] = pub;
          else if (e && e.url === finalUrl) it.product.images[i] = { ...e, url: pub };
          s.newUrl = pub;
        }
      })();
    }
    const next = it.picked.find(x => x > i && !it.slots[x]?.newUrl) ?? it.picked.find(x => !it.slots[x]?.newUrl);
    if (next != null) it.active = next;
  } catch (e) {
    toast('Image nahi lagi: ' + (e?.message || e), 'warn');
  } finally {
    s.busy = false;
    zhStudioRender();
  }
}

async function zsUndo(it, i) {
  const s = it.slots[i];
  if (!s?.newUrl || !s.orig) return;
  await replaceProductImage(it.product.id, i, s.orig, null);
  if (Array.isArray(it.product.images)) {
    const e = it.product.images[i];
    it.product.images[i] = typeof e === 'string' || e == null ? s.orig : { ...e, url: s.orig };
  }
  s.newUrl = null;
  it.active = i;
  zhStudioRender();
  toast(`↩ P${it.pNo} · Image #${i + 1} original`, 'info');
}

async function zsPasteInFlow(it) {
  const all = _allImgUrls(it.product);
  const idx = [...it.pasteSel].sort((a, b) => a - b).filter(i => all[i]);
  if (!idx.length) { toast('Kam se kam ek image tick karein', 'warn'); return; }
  const btn = $('zsPasteFlow');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Images tayyar…'; }
  try {
    const imgs = (await Promise.all(idx.map(i => flowPrefetchImage(all[i])))).filter(Boolean);
    if (!imgs.length) { toast('Images download nahi huin', 'warn'); return; }
    const tabs = await chrome.tabs.query({ url: '*://flow.google.com/*' });
    const tab = tabs.find(t => /\/project\//.test(t.url || ''));
    if (!tab) {
      toast('Flow mein pehle ek project kholein (+ New project), phir dobara dabayein', 'warn');
      if (!tabs.length) chrome.tabs.create({ url: 'https://flow.google.com', active: true });
      else chrome.tabs.update(tabs[0].id, { active: true });
      return;
    }
    await chrome.tabs.update(tab.id, { active: true });
    if (tab.windowId) chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
    try { await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['flow_automation.js'] }); } catch (_) {}
    if (btn) btn.textContent = `⏳ Flow mein ${imgs.length} images…`;
    const res = await chrome.tabs.sendMessage(tab.id, {
      action: 'ZH_FLOW_MANUAL_ATTACH', images: imgs,
      prompt: ZhStudio.withPrompt ? (it.prompts[it.promptMode] || '') : '', clear: true
    }).catch(e => ({ ok: false, error: e?.message }));
    if (res?.ok) toast(`✓ ${res.added}/${res.total} images Flow mein${ZhStudio.withPrompt ? ' + prompt' : ''} — Generate dabayein`, 'ok');
    else toast('Flow: ' + (res?.error || 'images nahi lagin'), 'warn');
  } finally {
    if (btn) btn.disabled = false;
    zhStudioRender();
  }
}

function zsGo(delta) {
  const n = ZhStudio.items.length;
  const p = ZhStudio.page + delta;
  const current = zsCur();
  if (current) temuSaveTitles([{ id: current.product.id, url: current.product.url, title: current.product.title }]).catch(e => toast(e.message, 'warn'));
  if (p >= n) { zhStudioClose(); const { done, total } = zsStats(); toast(`🎉 Studio done: ${done}/${total} images replaced`, 'ok'); return; }
  if (p < 0) return;
  ZhStudio.page = p;
  zhStudioRender(delta);
}

(function initZhStudio() {
  $('zhStudioCloseBtn')?.addEventListener('click', zhStudioClose);
  $('zhStudioPrevBtn')?.addEventListener('click', () => zsGo(-1));
  $('zhStudioNextBtn')?.addEventListener('click', () => zsGo(1));
  const body = $('zhStudioBody');
  if (!body) return;

  body.addEventListener('input', (e) => {
    const it = zsCur(); if (!it) return;
    if (e.target.id === 'zsTitle') {
      const t = e.target.value.replace(/\n+/g, ' ');
      zsSetTitle(it, t);
      const c = $('zsTitleCnt'); if (c) { c.textContent = `${t.length}/180`; c.classList.toggle('over', t.length > 180); }
      const p = packFromTitle(t);
      if (p !== it.pack) { it.pack = p; body.querySelectorAll('.zs-chip').forEach(b => b.classList.toggle('on', +b.dataset.pack === p)); }
    } else if (e.target.id === 'zsPrompt') {
      it.prompts[it.promptMode] = e.target.value;
    }
  });

  body.addEventListener('change', (e) => {
    const it = zsCur(); if (!it) return;
    if (e.target.dataset.paste != null) {
      const i = +e.target.dataset.paste;
      e.target.checked ? it.pasteSel.add(i) : it.pasteSel.delete(i);
      const b = $('zsPasteFlow'); if (b) b.textContent = `⚡ Paste in Flow (${it.pasteSel.size})`;
    } else if (e.target.id === 'zsWithPrompt') {
      ZhStudio.withPrompt = e.target.checked;
      chrome.storage.local.set({ zhStudioWithPrompt: e.target.checked });
    }
  });

  body.addEventListener('click', async (e) => {
    const it = zsCur(); if (!it) return;
    const t = e.target;
    if (t.closest('.zs-chip')) {
      const p = +t.closest('.zs-chip').dataset.pack;
      it.pack = p;
      zsSetTitle(it, packTitle(it.product.title, p));
      if (p > 1) {
        const custom = it.prompts.pack && !/^Create a \d+ pack of this product\./.test(it.prompts.pack);
        if (!custom) it.prompts.pack = packImagePrompt(p);
        it.promptMode = 'pack';
      } else it.promptMode = 'image';
      zhStudioRender();
      return;
    }
    if (t.closest('[data-pm]')) { it.promptMode = t.closest('[data-pm]').dataset.pm; zhStudioRender(); return; }
    if (t.closest('#zsAiTitle')) { await zsAiRewriteTitle(it); return; }
    if (t.id === 'zsCopyPrompt') { if (await zhCopyText(it.prompts[it.promptMode] || '')) toast('📝 Prompt copied', 'ok'); return; }
    if (t.id === 'zsShowAll') { it.showAll = !it.showAll; zhStudioRender(); return; }
    if (t.id === 'zsPasteFlow') { await zsPasteInFlow(it); return; }
    if (t.id === 'zsOpenFlow') { focusOrOpenFlowTab().catch(() => {}); return; }
    const card = t.closest('.zs-img');
    if (!card || t.closest('.zs-tick')) return;
    const i = +card.dataset.i;
    let act = t.closest('[data-act]')?.dataset.act || 'select';
    // empty result slot: one click pastes straight from the clipboard
    if (act === 'select' && t.closest('.zs-slot') && !it.slots[i]?.newUrl) act = 'paste';
    if (act !== 'undo' && it.active !== i && (it.picked.includes(i) || it.slots[i]?.newUrl)) {
      it.active = i;
      body.querySelectorAll('.zs-img').forEach(c => c.classList.toggle('active', +c.dataset.i === i));
    }
    if (act === 'copy') {
      const src = _allImgUrls(it.product)[i];
      toast('📋 Copy ho rahi hai…', 'info');
      if (await zhCopyImage(src)) toast(`📋 P${it.pNo} · #${i + 1} copied — Flow mein Ctrl+V`, 'ok');
      else toast('Copy nahi hui — side panel par ek dafa click karke dobara try karein', 'warn');
    } else if (act === 'paste') {
      const src = await zsReadClipboardImage();
      if (!src) { toast('Clipboard mein image nahi — Flow mein image par Right click → Copy image karein', 'warn'); return; }
      await zsApply(it, i, src, 'Paste');
    } else if (act === 'flow') {
      const g = await flowLatestGenerated(ZhStudio.usedFlowIds);
      if (!g) { toast('Flow mein koi nayi generated image nahi mili (Flow project tab khula rakhein)', 'warn'); return; }
      ZhStudio.usedFlowIds.add(g.id);
      await zsApply(it, i, g.src, 'Flow');
    } else if (act === 'undo') {
      await zsUndo(it, i);
    }
  });

  document.addEventListener('paste', async (e) => {
    if (!ZhStudio.open || $('zhStudioModal')?.classList.contains('hidden')) return;
    const item = Array.from(e.clipboardData?.items || []).find(x => x.kind === 'file' && x.type.startsWith('image/'));
    if (!item) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const it = zsCur();
    const f = item.getAsFile();
    if (it && f) await zsApply(it, it.active, await _fileToDataUrl(f), 'Paste');
  }, true);

  document.addEventListener('keydown', (e) => {
    if (!ZhStudio.open || $('zhStudioModal')?.classList.contains('hidden')) return;
    if (e.target.closest?.('input, textarea, select')) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); zsGo(1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); zsGo(-1); }
    else if (e.key === 'Escape') zhStudioClose();
  });
})();

// ═════════════════════════════════════════════════════════════════
// v9.11.0 — PACK (2 / 3 / 4 … pack)
// Selected products are changed in place: AI rewrites the title as an N-pack, then the
// main image (#1) goes through Flow with a pack prompt.
// ═════════════════════════════════════════════════════════════════
async function temuMakePack() {
  const n = parseInt($('temuAiImgPackSel')?.value || '', 10);
  if (!n) { toast('Pehle "Pack" mein 2 / 3 / 4… choose karein', 'warn'); return; }
  const rows = await temuGetQueuedRows();
  const selRows = rows.filter(r => TemuImgEditSelected.has(r.id));
  if (!selRows.length) { toast('Pehle ✨ checkbox se products select karein', 'warn'); return; }
  const btn = $('temuMakePackBtn');
  if (btn) btn.disabled = true;
  let ok = 0;
  const packChanges = [];
  try {
    for (let i = 0; i < selRows.length; i++) {
      const r = selRows[i];
      if (btn) btn.textContent = `⏳ Title ${i + 1}/${selRows.length}`;
      try {
        const card = document.querySelector(`.temu-rv-card[data-id="${r.id}"]`);
        const cur = card?.querySelector('.temu-rv-title-inp')?.value || r.title || '';
        const t = packTitle(cur, n);
        r.title = t;
        packChanges.push({ id: r.id, url: r.url, title: t });
        for (const x of _productRowsById(r.id)) x.title = t;
        if (card) {
          const inp = card.querySelector('.temu-rv-title-inp');
          const snip = card.querySelector('.temu-rv-title-snippet');
          if (inp) inp.value = t;
          if (snip) snip.textContent = t;
        }
        ok++;
      } catch (e) { console.warn('[ZHunter] Pack title error:', e); }
    }
    if (packChanges.length) await temuSaveTitles(packChanges); // v9.12.3 safe save
    toast(`📦 ${ok}/${selRows.length} titles → "${n} Pack - …". Studio khul raha hai`, ok ? 'ok' : 'warn');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '📦 Make Pack'; }
  }
  // v9.11.0 — manual studio (no auto run, no debugger banner), pack prompt ready to copy
  await zhStudioOpen();
}

(function initPackAndSpeed() {
  $('temuMakePackBtn')?.addEventListener('click', temuMakePack);
  const sp = $('temuAiImgSpeedSel');
  if (sp) {
    chrome.storage.local.get(['zhunterFlowSpeed']).then(st => { if (FLOW_SPEEDS[st?.zhunterFlowSpeed]) sp.value = st.zhunterFlowSpeed; });
    sp.addEventListener('change', () => chrome.storage.local.set({ zhunterFlowSpeed: sp.value }));
  }
})();


// ═════════════════════════════════════════════════════════════════
// v9.11.0 — Temu Export polish: source segments, compact setup, collapsible
// Title Optimizer / Image Studio, settings auto-save
// ═════════════════════════════════════════════════════════════════
function temuSyncSrcSeg() {
  const sel = $('temuSource');
  const seg = $('temuSrcSeg');
  if (!sel || !seg) return;
  const v = sel.value;
  const key = v === 'library_sel' ? 'master' : v;
  seg.querySelectorAll('button[data-src]').forEach(b => b.classList.toggle('on', b.dataset.src === key));
  const note = $('temuSrcNote');
  if (note) {
    const opt = sel.selectedOptions?.[0];
    note.textContent = v === 'library_sel' || v === 'sheet' ? (opt?.textContent || '') : '';
    note.classList.toggle('show', !!note.textContent);
  }
  const pv = $('temuSrcPxVal');
  if (pv) pv.textContent = ($('tgPx2')?.value || $('tgPx')?.value || '5');

  // U2: Show product count badges on source segment buttons
  (async () => {
    const bulkCnt  = (BulkState?.results || []).filter(x => x.status !== 'fail').length;
    const masterRows = MasterUIState.allRows || [];
    const libCnt = masterRows.length;
    const counts = { bulk: bulkCnt, master: libCnt, sheet: TemuSheetRows?.length || 0 };
    seg.querySelectorAll('button[data-src]').forEach(b => {
      const src = b.dataset.src;
      const cnt = counts[src] ?? 0;
      let badge = b.querySelector('.src-cnt');
      if (!badge) { badge = document.createElement('span'); badge.className = 'src-cnt'; b.appendChild(badge); }
      badge.textContent = cnt > 0 ? String(cnt) : '';
    });
  })();

  // U10: Live price preview next to multiplier input
  const pxInput = $('tgPx2') || $('tgPx');
  const pxPreview = $('temuPxPreview');
  if (pxPreview && pxInput) {
    const mult = parseFloat(pxInput.value) || 5;
    pxPreview.textContent = `e.g. $5.99 → $${(5.99 * mult).toFixed(2)}`;
  }
}

(function initTemuPolish() {
  // source segments drive the (hidden) original select, so all old logic keeps working
  $('temuSrcSeg')?.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-src]');
    if (!b) return;
    const sel = $('temuSource');
    if (!sel) return;
    const want = b.dataset.src;
    if (want === 'sheet') {
      const o = sel.querySelector('option[value="sheet"]');
      if (o && !o.hidden && sel.value !== 'sheet') { sel.value = 'sheet'; sel.dispatchEvent(new Event('change', { bubbles: true })); }
      else $('temuSheetFile')?.click(); // pick (or re-pick) a sheet
      return;
    }
    if (want === 'master') {
      const o = sel.querySelector('option[value="library_sel"]');
      sel.value = o && !o.hidden && TemuLibPick ? 'library_sel' : 'master';
    } else sel.value = want;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  });
  $('temuSrcPxChip')?.addEventListener('click', () => { temuSwitchTab('settings'); setTimeout(() => $('tgPx2')?.focus(), 50); });

  // compact setup bar
  $('tscChangeBtn')?.addEventListener('click', () => $('temuSetupCard')?.classList.toggle('expanded'));
  $('tscTestBtn')?.addEventListener('click', () => $('temuTestConnBtn')?.click());

  // collapsible sections (closed by default, last state remembered)
  const KEY = 'zhTemuCollapse';
  let st = {};
  const apply = () => document.querySelectorAll('.temu-coll-tgl[data-coll]').forEach(t => {
    const k = t.dataset.coll, open = !!st[k];
    t.setAttribute('aria-expanded', open ? 'true' : 'false');
    t.closest('.temu-review-ai-bar, .temu-review-img-bar')?.classList.toggle('coll-open', open);
  });
  chrome.storage.local.get([KEY]).then(r => { st = r?.[KEY] || {}; apply(); }).catch(apply);
  const toggle = (k, force) => { st[k] = force ?? !st[k]; apply(); chrome.storage.local.set({ [KEY]: st }); };
  document.addEventListener('click', (e) => {
    const t = e.target.closest('.temu-coll-tgl[data-coll]');
    if (t) { toggle(t.dataset.coll); return; }
    if (e.target.closest('#temuAiImgPromptToggleBtn') && !st.img) toggle('img', true);
  });
  document.addEventListener('keydown', (e) => {
    const t = e.target.closest?.('.temu-coll-tgl[data-coll]');
    if (t && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggle(t.dataset.coll); }
  });

  // settings auto-save (same checks as "Save All Settings")
  let saveT = null;
  const pane = document.querySelector('#temuModal [data-tpane="settings"]');
  const kick = (e) => {
    if (!e.target.matches('input, select, textarea')) return;
    clearTimeout(saveT);
    saveT = setTimeout(() => $('tgSaveBtn')?.click(), 800);
  };
  pane?.addEventListener('change', kick);
  pane?.addEventListener('input', (e) => { if (e.target.type !== 'checkbox') kick(e); });
  // U10: also update on tgPx2 input (live)
  $('tgPx2')?.addEventListener('input', () => temuSyncSrcSeg());

  // U4: Batch name character counter
  const batchInp = $('temuBatchNameInp');
  const batchCnt = $('temuBatchNameCount');
  if (batchInp && batchCnt) {
    const updateBatchCount = () => {
      const len = batchInp.value.length;
      batchCnt.textContent = `${len}/60`;
      batchCnt.classList.toggle('temu-batch-name-count-warn', len > 50);
    };
    batchInp.addEventListener('input', updateBatchCount);
    updateBatchCount();
  }

  // U5: Export + Upload button — loading state
  const autoBtn = $('temuAutoBtn');
  const autoBtnTxt = $('temuAutoBtnTxt');
  const autoBtnSpinner = $('temuAutoBtnSpinner');
  if (autoBtn) {
    const origListener = autoBtn.onclick;
    // Wrap via observer: watch disabled state to toggle spinner
    const obs = new MutationObserver(() => {
      const busy = autoBtn.disabled;
      autoBtnSpinner?.classList.toggle('hidden', !busy);
      if (autoBtnTxt) autoBtnTxt.textContent = busy ? 'Processing...' : 'Export + Upload to Temu';
    });
    obs.observe(autoBtn, { attributes: true, attributeFilter: ['disabled'] });
  }

  // U1: Setup compact — add connection status dot
  const updateSetupDot = () => {
    const compact = $('temuSetupCompact');
    if (!compact) return;
    const storeName = $('tscStore')?.textContent?.trim();
    const isConnected = storeName && storeName !== '—';
    let dot = compact.querySelector('.tsc-status-dot');
    if (!dot) {
      dot = document.createElement('span');
      dot.className = 'tsc-status-dot';
      compact.prepend(dot);
    }
    dot.className = 'tsc-status-dot ' + (isConnected ? 'tsc-dot-ok' : 'tsc-dot-off');
    dot.title = isConnected ? `Connected: ${storeName}` : 'Not connected — add store first';
  };
  // Call once + after any setup change
  setTimeout(updateSetupDot, 500);
  document.addEventListener('click', (e) => {
    if (e.target.closest('#temuTestConnBtn,#temuStoreAddBtn,#tscChangeBtn')) {
      setTimeout(updateSetupDot, 800);
    }
  });

  // U7: Review list — show skeleton while loading
  const origTemuBuildReview = window.temuBuildReviewList;
  const reviewList = $('temuReviewList');
  if (reviewList) {
    const showSkeleton = (n = 3) => {
      reviewList.classList.remove('hidden');
      reviewList.innerHTML = Array.from({length: n}, () =>
        `<div class="temu-review-skel"><div class="skel-img"></div><div class="skel-lines"><div class="skel-line skel-w80"></div><div class="skel-line skel-w50"></div></div></div>`
      ).join('');
    };
    // Expose so temuBuildReviewList can call it
    window.temuShowReviewSkeleton = showSkeleton;
  }

  // U9: Categories bulk bar — ensure count text reads "X selected"
  const origCatBulkBar = window.temuCatUpdateBulkBar;
  // temuCatUpdateBulkBar already sets temuCatBulkCount — just make bar label clearer
  const catBulkLbl = document.querySelector('#temuCatBulkBar .temu-bulk-sel-lbl');
  if (catBulkLbl) {
    const orig = window.temuCatUpdateBulkBar;
    window.temuCatUpdateBulkBar = function() {
      if (orig) orig();
      const n = TemuCatSelected?.size || 0;
      catBulkLbl.textContent = n === 1 ? '1 category selected' : `${n} categories selected`;
    };
  }

  document.addEventListener('change', (e) => { if (e.target?.id === 'tgPx2') temuSyncSrcSeg(); });
  temuSyncSrcSeg();
})();

// v9.12.0 — "↺ Default list" for Description avoid words
(function initTemuAvoidReset() {
  $('tgAvoidReset')?.addEventListener('click', () => {
    const el = $('tgAvoidWords'); if (!el) return;
    el.value = TEMU_DESC_AVOID_DEFAULT.join(', ');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
})();
