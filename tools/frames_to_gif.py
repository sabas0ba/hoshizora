"""PNG フレームの並びを 1 本の GIF にまとめる。

使用法: python3 tools/frames_to_gif.py <フレーム一覧ファイル> <出力 GIF>

一覧ファイルは 1 行 1 コマで、`パス<TAB>表示時間[ms]` の形式。GIF の容量は
ほぼコマ数で決まるため、動きのないところはコマを増やさず表示時間を延ばす。

tools/make_preview_gif.js から呼ばれる補助スクリプトで、Pillow を必要とする
(アプリのビルド自体には不要)。

コマごとに減色すると色が揺れてちらつくため、全コマから共通のパレットを
1 つ作って全体に適用する。
"""

import sys
from pathlib import Path

from PIL import Image

COLORS = 96  # 夜空は階調が少ないため、この程度でも目立った劣化はない


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__.strip(), file=sys.stderr)
        return 2
    list_file, out_path = sys.argv[1], Path(sys.argv[2])

    entries = []
    for line in Path(list_file).read_text().splitlines():
        if not line.strip():
            continue
        path, _, ms = line.partition("\t")
        entries.append((Path(path), int(ms)))
    if not entries:
        print("コマがありません", file=sys.stderr)
        return 1

    images = {p: Image.open(p).convert("RGB") for p, _ in entries}

    # 共通パレットは全コマを縦に連結した画像から作る。
    uniq = list(images.values())
    w, h = uniq[0].size
    strip = Image.new("RGB", (w, h * len(uniq)))
    for i, img in enumerate(uniq):
        strip.paste(img, (0, i * h))
    palette = strip.quantize(colors=COLORS, method=Image.MEDIANCUT)

    quantized = {
        p: img.quantize(palette=palette, dither=Image.Dither.NONE)
        for p, img in images.items()
    }
    seq = [quantized[p] for p, _ in entries]
    durations = [ms for _, ms in entries]

    out_path.parent.mkdir(parents=True, exist_ok=True)
    seq[0].save(
        out_path,
        save_all=True,
        append_images=seq[1:],
        duration=durations,
        loop=0,
        optimize=True,
        disposal=1,
    )
    print(
        f"{len(seq)} コマ ({w}x{h}, {COLORS} 色, {sum(durations) / 1000:.1f} 秒)"
        f" -> {out_path} ({out_path.stat().st_size / 1024:.0f} KB)"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
