# tumble — MCP 化設計（Phase 2）

Phase 1 [survey](./survey.json) の判定 `skill-only` に基づく設計。

## 1. namespace と種別

- **namespace**: `tumble`
- **種別**: `skill-only`（常駐サーバを持たない。volta-mcp リポジトリの `docs/skills/tumble__<name>/SKILL.md` で参加）
- **理由**: Pure ESM・依存ゼロ・起動1 秒以内のライブラリで常駐プロセスの価値が薄い。現状 M1 のみ（box↔box 未実装）で tool 化しても機能が限定的。`node -e` で同等の呼び出しが可能。決定性保証・ヘッドレス運用・麻雀統合の手順は skill として配る価値がある。

## 2. tools 表

**なし**（skill-only なので MCP tool は提供しない）。

tumble の能力はライブラリ API（`World` / `Body`）として直接 import して使う。skill がその呼び出し方を案内する。

## 3. resources 表

skill-only でサーバを持たないため、`tumble://spec` / `tumble://guide` は **MCP resource として提供しない**。代替:

- spec に相当する情報: リポジトリの [DESIGN.md](../../DESIGN.md)（M1-M4 計画・API・慣性テンソル・XPBD ソルバ仕様）
- guide に相当する情報: [README.md](../../README.md)（import → World/Body → step の基本手順・CDN 利用法）

M2 完了後に `library-serve`（常駐 MCP サーバ化）を再評価した際、`tumble://spec` / `tumble://guide` を正式に提供する。

## 4. prompts / skills

### skill 一覧

| name | 用途 | locality | min_role |
|---|---|---|---|
| `drop-and-settle` | 傾いたボックスを落下させて静止姿勢を得る手順。決定性保証（Math.random 禁止・固定 substep）の解説を含む | `repo` | viewer |
| `deterministic-physics` | 決定性を保った物理シミュレーションの運用方針。固定 substep・Math.random 禁止・シード互換の麻雀配牌に使う方法。xpbd-body と共通の流儀 | `global` | viewer |
| `mahjong-physics-wiring` | M4 で netmahg に物理を組み込む計画。物理シャッフル壁・サイコロロール・捨て投げ。netmahg との協調入口（暫定仕様） | `repo` | viewer |

配置先: volta-mcp リポジトリ `docs/skills/tumble__<name>/SKILL.md`（SPEC-skills-over-mcp §7 方法 C）。

### applies_when

- `drop-and-settle`: `repo.has_file: index.js`（tumble リポジトリで発火）
- `deterministic-physics`: なし（global。物理決定性を要するあらゆる場面）
- `mahjong-physics-wiring`: `repo.has_file: index.js`（tumble リポジトリで発火）

### requires

全 skill とも `tools: []`（サーバが無いので MCP tool に依存しない）、`resources: []`。

## 5. 組み合わせ例

1. **tumble でサイコロを転がす → netmahg に供給**
   `drop-and-settle` skill で unit cube を落下→tumble→静止。`body.q` から上面を判定し、決定性を保った dice roll 結果を `mahjong__build_wall` 等の seed 入力として注入。
   データ渡し: `body.q` (quaternion `[x,y,z,w]`) → 上面判定（最大成分軸）→ 数値（1-6）→ netmahg seed

2. **tumble で物理シャッフル壁（M2-M4 必要）→ netmahg の deal seed**
   M2 の box↔box stacking で 136 枚の牌を物理シャッフル。結果の並びを配列として netmahg の deal seed に渡す。決定性が保たれるため再現可能。
   データ渡し: `body[]` の最終位置配列 → 牌 ID 並び順 `number[]` → `mahjong__build_wall(seed)`

3. **tumble で捨て投げ → renderer に渡す**
   牌の放物軌道・着地姿勢をシミュレート。`body.p` / `body.q` を three.js 等の renderer に渡して描画。ヘッドレスで物理計算のみを行い、描画は外部 renderer に任せる。
   データ渡し: `body.p` `[x,y,z]` + `body.q` `[x,y,z,w]` → renderer の transform

## 6. 依存と協調（issue-hub）

### 依存する関係

| 相手 repo | 方向 | 能力 | 現状 | 協調内容 |
|---|---|---|---|---|
| `xpbd-body` | depends_on | sibling engine (articulated bodies) | MCP 化予定（割当表 #6, namespace `xpbd`） | 共通流儀（pure ESM, zero deps, deterministic）の参照。コード依存なし。`deterministic-physics` skill で共通方針を共有 |
| `motion-engine` | depends_on | 共通ハウススタイルの参照元 | MCP 化予定（割当表 #2, namespace `motion`） | 同上 |

### 提供する関係

| 相手 repo | 方向 | 能力 | 現状 | 協調内容 |
|---|---|---|---|---|
| `netmahg` | provides_to | 物理シミュレーション結果（dice roll, wall shuffle, discard toss） | volta 登録済み（id=netmahg, port=9207, namespace `mahjong`） | M4 で tumble を netmahg に組み込む。物理結果の受け渡し形式を合意する |

### issue-hub に登録するもの

`netmahg` 宛: `[mcp] tumble ↔ mahjong: 物理シミュレーション結果の受け渡し形式`

暫定仕様（返答を待たずに進める）:
- dice roll: `{ quaternion: [x,y,z,w], top_face: 1-6 }` — tumble が `body.q` から上面を判定して返す
- wall shuffle: `{ tile_order: number[136] }` — tumble が物理シャッフル後の牌並びを返す
- discard toss: `{ position: [x,y,z], quaternion: [x,y,z,w] }` — tumble が着地姿勢を返す

## 7. 非対応にした候補と理由

Phase 1 からの差分なし。Phase 1 の判定 `skill-only` をそのまま採用。

- `simulate-step`（tool 化候補）→ `node -e` で十分のため skill の一部として `drop-and-settle` に含める
- `library-serve`（常駐サーバ化）→ M1 のみで機能が限定的。M2 完了後に再評価

## 8. 参加方法

- **manifest**: なし（skill-only なので `volta.service.json` を置かない）
- **port**: なし（割当表の port 列は `—`）
- **host**: なし
- **runtime**: なし
- **auth**: なし
- **配置**: volta-mcp リポジトリ `docs/skills/tumble__<name>/SKILL.md`（SPEC-skills-over-mcp §7 方法 C）。commit & push でファサードが同梱 skill として配信。

## 9. テスト方針

skill-only なので e2e（MCP クライアントで tools/list・healthz を叩く）は該当しない。以下で検証:

1. **tumble 自体のテスト**: `node test.mjs` が 7 件 pass（決定性・着地・静止の確認）
2. **skill 配信の確認**: `skill__list(namespace="tumble")` で 3 件が出現
3. **skill resolve の確認**: `skill__resolve(goal="物理でサイコロを転がす")` で `drop-and-settle` が返る
4. **catalog での確認**: `catalog__list_services` に tumble が載る（skill-only でも service として catalog に出るか要確認。出ない場合は `skill__list` で確認）
