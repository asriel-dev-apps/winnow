# 先行事例調査（2026-07-07）

Winnow要件定義の根拠となる調査記録。Sonnetエージェント4並列（①OSS ②Claude Code skill/エージェントハーネス ③商用サービス ④日本語圏+API事情）で実施。REQUIREMENTS.md §2「設計原則」の出典はすべて本書に対応する。

---

## Part 1: OSSダイジェスト生成プロジェクト（10件）

| # | プロジェクト | URL | 規模 | 要点 |
|---|---|---|---|---|
| 1 | finaldie/auto-news | https://github.com/finaldie/auto-news | 893★ | Tweets/RSS/YouTube/Reddit等→LangChain要約→Notion。興味ベースで「80%ノイズ除去」を明言。Weekly Top-k、Deepdive(検索エージェント深掘り) |
| 2 | iliane5/meridian | https://github.com/iliane5/meridian | 2.4k★ | 数百RSS→Cloudflare Workers→multilingual-e5-small埋め込み+UMAP/HDBSCANでクラスタリング→Geminiの多段分析→日次ブリーフ(Markdown+Nuxt)。前日TLDRとの継続性追跡 |
| 3 | ourongxing/newsnow | https://github.com/ourongxing/newsnow | 20.9k★ | LLM要約なしのリアルタイム集約。適応型スクレイピング(最短2分間隔)、MCPサーバー提供。UI/UXの参考 |
| 4 | sansan0/TrendRadar | https://github.com/sansan0/TrendRadar | 60.3k★ | 11プラットフォーム+RSS。LiteLLMで100+プロバイダ対応。v6.5.0で自然言語の興味記述→自動分類。HTML報告書(タブ/ダーク/検索)、17ツールのMCPサーバー、時間軸追跡 |
| 5 | kevinho/clawfeed | https://github.com/kevinho/clawfeed | 2.3k★ | X/RSS/HN/Reddit/GitHub Trending対応。digest-prompt.md と curation-rules.md の編集だけで出力形式・フィルタをカスタマイズ。Mark & Deep Dive(ブックマーク→後から深掘り)、Source Packs共有 |
| 6 | 00sapo/better-morning | https://github.com/00sapo/better-morning | 7★ | TOML管理RSS+litellm。プロンプトをグローバル/コレクション/フィード単位で編集可、ブーリアンクエリでLLMフィルタ。GitHub Actionsで日次、last-digestキャッシュで差分のみ処理 |
| 7 | piqoni/matcha | https://github.com/piqoni/matcha | 745★ | Go製。RSS/Google News/HN→1日1ファイルのMarkdown(Obsidian推奨)。既読自動除外、HNコメント直リンク+議論数🔥表示、ローカルLLM対応 |
| 8 | hrnrxb/AI-News-Aggregator-Bot | https://github.com/hrnrxb/AI-News-Aggregator-Bot | 22★ | feedparser+BS4+SQLite(送信済み追跡)。GitHub Actions 5時間ごと→Telegram配信。LLM要約は明記なし |
| 9 | polyrabbit/hacker-news-digest | https://github.com/polyrabbit/hacker-news-digest | 754★ | HN専業。ML抽出+gpt-3.5要約(ローカルT5フォールバック)。**コメント欄要約はTODOのまま未実装** |
| 10 | LearnPrompt/ai-news-radar | https://github.com/LearnPrompt/ai-news-radar | 1.5k★ | 10+ソース→GitHub Actions 30分ごと→GitHub Pages静的JSON。「多源確認×時間減衰」スコア+品質ゲート(AI相関0.72以上のみ)、48h鮮度減衰、同一ソースペナルティ。ai-radar Skillで自然言語問い合わせ、バックテストツールあり |

**採用価値トップ5(調査エージェントの結論)**: ①イベントクラスタリング+品質ゲート付きスコアリング(meridian, ai-news-radar) ②自然言語の興味プロファイル(better-morning, auto-news, TrendRadar) ③エージェント/MCPネイティブな対話型クエリ(TrendRadar, ai-news-radar) ④既読/差分キャッシュ(matcha, better-morning) ⑤HNコメント議論の可視化 — **主要HN専業OSSですらコメント要約は未着手のホワイトスペース**。

