@.claude/rules/aidlc.md

<!--
  先頭の @ 行が AI-DLC のメソッドを Claude の文脈に読み込む。参照の連鎖の
  1 ホップ目で、コピーではない:
    .claude/CLAUDE.md → @.claude/rules/aidlc.md → @../../aidlc/spaces/default/memory/*.md
  メソッドの本体は aidlc/spaces/default/memory/ に 1 か所だけある。直すならそちら。
  .claude/rules/aidlc.md は上流の生成物なので手を入れない。

  このファイルは上流（awslabs/aidlc-workflows v2）が配る 19KB のテンプレートを
  差し替えたもの。テンプレートは Bedrock 前提と全 Bash 事前承認を前提に書かれて
  いて、下記のとおりこのリポジトリでは両方とも採っていない。そのまま置くと
  毎セッションの文脈に事実と違う説明が載るため、必要な部分だけ残した。
-->

# AI-DLC（このリポジトリでの使い方）

このリポジトリのプロジェクトルールは、ルート直下の [CLAUDE.md](../CLAUDE.md) にある。
このファイルは AI-DLC の入口だけを担う。

`/aidlc <やりたいこと>` で起動する。仕事の重さでプロファイルを選ぶ。

| コマンド | 使いどころ |
| --- | --- |
| `/aidlc express` | 要件が固まっている小さめの追加 |
| `/aidlc feature` | 本番向けの機能をフルの手順で |
| `/aidlc bugfix` | 原因がわかっている不具合 |
| `/aidlc infra` | infra/ の CDK 変更 |
| `/aidlc security-patch` | 脆弱性対応 |

`/aidlc --doctor` で設定の健全性を確認、`/aidlc --status` で進行中のワークフローを確認する。
成果物は `aidlc/spaces/<space>/intents/<YYMMDD>-<label>/` に貯まる。

## 上流の既定から変えた点

配布物の `.claude/settings.json` をそのまま入れると既存のフックが消えるため、
マージした上で 2 か所を落としている。

Bedrock 前提を外した。上流は `CLAUDE_CODE_USE_BEDROCK=1` と Bedrock の推論プロファイル ID、
`model: opus[1m]` を固定して配る。このリポジトリのクラウドセッションはサブスク認証で動いていて、
AWS 側の `verify` プロファイルは読み取り専用の Permission Set なので `bedrock:InvokeModel` を持たない。
どちらの理由でも Bedrock 経路は通らない。

`permissions.allow` の裸の `Bash` を採らなかった。上流はワークフロー中の許可プロンプトを
無くすために全 Bash を事前承認するが、リポジトリ共有の設定でそれをやると、AI-DLC を
使わないセッションまで巻き込む。`Bash(bun "$CLAUDE_PROJECT_DIR/.claude/tools/"*)` だけ通してある。
ステージ実行中に許可を訊かれる回数が上流より増えるが、`deny-aws-writes.sh` は PreToolUse
フックなので、事前承認の有無にかかわらず AWS の更新操作は止まる。

## 同梱物は lint / 型検査の対象外

`.claude/**` と `aidlc/**` は `eslint.config.js` の `globalIgnores` で除いてある。
上流が生成して配る成果物で、こちらのルールに合わせる対象ではない。除かないと
`eslint .` がフックと CLI ツールまで検査して CI が落ちる。

## 前提

bun が要る。全 CLI ツールと 17 個のフックが bun で動く。クラウドVMのイメージには
入っていて、`~/.bashrc` に PATH も通っている。無い世代を引いたときは
`scripts/cloud-setup.sh` が npm から入れる（`bun.sh` はこの環境の egress で塞がれている）。

## 上流のドキュメント

- [awslabs/aidlc-workflows v2](https://github.com/awslabs/aidlc-workflows/tree/v2)
- [ユーザーガイド](https://github.com/awslabs/aidlc-workflows/blob/v2/docs/guide/00-introduction.md)
- [ワークフロープロファイル一覧](https://github.com/awslabs/aidlc-workflows/blob/v2/docs/guide/workflow-profiles.md)
