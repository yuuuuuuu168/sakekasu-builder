"""テスト用の環境変数を、main.py の読み込みより先に用意する。

main.py は設定ミスを起動段階で落とす（フェイルクローズ）ため、
テーブル名と Cognito の設定が無いと import すらできない。
値は形式が通れば何でもよく、テスト中に AWS へは一切アクセスしない。

LOCAL_DEV は設定しない。main.py は LOCAL_DEV と COGNITO_* の同時設定を
拒否するので、本番と同じ「Cognito 設定あり」の側で読み込む。
"""

import os

os.environ.setdefault("AWS_REGION", "ap-northeast-1")
os.environ.setdefault("PURCHASE_TABLE_NAME", "test-purchase-records")
os.environ.setdefault("DRINKING_TABLE_NAME", "test-drinking-records")
os.environ.setdefault("COGNITO_USER_POOL_ID", "ap-northeast-1_testpool")
os.environ.setdefault("COGNITO_APP_CLIENT_ID", "testappclientid")
# 好み記憶は各テストで明示的に組み立てる。読み込み時に AWS クライアントを
# 作らせないよう、既定では未設定にしておく
os.environ.pop("MEMORY_PREFERENCE_ID", None)
