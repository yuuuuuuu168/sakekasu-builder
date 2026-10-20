# OCR のモデル比較

保存済みの記録の画像を、本番の OCR と同じ頼み方（tool と指示文）で複数の Claude のモデルに読ませ、
正解率・応答時間・トークン数・費用を比べる。どのモデルで OCR を動かすかを決める材料にする。

| | |
| --- | --- |
| 関数 | `sakekasu-builder-dev-ocr-benchmark`（[infra/lambda/ocr-benchmark](../infra/lambda/ocr-benchmark)） |
| ロール | `sakekasu-dev-llm-ocr-benchmark`。Claude API の ID 連携のルール（`sakekasu-dev-llm-`）に入る |
| 起動 | GitHub Actions の `ocr-benchmark`（手動）、またはコンソール・CLI からの invoke |
| 結果 | CloudWatch Logs `/aws/lambda/sakekasu-builder-dev-ocr-benchmark` |

## 何を比べるか

- **正解**: 記録に保存された値（銘柄名・カテゴリ・産地・度数と、裏ラベルの詳細スペック 9 項目）。
  記録で空の項目は採点しない
- **読み取り結果**: モデルの tool の入力を本番と同じ `extractLabelInfo` に通したもの。
  tool_use が欠けたら、正解のある項目はすべて外れとして数える
- **一致の決め方**（[scoring.ts](../infra/lambda/ocr-benchmark/scoring.ts)）
  - 文字列は全角・半角、大文字・小文字、空白、中黒、会社の種類（株式会社など）を均してから比べる
  - 銘柄名・カテゴリ・特定名称は完全一致。銘柄名は別に、文字の 2-gram の近さ（0〜1）も出す
  - 産地・蔵元・酒米・酵母は、片方がもう片方を含めば一致（「山口県」と「山口」）
  - 数値は 0.05 までの差を一致とみなす
- **費用**: 返ってきたトークン数に定価を掛けた見積もり。単価表に無いモデルは費用を出さない（トークン数は残る）

## 本番の OCR との違い

- Bedrock へのやり直しをしない。比べたいのは指定したモデルなので、失敗は失敗として数える。
  流量の上限・過負荷は SDK の再試行（2 回）で待つ
- 出力の上限を 16,000 トークンに広げている。本番の 3,072 は Haiku の low に合わせた値で、
  Opus・Fable や高い effort では思考で使い切って tool_use が欠ける
- 呼び出し 1 回の待ち時間は 180 秒（本番は 14 秒）

## 起動のしかた

GitHub の Actions → `ocr-benchmark` → Run workflow（main で）。

| 入力 | 既定 | |
| --- | --- | --- |
| models | 4 モデル（Haiku 5.5 / Sonnet 5.5 / Opus 5.5 / Fable 5.1） | カンマ区切り。`claude-` で始まる ID |
| efforts | `low`（本番と同じ） | `low,high` のように並べると組み合わせをすべて回す |
| limit | 30 | 使う記録の数（新しい順） |
| offset | 0 | 新しい順に飛ばす数。2 回目に別の記録で回すときに使う |

ワークフローは Lambda を非同期で起動して終わる。Lambda は同時に 1 つしか動かない（予約同時実行 1）ので、
続けて起動すると 2 つ目は 1 つ目が終わってから走る。失敗しても自動ではやり直さない
（やり直すとクレジットを二重に使う）。

1 回は 15 分まで。残りが 200 秒を切ったら新しい呼び出しを始めず、そこまでの結果で集計する。
途中で切れても、記録ごとに全モデルを並べて投げているので、どのモデルも同じ記録で比べられる。

### 費用の目安（low、記録 1 件あたり）

| モデル | 目安 |
| --- | --- |
| Haiku 5.5 | $0.0005 前後 |
| Sonnet 5.5 | $0.02 前後 |
| Opus 5.5 | $0.05 前後 |
| Fable 5.1 | $0.15〜0.2 |

既定の 4 モデル × 30 件で $7〜8 ほど。effort を上げると思考のぶん出力が増える。

## 結果の読み方

ログに 1 行の JSON で出る。ラベルの文面・銘柄名・画像のキーは出さない（本番の OCR と同じ方針）。

| 行 | 中身 |
| --- | --- |
| `[bench] start` | 入力と、Models API で見えたモデルの一覧（新しいモデルが出ていないかの確認用） |
| `[bench] plan` | 候補の記録の数、使う記録の数、呼び出しの数 |
| `[bench] call` | 1 回の呼び出し。モデル・effort・記録の番号・時間・トークン・費用・項目ごとの正誤 |
| `[bench] summary` | モデルと effort の組ごとの集計。項目ごとの正解率、全体の正解率、時間（平均・p50・p90・最大）、費用 |
| `[bench] done` | 呼び出しの数、飛ばした数、費用の合計 |

```
fields @timestamp, @message
| filter @message like /\[bench\] summary/
| sort @timestamp desc
```
