/* =====================================================================
   Vanto Connect — isometric architecture stage (Three.js r128)
   Zoho CRM Leads  <->  Visual Bot Nodes  <->  Meta WhatsApp Cloud API
   ===================================================================== */
(function () {
  'use strict';

  var stage = document.getElementById('stage');
  if (!stage) return;
  var view = stage.querySelector('.stage-view') || stage; // 3D viewport (ticker bar sits below it)
  var canvas = stage.querySelector('canvas');
  var logEl = stage.querySelector('.stage-log');

  function fallback() { stage.classList.remove('is-live'); stage.classList.add('is-fallback'); }
  if (!window.THREE || !canvas) { fallback(); return; }

  var renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
  } catch (err) { fallback(); return; }
  if (!renderer || !renderer.getContext()) { fallback(); return; }

  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var isSmall = function () { return window.innerWidth < 720; };

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  var scene = new THREE.Scene();
  var camera = new THREE.OrthographicCamera(-10, 10, 8, -8, 0.1, 400);
  var lookTarget = new THREE.Vector3(0, 0.35, 0);

  /* ---------- Palette ---------- */
  var C = {
    plinth: 0x141c2a,
    plinthTop: 0x1b2435,
    edge: 0xf8fafc,
    maquette: 0xe4e9f0,
    maquetteDim: 0xb9c3d1,
    slate: 0x475569,
    emerald: 0x059669,
    emeraldBright: 0x34d399,
    alabaster: 0xf8fafc
  };

  /* ---------- Lights ---------- */
  scene.add(new THREE.HemisphereLight(0xdde5f0, 0x0a0e16, 0.62));
  var key = new THREE.DirectionalLight(0xffffff, 0.92);
  key.position.set(-7, 18, 11);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -18; key.shadow.camera.right = 18;
  key.shadow.camera.top = 18; key.shadow.camera.bottom = -18;
  key.shadow.camera.near = 1; key.shadow.camera.far = 60;
  key.shadow.bias = -0.0006;
  scene.add(key);
  var rim = new THREE.DirectionalLight(0x9fb4cc, 0.28);
  rim.position.set(12, 6, -10);
  scene.add(rim);

  /* ---------- Ground: faded grid + shadow catcher ---------- */
  var GROUND_Y = -3.4;
  (function buildGround() {
    var pts = [];
    var ext = 30, step = 1.6;
    for (var v = -ext; v <= ext + 0.001; v += step) {
      pts.push(-ext, 0, v, ext, 0, v);
      pts.push(v, 0, -ext, v, 0, ext);
    }
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    var mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uColor: { value: new THREE.Color(0x64748b) }, uRadius: { value: 17.0 } },
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform vec3 uColor; uniform float uRadius; varying vec3 vP; void main(){ float d = length(vP.xz) / uRadius; float a = (1.0 - smoothstep(0.2, 1.0, d)) * 0.26; gl_FragColor = vec4(uColor, a); }'
    });
    var grid = new THREE.LineSegments(g, mat);
    grid.position.y = GROUND_Y;
    scene.add(grid);

    var catcher = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.ShadowMaterial({ opacity: 0.38 }));
    catcher.rotation.x = -Math.PI / 2;
    catcher.position.y = GROUND_Y + 0.01;
    catcher.receiveShadow = true;
    scene.add(catcher);
  })();

  /* ---------- Materials ---------- */
  function std(color, rough, extra) {
    var m = new THREE.MeshStandardMaterial({ color: color, roughness: rough == null ? 0.7 : rough, metalness: 0.04 });
    if (extra) Object.keys(extra).forEach(function (k) { m[k] = extra[k]; });
    return m;
  }
  var matMaquette = std(C.maquette, 0.62);
  var matMaquetteDim = std(C.maquetteDim, 0.7);
  var matEmerald = std(C.emerald, 0.45, { emissive: new THREE.Color(C.emerald), emissiveIntensity: 0.18 });
  var matSlate = std(C.slate, 0.7);
  var matLed = new THREE.MeshBasicMaterial({ color: C.emeraldBright });

  function addEdges(mesh, opacity) {
    var lines = new THREE.LineSegments(
      new THREE.EdgesGeometry(mesh.geometry),
      new THREE.LineBasicMaterial({ color: C.edge, transparent: true, opacity: opacity })
    );
    lines.position.copy(mesh.position);
    lines.rotation.copy(mesh.rotation);
    return lines;
  }
  function box(w, h, d, mat, x, y, z) {
    var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x || 0, y || 0, z || 0);
    m.castShadow = true; m.receiveShadow = true;
    return m;
  }

  /* ---------- Platforms ---------- */
  var PW = 4.4, PH = 0.5, TOP = PH / 2 + 0.03; // top surface height (local)

  function makePlatform(name) {
    var group = new THREE.Group();
    var props = new THREE.Group();
    var base = box(PW, PH, PW, std(C.plinth, 0.86));
    group.add(base);
    var edgeMat = new THREE.LineBasicMaterial({ color: C.edge, transparent: true, opacity: 0.2 });
    var edges = new THREE.LineSegments(new THREE.EdgesGeometry(base.geometry), edgeMat);
    group.add(edges);
    var topMat = std(C.plinthTop, 0.72, { emissive: new THREE.Color(C.emerald), emissiveIntensity: 0 });
    var top = box(PW - 0.36, 0.06, PW - 0.36, topMat, 0, PH / 2, 0);
    top.castShadow = false;
    group.add(top);
    var led = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.08, 0.03), matLed.clone());
    led.position.set(-PW / 2 + 0.85, 0, PW / 2 + 0.016);
    group.add(led);
    group.add(props);

    // invisible hit volume for pointer picking
    var hit = new THREE.Mesh(new THREE.BoxGeometry(PW, 3.2, PW), new THREE.MeshBasicMaterial());
    hit.position.y = 1.2; hit.visible = false;
    hit.userData.platform = name;
    group.add(hit);

    scene.add(group);
    return {
      name: name, group: group, props: props, edgeMat: edgeMat, topMat: topMat, led: led, hit: hit,
      base: new THREE.Vector3(), lift: 0, liftV: 0, hover: 0, flash: 0, phase: Math.random() * Math.PI * 2
    };
  }

  var crm = makePlatform('crm');
  var bot = makePlatform('bot');
  var wa = makePlatform('wa');
  var platforms = [crm, bot, wa];

  /* CRM — Leads table maquette */
  var crmRows = [];
  (function () {
    for (var i = 0; i < 4; i++) {
      var z = -1.35 + i * 0.9;
      var row = box(2.75, 0.16, 0.6, matMaquette, 0.42, TOP + 0.08, z);
      var av = box(0.46, 0.34, 0.46, i === 1 ? matEmerald : matMaquetteDim, -1.42, TOP + 0.17, z);
      var cell = box(0.62, 0.08, 0.34, matSlate, 1.12, TOP + 0.2, z);
      crm.props.add(row, av, cell);
      crmRows.push(row);
    }
    // header bar
    crm.props.add(box(3.55, 0.05, 0.16, matSlate, 0.02, TOP + 0.03, -1.88));
  })();

  /* Bot — visual node graph maquette */
  var botNodes = [];
  (function () {
    var N = [
      { x: -1.35, z: -1.35, m: matMaquette },         // trigger
      { x: -1.35, z: 0.15, m: matMaquette },          // smart question
      { x: 0.2, z: 0.15, m: matEmerald, diamond: true }, // if / else
      { x: 1.4, z: -1.0, m: matMaquette },            // branch A: CRM sync
      { x: 1.4, z: 1.3, m: matMaquette }              // branch B: question
    ];
    N.forEach(function (n) {
      var s = n.diamond ? 0.66 : 0.6;
      var mesh = box(s, s, s, n.m, n.x, TOP + s / 2, n.z);
      if (n.diamond) mesh.rotation.y = Math.PI / 4;
      bot.props.add(mesh);
      botNodes.push(mesh);
    });
    var wire = new THREE.LineBasicMaterial({ color: C.emeraldBright, transparent: true, opacity: 0.85 });
    var y = TOP + 0.02;
    var segs = [
      [-1.35, -1.35, -1.35, 0.15],
      [-1.35, 0.15, 0.2, 0.15],
      [0.2, 0.15, 0.9, 0.15], [0.9, 0.15, 0.9, -1.0], [0.9, -1.0, 1.4, -1.0],
      [0.9, 0.15, 0.9, 1.3], [0.9, 1.3, 1.4, 1.3]
    ];
    var pts = [];
    segs.forEach(function (s) { pts.push(s[0], y, s[1], s[2], y, s[3]); });
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    bot.props.add(new THREE.LineSegments(g, wire));
  })();

  /* WhatsApp Cloud API — stacked service discs + broadcast rings */
  var waRings = [];
  (function () {
    var discGeo = new THREE.CylinderGeometry(1.2, 1.2, 0.36, 56);
    for (var i = 0; i < 3; i++) {
      var d = new THREE.Mesh(discGeo, i === 2 ? matEmerald : matMaquette);
      d.position.set(0, TOP + 0.18 + i * 0.46, 0);
      d.castShadow = true; d.receiveShadow = true;
      wa.props.add(d);
      var rimLine = new THREE.Mesh(new THREE.TorusGeometry(1.2, 0.018, 6, 72), new THREE.MeshBasicMaterial({ color: i === 2 ? C.emeraldBright : 0x9aa6b6 }));
      rimLine.rotation.x = Math.PI / 2;
      rimLine.position.set(0, TOP + 0.36 + i * 0.46, 0);
      wa.props.add(rimLine);
    }
    for (var r = 0; r < 2; r++) {
      var ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.8 + r * 0.45, 0.035, 10, 72),
        new THREE.MeshBasicMaterial({ color: C.emeraldBright, transparent: true, opacity: 0.7 - r * 0.3 })
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.y = TOP + 2.05 + r * 0.35;
      wa.props.add(ring);
      waRings.push(ring);
    }
  })();

  /* ---------- Layout (rising diagonal toward the camera's right) ---------- */
  var GAP = 6.7;
  crm.base.set(0, -0.75, GAP);
  bot.base.set(0, 0.25, 0);
  wa.base.set(0, 1.25, -GAP);
  platforms.forEach(function (p) { p.group.position.copy(p.base); });

  /* ---------- Connections + pulses ---------- */
  var tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), tmpC = new THREE.Vector3();
  function makeLink() {
    var curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3());
    var count = 48;
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(count * 3), 3));
    var line = new THREE.Line(geo, new THREE.LineDashedMaterial({ color: C.alabaster, transparent: true, opacity: 0.42, dashSize: 0.22, gapSize: 0.18 }));
    scene.add(line);
    return { curve: curve, line: line, count: count };
  }
  var links = [makeLink(), makeLink()]; // 0: CRM<->Bot, 1: Bot<->WA

  function updateLink(link, from, to) {
    tmpA.copy(from.group.position); tmpA.y += TOP + 0.05; tmpA.z -= PW / 2 - 0.25;
    tmpB.copy(to.group.position); tmpB.y += TOP + 0.05; tmpB.z += PW / 2 - 0.25;
    tmpC.addVectors(tmpA, tmpB).multiplyScalar(0.5); tmpC.y += 2.1;
    link.curve.v0.copy(tmpA); link.curve.v1.copy(tmpC); link.curve.v2.copy(tmpB);
    var pos = link.line.geometry.attributes.position;
    for (var i = 0; i < link.count; i++) {
      var p = link.curve.getPoint(i / (link.count - 1));
      pos.setXYZ(i, p.x, p.y, p.z);
    }
    pos.needsUpdate = true;
    link.line.computeLineDistances();
  }

  var haloTex = (function () {
    var c = document.createElement('canvas'); c.width = c.height = 64;
    var g = c.getContext('2d');
    var grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.25, 'rgba(255,255,255,0.55)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
    var t = new THREE.CanvasTexture(c);
    return t;
  })();

  var ROUTES = {
    inbound:  { segs: [[1, -1], [0, -1]], color: C.emeraldBright, start: 'wa',  logs: ['WhatsApp Cloud API · inbound message', 'Bot Studio · Smart Question validated', 'Zoho CRM · Lead fields synced'] },
    reply:    { segs: [[0, 1], [1, 1]],   color: C.alabaster,     start: 'crm', logs: ['Team Inbox · agent replied in Zoho CRM', 'Bot Studio · bot paused for 24h', 'WhatsApp Cloud API · reply sent'] },
    broadcast:{ segs: [[0, 1], [1, 1]],   color: C.alabaster,     start: 'crm', logs: ['Campaigns · template broadcast queued', 'Bot Studio · audience resolved', 'WhatsApp Cloud API · template sent'] },
    spend:    { segs: [[1, -1], [0, -1]], color: C.emeraldBright, start: 'wa',  logs: ['Meta pricing_analytics · spend update', 'Vanto Connect · category totals', 'Zoho CRM · Meta spend view refreshed'] }
  };
  var routeOrder = ['inbound', 'reply', 'inbound', 'spend', 'broadcast'];
  var routeIdx = 0;

  var pulses = [];
  function makePulse() {
    var mesh = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 12), new THREE.MeshBasicMaterial({ color: C.emeraldBright }));
    var halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex, color: C.emeraldBright, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending }));
    halo.scale.set(1.1, 1.1, 1);
    mesh.add(halo);
    mesh.visible = false;
    scene.add(mesh);
    return { mesh: mesh, halo: halo, active: false, route: null, seg: 0, t: 0, speed: 0.42 };
  }
  for (var pi = 0; pi < 4; pi++) pulses.push(makePulse());

  var byName = { crm: crm, bot: bot, wa: wa };
  function segTarget(seg) {
    // link 0 = crm<->bot, link 1 = bot<->wa ; dir 1 = forward (crm->bot / bot->wa), -1 = backward
    var link = seg[0], dir = seg[1];
    if (link === 0) return dir === 1 ? bot : crm;
    return dir === 1 ? wa : bot;
  }

  function launch(name) {
    var p = null;
    for (var i = 0; i < pulses.length; i++) if (!pulses[i].active) { p = pulses[i]; break; }
    if (!p) return;
    var route = ROUTES[name];
    p.active = true; p.route = route; p.seg = 0; p.t = 0;
    p.speed = 0.38 + Math.random() * 0.12;
    p.mesh.material.color.setHex(route.color);
    p.halo.material.color.setHex(route.color);
    p.mesh.visible = true;
    byName[route.start].flash = 1;
    log(route.logs[0]);
  }

  /* ---------- Event log ---------- */
  var logItems = [];
  function log(text) {
    if (!logEl) return;
    var li = document.createElement('li');
    li.textContent = text;
    logEl.insertBefore(li, logEl.firstChild); // newest first
    logItems.unshift(li);
    while (logItems.length > 3) { var old = logItems.pop(); if (old.parentNode) old.parentNode.removeChild(old); }
  }

  /* ---------- Labels ---------- */
  var labelEls = {};
  stage.querySelectorAll('[data-anchor]').forEach(function (el) { labelEls[el.getAttribute('data-anchor')] = el; });
  var anchorLocal = {
    crm: new THREE.Vector3(PW / 2, -PH / 2, PW / 2),            // front (lowest on screen) corner
    bot: new THREE.Vector3(-PW / 2, TOP, PW / 2),               // left corner
    wa:  new THREE.Vector3(0, TOP + 2.6, 0)                     // above the broadcast rings
  };
  var projV = new THREE.Vector3();
  var labelW = {}, labelH = {};
  function measureLabels() {
    Object.keys(labelEls).forEach(function (n) {
      var card = labelEls[n].querySelector('.stage-label-card');
      labelW[n] = card ? card.offsetWidth : 0;
      labelH[n] = card ? card.offsetHeight : 0;
    });
  }
  function placeLabels(w, h) {
    platforms.forEach(function (p) {
      var el = labelEls[p.name];
      if (!el) return;
      projV.copy(anchorLocal[p.name]).add(p.group.position).project(camera);
      var x = (projV.x + 1) / 2 * w;
      var y = (1 - projV.y) / 2 * h;
      // keep every label card fully inside the stage
      var cw = labelW[p.name] || 0, ch = labelH[p.name] || 0, m = 6, align = el.getAttribute('data-align');
      if (align === 'above' || align === 'below') x = Math.min(Math.max(x, cw / 2 + m), w - cw / 2 - m);
      else if (align === 'left') x = Math.max(x, cw + 16 + m);
      else if (align === 'right') x = Math.min(x, w - cw - 16 - m);
      if (align === 'above') y = Math.max(y, ch + 14 + m);
      else if (align === 'below') y = Math.min(y, h - ch - 14 - m);
      else y = Math.min(Math.max(y, ch / 2 + m), h - ch / 2 - m);
      el.style.transform = 'translate3d(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px,0)';
    });
  }
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(measureLabels);

  /* ---------- Camera rig with spring physics ---------- */
  var BASE_AZ = Math.PI / 4;
  var BASE_EL = Math.atan(1 / Math.SQRT2); // true isometric elevation
  var rig = { az: BASE_AZ, el: BASE_EL, vaz: 0, vel: 0, taz: BASE_AZ, tel: BASE_EL };
  var R = 60;
  function placeCamera() {
    var ce = Math.cos(rig.el);
    camera.position.set(
      lookTarget.x + R * ce * Math.sin(rig.az),
      lookTarget.y + R * Math.sin(rig.el),
      lookTarget.z + R * ce * Math.cos(rig.az)
    );
    camera.lookAt(lookTarget);
  }

  var viewW = 0, viewH = 0;
  function resize() {
    var w = view.clientWidth, h = view.clientHeight;
    if (!w || !h) return;
    viewW = w; viewH = h;
    renderer.setSize(w, h, false);
    var aspect = w / h;
    // world units that must fit; the extra height leaves breathing room above/below the composition
    var needW = isSmall() ? 18.4 : 17.8;
    var needH = isSmall() ? 15.8 : 16.2;
    var worldH = Math.max(needH, needW / aspect);
    camera.left = -worldH * aspect / 2; camera.right = worldH * aspect / 2;
    camera.top = worldH / 2; camera.bottom = -worldH / 2;
    camera.updateProjectionMatrix();
    renderer.shadowMap.enabled = !isSmall();
    measureLabels();
    if (reduceMotion) renderOnce();
  }

  /* ---------- Pointer: parallax + hover/press ---------- */
  var pointer = new THREE.Vector2(-10, -10);
  var raycaster = new THREE.Raycaster();
  var hovered = null;
  var hits = platforms.map(function (p) { return p.hit; });

  function setHover(name) {
    if (hovered === name) return;
    hovered = name;
    platforms.forEach(function (p) {
      var on = p.name === name;
      p.hover = on ? 1 : 0;
      if (labelEls[p.name]) labelEls[p.name].classList.toggle('is-hot', on);
    });
    canvas.style.cursor = name ? 'pointer' : '';
  }

  window.addEventListener('pointermove', function (e) {
    var r = view.getBoundingClientRect();
    var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    var nx = Math.max(-1, Math.min(1, (e.clientX - cx) / (window.innerWidth / 2)));
    var ny = Math.max(-1, Math.min(1, (e.clientY - cy) / (window.innerHeight / 2)));
    rig.taz = BASE_AZ + nx * 0.2;
    rig.tel = BASE_EL - ny * 0.07;
    if (e.pointerType === 'mouse') {
      pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    }
  }, { passive: true });
  canvas.addEventListener('pointerleave', function () { pointer.set(-10, -10); setHover(null); });

  canvas.addEventListener('click', function () {
    if (!hovered) return;
    var el = labelEls[hovered];
    if (el) el.click();
  });
  Object.keys(labelEls).forEach(function (name) {
    var el = labelEls[name];
    el.addEventListener('pointerenter', function () { setHover(name); });
    el.addEventListener('pointerleave', function () { setHover(null); });
    el.addEventListener('focus', function () { setHover(name); });
    el.addEventListener('blur', function () { setHover(null); });
  });

  /* ---------- Animation ---------- */
  var clock = new THREE.Clock();
  var time = 0, nextLaunch = 0.6;
  var running = false, visible = true, rafId = 0;

  function step(dt) {
    time += dt;

    // camera spring (critically-damped-ish, slight overshoot for tactility)
    var k = 26, d = 7.5;
    rig.vaz += ((rig.taz - rig.az) * k - rig.vaz * d) * dt;
    rig.vel += ((rig.tel - rig.el) * k - rig.vel * d) * dt;
    rig.az += rig.vaz * dt; rig.el += rig.vel * dt;
    placeCamera();

    // platforms: float + hover lift spring + flash decay
    platforms.forEach(function (p, i) {
      var bob = Math.sin(time * 0.9 + p.phase) * 0.12;
      var target = p.hover ? 0.42 : 0;
      p.liftV += ((target - p.lift) * 90 - p.liftV * 12) * dt;
      p.lift += p.liftV * dt;
      p.group.position.set(p.base.x, p.base.y + bob + p.lift, p.base.z);
      p.flash = Math.max(0, p.flash - dt * 1.4);
      p.topMat.emissiveIntensity = p.flash * 0.55 + p.hover * 0.12;
      p.edgeMat.opacity = 0.2 + p.hover * 0.35 + p.flash * 0.3;
      p.edgeMat.color.setHex(p.hover || p.flash > 0.2 ? C.emeraldBright : C.edge);
      p.led.material.color.setHex((Math.sin(time * 3 + i) > 0.6 || p.flash > 0.3) ? C.emeraldBright : C.emerald);
    });

    waRings.forEach(function (r, i) {
      r.rotation.z += dt * (0.5 + i * 0.3);
      var s = 1 + Math.sin(time * 2 + i) * 0.04;
      r.scale.set(s, s, s);
    });
    botNodes.forEach(function (n, i) {
      n.position.y = TOP + 0.3 + Math.max(0, Math.sin(time * 2.2 - i * 0.7)) * 0.08 * (bot.flash + 0.25);
    });

    updateLink(links[0], crm, bot);
    updateLink(links[1], bot, wa);

    // pulses
    nextLaunch -= dt;
    if (nextLaunch <= 0) {
      launch(routeOrder[routeIdx % routeOrder.length]);
      routeIdx++;
      nextLaunch = 1.6 + Math.random() * 0.9;
    }
    pulses.forEach(function (p) {
      if (!p.active) return;
      p.t += dt * p.speed;
      var seg = p.route.segs[p.seg];
      if (p.t >= 1) {
        var arrived = segTarget(seg);
        arrived.flash = 1;
        log(p.route.logs[p.seg + 1]);
        p.seg++; p.t = 0;
        if (p.seg >= p.route.segs.length) { p.active = false; p.mesh.visible = false; return; }
        seg = p.route.segs[p.seg];
      }
      var u = seg[1] === 1 ? p.t : 1 - p.t;
      p.mesh.position.copy(links[seg[0]].curve.getPoint(u));
      var s = 0.9 + Math.sin(time * 10) * 0.08;
      p.halo.scale.set(1.1 * s, 1.1 * s, 1);
    });

    // hover picking (mouse only)
    if (pointer.x > -2) {
      raycaster.setFromCamera(pointer, camera);
      var hit = raycaster.intersectObjects(hits, false)[0];
      setHover(hit ? hit.object.userData.platform : null);
    }

    renderer.render(scene, camera);
    placeLabels(viewW, viewH);
  }

  function loop() {
    rafId = 0;
    if (!running) return;
    var dt = Math.min(clock.getDelta(), 0.05);
    step(dt);
    rafId = requestAnimationFrame(loop);
  }
  function start() {
    if (running || reduceMotion) return;
    running = true; clock.getDelta();
    rafId = requestAnimationFrame(loop);
  }
  function stop() { running = false; if (rafId) cancelAnimationFrame(rafId); rafId = 0; }

  function renderOnce() {
    // static composition for reduced motion: settle everything, show one pulse per link
    platforms.forEach(function (p) { p.group.position.copy(p.base); });
    placeCamera();
    updateLink(links[0], crm, bot);
    updateLink(links[1], bot, wa);
    pulses[0].mesh.visible = true; pulses[0].mesh.position.copy(links[0].curve.getPoint(0.55));
    pulses[1].mesh.visible = true; pulses[1].mesh.position.copy(links[1].curve.getPoint(0.45));
    pulses[1].mesh.material.color.setHex(C.alabaster); pulses[1].halo.material.color.setHex(C.alabaster);
    renderer.render(scene, camera);
    placeLabels(viewW, viewH);
  }

  canvas.addEventListener('webglcontextlost', function (e) { e.preventDefault(); stop(); fallback(); }, false);

  if ('ResizeObserver' in window) new ResizeObserver(resize).observe(view);
  else window.addEventListener('resize', resize);
  resize();

  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) {
      visible = entries[0].isIntersecting;
      if (visible && !document.hidden) start(); else stop();
    }, { threshold: 0.01 }).observe(stage);
  }
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) stop(); else if (visible) start();
  });

  placeCamera();
  if (reduceMotion) {
    log('WhatsApp Cloud API · inbound message');
    log('Bot Studio · Smart Question validated');
    log('Zoho CRM · Lead fields synced');
    renderOnce();
  } else {
    step(0.016);
    start();
  }
  stage.classList.add('is-live');
})();
