# tumble — MCP 化ステータス（Phase 2）

## 現状

**state: `registered`**（skill-only で volta に参加完了）

tumble は `skill-only` 判定（Phase 1）。常駐サーバを持たず、volta-mcp リポジトリの `docs/skills/tumble__<name>/SKILL.md` で参加。

## 完了したこと

### 設計
- [x] `docs/mcp/DESIGN.md` を作成（namespace `tumble`、skill-only、3 skill の設計）
- [x] Phase 1 survey.json の判定をそのまま採用（`skill-only`）

### 協調
- [x] issue-hub #339 を作成: `[mcp] tumble → mahjong: 物理シミュレーション結果の受け渡し形式`
  - target: `game-workspace/netmahg`（namespace `mahjong`、id=netmahg、port=9207）
  - 暫定仕様で進行中。返答を待たずに実装。
  - 未決事項: dice roll の上面判定ロジックの所在、wall shuffle の tile_order ソート順、統合方式（import vs JSON）

### 実装（skill-only）
- [x] 3 つの SKILL.md を volta-mcp リポジトリに作成・commit・push:
  - `tumble__drop-and-settle`: 傾いたボックスの落下→静止手順（M1 対応）
  - `tumble__deterministic-physics`: 決定性運用方針（global locality）
  - `tumble__mahjong-physics-wiring`: M4 で netmahg に統合する計画
- [x] commit: `bf8017d`（volta-mcp main に push 済み）

### volta 参加確認
- [x] prod（192.168.1.50）の volta-mcp で `git pull` → `catalog__reload`
- [x] `skill__list(text="tumble")` で 3 件が認識されることを確認
- [x] `skill__resolve(goal="tumble でサイコロを転がす")` で `tumble__deterministic-physics` が返ることを確認

## 残っていること

### tumble repo 側
- [ ] `docs/mcp/DESIGN.md` と `docs/mcp/STATUS.md` を commit & push（このファイル）

### M2 完了後の再評価
- [ ] M2（box↔box SAT + manifold stacking）が実装されたら `library-serve`（常駐 MCP サーバ化）を再評価
- [ ] `tumble://spec` / `tumble://guide` resource を正式に提供
- [ ] `volta.service.json` / `deploy/` / `run.sh` を作成

### issue-hub #339 の解決
- [ ] netmahg 側からの返答待ち（ブロックしない。暫定仕様で進行中）
- [ ] 合意できたら `tumble__mahjong-physics-wiring` skill の暫定仕様を確定版に更新

## 未決事項（持ち主への質問）

1. M2（box↔box SAT+manifold）の実装タイミング。完了後に `library-serve` を再評価すべきか
2. `netmahg` 側が tumble の物理結果をどのような形式で受け取るべきか（issue-hub #339 で協調中）
3. `xpbd-body` / `motion-engine` も MCP 化の調査対象か（Phase 1 の open_questions から継承）

## deploy の記録

skill-only なので `volta__svc_add` / `gateway_routes_diff` は該当しない（サーバを持たないため manifest も gateway ルートも無い）。

- **配置**: volta-mcp リポジトリ `docs/skills/tumble__<name>/SKILL.md`（SPEC-skills-over-mcp §7 方法 C）
- **反映**: prod の volta-mcp で `git pull` → `catalog__reload` で即時反映（restart 不要）
- **確認**: `skill__list(text="tumble")` で 3 件が出現

## gateway / healthz

skill-only でサーバを持たないため:
- **port**: なし
- **hostname**: なし
- **healthz**: なし（サーバが無い）
- **gateway ルート**: なし
- **catalog__backend_status**: tumble はバックエンドではないので出現しない（skill として `skill__list` で出現）
