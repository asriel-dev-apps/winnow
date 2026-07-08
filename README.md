# Winnow 🌾

**技術記事サーベイダイジェスト生成 — Claude Code skill**

Hacker News / Zenn / Qiita / はてなブックマーク / GitHub Trending / Reddit / lobste.rs を1コマンドで横断サーベイし、興味プロファイルに基づいて選別・要約した「朝刊」を生成します。名前は英単語 *winnow*（風選する）— 籾殻（ノイズ）を風で飛ばし、実（価値ある記事）だけを残す、から。

## 特徴

- **ストーリー単位のクラスタリング**: 複数ソースで重複する話題を1つに束ね、「何ソースで話題になっているか」を注目度シグナルに使う
- **HNコメント欄の議論要約**: 記事本文だけでなく、Hacker Newsで賛否が分かれている論点まで要約
- **スワイプで学習**: レポートのトリアージモードで右スワイプ=⭐お気に入り / 左=✋興味なし。判定はSQLiteに蓄積され、次回サーベイの選別に反映。興味の外の良記事を混ぜる🎲セレンディピティ枠つき
- **二層出力**: grep可能なMarkdown + 自己完結HTML（JSなしでも全文可読、ライト/ダーク対応）
- **毎朝自動実行**: launchdで毎朝7時にheadless実行し、macOS通知
- **どこからでも閲覧**: Cloudflare Workers（無料枠）に静的サイトとして自動デプロイ。スワイプ判定はD1に記録され、翌朝ローカルの学習に還流

## 仕組み

```
fetch層(シェルスクリプト×9)          … HTTP取得はすべて決定論的なスクリプト
  └→ ingest(node:sqlite)            … URL正規化・重複排除・既読管理・学習プロファイル導出
       └→ Claude Code               … クラスタリング → スコアリング → 選別 → 要約(stories.json)
            └→ validate → finalize → render → publish
                 ├→ output/…/report.{md,html}   (ローカル)
                 └→ Cloudflare Workers Static Assets + Hono API + D1  (クラウド)
```

設計の詳細は [REQUIREMENTS.md](REQUIREMENTS.md)、先行事例調査は [docs/research/](docs/research/) を参照。

## 必要環境

- macOS（launchd・通知を使用。パイプライン自体は他OSでも動作）
- [Claude Code](https://claude.com/claude-code)
- Node.js **>= 23.4**（`node:sqlite` を使用。追加のnpm依存はゼロ）
- `jq` / `curl`
- （クラウド配信を使う場合）Cloudflareアカウント + wrangler

## セットアップ

```bash
git clone https://github.com/asriel-dev-apps/winnow.git && cd winnow

# 1. 興味プロファイルと収集ソースを自分用に編集
$EDITOR config/interests.yaml config/sources.json

# 2. Claude Code skillとして登録
ln -s "$PWD" ~/.claude/skills/winnow

# 3. 実行（Claude Codeのセッションで）
#    /winnow
```

初回実行でDB作成→収集→レポート生成→ブラウザ表示まで動きます。動作確認は `bash scripts/smoke.sh`。

### 定期実行（毎朝7時）

```bash
bash scripts/install-launchd.sh        # --uninstall で解除
```

`com.winnow.daily`（毎朝のサーベイ）と `com.winnow.serve`（フィードバックサーバー常駐、127.0.0.1:8765）が登録されます。headless実行の権限は `.claude/settings.local.json` の allowlist で事前許可してください（[docs/plans/m1-m3.md](docs/plans/m1-m3.md) に例）。

### クラウド配信（任意・Cloudflare無料枠）

```bash
cd cloud && npm install
npx wrangler d1 create winnow          # → database_id を wrangler.jsonc に記入
npx wrangler d1 execute winnow --remote --file schema.sql
npx wrangler deploy
openssl rand -hex 24 | npx wrangler secret put WINNOW_KEY
cd .. && echo '{"url": "https://<your-worker>.workers.dev", "key": "<生成したキー>"}' > data/cloud.json
```

以後 `/winnow` の実行ごとに静的サイトへ自動デプロイされます。閲覧は認証なし、スマホからスワイプ判定も記録したい場合は `/auth?key=<キー>` を一度開いてcookieを取得してください。

## ディレクトリ構成

```
SKILL.md              skill本体(実行手順)
REQUIREMENTS.md       要件定義(正本)
config/               interests.yaml(興味プロファイル) / sources.json(収集設定)
scripts/fetch/        ソース別取得スクリプト
scripts/              ingest / validate / render / serve / publish / sync-feedback ほか
templates/report.html レポートテンプレート(スワイプUI内蔵)
cloud/                Cloudflare Worker(Hono + D1)
launchd/              定期実行用plistテンプレート
docs/                 先行調査・実装計画のアーカイブ
```

## 開発について

本プロジェクトはAIエージェントとの協働で開発されています（要件定義・レビュー・実装・検証の記録は `docs/` 参照）。
