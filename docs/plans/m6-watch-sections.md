# Winnow M6 実装指示書 — 定点ウォッチセクション（RELEASE WATCH / OSS RANKING）

> 実装担当のcoding agentへの作業指示書。正本は `REQUIREMENTS.md`。

対象: リポジトリルート。M0〜M5実装済み・本番稼働中。`bash scripts/smoke.sh` の回帰を壊さないこと。

## 背景（ユーザー要望）

- リリース情報はこれまでLLMが1つの「リリースウォッチ」ストーリーに束ねていたが、**claude-codeとcodexを別々に**見たい
- **OSSのskills等のランキング**も独立したセクションで見たい
- → ストーリー枠(≤15)とは別に、レポート下部へ**固定セクション2つ**を新設する

## 1. fetch層の拡張

### `scripts/fetch/agents.sh`
- GitHub Releases API から取得する各itemに **`notes` フィールドを追加**: レスポンスの `.body`（リリースノートMarkdown本文）から改行を空白に潰し、**先頭1500文字**まで。無ければ空文字
- 共通スキーマ外の追加フィールドだが、ingest.mjsは未知フィールドを無視するため安全（要確認、壊れるなら ingest 側で除外）

### `scripts/fetch/ghtrend.sh`
- RSSの各itemに **`description` フィールドを追加**: item内の `<description>` からHTMLタグと実体参照を除去したテキスト、**先頭300文字**。無ければ空文字

### `config/sources.json`
- `"ranking_keywords": ["skill", "agent", "claude", "codex", "mcp", "copilot", "llm"]` を追加（OSS RANKINGの抽出キーワード。小文字で保持し、マッチは大文字小文字無視）

## 2. `scripts/ingest.mjs`

- `candidates` サブコマンドで、**`raw_tags` に `github-release` を含むitemを候補から除外**する（リリースは定点セクションで扱うため、ストーリー候補に出さない）。DBへのupsert自体は従来どおり行う

## 3. stories.json スキーマ拡張（任意ブロック2つ）

```json
{
  "release_watch": [
    {
      "repo": "anthropics/claude-code",
      "releases": [
        { "tag": "v2.1.202", "url": "https://…", "published_at": "ISO8601", "notes_summary": "1〜2文の日本語要約" }
      ]
    },
    { "repo": "openai/codex", "releases": [ … ] }
  ],
  "oss_ranking": [
    { "rank": 1, "repo": "addyosmani/agent-skills", "url": "https://…", "note": "1行の日本語説明" }
  ]
}
```

- どちらも**任意**（無い日は省略可）。生成はLLM側の仕事（SKILL.mdは依頼側が更新する）
- `scripts/validate.mjs` にルール追加（ブロックが存在する場合のみ検査）:
  - release_watch: 各entryに `repo` 非空、`releases` 1件以上、各releaseに `tag`・`url` 非空。**1つのentryに複数リポジトリを混ぜない**前提のため `repo` の重複禁止
  - oss_ranking: **最大10件**、`rank` が1からの連番、各entryに `repo`・`url` 非空

## 4. レンダリング（scripts/render.mjs + templates/report.html）

ストーリー一覧の後・FETCH STATUSの前に、静的HTML（ビルド時生成）で2セクションを追加:

- **`RELEASE WATCH`**（eyebrow見出し）: リポジトリごとにサブブロック。リポジトリ名（mono）+ リリースを新しい順に「タグ（リンク）・日付・notes_summary」のリスト。リポジトリ間は明確に分離（別カードまたは区切り線）
- **`OSS RANKING`**（eyebrow見出し）: 番号付きリスト（rank順）。「rank. repo名（リンク） — note」。番号はランキングという実態に即した意味を持つ
- report.md にも同構成のMarkdownセクションを追加
- デザインは既存トークン（mono eyebrow / gold / line）に従い、控えめに。ブロックが無い日はセクションごと出さない
- 索引（index.mjs）の検索対象に oss_ranking の repo 名と release_watch の repo/tag も含める（埋め込みJSONに追加）

## 受け入れ基準

1. `bash scripts/smoke.sh` 全PASS。fixtureの stories.sample.json に release_watch / oss_ranking を追加し、validate・renderがブロックを処理することを検証（`PASS watch_sections` として、render後のHTMLに RELEASE WATCH と OSS RANKING の見出し・repo名が静的に含まれることを確認）
2. ブロックが**無い** stories.json でも validate / render が従来どおり通る（後方互換）
3. `github-release` タグのitemが candidates 出力に含まれない検証を smoke に追加（`PASS release_excluded`: fixtureに github-release タグ付きitemを混ぜて確認）
4. `node --check` 全.mjs
5. README.md / REQUIREMENTS.md / SKILL.md / docs/（本書以外）無変更

## 制約（従来どおり）

ローカルscriptsは依存ゼロ、cloud/のみnpm依存可。git操作・wranglerネットワークコマンド禁止。サンドボックスに外部ネットワークなし（実APIの確認は依頼側が行う）。
