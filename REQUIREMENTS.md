# Winnow 要件定義書 v0.2

技術記事サーベイ skill — GitHub / Hacker News / Zenn / Qiita / はてブ等から興味のある技術記事を収集し、LLM要約した視覚的にわかりやすいドキュメント（Markdown + HTML）を生成する。スワイプによるフィードバックを記録・学習し、次回以降のサジェスト精度を高める。

- 作成日: 2026-07-07 / v0.2: 同日（実装前レビューの指摘 C-1〜C-4, M-1〜M-9, Minor を反映）
- ステータス: レビュー済み・実装着手可
- 先行事例調査: [docs/research/2026-07-07-prior-art-survey.md](docs/research/2026-07-07-prior-art-survey.md)（§2の出典URLはすべて本調査記録に記載）

---

## 1. 目的・ゴール

1. 複数の技術情報源を横断サーベイし、重複を排除した「ストーリー」（同一トピックを扱う複数記事の束、§4.3で定義）単位のダイジェストを1コマンドで生成する
2. 単なる記事要約ではなく、**HNコメント欄の議論（賛否・論点）まで要約**する。調査した範囲（OSS 10件・商用/ホスト型13件、調査記録参照）では、コメント議論要約とスワイプ学習を組み合わせた例は確認できなかった
3. 出力は**スキャン性の高いHTMLレポート**。読む深さを読者が選べる構造（Kagi News方式）
4. **スワイプ操作（お気に入り / 興味なし）でフィードバックを記録**し（履歴は追記型で保存）、次回サーベイのランキングに反映。少数の**セレンディピティ枠**で興味の外の良記事も混ぜる [M1]
5. ユーザーの重点キャッチアップ領域: **coding agent エコシステム（Claude Code skills / hooks / MCP / エージェントハーネス等)**

## 2. 設計原則（先行事例調査からの採用）

出典の詳細URLは [調査記録](docs/research/2026-07-07-prior-art-survey.md) を参照。

| 原則 | 出典 |
|---|---|
| fetch（シェルスクリプト）と summarize（Claude）の完全分離。AIにHTTPを叩かせず、DB書き込みもスクリプト経由 | Qiita事例 iineineno03k、Anthropic skill設計原則 |
| 1ソースの取得失敗が全体を止めないフェイルセーフ | 日本語圏事例共通 |
| 既読・差分管理。前回表示済み記事は再掲しない | matcha / better-morning |
| ストーリー単位クラスタリング + 「複数ソース言及 × 鮮度」スコア + 品質ゲート | meridian / ai-news-radar / Techmeme |
| 興味プロファイルは外部ファイルに永続化。自然言語で宣言的に書ける | TrendRadar / better-morning / clawfeed |
| 二段構え要約（全体マクロ3行 + 記事ミクロ） | Folo / HN Highlights |
| 見出しは直訳せず、固有名詞・数字入りの意訳 | Techmeme / Qiita事例 |
| 選定理由を1行明記する | note事例 |
| 最小反復ユニット（見出し+メタバッジ+2〜3文）の固定 | TLDR / Particle |
| 可変セクションの出し分け（Perspectives / Quick questions / Did you know?） | Kagi News |
| 数値基準の明文化と validate→fix→retry ループ | deep-research系skill |

## 3. スコープとマイルストーン

