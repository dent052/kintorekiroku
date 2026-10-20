# 引き継ぎ資料（筋トレ記録アプリ kintorekiroku）

作成: 2026-10-19 夜（JST）。このファイルを最初に全部読むこと。利用者とのやり取りは**日本語**。

## 1. これは何か
利用者（Android スマホ、自宅、自重＋トレーニングバンド、限界まで追い込むタイプ）専用の筋トレ記録 PWA。
- アプリ（公開中・検索除け noindex）：https://dent052.github.io/kintorekiroku/
- コード：`dent052/kintorekiroku`（**公開**リポジトリ。GitHub Pages は `main` の root から配信。作業ブランチ `ccr-7676d6d6-1kyvh4` は `main` と同一内容）
- 記録の保存先：`dent052/kintorekiroku-data`（**非公開**。`data.json`＝アプリが自動保存、`posts.json`＝コーチ便、`topics.json`、`README.md`＝コーチ手順書）
- 記録はスマホの `localStorage`（`kintore:data`）。アプリが5秒後に GitHub へ PUT（利用者のトークンはスマホの中だけにある。fine-grained、Contents R/W、`kintorekiroku-data` のみ、期限1年＝2027年10月ごろ作り直し）

## 2. 現在の状態
- **v5（下タブ・押せる一覧）を作業中**。設計 `docs/superpowers/specs/2026-10-20-kintore-v5-design.md`、計画 `…/plans/2026-10-20-kintore-v5.md`、見本 `docs/mockup-v8.html`、Codex ルール `docs/handoff/codex-rules-v5.txt`。v4 は main に公開済み（be23199）。利用者の方針：一般的な作法（下タブ、左上の戻る等）はよい、全部を上に寄せるのはだめ。
- 以下は v3 時点の記述。
- **v3 を `main` に公開済み**（コミット `5d15552`）。計算テスト 55 件、画面テスト 23 件（`npm test` / `npm run e2e`）すべて通過。
- **実機（Android）では未確認**：目盛りの指ざわり・振動、画面が下にずれないか（直前に「少し下にスクロールして下が隠れる」と報告があり、画面を `position:fixed` に固定して対処済みだが実機で未確認）、ホーム画面に追加、バイブ、画面を消さない機能。
- **定期タスク（コーチ便）**：`trig_012GiBuApW9QRo1EdXAouNAZ` 毎日 07:22 JST（`CRON_TZ=Asia/Tokyo 22 7 * * *`）、完了通知 push あり。**まだ一度も動いていない**。初回は 2026-10-20 07:22 JST。確認すること：①投稿されるか（`posts.json` が更新されるか）②通知が「返信のときだけ」になるか、毎日来るなら通知をオフに。旧タスク（週次・水曜）は削除済み。
- 利用者の最新の関心：実機で使ってみた感想待ち。

## 3. 設計の要点（詳細は specs/）
優先順：`docs/superpowers/specs/2026-10-19-kintore-v3-design.md`（画面。最優先）→ `…-v2-design.md`（ライン、コーチ便）→ `…-design.md`（v1、データ形式）。
- **ライン**：各種目の**1セット目**の「同じ負荷の最近3回の中央値＋1回（time は＋5秒）」。超えたら「突破」、届かなければ「あと n」で次回に持ち越し。1セット目が 20回（time は 60秒）以上で負荷を上げる合図。目標範囲（min/max）と週の目標日数は**廃止**（残っていても無視）。
- **画面**：白い「紙」（`.see`、見るだけ）と藍の「板」（`.press`、押すものは必ずここ）。主な画面は「今日」と「成長」の2枚（左右スワイプ）。トレーニングは専用モード。回数入力は±ではなく**目盛り**（ドラッグ／左右タップ／←→キー）。色は藍 `#1C2B4B`・朱 `#D03C22`・白。見本：`docs/mockup-v6.html`。
- **コーチ便**：毎朝1回、最大1件（返信→日曜の週次→発見→月水金の読み物）。通知は返信を投稿した日だけ。催促・「久しぶり」・達成日の予測・連続記録・勝敗/ランクは**しない**（休んだ日を責めない）。手順書は `coach/README.md`（データ用リポジトリの `README.md` と同じ内容を置く）。
- 記録データ・同期・コーチ便の取得は v2 のまま。古いデータ（`min`/`max`/`weeklyGoal` 付き）も読める。

## 4. 利用者との約束（重要）
1. **設計・仕様・判断は Claude が決める。Codex に判断させない。** 実装は Codex に任せる（分業）。利用者に「あなたはどう思う？」と丸投げしない。提案して決める。
2. **見本どおりに実装されているかをきびしくチェックする。** ただし「やりすぎ」は不可：自分で CSS を書いたり、合格テストを先に書いたりしない（一度やって「分業の意味がない」と叱られ、巻き戻した）。チェックの水準＝各タスクの差分を読む／`npm test`＋`npm run e2e`／**全画面を撮影して見本と目で比べる**。見本と違えば差し戻す。
3. 見本が魅力的でも実装すると魅力が消えることがあった。Codex には**見本の CSS の数値をそのまま流用**させる。
4. ゲームの見た目を真似しない。仕組み（なぜハマるか）を一般化して筋トレに合わせる。
5. 休んだ日・下がった記録を責めない。下がった数字も隠さず中立色で表示。
6. **`main` への公開は必ず利用者に確認してから。** Pages が `main` から配信しているため、push 即公開。公開前に `npm test` と `npm run e2e` を両方通す。
7. 「画面全体がスクロールして下が隠れる」「押すものが上にある」を最も嫌う。
8. 返信は日本語で、結論を先に。ponytail モード（最小の変更・短い返答・最後に「未確認のこと／リスク」を1〜2行）が有効。

