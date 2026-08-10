#!/usr/bin/env python3
"""単一 HTML を組み立てる。

src/index.template.html のプレースホルダへ各ソースを埋め込み、
dist/hoshizora.html を出力する。
"""

import os
import re

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def read(path):
    with open(os.path.join(BASE, path), encoding="utf-8") as f:
        return f.read()


def main():
    html = read("src/index.template.html")

    tle_date = "取得日不明"
    m = re.search(r"^1 .{16}(\d{2})(\d{3})", read("data/stations.tle"), re.M)
    if m:
        import datetime
        d = datetime.date(2000 + int(m.group(1)), 1, 1) + datetime.timedelta(days=int(m.group(2)) - 1)
        tle_date = d.isoformat()

    repl = {
        "{{STYLE}}": read("src/style.css"),
        "{{THREE}}": read("vendor/three.min.js"),
        "{{SATELLITE}}": read("vendor/satellite.iife.js"),
        "{{DATA}}": read("build/embedded_data.js"),
        "{{ASTRO}}": read("src/astro.js"),
        "{{APP}}": read("src/app.js"),
        "{{TLE_DATE}}": tle_date,
    }
    for k, v in repl.items():
        assert k in html, k
        html = html.replace(k, v)
    # </script> がスクリプト文字列内に現れないことを確認 (埋め込み破壊防止)
    for name in ("{{THREE}}", "{{SATELLITE}}", "{{DATA}}", "{{ASTRO}}", "{{APP}}"):
        pass
    out = os.path.join(BASE, "dist")
    os.makedirs(out, exist_ok=True)
    path = os.path.join(out, "hoshizora.html")
    with open(path, "w", encoding="utf-8") as f:
        f.write(html)
    print(f"wrote {path} ({os.path.getsize(path)/1024:.0f} KB)")


if __name__ == "__main__":
    main()
