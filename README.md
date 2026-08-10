# 星空シミュレータ (hoshizora)

日時と緯度経度を指定して星空を 2D 星座早見 / 3D プラネタリウム表示する
単一ファイル HTML アプリケーション。オフラインで動作する。

## 成果物

- `dist/hoshizora.html` — 配布物。ブラウザで開くだけで動作する (約 830 KB)。

## 機能

- 2D: 天頂中心の全天図 (正距方位図法、北上・東左の星座早見盤形式)
- 3D: three.js による地上からのドームビュー (ドラッグ視線移動、ピンチ/ホイール画角)
- 日時入力・観測地入力 (都市プリセット / Geolocation)
- タイムスライダー (基準日時 ±24h) と再生 (×1〜×86400)
- 表示トグル: 星座線・星座名・恒星名・惑星・太陽/月・天の川・人工衛星・
  方位グリッド・地面・大気 (昼夜による空の色と星の減光)
- 天体タップで名称・等級・高度方位を表示
- 人工衛星: ISS / CSS / HST (内蔵 TLE スナップショットを SGP4 で伝播)

航空機の表示はリアルタイム ADS-B データが必要なため対象外とした。

## 構成

```
src/            アプリケーションソース
  astro.js        天文計算 (Meeus 略算: 恒星時・太陽・月・惑星・大気差)
  app.js          2D/3D 描画・UI
  style.css       スタイル
  index.template.html  埋め込みテンプレート
tools/          ビルド・検証スクリプト
  build_data.py       data/ から埋め込みデータ (build/embedded_data.js) を生成
  build_html.py       単一 HTML (dist/hoshizora.html) を組み立て
  screenshot_test.js  Playwright による表示確認
data/           取得した元データ (git 管理外の大容量含む)
vendor/         three.min.js r147, satellite.iife.js (v4.1.4 を bun でバンドル)
build/, dist/   生成物
```

## ビルド

```
python3 tools/build_data.py
python3 tools/build_html.py
node tools/screenshot_test.js   # 表示確認 (要 Playwright + Chromium)
```

## 精度

- 太陽: Meeus 低精度式 (〜0.01°)。Meeus 例 25.a で検証済
- 月: Meeus ch.47 主要項 (〜0.3°) + 高度視差の簡易補正。Meeus 例 47.a で検証済
- 惑星: Standish (JPL) 近似ケプラー要素 1800–2050 (数分角)
- 恒星: HYG v4.1 の J2000 位置。歳差・固有運動は未補正 (±数百年で <1° 程度)
- 衛星: TLE エポックから離れるほど誤差増大 (特に ISS は軌道維持で日単位でずれる)

## データ出典・ライセンス

| データ | 出典 | ライセンス |
|---|---|---|
| 恒星 (〜6.0 等, 5070 星) | astronexus/HYG-Database v4.1 | CC BY-SA 4.0 |
| 星座線・星座名・天の川輪郭 | ofrohn/d3-celestial | BSD-3-Clause |
| 衛星 TLE | CelesTrak (astrion-tech/celestrak-mirror 経由, 2026-08-10 取得) | パブリック |
| three.js r147 | mrdoob/three.js | MIT |
| satellite.js 4.1.4 | shashwatak/satellite-js | MIT |

生成 HTML には上記の帰属表示を含む。
