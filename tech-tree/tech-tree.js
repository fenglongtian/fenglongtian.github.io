/**
 * 科技树 · three.js 场景
 * ------------------------------------------------------------
 * 部署形态：Hexo 博客首页 Hero 区块（由 scripts/tech-tree-inject.js 注入脚本）
 * 依赖：本地 three.min.js（r128 UMD，全局 THREE），无其他外部请求
 * 设计要点：
 *   1. 根节点 + 一级分支 + 叶子，贝塞尔曲线连线，光点沿连线流动
 *   2. 从根节点逐级生长（缩放回弹 + 淡入），整体缓慢自转，指针视差
 *   3. 不引 OrbitControls / 后处理插件，发光用 Sprite 叠加模拟，降低体积
 *   4. WebGL 不可用、THREE 缺失、移动端降配、reduced-motion、后台暂停
 *   5. 首帧同步渲染一帧（后台标签 rAF 会被挂起，避免空白区块）
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

  // 容器：优先插到 <main> 之前（Fluid 结构），兼容老主题 #header 之后
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
    return; // WebGL 不可用：不留空区块
  }

  var stageW = stage.clientWidth || 1000;
  var stageH = stage.clientHeight || 700;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(stageW, stageH);
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  stage.appendChild(renderer.domElement);

  // 首屏标题层：网站名 + slogan（取自 Fluid 导航标题与 banner 副标题，读不到用兜底文案）
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
  scene.fog = new THREE.FogExp2(0x050a16, 0.016);
  var camera = new THREE.PerspectiveCamera(55, stageW / stageH, 0.1, 120);
  var baseCamZ = isMobile ? 21.5 : 20.5;
  camera.position.set(0, 0.4, baseCamZ);

  var treeGroup = new THREE.Group();
  treeGroup.position.y = -0.6; // 整体下移，给顶部标题层让出空间
  scene.add(treeGroup);

  // ===================== 光晕贴图（复用） =====================
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

  // ===================== 布局 =====================
  var R1 = 5.2, R2 = 9.5, R3 = 11.8;
  var N = DATA.branches.length;
  var nodes = [];      // { name, level, pos, color, mesh, sprite, baseScale, delay, phase }
  var edges = [];      // { curve, line, mat, pulses: [{mesh, phase, speed}] }
  var pickables = [];  // 射线拾取列表

  function makeNode(name, level, pos, color, baseScale, delay, pickable) {
    var geo = new THREE.SphereGeometry(baseScale, 24, 24);
    var mat = new THREE.MeshBasicMaterial({ color: color });
    var mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(pos);
    mesh.userData.name = name;

    var sMat = new THREE.SpriteMaterial({
      map: glowTex,
      color: color,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    var sprite = new THREE.Sprite(sMat);
    var glowSize = level === 0 ? baseScale * 7 : level === 1 ? baseScale * 4.5 : baseScale * 3.4;
    sprite.scale.set(glowSize, glowSize, 1);

    mesh.add(sprite);
    treeGroup.add(mesh);

    var node = {
      name: name, level: level, pos: pos, color: color,
      mesh: mesh, sprite: sprite, baseScale: baseScale,
      delay: delay, phase: Math.random() * Math.PI * 2
    };
    nodes.push(node);
    if (pickable !== false) pickables.push(mesh);
    return node;
  }

  // 根节点
  var rootPos = new THREE.Vector3(0, 0, 0);
  var root = makeNode(DATA.root, 0, rootPos, 0xffd98a, 0.5, 0);

  // 根节点中心大辉光（视觉焦点，呼吸明暗）
  var coreGlow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex, color: 0xffd98a, transparent: true, opacity: 0.22,
    blending: THREE.AdditiveBlending, depthWrite: false
  }));
  coreGlow.scale.set(11, 11, 1);
  treeGroup.add(coreGlow);

  // 一级分支 + 叶子
  DATA.branches.forEach(function (b, i) {
    var ang = -Math.PI / 2 + i * (2 * Math.PI / N);
    var bPos = new THREE.Vector3(
      Math.cos(ang) * R1,
      Math.sin(ang) * R1 * 0.62,
      (i % 2 === 0 ? 1.2 : -1.2)
    );
    var branch = makeNode(b.name, 1, bPos, b.color, 0.32, 0.35 + i * 0.08);

    addEdge(root, branch, b.color, 0.28);

    b.children.forEach(function (cn, j) {
      var leafAng = ang + (j - (b.children.length - 1) / 2) * 0.42;
      var lPos = new THREE.Vector3(
        Math.cos(leafAng) * R2,
        Math.sin(leafAng) * R2 * 0.62,
        bPos.z + (j - 1) * 0.9
      );
      var leafColor = new THREE.Color(b.color).lerp(new THREE.Color(0xffffff), 0.35);
      var leaf = makeNode(cn, 2, lPos, leafColor.getHex(), 0.19, 0.7 + i * 0.08 + j * 0.07);
      addEdge(branch, leaf, b.color, 0.18);

      // 三级远景微光点（仅桌面），让树冠更繁茂，不可拾取、无标签
      if (!isMobile) {
        var gPos = new THREE.Vector3(
          Math.cos(leafAng) * R3,
          Math.sin(leafAng) * R3 * 0.62,
          lPos.z + (j - 1) * 0.6
        );
        var ghost = makeNode('', 3, gPos, leafColor.getHex(), 0.08, 0.95 + i * 0.08 + j * 0.07, false);
        addEdge(leaf, ghost, b.color, 0.08);
      }
    });
  });

  function addEdge(a, b, color, opacity) {
    var mid = a.pos.clone().lerp(b.pos, 0.5);
    mid.z += 0.6;
    var curve = new THREE.QuadraticBezierCurve3(a.pos.clone(), mid, b.pos.clone());

    var geo = new THREE.BufferGeometry().setFromPoints(curve.getPoints(24));
    var mat = new THREE.LineBasicMaterial({
      color: color, transparent: true, opacity: opacity
    });
    var line = new THREE.Line(geo, mat);
    treeGroup.add(line);

    var pulses = [];
    var pulseCount = isMobile ? 1 : 2;
    for (var k = 0; k < pulseCount; k++) {
      var pGeo = new THREE.SphereGeometry(0.09, 12, 12);
      var pMat = new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0.9,
        blending: THREE.AdditiveBlending, depthWrite: false
      });
      var pMesh = new THREE.Mesh(pGeo, pMat);
      treeGroup.add(pMesh);
      pulses.push({ mesh: pMesh, phase: k / pulseCount, speed: 0.18 + Math.random() * 0.08 });
    }

    edges.push({ curve: curve, line: line, mat: mat, pulses: pulses });
  }

  // ===================== 背景星尘 =====================
  var stars;
  (function () {
    var count = isMobile ? 160 : 480;
    var pos = new Float32Array(count * 3);
    for (var i = 0; i < count; i++) {
      var r = 14 + Math.random() * 12;
      var th = Math.random() * Math.PI * 2;
      var ph = Math.acos(2 * Math.random() - 1);
      pos[i * 3] = r * Math.sin(ph) * Math.cos(th);
      pos[i * 3 + 1] = r * Math.sin(ph) * Math.sin(th);
      pos[i * 3 + 2] = r * Math.cos(ph);
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    var mat = new THREE.PointsMaterial({
      map: glowTex, color: 0x8899bb, size: 0.1, transparent: true, opacity: 0.7,
      sizeAttenuation: true, depthWrite: false, blending: THREE.AdditiveBlending, alphaTest: 0.01
    });
    stars = new THREE.Points(geo, mat);
    scene.add(stars);
  })();

  // ===================== 远景星云 =====================
  var nebulas = [];
  (function () {
    var palette = [0x2a3f7a, 0x3a2a6a, 0x1f5a6a, 0x4a3a7a];
    var count = isMobile ? 2 : 4;
    for (var i = 0; i < count; i++) {
      var m = new THREE.SpriteMaterial({
        map: glowTex, color: palette[i % palette.length],
        transparent: true, opacity: 0.16,
        blending: THREE.AdditiveBlending, depthWrite: false
      });
      var s = new THREE.Sprite(m);
      var ang = (i / count) * Math.PI * 2;
      var rr = 9 + Math.random() * 4;
      s.position.set(Math.cos(ang) * rr, Math.sin(ang) * rr * 0.7, -8 - Math.random() * 4);
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

  // ===================== 交互：射线 + 视差 =====================
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
    v.applyMatrix4(treeGroup.matrixWorld);
    v.project(camera);
    var x = (v.x * 0.5 + 0.5) * stageW;
    var y = (-v.y * 0.5 + 0.5) * stageH;
    label.style.left = x + 'px';
    label.style.top = y + 'px';
  }

  // 记录原始颜色，供 hover 还原
  nodes.forEach(function (n) { n.mesh.userData.color = n.color; });

  // ===================== 动画 =====================
  var start = performance.now();
  var lastTs = performance.now();
  var rafId = 0;
  var running = true;

  function easeOutBack(t) {
    var c = 1.70158;
    return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
  }
  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

  function frame(now) {
    rafId = requestAnimationFrame(frame);
    if (!running) return;

    var dt = Math.min((now - lastTs) / 1000, 0.05);
    lastTs = now;
    var t = (now - start) / 1000;

    // 整体自转 + 视差 + 星云缓漂
    if (!reducedMotion) {
      treeGroup.rotation.y += dt * 0.08;
      stars.rotation.y += dt * 0.015;
      nebulas.forEach(function (n) {
        n.position.y = n.userData.baseY + Math.sin(t * 0.1 + n.userData.phase) * 0.4;
      });
    }
    camera.position.x += (camTarget.x - camera.position.x) * 0.05;
    camera.position.y += (0.4 + camTarget.y - camera.position.y) * 0.05;
    camera.position.z += (baseCamZ + Math.sin(t * 0.15) * 0.6 - camera.position.z) * 0.05;
    camera.lookAt(0, 0, 0);

    // 节点生长 + 呼吸
    nodes.forEach(function (n) {
      var p = clamp01((t - n.delay) / 0.5);
      var scale = n.baseScale * Math.max(0.001, easeOutBack(p));
      if (!reducedMotion) scale *= 1 + Math.sin(t * 1.6 + n.phase) * 0.06;
      n.mesh.scale.setScalar(scale);
      var glowOpacity = 0.25 + 0.3 * p;
      n.sprite.material.opacity = glowOpacity;
    });

    // 根节点中心辉光呼吸
    if (!reducedMotion) {
      coreGlow.material.opacity = 0.18 + 0.06 * Math.sin(t * 1.2);
      coreGlow.scale.setScalar(11 + Math.sin(t * 1.2) * 0.6);
    }

    // 连线淡入 + 脉冲光点
    edges.forEach(function (e, ei) {
      e.mat.opacity = 0.12 + 0.25 * clamp01((t - 0.4) / 0.8);
      e.pulses.forEach(function (pu, k) {
        var u = (t * pu.speed + pu.phase) % 1;
        var pt = e.curve.getPoint(u);
        pu.mesh.position.copy(pt);
        pu.mesh.material.opacity = Math.sin(u * Math.PI) * 0.9;
      });
    });

    updateHover();
    if (hovered) placeLabel(hovered);

    renderer.render(scene, camera);
  }

  // 首帧同步渲染一帧（后台标签 rAF 可能被挂起，避免区块空白）
  renderer.render(scene, camera);
  rafId = requestAnimationFrame(frame);

  // 页面切回前台时补帧
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) {
      lastTs = performance.now();
      renderer.render(scene, camera);
    }
  });

  // 尺寸自适应
  window.addEventListener('resize', function () {
    stageW = stage.clientWidth || stageW;
    stageH = stage.clientHeight || stageH;
    camera.aspect = stageW / stageH;
    camera.updateProjectionMatrix();
    renderer.setSize(stageW, stageH);
  });

  // reduced-motion：首帧后停在静态帧
  if (reducedMotion) {
    running = false;
    cancelAnimationFrame(rafId);
  }
})();
