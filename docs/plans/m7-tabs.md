# Winnow M7 実装指示書 — コンテンツタブ（サーベイ / リリース / ランキング）

> 実装担当のcoding agentへの作業指示書。正本は `REQUIREMENTS.md`。

対象: リポジトリルート。M0〜M6実装済み・本番稼働中。`bash scripts/smoke.sh` の回帰を壊さないこと。

## 目的（ユーザー要望）

レポート内の「サーベイ結果（ストーリー）」「RELEASE WATCH」「OSS RANKING」をボタン（タブ）で切り替えて見られるようにする。

## 仕様

### 1. 構造（render.mjs / templates/report.html）

- 静的HTMLの並びは従来どおり（hero → ストーリー群 → watchSection×2 → fetchwrap）とし、**JSなしでは全セクションが縦に並んで読める**ことを維持する（progressive enhancement）
- JSでの表示制御のために、各領域を特定できるようにする:
  - サーベイビュー = hero（`.hero`）+ ストーリー群 + FETCH STATUS（`.fetchwrap`）
  - リリースビュー = RELEASE WATCH の `.watchSection`（`id="releaseView"` を付与）
  - ランキングビュー = OSS RANKING の `.watchSection`（`id="rankingView"` を付与）

### 2. タブUI（templates/report.html、JSでのみ表示）

- トップバー内（wordmark/runmetaの行）に**セグメンテッドコントロール**を配置: `サーベイ` / `リリース` / `ランキング` の3ボタン（絵文字なし、既存のデザイントークン。選択中はink地にpage色文字 — M4以前のタブと同じ見た目の作法）
- `role="tablist"` / `aria-selected` を付与。最小タッチターゲット44px
- **存在しないセクションのタブは出さない**（release_watch / oss_ranking が無い日はサーベイのみ→タブバー自体を出さない）
- モバイル（max-width 520px）ではトップバーの下に折り返して全幅表示
- `.js` クラスゲート（既存パターン）でJSなし環境ではタブ非表示

### 3. 切り替えロジック

- 選択タブに応じて該当ビューのみ表示（他は `display:none`）。デフォルトは「サーベイ」
- **URLハッシュルーティング**: `#releases` → リリース、`#ranking` → ランキング、それ以外/なし → サーベイ。タブクリックで `location.hash` を更新し、`hashchange` でも切り替え（ブラウザバック対応）。サーベイ選択時はハッシュを除去（`history.pushState` で `#` なしに）
- タブ切り替え時は `window.scrollTo({top:0})`
- オーナーモードのアクションバー・フィードバック復元（M4）はサーベイビュー内の従来動作を維持。ownerChipは全タブで表示のまま

### 4. スコープ外

SKILL.md / README.md / REQUIREMENTS.md / docs/ は変更しない。cloud/ も変更不要。

## 受け入れ基準

1. `bash scripts/smoke.sh` 全PASS（回帰なし）
2. 再レンダリング後のreport.htmlで: scriptタグ除去でも全セクション（ストーリー・RELEASE WATCH・OSS RANKING・FETCH STATUS）のテキストが読める
3. release_watch/oss_rankingが無いstories.json（例: fixtures最小構成）でもエラーなくレンダリングされ、タブバーが出ない
4. `node --check` 全.mjs

## 制約（従来どおり）

ローカルscriptsは依存ゼロ。git操作・wranglerネットワークコマンド禁止。外部ネットワークなし。
