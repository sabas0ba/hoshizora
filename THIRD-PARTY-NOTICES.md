# 第三者のソフトウェアおよびデータ

本リポジトリには、以下の第三者成果物が同梱されています。生成される単一ファイル
`dist/hoshizora.html` には、これらすべてが埋め込まれます。

自作コード (`src/`, `tools/`) は Apache License 2.0 です。以下の同梱物には
それぞれのライセンスが適用され、Apache-2.0 に置き換わるものではありません。

## 要約

| 同梱物 | 版・固定 commit | ライセンス | リポジトリ内の位置 |
|---|---|---|---|
| HYG Database (恒星カタログ) | v4.1 / `c7f7f883` | CC BY-SA 4.0 | `data/hyg_v41_mag6.csv` |
| d3-celestial (星座線・星座名・天の川) | `7e720a3d` | BSD 3-Clause | `data/constellations*.json`, `data/milkyway.json` |
| CelesTrak TLE (軌道要素) | 2026-08-10 取得 | 制限なし (下記参照) | `data/tle/*.tle` |
| three.js | r147 / `309b00af` | MIT | `vendor/three.min.js` |
| satellite.js | 4.1.4 / `3c1efc0c` | MIT | `vendor/satellite.iife.js` |

上流の commit と成果物のハッシュは `tools/SHA256SUMS` に記録しており、
`tools/fetch_sources.sh --verify` で照合できます。

## 継承ライセンス (CC BY-SA 4.0) について

これは利用上もっとも注意を要する点であるため、独立した節として記します。

`data/hyg_v41_mag6.csv` は HYG Database v4.1 から実視等級 6.0 以下の恒星と
必要な列のみを抽出した派生物です。HYG Database は
**Creative Commons 表示 - 継承 4.0 国際 (CC BY-SA 4.0)** で提供されており、
その派生物にも同ライセンスが継承されます。

したがって:

- 生成物 `dist/hoshizora.html` は、恒星データ部分について CC BY-SA 4.0 の
  条件下にあります。同ファイルを再配布する場合、または恒星データを改変して
  配布する場合は、**帰属表示** と **同一ライセンスでの提供** が必要です。
- 自作コード (`src/`, `tools/`) 単体を Apache-2.0 の下で利用する場合、
  この制約は及びません。恒星データを含めないのであれば Apache-2.0 のみが
  適用されます。
- 本プロジェクトは HYG Database の作者による推奨や保証を受けたものでは
  ありません。

CC BY-SA 4.0 の全文: <https://creativecommons.org/licenses/by-sa/4.0/legalcode>

## 各同梱物の詳細

### HYG Database v4.1

- 出典: <https://github.com/astronexus/HYG-Database>
- 固定 commit: `c7f7f883fe678cc7680169a50ccd7dcc49b060ce`
- 元ファイル: `hyg/CURRENT/hygdata_v41.csv`
- ライセンス: CC BY-SA 4.0 (`data/LICENSE-HYG.md`)
- 加工内容: 実視等級 6.0 以下の 5,070 星に限定し、列を
  `hip, proper, ra, dec, mag, ci, spect, con, bayer, flam` に削減。
  等級順に整列 (`tools/extract_hyg_subset.py`)。
- HYG Database 自体は Hipparcos、Yale Bright Star Catalog、Gliese Catalog を
  統合したものです。

### d3-celestial

- 出典: <https://github.com/ofrohn/d3-celestial>
- 固定 commit: `7e720a3de062059d4c5400a379146a601d9010e0`
- 著作権: Copyright (c) 2015, Olaf Frohn
- ライセンス: BSD 3-Clause (`data/LICENSE-d3-celestial.txt`)
- 使用データ: `constellations.json` (星座名・ラベル位置)、
  `constellations.lines.json` (星座線)、`milkyway.json` (天の川輪郭)
- 加工内容: ビルド時に座標を整数化し、天の川輪郭は表示に必要な 2 階調
  (`ol1`, `ol3`) のみを間引いて埋め込み (`tools/build_data.py`)。
  星座名は同データに含まれる日本語表記 (`ja`) を使用。

### CelesTrak TLE

- 出典: CelesTrak <https://celestrak.org/> (Dr. T.S. Kelso)
- 取得経路: <https://github.com/astrion-tech/celestrak-mirror> (30 分ごと更新の公開ミラー)
- 取得日: 2026-08-10
- 使用範囲: `stations.tle`, `science.tle` のうち ISS (ZARYA)、CSS (TIANHE)、HST の 3 基
- 条件: CelesTrak は軌道要素データを利用制限なく提供しています。出典表示を
  求められてはいませんが、本プロジェクトでは謝意として明記します。
- 注意: TLE は時刻依存のデータであり、元期から離れるほど誤差が増大します。
  同梱スナップショットの元期は生成物の設定パネルに表示されます。

### three.js r147

- 出典: <https://github.com/mrdoob/three.js>
- 固定 commit: `309b00afb6dcbc5e6c58e72f10eaa8d2e8888c83` (tag `r147`)
- 著作権: Copyright © 2010-2022 three.js authors
- ライセンス: MIT (`vendor/LICENSE-three.txt`)
- 加工内容: 配布物の `build/three.min.js` をそのまま使用 (無改変)。

### satellite.js 4.1.4

- 出典: <https://github.com/shashwatak/satellite-js>
- 固定 commit: `3c1efc0cee5197ea5a28b35a993cbf24354ebc1e` (tag `4.1.4`)
- 著作権: Copyright (C) 2013 Shashwat Kandadai, UCSC Jack Baskin School of Engineering
- ライセンス: MIT (`vendor/LICENSE-satellite.md`)
- 加工内容: 当該タグはビルド済み成果物をリポジトリに含まないため、`src/indexUmd.js`
  を起点に IIFE 形式へバンドルし、グローバル `satellite` を公開する形に変換
  (`tools/fetch_sources.sh`)。ロジックの変更はありません。
- satellite.js は SGP4/SDP4 実装を含み、その系譜は Vallado らによる公開実装に
  遡ります。

## 天文計算について

`src/astro.js` の計算式は、以下の公刊された文献に基づく独自実装です。
これらの文献のコードを転載したものではありません。

- Jean Meeus, *Astronomical Algorithms*, 2nd ed., Willmann-Bell, 1998
  (太陽・月の位置、恒星時、大気差)
- E. M. Standish, *Keplerian Elements for Approximate Positions of the Major
  Planets*, JPL Solar System Dynamics
  <https://ssd.jpl.nasa.gov/planets/approx_pos.html> (惑星の位置)