## 5. Codex の使い方（実装担当）
- `codex` CLI は入っている。**セッションが変わるとログインが切れている可能性**：`codex login status`。未ログインなら `codex login --device-auth` を実行し、出たコードと URL（https://auth.openai.com/codex/device）を利用者に渡して ChatGPT アカウントでログインしてもらう（バックグラウンドで実行し、ログファイルから URL とコードを読む）。環境の OpenAI API キーは枠なしで使えない（使わない）。
- 設定：`~/.codex/config.toml` に `model_reasoning_effort = "medium"`（初期値は none だった。**medium にすること**）。
- 実行はいつも **read-only で、全ファイルを出力させて Claude が書き込む**：
  `codex exec -s read-only -o OUT.txt "$(cat docs/handoff/codex-rules.txt)

  TASK: ..." < /dev/null > LOG 2>&1` を**バックグラウンド**で（`< /dev/null` 必須。付けないと入力待ちで固まる）。出力は `=== FILE: path ===` … `=== END FILE ===` 形式。`python3 docs/handoff/apply.py OUT.txt` でリポジトリ直下に書き込む（リポジトリのルートで実行）。
- `docs/handoff/codex-rules.txt` は v3 用のルール。新しい計画書を作るときはパスを差し替える。ルールの要点：タスク以外のことをしない／判断が要るなら止まって `QUESTION:` に**全部まとめて**書く／既存テストの期待値は変えない。
- 利用上限に当たることがある（過去に何度か）。当たったらエラーに復帰時刻が出る。待つか、ユーザーに伝える。
- 癖：①細かい表示の質問で止まりやすい（→ 計画書に決定を書き足して渡し直す。共通の決めごとは Global Constraints に）②**既存テストの期待値を勝手に書き換える**（`git diff logic.test.js` の `-` 行を必ず見る）③CSS を見本より少なく書く④e2e で「保存の完了を待たずに読む」タイミング不備を書く（`waitForFunction` で待つ）。
- 計画書の例：`docs/superpowers/plans/2026-10-19-kintore-v3.md`。

## 6. 開発・確認の手順
```
cd /home/user/kintorekiroku
npm install                     # 初回のみ（playwright を入れる）
npm test                        # logic.js の単体テスト（node --test）
npm run e2e                     # Chromium で画面テスト（/opt/pw-browsers/chromium）
npx http-server -p 8080 -c-1 -s .   # 手元確認用サーバー
node docs/handoff/shots-today.mjs <出力ディレクトリ>   # 今日・各シート・設定を撮影（サンプルデータ e2e/fixture.mjs）
node docs/handoff/shots-train.mjs <出力ディレクトリ>   # トレーニング一連を撮影
node docs/handoff/shots-growth.mjs <出力ディレクトリ>  # 成長・記録・新着を撮影
```
撮影スクリプトは playwright を `/home/user/kintorekiroku/node_modules/playwright` から読む前提。撮った画像は `Read` で見る（数枚を1枚の contact sheet にまとめて見ると速い）。
公開：`git push origin <作業ブランチ>:main`、その後 `curl https://dent052.github.io/kintorekiroku/style.css` に新しい内容が出るまで待つ（数分）。ブランチは `ccr-7676d6d6-1kyvh4`（`main` と同一に保つ）。コミット末尾に Co-Authored-By / Claude-Session の2行（システムの指示どおり）。stop フックが「未コミット／未 push があると止める」。

## 7. GitHub まわりの制約
- `gh` は使えない（トークン無効）。`mcp__github__*` は使えるが、**リポジトリ設定の変更・リポジトリ作成はできない**（プロキシが拒否）。リポジトリ作成・公開設定・Pages・トークン作成は利用者に画面で操作してもらった（済）。
- データ用リポジトリは `mcp__claude-code-remote__add_repo` で追加（access: push）し、`git clone` して使う。定期タスクのセッションも同様に add_repo から始める指示になっている。

## 8. 既知の未確認・課題・アイデア
- 実機未確認（§2）。利用者のスクリーンショットで見た目の不満が出たら、全画面を撮って見本と比べて Codex に差し戻す。
- コーチ便の初回実行（§2）。`topics.json` と `posts.json` は `[]` で初期化済み。
- 効果音は入れない（バイブのみ）。体の変化の写真記録は作らない（スマホのカメラアプリで）。
- トークン期限（1年）が切れたら GitHub 同期が失敗する。設定画面の「GitHub 保存」で再入力。
- ありがちな不具合の型：画面の固定（`position:fixed; inset:0`）と `touch-action`、板の中にだけ押せるものを置く（e2e の原則テストが検出）、保存完了前の読み取り（e2e）。
