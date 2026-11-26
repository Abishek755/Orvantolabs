/* =====================================================================
   Strict geo-locked currency for orvantolabs.in
   ---------------------------------------------------------------------
   ₹ INR is shown ONLY to visitors in India; everyone else sees $ USD
   and no INR at all.

   1. An inline <head> script sets <html data-geo="IN|INTL"> from the
      browser timezone / language before first paint (no INR flash).
   2. This script asks vanto-connect's public plans API directly — it
      runs on Vercel and sees the visitor's real IP country
      (x-vercel-ip-country) — and corrects data-geo. (The same-origin
      /api/plans proxy can't be used for geo: it would report the proxy's
      location, not the visitor's.)
   The API payload is kept on window.OrvantoGeo.payload for
   js/plans-sync.js, so the page makes one request.
   ===================================================================== */
(function () {
  'use strict';
  var root = document.documentElement;
  var API = 'https://vanto-connect.vercel.app/api/orgs/public/plans';
  var listeners = [];

  function guess() {
    try {
      var tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
      if (/^Asia\/(Kolkata|Calcutta)$/.test(tz)) return 'IN';
    } catch (e) { /* older browser */ }
    var langs = navigator.languages || [navigator.language || ''];
    for (var i = 0; i < langs.length; i++) if (/-IN$/i.test(langs[i] || '')) return 'IN';
    return 'INTL';
  }

  var geo = {
    region: root.getAttribute('data-geo') === 'IN' ? 'IN' : (root.getAttribute('data-geo') ? 'INTL' : guess()),
    country: null,
    source: 'browser',
    payload: null,
    settled: false,
    get inIndia() { return this.region === 'IN'; },
    onChange: function (cb) { listeners.push(cb); if (this.settled) cb(this); }
  };
  window.OrvantoGeo = geo;

  function apply() {
    root.setAttribute('data-geo', geo.region);
    // <option>s can't be reliably hidden with CSS (iOS) — drop INR-only ones outside India.
    if (geo.region !== 'IN') {
      Array.prototype.forEach.call(document.querySelectorAll('option.inr-only'), function (o) { o.parentNode && o.parentNode.removeChild(o); });
    }
  }
  function settle() {
    geo.settled = true;
    apply();
    listeners.forEach(function (cb) { try { cb(geo); } catch (e) { /* keep going */ } });
  }

  apply();
  if (!window.fetch) return settle();
  var ctrl = 'AbortController' in window ? new AbortController() : null;
  var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 5000) : 0;
  fetch(API, { headers: { Accept: 'application/json' }, credentials: 'omit', signal: ctrl ? ctrl.signal : undefined })
    .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(function (d) {
      clearTimeout(timer);
      geo.payload = d;
      var c = d && d.geo && typeof d.geo.country === 'string' ? d.geo.country.toUpperCase() : null;
      if (c && /^[A-Z]{2}$/.test(c)) {
        geo.country = c;
        geo.region = c === 'IN' ? 'IN' : 'INTL';
        geo.source = 'ip';
      }
      settle();
    })
    .catch(function () { clearTimeout(timer); settle(); });
})();
