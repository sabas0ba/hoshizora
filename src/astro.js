// astro.js - 天文計算エンジン
// 参考: Meeus "Astronomical Algorithms" 2nd ed.,
//       Standish (JPL) "Keplerian Elements for Approximate Positions of the Major Planets"
// 精度目標: 恒星 <0.1°, 太陽 <0.01°, 月 <0.3°(+視差補正), 惑星 <数分角。表示用途には十分。

var Astro = (function () {
  var D2R = Math.PI / 180;
  var R2D = 180 / Math.PI;

  function frac(x) { return x - Math.floor(x); }
  function norm360(x) { x = x % 360; return x < 0 ? x + 360 : x; }

  // ---- 時刻 ----
  function julianDate(dateMs) {
    return dateMs / 86400000 + 2440587.5;
  }
  // グリニッジ平均恒星時 [deg]
  function gmst(jd) {
    var T = (jd - 2451545.0) / 36525.0;
    var g = 280.46061837 + 360.98564736629 * (jd - 2451545.0)
      + 0.000387933 * T * T - T * T * T / 38710000.0;
    return norm360(g);
  }
  // 地方恒星時 [deg] (東経正)
  function lst(jd, lonDeg) {
    return norm360(gmst(jd) + lonDeg);
  }

  // 平均黄道傾斜角 [deg]
  function obliquity(jd) {
    var T = (jd - 2451545.0) / 36525.0;
    return 23.43929111 - 0.0130042 * T - 1.64e-7 * T * T + 5.04e-7 * T * T * T;
  }

  // 黄道座標 (λ, β deg) → 赤道座標 {ra, dec} [deg]
  function eclToEq(lam, beta, jd) {
    var e = obliquity(jd) * D2R;
    var l = lam * D2R, b = beta * D2R;
    var sl = Math.sin(l), cl = Math.cos(l);
    var sb = Math.sin(b), cb = Math.cos(b), tb = Math.tan(b);
    var ra = Math.atan2(sl * Math.cos(e) - tb * Math.sin(e), cl);
    var dec = Math.asin(sb * Math.cos(e) + cb * Math.sin(e) * sl);
    return { ra: norm360(ra * R2D), dec: dec * R2D };
  }

  // 赤道座標 → 地平座標 {alt, az} [deg] az: 北=0 東=90
  function eqToHorizontal(raDeg, decDeg, lstDeg, latDeg) {
    var H = (lstDeg - raDeg) * D2R;
    var lat = latDeg * D2R, dec = decDeg * D2R;
    var sinAlt = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(H);
    var alt = Math.asin(Math.max(-1, Math.min(1, sinAlt)));
    var az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(lat) - Math.tan(dec) * Math.cos(lat));
    return { alt: alt * R2D, az: norm360(az * R2D + 180) };
  }

  // 大気差 (Bennett) 真高度→視高度の加算分 [deg]
  function refraction(altDeg) {
    if (altDeg < -1) return 0;
    var R = 1.0 / Math.tan((altDeg + 7.31 / (altDeg + 4.4)) * D2R); // arcmin
    return R / 60.0;
  }

  // ---- 太陽 (Meeus ch.25 低精度) ----
  function sunPosition(jd) {
    var T = (jd - 2451545.0) / 36525.0;
    var L0 = norm360(280.46646 + 36000.76983 * T + 0.0003032 * T * T);
    var M = norm360(357.52911 + 35999.05029 * T - 0.0001537 * T * T);
    var e = 0.016708634 - 0.000042037 * T - 0.0000001267 * T * T;
    var Mr = M * D2R;
    var C = (1.914602 - 0.004817 * T - 0.000014 * T * T) * Math.sin(Mr)
      + (0.019993 - 0.000101 * T) * Math.sin(2 * Mr)
      + 0.000289 * Math.sin(3 * Mr);
    var trueLon = L0 + C;
    var nu = M + C;
    var Rdist = 1.000001018 * (1 - e * e) / (1 + e * Math.cos(nu * D2R)); // au
    var Om = 125.04 - 1934.136 * T;
    var lam = trueLon - 0.00569 - 0.00478 * Math.sin(Om * D2R); // 視黄経
    var eq = eclToEq(norm360(lam), 0, jd);
    return { ra: eq.ra, dec: eq.dec, dist: Rdist, eclLon: norm360(lam) };
  }

  // ---- 月 (Meeus ch.47 主要項のみ) ----
  var MOON_L = [ // [D, M, Mp, F, coefL(1e-6 deg), coefR(1e-3 km)]
    [0, 0, 1, 0, 6288774, -20905355],
    [2, 0, -1, 0, 1274027, -3699111],
    [2, 0, 0, 0, 658314, -2955968],
    [0, 0, 2, 0, 213618, -569925],
    [0, 1, 0, 0, -185116, 48888],
    [0, 0, 0, 2, -114332, -3149],
    [2, 0, -2, 0, 58793, 246158],
    [2, -1, -1, 0, 57066, -152138],
    [2, 0, 1, 0, 53322, -170733],
    [2, -1, 0, 0, 45758, -204586],
    [0, 1, -1, 0, -40923, -129620],
    [1, 0, 0, 0, -34720, 108743],
    [0, 1, 1, 0, -30383, 104755],
    [2, 0, 0, -2, 15327, 10321],
    [0, 0, 1, 2, -12528, 0],
    [0, 0, 1, -2, 10980, 79661],
    [4, 0, -1, 0, 10675, -34782],
    [0, 0, 3, 0, 10034, -23210],
    [4, 0, -2, 0, 8548, -21636],
    [2, 1, -1, 0, -7888, 24208],
    [2, 1, 0, 0, -6766, 30824],
    [1, 0, -1, 0, -5163, -8379],
    [1, 1, 0, 0, 4987, -16675],
    [2, -1, 1, 0, 4036, -12831],
    [2, 0, 2, 0, 3994, -10445],
    [4, 0, 0, 0, 3861, -11650],
    [2, 0, -3, 0, 3665, 14403]
  ];
  var MOON_B = [ // [D, M, Mp, F, coefB(1e-6 deg)]
    [0, 0, 0, 1, 5128122],
    [0, 0, 1, 1, 280602],
    [0, 0, 1, -1, 277693],
    [2, 0, 0, -1, 173237],
    [2, 0, -1, 1, 55413],
    [2, 0, -1, -1, 46271],
    [2, 0, 0, 1, 32573],
    [0, 0, 2, 1, 17198],
    [2, 0, 1, -1, 9266],
    [0, 0, 2, -1, 8822],
    [2, -1, 0, -1, 8216],
    [2, 0, -2, -1, 4324],
    [2, 0, 1, 1, 4200],
    [2, 1, 0, -1, -3359],
    [2, -1, -1, 1, 2463],
    [2, -1, 0, 1, 2211],
    [2, -1, -1, -1, 2065]
  ];

  function moonPosition(jd) {
    var T = (jd - 2451545.0) / 36525.0;
    var Lp = norm360(218.3164477 + 481267.88123421 * T - 0.0015786 * T * T + T * T * T / 538841.0);
    var D = norm360(297.8501921 + 445267.1114034 * T - 0.0018819 * T * T + T * T * T / 545868.0);
    var M = norm360(357.5291092 + 35999.0502909 * T - 0.0001536 * T * T);
    var Mp = norm360(134.9633964 + 477198.8675055 * T + 0.0087414 * T * T + T * T * T / 69699.0);
    var F = norm360(93.2720950 + 483202.0175233 * T - 0.0036539 * T * T - T * T * T / 3526000.0);
    var E = 1 - 0.002516 * T - 0.0000074 * T * T;

    var sumL = 0, sumR = 0, sumB = 0;
    var i, t, arg, ef;
    for (i = 0; i < MOON_L.length; i++) {
      t = MOON_L[i];
      arg = (t[0] * D + t[1] * M + t[2] * Mp + t[3] * F) * D2R;
      ef = t[1] === 0 ? 1 : (Math.abs(t[1]) === 1 ? E : E * E);
      sumL += t[4] * ef * Math.sin(arg);
      sumR += t[5] * ef * Math.cos(arg);
    }
    for (i = 0; i < MOON_B.length; i++) {
      t = MOON_B[i];
      arg = (t[0] * D + t[1] * M + t[2] * Mp + t[3] * F) * D2R;
      ef = t[1] === 0 ? 1 : (Math.abs(t[1]) === 1 ? E : E * E);
      sumB += t[4] * ef * Math.sin(arg);
    }
    // 金星・木星等による主要摂動 (Meeus A1,A2,A3)
    var A1 = norm360(119.75 + 131.849 * T);
    var A2 = norm360(53.09 + 479264.290 * T);
    var A3 = norm360(313.45 + 481266.484 * T);
    sumL += 3958 * Math.sin(A1 * D2R) + 1962 * Math.sin((Lp - F) * D2R) + 318 * Math.sin(A2 * D2R);
    sumB += -2235 * Math.sin(Lp * D2R) + 382 * Math.sin(A3 * D2R)
      + 175 * Math.sin((A1 - F) * D2R) + 175 * Math.sin((A1 + F) * D2R)
      + 127 * Math.sin((Lp - Mp) * D2R) - 115 * Math.sin((Lp + Mp) * D2R);

    var lam = norm360(Lp + sumL / 1e6);
    var beta = sumB / 1e6;
    var dist = 385000.56 + sumR / 1000.0; // km
    var eq = eclToEq(lam, beta, jd);
    var parallax = Math.asin(6378.14 / dist) * R2D;
    return { ra: eq.ra, dec: eq.dec, dist: dist, parallax: parallax, eclLon: lam, meanElong: D };
  }

  // 月齢 [日] と輝面比 (0..1)
  function moonPhase(jd, sun, moon) {
    // 位相角 i: 太陽-月の黄経差から近似
    var elong = Math.acos(
      Math.cos((moon.eclLon - sun.eclLon) * D2R) * 1.0
    ) * R2D; // β 無視の近似
    var k = (1 - Math.cos((moon.eclLon - sun.eclLon) * D2R)) / 2;
    var age = norm360(moon.meanElong) / 360.0 * 29.530588853;
    var waxing = norm360(moon.eclLon - sun.eclLon) < 180;
    return { age: age, illum: k, waxing: waxing, elong: elong };
  }

  // ---- 惑星 (Standish 近似ケプラー要素 1800-2050) ----
  // [a, e, I, L, longPeri, longNode] + 世紀あたり変化率
  var PLANET_ELEMENTS = {
    Mercury: [[0.38709927, 0.20563593, 7.00497902, 252.25032350, 77.45779628, 48.33076593],
              [0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081]],
    Venus:   [[0.72333566, 0.00677672, 3.39467605, 181.97909950, 131.60246718, 76.67984255],
              [0.00000390, -0.00004107, -0.00078890, 58517.81538729, 0.00268329, -0.27769418]],
    EM:      [[1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0.0],
              [0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0.0]],
    Mars:    [[1.52371034, 0.09339410, 1.84969142, -4.55343205, -23.94362959, 49.55953891],
              [0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343]],
    Jupiter: [[5.20288700, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909],
              [-0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106]],
    Saturn:  [[9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448],
              [-0.00125060, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794]],
    Uranus:  [[19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.95427630, 74.01692503],
              [-0.00196176, -0.00004397, -0.00242939, 428.48202785, 0.40805281, 0.04240589]],
    Neptune: [[30.06992276, 0.00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574],
              [0.00026291, 0.00005105, 0.00035372, 218.45945325, -0.32241464, -0.00508664]]
  };

  function keplerSolve(Mdeg, e) {
    var M = norm360(Mdeg) * D2R;
    var Ecc = M + e * Math.sin(M);
    for (var i = 0; i < 8; i++) {
      var dE = (Ecc - e * Math.sin(Ecc) - M) / (1 - e * Math.cos(Ecc));
      Ecc -= dE;
      if (Math.abs(dE) < 1e-9) break;
    }
    return Ecc;
  }

  // 日心黄道直交座標 [au] (J2000黄道面)
  function heliocentric(name, T) {
    var el = PLANET_ELEMENTS[name];
    var a = el[0][0] + el[1][0] * T;
    var e = el[0][1] + el[1][1] * T;
    var I = (el[0][2] + el[1][2] * T) * D2R;
    var L = el[0][3] + el[1][3] * T;
    var wb = el[0][4] + el[1][4] * T; // 近日点黄経
    var Om = (el[0][5] + el[1][5] * T);
    var M = L - wb;
    var w = (wb - Om) * D2R;
    var OmR = Om * D2R;
    var Ecc = keplerSolve(M, e);
    var xp = a * (Math.cos(Ecc) - e);
    var yp = a * Math.sqrt(1 - e * e) * Math.sin(Ecc);
    var cw = Math.cos(w), sw = Math.sin(w);
    var cO = Math.cos(OmR), sO = Math.sin(OmR);
    var cI = Math.cos(I), sI = Math.sin(I);
    return {
      x: (cw * cO - sw * sO * cI) * xp + (-sw * cO - cw * sO * cI) * yp,
      y: (cw * sO + sw * cO * cI) * xp + (-sw * sO + cw * cO * cI) * yp,
      z: (sw * sI) * xp + (cw * sI) * yp
    };
  }

  var PLANET_INFO = {
    Mercury: { ja: "水星", color: "#c8b8a0" },
    Venus: { ja: "金星", color: "#f5f0d5" },
    Mars: { ja: "火星", color: "#ff8560" },
    Jupiter: { ja: "木星", color: "#f0d8b0" },
    Saturn: { ja: "土星", color: "#f0e0a8" },
    Uranus: { ja: "天王星", color: "#a8e8e8" },
    Neptune: { ja: "海王星", color: "#88a8ff" }
  };

  // 近似実視等級
  function planetMagnitude(name, r, delta, phaseAngleDeg) {
    var i = phaseAngleDeg;
    var base = 5 * Math.log10(r * delta);
    switch (name) {
      case "Mercury": return -0.60 + base + 0.0498 * i - 0.000488 * i * i + 3.02e-6 * i * i * i;
      case "Venus": return -4.47 + base + 0.0103 * i + 0.000057 * i * i + 0.13e-6 * i * i * i;
      case "Mars": return -1.52 + base + 0.016 * i;
      case "Jupiter": return -9.40 + base + 0.005 * i;
      case "Saturn": return -8.88 + base + 0.044 * i - 0.3; // 環の寄与は平均値で近似
      case "Uranus": return -7.19 + base;
      case "Neptune": return -6.87 + base;
    }
    return 0;
  }

  // 全惑星の地心位置 {name, ja, ra, dec, mag, color, distAu}
  function planetPositions(jd) {
    var T = (jd - 2451545.0) / 36525.0;
    var earth = heliocentric("EM", T);
    var out = [];
    for (var name in PLANET_INFO) {
      var p = heliocentric(name, T);
      var gx = p.x - earth.x, gy = p.y - earth.y, gz = p.z - earth.z;
      var delta = Math.sqrt(gx * gx + gy * gy + gz * gz);
      var r = Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z);
      var lam = Math.atan2(gy, gx) * R2D;
      var beta = Math.atan2(gz, Math.sqrt(gx * gx + gy * gy)) * R2D;
      var eq = eclToEq(norm360(lam), beta, jd);
      var re = Math.sqrt(earth.x * earth.x + earth.y * earth.y + earth.z * earth.z);
      var cosPhase = (r * r + delta * delta - re * re) / (2 * r * delta);
      var phase = Math.acos(Math.max(-1, Math.min(1, cosPhase))) * R2D;
      out.push({
        name: name, ja: PLANET_INFO[name].ja, color: PLANET_INFO[name].color,
        ra: eq.ra, dec: eq.dec, mag: planetMagnitude(name, r, delta, phase), distAu: delta
      });
    }
    return out;
  }

  // B-V 色指数 → RGB (近似)
  function bvToRGB(bv) {
    if (bv === null || bv === undefined || bv > 9) bv = 0.5;
    bv = Math.max(-0.4, Math.min(2.0, bv));
    var t = 4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62)); // 色温度近似
    var r, g, b;
    if (t > 6600) {
      r = 1.292936 * Math.pow(t / 100 - 60, -0.1332047);
      g = 1.129891 * Math.pow(t / 100 - 60, -0.0755148);
      b = 1;
    } else {
      r = 1;
      g = Math.max(0, 0.39008 * Math.log(t / 100) - 0.63184);
      b = t < 1900 ? 0 : Math.max(0, 0.54320 * Math.log(t / 100 - 10) - 1.19625);
    }
    return [Math.min(1, r), Math.min(1, g), Math.min(1, b)];
  }

  return {
    D2R: D2R, R2D: R2D, norm360: norm360,
    julianDate: julianDate, gmst: gmst, lst: lst,
    obliquity: obliquity, eclToEq: eclToEq,
    eqToHorizontal: eqToHorizontal, refraction: refraction,
    sunPosition: sunPosition, moonPosition: moonPosition, moonPhase: moonPhase,
    planetPositions: planetPositions, bvToRGB: bvToRGB
  };
})();
