#!/usr/bin/env python3
"""生成物 dist/hoshizora.html の健全性を検査する。

ブラウザを起動しない静的な検査であり、CI のビルドジョブで実行する。
描画やスクリプトの動作確認は tools/screenshot_test.js と
tools/feature_test.js が担当する。
"""

import os
import re
import sys

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(BASE, "dist", "hoshizora.html")

# 生成物に必ず含まれるべき要素。欠落は埋め込み漏れを意味する。
REQUIRED_MARKERS = [
    ("three.js の埋め込み", "Three.js Authors"),
    ("satellite.js の埋め込み", "globalThis.satellite"),
    ("恒星データの埋め込み", "var PLANET_DATA="),
    ("天文計算の埋め込み", "var Astro"),
    ("2D キャンバス", 'id="canvas2d"'),
    ("3D キャンバス", 'id="canvas3d"'),
    ("検索 UI", 'id="searchbox"'),
    ("方位センサー UI", 'id="btn-gyro"'),
    ("共有ダイアログ", 'id="sharedlg"'),
    ("タイムスライダー", 'id="timeslider"'),
    ("HYG の帰属表示", "HYG"),
    ("d3-celestial の帰属表示", "d3-celestial"),
]

MIN_SIZE_KB = 700
MAX_SIZE_KB = 2000
MIN_STARS = 4500


def fail(message):
    print(f"NG: {message}", file=sys.stderr)
    sys.exit(1)


def main():
    if not os.path.exists(DIST):
        fail("dist/hoshizora.html がありません。tools/build_html.py を実行してください。")

    size_kb = os.path.getsize(DIST) / 1024
    if not MIN_SIZE_KB <= size_kb <= MAX_SIZE_KB:
        fail(f"生成物のサイズが想定外です: {size_kb:.0f} KB "
             f"(想定 {MIN_SIZE_KB}-{MAX_SIZE_KB} KB)")

    with open(DIST, encoding="utf-8") as f:
        html = f.read()

    for label, marker in REQUIRED_MARKERS:
        if marker not in html:
            fail(f"{label} が見つかりません (検索文字列: {marker!r})")

    # プレースホルダの置換漏れ
    leftover = re.findall(r"\{\{[A-Z_]+\}\}", html)
    if leftover:
        fail(f"未置換のプレースホルダが残っています: {sorted(set(leftover))}")

    # 恒星数
    m = re.search(r'"starCount":(\d+)', html)
    if not m:
        fail("starCount を確認できません")
    star_count = int(m.group(1))
    if star_count < MIN_STARS:
        fail(f"恒星数が少なすぎます: {star_count} (想定 {MIN_STARS} 以上)")

    # 読み込まれる外部リソースがないこと (オフライン動作の保証)。
    # <a href> は利用者が明示的にたどるリンクであり、読み込みは発生しないため対象外。
    resource_patterns = [
        (r'\bsrc\s*=\s*["\'](?:https?:)?//', "src 属性"),
        (r'<link\b[^>]*\bhref\s*=\s*["\'](?:https?:)?//', "link 要素"),
        (r'@import\s+(?:url\()?["\']?(?:https?:)?//', "CSS の @import"),
        (r'url\(\s*["\']?(?:https?:)?//', "CSS の url()"),
    ]
    for pattern, label in resource_patterns:
        if re.search(pattern, html, re.I):
            fail(f"外部リソースへの参照があります ({label})")

    index_path = os.path.join(BASE, "dist", "index.html")
    if not os.path.exists(index_path):
        fail("dist/index.html がありません (GitHub Pages 用)")

    print(f"OK: {size_kb:.0f} KB, 恒星 {star_count} 件, "
          f"検査項目 {len(REQUIRED_MARKERS)} 件すべて充足, 外部参照なし")


if __name__ == "__main__":
    main()
