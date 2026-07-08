---
name: winnow
description: 技術記事サーベイダイジェスト生成。Hacker News / Zenn / Qiita / はてブ / GitHub Trending / Reddit等から過去24〜48時間の記事を収集し、興味プロファイルに基づいて選別・要約し、お気に入り/興味なしを記録できるHTMLレポートを生成する。/winnow で明示起動されたとき、またはユーザーが「技術記事のサーベイ」「今日の技術ニュースまとめ」「ダイジェスト生成」を求めたときに使用する。
---

# Winnow — 技術記事サーベイダイジェスト

このskillのルートディレクトリを `$ROOT` と呼ぶ（SKILL.mdのあるディレクトリ。実体は `~/ghq/github.com/asriel-dev-apps/winnow`）。設計の根拠は `$ROOT/REQUIREMENTS.md` v0.2。

## 原則

- **HTTPアクセス・DB読み書きはすべてスクリプト経由**。あなた（Claude）が直接curlを叩いたりSQLiteを操作したりしない
- あなたの成果物は `stories.json` のみ。report.md / report.html は `render.mjs` が機械生成する
- スクリプトの成否は **exit codeのみ** で判定する（`node:sqlite` のExperimentalWarning等、stderrの警告は失敗ではない）

## 実行手順

### 1. 収集（並列）

`$ROOT/scripts/fetch/` の各スクリプトを並列実行し、出力を一時ディレクトリに保存する:

```bash
mkdir -p /tmp/winnow-raw && cd $ROOT
for s in hn zenn qiita hatebu ghtrend reddit lobsters agents; do
  scripts/fetch/$s.sh > /tmp/winnow-raw/$s.json 2>/tmp/winnow-raw/$s.err &
done; wait
```

- 骨格ソース（hn, zenn, qiita, hatebu）が**4つとも失敗**した場合のみエラー終了し、ユーザーに報告する
- それ以外の失敗はスキップし、ソース名と失敗理由を控えておく（stories.jsonの `fetch_status` に記録する）

### 2. 取り込みと候補抽出

```bash
node scripts/sync-feedback.mjs                             # クラウドのスワイプ判定を取り込む(未設定ならスキップ)
node scripts/ingest.mjs ingest /tmp/winnow-raw/*.json      # → run_id が出力される
node scripts/ingest.mjs candidates --run <run_id>          # → 候補JSON(quality_score付き) + learned_profile
```

candidatesの出力にはスワイプ履歴から導出した学習プロファイル（`learned_profile`、判定が無ければnull）が含まれる。

### 3. 選別（あなたの仕事 その1）

`$ROOT/config/interests.yaml` を読み、候補リストに対して:

1. **クラスタリング**: 同一トピックを扱うitemを1つの「ストーリー」に束ねる（cluster_id: s01, s02, …）。なお `github-release` タグのitemは候補から自動除外されている（定点ウォッチで扱う）。またステップ4.5でOSS RANKINGに載せるリポジトリは、特筆すべき文脈がない限りストーリーにはしない（重複回避）
2. **match_score付与**（0–100）: 興味プロファイルとの合致度。`focus` 該当は高スコア、`exclude` 該当は掲載対象外。学習プロファイルがあれば加味する（明示プロファイルが優先）
3. **選別**: 複合スコア = round(0.7×match + 0.3×quality) が **55以上** の上位 **最大15ストーリー**（通常枠）
4. **セレンディピティ枠**（学習プロファイルが存在する場合のみ）: match<40 かつ quality≥80 から最大2件を外数で追加し `is_serendipity: true`

### 4. 要約（あなたの仕事 その2）

掲載ストーリーごとに:

- HN由来のitemがあれば `scripts/fetch/hn_comments.sh <objectID>` でコメントを取得し、「議論の論点」セクションの入力にする
- 以下を生成:
  - `translated_title`: 日本語の意訳見出し（直訳禁止。固有名詞・数字を含める）
  - `summary`: 「。」区切りで**2〜3文**。背景・注目理由込み
  - `selection_reason`: **1行**（改行なし）
  - `sections`（該当するものだけ。全部は書かない）: discussion（HNコメントの賛否・論点） / perspectives（トレードオフ・賛否両論） / quick_questions（2〜3問のQ&A） / did_you_know（豆知識）
- レポート全体の `macro_summary`: ちょうど**3行**（配列長3）

### 4.5 定点ウォッチの生成（あなたの仕事 その3）

stories.json に任意ブロック2つを追加する（データが無ければ省略可）:

- **`release_watch`**: `/tmp/winnow-raw/agents.json` の `raw_tags` に `github-release` を含むitemから生成。**リポジトリごとに別entry**（claude-codeとcodexを混ぜない）。各リリースは新しい順に最大5件、`notes_summary` は item の `notes`（リリースノート本文）から**変更内容を1〜2文の日本語で要約**（notesが空なら notes_summary は省略）
- **`oss_ranking`**: `/tmp/winnow-raw/ghtrend.json` から、`config/sources.json` の `ranking_keywords` にリポジトリ名または `description` がマッチ（大文字小文字無視）するものを**トレンド順のまま最大10件**。`rank` は1からの連番、`note` は description を踏まえた1行の日本語説明

結果を `output/YYYY-MM-DD/stories.json` に書く。スキーマはREQUIREMENTS.md §5.1に厳密に従う（`run_id` はstep 2の値）。

### 5. 検証 → 書き戻し → レンダリング

```bash
node scripts/validate.mjs output/YYYY-MM-DD/stories.json   # 失敗→修正して再実行(最大2回)
node scripts/ingest.mjs finalize output/YYYY-MM-DD/stories.json --run <run_id>
node scripts/render.mjs output/YYYY-MM-DD/stories.json     # → report.md + report.html
node scripts/index.mjs                                     # → output/index.html (アーカイブ索引)
node scripts/publish.mjs output/YYYY-MM-DD/stories.json    # → クラウドへ配信(未設定ならスキップ)
```

validateが2回の修正後も失敗する場合は続行し、最終報告で警告する。**finalizeを飛ばさないこと**（飛ばすと次回、同じ記事が再掲される）。

### 6. 配信

```bash
node scripts/serve.mjs &   # 既に稼働中なら自動で再利用される(多重起動しない)
open http://127.0.0.1:${WINNOW_PORT:-8765}/YYYY-MM-DD/report.html
```

### 7. ユーザーへの報告

- マクロ要約3行、掲載ストーリー数（うちセレンディピティ数）、取得状況（失敗ソースがあれば明記）、レポートURL（ローカル + publishが成功していればクラウドURL）を簡潔に報告する
- report.md も SendUserFile で添付する
- レポート上の★/✕ボタンで判定すると次回の選別に反映される（オーナーのみ表示）ことを一言添える（初回のみ）
