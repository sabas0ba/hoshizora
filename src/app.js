// app.js - 星空シミュレータ本体 (2D星座早見 / 3Dプラネタリウム)
/* global THREE, satellite, Astro, PLANET_DATA */

(function () {
  "use strict";
  var D2R = Astro.D2R, R2D = Astro.R2D;

  // ================= 状態 =================
  var state = {
    lat: 35.6895, lon: 139.6917,          // 東京
    baseTime: Date.now(),                  // 基準日時 [ms] (下の initialBaseTime で確定)
    offsetMin: 0,                          // スライダーオフセット [min]
    view: "2d",
    playing: false, speed: 60,
    show: {
      constLines: true, constNames: false, starNames: true,
      planets: true, sunMoon: true, milkyway: true,
      satellites: true, grid: true, ground: true, atmosphere: true
    }
  };
  function simTime() { return state.baseTime + state.offsetMin * 60000; }

  // 起動時の基準日時。昼間 (太陽高度が市民薄明より上) に開いた場合は星が
  // ほとんど見えないため、その日の 20:00 (現地時刻) の空を初期表示にする。
  // 夜間に開いた場合は現在時刻をそのまま使う。
  var INITIAL_NIGHT_HOUR = 20;
  function initialBaseTime() {
    var now = Date.now();
    var jd = Astro.julianDate(now);
    var sun = Astro.sunPosition(jd);
    var h = Astro.eqToHorizontal(sun.ra, sun.dec, Astro.lst(jd, state.lon), state.lat);
    if (h.alt <= -6) return now;   // すでに夜
    var d = new Date(now);
    d.setHours(INITIAL_NIGHT_HOUR, 0, 0, 0);
    return d.getTime();
  }
  state.baseTime = initialBaseTime();

  var target = null;   // 検索で選択中の天体 {type, ...}
  var anim = null;     // 3D 視線移動アニメーション
  var gyro = {         // 方位センサー
    active: false, hasData: false, gotAbs: false, listening: false,
    a: 0, b: 0, g: 0, offset: 0
  };

  // ================= 恒星データ展開 =================
  var N = PLANET_DATA.starCount;
  var starRA = new Float64Array(N), starDec = new Float64Array(N);
  var starMag = new Float32Array(N), starCol = new Float32Array(N * 3);
  (function () {
    var a = PLANET_DATA.stars;
    for (var i = 0; i < N; i++) {
      starRA[i] = a[i * 4] / 10000;
      starDec[i] = a[i * 4 + 1] / 10000;
      starMag[i] = a[i * 4 + 2] / 100;
      var bv = a[i * 4 + 3] === 999 ? 0.5 : a[i * 4 + 3] / 100;
      var c = Astro.bvToRGB(bv);
      starCol[i * 3] = c[0]; starCol[i * 3 + 1] = c[1]; starCol[i * 3 + 2] = c[2];
    }
  })();
  var starNameMap = {};   // index -> name
  var namedBright = [];   // ラベル表示対象 [index, name]
  PLANET_DATA.starNames.forEach(function (e) {
    starNameMap[e[0]] = e[1];
    if (starMag[e[0]] <= 1.7) namedBright.push(e);
  });

  // ================= 衛星 =================
  var sats = PLANET_DATA.tles.map(function (t) {
    return { name: t.name, rec: satellite.twoline2satrec(t.l1, t.l2) };
  });

  // ================= 天文計算キャッシュ =================
  var A = {}; // 毎更新の計算結果
  function computeAstro() {
    var t = simTime();
    var jd = Astro.julianDate(t);
    A.jd = jd;
    A.lst = Astro.lst(jd, state.lon);
    A.sun = Astro.sunPosition(jd);
    A.moon = Astro.moonPosition(jd);
    A.phase = Astro.moonPhase(jd, A.sun, A.moon);
    A.planets = Astro.planetPositions(jd);
    A.sunH = Astro.eqToHorizontal(A.sun.ra, A.sun.dec, A.lst, state.lat);
    var mh = Astro.eqToHorizontal(A.moon.ra, A.moon.dec, A.lst, state.lat);
    mh.alt -= A.moon.parallax * Math.cos(mh.alt * D2R); // 地心→測心の簡易視差補正
    A.moonH = mh;
    A.planets.forEach(function (p) {
      p.h = Astro.eqToHorizontal(p.ra, p.dec, A.lst, state.lat);
    });
    // 昼間度 0(夜)..1(昼) : 太陽高度 -15..+3 で遷移
    var s = (A.sunH.alt + 15) / 18;
    A.day = Math.max(0, Math.min(1, s));
    A.magLimit = 6.3 - A.day * 9;  // 表示等級上限
    computeSats(t);
  }

  function satLookAngles(rec, date) {
    var pv = satellite.propagate(rec, date);
    if (!pv || !pv.position) return null;
    var gmst = satellite.gstime(date);
    var ecf = satellite.eciToEcf(pv.position, gmst);
    var gd = { longitude: state.lon * D2R, latitude: state.lat * D2R, height: 0 };
    var la = satellite.ecfToLookAngles(gd, ecf);
    // 被照射判定 (円筒影モデル)
    var sr = A.sun ? A.sun : Astro.sunPosition(Astro.julianDate(date.getTime()));
    var sd = [Math.cos(sr.dec * D2R) * Math.cos(sr.ra * D2R),
              Math.cos(sr.dec * D2R) * Math.sin(sr.ra * D2R),
              Math.sin(sr.dec * D2R)];
    var r = pv.position;
    var dot = r.x * sd[0] + r.y * sd[1] + r.z * sd[2];
    var perp2 = (r.x * r.x + r.y * r.y + r.z * r.z) - dot * dot;
    var lit = dot > 0 || perp2 > 6378.14 * 6378.14;
    return { alt: la.elevation * R2D, az: la.azimuth * R2D, range: la.rangeSat, lit: lit };
  }

  var satTrailT = -1e18;
  function computeSats(t) {
    A.sats = [];
    if (!state.show.satellites) return;
    for (var i = 0; i < sats.length; i++) {
      var cur = satLookAngles(sats[i].rec, new Date(t));
      if (!cur) continue;
      A.sats.push({ name: sats[i].name, cur: cur, idx: i });
    }
    if (Math.abs(t - satTrailT) > 5000) {
      satTrailT = t;
      A.satTrails = [];
      for (var j = 0; j < sats.length; j++) {
        var trail = [];
        for (var s = -180; s <= 180; s += 15) {
          var la = satLookAngles(sats[j].rec, new Date(t + s * 1000));
          trail.push(la);
        }
        A.satTrails.push(trail);
      }
    }
  }

  // ================= 2D ビュー =================
  var cv2 = document.getElementById("canvas2d");
  var ctx = cv2.getContext("2d");
  var view2 = { zoom: 1, panX: 0, panY: 0, W: 0, H: 0, R: 0, cx: 0, cy: 0 };

  function resize2d() {
    // 非表示中 (3D 表示中) はサイズが 0 になる。そのまま反映するとキャンバスが
    // 0×0 になり 2D に戻したときに何も描けなくなるため、無視して切替時に測り直す。
    var w = cv2.clientWidth, h = cv2.clientHeight;
    if (w <= 0 || h <= 0) return;
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    view2.W = w; view2.H = h;
    cv2.width = w * dpr; cv2.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    dirty = true;
  }

  // 地平座標→画面 (正距方位図法, 天頂中心, 北上・東左)
  function proj2d(alt, az) {
    var r = (90 - alt) / 90 * view2.R;
    var a = az * D2R;
    return [view2.cx - r * Math.sin(a), view2.cy - r * Math.cos(a), r];
  }

  function lerpColor(c1, c2, t) {
    return [c1[0] + (c2[0] - c1[0]) * t, c1[1] + (c2[1] - c1[1]) * t, c1[2] + (c2[2] - c1[2]) * t];
  }
  function css(c, a) {
    return "rgba(" + (c[0] | 0) + "," + (c[1] | 0) + "," + (c[2] | 0) + "," + (a === undefined ? 1 : a) + ")";
  }

  function draw2d() {
    var W = view2.W, H = view2.H;
    view2.R = Math.min(W, H) * 0.46 * view2.zoom;
    view2.cx = W / 2 + view2.panX; view2.cy = H / 2 + view2.panY;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#04060b";
    ctx.fillRect(0, 0, W, H);

    var day = state.show.atmosphere ? A.day : 0;
    // 空 (地平円内)
    ctx.save();
    ctx.beginPath();
    ctx.arc(view2.cx, view2.cy, view2.R, 0, Math.PI * 2);
    ctx.clip();
    var zen = lerpColor([6, 8, 15], [59, 124, 213], day);
    var hor = lerpColor([12, 16, 28], [168, 200, 232], day);
    var g = ctx.createRadialGradient(view2.cx, view2.cy, 0, view2.cx, view2.cy, view2.R);
    g.addColorStop(0, css(zen)); g.addColorStop(1, css(hor));
    ctx.fillStyle = g;
    ctx.fillRect(view2.cx - view2.R, view2.cy - view2.R, view2.R * 2, view2.R * 2);
    // 薄明の太陽方向グロー
    if (state.show.atmosphere && A.sunH.alt > -14 && A.sunH.alt < 8) {
      var sp = proj2d(Math.max(A.sunH.alt, -4), A.sunH.az);
      var ga = 0.55 * (1 - Math.abs(A.sunH.alt - (-3)) / 11);
      if (ga > 0) {
        var gg = ctx.createRadialGradient(sp[0], sp[1], 0, sp[0], sp[1], view2.R * 0.75);
        gg.addColorStop(0, "rgba(255,150,70," + ga + ")");
        gg.addColorStop(1, "rgba(255,150,70,0)");
        ctx.fillStyle = gg;
        ctx.fillRect(view2.cx - view2.R, view2.cy - view2.R, view2.R * 2, view2.R * 2);
      }
    }

    var nightF = 1 - day;
    if (state.show.milkyway && nightF > 0.05) drawMilkyway2d(nightF);
    if (state.show.grid) drawGrid2d();
    if (state.show.constLines) drawConstLines2d(nightF);
    drawStars2d();
    if (state.show.constNames) drawConstNames2d(nightF);
    if (state.show.planets) drawPlanets2d();
    if (state.show.sunMoon) drawSunMoon2d();
    if (state.show.satellites) drawSats2d(nightF);
    if (target) drawTarget2d();
    ctx.restore();

    // 地平リングと方位
    ctx.strokeStyle = "#3a4358"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(view2.cx, view2.cy, view2.R, 0, Math.PI * 2); ctx.stroke();
    ctx.font = "bold 14px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    var dirs = [["北", 0], ["東", 90], ["南", 180], ["西", 270]];
    for (var i = 0; i < 4; i++) {
      var p = proj2d(-6, dirs[i][1]);
      ctx.fillStyle = i === 0 ? "#e66" : "#9aa5bb";
      ctx.fillText(dirs[i][0], p[0], p[1]);
    }
  }

  function horizAllSky(raDeg, decDeg) {
    return Astro.eqToHorizontal(raDeg, decDeg, A.lst, state.lat);
  }

  function drawMilkyway2d(nightF) {
    var lv = [["ol1", 0.055], ["ol3", 0.07]];
    ctx.save();
    for (var l = 0; l < lv.length; l++) {
      var polys = PLANET_DATA.milkyway[lv[l][0]];
      if (!polys) continue;
      ctx.fillStyle = "rgba(150,170,215," + lv[l][1] * nightF + ")";
      for (var p = 0; p < polys.length; p++) {
        var pts = polys[p];
        ctx.beginPath();
        for (var i = 0; i < pts.length; i += 2) {
          var h = horizAllSky(pts[i] / 10, pts[i + 1] / 10);
          var xy = proj2d(h.alt, h.az);
          if (i === 0) ctx.moveTo(xy[0], xy[1]); else ctx.lineTo(xy[0], xy[1]);
        }
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.restore();
  }

  function drawGrid2d() {
    ctx.strokeStyle = "rgba(90,110,150,0.25)"; ctx.lineWidth = 1;
    var alts = [30, 60], i, a;
    for (i = 0; i < alts.length; i++) {
      var r = (90 - alts[i]) / 90 * view2.R;
      ctx.beginPath(); ctx.arc(view2.cx, view2.cy, r, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.beginPath();
    for (a = 0; a < 360; a += 45) {
      var p0 = proj2d(90, a), p1 = proj2d(0, a);
      ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]);
    }
    ctx.stroke();
  }

  function drawConstLines2d(nightF) {
    ctx.strokeStyle = "rgba(110,150,210," + (0.5 * nightF) + ")";
    ctx.lineWidth = 1;
    ctx.beginPath();
    var lines = PLANET_DATA.constLines;
    for (var s = 0; s < lines.length; s++) {
      var pts = lines[s], started = false;
      for (var i = 0; i < pts.length; i += 2) {
        var h = horizAllSky(pts[i] / 100, pts[i + 1] / 100);
        if (h.alt < -12) { started = false; continue; }
        var xy = proj2d(h.alt, h.az);
        if (!started) { ctx.moveTo(xy[0], xy[1]); started = true; }
        else ctx.lineTo(xy[0], xy[1]);
      }
    }
    ctx.stroke();
  }

  function drawConstNames2d(nightF) {
    ctx.font = "11px sans-serif"; ctx.textAlign = "center";
    ctx.fillStyle = "rgba(140,160,200," + 0.8 * nightF + ")";
    var cn = PLANET_DATA.constNames;
    for (var i = 0; i < cn.length; i++) {
      var h = horizAllSky(cn[i][2] / 100, cn[i][3] / 100);
      if (h.alt < 3) continue;
      var xy = proj2d(h.alt, h.az);
      ctx.fillText(cn[i][0], xy[0], xy[1]);
    }
  }

  function drawStars2d() {
    var maglim = state.show.atmosphere ? A.magLimit : 6.3;
    if (maglim < -1) return;
    for (var i = 0; i < N; i++) {
      if (starMag[i] > maglim) continue;
      var h = horizAllSky(starRA[i], starDec[i]);
      if (h.alt < -0.8) continue;
      var xy = proj2d(h.alt + Astro.refraction(h.alt), h.az);
      var m = starMag[i];
      var size = Math.max(0.5, 3.2 - m * 0.55) * Math.sqrt(view2.zoom);
      var alpha = m > maglim - 1 ? Math.max(0.15, maglim - m) : 1;
      ctx.fillStyle = css([starCol[i * 3] * 255, starCol[i * 3 + 1] * 255, starCol[i * 3 + 2] * 255], alpha);
      ctx.beginPath();
      ctx.arc(xy[0], xy[1], size, 0, Math.PI * 2);
      ctx.fill();
    }
    if (state.show.starNames) {
      ctx.font = "10px sans-serif"; ctx.textAlign = "left";
      ctx.fillStyle = "rgba(200,210,230,0.75)";
      for (var j = 0; j < namedBright.length; j++) {
        var idx = namedBright[j][0];
        if (starMag[idx] > maglim) continue;
        var hh = horizAllSky(starRA[idx], starDec[idx]);
        if (hh.alt < 0) continue;
        var pp = proj2d(hh.alt, hh.az);
        ctx.fillText(namedBright[j][1], pp[0] + 5, pp[1] - 4);
      }
    }
  }

  function drawPlanets2d() {
    ctx.textAlign = "left"; ctx.font = "11px sans-serif";
    for (var i = 0; i < A.planets.length; i++) {
      var p = A.planets[i];
      if (p.h.alt < -1) continue;
      if (p.mag > A.magLimit + 1 && state.show.atmosphere) continue;
      var xy = proj2d(p.h.alt + Astro.refraction(p.h.alt), p.h.az);
      var size = Math.max(2, 4.2 - p.mag * 0.6);
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(xy[0], xy[1], size, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.4)"; ctx.lineWidth = 0.5; ctx.stroke();
      ctx.fillStyle = "rgba(230,190,120,0.9)";
      ctx.fillText(p.ja, xy[0] + 6, xy[1] - 5);
    }
  }

  function drawSunMoon2d() {
    // 太陽
    if (A.sunH.alt > -1) {
      var sp = proj2d(A.sunH.alt + Astro.refraction(A.sunH.alt), A.sunH.az);
      var sg = ctx.createRadialGradient(sp[0], sp[1], 0, sp[0], sp[1], 18);
      sg.addColorStop(0, "rgba(255,240,180,1)");
      sg.addColorStop(0.4, "rgba(255,210,100,0.9)");
      sg.addColorStop(1, "rgba(255,180,60,0)");
      ctx.fillStyle = sg;
      ctx.beginPath(); ctx.arc(sp[0], sp[1], 18, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "rgba(230,190,120,0.95)"; ctx.font = "11px sans-serif";
      ctx.fillText("太陽", sp[0] + 12, sp[1] - 10);
    }
    // 月 (輝面を描画)
    if (A.moonH.alt > -1) {
      var mp = proj2d(A.moonH.alt + Astro.refraction(A.moonH.alt), A.moonH.az);
      drawMoonFace(ctx, mp[0], mp[1], 7, A.phase);
      ctx.fillStyle = "rgba(230,190,120,0.95)"; ctx.font = "11px sans-serif";
      ctx.fillText("月", mp[0] + 10, mp[1] - 8);
    }
  }

  // 月の満ち欠け描画 (共通)
  function drawMoonFace(c, x, y, r, phase) {
    c.save();
    c.translate(x, y);
    c.fillStyle = "#2a2d38";
    c.beginPath(); c.arc(0, 0, r, 0, Math.PI * 2); c.fill();
    var k = phase.illum;
    var w = (2 * k - 1) * r; // ターミネータ半幅 (負: 三日月)
    c.fillStyle = "#f2eeda";
    c.beginPath();
    // 東側(左)が輝く=満ちる時期は太陽側が輝く。天球上での向きは簡略化し waxing で左右反転。
    var sgn = phase.waxing ? -1 : 1;
    c.arc(0, 0, r, Math.PI / 2, -Math.PI / 2, sgn > 0);
    c.ellipse(0, 0, Math.abs(w), r, 0, -Math.PI / 2, Math.PI / 2, (w > 0) === (sgn > 0));
    c.fill();
    c.restore();
  }

  function drawSats2d(nightF) {
    for (var i = 0; i < A.sats.length; i++) {
      var s = A.sats[i];
      var trail = A.satTrails && A.satTrails[s.idx];
      if (trail) {
        ctx.lineWidth = 1;
        ctx.beginPath();
        var started = false;
        for (var j = 0; j < trail.length; j++) {
          var q = trail[j];
          if (!q || q.alt < 0) { started = false; continue; }
          var xy = proj2d(q.alt, q.az);
          if (!started) { ctx.moveTo(xy[0], xy[1]); started = true; }
          else ctx.lineTo(xy[0], xy[1]);
        }
        ctx.strokeStyle = "rgba(120,220,180,0.45)";
        ctx.stroke();
      }
      if (s.cur.alt > 0) {
        var p = proj2d(s.cur.alt, s.cur.az);
        ctx.fillStyle = s.cur.lit ? "#7ce8b0" : "rgba(124,232,176,0.35)";
        ctx.beginPath(); ctx.arc(p[0], p[1], 2.6, 0, Math.PI * 2); ctx.fill();
        ctx.font = "10px sans-serif"; ctx.textAlign = "left";
        ctx.fillStyle = "rgba(124,232,176,0.85)";
        ctx.fillText(s.name.split(" ")[0], p[0] + 6, p[1] + 3);
      }
    }
  }

  // 検索ターゲットのマーカー (2D)
  function drawTarget2d() {
    var ti = targetInfo();
    if (!ti) return;
    var below = ti.alt < 0;
    var xy = proj2d(Math.max(ti.alt, 0), ti.az);
    var pulse = 3 * Math.sin(performance.now() / 220);
    ctx.strokeStyle = below ? "rgba(230,180,34,0.55)" : "#e6b422";
    ctx.lineWidth = 2;
    if (below) ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.arc(xy[0], xy[1], 14 + pulse, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(xy[0], xy[1], 4, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = "bold 12px sans-serif"; ctx.textAlign = "center";
    ctx.fillStyle = "#e6b422";
    ctx.fillText(ti.name + (below ? " (地平線下)" : ""), xy[0], xy[1] - 22 - pulse);
  }

  // ================= 3D ビュー =================
  var three = { ready: false };
  function init3d() {
    if (three.ready) return;
    three.ready = true;
    var cv3 = document.getElementById("canvas3d");
    var renderer = new THREE.WebGLRenderer({ canvas: cv3, antialias: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    var scene = new THREE.Scene();
    var camera = new THREE.PerspectiveCamera(70, 1, 0.1, 3000);
    camera.position.set(0, 0.01, 0);
    three.renderer = renderer; three.scene = scene; three.camera = camera;
    three.yaw = 0; three.pitch = 20; // 北向き、やや上

    // --- 天球グループ (赤道座標系) ---
    var sky = new THREE.Group();
    scene.add(sky);
    three.sky = sky;

    // 恒星
    var R = 900;
    var pos = new Float32Array(N * 3);
    var col = new Float32Array(N * 3);
    var siz = new Float32Array(N);
    for (var i = 0; i < N; i++) {
      var ra = starRA[i] * D2R, de = starDec[i] * D2R;
      pos[i * 3] = R * Math.cos(de) * Math.cos(ra);
      pos[i * 3 + 1] = R * Math.cos(de) * Math.sin(ra);
      pos[i * 3 + 2] = R * Math.sin(de);
      col[i * 3] = starCol[i * 3]; col[i * 3 + 1] = starCol[i * 3 + 1]; col[i * 3 + 2] = starCol[i * 3 + 2];
      siz[i] = Math.max(1.2, 9.5 - starMag[i] * 1.5);
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    geo.setAttribute("psize", new THREE.BufferAttribute(siz, 1));
    var starMat = new THREE.ShaderMaterial({
      uniforms: { uFade: { value: 0 }, uScale: { value: 1 } },
      vertexShader:
        "attribute float psize; attribute vec3 color; uniform float uScale;" +
        "varying vec3 vC; varying float vM;" +
        "void main(){ vC=color; vM=psize;" +
        " vec4 mv=modelViewMatrix*vec4(position,1.0);" +
        " gl_PointSize=psize*uScale; gl_Position=projectionMatrix*mv; }",
      fragmentShader:
        "uniform float uFade; varying vec3 vC; varying float vM;" +
        "void main(){ vec2 d=gl_PointCoord-vec2(0.5); float r=length(d)*2.0;" +
        " float a=smoothstep(1.0,0.25,r)*(1.0-uFade);" +
        " float lim=(vM-1.2)/8.3;" +          // 暗い星から先に消す
        " a*=clamp(1.0-uFade*3.0+lim*2.0,0.0,1.0);" +
        " if(a<0.01) discard; gl_FragColor=vec4(vC,a); }",
      transparent: true, depthWrite: false
    });
    starMat.uniforms.uScale.value = renderer.getPixelRatio();
    three.starMat = starMat;
    sky.add(new THREE.Points(geo, starMat));

    // 星座線
    var lpts = [];
    PLANET_DATA.constLines.forEach(function (seg) {
      for (var i = 0; i + 3 < seg.length; i += 2) {
        [[seg[i], seg[i + 1]], [seg[i + 2], seg[i + 3]]].forEach(function (pt) {
          var ra = pt[0] / 100 * D2R, de = pt[1] / 100 * D2R;
          lpts.push(895 * Math.cos(de) * Math.cos(ra), 895 * Math.cos(de) * Math.sin(ra), 895 * Math.sin(de));
        });
      }
    });
    var lgeo = new THREE.BufferGeometry();
    lgeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(lpts), 3));
    three.constLines = new THREE.LineSegments(lgeo,
      new THREE.LineBasicMaterial({ color: 0x5f87c0, transparent: true, opacity: 0.5 }));
    sky.add(three.constLines);

    // 天の川 (エクイレクタングラーテクスチャ)
    var mwTex = makeMilkywayTexture();
    var mwMat = new THREE.MeshBasicMaterial({
      map: mwTex, side: THREE.BackSide, transparent: true, opacity: 0.85,
      blending: THREE.AdditiveBlending, depthWrite: false
    });
    var mwGeo = new THREE.SphereGeometry(950, 48, 24);
    var mwMesh = new THREE.Mesh(mwGeo, mwMat);
    // 球の極(+Y)を天の北極(+Z)へ。経度方向は tex.offset.x=0.5 で位相合わせ
    mwMesh.rotation.x = Math.PI / 2;
    mwTex.offset.x = 0.5;
    three.mwMesh = mwMesh; three.mwMat = mwMat;
    sky.add(mwMesh);

    // 星座名スプライト
    three.constNameGroup = new THREE.Group();
    PLANET_DATA.constNames.forEach(function (cn) {
      var sp = makeTextSprite(cn[0], "rgba(150,170,210,0.9)", 22);
      var ra = cn[2] / 100 * D2R, de = cn[3] / 100 * D2R;
      sp.position.set(870 * Math.cos(de) * Math.cos(ra), 870 * Math.cos(de) * Math.sin(ra), 870 * Math.sin(de));
      three.constNameGroup.add(sp);
    });
    sky.add(three.constNameGroup);

    // 恒星名スプライト
    three.starNameGroup = new THREE.Group();
    namedBright.forEach(function (e) {
      var sp = makeTextSprite(e[1], "rgba(210,220,240,0.85)", 20);
      var ra = starRA[e[0]] * D2R, de = starDec[e[0]] * D2R;
      sp.position.set(860 * Math.cos(de) * Math.cos(ra), 860 * Math.cos(de) * Math.sin(ra), 860 * Math.sin(de));
      three.starNameGroup.add(sp);
    });
    sky.add(three.starNameGroup);

    // --- 世界座標系 (地平) ---
    // 空ドーム (大気)
    var domeMat = new THREE.ShaderMaterial({
      uniforms: {
        uDay: { value: 0 }, uSunDir: { value: new THREE.Vector3(0, -1, 0) }
      },
      vertexShader:
        "varying vec3 vDir; void main(){ vDir=normalize(position);" +
        " gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }",
      fragmentShader:
        "uniform float uDay; uniform vec3 uSunDir; varying vec3 vDir;" +
        "void main(){ float h=clamp(vDir.y,0.0,1.0);" +
        " vec3 nZen=vec3(0.008,0.012,0.030); vec3 nHor=vec3(0.020,0.030,0.055);" +
        " vec3 dZen=vec3(0.23,0.49,0.84); vec3 dHor=vec3(0.66,0.78,0.91);" +
        " vec3 zen=mix(nZen,dZen,uDay); vec3 hor=mix(nHor,dHor,uDay);" +
        " vec3 c=mix(hor,zen,pow(h,0.6));" +
        " float sunH=uSunDir.y;" +
        " float tw=clamp(1.0-abs(sunH+0.05)*6.0,0.0,1.0);" + // 薄明強度
        " float g=pow(max(dot(vDir,normalize(vec3(uSunDir.x,max(uSunDir.y,-0.06),uSunDir.z))),0.0),6.0);" +
        " c+=vec3(1.0,0.45,0.15)*g*tw*0.55;" +
        " gl_FragColor=vec4(c,1.0); }",
      side: THREE.BackSide, depthWrite: false
    });
    var dome = new THREE.Mesh(new THREE.SphereGeometry(1000, 48, 24), domeMat);
    dome.renderOrder = -10;
    scene.add(dome);
    three.domeMat = domeMat;

    // 地面
    var groundGeo = new THREE.CircleGeometry(1200, 64);
    var groundMat = new THREE.MeshBasicMaterial({ color: 0x0d1410, side: THREE.DoubleSide });
    var ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -2;
    scene.add(ground);
    three.ground = ground;

    // 方位ラベル
    three.cardinalGroup = new THREE.Group();
    [["北", 0, "#ff7070"], ["東", 90, "#c8d2e8"], ["南", 180, "#c8d2e8"], ["西", 270, "#c8d2e8"]]
      .forEach(function (d) {
        var sp = makeTextSprite(d[0], d[2], 34);
        var a = d[1] * D2R;
        sp.position.set(800 * Math.sin(a), 30, -800 * Math.cos(a));
        sp.scale.multiplyScalar(1.6);
        three.cardinalGroup.add(sp);
      });
    scene.add(three.cardinalGroup);

    // 高度方位グリッド
    three.gridGroup = new THREE.Group();
    var gmat = new THREE.LineBasicMaterial({ color: 0x39466a, transparent: true, opacity: 0.4 });
    [0, 30, 60].forEach(function (alt) {
      var pts = [];
      for (var a = 0; a <= 360; a += 5) {
        var aa = a * D2R, r = 980 * Math.cos(alt * D2R), y = 980 * Math.sin(alt * D2R);
        pts.push(new THREE.Vector3(r * Math.sin(aa), y, -r * Math.cos(aa)));
      }
      three.gridGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), gmat));
    });
    for (var az = 0; az < 360; az += 45) {
      var pts2 = [];
      for (var al = 0; al <= 90; al += 5) {
        var r2 = 980 * Math.cos(al * D2R), y2 = 980 * Math.sin(al * D2R), az2 = az * D2R;
        pts2.push(new THREE.Vector3(r2 * Math.sin(az2), y2, -r2 * Math.cos(az2)));
      }
      three.gridGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts2), gmat));
    }
    scene.add(three.gridGroup);

    // 太陽・月・惑星スプライト
    three.sunSprite = makeGlowSprite("#fff2c0", "#ffb830");
    three.sunSprite.scale.set(120, 120, 1);
    scene.add(three.sunSprite);
    three.moonSprite = makeMoonSprite();
    three.moonSprite.scale.set(46, 46, 1);
    scene.add(three.moonSprite);
    three.sunLabel = makeTextSprite("太陽", "rgba(230,190,120,0.95)", 24);
    three.moonLabel = makeTextSprite("月", "rgba(230,190,120,0.95)", 24);
    scene.add(three.sunLabel); scene.add(three.moonLabel);

    three.planetSprites = A.planets.map(function (p) {
      var g2 = new THREE.Group();
      var dot = makeGlowSprite(p.color, p.color);
      dot.scale.set(26, 26, 1);
      var label = makeTextSprite(p.ja, "rgba(230,190,120,0.95)", 22);
      label.position.set(0, 26, 0);
      g2.add(dot); g2.add(label);
      scene.add(g2);
      return g2;
    });

    // 衛星
    three.satGroup = new THREE.Group();
    scene.add(three.satGroup);

    // 入力
    setupPointer3d(cv3);
    resize3d();
  }

  function makeTextSprite(text, color, px) {
    var c = document.createElement("canvas");
    var cc = c.getContext("2d");
    cc.font = "bold " + px + "px sans-serif";
    var w = Math.ceil(cc.measureText(text).width) + 8;
    c.width = w; c.height = px + 10;
    cc = c.getContext("2d");
    cc.font = "bold " + px + "px sans-serif";
    cc.fillStyle = color;
    cc.textBaseline = "top";
    cc.shadowColor = "#000"; cc.shadowBlur = 4;
    cc.fillText(text, 4, 4);
    var tex = new THREE.CanvasTexture(c);
    tex.minFilter = THREE.LinearFilter;
    var mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
    var sp = new THREE.Sprite(mat);
    sp.scale.set(c.width * 0.55, c.height * 0.55, 1);
    return sp;
  }

  function makeGlowSprite(inner, outer) {
    var c = document.createElement("canvas");
    c.width = c.height = 64;
    var cc = c.getContext("2d");
    var g = cc.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, inner);
    g.addColorStop(0.25, outer);
    g.addColorStop(1, "rgba(0,0,0,0)");
    cc.fillStyle = g;
    cc.fillRect(0, 0, 64, 64);
    var tex = new THREE.CanvasTexture(c);
    var mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
    return new THREE.Sprite(mat);
  }

  function makeMoonSprite() {
    var c = document.createElement("canvas");
    c.width = c.height = 64;
    three.moonCanvas = c;
    var tex = new THREE.CanvasTexture(c);
    three.moonTex = tex;
    return new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  }

  function updateMoonSprite() {
    var c = three.moonCanvas, cc = c.getContext("2d");
    cc.clearRect(0, 0, 64, 64);
    drawMoonFace(cc, 32, 32, 26, A.phase);
    three.moonTex.needsUpdate = true;
  }

  function makeMilkywayTexture() {
    var W = 2048, H = 1024;
    var c = document.createElement("canvas");
    c.width = W; c.height = H;
    var cc = c.getContext("2d");
    cc.clearRect(0, 0, W, H);
    function drawLevel(id, alpha) {
      var polys = PLANET_DATA.milkyway[id];
      if (!polys) return;
      cc.fillStyle = "rgba(150,170,215," + alpha + ")";
      for (var p = 0; p < polys.length; p++) {
        // RA を連続化 (境界跨ぎで ±360 補正)
        var pts = polys[p];
        var un = [];
        var prev = null;
        for (var i = 0; i < pts.length; i += 2) {
          var ra = pts[i] / 10, dec = pts[i + 1] / 10;
          if (prev !== null) {
            while (ra - prev > 180) ra -= 360;
            while (ra - prev < -180) ra += 360;
          }
          prev = ra;
          un.push(ra, dec);
        }
        for (var sh = -1; sh <= 1; sh++) {
          cc.beginPath();
          for (var j = 0; j < un.length; j += 2) {
            var x = (un[j] / 360) * W + sh * W;
            var y = (90 - un[j + 1]) / 180 * H;
            if (j === 0) cc.moveTo(x, y); else cc.lineTo(x, y);
          }
          cc.closePath(); cc.fill();
        }
      }
    }
    if (cc.filter !== undefined) cc.filter = "blur(6px)";
    drawLevel("ol1", 0.16);
    drawLevel("ol3", 0.2);
    if (cc.filter !== undefined) cc.filter = "none";
    var tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.RepeatWrapping;
    return tex;
  }

  // 地平座標→世界座標
  function horizToWorld(alt, az, r) {
    var a = alt * D2R, z = az * D2R;
    return new THREE.Vector3(
      r * Math.cos(a) * Math.sin(z),
      r * Math.sin(a),
      -r * Math.cos(a) * Math.cos(z)
    );
  }

  function update3d() {
    if (!three.ready) return;
    // 天球回転: 赤道座標(X=春分点, Z=天の北極) → 世界(Y=天頂, -Z=北)
    var lst = A.lst * D2R, lat = state.lat * D2R;
    var m = new THREE.Matrix4();
    // M_HA→world (列: X_HA, Y_HA, Z_HA)
    var mHA = new THREE.Matrix4().set(
      0, 1, 0, 0,
      Math.cos(lat), 0, Math.sin(lat), 0,
      Math.sin(lat), 0, -Math.cos(lat), 0,
      0, 0, 0, 1
    );
    var mRz = new THREE.Matrix4().makeRotationZ(-lst);
    m.multiplyMatrices(mHA, mRz);
    three.sky.matrixAutoUpdate = false;
    three.sky.matrix.copy(m);
    three.sky.matrixWorldNeedsUpdate = true;

    var day = state.show.atmosphere ? A.day : 0;
    three.starMat.uniforms.uFade.value = day;
    three.domeMat.uniforms.uDay.value = day;
    var sdir = horizToWorld(A.sunH.alt, A.sunH.az, 1).normalize();
    three.domeMat.uniforms.uSunDir.value.copy(sdir);

    three.constLines.visible = state.show.constLines;
    three.constLines.material.opacity = 0.5 * (1 - day);
    three.constNameGroup.visible = state.show.constNames && day < 0.9;
    three.starNameGroup.visible = state.show.starNames && day < 0.7;
    three.mwMesh.visible = state.show.milkyway;
    three.mwMat.opacity = 0.85 * (1 - day);
    three.gridGroup.visible = state.show.grid;
    three.ground.visible = state.show.ground;

    // 太陽・月・惑星
    var sunV = state.show.sunMoon && A.sunH.alt > -3;
    three.sunSprite.visible = sunV; three.sunLabel.visible = sunV;
    if (sunV) {
      three.sunSprite.position.copy(horizToWorld(A.sunH.alt + Astro.refraction(A.sunH.alt), A.sunH.az, 850));
      three.sunLabel.position.copy(horizToWorld(A.sunH.alt + 4, A.sunH.az, 850));
    }
    var moonV = state.show.sunMoon && A.moonH.alt > -3;
    three.moonSprite.visible = moonV; three.moonLabel.visible = moonV;
    if (moonV) {
      updateMoonSprite();
      three.moonSprite.position.copy(horizToWorld(A.moonH.alt + Astro.refraction(A.moonH.alt), A.moonH.az, 850));
      three.moonLabel.position.copy(horizToWorld(A.moonH.alt + 3, A.moonH.az, 850));
    }
    for (var i = 0; i < A.planets.length; i++) {
      var p = A.planets[i], g = three.planetSprites[i];
      var vis = state.show.planets && p.h.alt > -2 &&
        !(state.show.atmosphere && p.mag > A.magLimit + 1);
      g.visible = vis;
      if (vis) {
        g.position.copy(horizToWorld(p.h.alt + Astro.refraction(p.h.alt), p.h.az, 850));
        var s = Math.max(10, 26 - p.mag * 5);
        g.children[0].scale.set(s, s, 1);
      }
    }
    update3dSats();
  }

  function update3dSats() {
    var grp = three.satGroup;
    while (grp.children.length) {
      var ch = grp.children.pop();
      if (ch.geometry) ch.geometry.dispose();
    }
    if (!state.show.satellites || !A.sats) return;
    for (var i = 0; i < A.sats.length; i++) {
      var s = A.sats[i];
      var trail = A.satTrails && A.satTrails[s.idx];
      if (trail) {
        var pts = [];
        for (var j = 0; j < trail.length; j++) {
          var q = trail[j];
          if (q && q.alt > 0) pts.push(horizToWorld(q.alt, q.az, 840));
        }
        if (pts.length > 1) {
          grp.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),
            new THREE.LineBasicMaterial({ color: 0x78dcb4, transparent: true, opacity: 0.4 })));
        }
      }
      if (s.cur.alt > 0) {
        var dot = makeGlowSprite("#b0ffd8", "#4cc890");
        dot.scale.set(14, 14, 1);
        dot.material.opacity = s.cur.lit ? 1 : 0.35;
        dot.position.copy(horizToWorld(s.cur.alt, s.cur.az, 840));
        grp.add(dot);
        var lb = makeTextSprite(s.name.split(" ")[0], "rgba(124,232,176,0.9)", 18);
        lb.position.copy(horizToWorld(s.cur.alt + 2.5, s.cur.az, 840));
        grp.add(lb);
      }
    }
  }

  function resize3d() {
    if (!three.ready) return;
    var cv3 = document.getElementById("canvas3d");
    var w = cv3.clientWidth, h = cv3.clientHeight;
    // 非表示中は 0 になる。aspect が NaN になって描画が壊れるので無視する。
    if (w <= 0 || h <= 0) return;
    three.renderer.setSize(w, h, false);
    three.camera.aspect = w / h;
    three.camera.updateProjectionMatrix();
  }

  // 端末姿勢 → カメラ姿勢 (three.js DeviceOrientationControls と同等の変換)
  var _gyroZee = null, _gyroEuler = null, _gyroQ0 = null, _gyroQ1 = null,
    _gyroQYaw = null, _gyroYAxis = null, _gyroQEps = null;
  function setGyroQuat(q) {
    if (!_gyroZee) {
      _gyroZee = new THREE.Vector3(0, 0, 1);
      _gyroEuler = new THREE.Euler();
      _gyroQ0 = new THREE.Quaternion();
      _gyroQ1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));
      _gyroQYaw = new THREE.Quaternion();
      _gyroYAxis = new THREE.Vector3(0, 1, 0);
      _gyroQEps = new THREE.Quaternion()
        .setFromAxisAngle(new THREE.Vector3(1, 0, 0), 2e-4);
    }
    var orient = 0;
    if (window.screen && window.screen.orientation && isFinite(window.screen.orientation.angle)) {
      orient = window.screen.orientation.angle;
    } else if (isFinite(window.orientation)) {
      orient = window.orientation;
    }
    _gyroEuler.set(gyro.b, gyro.a, -gyro.g, "YXZ");
    q.setFromEuler(_gyroEuler);
    q.multiply(_gyroQ1);
    q.multiply(_gyroQ0.setFromAxisAngle(_gyroZee, -orient * D2R));
    _gyroQYaw.setFromAxisAngle(_gyroYAxis, -gyro.offset * D2R);
    q.premultiply(_gyroQYaw);
    // 仰角が厳密に 0 (視線が地面と完全平行) の退化姿勢を避けるため、
    // カメラローカル X 軸まわりに ~0.01° の微小回転を常時加える
    q.multiply(_gyroQEps);
  }

  function render3d() {
    if (gyro.active && gyro.hasData) {
      setGyroQuat(three.camera.quaternion);
    } else {
      var yaw = three.yaw * D2R, pitch = three.pitch * D2R;
      var tgt = new THREE.Vector3(
        Math.cos(pitch) * Math.sin(yaw),
        Math.sin(pitch),
        -Math.cos(pitch) * Math.cos(yaw)
      );
      three.camera.lookAt(tgt);
    }
    updateTargetMarker3d();
    three.renderer.render(three.scene, three.camera);
  }

  function setupPointer3d(el) {
    var pointers = {}, lastDist = 0;
    el.addEventListener("pointerdown", function (e) {
      pointers[e.pointerId] = { x: e.clientX, y: e.clientY, moved: false };
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener("pointermove", function (e) {
      var p = pointers[e.pointerId];
      if (!p) return;
      var ids = Object.keys(pointers);
      if (ids.length === 1) {
        var dx = e.clientX - p.x, dy = e.clientY - p.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) p.moved = true;
        var scale = three.camera.fov / el.clientHeight;
        if (gyro.active) {
          gyro.offset -= dx * scale;   // センサー動作中は方位補正のみ
        } else {
          anim = null;
          three.yaw -= dx * scale;
          three.pitch += dy * scale;
          three.pitch = Math.max(-30, Math.min(89.5, three.pitch));
        }
        p.x = e.clientX; p.y = e.clientY;
        dirty = true;
      } else if (ids.length === 2) {
        p.x = e.clientX; p.y = e.clientY;
        var a = pointers[ids[0]], b = pointers[ids[1]];
        var d = Math.hypot(a.x - b.x, a.y - b.y);
        if (lastDist > 0) {
          three.camera.fov = Math.max(20, Math.min(110, three.camera.fov * lastDist / d));
          three.camera.updateProjectionMatrix();
          dirty = true;
        }
        lastDist = d;
        a.moved = b.moved = true;
      }
    });
    function up(e) {
      var p = pointers[e.pointerId];
      if (p && !p.moved) pick3d(e.clientX, e.clientY);
      delete pointers[e.pointerId];
      lastDist = 0;
    }
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", function (e) { delete pointers[e.pointerId]; lastDist = 0; });
    el.addEventListener("wheel", function (e) {
      e.preventDefault();
      three.camera.fov = Math.max(20, Math.min(110, three.camera.fov * (e.deltaY > 0 ? 1.08 : 0.93)));
      three.camera.updateProjectionMatrix();
      dirty = true;
    }, { passive: false });
  }

  // ================= 天体ピック =================
  function angularSep(alt1, az1, alt2, az2) {
    var a1 = alt1 * D2R, a2 = alt2 * D2R, dz = (az1 - az2) * D2R;
    var c = Math.sin(a1) * Math.sin(a2) + Math.cos(a1) * Math.cos(a2) * Math.cos(dz);
    return Math.acos(Math.max(-1, Math.min(1, c))) * R2D;
  }

  function collectPickables() {
    var out = [];
    var maglim = state.show.atmosphere ? A.magLimit : 6.3;
    for (var i = 0; i < N; i++) {
      if (starMag[i] > Math.min(maglim, 4.5)) continue;
      var h = horizAllSky(starRA[i], starDec[i]);
      if (h.alt < 0) continue;
      out.push({
        type: "star", alt: h.alt, az: h.az, mag: starMag[i],
        name: starNameMap[i] || ("HYG星 (等級" + starMag[i].toFixed(1) + ")")
      });
    }
    if (state.show.planets) A.planets.forEach(function (p) {
      if (p.h.alt > 0) out.push({ type: "planet", alt: p.h.alt, az: p.h.az, mag: p.mag, name: p.ja, extra: "距離 " + p.distAu.toFixed(2) + " au" });
    });
    if (state.show.sunMoon) {
      if (A.sunH.alt > 0) out.push({ type: "sun", alt: A.sunH.alt, az: A.sunH.az, mag: -26.7, name: "太陽" });
      if (A.moonH.alt > 0) out.push({
        type: "moon", alt: A.moonH.alt, az: A.moonH.az, mag: -12,
        name: "月", extra: "月齢 " + A.phase.age.toFixed(1) + " / 輝面比 " + Math.round(A.phase.illum * 100) + "%"
      });
    }
    if (state.show.satellites && A.sats) A.sats.forEach(function (s) {
      if (s.cur.alt > 0) out.push({
        type: "sat", alt: s.cur.alt, az: s.cur.az, mag: null, name: s.name,
        extra: "距離 " + Math.round(s.cur.range) + " km" + (s.cur.lit ? " / 太陽光照射" : " / 地球の影")
      });
    });
    return out;
  }

  function showObjInfo(obj, x, y) {
    var el = document.getElementById("objinfo");
    var html = "<b>" + obj.name + "</b><br>";
    if (obj.mag !== null && obj.mag !== undefined) html += "等級 " + obj.mag.toFixed(1) + "<br>";
    html += "高度 " + obj.alt.toFixed(1) + "° / 方位 " + obj.az.toFixed(1) + "°";
    if (obj.extra) html += "<br>" + obj.extra;
    el.innerHTML = html;
    el.style.display = "block";
    var W = window.innerWidth;
    el.style.left = Math.min(x + 12, W - 200) + "px";
    el.style.top = Math.max(50, y - 70) + "px";
    clearTimeout(showObjInfo._t);
    showObjInfo._t = setTimeout(function () { el.style.display = "none"; }, 5000);
  }

  function pick2d(x, y) {
    var cands = collectPickables();
    var best = null, bestD = 24;
    for (var i = 0; i < cands.length; i++) {
      var p = proj2d(cands[i].alt, cands[i].az);
      var d = Math.hypot(p[0] - x, p[1] - y);
      var bonus = cands[i].type === "star" ? 0 : 6;
      if (d - bonus < bestD) { bestD = d - bonus; best = cands[i]; }
    }
    if (best) showObjInfo(best, x, y);
  }

  function pick3d(x, y) {
    var el = three.renderer.domElement;
    var rect = el.getBoundingClientRect();
    var nx = ((x - rect.left) / rect.width) * 2 - 1;
    var ny = -((y - rect.top) / rect.height) * 2 + 1;
    var v = new THREE.Vector3(nx, ny, 0.5).unproject(three.camera)
      .sub(three.camera.position).normalize();
    var alt = Math.asin(v.y) * R2D;
    var az = Astro.norm360(Math.atan2(v.x, -v.z) * R2D);
    var cands = collectPickables();
    var best = null, bestD = 2.5 * (three.camera.fov / 70);
    for (var i = 0; i < cands.length; i++) {
      var d = angularSep(alt, az, cands[i].alt, cands[i].az);
      var bonus = cands[i].type === "star" ? 0 : 0.8;
      if (d - bonus < bestD) { bestD = d - bonus; best = cands[i]; }
    }
    if (best) showObjInfo(best, x, y);
  }

  // ================= 検索ターゲット =================
  function targetInfo() {
    if (!target) return null;
    var h;
    switch (target.type) {
      case "star":
        h = horizAllSky(starRA[target.i], starDec[target.i]);
        return { alt: h.alt, az: h.az, name: target.name };
      case "const":
        h = horizAllSky(target.ra, target.dec);
        return { alt: h.alt, az: h.az, name: target.name };
      case "planet":
        for (var i = 0; i < A.planets.length; i++) {
          if (A.planets[i].name === target.key) {
            return { alt: A.planets[i].h.alt, az: A.planets[i].h.az, name: target.name };
          }
        }
        return null;
      case "sun": return { alt: A.sunH.alt, az: A.sunH.az, name: "太陽" };
      case "moon": return { alt: A.moonH.alt, az: A.moonH.az, name: "月" };
      case "sat":
        var la = satLookAngles(sats[target.i].rec, new Date(simTime()));
        if (!la) return null;
        return { alt: la.alt, az: la.az, name: target.name };
    }
    return null;
  }

  function updateTargetMarker3d() {
    var arrow = document.getElementById("dirarrow");
    if (!three.ready) return;
    if (!three.targetRing) {
      var c = document.createElement("canvas");
      c.width = c.height = 64;
      var cc = c.getContext("2d");
      cc.strokeStyle = "#e6b422"; cc.lineWidth = 4;
      cc.beginPath(); cc.arc(32, 32, 24, 0, Math.PI * 2); cc.stroke();
      cc.beginPath(); cc.arc(32, 32, 6, 0, Math.PI * 2); cc.stroke();
      three.targetRing = new THREE.Sprite(new THREE.SpriteMaterial({
        map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false
      }));
      three.scene.add(three.targetRing);
      three.targetLabel = null;
    }
    var ti = target ? targetInfo() : null;
    if (!ti) {
      three.targetRing.visible = false;
      if (three.targetLabel) three.targetLabel.visible = false;
      arrow.style.display = "none";
      return;
    }
    var pos = horizToWorld(ti.alt, ti.az, 820);
    var pulse = 1 + 0.18 * Math.sin(performance.now() / 220);
    three.targetRing.visible = true;
    three.targetRing.position.copy(pos);
    three.targetRing.scale.set(46 * pulse, 46 * pulse, 1);
    if (!three.targetLabel || three.targetLabelText !== ti.name) {
      if (three.targetLabel) three.scene.remove(three.targetLabel);
      three.targetLabel = makeTextSprite(ti.name, "rgba(230,180,34,0.95)", 24);
      three.targetLabelText = ti.name;
      three.scene.add(three.targetLabel);
    }
    three.targetLabel.visible = true;
    three.targetLabel.position.copy(horizToWorld(ti.alt + 4.5, ti.az, 820));
    // 画面外なら方向矢印
    var v = pos.clone().normalize()
      .applyQuaternion(three.camera.quaternion.clone().invert());
    var ang = Math.acos(Math.max(-1, Math.min(1, -v.z))) * R2D;
    if (ang > three.camera.fov * 0.55) {
      var sa = Math.atan2(-v.y, v.x); // CSS座標系 (y下向き) の角度
      arrow.style.display = "block";
      arrow.firstElementChild.style.transform =
        "rotate(" + sa + "rad) translateX(110px) translateY(-13px)";
    } else {
      arrow.style.display = "none";
    }
  }

  // 3D 視線移動アニメーション
  function startGoTo(ti) {
    if (!three.ready || gyro.active) return;
    var toPitch = Math.max(-25, Math.min(89, ti.alt));
    var cur = Astro.norm360(three.yaw % 360);
    var d = ti.az - cur;
    while (d > 180) d -= 360;
    while (d < -180) d += 360;
    anim = {
      t0: performance.now(), dur: 900,
      fy: three.yaw, fp: three.pitch,
      ty: three.yaw + d, tp: toPitch
    };
  }

  // ================= 検索 =================
  var STAR_ALIASES = {
    "シリウス": "Sirius", "カノープス": "Canopus", "アークトゥルス": "Arcturus",
    "ベガ": "Vega", "織姫": "Vega", "カペラ": "Capella", "リゲル": "Rigel",
    "プロキオン": "Procyon", "ベテルギウス": "Betelgeuse", "アケルナル": "Achernar",
    "アルタイル": "Altair", "彦星": "Altair", "アルデバラン": "Aldebaran",
    "スピカ": "Spica", "アンタレス": "Antares", "ポルックス": "Pollux",
    "フォーマルハウト": "Fomalhaut", "デネブ": "Deneb", "レグルス": "Regulus",
    "北極星": "Polaris", "ポラリス": "Polaris", "カストル": "Castor",
    "アルゴル": "Algol", "ミザール": "Mizar", "アルビレオ": "Albireo",
    "ミラ": "Mira", "コルカロリ": "Cor Caroli", "デネボラ": "Denebola"
  };
  function normQuery(s) {
    return s.toLowerCase().replace(/[ァ-ヶ]/g, function (c) {
      return String.fromCharCode(c.charCodeAt(0) - 0x60);
    }).replace(/[\s　]+/g, "");
  }
  var catalog = null;
  function buildCatalog() {
    if (catalog) return;
    catalog = [];
    var properToJa = {};
    for (var ja in STAR_ALIASES) {
      if (!properToJa[STAR_ALIASES[ja]]) properToJa[STAR_ALIASES[ja]] = ja;
    }
    catalog.push({ type: "sun", disp: "太陽", keys: ["たいよう", "sun", "太陽"], pri: 0 });
    catalog.push({ type: "moon", disp: "月", keys: ["つき", "moon", "月"], pri: 0 });
    var latinPlanets = {
      Mercury: "mercury", Venus: "venus", Mars: "mars", Jupiter: "jupiter",
      Saturn: "saturn", Uranus: "uranus", Neptune: "neptune"
    };
    A.planets.forEach(function (p) {
      catalog.push({ type: "planet", key: p.name, disp: p.ja, keys: [normQuery(p.ja), latinPlanets[p.name], p.ja], pri: 0 });
    });
    sats.forEach(function (s, i) {
      var keys = [normQuery(s.name)];
      if (s.name.indexOf("ISS") >= 0) keys.push("iss", "こくさいうちゅうすてーしょん");
      if (s.name.indexOf("CSS") >= 0) keys.push("css", "てんわ", "ちゅうごく");
      if (s.name.indexOf("ハッブル") >= 0) keys.push("hst", "はっぶる");
      catalog.push({ type: "sat", i: i, disp: s.name, keys: keys, pri: 1 });
    });
    PLANET_DATA.starNames.forEach(function (e) {
      var proper = e[1];
      var ja = properToJa[proper];
      var keys = [normQuery(proper)];
      if (ja) keys.push(normQuery(ja), ja);
      catalog.push({
        type: "star", i: e[0], disp: ja ? ja + " (" + proper + ")" : proper,
        keys: keys, mag: starMag[e[0]], pri: 2
      });
    });
    PLANET_DATA.constNames.forEach(function (cn) {
      catalog.push({
        type: "const", ra: cn[2] / 100, dec: cn[3] / 100, disp: cn[0],
        keys: [normQuery(cn[0]), normQuery(cn[1]), cn[0]], pri: 1
      });
    });
  }

  var TYPE_LABEL = { sun: "太陽", moon: "月", planet: "惑星", star: "恒星", const: "星座", sat: "衛星" };
  function searchEntries(q) {
    var nq = normQuery(q);
    if (!nq) return [];
    var hits = [];
    for (var i = 0; i < catalog.length; i++) {
      var e = catalog[i], best = -1;
      for (var k = 0; k < e.keys.length; k++) {
        var key = e.keys[k];
        if (!key) continue;
        var idx = key.indexOf(nq);
        if (idx === 0) { best = 0; break; }
        if (idx > 0 && best < 0) best = 1;
      }
      if (best >= 0) hits.push({ e: e, rank: best });
    }
    hits.sort(function (a, b) {
      return (a.rank - b.rank) || (a.e.pri - b.e.pri) ||
        ((a.e.mag || 99) - (b.e.mag || 99));
    });
    return hits.slice(0, 14).map(function (h) { return h.e; });
  }

  function entryHoriz(e) {
    switch (e.type) {
      case "star": return horizAllSky(starRA[e.i], starDec[e.i]);
      case "const": return horizAllSky(e.ra, e.dec);
      case "planet":
        for (var i = 0; i < A.planets.length; i++) {
          if (A.planets[i].name === e.key) return A.planets[i].h;
        }
        return null;
      case "sun": return A.sunH;
      case "moon": return A.moonH;
      case "sat": return satLookAngles(sats[e.i].rec, new Date(simTime()));
    }
    return null;
  }

  function renderResults(list) {
    var box = document.getElementById("searchresults");
    box.innerHTML = "";
    if (!list.length) {
      var q = document.getElementById("searchinput").value;
      if (q.trim()) {
        var d = document.createElement("div");
        d.className = "sr-empty";
        d.textContent = "該当なし";
        box.appendChild(d);
      }
      return;
    }
    list.forEach(function (e) {
      var h = entryHoriz(e);
      var row = document.createElement("div");
      row.className = "sr-row" + (h && h.alt < 0 ? " below" : "");
      var t = document.createElement("span");
      t.className = "sr-type"; t.textContent = TYPE_LABEL[e.type];
      var n = document.createElement("span");
      n.textContent = e.disp;
      var sub = document.createElement("span");
      sub.className = "sr-sub";
      sub.textContent = h ? (h.alt >= 0 ? "高度 " + h.alt.toFixed(0) + "°" : "地平線下") : "";
      row.appendChild(t); row.appendChild(n); row.appendChild(sub);
      row.addEventListener("click", function () { selectEntry(e); });
      box.appendChild(row);
    });
  }

  function selectEntry(e) {
    target = { type: e.type, key: e.key, i: e.i, ra: e.ra, dec: e.dec, name: e.disp };
    document.getElementById("searchbox").classList.add("hidden");
    var ti = targetInfo();
    if (ti && state.view === "3d") startGoTo(ti);
    dirty = true;
  }

  function toggleSearch() {
    var box = document.getElementById("searchbox");
    if (box.classList.contains("hidden")) {
      buildCatalog();
      box.classList.remove("hidden");
      var inp = document.getElementById("searchinput");
      renderResults(searchEntries(inp.value));
      inp.focus();
    } else {
      box.classList.add("hidden");
    }
  }

  // ================= 方位センサー =================
  function onDevOrient(e) {
    if (e.alpha === null || e.alpha === undefined) return;
    var alpha = e.alpha;
    if (typeof e.webkitCompassHeading === "number" && !gyro.gotAbs) {
      alpha = 360 - e.webkitCompassHeading;  // iOS: コンパス絶対方位
    }
    gyro.a = alpha * D2R;
    gyro.b = (e.beta || 0) * D2R;
    gyro.g = (e.gamma || 0) * D2R;
    gyro.hasData = true;
    if (gyro.active) dirty = true;
  }
  function startGyroListen() {
    if (gyro.listening) return;
    gyro.listening = true;
    if ("ondeviceorientationabsolute" in window) {
      window.addEventListener("deviceorientationabsolute", function (e) {
        // データ無しの初回イベント (alpha=null) で絶対方位モードに固定しない
        if (e.absolute && e.alpha !== null && e.alpha !== undefined) {
          gyro.gotAbs = true;
          onDevOrient(e);
        }
      });
    }
    window.addEventListener("deviceorientation", function (e) {
      if (gyro.gotAbs) return;
      onDevOrient(e);
    });
  }
  function setGyro(on) {
    if (on) {
      if (!window.DeviceOrientationEvent) {
        alert("この端末・ブラウザは姿勢センサー API に対応していません");
        return;
      }
      setView("3d");
      var req = DeviceOrientationEvent.requestPermission;
      var proceed = function () {
        startGyroListen();
        gyro.active = true;
        gyro.offset = 0;
        document.getElementById("btn-gyro").classList.add("active");
        dirty = true;
        setTimeout(function () {
          if (gyro.active && !gyro.hasData) {
            setGyro(false);
            alert("姿勢センサーのデータを取得できません。センサー非対応の端末か、許可がない可能性があります。");
          }
        }, 4000);
      };
      if (typeof req === "function") {
        req.call(DeviceOrientationEvent).then(function (r) {
          if (r === "granted") proceed();
          else alert("センサー利用が許可されませんでした");
        }).catch(function () {
          alert("センサー許可を要求できません。https 経由で開くと利用できる場合があります。");
        });
      } else {
        proceed();
      }
    } else {
      // 現在の視線を yaw/pitch に引き継ぐ
      if (gyro.active && gyro.hasData && three.ready) {
        var d = new THREE.Vector3(0, 0, -1).applyQuaternion(three.camera.quaternion);
        three.yaw = Math.atan2(d.x, -d.z) * R2D;
        three.pitch = Math.asin(Math.max(-1, Math.min(1, d.y))) * R2D;
        three.pitch = Math.max(-30, Math.min(89.5, three.pitch));
      }
      gyro.active = false;
      document.getElementById("btn-gyro").classList.remove("active");
      dirty = true;
    }
  }

  // ================= 2D 入力 =================
  (function () {
    var pointers = {}, lastDist = 0, panStart = null;
    cv2.addEventListener("pointerdown", function (e) {
      pointers[e.pointerId] = { x: e.clientX, y: e.clientY, moved: false };
      cv2.setPointerCapture(e.pointerId);
    });
    cv2.addEventListener("pointermove", function (e) {
      var p = pointers[e.pointerId];
      if (!p) return;
      var ids = Object.keys(pointers);
      if (ids.length === 1 && view2.zoom > 1.01) {
        var dx = e.clientX - p.x, dy = e.clientY - p.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) p.moved = true;
        view2.panX += dx; view2.panY += dy;
        clampPan();
        p.x = e.clientX; p.y = e.clientY;
        dirty = true;
      } else if (ids.length === 2) {
        p.x = e.clientX; p.y = e.clientY;
        var a = pointers[ids[0]], b = pointers[ids[1]];
        var d = Math.hypot(a.x - b.x, a.y - b.y);
        if (lastDist > 0) {
          view2.zoom = Math.max(1, Math.min(4, view2.zoom * d / lastDist));
          clampPan();
          dirty = true;
        }
        lastDist = d;
        a.moved = b.moved = true;
      }
    });
    function clampPan() {
      var max = Math.min(view2.W, view2.H) * 0.46 * (view2.zoom - 1) + 40;
      view2.panX = Math.max(-max, Math.min(max, view2.panX));
      view2.panY = Math.max(-max, Math.min(max, view2.panY));
      if (view2.zoom <= 1.01) { view2.panX = view2.panY = 0; }
    }
    cv2.addEventListener("pointerup", function (e) {
      var p = pointers[e.pointerId];
      if (p && !p.moved) pick2d(e.clientX, e.clientY);
      delete pointers[e.pointerId];
      lastDist = 0;
    });
    cv2.addEventListener("pointercancel", function (e) { delete pointers[e.pointerId]; lastDist = 0; });
    cv2.addEventListener("wheel", function (e) {
      e.preventDefault();
      view2.zoom = Math.max(1, Math.min(4, view2.zoom * (e.deltaY > 0 ? 0.92 : 1.09)));
      clampPan();
      dirty = true;
    }, { passive: false });
  })();

  // ================= UI =================
  function $(id) { return document.getElementById(id); }
  var dirty = true;

  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function fmtLocal(ms) {
    var d = new Date(ms);
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate())
      + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }
  function fmtForInput(ms) {
    var d = new Date(ms);
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate())
      + "T" + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }

  function updateTimeLabel() {
    var t = simTime();
    var off = state.offsetMin;
    var sign = off >= 0 ? "+" : "−";
    var oh = Math.floor(Math.abs(off) / 60), om = Math.abs(off) % 60;
    $("timelabel").innerHTML = fmtLocal(t) +
      " <small>(" + sign + pad(oh) + ":" + pad(om) + ")</small>";
    $("infoline").innerHTML =
      "緯度 " + state.lat.toFixed(3) + "° / 経度 " + state.lon.toFixed(3) + "°<br>" +
      "恒星時 " + (A.lst / 15).toFixed(2) + "h ・ 月齢 " + A.phase.age.toFixed(1) +
      " ・ 太陽高度 " + A.sunH.alt.toFixed(1) + "°";
  }

  function refresh() {
    computeAstro();
    updateTimeLabel();
    dirty = true;
  }

  // ビュー切替
  function setView(v) {
    state.view = v;
    $("btn-2d").classList.toggle("active", v === "2d");
    $("btn-3d").classList.toggle("active", v === "3d");
    $("canvas2d").classList.toggle("hidden", v !== "2d");
    $("canvas3d").classList.toggle("hidden", v !== "3d");
    // 非表示中のリサイズ (端末回転・URL バーの開閉など) は反映できないため、
    // 表示に戻したこの時点でキャンバスのサイズを測り直す。
    if (v === "3d") { init3d(); resize3d(); }
    else resize2d();
    dirty = true;
  }
  $("btn-2d").addEventListener("click", function () { setView("2d"); });
  $("btn-3d").addEventListener("click", function () { setView("3d"); });

  // 設定パネル
  $("btn-settings").addEventListener("click", function () { $("panel").classList.add("open"); });
  $("panel-close").addEventListener("click", function () { $("panel").classList.remove("open"); });

  // 検索・方位センサー
  $("btn-search").addEventListener("click", toggleSearch);
  $("searchinput").addEventListener("input", function () {
    renderResults(searchEntries(this.value));
  });
  $("search-clear").addEventListener("click", function () {
    target = null;
    $("searchinput").value = "";
    renderResults([]);
    $("searchbox").classList.add("hidden");
    dirty = true;
  });
  $("btn-gyro").addEventListener("click", function () { setGyro(!gyro.active); });

  // 日時
  $("dtinput").value = fmtForInput(state.baseTime);
  $("dtinput").addEventListener("change", function () {
    var v = this.value;
    if (!v) return;
    state.baseTime = new Date(v).getTime();
    refresh();
  });
  $("btn-now").addEventListener("click", function () {
    state.baseTime = Date.now();
    state.offsetMin = 0;
    $("timeslider").value = 0;
    $("dtinput").value = fmtForInput(state.baseTime);
    refresh();
  });

  // 位置
  $("latinput").value = state.lat;
  $("loninput").value = state.lon;
  function onLoc() {
    var la = parseFloat($("latinput").value), lo = parseFloat($("loninput").value);
    if (isFinite(la) && Math.abs(la) <= 90) state.lat = la;
    if (isFinite(lo) && Math.abs(lo) <= 180) state.lon = lo;
    refresh();
  }
  $("latinput").addEventListener("change", onLoc);
  $("loninput").addEventListener("change", onLoc);
  var PRESETS = [
    ["東京", 35.6895, 139.6917], ["大阪", 34.6937, 135.5023], ["札幌", 43.0618, 141.3545],
    ["名古屋", 35.1815, 136.9066], ["福岡", 33.5902, 130.4017], ["那覇", 26.2124, 127.6809],
    ["ロンドン", 51.5074, -0.1278], ["ニューヨーク", 40.7128, -74.0060],
    ["シドニー", -33.8688, 151.2093], ["ホノルル", 21.3069, -157.8583]
  ];
  var sel = $("citysel");
  PRESETS.forEach(function (p, i) {
    var o = document.createElement("option");
    o.value = i; o.textContent = p[0];
    sel.appendChild(o);
  });
  sel.addEventListener("change", function () {
    var p = PRESETS[this.value];
    if (!p) return;
    state.lat = p[1]; state.lon = p[2];
    $("latinput").value = p[1]; $("loninput").value = p[2];
    refresh();
  });
  $("btn-geo").addEventListener("click", function () {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(function (pos) {
      state.lat = Math.round(pos.coords.latitude * 10000) / 10000;
      state.lon = Math.round(pos.coords.longitude * 10000) / 10000;
      $("latinput").value = state.lat; $("loninput").value = state.lon;
      refresh();
    }, function () { alert("現在地を取得できませんでした"); });
  });

  // トグル
  var TOGGLES = [
    ["tg-constlines", "constLines"], ["tg-constnames", "constNames"],
    ["tg-starnames", "starNames"], ["tg-planets", "planets"],
    ["tg-sunmoon", "sunMoon"], ["tg-milkyway", "milkyway"],
    ["tg-sats", "satellites"], ["tg-grid", "grid"],
    ["tg-ground", "ground"], ["tg-atmo", "atmosphere"]
  ];
  TOGGLES.forEach(function (t) {
    var el = $(t[0]);
    el.checked = state.show[t[1]];
    el.addEventListener("change", function () {
      state.show[t[1]] = el.checked;
      if (t[1] === "satellites") satTrailT = -1e18;
      refresh();
    });
  });

  // タイムスライダー
  $("timeslider").addEventListener("input", function () {
    state.offsetMin = parseInt(this.value, 10);
    refresh();
  });
  $("btn-play").addEventListener("click", function () {
    state.playing = !state.playing;
    this.textContent = state.playing ? "❚❚" : "▶";
    this.classList.toggle("active", state.playing);
  });
  $("speed").addEventListener("change", function () {
    state.speed = parseFloat(this.value);
  });

  // ================= メインループ =================
  var lastFrame = performance.now(), lastInputSync = 0, lastPulse = 0;
  function loop(now) {
    requestAnimationFrame(loop);
    var dt = (now - lastFrame) / 1000;
    lastFrame = now;
    // 視線移動アニメーション
    if (anim && state.view === "3d" && !gyro.active) {
      var at = (now - anim.t0) / anim.dur;
      if (at >= 1) {
        three.yaw = anim.ty; three.pitch = anim.tp; anim = null;
      } else {
        var s = at < 0.5 ? 2 * at * at : 1 - Math.pow(-2 * at + 2, 2) / 2;
        three.yaw = anim.fy + (anim.ty - anim.fy) * s;
        three.pitch = anim.fp + (anim.tp - anim.fp) * s;
      }
      dirty = true;
    }
    // 2D ターゲットマーカーの点滅再描画
    if (target && state.view === "2d" && now - lastPulse > 66) {
      lastPulse = now;
      dirty = true;
    }
    if (state.playing) {
      state.baseTime += dt * 1000 * state.speed;
      if (now - lastInputSync > 500) {
        $("dtinput").value = fmtForInput(state.baseTime);
        lastInputSync = now;
      }
      refresh();
    }
    if (dirty) {
      dirty = false;
      if (state.view === "2d") draw2d();
      else { update3d(); render3d(); }
    } else if (state.view === "3d" && three.ready) {
      render3d();
    }
  }

  window.addEventListener("resize", function () { resize2d(); resize3d(); dirty = true; });

  // デバッグ用フック (開発・検証時のみ使用)
  window.__dbg = { three: three, gyro: gyro, state: state, astro: A };

  // 初期化
  computeAstro();
  resize2d();
  updateTimeLabel();
  setView("2d");
  requestAnimationFrame(loop);
})();
