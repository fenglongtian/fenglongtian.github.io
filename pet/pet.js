/**
 * 虚拟宠物 · 桌宠主体（图片帧版）
 * ------------------------------------------------------------
 * 形象来自三帧位图素材（睁眼 / 闭眼 / 开心），由 Canvas 2D 逐帧绘制。
 * 交互与动效由代码驱动，所以不需要精灵图的"帧序列动画"，只有表情切换会换图。
 *
 * 行为：
 *   - 待机：呼吸起伏 + 随机眨眼 + 视线跟随（整体微微倾斜/位移）
 *   - 点击：Q 弹挤压回弹 + 开心表情 + 爱心粒子 + 气泡台词
 *   - 双击：睡觉 / 唤醒
 *   - 拖拽：可拖动位置，位置记忆到 localStorage
 *   - 闲置 50 秒自动睡着
 *
 * 兼容：
 *   - 高 DPI 屏（devicePixelRatio）
 *   - 手机触摸（Pointer Events）
 *   - prefers-reduced-motion（降低动效，不阻断功能）
 *   - 图片加载失败时降级为极简占位绘制，不会让页面出现空洞元素
 */

(function () {
  'use strict';

  if (window.__virtualPetLoaded) return;
  window.__virtualPetLoaded = true;

  /* ---------------- 配置 ---------------- */
  var CFG = {
    SIZE: 132,                 // 画布逻辑尺寸（px）
    BLINK_MIN: 2.2,            // 眨眼最小间隔（s）
    BLINK_MAX: 5.6,            // 眨眼最大间隔（s）
    BLINK_DUR: 0.14,           // 眨眼时长
    IDLE_SLEEP: 50,            // 闲置多久睡着（s）
    HAPPY_DUR: 1.3,            // 开心表情持续（s）
    SPRITE_RATIO: 335 / 320,   // 素材宽高比
    SPRITE_H: 0.93,            // 素材高度占画布高度的比例
    STORAGE_KEY: 'vp-position'
  };

  var SPRITE_SRC = {
    base: '/pet/pet-base.png?v=20261117b',
    blink: '/pet/pet-blink.png?v=20261117b',
    happy: '/pet/pet-happy.png?v=20261117b'
  };

  var LINES = [
    '嘿，今天也要写点好代码',
    '这个页面归我守着了',
    '点我一下试试看',
    '需要帮忙就喊我',
    '别熬夜，眼睛会累',
    '架构先行，代码随后',
    'Zzz...'
  ];

  /* ---------------- 运行时状态 ---------------- */
  var el, canvas, ctx, bubble, dpr = 1;
  var W = CFG.SIZE, H = CFG.SIZE;
  var reduced = false;
  var sprites = null;          // 全部帧加载成功后才赋值

  var pet = {
    t: 0,
    state: 'idle',             // idle | happy | sleep | drag
    blinkStart: -99,
    nextBlink: CFG.BLINK_MIN,
    happyUntil: 0,
    idleTime: 0,
    breathe: 0,
    gazeX: 0,
    gazeY: 0,
    targetGazeX: 0,
    targetGazeY: 0,
    wanderAngle: 0,
    sqT: 99,                   // 挤压回弹计时（越大越静止）
    particles: [],
    zzzTimer: 0
  };

  var mouse = { x: -9999, y: -9999, active: false, near: false };
  var drag = { active: false, moved: false, dx: 0, dy: 0, lastX: 0, lastY: 0, pid: null };

  /* ---------------- 工具 ---------------- */
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  /* ---------------- 初始化 ---------------- */
  function reportError(stage, err) {
    try {
      document.documentElement.setAttribute(
        'data-vp-error',
        stage + ': ' + (err && err.message) + ' | ' + String((err && err.stack) || '').split('\n').slice(0, 2).join(' ; ')
      );
    } catch (e) { /* 忽略 */ }
  }

  function init() {
    try {
      reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (e) { reduced = false; }

    try {
      buildDom();
      restorePosition();
      bindEvents();
      resize();

      // 素材就绪后再开跑，避免闪一帧占位图
      preload(function () {
        // 先同步画一帧：标签页在后台时 requestAnimationFrame 会被浏览器暂停，
        // 不补这一帧就会一直空白，直到页面重新可见
        draw();
        requestAnimationFrame(loop);
        setTimeout(function () { if (el) el.classList.add('is-awake'); }, 300);
      });

      // 从后台切回前台时立刻补一帧并恢复计时基准
      document.addEventListener('visibilitychange', function () {
        if (!document.hidden) {
          lastTs = 0;
          draw();
        }
      });
    } catch (err) {
      reportError('init', err);
    }
  }

  function preload(cb) {
    var keys = Object.keys(SPRITE_SRC);
    var got = {};
    var pending = keys.length;
    var finished = false;

    function finish() {
      if (finished) return;
      finished = true;
      clearTimeout(guard);
      // 主帧拿到就能用；缺失的表情帧退回主帧，保证宠物一定会出现
      if (got.base) {
        sprites = {
          base: got.base,
          blink: got.blink || got.base,
          happy: got.happy || got.base
        };
      }
      cb();
    }

    function tick() {
      if (finished) return;
      if (--pending > 0) return;
      finish();
    }

    // 兜底：任何一张图请求挂起（既不 load 也不 error）时，最多等 2.5s 就开跑
    var guard = setTimeout(finish, 2500);

    keys.forEach(function (k) {
      var img = new Image();
      img.onload = function () { got[k] = img; tick(); };
      img.onerror = function () { tick(); };
      img.src = SPRITE_SRC[k];
    });
  }

  function buildDom() {
    el = document.createElement('div');
    el.id = 'virtual-pet';
    el.setAttribute('aria-label', '虚拟宠物，点击可以互动');
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');

    canvas = document.createElement('canvas');
    el.appendChild(canvas);

    bubble = document.createElement('div');
    bubble.id = 'virtual-pet-bubble';
    el.appendChild(bubble);

    document.body.appendChild(el);
    ctx = canvas.getContext('2d');

    el.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        triggerHappy();
      }
    });
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 3);
    var cssSize = (el && el.clientWidth) ? el.clientWidth : W;
    canvas.width = Math.round(cssSize * dpr);
    canvas.height = Math.round(cssSize * dpr);
    var k = (cssSize / W) * dpr;
    ctx.setTransform(k, 0, 0, k, 0, 0);
  }

  /* ---------------- 位置记忆 ---------------- */
  function restorePosition() {
    try {
      var raw = localStorage.getItem(CFG.STORAGE_KEY);
      if (!raw) return;
      var p = JSON.parse(raw);
      if (p && typeof p.x === 'number' && typeof p.y === 'number') {
        setPos(p.x, p.y);
      }
    } catch (e) { /* 忽略 */ }
  }

  function savePosition() {
    try {
      var r = el.getBoundingClientRect();
      localStorage.setItem(CFG.STORAGE_KEY, JSON.stringify({ x: r.left, y: r.top }));
    } catch (e) { /* 忽略 */ }
  }

  function setPos(x, y) {
    var maxX = Math.max(0, window.innerWidth - (el.offsetWidth || W));
    var maxY = Math.max(0, window.innerHeight - (el.offsetHeight || H));
    el.style.left = clamp(x, 0, maxX) + 'px';
    el.style.top = clamp(y, 0, maxY) + 'px';
    el.style.right = 'auto';
    el.style.bottom = 'auto';
  }

  /* ---------------- 事件 ---------------- */
  function bindEvents() {
    window.addEventListener('resize', function () {
      resize();
      if (el.style.left) {
        var x = parseFloat(el.style.left) || 0;
        var y = parseFloat(el.style.top) || 0;
        setPos(x, y);
      }
    }, { passive: true });

    document.addEventListener('pointermove', function (e) {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
      mouse.active = true;
      updateMouseNear();
    }, { passive: true });

    document.addEventListener('pointerleave', function () {
      mouse.active = false;
      mouse.near = false;
    });

    el.addEventListener('pointerdown', onDown);
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);

    el.addEventListener('dblclick', function () {
      toggleSleep();
    });
  }

  function updateMouseNear() {
    if (!el) return;
    var r = el.getBoundingClientRect();
    var cx = r.left + r.width / 2;
    var cy = r.top + r.height / 2;
    mouse.near = Math.hypot(mouse.x - cx, mouse.y - cy) < 260;
  }

  function onDown(e) {
    if (e.button !== undefined && e.button !== 0 && e.pointerType === 'mouse') return;
    var r = el.getBoundingClientRect();
    drag.active = true;
    drag.moved = false;
    drag.dx = e.clientX - r.left;
    drag.dy = e.clientY - r.top;
    drag.lastX = e.clientX;
    drag.lastY = e.clientY;
    drag.pid = e.pointerId;
    el.classList.add('is-dragging');
    try { el.setPointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }
    e.preventDefault();
  }

  function onMove(e) {
    if (!drag.active || e.pointerId !== drag.pid) return;
    if (Math.abs(e.clientX - drag.lastX) > 4 || Math.abs(e.clientY - drag.lastY) > 4) {
      drag.moved = true;
      pet.state = 'drag';
      setPos(e.clientX - drag.dx, e.clientY - drag.dy);
    }
  }

  function onUp(e) {
    if (!drag.active || e.pointerId !== drag.pid) return;
    drag.active = false;
    el.classList.remove('is-dragging');
    try { el.releasePointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }

    if (drag.moved) {
      pet.state = 'idle';
      savePosition();
    } else {
      triggerHappy();
    }
    drag.pid = null;
  }

  /* ---------------- 行为 ---------------- */
  function triggerHappy() {
    if (pet.state === 'sleep') {
      pet.state = 'idle';
      pet.idleTime = 0;
      pet.zzzTimer = 0;
      pet.sqT = 0;
      say('醒啦');
      return;
    }
    pet.state = 'happy';
    pet.happyUntil = pet.t + CFG.HAPPY_DUR;
    pet.sqT = 0;
    pet.idleTime = 0;
    spawnHearts();
    say(pickLine());
  }

  function toggleSleep() {
    if (pet.state === 'sleep') {
      pet.state = 'idle';
      pet.idleTime = 0;
      say('我醒了');
    } else {
      pet.state = 'sleep';
      pet.idleTime = 0;
      pet.happyUntil = 0;
      say('Zzz...');
    }
  }

  function pickLine() {
    return LINES[Math.floor(Math.random() * LINES.length)];
  }

  var bubbleTimer = 0;
  function say(text) {
    if (!bubble || !text) return;
    bubble.textContent = text;
    bubble.classList.add('is-show');
    clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(function () {
      bubble.classList.remove('is-show');
    }, 2200);
  }

  function spawnHearts() {
    for (var i = 0; i < 5; i++) {
      pet.particles.push({
        x: W / 2 + (Math.random() - 0.5) * 26,
        y: H / 2 - 18,
        vx: (Math.random() - 0.5) * 14,
        vy: -(38 + Math.random() * 26),
        life: 0,
        max: 0.8 + Math.random() * 0.45,
        size: 4.5 + Math.random() * 3,
        rot: (Math.random() - 0.5) * 0.5
      });
    }
  }

  /* ---------------- 更新 ---------------- */
  function update(dt) {
    pet.t += dt;

    // 眨眼
    pet.nextBlink -= dt;
    if (pet.nextBlink <= 0) {
      pet.blinkStart = pet.t;
      pet.nextBlink = CFG.BLINK_MIN + Math.random() * (CFG.BLINK_MAX - CFG.BLINK_MIN);
    }

    // 呼吸
    pet.breathe = Math.sin(pet.t * 1.5);

    // 视线跟随（作用到整体位移/倾斜）
    var tx = 0, ty = 0;
    if (mouse.active && mouse.near) {
      var r = el.getBoundingClientRect();
      var cx = r.left + r.width / 2;
      var cy = r.top + r.height / 2;
      var dx = mouse.x - cx;
      var dy = mouse.y - cy;
      var dist = Math.hypot(dx, dy) || 1;
      var amp = clamp(dist / 40, 0, 1) * 3.4;
      tx = (dx / dist) * amp;
      ty = (dy / dist) * amp * 0.7;
    } else if (mouse.active) {
      pet.wanderAngle += dt * 0.25;
      tx = Math.cos(pet.wanderAngle) * 1.4;
      ty = Math.sin(pet.wanderAngle * 1.3) * 0.9;
    }
    pet.targetGazeX = tx;
    pet.targetGazeY = ty;
    var k = reduced ? 1 : 0.18;
    pet.gazeX += (pet.targetGazeX - pet.gazeX) * k;
    pet.gazeY += (pet.targetGazeY - pet.gazeY) * k;

    // 挤压回弹计时
    if (pet.sqT < 9) pet.sqT += dt;

    // 开心计时
    if (pet.state === 'happy' && pet.t > pet.happyUntil) {
      pet.state = 'idle';
    }

    // 闲置睡眠
    if (pet.state !== 'sleep' && pet.state !== 'drag') {
      pet.idleTime += dt;
      if (pet.idleTime > CFG.IDLE_SLEEP) {
        pet.state = 'sleep';
        pet.idleTime = 0;
      }
    }

    // 粒子
    for (var i = pet.particles.length - 1; i >= 0; i--) {
      var p = pet.particles[i];
      p.life += dt;
      p.vy += 34 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.life >= p.max) pet.particles.splice(i, 1);
    }

    // 睡觉时的 zzz
    if (pet.state === 'sleep') {
      pet.zzzTimer += dt;
      if (pet.zzzTimer > 1.1) {
        pet.zzzTimer = 0;
        pet.particles.push({
          x: W / 2 + 26,
          y: H / 2 - 34,
          vx: 10,
          vy: -30,
          life: 0,
          max: 1.8,
          size: 7,
          zzz: true
        });
      }
    }
  }

  /* ---------------- 绘制 ---------------- */
  function pickFrame() {
    if (!sprites) return null;
    if (pet.state === 'sleep') return sprites.blink;
    if (pet.state === 'happy') return sprites.happy;
    var bp = (pet.t - pet.blinkStart) / CFG.BLINK_DUR;
    if (bp >= 0 && bp <= 1) return sprites.blink;
    return sprites.base;
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);

    var img = pickFrame();
    if (!img) {
      drawFallback();
      drawParticles();
      return;
    }

    // 呼吸
    var amp = reduced ? 0.006 : 0.022;
    var sy = 1 + amp * pet.breathe;
    var sx = 1 - amp * pet.breathe * 0.55;

    // 挤压回弹（衰减振荡）
    var sq = 0;
    if (pet.sqT < 1.6) {
      sq = Math.exp(-5.5 * pet.sqT) * Math.cos(pet.sqT * 24);
      if (reduced) sq *= 0.35;
    }
    sx *= (1 + 0.15 * sq);
    sy *= (1 - 0.17 * sq);

    // 视线带来的轻微偏移与倾斜
    var cx = W / 2 + pet.gazeX;
    var cy = H / 2 + pet.gazeY * 0.8;
    var rot = reduced ? 0 : (pet.gazeX / 3.4) * 0.045;

    var hh = H * CFG.SPRITE_H;
    var ww = hh * CFG.SPRITE_RATIO;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rot);
    ctx.scale(sx, sy);
    ctx.drawImage(img, -ww / 2, -hh / 2, ww, hh);
    ctx.restore();

    drawParticles();
  }

  // 素材加载失败时的极简占位，保证元素不会变成空白
  function drawFallback() {
    var cx = W / 2, cy = H / 2;
    ctx.save();
    ctx.fillStyle = '#fdf6ee';
    ctx.beginPath();
    ctx.arc(cx, cy, 42, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#2f2a26';
    ctx.beginPath();
    ctx.arc(cx - 13, cy - 4, 5.4, 0, Math.PI * 2);
    ctx.arc(cx + 13, cy - 4, 5.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawParticles() {
    for (var i = 0; i < pet.particles.length; i++) {
      var p = pet.particles[i];
      var kk = p.life / p.max;
      var alpha = Math.max(0, 1 - kk);
      ctx.save();
      ctx.globalAlpha = alpha;

      if (p.zzz) {
        ctx.fillStyle = '#8a6a52';
        ctx.font = '600 ' + (p.size + kk * 5) + 'px -apple-system, "Segoe UI", sans-serif';
        ctx.fillText('z', p.x, p.y);
      } else {
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot + kk * 0.4);
        ctx.fillStyle = '#ff8fa3';
        drawHeartShape(0, 0, p.size);
      }
      ctx.restore();
    }
  }

  function drawHeartShape(x, y, s) {
    ctx.beginPath();
    ctx.moveTo(x, y + s * 0.62);
    ctx.bezierCurveTo(x - s * 1.05, y - s * 0.15, x - s * 0.55, y - s * 1.15, x, y - s * 0.42);
    ctx.bezierCurveTo(x + s * 0.55, y - s * 1.15, x + s * 1.05, y - s * 0.15, x, y + s * 0.62);
    ctx.closePath();
    ctx.fill();
  }

  /* ---------------- 主循环 ---------------- */
  var lastTs = 0;
  function loop(ts) {
    try {
      if (!lastTs) lastTs = ts;
      var dt = (ts - lastTs) / 1000;
      lastTs = ts;
      dt = clamp(dt, 0, 0.05);

      if (pet.state !== 'drag') update(dt);
      draw();
    } catch (err) {
      reportError('loop', err);
    }
    requestAnimationFrame(loop);
  }

  /* ---------------- 启动 ---------------- */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
