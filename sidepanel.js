// ============================================================
// ZHunter PRO v11.0.4 — Side Panel Controller
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
  if (mode === 'hide') {
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

// ── DOM Helper ───────────────────────────────────────────────
function $(id) { return document.getElementById(id); }

// ── Message Helper ───────────────────────────────────────────
function msg(payload) {
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
      'alibaba': 'Alibaba'
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
    'Shein': 'cc-shein', 'Daraz': 'cc-daraz', 'Faire': 'cc-faire', "Sam's Club": 'cc-sams'
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
  document.querySelectorAll('.btn, .btn-hunt-main, .btn-ai-magic, .quick-btn, .hdr-btn')
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
    // Helper: strip ALL Amazon size tokens (handles chained tokens like ._AC_US40_QL65_.)
    const upscaleAmazonUrl = (src) => {
      let s = src;
      // Replace every size token globally until none remain
      let prev;
      do { prev = s; s = s.replace(/\._[A-Z0-9_,]{2,}_\./, '._AC_SL1500_.'); } while (s !== prev);
      return s;
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
        // Exclude any sponsored ad scripts (like Titleist or top banner ads)
        if (t.includes('ape_Detail') || t.includes('adCreativeMetaData') || t.includes('adProgramId')) return;

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

        // Regex fallback scoped strictly to "initial" block only
        const initM = t.match(/"initial"\s*:\s*(\[\s*\{[\s\S]*?\}\s*\])/);
        const scope = initM ? initM[1] : '';
        if (scope) {
          (scope.match(/"hiRes"\s*:\s*"(https?:[^"]+)"/g) || []).forEach(m => {
            const u = (m.match(/"hiRes"\s*:\s*"(https?:[^"]+)"/) || [])[1];
            if (u) addAmazonImg(u);
          });
          (scope.match(/"large"\s*:\s*"(https?:[^"]+)"/g) || []).forEach(m => {
            const u = (m.match(/"large"\s*:\s*"(https?:[^"]+)"/) || [])[1];
            if (u) addAmazonImg(u);
          });
        }
      });

      // Strategy 2: DOM scan — only when colorImages JSON found nothing
      if (data.images.length === 0) {
        document.querySelectorAll('#landingImage, #imgBlkFront, #altImages li:not(.video-item) img, #imageBlock img:not(.video-item img), img[data-old-hires]').forEach(img => {
          if (img.closest('[id*="ape_"], [class*="ape-"], [id*="ad-"], [class*="sponsored"], [id*="sims"], [id*="similarities"], [id*="recommendations"], [id*="reviews"], #customerReviews, #va-related-videos-widget_feature_div')) return;
          let src = img.getAttribute('data-old-hires') || img.getAttribute('data-zoom-image') || img.getAttribute('data-large-image') || img.src || img.getAttribute('data-src') || '';
          const dynRaw = img.getAttribute('data-a-dynamic-image');
          if (dynRaw && dynRaw.startsWith('{')) {
            try {
              const entries = Object.entries(JSON.parse(dynRaw));
              entries.sort((a, b) => (b[1]?.[0] || 0) - (a[1]?.[0] || 0));
              if (entries[0]?.[0]) src = entries[0][0];
            } catch (_) {}
          }
          if (src && !/play[-_]?button|video[-_]?thumbnail/i.test(src)) addAmazonImg(src);
        });
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
      if (id === 'images')  scanPageImages();
      if (id === 'videos' && typeof VidTabState !== 'undefined' && !VidTabState.videos.length && !VidTabState.isScanning) {
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
  let txt = `ZHunter PRO — Product Collection\nExported: ${new Date().toLocaleString()}\n${'─'.repeat(50)}\n\n`;
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
  let md = `# ZHunter PRO — Product Collection\n\n> Exported: ${new Date().toLocaleString()}\n\n`;
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
            <button class="copy-btn" onclick="copyText('${esc(l.title || l.url)}', this)" title="Copy title">📋</button>
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
<title>ZHunter PRO — Product Catalog</title>
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
    <div class="site-title">🛍️ ZHunter PRO Catalog</div>
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
<footer class="site-footer">Generated by ZHunter PRO v${APP_VERSION}</footer>
<script>
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
      .replace(/[^a-zA-Z0-9 _-]/g, '').trim().slice(0, 30).replace(/\s+/g, '_') || 'product';
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
  const m = src.match(/\.(jpg|jpeg|png|webp|gif|avif)(?:\?|#|$)/i);
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

function openLightbox(src, title = '') {
  const modal = $('lightboxModal');
  const img = $('lightboxImg');
  const titleEl = $('lightboxTitle');
  const link = $('lightboxOpenLink');
  const imgArea = modal?.querySelector('.lightbox-img-area');
  if (!modal || !img || !src) return;

  currentLightboxSrc = src;
  img.src = src;
  if (imgArea) imgArea.classList.remove('zoomed');
  if (titleEl) titleEl.textContent = title || 'Image Preview';
  if (link) link.href = src;

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
}

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

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!$('lightboxModal')?.classList.contains('hidden')) closeLightbox();
      if (!$('shortcutsModal')?.classList.contains('hidden')) closeShortcutsModal();
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
    // Search Shortcut
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
      e.preventDefault();
      $('searchQuery')?.focus();
    }
    // Escape handler
    if (e.key === 'Escape') {
      let closedModal = false;
      ['editModal', 'confirmModal', 'imageUrlModal', 'huntPreviewModal', 'huntBulkModal', 'queueImportPreviewModal'].forEach(id => {
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

function showAiDoneModal(title, message, sub) {
  const modal = $('aiDoneModal');
  if (!modal) return;
  const tEl = $('aiDoneTitle');
  const mEl = $('aiDoneMessage');
  const sEl = $('aiDoneSub');
  if (tEl && title) tEl.innerHTML = `<span>✨</span> ${esc(title)}`;
  if (mEl && message) mEl.textContent = message;
  if (sEl && sub) sEl.textContent = sub;
  modal.style.zIndex = '999999';
  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
  setTimeout(() => $('aiDoneOk')?.focus(), 100);
}

function hideAiDoneModal() {
  const modal = $('aiDoneModal');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden', 'true');
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
  $('settingsBtn')?.addEventListener('click', () => { // v10.3.0: alag options page khatam — side panel ka Settings tab hi sab kuch hai
    document.querySelector('[data-tab="settings"]')?.click();
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

  // ── Check for pending image hunt from right-click context menu ──
  setTimeout(async () => {
    try {
      const res = await msg({ action: 'GET_PENDING_IMAGE_HUNT' });
      if (res?.success && res.pending) {
        const pending = res.pending;
        // Switch to Images tab (v10.2.3: agar Hunt tab chhupa hai to switch na karo)
        if (!(window.zhHiddenTabs || []).includes('images')) document.querySelector('[data-tab="images"]')?.click();
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
    if (message.action === 'TEMU_SESSION_UPDATED') {
      try { restoreTemuCheckSession(); } catch (_) {}
      try { loadMasterSheet(); } catch (_) {}
      toast('🚀 Product added to Temu Review & Library!', 'ok');
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
  TAB_GROUP: true,       // v9.5.0: product tabs → 'ZHunter' tab group
  ANTI_BOT_DELAY: true   // Safe human jitter delay (0.8s-2.0s) to prevent bot blocks
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
  // Anti-bot safe delay toggle
  $('bulkAntiBotToggle')?.addEventListener('change', e => {
    BulkState.ANTI_BOT_DELAY = !!e.target.checked;
    msg({ action: 'UPDATE_SETTINGS', settings: { bulkAntiBotDelay: BulkState.ANTI_BOT_DELAY } }).catch(() => {});
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
    BulkState.ANTI_BOT_DELAY = d?.settings?.bulkAntiBotDelay !== false;
    const ab = $('bulkAntiBotToggle'); if (ab) ab.checked = BulkState.ANTI_BOT_DELAY;
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
  $('spWipeAllBtn')?.addEventListener('click', () => { // v10.3.0 (pehle options page ke Danger zone mein tha)
    showConfirm('Sab kuch mita dein?', 'Library, hunt history, queue aur settings — sab delete ho jayega. Temu stores/history bhi. Pehle Backup le lein.', 'Wipe everything', async () => {
      try { await chrome.runtime.sendMessage({ action: 'CLEAR_ALL' }); await new Promise(r => chrome.storage.local.clear(r)); toast('Sab data mit gaya — panel reload ho raha hai', 'info'); setTimeout(() => location.reload(), 800); }
      catch (_) { toast('Wipe fail', 'err'); }
    });
  });
  $('masterImportBtn')?.addEventListener('click', () => $('masterImportFile')?.click());
  $('masterImportFile')?.addEventListener('change', e => {
    const file = e.target.files?.[0];
    if (file) doImport(file);
    e.target.value = '';
  });
  $('masterSelectAllBtn')?.addEventListener('click', masterSelectAll);
  $('masterSelectFailedBtn')?.addEventListener('click', () => masterSelectByStatus('fail'));
  $('masterSelectPartialBtn')?.addEventListener('click', () => masterSelectByStatus('partial'));
  $('masterDeselectAllBtn')?.addEventListener('click', masterDeselectAll);
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
    filterAndRenderMasterRows();
  });
  document.querySelectorAll('#masterFilterChips .filter-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#masterFilterChips .filter-chip').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      MasterUIState.filterPlatform = btn.dataset.filter || 'all';
      filterAndRenderMasterRows();
    });
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
  $('bulkRetryAllFailedBtn')?.addEventListener('click', bulkRetryAllFailed);

  // Delegated actions for row focus (↗) and manual retry (🔄)
  document.addEventListener('click', e => {
    const focusBtn = e.target.closest('.btn-prog-focus, .bfi-act-open');
    if (focusBtn) {
      e.preventDefault();
      e.stopPropagation();
      const tabId = focusBtn.dataset.tabId;
      const url = focusBtn.dataset.url;
      bulkFocusTab(tabId, url);
      return;
    }
    const retryBtn = e.target.closest('.btn-prog-retry, .bfi-act-retry');
    if (retryBtn) {
      e.preventDefault();
      e.stopPropagation();
      const tabId = retryBtn.dataset.tabId;
      bulkRetrySingleTab(tabId);
      return;
    }
  });

  // Queue view controls.
  $('queueAddBtn')?.addEventListener('click', onQueueAddUrl);
  $('queueAddInput')?.addEventListener('keydown', e => { if (e.key === 'Enter') onQueueAddUrl(); });
  // ── Multi-Line List Paste Box Controls ──
  const qListContainer = $('queueListContainer');
  const qListTextarea = $('queueListTextarea');
  const qListCounter = $('queueListCounter');
  const qListPlatforms = $('queueListPlatforms');
  const qListSubmitBtn = $('queueListSubmitBtn');

  function updateQueueListAnalysis() {
    if (!qListTextarea || !qListCounter) return;
    const raw = qListTextarea.value || '';
    const urlRegex = /https?:\/\/[^\s"',;<>]+/g;
    const matches = raw.match(urlRegex) || [];
    const uniqueUrls = Array.from(new Set(matches.map(u => u.split('#')[0])));
    const count = uniqueUrls.length;

    if (count === 0) {
      qListCounter.textContent = '0 links detected';
      if (qListPlatforms) qListPlatforms.innerHTML = '';
      if (qListSubmitBtn) {
        qListSubmitBtn.disabled = true;
        qListSubmitBtn.textContent = 'Add to Queue';
      }
      return;
    }

    const counts = {};
    uniqueUrls.forEach(u => {
      const plat = detectTabPlatform(u);
      const name = plat?.name || 'Other';
      counts[name] = (counts[name] || 0) + 1;
    });

    qListCounter.textContent = `${count} link${count === 1 ? '' : 's'} detected`;
    if (qListPlatforms) {
      qListPlatforms.innerHTML = Object.entries(counts)
        .map(([name, num]) => `<span class="plat-tag">${esc(name)} (${num})</span>`)
        .join('');
    }
    if (qListSubmitBtn) {
      qListSubmitBtn.disabled = false;
      qListSubmitBtn.textContent = `Add ${count} Link${count === 1 ? '' : 's'} to Queue`;
    }
  }

  $('queueBulkPasteBtn')?.addEventListener('click', () => {
    if (!qListContainer) return;
    const isHidden = qListContainer.classList.toggle('hidden');
    if (!isHidden) {
      qListTextarea?.focus();
      updateQueueListAnalysis();
    }
  });

  qListTextarea?.addEventListener('input', updateQueueListAnalysis);

  $('queueListClearBtn')?.addEventListener('click', () => {
    if (qListTextarea) qListTextarea.value = '';
    updateQueueListAnalysis();
    qListTextarea?.focus();
  });

  $('queueListCloseBtn')?.addEventListener('click', () => {
    qListContainer?.classList.add('hidden');
  });

  qListSubmitBtn?.addEventListener('click', async () => {
    const raw = qListTextarea?.value || '';
    const urlRegex = /https?:\/\/[^\s"',;<>]+/g;
    const matches = raw.match(urlRegex) || [];
    if (!matches.length) return;

    const existingUrls = new Set((QueueState.items || []).map(i => (i.url || '').toLowerCase().split('#')[0]));
    const toAdd = [];
    for (let rawUrl of matches) {
      let cleanUrl = rawUrl.split('#')[0];
      try {
        const u = new URL(cleanUrl);
        ['utm_source','utm_medium','utm_campaign','utm_content','utm_term','gclid','fbclid','msclkid','ref','ref_'].forEach(p => u.searchParams.delete(p));
        cleanUrl = u.href;
      } catch {}
      if (existingUrls.has(cleanUrl.toLowerCase())) continue;
      const plat = detectTabPlatform(cleanUrl);
      existingUrls.add(cleanUrl.toLowerCase());
      toAdd.push({
        url: cleanUrl,
        title: cleanUrl,
        platform: plat?.name || null
      });
    }

    if (!toAdd.length) {
      toast('All detected links are already in the queue', 'warn');
      return;
    }

    qListSubmitBtn.disabled = true;
    qListSubmitBtn.textContent = 'Adding…';
    try {
      const res = await msg({ action: 'ADD_BULK_QUEUE_ITEMS', items: toAdd });
      if (qListTextarea) qListTextarea.value = '';
      updateQueueListAnalysis();
      qListContainer?.classList.add('hidden');
      await loadBulkQueue();
      toast(`Added ${res?.addedCount || toAdd.length} link(s) to Queue`, 'ok');
    } catch (err) {
      toast('Failed to add links: ' + (err?.message || 'unknown error'), 'err');
      updateQueueListAnalysis();
    }
  });

  $('queueImportFileBtn')?.addEventListener('click', () => $('queueFileInput')?.click());
  $('queueFileInput')?.addEventListener('change', async e => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      if (qListTextarea) {
        qListTextarea.value = text;
        qListContainer?.classList.remove('hidden');
        updateQueueListAnalysis();
      }
      const urlRegex = /https?:\/\/[^\s"',;<>]+/g;
      const matches = text.match(urlRegex) || [];
      if (!matches.length) {
        toast('No URLs found in selected file', 'warn');
        return;
      }
      const existingUrls = new Set((QueueState.items || []).map(i => (i.url || '').toLowerCase().split('#')[0]));
      const toAdd = [];
      for (let rawUrl of matches) {
        let cleanUrl = rawUrl.split('#')[0];
        try {
          const u = new URL(cleanUrl);
          ['utm_source','utm_medium','utm_campaign','utm_content','utm_term','gclid','fbclid','msclkid','ref','ref_'].forEach(p => u.searchParams.delete(p));
          cleanUrl = u.href;
        } catch {}
        if (existingUrls.has(cleanUrl.toLowerCase())) continue;
        const plat = detectTabPlatform(cleanUrl);
        existingUrls.add(cleanUrl.toLowerCase());
        toAdd.push({
          url: cleanUrl,
          title: cleanUrl,
          platform: plat?.name || null
        });
      }
      if (!toAdd.length) {
        toast('All URLs in file are already in queue or duplicates', 'warn');
        return;
      }
      const res = await msg({ action: 'ADD_BULK_QUEUE_ITEMS', items: toAdd });
      await loadBulkQueue();
      toast(`Imported ${res?.addedCount || toAdd.length} URLs from "${file.name}" to Queue`, 'ok');
    } catch (err) {
      toast('Failed to import file: ' + (err?.message || 'unknown error'), 'err');
    }
  });
  document.querySelectorAll('#queueStoreChips .filter-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#queueStoreChips .filter-chip').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      QueueState.platformFilter = btn.dataset.store || 'all';
      renderBulkQueueList();
    });
  });
  $('queueSelectAllBtn')?.addEventListener('click', () => toggleAllQueue(true));
  $('queueDeselectAllBtn')?.addEventListener('click', () => toggleAllQueue(false));
  $('queueClearDoneBtn')?.addEventListener('click', clearHuntedQueueItems);
  $('queueClearAllBtn')?.addEventListener('click', clearAllQueue);
  $('queueRetryProblemsBtn')?.addEventListener('click', retryProblemQueueItems);
  $('queueSearchInput')?.addEventListener('input', e => { QueueState.search = e.target.value || ''; renderBulkQueueList(); });
  $('queueStatusFilter')?.addEventListener('change', e => { QueueState.statusFilter = e.target.value || 'all'; renderBulkQueueList(); });
  $('bulkQueueHuntBtn')?.addEventListener('click', startQueueHunt);
  {
    const syncConcurrency = (val) => {
      const v = Math.max(1, Math.min(10, parseInt(val, 10) || 1));
      const ps = $('queueParallelSel');
      if (ps && ps.value !== String(v)) ps.value = String(v);
      const bs = $('bulkHuntConcurrencySel');
      if (bs && bs.value !== String(v)) bs.value = String(v);
      msg({ action: 'UPDATE_SETTINGS', settings: { queueParallel: v } }).catch(() => {});
      if (State.data?.settings) State.data.settings.queueParallel = v;
    };
    const ps = $('queueParallelSel');
    const bs = $('bulkHuntConcurrencySel');
    setTimeout(() => {
      const v = State.data?.settings?.queueParallel || 1;
      if (ps) ps.value = String(v);
      if (bs) bs.value = String(v);
    }, 500);
    ps?.addEventListener('change', () => syncConcurrency(ps.value));
    bs?.addEventListener('change', () => syncConcurrency(bs.value));
  }
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
    if (m?.action === 'FLOW_IMAGE_CAPTURED') handleFlowImageCaptured(m.url);
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

const QueueState = { items: [], search: '', statusFilter: 'all', platformFilter: 'all' };

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
    let matchesStore = true;
    if (QueueState.platformFilter && QueueState.platformFilter !== 'all') {
      const p = (item.platform || '').toLowerCase();
      const u = (item.url || '').toLowerCase();
      if (QueueState.platformFilter === 'amz') matchesStore = p.includes('amazon') || u.includes('amazon.');
      else if (QueueState.platformFilter === 'wmt') matchesStore = p.includes('walmart') || u.includes('walmart.');
      else if (QueueState.platformFilter === 'tmu') matchesStore = p.includes('temu') || u.includes('temu.');
      else if (QueueState.platformFilter === 'ali') matchesStore = p.includes('aliexpress') || u.includes('aliexpress.');
      else if (QueueState.platformFilter === 'oth') matchesStore = !p.includes('amazon') && !p.includes('walmart') && !p.includes('temu') && !p.includes('aliexpress') && !u.includes('amazon.') && !u.includes('walmart.') && !u.includes('temu.') && !u.includes('aliexpress.');
    }
    const haystack = `${item.title || ''} ${item.url || ''} ${item.platform || ''}`.toLowerCase();
    return matchesStatus && matchesStore && (!query || haystack.includes(query));
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
    const isFailed = status === 'needs_retry' || status === 'error' || status === 'fail';
    const retryButton = isFailed
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
      : (status === 'error' || status === 'fail') ? '&#x26A0; Failed'
      : status === 'complete' || isHunted ? '&#x2705; Done' : '&#x23F8; Queued';
    // Hero image (first image from scraped images if available)
    const heroImg = Array.isArray(item.images) && item.images.length
      ? `<img class="pq-hero-thumb" src="${esc(typeof item.images[0]==='string'?item.images[0]:item.images[0]?.url||'')}" alt="" data-onerror="hide">`
      : '';
    row.innerHTML = `<div class="bulk-tab-checkbox"></div>${platLabel}<div class="bulk-tab-info">${heroImg}<div class="bulk-tab-platform-lbl">${esc(item.title ? trunc(item.title,50) : shortUrl)}${huntedBadge}</div><div class="bulk-tab-title">${esc(shortUrl)}</div>${stageBar}<div class="pq-stage-label">${stageLabel}</div>${item.error && isFailed ? `<div class="pq-error-msg">&#9888; ${esc(item.error)}</div>` : ''}</div>${retryButton}<button class="queue-remove-btn" data-id="${esc(item.id)}" title="Remove from queue">&#10005;</button>`;
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
  const done = QueueState.items.filter(i => i.hunted || i.status === 'complete').length;
  const failed = QueueState.items.filter(i => i.status === 'needs_retry' || i.status === 'error').length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  if (cnt) cnt.textContent = BulkState.isHunting
    ? `${done}/${total} done (${pct}%) · ${checked} selected · ${failed} failed`
    : `${total} queued · ${checked} selected${failed ? ' · ' + failed + ' failed' : ''}`;
  if (eta) {
    if (checked === 0) eta.textContent = '';
    else { const sec = checked * 8; const m = Math.floor(sec/60), s = sec%60; eta.textContent = '~' + (m ? m+'m ' : '') + s + 's'; }
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
  let count = 0;
  QueueState.items.forEach(item => {
    const status = item.status || (item.hunted ? 'complete' : 'queued');
    if (status === 'needs_retry' || status === 'error' || status === 'fail') {
      item.hunted = false;
      item.checked = true;
      item.status = 'queued';
      item.attempts = 0;
      item.error = '';
      count++;
    }
  });
  saveBulkQueue();
  renderBulkQueueList();
  toast(count > 0 ? `${count} problem item(s) re-queued for retry` : 'No failed items to retry', count > 0 ? 'ok' : 'info');
}

function onQueueAddUrl() {
  const input = $('queueAddInput');
  const raw = (input?.value || '').trim();
  if (!raw) return;
  let normUrl;
  try {
    const u = new URL(raw.split('#')[0]);
    ['utm_source','utm_medium','utm_campaign','utm_content','utm_term','gclid','fbclid','msclkid','ref','ref_'].forEach(p => u.searchParams.delete(p));
    normUrl = u.href;
  } catch { toast('Invalid URL', 'err'); return; }
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
      const meta = await new Promise(res => chrome.storage.local.get('zhunterSheetMeta', x => res(x?.zhunterSheetMeta || {}))); // v9.13.0
      const items = valid.map(r => ({ url: r.url, title: meta[r.url.toLowerCase()]?.title || r.url, platform: r.platform }));
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

  // v9.13.0 — purane ZHunter ki simple sheet (#, Tital, Soursing link, Price) → links + title/price fallback
  const SHEET_META_KEY = 'zhunterSheetMeta';

  // ── v10.2.0 Store Copy: Temu "Manage products → Download" export (Product_data_export*.xlsx) ──
  // Columns: Category, Category id, Product name, Contribution Goods, SKU, Goods ID, SKU ID, Variation, Quantity, Base price, ...
  // Contribution Goods = "<PREFIX>-<source id>" (ASIN B0… = Amazon, 8-12 digit = Walmart). Source page dobara hunt hoti hai (images/description),
  // title/base price/variation/category Temu wali sheet se override hote hain (copy: true).
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
      // v10.2.1 EXACT copy: Temu ka live product page (edited images/title/description) pehli tarjeeh; Amazon/Walmart sirf fallback
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
  window.parseTemuStoreExport = parseTemuStoreExport; // v10.2.0: temuImportSheet (Temu tab) bhi use karta hai
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
    say(`✓ Store Copy: ${list.length} products (${fileName}) — ${nt} Temu live page se (exact copy: edited images/title)${no ? `, ${no} source page se` : ''}. Queue mein add ho gaye — Bulk → "Hunt all" dabayen. Base price / variation / category Temu sheet se.`, 'ok');
    try { renderBulkPastePreview(parsePastedLinks()); } catch (_) {}
    try { document.querySelector('[data-tab="bulk"]')?.click(); } catch (_) {}
    // v10.2.2: seedha queue mein daal do (paste modal band hai) — user ko sirf "Hunt all" dabana hai
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
      { const sc = parseTemuStoreExport(rows); if (sc) { if (!sc.length) { say('✗ Temu export mein koi product nahi (Contribution Goods khali?)', 'bad'); return; } await importStoreCopy(sc, file.name, say); return; } } // v10.2.0
      // link column = jis column mein sab se zyada http links; header row = pehli row jis mein link na ho
      const ncol = Math.max(...rows.map(r => r.length));
      const cnt = Array(ncol).fill(0);
      rows.forEach(r => r.forEach((c, i) => { if (/^https?:\/\//i.test(c)) cnt[i]++; }));
      const urlCol = cnt.indexOf(Math.max(...cnt));
      if (cnt[urlCol] === 0) { say('✗ Sheet mein koi link column nahi mila', 'bad'); return; }
      const headerIdx = rows.findIndex(r => r.some(c => /^https?:\/\//i.test(c))) - 1;
      const header = headerIdx >= 0 ? rows[headerIdx].map(c => c.toLowerCase()) : [];
      const findCol = (re) => header.findIndex(c => re.test(c));
      let titleCol = findCol(/tit|name|product/), priceCol = findCol(/price|cost|\$/);
      if (titleCol < 0) { // sab se lambi text column jo url nahi
        const len = Array(ncol).fill(0); rows.forEach(r => r.forEach((c, i) => { if (i !== urlCol && !/^https?:/i.test(c) && !/^[\d.,$]+$/.test(c)) len[i] += c.length; })); titleCol = len.indexOf(Math.max(...len)); if (len[titleCol] === 0) titleCol = -1; }
      if (priceCol < 0) { const num = Array(ncol).fill(0); rows.forEach(r => r.forEach((c, i) => { if (i !== urlCol && /^\$?\d+(\.\d{1,2})?$/.test(c) && parseFloat(c) > 0 && parseFloat(c) < 100000 && !/^\d{1,4}$/.test(c)) num[i]++; })); priceCol = num.indexOf(Math.max(...num)); if (num[priceCol] === 0) priceCol = -1; }
      const meta = {}; const links = [];
      rows.forEach(r => { const u = r[urlCol]; if (!/^https?:\/\//i.test(u)) return; let key; try { key = new URL(u).href.split('#')[0].toLowerCase(); } catch (_) { return; } links.push(u.split('#')[0]);
        meta[key] = { title: titleCol >= 0 ? r[titleCol] : '', price: priceCol >= 0 ? r[priceCol].replace(/[^\d.]/g, '') : '' }; });
      const old = await new Promise(res => chrome.storage.local.get(SHEET_META_KEY, x => res(x?.[SHEET_META_KEY] || {})));
      const merged = { ...old, ...meta }; const keys = Object.keys(merged); if (keys.length > 5000) keys.slice(0, keys.length - 5000).forEach(k => delete merged[k]);
      await new Promise(res => chrome.storage.local.set({ [SHEET_META_KEY]: merged }, res));
      const ta = $('bulkPasteTextarea'); if (ta) { ta.value = (ta.value.trim() ? ta.value.trim() + '\n' : '') + links.join('\n'); ta.dispatchEvent(new Event('input', { bubbles: true })); }
      say(`✓ ${links.length} links (${file.name})${titleCol >= 0 ? ' · title' : ''}${priceCol >= 0 ? ' · price fallback' : ''}`, 'ok');
      renderBulkPastePreview(parsePastedLinks());
    } catch (e) { say('✗ ' + (e?.message || e), 'bad'); }
  }
  $('bulkPasteImportBtn')?.addEventListener('click', () => $('bulkPasteFile')?.click());
  $('bulkPasteFile')?.addEventListener('change', e => { const f = e.target.files?.[0]; if (f) importLinksSheet(f); e.target.value = ''; });

  // Wire up listeners after DOM ready
  document.addEventListener('DOMContentLoaded', () => {
    $('bulkPasteClose')?.addEventListener('click', closeBulkPasteModal);
    $('bulkPasteCancelBtn')?.addEventListener('click', closeBulkPasteModal);
    $('bulkPastePreviewBtn')?.addEventListener('click', () => renderBulkPastePreview(parsePastedLinks()));
    $('bulkPasteAddBtn')?.addEventListener('click', addBulkPastedLinks);
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

// v9.13.2 — tab band karne se pehle: agar ye window ka aakhri tab hai to pehle ek khali tab kholo,
// warna Chrome poori window (profile) band kar deta hai — side panel bhi chala jata tha.
async function safeRemoveTab(tabId) {
  try {
    const tab = await new Promise(r => chrome.tabs.get(tabId, t => r(chrome.runtime.lastError ? null : t)));
    if (!tab) return;
    const inWin = await chrome.tabs.query({ windowId: tab.windowId });
    if (inWin.length <= 1) { try { await chrome.tabs.create({ windowId: tab.windowId, url: 'chrome://newtab', active: true }); } catch (_) {} }
    await chrome.tabs.remove(tabId);
  } catch (_) { try { chrome.tabs.remove(tabId, () => { void chrome.runtime.lastError; }); } catch (_) {} }
}
async function closeQueueWorkerTab() {
  const id = queueWorkerTabId;
  queueWorkerTabId = null;
  if (!id) return;
  await safeRemoveTab(id);
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

// v9.13.0 — sheet import ka title/price fallback (url → {title, price})
let _sheetMetaCache = null;
async function sheetMetaFor(url) {
  try {
    if (!_sheetMetaCache) _sheetMetaCache = await new Promise(res => chrome.storage.local.get('zhunterSheetMeta', x => res(x?.zhunterSheetMeta || {})));
    let key; try { key = new URL(url).href.split('#')[0].toLowerCase(); } catch (_) { return null; }
    return _sheetMetaCache[key] || null;
  } catch (_) { return null; }
}
async function scrapeQueueItem(queueItem, workerTabId) {
  const fakeId = queueItem.id;
  setBulkRowStatus(fakeId, 'active');
  if (BulkState.isCancelled) { setBulkRowStatus(fakeId, 'fail'); return; }

  let scraped = null;
  let errorCode = '';
  try {
    await chrome.tabs.update(workerTabId, { url: queueItem.url, active: false });
    setBulkRowMeta(fakeId, 'Loading in background…');
    const ready = await waitForQueueTabReady(workerTabId, 60000);
    if (!ready) throw new Error(BulkState.isCancelled ? 'cancelled' : 'page_timeout');

    setBulkRowMeta(fakeId, 'Injecting…');
    try { await chrome.scripting.executeScript({ target: { tabId: workerTabId }, files: ['lib/jszip.min.js', 'content.js'] }); }
    catch (_) { /* The script may already be present after navigation. */ }
    await sleep(500);

    setBulkRowMeta(fakeId, 'Scraping…');
    scraped = await sendQueueScrape(workerTabId);
    if (!scraped) throw new Error('no_response');
  } catch (error) {
    errorCode = error?.message || 'queue_worker_error';
  }

  const status = !scraped
    ? 'fail'
    : (!scraped.title && (!scraped.images || !scraped.images.length) && !scraped.price) ? 'partial' : 'ok';

  // Smart auto-retry on failure (1 attempt)
  const shouldRetryQueue = State?.data?.settings?.bulkAutoRetry !== false;
  if (shouldRetryQueue && status === 'fail' && !queueItem._retried && !BulkState.isCancelled && errorCode !== 'cancelled') {
    queueItem._retried = true;
    setBulkRowMeta(fakeId, 'Retrying (1/1)…');
    await sleep(1500);
    return await scrapeQueueItem(queueItem, workerTabId);
  }

  const resultItem = {
    tabId: fakeId,
    url: scraped?.url || queueItem.url,
    title: scraped?.title || queueItem.title || queueItem.url,
    price: scraped?.price || (await sheetMetaFor(queueItem.url))?.price || '', // v9.13.0 sheet fallback
    copy: (await sheetMetaFor(queueItem.url))?.copy ? (await sheetMetaFor(queueItem.url)) : null, // v10.2.0 Store Copy overrides
    platform: typeof queueItem.platform === 'string' ? queueItem.platform : (queueItem.platform?.name || 'Other'),
    images: scraped?.images || [], imagesBase64: [],
    videos: scraped?.videos || [], variants: scraped?.variants || [],
    description: scraped?.description || '',
    brand: scraped?.brand || '', color: scraped?.color || '', weight: scraped?.weight || '', dimL: scraped?.dimL || '', dimW: scraped?.dimW || '', dimH: scraped?.dimH || '', bullets: Array.isArray(scraped?.bullets) ? scraped.bullets : [],
    status,
    error: status === 'fail' ? (errorCode || 'no_response') : '',
    scrapedAt: new Date().toISOString()
  };
  if (resultItem.copy) { // v10.2.0: Temu sheet ka title / price / variation / category jeetta hai
    const cp = resultItem.copy; let t = cp.title || resultItem.title;
    const extra = String($('bulkCopyRemoveWords')?.value || '').split(',').map(w => w.trim()).filter(Boolean);
    extra.forEach(w => { t = t.replace(new RegExp('\\b' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'gi'), ' '); });
    resultItem.title = t.replace(/\s+/g, ' ').trim();
    if (cp.price) resultItem.temuBase = cp.price;
    if (cp.color) resultItem.copyColor = cp.color;
    if (cp.cat) resultItem.copyCat = cp.cat;
    resultItem.copyGoodsId = cp.goodsId || '';
    if (status === 'fail' && resultItem.title) { resultItem.status = 'partial'; resultItem.error = ''; } // title/price to hai — images nahi
  }
  BulkState.results.push(resultItem);
  if (resultItem.status !== 'fail') BulkState.pendingFlush.push(resultItem);

  const qi = QueueState.items.find(i => i.id === fakeId);
  if (qi) {
    qi.hunted = resultItem.status !== 'fail';
    qi.status = resultItem.status === 'fail' ? 'needs_retry' : 'complete';
    qi.error = resultItem.error;
    qi.attempts = Number(qi.attempts || 0) + 1;
  }
  setBulkRowStatus(fakeId, resultItem.status, { images: Array.isArray(resultItem.images) ? resultItem.images.length : 0, error: resultItem.error });
  updateBulkProgressBar();
}

async function processQueueSequential(items) {
  // N parallel worker tabs (Default 1 for slow net safe) — har worker apna tab, shared queue
  const n = Math.max(1, Math.min(10, parseInt($('queueParallelSel')?.value || $('bulkHuntConcurrencySel')?.value || State.data?.settings?.queueParallel || 1, 10) || 1));
  _sheetMetaCache = null;
  if (n === 1) {
    let worker = null;
    try {
      worker = await ensureQueueWorkerTab();
      for (const item of items) {
        while (BulkState.isPaused && !BulkState.isCancelled) await sleep(300);
        if (BulkState.isCancelled) break;
        worker = await ensureQueueWorkerTab();
        await scrapeQueueItem(item, worker.id);
        if (!BulkState.isCancelled) await sleep(BulkState.ANTI_BOT_DELAY ? Math.floor(Math.random() * 1200) + 800 : 500);
      }
    } finally { await closeQueueWorkerTab(); }
    return;
  }
  const workers = [];
  let idx = 0;
  const run = async (wi) => {
    let tab = null;
    try {
      tab = await chrome.tabs.create({ url: 'about:blank', active: false }); workers.push(tab.id);
      await sleep(wi * 400); // stagger — sab tabs ek saath Walmart par na jayen
      while (!BulkState.isCancelled) {
        while (BulkState.isPaused && !BulkState.isCancelled) await sleep(300);
        if (BulkState.isCancelled) break;
        const item = items[idx++]; if (!item) break;
        const alive = await new Promise(res => chrome.tabs.get(tab.id, t => res(!chrome.runtime.lastError && !!t)));
        if (!alive) { tab = await chrome.tabs.create({ url: 'about:blank', active: false }); workers.push(tab.id); }
        await scrapeQueueItem(item, tab.id);
        if (!BulkState.isCancelled) await sleep(BulkState.ANTI_BOT_DELAY ? Math.floor(Math.random() * 1200) + 800 : 300);
      }
    } catch (_) {}
  };
  try { await Promise.all(Array.from({ length: Math.min(n, items.length) }, (_, i) => run(i))); }
  finally { for (const id of workers) { await safeRemoveTab(id); } }
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

// Helper: Determine if Fast Mode is active (DOM toggle priority, no undefined fallback bug)
function isBulkFastMode() {
  const el = $('bulkFastToggle');
  if (el) return !!el.checked;
  return Boolean(State?.data?.settings?.bulkSkipImageDownload);
}

async function startQueueHunt() {
  if (BulkState.isHunting) return;
  const toHunt = QueueState.items.filter(i => i.checked && !i.hunted);
  if (toHunt.length === 0) { toast('No items selected in queue', 'warn'); return; }
  BulkState.isHunting = true; BulkState.isPaused = false; BulkState.isCancelled = false;
  { const cb = $('bulkCancelBtn'); if (cb) { cb.disabled = false; cb.textContent = 'Cancel'; } const pb = $('bulkPauseBtn'); if (pb) { pb.disabled = false; pb.textContent = 'Pause'; } }
  BulkState.results = []; BulkState.pendingFlush = []; BulkState._flushActive = false;
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
    updateBulkProgressTitle('Hunting products', `Processing ${toHunt.length} queued links…`);
    await processQueueSequential(toHunt);

    // ── Auto-Retry Pass for Timed-out / Failed links (Zero Missed Products) ──
    if (!BulkState.isCancelled) {
      const failedItems = toHunt.filter(item => {
        const res = BulkState.results.find(r => r.tabId === item.id);
        return res && (res.status === 'fail' || res.status === 'error');
      });

      if (failedItems.length > 0) {
        updateBulkProgressTitle('Auto-Retrying failed links', `Retrying ${failedItems.length} timed-out links with safety buffer…`);
        toast(`Auto-retrying ${failedItems.length} timed-out link${failedItems.length > 1 ? 's' : ''}…`, 'ok');
        await sleep(1500);

        const failedIds = new Set(failedItems.map(i => i.id));
        BulkState.results = BulkState.results.filter(r => !failedIds.has(r.tabId));

        failedItems.forEach(item => {
          setBulkRowStatus(item.id, 'active');
          setBulkRowMeta(item.id, 'Auto-retrying…');
        });

        BulkState._isRetryPass = true;
        try {
          await processQueueSequential(failedItems);
        } finally {
          BulkState._isRetryPass = false;
        }
      }
    }

    if (!BulkState.isCancelled && !isBulkFastMode()) await imageDownloadPhase();
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

// v9.16.0 — open tabs list: har product tab se image + price (content PEEK), cache on tab object
const _peekInflight = new Set();
function bulkPeekTab(t, row) {
  if (!t || !row || !Number.isInteger(t.tabId) || _peekInflight.has(t.tabId)) return;
  const apply = (pk) => {
    if (!row.isConnected) return;
    if (pk?.image) { const w = row.querySelector('.row-thumb-wrap'); if (w) { w.innerHTML = `<img class="row-thumb-img" src="${esc(pk.image)}" alt="" onerror="this.parentElement.classList.add('thumb-err')"><span class="row-thumb-fallback" style="display:none">${esc((t.platform?.name || 'P').slice(0, 2))}</span>`; w.dataset.img = pk.image; } }
    if (pk?.price) { const ti = row.querySelector('.bulk-tab-title'); if (ti && !row.querySelector('.bulk-tab-price')) { const pr = document.createElement('span'); pr.className = 'bulk-tab-price'; pr.textContent = pk.price; ti.after(pr); } }
  };
  if (t.peek) { apply(t.peek); return; }
  _peekInflight.add(t.tabId);
  let done = false;
  const timer = setTimeout(() => { if (!done) { done = true; _peekInflight.delete(t.tabId); } }, 4000);
  try {
    chrome.tabs.sendMessage(t.tabId, { action: 'PEEK' }, r => {
      void chrome.runtime.lastError; if (done) return; done = true; clearTimeout(timer); _peekInflight.delete(t.tabId);
      if (r && (r.image || r.price)) { t.peek = { image: r.image || '', price: r.price || '' }; apply(t.peek); }
    });
  } catch (_) { _peekInflight.delete(t.tabId); }
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

  const frag = document.createDocumentFragment();
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
      ? `<img class="row-thumb-img row-fav-img" src="${esc(t.favIconUrl)}" alt="${platName}" onerror="this.style.display='none';this.nextElementSibling.style.display='block';"><span class="row-thumb-fallback" style="display:none;">${esc(platName.slice(0, 2))}</span>`
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
      const img = row.querySelector('.row-thumb-wrap')?.dataset?.img || t.favIconUrl;
      if (img) { e.stopPropagation(); openLightbox(img, `${platName} — ${t.title || 'Store'}`); }
    });
    if (isProduct) bulkPeekTab(t, row); // v9.16.0 thumbnail + price

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

    frag.appendChild(row);
  });
  list.replaceChildren(frag);
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
  const list = $('bulkTabsList');
  if (list) {
    const rows = list.querySelectorAll('.bulk-tab-row');
    if (rows.length === BulkState.tabs.length && rows.length > 0) {
      rows.forEach(r => {
        const tid = Number(r.dataset.tabId);
        r.classList.toggle('checked', BulkState.selectedIds.has(tid));
      });
      updateBulkSummary();
      return;
    }
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

  try {
    updateBulkProgressTitle('Hunting products', `Processing ${selectedTabs.length} tabs…`);
    await processSmartQueue(selectedTabs); // Phase 1: scrape all tabs

    // ── Auto-Retry Pass for Timed-out / Failed open tabs ──
    if (!BulkState.isCancelled) {
      const failedTabs = selectedTabs.filter(t => {
        const res = BulkState.results.find(r => r.tabId === t.tabId);
        return res && (res.status === 'fail' || res.status === 'error');
      });
      if (failedTabs.length > 0) {
        updateBulkProgressTitle('Auto-Retrying failed tabs', `Retrying ${failedTabs.length} timed-out tabs…`);
        toast(`Auto-retrying ${failedTabs.length} timed-out tab${failedTabs.length > 1 ? 's' : ''}…`, 'ok');
        await sleep(1500);
        const failedTabIds = new Set(failedTabs.map(t => t.tabId));
        BulkState.results = BulkState.results.filter(r => !failedTabIds.has(r.tabId));
        failedTabs.forEach(t => {
          t._started = false;
          t._done = false;
          setBulkRowStatus(t.tabId, 'active');
          setBulkRowMeta(t.tabId, 'Auto-retrying…');
        });
        await processSmartQueue(failedTabs);
      }
    }

    // Phase 2: download images after all tabs scraped (skip if Fast Mode is ON)
    if (!BulkState.isCancelled && !isBulkFastMode()) {
      await imageDownloadPhase();
    }
  } catch (e) {
    toast('Bulk hunt error: ' + (e?.message || 'unknown'), 'err');
  }

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
    if (Number.isInteger(t.tabId)) live = await new Promise(r => chrome.tabs.get(t.tabId, x => r(chrome.runtime.lastError ? null : x))); // v9.13.4: queue ke fake ids (q_…) skip
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

function getHuntSpeedMode() {
  return localStorage.getItem('zh_hunt_speed') || 'safe';
}

function setHuntSpeedMode(mode) {
  localStorage.setItem('zh_hunt_speed', mode);
  document.querySelectorAll('.zh-speed-pill').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.speed === mode);
  });
  const desc = $('zhSpeedDesc');
  if (desc) {
    if (mode === 'safe') desc.textContent = '🐢 Safe (1 Tab) — Slow net safe, zero freeze';
    else if (mode === 'balanced') desc.textContent = '⚡ Balanced (2 Tabs) — Normal net';
    else desc.textContent = '🚀 Turbo (3 Tabs) — Fast broadband';
  }
  const concur = mode === 'turbo' ? 3 : mode === 'balanced' ? 2 : 1;
  const bs = $('bulkHuntConcurrencySel');
  if (bs && bs.value !== String(concur)) bs.value = String(concur);
  const ps = $('queueParallelSel');
  if (ps && ps.value !== String(concur)) ps.value = String(concur);
  if (typeof msg === 'function') msg({ action: 'UPDATE_SETTINGS', settings: { queueParallel: concur } }).catch(() => {});
  if (window.State?.data?.settings) window.State.data.settings.queueParallel = concur;
}

async function processSmartQueue(tabs) {
  const activeDomains = {};
  const running = new Set();
  
  const userConcurrency = parseInt($('bulkHuntConcurrencySel')?.value || $('queueParallelSel')?.value || State.data?.settings?.queueParallel, 10);
  let MAX_GLOBAL = userConcurrency >= 1 ? userConcurrency : 1;
  let MAX_PER_DOMAIN = MAX_GLOBAL > 1 ? 2 : 1;

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
        const isStrictDomain = /walmart\.com|samsclub\.com|amazon\./i.test(host);
        const maxForHost = isStrictDomain ? 1 : MAX_PER_DOMAIN;
        if ((activeDomains[host] || 0) >= maxForHost) continue;

        const tab = tabs[i];
        tab._started = true;
        activeDomains[host] = (activeDomains[host] || 0) + 1;
        startedAny = true;

        const p = (async () => {
          try {
            if (BulkState.ANTI_BOT_DELAY) {
              await sleep(Math.floor(Math.random() * 200) + 250);
            }
            await scrapeOneTab(tab);
            tab._done = true;

            // ── Zero-Missed Tabs & RAM Management ──
            const finalRes = BulkState.results.find(r => r.tabId === tab.tabId);
            const isSuccess = finalRes && (finalRes.status === 'ok' || (finalRes.status === 'partial' && finalRes.title));

            if (isSuccess) {
              // Succeeded: free RAM immediately if auto-close is enabled
              if (BulkState.AUTO_CLOSE_TABS && !BulkState.isCancelled) {
                safeRemoveTab(tab.tabId);
              }
            } else {
              // Failed / Problem: NEVER close tab! Bring to front so user can see it
              try {
                await chrome.tabs.update(tab.tabId, { active: true });
              } catch (_) {}
              setBulkRowMeta(tab.tabId, '⚠️ Kept open for review');
            }
          } finally {
            tab._done = true;
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

  // ── Live Active Tab Focus: Bring hunted tab to foreground ──
  if (tabInfo.tabId && Number.isInteger(tabInfo.tabId)) {
    try {
      await chrome.tabs.update(tabInfo.tabId, { active: true });
    } catch (_) {}
  }

  // Highlight active row & auto-scroll into view
  try {
    document.querySelectorAll('.bulk-prog-row.active-hunt').forEach(r => r.classList.remove('active-hunt'));
    const curRow = document.querySelector(`.bulk-prog-row[data-tab-id="${tabInfo.tabId}"]`);
    if (curRow) {
      curRow.classList.add('active-hunt');
      curRow.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  } catch (_) {}

  let scraped = null;
  let error = null;

  // Early exit if cancelled
  if (BulkState.isCancelled) { setBulkRowStatus(tabInfo.tabId, 'fail'); return; }

  try {
    // ── Wait for tab to load / Wake discarded tabs ──
    let tabDetails = await new Promise(resolve => chrome.tabs.get(tabInfo.tabId, t => resolve(chrome.runtime.lastError ? null : t)));
    if (tabDetails) {
      if (tabDetails.discarded) {
        setBulkRowMeta(tabInfo.tabId, 'Waking tab…');
        chrome.tabs.reload(tabInfo.tabId, {}, () => { void chrome.runtime.lastError; });
      }
      if (tabDetails.discarded || tabDetails.status !== 'complete') {
        for (let i = 0; i < 10; i++) { // 10 × 200ms = 2s max wait
          if (BulkState.isCancelled) { setBulkRowStatus(tabInfo.tabId, 'fail', { error: 'cancelled' }); return; }
          tabDetails = await new Promise(resolve => chrome.tabs.get(tabInfo.tabId, t => resolve(chrome.runtime.lastError ? null : t)));
          if (!tabDetails || tabDetails.status === 'complete') break;
          await sleep(200);
        }
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
          files: ['lib/jszip.min.js', 'content.js']
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
          chrome.tabs.sendMessage(tabInfo.tabId, { action: 'SCRAPE_PAGE', tabIndex: tabInfo.originalIndex, totalTabs: BulkState.huntTotal }, (res) => {
            clearTimeout(t);
            if (chrome.runtime.lastError) { finish(null); return; }
            if (!res?.success || !res?.data) { finish(null); return; }
            finish(res.data);
          });
        } catch (e) { finish(null); }
      });

      // ── AUTO-REFRESH on no-response (Quick 3s max, no 45s hanging) ──
      if (!scraped && !BulkState.isCancelled) {
        setBulkRowMeta(tabInfo.tabId, 'Not responding — waking…');

        // Bring to front so Chrome allocates 100% CPU priority
        try { await chrome.tabs.update(tabInfo.tabId, { active: true }); } catch (_) {}

        // Quick reload tab and wait up to 3 seconds max
        try { await new Promise(r => chrome.tabs.reload(tabInfo.tabId, {}, r)); } catch (_) {}
        let reloadDetails = null;
        for (let i = 0; i < 12; i++) { // 12 × 250ms = 3s max wait
          if (BulkState.isCancelled) break;
          reloadDetails = await new Promise(r => chrome.tabs.get(tabInfo.tabId, t => r(chrome.runtime.lastError ? null : t)));
          if (!reloadDetails || reloadDetails.status === 'complete') break;
          await sleep(250);
        }
        if (reloadDetails) await sleep(200);

        if (!BulkState.isCancelled) {
          setBulkRowMeta(tabInfo.tabId, 'Retrying…');

          try {
            await chrome.scripting.executeScript({ target: { tabId: tabInfo.tabId }, files: ['lib/jszip.min.js', 'content.js'] });
            await sleep(200);
          } catch (_) {}

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
              await sleep(200);
            } catch (_) {}
          }

          scraped = await new Promise((resolve) => {
            let done = false;
            let finish = (v) => { if (!done) { done = true; resolve(v); } };
            let cancelCheck = setInterval(() => { if (BulkState.isCancelled) finish(null); }, 200);
            const t = setTimeout(() => finish(null), 3000);
            const origFinish = finish;
            finish = (v) => { clearTimeout(t); clearInterval(cancelCheck); origFinish(v); };
            try {
              chrome.tabs.sendMessage(tabInfo.tabId, { action: 'SCRAPE_PAGE', tabIndex: tabInfo.originalIndex, totalTabs: BulkState.huntTotal }, (res) => {
                clearTimeout(t);
                if (chrome.runtime.lastError || !res?.success || !res?.data) { finish(null); return; }
                finish(res.data);
              });
            } catch (e) { finish(null); }
          });

          if (!scraped) {
            // Problem tab — kept open in Chrome so user can see it!
            setBulkRowMeta(tabInfo.tabId, '⚠️ Problem tab (kept open)');
            error = 'needs_attention';
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

  // Determine final status
  let status;
  if (!scraped) {
    status = 'fail';
  } else if (
    scraped.botWarning ||
    /robot check|captcha|blocked|access denied|perimeterx|security check/i.test(scraped.title || '') ||
    /validateCaptcha/i.test(scraped.url || '')
  ) {
    error = scraped.botWarning || 'captcha_blocked';
    status = 'fail';
    scraped = null;
  } else if (!scraped.title || (!scraped.price && (!scraped.images || !scraped.images.length))) {
    status = 'partial';
  } else {
    status = 'ok';
  }

  // Smart auto-retry on failure (1 attempt with tab reload)
  const shouldRetryTab = State?.data?.settings?.bulkAutoRetry !== false;
  if (shouldRetryTab && status === 'fail' && !tabInfo._retried && !BulkState.isCancelled && error !== 'cancelled') {
    tabInfo._retried = true;
    setBulkRowMeta(tabInfo.tabId, 'Retrying (1/1)…');
    await sleep(1500);
    try {
      chrome.tabs.reload(tabInfo.tabId, {}, () => { void chrome.runtime.lastError; });
      await sleep(1500);
    } catch (_) {}
    return await scrapeOneTab(tabInfo);
  }

  // PERF: Image download deferred to imageDownloadPhase() after all tabs scraped.
  const imagesBase64 = [];

  const result = {
    tabId:    tabInfo.tabId,
    url:      tabInfo.url,
    title:    scraped?.title || '',
    price:    scraped?.price || '',
    platform: tabInfo.platform?.name || 'Other',
    images:   scraped?.images || [],
    imagesBase64,
    videos:   scraped?.videos || [],
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
    platform:    result.platform,
    status:      result.status,
    error:       result.error,
    images:      result.images || [],
    imagesBase64: [],
    videos:      result.videos || [],
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

// ── Phase 2: Image Download (runs after all tabs scraped) ─────────────────
async function imageDownloadPhase() {
  const pending = BulkState.results.filter(r => r.images?.length > 0 && r.status !== 'fail');
  if (!pending.length) return;
  // Fast mode check: skip downloading base64 if Fast Mode is active
  if (isBulkFastMode()) {
    pending.forEach(r => { r.imagesBase64 = []; r.imgDlSkipped = true; setBulkRowMeta(r.tabId, `${r.images.length} img URLs`); setBulkRowStatus(r.tabId, r.status, { images: r.images.length, error: r.error }); });
    return;
  }

  updateBulkProgressTitle('Downloading images', `${pending.length} products — saving pictures`);

  let cursor = 0;
  const speedMode = getHuntSpeedMode();
  let CONCUR = 2;
  if (speedMode === 'safe') CONCUR = 1; // 1 batch at a time for slow internet!
  else if (speedMode === 'turbo') CONCUR = 4; // fast internet

  const workers = Array.from({ length: CONCUR }, async () => {
    while (cursor < pending.length && !BulkState.isCancelled) {
      const r = pending[cursor++];
      if (!r) break;
      try {
        const urls = (r.images || []).slice(0, 7);
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
      // v9.8.1: image DOWNLOAD (base64 for ZIP) fail hone se product "partial" nahi — title/price/image URLs sab mil gaye hain,
      // Temu ko URLs hi chahiye. Sirf note rakho (imgDlFailed) aur row par likho.
      if (r.status === 'ok' && r.images?.length > 0 && imgCount === 0) {
        r.imgDlFailed = true;
        setBulkRowMeta(r.tabId, `${r.images.length} img URLs · download ✗`);
        setBulkRowStatus(r.tabId, 'ok', { images: r.images.length, error: '' });
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
    tabs.forEach(t => {
      const row = document.createElement('div');
      row.className = 'bulk-prog-row waiting';
      row.dataset.tabId = t.tabId;
      const platName = t.platform?.name || 'Other';
      const platTag  = t.platform?.tag ? t.platform.tag.toLowerCase() : 'oth';
      row.innerHTML = `
        <span class="bulk-prog-status">⌛</span>
        <span class="plat-pill plat-pill-sm" data-plat="${esc(platTag)}">${esc(platName)}</span>
        <span class="bulk-prog-name" title="${esc(t.title || t.url)}">${esc(trunc(t.title, 46))}</span>
        <span class="bulk-prog-meta"></span>
        <div class="bulk-prog-actions">
          <button type="button" class="btn-prog-act btn-prog-focus" data-tab-id="${t.tabId}" data-url="${esc(t.url)}" title="Open & Focus Tab in Chrome">↗</button>
          <button type="button" class="btn-prog-act btn-prog-retry" data-tab-id="${t.tabId}" title="Retry this tab">🔄</button>
        </div>`;
      list.appendChild(row);
    });
  }

  $('bulkResultSummary')?.classList.add('hidden');
  $('bpHero')?.classList.remove('hidden');
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
  const r = $('bulkRingFill'), p = $('bulkRingPct'), headWrap = $('bulkRingHeadWrap'), head = $('bulkRingHead');
  const liveStatus = $('bpLiveStatus');
  const C = 257.6;
  const clamped = Math.max(0, Math.min(100, pct || 0));
  if (r) {
    r.style.strokeDashoffset = String(C - (C * clamped / 100));
    r.classList.toggle('done', state === 'done' || clamped >= 100);
    r.classList.toggle('warn', state === 'warn');
  }
  if (headWrap) {
    const angle = -90 + (clamped * 3.6);
    headWrap.setAttribute('transform', `rotate(${angle} 48 48)`);
    if (head) {
      head.style.opacity = clamped <= 0 ? '0' : '1';
      head.classList.toggle('done', state === 'done' || clamped >= 100);
    }
  }
  if (p) p.textContent = Math.round(clamped) + '%';
  if (liveStatus) {
    if (state === 'done' || clamped >= 100) {
      liveStatus.textContent = 'HUNT COMPLETE';
      liveStatus.style.color = '#34D399';
    } else if (state === 'warn') {
      liveStatus.textContent = 'ATTENTION REQUIRED';
      liveStatus.style.color = '#F59E0B';
    } else {
      liveStatus.textContent = BulkState.isPaused ? 'PAUSED' : 'ACTIVE HUNTING';
      liveStatus.style.color = '#00E5FF';
    }
  }
}

function closeBulkProgressModal() {
  $('bulkProgressModal')?.classList.add('hidden');
  // Free memory: release heavy base64 strings when modal is closed
  if (!BulkState.isHunting && Array.isArray(BulkState.results)) {
    BulkState.results.forEach(r => {
      if (r.imagesBase64 && r.imagesBase64.length) {
        r.imageCount = r.imagesBase64.length;
        r.imagesBase64 = null;
      }
    });
  }
}

function updateBulkProgressTitle(text, sub) {
  const el = $('bulkProgressTitle');
  if (el) el.textContent = String(text || '').replace(/^[^\w]+\s*/, '');   // strip legacy emoji prefixes
  if (sub !== undefined) { const se = $('bulkProgressSub'); if (se) se.textContent = sub; }
}

function setBulkRowStatus(tabId, status, opts = {}) {
  const row = document.querySelector(`.bulk-prog-row[data-tab-id="${tabId}"]`);
  if (!row) return;
  row.classList.remove('waiting', 'active', 'ok', 'partial', 'fail');
  row.classList.add(status);
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
    else if (status === 'partial') metaEl.textContent = 'partial';
    else if (status === 'fail') {
      const errMap = {
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
  const pct     = total ? Math.round((done / total) * 100) : 0;
  const fill    = $('bulkProgFill');
  if (fill) { fill.style.width = pct + '%'; fill.style.background = ''; }
  bpSetRing(pct, (failed > 0 && done === total) ? 'warn' : '');
  { const d = $('bpDone'), t = $('bpTotal'); if (d) d.textContent = String(done); if (t) t.textContent = String(total); }
  { const pt = $('bulkProgText'); if (pt) pt.textContent = failed ? `products done · ${failed} failed` : 'products done'; }

  // Live stats
  const elapsedSec = BulkState.huntStartTime ? (Date.now() - BulkState.huntStartTime) / 1000 : 0;
  const speed      = elapsedSec > 1 ? (done / elapsedSec).toFixed(1) : '—';
  const totalImgs  = BulkState.results.reduce((s, r) => s + (Array.isArray(r.images) ? r.images.length : (r.imageCount || 0)), 0);
  const totalVids  = BulkState.results.reduce((s, r) => s + (Array.isArray(r.videos) ? r.videos.length : (r.videoCount || 0)), 0);
  const remaining  = total - done;
  let etaStr = '';
  if (elapsedSec > 2 && done > 0 && remaining > 0) {
    const secLeft = Math.ceil(remaining * (elapsedSec / done));
    const m = Math.floor(secLeft / 60), sN = secLeft % 60;
    etaStr = m > 0 ? `${m}m ${sN}s` : `${sN}s`;
  }
  const chip = (id, n) => { const e = $(id); if (!e) return; const sp = e.querySelector('span'); if (sp) sp.textContent = String(n); else e.textContent = String(n); };
  chip('bpsImages', totalImgs); chip('bpsVideos', totalVids); chip('bpsFailed', failed); chip('bpsSpeed', speed);
  { const ff = $('bpsFailed'); if (ff) ff.classList.toggle('on', failed > 0); }
  { const eta = $('bpsEta'); if (eta) eta.textContent = remaining <= 0 && total > 0 ? 'Finishing up…' : (etaStr ? `About ${etaStr} left` : 'Calculating time left…'); }

  // Currently processing item
  const curEl = $('bpsCurrent');
  if (curEl) {
    if (currentItemTitle) {
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
  try { setTimeout(() => bulkNextRender(), 300); } catch (_) {} // v9.10.0

  const ok      = BulkState.results.filter(r => r.status === 'ok').length;
  const partial = BulkState.results.filter(r => r.status === 'partial').length;
  const fail    = BulkState.results.filter(r => r.status === 'fail').length;
  // Results carry images/videos arrays (imageCount is only on Library rows).
  const totalImgs = BulkState.results.reduce((s, r) => s + (r.imagesBase64?.length || r.images?.length || r.imageCount || 0), 0);
  const totalVids = BulkState.results.reduce((s, r) => s + (r.videos?.length || r.videoCount || 0), 0);

  // Compute hunt duration for summary
  const durMs  = BulkState.huntStartTime ? Date.now() - BulkState.huntStartTime : 0;
  const durSec = Math.round(durMs / 1000);
  const durStr = durSec >= 60 ? `${Math.floor(durSec/60)}m ${durSec%60}s` : `${durSec}s`;

  $('bulkRsOk').textContent      = ok;
  $('bulkRsPartial').textContent = partial;
  $('bulkRsFail').textContent    = fail;
  const dlFail = BulkState.results.filter(r => r.imgDlFailed).length;
  $('bulkResultMeta').textContent = `${totalImgs} images · ${totalVids} videos · ${durStr} total` + (dlFail ? ` · ${dlFail} ki images download nahi hui (URLs theek — Temu ke liye kaafi)` : '');

  // Mark progress complete
  const fill = $('bulkProgFill');
  if (fill) { fill.style.width = '100%'; fill.classList.add('complete'); }
  bpSetRing(100, fail > 0 ? 'warn' : 'done');

  // Show failed tabs detail
  const failedRows = BulkState.results.filter(r => r.status === 'fail');
  const detailEl = $('bulkFailedDetail');
  const listEl   = $('bulkFailedList');
  if (detailEl && listEl && failedRows.length > 0) {
    detailEl.classList.remove('hidden');
    listEl.classList.remove('hidden'); // auto-open so user sees them right away
    const errMap = {
      'cancelled':'cancelled','no_response':'timeout / slow','timeout':'timeout / slow',
      'needs_attention':'needs check (kept open in Chrome)','no_response_after_refresh':'slow / captcha (kept open)',
      'no_product':'not a product page','img_fetch_failed':'images failed',
      'url_mismatch':'wrong page','tab_navigated':'tab navigated','product_mismatch':'data mismatch',
      'scrape_error':'scrape error','tab_closed':'tab closed','no_script':'no script access','network_error':'network error',
      'captcha_blocked':'bot check / captcha (kept open)'
    };
    listEl.innerHTML = failedRows.map(r => {
      const raw    = r.error || '';
      const reason = errMap[raw] || (raw ? raw.replace(/_/g,' ') : 'problem tab');
      const host = (() => { try { return new URL(r.url).hostname.replace(/^www\./, ''); } catch { return r.url; } })();
      const platTag = r.platform ? r.platform.slice(0, 3).toLowerCase() : 'oth';
      const prodTitle = r.title || host;
      return `
        <div class="bulk-failed-item" data-tab-id="${r.tabId}">
          <div class="bfi-info">
            <span class="plat-pill plat-pill-sm" data-plat="${esc(platTag)}">${esc(r.platform || 'Other')}</span>
            <span class="bfi-title" title="${esc(r.title || r.url)}">${esc(trunc(prodTitle, 45))}</span>
            <span class="bfi-reason" title="${esc(raw)}">⚠️ ${esc(reason)}</span>
          </div>
          <div class="bfi-actions">
            <button type="button" class="btn btn-ghost btn-xs bfi-act-open" data-tab-id="${r.tabId}" data-url="${esc(r.url)}" title="Open & Focus Tab in Chrome">↗ View Tab</button>
            <button type="button" class="btn btn-ghost btn-xs bfi-act-retry" data-tab-id="${r.tabId}" title="Retry scraping this tab">🔄 Retry</button>
          </div>
        </div>`;
    }).join('');
    if ($('bulkFailedCount')) $('bulkFailedCount').textContent = failedRows.length;
    if ($('bulkFailedRetryCount')) $('bulkFailedRetryCount').textContent = failedRows.length;
  } else if (detailEl) {
    detailEl.classList.add('hidden');
  }

  // Results are already saved to master sheet via continuous flush loop

  // Show result summary
  $('bulkResultSummary')?.classList.remove('hidden');
  $('bpHero')?.classList.add('hidden');
  $('bpListWrap')?.classList.add('hidden');
  $('bpsCurrent')?.classList.add('hidden');
  $('bulkProgressFoot')?.classList.add('hidden');
  $('bulkProgressCloseBtn')?.classList.remove('hidden');
  const total = BulkState.results.length;
  updateBulkProgressTitle(BulkState.isCancelled ? 'Hunt cancelled' : 'Hunt complete',
    `${total} product${total === 1 ? '' : 's'} · ${totalImgs} images · ${durStr}`);

    updateMasterStats();
  updateBulkSummary();
  updateQueueExportButtons();

  // v8.3.2: no automatic download — the result modal is where the user picks what to save.
}

// ── Focus / Open Tab ──
async function bulkFocusTab(tabId, url) {
  if (tabId && Number.isInteger(+tabId)) {
    try {
      const t = await new Promise(r => chrome.tabs.get(+tabId, x => r(chrome.runtime.lastError ? null : x)));
      if (t) {
        await chrome.tabs.update(+tabId, { active: true });
        if (t.windowId) await chrome.windows.update(t.windowId, { focused: true });
        toast('Switched to tab', 'ok');
        return;
      }
    } catch (_) {}
  }
  if (url) {
    chrome.tabs.create({ url, active: true });
    toast('Opened product in new tab', 'ok');
  }
}

// ── Manual Single Tab Retry ──
async function bulkRetrySingleTab(rawTabId) {
  const isQueueItem = typeof rawTabId === 'string' && (rawTabId.startsWith('q_') || (QueueState.items || []).some(q => q.id === rawTabId));

  if (isQueueItem) {
    const qItem = (QueueState.items || []).find(q => q.id === rawTabId);
    if (!qItem) { toast('Queue item not found', 'warn'); return; }

    toast(`Retrying "${trunc(qItem.title || qItem.url, 25)}"…`, 'ok');
    setBulkRowStatus(rawTabId, 'active');
    setBulkRowMeta(rawTabId, 'Retrying…');

    // Remove old failed result
    const prevIdx = (BulkState.results || []).findIndex(r => r.tabId === rawTabId);
    if (prevIdx !== -1) BulkState.results.splice(prevIdx, 1);

    let worker = null;
    try {
      worker = await ensureQueueWorkerTab();
      await scrapeQueueItem(qItem, worker.id);
      const newRes = (BulkState.results || []).find(r => r.tabId === rawTabId);
      if (newRes && newRes.status !== 'fail') {
        await appendToMasterSheet([newRes]);
        toast('✓ Successfully hunted & added to sheet!', 'ok');
      }
    } catch (e) {
      toast('Retry failed: ' + (e?.message || 'unknown'), 'err');
    } finally {
      await closeQueueWorkerTab();
      updateBulkProgressBar();
      if (!$('bulkResultSummary')?.classList.contains('hidden')) {
        finishBulkHunt();
      }
    }
    return;
  }

  // Normal Chrome tab
  const tabId = +rawTabId;
  let tabInfo = (BulkState.tabs || []).find(t => t.tabId === tabId);
  if (!tabInfo) {
    const res = (BulkState.results || []).find(r => r.tabId === tabId);
    if (res) {
      tabInfo = { tabId: res.tabId, url: res.url, title: res.title || res.url, platform: { name: res.platform || 'Other' }, originalIndex: res.originalIndex ?? 0 };
    }
  }
  if (!tabInfo) {
    toast('Tab not found — could be closed', 'warn');
    return;
  }

  toast('Retrying tab in foreground…', 'ok');
  setBulkRowStatus(tabId, 'active');
  setBulkRowMeta(tabId, 'Retrying…');

  // Bring to foreground
  try {
    await chrome.tabs.update(tabId, { active: true });
  } catch (_) {}

  // Reload tab and wait for ready
  try {
    await new Promise(r => chrome.tabs.reload(tabId, {}, r));
    for (let i = 0; i < 20; i++) {
      await sleep(250);
      const td = await new Promise(r => chrome.tabs.get(tabId, t => r(chrome.runtime.lastError ? null : t)));
      if (!td || td.status === 'complete') break;
    }
    await sleep(400);
  } catch (_) {}

  // Remove previous result from BulkState.results
  const prevIdx = (BulkState.results || []).findIndex(r => r.tabId === tabId);
  if (prevIdx !== -1) BulkState.results.splice(prevIdx, 1);

  await scrapeOneTab(tabInfo);
  updateBulkProgressBar();
  
  // If result summary is currently visible, refresh it
  if (!$('bulkResultSummary')?.classList.contains('hidden')) {
    finishBulkHunt();
  }
}

// ── 1-Click Retry All Failed Tabs ──
async function bulkRetryAllFailed() {
  const failedRows = (BulkState.results || []).filter(r => r.status === 'fail');
  if (!failedRows.length) {
    toast('No failed tabs to retry!', 'ok');
    return;
  }

  // Check if these are Queue items
  const failedQueueItems = failedRows.filter(r => typeof r.tabId === 'string' && (r.tabId.startsWith('q_') || (QueueState.items || []).some(q => q.id === r.tabId)));
  const failedOpenTabs = failedRows.filter(r => !failedQueueItems.includes(r));

  // Remove failed records so re-scrape updates properly
  const failedIds = new Set(failedRows.map(r => r.tabId));
  BulkState.results = BulkState.results.filter(r => !failedIds.has(r.tabId));

  toast(`Retrying ${failedRows.length} failed link${failedRows.length > 1 ? 's' : ''}…`, 'ok');

  BulkState.isHunting = true;
  BulkState.isPaused = false;
  BulkState.isCancelled = false;

  try {
    if (failedQueueItems.length > 0) {
      const qItemsToRetry = failedQueueItems.map(fr => (QueueState.items || []).find(q => q.id === fr.tabId) || { id: fr.tabId, url: fr.url, title: fr.title }).filter(Boolean);
      const fakeTabs = qItemsToRetry.map(i => ({ tabId: i.id, url: i.url, title: i.title || i.url, platform: { name: 'Other', tag: 'oth' } }));
      openBulkProgressModal(fakeTabs);
      updateBulkProgressTitle('Retrying failed links', `Processing ${qItemsToRetry.length} queued links…`);
      await processQueueSequential(qItemsToRetry);
    }
    if (failedOpenTabs.length > 0) {
      const tabsToRetry = [];
      for (const fr of failedOpenTabs) {
        let existing = (BulkState.tabs || []).find(t => t.tabId === fr.tabId);
        if (existing) {
          existing._started = false;
          existing._done = false;
          tabsToRetry.push(existing);
        } else {
          tabsToRetry.push({
            tabId: fr.tabId,
            url: fr.url,
            title: fr.title || fr.url,
            platform: { name: fr.platform || 'Other', tag: (fr.platform || 'oth').slice(0, 3).toLowerCase() },
            originalIndex: fr.originalIndex ?? 0
          });
        }
      }
      openBulkProgressModal(tabsToRetry);
      updateBulkProgressTitle('Retrying failed tabs', `Processing ${tabsToRetry.length} tabs in foreground…`);
      await processSmartQueue(tabsToRetry);
    }
    if (!BulkState.isCancelled && !isBulkFastMode()) {
      await imageDownloadPhase();
    }
  } catch (e) {
    toast('Retry error: ' + (e?.message || 'unknown'), 'err');
  } finally {
    BulkState.isHunting = false;
    finishBulkHunt();
  }
}

// ── Master Sheet storage ─────────────────────────────────────
async function getMasterRows() {
  return new Promise(resolve => {
    chrome.storage.local.get(MASTER_KEY, res => resolve(res[MASTER_KEY] || []));
  });
}

async function setMasterRows(rows) {
  return new Promise(resolve => {
    chrome.storage.local.set({ [MASTER_KEY]: rows }, () => resolve());
  });
}

async function getMasterBatches() {
  return new Promise(resolve => {
    chrome.storage.local.get(BATCHES_KEY, res => resolve(res[BATCHES_KEY] || []));
  });
}

async function setMasterBatches(batches) {
  return new Promise(resolve => {
    chrome.storage.local.set({ [BATCHES_KEY]: batches }, () => resolve());
  });
}

async function appendToMasterSheet(rows) {
  // Strip base64 images from master storage (would explode storage)
  const existing = await getMasterRows();
  const existingUrls = new Set(existing.map(r => (r.url || '').toLowerCase()));
  const newRows = rows.filter(r => !existingUrls.has((r.url || '').toLowerCase()));

  if (newRows.length === 0) return;

  const lean = newRows.map(r => ({
    id:           `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    title:        r.title,
    url:          r.url,
    platform:     r.platform,
    price:        r.price,
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
  await setMasterRows([...existing, ...lean]);

  const batches = await getMasterBatches();
  const batch = batches.find(b => b.id === BulkState.currentBatchId);
  if (batch) {
    batch.count += newRows.length;
    batch.platforms = [...new Set([...batch.platforms, ...newRows.map(r => r.platform)])];
  } else {
    batches.unshift({
      id:        BulkState.currentBatchId,
      date:      new Date().toISOString(),
      count:     newRows.length,
      platforms: [...new Set(newRows.map(r => r.platform))]
    });
  }
  await setMasterBatches(batches.slice(0, 50));
}

async function updateMasterStats() {
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

function filterAndRenderMasterRows() {
  let rows = MasterUIState.allRows || [];
  const q = (MasterUIState.searchQuery || '').trim().toLowerCase();
  const plat = MasterUIState.filterPlatform || 'all';
  const sort = MasterUIState.sortBy || 'newest';

  if (plat === 'starred') {
    rows = rows.filter(r => !!r.starred);
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

  // Sort rows
  rows = [...rows];
  if (sort === 'newest') {
    rows.sort((a, b) => (b.scrapedAt || 0) - (a.scrapedAt || 0));
  } else if (sort === 'oldest') {
    rows.sort((a, b) => (a.scrapedAt || 0) - (b.scrapedAt || 0));
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
}

function renderMasterRows(rows) {
  const list = $('masterRowsList');
  if (!list) return;
  const libView = localStorage.getItem('zh_lib_view') || 'card';
  list.classList.toggle('master-dense-view', libView === 'dense' || libView === 'compact');
  if (!rows || rows.length === 0) {
    list.innerHTML = '<div class="bulk-empty empty"><div class="empty-ico"><svg class="i" viewBox="0 0 24 24"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg></div><h3>No Products Yet</h3><p>Hunt some tabs to collect products here. They will appear instantly!</p></div>';
    updateMasterBulkBar();
    return;
  }

  list.innerHTML = '';
  // Order already determined by filterAndRenderMasterRows sorting
  const display = [...rows];
  display.forEach((r, _rowIdx) => {
    const sel = MasterUIState.selectedIds.has(r.id);
    const status = r.status || 'ok';
    const date = r.scrapedAt ? new Date(r.scrapedAt) : null;
    const dateStr = date ? `${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')} ${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}` : '—';
    const priceStr = r.price ? r.price : '—';
    const tagInfo = (PLATFORM_PATTERNS[(Object.keys(PLATFORM_PATTERNS).find(k => (r.platform || '').toLowerCase().includes(k.split('.')[0])) || '')]) || null;
    const platName = tagInfo?.name || r.platform || 'Other';
    const platTag = tagInfo?.tag ? tagInfo.tag.toLowerCase() : (r.platform ? r.platform.slice(0, 3).toLowerCase() : 'oth');

    const thumbUrl = (Array.isArray(r.images) && r.images.length && typeof r.images[0] === 'string')
      ? r.images[0]
      : (r.images?.[0]?.url || '');
    const thumbHtml = thumbUrl
      ? `<img class="row-thumb-img" src="${esc(thumbUrl)}" alt="${esc(r.title || '')}" loading="lazy" decoding="async" data-onerror="thumb"><span class="row-thumb-fallback" style="display:none;">${esc(platName.slice(0, 2))}</span>`
      : `<span class="row-thumb-fallback">${esc(platName.slice(0, 2))}</span>`;

    const row = document.createElement('div');
    row.className = 'master-row' + (sel ? ' selected' : '') + ' status-' + status;
    row.dataset.id = r.id;

    row.innerHTML = `
      <div class="master-row-check"></div>
      <div class="row-thumb-wrap">${thumbHtml}</div>
      <div class="master-row-info">
        <div class="master-row-top">
          <button class="star-btn ${r.starred ? 'starred' : ''}" data-id="${esc(r.id)}" title="${r.starred ? 'Unstar' : 'Star'}" type="button">${r.starred ? '★' : '☆'}</button>
          <span class="plat-pill" data-plat="${esc(platTag)}">${esc(platName)}</span>
          <span class="m-price">${esc(priceStr)}</span>
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
      await setMasterRows(filtered);
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
      if (MasterUIState.selectedIds.has(r.id)) {
        MasterUIState.selectedIds.delete(r.id);
        row.classList.remove('selected');
      } else {
        MasterUIState.selectedIds.add(r.id);
        row.classList.add('selected');
      }
      updateMasterBulkBar();
    });

    row.style.animationDelay = Math.min(_rowIdx * 30, 300) + 'ms';
    list.appendChild(row);
  });
  updateMasterBulkBar();
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
  const rows = await getMasterRows();
  rows.forEach(r => {
    if (r.status === targetStatus) MasterUIState.selectedIds.add(r.id);
  });
  renderMasterRows(rows);
}

async function masterSelectAll() {
  // v9.7.3: "All" = sirf jo abhi filter/search mein dikh rahe hain (poori Library nahi)
  const rows = Array.isArray(MasterUIState.visibleRows) ? MasterUIState.visibleRows : await getMasterRows();
  rows.forEach(r => MasterUIState.selectedIds.add(r.id));
  renderMasterRows(rows);
}

function masterDeselectAll() {
  MasterUIState.selectedIds.clear();
  updateMasterStats(); // re-render
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
      await setMasterRows(remaining);
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
      await chrome.scripting.executeScript({ target: { tabId: newTab.id }, files: ['lib/jszip.min.js', 'content.js'] });
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
      title:        scraped.title || r.title,
      price:        scraped.price || r.price,
      description:  scraped.description || r.description,
      variants:     Array.isArray(scraped.variants) ? scraped.variants.join(', ') : r.variants,
      imageCount:   Array.isArray(scraped.images) ? scraped.images.length : r.imageCount,
      videoCount:   Array.isArray(scraped.videos) ? scraped.videos.length : r.videoCount,
      images:       Array.isArray(scraped.images) ? scraped.images.slice(0, 10) : r.images,
      brand: scraped.brand || r.brand || '', color: scraped.color || r.color || '', weight: scraped.weight || r.weight || '',
      dimL: scraped.dimL || r.dimL || '', dimW: scraped.dimW || r.dimW || '', dimH: scraped.dimH || r.dimH || '',
      bullets:      Array.isArray(scraped.bullets) && scraped.bullets.length ? scraped.bullets : (r.bullets || []),
      videos:       Array.isArray(scraped.videos) ? scraped.videos.slice(0, 4) : r.videos,
      status:       'ok',
      lastRehunted: new Date().toISOString()
    };
  });
  await setMasterRows(updatedRows);
  await updateMasterStats();
  toast('✓ Updated with latest data', 'ok');
}

function renderMasterBatches(batches) {
  const list = $('masterBatchList');
  if (!list) return;
  if (batches.length === 0) {
    list.innerHTML = '<div class="bulk-empty"><p>No batches yet. Hunt some tabs first!</p></div>';
    return;
  }
  list.innerHTML = '';
  batches.slice(0, 20).forEach(b => {
    const d = new Date(b.date);
    const row = document.createElement('div');
    row.className = 'master-batch-row';
    row.innerHTML = `
      <span class="bdate">${d.toLocaleDateString()} ${d.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</span>
      <span class="bcount">${b.count} products</span>`;
    list.appendChild(row);
  });
}

async function resetMasterSheet() {
  showConfirm(
    'Reset Master Sheet',
    'Delete all master sheet data? This cannot be undone.',
    'Delete All',
    async () => {
      await setMasterRows([]);
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
  wb.Props = { Title: 'ZHunter PRO Catalog', Subject: 'Product hunt export', Author: 'ZHunter PRO', CreatedDate: new Date() };
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
    + '<title>' + escPdf(titleText||'ZHunter PRO Catalog') + '</title>'
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
    + '<h1>' + escPdf(titleText||'ZHunter PRO Catalog') + ' (' + rows.length + ' products)</h1>'
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
    const basePx = pick('Base Price', 'base', 'temuBase', 'BasePrice', 'price', 'Price');
    const varVal = pick('Variation', 'variation', 'variant', 'Variant', 'color', 'Color');
    const rawImgs = pick('Images', 'images', 'image_urls', 'Image URLs');
    const imgList = Array.isArray(r.images) ? r.images.slice(0, 10) : rawImgs ? rawImgs.split(/[|,\s]+/).map(x => x.trim()).filter(u => /^https?:\/\//i.test(u)).slice(0, 10) : [...Array(10).keys()].map(i => pick(`img${i+1}`, `Image ${i+1}`)).filter(Boolean);
    return {
      id: `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      sku: pick('SKU', 'sku', 'Seller SKU', 'seller_sku'),
      title: pick('title', 'Product Title', 'Title', 'name') || url,
      url, platform: pick('platform', 'Platform') || bgPlatformGuess(url),
      brand: pick('brand', 'Brand'), color: varVal,
      weight: pick('weight', 'Weight'), dimL: pick('dimL', 'Length'), dimW: pick('dimW', 'Width'), dimH: pick('dimH', 'Height'),
      bullets: Array.isArray(r.bullets) ? r.bullets : String(pick('bullets', 'Bullet Points')).split(' | ').filter(Boolean),
      price: pick('price', 'Price', 'Scraped Price') || basePx,
      temuBase: basePx || pick('price', 'Price', 'Scraped Price'),
      labelCost: pick('labelCost', 'Sourcing Price', 'Label Cost'), listPrice: pick('listPrice', 'List Price'),
      description: pick('description', 'Description'), tags: pick('tags', 'Tags'), variants: pick('variants', 'Variants'),
      imageCount: Number(pick('imageCount', 'Images')) || (imgList.length || 0), videoCount: Number(pick('videoCount', 'Videos')) || 0,
      images: imgList, videos: Array.isArray(r.videos) ? r.videos.slice(0, 4) : [],
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
  const parsed = await parseImportFile(file);
  if (!parsed) return;
  const { rows, batches } = parsed;
  try {
    const existing = await getMasterRows();
    const seen = new Set(existing.map(r => (r.url || '').toLowerCase()));
    const fresh = rows.filter(r => !seen.has(r.url.toLowerCase()));
    await setMasterRows([...existing, ...fresh]);
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
    Generated by ZHunter PRO · Click "Copy as Sheet" then paste into Google Sheets / Excel
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
    // If any product has image URLs but missing base64 (e.g. hunted with Fast Mode ON), download on-demand!
    const missingImgRows = rows.filter(r => (!r.imagesBase64 || r.imagesBase64.length === 0) && r.images && r.images.length > 0);
    if (missingImgRows.length > 0) {
      if (btn) {
        const txt = btn.querySelector('.bulk-dl-text');
        if (txt) txt.textContent = `Downloading images (${missingImgRows.length})…`;
      }
      let cur = 0;
      const CONCUR = 4;
      const workers = Array.from({ length: CONCUR }, async () => {
        while (cur < missingImgRows.length) {
          const r = missingImgRows[cur++];
          if (!r) break;
          try {
            const urls = (r.images || []).slice(0, 7);
            const batchRes = await msg({ action: 'FETCH_BASE64_BATCH', urls });
            if (batchRes?.success && Array.isArray(batchRes.results)) {
              r.imagesBase64 = batchRes.results.filter(x => x?.success && x.base64).map(x => x.base64);
            }
          } catch (_) {}
        }
      });
      await Promise.all(workers);
      if (btn) {
        const txt = btn.querySelector('.bulk-dl-text');
        if (txt) txt.textContent = 'Building ZIP…';
      }
    }

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

          // Dedup by Amazon image ID + format to _AC_SL1500_ (auto-crop without white padding)
          const seenIds = new Set();
          const addImg = (url) => {
            if (!url || !url.startsWith('http')) return;
            const final = amzUpgrade(url) || url;
            const m = final.match(/\/images\/I\/([A-Za-z0-9+/]+=*)/);
            const id = m ? m[1] : final;
            if (seenIds.has(id)) return;
            seenIds.add(id);
            images.push(final);
          };

          // Upgrade a 'large' URL to ._AC_SL1500_. (reliable 500-1500px CDN version)
          const amzUpgrade = (url) => {
            if (!url) return url;
            const bare = amzStrip(url);
            return bare.replace(/\.(jpg|jpeg|png|webp|gif|avif)$/i, '._AC_SL1500_.$1');
          };

          // ── Strategy 1: Simple Extension Logic (ImageBlockATF / colorImages) ───────────────
          let foundInitial = false;
          for (let script of document.querySelectorAll('script:not([src])')) {
            const t = script.textContent || '';
            if (!t.includes('colorImages') && !t.includes('ImageBlockATF')) continue;
            // Exclude sponsored ad scripts
            if (t.includes('ape_Detail') || t.includes('adCreativeMetaData') || t.includes('adProgramId')) continue;

            try {
              const initMatch = t.match(/"initial"\s*:\s*(\[\s*\{[\s\S]*?\}\s*\])/);
              const scope = initMatch ? initMatch[1] : '';
              if (scope) {
                const hiResRegex = /"hiRes"\s*:\s*(?:null|"([^"\\]+)")/g;
                const largeRegex = /"large"\s*:\s*"([^"\\]+)"/g;

                let match;
                let hiResCount = 0;
                while ((match = hiResRegex.exec(scope)) !== null) {
                  if (match[1]) {
                    addImg(match[1], true);
                    hiResCount++;
                  }
                }

                if (hiResCount > 0) {
                  foundInitial = true;
                  break;
                }

                // If no hiRes, fallback to large
                let largeCount = 0;
                while ((match = largeRegex.exec(scope)) !== null) {
                  if (match[1]) {
                    addImg(match[1], true);
                    largeCount++;
                  }
                }

                if (largeCount > 0) {
                  foundInitial = true;
                  break;
                }
              }
            } catch (e) {
              console.error("Error parsing ImageBlockATF", e);
            }
          }

          // ── Strategy 2: DOM Gallery Fallback (Scoped strictly to product gallery) ──
          if (!foundInitial || images.length === 0) {
            const isBadEl = (el) => {
              return !!el.closest(
                '[id*="ape_"], [class*="ape-"], [id*="ad-"], [class*="sponsored"], ' +
                '[id*="sims"], [id*="similarities"], [id*="recommendations"], [id*="reviews"], ' +
                '#customerReviews, #va-related-videos-widget_feature_div'
              );
            };
            const pickDyn = (el) => {
              try {
                const d = el.getAttribute('data-a-dynamic-image');
                if (!d || !d.startsWith('{')) return '';
                const p = JSON.parse(d);
                const k = Object.keys(p);
                k.sort((a,b) => (p[b][0]*p[b][1]) - (p[a][0]*p[a][1]));
                return k[0] || '';
              } catch(_) { return ''; }
            };

            const landingImage = document.getElementById('landingImage');
            if (landingImage && !isBadEl(landingImage)) {
              const u = landingImage.getAttribute('data-old-hires') || pickDyn(landingImage) || landingImage.src;
              if (u) addImg(u, true);
            }

            const altImages = document.querySelectorAll(
              '#altImages li:not(.video-item) img, #imageBlock img:not(.video-item img), ' +
              '#imgTagWrapperId img, .a-button-thumbnail img, .imageThumbnail img'
            );
            altImages.forEach(img => {
              if (isBadEl(img)) return;
              const u = img.getAttribute('data-old-hires') || pickDyn(img) || img.getAttribute('data-zoom-image') || img.src || '';
              if (u && !/play[-_]?button|video[-_]?thumbnail/i.test(u)) {
                addImg(u, true);
              }
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
        // Keep ALL Amazon CDN URLs on timeout
        if (src.includes('media-amazon.com') || src.includes('images-amazon.com')) {
          const isBare = !/\._[A-Z0-9_,]{2,}_\./i.test(src);
          resolve({ src, w: isBare ? 2000 : 1500, h: isBare ? 2000 : 1500 });
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

  const images = ImgState.images;
  if (!images.length) {
    showImgEmpty();
    if (countEl) countEl.textContent = '0 images';
    if (filterBar) filterBar.classList.add('hidden');
    $('roleFilterBar')?.classList.add('hidden');
    return;
  }

  if (filterBar) filterBar.classList.remove('hidden');
  $('roleFilterBar')?.classList.remove('hidden');

  const minSize    = ImgState.minSize || 0;
  const roleFilter = ImgState.roleFilter || 'all';

  let visible = 0;
  const total = images.length;

  // Update role chip counters
  const roleCounts = {};
  images.forEach(img => {
    const r = img.role || 'unknown';
    roleCounts[r] = (roleCounts[r] || 0) + 1;
  });
  document.querySelectorAll('#roleFilterBar .role-chip').forEach(chip => {
    const role = chip.dataset.role;
    if (role === 'all') {
      const n = chip.querySelector('.lbl-n');
      if (n) n.textContent = total;
      chip.hidden = false;
    } else {
      const count = roleCounts[role] || 0;
      const n = chip.querySelector('.lbl-n');
      if (n) n.textContent = count;
      chip.hidden = count === 0;
    }
  });

  images.forEach((img, idx) => {
    const role = img.role || 'unknown';

    // Role filter: skip if not matching
    if (roleFilter !== 'all' && role !== roleFilter) return;

    const isUnderSize = minSize > 0 && img.w && img.h && (img.w < minSize || img.h < minSize);

    const card = document.createElement('div');
    card.className = 'img-card' + (ImgState.selected.has(idx) ? ' selected' : '');
    card.dataset.idx = idx;
    if (isUnderSize) card.style.display = 'none';
    else visible++;

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
      openLightbox(img.src, `Image ${idx + 1} of ${images.length} ${label ? `(${label})` : ''}`);
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

  // Update count: "N of M" when filter is active
  if (countEl) {
    if (roleFilter !== 'all') {
      countEl.textContent = `${visible} of ${total}`;
    } else {
      countEl.textContent = `${total}`;
    }
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

  let ok = 0, failed = 0;

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
        // This is the same quality as right-click → Save Image.
        const resp = await chrome.runtime.sendMessage({
          action: 'FETCH_BASE64',
          url:    imgData.src,
          // Pass settings that force bypass of all canvas conversion
          settings: { imageFormat: 'original', imageRatio: 'original', imageBg: 'original', imageMinSize: 0, imageMax5MB: false }
        });
        if (resp?.success && resp.base64) {
          dataUrl = resp.base64;
          // Derive extension from the actual content type returned
          if (resp.base64.startsWith('data:image/png'))       ext = 'png';
          else if (resp.base64.startsWith('data:image/webp')) ext = 'webp';
          else if (resp.base64.startsWith('data:image/gif'))  ext = 'gif';
          else if (resp.base64.startsWith('data:image/avif')) ext = 'avif';
          else                                                 ext = 'jpg';
        }
      } else {
        // ── JPG / PNG MODE: canvas conversion at high quality ──
        const mime = fmt === 'png' ? 'image/png' : 'image/jpeg';
        ext = fmt;
        dataUrl = await imgToDataUrl(imgData.src, mime);
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

// Convert image URL → data URL (JPG or PNG), high quality, aspect ratio preserved
// Used only when user explicitly selects JPG or PNG format.
function imgToDataUrl(src, mime) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width  = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');

      // White background (needed for JPG which has no transparency)
      if (mime === 'image/jpeg') {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }

      ctx.drawImage(img, 0, 0);

      // Use 97% quality — near-lossless for JPEG
      const quality = mime === 'image/jpeg' ? 0.97 : 1.0;
      resolve(canvas.toDataURL(mime, quality));
    };

    img.onerror = () => resolve(null);
    img.src = src;
    setTimeout(() => resolve(null), 8000);
  });
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

  document.querySelectorAll('#imgFilterChips .img-filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('#imgFilterChips .img-filter-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      ImgState.minSize = Number(chip.dataset.min || 0);
      renderImgGrid();
    });
  });

  // Role filter chips
  document.querySelectorAll('#roleFilterBar .role-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('#roleFilterBar .role-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      ImgState.roleFilter = chip.dataset.role || 'all';
      renderImgGrid();
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
const DEFAULT_GROQ_KEYS = [
  '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',
  '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',
  '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',
  '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'
];

function temuGetAiKeys(raw) {
  if (!raw || typeof raw !== 'string') return [...DEFAULT_GROQ_KEYS];
  const keys = raw.split(/[\s,;\n]+/).map(k => k.trim()).filter(Boolean);
  return keys.length ? keys : [...DEFAULT_GROQ_KEYS];
}

const TEMU_DEFAULT_CONFIG = {
  sku_prefix: 'CH',
  price_multiplier: 5.0,
  list_price_multiplier: 1.25,
  price_round_to_99: true,
  min_profit_dollar: 50.0,
  heavy_shipping_buffer: 2.0,
  heavy_weight_threshold: 2.0,
  quantity_min: 250,
  quantity_max: 500,
  max_sku_images: 10,
  gemini_api_key: DEFAULT_GROQ_KEYS.join('\n'),
  ai_keep_approved_brands: true,
  ai_strip_claims: true,
  ai_custom_instructions: '',
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
  category_profiles: {
    golf_balls: { match: ['golf ball', 'golf balls', 'dozen balls', 'golf', 'chrome tour', 'chrome soft', 'pro v1', 'tp5', 'avx', 'velocity', 'supersoft', 'tour response', 'speedsoft', 'warbird', 'erc soft'], category_keyword: 'Standard Balls',
      keyword_attributes: 'Rubber, 14 Years+',
      // v9.6.4: default White hata diya — variation ab title keyword (Tour/Soft/Distance/Premium…) ya rotation se aati hai
      attributes: { 'Material': 'Rubber', 'Applicable Age Group': '14 Years+' },
      weight_lb: 1.4, length_in: 7.5, width_in: 5.2, height_in: 1.5 },
    towels: { match: ['bath towel', 'hand towel', 'beach towel', 'washcloth', 'towel set'], exclude: ['paper towel', 'kitchen towel roll', 'shop towel'],
      category_keyword: 'Bath Towels',
      weight_lb: 2.0, length_in: 12, width_in: 10, height_in: 4 },
    // v9.8.0: household / grocery / baby — Temu category names + REQUIRED attributes Temu ki category template
    // (TEMU_BABYDIAPERS_..._CLEANINGCL.xlsx, GoodsLevelMode + Valid Values) se. Attribute values Temu ki valid list se hain.
    // Order matters: pehla match jeet-ta hai (specific pehle, general baad mein).
    swim_diapers: { match: ['swim diaper', 'swim pants', 'little swimmers', 'splashers'], category_keyword: 'Swim Diapers',
      attributes: { 'Applicable Age Group': '0 Year+', 'Material': 'Other' }, length_in: 10, width_in: 8, height_in: 4 },
    diapers: { match: ['diaper', 'diapers', 'pull-ups', 'pull ups', 'training pants', 'easy ups'], exclude: ['dog diaper', 'adult', 'incontinence', 'wipes', 'diaper bag', 'diaper pail', 'diaper cream', 'rash'],
      category_keyword: 'Baby Diapers', attributes: { 'Applicable Age Group': '0 Year+', 'Major Material': 'Textile' }, length_in: 16, width_in: 12, height_in: 10 },
    disinfectant_wipes: { match: ['disinfecting wipes', 'disinfectant wipes', 'clorox wipes', 'lysol wipes', 'cleaning wipes', 'antibacterial wipes'],
      category_keyword: 'Disinfectant Wipes', attributes: { 'Composition': 'See The User Manual' }, length_in: 10, width_in: 6, height_in: 8 },
    baby_wipes: { match: ['baby wipes', 'wipes refill', 'sensitive wipes', 'flushable wipes', 'water wipes', 'wipes,'], exclude: ['disinfect', 'clorox', 'lysol', 'glasses', 'screen', 'makeup', 'dog', 'pet'],
      category_keyword: 'Baby Wipes & Refills', attributes: { 'Applicable Age Group': '0 Year+' }, length_in: 12, width_in: 8, height_in: 8 },
    baby_lotion: { match: ['baby lotion', 'baby cream', 'baby moisturizer', 'baby oil', 'baby wash', 'baby shampoo'],
      category_keyword: 'Lotions', attributes: { 'Applicable Age Group': '0 Year+' } },
    trash_bags: { match: ['trash bag', 'trash bags', 'garbage bag', 'garbage bags', 'clean-up bag', 'clean up bag', 'drawstring bags', 'kitchen bags', 'lawn and leaf bag', 'contractor bag', 'trash can liner'], exclude: ['diaper', 'dog waste', 'poop bag'],
      category_keyword: 'Trash Bags', attributes: { 'Material': 'Plastic' }, length_in: 12, width_in: 8, height_in: 6 },
    // Bounty napkins bhi "Bounty" match karte hain → napkins/tissues pehle
    napkins: { match: ['napkin', 'napkins'], category_keyword: 'Disposable Napkins', attributes: { 'Material': 'Paper' }, length_in: 12, width_in: 8, height_in: 6 },
    box_tissues: { match: ['facial tissue', 'facial tissues', 'kleenex', 'puffs', 'tissue box', 'tissues,'], exclude: ['toilet', 'bath tissue', 'wipes'],
      category_keyword: 'Box Tissues', attributes: { 'Material': 'Paper' }, length_in: 12, width_in: 10, height_in: 9 },
    cleansing_wipes: { match: ['facial cleansing', 'cleansing towelettes', 'cleansing wipes', 'facial towels', 'makeup remover wipes', 'body wipes'],
      category_keyword: 'Personal Cleansing Wipes', attributes: { 'Material': 'Fabric' }, length_in: 10, width_in: 6, height_in: 6 },
    paper_towels: { match: ['paper towel', 'paper towels', 'bounty', 'select-a-size', 'kitchen roll'],
      category_keyword: 'Paper Towels', attributes: { 'Material': 'Paper' }, length_in: 16, width_in: 12, height_in: 11 },
    paper_plates: { match: ['paper plate', 'paper plates', 'dinner plates', 'dixie plates', 'compostable plates'], exclude: ['plastic plate'],
      category_keyword: 'Plates', attributes: { 'Material': 'Paper' }, length_in: 12, width_in: 12, height_in: 6 },
    plastic_plates: { match: ['plastic plate', 'plastic plates', 'disposable plates', 'foam plates'],
      category_keyword: 'Plates', attributes: { 'Material': 'Plastic' }, length_in: 12, width_in: 12, height_in: 6 },
    bowls: { match: ['paper bowl', 'paper bowls', 'disposable bowl', 'disposable bowls', 'foam bowls', 'plastic bowls'],
      category_keyword: 'Bowls', attributes: { 'Material': 'Paper' }, length_in: 10, width_in: 10, height_in: 6 },
    cutlery: { match: ['plastic fork', 'plastic forks', 'plastic spoons', 'plastic knives', 'cutlery', 'utensil set', 'disposable forks', 'disposable spoons', 'plastic utensils'],
      category_keyword: 'Cutlery Sets', attributes: { 'Material': 'Plastic' }, length_in: 10, width_in: 6, height_in: 4 },
    cups: { match: ['plastic cups', 'disposable cups', 'party cups', 'solo cups', 'paper cups', 'hot cups', 'cold cups'],
      category_keyword: 'Cups', attributes: { 'Material': 'Plastic' }, length_in: 10, width_in: 8, height_in: 8 },
    dish_soap: { match: ['dish soap', 'dishwashing liquid', 'dish liquid', 'dawn'], exclude: ['rinse aid', 'dishwasher'], category_keyword: 'Dish Soap' },
    rinse_aids: { match: ['rinse aid', 'jet-dry', 'jet dry', 'dishwasher rinse'], category_keyword: 'Rinse Aids', attributes: { 'Composition': 'See The User Manual' } },
    bleach: { match: ['bleach'], exclude: ['hair'], category_keyword: 'Bleach' },
    toilet_cleaners: { match: ['toilet bowl cleaner', 'toilet cleaner', 'toilet bowl'], category_keyword: 'Toilet Cleaners' },
    sponges: { match: ['sponge', 'sponges', 'scrub daddy', 'scrubber'], category_keyword: 'Sponges', attributes: { 'Material': 'Plastic' } },
    cleaning_cloths: { match: ['microfiber cloth', 'microfiber cloths', 'cleaning cloth', 'cleaning cloths', 'microfiber towels', 'shop towels'],
      category_keyword: 'Cleaning Cloths', attributes: { 'Material': 'Microfiber' } },
    hangers: { match: ['kids hangers', "children's hangers", 'baby hangers', 'toddler hangers', 'clothes hangers'], category_keyword: "Children's Clothes Hangers", attributes: { 'Material': 'Plastic' } },
    // Food — Allergen Information product-specific hai, khud nahi bharte (Fix drafts report karega); Food Ingredient List = "See Product Details"
    chips: { match: ['chips', 'crisps', 'pringles', 'doritos', 'cheetos', 'tortilla chips', 'potato chips'], exclude: ['chocolate chip', 'wood chip', 'poker chip'],
      category_keyword: 'Chips & Crisps', attributes: { 'Food Ingredient List': 'See Product Details' } },
    crackers: { match: ['saltine', 'saltines', 'crackers', 'ritz', 'cheez-it', 'goldfish'], category_keyword: 'Saltines', attributes: { 'Food Ingredient List': 'See Product Details' } },
    jerky: { match: ['jerky', 'beef sticks', 'meat sticks', 'slim jim'], category_keyword: 'Jerky', attributes: { 'Food Ingredient List': 'See Product Details' } },
    fruit_snacks: { match: ['fruit snacks', 'fruit snack', 'gummies', 'fruit roll', 'welch'], exclude: ['vitamin', 'supplement'],
      category_keyword: 'Fruit Snacks', attributes: { 'Food Ingredient List': 'See Product Details' } },
    ground_coffee: { match: ['ground coffee', 'coffee ground', 'coffee, ground', 'folgers', 'maxwell house'], exclude: ['k-cup', 'k cup', 'pods', 'whole bean', 'instant'],
      category_keyword: 'Ground Coffee', attributes: { 'Food Ingredient List': 'See Product Details' } },
    string_cheese: { match: ['string cheese', 'cheese sticks', 'cheese snack', 'snack cheese', 'babybel'], category_keyword: 'String & Snack', attributes: { 'Food Ingredient List': 'See Product Details' } },
    olive_oil: { match: ['olive oil'], category_keyword: 'Olive', attributes: { 'Food Ingredient List': 'See Product Details' } },
    // Canned beans / sauces — Temu file: sirf Allergen Information required (product-specific, khud nahi bharte)
    baked_beans: { match: ['baked beans'], category_keyword: 'Baked Beans' },
    kidney_beans: { match: ['kidney beans'], category_keyword: 'Kidney Beans' },
    pinto_beans: { match: ['pinto beans'], category_keyword: 'Pinto Beans' },
    black_beans: { match: ['black beans'], category_keyword: 'Black Beans' },
    pasta_sauce: { match: ['pasta sauce', 'marinara', 'alfredo sauce', 'spaghetti sauce'], category_keyword: 'Sauces' },
    canned_corn: { match: ['canned corn', 'whole kernel corn', 'sweet corn', 'corn, '], exclude: ['popcorn', 'corn chips', 'corn starch', 'tortilla'], category_keyword: 'Corn', attributes: { 'Food Ingredient List': 'See Product Details' } },
    green_beans: { match: ['green beans', 'cut green beans', 'french style green beans'], category_keyword: 'Green Beans', attributes: { 'Food Ingredient List': 'See Product Details' } }
  },
  price_alert_high: 150, price_alert_low: 3,
  price_min: 69.99, // v9.8.1: base price kam se kam itni ($69.99 floor)
  price_max: 999, // v9.12.3: high price limit ($999 tak normal hai)
  // v9.11.0 Brand approval guard — Temu "Brands & IP" ke mutabiq: brand → approved category groups (+ remaining sellable units).
  // Groups: sports, kitchen (Home & Kitchen), grocery, household (cleaning/paper/disposables), baby, pets, beauty.
  // Default list HQ TWO (Sep 2026) se — har store ke Settings mein apni list likhein.
  brand_rules: {
    'GREAT VALUE': { groups: ['kitchen', 'grocery'], units: 1000000 },
    "MEMBER'S MARK": { groups: ['pets', 'kitchen'], units: 1000000 },
    'CALLAWAY': { groups: ['sports'], units: 0 },
    'TAYLORMADE': { groups: ['sports'], units: 0 },
    'WILSON': { groups: ['sports'], units: 80 },
    'VICE GOLF': { groups: ['sports'], units: 999964 },
    'TITLEIST': { groups: ['sports'], units: 49 }
  },
  // v9.8.0: Temu template ke packaging columns (blank = nahi bharna). Valid values Temu template se:
  // SKU_type: Single set | Multi-piece set | Mixed set of different specifications | Mixed set of different products
  // Individually_packed: Yes | No · Packaging_unit: piece | pair | pack
  packaging: { sku_type: '', individually_packed: '', total_packaging_quantity: '', packaging_unit: '' },
  auto_fix_after_upload: true,
  colors: ['White','Red','Black','Yellow','Grey','Gray','Blue','Green','Purple','Orange','Pink','Brown','Navy Blue','Multi Color','Mixed Color','Neon'],
  smart_variations: true,
  upload_in_background: true,
  simple_variation_values: ['Standard', 'Special', 'New', 'Classic'],
  smart_weight: true,
  max_weight_lb: 8,
  skip_listed: true,
  title_remove_words: [
    'Amazon', 'Amazon.com', 'Walmart', 'Walmart.com', "Sam's Club", 'Costco', 'Target',
    'priced per pound', 'Prime', 'FSA Eligible', 'Best Seller', 'Lifetime Warranty', 'Warranty', 'Guaranteed',
    'Callaway', 'Vice', 'Titleist', 'TaylorMade', 'Bridgestone', 'Srixon', 'Pinnacle', 'Wilson',
    'BPA Free', 'Free Shipping', '100% Authentic'
  ]
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
  (items || []).forEach(it => { const k = store + '|' + (it.sid || temuSourceId(it.url)); if (m[k]) { delete m[k]; n++; } });
  if (!n) return 0;
  const ok = await msg({ action: 'UPDATE_SETTINGS', settings: { temuListed: m } });
  if (ok?.success) State.data.settings.temuListed = m;
  return n;
}
async function temuMarkListed(items) {
  const store = temuActiveStoreName() || 'default';
  const m = { ...temuListedMap() };
  const now = new Date().toISOString().slice(0, 10);
  // v9.6.2: aakhri mark yaad rakho (store + source ids) taake "Unmark last upload" reload ke baad bhi chale
  try { chrome.storage.local.set({ temuLastMarked: { store, sids: (items || []).map(it => it.sid || temuSourceId(it.url)), n: (items || []).length, t: Date.now() } }); } catch (_) {}
  items.forEach(it => {
    const sid = it.sid || temuSourceId(it.url); // v9.7.1: as-is Temu file ke items mein sid SKU se aata hai
    m[store + '|' + sid] = { t: (it.title || '').slice(0, 60), d: now };
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
function temuRenderStorePills() {
  const list = $('temuStorePillsList'); if (!list) return;
  const stores = temuStores();
  const act = temuActiveStoreName();
  const names = Object.keys(stores);
  if (!names.length) {
    list.innerHTML = '<span style="font-size:10.5px;color:var(--ink-4);padding-left:4px;">No stores</span>';
    return;
  }
  list.innerHTML = names.map(n => {
    const isActive = n === act;
    const st = stores[n];
    const hasTpl = !!st?.templateName;
    return `<button type="button" class="temu-store-pill${isActive ? ' active' : ''}" data-sname="${esc(n)}" title="${isActive ? 'Active store: ' + esc(n) : 'Click to switch to ' + esc(n)}">
      <span class="t-pill-dot"></span>
      <span>${esc(n)}</span>
      ${hasTpl ? '<span class="t-pill-check" title="Template attached">✓</span>' : ''}
    </button>`;
  }).join('');
}
function temuRenderStoreBar() {
  temuRenderStorePills();
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
}

function temuGetCfg() {
  const base = JSON.parse(JSON.stringify(TEMU_DEFAULT_CONFIG));
  const saved = temuActiveStore()?.config;
  if (!saved || typeof saved !== 'object' || !saved.defaults) return base;
  const merged = { ...base, ...saved, defaults: { ...base.defaults, ...saved.defaults }, packaging: { ...(base.packaging || {}), ...(saved.packaging || {}) }, category_profiles: { ...(base.category_profiles || {}), ...(saved.category_profiles || {}) }, brand_rules: (saved.brand_rules && typeof saved.brand_rules === 'object') ? saved.brand_rules : base.brand_rules };
  const currentKeys = (merged.gemini_api_key || '').split(/[\s,;\n]+/).map(k => k.trim()).filter(Boolean);
  if (!currentKeys.length || (currentKeys.length === 1 && !DEFAULT_GROQ_KEYS.includes(currentKeys[0]))) {
    merged.gemini_api_key = DEFAULT_GROQ_KEYS.join('\n');
  } else if (!DEFAULT_GROQ_KEYS.every(dk => currentKeys.includes(dk))) {
    merged.gemini_api_key = Array.from(new Set([...DEFAULT_GROQ_KEYS, ...currentKeys])).join('\n');
  }
  return merged;
}

function temuCleanTitle(t, cfg) {
  t = String(t || '').replace(/\s+/g, ' ').trim();
  ['Amazon.com :', 'Amazon.com:', 'Walmart.com:', 'SamsClub.com:'].forEach(p => { 
    if (t.toLowerCase().startsWith(p.toLowerCase())) t = t.slice(p.length).trim(); 
  });
  
  // Sort remove words by length descending so longer phrases match first
  const words = (cfg.title_remove_words || [])
    .map(w => String(w || '').trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);

  words.forEach(w => {
    const escaped = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp('(^|\\s|[,.;:!|/\\-])' + escaped + '(?=[,.;:!|/\\-\\s]|$)', 'gi');
    t = t.replace(re, '$1');
  });

  // Clean orphan domain remnants like .com, .org
  t = t.replace(/(^|[\s\-_,])\.com\b/gi, '$1');

  // Clean punctuation spacing without breaking hyphenated words like 12-Pack
  t = t.replace(/\s*([,;:!|])\s*/g, '$1 ')
       .replace(/\s+-\s+/g, ' - ')
       .replace(/([,;:|–—])\s*([,;:|–—])/g, '$1')
       .replace(/,\s*,+/g, ', ')
       .replace(/-\s*-+/g, '-')
       .replace(/\s{2,}/g, ' ')
       .replace(/^[\s,.;:!|/\-–—\\]+|[\s,.;:!|/\-–—\\]+$/g, '')
       .trim();
  return t.slice(0, 500);
}

// ── Smart Title & Brand Cleaner (Word Remover Chips & Live Preview) ──
function temuRenderWordChips() {
  const container = $('tgWordsChips');
  if (!container) return;
  const raw = $('tgWords')?.value || '';
  const words = raw.split(',').map(w => w.trim()).filter(Boolean);
  
  container.innerHTML = '';
  if (!words.length) {
    container.innerHTML = '<span class="title-cleaner-empty">Koi banned word set nahi hai. Upar word likh kar "+ Add" dabayein ya Preset select karein.</span>';
    temuUpdateWordPreview();
    return;
  }

  words.forEach((w, idx) => {
    const chip = document.createElement('span');
    chip.className = 'word-cleaner-chip';
    chip.innerHTML = `<span class="wc-text">${esc(w)}</span><button type="button" class="wc-del" data-idx="${idx}" title="Remove '${esc(w)}'">✕</button>`;
    chip.querySelector('.wc-del').addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      temuRemoveWordAt(idx);
    });
    container.appendChild(chip);
  });

  temuUpdateWordPreview();
}

function temuAddWords(newWordsArr) {
  const current = ($('tgWords')?.value || '').split(',').map(w => w.trim()).filter(Boolean);
  let added = false;
  newWordsArr.forEach(nw => {
    const clean = String(nw || '').trim();
    if (clean && !current.some(x => x.toLowerCase() === clean.toLowerCase())) {
      current.push(clean);
      added = true;
    }
  });
  if (added) {
    if ($('tgWords')) $('tgWords').value = current.join(', ');
    temuRenderWordChips();
  }
}

function temuRemoveWordAt(idx) {
  const current = ($('tgWords')?.value || '').split(',').map(w => w.trim()).filter(Boolean);
  if (idx >= 0 && idx < current.length) {
    current.splice(idx, 1);
    if ($('tgWords')) $('tgWords').value = current.join(', ');
    temuRenderWordChips();
  }
}

function temuUpdateWordPreview() {
  const raw = $('tgWords')?.value || '';
  const words = raw.split(',').map(w => w.trim()).filter(Boolean);
  const sample = 'Callaway Golf Chrome Tour Golf Balls 12-Pack Prime';
  const cfg = { title_remove_words: words };
  const cleaned = temuCleanTitle(sample, cfg);
  if ($('tgPrevBefore')) $('tgPrevBefore').textContent = sample;
  if ($('tgPrevAfter')) $('tgPrevAfter').textContent = cleaned || '(Empty Title)';
}

function temuInitWordRemoverEvents() {
  const wInput = $('tgWordInput');
  const wAddBtn = $('tgWordAddBtn');
  if (wInput && !wInput.dataset.bound) {
    wInput.dataset.bound = '1';
    const doAdd = () => {
      const val = wInput.value.trim();
      if (!val) return;
      const split = val.split(',').map(x => x.trim()).filter(Boolean);
      temuAddWords(split);
      wInput.value = '';
      wInput.focus();
    };
    wAddBtn?.addEventListener('click', doAdd);
    wInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        doAdd();
      }
    });
  }

  const qwInp = $('tckQuickWordInput');
  if (qwInp && !qwInp.dataset.bound) {
    qwInp.dataset.bound = '1';
    qwInp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        $('tckQuickWordBtn')?.click();
      }
    });
  }

  document.querySelectorAll('.preset-chip-btn').forEach(btn => {
    if (!btn.dataset.bound) {
      btn.dataset.bound = '1';
      btn.addEventListener('click', () => {
        const type = btn.dataset.preset;
        if (type === 'stores') {
          temuAddWords(['Amazon', 'Amazon.com', 'Walmart', 'Walmart.com', "Sam's Club", 'Costco', 'Target']);
        } else if (type === 'golf') {
          temuAddWords(['Callaway', 'Vice', 'Titleist', 'TaylorMade', 'Bridgestone', 'Srixon', 'Pinnacle']);
        } else if (type === 'claims') {
          temuAddWords(['Prime', 'Best Seller', 'Lifetime Warranty', 'Guaranteed', 'BPA Free', 'FSA Eligible', 'Priced per pound', 'Free Shipping']);
        }
      });
    }
  });
}

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

function temuPrice(src, cfg, itemWeight) {
  const p = parseFloat(String(src ?? '').replace(/[$,]/g, ''));
  if (!isFinite(p) || p <= 0) return [null, null];
  let base = p * (cfg.price_multiplier || 1.25);
  // v11: Min profit floor ($) — default $50 over sourcing cost. Ensures we always make at least $50 per item.
  const minProfit = isFinite(parseFloat(cfg.min_profit_dollar)) ? parseFloat(cfg.min_profit_dollar) : 50;
  if (minProfit > 0 && (base - p) < minProfit) {
    base = p + minProfit;
  }
  // v10.5.0: Heavy item shipping buffer ($) for items >= 2 lb
  const heavyBuf = parseFloat(cfg.heavy_shipping_buffer);
  const wtThresh = parseFloat(cfg.heavy_weight_threshold) || 2.0;
  const wt = parseFloat(itemWeight);
  if (isFinite(heavyBuf) && heavyBuf > 0 && isFinite(wt) && wt >= wtThresh) {
    base += heavyBuf;
  }
  // Minimum base price floor: if sourcing <= $2.5, floor is 69.99; otherwise min is 99 (or cfg.price_min)
  let minP = parseFloat(cfg.price_min) || 69.99;
  if (p <= 2.5) {
    minP = Math.min(minP, 69.99);
  } else if (minP < 99 && (!cfg.price_min || cfg.price_min === 60)) {
    minP = 99.0;
  }
  if (base < minP) base = minP;
  let list = base * (cfg.list_price_multiplier || 1.25);
  // v10.5.0: Smart .99 Rounding
  if (cfg.price_round_to_99 !== false) {
    base = Math.floor(base) + 0.99;
    list = Math.floor(list) + 0.99;
  }
  return [Math.round(base * 100) / 100, Math.round(list * 100) / 100];
}

// rows: bulk/master row objects → enriched Temu items + warnings
function temuEnrich(rows, cfg) {
  const items = [], usedSku = new Set(), seenSrc = new Set(), skipped = [];
  const d = cfg.defaults;
  rows.forEach((r, rowIdx) => {
    const title = temuCleanTitle(r.title, cfg) || String(r.title || '').trim() || ('Product ' + (rowIdx + 1));
    const url = r.url || '';
    if (!title || !url) { skipped.push((!url ? 'no url: ' : 'no title: ') + String(r.title || r.url || '?').slice(0, 40)); return; } // v9.7.2: chup-chaap drop nahi
    let uhost = ''; try { uhost = new URL(url).hostname; } catch (_) {}
    if (/temu\.com$/i.test(uhost) && !isTemuProductUrl(url)) { skipped.push('not a product (Temu page): ' + title.slice(0, 40)); return; }
    if (/^Temu\s*\|/i.test(title)) { skipped.push('not a product (Temu page): ' + title.slice(0, 40)); return; }
    if (/\/s\?k=|amazon\.[a-z.]+\/s\b|walmart\.com\/search|samsclub\.com\/s(\/|\?)/i.test(url)) { skipped.push('search page: ' + title.slice(0, 40)); return; }
    let sid = temuSourceId(url);
    if (!sid || !/^[A-Za-z0-9]{5,20}$/.test(sid)) {
      sid = String(url).replace(/\W+/g, '').slice(-10) || ('PRD' + String(rowIdx + 1).padStart(6, '0'));
    }
    const cleanVar = String(r.copyColor || r.color || r.variation || '').trim();
    const cleanTitle = String(r.title || '').trim();
    const srcKey = sid ? `${sid}|${cleanVar || cleanTitle.slice(0, 35)}` : (url || String(rowIdx));
    const isDup = seenSrc.has(srcKey);
    seenSrc.add(srcKey);
    if (isDup && !cfg._forReview && !cfg.allow_duplicates) {
      skipped.push('duplicate: ' + title.slice(0, 40));
      return;
    }
    const rec = temuListedMap()[(temuActiveStoreName() || 'default') + '|' + sid];
    const isAlreadyListed = !!rec;
    const skipListedSetting = $('tgSkipListedExport') ? $('tgSkipListedExport').checked : (cfg.skip_listed !== false);
    if (skipListedSetting && !cfg.allow_relist && !cfg._forReview) {
      if (rec) { skipped.push(`already listed (${rec.d}): ` + title.slice(0, 40)); return; }
    }

    // profile
    const tl = title.toLowerCase();
    let profName = '', prof = {};
    for (const [name, p] of Object.entries(cfg.category_profiles)) {
      if ((p.exclude || []).some(m => m && tl.includes(String(m).toLowerCase()))) continue;
      if ((p.match || []).some(m => m && tl.includes(String(m).toLowerCase()))) { profName = name; prof = p; break; }
    }
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
    if (r.copyColor) { color = String(r.copyColor).trim(); vtype = 'Color'; } // v10.2.0 Store Copy

    const goods = `${cfg.sku_prefix}-${sid}`;
    const vsfx = (color.replace(/[^A-Za-z0-9]+/g, '') || (isDup ? 'Dup' : 'Std')).slice(0, 10);
    let sku = `${goods}-${vsfx}`;
    let n = 2; while (usedSku.has(sku)) sku = `${goods}-${vsfx}-${n++}`;
    usedSku.add(sku);

    const num = (v, def) => { const x = parseFloat(v); return isFinite(x) && x > 0 ? Math.round(x * 10) / 10 : def; };
    const images = (Array.isArray(r.images) ? r.images : []).filter(u => /^https?:\/\//.test(u) && /\.(jpe?g|png)(\?|$)/i.test(u)).slice(0, cfg.max_sku_images);

    const warn = [];
    if (isDup) warn.push('DUPLICATE_SOURCE');
    if (!images.length) warn.push('NO_IMAGES');
    if (!brand) warn.push('NO_BRAND_MATCH');

    // weight: profile → title (smart) → scraped (0.1–8 lb) → global default; > max → skip
    let weight = (prof.weight_lb != null) ? prof.weight_lb : null, wsrc = weight != null ? 'profile' : '';
    if (weight == null && cfg.smart_weight !== false) {
      const tw = temuWeightFromTitle(title);
      if (tw) { weight = tw; wsrc = 'title'; }
      else { const sw = parseFloat(r.weight); if (isFinite(sw) && sw >= 0.1 && sw <= (cfg.max_weight_lb || 8)) { weight = Math.round(sw * 10) / 10; wsrc = 'scraped'; } }
    }
    if (weight == null) { weight = d.weight_lb; wsrc = 'default'; }
    const maxWt = parseFloat(cfg.max_weight_lb) || 0;
    if (maxWt > 0 && weight > maxWt) {
      warn.push('OVERWEIGHT');
    }
    if (wsrc === 'default') warn.push('DEFAULT_WEIGHT');

    let [base, list] = temuPrice(r.price, cfg, weight);
    if (r.temuBase) { // v10.2.0: Temu sheet ki base price as-is
      const tb = parseFloat(String(r.temuBase).replace(/[$,]/g, ''));
      if (isFinite(tb) && tb > 0) {
        base = Math.round(tb * 100) / 100;
        list = Math.round(base * (cfg.list_price_multiplier || 1.25) * 100) / 100;
        if (cfg.price_round_to_99 !== false) list = Math.floor(list) + 0.99;
      }
    }

    if (base === null) warn.push('NO_PRICE');
    if (!r.temuBase) { const pm = parseFloat(cfg.price_max) || 999; const sp = parseFloat(String(r.price ?? '').replace(/[$,]/g, '')); if (isFinite(pm) && pm > 0 && isFinite(sp) && sp > pm && sp > 999) warn.push('PRICE_ABSURD'); }
    if (r.copyCat && !profName) { const hit = Object.entries(cfg.category_profiles).find(([, p]) => String(p.category_keyword || '').toLowerCase() === String(r.copyCat).toLowerCase()); if (hit) { profName = hit[0]; prof = hit[1]; } else prof = { category_keyword: r.copyCat }; }
    if (!profName && !r.copyCat) warn.push('NO_CATEGORY_PROFILE');

    items.push({
      title, url, goods, sku, brand, trademark: tm, color, vtype, images, wsrc,
      category_keyword: prof.category_keyword || '',
      keyword_attributes: prof.keyword_attributes || '',
      group: temuProfileGroup(profName, prof), // v9.11.0
      base, list,
      source_price: r.price,
      qty: Math.floor(Math.random() * (cfg.quantity_max - cfg.quantity_min + 1)) + cfg.quantity_min,
      weight, dimL: prof.length_in ?? d.length_in,
      dimW: prof.width_in ?? d.width_in, dimH: prof.height_in ?? d.height_in,
      warn,
      isAlreadyListed,
      listedRecord: rec,
      isHistoryImport: !!r.isHistoryImport
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
  if (!keyCols['item_name']) throw new Error('item_name column missing — wrong template file?');
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
    // v9.7.6: reference_link khali — Temu sourcing link dekh kar kam price suggest karta tha
    put(r, 'brand', it.brand); put(r, 'trademark', it.trademark);
    let kwAttrs = it.keyword_attributes || '';
    if (it.attributes && typeof it.attributes === 'object') {
      const parts = [];
      if (it.attributes.material) parts.push(`Material: ${it.attributes.material}`);
      if (it.attributes.size) parts.push(`Size: ${it.attributes.size}`);
      if (it.attributes.color) parts.push(`Color: ${it.attributes.color}`);
      if (it.attributes.model) parts.push(`Model: ${it.attributes.model}`);
      if (it.attributes.pack_count && it.attributes.pack_count > 1) parts.push(`Quantity: ${it.attributes.pack_count}`);
      if (parts.length) {
        kwAttrs = kwAttrs ? `${kwAttrs}; ${parts.join('; ')}` : parts.join('; ');
      }
    }
    put(r, 'Keyword_attributes', kwAttrs);
    put(r, 'Variation_type_1', it.vtype || d.variation_theme);
    put(r, 'Variation_Variants_1', (it.attributes?.color || it.color || 'One Color'));
    if (it.images.length) {
      put(r, 'main_image_url', it.images[0]);
      it.images.slice(1, 10).forEach((u, i) => put(r, 'other_image_url', u, i));
    }
    put(r, 'map_price', it.base); put(r, 'list_price', it.list);
    put(r, 'quantity', it.qty);
    put(r, 'item_length', it.dimL); put(r, 'item_volume_unit', 'in');
    put(r, 'item_width', it.dimW); put(r, 'item_height', it.dimH);
    put(r, 'item_weight', it.weight); put(r, 'item_weight_unit', 'lb');
    { const pk = cfg.packaging || {}; // v9.8.0
      put(r, 'SKU_type', pk.sku_type); put(r, 'Individually_packed', pk.individually_packed);
      { const q = parseInt(pk.total_packaging_quantity, 10); if (q > 0) put(r, 'Total_packaging_quantity', q); }
      put(r, 'Packaging_unit', pk.packaging_unit); }
    put(r, 'shipping_template', d.shipping_template); put(r, 'handling_time', d.handling_time);
    put(r, 'fulfillment_channel', d.fulfillment_channel); put(r, 'origin_country', d.origin_country);
    r++;
  });
  range.e.r = Math.max(range.e.r, r - 1);
  ws['!ref'] = XLSX.utils.encode_range(range);
  return r - 4;
}

let TemuLast = null; // { bytes, items, skipped, n } from the last export
let TemuLibPick = null; // v9.6.1: Library tab se chune huay products {ids:Set, n}
let TemuSheetRows = null; // v9.7.0: Temu window mein import ki hui sheet ke rows

async function temuRunExport(opts = {}) {
  const rep = $('temuReport');
  const say = t => { if (rep) { rep.textContent = t; try { rep.scrollIntoView({ block: 'nearest' }); } catch (_) {} } };
  // v9.7.1: imported Temu file as-is — koi conversion nahi
  if (($('temuSource')?.value || '') === 'sheet' && TemuLast?.asIs) {
    if (opts.dryRun) return null;
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
    if ($('tgSkuType')) cfg.packaging = { sku_type: $('tgSkuType')?.value || '', individually_packed: $('tgIndPacked')?.value || '', total_packaging_quantity: ($('tgPackQty')?.value || '').trim(), packaging_unit: $('tgPackUnit')?.value || '' };
    { const lp = parseFloat($('tgListPx')?.value); if (isFinite(lp) && lp > 0) cfg.list_price_multiplier = lp; }
    { const mp = parseFloat($('tgMinPx')?.value); if (isFinite(mp) && mp >= 0) cfg.price_min = mp; }
    { const mx = parseFloat($('tgMaxPx')?.value); if (isFinite(mx) && mx >= 0) cfg.price_max = mx; }
    { const a = parseInt($('tgQtyMin')?.value, 10), b = parseInt($('tgQtyMax')?.value, 10); if (a > 0 && b >= a) { cfg.quantity_min = a; cfg.quantity_max = b; } }
    { const mw = parseFloat($('tgMaxW')?.value); if (isFinite(mw) && mw > 0) cfg.max_weight_lb = mw; }
    { const vv = $('tgVarValues')?.value; if (vv !== undefined && vv !== null && vv.trim()) cfg.simple_variation_values = vv.split(',').map(x => x.trim()).filter(Boolean); }
    { const px = parseFloat($('tgPx')?.value); if (isFinite(px) && px > 0) cfg.price_multiplier = px; }
    { const r99 = $('tgRound99'); if (r99) cfg.price_round_to_99 = !!r99.checked; }
    { const mpf = parseFloat($('tgMinProfit')?.value); if (isFinite(mpf) && mpf >= 0) cfg.min_profit_dollar = mpf; }
    { const hbf = parseFloat($('tgHeavyBuffer')?.value); if (isFinite(hbf) && hbf >= 0) cfg.heavy_shipping_buffer = hbf; }
    { const num = v => { const x = parseFloat(v); return isFinite(x) && x > 0 ? x : null; };
      const w = num($('tgW')?.value), l = num($('tgL')?.value), wd = num($('tgWd')?.value), ht = num($('tgH')?.value);
      if (w) cfg.defaults.weight_lb = w; if (l) cfg.defaults.length_in = l;
      if (wd) cfg.defaults.width_in = wd; if (ht) cfg.defaults.height_in = ht; }
    const source = $('temuSource')?.value || 'bulk';
    let rows = [];
    if (source === 'bulk') {
      // v10.3.2: Library ka chupke-se fallback khatam — "Last bulk hunt" = sirf bulk hunt ke products
      rows = (BulkState?.results || []).filter(x => x.status !== 'fail');
      if (!rows.length) { if (!opts.dryRun) { say('✗ Last bulk hunt mein 0 products hain.\n→ Bulk → "Hunt all open tabs" chalayen, ya "Products to export" mein Library select karein.'); toast('Bulk hunt khali — Library select karein', 'warn'); } return opts.dryRun ? null : undefined; }
    } else if (source === 'library_sel' && TemuLibPick?.ids) {
      rows = (await getMasterRows()).filter(r => TemuLibPick.ids.has(r.id));
    } else if (source === 'sheet' && TemuSheetRows) {
      rows = TemuSheetRows;
    } else {
      rows = await getMasterRows();
    }
    if (!rows.length) { say('✗ Export ke liye koi product nahi mila.\n→ Bulk tab → "Hunt all open tabs" chalayen (ya data source "Library" karein), phir dobara try karein.'); toast('No products — pehle hunt karein', 'warn'); return; }
    say('Converting ' + rows.length + ' products…');
    if (opts.dryRun || opts.forReview || opts.forUpload || $('tgPrecheck')?.checked) cfg._forReview = true;
    let { items, skipped } = opts.items ? { items: opts.items, skipped: opts.skipped || [] } : temuEnrich(rows, cfg);
    if (opts.dryRun) return { items, skipped, cfg, rows };
    // v9.12.3: check panel ke bina upload → ghalat (absurd) price wale products bahar (Temu "abnormal price" violation)
    if (opts.dropAbsurd) { const bad = items.filter(it => (it.warn || []).includes('PRICE_ABSURD') && it.base > (parseFloat(cfg.price_max) || 999)); if (bad.length) { items = items.filter(it => !bad.includes(it)); bad.forEach(it => skipped.push(`price ghalat ($${it.base}): ` + String(it.title || '').slice(0, 40))); } }
    if (!items.length) {
      say('Koi naya product nahi:\n' + (skipped.length ? skipped.map(x => '• ' + x).join('\n') : '(list khali hai)') +
        '\n\nAgar dobara list karna hai to "Pehle se listed" checkbox off karein.');
      return;
    }
    const wb = XLSX.read(b64, { type: 'base64', cellStyles: true });
    const n = temuFillTemplate(wb, items, cfg);
    const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx', cellStyles: true });
    TemuLast = { bytes: out, items, skipped, n, marked: false };
    // v9.3.1: listed-history ab sirf CONFIRMED upload ke baad mark hoti hai (export-only par nahi).
    { const mb = $('temuMarkListedBtn'); if (mb) { mb.hidden = !!opts.forUpload; mb.textContent = `Listed mark karo (${n})`; } }
    zhSaveBlob(new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'temu_upload.xlsx');
    if (!opts.forUpload) { try { await temuHistAdd({ kind: 'export', store: temuActiveStoreName() || '—', n, skipped: skipped.length, source: $('temuSource')?.selectedOptions?.[0]?.textContent || '', items: temuHistItems(items), skippedList: skipped.slice(0, 300) }); } catch (_) {} }
    const lines = items.map(it => `${it.sku}  ${it.brand || '—'}  ${it.vtype || 'Color'}: ${it.color}  ${it.weight}lb(${it.wsrc || '?'})  img=${it.images.length}  $${it.base ?? '—'}${it.warn.length ? '  ⚠ ' + it.warn.join(',') : ''}`);
    say(`✓ ${n} products → temu_upload.xlsx\n` + (skipped.length ? `Skipped: ${skipped.length} (${skipped.slice(0,3).join('; ')}${skipped.length>3?'…':''})\n` : '') + lines.join('\n'));
    toast(`Temu file ready — ${n} products`, 'ok');
    temuUpdateSrcInfo();
  } catch (e) {
    say('ERROR: ' + (e?.message || e));
    toast('Temu export failed', 'err');
  }
}


// ── v9.10.0 Pipeline stepper (Export → Upload → Confirm → Errors → Fix drafts) ──
function temuStep(name, state, note) {
  const box = $('temuSteps'); if (!box) return;
  box.hidden = false;
  const el = box.querySelector(`.tstep[data-step="${name}"]`); if (!el) return;
  el.className = 'tstep ' + (state || 'idle');
  const n = el.querySelector('.tstep-note'); if (n) n.textContent = note || '';
  const r = el.querySelector('.tstep-retry'); if (r) r.hidden = !(state === 'bad' || state === 'warn');
}
function temuStepsReset(show) {
  const box = $('temuSteps'); if (!box) return;
  box.querySelectorAll('.tstep').forEach(el => {
    el.className = 'tstep idle';
    const n = el.querySelector('.tstep-note'); if (n) n.textContent = '—';
    const r = el.querySelector('.tstep-retry'); if (r) r.hidden = true;
  });
  box.hidden = !show;
}
async function temuStepRetry(name) {
  if (name === 'prep') return temuUpdateSrcInfo();
  if (name === 'export') return temuAutoUpload({});
  if (name === 'upload') { if (!TemuLast) return temuAutoUpload({}); TemuLast.fromCheck = true; return temuAutoUpload({ skipCheck: true }); }
  if (name === 'fix') {
    temuStep('fix', 'run', 'Drafts fix…');
    await temuFixDrafts();
    await temuFillAttributes();
    temuStep('fix', 'ok', 'Live');
    return;
  }
}

let TemuUploading = false;
let TemuUploadCancelled = false;

async function temuAutoUpload(opts = {}) {
  const rep = $('temuReport');
  const say = t => { if (rep) { rep.textContent = t; try { rep.scrollIntoView({ block: 'nearest' }); rep.scrollTop = rep.scrollHeight; } catch (_) {} } };
  
  TemuUploading = true;
  TemuUploadCancelled = false;
  temuStopShow(true);

  try {
    // v9.8.0: upload se pehle check panel (flags + price/category edit) — jab tak user "Upload" na dabaye, kuch nahi jata
    let drItems = null;
    if (!opts.skipCheck && !TemuLast?.fromCheck && ($('tgPrecheck')?.checked !== false)) {
      const dr = await temuRunExport({ dryRun: true, forUpload: true });
      if (dr && dr.items) {
        drItems = dr.items;
        if (!dr.items.length) { say('Koi naya product nahi:\n' + (dr.skipped.length ? dr.skipped.map(x => '• ' + x).join('\n') : '(list khali hai)') + '\n\nAgar dobara list karna hai to "Skip already listed" off karein.'); toast('Koi product nahi — sab skipped', 'warn'); return; }
        const anyFlag = dr.items.some(it => temuCheckFlags(it, dr.cfg).some(f => f.k === 'bad' || f.k === 'warn'));
        if (!anyFlag) { say(`✓ Check: ${dr.items.length} products saaf (koi flag nahi) — seedha upload…`); toast(`${dr.items.length} products saaf — upload ho raha hai`, 'ok'); }
        else { temuCheckRender(dr.items, dr.skipped, dr.cfg, dr.rows); return; }
      }
      if (!dr && !TemuLast?.asIs) return; // template/store error ya bulk khali — message already shown; asIs (sheet) mode mein null expected hai
    }
    if (TemuUploadCancelled) { say('\n🛑 Upload cancelled by user.'); temuStep('upload', 'bad', 'Cancelled'); return; }
    if (TemuLast?.fromCheck) TemuLast.fromCheck = false;
    temuStepsReset(true);
    const totalCount = (opts.items || drItems || TemuLast?.items || []).length || (BulkState?.results || []).length || 1;
    temuStep('prep', 'ok', `${totalCount} products`);
    temuStep('export', 'run', 'Building .xlsx…');
    // v9.10.0: store auto-detect
    try { const det = await temuDetectStore({ apply: true }); if (det?.switched) say(`✓ Store auto: Temu tab par "${det.mall}" khula hai — active store switch kar diya`); else if (det?.unknown) { say(`✗ Temu tab par store "${det.mall}" khula hai jo extension mein add nahi — pehle "+ Add" se add karein`); temuStep('export', 'bad', 'store?'); return; } } catch (_) {}
    // Build fresh if nothing exported yet in this session
    if (!TemuLast) { await temuRunExport({ forUpload: true, dropAbsurd: true }); }
    if (TemuUploadCancelled) { say('\n🛑 Upload cancelled by user.'); temuStep('upload', 'bad', 'Cancelled'); return; }
    if (!TemuLast) { temuStep('export', 'bad', 'fail'); return; }
    temuStep('export', 'ok', `${TemuLast.n || TemuLast.items?.length || 0} ready`);
    temuStep('upload', 'run', 'Temu tab…');
    { const mb = $('temuMarkListedBtn'); if (mb) mb.hidden = true; }
    const bg = temuGetCfg().upload_in_background !== false;
    say((rep?.textContent || '') + (bg ? '\n\nTemu tab khul raha hai — processing poori hote hi focus wapas aap ke tab par aa jayega…' : '\n\nTemu page khul raha hai…'));

    const u8 = new Uint8Array(TemuLast.bytes);
    let bin = '';
    for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    const b64 = btoa(bin);
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
    const onProg = (m) => {
      if (m?.action === 'TEMU_UPLOAD_PROGRESS' && rep) {
        rep.textContent = base + '\n' + fmtProg(m);
        try {
          const p = m;
          if (p.phase === 'uploading') temuStep('upload', 'run', `${p.secs || 0}s`);
          else if (p.phase === 'accepted') temuStep('upload', 'run', 'Processing…');
          else if (p.phase === 'processing' || p.phase === 'finishing') temuStep('upload', 'run', p.pct != null ? `${p.pct}%` : 'Processing…');
        } catch (_) {}
      }
    };
    try { chrome.runtime.onMessage.addListener(onProg); } catch (_) {}
    let result;
    try {
      if (TemuUploadCancelled) { say('\n🛑 Upload cancelled by user.'); temuStep('upload', 'bad', 'Cancelled'); return; }
      result = await msg({ action: 'TEMU_AUTO_UPLOAD', b64, filename: 'temu_upload.xlsx', expectStore: temuActiveStoreName(), background: bg });
    }
    finally { try { chrome.runtime.onMessage.removeListener(onProg); } catch (_) {} }
    if (TemuUploadCancelled) { say('\n🛑 Upload cancelled by user.'); temuStep('upload', 'bad', 'Cancelled'); return; }
    if (rep) rep.textContent = base;
    if (!result?.success) {
      const isStoreErr = (result?.report || []).some(r => /ghalat store/i.test(r));
      temuStep('upload', 'bad', isStoreErr ? 'Store mismatch' : 'Upload fail');
      if (isStoreErr) toast('Store mismatch: Temu tab par aur store khula hai', 'warn');
    }
    if (result?.success && !result?.confirmed) {
      temuStep('upload', 'run', 'Confirming…');
      const late = await temuLateConfirm(result, rep);
      if (late) { result.confirmed = true; result.report = [...(result.report || []), `✓ Late confirm — ${late.status}: ${late.processed ?? '?'} records processed, ${late.added ?? '?'} added, ${late.errors ?? '?'} errors` + (late.uploadId ? ` (ID ${late.uploadId})` : '')]; }
    }
    const rl = (result?.report || []).join('\n');
    const rm = rl.match(/(\d+) records processed, (\d+) added, (\d+) errors/);
    try { const im = rl.match(/ID (\d{13,20})/); if (im && TemuLast) TemuLast.uploadId = im[1]; } catch (_) {}
    const summary = result?.success
      ? (result?.confirmed
          ? (rm ? `→ Upload ho gaya: ${rm[2]} products add huay${+rm[3] > 0 ? `, ${rm[3]} mein error (Temu tab → "View processing results")` : ', 0 errors'}.`
                : '→ Upload ho gaya. Temu tab peeche khula hai — Upload history mein result wahan dekhein.')
          : '→ File attach ho gayi lekin confirm nahi hua — Temu tab check karein.')
      : '→ Manually upload kar lein (file Download folder mein hai).';
    say((rep?.textContent || '') + '\n' + (result?.report || []).join('\n') + '\n' + summary);
    try {
      const idm = rl.match(/ID (\d{13,20})/);
      await temuHistAdd({ kind: 'upload', store: temuActiveStoreName() || '—', n: TemuLast.items.length, skipped: (TemuLast.skipped || []).length,
        source: $('temuSource')?.selectedOptions?.[0]?.textContent || '', confirmed: !!(result?.success && result?.confirmed), uploadId: idm ? idm[1] : '',
        added: rm ? +rm[2] : null, errors: rm ? +rm[3] : null, items: temuHistItems(TemuLast.items), skippedList: (TemuLast.skipped || []).slice(0, 300) });
    } catch (_) {}
    if (result?.success && result?.confirmed) {
      temuStep('upload', 'ok', rm ? `${rm[2]} added` : 'Confirmed');
      if (!TemuLast.marked) { await temuMarkListed(TemuLast.items); TemuLast.marked = true; }
      say((rep?.textContent || '') + `\n✓ ${TemuLast.items.length} products listed-history mein save`);
      temuUpdateSrcInfo();
      // One-click pipeline: Fix drafts + missing attributes
      const hasErrors = rm ? +rm[3] > 0 : false;
      const isClean = rm ? +rm[3] === 0 : false;
      if (isClean) {
        say((rep?.textContent || '') + '\n✓ Sab products kamyabi se upload ho gaye (0 errors) — drafts fill karne ki zaroorat nahi!');
        temuStep('fix', 'ok', 'Clean (0 errors)');
      } else if (($('tgAutoFix')?.checked ?? (temuGetCfg().auto_fix_after_upload !== false)) && hasErrors) {
        const idm = rl.match(/ID (\d{13,20})/);
        const upId = idm ? idm[1] : (result.uploadId || TemuLast?.uploadId || null);
        say((rep?.textContent || '') + `\n⏳ ${rm[3]} products mein error/drafts hain — Temu processing results check kar raha hoon…`);
        temuStep('fix', 'run', 'Checking drafts…');

        // Step 1: Read the actual failure reasons from Temu Processing results first
        const failedRes = await temuReadFailed({ tabId: result.tabId ?? null, uploadId: upId, silent: true });
        const failedList = failedRes?.failed || [];

        const dupOnly = failedList.length > 0 && failedList.every(f => f.duplicate);
        const hasMissingAttrs = failedList.some(f => f.missingAttributes || (!f.duplicate && !f.priceIssue));

        if (dupOnly) {
          // All drafts are duplicate SKUs (already listed on store)!
          // They DO NOT have missing attributes, so opening product-action.html would show 0 products and fail.
          say((rep?.textContent || '') + `\n✓ Tamam error products pehle se store par list hain (Duplicate SKU) — inhen listed-history mein save kar diya.`);
          temuStep('fix', 'ok', 'Duplicates Skipped');
          toast(`${failedList.length} duplicate product(s) — store par pehle se listed`, 'ok');
        } else {
          // There are genuine missing attributes or uninspected errors — run Fix Drafts
          say((rep?.textContent || '') + `\n⏳ Products ke missing attributes complete karne ja raha hoon…`);
          const fx = await temuOpenCompleteAndFix({ tabId: result.tabId ?? null, uploadId: upId });
          let attrOk = true;
          if (hasMissingAttrs || !failedList.length) {
            attrOk = await temuFillAttributes();
          }
          const allDone = !!(fx && attrOk);
          temuStep('fix', allDone ? 'ok' : 'warn', allDone ? 'Live' : 'Action Needed');
        }
      } else {
        temuStep('fix', 'skip', 'Ready');
      }
      bulkNextRender('uploaded'); hdrStoreRender();
    } else {
      say((rep?.textContent || '') + '\n(Upload unconfirmed — products listed mark nahi kiye)');
      if (result?.success) temuStep('upload', 'bad', 'Unconfirmed');
      const mb = $('temuMarkListedBtn'); if (mb) { mb.hidden = false; mb.textContent = `Listed mark karo (${TemuLast.items.length})`; }
    }
    toast(result?.success ? 'File Temu par upload ho gayi' : 'Auto-upload fail', result?.success ? 'ok' : 'warn');
  } catch (e) {
    say((rep?.textContent || '') + '\n✗ ' + (e?.message || e));
    temuStep('upload', 'bad', 'Error');
  } finally {
    TemuUploading = false;
    temuStopShow(false);
  }
}

// ── v9.8.0 Pre-upload check: har product ke flags, price/category edit, unselect → phir upload ──
let TemuCheck = null; // { items, skipped, cfg }
// v9.11.0 — profile name → Temu top-level category group (brand approval ke liye)
const TEMU_PROFILE_GROUPS = {
  golf_balls: 'sports', towels: 'kitchen', hangers: 'kitchen', bowls: 'kitchen', cups: 'kitchen', cutlery: 'kitchen',
  swim_diapers: 'baby', diapers: 'baby', baby_wipes: 'baby', baby_lotion: 'baby',
  disinfectant_wipes: 'household', trash_bags: 'household', napkins: 'household', box_tissues: 'household', cleansing_wipes: 'beauty',
  paper_towels: 'household', paper_plates: 'household', plastic_plates: 'household', dish_soap: 'household', rinse_aids: 'household',
  bleach: 'household', toilet_cleaners: 'household', sponges: 'household', cleaning_cloths: 'household',
  chips: 'grocery', crackers: 'grocery', jerky: 'grocery', fruit_snacks: 'grocery', ground_coffee: 'grocery', string_cheese: 'grocery',
  olive_oil: 'grocery', baked_beans: 'grocery', kidney_beans: 'grocery', pinto_beans: 'grocery', black_beans: 'grocery', pasta_sauce: 'grocery',
  canned_corn: 'grocery', green_beans: 'grocery'
};
function temuProfileGroup(name, prof) { return (prof && prof.group) || TEMU_PROFILE_GROUPS[name] || ''; }
// v9.12.0 Temu top-level category name → group token
const TEMU_CAT_GROUPS = [
  [/sports/i, 'sports'], [/home\s*&\s*kitchen/i, 'kitchen'], [/grocery/i, 'grocery'], [/health\s*&\s*household|household/i, 'household'],
  [/pet/i, 'pets'], [/baby/i, 'baby'], [/beauty|personal care/i, 'beauty'], [/toys/i, 'toys'], [/electronics/i, 'electronics'],
  [/tools|home improvement/i, 'tools'], [/automotive/i, 'automotive'], [/office/i, 'office'], [/clothing|apparel|shoes/i, 'clothing'],
  [/patio|lawn|garden/i, 'garden'], [/arts|crafts|sewing/i, 'crafts'], [/industrial|scientific/i, 'industrial'], [/musical/i, 'music'], [/appliances/i, 'appliances'], [/cell phones/i, 'phones'], [/video games/i, 'games'], [/books|movies|music/i, 'media']
];
function temuCatGroup(name) { for (const [re, g] of TEMU_CAT_GROUPS) if (re.test(name)) return g; return String(name || '').toLowerCase().replace(/\(.*$/, '').replace(/[^a-z]+/g, ' ').trim().split(' ')[0] || 'other'; }
// rule → units for a group (per-group `cats` pehle, phir purana single `units`)
function temuRuleUnits(rule, group) { if (!rule) return null; if (rule.cats && group && rule.cats[group] != null) return rule.cats[group]; return rule.units ?? null; }
// brand rule lookup (case-insensitive) → { groups, units } | null
function temuBrandRule(cfg, brand) {
  if (!brand) return null;
  const rules = cfg.brand_rules || {}; const b = String(brand).toLowerCase();
  for (const [k, v] of Object.entries(rules)) if (k.toLowerCase() === b) return v || null;
  return null;
}
// "BRAND: group1, group2 | units N" lines ⇄ object
// "BRAND: kitchen(59), grocery(58)" — group ke baad (units) optional; purana "| units N" bhi chalta hai
function temuBrandRulesToText(rules) {
  return Object.entries(rules || {}).map(([b, r]) => {
    const parts = (r.groups || []).map(g => { const u = temuRuleUnits(r, g); return u != null && r.cats ? `${g}(${u})` : g; });
    return `${b}: ${parts.join(', ')}${(!r.cats && r.units != null) ? ` | units ${r.units}` : ''}`;
  }).join('\n');
}
function temuBrandRulesFromText(txt) {
  const out = {};
  String(txt || '').split('\n').map(l => l.trim()).filter(Boolean).forEach(l => {
    const m = l.match(/^([^:]+):\s*([^|]*)(?:\|\s*units?\s*(\d+))?\s*$/i); if (!m) return;
    const b = m[1].trim().toUpperCase(); if (!b) return;
    const groups = [], cats = {}; let anyCats = false;
    m[2].split(',').map(x => x.trim()).filter(Boolean).forEach(tok => { const gm = tok.match(/^([a-z][a-z_ -]*?)\s*(?:\((\d+)\))?$/i); if (!gm) return; const g = gm[1].trim().toLowerCase(); groups.push(g); if (gm[2] != null) { cats[g] = +gm[2]; anyCats = true; } });
    out[b] = { groups, units: m[3] != null ? +m[3] : null, ...(anyCats ? { cats } : {}) };
  });
  return out;
}
function temuCheckFlags(it, cfg) {
  const f = [];
  // v9.11.0 brand approval guard
  { const rule = temuBrandRule(cfg, it.brand);
    if (it.brand && rule) {
      // v9.12.2: units ka flag hata diya — units orders se kam hote hain, snapshot purana ho sakta hai; user Temu par khud dekhe. Sirf category approval check.
      if (it.group && rule.groups?.length && !rule.groups.includes(it.group)) f.push({ k: 'bad', t: `${it.brand} ✗ ${it.group}`, tip: `Is store par ${it.brand} sirf ${rule.groups.join(', ')} ke liye approved hai — ${it.group} product violation se removed hoga` });
      else if (!it.group && rule.groups?.length) f.push({ k: 'warn', t: `${it.brand}: category?`, tip: `Brand approval sirf ${rule.groups.join(', ')} — is product ki category pata nahi, khud check karein` });
    } else if (it.brand) f.push({ k: 'warn', t: `${it.brand}: approval?`, tip: 'Ye brand Settings → Brand approvals list mein nahi — Temu par trademark approval hai? Warna removed hoga' });
  }
  const w = it.warn || [];
  if (w.includes('NO_IMAGES') || !(it.images || []).length) f.push({ k: 'bad', t: 'no images', tip: 'Koi image nahi — Temu reject karega' });
  else if ((it.images || []).length < 3) f.push({ k: 'warn', t: `${it.images.length} imgs`, tip: '3 se kam images — Temu min 3 recommend karta hai' });

  if (w.includes('NO_PRICE') || it.base == null || it.base <= 0) {
    f.push({ k: 'bad', t: 'no price', tip: 'Selling price nahi mili ya zero hai' });
  } else if (it.base > (parseFloat(cfg.price_max) || 999)) {
    f.push({ k: 'warn', t: `$${it.base}`, tip: `High price: $${it.base}` });
  } else {
    const lo = Math.max(cfg.price_alert_low || 3, parseFloat(cfg.price_min) || 0);
    if (it.base < lo) f.push({ k: 'warn', t: `$${it.base} low`, tip: 'Price minimum se kam hai' });
  }
  if (w.includes('DUPLICATE_SOURCE')) {
    f.push({ k: 'info', t: 'dupe link', tip: 'Same source link se aik aur product maujood hai (unique variation SKU assigned)' });
  }

  // Weight check (Temu requires valid shipping weight)
  const wt = parseFloat(it.weight);
  const maxWt = parseFloat(cfg?.max_weight_lb) || 0;
  if (!wt || wt <= 0) f.push({ k: 'bad', t: 'no weight', tip: 'Weight missing hai — Temu file reject kar dega' });
  else if (w.includes('OVERWEIGHT') || (maxWt > 0 && wt > maxWt)) f.push({ k: 'warn', t: `⚖️ ${wt} lb (heavy)`, tip: `Configured limit (${maxWt} lb) se zyada hai — edit weight or proceed` });
  else if (w.includes('DEFAULT_WEIGHT') || it.wsrc === 'default') f.push({ k: 'info', t: `${it.weight} lb default`, tip: 'Weight default lag raha hai' });

  // Title check (Temu title max limit)
  const tlen = (it.title || '').trim().length;
  if (!tlen) f.push({ k: 'bad', t: 'no title', tip: 'Title missing hai' });
  else if (tlen > 140) f.push({ k: 'bad', t: `${tlen} chars`, tip: 'Title 140 chars se bara hai — Temu reject karega' });
  else if (tlen > 120) f.push({ k: 'warn', t: `${tlen} chars`, tip: 'Title 120 chars se bara hai — Temu standard 120 chars hai' });

  // Banned words & IP risk check in title
  const removeWords = (cfg.title_remove_words || []).filter(Boolean);
  const tLower = ' ' + (it.title || '').toLowerCase() + ' ';
  const matchedBanned = removeWords.find(w => {
    const escW = w.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp('(^|[\\s,.;:!|/\\-])' + escW + '(?=[\\s,.;:!|/\\-]|$)', 'i').test(tLower);
  });
  if (matchedBanned) {
    f.push({ k: 'ip', t: `🛡️ ${matchedBanned}`, tip: `Title mein banned/IP lafz "${matchedBanned}" mila — "Clean Titles" se remove karein` });
  }

  if (w.includes('NO_CATEGORY_PROFILE') || !it.category_keyword) f.push({ k: 'warn', t: 'no category', tip: 'Category profile match nahi — Temu khud category lagayega' });
  if (w.includes('NO_BRAND_MATCH')) f.push({ k: 'info', t: 'no brand', tip: 'Brand blank jayega' });

  // pehle se listed?
  const sid = it.sid || temuSourceId(it.url), me = temuActiveStoreName() || 'default';
  const rec = it.listedRecord || temuListedMap()[me + '|' + sid];
  if (it.isAlreadyListed || rec) {
    const dStr = rec?.d ? ` (${rec.d})` : '';
    if (it._relist || it._aiOptimized) {
      f.push({ k: 'ok', t: '✨ Ready to Re-list', tip: `AI Rewritten title & naya SKU tayyar hai${dStr}.` });
    } else {
      f.push({ k: 'warn', t: 'Already Listed', tip: `Is store par pehle list ho chuka hai${dStr}. AI Title rewrite karke naye SKU ke sath re-list karein.` });
    }
  } else {
    // doosre store mein pehle se listed?
    const others = Object.keys(temuListedMap()).filter(k => k.endsWith('|' + sid) && k.split('|')[0] !== me).map(k => k.split('|')[0]);
    if (others.length) f.push({ k: 'info', t: 'listed: ' + others.slice(0, 2).join(', '), tip: 'Doosre store mein pehle se listed hai' });
  }
  return f;
}

function renderTckImgSlots(it, itemIdx) {
  let imgs = Array.isArray(it.images) && it.images.length > 0 ? it.images : (it.image ? [it.image] : []);
  if (!imgs.length) imgs = [''];
  return imgs.map((imgUrl, sIdx) => {
    const isMain = sIdx === 0;
    const badgeTxt = isMain ? '⭐ Slot 1 (Main Hero)' : `Slot ${sIdx + 1}`;
    return `<div class="tck-img-slot" data-i="${itemIdx}" data-slot="${sIdx}">
      <div class="tck-slot-badge ${isMain ? 'main' : ''}">
        <span>${badgeTxt}</span>
        ${!isMain ? `<button type="button" class="temu-link-btn tck-slot-act-main" data-i="${itemIdx}" data-slot="${sIdx}" title="Make this the Main Image">⭐ Make Main</button>` : ''}
      </div>
      <div class="tck-slot-thumb-wrap">
        <img class="tck-slot-thumb" src="${esc(imgUrl || '')}" alt="" onerror="this.src='data:image/svg+xml,<svg xmlns=\\'http://www.w3.org/2000/svg\\' viewBox=\\'0 0 100 100\\'><text y=\\'.9em\\' font-size=\\'90\\'>🖼️</text></svg>'">
      </div>
      <div class="tck-slot-acts">
        <button type="button" class="btn btn-ghost btn-xs tck-slot-act-btn tck-flow-btn" data-i="${itemIdx}" data-slot="${sIdx}" title="Open Flow AI and link this slot">🎨 Edit in Flow</button>
        <button type="button" class="btn btn-ghost btn-xs tck-slot-act-btn tck-paste-btn" data-i="${itemIdx}" data-slot="${sIdx}" title="Paste image URL from clipboard">📋 Paste</button>
        <button type="button" class="btn btn-ghost btn-xs tck-slot-act-btn btn-danger tck-del-img-btn" data-i="${itemIdx}" data-slot="${sIdx}" title="Delete image">✕</button>
      </div>
    </div>`;
  }).join('') + `<div class="tck-img-add-card" data-i="${itemIdx}"><span>➕</span><b>Add Image</b></div>`;
}

async function handleFlowImageCaptured(url) {
  if (!url) return;
  let target = null;
  try {
    const res = await chrome.storage.local.get('flowActiveTarget');
    target = res?.flowActiveTarget;
  } catch (_) {}
  if (!target || target.itemIdx == null || target.slotIdx == null) {
    toast('Image captured from Flow, but no active product slot selected in ZHunter', 'warn');
    return;
  }
  const i = target.itemIdx, slot = target.slotIdx;
  if (!TemuCheck?.items || !TemuCheck.items[i]) {
    toast('Active product not found in current review session', 'warn');
    return;
  }
  const it = TemuCheck.items[i];
  it.images = Array.isArray(it.images) && it.images.length > 0 ? it.images : [it.image || ''];
  it.images[slot] = url;
  if (slot === 0) it.image = url;
  const list = $('temuCheckList');
  if (list) {
    const slotsEl = list.querySelector(`.tck-img-slots[data-i="${i}"]`);
    if (slotsEl) slotsEl.innerHTML = renderTckImgSlots(it, i);
    const row = list.querySelector(`.tck-row[data-i="${i}"]`);
    if (row) {
      const imgBtn = row.querySelector('.tck-img-btn');
      if (imgBtn) imgBtn.textContent = `🖼️ ${(it.images || []).length || 1} imgs ▾`;
      const mainThumb = row.querySelector('.tck-thumb');
      const firstImg = it.images?.[0] || it.image;
      if (mainThumb && firstImg) mainThumb.src = firstImg;
    }
  }
  saveTemuCheckSession();
  toast(`✓ Slot ${slot + 1} updated with Flow AI image!`, 'ok');
}

function temuCheckRender(items, skipped, cfg, rows) {
  TemuCheck = { items, skipped, cfg, showAll: true, rows: rows || TemuCheck?.rows || null, view: { filter: 'all', q: '', hideClean: null, minimized: false } };
  const card = $('temuCheckCard'), list = $('temuCheckList'); if (!card || !list) return;
  const acts = document.querySelector('.temu-actions'); if (acts) acts.style.display = 'none';
  temuReviewMode(true);
  const skipBox = $('temuSkippedBox');
  if (skipBox) {
    if (skipped && skipped.length > 0) {
      skipBox.hidden = false;
      skipBox.innerHTML = `<div class="tck-skipped-head" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;"><span style="font-weight:600;font-size:11px;color:var(--tck-ink-2,#aab4c0);">${skipped.length} skipped before review</span><button type="button" class="btn btn-ghost btn-xs" id="tckToggleSkippedBtn" style="font-size:10px;padding:2px 6px;">Show Details ▼</button></div><div class="tck-skipped-list" id="tckSkippedDetails" style="display:none;max-height:120px;overflow-y:auto;font-size:11px;color:#94a3b8;border-top:1px solid rgba(255,255,255,0.06);padding-top:6px;">${skipped.map(s => `<div style="margin-bottom:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">• ${esc(typeof s === 'object' ? s.text || s.reason || JSON.stringify(s) : String(s))}</div>`).join('')}</div>`;
      const btn = $('tckToggleSkippedBtn');
      if (btn) {
        btn.addEventListener('click', () => {
          const det = $('tckSkippedDetails');
          if (det) {
            const isHidden = det.style.display === 'none';
            det.style.display = isHidden ? 'block' : 'none';
            btn.textContent = isHidden ? 'Hide Details ▲' : 'Show Details ▼';
          }
        });
      }
    } else {
      skipBox.hidden = true;
      skipBox.innerHTML = '';
    }
  }
  const cats = Object.values(cfg.category_profiles || {}).map(p => p.category_keyword).filter(Boolean);
  const catSet = [...new Set(cats)];
  list.innerHTML = items.map((it, i) => {
    const flags = temuCheckFlags(it, cfg);
    const bad = flags.some(f => f.k === 'bad');
    const opts = ['<option value="">— category —</option>'].concat(catSet.map(c => `<option value="${esc(c)}"${c === it.category_keyword ? ' selected' : ''}>${esc(c)}</option>`));
    if (it.category_keyword && !catSet.includes(it.category_keyword)) opts.push(`<option value="${esc(it.category_keyword)}" selected>${esc(it.category_keyword)}</option>`);
    const clean = !flags.some(f => f.k === 'bad' || f.k === 'warn');
    const thumb = it.images?.[0] || it.image || '';
    const titleLen = (it.title || '').length;
    const lenCls = titleLen > 140 ? 'bad' : titleLen > 120 ? 'warn' : '';
    const isH = it.warn?.includes('OVERWEIGHT') || (parseFloat(cfg?.max_weight_lb) > 0 && parseFloat(it.weight) > parseFloat(cfg.max_weight_lb));
    const collapsed = it._uiCollapsed != null ? it._uiCollapsed : clean; // v11.1.0: clean products auto-collapse by default, click row to expand
    return `<div class="tck-row${bad ? ' tck-bad' : ''}${clean ? ' tck-clean' : ''}${collapsed ? ' tck-collapsed' : ''}" data-i="${i}" data-bad="${bad}" data-warn="${flags.some(f => f.k === 'warn')}" data-clean="${clean}" data-heavy="${isH}" data-ai="${!!it._aiOptimized}">
      <label class="tck-chk"><input type="checkbox" class="tck-on" data-i="${i}" ${bad ? '' : 'checked'}></label>
      <img class="tck-thumb" src="${esc(thumb)}" alt="" loading="lazy" decoding="async" onerror="this.style.opacity='0.2';this.src='data:image/svg+xml,<svg xmlns=\\'http://www.w3.org/2000/svg\\' viewBox=\\'0 0 100 100\\'><text y=\\'.9em\\' font-size=\\'90\\'>📦</text></svg>'">
      <div class="tck-main">
        <div class="tck-title-row">
          <input class="inp tck-title-inp" data-i="${i}" value="${esc(it.title || '')}" title="Click to edit title">
          <span class="tck-chars ${lenCls}" title="Title length (Temu standard ≤ 120)">${titleLen}/120</span>
          <button type="button" class="btn btn-ghost btn-xs tck-ai-row-btn" data-i="${i}" title="AI se ye title optimize karein">AI</button>
          <span class="tck-mini tck-mini-price">$${esc(String(it.base ?? ''))}</span>
          <span class="tck-mini tck-mini-cat">${esc(it.category_keyword || '\u2014')}</span>
          <button type="button" class="tck-row-toggle" data-i="${i}" title="${collapsed ? 'Expand' : 'Collapse'} product details" aria-label="Toggle product details"><svg class="i i-xs" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg></button>
        </div>
        <div class="tck-details">
        <div class="tck-meta">
          ${flags.filter(f => f.k !== 'info').map(f => `<span class="tck-flag tck-${f.k}" title="${esc(f.tip)}">${esc(f.t)}</span>`).join('')}
          <span class="tck-sku">${esc(it.sku || '')}</span>
          <span class="tck-badge tck-cost" title="Original Cost">Cost: ${(it.source_price ?? it.cost) ? (String(it.source_price ?? it.cost).trim().startsWith('$') ? esc(String(it.source_price ?? it.cost).trim()) : '$' + esc(String(it.source_price ?? it.cost).trim())) : '—'}</span>
          <span class="tck-badge tck-badge-weight" title="Shipping weight">${it.weight || 1.4} lb</span>
          <button type="button" class="tck-img-btn" data-i="${i}" title="View and edit product images in Flow AI">🖼️ ${(it.images || []).length || 1} imgs ▾</button>
          <span class="tck-dim">${esc(it.color || '')}${it.brand ? ' · ' + esc(it.brand) : ''}</span>
          ${it.attributes ? `<div class="tck-attr-badges">
            ${it.attributes.material ? `<span class="tck-attr-chip">🧶 <b>${esc(it.attributes.material)}</b></span>` : ''}
            ${it.attributes.size ? `<span class="tck-attr-chip">📐 <b>${esc(it.attributes.size)}</b></span>` : ''}
            ${it.attributes.color ? `<span class="tck-attr-chip">🎨 <b>${esc(it.attributes.color)}</b></span>` : ''}
            ${it.attributes.pack_count && it.attributes.pack_count > 1 ? `<span class="tck-attr-chip">📦 <b>${it.attributes.pack_count}-Pack</b></span>` : ''}
          </div>` : ''}
        </div>
        <div class="tck-edit">
          <span class="tck-lbl" title="Temu Selling Price">$</span>
          <input class="inp tck-price" data-i="${i}" value="${it.base ?? ''}" inputmode="decimal" title="Temu Selling Base Price">
          <span class="tck-lbl" title="Shipping weight (lb)">⚖</span>
          <input class="inp tck-weight" data-i="${i}" type="number" step="0.1" min="0.1" value="${it.weight ?? 1.4}" title="Item Shipping Weight in lb (Click to edit)">
          <span class="tck-wt-unit">lb</span>
          <select class="sel tck-cat" data-i="${i}" title="Temu category keyword">${opts.join('')}</select>
          <span class="tck-lbl" title="Pack size">📦</span>
          <select class="sel tck-pack-sel" data-i="${i}" title="Product pack size">
            <option value="1"${(!it.attributes?.pack_count || it.attributes.pack_count <= 1) ? ' selected' : ''}>1-Pack</option>
            <option value="2"${it.attributes?.pack_count == 2 ? ' selected' : ''}>2-Pack</option>
            <option value="3"${it.attributes?.pack_count == 3 ? ' selected' : ''}>3-Pack</option>
            <option value="4"${it.attributes?.pack_count == 4 ? ' selected' : ''}>4-Pack</option>
            <option value="5"${it.attributes?.pack_count == 5 ? ' selected' : ''}>5-Pack</option>
            <option value="6"${it.attributes?.pack_count == 6 ? ' selected' : ''}>6-Pack</option>
          </select>
        </div>
        <div class="tck-img-drawer" id="tckImgDrawer_${i}" hidden>
          <div class="tck-img-drawer-head">
            <div class="tck-img-drawer-title">
              <span>🖼️ Product Images (Flow AI &amp; URLs)</span>
            </div>
            <button type="button" class="btn btn-ghost btn-xs tck-add-img-btn" data-i="${i}">+ Add Image URL</button>
          </div>
          <div class="tck-img-slots" data-i="${i}">
            ${renderTckImgSlots(it, i)}
          </div>
        </div>
        </div>
      </div>
    </div>`;
  }).join('');

  list.querySelectorAll('.tck-title-inp').forEach(inp => {
    inp.addEventListener('input', () => {
      const i = +inp.dataset.i;
      if (items[i]) items[i].title = inp.value.trim();
      const cnt = inp.parentElement?.querySelector('.tck-chars');
      if (cnt) {
        const len = inp.value.length;
        cnt.textContent = `${len}/120`;
        cnt.className = `tck-chars ${len > 140 ? 'bad' : len > 120 ? 'warn' : ''}`;
      }
      temuCheckSummary();
      saveTemuCheckSession();
    });
  });

  list.querySelectorAll('.tck-price').forEach(inp => {
    inp.addEventListener('change', () => {
      const i = +inp.dataset.i;
      const px = parseFloat(inp.value);
      if (items[i] && isFinite(px) && px > 0) {
        items[i].base = Math.round(px * 100) / 100;
        let l = items[i].base * (cfg.list_price_multiplier || 1.25);
        if (cfg.price_round_to_99) l = Math.floor(l) + 0.99;
        items[i].list = Math.round(l * 100) / 100;
      }
      temuCheckSummary();
      saveTemuCheckSession();
    });
  });

  list.querySelectorAll('.tck-weight').forEach(inp => {
    inp.addEventListener('change', () => {
      const i = +inp.dataset.i;
      const wt = parseFloat(inp.value);
      if (items[i] && isFinite(wt) && wt > 0) {
        items[i].weight = Math.round(wt * 10) / 10;
        const maxWt = parseFloat(cfg?.max_weight_lb) || 0;
        if (maxWt > 0 && items[i].weight > maxWt) {
          if (!items[i].warn.includes('OVERWEIGHT')) items[i].warn.push('OVERWEIGHT');
        } else {
          items[i].warn = (items[i].warn || []).filter(w => w !== 'OVERWEIGHT');
        }
        const row = inp.closest('.tck-row');
        if (row) {
          const wb = row.querySelector('.tck-badge-weight');
          if (wb) wb.textContent = `⚖️ ${items[i].weight} lb`;
        }
      }
      temuCheckSummary();
      saveTemuCheckSession();
    });
  });

  list.querySelectorAll('.tck-cat').forEach(sel => {
    sel.addEventListener('change', () => {
      const i = +sel.dataset.i;
      if (items[i]) items[i].category_keyword = sel.value;
      saveTemuCheckSession();
    });
  });

  list.querySelectorAll('.tck-on').forEach(chk => {
    chk.addEventListener('change', () => {
      saveTemuCheckSession();
    });
  });

  // Image drawer toggle
  list.querySelectorAll('.tck-img-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const i = +btn.dataset.i;
      const drawer = $(`tckImgDrawer_${i}`);
      if (!drawer) return;
      const isHidden = drawer.hidden;
      drawer.hidden = !isHidden;
      btn.classList.toggle('active', !isHidden);
      const row = btn.closest('.tck-row');
      if (row && row.classList.contains('tck-collapsed') && !isHidden) {
        row.classList.remove('tck-collapsed');
      }
    });
  });

  // Pack selector change
  list.querySelectorAll('.tck-pack-sel').forEach(sel => {
    sel.addEventListener('change', () => {
      const i = +sel.dataset.i;
      if (!items[i]) return;
      const pack = parseInt(sel.value, 10) || 1;
      items[i].attributes = items[i].attributes || {};
      items[i].attributes.pack_count = pack;
      let t = items[i].title || '';
      if (pack > 1) {
        if (!/(pack of|\b\d+-pack\b)/i.test(t)) {
          items[i].title = `${t.trim()} (${pack}-Pack)`;
        } else {
          items[i].title = t.replace(/(pack of\s*\d+|\b\d+-pack\b|\(\d+-pack\))/gi, `(${pack}-Pack)`);
        }
      } else {
        items[i].title = t.replace(/\s*\([1-9]\d*-Pack\)/gi, '').replace(/\s*\b[1-9]\d*-Pack\b/gi, '').trim();
      }
      const titleInp = sel.closest('.tck-row')?.querySelector('.tck-title-inp');
      if (titleInp) titleInp.value = items[i].title;
      saveTemuCheckSession();
      toast(`✓ Updated to ${pack}-Pack`, 'ok');
    });
  });

  // Image slots interaction handler (delegated on list)
  const refreshRowDrawer = (itemIdx) => {
    const slotsEl = list.querySelector(`.tck-img-slots[data-i="${itemIdx}"]`);
    if (slotsEl && items[itemIdx]) {
      slotsEl.innerHTML = renderTckImgSlots(items[itemIdx], itemIdx);
    }
    const row = list.querySelector(`.tck-row[data-i="${itemIdx}"]`);
    if (row && items[itemIdx]) {
      const imgBtn = row.querySelector('.tck-img-btn');
      if (imgBtn) imgBtn.textContent = `🖼️ ${(items[itemIdx].images || []).length || 1} imgs ▾`;
      const mainThumb = row.querySelector('.tck-thumb');
      const firstImg = items[itemIdx].images?.[0] || items[itemIdx].image;
      if (mainThumb && firstImg) mainThumb.src = firstImg;
    }
  };

  list.addEventListener('click', async (e) => {
    const flowBtn = e.target.closest('.tck-flow-btn');
    if (flowBtn) {
      e.stopPropagation();
      const i = +flowBtn.dataset.i, slot = +flowBtn.dataset.slot;
      const it = items[i]; if (!it) return;
      list.querySelectorAll('.tck-img-slot').forEach(s => s.classList.remove('active-flow'));
      flowBtn.closest('.tck-img-slot')?.classList.add('active-flow');
      await chrome.storage.local.set({
        flowActiveTarget: { itemIdx: i, slotIdx: slot, sku: it.sku || '', time: Date.now() }
      });
      const curImg = (it.images || [])[slot] || it.image || '';
      if (curImg) {
        try { await navigator.clipboard.writeText(curImg); } catch (_) {}
      }
      chrome.tabs.create({ url: 'https://flow.google.com/project/a1e6e7b6-b581-4e66-8f69-bee201d83517' });
      toast('🎨 Flow AI tab khola gaya! Image URL clipboard par copy ho chuka hai. Edit ke baad right-click karein ya Paste dabayein.', 'ok');
      return;
    }

    const pasteBtn = e.target.closest('.tck-paste-btn');
    if (pasteBtn) {
      e.stopPropagation();
      const i = +pasteBtn.dataset.i, slot = +pasteBtn.dataset.slot;
      const it = items[i]; if (!it) return;
      let clip = '';
      try { clip = await navigator.clipboard.readText(); } catch(_) {}
      if (!clip || !clip.startsWith('http')) {
        clip = prompt('Paste new image URL:', (it.images || [])[slot] || it.image || '');
      }
      if (clip && clip.trim().startsWith('http')) {
        it.images = Array.isArray(it.images) && it.images.length > 0 ? it.images : [it.image || ''];
        it.images[slot] = clip.trim();
        if (slot === 0) it.image = clip.trim();
        refreshRowDrawer(i);
        saveTemuCheckSession();
        toast('✓ Image slot updated!', 'ok');
      }
      return;
    }

    const mainBtn = e.target.closest('.tck-slot-act-main');
    if (mainBtn) {
      e.stopPropagation();
      const i = +mainBtn.dataset.i, slot = +mainBtn.dataset.slot;
      const it = items[i]; if (!it || !it.images || !it.images[slot]) return;
      const picked = it.images.splice(slot, 1)[0];
      it.images.unshift(picked);
      it.image = it.images[0];
      refreshRowDrawer(i);
      saveTemuCheckSession();
      toast('✓ Moved to Slot 1 (Main Hero Image)!', 'ok');
      return;
    }

    const delBtn = e.target.closest('.tck-del-img-btn');
    if (delBtn) {
      e.stopPropagation();
      const i = +delBtn.dataset.i, slot = +delBtn.dataset.slot;
      const it = items[i]; if (!it || !it.images) return;
      it.images.splice(slot, 1);
      if (it.images.length === 0) it.images.push('');
      it.image = it.images[0] || '';
      refreshRowDrawer(i);
      saveTemuCheckSession();
      toast('✓ Image removed', 'ok');
      return;
    }

    const addBtn = e.target.closest('.tck-add-img-btn') || e.target.closest('.tck-img-add-card');
    if (addBtn) {
      e.stopPropagation();
      const i = +addBtn.dataset.i;
      const it = items[i]; if (!it) return;
      let url = prompt('Enter new Image URL:');
      if (url && url.trim().startsWith('http')) {
        it.images = Array.isArray(it.images) ? it.images : (it.image ? [it.image] : []);
        it.images.push(url.trim());
        refreshRowDrawer(i);
        saveTemuCheckSession();
        toast('✓ New image added!', 'ok');
      }
      return;
    }
  });

  // v10.3.3: ek hi visibility engine — default: masle hon to saaf products chhupe
  { const v = TemuCheck.view; if (v.hideClean == null) { const nClean = items.filter(it => !temuCheckFlags(it, cfg).some(f => f.k === 'bad' || f.k === 'warn')).length; v.hideClean = nClean > 0 && nClean < items.length; } const hc = $('tckHideClean'); if (hc) hc.checked = !!v.hideClean; const si = $('tckSearchInp'); if (si) si.value = ''; }
  temuCheckSync();
  try { chrome.storage.local.get('tckPanelOpen', r => { if (r?.tckPanelOpen && $(r.tckPanelOpen)) temuCheckPanel(r.tckPanelOpen, true); }); } catch (_) {}

  // Hook up inline AI prompt bar apply button
  const promptBtn = $('tckApplyPromptBtn');
  if (promptBtn) {
    promptBtn.onclick = async () => {
      const pVal = ($('tckCustomPromptInp')?.value || '').trim();
      if (!pVal) {
        toast('Pehle apna AI prompt likhein (e.g. Add 2024 Edition, remove brand...)', 'warn');
        $('tckCustomPromptInp')?.focus();
        return;
      }
      promptBtn.disabled = true;
      promptBtn.textContent = '⏳ Optimizing...';
      try {
        await temuAIOptimizeTitles(null, { customPrompt: pVal });
        toast('✓ AI Prompt applied to selected products!', 'ok');
      } catch (err) {
        toast('AI Error: ' + (err?.message || err), 'err');
      } finally {
        promptBtn.disabled = false;
        promptBtn.textContent = '⚡ Apply AI';
      }
    };
  }

  temuCheckSummary();
  saveTemuCheckSession();
  card.hidden = false;
  card.style.display = '';
  try { card.scrollIntoView({ block: 'start', behavior: 'smooth' }); } catch (_) {}
  const rep = $('temuReport'); if (rep) rep.textContent = `Review Table: ${items.length} products tayyar — title/price/weight edit ya flags dekh kar "Upload" dabayen.` + (skipped.length ? `\nSkipped ${skipped.length}: ${skipped.slice(0, 5).join('; ')}${skipped.length > 5 ? '…' : ''}` : '');

  // Restore view mode
  const savedView = localStorage.getItem('zh_tck_view') || 'card';
  setTemuReviewViewMode(savedView);
}

// v10.3.3 — SINGLE source of truth: har change ke baad ye chalta hai aur sab kuch (rows, counts, chips,
// status line, dock, Upload(N)) ek hi hisab se update karta hai. Row dikhana/chhupana sirf row.hidden se.
function temuCheckSync() {
  if (!TemuCheck) return;
  const allItems = TemuCheck.items || [], cfg = TemuCheck.cfg || {};
  const v = TemuCheck.view || (TemuCheck.view = { filter: 'all', q: '', hideClean: false, minimized: false });
  const maxWt = parseFloat(cfg?.max_weight_lb) || 0, me = temuActiveStoreName() || 'default', lm = temuListedMap();
  const q = (v.q || '').trim().toLowerCase();
  let ready = 0, warn = 0, bad = 0, heavy = 0, ai = 0, listed = 0, visible = 0, hiddenClean = 0, hiddenFilter = 0, checked = 0;
  const list = $('temuCheckList');
  const rows = document.querySelectorAll('#temuCheckList .tck-row');
  rows.forEach(r => {
    const idx = +r.dataset.i, it = allItems[idx]; if (!it) { r.hidden = true; return; }
    const flags = temuCheckFlags(it, cfg);
    const isBad = flags.some(f => f.k === 'bad'), isWarn = !isBad && flags.some(f => f.k === 'warn'), clean = !isBad && !isWarn;
    const isH = !!(it.warn?.includes('OVERWEIGHT') || (maxWt > 0 && parseFloat(it.weight) > maxWt));
    const isAi = !!it._aiOptimized;
    const isL = !!(it.isAlreadyListed || it.listedRecord || lm[me + '|' + (it.sid || temuSourceId(it.url))]);
    if (isBad) bad++; else if (isWarn) warn++; else ready++;
    if (isH) heavy++; if (isAi) ai++; if (isL) listed++;
    r.dataset.bad = isBad; r.dataset.warn = isWarn; r.dataset.clean = clean; r.dataset.heavy = isH; r.dataset.ai = isAi; r.dataset.listed = isL;
    const collapsed = it._uiCollapsed != null ? it._uiCollapsed : clean; // v11.1.0
    r.classList.toggle('tck-bad', isBad); r.classList.toggle('tck-clean', clean); r.classList.toggle('tck-collapsed', collapsed);
    let show = true;
    const f = v.filter || 'all';
    if (f === 'ready') show = clean; else if (f === 'warn') show = isWarn; else if (f === 'bad') show = isBad;
    else if (f === 'ai') show = isAi; else if (f === 'heavy') show = isH; else if (f === 'listed') show = isL;
    if (show && q) {
      const hay = [r.querySelector('.tck-title-inp')?.value, it.sku, it.brand, it.color, it.source_price, it.base, it.url].map(x => String(x ?? '').toLowerCase()).join(' ');
      show = hay.includes(q);
    }
    if (!show) hiddenFilter++;
    else if (v.hideClean && clean && f === 'all' && !q) { show = false; hiddenClean++; }
    r.hidden = !show; // v11.1.0: minimize ab per-row collapse hai, poori row hide nahi hoti
    if (show) visible++;
    if (r.querySelector('.tck-on')?.checked) checked++;
  });
  const all = allItems.length;
  const set = (id, val) => { const el = $(id); if (el) el.textContent = val; };
  set('temuCntAll', all); set('temuCntReady', ready); set('temuCntWarn', warn); set('temuCntBad', bad); set('temuCntHeavy', heavy); set('temuCntAi', ai); set('temuCntListed', listed);
  document.querySelectorAll('.tck-filter-chip').forEach(c => c.classList.toggle('active', (c.dataset.filter || 'all') === (v.filter || 'all')));
  { const el = $('temuCheckSum'); if (el) { el.textContent = `${checked}/${all} · ${ready} ok · ${warn} warn · ${bad} bad` + (heavy ? ` · ${heavy} heavy` : ''); el.title = `${checked} of ${all} selected · ${ready} ready · ${warn} warnings · ${bad} blocked · ${heavy} heavy` + (TemuCheck.skipped?.length ? ` · ${TemuCheck.skipped.length} skipped before review` : ''); } }
  // Filters badge: active filter / search / hide-clean
  { const b = $('tckFiltersBadge'); const parts = []; if ((v.filter || 'all') !== 'all') parts.push(v.filter); if (v.hideClean && hiddenClean) parts.push('clean hidden'); if (b) { b.hidden = !parts.length; b.textContent = parts.length ? String(parts.length) : ''; b.title = parts.join(' · '); }
    const fb = $('tckFiltersBtn'); if (fb) fb.classList.toggle('is-active', !!parts.length || !!q); }
  // Search count
  { const sc = $('tckSearchCount'); if (sc) { sc.hidden = !q; sc.textContent = `${visible}`; } const cl = $('tckSearchClearBtn'); if (cl) cl.hidden = !q; }
  // Status line
  { const st = $('tckStatusLine'), tx = $('tckStatusTxt'), sa = $('tckStatusShowAll');
    if (st && tx) {
      if (v.minimized) { st.hidden = true; }
      else if (visible === all) { st.hidden = true; }
      else {
        st.hidden = false;
        const why = []; if (hiddenClean) why.push(`${hiddenClean} clean hidden`); if (hiddenFilter) why.push(`${hiddenFilter} filtered out`);
        tx.textContent = `Showing ${visible} of ${all}` + (why.length ? ' · ' + why.join(' · ') : '');
        if (sa) sa.hidden = false;
      }
    } }
  // v11.1.2: yeh poore Review panel ko minimize karta hai (jagah bachane ke liye) — alag hai per-row collapse se
  { if (list) list.hidden = !!v.minimized; const n = $('tckMinimizedNotice'); if (n) n.style.display = v.minimized ? 'block' : 'none'; set('tckMinimizedCount', `${all} products`); const mb = $('tckMinimizeBtn'); if (mb) mb.classList.toggle('is-min', !!v.minimized); const hc = $('tckHideClean'); if (hc) hc.checked = !!v.hideClean; }
  // Dock
  const b = $('temuCheckGo'); if (b) b.disabled = !checked;
  set('tckStickyCount', `${checked}`); set('tckTotalCount', `${all}`); set('tckBtnUploadCount', `${checked}`);
}
function temuCheckSummary() { temuCheckSync(); }
function temuCheckPanel(id, force) {
  const p = $(id); if (!p) return;
  const open = force != null ? !!force : p.hidden;
  ['tckFiltersPanel', 'tckToolsPanel'].forEach(x => { const el = $(x); if (el && x !== id) el.hidden = true; });
  p.hidden = !open;
  document.querySelectorAll('.tck-drop-btn').forEach(btn => btn.classList.toggle('open', btn.dataset.panel === id && open));
  try { chrome.storage.local.set({ tckPanelOpen: open ? id : '' }); } catch (_) {}
}

// ── Quick Filter Tabs logic ──
function temuFilterRows(filterType) {
  if (!TemuCheck) return;
  TemuCheck.view.filter = filterType || 'all';
  temuCheckSync();
}

// ── Dual-View Switcher: Review Table & Library ──
function setTemuReviewViewMode(view) {
  const list = $('temuCheckList');
  const switcher = $('tckViewSwitcher');
  const isDense = (view === 'dense' || view === 'compact');
  if (list) {
    list.classList.toggle('tck-compact-view', isDense);
    list.classList.toggle('tck-dense-view', isDense);
  }
  if (switcher) {
    switcher.querySelectorAll('.zh-view-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.view === (isDense ? 'dense' : 'card'));
    });
  }
  const vBtn = $('temuViewToggle');
  if (vBtn) vBtn.textContent = isDense ? '↔️ View: Dense' : '↔️ View: Card';
  localStorage.setItem('zh_tck_view', isDense ? 'dense' : 'card');
}

function setMasterLibraryViewMode(view) {
  const list = $('masterRowsList');
  const switcher = $('masterViewSwitcher');
  const isDense = (view === 'dense' || view === 'compact');
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

function temuToggleViewMode() {
  const current = localStorage.getItem('zh_tck_view') || 'card';
  const next = (current === 'dense' || current === 'compact') ? 'card' : 'dense';
  setTemuReviewViewMode(next);
  toast(next === 'dense' ? 'Dense Spreadsheet View active' : 'Card View active', 'ok');
}

function toggleTemuProductsMinimized() {
  // v11.1.2: poori Review list minimize/maximize (list.hidden true/false) — jagah bachane ke liye.
  // Har product ka apna row-level collapse (chevron/click) ek alag, independent feature hai.
  if (!TemuCheck) return;
  TemuCheck.view.minimized = !TemuCheck.view.minimized;
  temuCheckSync();
}

// ── Find & Replace in Titles Modal ──
function openFindReplaceModal() {
  const m = $('tckFindReplaceModal');
  if (!m) return;
  m.classList.remove('hidden');
  m.setAttribute('aria-hidden', 'false');
  const fInp = $('tckFrFind');
  if (fInp) { fInp.value = ''; fInp.focus(); }
  const rInp = $('tckFrReplace');
  if (rInp) rInp.value = '';
  updateFindReplacePreview();
}

function closeFindReplaceModal() {
  const m = $('tckFindReplaceModal');
  if (m) {
    m.classList.add('hidden');
    m.setAttribute('aria-hidden', 'true');
  }
}

function updateFindReplacePreview() {
  const findVal = $('tckFrFind')?.value || '';
  const caseSens = $('tckFrCase')?.checked || false;
  const selOnly = $('tckFrSelectedOnly')?.checked || false;
  const previewEl = $('tckFrPreview');
  const applyBtn = $('tckFrApplyBtn');

  if (!findVal) {
    if (previewEl) previewEl.textContent = 'Enter text to search...';
    if (applyBtn) { applyBtn.disabled = true; applyBtn.textContent = 'Replace All'; }
    return;
  }

  const items = TemuCheck?.items || [];
  let matchCount = 0;
  let titleCount = 0;

  items.forEach((it, idx) => {
    if (selOnly) {
      const chk = document.querySelector(`#temuCheckList .tck-on[data-i="${idx}"]`);
      if (!chk || !chk.checked) return;
    }
    const title = it.title || '';
    let matches = 0;
    if (caseSens) {
      matches = (title.split(findVal).length - 1);
    } else {
      const re = new RegExp(findVal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      matches = (title.match(re) || []).length;
    }
    if (matches > 0) {
      matchCount += matches;
      titleCount++;
    }
  });

  if (previewEl) {
    previewEl.textContent = matchCount > 0
      ? `Found ${matchCount} match${matchCount > 1 ? 'es' : ''} in ${titleCount} title${titleCount > 1 ? 's' : ''}`
      : 'No matches found in titles';
  }
  if (applyBtn) {
    applyBtn.disabled = matchCount === 0;
    applyBtn.textContent = matchCount > 0 ? `Replace All (${matchCount})` : 'Replace All';
  }
}

function applyFindReplace() {
  const findVal = $('tckFrFind')?.value || '';
  const repVal = $('tckFrReplace')?.value ?? '';
  const caseSens = $('tckFrCase')?.checked || false;
  const selOnly = $('tckFrSelectedOnly')?.checked || false;

  if (!findVal || !TemuCheck?.items) return;

  const items = TemuCheck.items;
  let updatedCount = 0;
  let occurrences = 0;

  items.forEach((it, idx) => {
    if (selOnly) {
      const chk = document.querySelector(`#temuCheckList .tck-on[data-i="${idx}"]`);
      if (!chk || !chk.checked) return;
    }
    const title = it.title || '';
    let newTitle = title;
    let occ = 0;
    if (caseSens) {
      occ = (title.split(findVal).length - 1);
      newTitle = title.split(findVal).join(repVal);
    } else {
      const re = new RegExp(findVal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      occ = (title.match(re) || []).length;
      newTitle = title.replace(re, repVal);
    }

    if (occ > 0 && newTitle !== title) {
      it.title = newTitle;
      updatedCount++;
      occurrences += occ;

      const row = document.querySelector(`#temuCheckList .tck-row[data-i="${idx}"]`);
      if (row) {
        const inp = row.querySelector('.tck-title-inp');
        if (inp) inp.value = newTitle;
        const cnt = row.querySelector('.tck-chars');
        if (cnt) {
          const len = newTitle.length;
          cnt.textContent = `${len}/120`;
          cnt.className = `tck-chars ${len > 140 ? 'bad' : len > 120 ? 'warn' : ''}`;
        }
      }
    }
  });

  closeFindReplaceModal();
  temuCheckSummary();
  toast(`Replaced ${occurrences} occurrences in ${updatedCount} titles!`, 'ok');
}
function temuCleanTitlesInReview(customWord = null) {
  if (!TemuCheck || !TemuCheck.items) return 0;
  const { items, cfg } = TemuCheck;
  let count = 0;
  const wordsToStrip = customWord ? [customWord] : (cfg.title_remove_words || []);
  const tempCfg = { ...cfg, title_remove_words: wordsToStrip };

  items.forEach((it, i) => {
    const oldT = it.title || '';
    const newT = temuCleanTitle(oldT, tempCfg);
    if (newT !== oldT) {
      it.title = newT;
      count++;
      const row = document.querySelector(`#temuCheckList .tck-row[data-i="${i}"]`);
      if (row) {
        const inp = row.querySelector('.tck-title-inp');
        if (inp) inp.value = newT;
        const cnt = row.querySelector('.tck-chars');
        if (cnt) {
          const len = newT.length;
          cnt.textContent = `${len}/120`;
          cnt.className = `tck-chars ${len > 140 ? 'bad' : len > 120 ? 'warn' : ''}`;
        }
      }
    }
  });

  temuCheckSummary();
  return count;
}

// ═══════════════════════════════════════════════════════════════
// 1-CLICK AI TITLE STUDIO (Prompt Box + Side-by-Side Live Edit)
// ═══════════════════════════════════════════════════════════════
const _aiEsc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function openAiTitleStudio() {
  if (!TemuCheck || !TemuCheck.items || !TemuCheck.items.length) {
    toast('Pehle products hunt karein ya Review table kholein', 'warn');
    return;
  }
  const modal = $('tckAiStudioModal');
  if (!modal) return;

  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');

  chrome.storage.local.get('zhLastAiTitlePrompt', res => {
    const pInp = $('tckAiStudioPromptInp');
    if (pInp && !pInp.value.trim() && res?.zhLastAiTitlePrompt) {
      pInp.value = res.zhLastAiTitlePrompt;
    }
  });

  const selChks = document.querySelectorAll('#temuCheckList .tck-on:checked');
  const selCount = selChks.length;
  const selCountEl = $('tckAiStudioSelCount');
  if (selCountEl) selCountEl.textContent = selCount;

  const selOnlyToggle = $('tckAiStudioSelectedOnly');
  if (selOnlyToggle) {
    selOnlyToggle.checked = selCount > 0 && selCount < TemuCheck.items.length;
  }

  renderAiStudioList();
}

function closeAiTitleStudio() {
  const modal = $('tckAiStudioModal');
  if (modal) {
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
  }
}

function renderAiStudioList() {
  const listEl = $('tckAiStudioList');
  if (!listEl || !TemuCheck || !TemuCheck.items) return;

  const items = TemuCheck.items;
  const selOnly = $('tckAiStudioSelectedOnly')?.checked || false;

  let activeIndices = [];
  items.forEach((it, idx) => {
    if (selOnly) {
      const chk = document.querySelector(`#temuCheckList .tck-on[data-i="${idx}"]`);
      if (!chk || !chk.checked) return;
    }
    activeIndices.push(idx);
  });

  if (!activeIndices.length) {
    activeIndices = items.map((_, i) => i);
  }

  const itemCountEl = $('tckAiStudioItemCount');
  if (itemCountEl) itemCountEl.textContent = activeIndices.length;

  const statusEl = $('tckAiStudioStatus');
  if (statusEl) statusEl.textContent = `Ready to optimize ${activeIndices.length} product titles`;

  const existingValues = {};
  listEl.querySelectorAll('.tck-ai-item').forEach(row => {
    const idx = +row.dataset.i;
    const val = row.querySelector('.tck-ai-item-inp')?.value;
    const isChecked = row.querySelector('.tck-ai-item-chk')?.checked;
    if (!isNaN(idx) && val !== undefined) {
      existingValues[idx] = { val, isChecked };
    }
  });

  listEl.innerHTML = activeIndices.map(idx => {
    const it = items[idx];
    const origTitle = it.title || '';
    const currVal = existingValues[idx]?.val !== undefined ? existingValues[idx].val : origTitle;
    const isChecked = existingValues[idx]?.isChecked !== undefined ? existingValues[idx].isChecked : true;
    const len = currVal.length;
    const badgeCls = len > 120 ? 'bad' : len > 100 ? 'warn' : 'ok';
    const isMod = currVal !== origTitle;
    const imgUrl = it.image || it.img || (Array.isArray(it.images) ? it.images[0] : '') || 'icon48.png';

    return `<div class="tck-ai-item ${isMod ? 'tck-ai-modified' : ''}" data-i="${idx}">
      <div class="tck-ai-item-left">
        <label class="chk" style="margin:0;"><input type="checkbox" class="tck-ai-item-chk" ${isChecked ? 'checked' : ''}></label>
        <img src="${imgUrl}" class="tck-ai-thumb" onerror="this.src='icon48.png'" />
        <span class="tck-ai-num">#${idx + 1}</span>
      </div>
      <div class="tck-ai-item-body">
        <div class="tck-ai-orig">
          <span class="tck-ai-tag-orig">Original</span>
          <span class="tck-ai-orig-text">${_aiEsc(origTitle)}</span>
        </div>
        <div class="tck-ai-opt-wrap">
          <div class="tck-ai-opt-head">
            <span class="tck-ai-tag-ai">✨ AI Title (Direct Edit)</span>
            <span class="tck-ai-char-badge ${badgeCls}">${len}/120</span>
          </div>
          <textarea class="inp tck-ai-item-inp" rows="2" placeholder="AI title yahan show hoga aur aap edit kar sakte hain...">${_aiEsc(currVal)}</textarea>
        </div>
      </div>
    </div>`;
  }).join('');

  updateAiStudioCounts();
}

function updateAiStudioCounts() {
  const listEl = $('tckAiStudioList');
  if (!listEl) return;

  const chks = listEl.querySelectorAll('.tck-ai-item-chk:checked');
  const applyBtn = $('tckAiStudioApplyBtn');
  const countEl = $('tckAiApprovedCount');

  if (countEl) countEl.textContent = chks.length;
  if (applyBtn) {
    applyBtn.disabled = chks.length === 0;
  }
}

async function runAiTitleStudio() {
  if (!TemuCheck || !TemuCheck.items || !TemuCheck.items.length) return;

  const cfg = temuGetCfg();
  const rawKeyStr = (cfg.gemini_api_key || $('tgGeminiKey')?.value || '').trim();
  const keyList = temuGetAiKeys(rawKeyStr);
  if (!keyList.length) {
    toast('Pehle Settings → AI Optimizer mein API Key enter karein', 'warn');
    return;
  }

  const promptInp = $('tckAiStudioPromptInp');
  const userCustomPrompt = (promptInp?.value || '').trim();
  if (userCustomPrompt) {
    chrome.storage.local.set({ zhLastAiTitlePrompt: userCustomPrompt });
  }

  const runBtn = $('tckAiStudioRunBtn');
  const statusEl = $('tckAiStudioStatus');
  if (runBtn) {
    runBtn.classList.add('busy');
    runBtn.innerHTML = '⏳ Processing with AI...';
  }

  const listEl = $('tckAiStudioList');
  const rows = listEl ? Array.from(listEl.querySelectorAll('.tck-ai-item')) : [];
  const allItems = TemuCheck.items;

  const targetIndices = rows.map(r => +r.dataset.i).filter(i => !isNaN(i) && allItems[i]);
  if (!targetIndices.length) {
    toast('Optimize karne ke liye koi product nahi hai', 'warn');
    if (runBtn) {
      runBtn.classList.remove('busy');
      runBtn.innerHTML = '<svg class="i i-xs" viewBox="0 0 24 24"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> ✨ Run AI Title Check';
    }
    return;
  }

  const keepBrands = cfg.ai_keep_approved_brands !== false;
  let approvedBrands = [];
  if (keepBrands) {
    const brandMap = {};
    if (cfg.brand_rules && typeof cfg.brand_rules === 'object') {
      Object.keys(cfg.brand_rules).forEach(b => { if (b.trim()) brandMap[b.trim()] = true; });
    }
    if (cfg.trademarks && typeof cfg.trademarks === 'object') {
      Object.keys(cfg.trademarks).forEach(b => { if (b.trim()) brandMap[b.trim()] = true; });
    }
    if (cfg.brands && typeof cfg.brands === 'object') {
      Object.values(cfg.brands).forEach(b => { if (b.trim()) brandMap[b.trim()] = true; });
    }
    approvedBrands = Object.keys(brandMap);
  }

  const stripClaims = cfg.ai_strip_claims !== false;
  const CHUNK_SIZE = 25;
  let optimizedCount = 0;

  try {
    let activeKeyIndex = 0;

    for (let c = 0; c < targetIndices.length; c += CHUNK_SIZE) {
      const chunkIndices = targetIndices.slice(c, c + CHUNK_SIZE);
      if (statusEl) {
        statusEl.textContent = `⏳ Processing ${c + 1}–${Math.min(c + CHUNK_SIZE, targetIndices.length)} of ${targetIndices.length}...`;
      }

      const inputList = chunkIndices.map(idx => ({
        id: idx,
        title: allItems[idx].title || ''
      }));

      const systemPrompt = `You are an expert e-commerce copywriter optimizing product titles specifically for the Temu marketplace.
Your job is to rewrite each product title so it is clean, accurate, attractive, and strictly compliant with marketplace guidelines.

TEMU TITLE REQUIREMENTS:
1. Target length: strictly between 60 and 115 characters. Never exceed 118 characters.
2. Format: Clear and readable. Structure as: [Core Product / Keywords] + [Key Features / Material / Model] + [Pack Size / Quantity / Color].
3. Quality: Capitalize the first letter of major words (Title Case). Do NOT use ALL-CAPS words, do NOT use emojis, exclamation marks, or symbols like '***' or '>>>'.
${approvedBrands.length ? `4. CRITICAL BRAND RULE: The seller is authorized and APPROVED to sell these brands: [${approvedBrands.join(', ')}].
   - If a product title mentions any of these approved brands, YOU MUST PRESERVE the brand name in the title!
   - For any OTHER third-party brands NOT in this approved list, remove the brand name to avoid copyright/IP violations.` : `4. Remove third-party trademarked brand names to avoid copyright/IP violations.`}
${stripClaims ? `5. PROHIBITED CLAIMS & WORDS (MUST REMOVE):
   - Health/Medical claims: "FDA approved", "cure", "relief", "pain relief", "medical grade", "therapeutic", "clinical", "heals".
   - Environmental/Eco claims: "eco-friendly", "biodegradable", "green", "100% natural", "organic", "zero waste".
   - Baby/Safety claims: "BPA free", "non-toxic", "pediatrician approved", "infant safe", "choking safe".
   - Warranty/Hype words: "lifetime warranty", "guaranteed", "best seller", "top seller", "100% satisfaction", "free shipping", "prime".
   - Platform/Store names: "Amazon", "Walmart", "Sam's Club", "Costco", "eBay", "Prime".` : ''}
${userCustomPrompt ? `6. USER CRITICAL CUSTOM INSTRUCTIONS (FOLLOW STRICTLY):
   ${userCustomPrompt}` : ''}

You will receive a JSON list of objects with "id" and "title".
Return ONLY a valid JSON array of objects with "id" and "optimized" (the new title string).
Do NOT include explanations or markdown fences. Just the raw JSON array.`;

      let outText = '';
      let chunkSuccess = false;
      let lastError = null;

      while (activeKeyIndex < keyList.length && !chunkSuccess) {
        const apiKey = keyList[activeKeyIndex];
        const isGroq = apiKey.startsWith('gsk_');

        try {
          if (isGroq) {
            const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
              },
              body: JSON.stringify({
                model: 'openai/gpt-oss-120b',
                messages: [
                  { role: 'system', content: systemPrompt },
                  { role: 'user', content: JSON.stringify(inputList) }
                ],
                temperature: 0.2
              })
            });
            const resData = await res.json();
            if (res.status === 429 || resData.error?.code === 'rate_limit_exceeded' || (resData.error?.message && /rate limit|tokens per/i.test(resData.error.message))) {
              activeKeyIndex++;
              if (activeKeyIndex < keyList.length) {
                toast(`⚡ Groq Key #${activeKeyIndex} limit ➔ Switching to Key #${activeKeyIndex + 1}`, 'info');
                continue;
              } else {
                throw new Error('All Groq keys rate-limited. Please wait 1 minute.');
              }
            }
            if (resData.error) throw new Error(resData.error.message || 'Groq API call failed');
            outText = resData?.choices?.[0]?.message?.content || '';
            chunkSuccess = true;
          } else {
            let { model, apiVer } = await temuGetGeminiModelInfo(apiKey);
            let geminiUrl = `https://generativelanguage.googleapis.com/${apiVer}/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
            const payload = {
              contents: [{ role: 'user', parts: [{ text: systemPrompt + '\n\nINPUT TITLES:\n' + JSON.stringify(inputList) }] }],
              generationConfig: { temperature: 0.3, maxOutputTokens: 2048, responseMimeType: 'application/json' }
            };

            let res = await fetch(geminiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
            let resData = await res.json();
            if (res.status === 429 || resData.error?.code === 429) {
              activeKeyIndex++;
              if (activeKeyIndex < keyList.length) {
                toast(`⚡ Gemini Key #${activeKeyIndex} quota ➔ Key #${activeKeyIndex + 1}`, 'info');
                continue;
              } else {
                throw new Error('All API keys quota exceeded.');
              }
            }
            if (resData.error) throw new Error(resData.error.message || 'Gemini API call failed');
            outText = resData?.candidates?.[0]?.content?.parts?.[0]?.text;
            chunkSuccess = true;
          }
        } catch (err) {
          lastError = err;
          if (activeKeyIndex + 1 < keyList.length) {
            activeKeyIndex++;
            toast(`⚡ Key #${activeKeyIndex} error ➔ Key #${activeKeyIndex + 1}`, 'info');
            continue;
          }
          throw err;
        }
      }

      if (!outText) throw (lastError || new Error('No content returned by AI'));

      let parsed = [];
      try {
        let clean = outText.trim();
        if (clean.startsWith('```json')) clean = clean.replace(/^```json\s*/i, '').replace(/\s*```$/, '');
        else if (clean.startsWith('```')) clean = clean.replace(/^```\s*/i, '').replace(/\s*```$/, '');
        parsed = JSON.parse(clean);
      } catch (err) {
        console.error('AI JSON parse failed on:', outText);
        throw new Error('AI response format invalid');
      }

      if (Array.isArray(parsed)) {
        parsed.forEach(p => {
          const idx = p.id;
          const newTitle = (p.optimized || '').trim();
          if (newTitle) {
            const row = listEl?.querySelector(`.tck-ai-item[data-i="${idx}"]`);
            if (row) {
              row.classList.add('tck-ai-modified');
              const inp = row.querySelector('.tck-ai-item-inp');
              if (inp) {
                inp.value = newTitle;
                inp.style.background = 'rgba(168, 85, 247, 0.25)';
                setTimeout(() => { if (inp) inp.style.background = ''; }, 1200);
              }
              const cnt = row.querySelector('.tck-ai-char-badge');
              if (cnt) {
                const len = newTitle.length;
                cnt.textContent = `${len}/120`;
                cnt.className = `tck-ai-char-badge ${len > 120 ? 'bad' : len > 100 ? 'warn' : 'ok'}`;
              }
              const chk = row.querySelector('.tck-ai-item-chk');
              if (chk) chk.checked = true;
            }
            optimizedCount++;
          }
        });
      }
    }

    if (statusEl) statusEl.textContent = `✓ ${optimizedCount} titles check ho gaye. Aap kisi ko bhi edit kar sakte hain!`;
    toast(`✨ ${optimizedCount} titles AI se generate ho gaye!`, 'ok');
    updateAiStudioCounts();
  } catch (err) {
    console.error('AI Title Studio Error:', err);
    if (statusEl) statusEl.textContent = `⚠️ Error: ${err.message}`;
    toast(`AI Error: ${err.message}`, 'bad');
  } finally {
    if (runBtn) {
      runBtn.classList.remove('busy');
      runBtn.innerHTML = '<svg class="i i-xs" viewBox="0 0 24 24"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> ✨ Run AI Title Check';
    }
  }
}

function applyAiStudioTitles() {
  const listEl = $('tckAiStudioList');
  if (!listEl || !TemuCheck || !TemuCheck.items) return;

  const items = TemuCheck.items;
  let appliedCount = 0;

  listEl.querySelectorAll('.tck-ai-item').forEach(row => {
    const chk = row.querySelector('.tck-ai-item-chk');
    if (!chk || !chk.checked) return;

    const idx = +row.dataset.i;
    const inp = row.querySelector('.tck-ai-item-inp');
    const newTitle = (inp?.value || '').trim();

    if (!isNaN(idx) && items[idx] && newTitle) {
      items[idx].title = newTitle;
      items[idx]._aiOptimized = true;
      appliedCount++;

      const mainRow = document.querySelector(`#temuCheckList .tck-row[data-i="${idx}"]`);
      if (mainRow) {
        mainRow.dataset.ai = 'true';
        const tInp = mainRow.querySelector('.tck-title-inp');
        if (tInp) {
          tInp.value = newTitle;
          tInp.style.background = 'rgba(16, 185, 129, 0.25)';
          setTimeout(() => { if (tInp) tInp.style.background = ''; }, 1200);
        }
        const cnt = mainRow.querySelector('.tck-chars');
        if (cnt) {
          const len = newTitle.length;
          cnt.textContent = `${len}/120`;
          cnt.className = `tck-chars ${len > 140 ? 'bad' : len > 120 ? 'warn' : ''}`;
        }
      }
    }
  });

  temuCheckSummary();
  closeAiTitleStudio();
  toast(`✅ ${appliedCount} titles pre-upload list mein apply ho gaye!`, 'ok');
  if (appliedCount > 0) {
    showAiDoneModal(
      'AI Studio Applied',
      `🎉 ${appliedCount} titles successfully update ho gaye!`,
      'Pre-upload review list mein updated titles ready hain.'
    );
  }
}

// ═══════════════════════════════════════════════════════════════
// INSTANT LIVE SEARCH (PRE-UPLOAD REVIEW TABLE)
// ═══════════════════════════════════════════════════════════════
function tckFilterBySearch(q) {
  if (!TemuCheck) return;
  TemuCheck.view.q = q || '';
  temuCheckSync();
}

// ═══════════════════════════════════════════════════════════════
// 1-CLICK SMART PRICING PRESETS
// ═══════════════════════════════════════════════════════════════
function applyPricingPreset(presetKey) {
  const presets = {
    standard: { mult: 1.35, minProfit: 2.0, heavyBuf: 4.0, round99: true, name: 'Standard (1.35x)' },
    high_margin: { mult: 2.50, minProfit: 4.0, heavyBuf: 6.0, round99: true, name: 'High Margin (2.5x)' },
    heavy_bulky: { mult: 1.25, minProfit: 3.0, heavyBuf: 10.0, round99: true, name: 'Heavy Bulky (+$10)' },
    aggressive: { mult: 1.18, minProfit: 0.0, heavyBuf: 2.0, round99: false, name: 'Aggressive (1.18x)' }
  };

  const p = presets[presetKey];
  if (!p) return;

  const pxInp = $('tgPx'); if (pxInp) pxInp.value = String(p.mult);
  const px2Inp = $('tgPx2'); if (px2Inp) px2Inp.value = String(p.mult);
  const minPInp = $('tgMinProfit'); if (minPInp) minPInp.value = String(p.minProfit);
  const heavyInp = $('tgHeavyBuffer'); if (heavyInp) heavyInp.value = String(p.heavyBuf);
  const r99 = $('tgRound99'); if (r99) r99.checked = p.round99;
  const r99_2 = $('tgRound992'); if (r99_2) r99_2.checked = p.round99;

  document.querySelectorAll('.zh-pricing-preset-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.preset === presetKey);
  });

  const cfg = temuGetCfg();
  cfg.list_price_multiplier = p.mult;
  cfg.min_profit = p.minProfit;
  cfg.heavy_buffer = p.heavyBuf;
  cfg.price_round_to_99 = p.round99;
  temuSaveCfg(cfg);

  if (TemuCheck?.items?.length) {
    TemuCheck.items.forEach((it, idx) => {
      const baseCost = it.source_price ?? it.cost ?? it.base ?? 10;
      let calculated = baseCost * p.mult;
      if (p.minProfit && (calculated - baseCost) < p.minProfit) calculated = baseCost + p.minProfit;
      if (parseFloat(it.weight) >= 2 && p.heavyBuf) calculated += p.heavyBuf;
      if (p.round99) calculated = Math.floor(calculated) + 0.99;
      else calculated = Math.round(calculated * 100) / 100;

      it.base = calculated;
      it.list = Math.round((calculated * 1.2) * 100) / 100;

      const row = document.querySelector(`#temuCheckList .tck-row[data-i="${idx}"]`);
      if (row) {
        const inp = row.querySelector('.tck-price');
        if (inp) inp.value = calculated.toFixed(2);
      }
    });
    temuCheckSummary();
    saveTemuCheckSession();
  }

  temuUpdatePricePreview();
  toast(`Pricing applied: ${p.name}`, 'ok');
}

// ═══════════════════════════════════════════════════════════════
// CRASH-PROOF REVIEW SESSION PERSISTENCE
// ═══════════════════════════════════════════════════════════════
let _sessionSaveTimer = null;
function saveTemuCheckSession() {
  clearTimeout(_sessionSaveTimer);
  _sessionSaveTimer = setTimeout(() => {
    try {
      if (TemuCheck && Array.isArray(TemuCheck.items) && TemuCheck.items.length) {
        chrome.storage.local.set({
          zh_saved_temu_session: {
            items: TemuCheck.items,
            skipped: TemuCheck.skipped || [],
            savedAt: Date.now()
          }
        });
      } else {
        chrome.storage.local.remove('zh_saved_temu_session');
      }
    } catch (_) {}
  }, 400);
}

function restoreTemuCheckSession() {
  chrome.storage.local.get('zh_saved_temu_session', res => {
    const s = res?.zh_saved_temu_session;
    if (!s || !Array.isArray(s.items) || !s.items.length) return;
    const ageMs = Date.now() - (s.savedAt || 0);
    if (ageMs < 24 * 60 * 60 * 1000) {
      if (!TemuCheck || !TemuCheck.items || !TemuCheck.items.length) {
        const cfg = temuGetCfg();
        temuCheckRender(s.items, s.skipped || [], cfg);
        toast(`✨ Restored ${s.items.length} products from previous session!`, 'ok');
      }
    }
  });
}

// ═══════════════════════════════════════════════════════════════
// AI ATTRIBUTES & SPECIFICATIONS AUTO-EXTRACTOR
// ═══════════════════════════════════════════════════════════════
async function temuAiExtractAttributes() {
  if (!TemuCheck || !TemuCheck.items || !TemuCheck.items.length) {
    toast('Pehle products hunt karein ya Review table kholein', 'warn');
    return;
  }
  const cfg = temuGetCfg();
  const rawKeyStr = (cfg.gemini_api_key || $('tgGeminiKey')?.value || '').trim();
  const keyList = temuGetAiKeys(rawKeyStr);
  if (!keyList.length) {
    toast('Pehle Settings → AI Optimizer mein API Key enter karein', 'warn');
    return;
  }

  const allItems = TemuCheck.items;
  const rows = document.querySelectorAll('#temuCheckList .tck-row');
  let targetIndices = [];
  rows.forEach(r => {
    const chk = r.querySelector('.tck-on');
    const idx = +r.dataset.i;
    if (chk && chk.checked && allItems[idx]) targetIndices.push(idx);
  });
  if (!targetIndices.length) {
    targetIndices = allItems.map((_, idx) => idx);
  }

  const btn = $('temuAiAttributesBtn');
  if (btn) {
    btn.classList.add('busy');
    btn.textContent = '⏳ Specs...';
  }

  const CHUNK_SIZE = 20;
  let extractedCount = 0;
  try {
    let activeKeyIndex = 0;

    for (let c = 0; c < targetIndices.length; c += CHUNK_SIZE) {
      const chunkIndices = targetIndices.slice(c, c + CHUNK_SIZE);
      const inputList = chunkIndices.map(idx => {
        const it = allItems[idx];
        return {
          id: idx,
          title: it.title || '',
          description: (it.description || '').slice(0, 300),
          bullets: Array.isArray(it.bullets) ? it.bullets.slice(0, 5).join('; ') : ''
        };
      });

      const systemPrompt = `You are an expert e-commerce catalog specialist extracting product specifications for Temu marketplace listings.
Analyze each product and accurately extract these 5 key attributes:
1. material: Primary material (e.g., Stainless Steel, Cotton, Plastic, Ceramic, PU Leather, Solid Wood, Aluminum). If unknown, leave empty string "".
2. size: Size specification (e.g., 12 oz, Large, 10x8 inch, 500ml, Standard). If unknown, leave empty string "".
3. color: Primary color or color combination (e.g., Black, White, Navy Blue, Multicolor). If unknown, leave empty string "".
4. model: Model number or sub-series name. If unknown, leave empty string "".
5. pack_count: Item quantity / pack count (e.g., 1, 2, 4, 12). If unknown, default to 1.

Return ONLY a valid JSON array of objects with keys: "id", "material", "size", "color", "model", "pack_count". No explanations or markdown.`;

      let outText = '';
      let chunkSuccess = false;
      let lastError = null;

      while (activeKeyIndex < keyList.length && !chunkSuccess) {
        const apiKey = keyList[activeKeyIndex];
        const isGroq = apiKey.startsWith('gsk_');

        try {
          if (isGroq) {
            const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
              },
              body: JSON.stringify({
                model: 'openai/gpt-oss-120b',
                messages: [
                  { role: 'system', content: systemPrompt },
                  { role: 'user', content: JSON.stringify(inputList) }
                ],
                temperature: 0.1
              })
            });
            const resData = await res.json();
            if (res.status === 429 || resData.error?.code === 'rate_limit_exceeded') {
              activeKeyIndex++;
              if (activeKeyIndex < keyList.length) continue;
              else throw new Error('All Groq keys rate-limited');
            }
            if (resData.error) throw new Error(resData.error.message || 'Groq API error');
            outText = resData?.choices?.[0]?.message?.content || '';
            chunkSuccess = true;
          } else {
            let { model, apiVer } = await temuGetGeminiModelInfo(apiKey);
            let geminiUrl = `https://generativelanguage.googleapis.com/${apiVer}/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
            const payload = {
              contents: [{ role: 'user', parts: [{ text: systemPrompt + '\n\nINPUT DATA:\n' + JSON.stringify(inputList) }] }],
              generationConfig: { temperature: 0.1, maxOutputTokens: 2048, responseMimeType: 'application/json' }
            };
            let res = await fetch(geminiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
            let resData = await res.json();
            if (res.status === 429) {
              activeKeyIndex++;
              if (activeKeyIndex < keyList.length) continue;
              else throw new Error('All Gemini keys quota exceeded');
            }
            if (resData.error) throw new Error(resData.error.message || 'Gemini API error');
            outText = resData?.candidates?.[0]?.content?.parts?.[0]?.text;
            chunkSuccess = true;
          }
        } catch (err) {
          lastError = err;
          if (activeKeyIndex + 1 < keyList.length) {
            activeKeyIndex++;
            continue;
          }
          throw err;
        }
      }

      if (!outText) throw (lastError || new Error('No content returned by AI'));

      let parsed = [];
      try {
        let clean = outText.trim();
        if (clean.startsWith('```json')) clean = clean.replace(/^```json\s*/i, '').replace(/\s*```$/, '');
        else if (clean.startsWith('```')) clean = clean.replace(/^```\s*/i, '').replace(/\s*```$/, '');
        parsed = JSON.parse(clean);
      } catch (err) {
        console.error('AI JSON parse failed:', outText);
      }

      if (Array.isArray(parsed)) {
        parsed.forEach(p => {
          const idx = p.id;
          if (allItems[idx]) {
            allItems[idx].attributes = {
              material: p.material || '',
              size: p.size || '',
              color: p.color || allItems[idx].color || '',
              model: p.model || '',
              pack_count: p.pack_count || 1
            };
            if (p.color && !allItems[idx].color) allItems[idx].color = p.color;

            const row = document.querySelector(`#temuCheckList .tck-row[data-i="${idx}"]`);
            if (row) {
              let badgeWrap = row.querySelector('.tck-attr-badges');
              if (!badgeWrap) {
                badgeWrap = document.createElement('div');
                badgeWrap.className = 'tck-attr-badges';
                const meta = row.querySelector('.tck-meta');
                if (meta) meta.appendChild(badgeWrap);
              }
              const chips = [];
              if (p.material) chips.push(`<span class="tck-attr-chip">🧶 <b>${esc(p.material)}</b></span>`);
              if (p.size) chips.push(`<span class="tck-attr-chip">📐 <b>${esc(p.size)}</b></span>`);
              if (p.color) chips.push(`<span class="tck-attr-chip">🎨 <b>${esc(p.color)}</b></span>`);
              if (p.pack_count && p.pack_count > 1) chips.push(`<span class="tck-attr-chip">📦 <b>${p.pack_count}-Pack</b></span>`);
              badgeWrap.innerHTML = chips.join('');
            }
            extractedCount++;
          }
        });
      }
    }

    saveTemuCheckSession();
    toast(`🧩 ${extractedCount} products ke attributes extract ho gaye!`, 'ok');
  } catch (err) {
    console.error('AI Specs Error:', err);
    toast(`AI Specs Error: ${err.message}`, 'bad');
  } finally {
    if (btn) {
      btn.classList.remove('busy');
      btn.textContent = '🧩 AI Specs';
    }
  }
}

let detectedGeminiModel = 'gemini-3.6-flash';
let detectedGeminiApiVersion = 'v1beta';

async function temuGetGeminiModelInfo(apiKey, forceRefresh = false) {
  if (detectedGeminiModel && !forceRefresh) {
    return { model: detectedGeminiModel, apiVer: detectedGeminiApiVersion };
  }

  const versions = ['v1beta', 'v1'];
  for (const ver of versions) {
    try {
      const listRes = await fetch(`https://generativelanguage.googleapis.com/${ver}/models?key=${encodeURIComponent(apiKey)}`);
      const listData = await listRes.json();
      if (listData && Array.isArray(listData.models) && listData.models.length > 0) {
        const candidates = listData.models.filter(m => 
          Array.isArray(m.supportedGenerationMethods) && 
          m.supportedGenerationMethods.includes('generateContent')
        );

        // Sort descending: highest version + flash first (e.g. 3.6-flash > 2.5-flash > 2.0-flash)
        candidates.sort((a, b) => {
          const score = mName => {
            const verMatch = mName.match(/gemini-(\d+)(?:\.(\d+))?/i);
            const v = verMatch ? (parseInt(verMatch[1] || '0', 10) * 100 + parseInt(verMatch[2] || '0', 10)) : 0;
            const isFlash = /flash/i.test(mName) ? 1000 : 0;
            return v + isFlash;
          };
          return score(b.name) - score(a.name);
        });

        if (candidates.length > 0) {
          detectedGeminiModel = candidates[0].name.replace(/^models\//, '');
          detectedGeminiApiVersion = ver;
          return { model: detectedGeminiModel, apiVer: detectedGeminiApiVersion };
        }
      }
    } catch (e) {
      console.warn(`ListModels for ${ver} failed:`, e);
    }
  }

  detectedGeminiModel = 'gemini-3.6-flash';
  detectedGeminiApiVersion = 'v1beta';
  return { model: detectedGeminiModel, apiVer: detectedGeminiApiVersion };
}

// Google Gemini AI Title Optimizer
async function temuAIOptimizeTitles(singleIndex = null, opts = {}) {
  if (!TemuCheck || !TemuCheck.items || !TemuCheck.items.length) {
    toast('Review table mein koi product nahi mila', 'warn');
    return;
  }
  const cfg = temuGetCfg();
  const rawKeyStr = (cfg.gemini_api_key || $('tgGeminiKey')?.value || '').trim();
  const keyList = temuGetAiKeys(rawKeyStr);
  if (!keyList.length) {
    toast('Pehle Settings → AI Optimizer mein API Key enter karein', 'warn');
    const pill = document.querySelector('a[href="#tgSecGeminiAi"]');
    if (pill) pill.click();
    return;
  }

  const allItems = TemuCheck.items;
  let targetIndices = [];

  if (opts?.targetIndices && Array.isArray(opts.targetIndices)) {
    targetIndices = opts.targetIndices;
  } else if (singleIndex !== null && typeof singleIndex === 'number') {
    targetIndices = [singleIndex];
  } else {
    const rows = document.querySelectorAll('#temuCheckList .tck-row');
    rows.forEach(r => {
      const chk = r.querySelector('.tck-on');
      const idx = +r.dataset.i;
      if (chk && chk.checked && allItems[idx]) targetIndices.push(idx);
    });
    if (!targetIndices.length) {
      targetIndices = allItems.map((_, idx) => idx);
    }
  }

  if (!targetIndices.length) {
    toast('Optimize karne ke liye koi product select nahi hai', 'warn');
    return;
  }

  const mainBtn = $('temuAiOptimizeBtn');
  if (mainBtn && singleIndex === null) {
    mainBtn.classList.add('busy');
    mainBtn.textContent = '⏳ AI Optimizing...';
  }
  if (singleIndex !== null) {
    const rowBtn = document.querySelector(`.tck-ai-row-btn[data-i="${singleIndex}"]`);
    if (rowBtn) {
      rowBtn.classList.add('busy');
      rowBtn.textContent = '⏳...';
    }
  }

  // Approved Brands Whitelist
  const keepBrands = cfg.ai_keep_approved_brands !== false;
  let approvedBrands = [];
  if (keepBrands) {
    const brandMap = {};
    if (cfg.brand_rules && typeof cfg.brand_rules === 'object') {
      Object.keys(cfg.brand_rules).forEach(b => { if (b.trim()) brandMap[b.trim()] = true; });
    }
    if (cfg.trademarks && typeof cfg.trademarks === 'object') {
      Object.keys(cfg.trademarks).forEach(b => { if (b.trim()) brandMap[b.trim()] = true; });
    }
    if (cfg.brands && typeof cfg.brands === 'object') {
      Object.values(cfg.brands).forEach(b => { if (b.trim()) brandMap[b.trim()] = true; });
    }
    approvedBrands = Object.keys(brandMap);
  }

  const stripClaims = cfg.ai_strip_claims !== false;
  const userInstructions = (opts?.customPrompt || cfg.ai_custom_instructions || $('tgAiInstructions')?.value || '').trim();
  const rawBanned = (cfg.ai_banned_words ?? $('tgBannedWords')?.value ?? '').trim();
  const defaultBanned = 'cure, treat, healing, disease, remedy, therapeutic, detox, relief, pain relief, immunity, clinical, medicine, sterile, eco-friendly, biodegradable, sustainable, zero waste, 100% organic, non-toxic, chemical-free, baby, infant, newborn, toddler, crib, nursery, pediatric, lifetime warranty, guaranteed, prime';
  const bannedWordsList = (rawBanned || defaultBanned).split(',').map(s => s.trim()).filter(Boolean);
  const isReListMode = Boolean(opts?.isReList);

  let optimizedCount = 0;
  const CHUNK_SIZE = 25;

  try {
    let activeKeyIndex = 0;

    for (let c = 0; c < targetIndices.length; c += CHUNK_SIZE) {
      const chunkIndices = targetIndices.slice(c, c + CHUNK_SIZE);
      const inputList = chunkIndices.map(idx => ({
        id: idx,
        title: allItems[idx].title || ''
      }));

      const systemPrompt = `You are an expert e-commerce copywriter optimizing product titles specifically for the Temu marketplace.
Your job is to rewrite each product title so it is descriptive, clean, accurate, attractive, and strictly compliant with official Temu marketplace guidelines.

TEMU OFFICIAL TITLE STRUCTURE & REQUIREMENTS:
1. Target length: strictly between 80 and 135 characters. Titles shorter than 75 characters are blocked by Temu's algorithm for "Product title too short". Never exceed 140 characters.
2. Official recommended structure (separated by commas where appropriate):
   [Quantifier/Pack] + [Core Feature] + [Short Product Keywords], [Additional Feature], [Alternative Keyword], [Target Market / Audience], [Size / Color (if applicable)], [Product Category]
   Example pattern: "2-Pack Heavy Duty Wireless Earbuds, Deep Bass Waterproof, Bluetooth 5.3 Headphones for Running Workout, In-Ear Black, Consumer Electronics"
3. Quality: Capitalize the first letter of major words (Title Case). Do NOT use ALL-CAPS words, emojis, or symbols like '***' or '>>>'.
${approvedBrands.length ? `4. CRITICAL BRAND RULE: The seller is authorized and APPROVED to sell these brands: [${approvedBrands.join(', ')}].
   - If a product title mentions any of these approved brands, YOU MUST PRESERVE the brand name in the title!
   - For any OTHER third-party brands NOT in this approved list, remove the brand name to avoid copyright/IP violations.` : `4. Remove third-party trademarked brand names to avoid copyright/IP violations.`}
${stripClaims && bannedWordsList.length ? `5. STRICT BANNED WORDS & CLAIMS (NEVER USE ANY OF THESE):
   [${bannedWordsList.join(', ')}]
   - Health/Medical claims: Never claim health benefits, medical treatment, pain relief, or healing.
   - Environmental claims: Never make unverified eco/green claims (like eco-friendly, biodegradable, sustainable). Note: genuine colors (e.g. "Green Shirt", "Green Tea") are permitted if part of the product name/color.
   - Baby/Infant words: Strictly avoid baby, infant, toddler, newborn terms (which trigger Temu CPC/CPSC certification blocks).
   - Warranty/Hype/Platforms: Remove warranty, guaranteed, Amazon, Walmart, Prime.` : ''}
${userInstructions ? `6. USER CUSTOM RULES: ${userInstructions}` : ''}
${isReListMode ? `7. SPECIAL RE-LISTING DIRECTIVE:
   - These products were previously listed on Temu.
   - YOU MUST REWRITE AND RESTRUCTURE the title with fresh, alternative SEO keywords and angles so it is NOT identical to the old listing, strictly avoiding Temu duplicate product / title penalties.
   - Keep approved brand and core specifications accurate, but vary phrasing and keyword order significantly.` : ''}

You will receive a JSON list of objects with "id" and "title".
Return ONLY a valid JSON array of objects with "id" and "optimized" (the new title string).
Do NOT include explanations or markdown fences. Just the raw JSON array.`;

      let outText = '';
      let chunkSuccess = false;
      let lastError = null;

      while (activeKeyIndex < keyList.length && !chunkSuccess) {
        const apiKey = keyList[activeKeyIndex];
        const isGroq = apiKey.startsWith('gsk_');

        try {
          if (isGroq) {
            const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
              },
              body: JSON.stringify({
                model: 'openai/gpt-oss-120b',
                messages: [
                  { role: 'system', content: systemPrompt },
                  { role: 'user', content: JSON.stringify(inputList) }
                ],
                temperature: 0.2
              })
            });
            const resData = await res.json();
            if (res.status === 429 || resData.error?.code === 'rate_limit_exceeded' || (resData.error?.message && /rate limit|tokens per/i.test(resData.error.message))) {
              console.log(`Groq Key #${activeKeyIndex + 1} rate-limited, switching to next key...`);
              activeKeyIndex++;
              if (activeKeyIndex < keyList.length) {
                toast(`⚡ Groq Key #${activeKeyIndex} limit ➔ Switching to Key #${activeKeyIndex + 1}`, 'info');
                continue;
              } else {
                throw new Error('All Groq keys rate-limited. Please wait 1 minute.');
              }
            }
            if (resData.error) throw new Error(resData.error.message || 'Groq API call failed');
            outText = resData?.choices?.[0]?.message?.content || '';
            chunkSuccess = true;
          } else {
            let { model, apiVer } = await temuGetGeminiModelInfo(apiKey);
            let geminiUrl = `https://generativelanguage.googleapis.com/${apiVer}/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
            const payload = {
              contents: [
                {
                  role: 'user',
                  parts: [
                    { text: systemPrompt + '\n\nINPUT TITLES:\n' + JSON.stringify(inputList) }
                  ]
                }
              ],
              generationConfig: {
                temperature: 0.3,
                maxOutputTokens: 2048,
                responseMimeType: 'application/json'
              }
            };

            let res = await fetch(geminiUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'X-goog-api-key': apiKey },
              body: JSON.stringify(payload)
            });

            let resData = await res.json();
            if (resData.error) {
              const m = (resData.error.message || '').match(/use\s+models\/([a-zA-Z0-9\.\-_]+)/i);
              if (m && m[1]) {
                model = m[1];
                detectedGeminiModel = model;
                geminiUrl = `https://generativelanguage.googleapis.com/${apiVer}/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
                res = await fetch(geminiUrl, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', 'X-goog-api-key': apiKey },
                  body: JSON.stringify(payload)
                });
                resData = await res.json();
              }
            }

            if (res.status === 429 || resData.error?.code === 429) {
              activeKeyIndex++;
              if (activeKeyIndex < keyList.length) {
                toast(`⚡ Gemini limit ➔ Switching to Key #${activeKeyIndex + 1}`, 'info');
                continue;
              } else {
                throw new Error('All API keys rate-limited. Please wait a moment.');
              }
            }

            if (resData.error) throw new Error(resData.error.message || 'Gemini API call failed');
            outText = resData?.candidates?.[0]?.content?.parts?.[0]?.text;
            chunkSuccess = true;
          }
        } catch (err) {
          lastError = err;
          if (activeKeyIndex + 1 < keyList.length) {
            activeKeyIndex++;
            toast(`⚡ Key #${activeKeyIndex} error ➔ Trying Key #${activeKeyIndex + 1}`, 'info');
            continue;
          }
          throw err;
        }
      }

      if (!outText) throw (lastError || new Error('No content returned by AI'));

      let parsed = [];
      try {
        let clean = outText.trim();
        if (clean.startsWith('```json')) clean = clean.replace(/^```json\s*/i, '').replace(/\s*```$/, '');
        else if (clean.startsWith('```')) clean = clean.replace(/^```\s*/i, '').replace(/\s*```$/, '');
        // Try strict parse first
        try {
          parsed = JSON.parse(clean);
        } catch (_) {
          // Response may be truncated — salvage complete objects already present
          const items = [];
          const objRegex = /\{[^{}]*"id"\s*:\s*(\d+)[^{}]*"optimized"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
          let m;
          while ((m = objRegex.exec(clean)) !== null) {
            items.push({ id: +m[1], optimized: m[2].replace(/\\"/g, '"') });
          }
          if (items.length > 0) {
            parsed = items;
            console.warn(`AI JSON truncated — salvaged ${items.length} item(s) from partial response`);
            toast(`⚠️ AI response truncated — ${items.length} titles saved`, 'info');
          } else {
            console.error('AI JSON parse failed on:', outText);
            throw new Error('AI response format invalid');
          }
        }
      } catch (err) {
        if (err.message === 'AI response format invalid') throw err;
        console.error('AI JSON parse failed on:', outText);
        throw new Error('AI response format invalid');
      }

      if (Array.isArray(parsed)) {
        parsed.forEach(p => {
          const idx = p.id;
          const newTitle = (p.optimized || '').trim();
          if (allItems[idx] && newTitle) {
            allItems[idx].title = newTitle;
            allItems[idx]._aiOptimized = true;
            optimizedCount++;
            const row = document.querySelector(`#temuCheckList .tck-row[data-i="${idx}"]`);
            if (row) {
              row.dataset.ai = 'true';
              const inp = row.querySelector('.tck-title-inp');
              if (inp) {
                inp.value = newTitle;
                inp.style.transition = 'background 0.4s';
                inp.style.background = 'rgba(168, 85, 247, 0.25)';
                setTimeout(() => { if (inp) inp.style.background = ''; }, 1200);
              }
              const cnt = row.querySelector('.tck-chars');
              if (cnt) {
                const len = newTitle.length;
                cnt.textContent = `${len}/120`;
                cnt.className = `tck-chars ${len > 140 ? 'bad' : len > 120 ? 'warn' : ''}`;
              }
            }
          }
        });
      }
    }

    temuCheckSummary();
    toast(`✨ ${optimizedCount} titles AI se optimize ho gaye!`, 'ok');
    if (optimizedCount > 0) {
      showAiDoneModal(
        'AI Optimization Done',
        `🎉 ${optimizedCount} products ke titles AI se optimize ho gaye!`,
        'Sabhi selected products ke titles successfully update ho gaye hain.'
      );
    }
  } catch (err) {
    console.error('AI Title Optimization Error:', err);
    toast(`AI Error: ${err.message}`, 'bad');
  } finally {
    if (mainBtn && singleIndex === null) {
      mainBtn.classList.remove('busy');
      mainBtn.textContent = '🤖 AI Optimize';
    }
    if (singleIndex !== null) {
      const rowBtn = document.querySelector(`.tck-ai-row-btn[data-i="${singleIndex}"]`);
      if (rowBtn) {
        rowBtn.classList.remove('busy');
        rowBtn.textContent = '✨ AI';
      }
    }
  }
}

async function temuTestGeminiConnection() {
  const rawKeyStr = ($('tgGeminiKey')?.value || temuGetCfg()?.gemini_api_key || '').trim();
  const keys = temuGetAiKeys(rawKeyStr);
  const st = $('tgGeminiStatus');
  const btn = $('tgGeminiTestBtn');
  if (!keys.length) {
    if (st) { st.textContent = '✗ Pehle API key paste karein'; st.className = 'temu-inline-msg bad'; }
    toast('API key enter karein', 'warn');
    return;
  }
  if (btn) btn.disabled = true;

  const key = keys[0];
  const isGroq = key.startsWith('gsk_');
  if (st) { st.textContent = isGroq ? `⏳ Testing Groq AI (${keys.length} keys loaded)...` : '⏳ Testing Gemini connection...'; st.className = 'temu-inline-msg'; }

  try {
    if (isGroq) {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${key}`
        },
        body: JSON.stringify({
          model: 'openai/gpt-oss-120b',
          messages: [{ role: 'user', content: 'Reply with the word OK' }],
          max_tokens: 10,
          temperature: 0
        })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error.message || 'Groq API error');
      if (st) {
        st.textContent = `✓ Connected successfully! ${keys.length} Groq Keys Active (Auto-Failover ON).`;
        st.className = 'temu-inline-msg ok';
      }
      toast(`✓ Groq AI Connected! (${keys.length} keys active)`, 'ok');
    } else {
      let { model, apiVer } = await temuGetGeminiModelInfo(key, true);
      let url = `https://generativelanguage.googleapis.com/${apiVer}/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
      let res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-goog-api-key': key },
        body: JSON.stringify({
          contents: [{ parts: [{ text: 'Reply with the single word: OK' }] }],
          generationConfig: { maxOutputTokens: 10, temperature: 0 }
        })
      });
      let data = await res.json();
      if (data.error) {
        const m = (data.error.message || '').match(/use\s+models\/([a-zA-Z0-9\.\-_]+)/i);
        if (m && m[1]) {
          model = m[1];
          detectedGeminiModel = model;
          url = `https://generativelanguage.googleapis.com/${apiVer}/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
          res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-goog-api-key': key },
            body: JSON.stringify({
              contents: [{ parts: [{ text: 'Reply with the single word: OK' }] }],
              generationConfig: { maxOutputTokens: 10, temperature: 0 }
            })
          });
          data = await res.json();
        }
      }

      if (data.error) throw new Error(data.error.message || 'API rejected request');
      if (st) {
        st.textContent = `✓ Connected successfully! Active Model: ${model}`;
        st.className = 'temu-inline-msg ok';
      }
      toast(`✓ Gemini Connected! (${model})`, 'ok');
    }
  } catch (err) {
    if (st) {
      st.textContent = '✗ Connection failed: ' + err.message;
      st.className = 'temu-inline-msg bad';
    }
    toast('API error: ' + err.message, 'bad');
  } finally {
    if (btn) btn.disabled = false;
  }
}
function temuAutoFixAll() {
  if (!TemuCheck || !TemuCheck.items) return;
  const { items, cfg } = TemuCheck;
  const defaultWeight = parseFloat(cfg.default_weight) || 1.4;
  const defaultProf = Object.values(cfg.category_profiles || {})[0] || {};
  const defaultCat = defaultProf.category_keyword || '';
  const defaultAttrs = defaultProf.keyword_attributes || defaultProf.attributes || '';
  let fixedCount = 0;

  items.forEach(it => {
    let touched = false;
    // 1. Strip banned words & IP terms
    const cleanT = temuCleanTitle(it.title, cfg);
    if (cleanT !== it.title) {
      it.title = cleanT;
      touched = true;
    }

    // 2. Trim title if > 120 chars
    if (it.title && it.title.length > 120) {
      let t = it.title.slice(0, 120);
      const sp = t.lastIndexOf(' ');
      if (sp > 95) t = t.slice(0, sp);
      it.title = t.trim();
      touched = true;
    }

    // 3. Fix missing weight
    const wt = parseFloat(it.weight);
    if (!wt || wt <= 0) {
      it.weight = defaultWeight;
      it.wsrc = 'default';
      touched = true;
    }

    // 4. Fallback category & attributes if none
    if (!it.category_keyword && defaultCat) {
      it.category_keyword = defaultCat;
      if (defaultAttrs && !it.keyword_attributes) {
        it.keyword_attributes = typeof defaultAttrs === 'string' ? defaultAttrs : JSON.stringify(defaultAttrs);
      }
      touched = true;
    }

    if (touched) fixedCount++;
  });

  temuCheckRender(items, TemuCheck.skipped, cfg);

  // Auto-uncheck unfixable items (e.g. no images or no price)
  let unch = 0;
  items.forEach((it, i) => {
    const flags = temuCheckFlags(it, cfg);
    if (flags.some(f => f.k === 'bad')) {
      const chk = document.querySelector(`#temuCheckList .tck-row[data-i="${i}"] .tck-on`);
      if (chk && chk.checked) { chk.checked = false; unch++; }
    }
  });
  if (unch) temuCheckSummary();

  toast(`⚡ Auto-fixed ${fixedCount} product${fixedCount === 1 ? '' : 's'}!${unch ? ` (${unch} unfixable unselected)` : ''}`, 'ok');
}
function temuCheckClose() { const c = $('temuCheckCard'); if (c) { c.hidden = true; c.style.display = 'none'; } const acts = document.querySelector('.temu-actions'); if (acts) acts.style.display = ''; TemuCheck = null; temuReviewMode(false); try { chrome.storage.local.remove('zh_saved_temu_session'); } catch (_) {} }

// Returns array of checked items with live title/price/weight values read from UI
function temuCheckSelected() {
  if (!TemuCheck) return [];
  const { items } = TemuCheck;
  const sel = [];
  document.querySelectorAll('#temuCheckList .tck-row').forEach(row => {
    const i = +row.dataset.i, it = items[i]; if (!it) return;
    const on = row.querySelector('.tck-on')?.checked;
    if (!on) return;
    const titleVal = row.querySelector('.tck-title-inp')?.value?.trim();
    if (titleVal) it.title = titleVal;
    const px = parseFloat(row.querySelector('.tck-price')?.value);
    if (isFinite(px) && px > 0) it.base = Math.round(px * 100) / 100;
    const wtVal = parseFloat(row.querySelector('.tck-weight')?.value);
    if (isFinite(wtVal) && wtVal > 0) it.weight = Math.round(wtVal * 10) / 10;
    const cat = row.querySelector('.tck-cat')?.value;
    if (cat) it.category_keyword = cat;
    sel.push(it);
  });
  return sel;
}

// v10.3.2 — review mode: upar ke store/template/pricing cards ek line mein simat jate hain, products upar aa jate hain
function temuReviewMode(on) {
  const m = $('temuModal'); if (!m) return;
  m.classList.toggle('temu-review-mode', !!on);
  if (!on) m.classList.remove('temu-review-expanded');
  const bar = $('temuReviewCompact'); if (bar) bar.hidden = !on;
  if (on) temuReviewCompactText();
}
function temuReviewCompactText() {
  const t = $('temuReviewCompactTxt'); if (!t) return;
  const st = temuActiveStoreName() || 'store?';
  const tpl = temuActiveStore()?.templateB64 ? 'template ✓' : 'template ✗';
  const px = $('tgPx')?.value || temuGetCfg().price_multiplier || '';
  const srcTxt = $('temuSource')?.selectedOptions?.[0]?.textContent || '';
  t.textContent = `● ${st} · ${tpl} · Price ×${px} · ${srcTxt}`;
}
// Review table se selected products + user ki edits (title / price / weight / category) uthao
function temuCheckCollect() {
  if (!TemuCheck) return null;
  const { items, cfg } = TemuCheck;
  const skipped = TemuCheck.skipped.slice();
  const sel = [];
  document.querySelectorAll('#temuCheckList .tck-row').forEach(row => {
    const i = +row.dataset.i, it = items[i]; if (!it) return;
    const on = row.querySelector('.tck-on')?.checked;
    const titleVal = row.querySelector('.tck-title-inp')?.value?.trim();
    if (titleVal) it.title = titleVal;
    const px = parseFloat(row.querySelector('.tck-price')?.value);
    if (isFinite(px) && px > 0 && px !== it.base) {
      it.base = Math.round(px * 100) / 100;
      let l = it.base * (cfg.list_price_multiplier || 1.25);
      if (cfg.price_round_to_99) l = Math.floor(l) + 0.99;
      it.list = Math.round(l * 100) / 100;
    }
    const wtVal = parseFloat(row.querySelector('.tck-weight')?.value);
    if (isFinite(wtVal) && wtVal > 0 && wtVal !== it.weight) {
      it.weight = Math.round(wtVal * 10) / 10;
    }
    const cat = row.querySelector('.tck-cat')?.value ?? it.category_keyword;
    if (cat !== it.category_keyword) { it.category_keyword = cat; if (cat) it.warn = (it.warn || []).filter(w => w !== 'NO_CATEGORY_PROFILE'); }
    if (on) sel.push(it); else skipped.push('unchecked in review table: ' + (it.title || '').slice(0, 40));
  });
  return { sel, skipped, items, cfg };
}
// Review se sirf file (upload nahi): 'temu' = Temu template .xlsx, 'simple' = ZHunter title/link/price sheet
async function temuReviewExport(kind) {
  const c = temuCheckCollect(); if (!c) return;
  const { sel, skipped } = c;
  if (!sel.length) { toast('Koi product select nahi', 'warn'); return; }
  if (kind === 'simple') {
    const rows = TemuCheck.rows || [];
    const urls = new Set(sel.map(it => String(it.url || '').split('#')[0].toLowerCase()));
    let picked = rows.filter(r => urls.has(String(r.url || '').split('#')[0].toLowerCase()));
    if (!picked.length) picked = sel.map(it => ({ title: it.title, url: it.url, price: it.source_price ?? it.base, brand: it.brand, images: it.images || [], platform: it.platform || '' }));
    // review mein edit kiya hua title sheet mein bhi jaye
    const byUrl = new Map(sel.map(it => [String(it.url || '').split('#')[0].toLowerCase(), it]));
    picked = picked.map(r => { const it = byUrl.get(String(r.url || '').split('#')[0].toLowerCase()); return it && it.title ? { ...r, title: it.title } : r; });
    downloadXlsxRich(buildRichSheetData(picked), buildFilename('xlsx', '_temu_review'));
    toast(`ZHunter sheet — ${picked.length} products`, 'ok');
    return;
  }
  await temuRunExport({ forUpload: false, items: sel, skipped });
}
async function temuCheckGo() {
  const c = temuCheckCollect(); if (!c) return;
  const { sel, skipped, items, cfg } = c;
  if (!sel.length) { toast('Koi product select nahi', 'warn'); return; }

  // Confirmation if any items are skipped or overweight
  const unselCount = items.length - sel.length;
  const maxWt = parseFloat(cfg?.max_weight_lb) || 0;
  const heavyCount = sel.filter(it => it.warn?.includes('OVERWEIGHT') || (maxWt > 0 && it.weight > maxWt)).length;

  if (unselCount > 0 || heavyCount > 0) {
    const msg = [];
    if (unselCount > 0) msg.push(`⚠️ ${unselCount} products unselect hain (skip ho jayenge).`);
    if (heavyCount > 0) msg.push(`⚖️ ${heavyCount} selected products limit (${maxWt} lb) se zyada heavy hain.`);
    msg.push(`\nKya aap baaqi ${sel.length} products Temu par upload karna chahte hain?`);
    if (!confirm(msg.join('\n'))) return;
  }

  temuCheckClose();
  // v10.3.2: Excel banne ke doran bhi Stop dikhe
  TemuUploadCancelled = false; TemuUploading = true; temuStopShow(true);
  temuStepsReset(true); temuStep('prep', 'ok', `${sel.length} products`); temuStep('export', 'run', 'Building .xlsx…');
  try { await temuRunExport({ forUpload: true, items: sel, skipped }); } finally { if (!TemuLast || TemuUploadCancelled) temuStopShow(false); }
  if (TemuUploadCancelled) { temuStep('export', 'bad', 'Cancelled'); TemuUploading = false; return; }
  if (!TemuLast) { temuStep('export', 'bad', 'fail'); TemuUploading = false; return; }
  TemuLast.fromCheck = true;
  await temuAutoUpload({ skipCheck: true });
}
// v10.3.2 — Stop button (pipeline header) + purana Stop Upload button ek saath
function temuStopShow(on) {
  const sb = $('temuStopBtn'); if (sb) sb.hidden = !on;
  const cb = $('temuCancelUploadBtn'); if (cb) cb.style.display = on ? 'inline-flex' : 'none';
  const ab = $('temuAutoBtn'); if (ab) ab.style.display = on ? 'none' : 'inline-flex';
}
async function temuStopNow() {
  TemuUploadCancelled = true;
  TemuUploading = false;
  temuStopShow(false);
  temuStep('upload', 'bad', 'Cancelled');
  const rep = $('temuReport'); if (rep) rep.textContent += '\n🛑 Stop dabaya — upload rok raha hoon…';
  try {
    const r = await msg({ action: 'TEMU_ABORT_UPLOAD' });
    if (rep && r?.note) rep.textContent += '\n' + r.note;
  } catch (_) {}
  toast('Upload cancelled', 'warn');
}

// v9.8.1: Upload history mein row na mile to tab reload kar ke ek baar dobara try (Refresh button kabhi table update nahi karta)
// v9.8.3 — upload confirm time-out ke baad Upload history row ko poll karo (max 10 min, har 15s)
async function temuLateConfirm(result, rep) {
  const add = t => { if (rep) { rep.textContent = (rep.textContent || '') + '\n' + t; try { rep.scrollTop = rep.scrollHeight; } catch (_) {} } };
  const expectStore = temuActiveStoreName() || '';
  let tabId = result?.tabId ?? null;
  if (tabId == null) { const all = await chrome.tabs.query({ url: ['https://seller.temu.com/upload-goods-multiple.html*'] }); if (all[0]) tabId = all[0].id; }
  if (tabId == null) { add('• Temu upload tab nahi mila — late confirm mumkin nahi'); return null; }
  add('⏳ Upload history se confirm kar raha hoon (10 min tak, har 15s)…');
  const t0 = Date.now(); let lastLine = '', misses = 0, lastReload = 0;
  while (Date.now() - t0 < 600000) {
    const r = await new Promise(res => chrome.tabs.sendMessage(tabId, { action: 'TEMU_CHECK_UPLOAD', uploadId: result?.uploadId || null, notSig: result?.beforeSig || null, expectStore }, x => res(chrome.runtime.lastError ? { success: false, report: ['✗ ' + chrome.runtime.lastError.message] } : x)));
    if (r?.wrongStore) { (r.report || []).forEach(add); return null; }
    if (r?.success && r.done) { (r.report || []).forEach(add); return r; }
    // v9.10.2: table kabhi stale reh jati hai (Refresh register na ho) — 3 baar row na mile to tab reload (2 min mein ek baar)
    if (r?.noRow || !r?.success) { misses++; if (misses >= 3 && Date.now() - lastReload > 120000) { misses = 0; lastReload = Date.now(); add('• Row nahi mil rahi — Temu tab reload kar raha hoon…'); await new Promise(rs => chrome.tabs.reload(tabId, {}, () => { void chrome.runtime.lastError; rs(); })); await new Promise(rs => setTimeout(rs, 4000)); await new Promise(res => { let n = 0; const ping = () => chrome.tabs.sendMessage(tabId, { action: 'PING' }, x => { if (!chrome.runtime.lastError && x?.ready) return res(true); if (++n > 30) return res(false); setTimeout(ping, 500); }); ping(); }); continue; } } else misses = 0;
    const line = (r?.report || []).join(' ') + ` · ${Math.round((Date.now() - t0) / 1000)}s`;
    if (rep && line !== lastLine) { if (lastLine) rep.textContent = rep.textContent.replace('\n' + lastLine, ''); add(line); lastLine = line; }
    await new Promise(r => setTimeout(r, 15000));
  }
  add('• 10 min mein bhi confirm nahi hua — Temu tab check karein; complete ho jaye to "Listed mark karo" daba dein');
  return null;
}
// v9.14.1 — Temu tab se rabta: ping; na mile to (extension reload ke baad content script nahi hota) tab reload → 30s tak ping
async function temuEnsureTabReady(tabId, add) {
  const ping = (ms, delay) => new Promise(res => { let n = 0, max = Math.ceil(ms / 500); const p = () => chrome.tabs.sendMessage(tabId, { action: 'PING' }, r => { if (!chrome.runtime.lastError && r?.ready) return res(true); if (++n > max) return res(false); setTimeout(p, 500); }); setTimeout(p, delay); });
  if (await ping(3000, 50)) return true;
  add && add(`• Tab ${tabId}: page se rabta nahi — reload kar raha hoon…`);
  await new Promise(r => chrome.tabs.reload(tabId, {}, () => { void chrome.runtime.lastError; r(); }));
  const ok = await ping(30000, 3000);
  if (ok) await new Promise(r => setTimeout(r, 2000));
  return ok;
}
async function temuRetryAfterReload(tabId, message, add) {
  try {
    add && add('• Row nahi mili — Temu tab reload kar ke dobara dekh raha hoon…');
    await new Promise(r => chrome.tabs.reload(tabId, {}, () => { void chrome.runtime.lastError; r(); }));
    await new Promise(r => setTimeout(r, 2500));
    const ok = await new Promise(res => { let n = 0; const ping = () => chrome.tabs.sendMessage(tabId, { action: 'PING' }, r => { if (!chrome.runtime.lastError && r?.ready) return res(true); if (++n > 40) return res(false); setTimeout(ping, 500); }); ping(); });
    if (!ok) return null;
    await new Promise(r => setTimeout(r, 1500));
    return await new Promise(res => chrome.tabs.sendMessage(tabId, message, x => res(chrome.runtime.lastError ? { success: false, report: ['✗ ' + chrome.runtime.lastError.message] } : x)));
  } catch (_) { return null; }
}
const temuRowMissing = r => (r?.report || []).some(t => /upload nahi mila/i.test(t));

// ── v9.8.0 Pipeline step: upload-history row → "Complete product infomation" → wait for edit page → Fix drafts ──
// ── v9.14.0 "Missing required attributes" page (upload ke errors) — open + fill + submit ──
const TEMU_ATTR_URL = 'https://seller.temu.com/product-action.html?reform_type=excel_publish_complete_attributes';
async function temuFillAttributes() {
  const rep = $('temuReport');
  const add = t => { if (rep) { rep.textContent = (rep.textContent || '') + '\n' + t; try { rep.scrollTop = rep.scrollHeight; } catch (_) {} } };
  try {
    const cfg = temuGetCfg(); const rules = temuDraftRules(cfg);
    const defaults = (cfg.draft_default_attributes && typeof cfg.draft_default_attributes === 'object') ? cfg.draft_default_attributes : {};
    let tabs = await chrome.tabs.query({ url: ['https://seller.temu.com/product-action.html*', 'https://seller.temu.com/*products-excel-multiple-edit*'] });
    let tab = tabs.find(t => t.active) || tabs[0] || null, created = false;
    if (!tab) { tab = await chrome.tabs.create({ url: TEMU_ATTR_URL, active: true }); created = true; add('⏳ "Product action required" page khol raha hoon…'); }
    else { try { await chrome.tabs.update(tab.id, { active: true }); } catch (_) {} }
    const pingFor = (ms, delay) => new Promise(res => { let n = 0, max = Math.ceil(ms / 500); const ping = () => chrome.tabs.sendMessage(tab.id, { action: 'PING' }, r => { if (!chrome.runtime.lastError && r?.ready) return res(true); if (++n > max) return res(false); setTimeout(ping, 500); }); setTimeout(ping, delay); });
    let okP = await pingFor(created ? 30000 : 3000, created ? 2500 : 100);
    if (!okP && !created) { add('⏳ Tab se rabta nahi — reload…'); await new Promise(r => chrome.tabs.reload(tab.id, {}, () => { void chrome.runtime.lastError; r(); })); okP = await pingFor(30000, 3000); created = true; }
    if (!okP) { add('✗ Temu page se rabta nahi hua'); return false; }
    if (created) await new Promise(r => setTimeout(r, 2500));
    const isEditPage = (tab.url || '').includes('products-excel-multiple-edit');
    add(isEditPage ? '⏳ Complete product details drafts check & submit kar raha hoon…' : '⏳ Missing attributes bhar raha hoon…');
    const act = isEditPage ? 'TEMU_FIX_DRAFTS' : 'TEMU_FILL_ATTRS';
    const r = await new Promise(res => chrome.tabs.sendMessage(tab.id, { action: act, rules, defaults, autoSubmit: cfg.draft_auto_submit !== false, expectStore: temuActiveStoreName() }, x => res(chrome.runtime.lastError ? { success: false, report: ['✗ ' + chrome.runtime.lastError.message] } : x)));
    (r?.report || []).forEach(add);
    toast(r?.success ? `Attributes: ${r.changed || 0} set, ${r.submitted || 0} submitted${r.stillEmpty ? `, ${r.stillEmpty} baqi` : ''}` : 'Attributes fill fail — report dekhein', r?.success && !r.stillEmpty ? 'ok' : 'warn');
    return !!(r?.success && !r.stillEmpty);
  } catch (e) { add('✗ ' + (e?.message || e)); return false; }
}
async function temuOpenCompleteAndFix({ tabId = null, uploadId = null } = {}) {
  const rep = $('temuReport');
  const add = t => { if (rep) { rep.textContent = (rep.textContent || '') + '\n' + t; try { rep.scrollTop = rep.scrollHeight; } catch (_) {} } };
  try {
    const expectStore = temuActiveStoreName() || '';
    const before = new Set((await chrome.tabs.query({ url: ['https://seller.temu.com/*products-excel-multiple-edit*'] })).map(t => t.id));
    let cands = [];
    if (tabId != null) { const t = await new Promise(r => chrome.tabs.get(tabId, x => r(chrome.runtime.lastError ? null : x))); if (t) cands.push(t); }
    const all = await chrome.tabs.query({ url: ['https://seller.temu.com/upload-goods-multiple.html*'] });
    all.sort((a, b) => (b.active ? 1 : 0) - (a.active ? 1 : 0));
    for (const t of all) if (!cands.some(c => c.id === t.id)) cands.push(t);
    if (!cands.length) { add('✗ Temu upload page ka tab nahi mila — "Fix drafts on Temu" khud dabayen'); return false; }
    const pingOk = id => new Promise(res => { let n = 0; const ping = () => chrome.tabs.sendMessage(id, { action: 'PING' }, r => { if (!chrome.runtime.lastError && r?.ready) return res(true); if (++n > 10) return res(false); setTimeout(ping, 400); }); ping(); });
    let result = null, tab = null;
    for (const t of cands) {
      if (!(await pingOk(t.id)) && !(await temuEnsureTabReady(t.id, add))) continue; // v9.14.1 auto reload
      // v9.10.1: tab saamne lao — background tab se Temu ka naya page (window.open) Chrome block kar deta hai
      try { await chrome.tabs.update(t.id, { active: true }); await new Promise(r => setTimeout(r, 400)); } catch (_) {}
      let r = await new Promise(res => chrome.tabs.sendMessage(t.id, { action: 'TEMU_OPEN_COMPLETE', uploadId, expectStore }, x => res(chrome.runtime.lastError ? { success: false, report: ['✗ ' + chrome.runtime.lastError.message] } : x)));
      if (r?.wrongStore) continue;
      if (!r?.success && temuRowMissing(r)) { (r.report || []).forEach(add); const r2 = await temuRetryAfterReload(t.id, { action: 'TEMU_OPEN_COMPLETE', uploadId, expectStore }, add); if (r2) r = r2; }
      result = r; tab = t; break;
    }
    (result?.report || []).forEach(add);
    if (result?.noDraftsNeeded) {
      add('✓ Sab products already complete hain (0 errors) — draft fix ki zaroorat nahi.');
      temuStep('fix', 'ok', 'Clean (0 errors)');
      return true;
    }
    if (!result?.success) { add('• Drafts khud complete nahi ho sake — Temu par "Complete product infomation" dabakar phir "Fix drafts on Temu" dabayen'); return false; }
    // edit page: nayi tab ya same tab — dono handle
    let retried = false;
    const editTab = await new Promise(res => {
      const t0 = Date.now();
      const poll = async () => {
        const list = await chrome.tabs.query({ url: ['https://seller.temu.com/*products-excel-multiple-edit*'] });
        const fresh = list.find(t => !before.has(t.id)) || list.find(t => t.id === tab.id) || null;
        if (fresh && fresh.status === 'complete') return res(fresh);
        // v10.1.1: 8s baad bhi kuch nahi khula — popup block? dobara dabao; href ho to extension khud tab khole
        if (!fresh && !retried && Date.now() - t0 > 8000) {
          retried = true;
          if (result?.href) { add('• Page khud nahi khula — link se tab khol raha hoon'); try { await chrome.tabs.create({ url: result.href, active: true }); } catch (_) {} }
          else { add('• Page khud nahi khula — button dobara daba raha hoon'); try { await new Promise(r2 => chrome.tabs.sendMessage(tab.id, { action: 'TEMU_OPEN_COMPLETE', uploadId, expectStore }, () => { void chrome.runtime.lastError; r2(); })); } catch (_) {} }
        }
        if (Date.now() - t0 > 30000) return res(fresh);
        setTimeout(poll, 700);
      };
      poll();
    });
    if (!editTab) { add('✗ "Complete product details" page 30s mein nahi khula — Temu par "Complete product infomation" khud dabayen, phir "Temu par complete karo" dabayen'); if (result?.btnHtml) { try { chrome.storage.local.set({ temuDebugCompleteBtn: result.btnHtml }); } catch (_) {} } return false; }
    try { await chrome.tabs.update(editTab.id, { active: true }); } catch (_) {}
    await new Promise(r => setTimeout(r, 1500)); // page render
    add('⏳ Fix drafts chal raha hai…');
    await temuFixDrafts({ noChain: true });
    return true;
  } catch (e) { add('✗ ' + (e?.message || e)); return false; }
}

// ── v9.0.0 Fix drafts: drive Temu's "Complete product details" page ──
// Builds attribute rules from category profiles: profile.attributes {Label: Value}
// or, if missing, derived from keyword_attributes ("Rubber, 14 Years+" → Material / Age Group).
function temuDraftRules(cfg) {
  const rules = [];
  for (const [name, p] of Object.entries(cfg.category_profiles || {})) {
    let attrs = (p.attributes && typeof p.attributes === 'object') ? { ...p.attributes } : {};
    if (!Object.keys(attrs).length && p.keyword_attributes) {
      const toks = String(p.keyword_attributes).split(',').map(x => x.trim()).filter(Boolean);
      toks.forEach(tk => {
        if (/years?\s*\+|adults?|kids?|children|teens?|all ages/i.test(tk)) { if (!attrs['Applicable Age Group']) attrs['Applicable Age Group'] = tk; }
        else if (!attrs['Material']) attrs['Material'] = tk;
      });
    }
    if (Object.keys(attrs).length) rules.push({ name, match: p.match || [], attributes: attrs });
  }
  return rules;
}
async function temuFixDrafts(opts = {}) {
  { // v9.14.0: agar "Product action required" (missing attributes) page saamne khula hai to wahi bharo
    try { const [act] = await chrome.tabs.query({ active: true, currentWindow: true }); if (act && /seller\.temu\.com\/product-action\.html/.test(act.url || '')) return temuFillAttributes(); } catch (_) {}
  }
  const rep = $('temuReport');
  const say = t => { if (rep) rep.textContent = t; };
  const cfg = temuGetCfg();
  const rules = temuDraftRules(cfg);
  const defaults = (cfg.draft_default_attributes && typeof cfg.draft_default_attributes === 'object') ? cfg.draft_default_attributes : {};
  // v9.5.2: rules na hon tab bhi chalao — khali required fields fallback se bharte hain, bhare huay drafts sirf Submit hote hain
  try {
    // find an open "Complete product details" tab; otherwise open the upload-history page for the user
    const tabs = await chrome.tabs.query({ url: ['https://seller.temu.com/products-excel-multiple-edit.html*', 'https://seller.temu.com/*products-excel-multiple-edit*'] });
    let tab = tabs.find(t => t.active) || tabs[0];
    if (!tab) {
      // v9.8.3: edit page khula nahi → khud Upload history se "Complete product infomation" dabao (pehle sirf upload page khol kar ruk jata tha)
      if (opts.noChain) { say('✗ "Complete product details" page nahi khula — Temu Upload history mein "Complete product infomation" dabayen, phir "Fix drafts on Temu".'); return; }
      say('"Complete product details" page khula nahi — Upload history se khud "Complete product infomation" daba raha hoon…');
      const ups = await chrome.tabs.query({ url: ['https://seller.temu.com/upload-goods-multiple.html*'] });
      let up = ups.find(t => t.active) || ups[0] || null;
      if (!up) {
        up = await chrome.tabs.create({ url: 'https://seller.temu.com/upload-goods-multiple.html', active: true });
        const okPing = await new Promise(res => { let n = 0; const ping = () => chrome.tabs.sendMessage(up.id, { action: 'PING' }, r => { if (!chrome.runtime.lastError && r?.ready) return res(true); if (++n > 60) return res(false); setTimeout(ping, 500); }); setTimeout(ping, 1500); });
        if (!okPing) { say('✗ Temu upload page 30s mein load nahi hua — page khulne par dobara "Fix drafts on Temu" dabayen'); return; }
        await new Promise(r => setTimeout(r, 2000));
      }
      const done = await temuOpenCompleteAndFix({ tabId: up.id, uploadId: TemuLast?.uploadId || null });
      if (!done) toast('Drafts complete nahi ho sake — report dekhein', 'warn');
      return;
    }
    await chrome.tabs.update(tab.id, { active: true });
    say(`Drafts fix ho rahe hain… (${rules.map(r => r.name).join(', ') || 'defaults'})`);
    const ready = await new Promise(res => {
      let tries = 0;
      const ping = () => chrome.tabs.sendMessage(tab.id, { action: 'PING' }, r => {
        if (!chrome.runtime.lastError && r?.ready) return res(true);
        if (++tries > 20) return res(false);
        setTimeout(ping, 500);
      });
      ping();
    });
    if (!ready && !(await temuEnsureTabReady(tab.id, t => say((rep?.textContent || '') + '\n' + t)))) { say('✗ Temu page se rabta nahi hua — page reload kar ke dobara try karein'); return; }
    const result = await new Promise(res => chrome.tabs.sendMessage(tab.id,
      { action: 'TEMU_FIX_DRAFTS', rules, defaults, autoSubmit: cfg.draft_auto_submit !== false, expectStore: temuActiveStoreName() },
      r => res(chrome.runtime.lastError ? { success: false, report: ['✗ ' + chrome.runtime.lastError.message] } : r)));
    say((result?.report || []).join('\n'));
    toast(result?.success ? (result.stillEmpty ? `${result.stillEmpty} field(s) khali — report dekhein` : `Drafts: ${result.changed ?? 0} fields set, Submit dabaya`) : 'Fix drafts fail — report dekhein', result?.success && !result.stillEmpty ? 'ok' : 'warn');
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
      if (!(await pingOk(t.id)) && !(await temuEnsureTabReady(t.id, add))) { add(`• Tab ${t.id}: page se rabta nahi`); continue; } // v9.14.1 auto reload
      let r = await new Promise(res => chrome.tabs.sendMessage(t.id, { action: 'TEMU_READ_FAILED', uploadId, expectStore }, x => res(chrome.runtime.lastError ? { success: false, report: ['✗ ' + chrome.runtime.lastError.message] } : x)));
      if (r?.wrongStore) { add(`• Tab "${r.mall}" skip (active store: ${expectStore})`); continue; }
      if (uploadId && temuRowMissing(r)) { (r.report || []).forEach(add); const r2 = await temuRetryAfterReload(t.id, { action: 'TEMU_READ_FAILED', uploadId, expectStore }, add); if (r2) r = r2; }
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
      const lineIdx = f.line ? (parseInt(f.line, 10) - 5) : -1;
      const itByLine = (lineIdx >= 0 && lineIdx < items.length) ? items[lineIdx] : null;
      const it = (f.name ? byTitle.get(temuNormTitle(f.name)) : null) || itByLine || (f.name ? items.find(it => temuNormTitle(it.title).startsWith(temuNormTitle(f.name).slice(0, 40))) : null);
      const prodName = (it?.title || f.name || `Line ${f.line || '?'}` || f.goodsId || 'Product');
      let explainTag = '';
      if (f.duplicate) {
        explainTag = `⚠️ DUPLICATE SKU — Store par pehle se mojood hai` + (f.dupGoodsId ? ` (Goods ID: ${f.dupGoodsId})` : '') + `\n  → Is product mein attributes ki koi kami nahi hai. Pehle se listed hone ki wajah se draft bana.`;
        if (it) dupItems.push(it);
      } else if (f.missingAttributes) {
        explainTag = `⚠️ MISSING ATTRIBUTES — ${f.reason || 'Attributes required'}\n  → Temu par "Complete product details" se fill karein ya profile mein attributes likhein.`;
      } else if (f.priceIssue) {
        explainTag = `⚠️ PRICE ISSUE — ${f.reason}\n  → Price Temu limits se bahar hai.`;
      } else {
        explainTag = `⚠️ ${f.status || 'Draft'}: ${f.reason || 'Unknown error'}`;
      }
      add(`• ${prodName.slice(0, 60)}:\n  ${explainTag}`);
    }
    if (dupItems.length) {
      await temuMarkListed(dupItems);
      add(`✓ ${dupItems.length} duplicate product(s) listed-history mein mark ho gaye — agli export mein khud skip honge.`);
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
// ── v9.9.0 Daily dashboard: aaj kitne listed (sab stores), uploads, errors, target progress, 7-din strip ──
// Listed = temuListed entries (key "store|sid", d = ISO date jis din mark hua); uploads/errors = temuUploadHistory (aaj ke 'upload' records).
const temuDayKey = (d) => new Date(d).toISOString().slice(0, 10);
async function temuDashTarget() { return await new Promise(r => chrome.storage.local.get('temuDailyTarget', x => { const v = parseInt(x?.temuDailyTarget, 10); r(v > 0 ? v : 50); })); }
async function temuDashRender(list) {
  const root = $('temuDash'); if (!root) return;
  try {
    if (!list) list = await temuHistGet();
    const target = await temuDashTarget();
    const today = temuDayKey(Date.now());
    const perDay = {}, perStore = {};
    for (const [k, v] of Object.entries(temuListedMap())) {
      const d = v?.d; if (!d) continue;
      perDay[d] = (perDay[d] || 0) + 1;
      if (d === today) { const st = k.split('|')[0] || '—'; perStore[st] = (perStore[st] || 0) + 1; }
    }
    const listed = perDay[today] || 0;
    let uploads = 0, errors = 0;
    for (const hh of list) { if (hh.kind !== 'upload' || temuDayKey(hh.t) !== today) continue; uploads++; errors += +hh.errors || 0; }
    const left = Math.max(0, target - listed);
    const set = (id, v) => { const el = $(id); if (el) el.textContent = String(v); };
    set('temuDashListed', listed); set('temuDashUploads', uploads); set('temuDashErrors', errors); set('temuDashLeft', left);
    try { hdrStoreRender(); } catch (_) {} // v9.10.0
    { const el = $('temuDashDate'); if (el) el.textContent = new Date().toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }); }
    { const ti = $('temuDashTarget'); if (ti && document.activeElement !== ti) ti.value = String(target); }
    { const f = $('temuDashFill'); if (f) { const pct = Math.min(100, Math.round(listed / target * 100)); f.style.width = pct + '%'; f.classList.toggle('done', listed >= target); f.title = `${listed} / ${target} (${pct}%)`; } }
    { const el = $('temuDashStores'); if (el) { const ents = Object.entries(perStore).sort((a, b) => b[1] - a[1]); el.innerHTML = ents.length ? ents.map(([st, n]) => `<span class="temu-dash-store"><b>${n}</b> ${esc(st)}</span>`).join('') : '<span class="temu-dash-none">Aaj abhi kuch listed nahi</span>'; } }
    { const el = $('temuDashWeek'); if (el) {
        const days = []; for (let i = 6; i >= 0; i--) { const d = new Date(Date.now() - i * 864e5); days.push({ k: temuDayKey(d), lbl: d.toLocaleDateString(undefined, { weekday: 'narrow' }), n: perDay[temuDayKey(d)] || 0 }); }
        const mx = Math.max(target, ...days.map(x => x.n), 1);
        el.innerHTML = days.map(x => `<div class="temu-dash-day${x.k === today ? ' today' : ''}${x.n >= target ? ' hit' : ''}" title="${x.k}: ${x.n} listed"><div class="temu-dash-col"><div class="temu-dash-colfill" style="height:${Math.max(x.n ? 6 : 0, Math.round(x.n / mx * 100))}%"></div></div><span class="temu-dash-n">${x.n || ''}</span><span class="temu-dash-d">${x.lbl}</span></div>`).join('');
    } }
  } catch (e) { try { console.warn('temuDashRender', e); } catch (_) {} }
}
let TemuHistStoreFilter = 'all';
let TemuHistStatusFilter = 'all';
let TemuHistSearchQuery = '';

async function temuRenderHistory() {
  const box = $('temuHistList'); if (!box) return;
  const list = await temuHistGet();
  temuDashRender(list); // v9.9.0
  { const c = $('temuHistCount'); if (c) c.textContent = list.length ? String(list.length) : ''; }

  // Bind live search input once
  const hSearchInp = $('temuHistSearch');
  if (hSearchInp && !hSearchInp.dataset.bound) {
    hSearchInp.dataset.bound = '1';
    hSearchInp.addEventListener('input', () => {
      TemuHistSearchQuery = hSearchInp.value.trim();
      const clr = $('temuHistSearchClear');
      if (clr) clr.hidden = !TemuHistSearchQuery;
      temuRenderHistory();
    });
  }

  // Populate dynamic store filter pills
  const storePillsWrap = $('temuHistStoreFilters');
  if (storePillsWrap) {
    const uniqueStores = [...new Set(list.map(x => x.store).filter(Boolean))];
    let storeBtns = `<button type="button" class="thist-store-pill${TemuHistStoreFilter === 'all' ? ' active' : ''}" data-sfilter="all">All Stores</button>`;
    uniqueStores.forEach(s => {
      storeBtns += `<button type="button" class="thist-store-pill${TemuHistStoreFilter === s ? ' active' : ''}" data-sfilter="${esc(s)}">${esc(s)}</button>`;
    });
    storePillsWrap.innerHTML = storeBtns;
  }

  // Filter list
  const filtered = list.filter(h => {
    if (TemuHistStoreFilter !== 'all' && (h.store || '') !== TemuHistStoreFilter) return false;
    if (TemuHistStatusFilter === 'ok') {
      if (h.kind !== 'upload' || !h.confirmed || (h.errors && h.errors > 0)) return false;
    } else if (TemuHistStatusFilter === 'err') {
      const isErr = (h.kind === 'upload' && !h.confirmed) || (h.errors && h.errors > 0);
      if (!isErr) return false;
    } else if (TemuHistStatusFilter === 'export') {
      if (h.kind !== 'export' && h.kind !== 'manual') return false;
    }
    if (TemuHistSearchQuery) {
      const q = TemuHistSearchQuery.toLowerCase();
      const inStore = String(h.store || '').toLowerCase().includes(q);
      const inUploadId = String(h.uploadId || '').toLowerCase().includes(q);
      const inSource = String(h.source || '').toLowerCase().includes(q);
      const inItems = (h.items || []).some(it => 
        String(it.sku || '').toLowerCase().includes(q) ||
        String(it.title || '').toLowerCase().includes(q) ||
        String(it.url || '').toLowerCase().includes(q)
      );
      if (!inStore && !inUploadId && !inSource && !inItems) return false;
    }
    return true;
  });

  box.innerHTML = '';
  for (const h of filtered) {
    const d = new Date(h.t);
    const when = d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    let typeClass = 'thist-type-ok';
    if (h.kind === 'export' || h.kind === 'manual') {
      typeClass = 'thist-type-export';
    } else if (!h.confirmed || (h.errors && h.errors > 0)) {
      typeClass = 'thist-type-bad';
    }

    const el = document.createElement('div');
    el.className = `temu-hist ${typeClass}`;
    el.innerHTML = `
      <div class="temu-hist-top">
        <div class="thist-meta-left">
          <span class="thist-store-badge"><span class="thist-sdot"></span>${esc(h.store || 'Store')}</span>
          <span class="thist-time">${esc(when)}</span>
          <span class="thist-count-badge">${h.n || (h.items || []).length} items</span>
        </div>
        <div class="temu-hist-acts">
          <button class="btn btn-ghost btn-xs" type="button" data-act="list">List</button>
          <button class="btn btn-ghost btn-xs" type="button" data-act="csv">CSV</button>
        </div>
      </div>
      <div class="thist-badges-row">
        ${h.added != null ? `<span class="thist-badge ok">✓ ${h.added} added</span>` : ''}
        ${h.errors ? `<span class="thist-badge bad">⚠ ${h.errors} errors</span>` : ''}
        ${h.skipped ? `<span class="thist-badge warn">${h.skipped} skipped</span>` : ''}
        ${h.uploadId ? `<button type="button" class="thist-badge id thist-copy-id" data-copy="${esc(h.uploadId)}" title="Click to copy Upload ID">ID: ${esc(h.uploadId)} <svg class="i i-xs" viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>` : ''}
        ${h.kind === 'export' ? `<span class="thist-badge file">📁 Export File Only</span>` : ''}
        ${h.kind === 'manual' ? `<span class="thist-badge file">Marked as listed</span>` : ''}
        ${h.source ? `<span class="thist-meta-src">via ${esc(h.source)}</span>` : ''}
      </div>
      <div class="temu-hist-list">
        <div class="thist-prod-rows">
          ${(h.items || []).map((it, i) => `
            <div class="thist-prod-row">
              <span class="thist-pnum">#${i + 1}</span>
              <span class="thist-psku">${esc(it.sku || '—')}</span>
              <span class="thist-ptitle" title="${esc(it.title || '')}">${esc(it.title || 'Untitled')}</span>
              ${it.base ? `<span class="thist-pprice">$${esc(it.base)}</span>` : ''}
            </div>
          `).join('')}
          ${(h.skippedList || []).length ? `
            <div class="thist-skipped-box">
              <b>Skipped (${h.skippedList.length}):</b>
              ${h.skippedList.map(x => `<div>• ${esc(x)}</div>`).join('')}
            </div>
          ` : ''}
        </div>
      </div>
    `;

    const copyBtn = el.querySelector('.thist-copy-id');
    if (copyBtn) {
      copyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idVal = copyBtn.dataset.copy;
        if (idVal) {
          navigator.clipboard.writeText(idVal).then(() => {
            toast(`Upload ID copied: ${idVal}`, 'ok');
          }).catch(() => {
            toast('Failed to copy ID', 'warn');
          });
        }
      });
    }

    el.querySelector('[data-act="list"]').addEventListener('click', () => el.classList.toggle('open'));
    el.querySelector('[data-act="csv"]').addEventListener('click', () => {
      const lines = [['SKU', 'Title', 'URL', 'Base Price', 'Variation'].join(',')].concat((h.items || []).map(it => [it.sku, it.title, it.url, it.base, it.variation].map(v => '"' + String(v ?? '').replace(/"/g, '""') + '"').join(',')));
      zhSaveBlob(new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv' }), `temu_upload_${h.store || 'store'}_${d.toISOString().slice(0, 16).replace(/[:T]/g, '-')}.csv`);
    });
    box.appendChild(el);
  }
}
const temuHistItems = items => (items || []).map(it => ({ sku: it.sku, title: (it.title || '').slice(0, 120), url: it.url, base: it.base, variation: `${it.vtype || 'Color'}: ${it.color}` }));

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
// v9.7.6: as-is Temu file mein bhi reference_link column khali karo (purani exports mein sourcing link tha)
function temuStripRefLinks(buf) {
  try {
    const wb = XLSX.read(buf, { type: 'array', cellStyles: true });
    const ws = wb.Sheets['Template'] || wb.Sheets[wb.SheetNames[0]]; if (!ws || !ws['!ref']) return { buf, n: 0 };
    const range = XLSX.utils.decode_range(ws['!ref']);
    const cols = [];
    for (let c = range.s.c; c <= range.e.c; c++) { const cell = ws[XLSX.utils.encode_cell({ r: 2, c })]; if (cell && String(cell.v).trim() === 'reference_link') cols.push(c); }
    if (!cols.length) return { buf, n: 0 };
    let n = 0;
    for (let r = 4; r <= range.e.r; r++) cols.forEach(c => { const a = XLSX.utils.encode_cell({ r, c }); if (ws[a] && ws[a].v !== '' && ws[a].v !== null && ws[a].v !== undefined) { delete ws[a]; n++; } });
    if (!n) return { buf, n: 0 };
    return { buf: XLSX.write(wb, { type: 'array', bookType: 'xlsx', cellStyles: true }), n };
  } catch (e) { console.warn('temuStripRefLinks', e); return { buf, n: 0 }; }
}
async function temuImportSheet(file) {
  const rep = $('temuReport');
  const name = (file.name || '').toLowerCase();
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    let buf = await file.arrayBuffer();
    const items = temuParseTemuFile(buf);
    if (items) {
      // Temu file as-is: koi conversion nahi, wahi file upload hogi (sirf reference_link khali — v9.7.6)
      const strip = temuStripRefLinks(buf); buf = strip.buf;
      TemuSheetRows = null;
      TemuLast = { bytes: buf, items, skipped: [], n: items.length, marked: false, asIs: true, name: file.name };
      const sel = $('temuSource');
      if (sel) { const o = sel.querySelector('option[value="sheet"]'); if (o) { o.hidden = false; o.textContent = `Temu file — ${file.name} (${items.length}) · as-is`; } sel.value = 'sheet'; }
      { const mb = $('temuMarkListedBtn'); if (mb) { mb.hidden = false; mb.textContent = `Listed mark karo (${items.length})`; } }
      temuUpdateSrcInfo();
      if (rep) rep.textContent = `✓ Temu file: ${file.name} — ${items.length} products (as-is, koi conversion nahi; already-listed skip bhi nahi).${strip.n ? `\n${strip.n} reference_link (sourcing link) khali kar diye.` : ''}
Store check karein, phir "Export + Upload to Temu".
` + items.slice(0, 60).map(it => `${it.sku}  ${it.vtype}: ${it.color}  $${it.base}`).join('\n');
      toast(`Temu file ready — ${items.length} products, as-is upload`, 'ok');
      return;
    }
  }
  if (name.endsWith('.xlsx') || name.endsWith('.xls') || name.endsWith('.csv')) { // v10.2.0 Store Copy (Temu Manage products → Download)
    try {
      const buf2 = await file.arrayBuffer(); const wb2 = XLSX.read(buf2, { type: 'array' }); const ws2 = wb2.Sheets[wb2.SheetNames[0]];
      const rows2 = XLSX.utils.sheet_to_json(ws2, { header: 1, defval: '' }).map(r => (r || []).map(c => String(c ?? '').trim()));
      const sc = (typeof parseTemuStoreExport === 'function') ? parseTemuStoreExport(rows2) : null;
      if (sc) { if (!sc.length) { if (rep) rep.textContent = '✗ Temu export mein koi product nahi'; return; }
        await importStoreCopy(sc, file.name, (t) => { if (rep) rep.textContent = t + '\n\nAgla qadam: Bulk tab → tabs kholo / hunt karo → wapas Temu Export → "Export + Upload to Temu".'; });
        return; }
    } catch (_) {}
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
  try { temuSetupRender(); hdrStoreRender(); } catch (_) {} // v9.10.0
  const el = $('temuTplStatus'); if (!el) return;
  const store = temuActiveStore(); const n = temuActiveStoreName();
  const name = store?.templateName;
  el.textContent = n
    ? (name ? `✓ ${n}: ${name}` : `${n}: template select karein (aik dafa)`)
    : 'Pehle store add karein';
  el.style.color = name ? '#3ddc84' : '#e8a33d';
}

async function temuSaveCfg(cfg) {
  const stores = temuStores(); const n = temuActiveStoreName();
  if (!n) { toast('Pehle store add karein', 'warn'); return 'no active store'; }
  stores[n] = { ...(stores[n] || {}), config: cfg };
  return temuSaveStores(stores);
}

// ── Temu Official Category Catalog & Smart Auto-Fill ────────
const TEMU_OFFICIAL_CATALOG = [
  // Home & Kitchen
  { name: 'Bath Towels', cat: 'Bath Towels', match: ['bath towel', 'hand towel', 'washcloth', 'towel set', 'shower towel'], wt: 2, l: 12, w: 10, h: 4 },
  { name: 'Bed Sheets', cat: 'Bed Sheets', match: ['bed sheet', 'fitted sheet', 'flat sheet', 'sheet set', 'bedsheet'], wt: 3, l: 14, w: 11, h: 3 },
  { name: 'Pillows', cat: 'Pillows', match: ['pillow', 'pillowcase', 'memory foam pillow', 'bed pillow', 'cushion'], wt: 2.5, l: 16, w: 12, h: 5 },
  { name: 'Blankets', cat: 'Blankets', match: ['blanket', 'throw blanket', 'fleece blanket', 'plush blanket', 'quilt'], wt: 3.5, l: 15, w: 12, h: 4 },
  { name: 'Kitchen Utensils', cat: 'Kitchen Utensils', match: ['spatula', 'tongs', 'whisk', 'ladle', 'utensil set', 'cooking spoons'], wt: 1.5, l: 12, w: 5, h: 3 },
  { name: 'Coffee Mugs', cat: 'Coffee Mugs', match: ['coffee mug', 'ceramic mug', 'tea cup', 'tumbler', 'insulated mug'], wt: 1.2, l: 6, w: 5, h: 5 },
  { name: 'Water Bottles', cat: 'Water Bottles', match: ['water bottle', 'stainless steel bottle', 'sports bottle', 'flask', 'hydration'], wt: 1.1, l: 10, w: 4, h: 4 },
  { name: 'Storage Bins', cat: 'Storage Bins', match: ['storage bin', 'organizer box', 'storage basket', 'closet organizer', 'storage container'], wt: 2, l: 14, w: 10, h: 8 },
  { name: 'Cookware', cat: 'Cookware', match: ['frying pan', 'skillet', 'saucepan', 'pot', 'nonstick pan'], wt: 4, l: 14, w: 11, h: 4 },
  { name: 'Curtains', cat: 'Curtains', match: ['curtains', 'drapes', 'window panel', 'blackout curtain', 'sheer curtains'], wt: 2.5, l: 12, w: 9, h: 3 },
  { name: 'Candles', cat: 'Candles', match: ['scented candle', 'soy candle', 'aromatherapy candle', 'wax candle', 'jar candle'], wt: 1.2, l: 5, w: 5, h: 5 },

  // Pets
  { name: 'Dog Food', cat: 'Dog Food', match: ['dog food', 'puppy food', 'dry dog food', 'kibble', 'wet dog food'], wt: 5, l: 14, w: 10, h: 5 },
  { name: 'Cat Food', cat: 'Cat Food', match: ['cat food', 'kitten food', 'dry cat food', 'wet cat food', 'cat pouches'], wt: 4, l: 12, w: 9, h: 4 },
  { name: 'Dog Toys', cat: 'Dog Toys', match: ['dog toy', 'chew toy', 'puppy toy', 'squeaky toy', 'rope toy', 'dog ball'], wt: 0.8, l: 7, w: 4, h: 3 },
  { name: 'Cat Toys', cat: 'Cat Toys', match: ['cat toy', 'catnip', 'feather wand', 'cat scratcher', 'laser toy'], wt: 0.6, l: 8, w: 4, h: 3 },
  { name: 'Pet Beds', cat: 'Pet Beds', match: ['dog bed', 'cat bed', 'pet mat', 'calming bed', 'orthopedic dog bed'], wt: 3.5, l: 18, w: 14, h: 6 },
  { name: 'Dog Collars & Leashes', cat: 'Collars & Leashes', match: ['dog collar', 'dog leash', 'dog harness', 'puppy collar', 'pet leash'], wt: 0.7, l: 8, w: 5, h: 2 },
  { name: 'Pet Grooming', cat: 'Pet Grooming', match: ['dog shampoo', 'pet brush', 'nail clippers', 'grooming comb', 'deshedding tool'], wt: 1.2, l: 9, w: 4, h: 3 },

  // Sports & Outdoors
  { name: 'Golf Balls', cat: 'Standard Balls', match: ['golf ball', 'golf balls', 'dozen balls', 'chrome tour', 'tp5', 'pro v1'], wt: 1.4, l: 7.5, w: 5.2, h: 1.5, attrs: 'Rubber, 14 Years+' },
  { name: 'Yoga Mats', cat: 'Yoga Mats', match: ['yoga mat', 'exercise mat', 'fitness mat', 'pilates mat', 'workout mat'], wt: 2.8, l: 24, w: 6, h: 6 },
  { name: 'Resistance Bands', cat: 'Resistance Bands', match: ['resistance bands', 'exercise bands', 'workout bands', 'loop bands', 'pull up bands'], wt: 1, l: 8, w: 6, h: 2 },
  { name: 'Fishing Lures', cat: 'Fishing Lures', match: ['fishing lure', 'crankbait', 'soft plastic bait', 'spinnerbait', 'tackle kit'], wt: 0.8, l: 7, w: 4, h: 2 },
  { name: 'Camping Gear', cat: 'Camping', match: ['sleeping bag', 'camping tent', 'camp chair', 'headlamp', 'camping lantern'], wt: 4, l: 16, w: 8, h: 8 },

  // Electronics & Accessories
  { name: 'Phone Cases', cat: 'Phone Cases', match: ['phone case', 'iphone case', 'clear case', 'protective cover', 'silicone case'], wt: 0.3, l: 6.5, w: 3.5, h: 0.8 },
  { name: 'Screen Protectors', cat: 'Screen Protectors', match: ['screen protector', 'tempered glass', 'privacy screen', 'camera lens protector'], wt: 0.2, l: 7, w: 4, h: 0.5 },
  { name: 'Charging Cables', cat: 'Charging Cables', match: ['charging cable', 'usb-c cable', 'lightning cable', 'fast charger cord', 'type c cable'], wt: 0.3, l: 5, w: 4, h: 1 },
  { name: 'Earbuds & Headphones', cat: 'Earbuds', match: ['wireless earbuds', 'bluetooth earbuds', 'headphones', 'earphones', 'airbuds'], wt: 0.5, l: 5, w: 4, h: 2 },
  { name: 'Smartwatch Bands', cat: 'Watch Bands', match: ['watch band', 'smartwatch strap', 'apple watch band', 'silicone band'], wt: 0.2, l: 6, w: 2, h: 1 },

  // Apparel & Footwear
  { name: 'T-Shirts', cat: 'T-Shirts', match: ['t-shirt', 'tee shirt', 'graphic tee', 'crewneck tee', 'cotton shirt'], wt: 0.6, l: 11, w: 8, h: 1 },
  { name: 'Hoodies & Sweatshirts', cat: 'Hoodies', match: ['hoodie', 'sweatshirt', 'pullover', 'fleece hoodie'], wt: 1.5, l: 13, w: 10, h: 3 },
  { name: 'Socks', cat: 'Socks', match: ['socks', 'ankle socks', 'crew socks', 'athletic socks', 'compression socks'], wt: 0.5, l: 9, w: 4, h: 2 },
  { name: 'Underwear', cat: 'Underwear', match: ['boxer briefs', 'boxers', 'panties', 'briefs', 'cotton underwear'], wt: 0.6, l: 8, w: 6, h: 2 },
  { name: 'Baseball Caps', cat: 'Hats & Caps', match: ['baseball cap', 'snapback', 'trucker hat', 'sun hat', 'beanie'], wt: 0.4, l: 8, w: 7, h: 4 },
  { name: 'Sunglasses', cat: 'Sunglasses', match: ['sunglasses', 'polarized sunglasses', 'shades', 'uv protection glasses'], wt: 0.3, l: 7, w: 3, h: 2 },
  { name: 'Sneakers', cat: 'Sneakers', match: ['sneakers', 'running shoes', 'athletic shoes', 'walking shoes', 'tennis shoes'], wt: 2.2, l: 13, w: 8, h: 5 },
  { name: 'Backpacks', cat: 'Backpacks', match: ['backpack', 'school bag', 'travel backpack', 'laptop bag', 'daypack'], wt: 1.8, l: 16, w: 12, h: 5 },

  // Baby & Toys
  { name: 'Baby Diapers', cat: 'Diapers', match: ['baby diapers', 'diaper pants', 'swaddlers', 'pull-ups', 'training pants'], wt: 4.5, l: 14, w: 10, h: 8 },
  { name: 'Baby Wipes', cat: 'Baby Wipes', match: ['baby wipes', 'wet wipes', 'water wipes', 'sensitive wipes'], wt: 3, l: 9, w: 6, h: 5 },
  { name: 'Action Figures', cat: 'Action Figures', match: ['action figure', 'collectible figure', 'toy model', 'superhero figure'], wt: 0.8, l: 9, w: 6, h: 3 },
  { name: 'Stuffed Animals', cat: 'Plush Toys', match: ['stuffed animal', 'plush toy', 'teddy bear', 'plushie', 'squishy plush'], wt: 1, l: 10, w: 8, h: 6 },
  { name: 'Puzzles & Games', cat: 'Puzzles', match: ['jigsaw puzzle', 'board game', 'puzzle 1000 pieces', 'card game'], wt: 1.6, l: 11, w: 9, h: 2 },

  // Beauty & Personal Care
  { name: 'Makeup Brushes', cat: 'Makeup Brushes', match: ['makeup brushes', 'brush set', 'cosmetic brush', 'foundation brush', 'blending brush'], wt: 0.5, l: 8, w: 4, h: 2 },
  { name: 'Skin Care', cat: 'Skin Care', match: ['face cream', 'moisturizer', 'facial cleanser', 'serum', 'face lotion'], wt: 0.8, l: 6, w: 3, h: 3 },
  { name: 'Hair Accessories', cat: 'Hair Accessories', match: ['hair clips', 'hair ties', 'scrunchies', 'headband', 'claw clips'], wt: 0.3, l: 6, w: 4, h: 2 },

  // Automotive & Tools
  { name: 'Car Seat Covers', cat: 'Seat Covers', match: ['car seat cover', 'seat protector', 'leather seat cover', 'front seat cover'], wt: 3.5, l: 14, w: 11, h: 5 },
  { name: 'Car Phone Mount', cat: 'Car Mounts', match: ['car phone mount', 'dashboard mount', 'air vent holder', 'magnetic car mount'], wt: 0.4, l: 5, w: 4, h: 3 },
  { name: 'Hand Tools', cat: 'Hand Tools', match: ['screwdriver set', 'pliers', 'wrench set', 'hammer', 'tape measure'], wt: 3, l: 12, w: 8, h: 3 },
  { name: 'Cleaning Cloths', cat: 'Cleaning Cloths', match: ['microfiber cloth', 'cleaning towels', 'car drying towel', 'dusting cloth'], wt: 1, l: 10, w: 7, h: 3 }
];

function temuPopulateCatalogDropdown() {
  const sel = $('tcCatalogSel');
  if (!sel || sel.dataset.populated) return;
  sel.dataset.populated = '1';
  TEMU_OFFICIAL_CATALOG.forEach((c, idx) => {
    const opt = document.createElement('option');
    opt.value = idx;
    opt.textContent = `🏷️ ${c.name} (${c.cat})`;
    sel.appendChild(opt);
  });
  sel.addEventListener('change', () => {
    const val = sel.value;
    if (val === '') return;
    const item = TEMU_OFFICIAL_CATALOG[+val];
    if (item) temuLoadFromCatalogItem(item);
    sel.value = '';
  });
}

function temuLoadFromCatalogItem(item) {
  const keyName = item.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if ($('tcName')) $('tcName').value = keyName;
  if ($('tcCat')) $('tcCat').value = item.cat || item.name;
  if ($('tcMatch')) $('tcMatch').value = (item.match || []).join(', ');
  if ($('tcAttrs')) $('tcAttrs').value = item.attrs || '';
  if ($('tcW')) $('tcW').value = item.wt || '';
  if ($('tcL')) $('tcL').value = item.l || '';
  if ($('tcWd')) $('tcWd').value = item.w || '';
  if ($('tcH')) $('tcH').value = item.h || '';
  const ft = $('tcFormTitle'); if (ft) ft.textContent = `Add category: ${item.name}`;
  temuCatMsg(`✓ "${item.name}" catalog se load ho gaya! Ab "Save category" dabayein.`, 'ok');
  toast(`✓ Temu category "${item.name}" loaded!`, 'ok');
  try { $('temuCatForm').scrollIntoView({ block: 'start', behavior: 'smooth' }); } catch (_) {}
}

function temuAutoFillCategory(rawName) {
  rawName = String(rawName || '').trim();
  if (!rawName) rawName = $('tcName')?.value?.trim();
  if (!rawName) {
    temuCatMsg('Pehle category ka aam naam likhein (e.g. Dog Food ya Bedsheets)', 'bad');
    $('tcName')?.focus();
    return;
  }
  const q = rawName.toLowerCase();
  const hit = TEMU_OFFICIAL_CATALOG.find(c => c.name.toLowerCase() === q || c.cat.toLowerCase() === q || c.name.toLowerCase().includes(q) || q.includes(c.name.toLowerCase()));
  if (hit) {
    temuLoadFromCatalogItem(hit);
    return;
  }

  const cleanKey = rawName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const titleCase = rawName.split(/[\s_]+/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
  const words = rawName.toLowerCase().split(/[\s_]+/).filter(w => w.length > 2);
  const matchArr = [rawName.toLowerCase()];
  if (words.length > 1) {
    matchArr.push(words.join(' '));
    words.forEach(w => { if (!matchArr.includes(w)) matchArr.push(w); });
  }
  if (rawName.toLowerCase().endsWith('s')) matchArr.push(rawName.toLowerCase().slice(0, -1));
  else matchArr.push(rawName.toLowerCase() + 's');

  if ($('tcName')) $('tcName').value = cleanKey;
  if ($('tcCat')) $('tcCat').value = titleCase;
  if ($('tcMatch')) $('tcMatch').value = [...new Set(matchArr)].slice(0, 6).join(', ');
  if ($('tcW')) $('tcW').value = '1.4';
  if ($('tcL')) $('tcL').value = '8';
  if ($('tcWd')) $('tcWd').value = '6';
  if ($('tcH')) $('tcH').value = '3';

  temuCatMsg(`✨ Smart Auto-Fill complete for "${titleCase}"! Ab "Save category" dabayein.`, 'ok');
  toast(`✨ Category "${titleCase}" auto-filled!`, 'ok');
}

async function temuFetchCategoryFromTab() {
  const tabs = await chrome.tabs.query({ url: ['https://seller.temu.com/*'] });
  if (!tabs.length) {
    toast('Koi Temu Seller Central tab khula nahi hai', 'warn');
    return;
  }
  const tab = tabs.find(t => t.active) || tabs[0];
  toast('Temu tab se category read ho rahi hai…', 'ok');
  
  chrome.tabs.sendMessage(tab.id, { action: 'TEMU_GET_ACTIVE_CATEGORY' }, res => {
    let catFound = res?.category || '';
    if (!catFound) {
      const title = tab.title || '';
      const m = title.match(/([A-Za-z\s&]+)\s*-\s*Temu/i) || title.match(/Upload\s+([A-Za-z\s&]+)/i);
      if (m && m[1]) catFound = m[1].trim();
    }
    if (catFound) {
      const lastSeg = catFound.split(/[\/>-]/).pop().trim();
      temuAutoFillCategory(lastSeg);
      toast(`📥 Temu se category mil gayi: "${lastSeg}"!`, 'ok');
    } else {
      toast('Temu page par koi category select nahi mili — catalog se pick karein', 'info');
    }
  });
}

async function temuImportCategoryFromTemplate(file) {
  if (!file) return;
  const name = file.name.replace(/\.[^/.]+$/, '');
  try {
    const buf = await file.arrayBuffer();
    let catName = '';
    if (typeof XLSX !== 'undefined') {
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets['Template'] || wb.Sheets[wb.SheetNames[0]];
      if (ws) {
        const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
        const text = JSON.stringify(aoa.slice(0, 5));
        const m = text.match(/Category[:\s"]+([A-Za-z\s&]{3,40})/i);
        if (m) catName = m[1].trim();
      }
    }
    if (!catName) {
      catName = name.replace(/_template|template|temu/gi, '').replace(/[_-]+/g, ' ').trim();
    }
    temuAutoFillCategory(catName || name);
    toast(`📄 Template se category auto-fill: "${catName || name}"!`, 'ok');
  } catch (err) {
    toast('Template read error: ' + err.message, 'warn');
  }
}

let TemuCatSearchQuery = '';

function temuRenderProfiles() {
  const box = $('temuProfileList'); if (!box) return;
  temuPopulateCatalogDropdown();
  const cfg = temuGetCfg();
  
  // Bind category search once
  const cSearchInp = $('temuCatSearch');
  if (cSearchInp && !cSearchInp.dataset.bound) {
    cSearchInp.dataset.bound = '1';
    cSearchInp.addEventListener('input', () => {
      TemuCatSearchQuery = cSearchInp.value.trim();
      const clr = $('temuCatSearchClear');
      if (clr) clr.hidden = !TemuCatSearchQuery;
      temuRenderProfiles();
    });
  }

  box.innerHTML = '';
  const entries = Object.entries(cfg.category_profiles || {});
  const cnt = $('temuCatCount'); if (cnt) cnt.textContent = entries.length ? String(entries.length) : '';
  
  const filtered = entries.filter(([name, p]) => {
    if (!TemuCatSearchQuery) return true;
    const q = TemuCatSearchQuery.toLowerCase();
    if (name.toLowerCase().includes(q)) return true;
    if ((p.category_keyword || '').toLowerCase().includes(q)) return true;
    if ((p.match || []).some(m => String(m).toLowerCase().includes(q))) return true;
    if ((p.keyword_attributes || '').toLowerCase().includes(q)) return true;
    return false;
  });

  if (!filtered.length) {
    box.innerHTML = '<div style="padding:16px;text-align:center;font-size:11.5px;color:var(--ink-4);">Koi matching category profile nahi mila.</div>';
    return;
  }

  filtered.forEach(([name, p]) => {
    const row = document.createElement('div');
    row.className = 'temu-prof';
    const dims = [p.length_in, p.width_in, p.height_in].every(v => v != null) ? `${p.length_in}×${p.width_in}×${p.height_in} in` : 'default size';
    const wt = p.weight_lb != null ? `${p.weight_lb} lb` : 'title/default';
    const displayName = String(name || '').replace(/_/g, ' ').replace(/\b[a-z]/g, c => c.toUpperCase());
    
    row.innerHTML = `
      <div class="temu-prof-head" data-collapse-toggle>
        <div class="temu-prof-name">
          <span class="temu-prof-collapse-icon">▶</span>
          <span>${esc(displayName)}</span>
          ${p.category_keyword ? `<span class="tcat-keyword-badge">🏷️ ${esc(p.category_keyword)}</span>` : ''}
        </div>
        <div class="temu-prof-actions">
          <button class="btn btn-ghost btn-xs" data-edit="${esc(name)}" type="button">Edit</button>
          <button class="btn btn-ghost btn-xs btn-danger" data-del="${esc(name)}" type="button">Delete</button>
        </div>
      </div>
      <div class="tcat-pills-row tcat-collapsed">
        ${(p.match || []).map(m => `<span class="tcat-pill">🔑 ${esc(m)}</span>`).join('')}
        ${(p.exclude || []).length ? `<span class="tcat-pill" style="color:#FF2E54;border-color:rgba(255,46,84,0.25);">✕ ${esc(p.exclude.join(', '))}</span>` : ''}
        ${p.keyword_attributes ? `<span class="tcat-pill" style="color:#A78BFA;border-color:rgba(167,139,250,0.25);">⚙️ ${esc(p.keyword_attributes)}</span>` : ''}
        <span class="tcat-spec-pill">⚖️ ${esc(wt)}</span>
        <span class="tcat-spec-pill">📐 ${esc(dims)}</span>
      </div>
    `;

    row.querySelector('[data-collapse-toggle]').addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      const pills = row.querySelector('.tcat-pills-row');
      const icon = row.querySelector('.temu-prof-collapse-icon');
      const isCollapsed = pills.classList.toggle('tcat-collapsed');
      icon.textContent = isCollapsed ? '▶' : '▼';
    });

    row.querySelector('[data-edit]').addEventListener('click', () => {
      $('tcName').value = displayName; $('tcCat').value = p.category_keyword || '';
      $('tcMatch').value = (p.match||[]).join(', '); $('tcExclude').value = (p.exclude||[]).join(', ');
      $('tcAttrs').value = p.keyword_attributes || '';
      $('tcW').value = p.weight_lb ?? ''; $('tcL').value = p.length_in ?? '';
      $('tcWd').value = p.width_in ?? ''; $('tcH').value = p.height_in ?? '';
      const ft = $('tcFormTitle'); if (ft) ft.textContent = `Edit category: ${displayName}`;
      $('temuCatForm')?.classList.add('editing');
      temuCatMsg('');
      try { $('temuCatForm').scrollIntoView({ block: 'start', behavior: 'smooth' }); $('tcName')?.focus(); } catch (_) {}
    });

    row.querySelector('[data-del]').addEventListener('click', async () => {
      if (!confirm(`Category "${name}" delete karein?`)) return;
      const cfg2 = temuGetCfg(); delete cfg2.category_profiles[name];
      const r = await temuSaveCfg(cfg2);
      if (r === true) { temuRenderProfiles(); temuCatMsg(`Category "${name}" removed`, 'ok'); }
      else temuCatMsg('Delete fail: ' + (r || 'save error'), 'bad');
    });
    box.appendChild(row);
  });
}

function temuCatMsg(text, kind) {
  const el = $('tcMsg'); if (!el) return;
  el.textContent = text || ''; el.className = 'temu-inline-msg' + (kind ? ' ' + kind : '');
  if (text && kind === 'ok') setTimeout(() => { if (el.textContent === text) { el.textContent = ''; el.className = 'temu-inline-msg'; } }, 4000);
}
function temuCatFormReset() {
  ['tcName','tcCat','tcMatch','tcExclude','tcAttrs','tcW','tcL','tcWd','tcH'].forEach(id => { const el = $(id); if (el) el.value = ''; });
  const ft = $('tcFormTitle'); if (ft) ft.textContent = 'Add category';
  $('temuCatForm')?.classList.remove('editing');
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
    width_in: num($('tcWd')?.value), height_in: num($('tcH')?.value)
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
  set('tgListPx', cfg.list_price_multiplier ?? 1.25); set('tgMinPx', cfg.price_min ?? 69.99); set('tgMaxPx', cfg.price_max ?? 999);
  set('tgMinProfit', cfg.min_profit_dollar ?? 50); set('tgMinProfit2', cfg.min_profit_dollar ?? 50);
  set('tgHeavyBuffer', cfg.heavy_shipping_buffer ?? 2); set('tgHeavyBuffer2', cfg.heavy_shipping_buffer ?? 2);
  chk('tgRound99', cfg.price_round_to_99 !== false); chk('tgRound992', cfg.price_round_to_99 !== false);
  set('tgQtyMin', cfg.quantity_min ?? 250); set('tgQtyMax', cfg.quantity_max ?? 500);
  set('tgMaxW', cfg.max_weight_lb ?? 8);
  set('tgWords', (cfg.title_remove_words || []).join(', '));
  set('tgVarValues', (cfg.simple_variation_values || []).join(', '));
  temuInitWordRemoverEvents();
  temuRenderWordChips();
  chk('tgSkipListed', cfg.skip_listed !== false);
  chk('tgSkipListedExport', cfg.skip_listed !== false);
  chk('tgSmartVar', cfg.smart_variations !== false);
  chk('tgBgUpload', cfg.upload_in_background !== false);
  chk('tgSmartWeight', cfg.smart_weight !== false);
  { const pk = cfg.packaging || {}; set('tgSkuType', pk.sku_type); set('tgIndPacked', pk.individually_packed); set('tgPackQty', pk.total_packaging_quantity); set('tgPackUnit', pk.packaging_unit); }
  chk('tgAutoFix', cfg.auto_fix_after_upload !== false);
  set('tgBrandRules', temuBrandRulesToText(cfg.brand_rules)); // v9.11.0
  const activeKeysStr = cfg.gemini_api_key || DEFAULT_GROQ_KEYS.join('\n');
  set('tgGeminiKey', activeKeysStr);
  const aiSt = $('tgGeminiStatus');
  const aiKeys = temuGetAiKeys(activeKeysStr);
  if (aiSt && aiKeys.length) {
    aiSt.textContent = `🟢 ${aiKeys.length} Groq Keys Active (Auto-Failover ON)`;
    aiSt.className = 'temu-inline-msg ok';
  }
  chk('tgKeepApprovedBrands', cfg.ai_keep_approved_brands !== false);
  chk('tgStripClaims', cfg.ai_strip_claims !== false);
  set('tgBannedWords', cfg.ai_banned_words ?? 'cure, treat, healing, disease, remedy, therapeutic, detox, relief, pain relief, immunity, clinical, medicine, sterile, eco-friendly, biodegradable, sustainable, zero waste, 100% organic, non-toxic, chemical-free, baby, infant, newborn, toddler, crib, nursery, pediatric, lifetime warranty, guaranteed, prime');
  set('tgAiInstructions', cfg.ai_custom_instructions || '');
  temuUpdateSrcInfo();
  temuUpdatePricePreview();
}

function temuUpdatePricePreview() {
  const resEl = $('tppResult'), profEl = $('tppProfit');
  if (!resEl || !profEl) return;
  const px = parseFloat($('tgPx')?.value) || 5.0;
  const minProfit = parseFloat($('tgMinProfit')?.value) || 0;
  const round99 = $('tgRound99') ? !!$('tgRound99').checked : true;
  const sampleCost = 10.0;
  let base = sampleCost * px;
  if (minProfit > 0 && (base - sampleCost) < minProfit) {
    base = sampleCost + minProfit;
  }
  if (round99) {
    base = Math.floor(base) + 0.99;
  }
  base = Math.round(base * 100) / 100;
  const estProfit = Math.round((base - sampleCost) * 100) / 100;
  resEl.textContent = `$${base.toFixed(2)}`;
  profEl.textContent = `+$${estProfit.toFixed(2)}`;
}

// "N products ready" line under the source selector
async function temuUpdateSrcInfo() {
  const el = $('temuSrcInfo'); if (!el) return;
  try { if ($('temuModal')?.classList.contains('temu-review-mode')) temuReviewCompactText(); } catch (_) {}
  try {
    const source = $('temuSource')?.value || 'bulk';
    if (source === 'sheet' && TemuLast?.asIs) { el.textContent = `${TemuLast.n} products — Temu file as-is (${TemuLast.name}) · store: ${temuActiveStoreName() || '—'}`; return; }
    let rows = [];
    if (source === 'bulk') rows = (BulkState?.results || []).filter(x => x.status !== 'fail');
    else if (source === 'library_sel' && TemuLibPick?.ids) rows = (await getMasterRows()).filter(r => TemuLibPick.ids.has(r.id));
    else if (source === 'sheet' && TemuSheetRows) rows = TemuSheetRows;
    else rows = await getMasterRows();
    const n = rows.length;
    if (!n) {
      if (source === 'bulk') {
        const masterRows = await getMasterRows();
        if (masterRows.length > 0) {
          el.innerHTML = `<span>0 in current bulk hunt · <b style="color:#38BDF8">${masterRows.length} in Library</b></span> <button id="temuSwitchLibBtn" class="temu-link-btn" type="button" style="color:#FFB800;font-weight:700;margin-left:8px;text-decoration:underline;">[ 📦 Switch to Library ]</button>`;
          $('temuSwitchLibBtn')?.addEventListener('click', () => {
            if ($('temuSource')) { $('temuSource').value = 'master'; temuUpdateSrcInfo(); }
          });
          return;
        }
        el.textContent = '0 products — pehle Bulk → Hunt all open tabs chalayen';
        return;
      }
      el.textContent = '0 products in Library';
      return;
    }
    const cfg = temuGetCfg();
    const store = temuActiveStoreName() || 'default';
    const skipOn = $('tgSkipListedExport') ? !!$('tgSkipListedExport').checked : ($('tgSkipListed') ? !!$('tgSkipListed').checked : cfg.skip_listed !== false);
    const listed = rows.filter(r => temuListedMap()[store + '|' + temuSourceId(r.url || '')]).length;
    el.textContent = `${n} products ready` + (listed ? ` · ${listed} already listed (${skipOn ? 'skip' : 'skip OFF — dobara jayenge!'})` : '') + ` · store: ${temuActiveStoreName() || '—'}`;
    if ($('tgPrecheck')?.checked && rows.length > 0 && !TemuCheck) {
      temuRunExport({ dryRun: true, forUpload: true }).then(dr => {
        if (dr?.items?.length) temuCheckRender(dr.items, dr.skipped || [], dr.cfg, dr.rows);
      }).catch(() => {});
    }
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

async function openTemuModal() {
  const m = $('temuModal'); if (!m) return;
  m.style.zIndex = '99999';
  await temuMigrateLegacyIfNeeded();
  temuRenderStoreBar();
  temuUpdateTplStatus();
  temuRenderProfiles();
  temuFillForm();
  temuCatFormReset();
  temuSwitchTab('upload');
  temuRenderHistory();
  TemuStoreCardOpen = false; temuSetupRender(); hdrStoreRender(); temuDetectStore({ apply: false }).catch(() => {}); // v9.10.0 / v9.16.0
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

// ── v9.10.0 Store auto-detect (khule Temu tabs ka mall name) ──
async function temuDetectStore({ apply = false } = {}) {
  let tabs = [];
  try { tabs = await chrome.tabs.query({ url: ['https://seller.temu.com/*'] }); } catch (_) { return null; }
  if (!tabs.length) return { none: true };
  const malls = new Set();
  await Promise.all(tabs.map(t => new Promise(res => {
    try {
      chrome.tabs.sendMessage(t.id, { action: 'TEMU_GET_MALL' }, async r => {
        if (!chrome.runtime.lastError && r?.mall) { malls.add(r.mall); return res(); }
        try {
          if (chrome.scripting) {
            const inj = await chrome.scripting.executeScript({
              target: { tabId: t.id },
              func: () => (document.querySelector('[class*="mall_name"]')?.textContent || '').trim()
            });
            const m = inj?.[0]?.result;
            if (m) malls.add(m);
          }
        } catch (_) {}
        res();
      });
    } catch (_) { res(); }
  })));
  if (!malls.size) return { none: true };
  const act = temuActiveStoreName();
  const stores = temuStores();
  const list = [...malls];
  const line = $('temuStoreDetect'), setupLine = $('temuSetupDetect');
  const show = (txt, kind) => { [line, setupLine].forEach(el => { if (!el) return; el.hidden = !txt; el.textContent = txt || ''; el.className = (el === line ? 'temu-detect' : 'setup-hint') + (kind ? ' ' + kind : ''); });
    const md = $('temuStoreMiniDet'); if (md) { md.textContent = kind === 'ok' ? '· Temu tab ✓' : kind ? '· Temu tab ⚠' : ''; md.className = 'tsm-det' + (kind ? ' ' + kind : ''); } // v9.16.0
  };
  if (list.length > 1) { show(`Temu tabs: ${list.join(', ')} — ${list.includes(act) ? act + ' active' : 'active store "' + act + '" khula nahi!'}`, list.includes(act) ? '' : 'bad'); return { multi: true, malls: list }; }
  const mall = list[0];
  if (mall === act) { show(`✓ Temu tab par "${mall}" khula hai — match`, 'ok'); return { match: true, mall }; }
  const known = Object.keys(stores).find(n => n.toLowerCase() === mall.toLowerCase());
  if (known) {
    if (apply) { if ((await temuSaveStores(stores, known)) === true) { if (!TemuLast?.asIs) TemuLast = null; temuRenderStoreBar(); temuUpdateTplStatus(); temuRenderProfiles(); temuFillForm(); hdrStoreRender(); show(`✓ Store auto-switch: "${known}" (Temu tab se)`, 'ok'); return { switched: true, mall: known }; } }
    show(`Temu tab par "${mall}" khula hai, extension mein "${act || '—'}" — dropdown se switch karein`, 'warn'); return { mismatch: true, mall };
  }
  show(`Temu tab par "${mall}" khula hai — ye store extension mein nahi. "+ Add" dabayen (naam khud bhar jayega)`, 'warn');
  TemuDetectedMall = mall;
  return { unknown: true, mall };
}
let TemuDetectedMall = '';

// ── v9.12.0 Brand approvals import from Temu "Brands & intellectual property" ──
async function temuImportBrands() {
  const msgEl = $('tgBrandMsg'); const say = (t, k) => { if (msgEl) { msgEl.textContent = t; msgEl.className = 'temu-inline-msg' + (k ? ' ' + k : ''); } };
  const store = temuActiveStoreName(); if (!store) { say('Pehle store chunein', 'bad'); return; }
  say('⏳ Temu Brands & IP page dhoondh raha hoon…');
  let tabs = await chrome.tabs.query({ url: ['https://seller.temu.com/brands-property.html*'] });
  let tab = tabs.find(t => t.active) || tabs[0] || null, created = false;
  if (!tab) { tab = await chrome.tabs.create({ url: 'https://seller.temu.com/brands-property.html', active: true }); created = true; }
  const pingFor = (ms, delay) => new Promise(res => { let n = 0, max = Math.ceil(ms / 500); const ping = () => chrome.tabs.sendMessage(tab.id, { action: 'PING' }, r => { if (!chrome.runtime.lastError && r?.ready) return res(true); if (++n > max) return res(false); setTimeout(ping, 500); }); setTimeout(ping, delay); });
  let okPing = await pingFor(created ? 30000 : 3000, created ? 2500 : 100);
  if (!okPing && !created) {
    // v9.12.1: extension reload ke baad purane tab mein content script nahi hota — tab reload kar ke dobara
    say('⏳ Temu tab se rabta nahi (extension reload hua tha) — tab reload kar raha hoon…');
    await new Promise(r => chrome.tabs.reload(tab.id, {}, () => { void chrome.runtime.lastError; r(); }));
    okPing = await pingFor(30000, 3000); created = true;
  }
  if (!okPing) { say('✗ Temu page se rabta nahi — page load hone par dobara dabayen', 'bad'); return; }
  if (created) await new Promise(r => setTimeout(r, 2500));
  try { await chrome.tabs.update(tab.id, { active: true }); } catch (_) {}
  say('⏳ Trademark table parh raha hoon (sab pages)…');
  const r = await new Promise(res => chrome.tabs.sendMessage(tab.id, { action: 'TEMU_READ_BRANDS' }, x => res(chrome.runtime.lastError ? { success: false, report: ['✗ ' + chrome.runtime.lastError.message] } : x)));
  if (!r?.success) { say((r?.report || ['✗ parh nahi saka']).join(' '), 'bad'); return; }
  if (r.mall && r.mall.toLowerCase() !== store.toLowerCase()) { say(`✗ Temu tab store "${r.mall}" ka hai, extension mein "${store}" — pehle store match karein`, 'bad'); return; }
  const rules = {}; let skipped = 0;
  for (const b of r.brands || []) {
    if (!/in effect/i.test(b.status || '')) { skipped++; continue; }
    const name = String(b.name || '').trim().toUpperCase(); if (!name) continue;
    const rule = rules[name] || { groups: [], cats: {} };
    for (const ct of b.cats || []) { const g = temuCatGroup(ct.name); if (!rule.groups.includes(g)) rule.groups.push(g); if (ct.units != null) rule.cats[g] = Math.max(rule.cats[g] ?? 0, ct.units); }
    rules[name] = rule;
  }
  const ta = $('tgBrandRules'); if (ta) ta.value = temuBrandRulesToText(rules);
  const cfg = temuGetCfg(); cfg.brand_rules = rules;
  const sv = await temuSaveCfg(cfg);
  say(sv === true ? `✓ ${Object.keys(rules).length} brands import + save (${store})${skipped ? ` · ${skipped} non-active skip` : ''}` : '✗ Save fail: ' + sv, sv === true ? 'ok' : 'bad');
  toast(`${Object.keys(rules).length} brand approvals import — ${store}`, 'ok');
}

// ── v9.10.0 Header store badge ──
async function hdrStoreRender() {
  const b = $('hdrStore'); if (!b) return;
  const n = temuActiveStoreName();
  if (!n) { b.hidden = true; return; }
  b.hidden = false; $('hdrStoreName').textContent = n;
  try {
    const target = await temuDashTarget(); const today = temuDayKey(Date.now());
    let listed = 0; for (const v of Object.values(temuListedMap())) if (v?.d === today) listed++;
    const t = $('hdrStoreToday'); if (t) { t.textContent = `${listed}/${target}`; t.classList.toggle('done', listed >= target); }
  } catch (_) {}
}

// ── v9.10.0 Bulk tab "Agla step" card ──
function bulkNextRender(mode) {
  const card = $('bulkNext'); if (!card) return;
  const rows = (BulkState?.results || []).filter(x => x.status !== 'fail');
  const t = $('bulkNextTitle'), sub = $('bulkNextSub'), btn = $('bulkNextBtn');

  if (mode === 'uploaded') {
    card.hidden = false;
    card.dataset.mode = 'uploaded';
    if (t) t.textContent = 'Upload Completed ✓';
    if (sub) sub.textContent = 'Products successfully pushed to Temu';
    if (btn) btn.innerHTML = `<svg class="i i-xs" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 8v4l3 3m6-3a9 9 0 1 1-18 0 9 9 0 0 1 18 0z"/></svg><span class="btn-lbl">Temu History</span><span class="btn-arr">→</span>`;
    return;
  }
  if (!rows.length) {
    card.hidden = false;
    card.dataset.mode = 'idle';
    if (t) t.textContent = 'Temu Seller Integration';
    if (sub) sub.textContent = 'Direct Export, Draft Creation & Auto-Upload';
    if (btn) btn.innerHTML = `<svg class="i i-xs" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg><span class="btn-lbl">Upload to Temu</span><span class="btn-arr">→</span>`;
    return;
  }
  card.hidden = false;
  card.dataset.mode = 'ready';
  if (t) t.textContent = `${rows.length} Product${rows.length === 1 ? '' : 's'} Ready for Temu`;
  if (sub) sub.textContent = '1-Click Export and automated Drafts upload';
  if (btn) btn.innerHTML = `<svg class="i i-xs" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg><span class="btn-lbl">Upload to Temu</span><span class="btn-arr">→</span>`;
}

// ── v9.10.0 Setup card ──
let TemuStoreCardOpen = false; // v9.16.0
function temuStoreMiniRender(hasStore, hasTpl) {
  const full = $('temuStoreCard'); if (!full) return;
  full.hidden = !hasStore;
}
function temuSetupRender() {
  const card = $('temuSetup'); if (!card) return;
  const n = temuActiveStoreName(); const st = temuActiveStore();
  const s1 = $('setupStep1'), s2 = $('setupStep2');
  const hasStore = !!n, hasTpl = !!(st && st.templateName);
  temuStoreMiniRender(hasStore, hasTpl); // v9.16.0
  if (hasStore && hasTpl) { card.hidden = true; return; }
  card.hidden = false;
  s1.classList.toggle('done', hasStore); s2.classList.toggle('done', hasTpl); s2.classList.toggle('locked', !hasStore);
  s1.querySelector('.setup-txt small').textContent = hasStore ? `✓ ${n}` : 'Naam bilkul wahi jo Temu Seller Center mein upar-right dikhta hai';
}

// ── v9.10.0 Hints → (?) toggle ──
function temuHintsInit() {
  document.querySelectorAll('#temuModal .temu-hint:not(.temu-hint-top):not([data-q])').forEach(hint => {
    hint.dataset.q = '1';
    const field = hint.closest('.temu-field') || hint.parentElement;
    const lbl = field && field.querySelector('.temu-lbl');
    const q = document.createElement('button'); q.type = 'button'; q.className = 'hint-q'; q.textContent = '?'; q.title = 'Madad';
    q.addEventListener('click', (e) => { e.preventDefault(); hint.classList.toggle('open'); q.classList.toggle('on', hint.classList.contains('open')); });
    if (lbl) lbl.appendChild(q); else hint.before(q);
  });
}

function initTemuExport() {
  temuInitActivitySummary();
  temuHintsInit();
  restoreTemuCheckSession();
  // v9.10.0: stepper retry / next card / setup / fast toggle
  document.addEventListener('click', e => {
    const rb = e.target.closest('#temuSteps .tstep-retry'); if (rb) { temuStepRetry(rb.dataset.retry); return; }
    if (e.target.closest('#bulkNextBtn')) { const card = $('bulkNext'); openTemuModal().then(() => { if (card?.dataset.mode === 'uploaded') temuSwitchTab('history'); }); return; }
    if (e.target.closest('#hdrStore')) { openTemuModal(); return; }
    if (e.target.closest('#temuStoreMini')) { TemuStoreCardOpen = true; temuSetupRender(); return; } // v9.16.0
    if (e.target.closest('#tgBrandImport')) { temuImportBrands(); return; }
    if (e.target.closest('#temuAttrBtn')) { temuStepsReset(false); temuFillAttributes(); return; }
    const sb = e.target.closest('#temuSetup [data-setup]'); if (sb) { if (sb.dataset.setup === 'store') $('temuStoreAddBtn')?.click(); else $('temuTplFile')?.click(); return; }
  });
  { const ft = $('bulkFastToggle'); if (ft) {
      const sync = () => { try { ft.checked = !!State.data?.settings?.bulkSkipImageDownload; } catch (_) {} };
      setTimeout(sync, 400); setTimeout(sync, 2000);
      ft.addEventListener('change', async () => { const v = ft.checked; const r = await msg({ action: 'UPDATE_SETTINGS', settings: { bulkSkipImageDownload: v } }).catch(() => null); if (r?.success !== false) { if (State.data?.settings) State.data.settings.bulkSkipImageDownload = v; const q = document.querySelector('#tab-settings [data-setting="bulkSkipImageDownload"]'); if (q) q.checked = v; toast(v ? 'Fast mode ON — sirf image URLs' : 'Fast mode OFF — images download hongi', 'ok'); } else toast('Save nahi hua', 'warn'); });
      document.addEventListener('change', e => { if (e.target?.dataset?.setting === 'bulkSkipImageDownload') ft.checked = !!e.target.checked; });
  } }
  { // Find & Replace Modal Inputs
    $('tckFrFind')?.addEventListener('input', updateFindReplacePreview);
    $('tckFrReplace')?.addEventListener('input', updateFindReplacePreview);
    $('tckFrCase')?.addEventListener('change', updateFindReplacePreview);
    $('tckFrSelectedOnly')?.addEventListener('change', updateFindReplacePreview);
    $('tckFrFind')?.addEventListener('keydown', e => { if (e.key === 'Enter') applyFindReplace(); });
    $('tckFrReplace')?.addEventListener('keydown', e => { if (e.key === 'Enter') applyFindReplace(); });
  }
  { // 1-Click AI Title Studio Listeners
    $('tckAiStudioSelectedOnly')?.addEventListener('change', renderAiStudioList);
    $('tckAiStudioList')?.addEventListener('input', e => {
      const inp = e.target.closest('.tck-ai-item-inp');
      if (inp) {
        const row = inp.closest('.tck-ai-item');
        if (row) {
          row.classList.add('tck-ai-modified');
          const chk = row.querySelector('.tck-ai-item-chk');
          if (chk) chk.checked = true;
          const cnt = row.querySelector('.tck-ai-char-badge');
          if (cnt) {
            const len = inp.value.length;
            cnt.textContent = `${len}/120`;
            cnt.className = `tck-ai-char-badge ${len > 120 ? 'bad' : len > 100 ? 'warn' : 'ok'}`;
          }
          updateAiStudioCounts();
        }
      }
    });
    $('tckAiStudioList')?.addEventListener('change', e => {
      if (e.target.classList.contains('tck-ai-item-chk')) {
        updateAiStudioCounts();
      }
    });
    window.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        closeAiTitleStudio();
        closeFindReplaceModal();
      }
    });
  }
  { // Initialize Hunt Speed & Network Mode
    setTimeout(() => {
      setHuntSpeedMode(getHuntSpeedMode());
    }, 100);
  }
  setTimeout(() => { hdrStoreRender(); bulkNextRender(); }, 600);
  { // v10.2.3 — tabs hide/show (zhHiddenTabs: ['images','library'])
    const apply = (hidden) => {
      ['images', 'library'].forEach(t => { const b = document.getElementById('tab-btn-' + t); if (b) b.style.display = hidden.includes(t) ? 'none' : ''; });
      const act = document.querySelector('.tab-btn.active'); if (act && hidden.includes(act.dataset.tab)) document.querySelector('[data-tab="bulk"]')?.click();
      window.zhHiddenTabs = hidden;
    };
    chrome.storage.local.get('zhHiddenTabs', x => { const h = Array.isArray(x?.zhHiddenTabs) ? x.zhHiddenTabs : []; apply(h);
      const ch = $('zhTabShowHunt'), cl = $('zhTabShowLibrary'); if (ch) ch.checked = !h.includes('images'); if (cl) cl.checked = !h.includes('library'); });
    const save = () => { const h = []; if ($('zhTabShowHunt') && !$('zhTabShowHunt').checked) h.push('images'); if ($('zhTabShowLibrary') && !$('zhTabShowLibrary').checked) h.push('library'); chrome.storage.local.set({ zhHiddenTabs: h }); apply(h); toast('Tabs update ho gaye', 'ok'); };
    $('zhTabShowHunt')?.addEventListener('change', save); $('zhTabShowLibrary')?.addEventListener('change', save);
  }
  { const ef = $('zhExportFolderToggle'); if (ef) { chrome.storage.local.get('zhExportFolder', x => { ef.checked = x?.zhExportFolder !== false; }); ef.addEventListener('change', () => { chrome.storage.local.set({ zhExportFolder: ef.checked }); toast(ef.checked ? 'Downloads → ZHunter Export/<date>/' : 'Downloads → default folder', 'ok'); }); } } // v10.1.0
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

    // v10.3.4 Performance mode (default ON): html[data-fx="off"] → animations/blur band
    { const fx = $('zhReduceFxToggle');
      const apply = on => { document.documentElement.dataset.fx = on ? 'off' : 'full'; };
      chrome.storage.local.get('zhReduceFx', x => { const on = x?.zhReduceFx === true; if (fx) fx.checked = on; apply(on); }); // v11: default OFF (Premium glass)
      fx?.addEventListener('change', () => { chrome.storage.local.set({ zhReduceFx: fx.checked }); apply(fx.checked); toast(fx.checked ? 'Performance mode ON' : 'Performance mode OFF', 'ok'); }); }
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
      if ($('zhFrameColorPicker2') && color !== 'rainbow') $('zhFrameColorPicker2').value = color;
      document.querySelectorAll('.zh-fcol-preset').forEach(btn => {
        const isSel = (btn.dataset.color || '').toLowerCase() === color.toLowerCase();
        btn.classList.toggle('zh-fcol-active', isSel);
        btn.style.outline = isSel ? '2.5px solid #FFB800' : 'none';
        btn.style.boxShadow = isSel ? '0 0 0 4px rgba(255,184,0,.25), 0 0 8px rgba(255,184,0,.4)' : 'none';
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
        const isSel = btn.dataset.corner === corner;
        btn.classList.toggle('active', isSel);
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
      if ($('zhFrameColorPicker2') && col !== 'rainbow') $('zhFrameColorPicker2').value = col;
      document.querySelectorAll('.zh-fcol-preset').forEach(btn => {
        const isSel = (btn.dataset.color || '').toLowerCase() === col.toLowerCase();
        btn.classList.toggle('zh-fcol-active', isSel);
        btn.style.outline = isSel ? '2.5px solid #FFB800' : 'none';
        btn.style.boxShadow = isSel ? '0 0 0 4px rgba(255,184,0,.25), 0 0 8px rgba(255,184,0,.4)' : 'none';
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
    $('zhFrameColorPicker2')?.addEventListener('input', e => updateFrameColor(e.target.value));
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
  document.addEventListener('change', e => {
    if (e.target && (e.target.id === 'tgSkipListed' || e.target.id === 'tgSkipListedExport')) {
      const isChk = e.target.checked;
      if ($('tgSkipListed')) $('tgSkipListed').checked = isChk;
      if ($('tgSkipListedExport')) $('tgSkipListedExport').checked = isChk;
      TemuCheck = null;
      temuUpdateSrcInfo();
    }
    if (e.target && e.target.id === 'temuDashTarget') { const v = parseInt(e.target.value, 10); if (v > 0) chrome.storage.local.set({ temuDailyTarget: v }, () => temuDashRender()); else e.target.value = '50'; } // v9.9.0
    if (e.target && e.target.classList?.contains('tck-on')) temuCheckSummary();
    if (e.target && e.target.id === 'temuSource') temuCheckClose();
    if (e.target && e.target.id === 'temuSource') { if (TemuLast?.asIs && e.target.value !== 'sheet') { TemuLast = null; const mb = $('temuMarkListedBtn'); if (mb) mb.hidden = true; } temuUpdateSrcInfo(); }
    if (e.target && e.target.id === 'temuSheetFile') { const f = e.target.files?.[0]; if (f) temuImportSheet(f); e.target.value = ''; }
    if (e.target && e.target.id === 'tgPx') { const o = $('tgPx2'); if (o) o.value = e.target.value; TemuCheck = null; temuUpdateSrcInfo(); temuUpdatePricePreview(); }
    if (e.target && e.target.id === 'tgPx2') { const o = $('tgPx'); if (o) o.value = e.target.value; TemuCheck = null; temuUpdateSrcInfo(); temuUpdatePricePreview(); }
    if (e.target && (e.target.id === 'tgRound99' || e.target.id === 'tgRound992')) {
      const v = e.target.checked;
      if ($('tgRound99')) $('tgRound99').checked = v;
      if ($('tgRound992')) $('tgRound992').checked = v;
      const cfg = temuGetCfg(); cfg.price_round_to_99 = v;
      temuSaveCfg(cfg); TemuCheck = null; temuUpdateSrcInfo(); temuUpdatePricePreview();
    }
    if (e.target && (e.target.id === 'tgMinProfit' || e.target.id === 'tgMinProfit2')) {
      const v = e.target.value;
      if ($('tgMinProfit')) $('tgMinProfit').value = v;
      if ($('tgMinProfit2')) $('tgMinProfit2').value = v;
      const cfg = temuGetCfg(); cfg.min_profit_dollar = parseFloat(v) || 0;
      temuSaveCfg(cfg); TemuCheck = null; temuUpdateSrcInfo(); temuUpdatePricePreview();
    }
    if (e.target && (e.target.id === 'tgHeavyBuffer' || e.target.id === 'tgHeavyBuffer2')) {
      const v = e.target.value;
      if ($('tgHeavyBuffer')) $('tgHeavyBuffer').value = v;
      if ($('tgHeavyBuffer2')) $('tgHeavyBuffer2').value = v;
      const cfg = temuGetCfg(); cfg.heavy_shipping_buffer = parseFloat(v) || 0;
      temuSaveCfg(cfg); TemuCheck = null; temuUpdateSrcInfo(); temuUpdatePricePreview();
    }
    if (e.target && e.target.id === 'temuStoreSel') (async () => {
      if ((await temuSaveStores(temuStores(), e.target.value)) === true) {
        if (!TemuLast?.asIs) TemuLast = null;
        temuUpdateTplStatus(); temuRenderProfiles(); temuFillForm();
        toast(`Active store: ${e.target.value}`, 'ok');
      }
    })();
  });
  document.addEventListener('input', e => {
    if (e.target && (e.target.id === 'tgPx' || e.target.id === 'tgPx2' || e.target.id === 'tgMinProfit' || e.target.id === 'tgMinProfit2' || e.target.id === 'tgHeavyBuffer' || e.target.id === 'tgHeavyBuffer2')) {
      temuUpdatePricePreview();
    }
    if (e.target && e.target.id === 'tckSearchInp') {
      tckFilterBySearch(e.target.value);
    }
    if (e.target && e.target.id === 'tckHideClean') { if (TemuCheck) { TemuCheck.view.hideClean = !!e.target.checked; temuCheckSync(); } }
  });
  // Delegated clicks — survive any re-render and any modal stacking
  document.addEventListener('click', e => {
    const sp = e.target.closest('.temu-store-pill');
    if (sp && sp.dataset.sname) {
      const targetName = sp.dataset.sname;
      if (targetName !== temuActiveStoreName()) {
        (async () => {
          const ok = await temuSaveStores(temuStores(), targetName);
          if (ok === true) {
            if (!TemuLast?.asIs) TemuLast = null;
            temuRenderStoreBar();
            temuUpdateTplStatus();
            temuRenderProfiles();
            temuFillForm();
            temuUpdateSrcInfo();
            toast(`Switched to ${targetName} (Active)`, 'ok');
          }
        })();
      }
      return;
    }
    if (e.target.closest('#temuStorePillAdd')) {
      $('temuStoreAddBtn')?.click();
      return;
    }
    const tb = e.target.closest('#temuModal .temu-tab'); if (tb) { temuSwitchTab(tb.dataset.ttab); return; }
    if (e.target.closest('#temuReportClear')) { const r = $('temuReport'); if (r) r.textContent = ''; const wp = $('temuActivityWrap'); if (wp) wp.open = false; try { chrome.storage.local.remove('temuReportText'); } catch (_) {} }
    if (e.target.closest('#tcCancelBtn')) { temuCatFormReset(); temuCatMsg(''); }
    if (e.target.closest('#bulkTemuBtn') || e.target.closest('#queueTemuBtn') || e.target.closest('#bulkTemuOpenBtn')) { e.preventDefault(); openTemuModal(); } // v9.5.3: Bulk tab ka 'Temu' button — bina hunt ke bhi
    if (e.target.closest('#temuModalClose')) $('temuModal')?.classList.add('hidden');
    if (e.target.closest('#temuExportBtn')) {
      temuRunExport({ forUpload: false });
      toast('Excel file download ho rahi hai...', 'ok');
    }
    if (e.target.closest('#temuCancelUploadBtn') || e.target.closest('#temuStopBtn')) { temuStopNow(); }
    if (e.target.closest('#temuReviewExpandBtn')) { $('temuModal')?.classList.toggle('temu-review-expanded'); }
    { const t2 = e.target.closest('.tck-dock-t2[data-mirror]'); if (t2) { $(t2.dataset.mirror)?.click(); } }
    if (e.target.closest('#tckExpTemu')) { const mn = $('tckExportMenu'); if (mn) mn.hidden = true; temuReviewExport('temu'); }
    if (e.target.closest('#tckExpSimple')) { const mn = $('tckExportMenu'); if (mn) mn.hidden = true; temuReviewExport('simple'); }
    if (!e.target.closest('.tck-export-wrap')) { const mn = $('tckExportMenu'); if (mn && !mn.hidden) mn.hidden = true; }
    if (e.target.closest('#temuOpenTemuPageBtn')) {
      chrome.tabs.create({ url: 'https://seller.temu.com/upload-goods-multiple.html', active: true });
    }
    if (e.target.closest('#temuStepsResetBtn')) {
      const st = $('temuSteps');
      if (st) st.hidden = true;
    }
    if (e.target.closest('#temuMarkListedBtn')) (async () => {
      if (!TemuLast?.items?.length) return;
      if (!confirm(`${TemuLast.items.length} products ko "listed" mark karein? (Sirf tab jab aap ne ye file Temu par khud upload kar di ho)`)) return;
      await temuMarkListed(TemuLast.items); TemuLast.marked = true;
      try { await temuHistAdd({ kind: 'manual', store: temuActiveStoreName() || '—', n: TemuLast.items.length, items: temuHistItems(TemuLast.items) }); } catch (_) {}
      const mb = $('temuMarkListedBtn'); if (mb) mb.hidden = true;
      const rep = $('temuReport'); if (rep) rep.textContent += `\n✓ ${TemuLast.items.length} products listed mark kiye`;
      temuUpdateSrcInfo();
    })();
    if (e.target.closest('#temuAutoBtn')) temuAutoUpload();
    if (e.target.closest('#temuFixDraftsBtn')) (async () => { // v9.15.2: ek button = drafts complete + missing attributes
      temuStepsReset(false);
      const rep = $('temuReport'); if (rep) rep.textContent = '⏳ 1/2 Drafts complete (Complete product details)…';
      await temuFixDrafts();
      if (rep) rep.textContent = (rep.textContent || '') + '\n⏳ 2/2 Missing attributes (Product action required)…';
      await temuFillAttributes();
      if (rep) rep.textContent = (rep.textContent || '') + '\n✓ Temu par complete — Manage products mein status dekh lein';
    })();
    if (e.target.closest('#temuFailedBtn')) temuReadFailed({});
    if (e.target.closest('#temuCheckGo')) temuCheckGo();
    if (e.target.closest('#temuCheckCancel')) { temuCheckClose(); const rep = $('temuReport'); if (rep) rep.textContent = 'Check cancel — kuch upload nahi hua.'; }
    if (e.target.closest('#temuAutoFixBtn')) temuAutoFixAll();
    if (e.target.closest('#tckStatusShowAll') || e.target.closest('#temuCheckShowAll')) { if (TemuCheck) { TemuCheck.view.filter = 'all'; TemuCheck.view.q = ''; TemuCheck.view.hideClean = false; const si = $('tckSearchInp'); if (si) si.value = ''; temuCheckSync(); } }
    { const db = e.target.closest('.tck-drop-btn[data-panel]'); if (db) temuCheckPanel(db.dataset.panel); }
    if (e.target.closest('#tckSearchClearBtn')) { const si = $('tckSearchInp'); if (si) si.value = ''; tckFilterBySearch(''); }
    if (e.target.closest('#temuCheckAll')) { document.querySelectorAll('#temuCheckList .tck-row:not([hidden]) .tck-on').forEach(c => { c.checked = true; }); temuCheckSummary(); }
    if (e.target.closest('#temuCheckNone')) { document.querySelectorAll('#temuCheckList .tck-row:not([hidden]) .tck-on').forEach(c => { c.checked = false; }); temuCheckSummary(); }
    if (e.target.closest('#temuCheckClean')) { document.querySelectorAll('#temuCheckList .tck-row').forEach(r => { const c = r.querySelector('.tck-on'); if (c) c.checked = r.dataset.clean === 'true'; }); temuCheckSummary(); }
    if (e.target.closest('#temuCheckHeavy')) {
      const maxWt = parseFloat(TemuCheck?.cfg?.max_weight_lb) || 0;
      let cnt = 0;
      document.querySelectorAll('#temuCheckList .tck-row').forEach(r => {
        const i = +r.dataset.i, it = TemuCheck?.items?.[i];
        const isH = it?.warn?.includes('OVERWEIGHT') || (maxWt > 0 && parseFloat(it?.weight) > maxWt);
        if (isH) {
          const chk = r.querySelector('.tck-on');
          if (chk && !chk.checked) { chk.checked = true; cnt++; }
        }
      });
      temuCheckSummary();
      toast(`⚖️ ${cnt} heavy products include/select kar diye!`, 'ok');
    }
    if (e.target.closest('#temuCheckCleanTitles')) {
      const cnt = temuCleanTitlesInReview();
      toast(cnt ? `🛡️ ${cnt} titles se banned words strip kar diye!` : 'Sab titles pehle se clean hain!', 'ok');
    }
    // Quick Filter Chips
    const fltChip = e.target.closest('.tck-filter-chip');
    if (fltChip) {
      const fType = fltChip.dataset.filter || 'all';
      temuFilterRows(fType);
    }
    // Compact / Dual-View Switchers
    if (e.target.closest('#temuViewToggle')) {
      temuToggleViewMode();
    }
    const tckViewBtn = e.target.closest('#tckViewSwitcher .zh-view-btn');
    if (tckViewBtn) {
      setTemuReviewViewMode(tckViewBtn.dataset.view);
      toast(tckViewBtn.dataset.view === 'dense' ? 'Dense Spreadsheet View active' : 'Card View active', 'ok');
    }
    if (e.target.closest('#tckMinimizeBtn') || e.target.closest('#tckMinimizedNotice')) {
      toggleTemuProductsMinimized();
    }
    if (e.target.closest('#aiDoneClose') || e.target.closest('#aiDoneOk') || (e.target.classList.contains('modal-back') && e.target.id === 'aiDoneModal')) {
      hideAiDoneModal();
    }
    const masterViewBtn = e.target.closest('#masterViewSwitcher .zh-view-btn');
    if (masterViewBtn) {
      setMasterLibraryViewMode(masterViewBtn.dataset.view);
      toast(masterViewBtn.dataset.view === 'dense' ? 'Dense Spreadsheet View active' : 'Card View active', 'ok');
    }
    // Find & Replace Modal
    if (e.target.closest('#temuFindReplaceBtn') || e.target.closest('#tckStickyReplaceBtn')) {
      openFindReplaceModal();
    }
    // 1-Click AI Title Studio Modal
    if (e.target.closest('#temuAiStudioBtn') || e.target.closest('#tckStickyAiBtn')) {
      openAiTitleStudio();
    }
    if (e.target.closest('#tckAiStudioCloseBtn') || e.target.closest('#tckAiStudioCancelBtn') || e.target.closest('#tckAiStudioBackdrop')) {
      closeAiTitleStudio();
    }
    if (e.target.closest('#tckAiStudioRunBtn')) {
      runAiTitleStudio();
    }
    if (e.target.closest('#tckAiStudioApplyBtn')) {
      applyAiStudioTitles();
    }
    if (e.target.closest('#tckAiMatrixSelectAll')) {
      const listEl = $('tckAiStudioList');
      if (listEl) listEl.querySelectorAll('.tck-ai-item-chk').forEach(c => c.checked = true);
      updateAiStudioCounts();
    }
    if (e.target.closest('#tckAiMatrixDeselectAll')) {
      const listEl = $('tckAiStudioList');
      if (listEl) listEl.querySelectorAll('.tck-ai-item-chk').forEach(c => c.checked = false);
      updateAiStudioCounts();
    }
    const presetChip = e.target.closest('.tck-ai-preset-chip');
    if (presetChip && presetChip.dataset.instruction) {
      const pInp = $('tckAiStudioPromptInp');
      if (pInp) {
        const text = presetChip.dataset.instruction;
        const curr = pInp.value.trim();
        if (!curr) pInp.value = text;
        else if (!curr.includes(text)) pInp.value = curr + ', ' + text;
        presetChip.classList.add('active');
        setTimeout(() => presetChip.classList.remove('active'), 800);
        pInp.focus();
      }
    }
    const speedPill = e.target.closest('.zh-speed-pill');
    if (speedPill && speedPill.dataset.speed) {
      setHuntSpeedMode(speedPill.dataset.speed);
      const modeLabel = speedPill.dataset.speed === 'safe' ? 'Safe Mode (1 Tab) — Slow net safe' : speedPill.dataset.speed === 'balanced' ? 'Balanced Mode (2 Tabs)' : 'Turbo Mode (3 Tabs)';
      toast(`Hunt speed: ${modeLabel}`, 'ok');
    }
    if (e.target.closest('#tckStickyExportBtn')) {
      const mn = $('tckExportMenu'); if (mn) mn.hidden = !mn.hidden;
    }
    if (e.target.closest('#tckStickyUploadBtn')) {
      $('temuCheckGo')?.click();
    }
    if (e.target.closest('#tckFrCloseBtn') || e.target.closest('#tckFrCancelBtn') || e.target.closest('#tckFrBackdrop')) {
      closeFindReplaceModal();
    }
    if (e.target.closest('#tckFrApplyBtn')) {
      applyFindReplace();
    }

    if (e.target.closest('#temuAiOptimizeBtn')) {
      temuAIOptimizeTitles();
    }
    if (e.target.closest('#temuAiRewriteListedBtn') || e.target.closest('#tckStickyAiRewriteBtn')) {
      const allItems = TemuCheck?.items || [];
      const listedIndices = [];
      allItems.forEach((it, idx) => {
        if (it.isAlreadyListed || it.listedRecord) listedIndices.push(idx);
      });
      if (!listedIndices.length) {
        toast('Review table mein koi already-listed product nahi mila', 'info');
        return;
      }
      temuAIOptimizeTitles(null, { isReList: true, targetIndices: listedIndices });
    }
    if (e.target.closest('#tckQuickAll')) {
      document.querySelectorAll('#temuCheckList .tck-on').forEach(chk => { chk.checked = true; });
      temuCheckSummary();
    }
    if (e.target.closest('#tckQuickNone')) {
      document.querySelectorAll('#temuCheckList .tck-on').forEach(chk => { chk.checked = false; });
      temuCheckSummary();
    }
    if (e.target.closest('#tckStickyAiBtn')) {
      $('temuAiStudioBtn')?.click();
    }
    // v10.3.2: Export ▾ menu (tckExpTemu / tckExpSimple) handles review export
    const aiRelistBtn = e.target.closest('.tck-ai-relist-btn');
    if (aiRelistBtn) {
      const idx = +aiRelistBtn.dataset.i;
      if (!isNaN(idx)) {
        aiRelistBtn.classList.add('busy');
        aiRelistBtn.textContent = '⏳...';
        temuAIOptimizeTitles(idx, { isReList: true });
      }
    }
    if (e.target.closest('#temuAiAttributesBtn')) {
      temuAiExtractAttributes();
    }
    const presetBtn = e.target.closest('.zh-pricing-preset-btn');
    if (presetBtn && presetBtn.dataset.preset) {
      applyPricingPreset(presetBtn.dataset.preset);
    }
    if (e.target.closest('#tckSearchClearBtn')) {
      const sInp = $('tckSearchInp');
      if (sInp) {
        sInp.value = '';
        tckFilterBySearch('');
        sInp.focus();
      }
    }
    const aiRowBtn = e.target.closest('.tck-ai-row-btn');
    if (aiRowBtn) {
      const idx = +aiRowBtn.dataset.i;
      if (!isNaN(idx)) temuAIOptimizeTitles(idx);
    }
    // v11.1.0: per-row expand/collapse (chevron button, ya collapsed row kahin bhi click karein)
    const rowToggleBtn = e.target.closest('.tck-row-toggle');
    if (rowToggleBtn) {
      const idx = +rowToggleBtn.dataset.i;
      const it = TemuCheck?.items?.[idx];
      const isCollapsedNow = rowToggleBtn.closest('.tck-row')?.classList.contains('tck-collapsed');
      if (it) { it._uiCollapsed = !isCollapsedNow; temuCheckSync(); }
    } else {
      const collapsedRow = e.target.closest('.tck-row.tck-collapsed');
      if (collapsedRow && !e.target.closest('input, select, button, label, .tck-chk')) {
        const idx = +collapsedRow.dataset.i;
        const it = TemuCheck?.items?.[idx];
        if (it) { it._uiCollapsed = false; temuCheckSync(); }
      }
    }
    if (e.target.closest('#tgGeminiTestBtn')) {
      temuTestGeminiConnection();
    }
    if (e.target.closest('#tgResetDefaultKeysBtn')) {
      const inp = $('tgGeminiKey');
      if (inp) {
        inp.value = DEFAULT_GROQ_KEYS.join('\n');
        const aiSt = $('tgGeminiStatus');
        if (aiSt) {
          aiSt.textContent = `🟢 ${DEFAULT_GROQ_KEYS.length} Groq Keys Active (Auto-Failover ON)`;
          aiSt.className = 'temu-inline-msg ok';
        }
        toast(`Loaded ${DEFAULT_GROQ_KEYS.length} Groq keys! "Save settings" click karein.`, 'ok');
      }
    }
    if (e.target.closest('#tgToggleKeyVis')) {
      const inp = $('tgGeminiKey');
      if (inp) {
        if (inp.tagName === 'TEXTAREA') {
          inp.style.webkitTextSecurity = (inp.style.webkitTextSecurity === 'none' || !inp.style.webkitTextSecurity) ? 'disc' : 'none';
        } else {
          inp.type = inp.type === 'password' ? 'text' : 'password';
        }
      }
    }
    if (e.target.closest('#temuToggleQuickStrip')) {
      const bar = $('tckQuickStripBar');
      if (bar) {
        bar.hidden = !bar.hidden;
        if (!bar.hidden) $('tckQuickWordInput')?.focus();
      }
    }
    if (e.target.closest('#tckQuickStripClose')) {
      const bar = $('tckQuickStripBar');
      if (bar) bar.hidden = true;
    }
    if (e.target.closest('#tckQuickWordBtn')) {
      const inp = $('tckQuickWordInput');
      const word = inp?.value?.trim();
      if (!word) { toast('Lafz likhein jo remove karna hai', 'warn'); return; }
      const cnt = temuCleanTitlesInReview(word);
      temuAddWords([word]);
      const curCfg = temuGetCfg();
      if (curCfg && Array.isArray(curCfg.title_remove_words) && !curCfg.title_remove_words.some(w => w.toLowerCase() === word.toLowerCase())) {
        curCfg.title_remove_words.push(word);
        temuSaveCfg(curCfg);
      }
      toast(`✂️ "${word}" ${cnt} titles se strip kar diya aur saved list mein shamil hua!`, 'ok');
    }
    if (e.target.closest('#temuSheetBtn')) $('temuSheetFile')?.click();
    if (e.target.closest('#temuDashTarget')) { /* v9.9.0: input click — koi action nahi */ }
    if (e.target.closest('#temuHistClear')) (async () => { if (!confirm('Temu upload history clear karein?')) return; await new Promise(r => chrome.storage.local.set({ temuUploadHistory: [] }, r)); temuRenderHistory(); })();
    const stFilterBtn = e.target.closest('#temuHistStoreFilters .thist-store-pill');
    if (stFilterBtn) {
      TemuHistStoreFilter = stFilterBtn.dataset.sfilter;
      temuRenderHistory();
      return;
    }
    const statFilterBtn = e.target.closest('#temuHistStatusFilters .thist-status-pill');
    if (statFilterBtn) {
      TemuHistStatusFilter = statFilterBtn.dataset.status;
      document.querySelectorAll('#temuHistStatusFilters .thist-status-pill').forEach(b => b.classList.toggle('active', b === statFilterBtn));
      temuRenderHistory();
      return;
    }
    if (e.target.closest('#temuHistSearchClear')) {
      const inp = $('temuHistSearch');
      if (inp) inp.value = '';
      const clr = $('temuHistSearchClear');
      if (clr) clr.hidden = true;
      TemuHistSearchQuery = '';
      temuRenderHistory();
      return;
    }
    if (e.target.closest('#temuHistExportAll')) (async () => {
      const list = await temuHistGet();
      if (!list.length) { toast('Export karne ke liye koi history nahi', 'warn'); return; }
      const rows = [['Date', 'Store', 'Kind', 'Confirmed', 'Upload ID', 'Added', 'Errors', 'Source', 'SKU', 'Title', 'Price', 'URL']];
      list.forEach(h => {
        const d = new Date(h.t).toISOString().slice(0, 19).replace('T', ' ');
        if (!h.items || !h.items.length) {
          rows.push([d, h.store || '', h.kind || '', h.confirmed ? 'Yes' : 'No', h.uploadId || '', h.added ?? '', h.errors ?? '', h.source || '', '', '', '', '']);
        } else {
          h.items.forEach(it => {
            rows.push([d, h.store || '', h.kind || '', h.confirmed ? 'Yes' : 'No', h.uploadId || '', h.added ?? '', h.errors ?? '', h.source || '', it.sku || '', it.title || '', it.base || '', it.url || '']);
          });
        }
      });
      const csvContent = '\uFEFF' + rows.map(r => r.map(v => '"' + String(v ?? '').replace(/"/g, '""') + '"').join(',')).join('\n');
      zhSaveBlob(new Blob([csvContent], { type: 'text/csv' }), `temu_all_uploads_history_${new Date().toISOString().slice(0, 10)}.csv`);
      toast('Full upload history downloaded as CSV', 'ok');
      return;
    })();
    // Categories Search Clear & Quick Add
    if (e.target.closest('#temuCatSearchClear')) {
      const inp = $('temuCatSearch');
      if (inp) inp.value = '';
      const clr = $('temuCatSearchClear');
      if (clr) clr.hidden = true;
      TemuCatSearchQuery = '';
      temuRenderProfiles();
      return;
    }
    if (e.target.closest('#temuCatAddToggle')) {
      temuCatFormReset();
      const form = $('temuCatForm');
      if (form) {
        form.scrollIntoView({ behavior: 'smooth', block: 'start' });
        $('tcName')?.focus();
      }
      return;
    }
    // Settings Sub-Nav Jump
    const snavPill = e.target.closest('.temu-snav-pill');
    if (snavPill) {
      e.preventDefault();
      const targetId = snavPill.getAttribute('href');
      const targetEl = targetId ? document.querySelector(targetId) : null;
      if (targetEl) {
        targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
        document.querySelectorAll('.temu-snav-pill').forEach(p => p.classList.toggle('active', p === snavPill));
      }
      return;
    }
    // Settings Safe Defaults Reset
    if (e.target.closest('#tgResetDefaults')) {
      if (!confirm('Default safe settings restore karein?\n\n• Price ×: 5\n• List price ×: 1.25\n• Min price: $60\n• Min Profit: $3\n• ≥2lb Buffer: $2\n• Auto .99 Rounding: ON\n• Weight: 1.4 lb (7.5×5.2×1.5 in)')) return;
      if ($('tgPx2')) $('tgPx2').value = '5';
      if ($('tgPx')) $('tgPx').value = '5';
      if ($('tgListPx')) $('tgListPx').value = '1.25';
      if ($('tgMinPx')) $('tgMinPx').value = '60';
      if ($('tgMaxPx')) $('tgMaxPx').value = '400';
      if ($('tgQtyMin')) $('tgQtyMin').value = '250';
      if ($('tgQtyMax')) $('tgQtyMax').value = '500';
      if ($('tgMinProfit2')) $('tgMinProfit2').value = '3';
      if ($('tgMinProfit')) $('tgMinProfit').value = '3';
      if ($('tgHeavyBuffer2')) $('tgHeavyBuffer2').value = '2';
      if ($('tgHeavyBuffer')) $('tgHeavyBuffer').value = '2';
      if ($('tgRound992')) $('tgRound992').checked = true;
      if ($('tgRound99')) $('tgRound99').checked = true;
      if ($('tgW')) $('tgW').value = '1.4';
      if ($('tgL')) $('tgL').value = '7.5';
      if ($('tgWd')) $('tgWd').value = '5.2';
      if ($('tgH')) $('tgH').value = '1.5';
      if ($('tgMaxW')) $('tgMaxW').value = '8';
      if ($('tgSkipListed')) $('tgSkipListed').checked = true;
      if ($('tgSmartVar')) $('tgSmartVar').checked = true;
      if ($('tgSmartWeight')) $('tgSmartWeight').checked = true;
      if ($('tgAutoFix')) $('tgAutoFix').checked = true;
      if ($('tgBgUpload')) $('tgBgUpload').checked = true;
      if ($('tgWords')) $('tgWords').value = "Amazon, Amazon.com, Walmart, Sam's Club, priced per pound, Prime, FSA Eligible, Best Seller";
      temuRenderWordChips();
      $('tgSaveBtn')?.click();
      toast('Safe defaults restored & saved!', 'ok');
      return;
    }
    if (e.target.closest('#tcSaveBtn')) temuSaveProfileFromForm();
    if (e.target.closest('#tcCancelBtn')) { temuCatFormReset(); temuCatMsg(''); }
    if (e.target.closest('#tcSmartAutoBtn')) {
      const name = $('tcName')?.value?.trim();
      temuAutoFillCategory(name);
    }
    if (e.target.closest('#tcFetchTemuTabBtn')) {
      temuFetchCategoryFromTab();
    }
    if (e.target.closest('#tcImportTplBtn')) {
      const fi = $('tcImportTplFile');
      if (fi && !fi.dataset.bound) {
        fi.dataset.bound = '1';
        fi.addEventListener('change', evt => {
          const file = evt.target.files?.[0];
          if (file) temuImportCategoryFromTemplate(file);
          evt.target.value = '';
        });
      }
      fi?.click();
    }
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
    if (e.target.closest('#temuStoreAddBtn')) (async () => {
      const name = prompt('Store ka naam (bilkul wahi jo Temu Seller Center mein upar dikhta hai, e.g. HQ TWO):', TemuDetectedMall || '');
      if (!name || !name.trim()) return;
      const stores = temuStores();
      if (!stores[name.trim()]) stores[name.trim()] = { templateB64: '', templateName: '', config: null };
      if ((await temuSaveStores(stores, name.trim())) === true) { temuRenderStoreBar(); temuUpdateTplStatus(); temuRenderProfiles(); toast(`Store added: ${name.trim()}`, 'ok'); }
    })();
    if (e.target.closest('#temuStoreDelBtn')) (async () => {
      const n = temuActiveStoreName(); if (!n) return;
      if (!confirm(`Store "${n}" (template + settings) delete karein?`)) return;
      const stores = temuStores(); delete stores[n];
      if ((await temuSaveStores(stores, Object.keys(stores)[0] || '')) === true) { temuRenderStoreBar(); temuUpdateTplStatus(); temuRenderProfiles(); }
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
      { const mp = parseFloat($('tgMinPx')?.value); cfg.price_min = isFinite(mp) && mp >= 0 ? mp : 0; }
      { const mx = parseFloat($('tgMaxPx')?.value); cfg.price_max = isFinite(mx) && mx > 0 ? mx : 0; } // v9.12.3
      { const a = parseInt($('tgQtyMin')?.value, 10), b = parseInt($('tgQtyMax')?.value, 10);
        if (a > 0 && b >= a) { cfg.quantity_min = a; cfg.quantity_max = b; } }
      { const mw = num($('tgMaxW')?.value); if (mw) cfg.max_weight_lb = mw; }
      { const minProf = parseFloat($('tgMinProfit2')?.value ?? $('tgMinProfit')?.value); if (isFinite(minProf) && minProf >= 0) cfg.min_profit_dollar = minProf; }
      { const heavyB = parseFloat($('tgHeavyBuffer2')?.value ?? $('tgHeavyBuffer')?.value); if (isFinite(heavyB) && heavyB >= 0) cfg.heavy_shipping_buffer = heavyB; }
      { const r99 = $('tgRound992') ? $('tgRound992').checked : ($('tgRound99') ? $('tgRound99').checked : true); cfg.price_round_to_99 = !!r99; }
      cfg.title_remove_words = ($('tgWords')?.value || '').split(',').map(x => x.trim()).filter(Boolean);
      cfg.skip_listed = !!$('tgSkipListed')?.checked;
      cfg.smart_variations = !!$('tgSmartVar')?.checked;
      cfg.upload_in_background = !!$('tgBgUpload')?.checked;
      cfg.smart_weight = !!$('tgSmartWeight')?.checked;
      cfg.packaging = { sku_type: $('tgSkuType')?.value || '', individually_packed: $('tgIndPacked')?.value || '', total_packaging_quantity: ($('tgPackQty')?.value || '').trim(), packaging_unit: $('tgPackUnit')?.value || '' };
      cfg.auto_fix_after_upload = !!$('tgAutoFix')?.checked;
      { const br = $('tgBrandRules'); if (br) cfg.brand_rules = temuBrandRulesFromText(br.value); } // v9.11.0
      { const vv = ($('tgVarValues')?.value || '').split(',').map(x => x.trim()).filter(Boolean); if (vv.length) cfg.simple_variation_values = vv; }
      cfg.gemini_api_key = ($('tgGeminiKey')?.value || '').trim();
      cfg.ai_keep_approved_brands = !!$('tgKeepApprovedBrands')?.checked;
      cfg.ai_strip_claims = !!$('tgStripClaims')?.checked;
      cfg.ai_banned_words = ($('tgBannedWords')?.value || '').trim();
      cfg.ai_custom_instructions = ($('tgAiInstructions')?.value || '').trim();
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
  $('tgGeminiKey')?.addEventListener('input', () => {
    const raw = ($('tgGeminiKey')?.value || '').trim();
    const keys = temuGetAiKeys(raw);
    const aiSt = $('tgGeminiStatus');
    if (aiSt) {
      if (keys.length) {
        aiSt.textContent = `🟢 ${keys.length} Groq Keys Active (Auto-Failover ON)`;
        aiSt.className = 'temu-inline-msg ok';
      } else {
        aiSt.textContent = '✗ No keys entered';
        aiSt.className = 'temu-inline-msg bad';
      }
    }
  });

  // Restore Dual-View switchers
  setTemuReviewViewMode(localStorage.getItem('zh_tck_view') || 'card');
  setMasterLibraryViewMode(localStorage.getItem('zh_lib_view') || 'card');
  initThumbnailHoverZoom();
}

// ── Floating Thumbnail Hover Image Zoom ──
function initThumbnailHoverZoom() {
  const popup = $('zhImgZoomPopup');
  const zoomImg = $('zhImgZoomImg');
  const zoomTitle = $('zhImgZoomTitle');
  if (!popup || !zoomImg) return;

  function positionZoomPopup(e) {
    const pad = 14;
    const w = 224;
    const h = 240;
    let left = e.clientX + pad;
    let top = e.clientY - 60;
    if (left + w > window.innerWidth) left = e.clientX - w - pad;
    if (left < 6) left = 6;
    if (top + h > window.innerHeight) top = window.innerHeight - h - pad;
    if (top < 6) top = 6;
    popup.style.left = `${left}px`;
    popup.style.top = `${top}px`;
  }

  document.addEventListener('mouseover', (e) => {
    const thumb = e.target.closest('.tck-thumb, .row-thumb-img, .bulk-tab-thumb, .bulk-thumb-img');
    if (!thumb) return;
    const src = thumb.src || thumb.getAttribute('src');
    if (!src || src.startsWith('data:image/svg')) return;
    zoomImg.src = src;
    const row = thumb.closest('.tck-row, .master-row, .bulk-tab-row');
    const title = thumb.getAttribute('alt') ||
      row?.querySelector('.tck-title-inp')?.value ||
      row?.querySelector('.master-row-title, .bulk-tab-title')?.textContent ||
      '';
    if (zoomTitle) {
      zoomTitle.textContent = title.trim();
      zoomTitle.style.display = title.trim() ? '-webkit-box' : 'none';
    }
    popup.hidden = false;
    positionZoomPopup(e);
  });

  document.addEventListener('mousemove', (e) => {
    if (!popup.hidden) {
      positionZoomPopup(e);
    }
  });

  document.addEventListener('mouseout', (e) => {
    const thumb = e.target.closest('.tck-thumb, .row-thumb-img, .bulk-tab-thumb, .bulk-thumb-img');
    if (thumb) {
      popup.hidden = true;
    }
  });
}

try { document.addEventListener('DOMContentLoaded', initTemuExport); if (document.readyState !== 'loading') initTemuExport(); } catch (_) {}

