# npm の脆弱性への対応

`npm audit` の結果と、残しているものの扱い。2026-10-04 時点。

## どこに入るか

lock は 12 本ある（ルート、`infra/`、`infra/lambda/*` の 9 本、`sommelier/agentcore/cdk/`）。
本番で動くのは次の 2 つだけで、それ以外は開発・ビルド・デプロイのときにしか動かない。

| 本番で動くもの | 中身 | 確かめ方 |
| --- | --- | --- |
| 画面のバンドル（ルート） | `aws-amplify`（auth / api）、React、`@base-ui/react`、`date-fns` ほか。脆弱性があったのは Amplify が引く `js-cookie` と `uuid` | `npx vite build --sourcemap` の source map に載っているパッケージを数える |
| Lambda のバンドル（`infra/lambda/*`） | 各関数のコードだけ。Node.js 22 の `NodejsFunction` は `@aws-sdk/*` をバンドルに入れず、ランタイム同梱の SDK を使う | `cdk synth` の `asset.*` を見る |

AgentCore のコンテナは Python（`sommelier/app/sommelier`、uv）で、npm の依存を持たない。
`sommelier/agentcore/cdk` は CDK アプリで、デプロイ時の合成にしか使わない。

## 2026-10-04 の対応

| 場所 | 前 | 後 | やったこと |
| --- | --- | --- | --- |
| ルート | 37 | 0 | `shadcn` を依存から外した（下記）。残りは `npm audit fix`。`vite` と `vitest` の下限を修正版に上げた |
| `infra/` | 17 | 8 | `aws-cdk-lib` 2.243 → 2.272、`aws-cdk` 2.1111 → 2.1144、`vitest` 4.1.0 → 4.1.11、`tsx` 4.21 → 4.23（esbuild 0.27 → 0.28） |
| `infra/lambda/presigned-url` | 3 | 0 | `npm audit fix`（`@aws-sdk/xml-builder` 経由の `fast-xml-parser`） |
| `infra/lambda/health-check`、`sommelier-canary` | 2 | 0 | `npm audit fix`（`@smithy/middleware-compression` 経由の `fflate`） |
| `sommelier/agentcore/cdk` | 38 | 1 | `jest` 29 → 30、`@types/jest` 29 → 30。残りは `npm audit fix` |

`aws-cdk-lib` を上げると合成結果のスキーマが 54 になり、2.1144 より古い CDK CLI では読めなくなる。
そのため CLI も一緒に上げた。テンプレートは CDK のメタデータ（`Analytics`）以外は変わらず、
Lambda のバンドルも esbuild 0.28 で中身が同一だった。

### shadcn を依存から外した理由

画面が `shadcn` パッケージから読んでいたのは `shadcn/tailwind.css`（カスタムバリアントとキーフレームだけの CSS）だけだった。
一方で CLI 本体は `fast-glob` → `micromatch` → `braces` を引いており、`braces` には修正版が出ていない。
CSS を `src/styles/shadcn-tailwind.css` に写してパッケージを外した。ビルド後の CSS はハッシュまで同一。
コンポーネントを足すときは `npx shadcn@latest add <名前>` を使う（依存に入れなくても動く）。
CLI が `src/index.css` に `@import "shadcn/tailwind.css";` を書き足したら、その行は消す。

### `npm audit fix` が npm 10 で落ちる

Node.js 22 同梱の npm 10.9 では、ルートと `infra/` の `npm audit fix` / `npm install <名前>` が
`Cannot read properties of null (reading 'edgesOut')` で止まる。`npx npm@11 audit fix` なら通る。
lock の形式（lockfileVersion 3）は同じで、CI の `npm ci`（npm 10）はそのまま入る。

## 残しているもの

本番のバンドルに入る依存に既知の脆弱性は無い。開発・デプロイ時だけの依存の残りは定期的に見直す。

## 取り直し方

```sh
for d in . infra sommelier/agentcore/cdk infra/lambda/*/; do
  echo "== $d"; (cd "$d" && npm audit | tail -1)
done
```
