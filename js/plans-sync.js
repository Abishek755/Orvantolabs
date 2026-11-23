/* =====================================================================
   Vanto Connect — live plan sync from vanto-admin
   ---------------------------------------------------------------------
   The pricing cards in index.html ship as static HTML (a snapshot of the
   vanto-admin plans API). On load this script fetches the live plans and
   re-renders the cards, so price, seat, usage-limit and feature-flag
   changes made in vanto-admin appear without a redeploy. Any failure
   (network, CORS, bad payload) is silent: the static snapshot stays.

   Endpoints, tried in order:
     1. /api/plans  — same-origin proxy (see "rewrites" in vercel.json)
     2. https://vanto-connect.vercel.app/api/orgs/public/plans (needs CORS)
   ===================================================================== */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.VantoPlans = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Feature flags shown on the cards, in display order. Flags not listed here are not shown.
  var FEATURES = [
    ['inbox_media', 'Shared Team Inbox with media'],
    ['templates', 'WhatsApp template sync'],
    ['broadcasts', 'Campaign broadcasts'],
    ['automation', 'Automation workflows'],
    ['documents', 'PDF document sending'],
    ['menu_bot', 'n8n-style Visual Bot Builder'],
    ['calling', 'WhatsApp Business voice calling'],
    ['call_routing', 'Call routing'],
    ['call_auto_reply', 'Call auto-reply'],
    ['catalog', 'WhatsApp product catalog'],
    ['analytics_cpl', 'Click-to-WhatsApp ad tracking & cost per lead'],
    ['crm_attachment_pdf', 'Zoho CRM attachments as PDF'],
    ['zoho_books_pdf', 'Zoho Books quote & invoice PDFs'],
    ['ai_agent', 'AI agent']
  ];
  // Usage limits shown on the cards. null = Unlimited, 0 = None.
  // A row is only shown if at least one tier has a number for it.
  var LIMITS = [
    ['max_seats', 'Zoho CRM users'],
    ['monthly_messages', 'messages / month'],
    ['monthly_broadcast_recipients', 'broadcast recipients / month'],
    ['monthly_automation_runs', 'automation runs / month'],
    ['monthly_call_minutes', 'voice call minutes / month'],
    ['monthly_pdfs', 'PDF documents / month'],
    ['max_quick_replies', 'saved quick replies']
  ];

  var CHECK = '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var ARROW = '<svg class="arrow" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function num(v) { return typeof v === 'number' && isFinite(v) ? v : null; }
  function group(n) { return Math.round(n).toLocaleString('en-IN'); }
  function money(v, cur) {
    if (cur === 'INR') return '₹' + group(v);
    return '$' + (Math.round(v) === v ? String(v) : v.toFixed(2));
  }
  function isLifetime(code) { return /lifetime|founding/i.test(code); }

  /* Validate + sort the API payload. Returns null if unusable. */
  function normalize(payload) {
    if (!payload || payload.ok === false) return null;
    var list = Array.isArray(payload) ? payload : (payload.tiers || payload.plans || payload.data);
    if (!Array.isArray(list)) return null;
    var tiers = list.filter(function (t) {
      return t && typeof t.code === 'string' && t.code && typeof t.name === 'string' && t.name &&
        t.prices && num(t.prices.INR) > 0 && num(t.prices.USD) > 0;
    }).map(function (t, i) {
      return {
        code: t.code.toLowerCase().replace(/[^a-z0-9_-]/g, ''),
        name: t.name,
        tagline: typeof t.tagline === 'string' ? t.tagline : '',
        prices: { INR: t.prices.INR, USD: t.prices.USD },
        popular: t.is_popular === true,
        order: num(t.sort_order) != null ? t.sort_order : i,
        limits: t.limits && typeof t.limits === 'object' ? t.limits : {},
        features: t.features && typeof t.features === 'object' ? t.features : {}
      };
    });
    if (!tiers.length) return null;
    tiers.sort(function (a, b) { return a.order - b.order; });
    return tiers;
  }

  function limitRows(tier, shownKeys) {
    return shownKeys.map(function (k) {
      var label = LIMITS.filter(function (l) { return l[0] === k; })[0][1];
      var v = tier.limits[k];
      var val = v === null || v === undefined ? 'Unlimited' : (v === 0 ? 'None' : group(v));
      return '<div><b>' + esc(val) + '</b><span>' + esc(label) + '</span></div>';
    }).join('');
  }

  function renderTier(tier, prev, shownLimits) {
    var feats = [];
    if (!prev) feats.push('WhatsApp messaging inside Zoho CRM');
    FEATURES.forEach(function (f) {
      var on = tier.features[f[0]] === true;
      var before = prev && prev.features[f[0]] === true;
      if (on && !before) feats.push(f[1]);
    });
    var list = (prev ? '<li class="all">Everything in ' + esc(prev.name) + ', plus:</li>' : '') +
      feats.map(function (f) { return '<li>' + CHECK + '<span>' + esc(f) + '</span></li>'; }).join('');
    return '' +
      '<article class="card plan' + (tier.popular ? ' featured' : '') + '" data-plan="' + esc(tier.code) + '">' +
        '<div class="plan-tag"><span class="chip">Monthly</span>' + (tier.popular ? '<span class="chip chip-emerald">Most popular</span>' : '') + '</div>' +
        '<h3>' + esc(tier.name) + '</h3>' +
        (tier.tagline ? '<p class="for">' + esc(tier.tagline) + '</p>' : '') +
        '<div class="price">' +
          '<span class="amt"><span data-cur="INR">' + money(tier.prices.INR, 'INR') + '</span><span data-cur="USD">' + money(tier.prices.USD, 'USD') + '</span><span class="per">/mo</span></span>' +
          '<span class="cur">per month · billed in <span data-cur="INR">INR</span><span data-cur="USD">USD</span></span>' +
        '</div>' +
        '<a class="btn ' + (tier.popular ? 'btn-dark' : 'btn-ghost') + ' btn-block" href="contact.html?plan=' + encodeURIComponent(tier.code) + '">Choose ' + esc(tier.name) + ' ' + ARROW + '</a>' +
        '<ul class="plan-list">' + list + '</ul>' +
        (shownLimits.length ? '<p class="limits-title">Plan limits</p><div class="limits">' + limitRows(tier, shownLimits) + '</div>' : '') +
      '</article>';
  }

  /* Render all monthly tiers (lifetime-coded tiers are handled by the banner). */
  function renderTiers(tiers) {
    var monthly = tiers.filter(function (t) { return !isLifetime(t.code); });
    var shown = LIMITS.map(function (l) { return l[0]; }).filter(function (k) {
      return monthly.some(function (t) { return num(t.limits[k]) !== null; });
    });
    return monthly.map(function (t, i) { return renderTier(t, i ? monthly[i - 1] : null, shown); }).join('\n');
  }

  return { normalize: normalize, renderTiers: renderTiers, money: money, isLifetime: isLifetime, FEATURES: FEATURES, LIMITS: LIMITS };
});

