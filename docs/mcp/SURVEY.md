# tumble — MCP 化調査（Phase 1）

## 概要

`tumble` は Pure ESM・依存ゼロ・決定的な 3D 剛体物理エンジン。XPBD 接触解決と異方性ボックス慣性テンソルにより、薄い牌やサイコロが転倒して面で静止する挙動を再現する。`index.js` 1 ファイル（120 行）で `World` と `Body` クラスのみを export し、HTTP API・CLI・常駐サーバを持たない純粋ライブラリ。`test.mjs` でヘッドレス検証可能。

兄弟リポジトリ `xpbd-body`（articulated bodies）・`motion-engine` と共通の流儀（pure ESM, zero deps, deterministic, headless-testable）を共有。存在理由は 3D 麻雀ゲーム（牌の壁・サイコロ・捨て投げ）への物理組込。

**マイルストーン**: M1 完了（box↔ground-plane 接触）、M2-M4 は planned（box↔box SAT, broadphase/sleeping, mahjong wiring）。

## 判定と理由

**判定: `skill-only`**

- 依存ゼロ・起動1秒以内のライブラリ。常駐プロセスの価値が薄い（`node -e` で即座に呼べる）。
- 現状 M1 のみで box↔box が未実装。tool 化しても機能が限定的（単体落下・静止のみ）。
- 既存 HTTP API も CLI も無く「薄く包む」対象がない。
- ただし決定性の保証・ヘッドレス運用・mahjong 統合の手順は **skill として配る価値**がある。
- M2 完了後（box↔box stacking が実装された後）に `library-serve` を再評価すべき。

## 公開候補

| kind | name | io / uri | 副作用 | 長時間 | 備考 |
|---|---|---|---|---|---|
| skill | `simulate-step` | — | — | — | `World.step()` の呼び出し方・状態読み取り。tool 化せず `node -e` で十分 |
| skill | `drop-and-settle` | — | — | — | 傾いたボックスを落下させて静止姿勢を得る手順（test.mjs と同じ）。決定性保証の解説を含む |
| resource | `spec` | `tumble://spec` | read | no | M1 能力範囲: Body, box inertia, box↔ground-plane XPBD, damping。M2-M4 計画 |
| resource | `guide` | `tumble://guide` | read | no | import 〜 step 呼び出し・CDN 利用・test.mjs 実行法 |
| skill | `deterministic-physics` | — | — | — | 固定 substep・Math.random 禁止・シード互換の麻雀配牌。xpbd-body と共通流儀（locality: global） |
| skill | `mahjong-physics-wiring` | — | — | — | M4 計画: 物理シャッフル壁・サイコロ・捨て投げ。netmahg と協調（locality: repo） |

## 組み合わせ例

1. **tumble でサイコロを転がす → netmahg に供給**: `body.q` から上面を判定し、決定性を保った dice roll 結果を netmahg の配牌ロジックに注入。
2. **tumble で物理シャッフル壁（M2-M4 必要） → netmahg の deal seed**: 物理でシャッフルした壁の配列をシードとして netmahg に渡す。決定性が保たれるため再現可能。
3. **tumble で捨て投げ → renderer に渡す**: 牌の放物軌道・着地姿勢をシミュレートし、three.js 等の renderer に `body.p` / `body.q` を渡して描画。

## 依存と協調

| 相手 repo | 方向 | 能力 | 現存 | 備考 |
|---|---|---|---|---|
| `xpbd-body` | depends_on | sibling engine (articulated bodies) | no | コード依存なし。共通流儀を共有。volta カタログに未登録 |
| `motion-engine` | depends_on | 共通ハウススタイルの参照元 | no | コード依存なし。流儀の参照元。volta カタログに未登録 |
| `netmahg` | provides_to | 物理シミュレーション結果（dice, wall, discard） | yes | M4 で統合計画。netmahg は volta 登録済み（id=netmahg, port 7074, systemd） |

**協調の要否**: M4（mahjong wiring）で `netmahg` との協調が必須。Phase 2 で issue-hub に登録すべき。`xpbd-body` / `motion-engine` も別途 MCP 化調査の対象か確認が要る。

## ライブラリのサーバ化

該当しない（`needed: false`）。M1 段階では常駐化の価値が薄い。M2 完了後に再評価。

## リスク

- M1 のみで box↔box が未実装。実用的な積み上げ・壁構築には M2 が必要。
- 決定性は `Math.random` 禁止に依存。呼び出し側が乱数を混ぜると再現性が失われる。
- 物理パラメータ（substeps, damping, timestep）の調整が必要。不適切な値では安定しない。
- CDN 経由で配布されるためバージョン固定の注意（`@v0.1.0` 指定を推奨）。

## 持ち主への質問

1. M2（box↔box SAT+manifold）の実装タイミング。完了後に `library-serve` を再評価すべきか。
2. `netmahg` 側が tumble の物理結果をどのような形式で受け取るべきか（JSON RPC, 共有メモリ, ライブラリ import）。
3. `xpbd-body` / `motion-engine` も MCP 化の調査対象か。3 つの物理エンジンを統合する入口は必要か。