| フェーズ | 内容 | 状態 |
|---|---|---|
| **M0** | オンデマンド実行。収集→選別→要約→Markdown+HTMLレポート生成。スワイプUIとSQLiteへのフィードバック**記録**まで | **実装済み**（2026-07-07） |
| **M1** | フィードバック**学習**ループ（undo考慮の最新判定で学習プロファイル導出）+ セレンディピティ枠 | **実装済み**（2026-07-08） |
| **M2** | 定期実行 + アーカイブ索引ページ（`scripts/index.mjs` → `output/index.html`）。方式は**launchdに決定**: `com.winnow.daily`（毎朝07:00に `scripts/daily.sh` → `claude -p "/winnow"` headless実行、macOS通知）+ `com.winnow.serve`（serve.mjs常駐）。scheduled agentsはクラウド実行のためローカルDB/outputに書けず不採用 | **実装済み**（2026-07-08） |
| **M3** | Cloudflare配信（**ハイブリッド構成**: 生成はローカルのまま、配信+フィードバック収集をクラウドへ）。https://winnow.tt-dev.workers.dev — **閲覧はWorkers Static Assetsによる公開静的サイト**（`output/` をそのままデプロイ、HTMLのみ公開・stories.json/report.mdは`.assetsignore`で遮断）、`cloud/` のHono Workerは認証付きフィードバックAPI（D1）のみ担当。`publish.mjs`=`wrangler deploy`、`sync-feedback.mjs` でクラウドの判定をローカルDBに還流 | **実装済み・デプロイ済み**（2026-07-08。当初のKV+認証付き配信から公開静的サイトに変更） |
| **M4** | **フィードバックUIの統合とオーナー限定化**。2モード切替（読む/選り分ける）を廃止して単一ビュー+カード上のインラインアクション（★/✕）に統合。判定状態の永続表示と変更（§4.6）。`GET /api/feedback/state` 追加、Honoに `/login`・`/logout` のログイン導線を追加（オーナーのみ操作UIが表示される） | **実装済み**（2026-07-08） |
| **M6** | **定点ウォッチセクション**。ストーリー枠と独立に、レポート下部へ固定セクション2つを新設: ①`RELEASE WATCH` — GitHub Releasesを**リポジトリごとに分離**表示（claude-code / codex）。リリースノート本文（`notes`、1500字まで取得）から変更内容の1〜2文要約付き。`github-release` itemはストーリー候補から除外。②`OSS RANKING` — GitHub Trendingから `ranking_keywords`（skill/agent/mcp等）にマッチするリポジトリをトレンド順に最大10件、1行説明付きでランキング表示。stories.jsonの任意ブロック（§5.1）として保持し、無い日はセクションごと省略 | **実装済み**（2026-07-08） |
| **M5** | **認証強化とアーカイブ索引の改善**。①`/auth?key=`・`?key=` クエリ認証を廃止（URLにキーが載る経路の根絶。認証は `X-Winnow-Key` ヘッダとセッションCookieのみ）。②Cookieを `__Host-wk` + **HMAC-SHA256署名付き30日トークン**（`<exp>.<sig>` 形式、生キー非含有、タイミングセーフ比較、残り7日でスライディング更新）に変更。③レポートフッターにログイン導線（閲覧モード=LOGIN / オーナー=LOGOUT、JSで出し分け）。④アーカイブ索引を刷新: 月別グルーピング+全レポート横断のインクリメンタル検索（見出し・topics・マクロ要約をAND検索、マッチ記事の提示付き、no-JSでもリスト閲覧可） | **実装済み**（2026-07-08） |

フィードバックストアはSQLite（D1互換DDL）・受信はHTTP POSTで設計したため、M3はserve.mjsと同一コントラクトのWorker追加のみで成立した。item ID（§4.2のURL正規化仕様）は今後も不変とする。

フルクラウド化（Workers Cron Triggers + Workflows + Anthropic API直叩きで生成までクラウド実行）は、API従量課金が発生するため見送り。無料方針の間はハイブリッド構成を維持する。

## 4. 機能要件

### 4.1 収集（fetch層 — シェルスクリプト）

ソースごとに独立したスクリプト（`scripts/fetch/<source>.sh`）。すべて認証不要または低コストAPIを使用。fetch層の機械設定（購読トピック・subreddit・focusキーワード・対象リポジトリ）は `config/sources.json` に集約する。

