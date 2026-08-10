// 検索・方位センサー機能の動作確認 (合成 DeviceOrientationEvent 使用)
const { chromium } = require("playwright");
const path = require("path");

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

  console.log("console errors:", errors.length ? errors : "(none)");
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})();
