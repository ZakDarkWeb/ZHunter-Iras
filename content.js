// ============================================================
// ZHunter PRO v10.3.1 — Content Script
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
    .replace(/\blist\s*price\s*:?\s*[$£€¥₹₩]?\s*\d[\d.,]*/gi, '')
    .replace(/\bwas\s*:?\s*[$£€¥₹₩]?\s*\d[\d.,]*/gi, '')
    .replace(/\btypical\s*price\s*:?\s*[$£€¥₹₩]?\s*\d[\d.,]*/gi, '')
    .replace(/\boriginal\s*price\s*:?\s*[$£€¥₹₩]?\s*\d[\d.,]*/gi, '')
    .replace(/\b\d+(?:\.\d+)?\s*(?:¢|cents?)\s*\/\s*(?:oz|fl\.?\s*oz|count|ea|lb)\b/gi, '')
    .replace(/\bfrom\s*:?\s*/gi, '')
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
      // Amazon Auto-Crop: _AC_SL1500_ automatically trims excess white margins and provides 1500px HD resolution.
      let clean = u.pathname.replace(/(?:\._[A-Za-z0-9_.,-]+_\.?)+/g, '.');
      u.pathname = clean.replace(/(\.[a-zA-Z0-9]+)$/i, '._AC_SL1500_$1');
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
    '[class*="brand-logo"], [class*="BrandLogo"], ' +
    // Ads, sponsored placements, carousels, recommendations, and reviews
    '[id*="ape_"], [class*="ape-"], [id*="ad-"], [class*="ad-"], [id*="ilm"], ' +
    '[class*="sponsored"], [data-cel-widget*="ad"], [id*="sims"], [id*="similarities"], ' +
    '[id*="recommendations"], [id*="rhf"], [id*="review"], [class*="review"], ' +
    '#customerReviews, #va-related-videos-widget_feature_div, #dp-ads-middle'
  );
  if (badParent) return true;

  // Amazon safeguard: reject images outside product image container
  if (location.hostname.includes('amazon.')) {
    const inAmzGallery = imgEl.closest(
      '#imageBlock, #imageBlock_feature_div, #main-image-container, ' +
      '#altImages, #imgTagWrapperId, #leftCol, #dp-container #left-col, #landingImage'
    );
    if (!inAmzGallery) return true;
  }

  return false;
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

// ── Bot Challenge Detection (Walmart / Amazon / Sam's Club) ──
function checkBotChallenge() {
  try {
    const docText = (document.body ? document.body.innerText : '') || '';
    const title = (document.title || '').toLowerCase();

    // Walmart / PerimeterX
    if (document.getElementById('px-captcha') || /press\s*&\s*hold/i.test(docText) || /robot or human\?/i.test(title) || (title.includes('blocked') && host().includes('walmart'))) {
      return 'Walmart / PerimeterX Bot Check';
    }
    // Amazon Robot Check
    if (title.includes('robot check') || /api-services-support@amazon\.com/i.test(docText) || document.querySelector('form[action*="validateCaptcha"]')) {
      return 'Amazon Robot Check / Captcha';
    }
    // Sam's Club / Akamai
    if (title.includes('access denied') || /reference\s*#[0-9a-f.]+/i.test(docText)) {
      return "Sam's Club / Akamai Access Denied";
    }
  } catch (_) {}
  return null;
}