| 優先 | ソース | 手段 | 備考 |
|---|---|---|---|
| 骨格 | Hacker News | Algolia API（`hn.algolia.com/api/v1/search`、10,000req/h/IP） | 2系統: ①`search?tags=front_page&hitsPerPage=50` ②focusキーワードごとの `search_by_date?query=<kw>&tags=story&numericFilters=points>10,created_at_i><now-48h>` |
| 骨格 | Zenn | 公式RSS `zenn.dev/feed` + トピック別 `zenn.dev/topics/{t}/feed` | 購読トピックは sources.json（初期値: claudecode, llm, ai, rust, go, cloudflare） |
| 骨格 | Qiita | API v2（無認証60req/h、`QIITA_TOKEN` があれば1000req/h） | `query=stocks:>5`、過去48hはクライアント側でフィルタ |
| 骨格 | はてなブックマーク | ホットエントリRSS `b.hatena.ne.jp/hotentry/it.rss` | テクノロジーカテゴリ |
| 補助 | GitHub Trending | RSSミラー `mshibanami.github.io/GitHubTrendingRSS`（daily/all + 言語別） | 公式APIなし。失敗時はスキップ |
| 補助 | Reddit | `old.reddit.com/r/{sub}/.rss`（ベストエフォート） | 403時は静かにスキップし、レポートの取得状況に明記。リクエスト間2秒sleep |
| 補助 | lobste.rs / dev.to | `lobste.rs/hottest.json` / Forem API v1 `dev.to/api/articles?top=2` | HNの補完 |
| 重点 | coding agent系 | GitHub releases API（anthropics/claude-code, openai/codex 等）+ 対象リポジトリの `commits.atom`（awesome-claude-code 等） | 対象リポジトリは sources.json。**Anthropic engineering blogは公式RSSが確認できなかったため対象外**（2026-07-07に3候補URLの404を実測。公式フィード提供時に§8で再検討）。focusキーワードのHN/Zenn検索は上記2ソースに統合済み |

優先度ラベルの運用: **骨格**ソースは4つのうち1つ以上の成功が必須（全滅した場合のみ実行エラーで停止）。**補助**・**重点**は失敗してもスキップして続行し、取得状況（§4.8）に記録する。

要件:
- 各スクリプトは**副作用をstdout出力に限定したステートレスなスクリプト**。共通スキーマのJSON配列を出力: `{source, url, title, author, published_at, engagement: {…ソース固有キー}, raw_tags[]}`
- エラーはstderrと非ゼロexit codeで報告（stderrへの警告出力は失敗と見なさない。成否はexit codeのみで判定）
- 並列実行可能。1回のサーベイでの取得上限: 1ソースあたり50件
- HNコメント取得用に `scripts/fetch/hn_comments.sh <objectID>`（Algolia itemsエンドポイント、上位コメント最大20件をJSON出力）を用意。掲載決定後のストーリーにのみ使用

### 4.2 正規化・重複排除・差分管理（DB層）

- 取得結果を `scripts/ingest.mjs ingest` でSQLiteの `items` に upsert
- **item ID = 正規化URLのsha256**。URL正規化仕様（M3以降も不変）:
  1. scheme・hostを小文字化（schemeの http→https 変換はしない）
  2. フラグメント（`#…`）除去
  3. トラッキングクエリ除去: `utm_*`, `gclid`, `fbclid`, `ref_src`, `source`
  4. 残ったクエリパラメータをキー名で昇順ソート
  5. パス末尾のスラッシュ除去（パスが `/` のみの場合を除く）
- 過去のrunで表示済み（`last_shown_run` が非NULL）のitemは候補から除外（再浮上機能はM2以降の検討事項）
- 複数ソースで同一URLが観測された場合、engagementは**ソース別にそのまま保持**（`engagement_json` は `{"hn":{"points":320,"comments":210},"hatebu":{"users":150}}` のようなソース別マップ。単位が異なるため加算しない）。`source_count` = ユニークソース数

### 4.3 選別・ランキング（Claude — LLMベース軽量クラスタリング）

