# `topFace()` extreme-quaternion normalization (#45)

## 観測事実

PR #44 の merge 後も、有限・非ゼロの quaternion の長さが表現上限を超えるか、
上限付近でそれを超える値へ丸められる場合、`Math.hypot` は `Infinity` を返す。従来の
`q.norm` は各成分を `Infinity` で割ってゼロ quaternion にし、等価な単位
quaternion と異なる面を `topFace()` から返した。独立 Judge の反復2検収では、
subnormal な長さも有効桁不足により向きを歪めることが追加で判明した。反復3の
独立 Judge はさらに、通常値だけ直接 `Math.hypot` する分岐のため、数学的に同着する
`[-4,2,3,1]` の順列・符号384件中88件で等価な単位入力と異なる面になることを確認した。

指定された `docs/product-brief.md` と repo 内の `AGENTS.md` / `CLAUDE.md` は
存在しないため、README / DESIGN を製品範囲として確認した。開始時の open PR
は0件で、PR #44 は merge 済み、issue #43 は closed 済みだった。

## 判断と更新終了要件

有限・非ゼロ値をすべて最大絶対成分でスケールしてから正規化し、通常・subnormal・
極大値で同じ丸め経路を使う。公開 API、依存、solver は変更しない。

- 有限・非ゼロの通常／極大／subnormal quaternion は、数学的 tie も含めて等価な
  単位 quaternion と同じ `axis` / `sign` / `normal` / `alignment` を返す。
- ゼロ長 quaternion は `RangeError` となり、入力を変更しない。
- 回帰テスト、全テスト、構文検査、差分検査、PR CI が成功する。
- 独立 Judge の accept 後だけ Finalizer が merge し、issue #45 の close を確認する。

取り消しは merge commit を `git revert -m 1` する別 PR を検証・mergeし、issue
#45 を reopen する。

## 再現・検証手順

```sh
node --input-type=module - <<'JS'
import { topFace } from './index.js';
const q = [Math.sin(Math.PI / 12), 0, 0, Math.cos(Math.PI / 12)];
console.log(topFace({ q }));
console.log(topFace({ q: q.map((component) => component * Number.MAX_VALUE) }));
JS
node test.mjs
node --check index.js
node --check test.mjs
git diff --check
```

## 反復2 ledger

- 観測事実: 極大 quaternion は正規化時にゼロ化し、単位 quaternion と異なる面を返した。
- 仮説: 長さが非有限の場合だけ最大成分で事前スケールすれば、通常値を変えずに向きを保てる。
- 実施内容: `q.norm` の極大値経路、4件の回帰検査、README / DESIGN の契約を追加。
- 検証結果: Builder のローカル検証と PR CI は成功したが、独立 Judge が subnormal
  入力で `normal/alignment` の不一致を発見し、repair 判定とした。
- 次の判断: 独立 Judge が最終 head と証拠を検査し、repair または accept を返す。Builder は merge しない。

## 反復3 ledger

- 観測事実: `[2*MIN_VALUE,MIN_VALUE,0,-MIN_VALUE]` は有限・非ゼロだが、直接の
  長さで正規化すると等価な単位 quaternion と異なる `normal/alignment` になった。
- 仮説: subnormal 長さも最大成分スケール経路へ送れば、成分比を保てる。
- 実施内容: subnormal 分岐と4件の回帰検査を追加し、契約文書を更新。
- 検証結果: Builder の再検証と最終headのPR CI結果をPR/issueへ記録する。独立 Judge
  は通常値の数学的 tie で順列・符号384件中88件の面不一致を発見し、repair とした。
- 次の判断: 最大成分スケールを全有限値の単一経路にし、通常・subnormal・極大の
  順列・符号1,152件を回帰化してから、独立 Judge が最終 head を再検収する。

## 反復3 修復 ledger

- 観測事実: 通常値だけ異なる正規化経路を通るため、等価な単位入力との微小な丸め差が
  数学的 tie の勝者を変えていた。
- 仮説: 全有限値を最大絶対成分で先にスケールすれば、スカラー等価入力の成分比と
  tie-break を安定させ、極値対策も一つの規則に統合できる。
- 実施内容: `q.norm` を単一の最大成分スケール経路にし、通常・subnormal・極大の
  3スケール × 24順列 × 16符号 = 1,152件を回帰化した。
- 検証結果: Node v20.20.0 で全239検査、`node --check index.js`、
  `node --check test.mjs`、`git diff --check` が成功した。最終 head の CI は push 後に
  PR #46 へ記録する。
- 次の判断: 別セッションの独立 Judge が成果と証拠を検査し、accept の場合だけ
  Finalizer が PR #46 を merge して issue #45 の close を確認する。

## 情報源

取得日: **2026-09-20**。外部技術資料・素材・依存は利用していない。

- 対象 repo のコードと文書: MIT
  (https://github.com/opaopa6969/tumble/blob/ff9bb1d2ace7beaf2a8af6ac6f5b15a231618dd1/LICENSE)
- issue #45: https://github.com/opaopa6969/tumble/issues/45
- GitHub メタデータ/API: GitHub Terms of Service
  (https://docs.github.com/en/site-policy/github-terms/github-terms-of-service)
