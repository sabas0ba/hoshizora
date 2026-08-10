#!/usr/bin/env python3
"""埋め込み用データ生成スクリプト。

入力 (data/):
  hygdata_v41.csv           HYG v4.1 星表 (CC BY-SA 4.0)
  constellations.lines.json d3-celestial 星座線 (BSD-3)
  constellations.json       d3-celestial 星座名・ラベル位置 (BSD-3)
  milkyway.json             d3-celestial 天の川輪郭 (BSD-3)
  stations.tle, science.tle CelesTrak TLE スナップショット

出力 (build/embedded_data.js): グローバル PLANET_DATA を定義する JS。
"""

import csv
import json
import os
import re

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(BASE, "data")
OUT = os.path.join(BASE, "build")
MAG_LIMIT = 6.0

os.makedirs(OUT, exist_ok=True)


def build_stars():
    """HYG から mag<=MAG_LIMIT の恒星を抽出し平坦な整数配列に圧縮する。

    形式: ra(deg*10000), dec(deg*10000), mag(*100), ci(B-V, *100, 欠損は 999)
    """
    flat = []
    names = []  # [index, name]
    count = 0
    with open(os.path.join(DATA, "hygdata_v41.csv"), newline="") as f:
        for row in csv.DictReader(f):
            if row["id"] == "0":  # 太陽エントリを除外
                continue
            try:
                mag = float(row["mag"])
            except ValueError:
                continue
            if mag > MAG_LIMIT:
                continue
            ra_deg = float(row["ra"]) * 15.0
            dec = float(row["dec"])
            ci_s = row.get("ci", "")
            ci = int(round(float(ci_s) * 100)) if ci_s not in ("", None) else 999
            flat.extend([
                int(round(ra_deg * 10000)),
                int(round(dec * 10000)),
                int(round(mag * 100)),
                ci,
            ])
            proper = (row.get("proper") or "").strip()
            if proper:
                names.append([count, proper])
            count += 1
    return flat, names, count


def build_constellation_lines():
    """星座線を [ [ra,dec,ra,dec,...](线分連結列), ... ] (deg*100) に変換。"""
    with open(os.path.join(DATA, "constellations.lines.json")) as f:
        geo = json.load(f)
    lines = []
    for feat in geo["features"]:
        for seg in feat["geometry"]["coordinates"]:
            pts = []
            for lon, lat in seg:
                ra = lon if lon >= 0 else lon + 360.0
                pts.extend([int(round(ra * 100)), int(round(lat * 100))])
            lines.append(pts)
    return lines


def build_constellation_names():
    """星座ラベル: [ja, la, ra(deg*100), dec(deg*100)]"""
    with open(os.path.join(DATA, "constellations.json")) as f:
        geo = json.load(f)
    out = []
    for feat in geo["features"]:
        p = feat["properties"]
        lon, lat = feat["geometry"]["coordinates"]
        ra = lon if lon >= 0 else lon + 360.0
        ja = p.get("ja") or p.get("la") or p.get("name")
        out.append([ja, p.get("desig", ""), int(round(ra * 100)), int(round(lat * 100))])
    return out


def _downsample(ring, step_deg=1.2):
    """輪郭の点列を距離間引きする (deg)。"""
    out = []
    last = None
    for lon, lat in ring:
        if last is None:
            out.append((lon, lat))
            last = (lon, lat)
            continue
        dlon = abs(lon - last[0])
        if dlon > 180:
            dlon = 360 - dlon
        if (dlon ** 2 + (lat - last[1]) ** 2) ** 0.5 >= step_deg:
            out.append((lon, lat))
            last = (lon, lat)
    if len(out) > 2 and out[-1] != ring[-1]:
        out.append(tuple(ring[-1]))
    return out


def build_milkyway():
    """天の川: ol1(外縁) と ol3(明部) の2レベルのみ、間引きして埋め込む。"""
    with open(os.path.join(DATA, "milkyway.json")) as f:
        geo = json.load(f)
    levels = {}
    for feat in geo["features"]:
        if feat["id"] not in ("ol1", "ol3"):
            continue
        polys = []
        for ring in feat["geometry"]["coordinates"]:
            ds = _downsample(ring)
            if len(ds) < 8:
                continue
            pts = []
            for lon, lat in ds:
                ra = lon if lon >= 0 else lon + 360.0
                pts.extend([int(round(ra * 10)), int(round(lat * 10))])
            polys.append(pts)
        levels[feat["id"]] = polys
    return levels


def build_tles():
    """代表的な衛星のみ抽出。"""
    wanted = {
        "ISS (ZARYA)": "ISS (国際宇宙ステーション)",
        "CSS (TIANHE)": "CSS 天和 (中国宇宙ステーション)",
        "HST": "ハッブル宇宙望遠鏡",
    }
    sats = []
    for fname in ("stations.tle", "science.tle"):
        path = os.path.join(DATA, fname)
        if not os.path.exists(path):
            continue
        with open(path) as f:
            lines = [l.rstrip() for l in f]
        for i in range(0, len(lines) - 2, 3):
            name = lines[i].strip()
            if name in wanted and lines[i + 1].startswith("1 "):
                sats.append({
                    "name": wanted[name],
                    "l1": lines[i + 1],
                    "l2": lines[i + 2],
                })
    return sats


def main():
    stars_flat, star_names, n = build_stars()
    lines = build_constellation_lines()
    cnames = build_constellation_names()
    mw = build_milkyway()
    tles = build_tles()

    tle_epoch = ""
    if tles:
        m = re.match(r"^1 .{16}(\d{2})(\d{3}\.\d+)", tles[0]["l1"] + " ")
        if m:
            tle_epoch = f"20{m.group(1)}年 通日{float(m.group(2)):.1f}"

    payload = {
        "starCount": n,
        "stars": stars_flat,
        "starNames": star_names,
        "constLines": lines,
        "constNames": cnames,
        "milkyway": mw,
        "tles": tles,
        "tleEpochNote": tle_epoch,
    }
    js = "// generated by tools/build_data.py\nvar PLANET_DATA=" + json.dumps(
        payload, ensure_ascii=False, separators=(",", ":")
    ) + ";\n"
    out_path = os.path.join(OUT, "embedded_data.js")
    with open(out_path, "w") as f:
        f.write(js)
    print(f"stars={n} names={len(star_names)} lines={len(lines)} "
          f"mw_polys={sum(len(v) for v in mw.values())} tles={len(tles)}")
    print(f"wrote {out_path} ({os.path.getsize(out_path)/1024:.0f} KB)")


if __name__ == "__main__":
    main()
