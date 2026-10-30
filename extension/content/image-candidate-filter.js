(function initializeImageCandidateFilter(globalObject) {
  "use strict";

  const COMMERCE_HOST_SUFFIXES = [
    "1688.com",
    "aliexpress.com",
    "etsy.com",
    "jd.com",
    "jingdong.com",
    "pinduoduo.com",
    "rakuten.co.jp",
    "shein.com",
    "suning.com",
    "taobao.com",
    "temu.com",
    "tmall.com",
    "vip.com",
    "walmart.com",
    "wayfair.com"
  ];
  const REGIONAL_COMMERCE_HOST_PATTERN =
    /^(?:.+\.)?(?:amazon|ebay|lazada|shopee)\.[a-z]{2,}(?:\.[a-z]{2,})?$/i;
  const PRODUCT_HOST_PATTERN = /^(?:detail|item|npcitem|product)\./i;
  const PRODUCT_PATH_PATTERN =
    /\/(?:dp|gp\/product|item|items|product|products|detail|goods|sku|itm|offer)(?:[/.?_-]|$)/i;
  const CATEGORY_PATH_PATTERN =
    /\/(?:category|categories|collection|collections|department|departments)(?:[/.?_-]|$)/i;
  const JD_NON_PRODUCT_HOST_PATTERN =
    /^(?:channel|list|mall|pro|prodev|search)\.jd\.com$/i;
  const ALWAYS_EXCLUDED_TOKENS = new Set([
    "ad",
    "ads",
    "advert",
    "advertisement",
    "banner",
    "hero",
    "promo",
    "promotion",
    "sponsor",
    "sponsored"
  ]);
  const TAXONOMY_TOKENS = new Set([
    "brand",
    "brands",
    "categories",
    "category",
    "department",
    "departments"
  ]);
  const PRODUCT_TOKENS = new Set([
    "goods",
    "listing",
    "offer",
    "product",
    "sku"
  ]);
  const AD_DISCLOSURE_PATTERN =
    /(?:\b(?:ad|advertisement|anzeige|publicité|sponsored|sponsorisé|werbung)\b|广告|廣告|推广|推廣|赞助|贊助|広告|광고|quảng\s+cáo)/i;

  function tokenizeMetadata(values) {
    return values
      .flatMap((value) =>
        String(value || "")
          .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
          .toLowerCase()
          .split(/[^a-z0-9\p{L}]+/u)
      )
      .filter(Boolean);
  }

  function isCommerceHost(hostname) {
    const host = String(hostname || "").toLowerCase().replace(/^www\./, "");
    return (
      COMMERCE_HOST_SUFFIXES.some(
        (suffix) => host === suffix || host.endsWith(`.${suffix}`)
      ) || REGIONAL_COMMERCE_HOST_PATTERN.test(host)
    );
  }

  function parseUrl(value, baseUrl) {
    try {
      return new URL(value, baseUrl || "https://example.com/");
    } catch {
      return null;
    }
  }

  function isProductHref(value, baseUrl) {
    const url = parseUrl(value, baseUrl);
    if (!url || !["http:", "https:"].includes(url.protocol)) return false;
    return (
      PRODUCT_HOST_PATTERN.test(url.hostname) ||
      PRODUCT_PATH_PATTERN.test(`${url.pathname}${url.search}`)
    );
  }

  function isCategoryHref(value, baseUrl) {
    const url = parseUrl(value, baseUrl);
    return Boolean(
      url &&
        (CATEGORY_PATH_PATTERN.test(`${url.pathname}${url.search}`) ||
          JD_NON_PRODUCT_HOST_PATTERN.test(url.hostname))
    );
  }

  function hasExcludedMetadata(...values) {
    const tokens = tokenizeMetadata(values);
    if (tokens.some((token) => ALWAYS_EXCLUDED_TOKENS.has(token))) {
      return true;
    }

    const hasTaxonomyToken = tokens.some((token) => TAXONOMY_TOKENS.has(token));
    const hasProductToken = tokens.some((token) => PRODUCT_TOKENS.has(token));
    return hasTaxonomyToken && !hasProductToken;
  }

  function hasAdDisclosureText(value) {
    return AD_DISCLOSURE_PATTERN.test(String(value || "").slice(0, 800));
  }

  const api = {
    hasAdDisclosureText,
    hasExcludedMetadata,
    isCategoryHref,
    isCommerceHost,
    isProductHref
  };

  globalObject.HuojueImageFilter = api;
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis === "object" ? globalThis : this);