その他: taielab/awesome-ai-news（類似ツールのキュレーションリスト）、samestrin/llm-newsletter-generator（実験段階）。

---

## Part 2: Claude Code skill / エージェントハーネスの先行事例

### skillエコシステム
- **Anthropic公式 /deep-research**（https://claude.com/blog/a-harness-for-every-task-dynamic-workflows-in-claude-code）: fan-out並列検索→adversarial verification（producer/skepticがコンテキストを共有しない）→引用付き合成。曖昧な質問には事前に2〜3の確認質問
- **199-biotechnologies/claude-deep-research-skill**（https://github.com/199-biotechnologies/claude-deep-research-skill）: Scope→Plan→Retrieve→Triangulate→Outline→Synthesize→Critique(ループバック)→Package。validate_report.py(9項目)+verify_citations.py(URL実在性)を最大3回のvalidate→fix→retryループ。「10+ソース、claimごとに3+」「サマリー200-400語」等の数値基準。Markdown/HTML/PDF三形式出力
- **Weizhena/Deep-Research-skills**（https://github.com/Weizhena/Deep-Research-skills）: /research→/research-deep→/research-report の3フェーズ、フェーズ間で人間の承認を要求
- **Daily News Report / News Aggregator Skill**（https://crossaitools.com/skills/rookie-ricardo/erduo-skills/daily-news-report ほか）: 並列サブエージェント収集、品質スコアでマーケ色の強い投稿を除外、URLキャッシュ重複排除、上位20件で早期終了。キーワードsmart expansion("AI"→"AI,LLM,GPT,Claude")
- **Qiita: Claude Codeで毎朝の技術ニュースを自動要約**（https://qiita.com/iineineno03k/items/810f73deb31fba8617c2）: **依頼要件に最も近い実例**。GitHub Trending(RSSミラー)/HN(Algolia)/Reddit(公開JSON)/Zenn(非公式API)/Qiita(API v2)。「データ取得はcurl/jqで十分。AIにHTTPを投げさせる意味がない」— Phase1(シェル約250行)とPhase2(Claude要約)の完全分離。feed.mdは意訳見出し+背景込み要約+一次URL
- **Galaxy-Dawn/claude-scholar**（https://github.com/Galaxy-Dawn/claude-scholar）: hooks+skills+agents+knowledge evolutionの4層構成
- **Research Summarizer skill**（https://www.claudedirectory.org/skills/claude-skills-research-summarizer）: 情報源タイプ別テンプレート、複数ソース比較マトリクス、信頼性/エビデンス/最新性/客観性の4次元スコア
- **anthropics/skills の可視化系**（https://github.com/anthropics/skills）: web-artifacts-builder、canvas-design(「visual philosophyを先に定義」)。skill設計原則の一次情報: https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills — progressive disclosure、決定論的処理はスクリプトへ

### エージェント型リサーチハーネス
- **Anthropicマルチエージェント研究システム**（https://www.anthropic.com/engineering/multi-agent-research-system）: リード+サブエージェント(3〜5並列)+CitationAgent。努力スケーリング規則を明文化しないと暴走。委譲時は目標/出力形式/ツール/タスク境界の明記必須。トークンはチャット比15倍
- **gpt-researcher**（https://github.com/assafelovic/gpt-researcher）: planner→execution agents→publisher。Deep Researchモードは約5分・約$0.4
- **Stanford STORM**（https://github.com/stanford-oval/storm）: Knowledge Curation→Outline→Article→Polish。類似Wikipedia記事からperspectiveを自動発見
- **LangChain open_deep_research**（https://github.com/langchain-ai/open_deep_research）: LangGraph状態機械、User Clarification→Brief Generationのスコーピング
- **HF smolagents open_deep_research**（https://github.com/huggingface/smolagents）: Code Agent方式、GAIA pass@1 55%

