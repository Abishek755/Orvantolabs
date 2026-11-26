/* Vanto Connect — Live Product Explorer (tabs + interactive mockups) */
(function () {
  'use strict';

  var root = document.querySelector('[data-explorer]');
  if (!root) return;
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var tabs = Array.prototype.slice.call(root.querySelectorAll('[role="tab"]'));
  var panels = {};
  tabs.forEach(function (t) { panels[t.getAttribute('data-tab')] = document.getElementById(t.getAttribute('aria-controls')); });
  var crumbs = root.querySelector('[data-crumb]');
  var crumbText = { canvas: 'Bot Studio', inbox: 'Team Inbox', spend: 'Meta Spend' };
  var shown = {};

  function select(id, focus) {
    if (!panels[id]) return;
    tabs.forEach(function (t) {
      var on = t.getAttribute('data-tab') === id;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      if (on && focus) t.focus();
    });
    Object.keys(panels).forEach(function (k) { panels[k].hidden = k !== id; });
    if (crumbs) crumbs.textContent = crumbText[id] || '';
    onShow(id);
  }

  tabs.forEach(function (t, i) {
    t.addEventListener('click', function () { select(t.getAttribute('data-tab')); });
    t.addEventListener('keydown', function (e) {
      var n = null;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') n = (i + 1) % tabs.length;
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') n = (i - 1 + tabs.length) % tabs.length;
      else if (e.key === 'Home') n = 0;
      else if (e.key === 'End') n = tabs.length - 1;
      if (n !== null) { e.preventDefault(); select(tabs[n].getAttribute('data-tab'), true); }
    });
  });

  // Deep links from the hero stage and elsewhere: <a data-explorer-tab="inbox" href="#product">
  document.addEventListener('click', function (e) {
    var a = e.target.closest('[data-explorer-tab]');
    if (!a) return;
    e.preventDefault();
    select(a.getAttribute('data-explorer-tab'));
    root.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
    if (history.replaceState) history.replaceState(null, '', '#product');
  });

  var seen = false; // explorer has scrolled into view at least once
  function onShow(id) {
    if (id === 'canvas') { drawEdges(); if (seen && !shown.canvas) { shown.canvas = true; build(false); } }
    if (id === 'inbox') startTimer(); else stopTimer();
    if (id === 'spend' && !shown.spend) { shown.spend = true; renderSpend(); }
  }

  /* =================================================================
     1 · Visual Bot Canvas
     ================================================================= */
  var board = root.querySelector('.board');
  var svg = board ? board.querySelector('svg.edges') : null;
  var EDGES = [
    ['trigger:b', 'name:t', 'flow'],
    ['name:b', 'email:t', 'flow'],
    ['email:r', 'ifelse:l', 'flow'],
    ['ifelse@yes', 'crm:l', 'flow'],
    ['ifelse@else', 'number:l', 'flow'],
    ['number:b', 'plus:t', 'dotted'],
    ['email@side', 'guard:l', 'dotted']
  ];
  var SVGNS = 'http://www.w3.org/2000/svg';

  function nodeEl(name) { return board.querySelector('[data-node="' + name + '"]'); }
  function portPos(spec) {
    var x, y, side;
    if (spec.indexOf('@') > -1) {
      var parts = spec.split('@');
      var n = nodeEl(parts[0]);
      var port = n.querySelector('[data-port="' + parts[1] + '"]');
      // walk offsets up to the board
      var el = port, ox = 0, oy = 0;
      while (el && el !== board) { ox += el.offsetLeft; oy += el.offsetTop; el = el.offsetParent; }
      return { x: ox + port.offsetWidth / 2, y: oy + port.offsetHeight / 2, side: 'r' };
    }
    var p = spec.split(':');
    var node = nodeEl(p[0]);
    side = p[1];
    var L = node.offsetLeft, T = node.offsetTop, W = node.offsetWidth, H = node.offsetHeight;
    if (side === 'b') { x = L + W / 2; y = T + H; }
    else if (side === 't') { x = L + W / 2; y = T; }
    else if (side === 'r') { x = L + W; y = T + H / 2; }
    else { x = L; y = T + H / 2; }
    return { x: x, y: y, side: side };
  }
  function pathD(a, b) {
    var dx = Math.max(30, Math.abs(b.x - a.x) * 0.5), dy = Math.max(24, Math.abs(b.y - a.y) * 0.5);
    var c1 = { x: a.x, y: a.y }, c2 = { x: b.x, y: b.y };
    if (a.side === 'b') c1.y += dy; else if (a.side === 't') c1.y -= dy; else if (a.side === 'r') c1.x += dx; else c1.x -= dx;
    if (b.side === 't') c2.y -= dy; else if (b.side === 'b') c2.y += dy; else if (b.side === 'l') c2.x -= dx; else c2.x += dx;
    return 'M' + a.x + ' ' + a.y + ' C' + c1.x + ' ' + c1.y + ' ' + c2.x + ' ' + c2.y + ' ' + b.x + ' ' + b.y;
  }
  // Scale the fixed-size board to fit medium widths; below 78% let it scroll instead
  var sizer = board ? board.parentElement : null;
  var BW = 720, BH = 480;
  function fitBoard() {
    if (!sizer || !sizer.classList.contains('board-sizer')) return;
    var scroller = sizer.parentElement;
    var avail = scroller.clientWidth;
    if (!avail) return;
    var s = Math.max(0.78, Math.min(1, avail / BW));
    board.style.transform = s < 1 ? 'scale(' + s.toFixed(4) + ')' : '';
    sizer.style.width = Math.round(BW * s) + 'px';
    sizer.style.height = Math.round(BH * s) + 'px';
  }

  var edgePaths = [];
  function drawEdges() {
    fitBoard();
    if (!svg || !board.offsetWidth) return;
    var builtState = edgePaths.map(function (e) { return e.drawn; });
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    edgePaths = [];
    EDGES.forEach(function (e, i) {
      var a = portPos(e[0]), b = portPos(e[1]);
      var d = pathD(a, b);
      var group = { drawn: !!builtState[i], els: [] };
      if (e[2] === 'dotted') {
        var dp = document.createElementNS(SVGNS, 'path');
        dp.setAttribute('d', d); dp.setAttribute('class', 'e-dotted');
        svg.appendChild(dp); group.els.push(dp);
      } else {
        var base = document.createElementNS(SVGNS, 'path');
        base.setAttribute('d', d); base.setAttribute('class', 'e-base'); base.setAttribute('pathLength', '1');
        var flow = document.createElementNS(SVGNS, 'path');
        flow.setAttribute('d', d); flow.setAttribute('class', 'e-flow');
        svg.appendChild(base); svg.appendChild(flow);
        group.els.push(base, flow);
      }
      if (group.drawn) group.els.forEach(function (el) { el.classList.add('is-drawn'); });
      edgePaths.push(group);
    });
  }

  var buildTimers = [];
  var BUILD_ORDER = ['trigger', 'name', 'email', 'ifelse', 'crm', 'number', 'plus', 'guard'];
  var EDGE_AFTER = { name: [0], email: [1], ifelse: [2], crm: [3], number: [4], plus: [5], guard: [6] };
  var promptTxt = root.querySelector('[data-prompt]');
  var PROMPT = promptTxt ? promptTxt.getAttribute('data-prompt') : '';

  function clearBuild() {
    buildTimers.forEach(clearTimeout); buildTimers = [];
    if (!board) return;
    board.querySelectorAll('.is-built').forEach(function (n) { n.classList.remove('is-built'); });
    edgePaths.forEach(function (g) { g.drawn = false; g.els.forEach(function (el) { el.classList.remove('is-drawn'); }); });
  }
  function markEdges(idxs) {
    idxs.forEach(function (i) { var g = edgePaths[i]; if (!g) return; g.drawn = true; g.els.forEach(function (el) { el.classList.add('is-drawn'); }); });
  }
  function buildNodes(stepMs) {
    BUILD_ORDER.forEach(function (name, i) {
      buildTimers.push(setTimeout(function () {
        var n = nodeEl(name); if (n) n.classList.add('is-built');
        if (EDGE_AFTER[name]) markEdges(EDGE_AFTER[name]);
      }, i * stepMs));
    });
  }
  function build(typed) {
    if (!board) return;
    clearBuild();
    drawEdges();
    if (reduceMotion) {
      BUILD_ORDER.forEach(function (n) { var el = nodeEl(n); if (el) el.classList.add('is-built'); });
      markEdges([0, 1, 2, 3, 4, 5, 6]);
      if (promptTxt) promptTxt.textContent = PROMPT;
      return;
    }
    if (typed && promptTxt) {
      promptTxt.textContent = '';
      var i = 0;
      (function type() {
        promptTxt.textContent = PROMPT.slice(0, i);
        if (i <= PROMPT.length) { i += 2; buildTimers.push(setTimeout(type, 18)); }
        else buildNodes(170);
      })();
    } else {
      buildNodes(150);
    }
  }
  var buildBtn = root.querySelector('[data-build]');
  if (buildBtn) buildBtn.addEventListener('click', function () { build(true); });

  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { drawEdges(); });
  window.addEventListener('resize', function () { if (panels.canvas && !panels.canvas.hidden) drawEdges(); });

  // Build the first time the explorer scrolls into view
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      if (!entries[0].isIntersecting) return;
      io.disconnect();
      seen = true;
      if (panels.canvas && !panels.canvas.hidden && !shown.canvas) { shown.canvas = true; build(false); }
    }, { threshold: 0.2 });
    io.observe(root);
  } else { seen = true; }

  /* =================================================================
     2 · Team Inbox + auto-pause
     ================================================================= */
  var banner = root.querySelector('[data-bot-banner]');
  var timerEl = root.querySelector('[data-timer]');
  var resumeBtn = root.querySelector('[data-resume]');
  var statusChip = root.querySelector('[data-bot-status]');
  var bannerTxt = root.querySelector('[data-banner-text]');
  var remaining = 23 * 3600 + 58 * 60 + 41;
  var paused = true, tick = 0;

  function fmt(s) {
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m + ':' + (x < 10 ? '0' : '') + x;
  }
  function renderBanner() {
    if (!banner) return;
    banner.classList.toggle('is-active', !paused);
    if (paused) {
      bannerTxt.innerHTML = '<b>Bot paused</b> — Divya replied, so automation is on hold for 24 hours.';
      timerEl.textContent = fmt(remaining) + ' left';
      timerEl.hidden = false;
      resumeBtn.textContent = 'Resume Bot';
      if (statusChip) { statusChip.textContent = 'Bot paused'; statusChip.className = 'chip'; }
    } else {
      bannerTxt.innerHTML = '<b>Bot active</b> — automated replies resumed. The next agent reply pauses it again for 24 hours.';
      timerEl.hidden = true;
      resumeBtn.textContent = 'Pause Bot';
      if (statusChip) { statusChip.textContent = 'Bot active'; statusChip.className = 'chip chip-emerald'; }
    }
  }
  function startTimer() {
    if (tick || !timerEl) return;
    tick = setInterval(function () {
      if (!paused) return;
      remaining = Math.max(0, remaining - 1);
      timerEl.textContent = fmt(remaining) + ' left';
    }, 1000);
  }
  function stopTimer() { if (tick) { clearInterval(tick); tick = 0; } }
  if (resumeBtn) {
    resumeBtn.addEventListener('click', function () {
      paused = !paused;
      if (paused) remaining = 24 * 3600;
      renderBanner();
    });
    renderBanner();
  }

  /* =================================================================
     3 · Meta Spend Analytics (illustrative sample data)
     ================================================================= */
  var DAILY = [
    ['10 Nov', 41.20], ['11 Nov', 52.85], ['12 Nov', 47.10], ['13 Nov', 38.40], ['14 Nov', 61.75],
    ['15 Nov', 29.30], ['16 Nov', 24.15], ['17 Nov', 55.60], ['18 Nov', 63.90], ['19 Nov', 49.25],
    ['20 Nov', 58.10], ['21 Nov', 71.45], ['22 Nov', 33.80], ['23 Nov', 44.65]
  ];
  var CATS = [
    ['Marketing', 1240, 967.20],
    ['Utility', 860, 98.90],
    ['Authentication', 310, 35.65],
    ['Service', 1920, 0]
  ];
  // Illustrative spend figures: ₹ for visitors in India, $ elsewhere (strict geo lock, js/geo.js).
  function india() { return document.documentElement.getAttribute('data-geo') === 'IN'; }
  function sym() { return india() ? '₹' : '$'; }
  function inr(v) { return sym() + v.toLocaleString(india() ? 'en-IN' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

  function renderSpend() {
    var daily = root.querySelector('[data-daily]');
    var tip = root.querySelector('[data-tip]');
    var cats = root.querySelector('[data-cats]');
    if (daily && !daily.children.length) {
      var max = 80; // axis max (₹)
      var grid = document.createElement('div'); grid.className = 'daily-grid';
      [0.25, 0.5, 0.75, 1].forEach(function (f) {
        var s = document.createElement('span');
        s.style.bottom = (f * 100) + '%';
        s.setAttribute('data-v', sym() + Math.round(f * max));
        grid.appendChild(s);
      });
      daily.appendChild(grid);
      DAILY.forEach(function (d) {
        var col = document.createElement('div');
        col.className = 'col'; col.tabIndex = 0;
        col.setAttribute('aria-label', d[0] + ': ' + inr(d[1]));
        var bar = document.createElement('i');
        bar.style.height = '0%';
        col.appendChild(bar);
        daily.appendChild(col);
        requestAnimationFrame(function () {
          bar.style.transition = reduceMotion ? 'none' : 'height .7s cubic-bezier(.2,.7,.2,1)';
          bar.style.height = (d[1] / max * 100).toFixed(1) + '%';
        });
        var show = function () {
          var card = daily.closest('.viz-card');
          var cr = card.getBoundingClientRect(), br = bar.getBoundingClientRect();
          tip.innerHTML = d[0] + ' · <b>' + inr(d[1]) + '</b>';
          tip.style.left = (br.left - cr.left + br.width / 2) + 'px';
          tip.style.top = (br.top - cr.top) + 'px';
          tip.classList.add('on');
        };
        col.addEventListener('pointerenter', show);
        col.addEventListener('focus', show);
        col.addEventListener('pointerleave', function () { tip.classList.remove('on'); });
        col.addEventListener('blur', function () { tip.classList.remove('on'); });
      });
    }
    if (cats && !cats.children.length) {
      var maxC = CATS.reduce(function (m, c) { return Math.max(m, c[2]); }, 0);
      CATS.forEach(function (c) {
        var row = document.createElement('div');
        row.className = 'cat-row';
        row.title = c[0] + ': ' + c[1].toLocaleString('en-IN') + ' conversations · ' + inr(c[2]);
        row.innerHTML = '<span class="n">' + c[0] + '</span><span class="track"><span class="fill"></span></span><span class="val">' + inr(c[2]) + '</span>';
        cats.appendChild(row);
        var fill = row.querySelector('.fill');
        fill.style.width = '0%';
        requestAnimationFrame(function () {
          fill.style.transition = reduceMotion ? 'none' : 'width .8s cubic-bezier(.2,.7,.2,1)';
          fill.style.width = (c[2] / maxC * 100).toFixed(1) + '%';
        });
      });
    }
  }

  // initial state
  var initial = (tabs.filter(function (t) { return t.getAttribute('aria-selected') === 'true'; })[0] || tabs[0]).getAttribute('data-tab');
  select(initial);
})();
