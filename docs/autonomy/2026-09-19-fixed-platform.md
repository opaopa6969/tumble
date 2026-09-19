# Builder 反復1: 固定台の端での衝突候補漏れ

- 対象: tumble / issue #25
- 基点: `9b74a2f34559e4f1406cceae162b23b1a6e894a8`
- 作業場所: `autonomy/fan-mu839k07-xc` 専用worktree
- 実行: Codex、2026-09-19、Builder実装・ローカル検証は約5分。モデルの詳細識別子・課金情報は取得していない。

## 観測事実

指定の `docs/product-brief.md`、repo内の `AGENTS.md` / `CLAUDE.md` は存在しなかった。
README / DESIGN / package.json / CI / 直近8コミットを読み、既存の依存なしESM物理エンジンを対象とした。
開始時open issueとPRはいずれも0件。origin/mainの最新CIは成功。
既存worktreeはクリーンで、他のworktreeは変更していない。

固定台 `pos=[0,0,0], half=[6,0.5,2]` の端 `pos=[5,2,0]` に箱を落とすと、
120フレーム後の箱の高さはbroadphase有効時 `-12.618190539319857`、
無効時 `0.9999967007330595`。固定物体がcellSizeガードから除外される一方、
候補生成では中心セルの近傍しか調べないことを確認した。

## 仮説・判断

固定物体と可動物体の全ペアを追加すれば、大きさ・回転・登録順に依存する
固定台の候補漏れを防げる。全グリッドの再設計を避ける最小の修正として選んだ。
追加コストは固定物体F、全物体Nに対して O(F·N)。固定物体が多い場面の
性能最適化は別の測定を要する。Node/npmの導入・更新、Rustへの移植は行っていない。

## 実施内容・更新終了要件

1. 固定/可動ペアを保守的に追加し、重複排除と既存ソート順を維持する。
2. 登録順2通り × 固定台の回転有無2通りで、箱が台上に留まり、
   broadphase無効時と120フレーム後の位置・姿勢・速度・sleep状態が一致する。
3. 固定物体の状態は変えず、離れた可動物体同士は引き続き候補から除外する。
4. README / DESIGNに固定物体の例外と計算量を記載する。
5. 全テスト・PR CI成功の証拠を独立Judgeへ渡す。accept後のmergeとissue closeはFinalizerが行う。

## 検証結果・再現手順

ローカル既存環境: Node `v20.20.0`。CI設定はNode 24。

- 修正前の `node test.mjs`: 84 assertions成功。
- 新規回帰ブロックを旧 `index.js` に対して実行: 36成功 / 12失敗。
- 同ブロックを修正後に対して実行: 48成功 / 0失敗。
- 修正後の `node test.mjs`: 132 assertions成功、終了コード0。
- `node --check index.js` / `node --check test.mjs` / `git diff --check`: 成功。
- 複数固定物体と近接グリッド候補が重なる追加検査でも重複なし・ソート順維持・遠方可動ペアの除外を確認。

全回帰検証は `node test.mjs` で再現できる。修正前後の比較は、一時ディレクトリに
`git show 9b74a2f:index.js` を `index.mjs` として保存し、`test.mjs` の
`// A fixed platform may extend` から最後のログ出力直前までを `ok` 集計関数と
`import { World, Body } from './index.mjs'` 付きで実行する。同じファイルを修正版に
置き換えると失敗が解消する。共有worktreeのファイルを書き換える必要はない。

## 次の判断・残る不確実性

Builderは検収のacceptを出さない。PRの最終headとCIを独立Judgeが検査する。
固定物体数が多い場合の性能は未測定。回転した可動物体同士のcellSize境界は
今回の修正対象外であり、一般的な候補完全性の証明はしていない。
次候補はその境界条件の再現調査。briefの欠落も引き継ぐが、製品方針を新しく作らない。

取り消しはmerge後に `git revert -m 1 <merge-commit>` のPRを作り、検証してmergeする。
対応issueをreopenすることで追跡を戻せる。

## 情報源

取得日: **2026-09-19**。外部技術資料の転用なし。

- 対象コード: https://github.com/opaopa6969/tumble/tree/9b74a2f34559e4f1406cceae162b23b1a6e894a8
- repoライセンス: MIT / https://github.com/opaopa6969/tumble/blob/9b74a2f34559e4f1406cceae162b23b1a6e894a8/LICENSE
- 開始時CI: https://github.com/opaopa6969/tumble/actions/runs/33618021214
- issue: https://github.com/opaopa6969/tumble/issues/25
- GitHubメタデータの取得: `gh issue list --state open` / `gh pr list --state open` / `gh run list --limit 8`。
  API利用条件: https://docs.github.com/en/site-policy/github-terms/github-terms-of-service （条件本文の転用なし）。
