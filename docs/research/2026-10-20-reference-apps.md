# 上位アプリの画面と操作の調査（Hevy・Strong）

調査: 2026-10-20、Claude。公式の機能ページとヘルプを読んだ（アプリは触っていない）。取り入れるのは**仕組み**だけで、見た目・ロゴは写さない。
Strong のタブの構成は公式資料で確認できなかった（未確認）。

## 1. 比べた結果

| 場面 | Hevy | Strong | うち（v6／v7 予定） | 取り入れるか |
|---|---|---|---|---|
| 始め方 | 下の Workout タブ → ルーティンの「Start Routine」か「＋ Start Empty Workout」 | テンプレートから開始 | ホームの「始める」（今日のメニュー） | 今のままでよい |
| 記録画面の形 | **1画面に全種目のカード**を縦に並べ、各カードの下にセットの行。下に「＋ Add Exercise」 | 同様（セットの行にチェック） | 1種目ずつ全画面、前／次で移動 | **検討**：1画面に全種目を並べる形は、好きな種目へ飛べない・終了が奥にある問題（レビュー 42・44）を一度に解く。ただしカウンタを大きく使えなくなる |
| セットの行 | 番号・**PREVIOUS（前回、例 45kg×9）**・負荷・回数・完了チェック | 重さ・回数を入れてチェック | 番号・前回・今日・チェック（v6） | 同じ形になっている |
| 前回の値 | 前回の値を**押すと今日の欄に写せる**。どの前回か（同じルーティンだけ等）を設定で選べる | 前回のセットを覚えている | 前回の値から始まる（v7） | 「押すと写す」は不要（もう入っている） |
| セットの足し方・消し方 | 各種目の下の「＋ Add Set」、**左へスワイプで削除** | — | 「＋ もう1セット」、行を押して直す・消す | 今のままでよい（スワイプは種目移動とぶつかる） |
| セットの種類 | 番号を押して 通常・ウォームアップ・ドロップ・**限界** | ウォームアップ・ドロップ・限界の区分 | なし | **後回し**（レビュー 12・25 と同じ。限界まで行うので「限界」の印は役に立つかも） |
| 休憩タイマー | セット完了で自動開始。**種目ごとに時間を設定**、±15秒、飛ばす、オフも可 | 完了で自動開始、**画面の左上に小さく**、押すと全画面で時間変更・Skip。種目ごと・ウォームアップ別に時間 | 完了で自動、共通の時間、+15秒・休憩を終える、帯で小さく（v6） | **種目ごとの時間**と「−15秒」を足す価値あり |
| ロック画面 | Live Activity（今の種目・次のセット・残り時間） | — | なし（ブラウザでは難しい） | できない |
| 終了 | **右上の Finish**（全部やらなくても終われる）→ まとめ（量・セット数・メモ） | 右上の Finish、全部やらなくても終われる | 最後の種目の「終了」かメモの奥 | **取り入れる**：どこからでも「終了」 |
| 自己ベスト | セット中に**その場で PR 通知**（最大重量・最多回数・最長時間）、まとめにも | 記録タブに全期間のベスト、回数ごとのベスト | まとめに「自己ベスト」（v7） | **取り入れる**：完了した瞬間に「自己ベスト」を出す（記録を歪めない中毒性） |
| 種目の画面 | グラフ（最大重量・回数合計など切替）＋下に記録、**History で全回の日付とセット** | History／Charts／Records の3つ | グラフ＋日ごとのセット（v7） | 近い。グラフの指標の切り替えは後回し |
| 過去の記録 | プロフィールに保存済みの一覧 | **History タブ**で一覧 → 押して「Edit Workout」で直す。過去の日は開始時刻を変えて記録 | 「日ごと」の一覧と「＋ 過去の日を記録」（v7） | 同じ考え方 |
| 続ける気持ち | 週の連続（streak）、何回目のワークアウトか、月のレポート | — | 今週の7マス、通算日数 | 連続日数は約束で「しない」。「何回目」は事実なので可 |

## 2. ここから決めたこと（Claude の判断）
1. **どこからでも「終了」**：トレーニング画面の上の右端（Hevy・Strong と同じ位置）に `終了`。押すと、残りがあれば「記録済みを保存して終える／続ける」。下の段の「メモ」から終了・種目追加を出す
2. **完了した瞬間の自己ベスト**：同じ負荷で今までの最多回数（秒）を超えたら、結果の帯に `自己ベスト`。実際の記録だけで判定するので歪めない
3. **休憩を種目ごとに**：種目の編集に休憩秒数（空なら共通の設定）、休憩の帯に `−15秒`
4. **1画面に全種目を並べる形は見送り**：大きなカウンタで疲れていても押せる今の形を保つ。代わりに上の進み具合を押すと種目の一覧から飛べるようにする
5. セットの種類（限界など）は後回し

## 出典
- [Hevy – Track Workouts](https://www.hevyapp.com/features/track-workouts/)
- [Hevy – Previous Workout Values](https://www.hevyapp.com/features/track-exercises/)
- [Hevy – Workout Rest Timer](https://www.hevyapp.com/features/workout-rest-timer/)
- [Hevy – Exercise Performance](https://www.hevyapp.com/features/exercise-performance/)
- [Hevy – Start Empty Workout](https://www.hevyapp.com/features/start-empty-workout/)
- [Hevy Help – How to Log a Workout](https://help.hevyapp.com/hc/en-us/articles/35361530647959-How-to-Log-a-Workout-in-the-Hevy-App-Step-by-Step-Guide)
- [Hevy – Live Activity](https://www.hevyapp.com/features/live-activity/)
- [Strong Help – My first workout](https://help.strongapp.io/article/229-my-first-workout)
- [Strong Help – Rest Timer](https://help.strongapp.io/article/231-rest-timer)
- [Strong Help – Exercise Detail](https://help.strongapp.io/article/237-about-exercise-detail)
- [Strong Help – Records screen](https://help.strongapp.io/article/216-exercise-records-screen)
- [Strong Help – Edit a past workout](https://help.strongapp.io/article/249-how-do-i-edit-a-past-workout)
- [Strong Help – Log a past workout](https://help.strongapp.io/article/167-adjust-workout-date)
- [Strong Help – Set tags](https://help.strongapp.io/article/166-set-tags)
