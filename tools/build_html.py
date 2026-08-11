#!/usr/bin/env python3
"""単一 HTML を組み立てる。

src/index.template.html のプレースホルダへ各ソースを埋め込み、
dist/hoshizora.html と、GitHub Pages 用に同内容の dist/index.html を出力する。

前提: tools/build_data.py を先に実行し build/embedded_data.js を生成しておくこと。
"""

import datetime
import os
import re
import shutil
import sys

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# プレースホルダ名 -> 埋め込むファイル
SOURCES = {
    "{{STYLE}}": "src/style.css",
    "{{THREE}}": "vendor/three.min.js",
    "{{SATELLITE}}": "vendor/satellite.iife.js",
    "{{DATA}}": "build/embedded_data.js",
    "{{ASTRO}}": "src/astro.js",
    "{{APP}}": "src/app.js",
}
# <script> ブロックへ埋め込むもの (終了タグ混入の検査対象)
SCRIPT_KEYS = ("{{THREE}}", "{{SATELLITE}}", "{{DATA}}", "{{ASTRO}}", "{{APP}}")

SCRIPT_END = re.compile(r"</\s*script", re.I)


def read(rel_path):
    path = os.path.join(BASE, rel_path)
    if not os.path.exists(path):
        sys.exit(f"必要なファイルがありません: {rel_path}\n"
                 f"data/ の準備は tools/fetch_sources.sh を、"
                 f"build/ の生成は tools/build_data.py を参照してください。")
    with open(path, encoding="utf-8") as f:
        return f.read()


def tle_epoch_date():
    """TLE の元期を YYYY-MM-DD に整形する。取得できない場合は空文字。"""
    m = re.search(r"^1 .{16}(\d{2})(\d{3})", read("data/tle/stations.tle"), re.M)
    if not m:
        return ""
    year, doy = 2000 + int(m.group(1)), int(m.group(2))
    return (datetime.date(year, 1, 1) + datetime.timedelta(days=doy - 1)).isoformat()


def main():
    html = read("src/index.template.html")

    contents = {key: read(path) for key, path in SOURCES.items()}
    for key in SCRIPT_KEYS:
        if SCRIPT_END.search(contents[key]):
            sys.exit(f"{SOURCES[key]} に </script> 相当の文字列が含まれています。"
                     f"インライン埋め込みが破壊されるため中断します。")

    contents["{{TLE_DATE}}"] = tle_epoch_date() or "不明"
    for key, value in contents.items():
        if key not in html:
            sys.exit(f"テンプレートにプレースホルダ {key} がありません")
        html = html.replace(key, value)

    out_dir = os.path.join(BASE, "dist")
    os.makedirs(out_dir, exist_ok=True)
    primary = os.path.join(out_dir, "hoshizora.html")
    with open(primary, "w", encoding="utf-8") as f:
        f.write(html)
    # GitHub Pages はディレクトリ既定の index.html を配信する
    shutil.copyfile(primary, os.path.join(out_dir, "index.html"))
    print(f"wrote {primary} ({os.path.getsize(primary) / 1024:.0f} KB) と index.html")


if __name__ == "__main__":
    main()
