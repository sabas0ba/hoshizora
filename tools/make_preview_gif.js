// README 用のプレビュー GIF (2D -> 3D の切り替え操作) を docs/preview.gif に生成する。
//
// 使用法: node tools/make_preview_gif.js
// 生成物はリポジトリにコミットする。撮影条件を固定しているため、
// 再実行すればほぼ同じ内容が得られる。
//
// このスクリプトはフレームを PNG で書き出すところまでを担当し、
// GIF への合成は tools/frames_to_gif.py (Pillow) が行う。

const { chromium } = require("playwright");
const { execFileSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "docs/preview.gif");
const DIST = "file://" + path.join(ROOT, "dist/hoshizora.html");

// 撮影条件は docs/images/ のスクリーンショットと揃える (東京、夏の大三角が天頂付近)。
const LOCATION = { lat: 35.6895, lon: 139.6917 };
const DATETIME = "2026-08-10T21:30";
const VIEW = { width: 420, height: 660 };

const FRAME_MS = 180; // 1 フレームあたりの表示時間

// 実際のポインタは撮影されないため、操作位置を示す疑似カーソルを重ねる。
const CURSOR_CSS = `
#__cursor {
  position: fixed; z-index: 99999; width: 26px; height: 26px;
  margin: -13px 0 0 -13px; border-radius: 50%; pointer-events: none;
  border: 2px solid rgba(255,255,255,.9); background: rgba(255,255,255,.18);
  box-shadow: 0 0 8px rgba(0,0,0,.6); opacity: 0; transition: none;
}
#__cursor.on { opacity: 1; }
#__cursor.press { background: rgba(255,255,255,.75); transform: scale(.8); }
`;

async function setupCursor(page) {
  await page.addStyleTag({ content: CURSOR_CSS });
  await page.evaluate(() => {
    const el = document.createElement("div");
    el.id = "__cursor";
    document.body.appendChild(el);
  });
}

async function cursor(page, { x, y, show, press } = {}) {
  await page.evaluate((s) => {
    const el = document.getElementById("__cursor");
    if (!el) return;
    if (s.x != null) el.style.left = s.x + "px";
    if (s.y != null) el.style.top = s.y + "px";
    if (s.show != null) el.classList.toggle("on", s.show);
    if (s.press != null) el.classList.toggle("press", s.press);
  }, { x, y, show, press });
}

const frames = [];
async function shot(page, dir, times = 1) {
  const file = path.join(dir, String(frames.length).padStart(3, "0") + ".png");
  await page.screenshot({ path: file });
  for (let i = 0; i < times; i++) frames.push(file);
}

async function center(page, selector) {
  const box = await page.locator(selector).boundingBox();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

// カーソルを現在地から目標へ数フレームかけて動かす。
let pos = { x: VIEW.width / 2, y: VIEW.height - 40 };
async function moveTo(page, dir, to, steps = 3) {
  for (let i = 1; i <= steps; i++) {
    const x = pos.x + (to.x - pos.x) * (i / steps);
    const y = pos.y + (to.y - pos.y) * (i / steps);
    await cursor(page, { x, y, show: true });
    await shot(page, dir);
  }
  pos = to;
}

async function tap(page, dir, selector) {
  const to = await center(page, selector);
  await moveTo(page, dir, to);
  await cursor(page, { press: true });
  await shot(page, dir, 2);
  await page.click(selector);
  await cursor(page, { press: false });
}

// ドラッグ操作。各ステップでフレームを撮り、視点移動が伝わるようにする。
async function drag(page, dir, from, to, steps) {
  await moveTo(page, dir, from);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await cursor(page, { press: true });
  for (let i = 1; i <= steps; i++) {
    const x = from.x + (to.x - from.x) * (i / steps);
    const y = from.y + (to.y - from.y) * (i / steps);
    await page.mouse.move(x, y);
    await cursor(page, { x, y });
    await shot(page, dir);
  }
  await page.mouse.up();
  await cursor(page, { press: false });
  pos = to;
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hoshizora-preview-"));
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: VIEW,
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

  // 日時を固定し、星座名を出した状態から始める。
  await page.click("#btn-settings");
  await page.waitForTimeout(300);
  await page.fill("#dtinput", DATETIME);
  await page.dispatchEvent("#dtinput", "change");
  await page.check("#tg-constnames");
  await page.click("#panel-close");
  await page.waitForTimeout(800);

  await setupCursor(page);

  // 1. 2D 星座早見をしばらく見せる
  await shot(page, dir, 5);

  // 2. 3D へ切り替える
  await tap(page, dir, "#btn-3d");
  await page.waitForTimeout(500);
  await shot(page, dir, 2);
  await page.waitForTimeout(600);
  await shot(page, dir, 3);

  // 3. 3D をドラッグして見回す (視線を上げてから天の川に沿って横に振る)
  await drag(page, dir, { x: 210, y: 250 }, { x: 210, y: 450 }, 6);
  await shot(page, dir, 2);
  await drag(page, dir, { x: 330, y: 380 }, { x: 90, y: 380 }, 8);
  await shot(page, dir, 4);

  // 4. 2D へ戻して先頭へつなぐ
  await tap(page, dir, "#btn-2d");
  await page.waitForTimeout(700);
  await cursor(page, { show: false });
  await shot(page, dir, 5);

  await browser.close();
  if (errors.length) {
    console.error("ページエラー:", errors);
    process.exit(1);
  }

  const list = path.join(dir, "frames.txt");
  fs.writeFileSync(list, frames.join("\n") + "\n");
  execFileSync(
    "python3",
    [path.join(__dirname, "frames_to_gif.py"), list, OUT, String(FRAME_MS)],
    { stdio: "inherit" },
  );
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`${path.relative(ROOT, OUT)}: ${(fs.statSync(OUT).size / 1024).toFixed(0)} KB`);
})();
