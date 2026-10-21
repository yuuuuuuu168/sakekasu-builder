"""相談に添付された画像（酒屋の棚・メニューの写真など）の検証。"""

import base64

# 1回の相談に添付できる画像の上限枚数
MAX_IMAGES = 3
# 添付画像1枚あたりのバイナリ上限（フロントの圧縮上限 5MB と揃える）
MAX_IMAGE_BYTES = 5 * 1024 * 1024
# base64 文字列としての上限。デコード前に判定して、巨大入力の
# デコードコスト自体を避ける（パディング分の +4 は余裕）
MAX_IMAGE_BASE64_LENGTH = ((MAX_IMAGE_BYTES + 2) // 3) * 4 + 4
# 添付画像全体でのバイナリ合計上限。1枚あたりの上限だけだと
# 枚数分（3×5MB=15MB）まで積み上がるため、合計にも別途キャップを課して
# 1リクエストが確保できるメモリを抑える（通常の写真は圧縮済みで1枚 1〜2MB 程度）
MAX_TOTAL_IMAGE_BYTES = 10 * 1024 * 1024
# 合計の base64 文字数上限。デコード前に累計で判定し、
# 合計超過が確定した後のデコードコストを発生させない
MAX_TOTAL_IMAGE_BASE64_LENGTH = ((MAX_TOTAL_IMAGE_BYTES + 2) // 3) * 4 + 4 * MAX_IMAGES


# 受け付ける画像形式と、その先頭バイト列。
# 宣言された形式（format）と実体（デコード後のバイト列）の一致を検証し、
# 画像以外のバイナリをモデルに渡さない
_IMAGE_MAGIC_BYTES = {
    "jpeg": b"\xff\xd8\xff",
    "png": b"\x89PNG\r\n\x1a\n",
}

# 写真だけで文面がない相談に補う既定の相談内容（固定値であり
# ユーザー入力ではないため、無害化は不要）
_DEFAULT_IMAGE_PROMPT = (
    "この写真に写っているお酒の中から、私の好みに合いそうなおすすめを教えてください。"
)


def _build_image_blocks(raw) -> tuple:
    """payload の images を Bedrock Converse の image ブロック列へ検証・変換する。

    戻り値は (ブロックのリスト, エラーメッセージ)。1枚でも不正があれば
    全体を拒否する（フェイルクローズ）。base64 のデコードコストが増幅
    しないよう、枚数→文字数（単体・累計）→デコード→実体の順に
    安い検査から行う。エラーメッセージに入力値は反射しない。

    画像の中に写り込んだ文字（ポップ・値札など）はプログラムでは
    無害化できない（ピクセルの内容検査は現実的でない）。この経路の
    プロンプトインジェクション対策は SYSTEM_PROMPT の指示に加えて、
    ツールが読み取り専用かつ owner_sub 限定であること・応答が本人にしか
    返らないことで影響範囲を本人のセッション内に閉じる設計で担保する
    （残存リスクとして受容。PR #97 のレビュー対応を参照）。
    """
    if raw is None:
        return [], None
    if not isinstance(raw, list):
        return [], "画像データの形式が不正です。"
    if len(raw) > MAX_IMAGES:
        return [], f"画像は{MAX_IMAGES}枚まで添付できます。"

    blocks = []
    total_base64 = 0
    total_decoded = 0
    for item in raw:
        if not isinstance(item, dict):
            return [], "画像データの形式が不正です。"
        fmt = item.get("format")
        data = item.get("data")
        if fmt not in _IMAGE_MAGIC_BYTES or not isinstance(data, str):
            return [], "対応していない画像形式です（JPEG / PNG のみ）。"
        if len(data) > MAX_IMAGE_BASE64_LENGTH:
            return [], f"画像が大きすぎます。{MAX_IMAGE_BYTES // (1024 * 1024)}MB 以下でお願いします。"
        # 合計はデコード前（文字数）の時点で判定し、超過が確定した入力に
        # デコードコストを払わない
        total_base64 += len(data)
        if total_base64 > MAX_TOTAL_IMAGE_BASE64_LENGTH:
            return [], (
                f"添付画像の合計サイズが大きすぎます。"
                f"合計 {MAX_TOTAL_IMAGE_BYTES // (1024 * 1024)}MB 以下でお願いします。"
            )
        try:
            decoded = base64.b64decode(data, validate=True)
        except (ValueError, TypeError):
            return [], "画像データを読み取れませんでした。"
        if not decoded:
            return [], "画像データを読み取れませんでした。"
        if len(decoded) > MAX_IMAGE_BYTES:
            return [], f"画像が大きすぎます。{MAX_IMAGE_BYTES // (1024 * 1024)}MB 以下でお願いします。"
        total_decoded += len(decoded)
        if total_decoded > MAX_TOTAL_IMAGE_BYTES:
            return [], (
                f"添付画像の合計サイズが大きすぎます。"
                f"合計 {MAX_TOTAL_IMAGE_BYTES // (1024 * 1024)}MB 以下でお願いします。"
            )
        if not decoded.startswith(_IMAGE_MAGIC_BYTES[fmt]):
            return [], "画像データと形式が一致しません。"
        blocks.append({"image": {"format": fmt, "source": {"bytes": decoded}}})
    return blocks, None