1. **クラスタリング**: 候補一覧（タイトル+タグ+ソース）をClaudeに渡し、同一トピックを扱うitemを「ストーリー」に束ねる。埋め込みは使わない（skillには過剰）
2. **スコアリング**: 全候補ストーリーに対して算出（部分的な打ち切りはしない）:
   - `match_score`（0–100）: 興味プロファイル（§4.5）との合致度。Claudeが理由付きで付与。`exclude` に該当するストーリーはスコア以前に掲載対象外
   - `quality_score`（0–100）: **同一ソース内の候補集合におけるengagementの百分位順位**（スクリプトが算出し候補リストに添付。複数ソースにまたがるストーリーは最大値を採用）
   - 複合スコア = `round(0.7 × match_score + 0.3 × quality_score)`
3. **品質ゲート**: 複合スコア **55未満は掲載しない**。掲載は複合スコア上位**最大15ストーリー**（通常枠）。閾値・重みは初期値であり、運用しながら調整する
4. **セレンディピティ枠 [M1]**: `match_score < 40` かつ `quality_score ≥ 80` のストーリーから**最大2件**を通常枠の**外数**として選出し、🎲バッジ付きで掲載。選定理由に「なぜ興味の外だが提示するか」を明記。掲載合計はM0で最大15、M1で最大17

### 4.4 要約（Claude）

- **マクロ要約**: レポート冒頭に「今回のサーベイを3行で」（改行区切りの3要素）
- **ミクロ要約**: ストーリーごとに固定ユニット:
  - 意訳見出し（日本語、固有名詞・数字入り）
  - メタバッジ行: ソースアイコン / source_count / engagement / 公開日 / 複合スコア
  - 2〜3文の要約（「。」区切りで2〜3文。背景・注目理由込み）
  - 選定理由 1行（改行を含まない）
  - 一次ソースURL + 関連リンク（クラスタ内の他ソース記事をぶら下げ）
- **可変セクション**（ストーリーの性質に応じて出し分け、全部は書かない）:
  - 💬 **議論の論点**: HNコメント欄の賛否・主要な反論の要約（`hn_comments.sh` の出力を入力とする）
  - ⚖️ **Perspectives**: 技術的トレードオフ・賛成派/懐疑派の視点
  - ❓ **Quick questions**: 読者が抱きそうな疑問への先回り回答（2〜3問）
  - 💡 **Did you know?**: 関連する豆知識・歴史的経緯
- 言語: 日本語（技術用語は原語のまま）
- Claudeの成果物は `output/YYYY-MM-DD/stories.json`（§5.1）のみ。report.md / report.html は `render.mjs` が stories.json から機械生成する

### 4.5 興味プロファイル（二層構造）

**第1層 — 明示プロファイル** `config/interests.yaml`（人間が編集する唯一のファイル）:

```yaml
focus:   # 重点領域（常に高スコア）
  - coding agentツール全般（Claude Code skills / hooks / MCP / subagent / エージェントハーネス）
interests:
  - Rust / Go によるTUI・CLI開発
  - Cloudflare Workers / D1 / Durable Objects
  - LLMアプリケーション設計・課金・計測
exclude:
  - 暗号通貨の相場記事
  - 採用・転職系ポエム
```

**第2層 — 学習プロファイル [M1]**（自動生成）:
- run開始時に `ingest.mjs` が `feedback_events` × `items` を集計し、お気に入り/興味なしの**トピック・キーワード・ソース傾向**を `data/learned-profile.json` に出力（各itemの有効判定は最新イベント。`undo` は未判定扱い）
- Claudeはスコアリング時に第1層+第2層を統合して使う。**矛盾時は第1層（明示）が優先**
- セレンディピティ枠でお気に入りされたトピックは学習プロファイルに昇格（興味の外→中への導線）

### 4.6 レポート出力（二層）

1. **Markdown** `output/YYYY-MM-DD/report.md` — 引用・URL付きの一次成果物。アーカイブ・grep用
2. **HTML** `output/YYYY-MM-DD/report.html` — テンプレート（`templates/report.html`）に stories.json を埋め込んだ**自己完結型1ファイル**（CSS/JSインライン。外部CDN・外部ホストへのアセット取得なし。通信はフィードバックAPI `http://127.0.0.1:<port>` への同一ホスト通信のみ。ライト/ダーク対応）

