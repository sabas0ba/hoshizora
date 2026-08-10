// dist/hoshizora.html の表示確認。コンソールエラー検出とスクリーンショット取得を行う。
const { chromium } = require("playwright");
const path = require("path");

async function setDatetime(page, value) {
  await page.click("#btn-settings");
  await page.waitForTimeout(350);
  await page.fill("#dtinput", value);
  await page.dispatchEvent("#dtinput", "change");
  await page.click("#panel-close");
  await page.waitForTimeout(450);
  await page.evaluate(() => { window.scrollTo(0, 0); document.body.scrollLeft = 0; });
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 480, height: 900 },
    timezoneId: "Asia/Tokyo",
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));

  const url = "file://" + path.resolve(__dirname, "../dist/hoshizora.html");
  await page.goto(url);
  await page.waitForTimeout(1200);

  // 夜 (JST 2026-08-10 21:30)
  await setDatetime(page, "2026-08-10T21:30");
  await page.screenshot({ path: "/tmp/shot_2d.png" });

  // 3D ビュー (初期は北向き)
  await page.click("#btn-3d");
  await page.waitForTimeout(1500);
  await page.screenshot({ path: "/tmp/shot_3d.png" });

  // 南向きに回す
  await page.mouse.move(240, 450);
  await page.mouse.down();
  await page.mouse.move(540, 470, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  await page.screenshot({ path: "/tmp/shot_3d_south.png" });

  // 昼 (大気確認)
  await setDatetime(page, "2026-08-10T12:00");
  await page.screenshot({ path: "/tmp/shot_3d_day.png" });

  // 2D 昼
  await page.click("#btn-2d");
  await page.waitForTimeout(400);
  await page.screenshot({ path: "/tmp/shot_2d_day.png" });

  // 2D 夜 + 星座名トグル
  await setDatetime(page, "2026-08-10T23:00");
  await page.click("#btn-settings");
  await page.waitForTimeout(350);
  await page.check("#tg-constnames");
  await page.click("#panel-close");
  await page.waitForTimeout(450);
  await page.screenshot({ path: "/tmp/shot_2d_names.png" });

  // タイムスライダーを +6h へ
  await page.evaluate(() => {
    const s = document.getElementById("timeslider");
    s.value = 360;
    s.dispatchEvent(new Event("input"));
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: "/tmp/shot_2d_slider.png" });

  console.log("console errors:", errors.length ? errors : "(none)");
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})();
