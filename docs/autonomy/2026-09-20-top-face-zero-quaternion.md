# `topFace()` zero-quaternion guard (#43)

## 観測事実

`topFace({ q: [0,0,0,0] })` は `main` の `e870900` で例外を投げず、恒等姿勢と
同じ `{ axis: 1, sign: 1, normal: [0,1,0], alignment: 1 }` を返した。
`Body` のconstructorはゼロ長quaternionを拒否する一方、`topFace` は公開された
`body.q` の変更後や Body-like object も受け付ける。内部の正規化fallbackがゼロを
そのまま通し、面法線の回転式が恒等写像のように振る舞うことが原因だった。

指定された `docs/product-brief.md` とrepo内の `AGENTS.md` / `CLAUDE.md` は存在せず、
README / DESIGNを製品範囲として確認した。開始時のopen issue / PRは0件、
`origin/main` の直近CIは成功。引継ぎ対象PR #26は指定headと成功CIでmerge済み、
issue #25はclosed済みだった。

## 仮説・判断と更新終了要件

`topFace` の境界でゼロ長だけを `RangeError` にすれば、無効な骰子姿勢の黙った
読み取りを防ぎつつ、既存の単位・非単位quaternionの正規化挙動を維持できる。
solver、`Body` の可変性、依存や配布方式には触れない最小・可逆な変更とした。

- ゼロ長の `body.q` を `RangeError` で拒否し、入力objectを変更しない。
- 有限・非ゼロ長の単位／スケール済みquaternionは従来どおり同じ面を返す。
- README / DESIGNに呼び出し境界の契約を記載する。
- 全テスト・構文検査・差分検査・PR CI成功を独立Judgeが検査する。
- Judgeのaccept後だけFinalizerがmergeし、issue #43のcloseを確認する。

取り消しはmerge commitを `git revert -m 1` する別PRを検証・mergeし、issue #43を
reopenする。

## 検証結果・再現手順

修正前の再現と、修正後の全検証は次で実行する。

```sh
node --input-type=module - <<'JS'
import { topFace } from './index.js';
console.log(topFace({ q: [0, 0, 0, 0] }));
JS
node test.mjs
node --check index.js
node --check test.mjs
git diff --check
```

Node `v20.20.0` で、修正後の `node test.mjs` は全230件成功（既存228件と
新規2件）、終了コード0。`node --check index.js`、`node --check test.mjs`、
`git diff --check` も成功した。境界プローブではゼロ長だけが `RangeError`、
`[0,0,0,1]` と `[0,0,0,3]` は同じ上面を返し、3入力すべてが非変更だった。
PR CI URLは実行後にPRへ記録する。

## 反復1 ledger

- 観測事実: ゼロquaternionが恒等姿勢と同じ上面を返した。
- 仮説: `topFace` の正規化前に非ゼロ長を要求すれば、有効入力を変えず誤読だけを防げる。
- 実施内容: 長さguard、拒否と非変更の回帰検査、README / DESIGNの契約を追加。
- 検証結果: Node v20.20.0で全230件、構文検査、差分検査、境界プローブが成功。
  PR CIは独立Judgeへ渡す前に確認する。
- 次の判断: 独立Judgeが最終headと証拠を検収し、repairまたはacceptを返す。Builderはmergeしない。

## 情報源

取得日: **2026-09-20**。外部技術資料・素材・依存は利用していない。

- 対象repoのコードと文書: MIT
  (https://github.com/opaopa6969/tumble/blob/e870900162e76c8863961c902ead2aefb5fcd186/LICENSE)
- issue #43: https://github.com/opaopa6969/tumble/issues/43
- GitHubメタデータ/API: GitHub Terms of Service
  (https://docs.github.com/en/site-policy/github-terms/github-terms-of-service)
