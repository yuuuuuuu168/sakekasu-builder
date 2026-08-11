/**
 * 画像の保存場所に関する取り決め。
 *
 * CDK（ライフサイクルルール）と presigned-url Lambda（キー組み立て・タグ付与）の
 * 両方から参照する。片方だけ変えるとタグが噛み合わず、一時オブジェクトが
 * 消えないか、逆に正式な画像が消える
 */

/**
 * OCR の事前アップロード先に使うキーの区画。
 *
 * キーは `{sub}/{recordType}/{recordId}/{fileName}` の形式で、記録に紐づく前の
 * 画像は recordType の位置にこの値を入れて `{sub}/tmp/{uploadId}/{fileName}` に置く。
 * 所有者チェックは先頭の `{sub}/` を見るため、この形なら検証を変えずに済む
 */
export const TEMP_LOCATION = 'tmp';

/**
 * 一時オブジェクトに付けるタグ。
 *
 * S3 のライフサイクルルールはプレフィックスの前方一致かタグでしか対象を絞れない。
 * `{sub}` が利用者ごとに変わる本アプリでは、途中に tmp を含むキーを
 * ワイルドカードで指定できないため、タグで削除対象を識別する
 */
export const TEMP_TAG_KEY = 'lifecycle';
export const TEMP_TAG_VALUE = 'temporary';

/**
 * PutObject に渡すタグ表現（`key=value` の形）。
 *
 * 署名済み URL では、SDK がこの値を**クエリパラメータ**（`x-amz-tagging`）に
 * 埋め込む。署名対象ヘッダには入らないため、クライアントが同名の HTTP ヘッダを
 * 添えると二重指定になり、S3 が 403 SignatureDoesNotMatch を返す。
 *
 * ここに「`x-amz-tagging` ヘッダと同じ形式」と書いてあったことが、
 * ヘッダで送る実装を生んで本番の画像アップロードを止めた（PR #147）。
 * 形式の説明にヘッダを持ち出さない
 */
export const TEMP_OBJECT_TAGGING = `${TEMP_TAG_KEY}=${TEMP_TAG_VALUE}`;
