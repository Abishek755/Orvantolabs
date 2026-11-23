/* Orvanto Labs — shared site behaviour (nav, reveal, tactile tilt, scroll perspective) */
(function () {
  'use strict';

  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var finePointer = window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  /* ---- Navigation ---- */
  var nav = document.querySelector('.site-nav');
  if (nav) {
    var toggle = nav.querySelector('.nav-toggle');
    var links = nav.querySelector('.nav-links');
    var onScroll = function () { nav.classList.toggle('is-scrolled', window.scrollY > 12); };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('load', onScroll);
    window.addEventListener('hashchange', onScroll);

    var setOpen = function (open) {
      nav.classList.toggle('is-open', open);
      if (toggle) {
        toggle.setAttribute('aria-expanded', String(open));
        toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
      }
    };
    if (toggle && links) {
      toggle.addEventListener('click', function () { setOpen(!nav.classList.contains('is-open')); });
      links.addEventListener('click', function (e) { if (e.target.closest('a')) setOpen(false); });
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && nav.classList.contains('is-open')) { setOpen(false); toggle.focus(); }
      });
      window.addEventListener('resize', function () { if (window.innerWidth > 960) setOpen(false); });
    }

    /* Active-section indicator: a single pill that glides to the current link */
    var center = nav.querySelector('.nav-center');
    var indicator = center && center.querySelector('.nav-indicator');
    var navLinks = center ? Array.prototype.slice.call(center.querySelectorAll('.nav-links > li > a')) : [];
    var spies = navLinks.map(function (a) {
      var id = a.getAttribute('data-spy');
      return { a: a, el: id ? document.getElementById(id) : null };
    }).filter(function (s) { return s.el; });
    var fixedActive = navLinks.filter(function (a) { return a.getAttribute('aria-current') === 'page'; })[0] || null;
    var current = null;

    var place = function (link) {
      if (!indicator) return;
      if (!link || window.innerWidth <= 960) { indicator.style.opacity = '0'; return; }
      var cr = center.getBoundingClientRect(), lr = link.getBoundingClientRect();
      indicator.style.width = lr.width + 'px';
      indicator.style.transform = 'translateX(' + (lr.left - cr.left) + 'px)';
      indicator.style.opacity = '1';
    };
    var pick = function () {
      var active = fixedActive;
      if (spies.length) {
        var line = window.innerHeight * 0.35;
        active = null;
        spies.forEach(function (s) { if (s.el.getBoundingClientRect().top <= line) active = s.a; });
        // past the last section (e.g. footer) keep the last one; above the first, none
      }
      if (active !== current) {
        navLinks.forEach(function (a) { a.classList.toggle('is-active', a === active); });
        current = active;
      }
      place(current);
    };
    var spyTick = false;
    var onSpy = function () { if (!spyTick) { spyTick = true; requestAnimationFrame(function () { spyTick = false; pick(); }); } };
    pick();
    window.addEventListener('scroll', onSpy, { passive: true });
    window.addEventListener('resize', onSpy);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(onSpy);
  }

  /* ---- Footer year ---- */
  document.querySelectorAll('[data-year]').forEach(function (el) { el.textContent = String(new Date().getFullYear()); });

  /* ---- Reveal on scroll ---- */
  var reveals = document.querySelectorAll('.reveal');
  if (reveals.length) {
    if (reduceMotion || !('IntersectionObserver' in window)) {
      reveals.forEach(function (el) { el.classList.add('is-in'); });
    } else {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          var el = entry.target;
          el.classList.add('is-in');
          io.unobserve(el);
          // hand control back to hover/tilt transitions once the entrance has finished
          setTimeout(function () { el.classList.remove('reveal', 'is-in'); }, 1100);
        });
      }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
      reveals.forEach(function (el) { io.observe(el); });
    }
  }

  /* ---- Tactile tilt (pointer-driven 3D) ---- */
  if (finePointer && !reduceMotion) {
    document.querySelectorAll('[data-tilt]').forEach(function (el) {
      var max = parseFloat(el.getAttribute('data-tilt')) || 4;
      var raf = 0, rx = 0, ry = 0;
      el.classList.add('tilt');
      el.addEventListener('pointermove', function (e) {
        var r = el.getBoundingClientRect();
        var px = (e.clientX - r.left) / r.width - 0.5;
        var py = (e.clientY - r.top) / r.height - 0.5;
        ry = px * max * 2; rx = -py * max * 2;
        if (!raf) raf = requestAnimationFrame(function () {
          raf = 0;
          el.classList.add('is-tilting');
          el.style.transform = 'perspective(1100px) rotateX(' + rx.toFixed(2) + 'deg) rotateY(' + ry.toFixed(2) + 'deg) translateZ(0)';
        });
      });
      el.addEventListener('pointerleave', function () {
        if (raf) { cancelAnimationFrame(raf); raf = 0; }
        el.classList.remove('is-tilting');
        el.style.transform = '';
      });
    });
  }

  /* ---- Scroll-linked perspective settle ([data-settle]) ---- */
  var settles = Array.prototype.slice.call(document.querySelectorAll('[data-settle]'));
  if (settles.length && !reduceMotion) {
    var ticking = false;
    var update = function () {
      ticking = false;
      var vh = window.innerHeight;
      settles.forEach(function (el) {
        var r = el.getBoundingClientRect();
        // progress 0 when the top enters the viewport bottom, 1 when it reaches 35% from top
        var p = (vh - r.top) / (vh * 0.65);
        p = Math.max(0, Math.min(1, p));
        var e = 1 - Math.pow(1 - p, 3);
        el.style.transform = 'rotateX(' + ((1 - e) * 14).toFixed(2) + 'deg) translateY(' + ((1 - e) * 24).toFixed(1) + 'px) scale(' + (0.96 + e * 0.04).toFixed(4) + ')';
      });
    };
    var onScrollSettle = function () { if (!ticking) { ticking = true; requestAnimationFrame(update); } };
    update();
    window.addEventListener('scroll', onScrollSettle, { passive: true });
    window.addEventListener('resize', onScrollSettle);
  }

  /* ---- Legal pages: highlight current section in TOC ---- */
  var toc = document.querySelector('.legal-toc');
  if (toc && 'IntersectionObserver' in window) {
    var tocLinks = Array.prototype.slice.call(toc.querySelectorAll('a[href^="#"]'));
    var map = {};
    tocLinks.forEach(function (a) { map[a.getAttribute('href').slice(1)] = a; });
    var sectionIO = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          tocLinks.forEach(function (a) { a.classList.remove('is-current'); });
          var link = map[entry.target.id];
          if (link) link.classList.add('is-current');
        }
      });
    }, { rootMargin: '-20% 0px -70% 0px' });
    Object.keys(map).forEach(function (id) { var s = document.getElementById(id); if (s) sectionIO.observe(s); });
  }
})();
