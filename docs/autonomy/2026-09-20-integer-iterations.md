# 反復回数の整数性ガード (#41)

## 観測事実

`World.step(dt, substeps)` と `World.contactIterations` は有限・正値を検査していたが、
整数性を検査していなかった。JavaScript の `for (let i = 0; i < count; i++)` は
小数を切り上げた回数だけ実行するため、`substeps=0.5` は `h=2*dt` で1回積分し、
無接触・無減衰で速度1の物体を `dt=1` の間に2進めた。`contactIterations=1.5` は
接触処理を2回呼んだ。

指定された `docs/product-brief.md` とrepo内の `AGENTS.md` / `CLAUDE.md` は存在しない。
README / DESIGN、open issue / PR、CI、最近の変更を確認した。引継ぎ対象のPR #26は
指定headと成功CIのままmerge済み、issue #25は独立Judgeのaccept記録付きでclosed、
開始時のopen issue / PRは0件だった。

## 仮説・判断

反復回数は離散値なので、暗黙に丸めず正の整数だけを受理するのが既存APIの意図と一致する。
`Number.isInteger` をAPI境界で使い、構築後に公開フィールドを書き換えた場合も `step()` の
状態変更前に再検査する最小修正を選んだ。既存JS製品、依存、物理アルゴリズムは変えず、
Rustへの全面移植やNode/npmの導入は行わない。

## 実施内容・更新終了要件

- `substeps` を有限な正の整数に限定し、不正値は状態変更前に `RangeError` にする。
- `contactIterations` を構築時と `step()` 時の両方で正の整数に限定する。
- 小数の拒否と、拒否後のシミュレーション状態不変を回帰検査する。
- README / DESIGNに整数契約を記載する。
- 全テスト・構文検査・差分検査・PR CI成功を独立Judgeが検査し、accept後だけFinalizerがmergeする。

取り消しはmerge commitを `git revert -m 1` する別PRを検証・mergeし、issue #41をreopenする。

## 情報源・再現

取得日: 2026-09-20。外部技術資料・素材・依存は利用していない。

- 対象repoのコードと文書: MIT
  (https://github.com/opaopa6969/tumble/blob/c96aef4800f56674e9d52dcbd3390777af3b0bc5/LICENSE)
- issue #41: https://github.com/opaopa6969/tumble/issues/41
- GitHubメタデータ/API: GitHub Terms of Service
  (https://docs.github.com/en/site-policy/github-terms/github-terms-of-service)

基点での再現値は `substeps=0.5` で `p.x=2`、`contactIterations=1.5` で接触処理2回。
修正後は `node test.mjs` で小数入力の拒否と状態不変を再現できる。

## 反復1 ledger

- 観測事実: 基点の全218検査は成功。小数の反復回数だけが指定値と異なる回数・時間で実行された。
- 仮説: 入口で正の整数に限定すれば正常な整数入力を変えず、黙った軌道変化を防げる。
- 実施内容: 共通整数ガード、構築時・step時の検査、回帰検査、契約文書を追加。
- 検証結果: Node v20.20.0で `node test.mjs` 全228検査、`node --check index.js`、
  `node --check test.mjs`、`git diff --check` が成功。基点の全218検査も成功済み。
  PR CIは実行後に記録して独立Judgeへ渡す。
- 次の判断: 独立Judgeが最終headと証拠を検収し、repairまたはacceptを返す。Builderはmergeしない。
