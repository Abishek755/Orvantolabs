/* =====================================================================
   Vanto Connect — Razorpay Standard Checkout for India (INR) plans
   ---------------------------------------------------------------------
   When ₹ pricing is shown, Starter / Growth / Pro buttons (monthly or
   annual) open a small buyer-details modal instead of the contact form:

   1. Load https://checkout.razorpay.com/v1/checkout.js (on first click).
   2. POST <razorpay.checkoutApi>  (application/json)
        { plan, billing_cycle, currency: "INR", name, email, phone }
      expected reply: { key | key_id, subscription_id, description? }
      error reply:    non-2xx or { ok: false, error: "message" }
   3. new Razorpay({ key, subscription_id, name, description, prefill,
      theme, handler }).open()
   4. handler → poll GET <razorpay.claimStatusApi>?subscription_id=…
      every 1.5 s for up to <pollSeconds>; ready when the reply has
      claim_url | url, or token | claim_token (→ <claimUrl>?token=…).
      Then redirect to the claim page; otherwise tell the buyer the
      install link is on its way to their email.

   Config lives in js/checkout-config.js (window.ORVANTO_CHECKOUT.razorpay).
   The buttons keep their contact-form href, so without JS — or if this
   script fails to load — they still lead somewhere useful.
   ===================================================================== */
