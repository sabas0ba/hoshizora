# data/

生成物 `dist/hoshizora.html` に埋め込まれるデータ。すべてコミット済みであり、
ビルドにネットワーク接続は不要です。

| ファイル | 内容 | 出典 | ライセンス |
|---|---|---|---|
| `hyg_v41_mag6.csv` | 6.0 等以下の恒星 5,070 件 | HYG Database v4.1 | CC BY-SA 4.0 |
| `constellations.json` | 星座名 (多言語) とラベル位置 | d3-celestial | BSD 3-Clause |
| `constellations.lines.json` | 星座線 | d3-celestial | BSD 3-Clause |
| `milkyway.json` | 天の川の輪郭 (5 階調) | d3-celestial | BSD 3-Clause |
| `tle/stations.tle`, `tle/science.tle` | 人工衛星の軌道要素 | CelesTrak | 制限なし |

由来と加工内容の詳細は [`../THIRD-PARTY-NOTICES.md`](../THIRD-PARTY-NOTICES.md)
を参照してください。とくに `hyg_v41_mag6.csv` は CC BY-SA 4.0 の継承対象です。

## 再生成と検証

上流はすべて commit SHA で固定しています。

```sh
tools/fetch_sources.sh --verify   # 既存ファイルのハッシュを照合
tools/fetch_sources.sh            # 上流から再取得 (git, python3, bun が必要)
```

TLE のみは時刻依存のため固定対象外です。再取得すると内容が変わり、
`tools/SHA256SUMS` の照合対象からも外してあります。

`hygdata_v41.csv` の完全版 (約 34 MB) はリポジトリに含めていません。
`tools/extract_hyg_subset.py` が 6 等以下の抽出版を生成します。
