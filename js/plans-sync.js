/* =====================================================================
   Vanto Connect — live plan sync from vanto-admin
   ---------------------------------------------------------------------
   The pricing cards in index.html ship as static HTML (a snapshot of the
   plans API, also the fallback). On load the live plans — prices, seats,
   usage limits and the feature_list bullets edited in vanto-admin — are
   re-rendered, so changes appear without a redeploy. Any failure keeps
   the static snapshot.

   Data: js/geo.js already fetched https://vanto-connect.vercel.app/api/orgs/public/plans
   (it carries the visitor's IP country); if that failed, the same-origin
   /api/plans proxy supplies prices only (vercel.json "rewrites").

   Currency is geo-locked: ₹ INR only inside India (toggle shown, INR by
   default); everywhere else only $ USD and no toggle. Buttons get their
   Dodo checkout links from js/checkout-config.js.
   ===================================================================== */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.VantoPlans = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Feature flags (fallback when a plan has no feature_list bullets), in display order.
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
  function bullets(list) {
    return Array.isArray(list) ? list.filter(function (x) { return typeof x === 'string' && x.trim(); }).map(function (x) { return x.trim(); }).slice(0, 15) : [];
  }

  /* Validate + sort the API payload. Returns null if unusable. INR is optional
     (the API leaves it out for visitors outside India). */
  function normalize(payload) {
    if (!payload || payload.ok === false) return null;
    var list = Array.isArray(payload) ? payload : (payload.tiers || payload.plans || payload.data);
    if (!Array.isArray(list)) return null;
    var tiers = list.filter(function (t) {
      return t && typeof t.code === 'string' && t.code && typeof t.name === 'string' && t.name && t.prices && num(t.prices.USD) > 0;
    }).map(function (t, i) {
      return {
        code: t.code.toLowerCase().replace(/[^a-z0-9_-]/g, ''),
        name: t.name,
        tagline: typeof t.tagline === 'string' ? t.tagline : '',
        prices: { INR: num(t.prices.INR) > 0 ? t.prices.INR : null, USD: t.prices.USD },
        annualUSD: t.prices_annual && num(t.prices_annual.USD) > 0 ? t.prices_annual.USD : null,
        popular: t.is_popular === true,
        order: num(t.sort_order) != null ? t.sort_order : i,
        limits: t.limits && typeof t.limits === 'object' ? t.limits : {},
        features: t.features && typeof t.features === 'object' ? t.features : {},
        bullets: bullets(t.feature_list)
      };
    });
    if (!tiers.length) return null;
    tiers.sort(function (a, b) { return a.order - b.order; });
    return tiers;
  }

  /* One-time launch offer prices from the API (`offers`, or a lifetime-coded tier). */
  function lifetimeOffer(payload) {
    var list = [].concat((payload && payload.offers) || [], (payload && payload.tiers) || []);
    for (var i = 0; i < list.length; i++) {
      var t = list[i];
      if (!t || !isLifetime(String(t.code || ''))) continue;
      var p = t.prices_once || t.prices || {};
      var out = { INR: num(p.INR) > 0 ? p.INR : null, USD: num(p.USD) > 0 ? p.USD : null };
      if (out.INR || out.USD) return out;
    }
    return null;
  }

  function limitRows(tier, shownKeys) {
    return shownKeys.map(function (k) {
      var label = LIMITS.filter(function (l) { return l[0] === k; })[0][1];
      var v = tier.limits[k];
      var val = v === null || v === undefined ? 'Unlimited' : (v === 0 ? 'None' : group(v));
      return '<div><b>' + esc(val) + '</b><span>' + esc(label) + '</span></div>';
    }).join('');
  }

  function featureItems(tier, prev) {
    if (tier.bullets.length) {
      // Bullets edited in vanto-admin (same list as Zoho CRM's Plans & Billing tab).
      return tier.bullets.map(function (b) {
        return /^everything in /i.test(b) ? '<li class="all">' + esc(b) + (/[:,]$/.test(b) ? '' : ', plus:') + '</li>' : '<li>' + CHECK + '<span>' + esc(b) + '</span></li>';
      }).join('');
    }
    var feats = [];
    if (!prev) feats.push('WhatsApp messaging inside Zoho CRM');
    FEATURES.forEach(function (f) {
      var on = tier.features[f[0]] === true;
      var before = prev && prev.features[f[0]] === true;
      if (on && !before) feats.push(f[1]);
    });
    return (prev ? '<li class="all">Everything in ' + esc(prev.name) + ', plus:</li>' : '') +
      feats.map(function (f) { return '<li>' + CHECK + '<span>' + esc(f) + '</span></li>'; }).join('');
  }

  function renderTier(tier, prev, shownLimits, annualUSD) {
    var inr = tier.prices.INR ? '<span data-cur="INR">' + money(tier.prices.INR, 'INR') + '</span>' : '';
    var hasAnnual = annualUSD > 0;
    return '' +
      '<article class="card plan' + (tier.popular ? ' featured' : '') + (hasAnnual ? ' has-annual' : '') + '" data-plan="' + esc(tier.code) + '">' +
        '<div class="plan-tag"><span class="chip"><span data-cycle-show="monthly">Monthly</span>' + (hasAnnual ? '<span data-cycle-show="annual">Annual</span>' : '') + '</span>' + (tier.popular ? '<span class="chip chip-emerald">Most popular</span>' : '') + '</div>' +
        '<h3>' + esc(tier.name) + '</h3>' +
        (tier.tagline ? '<p class="for">' + esc(tier.tagline) + '</p>' : '') +
        '<div class="price">' +
          '<span class="amt"><span data-cycle-show="monthly">' + inr + '<span data-cur="USD">' + money(tier.prices.USD, 'USD') + '</span><span class="per">/mo</span></span>' +
            (hasAnnual ? '<span data-cycle-show="annual">' + money(annualUSD, 'USD') + '<span class="per">/yr</span></span>' : '') + '</span>' +
          '<span class="cur" data-cycle-show="monthly">per month · billed in ' + (tier.prices.INR ? '<span data-cur="INR">INR</span>' : '') + '<span data-cur="USD">USD</span></span>' +
          (hasAnnual ? '<span class="cur" data-cycle-show="annual">per year · billed annually in USD</span>' : '') +
        '</div>' +
        '<a class="btn ' + (tier.popular ? 'btn-dark' : 'btn-ghost') + ' btn-block" href="contact.html?plan=' + encodeURIComponent(tier.code) + '" data-checkout="' + esc(tier.code) + '" data-cycle="monthly">Choose ' + esc(tier.name) + ' ' + ARROW + '</a>' +
        '<ul class="plan-list">' + featureItems(tier, prev) + '</ul>' +
        (shownLimits.length ? '<p class="limits-title">Plan limits</p><div class="limits">' + limitRows(tier, shownLimits) + '</div>' : '') +
      '</article>';
  }

  /* Annual USD price for a tier: the Dodo product price from checkout-config
     (annualPrices), else an annual price the API may publish later. */
  function annualPrice(tier, annualMap) {
    var cfg = annualMap && annualMap[tier.code];
    if (cfg && num(cfg.USD) > 0) return cfg.USD;
    return num(tier.annualUSD) > 0 ? tier.annualUSD : null;
  }

  /* Render the recurring tiers (lifetime-coded tiers are handled by the launch banner). */
  function renderTiers(tiers, annualMap) {
    var monthly = tiers.filter(function (t) { return !isLifetime(t.code); });
    var shown = LIMITS.map(function (l) { return l[0]; }).filter(function (k) {
      return monthly.some(function (t) { return num(t.limits[k]) !== null; });
    });
    return monthly.map(function (t, i) { return renderTier(t, i ? monthly[i - 1] : null, shown, annualPrice(t, annualMap)); }).join('\n');
  }

  return { normalize: normalize, renderTiers: renderTiers, lifetimeOffer: lifetimeOffer, money: money, isLifetime: isLifetime, FEATURES: FEATURES, LIMITS: LIMITS };
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
  var cycleButtons = Array.prototype.slice.call(section.querySelectorAll('[data-set-cycle]'));
  var KEY = 'vc-currency';
  var geo = window.OrvantoGeo || null;
  var annualMap = (window.ORVANTO_CHECKOUT && window.ORVANTO_CHECKOUT.annualPrices) || null;
  var cycle = 'monthly'; // visitor's billing-cycle choice; annual is offered in USD only

  function inIndia() {
    return geo ? geo.inIndia : document.documentElement.getAttribute('data-geo') === 'IN';
  }
  function saved() {
    try { return localStorage.getItem(KEY); } catch (e) { return null; }
  }
  /** INR by default inside India (unless the visitor picked USD); USD only elsewhere. */
  function effective() {
    if (!inIndia()) return 'USD';
    return saved() === 'USD' ? 'USD' : 'INR';
  }

  /** Show the chosen billing cycle (forced to monthly in ₹) and point each plan button at the matching checkout. */
  function applyCycle() {
    var cur = section.getAttribute('data-currency') === 'INR' ? 'INR' : 'USD';
    var c = cur === 'USD' ? cycle : 'monthly';
    section.setAttribute('data-cycle', c);
    cycleButtons.forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-set-cycle') === c)); });
    if (grid) {
      Array.prototype.forEach.call(grid.querySelectorAll('.plan [data-checkout]'), function (a) {
        var card = a.closest('.plan');
        a.setAttribute('data-cycle', c === 'annual' && card && card.classList.contains('has-annual') ? 'annual' : 'monthly');
      });
    }
    if (window.OrvantoCheckout) window.OrvantoCheckout.wire(section, cur);
  }

  function setCurrency(cur, remember) {
    if (!inIndia()) cur = 'USD';
    section.setAttribute('data-currency', cur);
    buttons.forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-set-currency') === cur)); });
    if (remember) { try { localStorage.setItem(KEY, cur); } catch (e) { /* storage unavailable */ } }
    applyCycle();
  }
  setCurrency(effective(), false);
  buttons.forEach(function (b) {
    b.addEventListener('click', function () { setCurrency(b.getAttribute('data-set-currency'), true); });
  });
  cycleButtons.forEach(function (b) {
    b.addEventListener('click', function () { cycle = b.getAttribute('data-set-cycle') === 'annual' ? 'annual' : 'monthly'; applyCycle(); });
  });

  function apply(payload, live) {
    var tiers = P.normalize(payload);
    if (!tiers) throw new Error('unusable payload');
    // The proxy reports its own (non-Indian) location, so its payload has no ₹ prices —
    // for a visitor in India keep the static snapshot (which has both) instead.
    if (!live && inIndia() && tiers.every(function (t) { return !t.prices.INR; })) throw new Error('no INR in proxy payload');
    var html = P.renderTiers(tiers, annualMap);
    if (html && grid) grid.innerHTML = html;
    var lt = P.lifetimeOffer(payload);
    if (lt) {
      Array.prototype.forEach.call(section.querySelectorAll('[data-lt-price]'), function (el) {
        var cur = el.getAttribute('data-lt-price');
        if (lt[cur] > 0) el.textContent = P.money(lt[cur], cur);
      });
    }
    section.setAttribute('data-sync', 'live');
    if (note) note.textContent = live ? 'Live pricing from vanto-admin' : 'Pricing from vanto-admin';
    setCurrency(effective(), false); // re-wire the new buttons
  }

  function fetchJSON(url) {
    var ctrl = 'AbortController' in window ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 5000) : 0;
    return fetch(url, { headers: { Accept: 'application/json' }, credentials: 'omit', signal: ctrl ? ctrl.signal : undefined })
      .then(function (r) { clearTimeout(timer); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  }
  function viaProxy() {
    if (!window.fetch || !/^https?:$/.test(location.protocol)) return;
    // Prices only — the proxy can't tell the visitor's country (geo stays as detected).
    fetchJSON('/api/plans').then(function (d) { apply(d, false); }).catch(function () { /* keep the static snapshot */ });
  }

  if (geo) {
    geo.onChange(function () {
      var ok = false;
      if (geo.payload) {
        try { apply(geo.payload, true); ok = true; } catch (e) { /* fall through */ }
      }
      if (!ok) { setCurrency(effective(), false); viaProxy(); }
    });
  } else {
    // geo.js didn't load: fetch directly, then the proxy.
    if (!window.fetch) return;
    fetchJSON('https://vanto-connect.vercel.app/api/orgs/public/plans').then(function (d) { apply(d, true); }).catch(viaProxy);
  }
})();