HTMLは**単一ビュー**（v0.3/M4で2モード切替を廃止）:
- 読み物としてのダイジェスト。セクション開閉式（Kagi News方式）、ソース内訳のグレイン表示、タグチップ。JSなしでも全文可読
- **インラインアクション（オーナーのみ）**: ロード時に `GET /api/feedback/state` の成否で判定し、成功時のみ各カードに「★お気に入り / ✕興味なし」ボタンをJSで注入する。閲覧者には操作UIを一切表示しない（`file://` はオーナー扱い）
  - 判定状態は次回以降も復元表示され、いつでも変更できる（favorite⇄undo⇄not_interested。イベントは追記型のため履歴保全）
  - `.is-fav` はゴールドアクセント、`.is-muted` は本文を畳んで減光
  - 判定はフィードバックAPIへ即時POST。**APIベースURLは実行時判定**（`file://` はHTML生成時に埋め込んだ `http://127.0.0.1:<port>`、それ以外は同一オリジン相対）
  - サーバー不達時は localStorage にキューし、次回オンライン時に再送

### 4.7 フィードバック収集サーバー（ローカル、M3でWorkerに差し替え）

- `node scripts/serve.mjs` — 依存ゼロ（`node:http` + `node:sqlite`）
- **bind: 127.0.0.1 のみ**（LANに露出しない）。ポート既定値 **8765**、環境変数 `WINNOW_PORT` で変更可
- ライフサイクル: 起動時に `GET /api/health` で既存インスタンスを確認し、稼働中なら**多重起動せず再利用**。EADDRINUSEかつhealth不通ならエラー報告。停止は手動（Ctrl+C）または最終リクエストから**120分のアイドルタイムアウト**（`--no-timeout` で無効化）。M2定期実行時のプロセス残留はこのタイムアウトで回収する
- CORS: `/api/*` に `Access-Control-Allow-Origin: *` と OPTIONS プリフライト対応を付与（bind先が127.0.0.1のためリスクは限定的。`file://` で開いたレポートからのPOSTを許容するため）
- エンドポイント（APIコントラクト）:

| メソッド/パス | リクエスト | レスポンス |
|---|---|---|
| `GET /api/health` | — | `{ok: true, version, db: <path>}` |
| `POST /api/feedback` | `{run_id, cluster_id, item_ids: string[], verdict: 'favorite'\|'not_interested'\|'skip'\|'undo'}`。`run_id` は**itemが掲載されたrun**（HTML埋め込み値）。`decided_at` はサーバー側で付与 | `{ok: true, recorded: <イベント挿入数>}` |
| `GET /api/feedback/summary` | — | verdict別・run別の集計JSON（動作確認用） |
| `GET /api/feedback/state` | 任意で `?run_id=` | item_idごとの最新判定 `{state: {"<item_id>": "favorite"\|"not_interested"\|"skip"}}`（最新が `undo` のitemは含めない）。**cloud側はキー認証必須**で、これがオーナー/閲覧者の判定を兼ねる |
| `GET /` ほか静的パス | — | `output/` 配下の静的配信 |

- 役割は上記のみ。skillはレポート生成後にサーバーを起動（または再利用）し `open http://127.0.0.1:<port>/YYYY-MM-DD/report.html` でブラウザを開く

### 4.8 取得状況の透明化

fetch層の成否（ソース名 / 成功・失敗 / 件数 / 失敗理由1行）を stories.json の `fetch_status` に記録し、レポート末尾に「取得状況」セクションとして必ず表示する。

## 5. データモデル（SQLite、D1互換DDL）

