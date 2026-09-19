# `step(dt)` の有限性ガード

## 観測事実

`main` の `5bd83dd` では `World.step(Infinity, 8)` が既存の
`dt > 0` 検査を通過した。例外は発生せず、追加済み body の
`p` / `q` / `v` / `w` が非有限値になった。`JSON.stringify` した再現結果は
各成分が `null` だった。

指定された `docs/product-brief.md` とリポジトリ内の `AGENTS.md` /
`CLAUDE.md` は存在しなかったため、製品範囲は `README.md` と
`DESIGN.md` から確認した。既存 PR #26 / issue #25 は merge / close 済みで、
開始時点の open issue と open PR はともに0件だった。

## 仮説と判断

`Infinity > 0` が真になるため、正値検査だけでは非有限の時間幅を拒否できない。
積分前に `Number.isFinite(dt)` を検査すれば、正常な有限入力の軌道を変えずに
状態汚染を防げる。物理アルゴリズムや公開APIを拡張しない、小さく可逆な修正を
選んだ。

## 実施内容と終了要件

- `step()` が非有限の `dt` を状態変更前に `RangeError` で拒否する。
- Infinity / NaN / 0 / 負数の拒否と、拒否後の状態不変を回帰検査する。
- README / DESIGN に `dt` は有限かつ正という契約を記載する。
- 全テスト、構文検査、差分検査、PR CIが成功する。
- 独立 Judge の accept 後に Finalizer が mergeし、issue #34 の closeを確認する。

対象外は既存の可変公開フィールド全体の再監査と、物理・配布方式の変更である。
取り消す場合は merge commit を `git revert -m 1` する別PRを検証・mergeし、
issue #34 を reopenする。

## 情報源と再現

取得日: 2026-09-20。

- 対象リポジトリのコードと文書: MIT (`LICENSE`)
- issue #34: https://github.com/opaopa6969/tumble/issues/34
- GitHubメタデータ: GitHub Terms of Service
  (https://docs.github.com/en/site-policy/github-terms/github-terms-of-service)

外部技術資料・素材・依存は利用していない。

```sh
node --input-type=module - <<'EOF'
import { World, Body } from './index.js';
const world = new World();
const body = world.add(new Body({ pos: [0, 1, 0] }));
world.step(Infinity, 8);
console.log(body.p, body.q, body.v, body.w);
EOF

node test.mjs
node --check index.js
node --check test.mjs
git diff --check
```
