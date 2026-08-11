// README 用のスクリーンショットを docs/images/ に生成する。
//
// 使用法: node tools/make_screenshots.js
// 生成物はリポジトリにコミットする。撮影条件を固定しているため、
// 再実行すれば同じ構図が得られる。

const { chromium } = require("playwright");
const { execFileSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const OUT_DIR = path.resolve(__dirname, "../docs/images");
const DIST = "file://" + path.resolve(__dirname, "../dist/hoshizora.html");

// 撮影条件: 東京、2026-08-10 21:30 JST (夏の大三角が天頂付近)
const LOCATION = { lat: 35.6895, lon: 139.6917 };
const DATETIME = "2026-08-10T21:30";

// 2D は全天円が主題のため縦を詰める。3D は縦長のほうが空の広がりが出る。
const VIEW_2D = { width: 430, height: 640 };
const VIEW_3D = { width: 430, height: 780 };

// 256 色へ減色する。星空は階調が限られるため劣化がほとんど無く、容量は約 1/4 になる。
function quantize(file) {
  execFileSync("convert", [file, "-colors", "256", "-depth", "8", "PNG8:" + file]);
}

async function setDatetime(page, value) {
  await page.click("#btn-settings");
  await page.waitForTimeout(300);
  await page.fill("#dtinput", value);
  await page.dispatchEvent("#dtinput", "change");
  await page.click("#panel-close");
  await page.waitForTimeout(500);
}

async function setToggle(page, id, on) {
  await page.click("#btn-settings");
  await page.waitForTimeout(300);
  if (on) await page.check(id); else await page.uncheck(id);
  await page.click("#panel-close");
  await page.waitForTimeout(500);
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: VIEW_2D,
    deviceScaleFactor: 2,
    timezoneId: "Asia/Tokyo",
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  await page.goto(DIST);
  await page.waitForTimeout(1200);
  await page.evaluate((loc) => {
    document.getElementById("latinput").value = loc.lat;
    document.getElementById("loninput").value = loc.lon;
    document.getElementById("latinput").dispatchEvent(new Event("change"));
  }, LOCATION);
  await setDatetime(page, DATETIME);

  // 1. 2D 星座早見 (星座名あり)
  await setToggle(page, "#tg-constnames", true);
  await page.screenshot({ path: path.join(OUT_DIR, "2d-allsky.png") });

  // 2. 昼間の空 (大気表現、太陽と月と内惑星)
  await setToggle(page, "#tg-constnames", false);
  await setDatetime(page, "2026-08-11T12:00");
  await page.screenshot({ path: path.join(OUT_DIR, "2d-daylight.png") });
  await setDatetime(page, DATETIME);

  // 3. 3D プラネタリウム (天頂付近の天の川)
  await page.setViewportSize(VIEW_3D);
  await page.click("#btn-3d");
  await page.waitForTimeout(1500);
  await page.mouse.move(215, 400);
  await page.mouse.down();
  await page.mouse.move(-160, 400, { steps: 12 });
  await page.mouse.up();
  await page.mouse.move(215, 220);
  await page.mouse.down();
  await page.mouse.move(215, 640, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT_DIR, "3d-planetarium.png") });

  // 4. 検索 (恒星と星座が混在する結果)
  await page.click("#btn-search");
  await page.fill("#searchinput", "ア");
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT_DIR, "search.png") });

  await browser.close();
  if (errors.length) {
    console.error("ページエラー:", errors);
    process.exit(1);
  }
  for (const f of fs.readdirSync(OUT_DIR)) {
    const full = path.join(OUT_DIR, f);
    const before = fs.statSync(full).size / 1024;
    quantize(full);
    const after = fs.statSync(full).size / 1024;
    console.log(`${f}: ${before.toFixed(0)} KB -> ${after.toFixed(0)} KB`);
  }
})();
