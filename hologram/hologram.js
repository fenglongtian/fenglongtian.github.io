/**
 * 全息守护者 · three.js 场景（首页固定悬浮）
 * ------------------------------------------------------------
 * 部署形态：Hexo 首页右下角固定层（由 scripts/hologram-inject.js 注入）
 * 依赖：本地 three.min.js（r128 UMD，全局 THREE），无任何外部请求
 * 现状：用程序化几何体拼一个风格化人形 + 全息 shader，先把
 *       「入场凝聚 → 扫描渐显 → 待机浮动」整套跑通；
 *       后续可直接替换为 Ready Player Me / Mixamo 的 glb 模型，
 *       全息材质与入场时间轴保持不变。
 * 降级：WebGL 不可用 / reduced-motion 直接给最终态；移动端缩小。
 */
(function () {
  'use strict';

  if (typeof THREE === 'undefined') return;

  var reducedMotion = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var isMobile = window.matchMedia &&
    window.matchMedia('(max-width: 768px)').matches;

  // 仅首页运行（注入器已限制，这里再兜底）
  var path = window.location.pathname.replace(/index\.html$/, '');
  if (path !== '/' && path !== '') return;

  // ===================== 容器 =====================
  var host = document.createElement('div');
  host.id = 'hologram';
  host.className = isMobile ? 'is-mobile' : '';
  host.setAttribute('aria-hidden', 'true');
  document.body.appendChild(host);

  var renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance'
    });
  } catch (err) {
    host.remove();
    return;
  }

  var W = host.clientWidth || 240;
  var H = host.clientHeight || 360;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(W, H);
  renderer.domElement.style.display = 'block';
  host.appendChild(renderer.domElement);

  var scene = new THREE.Scene();
  var camera = new THREE.PerspectiveCamera(40, W / H, 0.1, 100);
  camera.position.set(0, 1.35, 6.2);
  camera.lookAt(0, 1.1, 0);

  // ===================== 共享全息 uniforms =====================
  var uTime = { value: 0 };
  var uOpacity = { value: 0 };          // 入场整体淡入
  var uScan = { value: -1.0 };          // 凝聚扫描线位置（-1 表示不扫）

  // 全息材质：半透明青色 + 边缘菲涅耳 + 水平扫描线 + 轻微闪烁
  var holoMat = new THREE.MeshBasicMaterial({
    color: 0x8feeff,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.FrontSide
  });

  holoMat.onBeforeCompile = function (shader) {
    window.__holoShader = true; // 供外部确认自定义 shader 已生效
    shader.uniforms.uTime = uTime;
    shader.uniforms.uOpacity = uOpacity;
    shader.uniforms.uScan = uScan;

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>',
        '#include <common>\n' +
        'varying vec3 vWPos;\n' +
        'varying vec3 vWNrm;\n')
      .replace('#include <begin_vertex>',
        '#include <begin_vertex>\n' +
        'vec4 hWp = modelMatrix * vec4(transformed, 1.0);\n' +
        'vWPos = hWp.xyz;\n' +
        'vWNrm = normalize(mat3(modelMatrix) * normal);\n');

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>',
        '#include <common>\n' +
        'uniform float uTime;\n' +
        'uniform float uOpacity;\n' +
        'uniform float uScan;\n' +
        'varying vec3 vWPos;\n' +
        'varying vec3 vWNrm;\n')
      .replace('#include <output_fragment>',
        'vec3 hView = normalize(cameraPosition - vWPos);\n' +
        'float hFres = pow(1.0 - abs(dot(normalize(vWNrm), hView)), 2.4);\n' +
        'float hLine = smoothstep(0.55, 0.62, fract(vWPos.y * 2.6 - uTime * 0.55));\n' +
        'float hFlick = 0.8 + 0.2 * sin(uTime * 22.0 + vWPos.y * 38.0);\n' +
        // 正面 alpha 很低（可看穿），边缘菲涅耳主导，整体才是全息投影
        'float hA = (0.05 + hFres * 0.85) * (0.7 + hLine * 0.3) * hFlick;\n' +
        'vec3 hTint = vec3(0.4, 0.82, 1.0);\n' +
        'gl_FragColor.rgb = hTint * (0.12 + hFres * 0.85 + hLine * 0.4);\n' +
        'gl_FragColor.a = hA * uOpacity;\n' +
        // 凝聚时的一次性高亮扫描带
        'if (uScan > -0.5) {\n' +
        '  float band = smoothstep(0.18, 0.0, abs(vWPos.y - uScan));\n' +
        '  gl_FragColor.rgb += vec3(0.8, 1.0, 1.0) * band;\n' +
        '  gl_FragColor.a = max(gl_FragColor.a, band) * uOpacity;\n' +
        '}\n' +
        '#include <output_fragment>');
  };

  // ===================== 程序化人形 =====================
  var figure = new THREE.Group();
  scene.add(figure);

  function part(geo, x, y, z) {
    var m = new THREE.Mesh(geo, holoMat);
    m.position.set(x || 0, y || 0, z || 0);
    figure.add(m);
    return m;
  }

  // 长袍（上窄下宽）
  part(new THREE.CylinderGeometry(0.30, 0.56, 1.5, 24, 1), 0, 0.78, 0);
  // 肩
  part(new THREE.CylinderGeometry(0.34, 0.30, 0.28, 24), 0, 1.55, 0);
  // 颈
  part(new THREE.CylinderGeometry(0.09, 0.11, 0.18, 16), 0, 1.72, 0);
  // 头
  part(new THREE.SphereGeometry(0.27, 24, 20), 0, 1.98, 0);
  // 兜帽（罩在头外的大半球，正面露脸 —— Anorak 标志性 hood）
  part(new THREE.SphereGeometry(0.44, 26, 18, 0, Math.PI * 2, 0, Math.PI * 0.62), 0, 1.98, -0.06);
  // 兜帽尖顶（背后微微隆起的帽尖）
  part(new THREE.ConeGeometry(0.16, 0.4, 18), 0, 2.32, -0.18);
  // 鬓发（头两侧白发）
  part(new THREE.SphereGeometry(0.1, 14, 12), -0.2, 1.92, 0.04);
  part(new THREE.SphereGeometry(0.1, 14, 12), 0.2, 1.92, 0.04);
  // 灰白长胡须（下垂尖锥，老人特征）
  part(new THREE.ConeGeometry(0.14, 0.62, 18), 0, 1.66, 0.08);
  part(new THREE.SphereGeometry(0.12, 14, 12), 0, 1.86, 0.06);

  // 手臂（独立分组，待机时轻微摆动）
  var armL = new THREE.Group();
  var armR = new THREE.Group();
  armL.position.set(-0.36, 1.5, 0);
  armR.position.set(0.36, 1.5, 0);
  var armGeoL = new THREE.CylinderGeometry(0.07, 0.09, 1.05, 14);
  var armGeoR = armGeoL.clone();
  var aL = new THREE.Mesh(armGeoL, holoMat);
  var aR = new THREE.Mesh(armGeoR, holoMat);
  aL.position.y = -0.5;
  aR.position.y = -0.5;
  armL.add(aL);
  armR.add(aR);
  var handL = new THREE.Mesh(new THREE.SphereGeometry(0.09, 14, 12), holoMat);
  var handR = handL.clone();
  handL.position.y = -1.04;
  handR.position.y = -1.04;
  armL.add(handL);
  armR.add(handR);
  // 左臂自然外张下垂；右臂向前抬起、掌心朝上托钥匙
  armL.rotation.z = 0.3;
  armR.rotation.z = -0.12;
  armR.rotation.x = -1.28;
  figure.add(armL);
  figure.add(armR);

  // ===================== 掌心的水晶钥匙 =====================
  var keyGlowTex = (function () {
    var c = document.createElement('canvas');
    c.width = c.height = 128;
    var x = c.getContext('2d');
    var g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(180,240,255,0.5)');
    g.addColorStop(1, 'rgba(180,240,255,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  })();

  var keyMat = new THREE.MeshBasicMaterial({
    color: 0xeafdff, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false
  });
  var keyGroup = new THREE.Group();
  var keyRing = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.024, 10, 26), keyMat);
  var keyStem = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.3, 0.05), keyMat);
  keyStem.position.y = -0.2;
  var tooth1 = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.05, 0.05), keyMat);
  tooth1.position.set(0.04, -0.33, 0);
  var tooth2 = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.05, 0.05), keyMat);
  tooth2.position.set(0.02, -0.27, 0);
  keyGroup.add(keyRing, keyStem, tooth1, tooth2);
  // 悬浮在前伸右手的掌心上方
  keyGroup.position.set(0.36, 1.52, 1.06);
  keyGroup.rotation.set(0.3, 0, -0.35);
  keyGroup.scale.setScalar(1.45);
  scene.add(keyGroup);

  var keyGlow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: keyGlowTex, color: 0xbff3ff, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false
  }));
  keyGlow.scale.set(1.5, 1.5, 1);
  keyGlow.position.copy(keyGroup.position);
  scene.add(keyGlow);

  // ===================== 底座光环 + 光柱 =====================
  var baseMat = new THREE.MeshBasicMaterial({
    color: 0x66ddff, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
  });
  var ring = new THREE.Mesh(new THREE.RingGeometry(0.62, 0.92, 60), baseMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.02;
  scene.add(ring);

  var ring2 = new THREE.Mesh(
    new THREE.RingGeometry(0.4, 0.5, 48),
    baseMat.clone()
  );
  ring2.rotation.x = -Math.PI / 2;
  ring2.position.y =0.02;
  scene.add(ring2);

  var beamMat = new THREE.MeshBasicMaterial({
    color: 0x8feeff, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false,
    side: THREE.DoubleSide
  });
  var beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.45, 0.75, 2.7, 26, 1, true),
    beamMat
  );
  beam.position.y = 1.35;
  scene.add(beam);

  // 循环扫描环（待机时持续上下）
  var sweepMat = new THREE.MeshBasicMaterial({
    color: 0xc8f6ff, transparent: true, opacity: 0.6,
    blending: THREE.AdditiveBlending, depthWrite: false
  });
  var sweep = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.012, 8, 60), sweepMat);
  sweep.rotation.x = Math.PI / 2;
  sweep.position.y = 0;
  scene.add(sweep);

  // 周围漂浮粒子
  var pCount = isMobile ? 16 : 34;
  var pPos = new Float32Array(pCount * 3);
  var pSeed = [];
  for (var i = 0; i < pCount; i++) {
    var ang = Math.random() * Math.PI * 2;
    var rad = 0.7 + Math.random() * 0.7;
    pPos[i * 3] = Math.cos(ang) * rad;
    pPos[i * 3 + 1] = Math.random() * 2.4;
    pPos[i * 3 + 2] = Math.sin(ang) * rad;
    pSeed.push({ s: Math.random() * Math.PI * 2, v: 0.3 + Math.random() * 0.5 });
  }
  var pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  var pPts = new THREE.Points(pGeo, new THREE.PointsMaterial({
    color: 0x9feeff, size: 0.05, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false
  }));
  scene.add(pPts);

  // ===================== 入场时间轴 =====================
  // 0~0.8 底座/光柱亮起；0.6~2.0 人物凝聚 + 一次扫描；2.0 后待机
  function easeOut(x) { return 1 - Math.pow(1 - x, 3); }
  function clamp01(x) { return Math.max(0, Math.min(1, x)); }

  function idleState() {
    uOpacity.value = 1;
    uScan.value = -1;
    baseMat.opacity = 0.55;
    ring2.material.opacity = 0.4;
    beamMat.opacity = 0.16;
    pPts.material.opacity = 0.8;
    keyMat.opacity = 1;
    keyGlow.material.opacity = 0.7;
    figure.scale.set(1, 1, 1);
  }

  // 入场凝聚动画只在本次会话首次打开时播放一次；
  // 同一会话内刷新 / 返回页面直接显示最终态（新会话仍会播）。
  var introAlready = false;
  try {
    introAlready = sessionStorage.getItem('holoIntro') === '1';
    if (!introAlready) sessionStorage.setItem('holoIntro', '1');
  } catch (e) { /* 隐私模式等场景降级为每次播放 */ }

  if (reducedMotion) {
    idleState();
    renderer.render(scene, camera);
  } else {
    // 已播过入场则让时间轴直接处于待机区间，跳过凝聚动画
    var start = performance.now() - (introAlready ? 10000 : 0);
    var raf = 0;
    var running = true;

    function frame(now) {
      raf = requestAnimationFrame(frame);
      if (!running) return;
      var t = (now - start) / 1000;
      uTime.value = t;

      // 底座与光柱
      var baseP = easeOut(clamp01(t / 0.8));
      baseMat.opacity = 0.55 * baseP;
      ring2.material.opacity = 0.4 * baseP;
      beamMat.opacity = 0.16 * baseP;
      pPts.material.opacity = 0.8 * easeOut(clamp01(t / 1.2));

      // 人物淡入 + 纵向拉伸回弹
      var fp = clamp01((t - 0.6) / 1.4);
      uOpacity.value = easeOut(fp);
      var stretch = 0.35 + 0.65 * easeOut(fp);
      var bounce = 1 + Math.sin(fp * Math.PI) * 0.08;
      figure.scale.set(1 + (1 - stretch) * 0.4, stretch * bounce, 1 + (1 - stretch) * 0.4);

      // 凝聚扫描：0.7~1.9 从脚到头扫一次
      if (t >= 0.7 && t <= 1.9) {
        uScan.value = 0.05 + ((t - 0.7) / 1.2) * 2.25;
      } else {
        uScan.value = -1;
      }

      // 钥匙随人物一起淡入
      var keyP = easeOut(fp);
      keyMat.opacity = keyP;
      keyGlow.material.opacity = 0.7 * keyP;

      // 待机动作（入场后开始）
      if (t > 1.6) {
        var it = t - 1.6;
        figure.position.y = Math.sin(it * 1.1) * 0.07;
        figure.rotation.y = Math.sin(it * 0.4) * 0.22;
        armL.rotation.x = Math.sin(it * 0.9) * 0.12;
        // 右臂保持前伸托举基线，只做轻微起伏，不回落到下垂
        armR.rotation.x = -1.28 + Math.sin(it * 0.8) * 0.05;

        // 钥匙在掌心上方悬浮、缓慢自转，辉光呼吸
        keyGroup.position.y = 1.5 + Math.sin(it * 1.3) * 0.05;
        keyGroup.rotation.y = it * 0.7;
        keyGroup.rotation.z = -0.35 + Math.sin(it * 0.9) * 0.08;
        keyGlow.position.y = keyGroup.position.y;
        keyGlow.material.opacity = 0.55 + Math.sin(it * 1.6) * 0.18;
      }

      // 循环扫描环
      var cy = (t * 0.45) % 2.4;
      sweep.position.y = cy;
      sweepMat.opacity = 0.55 * Math.sin((cy / 2.4) * Math.PI) * baseP;

      // 粒子上浮
      var arr = pGeo.attributes.position.array;
      for (var k = 0; k < pCount; k++) {
        arr[k * 3 + 1] += pSeed[k].v * 0.005;
        if (arr[k * 3 + 1] > 2.4) arr[k * 3 + 1] = 0;
      }
      pGeo.attributes.position.needsUpdate = true;

      ring.rotation.z += 0.004;
      ring2.rotation.z -= 0.006;

      renderer.render(scene, camera);
    }

    renderer.render(scene, camera);
    raf = requestAnimationFrame(frame);

    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) renderer.render(scene, camera);
    });

    window.addEventListener('resize', function () {
      W = host.clientWidth || W;
      H = host.clientHeight || H;
      camera.aspect = W / H;
      camera.updateProjectionMatrix();
      renderer.setSize(W, H);
    });
  }
})();