**採用パターントップ5**: ①fetch/summarize物理分離 ②fan-out+adversarial verification(+サブエージェント上限規則) ③興味プロファイルの設定ファイル外出し ④品質基準の数値化+validateループ ⑤Markdown中間+視覚的最終成果物の二層出力。

---

## Part 3: 商用/ホスト型サービスの機能と情報設計（13件）

- **TLDR**（https://tldr.tech/）: 見出し+読了時間+2〜3文の反復ユニット。絵文字による分野タグ
- **Hacker Newsletter**（https://hackernewsletter.com/）: #favorites/#AskHN/#ShowHN等の固定カテゴリ(人力キュレーション)
- **Techmeme**（https://www.techmeme.com/）: **ストーリー単位クラスタリングの元祖**。一次報道を筆頭に関連記事を入れ子。「見出し自体が要約」原則
- **daily.dev**（https://daily.dev/）: カード+タグチップ+アップボートのみ(ダウンボートなし)。オンボーディングで言語/トピック/ソース選択
- **Kagi News (旧Kite)**（https://news.kagi.com/ 、OSS: https://github.com/kagisearch/kite-public）: **情報設計の最良のお手本**。コミュニティキュレーションRSSのみ使用、1日1回更新。セクション: Summary/Sources/Highlights/Quotes/**Perspectives**/Historical background/Timeline/**Quick questions**/**Did you know?**/Action items等をトピック性質で出し分け、ユーザーが表示・並べ替えカスタマイズ可。全主張にin-text citation
- **Particle.news**（https://particle.news/）: 要約スタイル切替(ELI5/5Ws)、Opposite Sides、**情報源本数バッジ**、記事へのQ&A
- **Artifact**（終了。https://en.wikipedia.org/wiki/Artifact_(app)）: 本文直前のスタイル切替可能AI要約。過度なパーソナライズによるニッチ化が反面教師
- **Ground News**（https://ground.news/bias-bar）: **Bias Bar — 帯グラフ1本で構成比を見せる**。Factuality/Bias Rating、Blindspot(自分の摂取偏りの可視化)
- **Feedly AI (Leo)**（https://feedly.com/ai）: Priority 4分類(Business Events/Industry/Like Board/Topic)、重複排除、CVE Insights Cards(ドメイン特化定型カード)
- **Readwise Reader (Ghostreader)**（https://docs.readwise.io/reader/guides/ghostreader/overview）: 保存時自動要約+ハイライト起点の事後要約。プロンプト完全カスタマイズ
- **Folo (RSSNext)**（https://github.com/RSSNext/Folo）: 個別記事AI要約+タイムライン全体の日次AIダイジェストの**二段構え**
- **HN要約系**: Hacker News Recap(Wondercraft.ai)、**Hacker News Highlights**(本文+コメント欄の両方をAI要約する数少ない例)、Hackercast(https://camrobjones.com/hackercast/ パイプライン公開)、hckrnews.com(コメント数+ポイントの数字2つで注目度表現)
- **Refind**（https://refind.com/）: Timelessnessスコアで古い良記事を再浮上(resurface)

**採用アイデアトップ5**: ①ストーリー単位クラスタリング+一次ソース筆頭 ②Kagi Newsの可変長・開閉式セクション ③帯グラフ1本の構成比表現 ④最小反復ユニットのテンプレート化 ⑤二段構え要約+コメント欄議論の要約。

---

## Part 4: 日本語圏の事例とデータソースAPI事情

### 日本語圏の実装事例
1. **GAS+GeminiのSlack Bot**（https://qiita.com/owayo/items/467290bce97d1f62fff9）: GIGAZINE/Publickey/Qiita/ZennのRSS→Gemini→Slack。ホスト別CSSセレクタマップ
2. **URL投げ込み型Notion蓄積Bot**（https://zenn.dev/sigmai_tech/articles/368533f22feb7f）: Function CallingでJSON構造化、12カテゴリ自動分類、OGP保存
3. **Claude Code 2フェーズ設計feed.md**（https://qiita.com/iineineno03k/items/810f73deb31fba8617c2）: Part 2参照。ソースごとの癖(Zennタイムゾーン、Redditレート制限2秒sleep)への個別対応
4. **Laravel News全訳パイプライン**（https://qiita.com/sgrs38/items/3bf1954d3903db068c74）: last-checked.txtで差分処理、翻訳担当と検証担当のエージェント分離、除外記事も理由を1行残す
5. **launchd毎朝の朝刊**（https://zenn.dev/aoi_umigishi/articles/936073d8dd16e9）: 3グループ並列取得、直近7日URLのgrep重複除外、settings.local.jsonで権限事前許可
6. **Claude APIメールダイジェスト**（https://note.com/stg_cat/n/n8a898f8994b4）: 選定理由の明記、$5で約2年分と試算

直接の先行実装: **claude-world/trend-pulse**（https://github.com/claude-world/trend-pulse）— 37ソース「全ソース無料・認証ゼロ」のCLI/Python/MCPサーバー。

### データソースAPI事情（2026-07時点）

| ソース | 取得手段 | 認証 | 制約・注意点 |
|---|---|---|---|
| Hacker News | 公式Firebase API / Algolia Search API | 不要 | Firebaseはレート制限なし明記。Algoliaは10,000req/h/IP、1クエリ最大1000ヒット |
| Reddit | 公式Data API(OAuth2) | 必須・審査制 | 2025年11月以降新規登録は手動審査(Responsible Builder Policy)。無料枠100QPM非商用。無認証.jsonは2026年5月末以降403化の報告。**RSS(old.reddit.com/.rss)もDC系IPは403になりやすい。ベストエフォート前提** |
| Zenn | 公式RSS(zenn.dev/feed、/topics/{t}/feed、?all=1) / 非公式API(api.zenn.dev) | 不要 | RSSは公式機能(https://zenn.dev/zenn/articles/zenn-feed-rss)。非公式APIは1ページ48件 |
| Qiita | 公式API v2(https://qiita.com/api/v2/docs) | 任意 | 認証1000req/h、無認証60req/h/IP(実測ヘッダで確認済み) |
| はてブ | ホットエントリRSS(b.hatena.ne.jp/hotentry/{cat}.rss) / entry.counts API | 不要 | entry.countsは50URL一括 |
| GitHub Trending | **公式APIなし**。RSSミラー mshibanami/GitHubTrendingRSS、またはSearch APIで近似 | ミラーは不要 | 非公式API(huchenme)は2020年以降実質未メンテ |
| lobste.rs | hottest.json / newest.json | 不要 | 非公式慣習。仕様変更リスクあり |
| dev.to | Forem API v1(developers.forem.com) | 読み取りほぼ不要 | per_page最大1000 |

### 要件への示唆
- 障害の局所化(ソース単位try/catch)、差分管理による重複掲載防止、AIの守備範囲最小化、選定理由明記、構造化蓄積、並列取得
- Redditはベストエフォート、GitHub Trendingはミラー/スクレイピング前提、非公式エンドポイントはフェイルセーフ+明示的ログ必須
- 骨格はHN/Zenn/Qiita/はてブ(+dev.to/lobste.rs)の公式・安定ソースで組む

---

## 補記: レビューでの追加実測（2026-07-07、evaluatorエージェント）

- Anthropic engineering blogのRSS: `/engineering/rss.xml`・`/rss.xml`・`/news/rss.xml` いずれも404 → 要件から除外し、公式フィード提供時に再検討
- 疎通確認(各1リクエスト): HN Algolia / zenn.dev/feed / zenn.dev/topics/claudecode/feed / b.hatena.ne.jp/hotentry/it.rss / lobste.rs/hottest.json / qiita.com/api/v2/items(Rate-Limit: 60を実測) / GitHubTrendingRSSミラー / api.github.com claude-code releases — すべて200
- Node v23.6.0で `node:sqlite` はフラグなしロード成功、ExperimentalWarningがstderrに出る