// ── Human-Like Telemetry & Carousel Hydration ────────────────
// Generates natural pointer movements and a progressive micro-scroll.
// 1) Satisfies PerimeterX, Akamai (_abck), and Cloudflare sensor scripts that expect user activity.
// 2) Triggers IntersectionObserver on Walmart, Sam's Club, and Amazon to unlock lazy-loaded carousel images.
async function simulateHumanInteraction() {
  try {
    if (typeof window === 'undefined' || !document.body) return;

    // Jitter mousemove / pointermove across viewport coordinates
    const points = [
      { x: Math.floor(window.innerWidth * 0.2) + Math.floor(Math.random() * 50), y: 150 + Math.floor(Math.random() * 40) },
      { x: Math.floor(window.innerWidth * 0.4) + Math.floor(Math.random() * 60), y: 280 + Math.floor(Math.random() * 50) },
      { x: Math.floor(window.innerWidth * 0.3) + Math.floor(Math.random() * 40), y: 360 + Math.floor(Math.random() * 60) }
    ];

    for (const pt of points) {
      const target = document.elementFromPoint(pt.x, pt.y) || document.body;
      const mouseEvtInit = {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: pt.x,
        clientY: pt.y,
        screenX: pt.x + (window.screenX || 0),
        screenY: pt.y + (window.screenY || 0),
        buttons: 0
      };
      try { target.dispatchEvent(new PointerEvent('pointermove', mouseEvtInit)); } catch (_) {}
      try { target.dispatchEvent(new MouseEvent('mousemove', mouseEvtInit)); } catch (_) {}
    }

    // Stepped micro-scroll to activate image observers and lazy-carousels
    const originalY = window.scrollY;
    const scrollTarget = Math.min(380, (document.body.scrollHeight || 1000) - window.innerHeight);
    if (scrollTarget > 50) {
      window.scrollBy({ top: scrollTarget, behavior: 'smooth' });
      await new Promise(r => setTimeout(r, 200));
      window.scrollTo({ top: originalY, behavior: 'smooth' });
      await new Promise(r => setTimeout(r, 100));
    }
  } catch (_) {}
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
  // Strategy 0: __NEXT_DATA__ JSON (authoritative product pricing)
  try {
    const nextEl = document.getElementById('__NEXT_DATA__');
    if (nextEl) {
      const nd = JSON.parse(nextEl.textContent || '{}');
      const root = nd?.props?.pageProps?.initialData?.data?.product
                || nd?.pageProps?.initialData?.data?.product
                || nd?.initialData?.data?.product;
      const jsonPrice = root?.priceInfo?.currentPrice?.priceString
                     || root?.priceInfo?.currentPrice?.price
                     || root?.primaryOffer?.offerPrice;
      if (jsonPrice) {
        const pStr = String(jsonPrice).trim();
        return pStr.startsWith('$') ? pStr : `$${pStr}`;
      }
    }
  } catch (_) {}

  // Prefer aria-label on the primary price wrapper (has the full formatted price)
  const ariaSelectors = [
    '[data-testid="price-wrap"] [itemprop="price"]',
    '[data-automation-id="product-price"] [itemprop="price"]',
    '[data-testid="price-wrap"] span[aria-label*="$"]',
    '[data-automation-id="product-price"] span[aria-label*="$"]',
    '[data-automation-id="product-price"]',
    '[data-testid="price-wrap"]',
    '[itemprop="price"]'
  ];
  for (const sel of ariaSelectors) {
    for (const el of document.querySelectorAll(sel)) {
      const attr = el.getAttribute('aria-label') || el.getAttribute('content') || '';
      const raw = attr || el.innerText || '';
      // Skip warranty, protection plan, delivery threshold, and unit pricing
      if (/per\s+(oz|ounce|fl|count|ea|lb)|warranty|protection|shipping|minimum|pickup/i.test(raw)) continue;
      let c = cleanPriceText(raw);
      if (!c || !/\d/.test(c)) continue;
      // Walmart price "$51" + "99" alag spans mein hota hai → innerText "$5199" (dot gayab) → 100x price
      if (!attr && /^[$£€]?\d{4,}$/.test(c) && el.children.length >= 2) c = c.replace(/(\d{2})$/, '.$1');
      return c;
    }
  }

  // Reconstruct from characteristic + mantissa
  const priceRoot = document.querySelector('[data-testid="price-wrap"], [data-automation-id="product-price"]') || document;
  const charEl = priceRoot.querySelector('.price-characteristic, [itemprop="price"]');
  const mantEl = priceRoot.querySelector('.price-mantissa');
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

  // Amazon product images: use _AC_SL1500_ (Auto-Crop 1500px).
  // Amazon's _AC_ automatically detects and crops out excess white margins around the product,
  // framing the item tightly and sharply at 1500px HD resolution (identical to right-click saving).
  function toAmazonAutoCrop(url) {
    if (!url || typeof url !== 'string' || !url.startsWith('http')) return null;
    let clean = url.split('?')[0];
    clean = clean.replace(/(?:\._[A-Za-z0-9_.,-]+_\.?)+/g, '.');
    return clean.replace(/(\.[a-zA-Z0-9]+)$/i, '._AC_SL1500_$1');
  }

  const seenKeys = new Set();

  function addHiResImg(url) {
    const sized = toAmazonAutoCrop(url);
    if (!sized) return;
    const key = canonImageKey(sized);
    if (seenKeys.has(key)) return;
    seenKeys.add(key);
    r.images.push(sized);
  }

  function addFallbackImg(url) {
    const sized = toAmazonAutoCrop(url);
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
      // v10.3.1 BUG FIX: variation wale products (Color: White / Yellow / …) ke script mein SAB variants ki images hoti hain —
      // sirf 'initial' (is page ka selected variant) wala array parho, warna har variant ko ek jaisi images milti hain.
      try {
        const ci = t.indexOf('colorImages');
        if (ci >= 0) {
          const ii = t.indexOf('initial', ci);
          const ab = ii >= 0 ? t.indexOf('[', ii) : -1;
          if (ab >= 0 && ab - ii < 20) {
            let depth = 0, end = -1;
            for (let i = ab; i < t.length && i < ab + 400000; i++) { const ch = t[i]; if (ch === '[') depth++; else if (ch === ']') { depth--; if (depth === 0) { end = i; break; } } }
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
  // v10.3.1 sanity: page ki main image (landingImage data-old-hires) entries mein na ho to script galat variant ka hai → DOM gallery use karo
  try {
    const li = document.getElementById('landingImage');
    const liKey = li ? canonImageKey(li.getAttribute('data-old-hires') || li.src || '') : '';
    if (liKey && entries.length && !entries.some(e => canonImageKey(e.hiRes || e.best || '') === liKey)) entries = [];
  } catch (_) {}
  entries.forEach(e => {
    if (e.hiRes) addHiResImg(e.hiRes);
    else if (e.best) addHiResImg(e.best);
  });

  // ── DOM gallery fallback: used if script extraction found nothing or wrong variant ──
  // Handles new Amazon "inline-twister" variant pages where colorImages is absent from scripts.
  if (r.images.length === 0) {
    const galleryImgs = document.querySelectorAll(
      '#landingImage, #imgTagWrapperId img, ' +
      '#altImages li:not(.video-item) img, ' +
      '#imageBlock img:not(.video-item img), .imageThumbnail img, ' +
      // Also capture any lazily-rendered thumbnails that haven't swapped src yet
      '#altImages [data-old-hires], #imageBlock_feature_div [data-old-hires]'
    );
    galleryImgs.forEach(img => {
      if (isBadImageElement(img)) return;
      // 1. data-old-hires: convert to _AC_SL1500_ for auto-crop without white padding
      const oldHires = img.getAttribute('data-old-hires') || '';
      if (oldHires) { const c = toAmazonAutoCrop(oldHires); if (c) { addHiResImg(c); return; } }
      // 2. data-a-dynamic-image: pick largest entry, convert to _AC_SL1500_
      const dyn = pickAmazonDynamic(img);
      if (dyn) { const c = toAmazonAutoCrop(dyn); if (c) { addHiResImg(c); return; } }
      // 3. data-zoom-image / data-large-image
      const zoom = img.getAttribute('data-zoom-image') || img.getAttribute('data-large-image') || '';
      if (zoom) { const c = toAmazonAutoCrop(zoom); if (c) { addHiResImg(c); return; } }
      // 4. Lazy src attributes (not yet rendered)
      const lazySrc = img.getAttribute('data-src') || img.getAttribute('data-lazy-src') || img.getAttribute('data-lazy') || '';
      if (lazySrc) { const c = toAmazonAutoCrop(lazySrc); if (c) { addHiResImg(c); return; } }
      // 5. Rendered src — thumbnail upscale to _AC_SL1500_
      const src = img.currentSrc || img.src || '';
      if (!src || /play[-_]?button|video[-_]?thumbnail|pkplay/i.test(src)) return;
      const c = toAmazonAutoCrop(src);
      if (c) addHiResImg(c);
    });
  }

  // Pass 2: Targeted script scan ONLY if DOM and Pass 0 yielded nothing (strictly scoped to image block scripts)
  if (r.images.length === 0) {
    for (const script of document.querySelectorAll('script:not([src])')) {
      const t = script.textContent || '';
      if (!t.includes('colorImages') && !t.includes('ImageBlockATF') && !t.includes('imageBlock')) continue;
      // Exclude any sponsored ad scripts
      if (t.includes('ape_Detail') || t.includes('adCreativeMetaData') || t.includes('adProgramId')) continue;
      const rawScan = /https:\/\/(?:m\.media-amazon\.com|images-amazon\.com)\/images\/I\/[A-Za-z0-9%+\-_.]+\.(?:jpg|jpeg|png|webp)/g;
      let match;
      while ((match = rawScan.exec(t)) !== null) {
        addHiResImg(match[0]);
      }
      if (r.images.length > 0) break;
    }
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
    // v10.2.3: inline <script> ki jagah background chrome.scripting (MAIN world) — temu.com ki CSP inline block karti hai
    const temuData = temuIsSellerCenter ? null : await new Promise((resolve) => {
      let done = false; const fin = (v) => { if (!done) { done = true; resolve(v); } };
      try { chrome.runtime.sendMessage({ action: 'ZH_PAGE_INIT_DATA' }, (r) => { void chrome.runtime.lastError; try { fin(r?.data ? JSON.parse(r.data) : null); } catch (_) { fin(null); } }); } catch (_) { fin(null); }
      setTimeout(() => fin(null), 2500);
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
  // v9.8.1: page-navigation text jo brand nahi hai
  if (/^(brand shop directory|brands?|brands? & intellectual property|shop all|see all|shop now|sponsored|departments?|services?|all departments)$/i.test(b)) return '';
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
      // v9.8.1: Walmart ka asal brand link `a[data-seo-id="brand-name"]` (e.g. "Great Value"); generic `a[href*="/brand/"]` footer ka
      // "Brand Shop Directory" / sponsored carousel pakar leta tha → ab sirf main product area ke andar aur junk reject.
      d.brand = cleanBrand(txt(document.querySelector('a[data-seo-id="brand-name"], a[data-testid="product-brand-link"], [link-identifier="brandName"], [data-testid="brand-link"], .prod-brandName')));
      if (!d.brand) {
        const scope = document.querySelector('#maincontent [data-testid="flex-container"], #maincontent, main') || document;
        const cand = [...scope.querySelectorAll('a[href*="/brand/"], a[href*="/cp/"], [class*="brand-name" i]')].find(a => !/branddirectory|\/brand\/?$/i.test(a.getAttribute('href') || '') && !a.closest('footer, nav, [data-testid*="carousel" i], [data-test-id="gpt-main"], [aria-label="Advertisement"]'));
        d.brand = cleanBrand(txt(cand));
      }
      if (/^(brand shop directory|brands?( & intellectual property)?|shop all|see all|visit the store)$/i.test(d.brand)) d.brand = '';
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
  const botWarn = checkBotChallenge();
  let data;
  try {
    const platformFn = pickPlatform();
    data = await platformFn() || {};
  } catch (_) {
    data = { title: document.title || '', price: '', images: [], videos: [], variants: [] };
  }
  if (botWarn) data.botWarning = botWarn;

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
// v9.10.2 — Temu ke div[role=button] React buttons: sirf mousedown+click register nahi hota; poora pointer sequence
function temuClick(el) {
  if (!el) return false;
  for (const t of ['pointerover', 'pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) { try { el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window, button: 0 })); } catch (_) {} }
  return true;
}
let _temuAbort = false; // v10.3.2 — side panel Stop → background TEMU_ABORT → sab waits foran khatam
function temuWait(fn, timeout = 8000, step = 200) {
  return new Promise(resolve => {
    const t0 = Date.now();
    (function poll() {
      if (_temuAbort) return resolve(null);
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
    if (heading) return heading.closest('[class*="wrap-"]') || heading.closest('[class]')?.parentElement || heading.parentElement;
    // v9.9.2 fallback: general table ka header th "File name / Date uploaded, Upload ID" (categories table mein alag th hote hain)
    const th = [...document.querySelectorAll('th[data-testid="beast-core-table-th"]')].find(t => /date uploaded,\s*upload id/i.test(t.textContent || ''));
    if (th) return th.closest('[class*="wrap-"]') || th.closest('[data-testid="beast-core-table"]')?.parentElement?.parentElement || null;
    return null;
  } catch (_) { return null; }
}
// v9.9.2 — page reload/naya tab "Add products by categories" par khulta hai; tab general section (aur uski Upload history) DOM mein hoti hi nahi.
// Pehle general template tab select karo, phir section ka 8s tak wait.
async function temuEnsureHistorySection(report) {
  let sec = temuHistorySection();
  if (sec) return sec;
  try {
    const title = [...document.querySelectorAll('[class*="upload_page_tab_item_title"]')].find(d => /general template/i.test(d.textContent || ''));
    const item = title && (title.closest('[class*="upload_page_tab_item-"]') || title.parentElement);
    if (item && !/active/i.test(item.className)) { item.click(); title.click(); report && report.push('• "Add products via general template" tab select kiya'); }
  } catch (_) {}
  sec = await temuWait(temuHistorySection, 8000, 300);
  return sec;
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
  _temuAbort = false;
  const ok = (m) => report.push('✓ ' + m);
  const fail = (m) => { if (_temuAbort) { report.push('🛑 Stop dabaya'); return { success: false, aborted: true, report }; } report.push('✗ ' + m); return { success: false, report }; };

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
      if (_temuAbort) return { success: false, aborted: true, report: [...report, '🛑 Stop dabaya — Temu ne abhi file uthai nahi thi'] };
      await new Promise(r => setTimeout(r, 700));
      uploadId = newId();
      if (progressText() !== null || uploadId || cancelVisible() || temuTopHistorySignature() !== beforeSig) { accepted = true; break; }
      progress('uploading');
      if (Date.now() - lastNote > 30000) { lastNote = Date.now(); report.push(`• File upload ho rahi hai… (${Math.round((Date.now() - t0) / 1000)}s)`); }
    }
    if (!accepted) { report.push('• 90s mein Temu ne file uthai nahi (na progress, na Upload ID) — peeche se Upload history dekhta rahunga'); return { success: true, confirmed: false, beforeSig, report }; }
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
    if (!finished) { report.push(`• Processing 200s mein poori nahi hui (last ${lastPct}%) — peeche se Upload history dekhta rahunga (10 min tak)`); return { success: true, confirmed: false, uploadId, beforeSig, report }; }
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
  const tags = [...sel.querySelectorAll('[class*="IPT_tag"], [class*="tagItem"], [class*="Tag_"], [class*="ST_tag"]')].map(t => t.textContent.replace(/[✕x×]/g, '').trim()).filter(Boolean);
  if (tags.length) return tags.join(', ');
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
  // v9.14.0: candidates array → pehla jo dropdown mein mile; '__first__' → dropdown ka pehla option
  if (Array.isArray(want)) { for (const w of want) { const r = await temuPickSelectValue(sel, w); if (r === 'set' || r === 'already') return r; } return 'no_option'; }
  if (want === '__first__') {
    const head = sel.querySelector('[data-testid="beast-core-select-header"]') || sel;
    head.scrollIntoView({ block: 'center' }); await temuSleep(120); temuClick(head); await temuSleep(400);
    let opts = []; const t0 = Date.now(); while (Date.now() - t0 < 4000 && !opts.length) { await temuSleep(200); opts = temuDropdownOptions().filter(o => (o.textContent || '').trim()); }
    if (!opts.length) { try { document.body.click(); } catch (_) {} return 'no_option'; }
    temuClick(opts[0]); await temuSleep(350); try { document.body.click(); } catch (_) {}
    return temuSelectCurrent(sel) || sel.querySelector('[class*="IPT_tag"] [class*="tag"], [class*="Tag_"]') ? 'set' : 'verify_failed';
  }
  const wantL = String(want).trim().toLowerCase();
  if (temuSelectCurrent(sel).toLowerCase().includes(wantL)) return 'already';
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
       || opts.find(o => o.textContent.trim().toLowerCase().includes(wantL))
       || opts.find(o => wantL.includes(o.textContent.trim().toLowerCase()))
       || null;
  }
  if (!opt) {
    if (inp) { try { inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true })); } catch (_) {} }
    await temuSleep(300);
    if (temuSelectCurrent(sel).toLowerCase().includes(wantL)) return 'set';
    try { document.body.click(); } catch (_) {}
    return 'no_option';
  }
  opt.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  opt.click();
  await temuSleep(400);
  try { document.body.click(); } catch (_) {}
  await temuSleep(200);
  const cur = temuSelectCurrent(sel).toLowerCase();
  return cur.includes(wantL) || wantL.includes(cur) || cur === wantL || cur.startsWith(wantL) || sel.querySelector('[class*="IPT_tag"], [class*="Tag_"], [class*="tagItem"]') ? 'set' : 'verify_failed';
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
const TEMU_DRAFT_FALLBACKS = { 'material': 'Other', 'applicable age group': '14 Years+', 'age group': '14 Years+' };
function temuRowFields(row) {
  const out = [];
  for (const fi of row.querySelectorAll('[data-testid="beast-core-form-item"]')) {
    const lb = fi.querySelector('[class*="Form_itemLabelContent"]');
    if (!lb) continue;
    const label = lb.textContent.trim();
    if (!label || /^variant\s*\d/i.test(label)) continue; // Variant 1/2 selectors — never touch
    const required = !!fi.querySelector('[class*="Form_itemRequired"]');
    const sel = fi.querySelector('[data-testid="beast-core-select"]');
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
      warn(`Active store is "${mall}" (extension: "${expectStore}") — proceeding with "${mall}"…`);
  }
  const rows = await temuWait(() => {
    const fathers = [...document.querySelectorAll('tr[data-testid="beast-core-table-body-tr"].TB_father_123, tr.TB_father_123, tr[class*="TB_father"]')];
    if (fathers.length) return fathers;
    const fallback = [...document.querySelectorAll('tr[data-testid="beast-core-table-body-tr"]')].filter(tr => /^\d{10,}$/.test(tr.getAttribute('data-row-key') || ''));
    return fallback.length ? fallback : null;
  }, 10000);
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
      // v9.15.1: rule → defaults → attr guess/fallback list → '__first__'; composition table support; 8s limit per field (stuck na ho)
      const isSensitive = /allergen|ingredient|drug\s*fact|nutrition|dietary|expiration|warning/i.test(f.label);
      const want = pick(ruleAttrs, f.label) ?? pick(defaults, f.label) ?? temuAttrGuess(f.label, name) ?? (!isSensitive ? TEMU_DRAFT_FALLBACKS[f.label.trim().toLowerCase()] : null) ?? (!isSensitive ? '__first__' : null);
      if (!want) {
        notes.push(`${f.label}: auto-fill skip (khud check karein)`);
        stillEmpty++;
        continue;
      }
      const withTimeout = (p, ms) => Promise.race([p, new Promise(r => setTimeout(() => r('timeout'), ms))]);
      const isComp = !!f.fi.querySelector('table');
      if (isComp) {
        const res = await withTimeout(temuFillComposition(f.fi, want), 9000);
        if (res === 'set' || res === 'already') { changed++; notes.push(`${f.label}=${Array.isArray(want) ? want[0] : want} 100%`); } else { notes.push(`${f.label}: composition nahi bhar saka (${res})`); stillEmpty++; }
        try { document.body.click(); } catch (_) {}
        continue;
      }
      if (f.sel) {
        let res = await withTimeout(temuPickSelectValue(f.sel, want), 8000);
        if (res !== 'set' && res !== 'already' && want !== '__first__' && !isSensitive) { try { document.body.click(); } catch (_) {} await temuSleep(200); res = await withTimeout(temuPickSelectValue(f.sel, '__first__'), 8000); }
        if (res === 'set' || res === 'already') { changed += res === 'set' ? 1 : 0; notes.push(`${f.label}=${temuSelectCurrent(f.sel) || want}`); }
        else { notes.push(`${f.label}: "${Array.isArray(want) ? want.join('/') : want}" dropdown mein nahi mila (${res})`); stillEmpty++; try { document.body.click(); } catch (_) {} }
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
      if (btn) {
        temuClick(btn);
        await temuSleep(600);
        try {
          const confirmBtn = [...document.querySelectorAll('[data-testid="beast-core-modal"] [role="button"], [class*="Modal_"] [role="button"], [class*="modal"] button')].find(b => /^\s*(confirm|ok|yes|submit)\s*$/i.test((b.textContent || '').trim()) && temuVisible(b));
          if (confirmBtn && confirmBtn !== btn) temuClick(confirmBtn);
        } catch (_) {}
        ok('Submit dabaya — Temu par drafts save ho gaye');
      } else {
        warn('Submit button nahi mila / disabled — page par khud Submit dabayen');
      }
    }
  }
  report.unshift(`${rows.length} drafts, ${changed} fields set, ${stillEmpty} still empty`);
  return { success: true, report, changed, total: rows.length, stillEmpty };
}

// ═══ v9.14.0 — "Product action required → Missing required attributes" (product-action.html?reform_type=excel_publish_complete_attributes) ═══
// DOM (Sep 2026): rows tr[data-testid=beast-core-table-body-tr] jin mein .pId-* "Goods ID: N" + .catName-* "Category: A / B / C";
// fields [data-testid=beast-core-form-item][id="<goodsId>.goodsProperty.<n>"] → label .Form_itemLabelContent_123, select [data-testid=beast-core-select]
// (filled = .inputItemRenderer-*, khali = placeholder "Select"); composition fields (Material / Cover Material / Filling Material) = nested table:
// select "Enter" + % input + "Add material" + "Sum (0.00%)". Row Submit = last td .btn-*.primary-* "Submit".
const TEMU_ATTR_FALLBACKS = {
  'power mode': ['Without electricity', 'Room electrical/hard wiring'],
  'battery properties': ['No Battery', 'Without Battery', 'No battery', 'Not Contain Battery', '__first__'],
  'wireless property': ['Not Wireless', 'No', 'Wired', '__first__'],
  'operating voltage': ['120V', '110V', '110-120V', '__first__'],
  'power supply': ['Use Without Electricity', 'Battery', '__first__'],
  'indoor outdoor usage': ['Indoor', '__first__'],
  'composition': ['Others', 'Other', '__first__'],
  'estimated burn time (single candle)': ['__first__'],
  'contain sku area ≥ 2.16m²': ['No'], 'contain sku longest side ≥1.8m': ['No'],
  'material type': ['Textile Material', '__first__'],
  'material': ['Plastic', 'Other', 'Others', '__first__'], 'cover material': ['Polyester', 'Cotton', '__first__'], 'filling material': ['Polyester', 'Cotton', '__first__'],
  'applicable age group': ['14 Years+', 'Adults', '__first__'], 'age group': ['14 Years+', '__first__']
};
function temuAttrGuess(label, title) {
  const l = label.trim().toLowerCase(), t = String(title || '').toLowerCase();
  if (/allergen/i.test(l)) {
    const matched = [];
    if (/\bprotein\b|shake|whey|casein|milk|dairy|latte|vanilla|chocolate/i.test(t)) {
      matched.push("Contains cow's milk", "Cow's milk", "Milk", "Dairy");
    }
    if (/\balmond|cashew|walnut|pecan|pistachio|hazelnut|tree nut/i.test(t)) {
      matched.push("Contains Tree nuts", "Tree nuts", "Almond");
    }
    if (/\bpeanut|peanuts|peanut butter\b/i.test(t)) {
      matched.push("Contains Peanuts", "Peanuts");
    }
    if (/\begg\b|\beggs\b/i.test(t) && !/eggplant/i.test(t)) {
      matched.push("Contains hen's egg", "Hen's egg", "Egg");
    }
    if (/\bsoy\b|soybean|soya/i.test(t)) {
      matched.push("Contains Soybean", "Soybean", "Soy");
    }
    if (/\bwheat\b|gluten|flour|cereal|biscuit|cookie|cinnamon roll/i.test(t)) {
      matched.push("Contains Wheat", "Wheat");
    }
    if (/\bfish\b|salmon|tuna/i.test(t)) {
      matched.push("Contains Fish", "Fish");
    }
    if (/\bsesame\b/i.test(t)) {
      matched.push("Contains Sesame", "Sesame");
    }
    return matched.length ? matched : ["Contains cow's milk", "Milk", "Contains Tree nuts", "__first__"];
  }
  if (l === 'power mode') return /corded|electric|plug|watt|\bv\b|volt|toaster|cooker|mixer|blender|heater|lamp|led/.test(t) && !/battery|cordless|manual/.test(t) ? ['Room electrical/hard wiring', 'Without electricity'] : ['Without electricity', 'Room electrical/hard wiring'];
  if (l === 'material') { if (/stainless|steel|metal|iron/.test(t)) return ['Stainless Steel', 'Metal', 'Other', '__first__']; if (/glass/.test(t)) return ['Glass', 'Other', '__first__']; if (/wood|bamboo/.test(t)) return ['Wood', 'Bamboo', 'Other', '__first__']; if (/cotton|fabric|plush|fleece|towel/.test(t)) return ['Cotton', 'Polyester', 'Other', '__first__']; if (/coir|jute/.test(t)) return ['Coir', 'Jute', 'Natural Fiber', 'Other', '__first__']; }
  return TEMU_ATTR_FALLBACKS[l] || null;
}
async function temuFillComposition(fi, wantList) {
  // nested material table: "No data" ho to pehle "Add material" dabao; phir pehli row ka select + 100%
  const tbl = () => fi.querySelector('table'); if (!tbl()) return 'no_table';
  let sel = tbl().querySelector('[data-testid="beast-core-select"]');
  if (!sel) {
    const addBtn = [...fi.querySelectorAll('[role="button"]')].find(b => /add material/i.test(b.textContent || ''));
    if (!addBtn) return 'no_add_btn';
    temuClick(addBtn); await temuSleep(700);
    sel = await temuWait(() => tbl() && tbl().querySelector('[data-testid="beast-core-select"]'), 4000, 200);
    if (!sel) return 'no_select';
  }
  const r = await temuPickSelectValue(sel, wantList);
  if (r !== 'set' && r !== 'already') return r;
  const pct = tbl().querySelector('input[data-testid="beast-core-inputNumber-htmlInput"]');
  if (pct) { pct.focus(); temuSetNativeValue(pct, '100'); pct.dispatchEvent(new Event('blur', { bubbles: true })); await temuSleep(300); }
  return 'set';
}
function temuAttrRowName(row) {
  return (
    row.querySelector('[class*="p_name-"]')?.innerText ||
    row.querySelector('[class*="pName-"]')?.innerText ||
    row.querySelector('[class*="elli_outerWrapper"]')?.innerText ||
    row.querySelector('[data-testid="beast-core-ellipsis"]')?.innerText ||
    row.querySelector('[class*="name"]')?.innerText ||
    ''
  ).replace(/\s+/g, ' ').trim();
}
function temuAttrRowId(row) {
  const dataKey = row.getAttribute('data-row-key') || '';
  if (/^\d{10,}$/.test(dataKey)) return dataKey;
  return (
    (row.querySelector('[class*="p_id-"], [class*="pId-"]')?.textContent || '').match(/\d{10,}/)?.[0] ||
    (row.textContent || '').match(/Goods ID:\s*(\d+)/i)?.[1] ||
    ''
  );
}
async function temuPageFillAttributes({ rules = [], defaults = {}, autoSubmit = true, expectStore } = {}) {
  const report = [];
  const ok = m => report.push('✓ ' + m); const warn = m => report.push('• ' + m);
  const fail = m => { report.push('✗ ' + m); return { success: false, report }; };
  if (expectStore) {
    const mall = (document.querySelector('[class*="mall_name"]')?.textContent || '').trim();
    if (mall && mall.toLowerCase() !== String(expectStore).toLowerCase())
      warn(`Active store is "${mall}" (extension: "${expectStore}") — proceeding with "${mall}"…`);
  }
  const rowsOf = () => {
    const fathers = [...document.querySelectorAll('tr[data-testid="beast-core-table-body-tr"].TB_father_123, tr.TB_father_123, tr[class*="TB_father"]')];
    if (fathers.length) return fathers;
    const trs = [...document.querySelectorAll('tr[data-testid="beast-core-table-body-tr"]')].filter(tr => {
      const k = tr.getAttribute('data-row-key') || '';
      return /^\d{10,}$/.test(k) || !!tr.querySelector('[class*="p_id-"], [class*="pId-"]') || /Goods ID:/i.test(tr.textContent || '');
    });
    if (trs.length) return trs;
    return [...document.querySelectorAll('tbody tr')].filter(tr => !!tr.querySelector('[data-testid*="form-item"], [data-testid*="select"]'));
  };
  const first = await temuWait(() => { const r = rowsOf(); return r.length ? r : null; }, 10000);
  if (!first) return fail('"Missing required attributes" rows nahi mili — Product action required page khula hai?');
  const pick = (attrs, label) => { const want = label.trim().toLowerCase(); for (const k of Object.keys(attrs || {})) if (k.trim().toLowerCase() === want && attrs[k] !== '' && attrs[k] != null) return attrs[k]; return null; };
  const ids = first.map(temuAttrRowId).filter(Boolean);
  let changed = 0, submitted = 0; const manual = [];
  // v9.14.2: har product ko Goods ID se dobara dhoondo (Submit ke baad React table dobara banata hai — purane refs bekaar);
  // jo field na bhar sake us par ruko mat — aakhir mein "khud bharo" list. 2 passes (doosra '__first__' se).
  const fillRow = async (row, pass) => {
    const name = temuAttrRowName(row), catTxt = (row.querySelector('[class*="catName-"]')?.textContent || '').replace(/^\s*Category:\s*/i, '').trim();
    const tl = (name + ' ' + catTxt).toLowerCase();
    const rule = rules.find(r => (r.match || []).some(m => m && tl.includes(String(m).toLowerCase())));
    const ruleAttrs = (rule && rule.attributes) || {};
    const notes = [], left = [];
    for (const fi of row.querySelectorAll('[data-testid="beast-core-form-item"][id*="goodsProperty"]')) {
      if (!fi.isConnected) continue;
      const lb = fi.querySelector('[class*="Form_itemLabelContent"]'); if (!lb) continue;
      const label = lb.textContent.trim(); const isComp = !!fi.querySelector('table');
      const sel = isComp ? null : fi.querySelector('[data-testid="beast-core-select"]');
      const isMulti = !!(sel && sel.querySelector('[class*="ST_selectValueMultiple"]'));
      const cur = isComp ? (fi.querySelector('table [class*="inputItemRenderer"]')?.textContent || '').trim() : (sel ? (isMulti ? (sel.querySelector('[class*="IPT_tag"] [class*="Tag_"], [class*="tagItem"], [class*="ST_tag"]')?.textContent || '') : temuSelectCurrent(sel)) : '');
      const hasErr = !!fi.querySelector('.error-field, [class*="error-field"], [class*="Form_itemError"] span');
      const filled = cur && !/^(select|enter)$/i.test(cur) && !hasErr;
      if (filled) continue;
      const isSensitive = /allergen|ingredient|drug\s*fact|nutrition|dietary|expiration|warning/i.test(label);
      let want = pick(ruleAttrs, label) ?? pick(defaults, label) ?? temuAttrGuess(label, name);
      if (!want && !isSensitive) want = '__first__';
      if (pass === 2 && !isSensitive) want = '__first__';
      if (!want) { left.push(label); notes.push(`${label}: auto-fill skip (khud check karein)`); continue; }
      let res;
      try {
        if (isComp) res = await temuFillComposition(fi, want);
        else if (sel) { res = await temuPickSelectValue(sel, want); if (isMulti) { try { document.body.click(); } catch (_) {} await temuSleep(200); } }
        else { const inp = fi.querySelector('input, textarea'); if (inp && typeof want === 'string' && want !== '__first__') { temuSetNativeValue(inp, want); res = 'set'; } else res = 'no_field'; }
      } catch (e) { res = 'err:' + (e?.message || e); }
      if (res === 'set' || res === 'already') { changed++; notes.push(`${label}=${(sel && temuSelectCurrent(sel)) || (Array.isArray(want) ? want[0] : want)}`); }
      else left.push(label);
    }
    return { name, catTxt, notes, left };
  };
  for (const id of ids) {
    let row = rowsOf().find(r => temuAttrRowId(r) === id); if (!row) continue;
    let r1 = await fillRow(row, 1);
    if (r1.left.length) { row = rowsOf().find(r => temuAttrRowId(r) === id); if (row) { const r2 = await fillRow(row, 2); r1 = { ...r1, notes: r1.notes.concat(r2.notes), left: r2.left }; } }
    row = rowsOf().find(r => temuAttrRowId(r) === id);
    let sub = '';
    if (autoSubmit && row && !r1.left.length) {
      const btn = [...row.querySelectorAll('[role="button"]')].find(b => /^\s*submit\s*$/i.test((b.textContent || '').trim()) && !/disable/i.test(b.className));
      if (btn) { temuClick(btn); await temuSleep(1800); const still = rowsOf().find(r => temuAttrRowId(r) === id); if (still && still.querySelector('.error-field, [class*="error-field"]')) { sub = 'Submit reject (field error)'; r1.left.push('(page error dekhein)'); } else { submitted++; sub = 'Submit ✓'; } }
    }
    if (r1.left.length) manual.push(`${r1.name.slice(0, 40)} → ${r1.left.join(', ')}`);
    ok(`${r1.name.slice(0, 45)}${r1.catTxt ? ' [' + r1.catTxt.split('/').pop().trim() + ']' : ''} → ${r1.notes.join(', ') || '—'}${sub ? ' · ' + sub : ''}${r1.left.length ? ' · KHUD BHARO: ' + r1.left.join(', ') : ''}`);
  }
  if (manual.length) { warn(`${manual.length} product(s) mein kuch fields extension nahi bhar saki — page par khud bhar kar us row ka Submit dabayen:`); manual.forEach(m => warn('   ' + m)); }
  report.unshift(`${ids.length} products, ${changed} fields set, ${submitted} submitted, ${manual.length} khud bharne wale`);
  return { success: true, report, changed, total: ids.length, stillEmpty: manual.length, submitted, manual };
}

// ═══ v9.6.0 — "View failed details" popup parhna (upload-goods-multiple.html) ═══
// DOM (2026-09-04): Upload history row → button "View failed details" → modal [data-testid=beast-core-modal]
// title "N product(s) failed to upload"; rows: td0 = name ([class*=elli_outerWrapper]) + "Goods ID: N" ([class*="id-"]),
// td1 = reason (e.g. "Contribution SKU duplicated with another product (Goods ID: 6109…)"). Close: [class*=modalCloseButton].
// v9.8.3 — late confirm: upload ke waqt 90s/200s time-out ho gaya to side panel is se har 15s poochta hai
// ke Upload history row (ID se) Completed/Action required ho gayi ya nahi. Row text (Sept 2026):
// "Action required — 28 processed, 26 added, 2 errors" ya "Processing NN%".
async function temuPageCheckUpload({ uploadId, notSig, expectStore } = {}) {
  const report = [];
  const mall = (document.querySelector('[class*="mall_name"]')?.textContent || '').trim();
  if (expectStore && mall && mall.toLowerCase() !== String(expectStore).toLowerCase())
    return { success: false, wrongStore: true, mall, report: [`✗ Ye tab store "${mall}" ka hai, extension mein "${expectStore}" active hai`] };
  const sec0 = await temuEnsureHistorySection(report);
  if (!sec0) return { success: false, report: [...report, '✗ Upload history section nahi mili'] };
  const secNow = () => (document.contains(sec0) ? sec0 : temuHistorySection()) || sec0;
  try { document.querySelectorAll('[data-testid="beast-core-modal"] [class*="modalCloseButton"], [data-testid="beast-core-modal"] [class*="closeIcon"]').forEach(b => b.click()); } catch (_) {}
  try { const b = [...secNow().querySelectorAll('[role="button"], button')].find(b => /^\s*refresh\s*$/i.test((b.textContent || '').trim())); if (b) { temuClick(b); } } catch (_) {}
  await new Promise(r => setTimeout(r, 2500));
  const rows = [...secNow().querySelectorAll('tr[data-testid="beast-core-table-body-tr"]')];
  const idOf = r => { const t = (r.querySelector('[class*="info-"] div')?.textContent || '').trim(); return /^\d{13,20}$/.test(t) ? t : ((r.innerText || '').match(/\b\d{15}\b/) || [''])[0]; };
  let row = null;
  if (uploadId) row = rows.find(r => (r.innerText || '').includes(String(uploadId))) || null;
  if (!row && !uploadId && rows.length) { const top = rows[0]; const tid = idOf(top); if (tid && ('id:' + tid) !== String(notSig || '')) row = top; }
  if (!row) return { success: true, done: false, noRow: true, report: ['• Upload history mein row abhi nahi' + (uploadId ? ` (ID ${uploadId})` : '')] };
  const txt = (row.innerText || '').replace(/\s+/g, ' ');
  const id = idOf(row) || uploadId || null;
  // v9.14.0: dono formats — "28 processed, 26 added, 2 errors" YA "records processed from this upload: 74 … records added: 59 … records with errors: 15"
  let m = txt.match(/(\d+)\s*(?:records\s*)?processed\b[\s\S]*?(\d+)\s*(?:records\s*)?added\b[\s\S]*?(\d+)\s*(?:records\s*with\s*)?errors?/i);
  if (!m) { const a = txt.match(/processed[^:]*:\s*(\d+)/i), b = txt.match(/records added\s*:\s*(\d+)/i), e = txt.match(/with errors\s*:\s*(\d+)/i); if (a && b && e) m = [null, a[1], b[1], e[1]]; }
  const status = /\bCompleted\b/.test(txt) ? 'Completed' : (/Action required/i.test(txt) ? 'Action required' : null);
  const pm = txt.match(/Processing(?:\s*data)?\s*\(?\s*(\d+)%/i);
  if (!m && !status) return { success: true, done: false, uploadId: id, pct: pm ? +pm[1] : null, report: [`• Abhi processing${pm ? ` ${pm[1]}%` : ''}${id ? ` (ID ${id})` : ''}…`] };
  const out = { success: true, done: true, uploadId: id, status: status || 'Done', processed: m ? +m[1] : null, added: m ? +m[2] : null, errors: m ? +m[3] : null, report };
  report.push(`✓ Upload history: ${out.status}${m ? ` — ${m[1]} records processed, ${m[2]} added, ${m[3]} errors` : ''}${id ? ` (ID ${id})` : ''}`);
  return out;
}

async function temuPageReadFailed({ uploadId, expectStore } = {}) {
  const report = [];
  const mall = (document.querySelector('[class*="mall_name"]')?.textContent || '').trim();
  if (expectStore && mall && mall.toLowerCase() !== String(expectStore).toLowerCase())
    return { success: false, wrongStore: true, mall, report: [`✗ Ye tab store "${mall}" ka hai, extension mein "${expectStore}" active hai`] };
  const sec = await temuEnsureHistorySection(report);
  if (!sec) return { success: false, report: [...report, '✗ Upload history section nahi mili (general template tab kholein)'] };
  const secNow = () => (document.contains(sec) ? sec : temuHistorySection()) || sec; // v9.8.1: Refresh ke baad React table dobara banata hai — stale node se rows nahi milti
  const rowsOf = () => [...secNow().querySelectorAll('tr[data-testid="beast-core-table-body-tr"]')];
  const btnOf = row => [...row.querySelectorAll('[role="button"], button, [class*="textButton"], div, span, a')].find(b =>
    /view (processing results|failed details)/i.test((b.textContent || '').trim())
  );
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
    const rf = () => [...secNow().querySelectorAll('[role="button"], button')].find(b => /^\s*refresh\s*$/i.test((b.textContent || '').trim()));
    report.push('• Upload history refresh…');
    const t0 = Date.now();
    while (Date.now() - t0 < 25000) {
      closeTemuModals();
      const b = rf(); if (b) { temuClick(b); }
      row = await temuWait(() => { const r = pickRow(); return (r && btnOf(r)) ? r : null; }, 5000, 400);
      if (row) break;
    }
    if (!row) row = pickRow();
  }
  if (!row) return { success: true, failed: [], report: ['• Upload history mein ye upload nahi mila' + (uploadId ? ` (ID ${uploadId})` : '')] };
  const btn = btnOf(row);
  if (!btn) return { success: true, failed: [], report: ['• Is upload par "View processing results" button nahi hai (koi failed product nahi, ya abhi processing)'] };
  temuClick(btn);
  const modal = await temuWait(() => [...document.querySelectorAll('[data-testid="beast-core-modal"]')].find(m => /processing results|failed to upload/i.test(m.innerText || m.textContent || '')), 8000);
  if (!modal) return { success: false, report: ['✗ "Processing results" popup nahi khula'] };
  await temuWait(() => modal.querySelector('tr[data-testid="beast-core-table-body-tr"]'), 5000);
  const failed = [];
  const trs = [...modal.querySelectorAll('tr[data-testid="beast-core-table-body-tr"]')];
  for (const tr of trs) {
    const tds = [...tr.querySelectorAll('td')];
    if (!tds.length) continue;
    let line = '', goodsId = '', skuId = '', status = '', reason = '', name = '';
    if (tds.length >= 4) {
      // 5-column table (Sept 2026): Line | Goods ID / SKU ID | Status | Failure reason | Processing notes
      line = (tds[0]?.innerText || tds[0]?.textContent || '').trim();
      const idText = (tds[1]?.innerText || tds[1]?.textContent || '').trim();
      const gidM = idText.match(/\b\d{13,20}\b/g) || [];
      goodsId = gidM[0] || '';
      skuId = gidM[1] || '';
      status = (tds[2]?.innerText || tds[2]?.textContent || '').trim();
      reason = (tds[3]?.innerText || tds[3]?.textContent || '').trim();
      name = (tr.querySelector('[class*="elli_outerWrapper"]')?.textContent || '').trim();
    } else {
      // Legacy 2-column or 3-column table
      name = (tr.querySelector('[class*="elli_outerWrapper"]')?.textContent || tds[0]?.innerText || '').trim();
      goodsId = ((tr.querySelector('[class*="id-"]')?.textContent || '').match(/\d{10,}/) || [''])[0];
      reason = (tds[1]?.innerText || tds[1]?.textContent || '').trim();
      status = (tds[2]?.innerText || tds[2]?.textContent || 'Saved as draft').trim();
    }
    const dupMatch = reason.match(/Goods ID:\s*(\d{10,})/i);
    const isDup = /duplicat/i.test(reason) || /already (listed|exists)/i.test(reason);
    const isMissingAttr = /missing.*attribute|attribute.*missing|required attribute/i.test(reason);
    const isPrice = /price|abnormal/i.test(reason);
    if (!/^\s*added\s*$/i.test(status) || (reason && reason !== '-')) {
      failed.push({
        line,
        name,
        goodsId,
        skuId,
        status,
        reason,
        duplicate: isDup,
        dupGoodsId: dupMatch ? dupMatch[1] : '',
        missingAttributes: isMissingAttr,
        priceIssue: isPrice
      });
    }
  }
  const total = ((modal.innerText || '').match(/Total\s+(\d+)\s+items?/i) || [])[1];
  try { (modal.querySelector('[class*="modalCloseButton"], [class*="closeIcon"], [role="button"]') || modal.querySelector('[data-testid*="close"]'))?.click(); } catch (_) {}
  report.push(`✓ Processing results parhe: ${failed.length} error/draft item(s)${total && +total > failed.length ? ` (Temu total ${total})` : ''}`);
  return { success: true, failed, total: total ? +total : failed.length, report };
}

// v9.8.0 — Upload history row par "Complete product infomation" (sic) button dabao → Temu "Complete product details" page kholta hai
// DOM (Sept 2026): row `tr[data-testid=beast-core-table-body-tr]`, ID `.info-* > div`, actions `.actions_wrapper-* .btn-*.primary-*` text "Complete product infomation"
async function temuPageOpenComplete({ uploadId, expectStore } = {}) {
  const report = [];
  const mall = (document.querySelector('[class*="mall_name"]')?.textContent || '').trim();
  if (expectStore && mall && mall.toLowerCase() !== String(expectStore).toLowerCase()) {
    report.push(`• Active Temu store is "${mall}" (extension had "${expectStore}") — continuing with "${mall}"…`);
  }
  const sec = await temuEnsureHistorySection(report);
  if (!sec) return { success: false, report: [...report, '✗ Upload history section nahi mili (general template tab kholein)'] };
  const secNow = () => (document.contains(sec) ? sec : temuHistorySection()) || sec; // v9.8.1: Refresh ke baad React table dobara banata hai — stale node se rows nahi milti
  const rowsOf = () => [...secNow().querySelectorAll('tr[data-testid="beast-core-table-body-tr"]')];
  const btnOf = row => [...row.querySelectorAll('[role="button"], button')].find(b => /complete product inf/i.test(b.textContent || ''));
  const pickRow = () => {
    const rows = rowsOf();
    if (uploadId) { const r = rows.find(r => (r.innerText || '').includes(String(uploadId))); if (r) return r; return null; }
    return rows[0] || null;
  };
  const closeTemuModals = () => { try { document.querySelectorAll('[data-testid="beast-core-modal"] [class*="modalCloseButton"], [data-testid="beast-core-modal"] [class*="closeIcon"]').forEach(b => b.click()); } catch (_) {} };
  let row = pickRow();
  if (!row || !btnOf(row)) {
    const rf = () => [...secNow().querySelectorAll('[role="button"], button')].find(b => /^\s*refresh\s*$/i.test((b.textContent || '').trim()));
    report.push('• Upload history refresh…');
    const t0 = Date.now();
    while (Date.now() - t0 < 25000) {
      closeTemuModals();
      const b = rf(); if (b) { temuClick(b); }
      row = await temuWait(() => { const r = pickRow(); return (r && btnOf(r)) ? r : null; }, 5000, 400);
      if (row) break;
    }
  }
  if (!row) return { success: false, report: ['• Upload history mein ye upload nahi mila' + (uploadId ? ` (ID ${uploadId})` : '')] };
  const rowTxt = (row.innerText || '');
  const errMatch = rowTxt.match(/records\s+with\s+errors\s*:\s*(\d+)/i);
  const readyMatch = rowTxt.match(/Ready\s+to\s+Submit\s*:\s*(\d+)/i);
  const isCompleted = /\bCompleted\b/i.test(rowTxt);
  if (errMatch && +errMatch[1] === 0 && (!readyMatch || +readyMatch[1] === 0) && isCompleted) {
    report.push('✓ Upload row check: 0 errors, 0 drafts — tamam products already publish hain, draft fix ki zaroorat nahi');
    return { success: true, noDraftsNeeded: true, report };
  }
  const btn = btnOf(row);
  if (!btn) return { success: false, report: ['• Is row par "Complete product infomation" button nahi hai (abhi processing?)'] };
  const st = (row.querySelector('[class*="success-"], [class*="error-"]')?.textContent || '').trim();
  closeTemuModals();
  // v9.10.1: React button — poora pointer sequence (pehle sirf mousedown+click tha, page khulta nahi tha)
  const hrefBefore = location.href;
  const fire = (el) => { for (const t of ['pointerover', 'pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) { try { el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window, button: 0 })); } catch (_) {} } };
  fire(btn);
  await new Promise(r => setTimeout(r, 1200));
  let navigated = location.href !== hrefBefore;
  if (!navigated) { const inner = btn.querySelector('[class*="content-"]') || btn.firstElementChild; if (inner) fire(inner); await new Promise(r => setTimeout(r, 1200)); navigated = location.href !== hrefBefore; }
  report.push(`✓ "Complete product infomation" dabaya (row: ${st || '?'})${navigated ? ' — isi tab mein page khula' : ''}`);
  // v10.1.1: agar button link hai to href bhi bhejo — popup block ho jaye to extension khud tab kholegi
  let href = ''; try { const an = btn.closest('a[href]') || row.querySelector('a[href*="excel-multiple-edit"]'); if (an) href = an.href; } catch (_) {}
  const btnHtml = (() => { try { return (btn.outerHTML || '').slice(0, 400); } catch (_) { return ''; } })();
  return { success: true, clicked: true, navigated, status: st, href, btnHtml, report };
}

// ── v9.12.0 Brands & IP reader (seller.temu.com/brands-property.html, Trademark tab) ──
// DOM (Sep 2026): rows tr[data-testid=beast-core-table-body-tr]; td0 Trademark ID, td1 status ([data-color] "In Effect"),
// td2 name, td7 categories: har block mein ellipsis "Home & Kitchen(ID: 9711)" + "Remaining sellable units:59";
// pagination: li.PGT_pagerItem_123, next [data-testid=beast-core-pagination-next] (PGT_disabled_123 = last).
async function temuPageReadBrands() {
  const report = [];
  const mall = (document.querySelector('[class*="mall_name"], #mms-layout-user-setting [class*="Space_outWrapper"] > div:first-child > div')?.textContent || '').trim();
  const tabLbl = [...document.querySelectorAll('[data-testid="beast-core-tab-itemLabel"]')].find(e => /^\s*trademark\s*$/i.test(e.textContent || ''));
  if (tabLbl && !/active/i.test(tabLbl.className)) { temuClick(tabLbl); await new Promise(r => setTimeout(r, 1200)); }
  const rowsOf = () => [...document.querySelectorAll('tr[data-testid="beast-core-table-body-tr"]')].filter(tr => tr.querySelectorAll('td').length >= 8);
  const readRows = () => rowsOf().map(tr => {
    const tds = tr.querySelectorAll('td');
    const txt = el => (el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim();
    const id = txt(tds[0]), status = txt(tds[1]).replace(/\s*$/, ''), name = txt(tds[2]);
    const cats = [];
    const catTd = tds[7];
    if (catTd) {
      // har category block: ellipsis (name + (ID: n)) aur uske baad "Remaining sellable units:N"
      catTd.querySelectorAll('[data-testid="beast-core-ellipsis"]').forEach(el => {
        const t = txt(el); const m = t.match(/^(.*?)\s*\(ID:\s*(\d+)\)\s*$/); if (!m) return;
        let units = null; let sib = el.parentElement?.nextElementSibling; if (!sib || !/remaining/i.test(sib.textContent || '')) sib = el.nextElementSibling;
        const blk = el.closest('div') && el.parentElement?.parentElement;
        const uTxt = (sib && /remaining/i.test(sib.textContent || '')) ? sib.textContent : (blk ? blk.textContent : '');
        const um = String(uTxt || '').match(/remaining sellable units\s*:?\s*(\d+)/i); if (um) units = +um[1];
        cats.push({ name: m[1].trim(), id: m[2], units });
      });
    }
    return { id, status, name, cats };
  });
  const firstId = () => (rowsOf()[0]?.querySelector('td')?.textContent || '').trim();
  if (!rowsOf().length) return { success: false, mall, report: ['✗ Trademark table nahi mili — Brands & intellectual property page (Trademark tab) khula hai?'] };
  const all = []; const seen = new Set(); let page = 1;
  while (page <= 15) {
    for (const b of readRows()) { const k = b.id || (b.name + '|' + page); if (!seen.has(k)) { seen.add(k); all.push(b); } }
    const next = document.querySelector('[data-testid="beast-core-pagination-next"]');
    if (!next || /disabled/i.test(next.className)) break;
    const before = firstId(); temuClick(next);
    const changed = await temuWait(() => firstId() && firstId() !== before ? true : null, 8000, 250);
    if (!changed) { report.push(`• Page ${page + 1} load nahi hui — ${all.length} brands tak parhe`); break; }
    page++;
  }
  report.push(`✓ ${all.length} trademarks parhe (${page} page${page > 1 ? 's' : ''})${mall ? ` — store ${mall}` : ''}`);
  return { success: true, mall, brands: all, report };
}

// ═══ v9.15.0 — ZHunter page frame (TobyFlow-style rangdaar border) ═══
// Temu seller pages: har store ka apna rang + naam ka badge (ghalat store ki pehchaan). Product pages: hunt ke doran pulse, done par green.
// Setting: chrome.storage.local.zhPageFrame (default on) — side panel Settings → "Page frame".
const ZH_FRAME_COLORS = ['#22D3EE', '#34D399', '#A78BFA', '#F59E0B', '#60A5FA', '#2DD4BF', '#A3E635', '#818CF8', '#FBBF24', '#38BDF8']; // v9.15.1: soft palette (red sirf error)
const ZH_FRAME_HOSTS = /(^|\.)(amazon\.[a-z.]+|walmart\.com|samsclub\.com|ebay\.[a-z.]+|temu\.com|target\.com|costco\.com|homedepot\.com|aliexpress\.[a-z.]+|bestbuy\.com|lowes\.com|wayfair\.com)$/i;
function zhFrameColorFor(name) { let h = 0; for (const ch of String(name || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return ZH_FRAME_COLORS[h % ZH_FRAME_COLORS.length]; }
let _zhFrameOn = true, _zhFrameTimer = null, _zhFrameCustomColor = '#FF1E56', _zhFrameCustomWidth = 5.5, _zhFrameCustomBrightness = 100, _zhFrameCustomCorners = 'square', _zhFrameMoving = false, _zhFrameStyle = 'laser', _zhFrameSpeed = 3.5;
function zhApplyFrameColors(f, hexColor) {
  if (!f) return;
  const col = hexColor || _zhFrameCustomColor || '#FF1E56';
  const isRainbow = col === 'rainbow';
  const isMoving = !!_zhFrameMoving;

  f.classList.toggle('zh-rainbow', isRainbow);
  f.classList.toggle('zh-moving', isMoving);

  const w = parseFloat(_zhFrameCustomWidth) || 5.5;
  const br = (parseFloat(_zhFrameCustomBrightness) || 100) / 100;
  const speed = Math.max(0.8, Math.min(10, parseFloat(_zhFrameSpeed) || 3.5));

  let rad = '0px';
  if (_zhFrameCustomCorners === 'round') rad = '14px';
  else if (_zhFrameCustomCorners === 'curved') rad = '28px';
  f.style.setProperty('--zh-bradius', rad);
  f.style.setProperty('--zh-bwidth', `${w}px`);
  f.style.setProperty('--zh-bbright', br);
  f.style.setProperty('--zh-anim-speed', `${speed}s`);

  let beam = f.querySelector('#zh-frame-beam');
  if (!beam) {
    beam = document.createElement('div');
    beam.id = 'zh-frame-beam';
    f.prepend(beam);
  }
  beam.style.animationDuration = `${speed}s`;

  const insetSpread = Math.round(18 * Math.pow(br, 1.5));
  const outerSpread = Math.round(28 * Math.pow(br, 1.5));

  let r = 255, g = 30, b = 86;
  if (!isRainbow) {
    const rgbMatch = col.match(/[0-9a-f]{2}/gi);
    if (rgbMatch && rgbMatch.length >= 3) {
      [r, g, b] = rgbMatch.slice(0, 3).map(x => parseInt(x, 16));
    }
  }
  const col2 = `rgb(${Math.min(255, Math.round(r + (255 - r) * 0.45))}, ${Math.min(255, Math.round(g + (255 - g) * 0.45))}, ${Math.min(255, Math.round(b + (255 - b) * 0.45))})`;

  // Calculate beam background gradient based on styleMode and color
  let beamBg = col;
  const styleMode = _zhFrameStyle || 'laser';

  if (isMoving) {
    if (isRainbow) {
      if (styleMode === 'laser') {
        // ⚡ Rainbow Laser Comet: White glowing head with trailing vibrant rainbow tail
        beamBg = 'conic-gradient(from var(--zh-angle, 0deg), transparent 0deg, transparent 130deg, #FF0055 180deg, #FFAA00 225deg, #00FF66 270deg, #00F2FE 315deg, #EC4899 350deg, #FFFFFF 360deg)';
      } else if (styleMode === 'dual') {
        // 💫 Rainbow Dual Beams: Two opposite white heads with rainbow tails 180deg apart
        beamBg = 'conic-gradient(from var(--zh-angle, 0deg), #FFFFFF 0deg, #00F2FE 30deg, #00FF66 65deg, transparent 90deg, transparent 180deg, #FFFFFF 180deg, #FF0055 210deg, #FFAA00 245deg, transparent 270deg, transparent 360deg)';
      } else {
        // 🌊 Rainbow Fluid Wave: Continuous rotating smooth rainbow
        beamBg = 'conic-gradient(from var(--zh-angle, 0deg), #FF0055, #FF7700, #FFDD00, #00FF66, #00F2FE, #7928CA, #EC4899, #FF0055)';
      }
    } else {
      // Single color custom / preset
      if (styleMode === 'laser') {
        // ⚡ Single Color Laser Comet: Bright white head with fading single-color tail
        beamBg = `conic-gradient(from var(--zh-angle, 0deg), transparent 0deg, transparent 150deg, rgba(${r},${g},${b},0.08) 200deg, rgba(${r},${g},${b},0.5) 280deg, ${col} 345deg, #FFFFFF 360deg)`;
      } else if (styleMode === 'dual') {
        // 💫 Single Color Dual Beams: Two white heads opposite to each other with colored tails
        beamBg = `conic-gradient(from var(--zh-angle, 0deg), #FFFFFF 0deg, ${col} 28deg, rgba(${r},${g},${b},0.15) 75deg, transparent 90deg, transparent 180deg, #FFFFFF 180deg, ${col2} 208deg, rgba(${r},${g},${b},0.15) 255deg, transparent 270deg, transparent 360deg)`;
      } else {
        // 🌊 Wave on single color: Multi-tone harmonic gradient wave
        beamBg = `conic-gradient(from var(--zh-angle, 0deg), ${col}, ${col2}, #FFFFFF, ${col2}, ${col}, ${col2}, #FFFFFF, ${col})`;
      }
    }
  } else {
    // Static mode
    if (isRainbow) {
      beamBg = 'conic-gradient(from 45deg, #FF0055, #FF7700, #FFDD00, #00FF66, #00F2FE, #7928CA, #EC4899, #FF0055)';
    } else {
      beamBg = col;
    }
  }

  f.style.setProperty('--zh-beam-bg', beamBg);
  beam.style.background = beamBg;

  // Corner brackets
  const isSquare = (!_zhFrameCustomCorners || _zhFrameCustomCorners === 'square') && !isMoving;
  f.querySelectorAll('.zh-corner').forEach(c => {
    if (!isSquare) {
      c.style.display = 'none';
    } else {
      c.style.display = 'block';
      c.style.borderColor = col2;
      c.style.borderRadius = '0px';
      if (c.id === 'zh-frame-c-tl') c.style.borderWidth = `${w}px 0 0 ${w}px`;
      else if (c.id === 'zh-frame-c-tr') c.style.borderWidth = `${w}px ${w}px 0 0`;
      else if (c.id === 'zh-frame-c-bl') c.style.borderWidth = `0 0 ${w}px ${w}px`;
      else if (c.id === 'zh-frame-c-br') c.style.borderWidth = `0 ${w}px ${w}px 0`;
    }
  });

  // Dynamic Glow & Ambient Halo
  const alpha1 = Math.min(0.95, Math.max(0.08, 0.65 * br)).toFixed(3);
  const alpha2 = Math.min(0.85, Math.max(0.05, 0.45 * br)).toFixed(3);

  if (isRainbow || (isMoving && styleMode === 'wave')) {
    f.style.boxShadow = `inset 0 0 ${insetSpread}px rgba(0,242,254,${(0.55*br).toFixed(2)}), 0 0 ${outerSpread}px rgba(255,0,85,${(0.55*br).toFixed(2)})`;
    f.style.filter = `drop-shadow(0 0 ${Math.round(10 * br)}px rgba(0,242,254,0.65)) drop-shadow(0 0 ${Math.round(18 * br)}px rgba(255,0,85,0.45)) brightness(${Math.min(1.6, 0.8 + 0.3 * br).toFixed(2)})`;
  } else {
    f.style.boxShadow = `inset 0 0 ${insetSpread}px rgba(${r},${g},${b},${alpha1}), 0 0 ${insetSpread}px rgba(${r},${g},${b},${alpha1}), 0 0 ${outerSpread}px rgba(${r},${g},${b},${alpha2})`;
    f.style.filter = `drop-shadow(0 0 ${Math.round(12 * br)}px rgba(${r},${g},${b},${alpha1})) brightness(${Math.min(1.6, 0.7 + 0.35 * br).toFixed(2)})`;
  }
}

// v10.3.2 — frame on all supported e-commerce sites
function zhFramePageOk() {
  const h = location.hostname;
  if (/^seller\.temu\.com$/i.test(h)) return true;
  return ZH_FRAME_HOSTS.test(h);
}

function zhFrame(state, label, color) {
  try {
    if (!_zhFrameOn || window.top !== window) return;
    if (!zhFramePageOk()) return;
    let f = document.getElementById('zh-frame');
    if (state === 'off') { if (f) f.remove(); return; }
    const col = color || (state === 'done' ? '#34D399' : state === 'error' ? '#F87171' : _zhFrameCustomColor || '#22D3EE');
    if (!f) {
      f = document.createElement('div'); f.id = 'zh-frame';
      f.innerHTML = '<div id="zh-frame-beam"></div><div id="zh-frame-c-tl" class="zh-corner"></div><div id="zh-frame-c-tr" class="zh-corner"></div><div id="zh-frame-c-bl" class="zh-corner"></div><div id="zh-frame-c-br" class="zh-corner"></div><div id="zh-frame-l"><span id="zh-frame-dot"></span><span id="zh-frame-t"></span></div>';
      const st = document.createElement('style'); st.id = 'zh-frame-css';
      st.textContent = `@property --zh-angle{syntax:'<angle>';initial-value:0deg;inherits:false}
@keyframes zhRotateFrame{to{--zh-angle:360deg}}
#zh-frame{
  position:fixed;inset:0;pointer-events:none;z-index:2147483646;box-sizing:border-box;
  border:none !important;
  border-radius:var(--zh-bradius,0px);
  transition:border-radius .15s ease, box-shadow .12s ease;
}
#zh-frame-beam{
  position:absolute;inset:0;border-radius:inherit;pointer-events:none;
  padding:var(--zh-bwidth,5.5px);
  background:var(--zh-beam-bg,var(--zh-bcol,#FF1E56));
  -webkit-mask:linear-gradient(#fff 0 0) content-box,linear-gradient(#fff 0 0);
  -webkit-mask-composite:xor;
  mask-composite:exclude;
  transition:padding .15s ease,border-radius .15s ease;
}
#zh-frame.zh-moving #zh-frame-beam{
  animation:zhRotateFrame var(--zh-anim-speed,3.5s) linear infinite;
}
#zh-frame.zh-paused #zh-frame-beam,#zh-frame.zh-paused #zh-frame-dot{animation-play-state:paused !important}
#zh-frame:not(.zh-moving) #zh-frame-beam{
  animation:zhBorderPulse 2.5s ease-in-out infinite alternate;
}
.zh-corner{position:absolute;width:24px;height:24px;border:solid var(--zh-bcol2,#FFB800);pointer-events:none;transition:all .25s ease;z-index:2}
#zh-frame-c-tl{top:0;left:0;border-width:var(--zh-bwidth,5.5px) 0 0 var(--zh-bwidth,5.5px);border-top-left-radius:var(--zh-bradius,0px)}
#zh-frame-c-tr{top:0;right:0;border-width:var(--zh-bwidth,5.5px) var(--zh-bwidth,5.5px) 0 0;border-top-right-radius:var(--zh-bradius,0px)}
#zh-frame-c-bl{bottom:0;left:0;border-width:0 0 var(--zh-bwidth,5.5px) var(--zh-bwidth,5.5px);border-bottom-left-radius:var(--zh-bradius,0px)}
#zh-frame-c-br{bottom:0;right:0;border-width:0 var(--zh-bwidth,5.5px) var(--zh-bwidth,5.5px) 0;border-bottom-right-radius:var(--zh-bradius,0px)}
@keyframes zhBorderPulse{
  0%{ opacity: 0.82; }
  100%{ opacity: 1.0; }
}
#zh-frame.zh-working{
  border-color:#00F2FE !important;
  animation:zhFrameWorkingPulse 1s ease-in-out infinite alternate;
}
#zh-frame.zh-working .zh-corner{border-color:#00F2FE;filter:drop-shadow(0 0 12px #00F2FE)}
#zh-frame.zh-done{
  border-color:#10B981 !important;
  box-shadow:inset 0 0 20px rgba(16,185,129,.7),0 0 24px rgba(52,211,153,.6);
  animation:none;
}
#zh-frame.zh-done .zh-corner{border-color:#10B981;filter:drop-shadow(0 0 10px #10B981)}
@keyframes zhFrameWorkingPulse{
  from{filter:drop-shadow(0 0 8px #00F2FE);box-shadow:inset 0 0 16px rgba(0,242,254,.5),0 0 16px rgba(56,189,248,.5)}
  to{filter:drop-shadow(0 0 16px #00F2FE) brightness(1.3);box-shadow:inset 0 0 30px rgba(0,242,254,.9),0 0 28px rgba(56,189,248,.9)}
}
#zh-frame-l{
  position:absolute;left:16px;bottom:16px;display:none;align-items:center;gap:8px;
  height:26px;padding:0 12px 0 9px;border-radius:4px;
  background:rgba(8,14,26,.92);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);
  color:#FFFFFF;font:700 11px/1 var(--mono,'JetBrains Mono',ui-monospace,sans-serif);
  letter-spacing:0.5px;
  border:1px solid rgba(255,184,0,.4);
  box-shadow:0 4px 20px rgba(0,0,0,.75),0 0 10px rgba(255,184,0,.25);
  transition:all .3s ease;
  z-index:3;
}
#zh-frame.zh-working #zh-frame-l,#zh-frame.zh-done #zh-frame-l{display:inline-flex}
#zh-frame.zh-working #zh-frame-l{border-color:rgba(0,242,254,.6);box-shadow:0 4px 20px rgba(0,0,0,.75),0 0 14px rgba(0,242,254,.35)}
#zh-frame.zh-done #zh-frame-l{border-color:rgba(16,185,129,.6);box-shadow:0 4px 20px rgba(0,0,0,.75),0 0 14px rgba(16,185,129,.35)}
#zh-frame-dot{width:7px;height:7px;border-radius:50%;background:#FFB800;box-shadow:0 0 8px #FFB800}
#zh-frame.zh-working #zh-frame-dot{background:#00F2FE;box-shadow:0 0 10px #00F2FE;animation:zhDot .8s ease-in-out infinite}
#zh-frame.zh-done #zh-frame-dot{background:#10B981;box-shadow:0 0 8px #10B981}
@keyframes zhDot{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.4;transform:scale(0.85)}}`;
      (document.head || document.documentElement).appendChild(st);
      (document.body || document.documentElement).appendChild(f);
    }
    f.classList.toggle('zh-working', state === 'working');
    f.classList.toggle('zh-done', state === 'done' || state === 'error');
    zhApplyFrameColors(f, _zhFrameCustomColor || col);
    const t = f.querySelector('#zh-frame-t'); if (t) t.textContent = label || 'ZHunter';
    f.title = label || 'ZHunter';
    clearTimeout(_zhFrameTimer);
    if (state === 'done' || state === 'error') { _zhFrameTimer = setTimeout(() => { try { zhFrameIdle(); } catch (_) {} }, 6000); }
  } catch (_) {}
}

function zhFrameIdle() {
  if (!_zhFrameOn) { const f = document.getElementById('zh-frame'); if (f) f.remove(); return; }
  if (!zhFramePageOk()) { const f = document.getElementById('zh-frame'); if (f) f.remove(); return; }
  if (/seller\.temu\.com$/i.test(location.hostname)) {
    const mall = (document.querySelector('[class*="mall_name"]')?.textContent || '').trim();
    zhFrame('idle', mall ? `ZHunter · ${mall}` : 'ZHunter · Temu', zhFrameColorFor(mall || 'temu'));
  } else {
    const pf = zhFramePlatform();
    zhFrame('idle', `ZHunter · ${pf.name}`, _zhFrameCustomColor || pf.color);
  }
}

// v10.0.2 — har platform ka apna rang (product pages ke idle frame ke liye)
function zhFramePlatform() {
  const h = location.hostname;
  if (/amazon\./i.test(h)) return { name: 'Amazon', color: '#F59E0B' };
  if (/walmart\.com$/i.test(h)) return { name: 'Walmart', color: '#60A5FA' };
  if (/samsclub\.com$/i.test(h)) return { name: "Sam's Club", color: '#38BDF8' };
  if (/ebay\./i.test(h)) return { name: 'eBay', color: '#A78BFA' };
  if (/temu\.com$/i.test(h)) return { name: 'Temu', color: '#FB923C' };
  if (/target\.com$/i.test(h)) return { name: 'Target', color: '#FB7185' };
  if (/costco\.com$/i.test(h)) return { name: 'Costco', color: '#818CF8' };
  if (/homedepot\.com$/i.test(h)) return { name: 'Home Depot', color: '#FBBF24' };
  if (/aliexpress\./i.test(h)) return { name: 'AliExpress', color: '#F472B6' };
  if (/bestbuy\.com$/i.test(h)) return { name: 'Best Buy', color: '#FACC15' };
  if (/lowes\.com$/i.test(h)) return { name: "Lowe's", color: '#2DD4BF' };
  if (/wayfair\.com$/i.test(h)) return { name: 'Wayfair', color: '#C084FC' };
  return { name: 'ready', color: '#22D3EE' };
}

(function zhFrameBoot() {
  try {
    let _lastHref = location.href;
    // v10.3.4: background tab mein frame animation pause (CPU/GPU bachao)
    const _zhVis = () => { try { const f = document.getElementById('zh-frame'); if (f) f.classList.toggle('zh-paused', document.hidden); } catch (_) {} };
    document.addEventListener('visibilitychange', _zhVis);
    setInterval(() => {
      _zhVis();
      try {
        if (location.href !== _lastHref) {
          _lastHref = location.href;
          zhFrameIdle();
        } else if (_zhFrameOn && zhFramePageOk() && !document.getElementById('zh-frame')) {
          zhFrameIdle();
        }
      } catch (_) {}
    }, 4000);

    chrome.storage.local.get(['zhPageFrame', 'zhFrameColor', 'zhFrameWidth', 'zhFrameBrightness', 'zhFrameCorners', 'zhFrameMoving', 'zhFrameStyle', 'zhFrameSpeed'], x => {
      _zhFrameOn = x?.zhPageFrame !== false;
      if (x?.zhFrameColor) _zhFrameCustomColor = x.zhFrameColor;
      if (x?.zhFrameWidth != null) _zhFrameCustomWidth = x.zhFrameWidth;
      if (x?.zhFrameBrightness != null) _zhFrameCustomBrightness = x.zhFrameBrightness;
      if (x?.zhFrameCorners) _zhFrameCustomCorners = x.zhFrameCorners;
      if (x?.zhFrameMoving != null) _zhFrameMoving = !!x.zhFrameMoving;
      if (x?.zhFrameStyle) _zhFrameStyle = x.zhFrameStyle;
      if (x?.zhFrameSpeed != null) _zhFrameSpeed = x.zhFrameSpeed;
      if (_zhFrameOn) {
        setTimeout(zhFrameIdle, 400);
        setTimeout(zhFrameIdle, 2000);
      }
    });

    chrome.storage.onChanged.addListener((ch, area) => {
      if (area === 'local') {
        if (ch.zhPageFrame) {
          _zhFrameOn = ch.zhPageFrame.newValue !== false;
          if (!_zhFrameOn) {
            const f = document.getElementById('zh-frame');
            if (f) f.remove();
          } else {
            zhFrameIdle();
          }
        }
        if (ch.zhFrameColor) _zhFrameCustomColor = ch.zhFrameColor.newValue || '#FF1E56';
        if (ch.zhFrameWidth != null) _zhFrameCustomWidth = ch.zhFrameWidth.newValue || 5.5;
        if (ch.zhFrameBrightness != null) _zhFrameCustomBrightness = ch.zhFrameBrightness.newValue || 100;
        if (ch.zhFrameCorners) _zhFrameCustomCorners = ch.zhFrameCorners.newValue || 'square';
        if (ch.zhFrameMoving != null) _zhFrameMoving = !!ch.zhFrameMoving.newValue;
        if (ch.zhFrameStyle) _zhFrameStyle = ch.zhFrameStyle.newValue || 'laser';
        if (ch.zhFrameSpeed != null) _zhFrameSpeed = ch.zhFrameSpeed.newValue || 3.5;
        if (ch.zhFrameColor || ch.zhFrameWidth || ch.zhFrameBrightness || ch.zhFrameCorners || ch.zhFrameMoving || ch.zhFrameStyle || ch.zhFrameSpeed) {
          let f = document.getElementById('zh-frame');
          if (!f && _zhFrameOn && zhFramePageOk()) {
            zhFrameIdle();
            f = document.getElementById('zh-frame');
          }
          if (f) zhApplyFrameColors(f, _zhFrameCustomColor);
        }
      }
    });

    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (msg && msg.action === 'zhUpdateFrame') {
        if (msg.enabled != null) {
          _zhFrameOn = !!msg.enabled;
          if (!_zhFrameOn) {
            const f = document.getElementById('zh-frame');
            if (f) f.remove();
            return;
          }
        }
        if (msg.width != null) _zhFrameCustomWidth = msg.width;
        if (msg.brightness != null) _zhFrameCustomBrightness = msg.brightness;
        if (msg.color != null) _zhFrameCustomColor = msg.color;
        if (msg.corners != null) _zhFrameCustomCorners = msg.corners;
        if (msg.moving != null) _zhFrameMoving = !!msg.moving;
        if (msg.style != null) _zhFrameStyle = msg.style;
        if (msg.speed != null) _zhFrameSpeed = msg.speed;
        
        if (!_zhFrameOn) return;
        let f = document.getElementById('zh-frame');
        if (!f && zhFramePageOk()) {
          zhFrameIdle();
          f = document.getElementById('zh-frame');
        }
        if (f) zhApplyFrameColors(f, _zhFrameCustomColor);
        if (typeof _zhZoomBox !== 'undefined' && _zhZoomBox && msg.color) {
          _zhZoomBox.style.borderColor = msg.color;
          _zhZoomBox.style.boxShadow = `0 16px 48px rgba(0, 0, 0, 0.85), 0 0 25px ${msg.color}55`;
        }
      }
    });
  } catch (_) {}
})();

// ── Visual Hunting Indicators (Tab Strip & Floating Top Cyber HUD) ──
let _zhBeaconTimer = null;
let _origTabTitle = null;

function zhHuntingBeacon(state, info = {}) {
  try {
    if (window.top !== window) return;
    
    // Store original document.title once
    if (!_origTabTitle) {
      _origTabTitle = (document.title || 'Product').replace(/^[🎯✅⚠️·⌛]\s*(\[[^\]]+\]\s*)?/, '').trim();
    }

    const tabNum = info.tabIndex != null ? (info.tabIndex + 1) : '';
    const total = info.totalTabs || '';
    const progressTag = tabNum && total ? ` #${tabNum}/${total}` : (tabNum ? ` #${tabNum}` : '');

    // 1. Dynamic Tab Title Update (Instantly identifiable in Chrome Tab Strip among 70+ tabs)
    if (state === 'hunting') {
      const cleanOrig = _origTabTitle.replace(/^[🎯✅⚠️·⌛]\s*(\[[^\]]+\]\s*)?/, '').trim();
      document.title = `🎯 [HUNTING${progressTag}] ${cleanOrig}`;
    } else if (state === 'done') {
      const cleanOrig = _origTabTitle.replace(/^[🎯✅⚠️·⌛]\s*(\[[^\]]+\]\s*)?/, '').trim();
      document.title = `✅ ${cleanOrig}`;
    } else if (state === 'error' || state === 'captcha') {
      const cleanOrig = _origTabTitle.replace(/^[🎯✅⚠️·⌛]\s*(\[[^\]]+\]\s*)?/, '').trim();
      document.title = `⚠️ [ACTION NEEDED] ${cleanOrig}`;
    }

    // 2. Floating Cyber Top HUD Banner on the Web Page
    let beacon = document.getElementById('zh-hunt-beacon');
    if (!beacon) {
      beacon = document.createElement('div');
      beacon.id = 'zh-hunt-beacon';
      beacon.innerHTML = `
        <div class="zh-bcn-pulse"></div>
        <div class="zh-bcn-icon">🎯</div>
        <div class="zh-bcn-content">
          <div class="zh-bcn-title">ZHUNTER PRO <span class="zh-bcn-badge">NOW HUNTING${progressTag}</span></div>
          <div class="zh-bcn-status" id="zhBcnStatus">Scanning page & extracting product data…</div>
        </div>
      `;
      const st = document.createElement('style');
      st.id = 'zh-bcn-css';
      st.textContent = `
        #zh-hunt-beacon {
          position: fixed !important;
          top: 14px !important;
          left: 50% !important;
          transform: translateX(-50%) !important;
          z-index: 2147483647 !important;
          display: flex !important;
          align-items: center !important;
          gap: 10px !important;
          padding: 8px 18px 8px 14px !important;
          background: rgba(8, 14, 26, 0.94) !important;
          backdrop-filter: blur(16px) !important;
          -webkit-backdrop-filter: blur(16px) !important;
          border: 1.5px solid #F97316 !important;
          border-radius: 6px !important;
          box-shadow: 0 10px 36px rgba(0, 0, 0, 0.85), 0 0 20px rgba(249, 115, 22, 0.45) !important;
          color: #FFFFFF !important;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif !important;
          font-size: 12px !important;
          pointer-events: none !important;
          animation: zhBcnDrop 0.25s cubic-bezier(0.16, 1, 0.3, 1) !important;
          transition: all 0.3s ease !important;
        }
        #zh-hunt-beacon.done {
          border-color: #10B981 !important;
          box-shadow: 0 10px 36px rgba(0, 0, 0, 0.85), 0 0 20px rgba(16, 185, 129, 0.45) !important;
        }
        #zh-hunt-beacon.warn {
          border-color: #F43F5E !important;
          box-shadow: 0 10px 36px rgba(0, 0, 0, 0.85), 0 0 24px rgba(244, 63, 94, 0.6) !important;
          background: rgba(24, 8, 12, 0.96) !important;
        }
        .zh-bcn-pulse {
          width: 9px !important;
          height: 9px !important;
          border-radius: 2px !important;
          background: #F97316 !important;
          box-shadow: 0 0 10px #F97316 !important;
          animation: zhBcnBlink 0.9s ease-in-out infinite !important;
        }
        #zh-hunt-beacon.done .zh-bcn-pulse {
          background: #10B981 !important;
          box-shadow: 0 0 10px #10B981 !important;
          animation: none !important;
        }
        #zh-hunt-beacon.warn .zh-bcn-pulse {
          background: #F43F5E !important;
          box-shadow: 0 0 12px #F43F5E !important;
        }
        .zh-bcn-icon { font-size: 16px !important; line-height: 1 !important; }
        .zh-bcn-content { display: flex !important; flex-direction: column !important; gap: 2px !important; }
        .zh-bcn-title {
          font-size: 11px !important;
          font-weight: 800 !important;
          letter-spacing: 0.05em !important;
          color: #CBD5E1 !important;
          display: flex !important;
          align-items: center !important;
          gap: 6px !important;
        }
        .zh-bcn-badge {
          background: rgba(249, 115, 22, 0.2) !important;
          border: 1px solid rgba(249, 115, 22, 0.4) !important;
          color: #FB923C !important;
          font-size: 9.5px !important;
          font-weight: 700 !important;
          padding: 1px 6px !important;
          border-radius: 3px !important;
        }
        #zh-hunt-beacon.done .zh-bcn-badge {
          background: rgba(16, 185, 129, 0.2) !important;
          border-color: rgba(16, 185, 129, 0.4) !important;
          color: #34D399 !important;
        }
        .zh-bcn-status {
          font-size: 11.5px !important;
          color: #F8FAFC !important;
          font-weight: 600 !important;
        }
        @keyframes zhBcnDrop {
          from { opacity: 0; transform: translate(-50%, -16px); }
          to { opacity: 1; transform: translate(-50%, 0); }
        }
        @keyframes zhBcnBlink {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.3; transform: scale(0.85); }
        }
      `;
      (document.head || document.documentElement).appendChild(st);
      (document.body || document.documentElement).appendChild(beacon);
    }

    const stEl = beacon.querySelector('#zhBcnStatus');
    const badgeEl = beacon.querySelector('.zh-bcn-badge');

    if (state === 'hunting') {
      beacon.className = '';
      if (stEl) stEl.textContent = info.statusText || 'Scanning images, specifications & pricing…';
      if (badgeEl) badgeEl.textContent = `NOW HUNTING${progressTag}`;
    } else if (state === 'done') {
      beacon.className = 'done';
      if (stEl) stEl.textContent = `✓ Scraped: ${info.images || 0} images · ${info.price || 'Price extracted'}`;
      if (badgeEl) badgeEl.textContent = 'DONE ✓';
      clearTimeout(_zhBeaconTimer);
      _zhBeaconTimer = setTimeout(() => {
        try { beacon.remove(); } catch (_) {}
      }, 4000);
    } else if (state === 'captcha' || state === 'error') {
      beacon.className = 'warn';
      if (stEl) stEl.textContent = info.error || '⚠️ Bot Verification or Captcha detected — Please solve';
      if (badgeEl) badgeEl.textContent = 'ACTION REQUIRED ⚠';
    }
  } catch (_) {}
}

// ── Message Listener ────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  try {
    if (message?.action === 'SCRAPE_PAGE') {
      zhFrame('working', 'ZHunter · hunting…'); // v9.15.0
      zhHuntingBeacon('hunting', { tabIndex: message.tabIndex, totalTabs: message.totalTabs });
      
      simulateHumanInteraction().then(() => scrapePageData()).then(data => {
        const imgCount = (data?.images || []).length;
        zhFrame('done', `ZHunter · ${imgCount} img ✓`);
        zhHuntingBeacon('done', { images: imgCount, price: data?.price });
        sendResponse({ success: true, data });
      }).catch(err => {
        zhHuntingBeacon('error', { error: err?.message || 'scrape_failed' });
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
    if (message?.action === 'PEEK') { // v9.16.0 — side panel Open tabs list ke liye halka: main image + price
      try {
        const h = location.hostname;
        let price = '';
        try { price = /walmart\.com$/i.test(h) ? readWalmartPrice() : /samsclub\.com$/i.test(h) ? readSamsClubPrice() : universalPrice(); } catch (_) {}
        let image = document.querySelector('meta[property="og:image"], meta[property="og:image:secure_url"], meta[name="twitter:image"]')?.content || '';
        if (!image) { const im = [...document.images].filter(i => i.naturalWidth >= 200 && i.naturalHeight >= 200 && /^https?:/.test(i.currentSrc || i.src)).sort((a, b) => b.naturalWidth * b.naturalHeight - a.naturalWidth * a.naturalHeight)[0]; if (im) image = im.currentSrc || im.src; }
        sendResponse({ image, price: price ? String(price).slice(0, 24) : '' });
      } catch (e) { sendResponse({ image: '', price: '' }); }
      return true;
    }
    if (message?.action === 'PING') {
      sendResponse({ success: true, ready: true });
      return true;
    }
    if (message?.action === 'TEMU_ABORT') { _temuAbort = true; try { zhFrame('error', 'ZHunter · stopped'); } catch (_) {} sendResponse({ ok: true }); return true; }
    if (message?.action === 'TEMU_UPLOAD_FILE') {
      if (!/seller\.temu\.com$/i.test(location.hostname)) { sendResponse({ success: false, report: ['✗ Yeh Temu seller page nahi hai'] }); return true; }
      zhFrame('working', 'ZHunter · Temu upload…'); // v9.15.0
      temuPageAutoUpload(message).then(r => { zhFrame(r?.success ? 'done' : 'error', r?.success ? 'ZHunter · upload ✓' : 'ZHunter · upload ✗'); sendResponse(r); }).catch(err => sendResponse({ success: false, report: ['✗ ' + (err?.message || 'error')] }));
      return true;
    }
    if (message?.action === 'TEMU_READ_BRANDS') { // v9.12.0
      if (!/seller\.temu\.com$/i.test(location.hostname)) { sendResponse({ success: false, report: ['✗ Yeh Temu seller page nahi hai'] }); return true; }
      temuPageReadBrands().then(sendResponse).catch(err => sendResponse({ success: false, report: ['✗ ' + (err?.message || 'error')] }));
      return true;
    }
    if (message?.action === 'TEMU_GET_MALL') { // v9.10.0 store auto-detect
      try { sendResponse({ mall: /seller\.temu\.com$/i.test(location.hostname) ? (document.querySelector('[class*="mall_name"]')?.textContent || '').trim() : '' }); } catch (_) { sendResponse({ mall: '' }); }
      return true;
    }
    if (message?.action === 'TEMU_CHECK_UPLOAD') {
      if (!/seller\.temu\.com$/i.test(location.hostname)) { sendResponse({ success: false, report: ['✗ Yeh Temu seller page nahi hai'] }); return true; }
      temuPageCheckUpload(message).then(sendResponse).catch(err => sendResponse({ success: false, report: ['✗ ' + (err?.message || 'error')] }));
      return true;
    }
    if (message?.action === 'TEMU_READ_FAILED') {
      if (!/seller\.temu\.com$/i.test(location.hostname)) { sendResponse({ success: false, report: ['✗ Yeh Temu seller page nahi hai'] }); return true; }
      temuPageReadFailed(message).then(sendResponse).catch(err => sendResponse({ success: false, report: ['✗ ' + (err?.message || 'error')] }));
      return true;
    }
    if (message?.action === 'TEMU_OPEN_COMPLETE') {
      if (!/seller\.temu\.com$/i.test(location.hostname)) { sendResponse({ success: false, report: ['✗ Yeh Temu seller page nahi hai'] }); return true; }
      temuPageOpenComplete(message).then(sendResponse).catch(err => sendResponse({ success: false, report: ['✗ ' + (err?.message || 'error')] }));
      return true;
    }
    if (message?.action === 'TEMU_FILL_ATTRS') { // v9.14.0
      if (!/seller\.temu\.com$/i.test(location.hostname)) { sendResponse({ success: false, report: ['✗ Yeh Temu seller page nahi hai'] }); return true; }
      zhFrame('working', 'ZHunter · attributes…'); // v9.15.0
      temuPageFillAttributes(message).then(r => { zhFrame('done', `ZHunter · ${r?.submitted || 0} submitted`); sendResponse(r); }).catch(err => sendResponse({ success: false, report: ['✗ ' + (err?.message || 'error')] }));
      return true;
    }
    if (message?.action === 'TEMU_FIX_DRAFTS') {
      if (!/seller\.temu\.com$/i.test(location.hostname)) { sendResponse({ success: false, report: ['✗ Yeh Temu seller page nahi hai'] }); return true; }
      zhFrame('working', 'ZHunter · fix drafts…'); // v9.15.0
      temuPageFixDrafts(message).then(r => { zhFrame('done', 'ZHunter · drafts ✓'); sendResponse(r); }).catch(err => sendResponse({ success: false, report: ['✗ ' + (err?.message || 'error')] }));
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
    const isAmz = h.includes('amazon.');
    const gallerySelectors = isAmz
      ? ['#landingImage, #imgTagWrapperId img, #altImages img, #imageBlock img, .imageThumbnail img']
      : [
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
      /* ── Panel Wrapper with Gold & Crimson Fire Border ── */
      .panel-wrap {
        position: relative;
        border-radius: 18px;
        padding: 2px;
        overflow: hidden; /* clips the ring to rounded shape */
        box-shadow: 0 0 28px rgba(255, 46, 84, 0.25), 0 12px 36px rgba(0, 0, 0, 0.75);
      }
      /* Uniform spinning Fire gradient around the perimeter */
      .panel-wrap::before {
        content: '';
        position: absolute;
        top: 50%; left: 50%;
        width: 400%; height: 400%;
        transform: translate(-50%, -50%) rotate(0deg);
        background: conic-gradient(from 0deg, #FFB800, #FF2E54, #F59E0B, #FF2E54, #FFB800);
        animation: zh-panel-spin 4s linear infinite;
        z-index: 0;
      }
      .panel {
        width: 318px;
        background: rgba(6, 9, 15, 0.98);
        backdrop-filter: blur(20px) saturate(180%);
        border-radius: 16px;
        overflow: hidden;
        font-family: 'Inter', system-ui, -apple-system, sans-serif;
        animation: zh-slide-in 0.45s cubic-bezier(0.16,1,0.3,1) both;
        transition: transform 0.4s cubic-bezier(0.16,1,0.3,1);
        position: relative; z-index: 1;
      }
      .panel-wrap.collapsed { display: none; }
      /* ── Minimized FAB: Fire Gold & Crimson Style ── */
      @keyframes zh-spin {
        from { transform: rotate(0deg); }
        to   { transform: rotate(360deg); }
      }
      @keyframes zh-spin-rev {
        from { transform: rotate(360deg); }
        to   { transform: rotate(0deg); }
      }
      @keyframes zh-panel-spin {
        from { transform: translate(-50%, -50%) rotate(0deg); }
        to   { transform: translate(-50%, -50%) rotate(360deg); }
      }
      @keyframes zh-badge-pulse {
        0%   { transform: scale(1);    box-shadow: 0 0 0 0 rgba(255,46,84,0.7); }
        40%  { transform: scale(1.35); box-shadow: 0 0 0 6px rgba(255,46,84,0.0); }
        100% { transform: scale(1);    box-shadow: 0 0 0 0 rgba(255,46,84,0.0); }
      }
      @keyframes zh-badge-ripple {
        0%   { opacity: 0.7; transform: scale(1); }
        100% { opacity: 0; transform: scale(2.2); }
      }
      /* FAB outer wrapper */
      .mini-widget-wrap {
        position: relative;
        width: 64px; height: 64px;
        display: flex; align-items: center; justify-content: center;
      }
      /* Spinning Fire Ring layer */
      .mini-ring {
        position: absolute;
        inset: 0;
        border-radius: 50%;
        background: conic-gradient(from 0deg, #FFB800, #FF2E54, #FBBF24, #FF1E56, #FFB800);
        animation: zh-spin 3s linear infinite;
        z-index: 0;
      }
      /* Reverse-spin Fire glow layer */
      .mini-glow {
        position: absolute;
        inset: -2px;
        border-radius: 50%;
        background: conic-gradient(from 180deg, #FFB800, #FF2E54, #FBBF24, #FF2E54, #FFB800);
        animation: zh-spin-rev 4s linear infinite;
        filter: blur(10px);
        opacity: 0.8;
        transition: opacity 0.25s ease, filter 0.25s ease;
        z-index: 0;
      }
      .mini-widget-wrap:hover .mini-glow { filter: blur(16px); opacity: 1; }
      .mini-widget {
        width: 54px; height: 54px;
        border-radius: 50%;
        position: relative;
        display: flex; align-items: center; justify-content: center;
        cursor: grab; user-select: none; touch-action: none;
        background: #06090F;
        border: 2px solid rgba(255,184,0,0.55) !important;
        box-shadow: 0 6px 24px rgba(0,0,0,0.85), 0 0 14px rgba(255,184,0,0.3) !important;
        transition: transform 0.2s cubic-bezier(0.16,1,0.3,1), box-shadow 0.2s;
        z-index: 1;
        outline: none;
        padding: 0;
        overflow: hidden;
      }
      .mini-widget:hover { transform: scale(1.06); cursor: grab; border-color: #FFB800 !important; box-shadow: 0 8px 32px rgba(0,0,0,0.95), 0 0 20px rgba(255,184,0,0.5) !important; }
      .mini-widget:active { cursor: grabbing; transform: scale(0.95); }
      .mini-widget img {
        width: 100%; height: 100%; object-fit: cover; pointer-events: none;
        border-radius: 50%;
        display: block;
        transition: transform 0.2s ease;
      }
      .mini-widget:hover img { transform: scale(1.05); }
      .mini-logo-fallback { display: none; color: #FFB800; font: 900 18px/1 system-ui, sans-serif; letter-spacing: -1px; text-shadow: 0 0 14px rgba(255,184,0,0.9); pointer-events: none; }
      /* Hover tooltip */
      .mini-tooltip {
        position: absolute;
        bottom: calc(100% + 10px);
        left: 50%; transform: translateX(-50%) scale(0.85);
        background: rgba(6,9,15,0.96);
        border: 1px solid rgba(255,184,0,0.4);
        backdrop-filter: blur(12px);
        color: #FEF08A; font-size: 10px; font-weight: 600;
        white-space: nowrap; padding: 5px 10px;
        border-radius: 8px;
        pointer-events: none;
        opacity: 0;
        transition: opacity 0.2s ease, transform 0.2s cubic-bezier(0.16,1,0.3,1);
        box-shadow: 0 4px 16px rgba(0,0,0,0.6), 0 0 12px rgba(255,184,0,0.25);
        z-index: 10;
      }
      .mini-tooltip::after {
        content: '';
        position: absolute; top: 100%; left: 50%;
        transform: translateX(-50%);
        border: 5px solid transparent;
        border-top-color: rgba(255,184,0,0.4);
      }
      .mini-widget-wrap:hover .mini-tooltip {
        opacity: 1; transform: translateX(-50%) scale(1);
      }
      /* Count badge — Fire Crimson badge with ripple pulse */
      .mini-count {
        position: absolute;
        top: -3px; right: -3px;
        min-width: 18px; height: 18px;
        background: linear-gradient(135deg, #FFB800, #FF2E54);
        color: #FFFFFF; font-weight: 800; font-size: 10px;
        padding: 0 4px; border-radius: 4px;
        border: 1.5px solid #06090F;
        box-shadow: 0 0 10px rgba(255,46,84,0.9), 0 0 16px rgba(255,184,0,0.5);
        pointer-events: none;
        font-family: 'JetBrains Mono', ui-monospace, system-ui, sans-serif;
        display: flex; align-items: center; justify-content: center;
        z-index: 12;
        letter-spacing: -0.2px;
      }
      .mini-count.pulse { animation: zh-badge-pulse 0.5s cubic-bezier(0.16,1,0.3,1); }

      .header { cursor: grab; touch-action: none; }
      .header:active { cursor: grabbing; }

      .header {
        display: flex; align-items: center; justify-content: space-between;
        padding: 11px 12px;
        background: linear-gradient(135deg, rgba(255,184,0,0.14) 0%, rgba(255,46,84,0.08) 100%);
        border-bottom: 1px solid rgba(255,184,0,0.2);
        cursor: pointer; user-select: none;
        transition: background 0.2s;
      }
      .header:hover { background: linear-gradient(135deg, rgba(255,184,0,0.2) 0%, rgba(255,46,84,0.12) 100%); }
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
        filter: drop-shadow(0 0 6px rgba(255,184,0,0.6));
        border-radius: 7px;
      }
      .header:hover .header-icon { transform: rotate(-5deg) scale(1.08); box-shadow: 0 4px 18px rgba(255,184,0,0.6); }
      .header-title { color: #FFFFFF; font-size: 12px; font-weight: 700; letter-spacing: 0.4px; text-shadow: 0 0 12px rgba(255,184,0,0.4); }
      .header-count {
        font-size: 10px; font-weight: 700; padding: 2px 8px;
        background: rgba(255,184,0,0.18); border: 1px solid rgba(255,184,0,0.4);
        border-radius: 9999px; color: #FDE047;
        transition: background 0.2s, transform 0.15s;
      }
      .toggle-btn {
        background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.1);
        cursor: pointer; color: #FDE047; padding: 5px 8px;
        line-height: 1; border-radius: 6px; display: flex; align-items: center; justify-content: center;
        transition: background 0.15s, color 0.15s, border-color 0.15s, transform 0.2s cubic-bezier(0.16,1,0.3,1);
      }
      .toggle-btn svg { pointer-events: none; transition: transform 0.3s cubic-bezier(0.16,1,0.3,1); }
      .toggle-btn:hover { background: rgba(255,184,0,0.15); border-color: rgba(255,184,0,0.45); color: #FFB800; transform: scale(1.12); }
      .toggle-btn:hover svg { transform: scale(1.1); }

      .body {
        padding: 10px; overflow-y: auto; overflow-x: hidden;
        max-height: 360px;
      }
      .body::-webkit-scrollbar { width: 3px; }
      .body::-webkit-scrollbar-track { background: rgba(255,255,255,0.03); }
      .body::-webkit-scrollbar-thumb { background: linear-gradient(to bottom, #FFB800, #FF2E54); border-radius: 3px; }

      .empty { text-align: center; padding: 28px 12px; color: #64748B; font-size: 11px; line-height: 1.7; }

      .skeleton { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
      .skel-item {
        aspect-ratio: 1; border-radius: 8px;
        background: linear-gradient(90deg, rgba(255,255,255,0.04) 25%, rgba(255,184,0,0.08) 50%, rgba(255,255,255,0.04) 75%);
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
        border: 2px solid rgba(255,255,255,0.08); cursor: pointer;
        aspect-ratio: 1; background: #080C14;
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
        border-color: rgba(255,184,0,0.55);
        transform: scale(1.06) translateY(-2px);
        box-shadow: 0 6px 20px rgba(0,0,0,0.5), 0 0 12px rgba(255,184,0,0.25);
        z-index: 2;
      }
      .img-wrap.selected { border-color: #FFB800; box-shadow: 0 0 0 1px rgba(255,184,0,0.4), 0 4px 16px rgba(255,46,84,0.25); }
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
        background: linear-gradient(135deg, #FFB800, #FF2E54); border-color: #FFB800; 
        box-shadow: 0 0 10px rgba(255,184,0,0.6); 
      }
      .img-wrap.selected .img-check::after {
        content: '';
        width: 4px; height: 8px;
        border: solid #FFFFFF;
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
      .img-res {
        position: absolute; top: 6px; right: 6px;
        font-size: 8px; font-weight: 800;
        padding: 2px 5px; border-radius: 5px;
        backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
        display: none; line-height: 1; letter-spacing: 0.3px;
        pointer-events: none; z-index: 2;
      }
      .img-res.show { display: block; }
      .img-res.hd {
        background: rgba(16, 185, 129, 0.9); color: #FFFFFF;
        border: 1px solid rgba(52, 211, 153, 0.7);
        box-shadow: 0 0 8px rgba(16, 185, 129, 0.4);
      }
      .img-res.sd {
        background: rgba(15, 23, 42, 0.85); color: #94A3B8;
        border: 1px solid rgba(255, 255, 255, 0.15);
      }
      .img-actions {
        position: absolute; bottom: 6px; left: 6px;
        display: flex; gap: 4px; z-index: 3;
        opacity: 0; transition: opacity 0.2s ease, transform 0.2s ease;
        transform: translateY(2px);
      }
      .img-wrap:hover .img-actions { opacity: 1; transform: translateY(0); }
      .img-btn-action {
        width: 20px; height: 20px; border-radius: 5px;
        background: rgba(6, 9, 15, 0.9); border: 1px solid rgba(255, 184, 0, 0.45);
        color: #FFB800; font-size: 10px; display: flex; align-items: center; justify-content: center;
        cursor: pointer; padding: 0; transition: all 0.15s cubic-bezier(0.16,1,0.3,1);
      }
      .img-btn-action:hover {
        background: #FFB800; color: #000000;
        transform: scale(1.15); box-shadow: 0 0 8px rgba(255, 184, 0, 0.6);
      }
      .img-wrap.dragging {
        opacity: 0.4;
        border: 2px dashed #FFB800 !important;
        transform: scale(0.95);
      }
      .img-wrap.drag-over {
        border-color: #10B981 !important;
        box-shadow: 0 0 16px rgba(16, 185, 129, 0.6) !important;
        transform: scale(1.06) translateY(-2px);
      }
      .img-main-badge {
        position: absolute; bottom: 6px; left: 6px;
        background: linear-gradient(135deg, #FFB800 0%, #FF2E54 100%);
        color: #FFFFFF; font-size: 8px; font-weight: 900;
        padding: 2px 5px; border-radius: 4px;
        box-shadow: 0 2px 8px rgba(255, 46, 84, 0.5);
        letter-spacing: 0.5px; line-height: 1; z-index: 2;
        display: flex; align-items: center; gap: 3px;
        pointer-events: none;
      }
      .img-wrap:hover .img-main-badge { display: none; }
      .img-btn-action.btn-main { color: #FEF08A; }
      .img-btn-action.btn-main:hover {
        background: #FF2E54; color: #FFFFFF; border-color: #FF2E54;
        box-shadow: 0 0 8px rgba(255, 46, 84, 0.7);
      }

      .footer {
        padding: 8px 10px;
        border-top: 1px solid rgba(255,184,0,0.15);
        background: rgba(255,184,0,0.02);
        display: flex; flex-direction: column; gap: 6px;
      }
      .footer-row {
        display: flex; gap: 6px; align-items: center; width: 100%;
      }
      .footer-sel-group {
        display: flex; gap: 4px; align-items: center;
      }
      .btn-sm {
        padding: 6px 10px; border-radius: 7px;
        font-size: 11px; font-weight: 700;
        cursor: pointer; border: 1px solid transparent;
        font-family: inherit; white-space: nowrap;
        transition: all 0.18s cubic-bezier(0.16,1,0.3,1);
        position: relative; overflow: hidden;
        display: inline-flex; align-items: center; justify-content: center;
        box-sizing: border-box;
      }
      .btn-sm:active { transform: scale(0.95) !important; }
      .btn-ghost {
        background: rgba(255,255,255,0.06); border-color: rgba(255,255,255,0.14); color: #FEF08A;
        padding: 5px 8px; font-size: 10px;
      }
      .btn-ghost:hover { background: rgba(255,184,0,0.14); border-color: rgba(255,184,0,0.4); color: #FFB800; transform: translateY(-1px); }
      .btn-temu {
        flex: 1;
        background: linear-gradient(135deg, #10B981 0%, #059669 100%);
        color: #FFFFFF; font-weight: 800; border: 1px solid rgba(16,185,129,0.5);
        box-shadow: 0 2px 10px rgba(16,185,129,0.35);
        padding: 6px 10px;
      }
      .btn-temu:hover {
        background: linear-gradient(135deg, #34D399 0%, #10B981 100%);
        box-shadow: 0 4px 14px rgba(16,185,129,0.6);
        transform: translateY(-1px);
      }
      .btn-zip {
        flex: 1;
        background: rgba(255,184,0,0.12);
        border: 1px solid rgba(255,184,0,0.38);
        color: #FFB800; font-weight: 700;
        padding: 6px 10px;
      }
      .btn-zip:not(:disabled):hover {
        background: rgba(255,184,0,0.22);
        border-color: #FFB800;
        box-shadow: 0 2px 10px rgba(255,184,0,0.25);
        transform: translateY(-1px);
      }
      .btn-zip:disabled { opacity: 0.32; cursor: not-allowed; border-color: rgba(255,255,255,0.1); color: #64748B; }
      .btn-dl {
        flex: 1;
        background: linear-gradient(135deg, #FFB800 0%, #FF2E54 100%);
        color: #FFFFFF; font-weight: 800; letter-spacing: 0.3px;
        box-shadow: 0 4px 14px rgba(255,46,84,0.4);
        padding: 6px 10px;
      }
      .btn-dl:not(:disabled):hover {
        box-shadow: 0 6px 20px rgba(255,46,84,0.65);
        transform: translateY(-1px);
      }
      .btn-dl:disabled { opacity: 0.32; cursor: not-allowed; background: rgba(255,255,255,0.1); box-shadow: none; color: #94A3B8; }
      .btn-video {
        background: linear-gradient(135deg, rgba(255,184,0,0.18) 0%, rgba(255,46,84,0.18) 100%);
        border: 1px solid rgba(255,184,0,0.4);
        color: #FFB800; padding: 5px 8px; font-size: 10px;
        display: none;
        align-items: center;
        gap: 4px;
      }
      .btn-video:hover {
        background: linear-gradient(135deg, #FFB800 0%, #FF2E54 100%);
        color: #fff;
        box-shadow: 0 4px 16px rgba(255,46,84,0.45);
        transform: translateY(-1px);
      }
      .img-sourcing {
        position: absolute;
        top: 4px; left: 4px;
        width: 18px; height: 18px;
        border-radius: 4px;
        background: rgba(6, 9, 15, 0.88);
        border: 1px solid rgba(255,184,0,0.5);
        color: #FFB800;
        font-size: 10px;
        display: flex; align-items: center; justify-content: center;
        cursor: pointer;
        opacity: 0;
        transition: opacity 0.2s, transform 0.2s;
        z-index: 5;
        padding: 0;
      }
      .img-wrap:hover .img-sourcing { opacity: 1; transform: scale(1.05); }
      .img-sourcing:hover { background: #FFB800; color: #06090F; }

      .status-bar { padding: 4px 10px 8px; font-size: 10px; color: #64748B; text-align: center; min-height: 20px; transition: color 0.3s; }
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
    miniWidget.innerHTML = `<img src="${chrome.runtime.getURL('icon128.png')}" alt="ZHunter" draggable="false"><span class="mini-logo-fallback" aria-hidden="true">ZH</span>`;
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
        <div class="header-icon"><img src="${chrome.runtime.getURL('icon128.png')}" alt="ZH" onerror="this.style.display='none';this.parentNode.textContent='ZH'"></div>
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
      <div class="footer-row">
        <div class="footer-sel-group">
          <button class="btn-sm btn-ghost" id="zh-sel-all" title="Select All">All</button>
          <button class="btn-sm btn-ghost" id="zh-sel-none" title="Deselect All">None</button>
        </div>
        <button class="btn-sm btn-temu" id="zh-send-temu" title="Send Product & Selected Images to Temu Review & Library">🚀 Send to Temu</button>
        <button class="btn-sm btn-video" id="zh-dl-video" style="display:none;" title="Download Product Video">🎥 Video</button>
      </div>
      <div class="footer-row">
        <button class="btn-sm btn-zip" id="zh-dl-zip" disabled title="Download all selected images as a single ZIP file">📦 ZIP</button>
        <button class="btn-sm btn-dl" id="zh-dl-btn" disabled title="Download individual files">↓ Files</button>
      </div>
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
    let draggedIdx = null;
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
      try {
        if (!chrome?.storage?.local?.set) return;
        chrome.storage.local.set({ [WIDGET_STATE_KEY]: {
          collapsed,
          top: widgetPosition.top,
          bottom: widgetPosition.bottom,
          left: widgetPosition.left,
          right: widgetPosition.right
        } }).catch(() => {});
      } catch (_) {}
    };
    const applyWidgetPosition = () => {
      const widgetHeight = collapsed ? 68 : 396;
      const widgetWidth = collapsed ? 68 : 322;

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

    // ── Fullscreen Zoom Lightbox Modal
    function openLightbox(startIdx) {
      if (!images.length) return;
      let currentIdx = Math.max(0, Math.min(startIdx, images.length - 1));
      let lb = document.getElementById('zh-lightbox-modal');
      if (lb) lb.remove();

      lb = document.createElement('div');
      lb.id = 'zh-lightbox-modal';
      lb.innerHTML = `
        <div class="zh-lb-backdrop"></div>
        <div class="zh-lb-card">
          <div class="zh-lb-header">
            <div class="zh-lb-counter">Image <span id="zh-lb-num">${currentIdx + 1}</span> / ${images.length}</div>
            <div class="zh-lb-badge" id="zh-lb-res">Calculating...</div>
            <div class="zh-lb-header-right">
              <button class="zh-lb-btn zh-lb-sel-btn" id="zh-lb-sel-btn" type="button">
                ${selected.has(currentIdx) ? '✓ Selected' : '+ Select'}
              </button>
              <button class="zh-lb-close" id="zh-lb-close" type="button" title="Close (Esc)">✕</button>
            </div>
          </div>
          <div class="zh-lb-body">
            <button class="zh-lb-nav zh-lb-prev" id="zh-lb-prev" type="button" title="Previous (Left Arrow)">❮</button>
            <div class="zh-lb-stage">
              <img id="zh-lb-image" src="${images[currentIdx]}" alt="High Definition Preview">
            </div>
            <button class="zh-lb-nav zh-lb-next" id="zh-lb-next" type="button" title="Next (Right Arrow)">❯</button>
          </div>
          <div class="zh-lb-footer">
            <button class="zh-lb-tool" id="zh-lb-dl" type="button">💾 Download HD</button>
            <button class="zh-lb-tool" id="zh-lb-source" type="button">🌐 Find Suppliers</button>
            <button class="zh-lb-tool" id="zh-lb-copy" type="button">📋 Copy URL</button>
          </div>
        </div>
      `;
      document.body.appendChild(lb);

      const imgEl = lb.querySelector('#zh-lb-image');
      const numEl = lb.querySelector('#zh-lb-num');
      const resEl = lb.querySelector('#zh-lb-res');
      const selBtn = lb.querySelector('#zh-lb-sel-btn');
      if (selected.has(currentIdx)) selBtn.classList.add('selected');

      const updateView = () => {
        imgEl.src = images[currentIdx];
        numEl.textContent = currentIdx + 1;
        resEl.textContent = 'Calculating...';
        resEl.className = 'zh-lb-badge';
        const isSel = selected.has(currentIdx);
        selBtn.textContent = isSel ? '✓ Selected' : '+ Select';
        selBtn.classList.toggle('selected', isSel);

        const onDim = () => {
          const w = imgEl.naturalWidth;
          const h = imgEl.naturalHeight;
          if (w && h) {
            const isHD = w >= 1000 || h >= 1000;
            resEl.textContent = `${w} × ${h} px • ${isHD ? 'HD Quality' : 'Standard'}`;
            resEl.className = 'zh-lb-badge ' + (isHD ? 'hd' : 'sd');
          }
        };
        if (imgEl.complete && imgEl.naturalWidth) onDim();
        else imgEl.onload = onDim;
      };

      updateView();

      const nav = (dir) => {
        currentIdx = (currentIdx + dir + images.length) % images.length;
        updateView();
      };

      const toggleSel = () => {
        if (selected.has(currentIdx)) selected.delete(currentIdx);
        else selected.add(currentIdx);
        renderGrid();
        updateView();
      };

      const closeLb = () => {
        window.removeEventListener('keydown', onKey);
        lb.remove();
      };

      const onKey = (e) => {
        if (e.key === 'Escape') closeLb();
        else if (e.key === 'ArrowLeft') nav(-1);
        else if (e.key === 'ArrowRight') nav(1);
        else if (e.key === ' ') { e.preventDefault(); toggleSel(); }
      };
      window.addEventListener('keydown', onKey);

      lb.querySelector('.zh-lb-backdrop').addEventListener('click', closeLb);
      lb.querySelector('#zh-lb-close').addEventListener('click', closeLb);
      lb.querySelector('#zh-lb-prev').addEventListener('click', () => nav(-1));
      lb.querySelector('#zh-lb-next').addEventListener('click', () => nav(1));
      selBtn.addEventListener('click', toggleSel);

      lb.querySelector('#zh-lb-dl').addEventListener('click', () => {
        const u = images[currentIdx];
        const ext = (u.match(/\.(jpe?g|png|webp|gif)/i)?.[1] || 'jpg').toLowerCase();
        const pSlug = (document.title || 'product').replace(/[^a-z0-9]/gi, '-').toLowerCase().slice(0, 25);
        downloadViaBackground(u, `${pSlug}-hd${currentIdx + 1}.${ext}`);
      });

      lb.querySelector('#zh-lb-source').addEventListener('click', (e) => {
        openSourcingMenu(images[currentIdx], e.clientX, e.clientY);
      });

      lb.querySelector('#zh-lb-copy').addEventListener('click', () => {
        navigator.clipboard.writeText(images[currentIdx]).then(() => {
          const btn = lb.querySelector('#zh-lb-copy');
          const old = btn.textContent;
          btn.textContent = '✓ Copied!';
          setTimeout(() => { btn.textContent = old; }, 1500);
        });
      });
    }

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
        wrap.setAttribute('draggable', 'true');
        wrap.innerHTML = `
          <img src="${url}" loading="lazy" alt="img ${i+1}" title="Double-click to preview HD"
               onerror="this.style.opacity='0.2';this.src='data:image/svg+xml,<svg xmlns=\\'http://www.w3.org/2000/svg\\' viewBox=\\'0 0 100 100\\'><text y=\\'.9em\\' font-size=\\'90\\'>\u{1F5BC}</text></svg>'">
          <div class="img-check"></div>
          <div class="img-res" id="res-${i}">...</div>
          ${i === 0 ? '<div class="img-main-badge" title="Hero / Primary Image">★ MAIN</div>' : ''}
          <div class="img-idx">${i + 1}</div>
          <div class="img-actions">
            ${i > 0 ? '<button class="img-btn-action btn-main" type="button" title="Set as Main (Hero) Photo">★</button>' : ''}
            <button class="img-btn-action btn-zoom" type="button" title="Zoom & Inspect">🔍</button>
          </div>
        `;

        const imgEl = wrap.querySelector('img');
        const resEl = wrap.querySelector('.img-res');
        const checkRes = () => {
          const w = imgEl.naturalWidth;
          const h = imgEl.naturalHeight;
          if (w && h) {
            const isHD = w >= 1000 || h >= 1000;
            resEl.textContent = isHD ? `${Math.max(w, h)}w HD` : `${w}×${h}`;
            resEl.className = 'img-res show ' + (isHD ? 'hd' : 'sd');
          }
        };
        if (imgEl.complete && imgEl.naturalWidth) checkRes();
        else imgEl.addEventListener('load', checkRes);

        // ── Drag and Drop Reordering
        wrap.addEventListener('dragstart', (e) => {
          draggedIdx = i;
          e.dataTransfer.effectAllowed = 'move';
          wrap.classList.add('dragging');
          try { e.dataTransfer.setData('text/plain', String(i)); } catch (_) {}
        });
        wrap.addEventListener('dragend', () => {
          draggedIdx = null;
          wrap.classList.remove('dragging');
          grid.querySelectorAll('.img-wrap').forEach(w => w.classList.remove('drag-over'));
        });
        wrap.addEventListener('dragover', (e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          if (draggedIdx !== null && draggedIdx !== i) {
            wrap.classList.add('drag-over');
          }
        });
        wrap.addEventListener('dragleave', () => {
          wrap.classList.remove('drag-over');
        });
        wrap.addEventListener('drop', (e) => {
          e.preventDefault();
          wrap.classList.remove('drag-over');
          if (draggedIdx !== null && draggedIdx !== i) {
            const selectedUrls = new Set([...selected].map(idx => images[idx]));
            const [moved] = images.splice(draggedIdx, 1);
            images.splice(i, 0, moved);
            selected = new Set(images.map((u, idx) => selectedUrls.has(u) ? idx : -1).filter(idx => idx >= 0));
            draggedIdx = null;
            renderGrid();
          }
        });

        // ── Set as Main (Hero) Photo
        wrap.querySelector('.btn-main')?.addEventListener('click', (e) => {
          e.stopPropagation();
          const selectedUrls = new Set([...selected].map(idx => images[idx]));
          const [hero] = images.splice(i, 1);
          images.unshift(hero);
          selected = new Set(images.map((u, idx) => selectedUrls.has(u) ? idx : -1).filter(idx => idx >= 0));
          selected.add(0);
          renderGrid();
          status.className = 'status-bar ok';
          status.textContent = `★ Photo set as Main (Hero)!`;
          setTimeout(() => { if (status.textContent.includes('★')) { status.textContent = ''; status.className = 'status-bar'; } }, 2500);
        });

        wrap.querySelector('.btn-zoom')?.addEventListener('click', (e) => {
          e.stopPropagation();
          openLightbox(i);
        });
        wrap.addEventListener('dblclick', (e) => {
          e.stopPropagation();
          openLightbox(i);
        });
        wrap.addEventListener('click', (e) => {
          if (e.target.closest('.img-actions')) return;
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
      dlBtn.textContent = n > 0 ? `\u2193 Files (${n})` : '\u2193 Files';
      const zipBtn = shadow.getElementById('zh-dl-zip');
      if (zipBtn) {
        zipBtn.disabled = n === 0;
        zipBtn.textContent = n > 0 ? `📦 ZIP (${n})` : '📦 ZIP';
      }
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

    // ── 1-Click ZIP Download
    const zipBtn = shadow.getElementById('zh-dl-zip');
    zipBtn?.addEventListener('click', async () => {
      if (!selected.size) return;
      zipBtn.disabled = true;
      const toZip = [...selected].sort((a, b) => a - b).map(idx => images[idx]).filter(Boolean);

      status.className = 'status-bar';
      status.textContent = `Packing 0 / ${toZip.length} images into ZIP...`;

      const productSlug = (document.title || 'product').replace(/[^a-z0-9]/gi, '-').toLowerCase().slice(0, 30) || 'product';

      try {
        if (typeof JSZip === 'undefined') {
          throw new Error('ZIP library initializing, please try again');
        }
        const zip = new JSZip();
        let packed = 0;

        for (let i = 0; i < toZip.length; i++) {
          const url = toZip[i];
          const ext = (url.match(/\.(jpe?g|png|webp|gif)/i)?.[1] || 'jpg').toLowerCase();
          const filename = `${productSlug}-img${i + 1}.${ext}`;

          const b64Res = await new Promise(resolve => {
            chrome.runtime.sendMessage({ action: 'FETCH_BASE64', url }, res => resolve(res));
          });

          if (b64Res?.base64) {
            let rawData = b64Res.base64;
            if (rawData.includes(',')) rawData = rawData.split(',')[1];
            zip.file(filename, rawData, { base64: true });
            packed++;
          }
          status.textContent = `Packing ${packed} / ${toZip.length} into ZIP...`;
        }

        status.textContent = `Generating ${productSlug}.zip...`;
        const zipBlob = await zip.generateAsync({ type: 'blob' });
        const blobUrl = URL.createObjectURL(zipBlob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = `${productSlug}_images.zip`;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { a.remove(); URL.revokeObjectURL(blobUrl); }, 2000);

        status.className = 'status-bar ok';
        status.textContent = `✓ ${packed} images downloaded as ZIP!`;
      } catch (err) {
        status.className = 'status-bar err';
        status.textContent = `ZIP error: ${err.message}`;
      } finally {
        zipBtn.disabled = selected.size === 0;
        setTimeout(() => { status.textContent = ''; status.className = 'status-bar'; }, 4000);
      }
    });

    // ── 1-Click Send to Temu / Library
    const temuBtn = shadow.getElementById('zh-send-temu');
    temuBtn?.addEventListener('click', async () => {
      temuBtn.disabled = true;
      status.className = 'status-bar';
      status.textContent = '⏳ Preparing product data for Temu...';

      try {
        let pData = null;
        try { pData = await scrapePageData(); } catch (_) {}

        if (!pData) {
          pData = {
            title: document.title || '',
            url: location.href,
            price: '',
            images: [],
            platform: host().replace(/^www\./, '')
          };
        }

        const chosenImages = [...selected].sort((a, b) => a - b).map(i => images[i]).filter(Boolean);
        if (chosenImages.length) pData.images = chosenImages;
        else if (images.length) pData.images = images.slice(0, 10);

        chrome.runtime.sendMessage({ action: 'SEND_TO_TEMU_REVIEW', product: pData }, res => {
          if (res?.success) {
            status.className = 'status-bar ok';
            status.textContent = `✓ Sent "${(pData.title || '').slice(0, 22)}..." to Temu!`;
          } else {
            status.className = 'status-bar ok';
            status.textContent = `✓ Added to Temu Review & Library!`;
          }
          setTimeout(() => { status.textContent = ''; status.className = 'status-bar'; }, 4000);
        });
      } catch (err) {
        status.className = 'status-bar err';
        status.textContent = `Failed: ${err.message}`;
        setTimeout(() => { status.textContent = ''; status.className = 'status-bar'; }, 4000);
      } finally {
        temuBtn.disabled = false;
      }
    });

    // ── Download Individual Files
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
    document.addEventListener('DOMContentLoaded', () => {
      initImagePanel();
      initReverseImageSourcing();
      initListingVideoDownloader();
    });
  } else {
    initImagePanel();
    initReverseImageSourcing();
    initListingVideoDownloader();
  }
})();

// ════════════════════════════════════════════════════════════════
// 1-Click Reverse Image Sourcing & Video Downloader Superpowers
// ════════════════════════════════════════════════════════════════

function openSourcingMenu(imgUrl, x, y) {
  const existing = document.getElementById('zh-sourcing-menu');
  if (existing) { existing.remove(); return; }

  const enc = encodeURIComponent(imgUrl);
  const menu = document.createElement('div');
  menu.id = 'zh-sourcing-menu';
  menu.className = 'zh-sourcing-popover';

  const top = Math.min(y + 10, window.innerHeight - 230);
  const left = Math.min(x + 10, window.innerWidth - 195);
  menu.style.top = `${Math.max(10, top)}px`;
  menu.style.left = `${Math.max(10, left)}px`;

  menu.innerHTML = `
    <div class="zh-sourcing-title">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
      Find Supplier
    </div>
    <a class="zh-sourcing-item" href="https://lens.google.com/uploadbyurl?url=${enc}" target="_blank" rel="noopener">
      <span>🌐</span> Google Lens
    </a>
    <a class="zh-sourcing-item" href="https://www.aliexpress.com/wholesale?SearchText=&imageAddress=${enc}" target="_blank" rel="noopener">
      <span>📦</span> AliExpress
    </a>
    <a class="zh-sourcing-item" href="https://www.alibaba.com/trade/search?fsb=y&IndexArea=product_en&CatId=&SearchText=&imageAddress=${enc}" target="_blank" rel="noopener">
      <span>🏭</span> Alibaba
    </a>
    <a class="zh-sourcing-item" href="https://s.1688.com/youyuan/index.htm?tab=imageSearch&imageAddress=${enc}" target="_blank" rel="noopener">
      <span>🇨🇳</span> 1688 Source
    </a>
    <div class="zh-sourcing-item" id="zh-copy-img-link">
      <span>📋</span> Copy HD Link
    </div>
  `;

  menu.querySelector('#zh-copy-img-link')?.addEventListener('click', () => {
    navigator.clipboard.writeText(imgUrl).then(() => {
      const el = menu.querySelector('#zh-copy-img-link');
      if (el) el.innerHTML = '<span>✓</span> Copied!';
      setTimeout(() => menu.remove(), 700);
    });
  });

  document.body.appendChild(menu);

  const closeMenu = (e) => {
    if (!menu.contains(e.target) && !e.target.closest('.zh-sourcing-trigger') && !e.target.closest('.img-sourcing')) {
      menu.remove();
      document.removeEventListener('click', closeMenu);
    }
  };
  setTimeout(() => document.addEventListener('click', closeMenu), 100);
}

function initReverseImageSourcing() {
  if (window.top !== window) return;

  if (!document.getElementById('zh-sourcing-css')) {
    const st = document.createElement('style');
    st.id = 'zh-sourcing-css';
    st.textContent = `
      .zh-sourcing-trigger {
        position: absolute; top: 12px; left: 12px; z-index: 2147483640;
        width: 34px; height: 34px; border-radius: 50%;
        background: #06090F; border: 1.5px solid #FFB800; color: #FFB800;
        display: flex; align-items: center; justify-content: center;
        cursor: pointer; box-shadow: 0 4px 14px rgba(0,0,0,0.7), 0 0 10px rgba(255,184,0,0.4);
        transition: transform 0.2s, box-shadow 0.2s, border-color 0.2s;
        padding: 0;
      }
      .zh-sourcing-trigger:hover {
        transform: scale(1.12);
        box-shadow: 0 6px 20px rgba(0,0,0,0.85), 0 0 16px rgba(255,46,84,0.7);
        border-color: #FF2E54; color: #FF2E54;
      }
      .zh-sourcing-popover {
        position: fixed; z-index: 2147483647;
        background: rgba(6, 9, 15, 0.96);
        border: 1px solid rgba(255, 184, 0, 0.4);
        border-radius: 12px; padding: 10px 8px;
        box-shadow: 0 12px 36px rgba(0,0,0,0.9), 0 0 20px rgba(255,184,0,0.18);
        backdrop-filter: blur(16px);
        display: flex; flex-direction: column; gap: 5px;
        min-width: 175px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      }
      .zh-sourcing-title {
        font-size: 10.5px; font-weight: 800; color: #FFB800; text-transform: uppercase;
        letter-spacing: 0.5px; padding: 2px 8px 5px; border-bottom: 1px solid rgba(255,184,0,0.18);
        display: flex; align-items: center; gap: 6px;
      }
      .zh-sourcing-item {
        display: flex; align-items: center; gap: 8px; padding: 7px 10px;
        border-radius: 7px; color: #F1F5F9; font-size: 11.5px; font-weight: 600;
        text-decoration: none; cursor: pointer; transition: all 0.15s ease;
        background: rgba(255,255,255,0.03); border: 1px solid transparent;
      }
      .zh-sourcing-item:hover {
        background: rgba(255,184,0,0.12); border-color: rgba(255,184,0,0.4);
        color: #FFB800; transform: translateX(2px);
      }
      .zh-video-overlay-btn {
        position: absolute; top: 14px; right: 14px; z-index: 2147483640;
        background: linear-gradient(135deg, #FFB800 0%, #FF2E54 100%);
        color: #FFFFFF; border: none; border-radius: 8px; padding: 7px 14px;
        font: 800 12px/1 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        cursor: pointer; box-shadow: 0 4px 18px rgba(0,0,0,0.7), 0 0 14px rgba(255,46,84,0.6);
        display: inline-flex; align-items: center; gap: 6px;
        transition: transform 0.2s cubic-bezier(0.16,1,0.3,1), box-shadow 0.2s;
      }
      .zh-video-overlay-btn:hover {
        transform: scale(1.06); box-shadow: 0 6px 24px rgba(255,46,84,0.85);
      }
      .zh-video-overlay-btn:active { transform: scale(0.96); }

      /* ── Fullscreen Zoom Lightbox Modal ── */
      #zh-lightbox-modal {
        position: fixed; inset: 0; z-index: 2147483647;
        display: flex; align-items: center; justify-content: center;
        font-family: 'Inter', system-ui, -apple-system, sans-serif;
      }
      .zh-lb-backdrop {
        position: absolute; inset: 0;
        background: rgba(4, 7, 13, 0.88);
        backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);
        animation: zh-fade-in 0.2s ease-out;
      }
      .zh-lb-card {
        position: relative; z-index: 1;
        max-width: 90vw; max-height: 92vh;
        display: flex; flex-direction: column;
        background: rgba(11, 15, 25, 0.98);
        border: 1px solid rgba(255, 184, 0, 0.35);
        border-radius: 18px; overflow: hidden;
        box-shadow: 0 20px 60px rgba(0,0,0,0.9), 0 0 35px rgba(255,184,0,0.18);
        animation: zh-scale-up 0.25s cubic-bezier(0.16,1,0.3,1);
      }
      .zh-lb-header {
        display: flex; align-items: center; justify-content: space-between;
        padding: 12px 18px; border-bottom: 1px solid rgba(255,184,0,0.15);
        background: rgba(255,184,0,0.03); gap: 12px;
      }
      .zh-lb-counter { font-size: 13px; font-weight: 700; color: #FEF08A; }
      .zh-lb-badge {
        font-size: 11px; font-weight: 800; padding: 3px 9px; border-radius: 6px;
        background: rgba(255, 255, 255, 0.08); color: #94A3B8; border: 1px solid rgba(255, 255, 255, 0.15);
      }
      .zh-lb-badge.hd {
        background: rgba(16, 185, 129, 0.2); color: #34D399; border-color: rgba(16, 185, 129, 0.45);
        box-shadow: 0 0 8px rgba(16, 185, 129, 0.3);
      }
      .zh-lb-header-right { display: flex; align-items: center; gap: 8px; }
      .zh-lb-sel-btn {
        padding: 6px 14px; border-radius: 8px; font-size: 12px; font-weight: 700;
        cursor: pointer; transition: all 0.2s; border: 1px solid rgba(255,255,255,0.2);
        background: rgba(255,255,255,0.08); color: #FFF;
      }
      .zh-lb-sel-btn.selected {
        background: linear-gradient(135deg, #FFB800 0%, #FF2E54 100%);
        border-color: #FFB800; color: #FFF; box-shadow: 0 2px 12px rgba(255,46,84,0.4);
      }
      .zh-lb-close {
        background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.15);
        color: #94A3B8; width: 30px; height: 30px; border-radius: 50%;
        cursor: pointer; display: flex; align-items: center; justify-content: center;
        font-size: 14px; font-weight: bold; transition: all 0.2s;
      }
      .zh-lb-close:hover {
        background: rgba(255,46,84,0.2); color: #FF2E54; border-color: #FF2E54; transform: scale(1.1);
      }
      .zh-lb-body {
        display: flex; align-items: center; justify-content: space-between;
        padding: 10px 14px; gap: 14px; flex: 1; min-height: 360px;
      }
      .zh-lb-nav {
        background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.15);
        color: #F8FAFC; width: 42px; height: 42px; border-radius: 50%;
        cursor: pointer; font-size: 18px; display: flex; align-items: center; justify-content: center;
        transition: all 0.2s; flex-shrink: 0;
      }
      .zh-lb-nav:hover {
        background: rgba(255,184,0,0.2); border-color: #FFB800; color: #FFB800; transform: scale(1.12);
      }
      .zh-lb-stage {
        display: flex; align-items: center; justify-content: center;
        max-width: 78vw; max-height: 68vh; overflow: hidden;
      }
      #zh-lb-image {
        max-width: 100%; max-height: 68vh; object-fit: contain;
        border-radius: 10px; box-shadow: 0 8px 32px rgba(0,0,0,0.6);
        transition: transform 0.25s ease;
      }
      .zh-lb-footer {
        display: flex; align-items: center; justify-content: center; gap: 10px;
        padding: 12px 18px; border-top: 1px solid rgba(255,184,0,0.15);
        background: rgba(255,184,0,0.02);
      }
      .zh-lb-tool {
        padding: 7px 14px; border-radius: 8px; font-size: 11.5px; font-weight: 700;
        background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.15);
        color: #E2E8F0; cursor: pointer; transition: all 0.2s;
      }
      .zh-lb-tool:hover {
        background: rgba(255,184,0,0.16); border-color: #FFB800; color: #FFB800; transform: translateY(-1px);
      }
      @keyframes zh-fade-in { from { opacity: 0; } to { opacity: 1; } }
      @keyframes zh-scale-up { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }
    `;
    (document.head || document.documentElement).appendChild(st);
  }

  const imgSelectors = [
    '#landingImage',
    '#imgTagWrapperId img',
    '#main-image-container img',
    '.imgTagWrapper img',
    '#leftCol .imageWrapper img',
    '[data-testid="hero-image-container"] img',
    '.prod-HeroImage img',
    'div[class*="mainImage"] img'
  ];

  function attachSourcingTrigger() {
    for (const sel of imgSelectors) {
      const img = document.querySelector(sel);
      if (img && img.src && !img.src.startsWith('data:')) {
        const parent = img.closest('#imgTagWrapperId') || img.closest('#main-image-container') || img.parentElement;
        if (parent && !parent.querySelector('.zh-sourcing-trigger')) {
          const pPos = window.getComputedStyle(parent).position;
          if (pPos === 'static') parent.style.position = 'relative';

          const btn = document.createElement('button');
          btn.className = 'zh-sourcing-trigger';
          btn.type = 'button';
          btn.title = 'ZHunter — Find Wholesale Suppliers';
          btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>`;

          btn.addEventListener('click', e => {
            e.preventDefault(); e.stopPropagation();
            openSourcingMenu(img.currentSrc || img.src, e.clientX, e.clientY);
          });
          parent.appendChild(btn);
        }
        break;
      }
    }
  }

  setTimeout(attachSourcingTrigger, 1200);
  setTimeout(attachSourcingTrigger, 3500);
}

function detectListingVideos() {
  const found = [];
  document.querySelectorAll('video').forEach(v => {
    let src = v.currentSrc || v.src;
    if (!src) {
      const s = v.querySelector('source[src]');
      if (s) src = s.src;
    }
    if (src && !src.startsWith('blob:') && !found.includes(src)) found.push(src);
  });

  const amazonSelectors = [
    '[data-video-url]',
    '.vse-video-container video',
    '#vse-video-container video',
    '#dp-video-container video',
    '#video-block video',
    '.review-video video'
  ];
  amazonSelectors.forEach(sel => {
    document.querySelectorAll(sel).forEach(el => {
      const u = el.getAttribute('data-video-url') || el.currentSrc || el.src;
      if (u && !u.startsWith('blob:') && !found.includes(u)) found.push(u);
    });
  });

  try {
    const scripts = document.querySelectorAll('script:not([src])');
    for (const s of scripts) {
      const txt = s.textContent || '';
      if (txt.includes('.mp4') && (txt.includes('vseVideoData') || txt.includes('videoUrl') || txt.includes('initialVideo'))) {
        const matches = txt.match(/https:\/\/[^"'\s\\]+\.mp4[^"'\s\\]*/g);
        if (matches) {
          matches.forEach(m => {
            const clean = m.replace(/\\u002F/g, '/').replace(/\\/g, '');
            if (!found.includes(clean)) found.push(clean);
          });
        }
      }
    }
  } catch (_) {}

  return found;
}

function initListingVideoDownloader() {
  if (window.top !== window) return;

  function attachVideoButtons() {
    const videos = detectListingVideos();
    if (!videos.length) return;

    const videoContainers = [
      '#vse-video-container',
      '.vse-video-container',
      '#dp-video-container',
      '#video-block',
      '.review-video'
    ];
    videoContainers.forEach(sel => {
      const container = document.querySelector(sel);
      if (container && !container.querySelector('.zh-video-overlay-btn')) {
        const pos = window.getComputedStyle(container).position;
        if (pos === 'static') container.style.position = 'relative';

        const btn = document.createElement('button');
        btn.className = 'zh-video-overlay-btn';
        btn.type = 'button';
        btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg> Download MP4`;
        btn.addEventListener('click', e => {
          e.preventDefault(); e.stopPropagation();
          const title = (document.title || 'product').replace(/[^a-z0-9]/gi, '_').slice(0, 30);
          chrome.runtime.sendMessage({
            action: 'DOWNLOAD_URL',
            url: videos[0],
            filename: `zhunter_${title}_video.mp4`
          });
          btn.innerHTML = `✓ Download Started`;
          setTimeout(() => {
            btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg> Download MP4`;
          }, 3000);
        });
        container.appendChild(btn);
      }
    });

    const panelRoot = document.getElementById('zhunter-img-panel-root');
    if (panelRoot?.shadowRoot) {
      const videoBtn = panelRoot.shadowRoot.getElementById('zh-dl-video');
      if (videoBtn) {
        videoBtn.style.display = 'inline-flex';
        videoBtn.textContent = `🎥 Video (${videos.length})`;
        videoBtn.onclick = () => {
          const title = (document.title || 'product').replace(/[^a-z0-9]/gi, '_').slice(0, 30);
          chrome.runtime.sendMessage({
            action: 'DOWNLOAD_URL',
            url: videos[0],
            filename: `zhunter_${title}_video.mp4`
          });
          videoBtn.textContent = '✓ Started';
          setTimeout(() => {
            videoBtn.textContent = `🎥 Video (${videos.length})`;
          }, 3000);
        };
      }
    }
  }

  setTimeout(attachVideoButtons, 1500);
  setTimeout(attachVideoButtons, 4000);
  setTimeout(attachVideoButtons, 8000);
}

} // end __zhunterContentLoaded guard

// ── In-page toast (feedback for the right-click menu) & Temu category bridge ──
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.action === 'TEMU_GET_ACTIVE_CATEGORY') {
    let cat = '';
    const catDiv = [...document.querySelectorAll('div, span, td, p')].find(el => /^\s*Category:\s*[A-Za-z0-9]/i.test(el.textContent));
    if (catDiv) cat = catDiv.textContent.replace(/^\s*Category:\s*/i, '').trim();
    if (!cat) {
      const el = document.querySelector('[class*="categoryPath"], [class*="category-selector"], [class*="breadcrumb"], [data-testid*="category"]');
      if (el) cat = el.textContent.trim();
    }
    if (!cat) {
      const opt = document.querySelector('[class*="inputItemRenderer"], [class*="select-selection-item"]');
      if (opt) cat = opt.textContent.trim();
    }
    sendResponse({ success: true, category: cat || '', url: location.href });
    return true;
  }
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

// ═══════════════════════════════════════════════════════════════
// UNIVERSAL IN-PAGE HOVER IMAGE ZOOM (Walmart, Amazon, Sam's Club, etc.)
// ═══════════════════════════════════════════════════════════════
let _zhZoomBox = null;
let _zhZoomImg = null;
let _zhZoomHoverTimer = null;
let _zhZoomActiveImg = null;

function zhGetHighResImageUrl(img) {
  if (!img) return '';
  let url = img.currentSrc || img.src || img.getAttribute('data-src') || '';
  if (!url || url.startsWith('data:image/svg') || url.startsWith('blob:')) return '';

  // 1. Walmart: i5.walmartimages.com
  if (url.includes('walmartimages.com')) {
    const zoomAttr = img.getAttribute('data-zoom-image') || img.getAttribute('data-zoom-src');
    if (zoomAttr) return zoomAttr;
    return url.replace(/odnHeight=\d+/gi, 'odnHeight=612').replace(/odnWidth=\d+/gi, 'odnWidth=612');
  }

  // 2. Amazon: m.media-amazon.com, images-na.ssl-images-amazon.com
  if (url.includes('amazon.com') || url.includes('media-amazon.com')) {
    const oldHires = img.getAttribute('data-old-hires');
    if (oldHires) return oldHires;
    const dyn = img.getAttribute('data-a-dynamic-image');
    if (dyn) {
      try {
        const parsed = JSON.parse(dyn);
        const keys = Object.keys(parsed);
        if (keys.length) {
          keys.sort((a, b) => (parsed[b][0] * parsed[b][1]) - (parsed[a][0] * parsed[a][1]));
          return keys[0];
        }
      } catch (_) {}
    }
    if (/\._[A-Z0-9_,]+_\./.test(url)) {
      return url.replace(/\._[A-Z0-9_,]+_\./, '._SL800_.');
    }
  }

  // 3. Sam's Club: scene7.samsclub.com, samsclubimages.com, samsclub.com
  if (url.includes('samsclub.com') || url.includes('scene7') || url.includes('samsclubimages')) {
    if (url.includes('scene7')) {
      // Strip any Scene7 image preset qualifiers like $SC_Item_Small_Image$ and query string
      let base = url.split('?')[0].replace(/\$[^$]+\$/g, '');
      return base + '?wid=1500&hei=1500&fmt=jpg&qlt=90,1';
    }
    if (url.includes('samsclubimages.com') || url.includes('walmartimages.com')) {
      return url.replace(/odnHeight=\d+/gi, 'odnHeight=1200')
                .replace(/odnWidth=\d+/gi, 'odnWidth=1200')
                .replace(/odnBg=[^&]+/gi, 'odnBg=FFFFFF');
    }
    let u = url.split('?')[0];
    return u + '?wid=1500&hei=1500&fmt=jpg';
  }

  // 4. AliExpress / Alibaba: alicdn.com
  if (url.includes('alicdn.com')) {
    return url.replace(/_\d+x\d+q?\d*\.(?:jpg|jpeg|png|webp)/i, '');
  }

  // 5. eBay: i.ebayimg.com
  if (url.includes('ebayimg.com')) {
    return url.replace(/s-l\d+\./i, 's-l1600.');
  }

  // 6. Check srcset for largest candidate
  if (img.srcset) {
    try {
      const candidates = img.srcset.split(',').map(s => s.trim().split(/\s+/)).filter(p => p[0]);
      if (candidates.length) {
        candidates.sort((a, b) => (parseFloat(b[1]) || 1) - (parseFloat(a[1]) || 1));
        if (candidates[0][0]) return candidates[0][0];
      }
    } catch (_) {}
  }

  // 7. Check common high-res data attributes on element or wrapper
  const wrap = img.closest('a, button, [data-zoom], [data-image]');
  if (wrap) {
    const zoomUrl = wrap.getAttribute('data-zoom-image') ||
                    wrap.getAttribute('data-zoom') ||
                    wrap.getAttribute('data-highres') ||
                    wrap.getAttribute('data-large-img-url') ||
                    wrap.getAttribute('href');
    if (zoomUrl && /\.(?:jpe?g|png|webp)(\?|$)/i.test(zoomUrl)) {
      return zoomUrl;
    }
  }

  return url;
}

function zhEnsureZoomBox() {
  if (_zhZoomBox && document.documentElement.contains(_zhZoomBox)) return _zhZoomBox;
  const box = document.createElement('div');
  box.id = 'zh-inpage-zoom';
  const color = (typeof _zhFrameCustomColor !== 'undefined' && _zhFrameCustomColor) ? _zhFrameCustomColor : '#F97316';
  box.style.cssText = `
    position: fixed;
    z-index: 2147483647;
    width: 340px;
    height: 340px;
    background: rgba(10, 16, 29, 0.96);
    border: 2px solid ${color};
    border-radius: 8px;
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.85), 0 0 25px ${color}55;
    backdrop-filter: blur(10px);
    padding: 6px;
    pointer-events: none;
    display: none;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    transition: opacity 0.15s ease, transform 0.15s ease;
    opacity: 0;
    transform: scale(0.94);
  `;
  const img = document.createElement('img');
  img.style.cssText = `
    width: 100%;
    height: 100%;
    object-fit: contain;
    border-radius: 4px;
    background: #ffffff;
    display: block;
    image-rendering: -webkit-optimize-contrast;
  `;
  box.appendChild(img);
  document.documentElement.appendChild(box);
  _zhZoomBox = box;
  _zhZoomImg = img;
  return box;
}

function zhPositionZoomBox(e) {
  if (!_zhZoomBox) return;
  const pad = 16;
  const w = 340;
  const h = 340;
  let left = e.clientX + pad;
  let top = e.clientY - (h / 2);

  // Flip to left if overflowing right edge
  if (left + w > window.innerWidth - 8) {
    left = e.clientX - w - pad;
  }
  // Clamp within viewport
  if (left < 8) left = 8;
  if (top + h > window.innerHeight - 8) top = window.innerHeight - h - 8;
  if (top < 8) top = 8;

  _zhZoomBox.style.left = `${left}px`;
  _zhZoomBox.style.top = `${top}px`;
}

function zhIsProductThumbnail(img, url) {
  if (!img || !url) return false;

  // 1. Must be thumbnail size (between 24px and 220px)
  const rect = img.getBoundingClientRect();
  if (rect.width < 24 || rect.height < 24) return false;
  if (rect.width > 220 || rect.height > 220) return false;

  // Aspect ratio check: square or standard rectangular product thumb
  const ar = rect.width / rect.height;
  if (ar < 0.4 || ar > 2.5) return false;

  // 2. Strict UI Blacklist: never trigger inside headers, navbars, footers, or utility bars
  if (img.closest('header, nav, footer, [role="navigation"], [role="banner"], [role="complementary"], [id*="header"], [class*="header"], [id*="nav"], [class*="nav"]')) return false;
  if (img.closest('[class*="fulfillment"], [class*="shipping"], [class*="delivery"], [class*="pickup"], [data-automation-id*="fulfillment"], [class*="add-to-cart"], [id*="cart"], [class*="payment"], [class*="review"], [class*="rating"], [class*="star"], [class*="badge"], [class*="search-bar"], [class*="searchBox"], [class*="logo"]')) return false;

  // 3. Blacklist by URL tokens (UI icons, trucks, logos, delivery, badges)
  if (/(?:icon|logo|truck|badge|banner|arrow|star|rating|avatar|delivery|pickup|shipping|sprite|spinner|loader|placeholder|credit|payment|affirm|klarna|paypal|visa|mastercard|feedback)\b/i.test(url)) {
    return false;
  }

  // 4. Blacklist by class / id / alt
  const meta = `${img.className} ${img.id} ${img.alt || ''} ${img.parentElement?.className || ''}`.toLowerCase();
  if (/(?:icon|logo|truck|badge|banner|arrow|star|rating|avatar|delivery|pickup|shipping|credit|payment|nav|header)\b/i.test(meta)) {
    return false;
  }

  // 5. Positive container match: MUST be in a verified product gallery or product tile
  const inProductGallery = !!img.closest(
    '[data-testid*="thumbnail"], [aria-label*="Thumbnail"], [class*="media-thumbnail"], ' +
    '[class*="vertical-carousel"], [class*="sc-carousel-item"], [class*="product-images"] [class*="thumbnail"], ' +
    '#altImages, .imageThumbnail, [data-action="thumb-action"], ' +
    '[data-item-id] [class*="tile-image"], [data-testid*="product-tile"] img'
  );
  if (!inProductGallery) return false;

  // 6. Platform-specific product item ID validation
  if (url.includes('samsclub.com') || url.includes('scene7')) {
    // Only allow scene7 product images with numeric/sku ID (e.g. 00193... or item numbers)
    if (!/\/is\/image\/samsclub\/\d+/i.test(url) && !/samsclubimages\.com/i.test(url)) return false;
  }
  if (url.includes('amazon.com') || url.includes('media-amazon.com')) {
    if (!url.includes('/images/I/')) return false;
  }
  if (url.includes('walmartimages.com')) {
    if (!/(?:\/asr\/|\/seo\/|\/ip\/)/.test(url)) return false;
  }

  return true;
}

function zhHideZoomBox() {
  clearTimeout(_zhZoomHoverTimer);
  _zhZoomActiveImg = null;
  if (_zhZoomBox) {
    _zhZoomBox.style.opacity = '0';
    _zhZoomBox.style.transform = 'scale(0.94)';
    _zhZoomBox.style.display = 'none';
    if (_zhZoomImg) _zhZoomImg.src = '';
  }
}

function zhInitInPageZoom() {
  document.addEventListener('mouseover', (e) => {
    // Ignore ZHunter's own UI elements
    if (e.target.closest('#zh-frame, #zh-inpage-zoom, #zhunter-page-toast')) return;

    let img = e.target.tagName === 'IMG' ? e.target : e.target.querySelector('img');
    if (!img) {
      const wrap = e.target.closest('button, a, [role="button"], li');
      if (wrap) img = wrap.querySelector('img');
    }
    if (!img) {
      if (_zhZoomActiveImg) zhHideZoomBox();
      return;
    }

    const rawUrl = img.currentSrc || img.src || img.getAttribute('data-src') || '';
    if (!zhIsProductThumbnail(img, rawUrl)) {
      if (_zhZoomActiveImg) zhHideZoomBox();
      return;
    }

    const hiResUrl = zhGetHighResImageUrl(img);
    if (!hiResUrl) {
      if (_zhZoomActiveImg) zhHideZoomBox();
      return;
    }

    _zhZoomActiveImg = img;
    clearTimeout(_zhZoomHoverTimer);

    // 60ms debounce
    _zhZoomHoverTimer = setTimeout(() => {
      if (_zhZoomActiveImg !== img) return;
      zhEnsureZoomBox();
      _zhZoomImg.src = hiResUrl;
      _zhZoomBox.style.display = 'flex';
      zhPositionZoomBox(e);
      requestAnimationFrame(() => {
        if (_zhZoomBox && _zhZoomActiveImg === img) {
          _zhZoomBox.style.opacity = '1';
          _zhZoomBox.style.transform = 'scale(1)';
        }
      });
    }, 60);
  }, { passive: true });

  document.addEventListener('mousemove', (e) => {
    if (!_zhZoomBox || _zhZoomBox.style.display !== 'flex') return;
    if (!_zhZoomActiveImg || !document.documentElement.contains(_zhZoomActiveImg)) {
      zhHideZoomBox();
      return;
    }

    // DIRECT PHYSICAL BOUNDING BOX CHECK
    // If mouse coordinates leave the thumbnail rectangle by more than 4px, HIDE IMMEDIATELY!
    const rect = _zhZoomActiveImg.getBoundingClientRect();
    const pad = 4;
    if (
      e.clientX < rect.left - pad ||
      e.clientX > rect.right + pad ||
      e.clientY < rect.top - pad ||
      e.clientY > rect.bottom + pad
    ) {
      zhHideZoomBox();
      return;
    }

    zhPositionZoomBox(e);
  }, { passive: true });

  document.addEventListener('mouseout', (e) => {
    if (_zhZoomActiveImg && (e.target === _zhZoomActiveImg || _zhZoomActiveImg.contains(e.target))) {
      zhHideZoomBox();
    }
  }, { passive: true });

  // Instantly dismiss on scroll, click, or Escape
  window.addEventListener('scroll', zhHideZoomBox, { passive: true });
  document.addEventListener('pointerdown', zhHideZoomBox, { passive: true });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') zhHideZoomBox();
  }, { passive: true });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', zhInitInPageZoom);
} else {
  zhInitInPageZoom();
}

