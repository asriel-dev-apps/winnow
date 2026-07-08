# Winnow M5 実装指示書 — 認証強化・ログイン導線・アーカイブ索引の改善

> 実装担当のcoding agentへの作業指示書。正本は `REQUIREMENTS.md`。

対象: リポジトリルート。M0〜M4実装済み・本番稼働中。`bash scripts/smoke.sh` の回帰を壊さないこと。

## 1. `/auth?key=` と `?key=` クエリ認証の廃止（cloud/src/index.ts）

- `GET /auth` ルートを削除
- 認証ミドルウェアから `?key=` クエリパラメータの受理を削除（URLにキーが載る経路の根絶）
- 認証手段は次の2つだけにする: ①`X-Winnow-Key` ヘッダ == env.WINNOW_KEY（スクリプト用）、②セッションCookie（下記）

## 2. Cookieの強化: 生キー → HMAC署名付き期限トークン

- Cookie名を `wk` → **`__Host-wk`** に変更（Secure必須・Path=/・Domain指定不可のブラウザ強制が効く）
- 値は生キーではなく **`<exp>.<sig>`** 形式のトークン:
  - `exp` = 失効時刻（epoch ms、発行から**30日**）
  - `sig` = `HMAC-SHA256(env.WINNOW_KEY, "winnow-session:" + exp)` のhex。WorkerのWebCrypto（`crypto.subtle.importKey`/`sign`）で計算
- 検証（ミドルウェア）: 形式パース → `exp > Date.now()` → sigを再計算して**タイミングセーフ比較**（長さ一致+定数時間比較関数を実装）
- **スライディング更新**: 検証成功かつ残り7日未満なら、新しい30日トークンをSet-Cookieで再発行
- `POST /login` 成功時に発行、`GET /logout` は `__Host-wk` を `Max-Age=0` で削除。属性は `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000`
- 旧 `wk` Cookieは単に無視される（利用者は一度再ログイン）

## 3. ログイン導線（templates/report.html と index）

- レポートページ: フッターを追加し、**閲覧モード（state取得401）のときのみ** `/login` への控えめなリンク（mono・muted、テキスト「LOGIN」）をJSで表示。オーナーモード時は「LOGOUT」リンク。`file://` では非表示
- アーカイブ索引（下記4）: フッターに同様のリンクを常設（静的でよい。ログイン済みかの判定はしなくてよい）

## 4. アーカイブ索引の改善（scripts/index.mjs）

`output/index.html` を「レポートが増えても探せる」ページに刷新:

- **データ**: 全 `output/*/stories.json` から `{date, story_count, serendipity_count, macro_summary, stories: [{translated_title, topics}]}` を抽出し、ページ内にJSONとして埋め込む
- **静的表示（no-JSでも機能）**: 月ごとの見出しで区切った日付降順リスト。各行 = 日付（YYYY-MM-DD、report.htmlへのリンク）/ ストーリー数 / マクロ要約の1行目。デザインはreport.htmlと同じトークン（page/ink/gold、monoのeyebrow、ライト/ダーク対応、自己完結1ファイル）
- **検索（JS enhancement）**: ページ上部に検索ボックスを1つ。入力に応じて**全レポート横断のインクリメンタル絞り込み**:
  - マッチ対象: 日付文字列・マクロ要約・各ストーリーの見出しとtopics
  - ストーリー見出しがマッチした場合は、その行の下にマッチした見出し（最大3件、リンクは該当日のreport.html）を表示して「どの記事で引っかかったか」が分かるようにする
  - 大文字小文字無視、スペース区切りでAND検索。0件時は「該当なし」表示
- 検索入力はデバウンス（150ms程度）。外部依存なし・インラインJSのみ

## 5. README・スクリーンショットは対象外

README.md と docs/assets/ は依頼側が扱う。**編集禁止**。

## 受け入れ基準

1. `bash scripts/smoke.sh` 全PASS（回帰なし）
2. `node --check` 全.mjs、cloud/は型整合
3. `node scripts/index.mjs` で生成した index.html について: scriptタグ除去でも既存2日分のリストが読める、検索ボックスと埋め込みJSONが存在する
4. cloud/src/index.ts に `auth` ルートと `?key=` 受理が残っていない
5. README.md / REQUIREMENTS.md / docs/（本書以外）/ SKILL.md 無変更

## 制約（従来どおり）

ローカルscriptsは依存ゼロ、cloud/のみnpm依存可。git操作・wranglerネットワークコマンド禁止。サンドボックスに外部ネットワークなし。
