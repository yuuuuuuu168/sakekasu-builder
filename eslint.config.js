import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // ビルド成果物は検査しない。ルート直下だけでなく、infra や sommelier の
  // 配下にも dist があるため、どの階層でも除く
  globalIgnores(['**/dist', '**/cdk.out']),
  // AI-DLC（awslabs/aidlc-workflows）の同梱物。上流が生成して配る成果物で、
  // こちらで手を入れる対象ではない。除かないと `eslint .` がフックと CLI
  // ツールの TypeScript まで検査して、既存ルールと衝突して CI が落ちる
  globalIgnores(['.claude/**', 'aidlc/**']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      // 使わないことを `_` で明示した引数は許す。コールバックの形を合わせる
      // ために受け取るだけの引数（toBlob の type / quality など）がある
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
        },
      ],
    },
  },
])
