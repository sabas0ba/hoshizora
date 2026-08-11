#!/usr/bin/env python3
"""HYG 星表から本アプリが使用する範囲のみを抽出する。

完全版 hygdata_v41.csv は約 34 MB あり、リポジトリに含めるには大きい。
本スクリプトは実視等級 MAG_LIMIT 以下の恒星と必要な列のみを抜き出し、
data/hyg_v41_mag6.csv (約 0.3 MB) を生成する。

抽出物は HYG Database の派生物であり、CC BY-SA 4.0 が継承される。
詳細は THIRD-PARTY-NOTICES.md を参照。

使用法:
    python3 tools/extract_hyg_subset.py <入力 hygdata_v41.csv> <出力 csv>
"""

import argparse
import csv
import os
import sys

MAG_LIMIT = 6.0

# 出力する列。表示に必要なものと、将来的な同定・拡張に有用なものに限定する。
COLUMNS = ["hip", "proper", "ra", "dec", "mag", "ci", "spect", "con", "bayer", "flam"]


def extract(src_path, dst_path):
    rows = []
    with open(src_path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        missing = [c for c in COLUMNS + ["id"] if c not in reader.fieldnames]
        if missing:
            raise SystemExit(f"入力に必要な列がありません: {missing}")
        for row in reader:
            if row["id"] == "0":
                continue  # id=0 は太陽。別途計算するため除外する。
            try:
                mag = float(row["mag"])
            except (TypeError, ValueError):
                continue
            if mag > MAG_LIMIT:
                continue
            rows.append([(row.get(c) or "").strip() for c in COLUMNS])

    # 等級順に整列し、入力の行順に依存しない決定的な出力にする。
    rows.sort(key=lambda r: (float(r[COLUMNS.index("mag")]), r[COLUMNS.index("ra")]))

    os.makedirs(os.path.dirname(os.path.abspath(dst_path)), exist_ok=True)
    with open(dst_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f, lineterminator="\n")
        writer.writerow(COLUMNS)
        writer.writerows(rows)
    return len(rows)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("src", help="HYG v4.1 の完全版 CSV")
    parser.add_argument("dst", help="出力先 CSV")
    args = parser.parse_args()
    if not os.path.exists(args.src):
        sys.exit(f"入力が存在しません: {args.src}")
    n = extract(args.src, args.dst)
    size_kb = os.path.getsize(args.dst) / 1024
    print(f"{n} 星を抽出しました (mag <= {MAG_LIMIT}) -> {args.dst} ({size_kb:.0f} KB)")


if __name__ == "__main__":
    main()