```sql
CREATE TABLE runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ran_at TEXT NOT NULL,            -- ISO8601
  mode TEXT NOT NULL DEFAULT 'on-demand',
  stats_json TEXT                  -- 取得件数・失敗ソース等
);

CREATE TABLE items (
  id TEXT PRIMARY KEY,             -- 正規化URL(§4.2)のsha256
  url TEXT NOT NULL,               -- 正規化後URL
  title TEXT NOT NULL,
  translated_title TEXT,           -- finalize時にstories.jsonから書き戻し
  source TEXT NOT NULL,            -- 初出ソース 'hn' | 'zenn' | ...
  author TEXT,
  published_at TEXT,
  engagement_json TEXT,            -- ソース別マップ {"hn":{"points":..},"hatebu":{"users":..}}
  source_count INTEGER DEFAULT 1,  -- ユニークソース数
  topics_json TEXT,                -- finalize時に書き戻し
  summary TEXT,                    -- finalize時に書き戻し
  cluster_id TEXT,                 -- finalize時に書き戻し
  match_score INTEGER,             -- 0-100、finalize時に書き戻し
  is_serendipity INTEGER DEFAULT 0,
  first_seen_run INTEGER REFERENCES runs(id),
  last_shown_run INTEGER REFERENCES runs(id)  -- finalize時に設定(重複掲載防止の鍵)
);

-- 追記型イベントログ(履歴を蓄積。UPDATEしない)
CREATE TABLE feedback_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id TEXT NOT NULL REFERENCES items(id),
  cluster_id TEXT,
  verdict TEXT NOT NULL CHECK (verdict IN ('favorite','not_interested','skip','undo')),
  decided_at TEXT NOT NULL,        -- サーバー付与のISO8601
  run_id INTEGER REFERENCES runs(id)  -- itemが掲載されたrun
);
CREATE INDEX idx_feedback_item ON feedback_events(item_id, decided_at);
```

itemの**有効判定**は「`decided_at` が最新のイベントのverdict。ただし `undo` は未判定扱い」と定義する（M1の学習集計はこの定義を用いる）。

### 5.1 stories.json スキーマ（Claudeの成果物 / HTMLへの埋め込みデータ / finalize入力）

```json
{
  "run_id": 12,
  "date": "2026-07-07",
  "generated_at": "ISO8601",
  "macro_summary": ["1行目", "2行目", "3行目"],
  "stories": [
    {
      "cluster_id": "s01",
      "translated_title": "意訳見出し",
      "match_score": 82,
      "quality_score": 67,
      "composite_score": 78,
      "is_serendipity": false,
      "topics": ["mcp", "billing"],
      "summary": "2〜3文の要約。",
      "selection_reason": "1行",
      "sections": {
        "discussion": "…(任意)",
        "perspectives": "…(任意)",
        "quick_questions": [{"q": "…", "a": "…"}],
        "did_you_know": "…(任意)"
      },
      "items": [
        {"id": "sha256…", "url": "…", "title": "原題", "source": "hn",
         "engagement": {"points": 320, "comments": 210}, "published_at": "ISO8601"}
      ]
    }
  ],
  "fetch_status": [{"source": "reddit", "ok": false, "count": 0, "note": "403"}]
}
```

このスキーマはM3のWorker差し替え時も互換性検証の基準とする。

## 6. skill構成とフロー

```
winnow/
├── REQUIREMENTS.md
├── SKILL.md                  # skill本体（~/.claude/skills/winnow → ここへsymlink）
├── config/
│   ├── interests.yaml        # 興味プロファイル(人間が編集)
│   └── sources.json          # fetch層の機械設定(トピック/subreddit/focusキーワード/対象repo)
├── scripts/
│   ├── fetch/{hn,zenn,qiita,hatebu,ghtrend,reddit,lobsters,agents,hn_comments}.sh
│   ├── ingest.mjs            # サブコマンド: ingest / candidates / finalize
│   ├── render.mjs            # stories.json + テンプレート → report.md + report.html
│   ├── validate.mjs          # stories.jsonの数値基準チェック(§7)
│   └── serve.mjs             # 静的配信 + フィードバックAPI
├── templates/report.html
├── data/winnow.db            # gitignore
├── docs/research/            # 先行事例調査記録
└── output/YYYY-MM-DD/{stories.json, report.md, report.html}
```

実行フロー（`/winnow` 起動時。[M1] 注記以外はM0）:

