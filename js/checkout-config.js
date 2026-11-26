/* =====================================================================
   Vanto Connect — Dodo Payments checkout links (the ONE file to edit)
   ---------------------------------------------------------------------
   Paste each product's static payment link from the Dodo dashboard
   (https://checkout.dodopayments.com/buy/pdt_…). A link can be one
   string for both currencies, or { INR: "…", USD: "…" } if you use a
   separate product per currency.

   Leave a link "" until the product exists — that button keeps opening
   the contact form instead, so nothing ever points at a dead checkout.

   Every link is opened with:
     redirect_url            → the Payment Confirmed page + install link
     metadata_plan / metadata_billing_cycle → which licence to issue
     paymentCurrency + showCurrencySelector=false (lockCurrency) → the
       buyer pays in the currency shown here (₹ only inside India)
   ===================================================================== */
window.ORVANTO_CHECKOUT = {
  // Where Dodo sends buyers after paying (vanto-connect shows their
  // purchase email, payment ID and the single-use Zoho install button).
  redirectUrl: "https://vanto-connect.vercel.app/claim",

  // Pay in the currency displayed on the site (no currency picker at checkout).
  lockCurrency: true,

  links: {
    starter: { monthly: "", annual: "" },
    growth: { monthly: "", annual: "" },
    pro: { monthly: "", annual: "" },
    // Founding Lifetime launch offer (one-time).
    lifetime: { one_time: "" }
  },

  // Fallback for buttons without a link yet, and the custom-plan inquiry.
  contactUrl: "contact.html"
};

/* ---------------- link builder (no need to edit below) ---------------- */
(function () {
  'use strict';
  var C = window.ORVANTO_CHECKOUT || {};

  function pick(v, cur) {
    if (!v) return '';
    if (typeof v === 'string') return v;
    return v[cur] || v.ANY || '';
  }

  /** Dodo checkout URL for plan / cycle / currency, or "" when not configured. */
  function url(plan, cycle, cur) {
    var base = pick(((C.links || {})[plan] || {})[cycle], cur);
    if (!/^https:\/\/\S+$/i.test(base)) return '';
    var u;
    try { u = new URL(base); } catch (e) { return ''; }
    if (C.redirectUrl && !u.searchParams.has('redirect_url')) u.searchParams.set('redirect_url', C.redirectUrl);
    u.searchParams.set('metadata_plan', plan);
    u.searchParams.set('metadata_billing_cycle', cycle);
    if (C.lockCurrency !== false && (cur === 'INR' || cur === 'USD')) {
      u.searchParams.set('paymentCurrency', cur);
      u.searchParams.set('showCurrencySelector', 'false');
    }
    return u.toString();
  }

  /**
   * Point every [data-checkout] button under `root` at its live checkout
   * (data-checkout = plan, data-cycle = monthly|annual|one_time,
   * data-currency = fixed currency, else the one shown). Buttons without
   * a configured link keep their contact-form href.
   */
  function wire(root, currency) {
    var els = (root || document).querySelectorAll('[data-checkout]');
    Array.prototype.forEach.call(els, function (a) {
      if (!a.hasAttribute('data-fallback')) a.setAttribute('data-fallback', a.getAttribute('href') || C.contactUrl || 'contact.html');
      var live = url(a.getAttribute('data-checkout'), a.getAttribute('data-cycle') || 'monthly', a.getAttribute('data-currency') || currency);
      a.setAttribute('href', live || a.getAttribute('data-fallback'));
      if (live) { a.setAttribute('data-live', ''); a.setAttribute('rel', 'noopener'); }
      else a.removeAttribute('data-live');
    });
  }

  window.OrvantoCheckout = { url: url, wire: wire };
})();
