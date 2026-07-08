# Winnow M4 実装指示書 — フィードバックUIの統合とオーナー限定化

> 実装担当のcoding agentへの作業指示書。正本は `REQUIREMENTS.md`。

対象: リポジトリルート。M0〜M3実装済み・本番稼働中。`bash scripts/smoke.sh` の回帰を壊さないこと。

## 背景・目的（ユーザー要望）

- SP/PCのブラウザ閲覧が前提。公開静的サイトで**フィードバック操作はオーナーだけ**が使える
- 「読む/選り分ける」のモード切替UIを廃止し、単一ビューに統合
- お気に入り状態を**次回開いたときも表示**し、いつでも変更(お気に入り⇄解除⇄興味なし)できる

## 1. API追加: `GET /api/feedback/state`

`scripts/serve.mjs` と `cloud/src/index.ts` の両方に、同一コントラクトで追加:

- クエリ `?run_id=<N>`（任意。指定時はそのrunのイベントに限定）
- レスポンス: `{ok: true, state: {"<item_id>": "favorite" | "not_interested" | "skip", ...}}`
  - item_idごとの**最新イベント**（`decided_at` 最大、同値なら `id` 最大）のverdict。最新が `undo` のitemは**キーごと省く**
- 認証: **cloud側は既存のキー認証必須**（未認証401）。serve.mjs（127.0.0.1）は認証なしで返す
- `scripts/smoke.sh` に検証を追加: feedback POST(favorite)後にstateへ反映→undo POST後にstateから消える、の2ステップ（`PASS feedback_state` / `PASS feedback_state_undo`）

## 2. テンプレート改修: `templates/report.html`

### 削除するもの
- モード切替タブ（.tabs / #docTab / #triageTab）、`#triageMode` セクション一式（stackWrap / triageCard / peek / verdictMark / controls / keyhint / progress）、setMode・renderCard・decide/undoのデッキ依存部分、キーボードショートカット、`.triage-active` CSS

### 追加するもの（単一ビュー + インラインアクション）
1. **起動時判定**: `const apiBase = location.protocol === 'file:' ? (data.apiBase || '') : '';` は維持。ロード時に `GET {apiBase}/api/feedback/state?run_id={data.run_id}` を試行:
   - 成功 → **オーナーモード**: 各カードにアクションバーを注入し、stateを反映
   - 失敗（401/ネットワーク） → **閲覧モード**: アクションUIを一切表示しない（静的ドキュメントのまま）。ただし `location.protocol === 'file:'` の場合はオーナーモード扱い（ローカルファイル=本人。stateは取れる範囲で）
2. **アクションバー**（JSでのみ注入。no-JS環境の静的HTMLには存在しない）: 各 `article.story` の末尾に
   - `[★ お気に入り]` `[✕ 興味なし]` の2ボタン。最小44pxタッチターゲット、既存のデザイントークン（--gold等）を使用。アイコンは**インラインSVG**（絵文字ではなく）
   - 状態遷移: 未判定→★クリック=favorite送信/カードに `.is-fav`。favorite中→★クリック=undo送信で解除。✕クリック=not_interested送信/`.is-muted`。muted中→✕クリック=undoで復元。fav⇄mutedの直接切替も1クリック（先に新verdictを送るだけでよい。イベントログは最新が勝つ）
   - 送信は既存の `postFeedback`（localStorageキュー含む）を流用。payloadコントラクト変更なし。楽観的にUI即時更新
3. **視覚状態**:
   - `.is-fav`: カード左に3pxのゴールドアクセント + ★ボタンが塗り（--gold-wash背景）
   - `.is-muted`: h3より後の要素（p, .why, details, .links）を非表示にし、カード全体 opacity .55。アクションバーは残し「興味なし ✓（タップで戻す）」表示
4. **ヘッダー**: runmetaの横にオーナーモード時のみ小さな集計チップ「★ n / ✕ n」を表示（state反映・操作で更新）
5. トップバーはワードマーク+runmetaのみに簡素化

### 維持するもの
- 静的ドキュメント（no-JSで全文可読）、ダークモード、既存のフィードバックbadge類は新しい仕組みに置き換えてよい

## 3. 認証UX: ログインページ（cloud/src/index.ts）

スマホで `/auth?key=<長いキー>` を打つのは現実的でないため、Honoにログイン導線を追加:

- `GET /login` — 最小のログインフォームHTML（インラインCSS、report.htmlと同じデザイントークン: page/ink/gold、モノスペースのeyebrow、ダーク対応）。キー入力欄（`type="password"`）+「ログイン」ボタン
- `POST /login` — `application/x-www-form-urlencoded` で `key` を受け、正しければ既存と同じ `wk` cookie（HttpOnly; Secure; SameSite=Lax; Max-Age=31536000; Path=/）を付けて `/` へ302。不正なら401でフォーム再表示（エラーメッセージ付き）
- `GET /logout` — cookieを無効化（Max-Age=0）して `/` へ302
- 既存の `/auth?key=` はそのまま維持（後方互換）
- これらのルートは認証ミドルウェアの**対象外**（ログイン前にアクセスするため）
- レートリミット的な配慮として、POST /login の失敗時は約1秒待ってから応答（総当たり抑止の最低限）

## 4. ドキュメント整合

- `SKILL.md` 手順7の「トリアージモード（🃏タブ）でスワイプ判定すると〜」の一文を「レポート上の★/✕ボタンで判定すると次回の選別に反映される（オーナーのみ表示）」に更新（**SKILL.mdはこの1文のみ変更可**）
- `REQUIREMENTS.md` は依頼側が更新するので触らない

## 受け入れ基準

1. `bash scripts/smoke.sh` 全PASS（新規の feedback_state 2項目を含む。/loginはcloud専用のためsmoke対象外で可）
2. `node --check` 全.mjs、cloud/は型整合
3. 再レンダリング後のreport.htmlについて: scriptタグ除去でも15ストーリーの本文が読める（既存基準の維持）、`stackWrap`/`triageTab` が存在しない、アクションバーはJS注入のため静的HTMLに含まれない
4. README.md / REQUIREMENTS.md / docs/（本書以外）無変更

## 制約（従来どおり）

ローカルscriptsは依存ゼロ、cloud/のみnpm依存可。git操作・wranglerネットワークコマンド禁止。サンドボックスに外部ネットワークなし。
