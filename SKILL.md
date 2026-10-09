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

### 1. 収集

`$ROOT/scripts/fetch/` の各スクリプトを `$ROOT/.raw/`（git管理外）に出力する。Bashツールのサンドボックスは `/tmp` への書き込み・`&` の並列・`$s` を展開するループを拒否するので、ソース名をリテラルで書き、`;` で順に実行する:

```bash
cd $ROOT; mkdir -p .raw; scripts/fetch/hn.sh > .raw/hn.json 2>.raw/hn.err; echo "hn exit=$?"; scripts/fetch/zenn.sh > .raw/zenn.json 2>.raw/zenn.err; echo "zenn exit=$?"
# 同じ形で qiita hatebu ghtrend reddit lobsters agents cloudflare
```

- zenn は exit 141（SIGPIPE）を返すことがある。出力が妥当なJSONなら成功として扱う
- cloudflare は各記事の本文全文を `.raw/cloudflare/<id>.txt` にも書き、その絶対パスを item の `body_path` に入れる（ステップ4.5のハイライトでサブエージェントが読む）
- 骨格ソース（hn, zenn, qiita, hatebu）が**4つとも失敗**した場合のみエラー終了し、ユーザーに報告する
- それ以外の失敗はスキップし、ソース名と失敗理由を控えておく（stories.jsonの `fetch_status` に記録する）

### 2. 取り込みと候補抽出

```bash
node scripts/sync-feedback.mjs                             # クラウドのスワイプ判定を取り込む(未設定ならスキップ)
node scripts/ingest.mjs ingest .raw/hn.json .raw/zenn.json …  # 9ファイルを列挙 → run_id が出力される
node scripts/ingest.mjs candidates --run <run_id> > .raw/cand.json  # → 候補JSON(quality_score付き) + learned_profile
```

`candidates` は `--run` で絞らず、未表示の全item（数千件）を返す。今回の `.raw/*.json`（agents・cloudflare 以外）にある URL の集合と突き合わせて絞ってから読む:

```bash
jq -s '(.[0:7]|add|map(.url)) as $u | .[7].candidates | map(select(.url as $x | $u|index($x)))' .raw/hn.json .raw/zenn.json .raw/qiita.json .raw/hatebu.json .raw/ghtrend.json .raw/reddit.json .raw/lobsters.json .raw/cand.json > .raw/today.json
```

candidatesの出力にはスワイプ履歴から導出した学習プロファイル（`learned_profile`、判定が無ければnull）が含まれる。

### 3. 選別（あなたの仕事 その1）

`$ROOT/config/interests.yaml` を読み、候補リストに対して:

1. **クラスタリング**: 同一トピックを扱うitemを1つの「ストーリー」に束ねる（cluster_id: s01, s02, …）。なお `github-release` / `cloudflare-official` タグのitemは候補から自動除外されている（定点ウォッチで扱う）。またステップ4.5でOSS RANKINGに載せるリポジトリは、特筆すべき文脈がない限りストーリーにはしない（重複回避）
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

stories.json に任意ブロックを追加する（データが無ければ省略可）:

