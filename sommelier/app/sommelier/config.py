"""環境変数から読む設定と、起動時の検証。

設定ミスは起動段階で落とす（フェイルクローズ）。認証（auth.py）と
記録の読み出し（records.py）の両方がここの値を使うので、どちらを先に
読み込んでも、値を使う前に検証が済んでいるようにここへまとめている。
"""

import os

PURCHASE_TABLE_NAME = os.getenv("PURCHASE_TABLE_NAME", "")
DRINKING_TABLE_NAME = os.getenv("DRINKING_TABLE_NAME", "")
AWS_REGION = os.getenv("AWS_REGION", "ap-northeast-1")
# 生の値は「設定しようとしたか」の判定に、整えた値は実際の利用に使う。
# 空白だけの値を素通しすると、issuer URL が壊れたまま起動して
# 全リクエストが認証に失敗する（起動は成功するので気づきにくい）
COGNITO_USER_POOL_ID_RAW = os.getenv("COGNITO_USER_POOL_ID", "")
COGNITO_USER_POOL_ID = COGNITO_USER_POOL_ID_RAW.strip()
COGNITO_APP_CLIENT_ID = os.getenv("COGNITO_APP_CLIENT_ID", "")
# 許可するアプリクライアントはカンマ区切りで複数指定できる。
# ブラウザ用に加えて、外形監視のカナリア用クライアントを通すために使う
COGNITO_APP_CLIENT_IDS = frozenset(
    value.strip() for value in COGNITO_APP_CLIENT_ID.split(",") if value.strip()
)
IS_LOCAL_DEV = os.getenv("LOCAL_DEV") == "1"

# 起動時検証（設定ミスは起動段階で落とすフェイルクローズ）
if not PURCHASE_TABLE_NAME:
    raise RuntimeError("PURCHASE_TABLE_NAME が未設定です（デフォルト値はありません）")
if not DRINKING_TABLE_NAME:
    raise RuntimeError("DRINKING_TABLE_NAME が未設定です（デフォルト値はありません）")
# ここは意図的に「パース後の集合」ではなく生の文字列で判定する。
# LOCAL_DEV は認証を素通りして固定の sub を返すため、Cognito を設定しようとした
# 痕跡が少しでもあれば起動を止める（空白のみ・カンマのみでも設定の意思とみなす）。
# 集合で判定すると、そうした値が「未設定」と解釈されて LOCAL_DEV のまま起動してしまう
if IS_LOCAL_DEV and (COGNITO_USER_POOL_ID_RAW or COGNITO_APP_CLIENT_ID):
    raise RuntimeError(
        "LOCAL_DEV=1 と COGNITO_USER_POOL_ID / COGNITO_APP_CLIENT_ID は同時に設定できません"
        "（空白のみ・カンマのみの値も設定済みとみなします）。"
        "デプロイ環境（envVars で Cognito 設定注入）への LOCAL_DEV 混入を防ぐための相互排他です"
    )
# こちらは逆に「実際に使える値があるか」を見るため、整えた値で判定する。
# 上のガードが生の値を見るのと非対称だが、これは意図したもの。
# 上＝設定の意思があれば止める / ここ＝使える値が無ければ止める、で
# どちらも安全側に倒している。片方に揃えるとどちらかの穴が開く
if not IS_LOCAL_DEV and (not COGNITO_USER_POOL_ID or not COGNITO_APP_CLIENT_IDS):
    raise RuntimeError(
        "COGNITO_USER_POOL_ID / COGNITO_APP_CLIENT_ID が未設定、または空白のみなど"
        "使用できない値です（LOCAL_DEV=1 以外では必須）"
    )
# 相談の回数の上限（quota.py）。テーブル名が無いと上限が黙って効かなくなるので、
# 手元での確認（LOCAL_DEV=1）以外では起動を止める
if not IS_LOCAL_DEV and not os.getenv("CHAT_QUOTA_TABLE_NAME", "").strip():
    raise RuntimeError("CHAT_QUOTA_TABLE_NAME が未設定です（LOCAL_DEV=1 以外では必須）")