```
1. fetch層を並列実行(bash)。骨格ソース全滅時のみエラー終了 ──▶ ソース別raw JSON
2. node scripts/ingest.mjs ingest <raw...>   … 正規化・dedup・items upsert・run作成
3. node scripts/ingest.mjs candidates --run <id>
   … 未掲載候補+quality_scoreをJSON出力 [M1: 学習プロファイルも同時出力]
4. Claude: クラスタリング → match_score付与 → 品質ゲート・選別(通常枠≤15 [M1: +🎲≤2])
5. Claude: 掲載ストーリーのHNコメント取得(scripts/fetch/hn_comments.sh経由)
   → 要約・可変セクション生成 → output/YYYY-MM-DD/stories.json
6. node scripts/validate.mjs output/…/stories.json
   … 失敗ならClaudeがstories.jsonを修正して再validate(最大2回。なお失敗なら
     続行し、レポート末尾に警告を表示)
7. node scripts/ingest.mjs finalize output/…/stories.json --run <id>
   … translated_title/summary/cluster_id/match_score/topics/is_serendipity を
     itemsに書き戻し、last_shown_run を設定(重複掲載防止)
8. node scripts/render.mjs output/…/stories.json … report.md + report.html を生成
9. node scripts/serve.mjs 起動(稼働中なら再利用) → ブラウザで開く → スワイプ結果がSQLiteへ
```

## 7. 非機能要件

- **実行環境**: Node **>= 23.4**（`node:sqlite` がフラグ不要。22.5+では `--experimental-sqlite` が必要）。`node:sqlite` のExperimentalWarningがstderrに出るため、スクリプトの成否判定はexit codeのみで行う
- **実行時間**: 1回のサーベイで10分以内を目安（fetch並列、コメント取得は掲載ストーリーのHN由来分のみ = 最大15件 [M1: 最大17件]）
- **コスト**: 外部APIはすべて無料枠。LLMコストはClaude Codeセッション内で完結
- **耐障害**: 骨格ソース全滅時のみエラー終了。部分失敗は§4.8の取得状況で透明化
- **重複掲載防止**: 同日・別日を問わず再実行しても、`last_shown_run` 設定済みのitemは再掲しない
- **validate基準**（`validate.mjs` が stories.json に対して機械検査する）:

| 項目 | 基準 |
|---|---|
| ストーリー数 | 通常枠 1〜15件 [M1: is_serendipity=true が0〜2件(外数)] |
| macro_summary | 配列長ちょうど3 |
| summary | 「。」区切りの文数が2〜3 |
| selection_reason | 非空・改行を含まない |
| translated_title | 非空 |
| items | 各ストーリーに1件以上、全itemにurlあり |
| composite_score | 全掲載ストーリーが55以上（セレンディピティ枠を除く） |

  validate失敗時はClaudeが修正して再validate（最大2回）。それでも失敗なら生成は続行し、レポート末尾に警告を表示する。

## 8. 未決事項

- [x] プロダクト名の確定 → **Winnow**（2026-07-07決定。英単語「風選する」— 籾殻＝ノイズを飛ばし、実＝価値ある記事だけを残す）
- [x] M2の定期実行方式 → launchd（§3参照、2026-07-08決定・実装）
- [x] M3のホスティング形態 → Hono Worker + KV + D1、シークレットキー認証（§3参照、2026-07-08デプロイ）
- [ ] Qiitaトークンの用意（無認証60req/hでも当面は足りる見込み。`QIITA_TOKEN` 環境変数で注入）
- [ ] Anthropic engineering blogの公式フィード提供状況のウォッチ（2026-07-07時点でRSS候補URL3件が404）
- [ ] スコアリング初期値（複合式の重み0.7/0.3、ゲート閾値55、🎲条件）の運用調整
- [ ] 記事本文の取得（現状の要約入力はタイトル+メタデータ+HNコメントのみ）
- [ ] Worker認証のCloudflare Access化（現状はシークレットキー+cookie方式）
- [ ] 過去の良記事の再浮上（Refind方式）