- **`release_watch`**: `.raw/agents.json` の `raw_tags` に `github-release` を含むitemから生成。**リポジトリごとに別entry**（claude-codeとcodexを混ぜない）。各リリースは新しい順に最大5件、`notes_summary` は item の `notes`（リリースノート本文）から**変更内容を1〜2文の日本語で要約**（notesが空なら notes_summary は省略）
- **`cloudflare_watch`**: `.raw/cloudflare.json`（Cloudflare公式。`raw_tags` の `cloudflare-blog` / `cloudflare-changelog` で振り分け）から `{"blog": [...], "changelog": [...]}` を生成。**興味スコアで絞らず全件を新しい順に載せる**（ユーザーがCloudflare公式の最新情報を常に見たいため）。各entryは `title`（原題のまま）・`url`・`published_at`・`summary`（item の `notes` から書く。notesが空なら省略）。summary は**専門外の人にも通じる平易な日本語1〜2文**で、次の3点を必ず含める: ①何ができるようになったか ②なぜ作られたか（どんな困りごとを解決するのか） ③何に・どう使うか（具体的な使い道）。製品名以外のカタカナ語・略語を並べない。notesに②が書かれていなければ推測で埋めず、①と③だけにする
  - さらに `highlights`（**最大5件**）を作り、図で見せる。**選ぶのはタイトルと `notes` だけを見て行う。** 全件が候補で、5件を超えるときだけ次の順に外していく（1から先に外す。5件以下ならどれも外さない）:
    1. 使い方が何も変わらない発表 — 会社の取り組み・寄付・事例集・速度ランキング・方針表明
    2. ネットワーク管理・社内セキュリティ向けの細かい設定変更 — Zero Trust / Access / Tunnel の権限や挙動、WAF・Rules の式の関数追加など（緊急の脆弱性対応は外さない）
    3. 既存機能の小さな改善 — 上限値の引き上げ、権限の細分化、名前の変更
    4. 同じ発表のブログと changelog の重複 — 1件にまとめ、図を描きやすい方を選ぶ
  - 最後まで外さないもの: **AI**（Workers AI のモデル、AI Gateway、AI Search、Agents SDK、MCP。Cloudflare が力を入れている領域）、Workers 基盤（Workers / Durable Objects / D1 / KV / R2 / Containers）、料金・無料枠の変更、廃止・移行が要るもの。それでも5件を超えるなら、新機能・既定動作の変更を小さな改善より優先する
  - **各highlightの中身は、選んだ記事ごとにサブエージェントを1つ立てて作らせる。** Agent ツールを `subagent_type: "general-purpose"` で、選んだ件数ぶん**1つのメッセージでまとめて**呼ぶ。各サブエージェントには下のテンプレートの `{…}` を埋めて渡す（`body_path` は `.raw/cloudflare.json` の item にある）。**あなた自身は本文ファイルを読まない**（ブログの本文は1件で1万字前後あり、5件ぶん積むとコンテキストを圧迫する）。返ってきた JSON オブジェクトを選んだ順に `highlights` に並べる。validate がハイライトで落ちたら、落ちた1件だけをあなたが直す（本文を読み直す必要があるなら、その1件だけ同じテンプレートでサブエージェントを立て直す）

    ```text
    Cloudflare 公式の発表1件を、技術レポートの「図カード」1枚分の JSON にしてください。

    記事: {title}
    URL: {url}
    本文ファイル: {body_path}
    種別の目安: {blog か changelog}

    手順:
    1. 本文ファイルを Read で全部読む（ほかのファイルは読まない。ファイルを書かない。Web を見ない）
    2. 記事の本質（何が変わり、誰の何に効くか）をつかみ、次の JSON オブジェクトを1つだけ返す。前後に説明文やコードフェンスを付けない

    {"title": "原題のまま", "url": "上の URL", "product": "製品名",
     "kind": "agent|platform|pricing|security",
     "headline": "何が変わるかを言い切る日本語見出し",
     "essence": "記事の本質を1〜2文（任意）",
     "figures": [ 図を1〜3個 ],
     "warn": "料金開始日など、行動が要る注意1文（無ければキーごと省略）",
     "use": ["使いどころ 1〜3行"]}

    kind: agent=AI（モデル・エージェント・AI 系サービス）/ platform=Workers 基盤 / pricing=料金に影響 / security

    図の型（type）と形。記事の本質に合う型を選ぶ:
    | type | 使う場面 | 形 |
    |---|---|---|
    | flow | 処理の順番が変わる・新しい処理の流れ | before?/after: 2〜5段の [{label, note?}] |
    | sequence | 誰と誰がどの順でやり取りするか（リクエストの経路、エージェント間の受け渡し） | actors: 2〜4個の名前、steps: [{from, to, label}]（2〜8個、from/to は actors のどれか） |
    | layers | 部品の構成・どこに何が入るか | layers: 2〜5段の [{label, items: [文字列 1〜6個]}]（上が利用者側） |
    | compare | 違いの表（これまで/これから、プラン別、提供元別） | columns: 2〜4個の見出し、rows: [{label, cells: [columns と同数]}]（1〜6行） |
    | timeline | 日付の決まった出来事（切り替え日・廃止日・料金開始日） | events: 2〜6個の [{date, label, note?}] |
    | split | 当てはまる/当てはまらないの二分（対応が要る人と要らない人など） | left/right: {label, items: [文字列 1〜5個]} |
    | stats | 記事中の数値 | items: 2〜3個の [{value, label}] |
    各図は任意で "caption"（図が何を示すかの1文）を持てる。例: {"type": "compare", "caption": "…", "columns": ["これまで", "これから"], "rows": [{"label": "…", "cells": ["…", "…"]}]}

    型の選び方:
    - flow は処理の順番が実際に変わるときだけ。1段だけのフローは作らない（before も after も2段以上）
    - 表の形をした変化（ステータスコード、上限値、プラン別の差）は compare
    - 日付の決まった出来事は timeline。誰が対応すべきかの話は split。構成の話は layers。リクエストの経路やエージェント間の受け渡しは sequence
    - 図は1〜3個。違う型を組み合わせてよい（例: timeline + split）
    - stats の value は単位込みの文字列（例 {"value": "0.25 秒", "label": "書き込みが全拠点に届くまで"}）。数値型にしない
    - 事実は本文に書かれたことだけ。本文に無い数値・日付・製品名を作らない
    - label・items は短い名詞句。日本語で、製品名以外のカタカナ語・略語を並べない
    ```
  - highlightに選んだ記事も `blog`/`changelog` には残してよい（表示時に「ほかの発表」から自動で除かれる）
