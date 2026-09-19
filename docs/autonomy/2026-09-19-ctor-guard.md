# Builder 反復1: コンストラクタ引数の検査

- 対象: tumble / issue #30
- 基点: `6571093828e0290a01fb4d30d130f7fdeb3e4463`
- 作業場所: `autonomy/fan-mu8esodd-7m4` 専用worktree
- 実行: Claude Opus 5 (1M context)、2026-09-19。課金情報は取得していない。

## 観測事実

指定の `docs/product-brief.md`、repo内の `AGENTS.md` / `CLAUDE.md` は今回も存在しない。
開始時のopen issue・open PRはいずれも0件、origin/mainの最新CI（run 35438682999）は成功。
前回の引継ぎ（PR #26 / #29、issue #25 / #28）はすべてmerge・close済みで、未完了の作業はなかった。
作業ツリーはクリーン、他のworktreeは触っていない。

`step()` には early throw が3件（#17 / #18 / #22）あるが、**構築時の入口は無検査**だった。
基点 `6571093828e0290a01fb4d30d130f7fdeb3e4463` / Node v20.20.0 で実測した silent failure:

| 入力 | 実測 |
|---|---|
| `new Body({pos:[0,2,0], mass:-1})` | `invM=-1`、120フレーム後 `p.y=-12.618190539319857`（床を貫通） |
| `new Body({pos:[0,1,0], mass:0})` | `o.mass \|\| 1` により黙って `mass=1` |
| `new Body({pos:[0,1,0], half:[0,0,0]})` | `invIl=[Infinity,Infinity,Infinity]` |
| `new Body({pos:[0,0.5,0], friction:-5})`、`v=[2,0,0]` | 2秒後 `p.x=2.572, v.x=0.7654`（μ=0.5では `p.x=0.4152, v=0`）＝エネルギー注入 |
| `new Body({pos:[NaN,1,0]})` | `p.x` がNaNのまま伝播 |
| `new World({gravity:[0,-9.81]})` | 60フレーム後 `p=[NaN,NaN,NaN]` |

## 仮説・判断

既存ガードと同じクラスの silent false-negative であり、**物理を変えずに入口で throw する**のが
最小・可逆な修正。選択した境界と理由:

- `half` の各成分は `> 0` を要求する。2成分が0だと慣性が無限大になり、負値はSATの射影半径の
  符号を反転させる。ゼロ厚の板を使っていた利用者には破壊的変更だが、v0.1.0であり revert 可能。
- `mass` は**可動体のみ**検査する。`fixed: true` は `invM=0` で質量を完全に無視するため、
  `{fixed:true, mass:0}` という一般的な書き方を壊さない。`mass:0` 単独は `fixed: true` を案内する。
- `restitution` は既存の `[0,1]` クランプを維持し、非有限のみ throw（後方互換）。
- `linDamp` / `angDamp` は `>= 0` の有限のみ要求し、`> 1` は禁止しない（意図的な増幅を妨げない）。
- `contactIterations` は `>= 1`。0だと接触を一切解かず静かに床を抜ける。`step()` 側の既存
  finite チェックは構築後の書き換え用に残す。

物理の数式・ソルバは一切変更しない。Node/npmの新規依存は追加していない。

## 実施内容・更新終了要件

1. `index.js` に `assertVec` / `assertNum` を追加し、`Body` / `World` のコンストラクタで検査する。
2. `test.mjs` に `ctor-guard` ブロック（45検査）を追加する。
3. 有効な入力の軌道が**基点と bit-identical** であること。
4. README / DESIGN.md に検査範囲と理由を記載する。
5. 全テストとPR CIの成功を証拠として独立Judgeへ渡す。accept後のmergeとissue closeはFinalizerが行う。

## 検証結果・再現手順

ローカル: Node `v20.20.0`（CI設定はNode 24）。

- 修正前の `node test.mjs`: 136 assertions成功。
- **新テストを基点の `index.js` に当てる**: 148成功 / **33失敗**（残り12は「引き続き受理される」
  「クランプが変わらない」等の不変検査で、両方で成功する）。
- 修正後の `node test.mjs`: **181 assertions成功**、終了コード0。
- **軌道の同一性**: 固定台1 + 5段スタック + 反発/摩擦付きタイル1（計7体）を
  `(broadphase, sleep)` = `(true,true) / (false,false) / (true,false)` の3構成 × 300フレームで実行し、
  基点の `index.js` と修正後の `index.js` の `[p,q,v,w,sleeping]` JSON が完全一致（4806文字、`identical: true`）。
- `node --check index.js` / `node --check test.mjs` / `git diff --check`: 成功。

再現手順: `mktemp -d` に `git show 6571093828e0290a01fb4d30d130f7fdeb3e4463:index.js` を `old.js`、現行を `new.js` として保存し、
両方を動的 `import` して同一シーンを走らせ JSON を比較する。新テストの有効性は、同じ一時
ディレクトリに `git show 6571093828e0290a01fb4d30d130f7fdeb3e4463:index.js` を `index.js` として置き、現行 `test.mjs` を実行すれば
33失敗として再現できる。共有worktreeのファイルを書き換える必要はない。

## 次の判断・残る不確実性

Builderは検収のacceptを出さない。PRの最終headとCIは独立Judgeが検査する。
`half` の `> 0` 要求は、ゼロ厚コライダーを使う利用者がいれば破壊的になる（repo内には該当なし）。
`linDamp > 1` のエネルギー増幅、`friction` の上限、`World` オプションの構築後書き換えは
今回の対象外。M4（麻雀ホスト配線：サイコロの上面読み取り等）は未着手のまま。

取り消しはmerge後に `git revert -m 1 <merge-commit>` のPRを作り、検証してmergeする。
issue #30 を reopen すれば追跡も戻る。

## 情報源

取得日: **2026-09-19**。外部技術資料の転用なし。

- 対象コード: https://github.com/opaopa6969/tumble/tree/6571093828e0290a01fb4d30d130f7fdeb3e4463
- repoライセンス: MIT / https://github.com/opaopa6969/tumble/blob/6571093828e0290a01fb4d30d130f7fdeb3e4463/LICENSE
- 開始時CI: https://github.com/opaopa6969/tumble/actions/runs/35438682999
- issue: https://github.com/opaopa6969/tumble/issues/30
- GitHubメタデータの取得: `gh issue list` / `gh pr list` / `gh run list`。
  API利用条件: https://docs.github.com/en/site-policy/github-terms/github-terms-of-service （条件本文の転用なし）。
