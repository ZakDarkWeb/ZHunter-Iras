// ============================================================
// ZHunter PRO v9.7.5 — Content Script
// ============================================================
// Fixes vs 7.6.0:
//   • Issue 1: Correct price extraction — reads full price string
//     (whole + fractional) directly from DOM; JSON harvest no longer
//     picks up unrelated numeric price fields (uses currency-bearing
//     string fields only when they originate from offer/price keys).
//   • Issue 2: Stronger isBadImage() — blocks logos, platform chrome,
//     UI sprites, tiny icons, header/footer/nav/banner images. DOM-
//     position-aware filtering rejects images outside the main product
//     gallery container.
//   • Issue 3: Universal e-commerce scraper covers Flipkart, Noon,
//     WooCommerce, BigCommerce, and any site exposing schema.org/JSON-LD
//     Product or Offer markup — no per-site hardcoding needed.
//   • Issue 4: Gallery-scoped image collection — images are collected
//     only from the main product display area (hero + thumbnails).
//     Description sections, review carousels, upsell grids, footer
//     banners are all excluded.
// ============================================================
if (!window.__zhunterContentLoaded) {
window.__zhunterContentLoaded = true;

'use strict';

const IMG_CAP = 15;
const VID_CAP = 12;

// FIX: Cache the harvestInlineJson result per page load.
// On complex pages (Next.js/Walmart/Amazon) the inline scripts can be 500 KB–2 MB.
// Re-parsing them on every SCRAPE_PAGE message caused 200–500 ms freezes.
let _harvestCache = null;

// ── Basics ──────────────────────────────────────────────────
const absUrl = u => { try { return new URL(u, location.href).href; } catch (_) { return u || ''; } };
const host   = () => { try { return location.hostname.toLowerCase().replace(/^www\./, ''); } catch (_) { return ''; } };

// ── Price Cleaner ────────────────────────────────────────────
// Strips discount noise and returns the FIRST standalone price token found.
function cleanPriceText(raw) {
  if (!raw || typeof raw !== 'string') return '';
  let s = raw
    .replace(/[-−]\s*\d{1,3}\s*%/g, '')
    .replace(/\d{1,3}\s*%\s*off/gi, '')
    .replace(/\(\s*\d{1,3}\s*%\s*\)/g, '')
    .replace(/save\s+\$?\d[\d.,]*/gi, '')
    .replace(/save\s+\d{1,3}\s*%/gi, '')
    .replace(/\bdiscount\b/gi, '')
    .replace(/list\s*price\s*:?/gi, '')
    .replace(/\bwas\s*:?\s*/gi, '')
    .replace(/\bfrom\s*:?\s*/gi, '')
    .replace(/typical\s*price\s*:?/gi, '')
    .replace(/original\s*price\s*:?/gi, '')
    .trim();

  const patterns = [
    /[$£€¥₹₩]\s*\d+(?:[.,]\d{3})*(?:[.,]\d{1,2})?/,
    /\d+(?:[.,]\d{3})*(?:[.,]\d{1,2})?\s*[$£€¥₹₩]/,
    /(?:USD|CAD|AUD|GBP|EUR|PKR|INR)\s*\d+(?:[.,]\d{3})*(?:[.,]\d{1,2})?/i,
    /\d+(?:[.,]\d{3})*(?:[.,]\d{1,2})?/
  ];
  for (const p of patterns) {
    const m = s.match(p);
    if (m && /\d/.test(m[0])) return m[0].replace(/\s+/g, '');
  }
  return '';
}

function ensureCurrency(p, symbol) {
  if (!p) return '';
  // Already has a currency symbol or code — return as-is
  if (/^[$£€¥₹₩]/.test(p)) return p;
  if (/^(USD|CAD|AUD|GBP|EUR|PKR|INR)/i.test(p)) return p;
  if (/[$£€¥₹₩]$/.test(p)) return p;
  // Use detected symbol from page, or fall back to $
  return `${symbol || '$'}${p}`;
}

// Detect the currency symbol used on this page (first occurrence wins)
function detectPageCurrencySymbol() {
  const priceEls = document.querySelectorAll(
    '[itemprop="price"], [data-price], [class*="price"], [id*="price"], ' +
    '.a-price, .Price, .price'
  );
  for (const el of priceEls) {
    const txt = el.textContent || '';
    const m = txt.match(/[$£€¥₹₩]/);
    if (m) return m[0];
  }
  // Fallback: look in meta tags
  const meta = document.querySelector('meta[property="product:price:currency"], meta[itemprop="priceCurrency"]');
  if (meta?.content) {
    const map = { USD: '$', GBP: '£', EUR: '€', JPY: '¥', INR: '₹', KRW: '₩', CAD: 'CA$', AUD: 'AU$' };
    return map[meta.content.toUpperCase()] || meta.content + ' ';
  }
  return '$';
}

// ── Image quality / dedup helpers ────────────────────────────
function normalizeImg(rawUrl) {
  try {
    const u = new URL(absUrl(rawUrl));
    const h = u.hostname.toLowerCase();

    ['width', 'height', 'w', 'h', 'size', 'quality', 'q', '_v', 'v',
     'fmt', 'wid', 'hei', 'fit'].forEach(p => u.searchParams.delete(p));

    if (/(media-amazon\.com|ssl-images-amazon\.com|images-na\.|amazon\.[a-z.]+)/i.test(h)) {
      // FIX: Replace ALL size tokens with SL1500 (highest standard CDN quality).
      // Previously this stripped the token entirely, which can result in Amazon
      // serving a low-res default. SL1500 guarantees 1500px longest side.
      // Global flag handles chained tokens like ._AC_US40_._SX300_.
      let path = u.pathname.replace(/\._[A-Z0-9_,]{2,}_\./gi, '._AC_SL1500_.');
      u.pathname = path;
      return u.href;
    }
    if (/walmartimages\.com|walmart\.com/i.test(h)) {
      ['odnHeight', 'odnWidth', 'odnBg'].forEach(p => u.searchParams.delete(p));
      return u.href;
    }
    if (/scene7\.samsclub\.com|samsclub\.com|samsclubimages\.com/i.test(h)) {
      if (/samsclubimages\.com/i.test(h) && !/scene7/i.test(h)) {
        ['odnHeight', 'odnWidth', 'odnBg', 'wid', 'hei'].forEach(p => u.searchParams.delete(p));
      } else {
        u.searchParams.set('wid', '2000');
        u.searchParams.set('hei', '2000');
        u.searchParams.set('fmt', 'jpg');
      }
      return u.href;
    }
    if (/faire-cdn\.com|cdn\.faire\.com|faire\.com/i.test(h)) {
      let path = u.pathname.replace(/\/(w|h|c|q|f)_[^/]+\/?/gi, '/');
      path = path.replace(/\/{2,}/g, '/');
      u.pathname = path;
      return u.href;
    }
    if (/alicdn\.com|aliexpress|alibaba/i.test(h)) {
      let path = u.pathname.replace(/_\d+x\d+(?=\.[a-z]+$)/i, '_960x960');
      u.pathname = path;
      return u.href;
    }
    if (/ebayimg\.com|ebaystatic\.com|ebay\./i.test(h)) {
      let path = u.pathname.replace(/s-l\d+/g, 's-l1600');
      u.pathname = path;
      return u.href;
    }
    if (/cdn\.shopify\.com|shopifycdn|myshopify\.com/i.test(h)) {
      let path = u.pathname.replace(/_(\d+)x(\d+)?(?=\.[a-z]+$)/i, '_1200x');
      u.pathname = path;
      return u.href;
    }
    return u.href;
  } catch (_) { return rawUrl || ''; }
}

function canonImageKey(url) {
  try {
    const u = new URL(absUrl(url));
    let p = u.pathname;
    // Amazon: strip ALL size/quality tokens (._AC_SL1500_., ._AC_US40_., etc.)
    // Use a global replace so multiple tokens in one path are all removed.
    p = p.replace(/\._[A-Z0-9_,]+_\./gi, '.'); // first pass (handles most)
    p = p.replace(/\._[A-Z0-9_,]+_\./gi, '.'); // second pass (handles chained tokens)
    p = p.replace(/\/\d{2,4}x\d{2,4}\//g, '/');
    p = p.replace(/\/\d{2,4}x\d{2,4}(?=\.[a-z]+$)/gi, '/');
    p = p.replace(/[-_](thumb|small|medium|large|tiny|sml|lrg|hi|lo)\b/gi, '');
    p = p.replace(/[-_]\d{2,4}x\d{2,4}(?=\.[a-z]+$)/gi, '');
    p = p.replace(/_\d{2,4}(?=\.[a-z]+$)/g, '');
    // Strip query string for Amazon image CDNs (they don't affect identity)
    if (/(media-amazon\.com|ssl-images-amazon\.com|images-na\.)/i.test(u.hostname)) {
      return u.hostname + p.toLowerCase();
    }
    return u.hostname + p.toLowerCase();
  } catch (_) { return String(url || '').toLowerCase(); }
}

// ── ISSUE 2 & 4 FIX: Stronger image bad-image filter ────────
function isBadImage(url) {
  if (!url) return true;
  const s = String(url).toLowerCase();
  if (s.length < 10) return true;
  if (s.startsWith('data:image/svg') || s.endsWith('.svg')) return true;
  if (/PHN2Z/.test(s)) return true; // base64 svg

  // ── Keyword-based exclusions (expanded) ──────────────────
  if (/\b(logo|logos|sprite|sprites|favicon|avatar|placeholder|spacer|pixel|blank|loading|tracking|banner|header|footer|badge|watermark|branding|navbar|navigation|overlay|spinner|advertisement|ribbon|sticker)\b/.test(s)) return true;
  if (/\/icon\/|\/icons\/|[_-]icon[_.@-]|icon[_.@-]\d|\/nav\/|\/menu\/|\/cart\/|\/checkout\/|\/ad[-_]|payment[-_]icon|payment[-_]method|trust[-_]badge|trust[-_]seal/.test(s)) return true;
  if (/hero[-_]banner|promo[-_]banner|category[-_]banner|category[-_]image|\/department\/|\/category\/|\/brand\/|brand[-_]logo|\/circular\/|\/hero\/|\/search\/|search[-_]icon/.test(s)) return true;
  if (/\/rating\/|star[-_]rating|review[-_]star|\/social\/|social[-_]share|\/upsell\/|\/related\/|\/recommendation|\/similar\/|\/customer[-_]review|\/review[-_]image/.test(s)) return true;
  if (/\/seller\/|seller[-_]logo|\/store\/|store[-_]logo|\/gift[-_]wrap|\/delivery\/|\/shipping\//.test(s)) return true;

  if (/(^\/|\/)(1x1|2x2|3x3)\.|grey-pixel|transparent\.gif/.test(s)) return true;

  // Skip tiny icon-sized images (up to 64px)
  if (/\/\d{1,2}x\d{1,2}[./]/.test(s)) return true;
  if (/[-_](16|24|32|48|64)x\d{2,3}[._]/.test(s)) return true;

  // Amazon non-product
  if (/ssl-images-amazon\.com/i.test(s) && /\/G\/|\/transparent\.|\/buttons?\/|\/ui\/|\/nav\//.test(s)) return true;

  // Walmart non-product — block spark logo, app/delivery/store icons, badges, category images
  if (/walmartimages\.com/i.test(s) && /\/spark\/|\/store\/|\/logo\/|\/icon\/|\/badge\/|\/footer\/|\/header\/|\/delivery\/|\/app\/|\/promo\/|\/circular\/|\/dept\/|\/category\/|\/brand\/|\/nav\/|\/hero\/|\/banner\//.test(s)) return true;
  // Walmart image filenames that are clearly UI chrome
  if (/walmartimages\.com/i.test(s) && /spark[-_]logo|walmart[-_]logo|wm[-_]logo|wm[-_]app|delivery[-_]icon|pickup[-_]icon|store[-_]icon/.test(s)) return true;
  // Walmart inline JSON image patterns — small base64-encoded images from JSON are always UI
  if (/walmartimages\.com/i.test(s) && /\/\d{2,3}x\d{2,3}[?/]/.test(s)) return true;

  // v8.4.0: tracking pixels / analytics beacons / non-product marketplace assets
  if (/xlgmedia\.com|\/analytics\.gif|\/beacon|\/pixel\.|doubleclick|scorecardresearch|\.gif(\?|$)/.test(s)) return true;
  // Walmart & Sam's "dfw"/"dfwrs" = seller marketing badges & rich-content tiles (not product photos); richmedia = 360° spin frames
  if (/(walmartimages|samsclubimages)\.com\/(dfw|dfwrs)\//.test(s)) return true;
  if (/i5-richmedia\.walmartimages\.com|_360_store_merchant_/.test(s)) return true;
  // Marketplaces (Temu) reject webp — drop it when a jpg/png source is the norm
  if (/\.webp(\?|$)/.test(s) && /(walmartimages|samsclubimages|media-amazon)\.com/.test(s)) return true;

  // Sam's Club non-product
  if (/samsclub\.com|samsclubimages\.com/i.test(s) && /\/category\/|\/banner\/|\/brand\/|\/circular\/|\/hero\/|\/nav\/|\/icon\/|\/logo\//.test(s)) return true;

  // Temu non-product (platform chrome / tracking pixels)
  if (/temu\.com/i.test(s) && /\/platform\/|\/icon\/|\/logo\/|\/badge\/|\/header\/|\/nav\//.test(s)) return true;

  // Faire non-product (brand logos, seller avatars)
  if (/faire\.com|faire-cdn\.com/i.test(s) && /brand[-_]logo|seller[-_]logo|\/avatar\/|\/logo\/|\/icon\/|\/badge\//.test(s)) return true;

  return false;
}

// ── DOM-context bad-image check ──────────────────────────────
// Returns true if the <img> element sits inside a non-product DOM region.
function isBadImageElement(imgEl) {
  if (!imgEl) return false;
  const badParent = imgEl.closest(
    'header, nav, footer, ' +
    '[class*="logo"], [id*="logo"], ' +
    '[class*="navbar"], [id*="navbar"], ' +
    '[class*="header"], [id*="header"], ' +
    '[class*="footer"], [id*="footer"], ' +
    '[class*="nav-"], [id*="nav-"], ' +
    '[class*="site-nav"], [class*="site-header"], ' +
    '[class*="breadcrumb"], [class*="Breadcrumb"], ' +
    '[class*="badge"], [class*="trust-badge"], ' +
    '[class*="payment-method"], [class*="PaymentMethod"], ' +
    '[class*="seller-info"], [class*="SellerInfo"], ' +
    '[class*="store-logo"], [class*="StoreLogo"], ' +
    '[class*="brand-logo"], [class*="BrandLogo"]'
  );
  return !!badParent;
}

// ── ISSUE 4 FIX: Find the main product gallery container ────
// Returns the DOM element that wraps the primary product image area,
// or null if we cannot confidently identify one.
function findProductGalleryContainer() {
  // Priority-ordered CSS selectors for product image containers
  const gallerySelectors = [
    // Amazon
    '#imageBlock_feature_div',
    '#imageBlock',
    '#img-canvas',
    // Walmart / Sam's Club live vertical carousels
    '[data-testid="vertical-carousel-container"]',
    '[data-testid="vertical-hero-carousel"]',
    '[data-testid="hero-image-container"]',
    '[data-testid="item-page-vertical-carousel-hero-image-button"]',
    '[data-testid="media-thumbnail"]',
    '[data-testid="zoom-image"]',
    '[data-testid="zoom-panel"]',
    '[data-automation-id="product-media"]',
    '[data-testid="product-media"]',
    '.prod-hero-image-carousel-container',
    // Sam's Club
    '[data-testid="product-image-container"]',
    '.sc-image-viewer',
    '[class*="ImageViewer"]',
    // Faire
    '[data-testid*="product-image"]',
    '[class*="ProductImages"]',
    '[class*="productImages"]',
    // AliExpress
    '.pdp-comp-product-image',
    '[class*="gallery--wrap"]',
    // eBay
    '#vi-main-img-fs',
    '.ux-image-carousel',
    '[class*="image-carousel"]',
    // Shopify / WooCommerce generic
    '.product__media-wrapper',
    '.woocommerce-product-gallery',
    '[class*="product-gallery"]',
    '[class*="ProductGallery"]',
    '[class*="product-images"]',
    '[class*="ProductImages"]',
    // Temu
    '[class*="goods-gallery"]',
    '[class*="GoodsGallery"]',
    // Daraz / Noon / Flipkart / Lazada
    '.pdp-gallery',
    '.product-image-section',
    '[class*="ImageGallery"]',
    '[class*="image-gallery"]',
    '.fk-imgbox', // Flipkart
    '.EKFha-', // Flipkart
    '[class*="product-image"]',
    // Etsy
    '.listing-page-image-carousel',
    // Generic fallback — look for any element that contains multiple images
    // and is positioned in the upper portion of the page
    '[class*="media-gallery"]',
    '[class*="MediaGallery"]',
    '[class*="photo-gallery"]',
    '[class*="PhotoGallery"]',
    '[class*="carousel"][class*="image"]',
    '[class*="slider"][class*="product"]',
  ];

  for (const sel of gallerySelectors) {
    const el = document.querySelector(sel);
    if (el) return el;
  }

  // Heuristic fallback: find the first element that contains
  // ≥2 images all with naturalWidth > 150, is within the top 60% of the page,
  // and is not inside a recommendations / reviews / footer section.
  const badAncestorSel =
    '[class*="recommend"], [class*="similar"], [class*="related"], ' +
    '[class*="review"], [class*="footer"], [class*="widget"], ' +
    '[class*="sponsored"], [id*="recommend"], [id*="related"]';

  const candidates = Array.from(document.querySelectorAll(
    'figure, [class*="gallery"], [class*="product"], [class*="image-wrap"], [class*="media-wrap"]'
  )).filter(el => {
    if (el.closest(badAncestorSel)) return false;
    const imgs = el.querySelectorAll('img');
    if (imgs.length < 1) return false;
    const rect = el.getBoundingClientRect();
    if (rect.top < 0 || rect.top > window.innerHeight * 2) return false; // too far down
    return true;
  });

  return candidates[0] || null;
}

// Collect images from within a DOM scope (gallery container or full document)
function collectScopedImages(scope) {
  const out = [];
  const imgs = (scope || document).querySelectorAll('img');
  imgs.forEach(img => {
    if (isBadImageElement(img)) return;
    const src = pickImgSrc(img);
    if (src) out.push(src);
  });
  return out;
}

function dedupeImages(arr) {
  const seen = new Set();
  const out = [];
  for (const raw of arr) {
    if (!raw || typeof raw !== 'string') continue;
    const norm = normalizeImg(raw);
    if (isBadImage(norm)) continue;
    const key = canonImageKey(norm);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(norm);
  }
  return out;
}

// ── Video helpers ───────────────────────────────────────────
const VID_REGEX = /\.(mp4|webm|m3u8|mov|m4v)([\?#]|$)/i;
const YT_REGEX  = /(youtube\.com\/(watch|embed|shorts|live)|youtu\.be\/)/i;

function ytWatch(url) {
  try {
    const u = new URL(url, location.href);
    const h = u.hostname.toLowerCase();
    let id = '';
    if (h.includes('youtu.be')) id = u.pathname.split('/').filter(Boolean)[0] || '';
    if (h.includes('youtube.com')) {
      id = u.searchParams.get('v') || '';
      const parts = u.pathname.split('/').filter(Boolean);
      for (const k of ['embed', 'shorts', 'live']) {
        const i = parts.indexOf(k);
        if (!id && i >= 0 && parts[i + 1]) id = parts[i + 1];
      }
    }
    return id ? `https://www.youtube.com/watch?v=${id}` : url;
  } catch (_) { return url || ''; }
}

function isVideoUrl(s) {
  if (!s || typeof s !== 'string') return false;
  if (s.startsWith('data:') || s.startsWith('blob:')) return false;
  if (!(VID_REGEX.test(s) || YT_REGEX.test(s))) return false;
  // Reject placeholders like "https://...mp4" that appear in page scripts.
  if (/^https?:/i.test(s)) {
    try { const h = new URL(s).hostname; if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(h)) return false; } catch { return false; }
  }
  return true;
}

function dedupeVideos(arr) {
  const seen = new Set();
  const out = [];
  for (const raw of arr) {
    if (!isVideoUrl(raw)) continue;
    let s = absUrl(raw);
    if (YT_REGEX.test(s)) s = ytWatch(s);
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

// ── DOM image collection ────────────────────────────────────
function pickImgSrc(img) {
  return (
    img.getAttribute('data-old-hires') ||
    img.getAttribute('data-zoom-image') ||
    img.getAttribute('data-image') ||
    img.getAttribute('data-large-image') ||
    img.getAttribute('data-src') ||
    img.getAttribute('data-lazy-src') ||
    img.getAttribute('data-original') ||
    img.src ||
    img.getAttribute('src') ||
    (img.getAttribute('srcset') || '').split(',').pop().trim().split(/\s+/)[0] ||
    ''
  );
}

function collectImagesBySelector(selector, scope) {
  const out = [];
  (scope || document).querySelectorAll(selector).forEach(img => {
    if (isBadImageElement(img)) return;
    const s = pickImgSrc(img);
    if (s && !isBadImage(s)) out.push(s);
  });
  return out;
}

function pickAmazonDynamic(img) {
  const raw = img.getAttribute('data-a-dynamic-image');
  if (!raw || !raw.startsWith('{')) return '';
  try {
    const parsed = JSON.parse(raw);
    const entries = Object.entries(parsed);
    entries.sort((a, b) => (b[1]?.[0] || 0) - (a[1]?.[0] || 0));
    return entries[0]?.[0] || '';
  } catch (_) { return ''; }
}

// Live marketplace gallery collector. Walmart and Sam's Club often render
// product media after the initial HTML response, using data-* attributes or
// srcset instead of a stable JSON payload.
function collectLiveMarketplaceImages(platform) {
  const out = [];
  const seen = new Set();
  const add = raw => {
    if (!raw || typeof raw !== 'string') return;
    const value = raw.trim().replace(/\\\//g, '/');
    if (!/^https?:|^\//i.test(value)) return;
    const abs = absUrl(value);
    if (isBadImage(abs)) return;
    const normalized = normalizeImg(abs);
    const key = canonImageKey(normalized);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(normalized);
  };
  const addSrcset = raw => {
    if (!raw) return;
    const candidates = String(raw).split(',').map(part => {
      const bits = part.trim().split(/\s+/);
      const descriptor = bits[1] || '';
      const score = descriptor.endsWith('w') ? parseFloat(descriptor) : parseFloat(descriptor) * 1000 || 0;
      return { url: bits[0], score };
    }).filter(item => item.url);
    candidates.sort((a, b) => b.score - a.score).forEach(item => add(item.url));
  };
  const selectors = platform === 'walmart' ? [
    '[data-testid="vertical-carousel-container"]',
    '[data-testid="vertical-hero-carousel"]',
    '[data-testid="item-page-vertical-carousel-hero-image-button"]',
    '[data-testid="hero-image-container"]',
    '[data-testid="hero-image"]',
    '[data-testid="media-thumbnail"]',
    '[data-testid="zoom-image"]',
    '[data-testid="zoom-panel"]',
    '[data-automation-id="product-media"]',
    '.prod-hero-image-carousel-container'
  ] : [
    '[data-testid="vertical-carousel-container"]',
    '[data-testid="vertical-hero-carousel"]',
    '[data-testid="item-page-vertical-carousel-hero-image-button"]',
    '[data-testid="hero-image-container"]',
    '[data-testid="hero-image"]',
    '[data-testid="media-thumbnail"]',
    '[data-testid="zoom-image"]',
    '[data-testid="zoom-panel"]',
    '[data-testid="product-image-container"]',
    '[class*="ImageViewer"]',
    '[class*="sc-image"]'
  ];
  const roots = new Set();
  selectors.forEach(selector => document.querySelectorAll(selector).forEach(root => roots.add(root)));
  const scopes = roots.size ? [...roots] : [findProductGalleryContainer() || document];
  const elements = new Set();
  scopes.forEach(scope => {
    if (scope.matches?.('img, picture source, [data-image-url], [data-image-src], [data-zoom-image], [data-large-image], [data-src], [data-lazy-src], [data-original]')) elements.add(scope);
    scope.querySelectorAll(
      'img, picture source, [data-image-url], [data-image-src], [data-zoom-image], [data-large-image], [data-src], [data-lazy-src], [data-original]'
    ).forEach(el => elements.add(el));
  });
  elements.forEach(el => {
    const context = `${el.getAttribute?.('data-testid') || ''} ${el.getAttribute?.('aria-label') || ''} ${el.className || ''}`;
    if (/video|interactive-video|play-button/i.test(context) || el.closest?.('[data-testid*="video" i], [aria-label*="video" i], [class*="video" i]')) return;
    if (el.tagName === 'IMG' && isBadImageElement(el)) return;
    ['data-old-hires', 'data-zoom-image', 'data-image-url', 'data-image-src', 'data-large-image', 'data-src', 'data-lazy-src', 'data-original', 'src'].forEach(attr => add(el.getAttribute?.(attr) || ''));
    addSrcset(el.getAttribute?.('srcset') || el.getAttribute?.('data-srcset') || '');
    if (el.tagName === 'IMG') add(el.currentSrc || el.src || '');
  });
  return out;
}

// ── DOM video collection ────────────────────────────────────
function collectDomVideos() {
  const out = [];
  document.querySelectorAll('video').forEach(v => {
    out.push(v.currentSrc || v.src || v.getAttribute('src') || '');
    v.querySelectorAll('source').forEach(s => out.push(s.src || s.getAttribute('src') || ''));
  });
  document.querySelectorAll(
    'meta[property="og:video"], meta[property="og:video:url"], meta[property="og:video:secure_url"], meta[name="twitter:player"], meta[name="twitter:player:stream"]'
  ).forEach(m => out.push(m.content));
  document.querySelectorAll(
    'iframe[src*="youtube.com"], iframe[src*="youtu.be"], iframe[src*="vimeo.com"], iframe[src*="brightcove"]'
  ).forEach(f => out.push(f.src || ''));
  document.querySelectorAll('[data-video-url], [data-video-src], [data-mp4], [data-video]').forEach(el => {
    ['data-video-url', 'data-video-src', 'data-mp4', 'data-video'].forEach(a => {
      const v = el.getAttribute(a);
      if (v) out.push(v);
    });
  });
  return out;
}

// ── Deep JSON media walker ────────────────────────────────────
// ISSUE 1 FIX: Only pick up price from offer/price-typed string fields
// that already contain a currency symbol (e.g. "$29.98"), not bare numbers.
// Bare numeric prices from JSON are unreliable and cause wrong price bugs.
function walkJsonForMedia(rootJson, found) {
  const stack = [{ node: rootJson, depth: 0 }];
  while (stack.length > 0) {
    const { node: json, depth } = stack.pop();
    if (!json || depth > 12) continue;
    const d = depth + 1;
    
    if (typeof json === 'string') {
      const s = json;
      if (s.length > 8192) continue;
      if (/^https?:\/\//i.test(s)) {
        if (/\.(jpg|jpeg|png|webp|gif|avif)(\?|#|$)/i.test(s) && !isBadImage(s)) found.images.push(s);
        if (isVideoUrl(s)) found.videos.push(s);
      }
      continue;
    }
    if (Array.isArray(json)) {
      for (let i = json.length - 1; i >= 0; i--) stack.push({ node: json[i], depth: d });
      continue;
    }
    if (typeof json === 'object') {
      for (const [k, v] of Object.entries(json)) {
        if (typeof v === 'string') {
          if (!found.price && /^(price|currentPrice|salePrice|displayPrice|priceFormatted|formattedPrice|currentPriceFormatted)$/i.test(k)) {
            if (/[$£€¥₹₩]/.test(v) && /\d/.test(v)) {
              const cleaned = cleanPriceText(v);
              if (cleaned) found.price = cleaned;
            }
          }
          if (/^(url|src|href|contentUrl|embedUrl|videoUrl|video_url|mp4|hls|thumbnailUrl|imageUrl|image_url)$/i.test(k)) {
            if (/^https?:\/\//i.test(v)) {
              if (/\.(jpg|jpeg|png|webp|gif|avif)(\?|#|$)/i.test(v) && !isBadImage(v)) found.images.push(v);
              if (isVideoUrl(v)) found.videos.push(v);
            }
          }
        }
        stack.push({ node: v, depth: d });
      }
    }
  }
}

async function harvestInlineJson() {
  // Return cached result from this page load if available
  if (_harvestCache) return _harvestCache;

  const found = { images: [], videos: [], price: '' };
  // Dedup guard: all video pushes go through addFoundVideo() which checks this Set.
  // Prevents duplicates when Brightcove sources[] and renditions[] overlap,
  // or when the same URL appears in both __NEXT_DATA__ and an inline <script>.
  const _vidSet = new Set();
  const addFoundVideo = (v) => {
    if (!v || typeof v !== 'string') return;
    const clean = v.replace(/\\\//g, '/').trim();
    if (!clean.startsWith('http') || _vidSet.has(clean)) return;
    _vidSet.add(clean);
    found.videos.push(clean);
  };

  // ── PRODUCT IDENTITY ANCHOR ─────────────────────────────────
  // Derive a short fingerprint from the current page URL path so we can
  // reject images that belong to unrelated products embedded in the same
  // JSON blob (e.g. "Customers also bought" carousels on Amazon/Walmart).
  //
  // Strategy: extract the last meaningful path segment(s) that are likely
  // the product identifier (ASIN, item ID, SKU, etc.).
  // Images are only filtered by this key when we can reliably extract one.
  let productPathKey = '';
  try {
    const pathParts = location.pathname.split('/').filter(Boolean);
    // Amazon: /dp/ASIN or /gp/product/ASIN
    const dpIdx = pathParts.indexOf('dp');
    const gpIdx = pathParts.indexOf('product');
    if (dpIdx >= 0 && pathParts[dpIdx + 1]) productPathKey = pathParts[dpIdx + 1].toLowerCase();
    else if (gpIdx >= 0 && pathParts[gpIdx + 1]) productPathKey = pathParts[gpIdx + 1].toLowerCase();
    // Walmart: /ip/product-name/ITEM_ID
    else if (/walmart/i.test(location.hostname)) {
      const numPart = pathParts.find(p => /^\d{6,}$/.test(p));
      if (numPart) productPathKey = numPart;
    }
    // Sam's Club: /ip/product-name/ITEM_ID
    else if (/samsclub/i.test(location.hostname)) {
      const numPart = pathParts.find(p => /^\d{6,}$/.test(p));
      if (numPart) productPathKey = numPart;
    }
    // eBay: /itm/ITEM_ID
    const itmIdx = pathParts.indexOf('itm');
    if (!productPathKey && itmIdx >= 0 && pathParts[itmIdx + 1]) {
      productPathKey = pathParts[itmIdx + 1].toLowerCase();
    }
    // Generic: last all-digit segment of length 6+
    if (!productPathKey) {
      const last = [...pathParts].reverse().find(p => /^\d{6,}$/.test(p));
      if (last) productPathKey = last;
    }
  } catch (_) {}

  // Helper: does this image URL plausibly belong to the current product?
  // When we have a product key, reject images whose path contains a DIFFERENT
  // product ID of the same format (e.g. different ASIN embedded in image URL).
  function isLikelyCurrentProduct(imgUrl) {
    if (!productPathKey || productPathKey.length < 6) return true; // no key → accept all
    try {
      const path = new URL(imgUrl).pathname.toLowerCase();
      // If the key appears in the image path → definitely this product
      if (path.includes(productPathKey)) return true;
      // Amazon images embed the ASIN in their path. If there's a different
      // ASIN-like segment (10 uppercase alphanum chars) in the image path,
      // reject it — it belongs to another product.
      if (/media-amazon\.com|ssl-images-amazon/i.test(imgUrl)) {
        const asinMatch = path.match(/\/([A-Z0-9]{10})\//i);
        if (asinMatch && asinMatch[1].toLowerCase() !== productPathKey) return false;
      }
      return true;
    } catch (_) { return true; }
  }

  const nextEl = document.querySelector('script#__NEXT_DATA__');
  if (nextEl) {
    try { walkJsonForMedia(JSON.parse(nextEl.textContent || '{}'), found); } catch (_) {}
  }

  document.querySelectorAll('script[type="application/json"]').forEach(s => {
    try { walkJsonForMedia(JSON.parse(s.textContent || '{}'), found); } catch (_) {}
  });

  document.querySelectorAll('script[type="application/ld+json"]').forEach(s => {
    try {
      const parsed = JSON.parse(s.textContent || '{}');
      walkJsonForMedia(parsed, found);
    } catch (_) {}
  });

  const allScripts = Array.from(document.querySelectorAll('script:not([src])'));
  
  for (const s of allScripts) {
    const t = s.textContent || '';
    if (t.length < 200 || t.length > 2_000_000) continue;
    if (!/__PRELOADED_STATE__|__INITIAL_STATE__|__APOLLO_STATE__|window\.__/.test(t)) continue;
    (t.match(/https?:\\?\/?\\?\/?[^"'\\s]+?\.(?:mp4|webm|m3u8)(?:\?[^"'\\s]*)?/gi) || [])
      .forEach(v => addFoundVideo(v));
    (t.match(/https?:\\?\/?\\?\/?(?:www\.)?(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)[\w-]{6,}/gi) || [])
      .forEach(v => addFoundVideo(v));
    (t.match(/https?:\\?\/?\\?\/?[^"'\\s]*brightcove[^"'\\s]*/gi) || [])
      .forEach(v => addFoundVideo(v));
    (t.match(/https?:\\?\/?\\?\/?scene7\.samsclub\.com\/[^"'\\s]+(?:\.mp4|\/is\/content\/[^"'\\s]+)/gi) || [])
      .forEach(v => addFoundVideo(v));
  }

  // Second pass: catch Brightcove player init scripts that don't contain window.__ globals.
  // These scripts hold sources[]/renditions[] but fail the __PRELOADED_STATE__ guard above.
  for (const s of allScripts) {
    const t = s.textContent || '';
    if (t.length < 50 || t.length > 3_000_000) continue;
    if (!/brightcove|"renditions"\s*:\s*\[|"sources"\s*:\s*\[|walmartimages[^"']*\.mp4/i.test(t)) continue;
    // Brightcove sources: "src":"https://...mp4"
    for (const m of t.matchAll(/"src"\s*:\s*"(https?:[^"]+\.(?:mp4|m3u8|webm)[^"]*)"/gi))
      addFoundVideo(m[1]);
    // Brightcove renditions: "url":"https://...mp4"
    for (const m of t.matchAll(/"url"\s*:\s*"(https?:[^"]+\.(?:mp4|m3u8|webm)[^"]*)"/gi))
      addFoundVideo(m[1]);
    // Walmart CDN video URLs in any script
    for (const m of t.matchAll(/https?:\\?\/?\/?[^\s"']*walmartimages\.com[^\s"']*\.(?:mp4|m3u8)/gi))
      addFoundVideo(m[0]);
  }

  // JSON-LD offer price — only use currency-bearing string prices
  if (!found.price) {
    document.querySelectorAll('script[type="application/ld+json"]').forEach(s => {
      try {
        const root = JSON.parse(s.textContent || '{}');
        const stack = Array.isArray(root) ? [...root] : [root];
        while (stack.length) {
          const it = stack.shift();
          if (!it || typeof it !== 'object') continue;
          const offers = it.offers;
          if (offers) {
            const arr = Array.isArray(offers) ? offers : [offers];
            for (const o of arr) {
              const rawPrice = o.price || o.lowPrice;
              const currency = o.priceCurrency || o.priceSpecification?.priceCurrency || '';
              if (rawPrice !== undefined && rawPrice !== null && rawPrice !== '') {
                // Map currency code to symbol for display
                const symMap = { USD: '$', GBP: '£', EUR: '€', JPY: '¥', INR: '₹', KRW: '₩', CAD: 'CA$', AUD: 'AU$', PKR: '₨' };
                const sym = symMap[currency.toUpperCase()] || (currency ? currency + ' ' : '$');
                found.price = `${sym}${rawPrice}`.replace(/\s+/g, '');
                break;
              }
            }
          }
          if (found.price) break;
          Object.values(it).forEach(v => { if (v && typeof v === 'object') stack.push(v); });
        }
      } catch (_) {}
    });
  }

  // ── POST-HARVEST PRODUCT FILTER ────────────────────────────
  // Remove images that belong to other products embedded in the JSON
  // (related/upsell carousels, "also bought" grids, etc.)
  if (productPathKey) {
    found.images = found.images.filter(u => isLikelyCurrentProduct(u));
  }

  // Final dedup for all pushes in walkJsonForMedia
  const finalVidSet = new Set();
  const finalVids = [];
  for (const v of found.videos) {
    if (!v || typeof v !== 'string') continue;
    const clean = v.replace(/\\\//g, '/').trim();
    if (!clean.startsWith('http') || finalVidSet.has(clean)) continue;
    finalVidSet.add(clean);
    finalVids.push(clean);
  }
  found.videos = finalVids;

  _harvestCache = found; // cache for subsequent calls on this page load
  return found;
}

// ── Variants ─────────────────────────────────────────────────
function collectVariants() {
  const out = [];
  document.querySelectorAll(
    'select option, [aria-label*="option" i], [data-testid*="variant" i], ' +
    '[data-automation-id*="variant" i], [class*="variant" i], [class*="swatch" i], ' +
    'button[aria-label*="Size" i], button[aria-label*="Color" i]'
  ).forEach(el => {
    const t = (el.innerText || el.textContent || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
    if (t && t.length < 80 && !/^(select|choose|undefined|—|-)$/i.test(t) && !out.includes(t)) {
      out.push(t);
    }
  });
  return out.slice(0, 20);
}

// ── Generic price lookup ─────────────────────────────────────
function priceFromSelectors(selectors) {
  for (const sel of selectors) {
    for (const el of document.querySelectorAll(sel)) {
      const raw =
        el.getAttribute?.('content') ||
        el.getAttribute?.('aria-label') ||
        el.innerText ||
        el.textContent ||
        '';
      const c = cleanPriceText(raw);
      if (c && /\d/.test(c)) return c;
    }
  }
  return '';
}

// ── Sam's Club precise price reader (v2) ─────────────────────
// Sam's Club 2024/2025: price can be in multiple formats.
// Priority: aria-label → structured data → characteristic+mantissa → JSON-LD → script
// ── Sam's Club precise price reader (v3 — fully rewritten) ───
// Priority order: aria-label → split-price DOM → meta itemprop →
//   JSON-LD → __NEXT_DATA__ deep walk → inline script regex fallback
function readSamsClubPrice() {
  const sym = detectPageCurrencySymbol() || '$';

  // ── 1. aria-label on price wrapper elements ────────────────
  const ariaEls = document.querySelectorAll(
    'span[aria-label], [data-testid="product-price"], [data-automation-id="product-price"], ' +
    '[class*="PriceDisplay"] span[aria-label], [class*="price-display"] span[aria-label], ' +
    '[class*="sc-price"] span[aria-label], [id*="price"] span[aria-label]'
  );
  for (const el of ariaEls) {
    const raw = el.getAttribute('aria-label') || '';
    if (!raw) continue;
    const c = cleanPriceText(raw);
    if (c && /\d/.test(c)) return ensureCurrency(c, sym);
  }

  // ── 2. Split-price: characteristic + mantissa ──────────────
  const charEl = document.querySelector(
    '.Price-characteristic, [class*="Price-characteristic"], [class*="price-characteristic"], ' +
    '[class*="priceCharacteristic"], [class*="PriceCharacteristic"]'
  );
  const mantEl = document.querySelector(
    '.Price-mantissa, [class*="Price-mantissa"], [class*="price-mantissa"], ' +
    '[class*="priceMantissa"], [class*="PriceMantissa"]'
  );
  if (charEl) {
    const whole = (charEl.getAttribute('content') || charEl.innerText || charEl.textContent || '').replace(/[^0-9,]/g, '');
    const frac  = mantEl ? (mantEl.innerText || mantEl.textContent || '').replace(/[^0-9]/g, '') : '';
    if (whole) return frac ? `${sym}${whole}.${frac}` : `${sym}${whole}`;
  }

  // ── 3. itemprop="price" ────────────────────────────────────
  const itmProp = document.querySelector('[itemprop="price"]');
  if (itmProp) {
    const raw = itmProp.getAttribute('content') || itmProp.innerText || itmProp.textContent || '';
    const c = cleanPriceText(raw) || raw.trim();
    if (c && /\d/.test(c)) return ensureCurrency(c, sym);
  }

  // ── 4. JSON-LD offer price ─────────────────────────────────
  for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const root = JSON.parse(s.textContent || '{}');
      const stack = Array.isArray(root) ? [...root] : [root];
      while (stack.length) {
        const it = stack.shift();
        if (!it || typeof it !== 'object') continue;
        const o = it.offers || it.Offers;
        if (o) {
          const arr = Array.isArray(o) ? o : [o];
          for (const of_ of arr) {
            const p = of_.price || of_.lowPrice;
            if (p !== undefined && p !== null && p !== '') {
              const symMap = { USD:'$', GBP:'£', EUR:'€', JPY:'¥', INR:'₹', KRW:'₩', CAD:'CA$', AUD:'AU$' };
              const cur = of_.priceCurrency || '';
              const cs = symMap[cur.toUpperCase()] || sym;
              return `${cs}${p}`;
            }
          }
        }
        Object.values(it).forEach(v => { if (v && typeof v === 'object') stack.push(v); });
      }
    } catch (_) {}
  }

  // ── 5. __NEXT_DATA__ deep walk ─────────────────────────────
  const nextEl = document.getElementById('__NEXT_DATA__');
  if (nextEl) {
    try {
      const nd = JSON.parse(nextEl.textContent || '{}');

      function getDeepSC(obj, ...keys) {
        let cur = obj;
        for (const k of keys) {
          if (!cur || typeof cur !== 'object') return undefined;
          cur = Array.isArray(cur) ? cur[0]?.[k] : cur[k];
        }
        return cur;
      }

      const candidates = [
        getDeepSC(nd, 'props', 'pageProps', 'initialData', 'data', 'product', 'priceInfo', 'finalPrice'),
        getDeepSC(nd, 'props', 'pageProps', 'initialData', 'data', 'product', 'priceInfo', 'itemPrice'),
        getDeepSC(nd, 'props', 'pageProps', 'initialData', 'data', 'product', 'priceInfo', 'listPrice'),
        getDeepSC(nd, 'props', 'pageProps', 'initialData', 'data', 'priceInfo', 'finalPrice'),
        getDeepSC(nd, 'props', 'pageProps', 'initialData', 'data', 'priceInfo', 'itemPrice'),
        getDeepSC(nd, 'props', 'pageProps', 'initialData', 'data', 'product', 'offerList', 0, 'priceInfo', 'finalPrice'),
        getDeepSC(nd, 'props', 'pageProps', 'initialData', 'data', 'product', 'offerList', 0, 'priceInfo', 'itemPrice'),
      ];
      for (const v of candidates) {
        if (typeof v === 'number' && v > 0) return `${sym}${v.toFixed(2)}`;
        if (typeof v === 'string' && /\d/.test(v)) {
          const c = cleanPriceText(v);
          if (c) return ensureCurrency(c, sym);
        }
      }

      function scDeepPrice(obj, depth) {
        if (!obj || typeof obj !== 'object' || depth > 15) return '';
        const priceKeys = ['finalPrice', 'itemPrice', 'salePrice', 'currentPrice', 'displayPrice',
                           'listPrice', 'price', 'regularPrice', 'memberPrice', 'clubPrice'];
        for (const key of priceKeys) {
          if (key in obj) {
            const v = obj[key];
            if (typeof v === 'number' && v > 0) return `${sym}${v.toFixed(2)}`;
            if (typeof v === 'string' && /\d/.test(v)) {
              const c = cleanPriceText(v);
              if (c) return ensureCurrency(c, sym);
            }
          }
        }
        for (const v of Object.values(obj)) {
          if (v && typeof v === 'object') {
            const res = scDeepPrice(v, depth + 1);
            if (res) return res;
          }
        }
        return '';
      }
      const found = scDeepPrice(nd, 0);
      if (found) return found;
    } catch (_) {}
  }

  // ── 6. Inline script regex fallback ───────────────────────
  for (const s of document.querySelectorAll('script:not([src])')) {
    const t = s.textContent || '';
    if (t.length < 50 || t.length > 3_000_000) continue;
    if (!/finalPrice|itemPrice|salePrice|clubPrice|memberPrice/.test(t)) continue;
    const m = t.match(/"(?:finalPrice|itemPrice|salePrice|clubPrice|memberPrice)"\s*:\s*([\d.]+)/);
    if (m && parseFloat(m[1]) > 0) return `${sym}${parseFloat(m[1]).toFixed(2)}`;
  }

  // ── 7. Generic DOM fallback ────────────────────────────────
  const genericSelectors = [
    '[data-testid="price"]', '[data-automation-id="price"]',
    '[class*="price-display"]', '[class*="PriceDisplay"]',
    '[class*="sc-price"]', '[class*="priceInfo"]',
    '.price', '#price'
  ];
  for (const sel of genericSelectors) {
    for (const el of document.querySelectorAll(sel)) {
      const raw = el.getAttribute('content') || el.innerText || el.textContent || '';
      const c = cleanPriceText(raw);
      if (c && /\d/.test(c)) return ensureCurrency(c, sym);
    }
  }

  return '';
}


// ── ISSUE 1 FIX: Walmart precise price reader ────────────────
function readWalmartPrice() {
  // Prefer aria-label on the price wrapper (has the full formatted price)
  const ariaSelectors = [
    '[itemprop="price"]',
    '[data-automation-id="product-price"] [itemprop="price"]',
    '[data-automation-id="product-price"]',
    'span[aria-label*="$"]',
    'span[aria-label*="£"]',
    'span[aria-label*="€"]'
  ];
  for (const sel of ariaSelectors) {
    for (const el of document.querySelectorAll(sel)) {
      const raw = el.getAttribute('aria-label') || el.getAttribute('content') || el.innerText || '';
      const c = cleanPriceText(raw);
      if (c && /\d/.test(c)) return c;
    }
  }

  // Reconstruct from characteristic + mantissa
  const charEl = document.querySelector('.price-characteristic, [itemprop="price"]');
  const mantEl = document.querySelector('.price-mantissa');
  if (charEl) {
    const whole = charEl.getAttribute('content') || charEl.innerText.replace(/[^0-9,]/g, '');
    const frac  = mantEl ? mantEl.innerText.replace(/[^0-9]/g, '') : '00';
    if (whole) return `$${whole}${frac ? '.' + frac : ''}`;
  }
  return '';
}

// ── ISSUE 3 FIX: Universal e-commerce price reader ──────────
// Reads price from any e-commerce page using a priority waterfall.
function universalPrice() {
  const sym = detectPageCurrencySymbol();
  const p = priceFromSelectors([
    // Schema.org meta
    'meta[property="product:price:amount"]',
    'meta[itemprop="price"]',
    // Structured data attributes
    '[itemprop="price"]',
    '[data-price]',
    // Common class patterns (ordered most-specific first)
    '.product-price .price',
    '.product__price .price',
    '.entry-price',
    '.single_variation_wrap .price .amount',
    '.woocommerce-Price-amount',   // WooCommerce
    '.bc-pricing__value',          // BigCommerce
    '.ProductMeta__Price',
    '.price-item--sale',
    '.price-item--regular',
    // Flipkart
    '._30jeq3._16Jk6d',
    '._30jeq3',
    // Noon
    '.priceNow',
    '.price-now',
    // Lazada / Shopee patterns
    '[class*="pdp-price"][class*="current"]',
    '[class*="current-price"]',
    '[class*="sale-price"]',
    '[class*="selling-price"]',
    '[class*="discounted-price"]',
    // Fallback catch-all (not script/style, not shipping)
    '[class*="price"]:not(script):not(style):not([class*="shipping"]):not([class*="original"]):not([class*="was"]):not([class*="strike"])',
    '[id*="price"]:not(script):not(style)'
  ]);
  if (p) return ensureCurrency(p, sym);

  // data-price attribute fallback
  const dp = document.querySelector('[data-price]')?.getAttribute('data-price');
  if (dp && /[\d.]+/.test(dp)) return `${sym}${dp}`;

  return '';
}

// ──────────────────────────────────────────────────────────────
//                  PLATFORM SCRAPERS
// ──────────────────────────────────────────────────────────────

// ISSUE 4 FIX: All scrapers now collect images from gallery scope only,
// not from the full document.

function scrapeAmazon() {
  const r = { title: '', price: '', images: [], videos: [], variants: [] };

  const titleEl = document.querySelector('#productTitle, #title span, h1.a-size-large, #title_feature_div #title');
  if (titleEl) r.title = titleEl.innerText.trim();
  // If DOM title is empty (e.g. page still loading), try og:title — never fall back to document.title
  // because Amazon sets it to "Adding to Cart..." during cart operations.
  if (!r.title) {
    const og = document.querySelector('meta[property="og:title"]');
    if (og?.content) r.title = og.content.trim();
  }

  // ISSUE 1 FIX: prefer .a-offscreen inside non-strikethrough price elements
  r.price = priceFromSelectors([
    '#corePrice_feature_div .a-price:not(.a-text-price) .a-offscreen',
    '#apex_offerDisplay_desktop .a-price:not(.a-text-price) .a-offscreen',
    '.priceToPay .a-offscreen',
    '.apexPriceToPay .a-offscreen',
    '#priceblock_ourprice', '#priceblock_dealprice', '#priceblock_saleprice',
    '.a-price:not([data-a-strike]):not(.a-text-price) .a-offscreen'
  ]);
  if (!r.price) {
    const w = document.querySelector('.a-price-whole')?.innerText.replace(/[^0-9,]/g, '');
    const f = document.querySelector('.a-price-fraction')?.innerText.replace(/[^0-9]/g, '') || '00';
    if (w) r.price = `$${w}.${f}`;
  }

  // ── TWO-TIER URL QUALITY STRATEGY ────────────────────────────────────────
  //
  // PROBLEM: Different Amazon JSON keys have different URL quality contracts:
  //   "hiRes"  = true original upload URL (clean or has modifier, always best)
  //   "large"  = bounded-size URL (e.g. ._SL1500_.) guaranteed by Amazon CDN
  //   "thumb"  = tiny thumbnail URL
  //
  // WRONG approach (caused the bug): stripping modifier from ALL sources.
  //   For "hiRes" → strip modifier → clean URL → Amazon serves ORIGINAL ✅
  //   For "large" → strip modifier → clean URL → Amazon may serve DEFAULT
  //                 size (e.g. 500px) which is WORSE than the original _SL1500_ ❌
  //
  // CORRECT approach: different treatment per source:
  //   "hiRes"  → strip modifier → clean URL → original upload quality
  //   "large"  → replace modifier with _SL1500_ → guaranteed 1500px
  //   "thumb"  → replace modifier with _SL1500_ → guaranteed 1500px
  //   raw scan → replace modifier with _SL1500_ → guaranteed 1500px
  //
  // This way: products where ALL images have hiRes → original quality for all.
  //           Products where SOME images have hiRes=null → 1500px for those.

  // For hiRes source: strip modifier entirely → original upload quality
  function cleanHiRes(url) {
    if (!url || typeof url !== 'string' || !url.startsWith('http')) return null;
    return url.replace(/\._[A-Za-z0-9_,]+_\./g, '.');
  }

  // For large/thumb/fallback: replace modifier with _SL1500_ → guaranteed 1500px
  // NOT stripping, because Amazon may not CDN-cache the original for these paths.
  function upscaleTo1500(url) {
    if (!url || typeof url !== 'string' || !url.startsWith('http')) return null;
    return url.replace(/\._[A-Za-z0-9_,]+_\./g, '._SL1500_.');
  }

  const seenKeys = new Set();

  // Add image from hiRes source → original quality
  function addHiResImg(url) {
    const clean = cleanHiRes(url);
    if (!clean) return;
    const key = canonImageKey(clean);
    if (seenKeys.has(key)) return;
    seenKeys.add(key);
    r.images.push(clean);
  }

  // Add image from fallback source → 1500px quality
  function addFallbackImg(url) {
    const sized = upscaleTo1500(url);
    if (!sized) return;
    const key = canonImageKey(sized);
    if (seenKeys.has(key)) return;
    seenKeys.add(key);
    r.images.push(sized);
  }

  // ── Pass 0: colorImages entries (one entry per gallery image) ─────────
  // Amazon uses DIFFERENT image IDs for different resolutions of the same
  // photo (e.g. hiRes 41I8AN0RAgL vs large 21lIynVSvcL). Taking hiRes AND
  // large from the same entry therefore yields a hi-res + a low-res duplicate
  // that dedupe cannot detect, and the low-res copies crowd out real images.
  // Fix: exactly ONE url per entry — hiRes if present, else the largest key
  // in "main", else "large" upscaled.
  function amazonEntriesFromScripts() {
    const out = [];
    const q = '\\\\?"';                                  // optional escaped quote
    const re = new RegExp(q + 'hiRes' + q + '\\s*:\\s*(null|' + q + 'https?:\\/\\/[^"\\\\]+' + q + ')' +
      '[\\s\\S]{0,600}?' + q + 'large' + q + '\\s*:\\s*' + q + '(https?:\\/\\/[^"\\\\]+)' + q +
      '(?:[\\s\\S]{0,40}?' + q + 'main' + q + '\\s*:\\s*\\{([\\s\\S]{0,4000}?)\\})?', 'g');
    for (const script of document.querySelectorAll('script')) {
      let t = script.textContent || '';
      if (!t.includes('colorImages') && !t.includes('ImageBlockATF')) continue;
      // v10.3.1 BUG FIX: variation products (Color: White / Yellow / ...) have images for ALL variants in script.
      // Strictly slice to 'initial' (current selected variant) array so variants don't mix.
      try {
        const ci = t.indexOf('colorImages');
        if (ci >= 0) {
          const ii = t.indexOf('initial', ci);
          const ab = ii >= 0 ? t.indexOf('[', ii) : -1;
          if (ab >= 0 && ab - ii < 20) {
            let depth = 0, end = -1;
            for (let i = ab; i < t.length && i < ab + 400000; i++) {
              const ch = t[i];
              if (ch === '[') depth++;
              else if (ch === ']') { depth--; if (depth === 0) { end = i; break; } }
            }
            if (end > ab) t = t.slice(ab, end + 1);
          }
        }
      } catch (_) {}
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(t)) !== null) {
        const hiRes = m[1] === 'null' ? null : m[1].replace(/^\\?"|\\?"$/g, '');
        let best = hiRes;
        if (!best && m[3]) {
          // pick the largest [w,h] in the main map
          let bestArea = 0;
          const mm = /(https?:\/\/[^"\\]+)\\?"\s*:\s*\[(\d+),(\d+)\]/g;
          let k;
          while ((k = mm.exec(m[3])) !== null) { const a = (+k[2]) * (+k[3]); if (a > bestArea) { bestArea = a; best = k[1]; } }
        }
        out.push({ hiRes, best: best || m[2] });
      }
      if (out.length) break;
    }
    return out;
  }
  let entries = amazonEntriesFromScripts();
  // Sanity check: if page has landingImage and it does not match extracted entries, script is for wrong variant → fallback to DOM gallery
  try {
    const li = document.getElementById('landingImage');
    const liKey = li ? canonImageKey(li.getAttribute('data-old-hires') || li.src || '') : '';
    if (liKey && entries.length && !entries.some(e => canonImageKey(e.hiRes || e.best || '') === liKey)) entries = [];
  } catch (_) {}
  entries.forEach(e => { if (e.hiRes) addHiResImg(e.hiRes); else addFallbackImg(e.best); });

  // ── DOM gallery fallback: one url per <img>, best candidate only ───────
  if (r.images.length === 0) {
    document.querySelectorAll('#landingImage, #imgTagWrapperId img, #altImages img, .a-button-thumbnail img, .imageThumbnail img').forEach(img => {
      const hires = img.getAttribute('data-old-hires') || '';
      const cand = hires || pickAmazonDynamic(img) || img.getAttribute('data-zoom-image') || img.getAttribute('data-large-image') || img.src || img.getAttribute('data-src') || '';
      if (!cand || /play[-_]?button|video[-_]?thumbnail|pkplay/i.test(cand)) return;
      if (hires) addHiResImg(cand); else addFallbackImg(cand);
    });
  }

  // Pass 2: Raw Amazon CDN URL scan — only if targeted script extraction found nothing.
  if (r.images.length === 0) for (const script of scripts) {
    const t = script.textContent || '';
    const rawScan = /https:\/\/(?:m\.media-amazon\.com|images-amazon\.com)\/images\/I\/[A-Za-z0-9%+\-_.]+\.(?:jpg|jpeg|png|webp)/g;
    let match;
    while ((match = rawScan.exec(t)) !== null) addFallbackImg(match[0]);
  }

  // Pass 3 (DOM fallback): used when script scans yield nothing (rare).
  if (r.images.length === 0) {
    const landingImage = document.getElementById('landingImage');
    if (landingImage) {
      const oldHires = landingImage.getAttribute('data-old-hires');
      if (oldHires) addHiResImg(oldHires);  // data-old-hires = true hi-res
      else addFallbackImg(landingImage.src); // src = fallback
    }

    document.querySelectorAll('.a-button-thumbnail img').forEach(img => {
      addHiResImg(img.getAttribute('data-old-hires') || '');
      addFallbackImg(pickAmazonDynamic(img) || img.src || '');
    });

    const imgEls = document.querySelectorAll(
      '#altImages img, #imgTagWrapperId img, #imageBlock img, .imageThumbnail img'
    );
    imgEls.forEach(img => {
      if (img.closest('[class*="review"]')) return;
      addHiResImg(img.getAttribute('data-old-hires') || '');
      addFallbackImg(
        pickAmazonDynamic(img) ||
        img.getAttribute('data-zoom-image') ||
        img.getAttribute('data-large-image') ||
        img.src || img.getAttribute('data-src') || ''
      );
    });
  }



  // ── AMAZON VIDEO EXTRACTION — Multi-pass with dedup ──────────────────────
  // Amazon embeds video data in several places:
  //   1. Standard mp4/m3u8 URLs in script tags
  //   2. Amazon-specific JSON keys: videoDisplayInfos, videoSrc, immersionVideoUrl, videoCatalogUrl
  //   3. Amazon CDN: aiv-delivery.net, video.media-amazon.com
  //   4. HTML5 <video> elements and data-video-url attributes
  //   5. og:video meta tags
  const _vidSet = new Set();
  const addAmazonVideo = (v) => {
    if (!v || typeof v !== 'string') return;
    const clean = v.replace(/\\\//g, '/').replace(/\\u002F/gi, '/').trim();
    if (!clean.startsWith('http') || _vidSet.has(clean)) return;
    _vidSet.add(clean);
    r.videos.push(clean);
  };

  document.querySelectorAll('script:not([src])').forEach(s => {
    let t = s.textContent || '';
    t = t.replace(/\\\//g, '/').replace(/\\u002F/ig, '/');

    // Pass 1: Standard mp4/m3u8 URLs anywhere in script
    if (/\.(mp4|m3u8)/i.test(t)) {
      (t.match(/https?:\/\/[^"'\s\\]+\.(?:mp4|m3u8)[^"'\s\\]*/gi) || [])
        .forEach(url => addAmazonVideo(url));
    }

    // Pass 2: Amazon-specific JSON video keys
    // Amazon embeds videoDisplayInfos[] array with videoSrc, plus top-level
    // immersionVideoUrl and videoCatalogUrl in the page's data JSON blobs.
    if (/videoDisplayInfos|videoSrc|immersionVideoUrl|videoCatalogUrl|videoUrl/i.test(t)) {
      for (const m of t.matchAll(/"videoSrc"\s*:\s*"(https?:[^"]+)"/gi))          addAmazonVideo(m[1]);
      for (const m of t.matchAll(/"videoUrl"\s*:\s*"(https?:[^"]+)"/gi))          addAmazonVideo(m[1]);
      for (const m of t.matchAll(/"immersionVideoUrl"\s*:\s*"(https?:[^"]+)"/gi)) addAmazonVideo(m[1]);
      for (const m of t.matchAll(/"videoCatalogUrl"\s*:\s*"(https?:[^"]+)"/gi))   addAmazonVideo(m[1]);
      for (const m of t.matchAll(/"videoThumbnailUrl"\s*:\s*"(https?:[^"]+\.(?:mp4|m3u8)[^"]*)"/gi)) addAmazonVideo(m[1]);
    }

    // Pass 3: Amazon CDN URLs — aiv-delivery.net and video.media-amazon.com
    // These appear even without .mp4 extension in the URL string.
    if (/aiv-delivery\.net|video\.media-amazon\.com/i.test(t)) {
      for (const m of t.matchAll(/https?:\/\/[^"'\s\\]*(?:aiv-delivery\.net|video\.media-amazon\.com)[^"'\s\\]*/gi))
        addAmazonVideo(m[0]);
    }
  });

  // Pass 4: HTML5 video elements and data-video-url attributes in DOM
  document.querySelectorAll('video, video source, [data-video-url], [data-video-src]').forEach(el => {
    addAmazonVideo(el.currentSrc || '');
    addAmazonVideo(el.src || '');
    addAmazonVideo(el.getAttribute('src') || '');
    addAmazonVideo(el.getAttribute('data-video-url') || '');
    addAmazonVideo(el.getAttribute('data-video-src') || '');
  });

  // Pass 5: og:video meta tags
  document.querySelectorAll(
    'meta[property="og:video"], meta[property="og:video:url"], meta[name="twitter:player:stream"]'
  ).forEach(m => addAmazonVideo(m.getAttribute('content') || ''));

  return r;
}

function scrapeWalmart() {
  const r = { title: '', price: '', images: [], videos: [], variants: [] };

  const titleEl = document.querySelector(
    'h1[itemprop="name"], h1.prod-ProductTitle, [data-automation-id="product-title"], h1.lh-copy, h1#main-title'
  );
  if (titleEl) r.title = titleEl.innerText.trim();

  r.price = readWalmartPrice();

  // Helper: strip Walmart CDN size-capping parameters to get full-resolution image
  // Walmart uses i5.walmartimages.com with params like ?odnWidth=180&odnHeight=180 that cap quality
  const wmUpscale = (src) => {
    if (!src) return src;
    // Remove all query parameters from Walmart/Sam's Club CDN URLs (they only cap size)
    if (/walmartimages\.com|scene7\.samsclub|samsclub\.com\/content/i.test(src)) {
      return src.split('?')[0];
    }
    return src.split('?')[0]; // strip params universally for clean dedup
  };

  // Strategy 1: __NEXT_DATA__ JSON (most reliable — contains full-res URLs directly)
  // ROOT CAUSE of duplicates: Walmart __NEXT_DATA__ embeds the same imageInfo.allImages
  // in MULTIPLE locations (product root + contentLayout modules + variantMap). A generic
  // DFS with early exit can still find two sibling nodes at the same depth.
  // Fix: navigate a PRIORITY-ORDERED list of known product paths instead of blind DFS.
  const nextEl = document.getElementById('__NEXT_DATA__');
  if (nextEl) {
    try {
      const nd = JSON.parse(nextEl.textContent || '{}');

      // canonical-key dedup Set shared across all candidate sources
      const wmSeen = new Set();
      const addWmImg = (rawUrl) => {
        if (!rawUrl) return;
        const clean = wmUpscale(rawUrl);
        if (!clean) return;
        const key = canonImageKey(clean);
        if (wmSeen.has(key)) return;
        wmSeen.add(key);
        r.images.push(clean);
      };

      // Extract images from an imageInfo.allImages array
      const extractAllImages = (imageInfo) => {
        if (!imageInfo || !Array.isArray(imageInfo.allImages)) return false;
        imageInfo.allImages.forEach(img => {
          let url = img.url || '';
          // Prefer the largest assetSizeList entry
          if (Array.isArray(img.assetSizeList) && img.assetSizeList.length) {
            const last = img.assetSizeList[img.assetSizeList.length - 1];
            if (last && last.url) url = last.url;
          }
          addWmImg(url);
        });
        return imageInfo.allImages.length > 0;
      };

      // Try exact, known paths first (prevents collecting from recommendations)
      const root = nd?.props?.pageProps?.initialData?.data?.product
                || nd?.pageProps?.initialData?.data?.product
                || nd?.initialData?.data?.product;

      if (root) {
        extractAllImages(root.imageInfo);
        // Some Walmart pages nest it one level deeper under primaryOffer or imageList
        if (r.images.length === 0) extractAllImages(root.primaryOffer?.imageInfo || root.imageList?.imageInfo);
      }

      // Fallback: if targeted paths gave nothing, do a BOUNDED DFS (max depth 6)
      // that stops as soon as one imageInfo.allImages is found
      if (r.images.length === 0) {
        const dfs = (obj, depth) => {
          if (!obj || typeof obj !== 'object' || depth > 6) return false;
          if (obj.imageInfo && Array.isArray(obj.imageInfo.allImages)) {
            return extractAllImages(obj.imageInfo);
          }
          for (const v of Object.values(obj)) {
            if (v && typeof v === 'object' && dfs(v, depth + 1)) return true;
          }
          return false;
        };
        dfs(nd, 0);
      }
    } catch (_) {}
  }

  // Strategy 2: DOM thumbnails fallback (if __NEXT_DATA__ had nothing)
  if (r.images.length === 0) {
    document.querySelectorAll('[data-testid="vertical-carousel-container"] img, [data-testid="media-thumbnail"] img').forEach(img => {
      // data-old-hires or data-zoom-image may hold higher-res version
      const src = img.getAttribute('data-old-hires') || img.getAttribute('data-zoom-image') ||
                  img.getAttribute('data-src') || img.src || img.srcset?.split(' ')[0] || '';
      if (!src) return;
      const clean = wmUpscale(src);
      if (clean && !r.images.includes(clean)) r.images.push(clean);
    });
  }

  // Always merge live gallery media: Walmart can expose a partial __NEXT_DATA__
  // payload while the remaining product images arrive through lazy DOM attributes.
  collectLiveMarketplaceImages('walmart').forEach(image => {
    if (!r.images.some(existing => canonImageKey(existing) === canonImageKey(image))) r.images.push(image);
  });


  // Extract videos from __NEXT_DATA__ JSON (Walmart: mediaAssets + Brightcove player)
  try {
    const nd = JSON.parse(document.getElementById('__NEXT_DATA__')?.textContent || '{}');
    const _wmVidSeen = new Set();
    const addWmVid = (u) => {
      if (!u || typeof u !== 'string') return;
      const clean = u.replace(/\\\//g, '/').trim();
      if (!clean.startsWith('http')) return;
      if (!/\.(mp4|m3u8|webm)/i.test(clean) && !isVideoUrl(clean)) return;
      if (!_wmVidSeen.has(clean)) { _wmVidSeen.add(clean); r.videos.push(clean); }
    };

    (function scanWalmartVideos(obj, depth) {
      if (!obj || typeof obj !== 'object' || depth > 12) return;

      // Standard mediaAssets format
      if (Array.isArray(obj.mediaAssets)) {
        obj.mediaAssets.forEach(a => {
          if (a && a.type === 'VIDEO' && a.url) addWmVid(a.url);
        });
      }

      // Brightcove: sources[] — array of {src, type}
      if (Array.isArray(obj.sources)) {
        obj.sources.forEach(s => {
          if (s && typeof s.src === 'string') addWmVid(s.src);
        });
      }

      // Brightcove: renditions[] — pick highest quality
      if (Array.isArray(obj.renditions) && obj.renditions.length > 0) {
        const sorted = [...obj.renditions]
          .filter(rd => rd && typeof rd.url === 'string')
          .sort((a, b) => (b.encodingRate || 0) - (a.encodingRate || 0));
        if (sorted.length > 0) addWmVid(sorted[0].url);
      }

      // Flat video key names
      ['videoUrl', 'mp4Url', 'hlsUrl', 'videoSrc', 'streamUrl', 'video_url',
       'hlsManifestUrl', 'dashManifestUrl'].forEach(k => {
        if (typeof obj[k] === 'string') addWmVid(obj[k]);
      });

      Object.values(obj).forEach(v => { if (v && typeof v === 'object') scanWalmartVideos(v, depth + 1); });
    })(nd, 0);
  } catch(_) {}
  return r;
}

function scrapeSamsClub() {
  const r = { title: '', price: '', images: [], videos: [], variants: [] };



  const titleEl = document.querySelector(
    'h1.sc-product-title, h1[data-testid="product-title"], h1[data-automation-id="product-title"], h1'
  );
  if (titleEl) r.title = titleEl.innerText.trim();

  r.price = readSamsClubPrice();

  // Helper: strip Sam's Club scene7 CDN size params to get full-resolution image
  // scene7 URLs use $SC_Item_Medium_Image$ qualifiers and ?wid=200&hei=200 that cap quality
  const scUpscale = (src) => {
    if (!src) return src;
    if (/scene7\.samsclub\.com/i.test(src)) {
      // Remove everything from ? onward AND strip scene7 image preset qualifiers
      return src.split('?')[0].replace(/\$SC_Item[^$]*\$/, '').replace(/\$[^$]+\$/, '');
    }
    return src.split('?')[0];
  };

  // Strategy 1: __NEXT_DATA__ JSON — assets[].largeImage or zoomImage (highest quality fields)
  // Use targeted path navigation to avoid collecting assets from recommendation panels.
  const nextEl = document.getElementById('__NEXT_DATA__');
  if (nextEl) {
    try {
      const nd = JSON.parse(nextEl.textContent || '{}');

      // Canonical-key dedup Set for Sam's Club images
      const scSeen = new Set();
      const addScImg = (rawUrl) => {
        if (!rawUrl) return;
        const clean = scUpscale(rawUrl);
        if (!clean) return;
        const key = canonImageKey(clean);
        if (scSeen.has(key)) return;
        scSeen.add(key);
        r.images.push(clean);
      };

      const extractScAssets = (assets) => {
        if (!Array.isArray(assets) || assets.length === 0) return false;
        const usable = assets.filter(a => a && (a.zoomImage || a.largeImage || a.imageUrl || a.image || a.url));
        if (!usable.length) return false;
        usable.forEach(a => addScImg(a.zoomImage || a.largeImage || a.imageUrl || a.image || a.url || ''));
        return r.images.length > 0;
      };

      // Navigate the known Sam's Club product path first
      const scProduct = nd?.props?.pageProps?.initialData?.data?.product
                     || nd?.pageProps?.initialData?.data?.product;

      if (scProduct) {
        extractScAssets(scProduct.assets);
        // Some Sam's Club pages use imageAssets instead of assets
        if (r.images.length === 0) extractScAssets(scProduct.imageAssets || scProduct.images);
      }

      // Fallback: bounded DFS (max depth 6) if targeted paths found nothing
      if (r.images.length === 0) {
        const dfs = (obj, depth) => {
          if (!obj || typeof obj !== 'object' || depth > 6) return false;
          if (extractScAssets(obj.assets)) return true;
          for (const v of Object.values(obj)) {
            if (v && typeof v === 'object' && dfs(v, depth + 1)) return true;
          }
          return false;
        };
        dfs(nd, 0);
      }
    } catch (_) {}
  }

  // Strategy 2: DOM thumbnail fallback
  if (r.images.length === 0) {
    document.querySelectorAll(
      '[data-testid="item-page-vertical-carousel-hero-image-button"] img, ' +
      '[data-seo-id="hero-carousel-image"] img, [data-testid="media-thumbnail"] img'
    ).forEach(img => {
      if ((img.src || '').includes('samsclub.com/content/dam/logos')) return;
      const src = img.getAttribute('data-old-hires') || img.getAttribute('data-zoom-image') ||
                  img.getAttribute('data-src') || img.src || img.srcset?.split(' ')[0] || '';
      if (!src) return;
      const clean = scUpscale(src);
      if (clean && !r.images.includes(clean)) r.images.push(clean);
    });
  }

  // Always merge live gallery media: Sam's Club may render image assets after
  // the initial React state has been created or use a different carousel DOM.
  collectLiveMarketplaceImages('samsclub').forEach(image => {
    if (!r.images.some(existing => canonImageKey(existing) === canonImageKey(image))) r.images.push(image);
  });


  // Extract videos from __NEXT_DATA__ JSON
  // Sam's Club shares Walmart's Next.js infrastructure BUT uses Brightcove player.
  // Brightcove stores video in sources[].src and renditions[].url — NOT mediaAssets[].
  try {
    const nd = JSON.parse(document.getElementById('__NEXT_DATA__')?.textContent || '{}');
    const _scVidSeen = new Set();
    const addScVid = (u) => {
      if (!u || typeof u !== 'string') return;
      const clean = u.replace(/\\\//g, '/').trim();
      if (!clean.startsWith('http')) return;
      if (!/\.(mp4|m3u8|webm)/i.test(clean) && !isVideoUrl(clean)) return;
      if (!_scVidSeen.has(clean)) { _scVidSeen.add(clean); r.videos.push(clean); }
    };

    (function scanScVideos(obj, depth) {
      if (!obj || typeof obj !== 'object' || depth > 15) return;

      // Standard Walmart/Sam's Club mediaAssets format
      if (Array.isArray(obj.mediaAssets)) {
        obj.mediaAssets.forEach(a => {
          if (a && a.type === 'VIDEO' && a.url) addScVid(a.url);
        });
      }

      // Brightcove: sources[] — array of {src, type} objects
      if (Array.isArray(obj.sources)) {
        obj.sources.forEach(s => {
          if (s && typeof s.src === 'string') addScVid(s.src);
        });
      }

      // Brightcove: renditions[] — pick highest quality (sort by encodingRate desc)
      if (Array.isArray(obj.renditions) && obj.renditions.length > 0) {
        const sorted = [...obj.renditions]
          .filter(rd => rd && typeof rd.url === 'string')
          .sort((a, b) => (b.encodingRate || 0) - (a.encodingRate || 0));
        if (sorted.length > 0) addScVid(sorted[0].url);
      }

      // Flat video key names (Walmart + Brightcove variants)
      ['videoUrl', 'mp4Url', 'hlsUrl', 'videoSrc', 'video_url', 'streamUrl',
       'hlsManifestUrl', 'dashManifestUrl'].forEach(k => {
        if (typeof obj[k] === 'string') addScVid(obj[k]);
      });

      Object.values(obj).forEach(v => { if (v && typeof v === 'object') scanScVideos(v, depth + 1); });
    })(nd, 0);

    // Inline <script> scan — catches Brightcove JSON not in __NEXT_DATA__
    document.querySelectorAll('script:not([src])').forEach(s => {
      const t = s.textContent || '';
      if (t.length < 50 || t.length > 3_000_000) return;
      if (!/brightcove|renditions|sources.*mp4|sources.*m3u8|scene7.*samsclub/i.test(t)) return;
      // Brightcove sources: "src":"https://...mp4"
      for (const m of t.matchAll(/"src"\s*:\s*"(https?:[^"]+\.(?:mp4|m3u8|webm)[^"]*)"/gi))
        addScVid(m[1].replace(/\\\//g, '/'));
      // Brightcove renditions: "url":"https://...mp4"
      for (const m of t.matchAll(/"url"\s*:\s*"(https?:[^"]+\.(?:mp4|m3u8|webm)[^"]*)"/gi))
        addScVid(m[1].replace(/\\\//g, '/'));
      // scene7 Sam's Club video CDN
      for (const m of t.matchAll(/https?:\\?\/?\/?scene7\.samsclub\.com\/[^\s"']+\.mp4/gi))
        addScVid(m[0].replace(/\\\//g, '/'));
    });
  } catch(_) {}
  return r;
}

function scrapeFaire() {
  const r = { title: '', price: '', images: [], videos: [], variants: [] };
  const sym = detectPageCurrencySymbol() || '$';

  // ── Title ──────────────────────────────────────────────────
  const titleEl = document.querySelector(
    'h1[class*="product"], h1[class*="Product"], h1[class*="title"], h1[class*="Title"], ' +
    '[data-testid*="product-title"], [data-testid*="productTitle"], ' +
    '[class*="ProductTitle"], [class*="product-title"], h1'
  );
  if (titleEl) r.title = titleEl.innerText.trim();

  // ── Price: Strategy 1 — __NEXT_DATA__ deep walk (most reliable for Faire) ──
  const nextDataEl = document.getElementById('__NEXT_DATA__');
  if (nextDataEl) {
    try {
      const nextData = JSON.parse(nextDataEl.textContent || '{}');

      function getFairePrice(obj, depth) {
        if (!obj || typeof obj !== 'object' || depth > 18) return '';
        const priceKeys = [
          'wholesale_price', 'wholesalePrice', 'unit_price', 'unitPrice',
          'min_price', 'minPrice', 'price_per_unit', 'pricePerUnit',
          'retail_price', 'retailPrice', 'suggested_retail_price',
          'min_order_amount', 'price'
        ];
        for (const key of priceKeys) {
          if (key in obj) {
            const v = obj[key];
            // Faire stores prices as integers in cents (e.g. 1498 = $14.98)
            if (typeof v === 'number' && v > 0) {
              const amount = v >= 100 ? (v / 100) : v;
              return `${sym}${amount.toFixed(2)}`;
            }
            if (typeof v === 'string' && /\d/.test(v)) {
              const c = cleanPriceText(v);
              if (c) return ensureCurrency(c, sym);
            }
          }
        }
        for (const v of Object.values(obj)) {
          if (v && typeof v === 'object') {
            const res = getFairePrice(v, depth + 1);
            if (res) return res;
          }
        }
        return '';
      }

      function walkFaireJson(obj, depth) {
        if (!obj || typeof obj !== 'object' || depth > 12) return;
        if (Array.isArray(obj)) { obj.forEach(v => walkFaireJson(v, depth + 1)); return; }
        const imageKeys = ['images', 'productImages', 'media', 'photos', 'product_images'];
        for (const key of imageKeys) {
          if (Array.isArray(obj[key])) {
            obj[key].forEach(item => {
              const u = typeof item === 'string' ? item
                : (item.url || item.src || item.imageUrl || item.image_url || '');
              if (u && !isBadImage(u)) r.images.push(u);
            });
          }
        }
        const singleKeys = ['imageUrl', 'image_url', 'heroImage', 'primaryImage', 'thumbnail_url', 'thumbnailUrl'];
        for (const key of singleKeys) {
          if (typeof obj[key] === 'string' && obj[key] && !isBadImage(obj[key])) {
            r.images.push(obj[key]);
          }
        }
        Object.values(obj).forEach(v => { if (v && typeof v === 'object') walkFaireJson(v, depth + 1); });
      }

      const foundPrice = getFairePrice(nextData, 0);
      if (foundPrice) r.price = foundPrice;
      walkFaireJson(nextData, 0);
    } catch (_) {}
  }

  // ── Price: Strategy 2 — DOM selectors (Faire-specific) ────────────────
  if (!r.price) {
    r.price = priceFromSelectors([
      '[data-testid="wholesale-price"]', '[data-testid="retail-price"]',
      '[data-testid="unit-price"]', '[data-testid="product-price"]',
      '[data-testid*="price"]', '[data-test-id*="price"]',
      '[class*="wholesale"][class*="price" i]',
      '[class*="WholesalePrice"]', '[class*="wholesalePrice"]',
      '[class*="UnitPrice"]', '[class*="unit-price"]',
      '[class*="ProductPrice"]', '[class*="product-price"]',
      '[class*="Price"]', '[class*="price"]',
      '[aria-label*="price" i]', '[aria-label*="wholesale" i]'
    ]);
    if (r.price) r.price = ensureCurrency(r.price, sym);
  }

  // ── Price: Strategy 3 — JSON-LD ───────────────────────────
  if (!r.price) {
    for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const root = JSON.parse(s.textContent || '{}');
        const stack = Array.isArray(root) ? [...root] : [root];
        while (stack.length) {
          const it = stack.shift();
          if (!it || typeof it !== 'object') continue;
          const o = it.offers || it.Offers;
          if (o) {
            const arr = Array.isArray(o) ? o : [o];
            for (const of_ of arr) {
              const p = of_.price || of_.lowPrice;
              if (p !== undefined && p !== null && p !== '') {
                const symMap = { USD:'$', GBP:'£', EUR:'€', JPY:'¥', INR:'₹', KRW:'₩', CAD:'CA$', AUD:'AU$' };
                const cur = of_.priceCurrency || '';
                const cs = symMap[cur.toUpperCase()] || sym;
                r.price = `${cs}${p}`;
                break;
              }
            }
          }
          if (r.price) break;
          Object.values(it).forEach(v => { if (v && typeof v === 'object') stack.push(v); });
        }
      } catch (_) {}
      if (r.price) break;
    }
  }

  // ── Images: Fallback DOM scan ──────────────────────────────
  if (r.images.length === 0) {
    const galleryScope = document.querySelector(
      '[data-testid*="product-image"], [class*="ProductImages"], ' +
      '[class*="productImages"], [class*="ImageGallery"], ' +
      '[class*="image-gallery"], [class*="carousel"], ' +
      '[class*="pdp-image"], [class*="ProductMedia"]'
    ) || findProductGalleryContainer() || document;

    collectImagesBySelector(
      'img[src*="faire-cdn"], img[src*="faire.com/"], img[srcset*="faire-cdn"], ' +
      'picture img, [data-testid*="image" i] img, [data-testid*="ProductImage" i] img, ' +
      '[class*="ProductImage"] img, [class*="carousel"] img, [class*="gallery"] img',
      galleryScope
    ).forEach(s => {
      if (!isBadImage(s)) r.images.push(s);
    });
  }

  return r;
}

function scrapeAlibaba() {
  const r = { title: '', price: '', images: [], videos: [], variants: [] };
  const t = document.querySelector('.product-title, h1, [class*="module_title"], [class*="product-name"]');
  if (t) r.title = t.innerText.trim();
  const pe = document.querySelector('.price, [class*="price-info"], [class*="product-price"], [class*="ma-spec-price"]');
  if (pe) {
    const nums = (pe.innerText || '').match(/[$£€]?\s*\d{1,3}(?:[,.\s]\d{3})*(?:\.\d{1,2})?/g);
    if (nums?.length >= 2) r.price = `${nums[0].trim()} - ${nums[1].trim()}`;
    else if (nums?.length === 1) r.price = nums[0].trim();
  }

  const galleryScope = document.querySelector('.detail-gallery, [class*="gallery-wrap"], [class*="ImageGallery"]') || findProductGalleryContainer() || document;
  collectImagesBySelector('.detail-gallery img, [class*="gallery"] img, .main-image img, .thumb-list img', galleryScope)
    .forEach(s => r.images.push(s.replace(/_\d+x\d+\./, '_960x960.')));
  return r;
}

function scrapeAliExpress() {
  const r = { title: '', price: '', images: [], videos: [], variants: [] };
  const t = document.querySelector('[data-pl="product-title"], h1, .product-title-text, [class*="title--wrap"] h1');
  if (t) r.title = t.innerText.trim();
  r.price = priceFromSelectors([
    '.product-price-value', '[class*="price--current"]',
    '[class*="uniform-banner-box-price"]', '[class*="es--wrap"] span', '.product-price-current'
  ]);

  const galleryScope = document.querySelector('.pdp-comp-product-image, [class*="gallery--wrap"]') || findProductGalleryContainer() || document;
  collectImagesBySelector('.slider--item img, .images--item img, [class*="gallery"] img, [class*="magnifier"] img', galleryScope)
    .forEach(s => r.images.push(s.replace(/_\d+x\d+\./, '_960x960.')));
  // Extract videos from inline page scripts (AliExpress embeds video_url in script JSON)
  try {
    document.querySelectorAll('script:not([src])').forEach(sc => {
      const text = sc.textContent || '';
      const matches = text.match(/"(?:video_url|videoUrl|video_src|mediaUrl)"\s*:\s*"([^"]+\.(?:mp4|m3u8)[^"]*)"/gi) || [];
      matches.forEach(m => {
        const raw = (m.match(/"([^"]{10,}\.(?:mp4|m3u8)[^"]*)"/) || [])[1];
        if (raw) {
          const clean = raw.replace(/\\\//g, '/');
          if (!r.videos.includes(clean)) r.videos.push(clean);
        }
      });
    });
  } catch(_) {}
  return r;
}

async function scrapeTemu() {
  const r = { title: '', price: '', images: [], videos: [], variants: [] };
  const sym = detectPageCurrencySymbol() || '$';

  // ── Title ──────────────────────────────────────────────────
  const titleEl = document.querySelector(
    '[class*="goods-name"], [class*="GoodsName"], [class*="ProductTitle"], ' +
    '[class*="product-title"], [class*="detail-title"], ' +
    '[data-testid*="product-name"], [data-testid*="title"], h1'
  );
  if (titleEl) r.title = titleEl.innerText.trim();

  // ── Helper: upgrade CDN thumbnail URL to full-resolution origin ──
  // Temu CDNs use suffixes like /thumbnail/200x200 or ?x-oss-process=image/resize,w_200
  // Replacing these gives the full-size product image instead of a preview.
  const temuOriginUrl = (u) => {
    if (!u || typeof u !== 'string') return u;
    return u
      .replace(/\/thumbnail\/\d+x\d+/gi, '/origin')           // /thumbnail/200x200 → /origin
      .replace(/\?x-oss-process=image\/resize[^&"]*/gi, '')   // strip Aliyun resize param
      .replace(/[?&]image_resize=\d+/gi, '')                   // strip ?image_resize=300
      .replace(/\?$/, '');                                     // clean trailing ?
  };

  // ── Price + Images + Videos: Strategy 1 — window.__init_data__ ──
  // Content scripts run in an isolated world; __init_data__ is a page-world global.
  // We inject a <script> to postMessage it back to the content script.
  // v9.1.1: Seller Center (seller.temu.com) ki CSP inline script block karti hai aur wahan
  // koi product data hota bhi nahi — is liye wahan ye strategy skip (console error khatam).
  const temuIsSellerCenter = /^seller\./i.test(location.hostname) || !/-g-\d+|goods_id=\d+/.test(location.href);
  try {
    const temuData = temuIsSellerCenter ? null : await new Promise((resolve) => {
      const msgKey = '__zhunter_temu_' + Date.now();
      const script = document.createElement('script');
      script.textContent = '(function(){' +
        'var d=window.__init_data__||null;' +
        'window.postMessage({__zhunterKey:"' + msgKey + '",payload:d?JSON.stringify(d):null},"*");' +
        '})();';
      const handler = (e) => {
        if (e.source === window && e.data && e.data.__zhunterKey === msgKey) {
          window.removeEventListener('message', handler);
          resolve(e.data.payload ? JSON.parse(e.data.payload) : null);
        }
      };
      window.addEventListener('message', handler);
      (document.head || document.documentElement).appendChild(script);
      script.remove();
      setTimeout(() => { window.removeEventListener('message', handler); resolve(null); }, 500);
    });

    if (temuData) {
      // FIX A1: Walk the FULL tree — never return early.
      // Images are collected on every node. Price is captured on first match.
      // Videos are also collected alongside images.
      const priceKeys = ['sale_price', 'salePrice', 'price', 'promotion_price',
                         'promotionPrice', 'actual_price', 'actualPrice',
                         'original_price', 'originalPrice', 'min_price', 'minPrice'];
      const imgKeys   = ['origin_url', 'original_img_url', 'img_url', 'thumbnail_url',
                         'goods_img_url', 'product_img_url'];
      const vidKeys   = ['video_url', 'videoUrl', 'video_src', 'goods_video_url',
                         'product_video', 'media_url', 'mp4_url'];

      const _imgSeen = new Set();
      const _vidSeen = new Set();

      function walkTemuInitData(obj, depth) {
        if (!obj || typeof obj !== 'object' || depth > 18) return;

        // ── Collect images ───────────────────────────────────
        for (const k of imgKeys) {
          if (k in obj && typeof obj[k] === 'string' && obj[k]) {
            const clean = temuOriginUrl(obj[k]);
            if (clean && !isBadImage(clean) && !_imgSeen.has(clean)) {
              _imgSeen.add(clean);
              r.images.push(clean);
            }
          }
        }

        // ── Collect videos ───────────────────────────────────
        for (const k of vidKeys) {
          if (k in obj && typeof obj[k] === 'string' && obj[k]) {
            const v = obj[k].replace(/\\\//g, '/');
            if (/\.(mp4|webm|m3u8)/i.test(v) && !_vidSeen.has(v)) {
              _vidSeen.add(v);
              r.videos.push(v);
            }
          }
        }

        // ── Capture price (first found, non-returning) ───────
        if (!r.price) {
          for (const k of priceKeys) {
            if (k in obj) {
              if (typeof obj[k] === 'number' && obj[k] > 0) {
                const dollars = obj[k] >= 100 ? (obj[k] / 100).toFixed(2) : obj[k].toFixed(2);
                r.price = sym + dollars;
                break;
              }
              if (typeof obj[k] === 'string' && /\d/.test(obj[k])) {
                const c = cleanPriceText(obj[k]);
                if (c) { r.price = ensureCurrency(c, sym); break; }
              }
            }
          }
        }

        // ── Recurse into children (always, no early exit) ────
        if (Array.isArray(obj)) {
          obj.forEach(v => { if (v && typeof v === 'object') walkTemuInitData(v, depth + 1); });
        } else {
          Object.values(obj).forEach(v => { if (v && typeof v === 'object') walkTemuInitData(v, depth + 1); });
        }
      }

      walkTemuInitData(temuData, 0);
    }
  } catch (_) {}

  // ── Price: Strategy 2 — DOM selectors (specific → generic) ────────────
  if (!r.price) {
    r.price = priceFromSelectors([
      // Temu uses CSS modules — look for price-like classes avoiding strikethrough
      '[data-testid="price"]', '[data-testid="selling-price"]',
      '[data-testid*="current-price"]', '[data-testid*="sale-price"]',
      '[class*="price-sale"]', '[class*="priceSale"]',
      '[class*="price-current"]', '[class*="priceCurrent"]',
      '[class*="price-actual"]', '[class*="priceActual"]',
      '[class*="selling-price"]', '[class*="sellingPrice"]',
      '[class*="current-price"]', '[class*="currentPrice"]',
      // Avoid crossed-out / original prices
      '[class*="price"]:not([class*="origin"]):not([class*="Origin"]):not([class*="delete"]):not([class*="Delete"]):not([class*="slash"]):not([class*="Strike"]):not([class*="before"]):not([class*="through"]):not([class*="line-through"]):not([class*="Before"])',
      '[class*="Price"]:not([class*="Origin"]):not([class*="Before"]):not([class*="Cross"]):not([class*="Strike"])',
      // aria-label price
      '[aria-label*="price" i]', '[aria-label*="Price" i]'
    ]);
    if (r.price) r.price = ensureCurrency(r.price, sym);
  }

  // ── Price: Strategy 3 — inline script regex (multiple patterns) ───────
  if (!r.price) {
    for (const s of document.querySelectorAll('script:not([src])')) {
      const t = s.textContent || '';
      if (t.length < 50 || t.length > 4_000_000) continue;
      if (!/sale_price|actual_price|display_price|price_str|priceStr|promotionPrice/.test(t)) continue;

      // Temu cents prices (integer, divide by 100)
      const centsMatch = t.match(/"(?:sale_price|salePrice|actual_price|actualPrice|promotion_price|promotionPrice)"\s*:\s*(\d{2,6})(?![.\d])/);
      if (centsMatch) {
        const cents = parseInt(centsMatch[1]);
        if (cents > 0) { r.price = `${sym}${(cents / 100).toFixed(2)}`; break; }
      }
      // String price with currency: "display_price":"$8.99"
      const strMatch = t.match(/"(?:display_price|price_str|priceStr|formatted_price|formattedPrice)"\s*:\s*"([^"]+)"/);
      if (strMatch) {
        const c = cleanPriceText(strMatch[1]);
        if (c) { r.price = ensureCurrency(c, sym); break; }
      }
      // Float prices: "price":8.99
      const floatMatch = t.match(/"(?:price|salePrice|sale_price)"\s*:\s*(\d+\.\d{1,2})(?![\d])/);
      if (floatMatch) {
        const v = parseFloat(floatMatch[1]);
        if (v > 0) { r.price = `${sym}${v.toFixed(2)}`; break; }
      }
    }
  }

  // ── Images: Strategy 2 — inline scripts (fallback when __init_data__ had no images) ──
  // FIX A2: apply temuOriginUrl() so CDN thumbnail URLs become full-resolution
  if (r.images.length === 0) {
    const scriptTexts = [];
    document.querySelectorAll('script:not([src])').forEach(s => {
      const t = s.textContent || '';
      if (t.includes('origin_url') || t.includes('original_img_url') || t.includes('img_url') || t.includes('goods_gallery')) {
        scriptTexts.push(t);
      }
    });

    for (const t of scriptTexts) {
      for (const m of t.matchAll(/"origin_url"\s*:\s*"(https?:[^"]+)"/g)) {
        const u = temuOriginUrl(m[1].replace(/\\/g, '').replace(/\//g, '/'));
        if (!isBadImage(u) && !r.images.includes(u)) r.images.push(u);
      }
      if (r.images.length === 0) {
        for (const m of t.matchAll(/"original_img_url"\s*:\s*"(https?:[^"]+)"/g)) {
          const u = temuOriginUrl(m[1].replace(/\\/g, '').replace(/\//g, '/'));
          if (!isBadImage(u) && !r.images.includes(u)) r.images.push(u);
        }
      }
      if (r.images.length === 0) {
        for (const m of t.matchAll(/"img_url"\s*:\s*"(https?:[^"]+)"/g)) {
          const u = temuOriginUrl(m[1].replace(/\\/g, '').replace(/\//g, '/'));
          if (!isBadImage(u) && !r.images.includes(u)) r.images.push(u);
        }
      }
    }
  }

  // ── Images: Strategy 3 — application/json scripts ──
  // FIX A2: apply temuOriginUrl() here too
  if (r.images.length === 0) {
    document.querySelectorAll('script[type="application/json"]').forEach(s => {
      try {
        const data = JSON.parse(s.textContent || '{}');
        function walkTemuJson(obj, d) {
          if (!obj || typeof obj !== 'object' || d > 12) return;
          if (Array.isArray(obj)) { obj.forEach(v => walkTemuJson(v, d + 1)); return; }
          const rawUrl = obj.origin_url || obj.original_img_url || obj.img_url || '';
          if (typeof rawUrl === 'string' && rawUrl && /\.(jpg|jpeg|png|webp)/i.test(rawUrl) && !isBadImage(rawUrl)) {
            const u = temuOriginUrl(rawUrl);
            if (!r.images.includes(u)) r.images.push(u);
          }
          Object.values(obj).forEach(v => { if (v && typeof v === 'object') walkTemuJson(v, d + 1); });
        }
        walkTemuJson(data, 0);
      } catch (_) {}
    });
  }

  // ── Images: Strategy 4 — DOM gallery scan ──
  // FIX A2: temuOriginUrl() already applied here (was the only working strategy before)
  if (r.images.length === 0) {
    const galleryScope = document.querySelector(
      '[class*="goods-gallery"], [class*="GoodsGallery"], [class*="image-view"], ' +
      '[class*="swiper-wrapper"], [class*="gallery-container"], ' +
      '[data-testid*="gallery"], [data-testid*="image"]'
    ) || findProductGalleryContainer() || document;

    galleryScope.querySelectorAll('img').forEach(img => {
      if (isBadImageElement(img)) return;
      const src = pickImgSrc(img);
      if (!src || isBadImage(src)) return;
      const clean = temuOriginUrl(src);
      r.images.push(clean);
    });
  }

  // ── Videos: Strategy 2 — inline script regex (A3 fallback) ──────────
  if (r.videos.length === 0) {
    for (const s of document.querySelectorAll('script:not([src])')) {
      const t = s.textContent || '';
      if (t.length < 50 || t.length > 4_000_000) continue;
      if (!/video_url|videoUrl|video_src|goods_video|mp4_url|media_url/.test(t)) continue;

      const vidMatches = t.matchAll(/"(?:video_url|videoUrl|video_src|goods_video_url|product_video|mp4_url|media_url)"\s*:\s*"(https?:[^"]+\.(?:mp4|webm|m3u8)[^"]*)"/gi);
      for (const m of vidMatches) {
        const v = m[1].replace(/\\\//g, '/');
        if (!r.videos.includes(v)) r.videos.push(v);
      }
      if (r.videos.length > 0) break;
    }
  }

  return r;
}

function scrapeEbay() {
  const r = { title: '', price: '', images: [], videos: [], variants: [] };
  const t = document.querySelector('h1.x-item-title__mainTitle span, h1[itemprop="name"], h1.product-title, .x-item-title span');
  if (t) r.title = t.innerText.trim();
  const pe = document.querySelector('.x-price-primary .ux-textspans, [itemprop="price"], #prcIsum, .x-bin-price__content .ux-textspans');
  if (pe) {
    const raw = pe.getAttribute('content') || pe.innerText;
    r.price = cleanPriceText(raw) || (pe.getAttribute('content') ? `$${pe.getAttribute('content')}` : '');
    if (r.price) r.price = ensureCurrency(r.price, detectPageCurrencySymbol());
  }

  const galleryScope = document.querySelector('#vi-main-img-fs, .ux-image-carousel, [class*="image-carousel"]') || findProductGalleryContainer() || document;
  collectImagesBySelector('#vi-main-img-fs img, .ux-image-carousel img, [class*="image-carousel"] img, .img img', galleryScope)
    .forEach(s => r.images.push(s.replace(/s-l\d+/g, 's-l1600')));
  return r;
}

function scrapeDaraz() {
  const r = { title: '', price: '', images: [], videos: [], variants: [] };
  const t = document.querySelector('.pdp-name, h1, [class*="title"]');
  if (t) r.title = t.innerText.trim();
  r.price = priceFromSelectors(['.pdp-price', '[class*="price"]']);

  const galleryScope = document.querySelector('.gallery-preview-panel, .pdp-gallery, [class*="ImageGallery"]') || findProductGalleryContainer() || document;
  collectImagesBySelector('.gallery-preview-panel img, [class*="gallery"] img, .pdp-image img', galleryScope).forEach(s => r.images.push(s));
  return r;
}

function scrapeShopify() {
  const r = { title: '', price: '', images: [], videos: [], variants: [] };
  const t = document.querySelector('.product__title, .product-single__title, h1, [class*="product-title"]');
  if (t) r.title = t.innerText.trim();
  r.price = priceFromSelectors([
    '.product__price', '.price', '[class*="product-price"]',
    '[data-product-price]', '.price-item--sale', '.price-item--regular',
    '.woocommerce-Price-amount'   // WooCommerce uses same fallback
  ]);
  if (r.price) r.price = ensureCurrency(r.price, detectPageCurrencySymbol());

  const galleryScope = document.querySelector(
    '.product__media-wrapper, .woocommerce-product-gallery, ' +
    '[class*="product-gallery"], [class*="ProductGallery"], ' +
    '[class*="product-images"], [class*="ProductImages"]'
  ) || findProductGalleryContainer() || document;

  collectImagesBySelector('.product__media img, .product-single__photo img, .product-featured-media img, [class*="product-image"] img, .woocommerce-product-gallery__image img', galleryScope)
    .forEach(s => r.images.push(s.replace(/_(small|medium|compact|large|grande|master|\d+x\d*)(?=[._])/, '_1200x1200')));
  return r;
}

// ── ISSUE 3 FIX: Flipkart scraper ───────────────────────────
function scrapeFlipkart() {
  const r = { title: '', price: '', images: [], videos: [], variants: [] };
  const t = document.querySelector('span[class*="B_NuCI"], h1, [class*="product-title"]');
  if (t) r.title = t.innerText.trim();
  r.price = priceFromSelectors([
    '._30jeq3._16Jk6d', '._30jeq3', '[class*="finalPrice"]', '[class*="price"]'
  ]);
  if (r.price) r.price = ensureCurrency(r.price, '₹');

  const galleryScope = document.querySelector('._3kidJX, [class*="imgWrapper"], [class*="ImageGallery"]') || findProductGalleryContainer() || document;
  collectImagesBySelector('._2r_T1I img, ._3kidJX img, [class*="productImage"] img, [class*="imgWrapper"] img', galleryScope)
    .forEach(s => r.images.push(s.replace(/\/\d+\/\d+(\/\d+)?(?=\/)/, '/832/832')));
  return r;
}

// ── ISSUE 3 FIX: Noon scraper ───────────────────────────────
function scrapeNoon() {
  const r = { title: '', price: '', images: [], videos: [], variants: [] };
  const t = document.querySelector('h1, [class*="productTitle"], [class*="product-title"]');
  if (t) r.title = t.innerText.trim();
  r.price = priceFromSelectors(['.priceNow', '.price-now', '[class*="sellingPrice"]', '[class*="price"]']);
  if (r.price) r.price = ensureCurrency(r.price, detectPageCurrencySymbol());

  const galleryScope = document.querySelector('[class*="imageGallery"], [class*="ImageGallery"]') || findProductGalleryContainer() || document;
  collectImagesBySelector('[class*="productImage"] img, [class*="imageGallery"] img', galleryScope).forEach(s => r.images.push(s));
  return r;
}

// ── ISSUE 3 FIX: Etsy scraper ───────────────────────────────
function scrapeEtsy() {
  const r = { title: '', price: '', images: [], videos: [], variants: [] };
  const t = document.querySelector('h1, [class*="listing-page-title"], [data-buy-box-listing-title]');
  if (t) r.title = t.innerText.trim();
  r.price = priceFromSelectors([
    '[class*="wt-text-title-larger"]', '[class*="currency-value"]',
    'p[class*="price"]', '[class*="price-is"]'
  ]);
  if (r.price) r.price = ensureCurrency(r.price, detectPageCurrencySymbol());

  const galleryScope = document.querySelector('.listing-page-image-carousel, [class*="carousel-pane"]') || findProductGalleryContainer() || document;
  collectImagesBySelector('.listing-page-image-carousel img, [class*="carousel-pane"] img, [data-image-carousel] img', galleryScope)
    .forEach(s => r.images.push(s.replace(/\/il_\d+x[N0-9]+\./, '/il_fullxfull.')));
  return r;
}

// ── ISSUE 3 FIX: Shein scraper ──────────────────────────────
function scrapeShein() {
  const r = { title: '', price: '', images: [], videos: [], variants: [] };
  const t = document.querySelector('h1, [class*="goods-name"], [class*="product-intro__head-name"]');
  if (t) r.title = t.innerText.trim();
  r.price = priceFromSelectors([
    '[class*="product-intro__price-current"]', '[class*="original"][class*="price"]',
    '[class*="price-new"]', '[class*="goods-price"]', '[class*="price"]'
  ]);
  if (r.price) r.price = ensureCurrency(r.price, detectPageCurrencySymbol());

  const galleryScope = document.querySelector('[class*="product-intro__main-pic"], [class*="ProductGallery"]') || findProductGalleryContainer() || document;
  collectImagesBySelector('[class*="product-intro__main-pic"] img, [class*="gallery"] img, [class*="ProductGallery"] img', galleryScope).forEach(s => r.images.push(s));
  return r;
}

function scrapeYouTube() {
  const r = { title: '', price: '', images: [], videos: [], variants: [] };
  const params = new URLSearchParams(location.search);
  let videoId = params.get('v');
  if (!videoId && location.pathname.includes('/shorts/')) videoId = location.pathname.split('/shorts/')[1]?.split('/')[0];
  if (!videoId && location.hostname.includes('youtu.be')) videoId = location.pathname.slice(1).split('/')[0];

  const t = document.querySelector(
    'h1.ytd-video-primary-info-renderer, h1.ytd-watch-metadata yt-formatted-string, ' +
    '#title h1 yt-formatted-string, h1[class*="title"], meta[property="og:title"]'
  );
  r.title = (t?.content || t?.innerText || document.title || '').replace(/ - YouTube$/, '').trim();

  if (videoId) {
    r.videos.push(`https://www.youtube.com/watch?v=${videoId}`);
    r.images.push(`https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`);
    r.images.push(`https://img.youtube.com/vi/${videoId}/hqdefault.jpg`);
  }
  return r;
}

// ── Golf Retail scraper (Shopify based) ────────────────────────
function scrapeGolfRetail() {
  const r = { title: '', price: '', images: [], videos: [], variants: [] };
  const sym = detectPageCurrencySymbol() || '$';

  const titleEl = document.querySelector('h1.product-title, h1.product__title, [data-product-title], h1');
  if (titleEl) r.title = titleEl.innerText.trim();

  r.price = priceFromSelectors([
    '[class*="price"] .money', '[data-price]', '[class*="product-price"]', '.price'
  ]);
  if (r.price) r.price = ensureCurrency(r.price, sym);

  const galleryScope = document.querySelector(
    '.product-gallery, [class*="product-image"], [class*="product__media"]'
  ) || findProductGalleryContainer() || document;

  collectImagesBySelector(
    '[class*="product-image"] img, [class*="product__media"] img, .product-gallery img',
    galleryScope
  ).forEach(s => {
    if (!isBadImage(s)) {
      const large = s
        .replace(/_(\d+)x(\d+)(\.[a-z]+)(\?|$)/i, '_1200x$3$4')
        .replace(/_(\d+)x(\.[a-z]+)(\?|$)/i, '_1200x$2$3');
      r.images.push(large);
    }
  });

  return r;
}

// ── World Wide Golf Balls / Worldwide Golf Shops scraper ─────
// Both worldwidegolfballs.com and worldwidegolfshops.com
function scrapeWorldwideGolfBalls() {
  const r = { title: '', price: '', images: [], videos: [], variants: [] };

  const titleEl = document.querySelector(
    'h1.product__title, h1.product-single__title, h1.product-title, ' +
    '.product__title h1, [class*="product-title"], h1'
  );
  if (titleEl) r.title = titleEl.innerText.trim();

  r.price = priceFromSelectors([
    '.price-item--sale', '.price-item--regular',
    '.product__price .price', '[class*="product-price"]',
    '.price', '[data-product-price]', '[itemprop="price"]'
  ]);
  if (r.price) r.price = ensureCurrency(r.price, '$');

  // ISSUE 4 FIX: Use exact strict selectors from Images Tab
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
    r.images.push(large);
  });

  r._strictImages = true;

  return r;
}

// ── Upgrade 1: Target, Costco, Home Depot, Best Buy ────────────────
function scrapeTarget() {
  const r = { title: '', price: '', images: [], videos: [], variants: [] };
  const sym = detectPageCurrencySymbol() || '$';
  const titleEl = document.querySelector('[data-test="product-title"], h1[class*="Heading"]');
  if (titleEl) r.title = titleEl.innerText.trim();
  r.price = priceFromSelectors(['[data-test="product-price"]', '[data-test="current-price"]', '[class*="Price"] span']);
  if (r.price) r.price = ensureCurrency(r.price, sym);
  const galleryScope = findProductGalleryContainer() || document;
  collectImagesBySelector('[data-test="image-gallery"] img, [class*="Gallery"] img', galleryScope).forEach(s => {
    if (!isBadImage(s) && !r.images.includes(s)) r.images.push(s);
  });
  return r;
}

function scrapeCostco() {
  const r = { title: '', price: '', images: [], videos: [], variants: [] };
  const sym = detectPageCurrencySymbol() || '$';
  const titleEl = document.querySelector('h1[automation-id="productName"], h1[itemprop="name"]');
  if (titleEl) r.title = titleEl.innerText.trim();
  r.price = priceFromSelectors(['[automation-id="productPrice"]', '.value.product-price']);
  if (r.price) r.price = ensureCurrency(r.price, sym);
  const galleryScope = findProductGalleryContainer() || document;
  collectImagesBySelector('#product-images img, [automation-id="productImage"] img', galleryScope).forEach(s => {
    if (!isBadImage(s) && !r.images.includes(s)) r.images.push(s);
  });
  return r;
}

function scrapeHomeDepot() {
  const r = { title: '', price: '', images: [], videos: [], variants: [] };
  const sym = detectPageCurrencySymbol() || '$';
  const titleEl = document.querySelector('h1[class*="product-title"], h1[class*="product-details__title"]');
  if (titleEl) r.title = titleEl.innerText.trim();
  const w = document.querySelector('.price-format__main-price')?.innerText.trim() || '';
  const f = document.querySelector('.price-format__fraction')?.innerText.trim() || '00';
  if (w) r.price = `$${w}.${f}`;
  if (!r.price) r.price = priceFromSelectors(['[class*="price"]']);
  if (r.price) r.price = ensureCurrency(r.price, sym);
  const galleryScope = findProductGalleryContainer() || document;
  collectImagesBySelector('.mediagallery__mainimage img, [class*="media-gallery"] img', galleryScope).forEach(s => {
    if (!isBadImage(s) && !r.images.includes(s)) r.images.push(s);
  });
  return r;
}

function scrapeBestBuy() {
  const r = { title: '', price: '', images: [], videos: [], variants: [] };
  const sym = detectPageCurrencySymbol() || '$';
  const titleEl = document.querySelector('h1.sku-title, [class*="product-title"]');
  if (titleEl) r.title = titleEl.innerText.trim();
  r.price = priceFromSelectors(['.priceView-customer-price span[aria-hidden="true"]', '.priceView-hero-price span']);
  if (r.price) r.price = ensureCurrency(r.price, sym);
  const galleryScope = findProductGalleryContainer() || document;
  collectImagesBySelector('.primary-image-container img, .shop-media-gallery img', galleryScope).forEach(s => {
    if (!isBadImage(s) && !r.images.includes(s)) r.images.push(s);
  });
  return r;
}

// ── ISSUE 3 FIX: Universal generic scraper ───────────────────
// Works on any e-commerce site with JSON-LD or structured markup.
function scrapeGeneric() {
  const r = { title: '', price: '', images: [], videos: [], variants: [] };
  const og = document.querySelector('meta[property="og:title"]');
  r.title = og?.content || document.title || '';

  // Try JSON-LD product title first
  document.querySelectorAll('script[type="application/ld+json"]').forEach(s => {
    try {
      const j = JSON.parse(s.textContent || '{}');
      const stack = Array.isArray(j) ? [...j] : [j];
      while (stack.length) {
        const it = stack.shift();
        if (!it || typeof it !== 'object') continue;
        if (!r.title && it.name && /Product|Offer/i.test(it['@type'] || '')) {
          r.title = String(it.name).trim();
        }
        if (it.image) {
          (Array.isArray(it.image) ? it.image : [it.image]).forEach(x => {
            const u = typeof x === 'string' ? x : (x.url || x.contentUrl || '');
            if (u && !isBadImage(u)) r.images.push(u);
          });
        }
        Object.values(it).forEach(v => { if (v && typeof v === 'object') stack.push(v); });
      }
    } catch (_) {}
  });

  const ogImg = document.querySelector('meta[property="og:image"]');
  if (ogImg?.content && !isBadImage(ogImg.content)) r.images.push(ogImg.content);

  // ISSUE 1 FIX: Use universalPrice() with currency-symbol detection
  r.price = universalPrice();

  // ISSUE 4 FIX: Images only from product gallery area
  const galleryScope = findProductGalleryContainer();
  if (galleryScope) {
    collectScopedImages(galleryScope)
      .filter(src => !isBadImage(src))
      .forEach(src => r.images.push(src));
  } else {
    // Fallback: only images meeting minimum dimensions, skip known bad patterns
    Array.from(document.querySelectorAll('img'))
      .filter(img => {
        if (isBadImage(img.src || '')) return false;
        // Skip images in known non-product sections
        const ancestor = img.closest(
          'footer, header, nav, [class*="recommend"], [class*="similar"], ' +
          '[class*="related"], [class*="review"], [class*="cart"], ' +
          '[class*="checkout"], [class*="sidebar"], [class*="widget"], ' +
          '[class*="ad-"], [class*="promo"], [id*="footer"], [id*="header"]'
        );
        if (ancestor) return false;
        const w = img.naturalWidth || parseInt(img.getAttribute('width') || '0');
        const h = img.naturalHeight || parseInt(img.getAttribute('height') || '0');
        if (w && w < 200) return false;
        if (h && h < 200) return false;
        return true;
      })
      .slice(0, 12)
      .forEach(img => r.images.push(img.src));
  }

  return r;
}

// ── Enhancement (Merge) ──────────────────────────────────────
function mergeUnique(target, items, keyFn) {
  const seen = new Set(target.map(keyFn));
  for (const it of items) {
    const k = keyFn(it);
    if (k && !seen.has(k)) {
      seen.add(k);
      target.push(it);
    }
  }
  return target;
}

async function enhanceWithGlobals(data) {
  data.images   = [...new Set((data.images || []).filter(Boolean))];
  data.videos   = [...new Set((data.videos || []).filter(Boolean))];
  data.variants = data.variants || [];

  const harvested = await harvestInlineJson();

  const scItemId = data._scItemId || '';
  const isSamsClubPage = /samsclub\.com/i.test(location.hostname);
  let harvestedImages = harvested.images;
  if (isSamsClubPage && scItemId) {
    const filtered = harvestedImages.filter(u => u.includes(scItemId));
    if (filtered.length > 0) harvestedImages = filtered;
  }

  // ISSUE 2 FIX: Filter harvested images through isBadImage before merging
  harvestedImages = harvestedImages.filter(u => !isBadImage(u));

  // Only merge JSON harvested images if the platform doesn't have a strict DOM image scraper
  if (!data._strictImages) {
    mergeUnique(data.images, harvestedImages, canonImageKey);
  }
  
  mergeUnique(data.videos, harvested.videos, x => (YT_REGEX.test(x) ? ytWatch(x) : x));

  // ISSUE 1 FIX: Only use harvested price if it has a currency symbol
  if (!data.price && harvested.price && /[$£€¥₹₩]/.test(harvested.price)) {
    data.price = harvested.price;
  }

  // OG / twitter image fallbacks — use mergeUnique so they don't duplicate
  // images already collected from the gallery or JSON harvest.
  const ogImages = [];
  document.querySelectorAll('meta[property="og:image"], meta[property="og:image:secure_url"], meta[name="twitter:image"]')
    .forEach(m => { if (m.content && !isBadImage(m.content)) ogImages.push(m.content); });
  mergeUnique(data.images, ogImages, canonImageKey);

  // OG video fallbacks
  document.querySelectorAll('meta[property="og:video"], meta[property="og:video:url"], meta[property="og:video:secure_url"], meta[name="twitter:player:stream"]')
    .forEach(m => { if (m.content) data.videos.push(m.content); });

  if (!data.title) {
    const og = document.querySelector('meta[property="og:title"]');
    data.title = og?.content || document.title || '';
  }

  return data;
}


// ═══════════════════════════════════════════════════════════════
// v8.4.0 — Product details extractor (brand / color / weight / dims / bullets)
// Runs after the platform scraper; only fills fields the scraper left empty.
// ═══════════════════════════════════════════════════════════════
const DETAIL_LABELS = {
  brand:  /^(brand|brand name|manufacturer)$/i,
  weight: /^(item weight|product weight|weight|package weight|shipping weight|net weight|assembled product weight)$/i,
  dims:   /^(?:(?:product|package|item|assembled product|parcel|box)\s+)?dimensions?(?:\s*\(?\s*l\s*x\s*w\s*x\s*h\s*\)?)?$/i,
  color:  /^(color|colour|actual color|color name)$/i
};

function txt(el) { return (el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim(); }

// "1.4 pounds" / "22.4 ounces" / "635 g" / "0.64 kg" → lb (1 decimal, string) or ''
function parseWeightLb(raw) {
  if (!raw) return '';
  const m = String(raw).replace(/,/g, '').match(/(\d+(?:\.\d+)?)\s*(pounds?|lbs?|lb\.|ounces?|oz\.?|kilograms?|kgs?|kg\.|grams?|g\b)/i);
  if (!m) return '';
  let v = parseFloat(m[1]); const u = m[2].toLowerCase();
  if (/^(ounce|oz)/.test(u)) v = v / 16;
  else if (/^(kilogram|kg)/.test(u)) v = v * 2.20462;
  else if (/^(gram|g)/.test(u)) v = v / 453.592;
  if (!isFinite(v) || v <= 0) return '';
  return String(Math.max(0.1, Math.round(v * 10) / 10));
}

// "7.5 x 5.2 x 1.5 inches" / "19 x 13 x 4 cm" / '7.5"L x 5.2"W x 1.5"H' → {dimL, dimW, dimH} in inches
function parseDimsIn(raw) {
  if (!raw) return null;
  const s = String(raw).replace(/,/g, '');
  const m = s.match(/(\d+(?:\.\d+)?)\s*(?:"|in(?:ch(?:es)?)?|cm|mm)?\s*[LlWwHhDd]?\s*[x×X]\s*(\d+(?:\.\d+)?)\s*(?:"|in(?:ch(?:es)?)?|cm|mm)?\s*[LlWwHhDd]?\s*[x×X]\s*(\d+(?:\.\d+)?)\s*("|in(?:ch(?:es)?)?|cm|mm)?/);
  if (!m) return null;
  let a = parseFloat(m[1]), b = parseFloat(m[2]), c = parseFloat(m[3]);
  const unit = (m[4] || (/\bcm\b/i.test(s) ? 'cm' : /\bmm\b/i.test(s) ? 'mm' : 'in')).toLowerCase();
  const f = unit === 'cm' ? 0.393701 : unit === 'mm' ? 0.0393701 : 1;
  const r1 = v => String(Math.max(0.1, Math.round(v * f * 10) / 10));
  if (![a, b, c].every(v => isFinite(v) && v > 0)) return null;
  return { dimL: r1(a), dimW: r1(b), dimH: r1(c) };
}

function cleanBrand(b) {
  b = String(b || '').replace(/^(visit the|brand:|by)\s+/i, '').replace(/\s+store$/i, '').replace(/\s+/g, ' ').trim();
  return b.length > 1 && b.length <= 60 ? b : '';
}

// Read any label/value spec table into a {labelLower: value} map
function readSpecTables(scopeSelectors) {
  const map = {};
  const add = (k, v) => { k = txt(k).replace(/[:：]\s*$/, '').toLowerCase(); v = txt(v); if (k && v && !map[k]) map[k] = v; };
  scopeSelectors.forEach(sel => {
    document.querySelectorAll(sel).forEach(scope => {
      scope.querySelectorAll('tr').forEach(tr => {
        const cells = tr.querySelectorAll('th, td');
        if (cells.length >= 2) add(cells[0], cells[1]);
      });
      scope.querySelectorAll('dt').forEach(dt => { const dd = dt.nextElementSibling; if (dd && dd.tagName === 'DD') add(dt, dd); });
      scope.querySelectorAll('li').forEach(li => {
        const t = txt(li); const m = t.match(/^([^:：]{2,40})[:：]\s*(.+)$/); if (m) add(m[1], m[2]);
      });
    });
  });
  return map;
}

function specLookup(map, re) {
  for (const k of Object.keys(map)) if (re.test(k)) return map[k];
  return '';
}

function jsonLdProduct() {
  for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const j = JSON.parse(s.textContent);
      const arr = Array.isArray(j) ? j : (j['@graph'] || [j]);
      for (const o of arr) if (o && /Product/i.test(String(o['@type']))) return o;
    } catch (_) {}
  }
  return null;
}

function extractProductDetails(platform) {
  const d = { brand: '', color: '', weight: '', dimL: '', dimW: '', dimH: '', bullets: [] };
  const h = host();
  try {
    // ── Amazon ──
    if (h.includes('amazon.')) {
      d.brand = cleanBrand(txt(document.querySelector('tr.po-brand td.a-span9, #bylineInfo, #brand')));
      const sel = document.querySelector('#variation_color_name .selection, #inline-twister-expanded-dimension-text-color_name, #twister .selection');
      d.color = txt(sel);
      const spec = readSpecTables(['#productDetails_techSpec_section_1', '#productDetails_detailBullets_sections1', '#productDetails_techSpec_section_2',
        '#detailBullets_feature_div', '#prodDetails', '#technicalSpecifications_section_1', '.a-keyvalue', '#productOverview_feature_div']);
      d.weight = parseWeightLb(specLookup(spec, DETAIL_LABELS.weight));
      Object.assign(d, parseDimsIn(specLookup(spec, DETAIL_LABELS.dims)) || {});
      if (!d.color) d.color = specLookup(spec, DETAIL_LABELS.color);
      if (!d.brand) d.brand = cleanBrand(specLookup(spec, DETAIL_LABELS.brand));
      document.querySelectorAll('#feature-bullets li span.a-list-item, #productFactsDesktopExpander li span.a-list-item').forEach(li => {
        const t = txt(li); if (t && t.length > 3 && !/^(make sure this fits|see more product details)/i.test(t)) d.bullets.push(t);
      });
    }
    // ── Walmart / Sam's Club (same front-end family) ──
    else if (h.includes('walmart.') || h.includes('samsclub.com')) {
      d.brand = cleanBrand(txt(document.querySelector('a[data-testid="product-brand-link"], [link-identifier="brandName"], [data-testid="brand-link"], a[href*="/brand/"], .prod-brandName, [class*="brand-name" i]')));
      // selected variant chip / "Actual Color: White"
      const chip = document.querySelector('[data-testid="variant-group"] [aria-checked="true"], [aria-pressed="true"][data-testid*="variant" i], .variant-option.selected, [class*="selected" i][class*="variant" i]');
      const chipTxt = txt(chip?.getAttribute?.('aria-label') ? { innerText: chip.getAttribute('aria-label') } : chip);
      d.color = chipTxt.length <= 30 ? chipTxt : '';
      document.querySelectorAll('[data-testid="variant-group"], [class*="variant" i]').forEach(g => {
        const m = txt(g).match(/(?:actual color|color|colour)\s*:\s*([A-Za-z][A-Za-z \/-]{1,30})/i); if (m && !d.color) d.color = m[1].trim();
      });
      const spec = readSpecTables(['[data-testid="product-specifications"]', '[data-testid="ui-collapse-panel"]', '#specifications', '.specifications', 'section[aria-label*="Specifications" i]', '[class*="specification" i]', 'main']);
      d.weight = parseWeightLb(specLookup(spec, DETAIL_LABELS.weight));
      Object.assign(d, parseDimsIn(specLookup(spec, DETAIL_LABELS.dims)) || {});
      if (!d.color) d.color = specLookup(spec, DETAIL_LABELS.color);
      if (!d.brand) d.brand = cleanBrand(specLookup(spec, DETAIL_LABELS.brand));
      document.querySelectorAll('[data-testid="product-description-content"] li, .about-desc li, [class*="about" i] li').forEach(li => { const t = txt(li); if (t && t.length > 3) d.bullets.push(t); });
    }
    // ── Generic: JSON-LD + any spec table ──
    const ld = jsonLdProduct();
    if (ld) {
      if (!d.brand) d.brand = cleanBrand(typeof ld.brand === 'string' ? ld.brand : (ld.brand?.name || ''));
      if (!d.color && typeof ld.color === 'string') d.color = ld.color;
      if (!d.weight && ld.weight) d.weight = parseWeightLb(typeof ld.weight === 'string' ? ld.weight : `${ld.weight.value} ${ld.weight.unitCode === 'KGM' ? 'kg' : ld.weight.unitCode === 'GRM' ? 'g' : ld.weight.unitText || 'lb'}`);
    }
    if (!d.brand) d.brand = cleanBrand(document.querySelector('meta[property="product:brand"], meta[itemprop="brand"]')?.content || txt(document.querySelector('[itemprop="brand"]')));
    if (!d.weight || !d.dimL) {
      const spec = readSpecTables(['table', 'dl', '[class*="spec" i]', '[class*="detail" i]']);
      if (!d.weight) d.weight = parseWeightLb(specLookup(spec, DETAIL_LABELS.weight));
      if (!d.dimL) Object.assign(d, parseDimsIn(specLookup(spec, DETAIL_LABELS.dims)) || {});
      if (!d.color) d.color = specLookup(spec, DETAIL_LABELS.color);
      if (!d.brand) d.brand = cleanBrand(specLookup(spec, DETAIL_LABELS.brand));
    }
  } catch (_) {}
  d.color = String(d.color || '').replace(/^(color|colour|actual color)\s*:\s*/i, '').replace(/\s+/g, ' ').trim().slice(0, 40);
  if (/^(select|choose|—|-)$/i.test(d.color)) d.color = '';
  d.bullets = [...new Set(d.bullets.map(b => b.slice(0, 700)))].slice(0, 6);
  return d;
}

// ── ISSUE 3 FIX: Dispatcher — expanded platform detection ────
function pickPlatform() {
  const h = host();
  if (h.includes('amazon.'))                                  return scrapeAmazon;
  if (h.endsWith('walmart.com') || h.includes('walmart.'))   return scrapeWalmart;
  if (h.includes('samsclub.com'))                             return scrapeSamsClub;
  if (h.includes('faire.com'))                               return scrapeFaire;
  if (h.includes('alibaba.com'))                             return scrapeAlibaba;
  if (h.includes('aliexpress.'))                             return scrapeAliExpress;
  if (h.includes('temu.com') || h.includes('temu.'))         return scrapeTemu;
  if (h.includes('ebay.'))                                   return scrapeEbay;
  if (h.includes('daraz.'))                                  return scrapeDaraz;
  if (h.includes('flipkart.com'))                            return scrapeFlipkart;
  if (h.includes('noon.com'))                                return scrapeNoon;
  if (h.includes('etsy.com'))                                return scrapeEtsy;
  if (h.includes('shein.com'))                               return scrapeShein;
  if (h.includes('youtube.com') || h.includes('youtu.be'))   return scrapeYouTube;
  if (h.includes('worldwidegolfballs.com') || h.includes('worldwidegolfshops.com')) return scrapeWorldwideGolfBalls;
  if (h.includes('worldgolfshop.com') || h.includes('golf.com') || h.includes('rockbottomgolf.com')) return scrapeGolfRetail;
  if (h.includes('target.com'))                              return scrapeTarget;
  if (h.includes('costco.com'))                              return scrapeCostco;
  if (h.includes('homedepot.com'))                           return scrapeHomeDepot;
  if (h.includes('bestbuy.com'))                             return scrapeBestBuy;
  // Detect Shopify and WooCommerce by DOM signals
  if (document.querySelector(
    '[data-product-form], form[action*="/cart/add"], ' +
    '.woocommerce-product-gallery, body.woocommerce, ' +
    '[class*="shopify"], meta[name="shopify-digital-wallet"]'
  )) return scrapeShopify;
  // Detect BigCommerce
  if (document.querySelector('[data-product-option-change], [class*="ProductView"], .productView')) return scrapeShopify;
  // Fallback: check JSON-LD for Product type — use generic with full power
  return scrapeGeneric;
}

async function scrapePageData() {
  let data;
  try {
    const platformFn = pickPlatform();
    data = await platformFn() || {};
  } catch (_) {
    data = { title: document.title || '', price: '', images: [], videos: [], variants: [] };
  }

  data = await enhanceWithGlobals(data);

  // Centralized: collect DOM videos not already found by platform scraper
  try {
    collectDomVideos().forEach(v => {
      if (!data.videos.includes(v)) data.videos.push(v);
    });
  } catch(_) {}
  // Centralized: collect variants if platform scraper found none
  if (!data.variants || data.variants.length === 0) {
    try { data.variants = collectVariants(); } catch(_) {}
  }

  // v8.4.0: brand / color / weight / dimensions / bullets
  try {
    const det = extractProductDetails();
    ['brand', 'color', 'weight', 'dimL', 'dimW', 'dimH'].forEach(k => { if (!data[k]) data[k] = det[k] || ''; });
    if (!Array.isArray(data.bullets) || !data.bullets.length) data.bullets = det.bullets;
  } catch (_) {
    data.brand = data.brand || ''; data.color = data.color || ''; data.bullets = data.bullets || [];
  }

  data.url      = location.href;
  // Filter out transient browser states ("Adding to Cart...", "Loading...", etc.)
  // that Amazon and other sites temporarily set as the page/tab title.
  const BAD_TITLE = /^(adding to cart|add to cart|added to cart|loading\.\.\.|please wait\.\.\.?|checkout|your amazon\.com cart|amazon\.com shopping cart|cart|processing)/i;
  const docTitle = BAD_TITLE.test((document.title || '').trim()) ? '' : document.title;
  const candidateTitle = (data.title || docTitle || '').trim();
  data.title = BAD_TITLE.test(candidateTitle) ? '' : candidateTitle;

  // ISSUE 1 FIX: Ensure price has a currency symbol — detect from page
  if (data.price && !/[$£€¥₹₩]/.test(data.price) && !/^(USD|CAD|AUD|GBP|EUR|PKR|INR)/i.test(data.price)) {
    const sym = detectPageCurrencySymbol();
    data.price = `${sym}${data.price}`;
  }

  data.images   = dedupeImages(data.images).slice(0, IMG_CAP);
  data.videos   = dedupeVideos(data.videos).slice(0, VID_CAP);
  data.variants = [...new Set(data.variants || [])].slice(0, 16);
  data.videoUrl = data.videos[0] || '';

  return data;
}



// ═══════════════════════════════════════════════════════════════
// v8.7.0 — Temu Seller Center auto-upload (runs only on seller.temu.com)
// Panel sends TEMU_UPLOAD_FILE {b64, filename}; we switch to the
// "general template" tab, tick the disclaimer, and attach the file.
// ═══════════════════════════════════════════════════════════════
function temuWait(fn, timeout = 8000, step = 200) {
  return new Promise(resolve => {
    const t0 = Date.now();
    (function poll() {
      let v = null;
      try { v = fn(); } catch (_) {}
      if (v) return resolve(v);
      if (Date.now() - t0 > timeout) return resolve(null);
      setTimeout(poll, step);
    })();
  });
}

// Upload history section ka container dhoondo (heading "Upload history" ke neeche wala block)
function temuHistorySection() {
  try {
    // general section ki table: title "Upload history" (categories wali "Spreadsheet upload status" hoti hai)
    const heading = [...document.querySelectorAll('div,span,h1,h2,h3')].find(e => /^\s*upload history\s*$/i.test((e.textContent || '').trim()));
    if (!heading) return null;
    return heading.closest('[class*="wrap-"]') || heading.closest('[class]')?.parentElement || heading.parentElement;
  } catch (_) { return null; }
}
// Sab se upar wali (naya-tareen) upload row ki "signature" — uska Upload ID (13-20 digit number)
// ya, agar ID abhi nahi bana, file ka naam + uske paas ka "Cancel"/"Processing" text.
// List hamesha nayi-se-purani order mein hoti hai, is liye pehla match hi "top" row hai.
function temuTopHistorySignature() {
  try {
    const sec = temuHistorySection();
    if (!sec) return 'nosection';
    // Upload ID = 15 digits in the first row's info block (<div class="info-…"><div>5648…</div><span>date</span>)
    const idEl = sec.querySelector('[class*="info-"] div');
    const idTxt = (idEl && idEl.textContent || '').trim();
    if (/^\d{13,20}$/.test(idTxt)) return 'id:' + idTxt;
    const text = (sec.innerText || sec.textContent || '').slice(0, 4000);
    const idMatch = text.match(/\d{15}/);
    if (idMatch) return 'id:' + idMatch[0];
    const cancelBtn = [...document.querySelectorAll('[role="button"], button')].find(b => /^\s*cancel\s*$/i.test((b.textContent || '').trim()) && temuVisible(b));
    if (cancelBtn) return 'processing:' + Date.now(); // active upload row present but no ID yet
    return 'none:' + text.slice(0, 120);
  } catch (_) { return 'err'; }
}

async function temuPageAutoUpload({ b64, filename, expectStore, waitForUpload, hiddenMode }) {
  const report = [];
  const ok = (m) => report.push('✓ ' + m);
  const fail = (m) => { report.push('✗ ' + m); return { success: false, report }; };

  // 0) Safety: make sure the right store is open in Seller Center
  if (expectStore) {
    const mall = (document.querySelector('[class*="mall_name"]')?.textContent || '').trim();
    if (mall && mall.toLowerCase() !== String(expectStore).toLowerCase()) {
      return fail(`Ghalat store khula hai: Temu par "${mall}" hai, magar file "${expectStore}" ke liye bani hai. Store switch kar ke dobara try karein.`);
    }
    ok(`Store verified: ${mall || expectStore}`);
  }

  // 1) Switch to "Add products via general template" tab
  const findTab = () => [...document.querySelectorAll('[class*="upload_page_tab_item_title"]')]
    .find(d => /general template/i.test(d.textContent));
  const tabTitle = await temuWait(findTab, 10000);
  if (!tabTitle) return fail('General template tab nahi mila — page load check karein');
  // NOTE: title element ki class "upload_page_tab_item_title-…" bhi "[class*=upload_page_tab_item]" se match ho jati thi,
  // is liye hyphen wala selector: parent item "upload_page_tab_item-336ly" (active class isi par lagti hai)
  const tabItem = tabTitle.closest('[class*="upload_page_tab_item-"]') || tabTitle.parentElement || tabTitle;
  if (!/active/i.test(tabItem.className)) {
    tabItem.click(); tabTitle.click();
    await temuWait(() => /active/i.test((tabTitle.closest('[class*="upload_page_tab_item-"]') || tabTitle.parentElement || {}).className || '') ||
      [...document.querySelectorAll('div,span')].some(e => /general template spreadsheet/i.test(e.textContent || '')), 6000);
  }
  ok('General template tab selected');
  await new Promise(r => setTimeout(r, 800));

  // 2+3) The page keeps BOTH tabs in the DOM, so there are two file inputs and
  // two disclaimer checkboxes. Scope to the GENERAL section: the upload box that
  // sits next to the "Upload configuration" panel (importUploadBoxWrap), falling
  // back to the LAST file input on the page.
  // v9.1.1 — STRICT: sirf GENERAL section ka file input. Page par do uploaders hain:
  //   (1) "Add products by categories"  → input inside .wrap-3yCRj (NO importUploadBoxWrap) — GALAT
  //   (2) "Add products via general template" → input inside .importUploadBoxWrap — SAHI
  // Pehle fallback "last input" tha, jo general section render hone se pehle categories wala utha leta
  // tha → file galat box mein jati thi ("Number of records processed: 0"). Ab koi fallback nahi.
  const pickInput = () => {
    const inputs = [...document.querySelectorAll('input[data-testid="beast-core-upload-input"][type="file"], input[type="file"]')];
    return inputs.find(i => i.closest('[class*="importUploadBoxWrap"]')) ||
           inputs.find(i => {
             const sec = i.closest('[class*="sectionWrap"]');
             return sec && /general template spreadsheet/i.test(sec.textContent || '') && !sec.querySelector('[class*="TLE_box"]');
           }) || null;
  };
  const generalTabActive = () => {
    const t = findTab(); const item = t && (t.closest('[class*="upload_page_tab_item-"]') || t.parentElement || t);
    return !!(item && /active/i.test(item.className));
  };
  let input = await temuWait(pickInput, hiddenMode ? 6000 : 8000);
  if (!input && !generalTabActive()) {
    // tab switch nahi hua — dobara click
    const t = findTab(); const item = t && (t.closest('[class*="upload_page_tab_item-"]') || t.parentElement || t);
    if (item) { item.click(); t.click(); }
    input = await temuWait(pickInput, 4000);
  }
  if (!input && hiddenMode && document.visibilityState === 'hidden') {
    // Hidden tab: Temu ne general upload box mount nahi kiya → 1-2 sec ke liye tab saamne mangwao
    report.push('• Background tab mein general upload box nahi bana — tab ko thori der ke liye saamne la raha hoon');
    try { await new Promise(res => chrome.runtime.sendMessage({ action: 'TEMU_NEED_VISIBLE' }, () => { void chrome.runtime.lastError; res(); })); } catch (_) {}
    await new Promise(r => setTimeout(r, 600));
    if (!generalTabActive()) { const t = findTab(); const item = t && (t.closest('[class*="upload_page_tab_item-"]') || t.parentElement || t); if (item) { item.click(); t.click(); } }
    input = await temuWait(pickInput, 10000);
  }
  if (!input) return fail('General template ka upload box nahi mila (visibility=' + document.visibilityState + ') — file GALAT box mein nahi bheji. Page reload kar ke dobara try karein.');
  if (!input.closest('[class*="importUploadBoxWrap"]')) report.push('• Note: importUploadBoxWrap nahi mila, section text se pehchana');
  ok('General template upload box mila (tab ' + (document.visibilityState === 'hidden' ? 'background mein' : 'saamne') + ')');

  // Disclaimer checkbox in the SAME section as the chosen input
  const section = input.closest('[class*="sectionWrap"]') || input.closest('[class*="importUploadBoxWrap"]')?.parentElement || document;
  const labels = [...section.querySelectorAll('label[data-testid="beast-core-checkbox"]')];
  const label = labels.find(l => l.getAttribute('data-checked') === 'false') || labels[0];
  if (label && label.getAttribute('data-checked') === 'false') {
    label.click();
    await new Promise(r => setTimeout(r, 400));
    ok('Disclaimer checkbox ticked');
  } else {
    ok('Disclaimer already ticked');
  }
  const beforeSig = temuTopHistorySignature();
  try {
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const file = new File([bytes], filename || 'temu_upload.xlsx',
      { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event('input',  { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    ok(`File attached: ${file.name} (${(file.size/1024).toFixed(0)} KB)`);
  } catch (e) {
    return fail('File attach fail: ' + (e?.message || e));
  }

  // v9.4.2 — DOM-confirmed flow (upload-goods-multiple.html, Sept 2026):
  //  * "Upload history" table (.wrap-1yaTg) STEP-2 section (.sectionWrap-*) ke BAHAR hai aur upload ke
  //    doran khud refresh NAHI hoti — nayi row wahan sirf page reload ke baad aati hai.
  //  * Upload ke doran STEP-2 section ke andar hi ek block dikhta hai:
  //    "temu_upload.xlsx / 5648…(15 digit) / date / Processing data (NN%) / Cancel" → phir usi jagah
  //    "Completed" (ya "Action required") + "Number of records processed from this upload: N".
  //  Is liye: sirf section ka text parho (history table ko fallback rakho), Upload ID = naya 15-digit
  //  number jo pehle na tha. Phase 1 = 90s (4 MB file slow net par upload hone mein 25s se zyada lagte hain); phase 2 = 200s
  //  (total < 5 min taake MV3 message channel/service worker time-out na ho).
  if (waitForUpload !== false) {
    const t0 = Date.now();
    const genSection = () => input.closest('[class*="sectionWrap"]') || input.closest('[class*="importUploadBoxWrap"]')?.parentElement || document.body;
    const secText = () => { const el = genSection(); return (el.innerText || el.textContent || ''); };
    const idsIn = (txt) => new Set((txt.match(/\b\d{15}\b/g) || []));
    const beforeIds = idsIn(secText());
    try { for (const id of idsIn((temuHistorySection() || document.body).innerText || '')) beforeIds.add(id); } catch (_) {}
    const newId = () => { for (const id of idsIn(secText())) if (!beforeIds.has(id)) return id; return null; };
    const progressText = () => { const m = secText().match(/Processing data\s*\((\d+)%\)/i); return m ? +m[1] : null; };
    const cancelVisible = () => { try { const el = genSection(); return [...el.querySelectorAll('[role="button"], button')].some(b => /^\s*cancel\s*$/i.test((b.textContent || '').trim()) && temuVisible(b)); } catch (_) { return false; } };
    // v9.6.2 — STEP-2 box mein PURANI upload ka result (Completed/Action required) pehle se dikh sakta hai;
    // is liye result sirf NAYE Upload ID ke baad wale text se parho, warna stale result "complete" samjha jata tha.
    const doneInfo = () => {
      let t = secText();
      const id = newId();
      if (!id) return null;
      const at = t.indexOf(id); if (at >= 0) t = t.slice(at);
      if (/Processing data\s*\(\d+%\)/i.test(t.slice(0, 400))) return null;
      const m = t.match(/Number of records processed[^:]*:\s*(\d+)[\s\S]*?records added:\s*(\d+)[\s\S]*?(?:Ready to Submit:\s*(\d+))?[\s\S]*?records with errors:\s*(\d+)/i);
      const status = /\bCompleted\b/.test(t) ? 'Completed' : (/Action required/i.test(t) ? 'Action required' : null);
      if (!m && !status) return null;
      return { status: status || 'Done', processed: m ? +m[1] : null, added: m ? +m[2] : null, ready: m && m[3] != null ? +m[3] : null, errors: m ? +m[4] : null };
    };
    // v9.4.3 — live progress → background → side panel (throttled: max 1 msg / 2s, rate-limit safe)
    let lastProg = 0, lastProgKey = '';
    const progress = (phase, extra = {}) => {
      const key = phase + JSON.stringify(extra);
      if (key === lastProgKey || Date.now() - lastProg < 2000) return;
      lastProg = Date.now(); lastProgKey = key;
      try { chrome.runtime.sendMessage({ action: 'TEMU_UPLOAD_PROGRESS', phase, secs: Math.round((Date.now() - t0) / 1000), ...extra }, () => void chrome.runtime.lastError); } catch (_) {}
    };
    // phase 1: Temu ne file uthaa li — progress text / Cancel button / naya Upload ID / nayi history row — max 90s
    let accepted = false, uploadId = null, lastNote = 0;
    while (Date.now() - t0 < 90000) {
      await new Promise(r => setTimeout(r, 700));
      uploadId = newId();
      if (progressText() !== null || uploadId || cancelVisible() || temuTopHistorySignature() !== beforeSig) { accepted = true; break; }
      progress('uploading');
      if (Date.now() - lastNote > 30000) { lastNote = Date.now(); report.push(`• File upload ho rahi hai… (${Math.round((Date.now() - t0) / 1000)}s)`); }
    }
    if (!accepted) { report.push('• 90s mein Temu ne file uthai nahi (na progress, na Upload ID) — Temu tab par dekh lein'); return { success: true, confirmed: false, report }; }
    progress('accepted', { uploadId });
    ok(`File Temu ne uthaa li (${Math.round((Date.now() - t0) / 1000)}s)` + (uploadId ? ` — Upload ID ${uploadId}` : ''));
    // phase 2: processing complete — "Processing data" gayab + section mein Completed/records count (ya nayi history row) — max 200s
    const t1 = Date.now();
    let lastPct = -1, finished = false, info = null;
    while (Date.now() - t1 < 200000) {
      await new Promise(r => setTimeout(r, 1000));
      const pct = progressText();
      if (pct !== null && pct !== lastPct) lastPct = pct;
      if (!uploadId) uploadId = newId();
      progress(pct === null ? 'finishing' : 'processing', { pct: pct === null ? lastPct : pct, uploadId });
      if (pct === null) {
        info = doneInfo();
        if (info) { finished = true; break; }
        // fallback: history table mein naya ID aa gaya (page refresh hua) — sirf tab jab section mein naya ID ho
        if (uploadId && temuTopHistorySignature() !== beforeSig && temuTopHistorySignature() === 'id:' + uploadId) { finished = true; break; }
      }
    }
    if (!finished) { report.push(`• Processing 200s mein poori nahi hui (last ${lastPct}%) — Temu tab saamne chhod diya; complete hone par "Mark as listed" daba dein`); return { success: true, confirmed: false, uploadId, report }; }
    const secs = Math.round((Date.now() - t1) / 1000);
    if (info && info.processed != null) {
      ok(`Processing mukammal (${secs}s) — ${info.status}: ${info.processed} records processed, ${info.added} added, ${info.errors} errors` + (uploadId ? ` (ID ${uploadId})` : ''));
      if (info.errors > 0) report.push(`• ${info.errors} record(s) mein error — Temu par "View processing results" dekh lein`);
      return { success: true, confirmed: true, uploadId, processed: info.processed, added: info.added, errors: info.errors, report };
    }
    ok(`Processing mukammal (${secs}s)` + (uploadId ? ` — Upload ID ${uploadId}` : ' — Upload history mein nayi entry aa gayi'));
    return { success: true, confirmed: true, uploadId, report };
  }
  return { success: true, confirmed: true, report };
}

// ═══════════════════════════════════════════════════════════════
// v9.0.0 — Temu "Complete product details" auto-fix (drafts)
// Page: seller.temu.com/products-excel-multiple-edit.html
// Panel sends TEMU_FIX_DRAFTS { rules:[{name, match:[..], attributes:{Label:Value}}],
//   defaults:{Label:Value}, autoSubmit:bool, expectStore }.
// For every product row we set the attribute dropdowns (Material, Applicable Age
// Group, ...) that the matching rule specifies, then (optionally) press Submit.
// ═══════════════════════════════════════════════════════════════
const temuSleep = ms => new Promise(r => setTimeout(r, ms));
function temuSetNativeValue(input, value) {
  const proto = input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(input, value); else input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}
function temuVisible(el) {
  if (!el || !el.isConnected) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}
function temuSelectCurrent(sel) {
  const rend = sel.querySelector('[class*="inputItemRenderer"]');
  const inp = sel.querySelector('input');
  return ((rend && rend.textContent) || (inp && inp.value) || '').trim();
}
// All option-like nodes that appeared for an open dropdown (rendered in a portal at body level)
function temuDropdownOptions() {
  const sels = [
    '[data-testid="beast-core-select-option"]', '[data-testid*="select-option"]', '[data-testid*="option"]',
    '[class*="ST_option"]', '[class*="Option_option"]', '[class*="option_"]', '[role="option"]', '[class*="ST_dropdown"] li', '[class*="dropdown"] li'
  ];
  const out = [];
  sels.forEach(s => { try { document.querySelectorAll(s).forEach(n => { if (temuVisible(n) && !out.includes(n)) out.push(n); }); } catch (_) {} });
  return out;
}
async function temuPickSelectValue(sel, want) {
  const wantL = String(want).trim().toLowerCase();
  if (temuSelectCurrent(sel).toLowerCase() === wantL) return 'already';
  const head = sel.querySelector('[data-testid="beast-core-select-header"]') || sel;
  head.scrollIntoView({ block: 'center' });
  await temuSleep(120);
  head.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  head.click();
  await temuSleep(350);
  const inp = sel.querySelector('input[data-testid="beast-core-select-htmlInput"], input');
  if (inp) { try { inp.focus(); temuSetNativeValue(inp, want); } catch (_) {} }
  // wait for options to render, then pick exact (or best) match
  let opt = null;
  const t0 = Date.now();
  while (Date.now() - t0 < 4000 && !opt) {
    await temuSleep(200);
    const opts = temuDropdownOptions();
    opt = opts.find(o => o.textContent.trim().toLowerCase() === wantL)
       || opts.find(o => o.textContent.trim().toLowerCase().startsWith(wantL))
       || null;
  }
  if (!opt) {
    if (inp) { try { inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true })); } catch (_) {} }
    await temuSleep(300);
    if (temuSelectCurrent(sel).toLowerCase() === wantL) return 'set';
    try { document.body.click(); } catch (_) {}
    return 'no_option';
  }
  opt.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  opt.click();
  await temuSleep(350);
  const cur = temuSelectCurrent(sel).toLowerCase();
  return cur === wantL || cur.startsWith(wantL) ? 'set' : 'verify_failed';
}
function temuFormItemsByLabel(scope, label) {
  const want = label.trim().toLowerCase();
  return [...scope.querySelectorAll('[data-testid="beast-core-form-item"]')].filter(fi => {
    const lb = fi.querySelector('[class*="Form_itemLabelContent"]');
    return lb && lb.textContent.trim().toLowerCase() === want;
  });
}
// v9.5.2 — generic: har product (father) row mein sirf woh REQUIRED (*) fields bharo jo khali hain.
// Order: matching category profile attributes → draft defaults → safe fallback (Material=Other,
// Applicable Age Group=14 Years+). Pehle se bhare fields ko haath nahi lagta. (DOM 2026-09-04:
// tr.TB_father_123 > [data-testid=beast-core-form-item] > label.Form_itemLabelContent_123 (+ .Form_itemRequired_123),
// select [data-testid=beast-core-select], filled value .inputItemRenderer-*, row category text "Category: A/B/C".)
const TEMU_DRAFT_FALLBACKS = { 
  'material': 'Other', 
  'applicable age group': '14 Years+', 
  'age group': '14 Years+',
  'power supply mode': 'None',
  'pattern': 'Solid Color',
  'theme': 'Other',
  'target audience': 'Adults',
  'care instructions': 'Hand Wash Only',
  'occasion': 'Casual',
  'season': 'All-Season'
};
function temuRowFields(row) {
  const out = [];
  const formItems = row.querySelectorAll('[data-testid="beast-core-form-item"], [class*="Form_item"], .form-item');
  for (const fi of formItems) {
    const lb = fi.querySelector('[class*="Form_itemLabelContent"], label, [class*="itemLabel"]');
    if (!lb) continue;
    const label = lb.textContent.replace(/\*/g, '').trim();
    if (!label || /^variant\s*\d/i.test(label)) continue; // Variant 1/2 selectors — never touch
    const required = !!fi.querySelector('[class*="Form_itemRequired"], [class*="required"]') || lb.textContent.includes('*');
    const sel = fi.querySelector('[data-testid="beast-core-select"], [class*="select"], [role="combobox"]');
    const inp = sel ? null : fi.querySelector('input, textarea');
    const current = sel ? temuSelectCurrent(sel) : (inp ? (inp.value || '').trim() : '');
    out.push({ fi, label, required, sel, inp, current, empty: !current || /^select$/i.test(current) });
  }
  return out;
}
async function temuPageFixDrafts({ rules = [], defaults = {}, autoSubmit = true, expectStore } = {}) {
  const report = [];
  const ok = m => report.push('✓ ' + m);
  const warn = m => report.push('• ' + m);
  const fail = m => { report.push('✗ ' + m); return { success: false, report }; };
  if (expectStore) {
    const mall = (document.querySelector('[class*="mall_name"]')?.textContent || '').trim();
    if (mall && mall.toLowerCase() !== String(expectStore).toLowerCase())
      return fail(`Ghalat store khula hai: Temu par "${mall}" hai, extension mein "${expectStore}" active hai.`);
  }
  const rows = await temuWait(() => { const r = [...document.querySelectorAll('tr[class*="TB_father"]')]; return r.length ? r : null; }, 10000);
  if (!rows) return fail('Koi draft row nahi mili — "Complete product details" page khula hai?');
  let changed = 0, stillEmpty = 0;
  const pick = (attrs, label) => {
    const want = label.trim().toLowerCase();
    for (const k of Object.keys(attrs || {})) if (k.trim().toLowerCase() === want && attrs[k] !== '' && attrs[k] != null) return attrs[k];
    return null;
  };
  for (const row of rows) {
    const name = (row.querySelector('[class*="p_name"]')?.textContent || '').trim();
    const catTxt = ([...row.querySelectorAll('div')].map(d => d.childNodes[0]?.nodeValue || '').find(t => /^\s*Category:/i.test(t)) || '').replace(/^\s*Category:\s*/i, '').trim();
    const tl = (name + ' ' + catTxt).toLowerCase();
    const rule = rules.find(r => (r.match || []).some(m => m && tl.includes(String(m).toLowerCase())));
    const ruleAttrs = (rule && rule.attributes) || {};
    const fields = temuRowFields(row);
    const need = fields.filter(f => f.required && f.empty);
    const notes = [];
    if (!need.length) { ok(`${name.slice(0, 45)} — sab required fields bhare hain` + (catTxt ? ` [${catTxt.split('/').pop()}]` : '')); continue; }
    for (const f of need) {
      const want = pick(ruleAttrs, f.label) ?? pick(defaults, f.label) ?? TEMU_DRAFT_FALLBACKS[f.label.trim().toLowerCase()] ?? null;
      if (want == null) { notes.push(`${f.label}: KHALI (profile mein value likhein)`); stillEmpty++; continue; }
      if (f.sel) {
        const res = await temuPickSelectValue(f.sel, want);
        if (res === 'set' || res === 'already') { changed += res === 'set' ? 1 : 0; notes.push(`${f.label}=${want}`); }
        else { notes.push(`${f.label}: "${want}" dropdown mein nahi mila (${res})`); stillEmpty++; }
      } else if (f.inp) {
        temuSetNativeValue(f.inp, want); changed++; notes.push(`${f.label}=${want} (typed)`);
      } else { notes.push(`${f.label}: field type samajh nahi aaya`); stillEmpty++; }
    }
    ok(`${name.slice(0, 45)} [${rule ? rule.name : 'defaults'}${catTxt ? ' · ' + catTxt.split('/').pop() : ''}] → ${notes.join(', ')}`);
  }
  if (autoSubmit) {
    if (stillEmpty > 0) warn(`${stillEmpty} required field(s) abhi bhi khali — Submit NAHI dabaya; upar wale fields Categories tab ke profile mein "attributes" mein likhein, ya page par khud bhar kar Submit karein`);
    else {
      const btn = [...document.querySelectorAll('[role="button"], button')].find(b => /^\s*submit\s*$/i.test(b.textContent || '') && temuVisible(b) && !/disable/i.test(b.className));
      if (btn) { btn.click(); ok('Submit dabaya — Temu par result dekhein (agar confirm popup aaye to OK karein)'); }
      else warn('Submit button nahi mila / disabled — page par khud Submit dabayen');
    }
  }
  report.unshift(`${rows.length} drafts, ${changed} fields set, ${stillEmpty} still empty`);
  return { success: true, report, changed, total: rows.length, stillEmpty };
}

// ═══ v9.6.0 — "View failed details" popup parhna (upload-goods-multiple.html) ═══
// DOM (2026-09-04): Upload history row → button "View failed details" → modal [data-testid=beast-core-modal]
// title "N product(s) failed to upload"; rows: td0 = name ([class*=elli_outerWrapper]) + "Goods ID: N" ([class*="id-"]),
// td1 = reason (e.g. "Contribution SKU duplicated with another product (Goods ID: 6109…)"). Close: [class*=modalCloseButton].
async function temuPageReadFailed({ uploadId, expectStore } = {}) {
  const report = [];
  const mall = (document.querySelector('[class*="mall_name"]')?.textContent || '').trim();
  if (expectStore && mall && mall.toLowerCase() !== String(expectStore).toLowerCase())
    return { success: false, wrongStore: true, mall, report: [`✗ Ye tab store "${mall}" ka hai, extension mein "${expectStore}" active hai`] };
  const sec = temuHistorySection();
  if (!sec) return { success: false, report: ['✗ Upload history section nahi mili'] };
  const rowsOf = () => [...sec.querySelectorAll('tr[data-testid="beast-core-table-body-tr"]')];
  const btnOf = row => [...row.querySelectorAll('[role="button"], button')].find(b => /view failed details/i.test(b.textContent || ''));
  const pickRow = () => {
    const rows = rowsOf();
    if (uploadId) { const r = rows.find(r => (r.innerText || '').includes(String(uploadId))); if (r) return r; }
    return rows.find(r => btnOf(r)) || null;
  };
  // v9.7.5: Temu ka koi popup (e.g. "N products require additional attribute information") upar khula ho to pehle band karo
  const closeTemuModals = () => { try { document.querySelectorAll('[data-testid="beast-core-modal"] [class*="modalCloseButton"], [data-testid="beast-core-modal"] [class*="closeIcon"]').forEach(b => b.click()); } catch (_) {} };
  let row = pickRow();
  if (!row || !btnOf(row)) {
    // history table upload ke baad refresh nahi hoti — Refresh dohrao, 25s tak (v9.7.5)
    const rf = () => [...sec.querySelectorAll('[role="button"], button')].find(b => /^\s*refresh\s*$/i.test((b.textContent || '').trim()));
    report.push('• Upload history refresh…');
    const t0 = Date.now();
    while (Date.now() - t0 < 25000) {
      closeTemuModals();
      const b = rf(); if (b) { b.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); b.click(); }
      row = await temuWait(() => { const r = pickRow(); return (r && btnOf(r)) ? r : null; }, 5000, 400);
      if (row) break;
    }
    if (!row) row = pickRow();
  }
  if (!row) return { success: true, failed: [], report: ['• Upload history mein ye upload nahi mila' + (uploadId ? ` (ID ${uploadId})` : '')] };
  const btn = btnOf(row);
  if (!btn) return { success: true, failed: [], report: ['• Is upload par "View failed details" button nahi hai (koi failed product nahi, ya abhi processing)'] };
  btn.click();
  const modal = await temuWait(() => [...document.querySelectorAll('[data-testid="beast-core-modal"]')].find(m => /failed to upload/i.test(m.innerText || '')), 8000);
  if (!modal) return { success: false, report: ['✗ "failed to upload" popup nahi khula'] };
  await temuWait(() => modal.querySelector('tr[data-testid="beast-core-table-body-tr"]'), 5000);
  const failed = [];
  for (const tr of modal.querySelectorAll('tr[data-testid="beast-core-table-body-tr"]')) {
    const tds = tr.querySelectorAll('td');
    const name = (tr.querySelector('[class*="elli_outerWrapper"]')?.textContent || tds[0]?.innerText || '').trim();
    const goodsId = ((tr.querySelector('[class*="id-"]')?.textContent || '').match(/\d{10,}/) || [''])[0];
    const reason = (tds[1]?.innerText || '').trim();
    const dup = reason.match(/Goods ID:\s*(\d{10,})/i);
    failed.push({ name, goodsId, reason, duplicate: /duplicat/i.test(reason), dupGoodsId: dup ? dup[1] : '' });
  }
  const total = ((modal.innerText || '').match(/Total\s+(\d+)\s+items?/i) || [])[1];
  try { (modal.querySelector('[class*="modalCloseButton"]') || modal.querySelector('[role="button"]'))?.click(); } catch (_) {}
  report.push(`✓ Failed details parhe: ${failed.length}${total && +total > failed.length ? ` (Temu total ${total} — sirf pehla page)` : ''}`);
  return { success: true, failed, total: total ? +total : failed.length, report };
}

// ── Message Listener ────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  try {
    if (message?.action === 'SCRAPE_PAGE') {
      scrapePageData().then(data => {
        sendResponse({ success: true, data });
      }).catch(err => {
        sendResponse({
          success: false,
          error: err?.message || 'scrape_failed',
          data: { title: document.title || '', url: location.href, price: '', images: [], videos: [], variants: [] }
        });
      });
      return true;
    }
    if (message?.action === 'GET_PRODUCT_LINKS') {
      const seen = new Set();
      const links = [];
      document.querySelectorAll('a[href], [data-href]').forEach(anchor => {
        const raw = anchor.getAttribute('href') || anchor.getAttribute('data-href') || '';
        try {
          const u = new URL(raw, location.href);
          if (u.protocol !== 'http:' && u.protocol !== 'https:') return;
          u.hash = '';
          const url = u.href;
          if (seen.has(url)) return;
          seen.add(url);
          links.push({ url, title: (anchor.textContent || anchor.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 300) });
        } catch (_) {}
      });
      sendResponse({ success: true, links: links.slice(0, 500) });
      return true;
    }
    if (message?.action === 'GET_PAGE_INFO') {
      sendResponse({ success: true, url: location.href, title: document.title || '' });
      return true;
    }
    if (message?.action === 'PING') {
      sendResponse({ success: true, ready: true });
      return true;
    }
    if (message?.action === 'TEMU_UPLOAD_FILE') {
      if (!/seller\.temu\.com$/i.test(location.hostname)) { sendResponse({ success: false, report: ['✗ Yeh Temu seller page nahi hai'] }); return true; }
      temuPageAutoUpload(message).then(sendResponse).catch(err => sendResponse({ success: false, report: ['✗ ' + (err?.message || 'error')] }));
      return true;
    }
    if (message?.action === 'TEMU_READ_FAILED') {
      if (!/seller\.temu\.com$/i.test(location.hostname)) { sendResponse({ success: false, report: ['✗ Yeh Temu seller page nahi hai'] }); return true; }
      temuPageReadFailed(message).then(sendResponse).catch(err => sendResponse({ success: false, report: ['✗ ' + (err?.message || 'error')] }));
      return true;
    }
    if (message?.action === 'TEMU_FIX_DRAFTS') {
      if (!/seller\.temu\.com$/i.test(location.hostname)) { sendResponse({ success: false, report: ['✗ Yeh Temu seller page nahi hai'] }); return true; }
      temuPageFixDrafts(message).then(sendResponse).catch(err => sendResponse({ success: false, report: ['✗ ' + (err?.message || 'error')] }));
      return true;
    }
  } catch (err) {
    sendResponse({
      success: false,
      error: err?.message || 'scrape_failed',
      data: { title: document.title || '', url: location.href, price: '', images: [], videos: [], variants: [] }
    });
  }
  return true;
});

// ── In-Page ZHunter Floating Button ──────────────────────────
(function() {
  const BG_PLATFORM_KEYS = [
    'walmart.com', 'amazon.', 'samsclub.com', 'faire.com', 'aliexpress.',
    'alibaba.com', 'temu.', 'ebay.', 'etsy.com', 'shein.com', 'daraz.',
    'worldwidegolfballs.com', 'worldwidegolfshops.com', 'flipkart.com',
    'noon.com', 'lazada.', 'myshopify.com', 'target.com', 'costco.com',
    'bestbuy.com', 'homedepot.com'
  ];

  const currentHost = host();
  const currentPath = location.pathname.toLowerCase();
  const currentUrl  = location.href.toLowerCase();

  // Step 1: Must be a known shopping domain
  const isProductDomain = BG_PLATFORM_KEYS.some(k => {
    if (k.endsWith('.')) return currentHost.startsWith(k) || currentHost.includes('.' + k);
    return currentHost === k || currentHost.endsWith('.' + k);
  });
  if (!isProductDomain) return;

  // Step 2: Must be an actual product page — NOT search/category/home
  const PRODUCT_URL_PATTERNS = [
    /\/ip\//,           // Walmart: /ip/product-name/12345
    /\/dp\//,           // Amazon: /dp/ASIN
    /\/gp\/product\//,  // Amazon alternate
    /\/product\//,      // Sam's Club, generic
    /\/itm\//,          // eBay: /itm/12345
    /\/listing\//,      // Etsy: /listing/12345
    /\/item\//,         // AliExpress, Lazada
    /\/goods[-_]?(detail)?/,  // Temu
    /\/p-/,             // Shein, Daraz: /p-1234
    /\/products?\//,    // Shopify stores
    /\/pd\//,           // BestBuy
    /\/skuId=/,         // Target, BestBuy query param
    /[?&]sku[_-]?id=/i, // generic SKU param
    /\/prd\//,          // Noon
    /\/buy\//,          // Walmart alternate
    /[?&]itemid=/,      // Lazada
    /\/asin\//,         // Amazon alternate paths
  ];

  const NON_PRODUCT_PATTERNS = [
    /\/search[\/?]/,
    /\/s\?/,
    /\/browse\//,
    /\/category\//,
    /\/collection/,
    /\/shop\/?$/,
    /\/deals\/?/,
    /\/offers\/?/,
    /^\/?$/,            // homepage (root path)
    /\/cart\//,
    /\/checkout\//,
    /\/account\//,
    /\/wishlist\//,
  ];

  const isNonProduct = NON_PRODUCT_PATTERNS.some(p => p.test(currentPath) || p.test(currentUrl));
  if (isNonProduct) return;

  const isProductPage = PRODUCT_URL_PATTERNS.some(p => p.test(currentPath) || p.test(currentUrl));
  if (!isProductPage) return;

  // v8: the on-page "Add to Queue" button is disabled. The floating image card
  // and the side panel cover this workflow. Code kept below for reference.
  return;

  // Wait for document to be interactive or complete
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initFloatingButton);
  } else {
    initFloatingButton();
  }

  function initFloatingButton() {
    // Avoid double injection
    if (document.getElementById('zhunter-floating-root')) return;

    console.log('[ZHunter] Initializing floating button on:', location.href);

    const root = document.createElement('div');
    root.id = 'zhunter-floating-root';
    root.style.position = 'fixed';
    root.style.top = '20px';
    root.style.right = '20px';
    root.style.zIndex = '2147483647';
    root.style.pointerEvents = 'auto';
    document.body.appendChild(root);

    const shadow = root.attachShadow({ mode: 'open' });

    // Stylesheet matching ZHunter cyberpunk theme (neon cyan / neon green)
    const style = document.createElement('style');
    style.textContent = `
      .zhunter-float-wrap {
        display: flex;
        align-items: center;
        gap: 8px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Outfit", sans-serif;
        pointer-events: auto;
      }
      .zhunter-btn {
        background: linear-gradient(135deg, #06b6d4, #0891b2) !important;
        color: #ffffff !important;
        border: 1px solid rgba(6, 182, 212, 0.4) !important;
        padding: 8px 14px !important;
        border-radius: 20px !important;
        font-size: 12px !important;
        font-weight: 700 !important;
        letter-spacing: 0.5px !important;
        cursor: pointer !important;
        box-shadow: 0 0 16px rgba(6, 182, 212, 0.25), inset 0 1px 0 rgba(255, 255, 255, 0.2) !important;
        transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1) !important;
        display: flex !important;
        align-items: center !important;
        gap: 6px !important;
        user-select: none !important;
        backdrop-filter: blur(4px) !important;
        pointer-events: auto !important;
      }
      .zhunter-btn:hover {
        transform: translateY(-2px) !important;
        box-shadow: 0 0 24px rgba(6, 182, 212, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.2) !important;
        border-color: rgba(6, 182, 212, 0.8) !important;
      }
      .zhunter-btn:active {
        transform: translateY(0) !important;
      }
      .zhunter-btn.added {
        background: linear-gradient(135deg, #10b981, #059669) !important;
        border-color: rgba(16, 185, 129, 0.4) !important;
        box-shadow: 0 0 16px rgba(16, 185, 129, 0.25) !important;
      }
      .zhunter-btn.added:hover {
        box-shadow: 0 0 24px rgba(16, 185, 129, 0.45) !important;
        border-color: rgba(16, 185, 129, 0.8) !important;
      }
      .zhunter-icon {
        font-size: 13px !important;
        line-height: 1 !important;
      }
      /* Quick In-Page Toast */
      .zhunter-toast {
        position: fixed;
        top: 70px;
        right: 20px;
        background: rgba(15, 23, 42, 0.95) !important;
        color: #e2e8f0 !important;
        border: 1px solid rgba(6, 182, 212, 0.3) !important;
        padding: 8px 16px !important;
        border-radius: 8px !important;
        font-size: 12px !important;
        font-weight: 500 !important;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3) !important;
        transform: translateY(-20px) !important;
        opacity: 0 !important;
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1) !important;
        pointer-events: none !important;
        display: flex !important;
        align-items: center !important;
        gap: 6px !important;
      }
      .zhunter-toast.show {
        transform: translateY(0) !important;
        opacity: 1 !important;
      }
    `;
    shadow.appendChild(style);

    const wrap = document.createElement('div');
    wrap.className = 'zhunter-float-wrap';

    const btn = document.createElement('button');
    btn.className = 'zhunter-btn';
    btn.innerHTML = '<span class="zhunter-icon" aria-hidden="true">+</span><span>Add to Queue</span>';

    const toast = document.createElement('div');
    toast.className = 'zhunter-toast';
    toast.innerHTML = '<span aria-hidden="true">✓</span><span>Product added to ZHunter Queue!</span>';

    wrap.appendChild(btn);
    shadow.appendChild(wrap);
    shadow.appendChild(toast);

    const normUrl = location.href.split('#')[0].trim();

    function sendRuntimeWithRetry(payload, attempts = 3) {
      return new Promise(resolve => {
        let attempt = 0;
        const run = () => {
          attempt += 1;
          try {
            chrome.runtime.sendMessage(payload, response => {
              const runtimeError = chrome.runtime.lastError;
              if (!runtimeError) { resolve(response || { success: false, error: 'no_response' }); return; }
              if (attempt < attempts) { setTimeout(run, 250 * attempt); return; }
              resolve({ success: false, error: runtimeError.message || 'runtime_disconnected' });
            });
          } catch (error) {
            if (attempt < attempts) { setTimeout(run, 250 * attempt); return; }
            resolve({ success: false, error: error?.message || 'extension_context_invalidated' });
          }
        };
        run();
      });
    }

    function showReconnectState(message = 'Refresh this tab once, then retry') {
      btn.classList.remove('added');
      btn.classList.add('retry-connection');
      btn.innerHTML = '<span class="zhunter-icon" aria-hidden="true">↻</span><span>Retry Queue</span>';
      btn.title = message;
    }

    // Check if already in queue. Retry short-lived service-worker wake-ups
    // before showing a non-blocking reconnect hint.
    sendRuntimeWithRetry({ action: 'CHECK_BULK_QUEUE', url: normUrl }).then(response => {
      if (response?.queued) {
        console.log('[ZHunter] Product is already queued.');
        markAdded();
      }
    });

    function markAdded() {
      btn.classList.add('added');
      btn.innerHTML = '<span class="zhunter-icon" aria-hidden="true">✓</span><span>Queued</span>';
    }

    function showToast() {
      toast.classList.add('show');
      setTimeout(() => {
        toast.classList.remove('show');
      }, 2500);
    }

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();

      if (btn.classList.contains('added')) {
        console.log('[ZHunter] Product already queued. Ignoring click.');
        return;
      }

      console.log('[ZHunter] Floating button clicked. Sending ADD_TO_BULK_QUEUE...');

      // Detect current platform name
      let platformName = null;
      try {
        const platMatch = BG_PLATFORM_KEYS.find(k => currentHost.includes(k));
        if (platMatch) {
          platformName = platMatch.split('.')[0];
          platformName = platformName.charAt(0).toUpperCase() + platformName.slice(1);
        }
      } catch (_) {}

      sendRuntimeWithRetry({
        action: 'ADD_TO_BULK_QUEUE',
        url: normUrl,
        title: document.title,
        platform: platformName
      }).then(res => {
        console.log('[ZHunter] Queue add response:', res);
        if (res?.success || res?.reason === 'duplicate') {
          markAdded();
          showToast();
        } else if (/runtime|context|reload|disconnect|receiving end/i.test(String(res?.error || ''))) {
          showReconnectState('Connection lost. Refresh this tab once, then click Retry Queue.');
        } else {
          alert("Failed to add product: " + (res?.reason || res?.error || 'unknown error'));
        }
      });
    });
  }
})();

// ── ZHunter In-Page Image Panel ──────────────────────────────
(function () {
  const PANEL_ID = 'zhunter-img-panel-root';
  const IMG_PLATFORM_KEYS = [
    'walmart.com', 'amazon.', 'samsclub.com', 'faire.com', 'aliexpress.',
    'alibaba.com', 'temu.', 'ebay.', 'etsy.com', 'shein.com', 'daraz.',
    'worldwidegolfballs.com', 'worldwidegolfshops.com', 'flipkart.com',
    'noon.com', 'lazada.', 'myshopify.com', 'target.com', 'costco.com',
    'bestbuy.com', 'homedepot.com'
  ];
  const PRODUCT_PATH_PATTERNS = [
    /\/ip\//,/\/dp\//,/\/gp\/product\//,/\/product\//,/\/itm\//,
    /\/listing\//,/\/item\//,/\/goods[-_]?(detail)?/,/\/p-/,
    /\/products?\//,/\/pd\//,/\/skuId=/,/[?&]sku[_-]?id=/i,
    /\/prd\//,/\/buy\//,/[?&]itemid=/,/\/asin\//
  ];
  const NON_PRODUCT_PATTERNS = [
    /\/search[\/?]/,/\/s\?/,/\/browse\//,/\/category\//,/\/collection/,
    /\/shop\/?$/,/\/deals\/?/,/\/offers\/?/,/^\/?$/,
    /\/cart\//,/\/checkout\//,/\/account\//,/\/wishlist\//
  ];

  const h = host();
  const path = location.pathname.toLowerCase();
  const href = location.href.toLowerCase();

  if (!IMG_PLATFORM_KEYS.some(k => h.includes(k))) return;
  if (NON_PRODUCT_PATTERNS.some(p => p.test(path) || p.test(href))) return;
  if (!PRODUCT_PATH_PATTERNS.some(p => p.test(path) || p.test(href))) return;

  // ── Image Collector ──────────────────────────────────────────
  const IMAGE_CARD_CAP = 40;

  function cardPlatformImages() {
    try {
      const normalizedHost = h.replace(/^www\./, '');
      if (normalizedHost.includes('amazon.')) return dedupeImages(scrapeAmazon().images || []);
      if (normalizedHost === 'walmart.com' || normalizedHost.endsWith('.walmart.com')) return dedupeImages(scrapeWalmart().images || []);
      if (normalizedHost === 'samsclub.com' || normalizedHost.endsWith('.samsclub.com')) return dedupeImages(scrapeSamsClub().images || []);
    } catch (_) {}
    return [];
  }

  function collectPageImages() {
    // The marketplace scrapers use verified gallery/state paths first. This
    // keeps recommendation media out while recovering lazy/variant images.
    const marketplaceImages = cardPlatformImages();
    if (marketplaceImages.length) return marketplaceImages.slice(0, IMAGE_CARD_CAP);

    const raw = [];
    const push = (url) => {
      if (!url || typeof url !== 'string') return;
      try {
        const abs = new URL(url, location.href).href;
        if (/\.(svg|ico)(\?|$)/i.test(abs)) return;
        if (/logo|icon|badge|sprite|avatar|banner|placeholder|play[-_]?button/i.test(abs)) return;
        raw.push(abs);
      } catch (_) {}
    };
    const addElement = (el) => {
      if (!el || (el.tagName === 'IMG' && isBadImageElement(el))) return;
      ['data-old-hires', 'data-zoom-image', 'data-image-url', 'data-image-src',
       'data-large-image', 'data-src', 'data-lazy-src', 'data-original', 'src']
        .forEach(attr => push(el.getAttribute?.(attr) || ''));
      const srcset = el.getAttribute?.('srcset') || el.getAttribute?.('data-srcset') || '';
      String(srcset).split(',').forEach(part => push(part.trim().split(/\s+/)[0] || ''));
      if (el.tagName === 'IMG') push(el.currentSrc || el.src || '');
    };
    const gallerySelectors = [
      '#landingImage, #imgTagWrapperId img, #altImages img, .a-button-thumbnail img, .imageThumbnail img',
      '[data-testid="vertical-carousel-container"] img',
      '[data-testid="vertical-hero-carousel"] img',
      '[data-testid="item-page-vertical-carousel-hero-image-button"] img',
      '[data-testid="media-thumbnail"] img, [data-testid="hero-image"] img',
      '[data-testid="hero-image-container"] img, [data-testid="zoom-image"] img',
      '[data-testid="zoom-panel"] img, [data-automation-id="product-media"] img',
      '[class*="product-gallery"] img, [class*="ProductGallery"] img',
      '[class*="product-image"] img, [class*="ProductImage"] img',
      '[class*="carousel"] img, [class*="gallery"] img',
      'img[data-zoom-image], img[data-image-url], img[data-image-src], img[data-lazy-src]'
    ];
    const gallery = document.querySelectorAll(gallerySelectors.join(', '));
    gallery.forEach(addElement);
    if (!gallery.length) document.querySelectorAll('meta[property="og:image"], meta[name="og:image"]').forEach(m => push(m.content));
    return dedupeImages(raw).slice(0, IMAGE_CARD_CAP);
  }

  // ── Download helper ──────────────────────────────────────────
  function downloadViaBackground(url, filename) {
    chrome.runtime.sendMessage({ action: 'FETCH_BASE64', url }, res => {
      if (chrome.runtime.lastError || !res?.base64) {
        // Fallback: open in new tab (CDN blocks direct anchor downloads)
        window.open(url, '_blank');
        return;
      }
      // res.base64 is already a full data URL (data:image/jpeg;base64,...)
      // Do NOT wrap it again — that creates an invalid double-prefixed URL
      const dataUrl = res.base64.startsWith('data:') ? res.base64 : `data:image/jpeg;base64,${res.base64}`;
      const a = document.createElement('a');
      a.href = dataUrl; a.download = filename;
      document.body.appendChild(a); a.click();
      setTimeout(() => a.remove(), 500);
    });
  }

  // ── Init Panel ───────────────────────────────────────────────
  function initImagePanel() {
    if (document.getElementById(PANEL_ID)) return;

    const root = document.createElement('div');
    root.id = PANEL_ID;
    Object.assign(root.style, {
      position: 'fixed', bottom: '20px', right: '20px', left: 'auto', top: 'auto',
      zIndex: '2147483640', fontFamily: 'sans-serif',
      touchAction: 'none'
    });
    document.documentElement.appendChild(root);

    const shadow = root.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = `
      * { box-sizing: border-box; margin: 0; padding: 0; }
      :host { all: initial; }

      @keyframes zh-slide-in {
        from { opacity: 0; transform: translateX(100%) scale(0.95); }
        to   { opacity: 1; transform: translateX(0) scale(1); }
      }
      @keyframes zh-fade-up {
        from { opacity: 0; transform: translateY(10px) scale(0.9); }
        to   { opacity: 1; transform: translateY(0) scale(1); }
      }
      @keyframes zh-border-pulse {
        0%,100% { border-color: rgba(0,229,255,0.35); box-shadow: -4px 0 32px rgba(0,0,0,0.6), 0 0 0 1px rgba(0,229,255,0.08); }
        50%      { border-color: rgba(0,229,255,0.7); box-shadow: -6px 0 40px rgba(0,229,255,0.15), 0 0 0 1px rgba(0,229,255,0.2); }
      }
      @keyframes zh-shimmer {
        0%   { background-position: -200% 0; }
        100% { background-position: 200% 0; }
      }
      @keyframes zh-check-pop {
        0%   { transform: scale(0) rotate(-20deg); opacity: 0; }
        60%  { transform: scale(1.3) rotate(5deg); opacity: 1; }
        100% { transform: scale(1) rotate(0deg); opacity: 1; }
      }
      @keyframes zh-btn-shine {
        0%   { background-position: -200% center; }
        100% { background-position: 200% center; }
      }

      /* ── Panel Wrapper with Rainbow Border ── */
      .panel-wrap {
        position: relative;
        border-radius: 18px;
        padding: 2px;
        overflow: hidden; /* clips the ring to rounded shape */
        box-shadow: 0 0 24px rgba(120,0,255,0.25), 0 8px 32px rgba(0,0,0,0.65);
      }
      /* This ::before pseudo is MUCH larger than parent so the conic-gradient
         sweeps uniformly around all 4 edges when it spins */
      .panel-wrap::before {
        content: '';
        position: absolute;
        top: 50%; left: 50%;
        width: 400%; height: 400%;
        transform: translate(-50%, -50%) rotate(0deg);
        background: conic-gradient(from 0deg, #ff0000, #ff7f00, #ffff00, #00ff00, #00ffff, #0000ff, #8b00ff, #ff0000);
        animation: zh-panel-spin 4s linear infinite;
        z-index: 0;
      }
      .panel {
        width: 295px;
        background: rgba(4, 8, 20, 0.97);
        backdrop-filter: blur(20px) saturate(180%);
        border-radius: 16px;
        overflow: hidden;
        font-family: 'Inter', system-ui, -apple-system, sans-serif;
        animation: zh-slide-in 0.45s cubic-bezier(0.16,1,0.3,1) both;
        transition: transform 0.4s cubic-bezier(0.16,1,0.3,1);
        position: relative; z-index: 1;
      }
      .panel-wrap.collapsed { display: none; }
      /* ── Minimized FAB: PRO Grade Premium Style ── */
      @keyframes zh-spin {
        from { transform: rotate(0deg); }
        to   { transform: rotate(360deg); }
      }
      @keyframes zh-spin-rev {
        from { transform: rotate(360deg); }
        to   { transform: rotate(0deg); }
      }
      /* zh-panel-spin: for panel ::before — must keep translate so centering stays */
      @keyframes zh-panel-spin {
        from { transform: translate(-50%, -50%) rotate(0deg); }
        to   { transform: translate(-50%, -50%) rotate(360deg); }
      }
      @keyframes zh-badge-pulse {
        0%   { transform: scale(1);    box-shadow: 0 0 0 0 rgba(0,229,255,0.7); }
        40%  { transform: scale(1.35); box-shadow: 0 0 0 6px rgba(0,229,255,0.0); }
        100% { transform: scale(1);    box-shadow: 0 0 0 0 rgba(0,229,255,0.0); }
      }
      @keyframes zh-badge-ripple {
        0%   { opacity: 0.7; transform: scale(1); }
        100% { opacity: 0; transform: scale(2.2); }
      }
      /* FAB outer wrapper */
      .mini-widget-wrap {
        position: relative;
        width: 68px; height: 68px;
        display: flex; align-items: center; justify-content: center;
      }
      /* Spinning premium ring layer (behind FAB button) */
      .mini-ring {
        position: absolute;
        inset: 0;
        border-radius: 50%;
        background: conic-gradient(from 0deg, #00e5ff, #7c3aed, #0ea5e9, #a855f7, #00e5ff, #38bdf8, #7c3aed, #00e5ff);
        animation: zh-spin 3s linear infinite;
        z-index: 0;
      }
      /* Reverse-spin blurred glow layer for depth effect */
      .mini-glow {
        position: absolute;
        inset: -2px;
        border-radius: 50%;
        background: conic-gradient(from 180deg, #00e5ff, #7c3aed, #0ea5e9, #a855f7, #00e5ff);
        animation: zh-spin-rev 4s linear infinite;
        filter: blur(12px);
        opacity: 0.65;
        transition: opacity 0.25s ease, filter 0.25s ease;
        z-index: 0;
      }
      .mini-widget-wrap:hover .mini-glow { filter: blur(20px); opacity: 1; }
      .mini-widget {
        width: 60px; height: 60px;
        border-radius: 50%;
        position: relative;
        display: flex; align-items: center; justify-content: center;
        cursor: grab; user-select: none; touch-action: none;
        background: radial-gradient(circle at 38% 32%, #0f2347 0%, #050d1c 70%, #020812 100%);
        box-shadow: 0 4px 24px rgba(0,0,0,0.7), inset 0 0 16px rgba(0,229,255,0.07);
        transition: transform 0.2s cubic-bezier(0.16,1,0.3,1), box-shadow 0.2s;
        z-index: 1;
        border: none;
        outline: none;
      }
      .mini-widget:hover { transform: scale(1.1); cursor: grab; box-shadow: 0 6px 28px rgba(0,0,0,0.8), inset 0 0 20px rgba(0,229,255,0.12); }
      .mini-widget:active { cursor: grabbing; transform: scale(0.93); }
      .mini-widget img {
        width: 36px; height: 36px; object-fit: contain; pointer-events: none;
        border-radius: 50%;
        transition: transform 0.2s ease;
        filter: drop-shadow(0 0 6px rgba(0,229,255,0.6));
      }
      .mini-widget:hover img { transform: scale(1.08); }
      .mini-logo-fallback { display: none; color: #00e5ff; font: 900 18px/1 system-ui, sans-serif; letter-spacing: -1px; text-shadow: 0 0 14px rgba(0,229,255,0.9), 0 0 28px rgba(0,229,255,0.5); pointer-events: none; }
      /* Hover tooltip */
      .mini-tooltip {
        position: absolute;
        bottom: calc(100% + 10px);
        left: 50%; transform: translateX(-50%) scale(0.85);
        background: rgba(4,8,20,0.94);
        border: 1px solid rgba(0,229,255,0.4);
        backdrop-filter: blur(12px);
        color: #e0f7fa; font-size: 10px; font-weight: 600;
        white-space: nowrap; padding: 5px 10px;
        border-radius: 8px;
        pointer-events: none;
        opacity: 0;
        transition: opacity 0.2s ease, transform 0.2s cubic-bezier(0.16,1,0.3,1);
        box-shadow: 0 4px 16px rgba(0,0,0,0.6), 0 0 12px rgba(0,229,255,0.2);
        z-index: 10;
      }
      .mini-tooltip::after {
        content: '';
        position: absolute; top: 100%; left: 50%;
        transform: translateX(-50%);
        border: 5px solid transparent;
        border-top-color: rgba(0,229,255,0.4);
      }
      .mini-widget-wrap:hover .mini-tooltip {
        opacity: 1; transform: translateX(-50%) scale(1);
      }
      /* Count badge — cyan brand color with ripple pulse */
      .mini-count {
        position: absolute;
        top: -5px; right: -5px;
        min-width: 20px; height: 20px;
        background: #00e5ff;
        color: #020812; font-weight: 900; font-size: 10.5px;
        padding: 0 5px; border-radius: 999px;
        border: 2px solid #050d1c;
        box-shadow: 0 0 10px rgba(0,229,255,0.8), 0 0 20px rgba(0,229,255,0.4);
        pointer-events: none;
        font-family: 'JetBrains Mono', ui-monospace, system-ui, sans-serif;
        display: flex; align-items: center; justify-content: center;
        z-index: 12;
        letter-spacing: -0.3px;
      }
      .mini-count.pulse { animation: zh-badge-pulse 0.5s cubic-bezier(0.16,1,0.3,1); }

      .header { cursor: grab; touch-action: none; }
      .header:active { cursor: grabbing; }

      .header {
        display: flex; align-items: center; justify-content: space-between;
        padding: 11px 12px;
        background: linear-gradient(135deg, rgba(0,229,255,0.13) 0%, rgba(6,182,212,0.06) 50%, rgba(14,165,233,0.04) 100%);
        border-bottom: 1px solid rgba(0,229,255,0.15);
        cursor: pointer; user-select: none;
        transition: background 0.2s;
      }
      .header:hover { background: linear-gradient(135deg, rgba(0,229,255,0.18) 0%, rgba(6,182,212,0.10) 100%); }
      .header-left { display: flex; align-items: center; gap: 8px; }
      .header-icon {
        width: 28px; height: 28px;
        background: transparent;
        border-radius: 8px;
        display: flex; align-items: center; justify-content: center;
        flex-shrink: 0;
        transition: transform 0.2s, box-shadow 0.2s;
        overflow: hidden;
      }
      .header-icon img {
        width: 28px; height: 28px; object-fit: contain; display: block; pointer-events: none;
        filter: drop-shadow(0 0 6px rgba(0,229,255,0.6));
        border-radius: 7px;
      }
      .header:hover .header-icon { transform: rotate(-5deg) scale(1.08); box-shadow: 0 4px 18px rgba(0,229,255,0.7); }
      .header-title { color: #e0f7fa; font-size: 12px; font-weight: 700; letter-spacing: 0.4px; text-shadow: 0 0 12px rgba(0,229,255,0.4); }
      .header-count {
        font-size: 10px; font-weight: 700; padding: 2px 8px;
        background: rgba(0,229,255,0.15); border: 1px solid rgba(0,229,255,0.35);
        border-radius: 9999px; color: #67e8f9;
        transition: background 0.2s, transform 0.15s;
      }
      .toggle-btn {
        background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.1);
        cursor: pointer; color: #7dd3fc; padding: 5px 8px;
        line-height: 1; border-radius: 6px; display: flex; align-items: center; justify-content: center;
        transition: background 0.15s, color 0.15s, border-color 0.15s, transform 0.2s cubic-bezier(0.16,1,0.3,1);
      }
      .toggle-btn svg { pointer-events: none; transition: transform 0.3s cubic-bezier(0.16,1,0.3,1); }
      .toggle-btn:hover { background: rgba(0,229,255,0.12); border-color: rgba(0,229,255,0.4); color: #00e5ff; transform: scale(1.12); }
      .toggle-btn:hover svg { transform: scale(1.1); }

      .body {
        padding: 10px; overflow-y: auto; overflow-x: hidden;
        max-height: 360px;
      }
      .body::-webkit-scrollbar { width: 3px; }
      .body::-webkit-scrollbar-track { background: rgba(255,255,255,0.03); }
      .body::-webkit-scrollbar-thumb { background: linear-gradient(to bottom, #00e5ff, #0ea5e9); border-radius: 3px; }

      .empty { text-align: center; padding: 28px 12px; color: #3b6a8a; font-size: 11px; line-height: 1.7; }

      .skeleton { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
      .skel-item {
        aspect-ratio: 1; border-radius: 8px;
        background: linear-gradient(90deg, rgba(255,255,255,0.04) 25%, rgba(0,229,255,0.08) 50%, rgba(255,255,255,0.04) 75%);
        background-size: 200% 100%; animation: zh-shimmer 1.5s ease-in-out infinite;
      }
      .skel-item:nth-child(2) { animation-delay: 0.15s; }
      .skel-item:nth-child(3) { animation-delay: 0.30s; }
      .skel-item:nth-child(4) { animation-delay: 0.45s; }
      .skel-item:nth-child(5) { animation-delay: 0.60s; }
      .skel-item:nth-child(6) { animation-delay: 0.75s; }

      .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 7px; }

      .img-wrap {
        position: relative; border-radius: 9px; overflow: hidden;
        border: 2px solid rgba(255,255,255,0.06); cursor: pointer;
        aspect-ratio: 1; background: #080f1e;
        transition: border-color 0.2s, transform 0.2s, box-shadow 0.2s;
        animation: zh-fade-up 0.4s cubic-bezier(0.16,1,0.3,1) both;
      }
      .img-wrap:nth-child(1)  { animation-delay: 0.05s; }
      .img-wrap:nth-child(2)  { animation-delay: 0.10s; }
      .img-wrap:nth-child(3)  { animation-delay: 0.15s; }
      .img-wrap:nth-child(4)  { animation-delay: 0.20s; }
      .img-wrap:nth-child(5)  { animation-delay: 0.25s; }
      .img-wrap:nth-child(6)  { animation-delay: 0.30s; }
      .img-wrap:nth-child(7)  { animation-delay: 0.35s; }
      .img-wrap:nth-child(8)  { animation-delay: 0.40s; }
      .img-wrap:nth-child(9)  { animation-delay: 0.45s; }
      .img-wrap:nth-child(10) { animation-delay: 0.50s; }
      .img-wrap:nth-child(11) { animation-delay: 0.55s; }
      .img-wrap:nth-child(12) { animation-delay: 0.60s; }
      .img-wrap:hover {
        border-color: rgba(0,229,255,0.5);
        transform: scale(1.06) translateY(-2px);
        box-shadow: 0 6px 20px rgba(0,0,0,0.5), 0 0 12px rgba(0,229,255,0.2);
        z-index: 2;
      }
      .img-wrap.selected { border-color: #00e5ff; box-shadow: 0 0 0 1px rgba(0,229,255,0.4), 0 4px 16px rgba(0,229,255,0.2); }
      .img-wrap img { width: 100%; height: 100%; object-fit: cover; display: block; transition: transform 0.25s; }
      .img-wrap:hover img { transform: scale(1.08); }

      .img-check {
        position: absolute; top: 6px; left: 6px;
        width: 18px; height: 18px; border-radius: 50%;
        background: rgba(4,8,20,0.6); border: 1.5px solid rgba(255,255,255,0.4);
        backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px);
        display: flex; align-items: center; justify-content: center;
        transition: background 0.2s, border-color 0.2s, box-shadow 0.2s;
        pointer-events: none;
      }
      .img-wrap.selected .img-check { 
        background: #00e5ff; border-color: #00e5ff; 
        box-shadow: 0 0 10px rgba(0,229,255,0.6); 
      }
      .img-wrap.selected .img-check::after {
        content: '';
        width: 4px; height: 8px;
        border: solid #000;
        border-width: 0 2px 2px 0;
        transform: rotate(45deg);
        margin-bottom: 2px;
        animation: zh-check-pop 0.25s cubic-bezier(0.16,1,0.3,1);
      }
      .img-idx {
        position: absolute; bottom: 6px; right: 6px;
        font-size: 9px; font-weight: 800; color: rgba(255,255,255,0.95);
        background: rgba(4,8,20,0.65); border: 1px solid rgba(255,255,255,0.15);
        backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
        padding: 2px 6px; border-radius: 6px;
      }

      .footer {
        padding: 9px 10px;
        border-top: 1px solid rgba(0,229,255,0.1);
        background: rgba(0,229,255,0.02);
        display: flex; gap: 6px; align-items: center;
      }
      .btn-sm {
        padding: 6px 10px; border-radius: 7px;
        font-size: 10px; font-weight: 700;
        cursor: pointer; border: 1px solid transparent;
        font-family: inherit; white-space: nowrap;
        transition: all 0.18s cubic-bezier(0.16,1,0.3,1);
        position: relative; overflow: hidden;
      }
      .btn-sm:active { transform: scale(0.94) !important; }
      .btn-ghost { background: rgba(255,255,255,0.05); border-color: rgba(255,255,255,0.12); color: #7dd3fc; }
      .btn-ghost:hover { background: rgba(0,229,255,0.1); border-color: rgba(0,229,255,0.4); color: #00e5ff; transform: translateY(-1px); }
      .btn-dl {
        flex: 1;
        background: linear-gradient(90deg, #00c8ff, #0ea5e9, #00e5ff, #0ea5e9, #00c8ff);
        background-size: 200% auto;
        color: #000; font-weight: 900; letter-spacing: 0.3px;
        box-shadow: 0 2px 12px rgba(0,229,255,0.3);
        transition: all 0.3s cubic-bezier(0.16,1,0.3,1);
      }
      .btn-dl:not(:disabled):hover {
        background-position: right center;
        box-shadow: 0 4px 20px rgba(0,229,255,0.55);
        transform: translateY(-1px);
        animation: zh-btn-shine 1.2s linear infinite;
      }
      .btn-dl:not(:disabled):active { transform: translateY(1px) scale(0.97); box-shadow: 0 1px 8px rgba(0,229,255,0.3); }
      .btn-dl:disabled { opacity: 0.3; cursor: not-allowed; background: rgba(255,255,255,0.1); box-shadow: none; }

      .status-bar { padding: 4px 10px 8px; font-size: 10px; color: #3b6a8a; text-align: center; min-height: 20px; transition: color 0.3s; }
      .status-bar.ok  { color: #34d399; text-shadow: 0 0 8px rgba(52,211,153,0.4); }
      .status-bar.err { color: #f87171; }
    `;
    shadow.appendChild(style);

    const panelWrap = document.createElement('div');
    panelWrap.className = 'panel-wrap';
    shadow.appendChild(panelWrap);

    const panel = document.createElement('div');
    panel.className = 'panel';
    panelWrap.appendChild(panel);

    // FAB wrapper (isolates stacking context for rainbow ring)
    const miniWrap = document.createElement('div');
    miniWrap.className = 'mini-widget-wrap';
    miniWrap.style.display = 'none';

    const miniRing = document.createElement('div');
    miniRing.className = 'mini-ring';
    miniWrap.appendChild(miniRing);

    const miniGlow = document.createElement('div');
    miniGlow.className = 'mini-glow';
    miniWrap.appendChild(miniGlow);

    const miniWidget = document.createElement('button');
    miniWidget.className = 'mini-widget';
    miniWidget.type = 'button';
    miniWidget.setAttribute('aria-label', 'Open ZHunter Images');
    miniWidget.innerHTML = `<img src="${chrome.runtime.getURL('icon48.png')}" alt="ZHunter" draggable="false"><span class="mini-logo-fallback" aria-hidden="true">ZH</span>`;
    miniWrap.appendChild(miniWidget);

    const miniTooltip = document.createElement('div');
    miniTooltip.className = 'mini-tooltip';
    miniTooltip.textContent = 'ZHunter — 0 images';
    miniWrap.appendChild(miniTooltip);

    const miniCountEl = document.createElement('span');
    miniCountEl.className = 'mini-count';
    miniCountEl.textContent = '0';
    miniWrap.appendChild(miniCountEl);

    shadow.appendChild(miniWrap);

    const miniLogo = miniWidget.querySelector('img');
    miniLogo.addEventListener('error', () => {
      miniLogo.style.display = 'none';
      miniWidget.querySelector('.mini-logo-fallback').style.display = 'block';
    }, { once: true });

    // ── Header
    const header = document.createElement('div');
    header.className = 'header';
    header.innerHTML = `
      <div class="header-left">
        <div class="header-icon"><img src="${chrome.runtime.getURL('icon48.png')}" alt="ZH" onerror="this.style.display='none';this.parentNode.textContent='ZH'"></div>
        <span class="header-title">ZHunter Images</span>
        <span class="header-count" id="zh-img-count">0</span>
      </div>
      <button class="toggle-btn" id="zh-toggle-btn" title="Minimize" aria-label="Minimize panel">
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M7 2L3 5L7 8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
    `;
    panel.appendChild(header);

    // ── Body
    const body = document.createElement('div');
    body.className = 'body';
    body.id = 'zh-img-body';
    body.innerHTML = `<div class="empty">\uD83D\uDD0D Scanning images...</div>`;
    panel.appendChild(body);

    // ── Footer
    const footer = document.createElement('div');
    footer.className = 'footer';
    footer.innerHTML = `
      <button class="btn-sm btn-ghost" id="zh-sel-all">All</button>
      <button class="btn-sm btn-ghost" id="zh-sel-none">None</button>
      <button class="btn-sm btn-dl" id="zh-dl-btn" disabled>\u2193 Download</button>
    `;
    panel.appendChild(footer);

    // ── Status bar
    const statusBar = document.createElement('div');
    statusBar.className = 'status-bar';
    statusBar.id = 'zh-status';
    panel.appendChild(statusBar);

    // ── State
    let images = [];
    let selected = new Set();
    // v8: the card always starts minimized; the user expands it by clicking the mini button.
    let collapsed = true;
    let widgetPosition = { top: null, bottom: 20, left: null, right: 20 };
    let dragging = false;
    let dragMoved = false;
    let dragOffset = { x: 0, y: 0 };
    let dragOrigin = { x: 0, y: 0 };
    const WIDGET_STATE_KEY = 'zhunterImageWidgetState';

    const toggleBtn = shadow.getElementById('zh-toggle-btn');
    const countEl   = shadow.getElementById('zh-img-count');
    const miniCount = miniCountEl; // from wrapper
    const dlBtn     = shadow.getElementById('zh-dl-btn');
    const status    = shadow.getElementById('zh-status');

    // Helper: pulse badge when count changes
    let _lastMiniCount = 0;
    function pulseMiniCount(n) {
      miniCount.textContent = n > 99 ? '99+' : String(n);
      miniTooltip.textContent = `ZHunter — ${n} image${n !== 1 ? 's' : ''}`;
      if (n !== _lastMiniCount && n > 0) {
        miniCount.classList.remove('pulse');
        void miniCount.offsetWidth; // reflow to restart animation
        miniCount.classList.add('pulse');
        miniCount.addEventListener('animationend', () => miniCount.classList.remove('pulse'), { once: true });
      }
      _lastMiniCount = n;
    }

    const saveWidgetState = () => {
      chrome.storage.local.set({ [WIDGET_STATE_KEY]: {
        collapsed,
        top: widgetPosition.top,
        bottom: widgetPosition.bottom,
        left: widgetPosition.left,
        right: widgetPosition.right
      } }).catch(() => {});
    };
    const applyWidgetPosition = () => {
      const widgetHeight = collapsed ? 68 : 384;
      const widgetWidth = collapsed ? 68 : 299;

      if (Number.isFinite(widgetPosition.top)) {
        const maxTop = Math.max(8, window.innerHeight - widgetHeight - 8);
        widgetPosition.top = Math.max(8, Math.min(widgetPosition.top, maxTop));
        root.style.top = `${widgetPosition.top}px`;
        root.style.bottom = 'auto';
      } else if (Number.isFinite(widgetPosition.bottom)) {
        const maxBottom = Math.max(8, window.innerHeight - widgetHeight - 8);
        widgetPosition.bottom = Math.max(8, Math.min(widgetPosition.bottom, maxBottom));
        root.style.bottom = `${widgetPosition.bottom}px`;
        root.style.top = 'auto';
      } else {
        widgetPosition.bottom = 20;
        root.style.bottom = '20px';
        root.style.top = 'auto';
      }

      if (Number.isFinite(widgetPosition.left)) {
        const maxLeft = Math.max(8, window.innerWidth - widgetWidth - 8);
        widgetPosition.left = Math.max(8, Math.min(widgetPosition.left, maxLeft));
        root.style.left = `${widgetPosition.left}px`;
        root.style.right = 'auto';
      } else {
        root.style.left = 'auto';
        root.style.right = `${Number.isFinite(widgetPosition.right) ? widgetPosition.right : 20}px`;
      }
    };
    const SVG_CHEVRON_LEFT  = `<svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M7 2L3 5L7 8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    const SVG_CHEVRON_RIGHT = `<svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 2L7 5L3 8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    const applyCollapsedState = () => {
      panelWrap.classList.toggle('collapsed', collapsed);
      miniWrap.style.display = collapsed ? 'flex' : 'none';
      toggleBtn.innerHTML = collapsed ? SVG_CHEVRON_RIGHT : SVG_CHEVRON_LEFT;
      toggleBtn.title = collapsed ? 'Expand' : 'Minimize';
      pulseMiniCount(images.length); // always sync tooltip + badge
      applyWidgetPosition();
    };
    const setCollapsed = value => {
      collapsed = !!value;
      // Always dock to bottom-right corner
      widgetPosition = { top: null, bottom: 20, left: null, right: 20 };
      applyCollapsedState();
      saveWidgetState();
    };

    const beginDrag = (event, target) => {
      if (event.button !== undefined && event.button !== 0) return;
      const rect = root.getBoundingClientRect();
      dragging = true;
      dragMoved = false;
      dragOrigin = { x: event.clientX, y: event.clientY };
      dragOffset = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      target.setPointerCapture?.(event.pointerId);
      document.body.style.userSelect = 'none';
      event.preventDefault();
    };
    const moveDrag = event => {
      if (!dragging) return;
      const nextLeft = event.clientX - dragOffset.x;
      const nextTop = event.clientY - dragOffset.y;
      if (Math.abs(event.clientX - dragOrigin.x) > 3 || Math.abs(event.clientY - dragOrigin.y) > 3) dragMoved = true;
      widgetPosition.left = Math.max(8, Math.min(nextLeft, window.innerWidth - (collapsed ? 68 : 295) - 8));
      widgetPosition.top = Math.max(8, Math.min(nextTop, window.innerHeight - (collapsed ? 68 : 380)));
      widgetPosition.bottom = null;
      widgetPosition.right = null;
      applyWidgetPosition();
    };
    const endDrag = () => {
      if (!dragging) return;
      dragging = false;
      document.body.style.userSelect = '';
      saveWidgetState();
    };
    header.addEventListener('pointerdown', event => {
      if (event.target !== toggleBtn) beginDrag(event, header);
    });
    window.addEventListener('pointermove', moveDrag, { passive: false });
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);

    toggleBtn.addEventListener('click', event => {
      event.stopPropagation();
      setCollapsed(!collapsed);
    });

    // Instant click to expand without drag interference
    miniWrap.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      setCollapsed(false);
    });

    // Always start minimized at bottom-right
    collapsed = true;
    widgetPosition = { top: null, bottom: 20, left: null, right: 20 };
    applyCollapsedState();

    // ── Render grid
    function renderGrid() {
      const b = shadow.getElementById('zh-img-body');
      if (!images.length) {
        b.innerHTML = `<div class="empty">🔍 No product images found<br><span style="font-size:9px;opacity:0.6">Navigate to a product page to scan</span></div>`;
        countEl.textContent = '0';
        pulseMiniCount(0);
        return;
      }
      countEl.textContent = images.length;
      pulseMiniCount(images.length);
      const grid = document.createElement('div');
      grid.className = 'grid';
      images.forEach((url, i) => {
        const wrap = document.createElement('div');
        wrap.className = 'img-wrap' + (selected.has(i) ? ' selected' : '');
        wrap.innerHTML = `
          <img src="${url}" loading="lazy" alt="img ${i+1}" title="${url}"
               onerror="this.style.opacity='0.2';this.src='data:image/svg+xml,<svg xmlns=\\'http://www.w3.org/2000/svg\\' viewBox=\\'0 0 100 100\\'><text y=\\'.9em\\' font-size=\\'90\\'>\u{1F5BC}</text></svg>'">
          <div class="img-check"></div>
          <div class="img-idx">${i + 1}</div>
        `;
        wrap.addEventListener('click', () => {
          if (selected.has(i)) selected.delete(i);
          else selected.add(i);
          wrap.classList.toggle('selected', selected.has(i));
          updateDlBtn();
        });
        grid.appendChild(wrap);
      });
      b.innerHTML = '';
      b.appendChild(grid);
      updateDlBtn();
    }

    function updateDlBtn() {
      const n = selected.size;
      dlBtn.disabled = n === 0;
      dlBtn.textContent = n > 0 ? `\u2193 Download ${n}` : '\u2193 Download';
    }

    // ── Select All / None
    shadow.getElementById('zh-sel-all').addEventListener('click', () => {
      images.forEach((_, i) => selected.add(i));
      renderGrid();
    });
    shadow.getElementById('zh-sel-none').addEventListener('click', () => {
      selected.clear();
      renderGrid();
    });

    // ── Download Selected
    dlBtn.addEventListener('click', async () => {
      if (!selected.size) return;
      dlBtn.disabled = true;
      const toDownload = [...selected].sort();
      let done = 0;

      status.className = 'status-bar';
      status.textContent = `Downloading 0 / ${toDownload.length}...`;

      const productSlug = document.title.replace(/[^a-z0-9]/gi, '-').toLowerCase().slice(0, 30);

      for (const idx of toDownload) {
        const url = images[idx];
        const ext = url.match(/\.(jpe?g|png|webp|gif)/i)?.[1] || 'jpg';
        const filename = `${productSlug}-img${idx + 1}.${ext}`;
        try {
          downloadViaBackground(url, filename);
          done++;
          status.textContent = `Downloading ${done} / ${toDownload.length}...`;
          await new Promise(r => setTimeout(r, 400)); // stagger downloads
        } catch (_) {}
      }

      status.className = 'status-bar ok';
      status.textContent = `\u2713 ${done} image${done !== 1 ? 's' : ''} downloaded!`;
      dlBtn.disabled = false;
      setTimeout(() => { status.textContent = ''; status.className = 'status-bar'; }, 4000);
    });

    // ── Load images (with delay for SPAs)
    let knownImages = new Set();
    let refreshTimer = null;
    const refreshImages = () => {
      const next = collectPageImages();
      if (!next.length && images.length) return;
      const selectedUrls = new Set([...selected].map(index => images[index]).filter(Boolean));
      const previousUrls = new Set(images);
      images = next;
      selected = new Set(images.map((url, index) => {
        if (!previousUrls.size || selectedUrls.has(url) || !previousUrls.has(url)) return index;
        return -1;
      }).filter(index => index >= 0));
      const changed = images.length !== knownImages.size || images.some(url => !knownImages.has(url));
      if (changed || !knownImages.size) {
        knownImages = new Set(images);
        renderGrid();
      }
    };
    const scheduleRefresh = () => {
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(refreshImages, 350);
    };
    setTimeout(refreshImages, 900);
    [1800, 3200, 5200, 8000].forEach(delay => setTimeout(refreshImages, delay));
    const galleryObserver = new MutationObserver(scheduleRefresh);
    galleryObserver.observe(document.body, {
      subtree: true, childList: true, attributes: true,
      attributeFilter: ['src', 'srcset', 'data-src', 'data-lazy-src', 'data-image-url', 'data-image-src', 'data-zoom-image']
    });
    setTimeout(() => galleryObserver.disconnect(), 10000);
  }

  // ── Kick off
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initImagePanel);
  } else {
    initImagePanel();
  }
})();

} // end __zhunterContentLoaded guard

// ── In-page toast (feedback for the right-click menu) ─────────
chrome.runtime.onMessage.addListener(message => {
  if (message?.action !== 'ZH_PAGE_TOAST') return;
  try {
    let host = document.getElementById('zhunter-page-toast');
    if (!host) {
      host = document.createElement('div');
      host.id = 'zhunter-page-toast';
      host.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:2147483647;pointer-events:none;';
      document.documentElement.appendChild(host);
    }
    const el = document.createElement('div');
    const color = message.type === 'warn' ? '#FBBF24' : message.type === 'err' ? '#F87171' : '#00E5FF';
    el.style.cssText = 'font:600 13px Inter,Segoe UI,system-ui,sans-serif;color:#E2E8F0;background:linear-gradient(135deg,rgba(8,20,50,.97),rgba(4,10,28,.98));border:1px solid rgba(0,229,255,.35);border-left:3px solid ' + color + ';border-radius:10px;padding:10px 14px;margin-top:8px;box-shadow:0 16px 48px rgba(0,0,0,.6),0 0 24px rgba(0,229,255,.18);opacity:0;transform:translateY(6px);transition:opacity .18s,transform .18s;max-width:320px;';
    el.textContent = String(message.text || '');
    host.appendChild(el);
    requestAnimationFrame(() => { el.style.opacity = '1'; el.style.transform = 'none'; });
    setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateY(6px)'; setTimeout(() => el.remove(), 250); }, 2600);
  } catch (_) {}
});