(function () {
  'use strict';
  var CFG = (window.ORVANTO_CHECKOUT || {}).razorpay || {};
  if (!CFG.enabled || !CFG.checkoutApi) return;
  var section = document.querySelector('[data-plans]');
  if (!section) return;

  var PLANS = { starter: true, growth: true, pro: true };
  var STORE = 'vc-buyer';
  var POLL_MS = 1500;
  var SUPPORT = 'info@orvantolabs.in';

  /* ---------- Razorpay script (loaded once, on demand) ---------- */
  var scriptPromise = null;
  function loadRazorpay() {
    if (window.Razorpay) return Promise.resolve();
    if (scriptPromise) return scriptPromise;
    scriptPromise = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = CFG.scriptUrl || 'https://checkout.razorpay.com/v1/checkout.js';
      s.async = true;
      s.onload = function () { window.Razorpay ? resolve() : reject(new Error('Razorpay did not load')); };
      s.onerror = function () { scriptPromise = null; reject(new Error('Could not load Razorpay')); };
      document.head.appendChild(s);
    });
    return scriptPromise;
  }

  /* ---------- small helpers ---------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fetchJSON(url, opts, ms) {
    var ctrl = 'AbortController' in window ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, ms || 15000) : 0;
    opts = opts || {};
    opts.credentials = 'omit';
    if (ctrl) opts.signal = ctrl.signal;
    return fetch(url, opts).then(function (r) {
      clearTimeout(timer);
      return r.text().then(function (txt) {
        var data = null;
        try { data = txt ? JSON.parse(txt) : null; } catch (e) { /* not JSON */ }
        if (!r.ok || (data && data.ok === false)) {
          var msg = data && (data.error && (data.error.message || data.error)) || data && data.message;
          throw new Error(typeof msg === 'string' && msg ? msg : 'Checkout service returned ' + r.status);
        }
        return data || {};
      });
    }, function (err) { clearTimeout(timer); throw err; });
  }
  function readBuyer() { try { return JSON.parse(localStorage.getItem(STORE) || '{}') || {}; } catch (e) { return {}; } }
  function saveBuyer(b) { try { localStorage.setItem(STORE, JSON.stringify(b)); } catch (e) { /* storage unavailable */ } }
  /** 10-digit Indian mobile from any input (strips spaces, +91, leading 0) or null. */
  function indianMobile(v) {
    var d = String(v || '').replace(/\D/g, '');
    if (d.length === 12 && d.indexOf('91') === 0) d = d.slice(2);
    if (d.length === 11 && d.charAt(0) === '0') d = d.slice(1);
    return /^[6-9]\d{9}$/.test(d) ? d : null;
  }
  function contactHref(plan) { return 'contact.html?plan=' + encodeURIComponent(plan); }

  /* ---------- modal ---------- */
  var ARROW = '<svg class="arrow" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var overlay = document.createElement('div');
  overlay.className = 'rzp-overlay';
  overlay.hidden = true;
  overlay.innerHTML =
    '<div class="rzp-modal" role="dialog" aria-modal="true" aria-labelledby="rzp-title">' +
      '<button type="button" class="rzp-close" aria-label="Close">&times;</button>' +
      '<h2 id="rzp-title">Subscribe to Vanto Connect</h2>' +
      '<div class="rzp-summary"><b data-rzp-plan></b><span data-rzp-price></span></div>' +
      '<form novalidate>' +
        '<div class="field"><label for="rzp-name">Full name</label><input id="rzp-name" name="name" type="text" autocomplete="name" required></div>' +
        '<div class="field"><label for="rzp-email">Work email</label><input id="rzp-email" name="email" type="email" autocomplete="email" required></div>' +
        '<div class="field"><label for="rzp-phone">Mobile number</label><div class="rzp-phone"><span class="cc" aria-hidden="true">+91</span><input id="rzp-phone" name="phone" type="tel" inputmode="numeric" autocomplete="tel-national" placeholder="98765 43210" required></div></div>' +
        '<div class="rzp-msg" role="alert"></div>' +
        '<button type="submit" class="btn btn-emerald btn-block" data-rzp-submit>Continue to secure payment ' + ARROW + '</button>' +
        '<p class="rzp-note">Billed in INR through Razorpay and renewed each <span data-rzp-cycle>month</span> until you cancel. Your install link is sent to this email. By continuing you agree to our <a href="terms.html">Terms</a> and <a href="refund.html">Refund &amp; Cancellation Policy</a>.</p>' +
      '</form>' +
      '<div class="rzp-status" aria-live="polite"><div class="rzp-spinner" aria-hidden="true"></div><p data-rzp-status-title></p><div class="rzp-status-body" data-rzp-status-body></div></div>' +
    '</div>';
  document.body.appendChild(overlay);

  var modal = overlay.querySelector('.rzp-modal');
  var form = overlay.querySelector('form');
  var nameIn = overlay.querySelector('#rzp-name');
  var emailIn = overlay.querySelector('#rzp-email');
  var phoneIn = overlay.querySelector('#rzp-phone');
  var msgEl = overlay.querySelector('.rzp-msg');
  var submitBtn = overlay.querySelector('[data-rzp-submit]');
  var submitHTML = submitBtn.innerHTML;
  var statusEl = overlay.querySelector('.rzp-status');
  var current = null;   // { plan, cycle, planName, price }
  var busy = false;     // a request / payment / claim poll is in progress
  var lastFocus = null;

  function message(kind, html) {
    msgEl.className = 'rzp-msg' + (kind ? ' ' + kind : '');
    msgEl.innerHTML = html || '';
  }
  function setBusy(on, label) {
    busy = on;
    submitBtn.disabled = on;
    submitBtn.innerHTML = on ? esc(label || 'Starting secure checkout…') : submitHTML;
  }
  function showStatus(title, body, done) {
    modal.classList.add('is-status');
    statusEl.classList.toggle('done', !!done);
    statusEl.querySelector('[data-rzp-status-title]').innerHTML = '<strong>' + esc(title) + '</strong>';
    statusEl.querySelector('[data-rzp-status-body]').innerHTML = body;
  }
  function openModal(info) {
    current = info;
    overlay.querySelector('[data-rzp-plan]').textContent = info.planName + ' · ' + (info.cycle === 'annual' ? 'Annual' : 'Monthly');
    overlay.querySelector('[data-rzp-price]').textContent = info.price;
    overlay.querySelector('[data-rzp-cycle]').textContent = info.cycle === 'annual' ? 'year' : 'month';
    var b = readBuyer();
    if (!nameIn.value && b.name) nameIn.value = b.name;
    if (!emailIn.value && b.email) emailIn.value = b.email;
    if (!phoneIn.value && b.phone) phoneIn.value = b.phone;
    modal.classList.remove('is-status');
    message('', '');
    setBusy(false);
    lastFocus = document.activeElement;
    overlay.hidden = false;
    document.documentElement.style.overflow = 'hidden';
    requestAnimationFrame(function () { overlay.classList.add('is-open'); });
    var first = [nameIn, emailIn, phoneIn].filter(function (i) { return !i.value; })[0] || submitBtn;
    setTimeout(function () { first.focus(); }, 30);
    loadRazorpay().catch(function () { /* retried on submit */ });
  }
  function closeModal(force) {
    if (busy && !force) return;
    overlay.classList.remove('is-open');
    overlay.hidden = true;
    document.documentElement.style.overflow = '';
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  overlay.querySelector('.rzp-close').addEventListener('click', function () { closeModal(false); });
  overlay.addEventListener('click', function (e) { if (e.target === overlay) closeModal(false); });
  document.addEventListener('keydown', function (e) {
    if (overlay.hidden) return;
    if (e.key === 'Escape') { closeModal(false); return; }
    if (e.key === 'Tab') { // keep focus inside the dialog
      var f = Array.prototype.filter.call(modal.querySelectorAll('button, input, a[href]'), function (el) { return !el.disabled && el.offsetParent !== null; });
      if (!f.length) return;
      var i = f.indexOf(document.activeElement);
      if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
    }
  });

  /* ---------- ₹ plan buttons → modal ---------- */
  section.addEventListener('click', function (e) {
    var a = e.target.closest('.plan [data-checkout]');
    if (!a || section.getAttribute('data-currency') !== 'INR') return;
    var plan = a.getAttribute('data-checkout');
    if (!PLANS[plan]) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button > 0) return; // let "open in new tab" use the contact link
    e.preventDefault();
    var cycle = a.getAttribute('data-cycle') === 'annual' ? 'annual' : 'monthly';
    var card = a.closest('.plan');
    var priceEl = card && card.querySelector('.amt [data-cycle-show="' + cycle + '"] [data-cur="INR"]');
    var nameEl = card && card.querySelector('h3');
    openModal({
      plan: plan,
      cycle: cycle,
      planName: nameEl ? nameEl.textContent.trim() : plan,
      price: (priceEl ? priceEl.textContent.trim() : '') + (cycle === 'annual' ? '/yr' : '/mo')
    });
  });

  /* ---------- submit → subscription → Razorpay ---------- */
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (busy || !current) return;
    var name = nameIn.value.trim();
    var email = emailIn.value.trim();
    var phone = indianMobile(phoneIn.value);
    if (name.length < 2) { message('err', 'Please enter your full name.'); nameIn.focus(); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { message('err', 'Please enter a valid work email — your install link is sent there.'); emailIn.focus(); return; }
    if (!phone) { message('err', 'Please enter a valid 10-digit Indian mobile number.'); phoneIn.focus(); return; }
    saveBuyer({ name: name, email: email, phone: phone });
    message('', '');
    setBusy(true);
    var plan = current.plan, cycle = current.cycle, planName = current.planName;

    var body = JSON.stringify({ plan: plan, billing_cycle: cycle, currency: 'INR', name: name, email: email, phone: '+91' + phone });
    Promise.all([
      loadRazorpay(),
      fetchJSON(CFG.checkoutApi, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: body }, 20000)
    ]).then(function (res) {
      var d = res[1] || {};
      var key = d.key || d.key_id || d.razorpay_key;
      var subId = d.subscription_id || (d.subscription && d.subscription.id) || d.id;
      if (!key || !subId) throw new Error('Checkout could not be created');
      startPayment({ key: key, subId: subId, description: d.description, plan: plan, cycle: cycle, planName: planName, name: name, email: email, phone: phone });
    }).catch(function (err) {
      setBusy(false);
      message('err', 'We couldn’t start the secure checkout' + (err && err.message && !/abort/i.test(err.message) ? ' (' + esc(err.message) + ')' : '') +
        '. Please try again in a moment, or <a href="' + contactHref(plan) + '">contact us</a> and we’ll set it up for you.');
    });
  });

  function startPayment(o) {
    var paid = false, failure = null;
    var rzp = new window.Razorpay({
      key: o.key,
      subscription_id: o.subId,
      name: CFG.merchantName || 'Orvanto Labs',
      description: o.description || ('Vanto Connect ' + o.planName + ' · ' + (o.cycle === 'annual' ? 'Annual' : 'Monthly')),
      prefill: { name: o.name, email: o.email, contact: '+91' + o.phone },
      theme: { color: CFG.themeColor || '#10b981' },
      handler: function (resp) {
        paid = true;
        waitForClaim((resp && resp.razorpay_subscription_id) || o.subId, o.email);
      },
      modal: {
        ondismiss: function () {
          if (paid) return;
          overlay.hidden = false;
          overlay.classList.add('is-open');
          setBusy(false);
          message(failure ? 'err' : 'info', failure
            ? 'The payment didn’t go through: ' + esc(failure) + '. You can try again, or <a href="' + contactHref(o.plan) + '">contact us</a>.'
            : 'Payment not completed — you can try again whenever you’re ready.');
        }
      }
    });
    rzp.on('payment.failed', function (resp) {
      failure = (resp && resp.error && (resp.error.description || resp.error.reason)) || 'payment failed';
    });
    // Razorpay shows its own dialog: hide ours underneath while it's open.
    overlay.classList.remove('is-open');
    overlay.hidden = true;
    rzp.open();
  }

  /* ---------- after payment: wait for the claim link, then redirect ---------- */
  function claimTarget(d) {
    if (!d) return null;
    var url = d.claim_url || d.url;
    if (typeof url === 'string' && url) {
      try { return new URL(url, CFG.claimUrl || 'https://vanto-connect.vercel.app/claim').toString(); } catch (e) { /* bad URL */ }
    }
    var token = d.token || d.claim_token;
    if (typeof token === 'string' && token) return (CFG.claimUrl || 'https://vanto-connect.vercel.app/claim') + '?token=' + encodeURIComponent(token);
    return null;
  }

  function waitForClaim(subId, email) {
    busy = true;
    overlay.hidden = false;
    overlay.classList.add('is-open');
    showStatus('Payment received', 'Setting up your Vanto Connect workspace — this takes a few seconds…', false);
    var deadline = Date.now() + (CFG.pollSeconds || 15) * 1000;
    var url = CFG.claimStatusApi + (CFG.claimStatusApi.indexOf('?') > -1 ? '&' : '?') + 'subscription_id=' + encodeURIComponent(subId);

    (function poll() {
      fetchJSON(url, { headers: { Accept: 'application/json' }, cache: 'no-store' }, 8000)
        .then(function (d) { return claimTarget(d); }, function () { return null; })
        .then(function (target) {
          if (target) {
            showStatus('You’re all set', 'Taking you to your install link…', false);
            window.location.href = target;
            return;
          }
          if (Date.now() + POLL_MS < deadline) { setTimeout(poll, POLL_MS); return; }
          busy = false;
          showStatus('Payment received — your install link is on its way',
            '<p>We’re finishing setup. Your install link will arrive at <strong>' + esc(email) + '</strong> within a minute or two — please check your inbox (and spam folder).</p>' +
            '<p>Need help? Email <a class="text-link" href="mailto:' + SUPPORT + '?subject=' + encodeURIComponent('Razorpay subscription ' + subId) + '">' + SUPPORT + '</a> and quote <code>' + esc(subId) + '</code>.</p>', true);
        });
    })();
  }

  // For testing / debugging in the console.
  window.OrvantoRazorpay = { open: openModal, loadRazorpay: loadRazorpay, indianMobile: indianMobile, claimTarget: claimTarget };
})();
