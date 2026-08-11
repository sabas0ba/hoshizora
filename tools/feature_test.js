// 検索・方位センサー・URL パラメータの動作確認 (合成 DeviceOrientationEvent 使用)
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");
const http = require("http");

const DIST = path.resolve(__dirname, "../dist/hoshizora.html");
const FILE_URL = "file://" + DIST;
const VIEWPORT = { width: 480, height: 900 };

// 共有ダイアログを開き、注意書きの有無・既定のチェック状態・生成 URL を返す
async function openShare(page) {
  await page.click("#btn-share");
  await page.waitForTimeout(300);
  return page.evaluate(() => ({
    warn: !document.getElementById("share-warn").classList.contains("hidden"),
    checked: document.getElementById("share-loc").checked,
    url: document.getElementById("shareurl").value,
  }));
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 480, height: 900 }, timezoneId: "Asia/Tokyo" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  // ヘッドレス環境にはセンサー API がないためシムを入れる
  await page.addInitScript(() => {
    if (!("DeviceOrientationEvent" in window)) {
      window.DeviceOrientationEvent = function () {};
    }
    window.__orient = null;
    setInterval(() => {
      if (!window.__orient) return;
      const e = new Event("deviceorientation");
      e.alpha = window.__orient[0]; e.beta = window.__orient[1];
      e.gamma = window.__orient[2]; e.absolute = true;
      window.dispatchEvent(e);
    }, 100);
  });

  await page.goto("file://" + path.resolve(__dirname, "../dist/hoshizora.html"));
  await page.waitForTimeout(900);
  await page.click("#btn-settings");
  await page.fill("#dtinput", "2026-08-10T21:30");
  await page.dispatchEvent("#dtinput", "change");
  await page.click("#panel-close");
  await page.waitForTimeout(400);

  // --- 検索: ベガ (2D マーカー) ---
  await page.click("#btn-search");
  await page.fill("#searchinput", "べが");
  await page.waitForTimeout(200);
  await page.screenshot({ path: "/tmp/ft_search_list.png" });
  const rows = await page.locator(".sr-row").count();
  console.log("search 'べが' rows:", rows);
  await page.locator(".sr-row").first().click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: "/tmp/ft_target_2d.png" });

  // --- 3D で goTo アニメーション → マーカー中央 ---
  await page.click("#btn-3d");
  await page.waitForTimeout(300);
  await page.click("#btn-search");
  await page.fill("#searchinput", "土星");
  await page.waitForTimeout(200);
  await page.locator(".sr-row").first().click();
  await page.waitForTimeout(1400); // アニメーション完了待ち
  await page.screenshot({ path: "/tmp/ft_target_3d.png" });

  // --- 検索: 星座 ---
  await page.click("#btn-search");
  await page.fill("#searchinput", "いて");
  await page.waitForTimeout(200);
  const constRows = await page.locator(".sr-row").allTextContents();
  console.log("search 'いて':", JSON.stringify(constRows.slice(0, 3)));
  await page.locator(".sr-row").first().click();
  await page.waitForTimeout(1400);
  await page.screenshot({ path: "/tmp/ft_target_const.png" });

  // --- 方位センサー (合成イベント連続送信) ---
  // 端末を立てて (beta=90) 東 (alpha=270) を向いた状態を模擬
  await page.evaluate(() => { window.__orient = [270, 90, 0]; });
  await page.click("#btn-gyro");
  await page.waitForTimeout(1500);
  await page.screenshot({ path: "/tmp/ft_gyro_east.png" });
  // 北向き
  await page.evaluate(() => { window.__orient = [0, 90, 0]; });
  await page.waitForTimeout(800);
  await page.screenshot({ path: "/tmp/ft_gyro_north.png" });
  const gyroBtnActive = await page.evaluate(() =>
    document.getElementById("btn-gyro").classList.contains("active"));
  console.log("gyro button active:", gyroBtnActive);
  // 解除
  await page.click("#btn-gyro");
  await page.waitForTimeout(300);

  // --- ビュー切替: 非表示中のリサイズを挟んでもキャンバスが潰れないこと ---
  await page.click("#btn-2d");
  await page.waitForTimeout(300);
  await page.click("#btn-3d");
  await page.waitForTimeout(400);
  await page.setViewportSize({ width: 480, height: 820 }); // 3D 表示中にリサイズ
  await page.waitForTimeout(300);
  await page.click("#btn-2d");
  await page.waitForTimeout(400);
  const sizes = await page.evaluate(() => {
    const c2 = document.getElementById("canvas2d");
    return { w: c2.width, h: c2.height, aspect: window.__dbg.three.camera.aspect };
  });
  console.log("2D canvas after 3D+resize:", JSON.stringify(sizes));
  if (sizes.w === 0 || sizes.h === 0) errors.push("2D キャンバスが 0×0 になった");
  if (!isFinite(sizes.aspect)) errors.push("3D カメラの aspect が NaN になった");
  await page.screenshot({ path: "/tmp/ft_view_switch.png" });

  // --- 起動時の基準日時: 昼間に開いたらその日の 20:00 になること ---
  // 20:00 は観測地 (既定は東京 = UTC+9) の時刻。ブラウザのタイムゾーンが
  // 異なっていても同じ空になる = dtinput の表示はブラウザ時刻に従う。
  for (const [tz, now, expect] of [
    ["Asia/Tokyo", "2026-08-11T13:00:00+09:00", "2026-08-11T20:00"],  // 昼 → 20:00 JST へ
    ["Asia/Tokyo", "2026-08-11T21:30:00+09:00", "2026-08-11T21:30"],  // 夜 → 現在時刻のまま
    ["UTC", "2026-08-11T04:52:00Z", "2026-08-11T11:00"],  // 昼 → 20:00 JST = 11:00 UTC
    ["UTC", "2026-08-11T10:09:00Z", "2026-08-11T10:09"],  // 夜 (19:09 JST) → 現在時刻のまま
  ]) {
    const c = await browser.newContext({ viewport: VIEWPORT, timezoneId: tz });
    const p = await c.newPage();
    p.on("pageerror", (e) => errors.push(String(e)));
    await p.clock.setFixedTime(new Date(now));
    await p.goto(FILE_URL);
    await p.waitForTimeout(700);
    const got = await p.inputValue("#dtinput");
    console.log("起動 (" + tz + ")", now, "-> 基準日時", got);
    if (got !== expect) errors.push(`起動時の基準日時 (${tz}, ${now}) が ${expect} ではなく ${got}`);
    await c.close();
  }

  // --- URL パラメータ ---
  for (const [label, query, expect] of [
    ["指定あり", "?t=2026-08-11T20:00%2B09:00&lat=-33.8688&lon=151.2093&view=3d",
      { t: Date.UTC(2026, 7, 11, 11, 0), lat: -33.8688, lon: 151.2093, view: "3d" }],
    ["+ が空白に化けた場合", "?t=2026-08-11T20:00+09:00",
      { t: Date.UTC(2026, 7, 11, 11, 0), lat: 35.6895, lon: 139.6917, view: "2d" }],
    ["都市名", "?t=2026-08-11T20:00%2B09:00&city=NAHA",
      { t: Date.UTC(2026, 7, 11, 11, 0), lat: 26.2124, lon: 127.6809, view: "2d" }],
    ["都市名より緯度経度が優先", "?city=naha&lat=34.6937&lon=135.5023",
      { t: Date.UTC(2026, 7, 11, 11, 0), lat: 34.6937, lon: 135.5023, view: "2d" }],
    ["不正値は無視して既定へ", "?t=yesterday&lat=999&lon=abc&city=atlantis&view=4d",
      { t: Date.UTC(2026, 7, 11, 11, 0), lat: 35.6895, lon: 139.6917, view: "2d" }],
  ]) {
    const c = await browser.newContext({ viewport: VIEWPORT, timezoneId: "UTC" });
    const p = await c.newPage();
    p.on("pageerror", (e) => errors.push(String(e)));
    // 不正値の行は「昼間フォールバックで 20:00 JST になる」ことも同時に確認する
    await p.clock.setFixedTime(new Date("2026-08-11T04:52:00Z"));
    await p.goto(FILE_URL + query);
    await p.waitForTimeout(700);
    const got = await p.evaluate(() => ({
      t: window.__dbg.state.baseTime, lat: window.__dbg.state.lat,
      lon: window.__dbg.state.lon, view: window.__dbg.state.view,
      hidden3d: document.getElementById("canvas3d").classList.contains("hidden"),
    }));
    console.log("URL パラメータ (" + label + "):", JSON.stringify(got));
    for (const k of ["t", "lat", "lon", "view"]) {
      if (got[k] !== expect[k]) errors.push(`URL パラメータ ${label}: ${k} が ${expect[k]} ではなく ${got[k]}`);
    }
    if (got.view === "3d" && got.hidden3d) errors.push("view=3d でも 3D キャンバスが非表示のまま");
    await p.screenshot({ path: "/tmp/ft_urlparam_" + (expect.view === "3d" ? "3d" : "2d") + ".png" });
    await c.close();
  }

  // --- 状態の URL 反映と共有ダイアログ (replaceState は file:// では動かないため http で) ---
  const html = fs.readFileSync(DIST);
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const httpUrl = "http://127.0.0.1:" + server.address().port + "/";
  {
    const c = await browser.newContext({
      viewport: VIEWPORT, timezoneId: "Asia/Tokyo",
      geolocation: { latitude: 43.0621, longitude: 141.3544 }, permissions: ["geolocation"],
    });
    const p = await c.newPage();
    p.on("pageerror", (e) => errors.push(String(e)));
    await p.goto(httpUrl);
    await p.waitForTimeout(800);
    await p.click("#btn-settings");
    await p.fill("#dtinput", "2026-08-10T21:30");
    await p.dispatchEvent("#dtinput", "change");
    await p.waitForTimeout(1400);   // URL 反映の間引き待ち
    const url1 = p.url();
    console.log("URL 反映 (プリセット都市):", url1);
    for (const frag of ["t=2026-08-10T21:30%2B09:00", "city=tokyo", "view=2d"]) {
      if (!url1.includes(frag)) errors.push(`URL に ${frag} が反映されていない: ${url1}`);
    }
    if (/lat=|lon=/.test(url1)) errors.push(`アドレスバーに緯度経度が出ている: ${url1}`);

    // 共有ダイアログ: プリセット都市なので注意書きは出さず、既定で含める (名前で)
    const preset = await openShare(p);
    console.log("共有ダイアログ (プリセット都市):", JSON.stringify(preset));
    if (preset.warn) errors.push("プリセット都市なのに共有ダイアログの注意書きが出ている");
    if (!preset.checked) errors.push("プリセット都市なのに既定で観測地が含まれていない");
    if (!preset.url.includes("city=tokyo") || /lat=|lon=/.test(preset.url)) {
      errors.push("プリセット都市の共有 URL が都市名になっていない: " + preset.url);
    }
    await p.click("#share-close");

    // 都市プリセット以外の座標は手入力でもアドレスバーに出さない
    await p.fill("#latinput", "35.1234");
    await p.dispatchEvent("#latinput", "change");
    await p.waitForTimeout(1600);
    const url2 = p.url();
    console.log("URL 反映 (手入力の座標):", url2);
    if (/lat=|lon=|city=/.test(url2)) errors.push(`手入力の座標が URL に載っている: ${url2}`);
    const manual = await openShare(p);
    console.log("共有ダイアログ (手入力):", JSON.stringify(manual));
    if (!manual.warn) errors.push("手入力の座標で共有ダイアログの注意書きが出ていない");
    if (manual.checked) errors.push("手入力の座標が既定で共有 URL に含まれている");
    await p.click("#share-close");

    // 都市そのものの座標を打ち込んだ場合はプリセット扱いに戻る
    await p.fill("#latinput", "35.6895");
    await p.dispatchEvent("#latinput", "change");
    await p.waitForTimeout(1600);
    if (!/city=tokyo/.test(p.url())) errors.push(`都市の座標が URL に戻らない: ${p.url()}`);

    // 現在地を取得した場合も同様に載せない
    await p.click("#btn-geo");
    await p.waitForTimeout(1600);
    const url3 = p.url();
    console.log("URL 反映 (現在地取得後):", url3);
    if (/lat=|lon=|city=/.test(url3)) errors.push(`現在地が URL に載っている: ${url3}`);
    const lat = await p.evaluate(() => window.__dbg.state.lat);
    if (Math.abs(lat - 43.0621) > 1e-3) errors.push("現在地が観測地に反映されていない: " + lat);

    const geo = await openShare(p);
    await p.screenshot({ path: "/tmp/ft_share_geo.png" });
    console.log("共有ダイアログ (現在地):", JSON.stringify(geo));
    if (!geo.warn) errors.push("現在地利用時に共有ダイアログの注意書きが出ていない");
    if (geo.checked) errors.push("現在地利用時に既定で緯度経度が含まれている");
    if (/lat=|lon=/.test(geo.url)) errors.push("共有 URL に現在地が含まれている: " + geo.url);
    // 同意すれば含められる
    await p.check("#share-loc");
    await p.waitForTimeout(200);
    const withLoc = await p.inputValue("#shareurl");
    if (!withLoc.includes("lat=43.0621")) errors.push("同意しても共有 URL に緯度経度が入らない: " + withLoc);
    await p.click("#share-close");
    await c.close();
  }

  // --- URL で渡された座標も、アドレスバーには残さないこと ---
  // (受け取った側がダイアログを通らずに転送できてしまうのを防ぐ。
  //  観測地としては反映され、共有ダイアログから作り直せる)
  {
    const c = await browser.newContext({ viewport: VIEWPORT, timezoneId: "Asia/Tokyo" });
    const p = await c.newPage();
    p.on("pageerror", (e) => errors.push(String(e)));
    await p.goto(httpUrl + "?t=2026-08-10T21:30%2B09:00&lat=36.1043&lon=137.5537");
    await p.waitForTimeout(1600);
    const url = p.url();
    const st = await p.evaluate(() => [window.__dbg.state.lat, window.__dbg.state.lon]);
    console.log("URL 反映 (URL 指定の座標):", url, JSON.stringify(st));
    if (/lat=|lon=/.test(url)) errors.push(`URL 指定の座標がアドレスバーに残っている: ${url}`);
    if (Math.abs(st[0] - 36.1043) > 1e-4 || Math.abs(st[1] - 137.5537) > 1e-4) {
      errors.push("URL 指定の座標が観測地に反映されていない: " + JSON.stringify(st));
    }
    const shared = await openShare(p);
    if (!shared.warn) errors.push("URL 指定の座標で共有ダイアログの注意書きが出ていない");
    await p.check("#share-loc");
    await p.waitForTimeout(200);
    const again = await p.inputValue("#shareurl");
    if (!again.includes("lat=36.1043")) errors.push("共有 URL を作り直せない: " + again);
    await c.close();
  }
  await new Promise((r) => server.close(r));

  console.log("console errors:", errors.length ? errors : "(none)");
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})();
