/**
 * 科技树 · three.js 场景（螺旋升腾能量树）
 * ------------------------------------------------------------
 * 部署形态：Hexo 博客首页 Hero 区块（由 scripts/tech-tree-inject.js 注入脚本）
 * 依赖：本地 three.min.js（r128 UMD，全局 THREE），无其他外部请求
 * 视觉结构：
 *   1. 中央能量核心（发光核 + 旋转线框 + 呼吸辉光）
 *   2. 金蓝双螺旋光带从核心盘旋升腾，粒子沿光带持续上升
 *   3. 全息底座光环 + 粒子环，技术栈节点沿核心水平环分布
 *   4. 深邃银河星尘，雾效纵深，鼠标悬浮节点标签、指针视差
 *   5. WebGL 不可用 / 移动端降配 / reduced-motion / 后台暂停
 */

(function () {
  'use strict';

  // ===================== 树数据（可改） =====================
  var DATA = {
    root: '前端工程',
    branches: [
      { name: '框架生态', color: 0x66ccff, children: ['Vue', 'React', '状态管理'] },
      { name: '工程化',   color: 0x7f9bff, children: ['Vite', 'Webpack', 'CI / CD'] },
      { name: 'AI 智能体', color: 0xb07fff, children: ['Agent', 'RAG', '多模态'] },
      { name: '全栈后端', color: 0x4fd6c0, children: ['Node.js', 'API', '数据库'] },
      { name: '可视化',   color: 0xffc866, children: ['Three.js', 'Canvas', '动效'] }
    ]
  };

  // ===================== 前置兜底 =====================
  if (typeof THREE === 'undefined') return;

  var reducedMotion = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var isMobile = window.matchMedia &&
    window.matchMedia('(max-width: 768px)').matches;

  // 容器：优先插到 <main> 之前（Fluid 结构），兼容老主题
  var stage = document.getElementById('tech-tree');
  if (!stage) {
    stage = document.createElement('section');
    stage.id = 'tech-tree';
    var mainEl = document.querySelector('main');
    if (mainEl) {
      mainEl.parentNode.insertBefore(stage, mainEl);
    } else {
      var oldHeader = document.getElementById('header');
      if (oldHeader && oldHeader.parentNode) {
        oldHeader.parentNode.insertBefore(stage, oldHeader.nextSibling);
      } else {
        document.body.insertBefore(stage, document.body.firstChild);
      }
    }
  }

  var renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance'
    });
  } catch (err) {
    return;
  }

  var stageW = stage.clientWidth || 1000;
  var stageH = stage.clientHeight || 700;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(stageW, stageH);
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  stage.appendChild(renderer.domElement);

  // 首屏标题层（DOM API，不写 HTML 字符串，避免被 Hexo 渲染器误解析）
  var brandEl = document.querySelector('.navbar-brand strong');
  var sloganEl = document.getElementById('subtitle');
  var heroTitle = brandEl ? brandEl.textContent.trim() : 'fenglongtian-Blog';
  var heroSlogan = sloganEl ? sloganEl.getAttribute('data-typed-text') : '前端工程师 · 持续构建中的个人小站';
  var hero = document.createElement('div');
  hero.className = 'tt-hero';
  var heroH1 = document.createElement('h1');
  heroH1.textContent = heroTitle;
  var heroP = document.createElement('p');
  heroP.textContent = heroSlogan;
  hero.appendChild(heroH1);
  hero.appendChild(heroP);
  stage.appendChild(hero);

  var scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x050a16, 0.014);
  var camera = new THREE.PerspectiveCamera(55, stageW / stageH, 0.1, 140);
  var baseCamZ = isMobile ? 20 : 17.5;
  var lookY = -0.5;
  camera.position.set(0, 1.5, baseCamZ);
  camera.lookAt(0, lookY, 0);

  var world = new THREE.Group();
  scene.add(world);

  // ===================== 光晕贴图 =====================
  var glowTex = (function () {
    var c = document.createElement('canvas');
    c.width = c.height = 128;
    var ctx = c.getContext('2d');
    var g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.3, 'rgba(255,255,255,0.45)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  })();

  // ===================== 关键坐标 =====================
  var CORE_Y = -3;
  var R1 = 3.2, R2 = 5.6;
  var N = DATA.branches.length;
  var nodes = [];
  var pickables = [];

  // ===================== 能量核心 =====================
  var core = new THREE.Mesh(
    new THREE.SphereGeometry(0.55, 28, 28),
    new THREE.MeshBasicMaterial({ color: 0xffe6b0 })
  );
  core.position.set(0, CORE_Y, 0);
  core.userData.name = DATA.root;
  world.add(core);
  pickables.push(core);

  var coreGlow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex, color: 0xffd98a, transparent: true, opacity: 0.6,
    blending: THREE.AdditiveBlending, depthWrite: false
  }));
  coreGlow.scale.set(10, 10, 1);
  coreGlow.position.set(0, CORE_Y, 0);
  world.add(coreGlow);

  // 核心旋转线框（包裹能量核）
  var coreFrame = new THREE.Mesh(
    new THREE.OctahedronGeometry(1.15, 0),
    new THREE.MeshBasicMaterial({ color: 0xffd98a, wireframe: true, transparent: true, opacity: 0.55 })
  );
  coreFrame.position.set(0, CORE_Y, 0);
  world.add(coreFrame);

  // 向上的垂直光柱
  var beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.12, 6, 16, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0xffd98a, transparent: true, opacity: 0.22,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
    })
  );
  beam.position.set(0, CORE_Y + 3, 0);
  world.add(beam);

  // ===================== 节点工具 =====================
  function makeNode(name, pos, color, baseScale, pickable) {
    var mesh = new THREE.Mesh(
      new THREE.SphereGeometry(baseScale, 20, 20),
      new THREE.MeshBasicMaterial({ color: color })
    );
    mesh.position.copy(pos);
    mesh.userData.name = name;

    var sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex, color: color, transparent: true, opacity: 0.5,
      blending: THREE.AdditiveBlending, depthWrite: false
    }));
    var gs = baseScale * 3.6;
    sprite.scale.set(gs, gs, 1);
    mesh.add(sprite);
    world.add(mesh);

    nodes.push({ mesh: mesh, sprite: sprite, baseScale: baseScale,
      phase: Math.random() * Math.PI * 2 });
    if (pickable !== false) pickables.push(mesh);
    return mesh;
  }

  function link(a, b, color, opacity) {
    var mid = a.clone().lerp(b, 0.5);
    mid.y += 0.35;
    var curve = new THREE.QuadraticBezierCurve3(a.clone(), mid, b.clone());
    var geo = new THREE.BufferGeometry().setFromPoints(curve.getPoints(20));
    var line = new THREE.Line(geo, new THREE.LineBasicMaterial({
      color: color, transparent: true, opacity: opacity
    }));
    world.add(line);
  }

  // 技术节点：沿核心水平环
  DATA.branches.forEach(function (b, i) {
    var ang = -Math.PI / 2 + i * (2 * Math.PI / N);
    var bPos = new THREE.Vector3(Math.cos(ang) * R1, CORE_Y, Math.sin(ang) * R1);
    makeNode(b.name, bPos, b.color, 0.26, true);
    link(new THREE.Vector3(0, CORE_Y, 0), bPos, b.color, 0.3);

    b.children.forEach(function (cn, j) {
      var la = ang + (j - (b.children.length - 1) / 2) * 0.4;
      var lPos = new THREE.Vector3(
        Math.cos(la) * R2, CORE_Y + (j - 1) * 0.5, Math.sin(la) * R2
      );
      var lc = new THREE.Color(b.color).lerp(new THREE.Color(0xffffff), 0.35);
      makeNode(cn, lPos, lc.getHex(), 0.16, true);
      link(bPos, lPos, b.color, 0.2);
    });
  });

  // ===================== 螺旋升腾光带 =====================
  function makeHelix(cfg) {
    function pointAt(u) {
      var a = cfg.phase + u * cfg.turns * Math.PI * 2;
      var r = cfg.r0 + (cfg.r1 - cfg.r0) * u;
      return new THREE.Vector3(
        Math.cos(a) * r,
        cfg.y0 + (cfg.y1 - cfg.y0) * u,
        Math.sin(a) * r
      );
    }
    var pts = [];
    for (var i = 0; i <= 120; i++) pts.push(pointAt(i / 120));
    var line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({
        color: cfg.color, transparent: true, opacity: 0.7,
        blending: THREE.AdditiveBlending, depthWrite: false
      })
    );
    world.add(line);

    // 沿螺旋上升的粒子
    var flow = [];
    var pCount = isMobile ? 10 : 24;
    for (var k = 0; k < pCount; k++) {
      var s = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTex, color: cfg.color, transparent: true, opacity: 0.9,
        blending: THREE.AdditiveBlending, depthWrite: false
      }));
      var size = 0.75 + Math.random() * 0.4;
      s.scale.set(size, size, 1);
      world.add(s);
      flow.push({ sprite: s, u: k / pCount, speed: 0.12 + Math.random() * 0.08 });
    }
    return { pointAt: pointAt, flow: flow };
  }

  var helices = [
    makeHelix({ color: 0xffd98a, phase: 0, turns: 2.5, r0: 2.6, r1: 1.0, y0: CORE_Y, y1: 8.5 }),
    makeHelix({ color: 0x66ccff, phase: Math.PI, turns: 2.5, r0: 2.2, r1: 0.8, y0: CORE_Y, y1: 8.5 })
  ];

  // ===================== 全息底座光环 =====================
  var baseRing = new THREE.Mesh(
    new THREE.RingGeometry(5.6, 6.0, 80),
    new THREE.MeshBasicMaterial({
      color: 0x4fd6c0, transparent: true, opacity: 0.55,
      side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false
    })
  );
  baseRing.rotation.x = -Math.PI / 2;
  baseRing.position.set(0, CORE_Y - 0.7, 0);
  world.add(baseRing);

  // 底座粒子环
  var ringDots;
  (function () {
    var count = isMobile ? 60 : 120;
    var pos = new Float32Array(count * 3);
    for (var i = 0; i < count; i++) {
      var a = (i / count) * Math.PI * 2;
      var r = 4.2 + (i % 2) * 1.6;
      pos[i * 3] = Math.cos(a) * r;
      pos[i * 3 + 1] = CORE_Y - 0.7;
      pos[i * 3 + 2] = Math.sin(a) * r;
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    ringDots = new THREE.Points(geo, new THREE.PointsMaterial({
      map: glowTex, color: 0x66d6e0, size: 0.14, transparent: true, opacity: 0.8,
      blending: THREE.AdditiveBlending, depthWrite: false, alphaTest: 0.01
    }));
    world.add(ringDots);
  })();

  // ===================== 银河星尘 =====================
  var stars;
  (function () {
    var count = isMobile ? 180 : 520;
    var pos = new Float32Array(count * 3);
    for (var i = 0; i < count; i++) {
      var r = 14 + Math.random() * 16;
      var th = Math.random() * Math.PI * 2;
      var ph = Math.acos(2 * Math.random() - 1);
      pos[i * 3] = r * Math.sin(ph) * Math.cos(th);
      pos[i * 3 + 1] = r * Math.sin(ph) * Math.sin(th);
      pos[i * 3 + 2] = r * Math.cos(ph);
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    stars = new THREE.Points(geo, new THREE.PointsMaterial({
      map: glowTex, color: 0x99aacc, size: 0.1, transparent: true, opacity: 0.75,
      blending: THREE.AdditiveBlending, depthWrite: false, alphaTest: 0.01
    }));
    scene.add(stars);
  })();

  // 远景星云（偏上方）
  var nebulas = [];
  (function () {
    var palette = [0x2a3f7a, 0x3a2a6a, 0x1f5a6a, 0x4a3a7a];
    var count = isMobile ? 2 : 4;
    for (var i = 0; i < count; i++) {
      var s = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTex, color: palette[i % palette.length], transparent: true, opacity: 0.16,
        blending: THREE.AdditiveBlending, depthWrite: false
      }));
      var ang = (i / count) * Math.PI * 2;
      var rr = 10 + Math.random() * 5;
      s.position.set(Math.cos(ang) * rr, 2 + Math.sin(ang) * rr * 0.5, -9 - Math.random() * 4);
      var size = 18 + Math.random() * 12;
      s.scale.set(size, size, 1);
      s.userData = { phase: Math.random() * Math.PI * 2, baseY: s.position.y };
      scene.add(s);
      nebulas.push(s);
    }
  })();

  // ===================== 标签 =====================
  var label = document.createElement('div');
  label.className = 'tt-label';
  stage.appendChild(label);
  var hovered = null;

  var raycaster = new THREE.Raycaster();
  var pointer = new THREE.Vector2(-2, -2);
  var camTarget = new THREE.Vector2(0, 0);

  stage.addEventListener('pointermove', function (ev) {
    var rect = stage.getBoundingClientRect();
    var nx = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    var ny = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    pointer.set(nx, ny);
    camTarget.set(nx * 0.9, ny * 0.5);
  });

  stage.addEventListener('pointerleave', function () {
    pointer.set(-2, -2);
    camTarget.set(0, 0);
    hovered = null;
    label.style.opacity = '0';
  });

  function updateHover() {
    raycaster.setFromCamera(pointer, camera);
    var hits = raycaster.intersectObjects(pickables, false);
    var next = hits.length ? hits[0].object : null;
    if (next !== hovered) {
      if (hovered) hovered.material.color.setHex(hovered.userData.color);
      hovered = next;
      if (hovered) {
        hovered.material.color.setHex(0xffffff);
        label.textContent = hovered.userData.name;
        label.style.opacity = '1';
      } else {
        label.style.opacity = '0';
      }
    }
  }

  function placeLabel(nodeMesh) {
    var v = nodeMesh.position.clone();
    v.applyMatrix4(world.matrixWorld);
    v.project(camera);
    label.style.left = ((v.x * 0.5 + 0.5) * stageW) + 'px';
    label.style.top = ((-v.y * 0.5 + 0.5) * stageH) + 'px';
  }

  // 记录原始颜色供 hover 还原
  pickables.forEach(function (m) { m.userData.color = m.material.color.getHex(); });

  // ===================== 动画 =====================
  var start = performance.now();
  var lastTs = performance.now();
  var rafId = 0;
  var running = true;

  function frame(now) {
    rafId = requestAnimationFrame(frame);
    if (!running) return;

    var dt = Math.min((now - lastTs) / 1000, 0.05);
    lastTs = now;
    var t = (now - start) / 1000;

    if (!reducedMotion) {
      coreFrame.rotation.y += dt * 0.8;
      coreFrame.rotation.x += dt * 0.35;
      baseRing.rotation.z += dt * 0.4;
      ringDots.rotation.y += dt * 0.25;
      stars.rotation.y += dt * 0.015;
      nebulas.forEach(function (n) {
        n.position.y = n.userData.baseY + Math.sin(t * 0.1 + n.userData.phase) * 0.4;
      });
    }

    // 核心辉光呼吸
    coreGlow.material.opacity = 0.5 + Math.sin(t * 1.4) * 0.12;
    coreGlow.scale.setScalar(10 + Math.sin(t * 1.4) * 0.6);

    // 节点呼吸
    nodes.forEach(function (n) {
      var sc = n.baseScale * (reducedMotion ? 1 : 1 + Math.sin(t * 1.6 + n.phase) * 0.08);
      n.mesh.scale.setScalar(sc);
    });

    // 螺旋粒子上升
    helices.forEach(function (h) {
      h.flow.forEach(function (f) {
        f.u += dt * f.speed;
        if (f.u > 1) f.u -= 1;
        var p = h.pointAt(f.u);
        f.sprite.position.copy(p);
        f.sprite.material.opacity = Math.sin(f.u * Math.PI) * 0.9;
      });
    });

    // 相机视差 + 缓慢呼吸
    camera.position.x += (camTarget.x - camera.position.x) * 0.05;
    camera.position.y += (1.5 + camTarget.y - camera.position.y) * 0.05;
    camera.position.z += (baseCamZ + Math.sin(t * 0.15) * 0.5 - camera.position.z) * 0.05;
    camera.lookAt(0, lookY, 0);

    updateHover();
    if (hovered) placeLabel(hovered);

    renderer.render(scene, camera);
  }

  renderer.render(scene, camera);
  rafId = requestAnimationFrame(frame);

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) {
      lastTs = performance.now();
      renderer.render(scene, camera);
    }
  });

  window.addEventListener('resize', function () {
    stageW = stage.clientWidth || stageW;
    stageH = stage.clientHeight || stageH;
    camera.aspect = stageW / stageH;
    camera.updateProjectionMatrix();
    renderer.setSize(stageW, stageH);
  });

  if (reducedMotion) {
    running = false;
    cancelAnimationFrame(rafId);
  }
})();
