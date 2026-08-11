"""PNG フレームの並びを 1 本の GIF にまとめる。

使用法: python3 tools/frames_to_gif.py <フレーム一覧ファイル> <出力 GIF> <1 フレームの ms>

一覧ファイルは 1 行 1 パスで、同じパスを繰り返せばその枚数だけ静止する。
tools/make_preview_gif.js から呼ばれる補助スクリプトで、Pillow を必要とする
(ビルド自体には不要)。

フレームごとに減色すると色が揺れてちらつくため、全フレームから共通の
パレットを 1 つ作って全体に適用する。
"""

import sys
from pathlib import Path

from PIL import Image

SCALE = 0.45  # 2 倍で撮ったフレームを縮小する (縮小時のアンチエイリアスで星が見やすくなる)
COLORS = 128  # 夜空は階調が少ないため 128 色で足りる


def main() -> int:
    if len(sys.argv) != 4:
        print(__doc__.strip(), file=sys.stderr)
        return 2
    list_file, out_path, frame_ms = sys.argv[1], Path(sys.argv[2]), int(sys.argv[3])

    paths = [Path(p) for p in Path(list_file).read_text().split() if p]
    if not paths:
        print("フレームがありません", file=sys.stderr)
        return 1

    cache: dict[Path, Image.Image] = {}
    frames = []
    for p in paths:
        if p not in cache:
            img = Image.open(p).convert("RGB")
            size = (round(img.width * SCALE), round(img.height * SCALE))
            cache[p] = img.resize(size, Image.LANCZOS)
        frames.append(cache[p])

    # 共通パレットは全フレームを縦に連結した画像から作る。
    uniq = list(cache.values())
    w, h = uniq[0].size
    strip = Image.new("RGB", (w, h * len(uniq)))
    for i, img in enumerate(uniq):
        strip.paste(img, (0, i * h))
    palette = strip.quantize(colors=COLORS, method=Image.MEDIANCUT)

    quantized = {
        id(img): img.quantize(palette=palette, dither=Image.Dither.NONE)
        for img in uniq
    }
    seq = [quantized[id(f)] for f in frames]

    out_path.parent.mkdir(parents=True, exist_ok=True)
    seq[0].save(
        out_path,
        save_all=True,
        append_images=seq[1:],
        duration=frame_ms,
        loop=0,
        optimize=True,
        disposal=1,
    )
    print(f"{len(seq)} フレーム -> {out_path} ({out_path.stat().st_size / 1024:.0f} KB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
