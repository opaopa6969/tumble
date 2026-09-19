# `topFace()` extreme-quaternion normalization (#45)

## 観測事実

PR #44 の merge 後も、有限・非ゼロの quaternion の長さが表現上限を超えるか、
上限付近でそれを超える値へ丸められる場合、`Math.hypot` は `Infinity` を返す。従来の
`q.norm` は各成分を `Infinity` で割ってゼロ quaternion にし、等価な単位
quaternion と異なる面を `topFace()` から返した。独立 Judge の反復2検収では、
subnormal な長さも有効桁不足により向きを歪めることが追加で判明した。

指定された `docs/product-brief.md` と repo 内の `AGENTS.md` / `CLAUDE.md` は
存在しないため、README / DESIGN を製品範囲として確認した。開始時の open PR
は0件で、PR #44 は merge 済み、issue #43 は closed 済みだった。

## 判断と更新終了要件

通常範囲の有限長では従来と同じ演算を維持し、長さが `Infinity` または subnormal
のときだけ最大絶対成分でスケールしてから正規化する。公開 API、依存、solver は
変更しない。

- 有限・非ゼロの極大／subnormal quaternion は等価な単位 quaternion と同じ面を返す。
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
- 検証結果: Builder の再検証と最終headのPR CI結果をPR/issueへ記録する。
- 次の判断: 独立 Judge が修正headを再検収し、accept後だけFinalizerがmergeする。

## 情報源

取得日: **2026-09-20**。外部技術資料・素材・依存は利用していない。

- 対象 repo のコードと文書: MIT
  (https://github.com/opaopa6969/tumble/blob/ff9bb1d2ace7beaf2a8af6ac6f5b15a231618dd1/LICENSE)
- issue #45: https://github.com/opaopa6969/tumble/issues/45
- GitHub メタデータ/API: GitHub Terms of Service
  (https://docs.github.com/en/site-policy/github-terms/github-terms-of-service)