/* ---------------- Browser runtime ---------------- */
(function () {
  'use strict';
  if (typeof document === 'undefined' || !window.VantoPlans) return;
  var P = window.VantoPlans;
  var section = document.querySelector('[data-plans]');
  if (!section) return;
  var grid = section.querySelector('[data-plans-grid]');
  var note = section.querySelector('[data-sync-text]');
  var buttons = Array.prototype.slice.call(section.querySelectorAll('[data-set-currency]'));
  var KEY = 'vc-currency';

  /* ---- Currency toggle (INR / USD) ---- */
  function setCurrency(cur, remember) {
    section.setAttribute('data-currency', cur);
    buttons.forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-set-currency') === cur)); });
    if (remember) { try { localStorage.setItem(KEY, cur); } catch (e) { /* storage unavailable */ } }
  }
  var initial = null;
  try { initial = localStorage.getItem(KEY); } catch (e) { /* storage unavailable */ }
  if (initial !== 'INR' && initial !== 'USD') {
    var tz = '';
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { /* older browser */ }
    initial = /Kolkata|Calcutta/.test(tz) || /-IN$/i.test(navigator.language || '') ? 'INR' : 'USD';
  }
  setCurrency(initial, false);
  buttons.forEach(function (b) {
    b.addEventListener('click', function () { setCurrency(b.getAttribute('data-set-currency'), true); });
  });

  /* ---- Live sync ---- */
  var endpoints = [];
  if (/^https?:$/.test(location.protocol)) endpoints.push('/api/plans');
  endpoints.push('https://vanto-connect.vercel.app/api/orgs/public/plans');

  function fetchJSON(url) {
    var ctrl = 'AbortController' in window ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 5000) : 0;
    return fetch(url, { headers: { Accept: 'application/json' }, credentials: 'omit', signal: ctrl ? ctrl.signal : undefined })
      .then(function (r) { clearTimeout(timer); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  }

  function apply(payload) {
    var tiers = P.normalize(payload);
    if (!tiers) throw new Error('unusable payload');
    var html = P.renderTiers(tiers);
    if (html && grid) grid.innerHTML = html;
    // Optional lifetime tier from vanto-admin updates the Founding Lifetime prices
    var lt = tiers.filter(function (t) { return P.isLifetime(t.code); })[0];
    if (lt) {
      section.querySelectorAll('[data-lt-price]').forEach(function (el) {
        var cur = el.getAttribute('data-lt-price');
        if (lt.prices[cur] > 0) el.textContent = P.money(lt.prices[cur], cur);
      });
    }
    section.setAttribute('data-sync', 'live');
    if (note) note.textContent = 'Live plan data from vanto-admin';
  }

  (function attempt(i) {
    if (i >= endpoints.length || !window.fetch) return; // silent fallback: keep the static snapshot
    fetchJSON(endpoints[i]).then(apply).catch(function () { attempt(i + 1); });
  })(0);
})();
