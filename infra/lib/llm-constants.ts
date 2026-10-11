/**
 * Claude の呼び先に関する取り決め。
 *
 * CDK（環境変数と IAM の条件）と Lambda（lambda/shared/llm.ts）の両方から参照する。
 * 片方だけ変えると、STS に頼む JWT の宛先・寿命と、ロールに許した条件が食い違い、
 * Claude API に入れないまま毎回 Bedrock へ回ることになる（エラーにならないので気づきにくい）
 */

/**
 * STS の GetWebIdentityToken に頼む JWT の宛先。Claude Console のフェデレーションルールの
 * audience と同じ値にしてある
 */
export const IDENTITY_TOKEN_AUDIENCE = 'https://api.anthropic.com';

/**
 * JWT の寿命（秒）。交換に使うだけなので短くてよい。Anthropic のトークンの寿命は
 * 「ルールの寿命（600 秒）」と「JWT の残り × 2」の短い方になる
 */
export const IDENTITY_TOKEN_SECONDS = 300;

/**
 * Claude API で使うモデル。どれも Claude Haiku 5.5 から始め、品質を見て上げる。
 * 上げるときは環境変数（ANTHROPIC_MODEL_*）を変えるだけで済むよう、ここを既定値にしている
 */
export const DEFAULT_ANTHROPIC_MODEL_OCR = 'claude-haiku-5-5';
export const DEFAULT_ANTHROPIC_MODEL_NOTE = 'claude-haiku-5-5';
