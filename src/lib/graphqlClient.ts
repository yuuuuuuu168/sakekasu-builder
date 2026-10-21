import { generateClient } from 'aws-amplify/api';

/**
 * AppSync へ GraphQL を投げるクライアント。アプリ全体でこの1つを使う。
 *
 * 接続先と認証は Amplify.configure（App.tsx）の設定を呼び出しのたびに読むので、
 * 設定より先にモジュールが読み込まれて作られても困らない。
 *
 * テストは `aws-amplify/api` の generateClient を差し替えて graphql を模している。
 * ここもその generateClient を呼ぶので、各テストの模し方はそのまま効く
 */
export const client = generateClient();
