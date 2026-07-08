# Winnow

技術記事サーベイダイジェスト生成 — Claude Code skill

Hacker News / Zenn / Qiita / はてなブックマーク / GitHub Trending / Reddit / lobste.rs を1コマンドで横断サーベイし、興味プロファイルに基づいて選別・要約した「朝刊」を生成します。名前は英単語 *winnow*（風選する — 籾殻を飛ばして実だけを残す）に由来します。

## 特徴

- 複数ソースで重複する話題をストーリー単位に束ね、言及ソース数を注目度として扱う
- 記事本文だけでなく、Hacker Newsコメント欄の論点まで要約
- レポート上で「お気に入り / 興味なし」を記録すると次回の選別に反映。判定は保存され、いつでも変更できる
- 出力はMarkdownと自己完結HTML（JavaScript無効でも可読、ライト / ダーク対応）
- launchdで毎朝自動実行し、Cloudflare Workers（無料枠）へ自動デプロイ

## 必要環境

macOS / [Claude Code](https://claude.com/claude-code) / Node.js >= 23.4 / jq。クラウド配信を使う場合のみCloudflareアカウントとwrangler。

## 使い方

```bash
git clone https://github.com/asriel-dev-apps/winnow.git && cd winnow
$EDITOR config/interests.yaml config/sources.json   # 興味プロファイルと収集ソース
ln -s "$PWD" ~/.claude/skills/winnow                # skillとして登録
```

Claude Codeのセッションで `/winnow` を実行すると、収集からレポート生成・表示まで動きます。動作確認は `bash scripts/smoke.sh`。

- 毎朝の自動実行: `bash scripts/install-launchd.sh`（解除は `--uninstall`）
- クラウド配信: `cloud/` で `wrangler d1 create winnow` → `wrangler d1 execute winnow --remote --file schema.sql` → `wrangler deploy` → `wrangler secret put WINNOW_KEY` を実行し、`data/cloud.json` に `{"url": "...", "key": "..."}` を置く。ブラウザから判定を記録するには `/login` からログイン

## ドキュメント

設計の正本は [REQUIREMENTS.md](REQUIREMENTS.md)、先行調査と実装計画の記録は [docs/](docs/) にあります。
