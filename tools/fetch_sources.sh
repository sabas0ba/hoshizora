#!/usr/bin/env bash
#
# data/ と vendor/ を上流から再生成する。
#
# 通常のビルドでは実行不要である。生成物はすべてリポジトリにコミット済みであり、
# ビルド (tools/build_data.py, tools/build_html.py) はネットワークを必要としない。
# 本スクリプトは以下の場合にのみ用いる。
#   - 上流の更新を取り込むとき
#   - コミット済みデータの由来を検証するとき
#
# 上流はすべて commit SHA で固定する。TLE のみ時刻依存のため最新を取得する。
#
# 使用法:
#   tools/fetch_sources.sh              # 全部を再取得
#   tools/fetch_sources.sh --verify     # 再取得せず、既存ファイルのハッシュのみ照合
#
set -euo pipefail

readonly REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly WORK_DIR="${REPO_ROOT}/.fetch-work"

# --- 上流の固定 ---------------------------------------------------------------
readonly HYG_REPO="https://github.com/astronexus/HYG-Database.git"
readonly HYG_COMMIT="c7f7f883fe678cc7680169a50ccd7dcc49b060ce"
readonly HYG_CSV="hyg/CURRENT/hygdata_v41.csv"

readonly CELESTIAL_REPO="https://github.com/ofrohn/d3-celestial.git"
readonly CELESTIAL_COMMIT="7e720a3de062059d4c5400a379146a601d9010e0"

readonly THREE_REPO="https://github.com/mrdoob/three.js.git"
readonly THREE_COMMIT="309b00afb6dcbc5e6c58e72f10eaa8d2e8888c83"  # tag r147

readonly SATELLITE_REPO="https://github.com/shashwatak/satellite-js.git"
readonly SATELLITE_COMMIT="3c1efc0cee5197ea5a28b35a993cbf24354ebc1e"  # tag 4.1.4

# TLE は 30 分ごとに更新される CelesTrak のミラーから取得する。
# 内容が時刻依存のためハッシュ固定の対象外。
readonly TLE_REPO="https://github.com/astrion-tech/celestrak-mirror.git"

log() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31mエラー:\033[0m %s\n' "$*" >&2; exit 1; }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "$1 が必要です"
}

# 指定 commit のみを取得する浅いクローン
clone_at() {
  local repo="$1" commit="$2" dest="$3"
  git init -q "${dest}"
  git -C "${dest}" remote add origin "${repo}"
  git -C "${dest}" fetch -q --depth 1 origin "${commit}"
  git -C "${dest}" checkout -q FETCH_HEAD
}

verify_checksums() {
  log "SHA256 を照合します"
  (cd "${REPO_ROOT}" && sha256sum -c tools/SHA256SUMS) \
    || die "ハッシュが一致しません。上流の更新か、ファイルの破損が考えられます。"
  log "照合に成功しました"
}

if [[ "${1:-}" == "--verify" ]]; then
  verify_checksums
  exit 0
fi

require_cmd git
require_cmd python3
require_cmd bun   # satellite.js の IIFE バンドルに使用する

rm -rf "${WORK_DIR}"
mkdir -p "${WORK_DIR}" "${REPO_ROOT}/data/tle" "${REPO_ROOT}/vendor"
trap 'rm -rf "${WORK_DIR}"' EXIT

# --- 恒星カタログ (HYG v4.1, CC BY-SA 4.0) -----------------------------------
log "HYG Database を取得します (${HYG_COMMIT:0:12})"
clone_at "${HYG_REPO}" "${HYG_COMMIT}" "${WORK_DIR}/hyg"
[[ -f "${WORK_DIR}/hyg/${HYG_CSV}" ]] || die "${HYG_CSV} が見つかりません"
log "6 等以下を抽出します (完全版 34 MB はコミットしない)"
python3 "${REPO_ROOT}/tools/extract_hyg_subset.py" \
  "${WORK_DIR}/hyg/${HYG_CSV}" "${REPO_ROOT}/data/hyg_v41_mag6.csv"
cp "${WORK_DIR}/hyg/hyg/CURRENT/LICENSE" "${REPO_ROOT}/data/LICENSE-HYG.md"

# --- 星座線・星座名・天の川 (d3-celestial, BSD-3-Clause) ----------------------
log "d3-celestial を取得します (${CELESTIAL_COMMIT:0:12})"
clone_at "${CELESTIAL_REPO}" "${CELESTIAL_COMMIT}" "${WORK_DIR}/celestial"
for f in constellations.json constellations.lines.json milkyway.json; do
  cp "${WORK_DIR}/celestial/data/${f}" "${REPO_ROOT}/data/${f}"
done
cp "${WORK_DIR}/celestial/LICENSE" "${REPO_ROOT}/data/LICENSE-d3-celestial.txt"

# --- 人工衛星の軌道要素 (CelesTrak) ------------------------------------------
log "TLE スナップショットを取得します (時刻依存)"
clone_at "${TLE_REPO}" "$(git ls-remote "${TLE_REPO}" HEAD | cut -f1)" "${WORK_DIR}/tle"
for f in stations science; do
  cp "${WORK_DIR}/tle/tle/${f}.tle" "${REPO_ROOT}/data/tle/${f}.tle"
done
cp "${WORK_DIR}/tle/LAST_REFRESH" "${REPO_ROOT}/data/tle/LAST_REFRESH"

# --- three.js (MIT) -----------------------------------------------------------
log "three.js r147 を取得します (${THREE_COMMIT:0:12})"
clone_at "${THREE_REPO}" "${THREE_COMMIT}" "${WORK_DIR}/three"
cp "${WORK_DIR}/three/build/three.min.js" "${REPO_ROOT}/vendor/three.min.js"
cp "${WORK_DIR}/three/LICENSE" "${REPO_ROOT}/vendor/LICENSE-three.txt"

# --- satellite.js (MIT) -------------------------------------------------------
# 4.1.4 はビルド済み成果物をリポジトリに含まないため、ソースからバンドルする。
log "satellite.js 4.1.4 を取得しバンドルします (${SATELLITE_COMMIT:0:12})"
clone_at "${SATELLITE_REPO}" "${SATELLITE_COMMIT}" "${WORK_DIR}/satellite"
cat > "${WORK_DIR}/satellite/bundle-entry.js" <<'EOF'
import satellite from "./src/indexUmd";
globalThis.satellite = satellite;
EOF
(cd "${WORK_DIR}/satellite" && bun build bundle-entry.js --format=iife --minify \
  --outfile="${REPO_ROOT}/vendor/satellite.iife.js")
cp "${WORK_DIR}/satellite/LICENSE.md" "${REPO_ROOT}/vendor/LICENSE-satellite.md"

log "完了しました。差分を確認し、必要なら tools/SHA256SUMS を更新してください:"
echo "    (cd \"${REPO_ROOT}\" && sha256sum \\"
echo "        data/hyg_v41_mag6.csv data/constellations.json \\"
echo "        data/constellations.lines.json data/milkyway.json \\"
echo "        vendor/three.min.js vendor/satellite.iife.js > tools/SHA256SUMS)"