- **`oss_ranking`（LLM & AGENTS）** と **`oss_ranking_general`（TOOLS & APPS）**: `.raw/ghtrend.json` の各リポジトリを、`config/sources.json` の `ranking_keywords` にリポジトリ名または `description` がマッチ（大文字小文字無視）するかで振り分ける。**マッチ → `oss_ranking`**（LLM・エージェント系）、**非マッチ → `oss_ranking_general`**（ツール・CLI・アプリ等の汎用トレンド）。**それぞれトレンド順のまま最大10件**、`rank` は各配列で1から独立に連番、`note` は description を踏まえた1行の日本語説明。どちらか一方が0件ならそのキーは省略してよい

結果を `output/YYYY-MM-DD/stories.json` に書く。スキーマはREQUIREMENTS.md §5.1に厳密に従う（`run_id` はstep 2の値）。

### 4.9 日本語の推敲（yomiyasu）

stories.json を書き終えたら、validate の前に日本語を整える。

1. Skill ツールで `yomiyasu`（plugin 名つきでは `yomiyasu:yomiyasu`）を読み込み、その原則で日本語の文を見直す。サブエージェントが書いた CLOUDFLARE のハイライトも対象にする。ただし次の点は yomiyasu より優先する:
   - 「です・ます」にそろえない。体言止めや短い言い切りのままでよい
   - 箇条書き・表・図のラベルを地の文に書き直さない
   - 文の形は、画面でひと目で読めることを優先する（短く、1文1要点）
   - 出力フォーマット（「書き直した本文」「変えたところ」等）は使わない。stories.json を直接直すだけ
2. `node scripts/jp-lint.mjs output/YYYY-MM-DD/stories.json` を実行し、`findings` の各項目を `path` のフィールドで見直す。指摘は候補なので、意味が変わるなら直さない。直すのは1回だけで、再実行の往復はしない
3. `{"skipped": ...}` が出たらリンターが無い。1 だけで進め、最終報告に書く

### 5. 検証 → 書き戻し → レンダリング

```bash
node scripts/validate.mjs output/YYYY-MM-DD/stories.json   # 失敗→修正して再実行(最大2回)
node scripts/ingest.mjs finalize output/YYYY-MM-DD/stories.json --run <run_id>
node scripts/render.mjs output/YYYY-MM-DD/stories.json     # → report.md + report.html
node scripts/index.mjs                                     # → output/index.html (アーカイブ索引)
node scripts/publish.mjs output/YYYY-MM-DD/stories.json    # → クラウドへ配信(未設定ならスキップ)
```

validateが2回の修正後も失敗する場合は続行し、最終報告で警告する。**finalizeを飛ばさないこと**（飛ばすと次回、同じ記事が再掲される）。

- `publish.mjs` は単独のコマンドで実行する。ほかのコマンドと `;` でつなぐと、deploy-gate hook がデプロイとみなして止める
- 終わったら `rm -rf .raw`

### 6. 配信

```bash
node scripts/serve.mjs &   # 既に稼働中なら自動で再利用される(多重起動しない)
open http://127.0.0.1:${WINNOW_PORT:-8765}/YYYY-MM-DD/report.html
```

### 7. ユーザーへの報告

- マクロ要約3行、掲載ストーリー数（うちセレンディピティ数）、取得状況（失敗ソースがあれば明記）、レポートURL（ローカル + publishが成功していればクラウドURL）を簡潔に報告する
- report.md も添付する。SendUserFile が使える環境ならそれで送り、無い環境（Claude Code CLIなど）では `output/YYYY-MM-DD/report.md` のパスを報告に書く
- レポート上の★/✕ボタンで判定すると次回の選別に反映される（オーナーのみ表示）ことを一言添える（初回のみ）
