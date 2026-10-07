/* ZHunter — product URL gate (v9.14)
 * One shared rule set used by the side panel, the queue importer and the background worker.
 * Only real PRODUCT pages may enter the Hunt: home pages, store/mall pages, search, category,
 * cart, login and seller pages are rejected for every site (not only Temu).
 * Loaded with <script> in sidepanel.html and importScripts() in background.js.
 */
(function (root) {
  'use strict';

  // Positive rules: [host fragment, test(pathname, search, url)] — a known site must match its product pattern.
  const SITE_RULES = [
    ['temu.', (p, s) => !/mall\.html|channel\.html|search_result\.html|category\.html|cart\.html|login\.html|checkout\.html|order\.html/i.test(p) &&
      (/-g-\d{8,}\.html/i.test(p) || (/\/goods\.html$/i.test(p) && /goods_id=\d{6,}/i.test(s)))],
    ['amazon.', (p) => /\/(?:dp|gp\/product|gp\/aw\/d|d|exec\/obidos\/asin)\/[a-z0-9]{10}/i.test(p)],
    ['walmart.com', (p) => /\/ip\/(?:[^/]+\/)?\d+/i.test(p)],
    ['samsclub.com', (p) => /\/(?:p|ip)\/(?:[^/]+\/)?(?:prod\d+|\d+)/i.test(p)],
    ['ebay.', (p) => /\/itm\/(?:[^/]+\/)?\d+/i.test(p)],
    ['aliexpress.', (p) => /\/(?:item|i)\/\d+\.html/i.test(p)],
    ['alibaba.com', (p) => /\/p(?:roduct)?-detail\/[^/]+\.html/i.test(p)],
    ['etsy.com', (p) => /\/listing\/\d+/i.test(p)],
    ['shein.com', (p) => /-p-\d+(?:-cat-\d+)?\.html/i.test(p)],
    ['daraz.', (p) => /\/products\/[^/]+-i\d+/i.test(p)],
    ['lazada.', (p) => /\/products\/[^/]+-i\d+/i.test(p)],
    ['flipkart.com', (p) => /\/p\/itm[a-z0-9]+/i.test(p)],
    ['noon.com', (p) => /\/p\/?(?:$|\?)|\/[nz][0-9a-z]{6,}[a-z]?\/p/i.test(p)],
    ['target.com', (p) => /^\/p\/.+/i.test(p)],
    ['homedepot.com', (p) => /^\/p\/.+\/\d{6,}/i.test(p)],
    ['bestbuy.com', (p) => /\/site\/.+\.p$/i.test(p) || /\/product\//i.test(p)],
    ['costco.com', (p) => /\.product\.\d+\.html/i.test(p)],
    ['faire.com', (p) => /\/product\//i.test(p)],
    ['myshopify.com', (p) => /\/products\/[^/]+/i.test(p)],
    ['worldwidegolf', (p) => /\.html$/i.test(p) || /\/product\//i.test(p)]
  ];

  // Negative rules for every site (including unknown ones): these are never single-product pages.
  const BAD_SEGMENT = /^(search|s|sch|find|category|categories|cat|collections?|catalog|cart|basket|bag|checkout|login|signin|sign-in|signup|register|account|my-?account|orders?|wishlist|favorites?|help|support|about|contact|blog|stores?|store-finder|brands?|deals|coupons?|outlet|new-arrivals|bestsellers?|best-sellers?|sitemap|sellers?|mall|channel|b|browse|shop-all|departments?|sale|clearance|gift-cards?|returns?|track|tracking|privacy|terms)$/i;
  const BAD_SELLER_HOST = /^(seller|sellercentral|vendorcentral|business|partner|merchant|ads|support|help|accounts?|login|auth)\./i;
  const BAD_FILE = /(?:^|\/)(?:mall|channel|search_result|search|category|categories|cart|login|checkout|order|orders|bgp_mall|store)\.html?$/i;

  function nonProductReason(rawUrl, opts) {
    let u;
    try { u = new URL(String(rawUrl || '').trim()); } catch (_) { return 'invalid_url'; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'invalid_url';
    const host = u.hostname.toLowerCase();
    const path = (u.pathname || '/').toLowerCase().replace(/\/{2,}/g, '/');
    const search = u.search || '';
    if (BAD_SELLER_HOST.test(host)) return 'seller_or_account_page';
    if (path === '/' || path === '') return 'home_page';
    if (BAD_FILE.test(path)) return 'store_or_list_page';
    const segs = path.split('/').filter(Boolean);
    // A short path whose first segment is a listing/utility word (e.g. /search, /collections/foo) is not a product.
    if (segs.length <= 3 && BAD_SEGMENT.test(segs[0].replace(/\.html?$/, '')) && !/\/products?\//i.test(path)) return 'list_or_utility_page';
    const rule = SITE_RULES.find(r => host.includes(r[0]));
    if (rule) return rule[1](path, search, u.href) ? '' : 'not_a_product_page';
    // Unknown site: generic "looks like a listing" signals only.
    if (/[?&](?:q|query|keyword|keywords|searchterm|search_query|k)=/i.test(search) && segs.length <= 2) return 'search_page';
    if (segs.length < 2 && !/[-_]\d{4,}|\.html?$|\.php$/i.test(segs[0] || '') && !(opts && opts.lenient)) return 'not_a_product_page';
    return '';
  }

  function isProductUrl(url, opts) { return nonProductReason(url, opts) === ''; }

  const REASON_TEXT = {
    invalid_url: 'invalid link',
    seller_or_account_page: 'seller / account page',
    home_page: 'home page',
    store_or_list_page: 'store / list page',
    list_or_utility_page: 'search / category / utility page',
    search_page: 'search page',
    not_a_product_page: 'not a product page'
  };
  function reasonText(code) { return REASON_TEXT[code] || 'not a product page'; }

  // Temu: remove tracking / "selected spec" params so the product opens on its normal first picture
  function cleanUrl(url) {
    try {
      const u = new URL(String(url || '').trim());
      if (!/(^|\.)temu\.com$/i.test(u.hostname)) return String(url || '');
      const keep = /\/goods\.html$/i.test(u.pathname) ? ['goods_id'] : [];
      for (const k of [...u.searchParams.keys()]) if (!keep.includes(k)) u.searchParams.delete(k);
      u.hash = '';
      return u.href;
    } catch (_) { return String(url || ''); }
  }

  root.ZhGate = { isProductUrl, nonProductReason, reasonText, cleanUrl };
})(typeof self !== 'undefined' ? self : this);
