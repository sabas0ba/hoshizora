// README 用のプレビュー GIF (2D/3D の切り替えと再生) を docs/preview.gif に生成する。
//
// 使用法: node tools/make_preview_gif.js
// 生成物はリポジトリにコミットする。ページ内の時間を Playwright の
// 仮想クロックで進めるため、再実行すれば同じ内容が得られる。
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
const START = new Date("2026-08-10T21:30:00+09:00");

// 横長で、星座名が読める大きさと 600 KB 以内という条件の折り合い。
// 等倍で撮って縮小はしない。縮小のアンチエイリアスで星がぼやけると
// コマ間の差分が増え、GIF が大きくなるため。
const VIEW = { width: 700, height: 470 };

const RENDER_MS = 60; // 描画のためだけに進める仮想時間

// フレームごとの表示時間 [ms]。GIF の容量はほぼコマ数で決まるため、
// 動きのないところはコマを増やさず 1 コマを長く表示して尺を稼ぐ。
const MS = { still: 900, move: 200, press: 250, drag: 170, play: 300 };

// 再生の速さ。ページ内の時間は仮想クロックで進めるので、GIF 上の見かけの
// 速さは PLAY_STEP_MS / MS.play * 速度で決まる。×600 の空を 1 コマあたり
// 500 ms 進めて 300 ms で見せるため、ちょうど 1000 倍速になる。
const SPEED = "600";
const PLAY_STEP_MS = 500;

// 実際のポインタは撮影されないため、操作位置を示す疑似カーソルを重ねる。
const CURSOR_CSS = `
#__cursor {
  position: fixed; z-index: 99999; width: 30px; height: 30px;
  margin: -15px 0 0 -15px; border-radius: 50%; pointer-events: none;
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

// ページ内の時間を進める。描画は requestAnimationFrame で回っているため、
// 撮影前に必ず進めてから撮る。
async function tick(page, ms) {
  await page.clock.runFor(ms);
}

const frames = [];
async function shot(page, dir, ms = MS.move, tickMs = RENDER_MS) {
  await tick(page, tickMs);
  const file = path.join(dir, String(frames.length).padStart(3, "0") + ".png");
  await page.screenshot({ path: file });
  frames.push({ file: file, ms: ms });
}

// 直前のフレームの表示を伸ばす。コマは増えないので容量に響かない。
function hold(ms) {
  frames[frames.length - 1].ms += ms;
}

async function center(page, selector) {
  const box = await page.locator(selector).boundingBox();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

// カーソルを現在地から目標へ数フレームかけて動かす。
let pos = { x: VIEW.width / 2, y: VIEW.height - 40 };
async function moveTo(page, dir, to) {
  if (Math.hypot(to.x - pos.x, to.y - pos.y) < 5) return;
  await cursor(page, { x: to.x, y: to.y, show: true });
  await shot(page, dir, MS.move);
  pos = to;
}

async function tap(page, dir, selector) {
  const to = await center(page, selector);
  await moveTo(page, dir, to);
  await cursor(page, { press: true });
  await shot(page, dir, MS.press);
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
    await shot(page, dir, MS.drag);
  }
  await page.mouse.up();
  await cursor(page, { press: false });
  pos = to;
}

// 再生 (▶) を押し、日周運動が進む様子を frames 枚撮ってから停止する。
async function play(page, dir, count) {
  await tap(page, dir, "#btn-play");
  for (let i = 0; i < count; i++) await shot(page, dir, MS.play, PLAY_STEP_MS);
  const label = (await page.textContent("#timelabel")).trim();
  console.log(`再生 ${count} コマ (×${SPEED}, 1 コマ ${PLAY_STEP_MS} ms) -> ${label}`);
  await tap(page, dir, "#btn-play");
}

async function openPanel(page, fn) {
  await page.click("#btn-settings");
  await tick(page, 400);
  await fn();
  await page.click("#panel-close");
  await tick(page, 600);
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hoshizora-preview-"));
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: VIEW,
    deviceScaleFactor: 1,
    timezoneId: "Asia/Tokyo",
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  // 仮想クロックを入れて時間の進み方を固定する。install だけでは実時間で
  // 進み続けるため pauseAt で止め、以後ページ内の時間は tick() でしか
  // 進まないようにする。撮影にかかる実時間に結果が左右されなくなる。
  await page.clock.install({ time: START });
  await page.clock.pauseAt(START);
  await page.goto(DIST);
  await tick(page, 1500);

  await page.evaluate((loc) => {
    document.getElementById("latinput").value = loc.lat;
    document.getElementById("loninput").value = loc.lon;
    document.getElementById("latinput").dispatchEvent(new Event("change"));
  }, LOCATION);

  // 日時を固定し、星座名を出した状態から始める。
  await openPanel(page, async () => {
    await page.fill("#dtinput", DATETIME);
    await page.dispatchEvent("#dtinput", "change");
    await page.check("#tg-constnames");
  });
  await page.selectOption("#speed", SPEED);
  await setupCursor(page);

  // 1. 2D 星座早見。再生すると全天が日周運動で回る
  await shot(page, dir, MS.still);
  await play(page, dir, 3);
  hold(700);

  // 2. 3D へ切り替える
  await tap(page, dir, "#btn-3d");
  await shot(page, dir, MS.still, 1200);

  // 3. 3D をドラッグして見回す。斜めに引いて、視線を上げながら
  //    天の川に沿って横へ振る (縦と横で 2 回引くよりコマ数を減らせる)
  await drag(page, dir, { x: 560, y: 200 }, { x: 160, y: 340 }, 4);
  hold(700);

  // 4. 3D でも再生して、空全体が動くところを見せる
  await play(page, dir, 3);
  hold(900);

  await browser.close();
  if (errors.length) {
    console.error("ページエラー:", errors);
    process.exit(1);
  }

  const list = path.join(dir, "frames.txt");
  fs.writeFileSync(list, frames.map((f) => f.file + "\t" + f.ms).join("\n") + "\n");
  execFileSync("python3", [path.join(__dirname, "frames_to_gif.py"), list, OUT], {
    stdio: "inherit",
  });
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`${path.relative(ROOT, OUT)}: ${(fs.statSync(OUT).size / 1024).toFixed(0)} KB`);
})();
