"""添付画像の検証（_build_image_blocks）のテスト。

画像は base64 のままモデルへ渡るので、ここを抜けたバイト列はそのまま
Bedrock / Claude API に届く。守りたいのは次の 3 つ。
- 1 枚でも不正があれば全体を拒否する（フェイルクローズ）
- 枚数→文字数→デコード→実体の順に、安い検査で先に弾く（デコードコストの増幅を防ぐ）
- 宣言された形式と実体の先頭バイトが一致しないものは通さない
"""

import base64

import pytest

import main
from main import (
    MAX_IMAGE_BASE64_LENGTH,
    MAX_IMAGE_BYTES,
    MAX_IMAGES,
    MAX_TOTAL_IMAGE_BYTES,
    _build_image_blocks,
)

JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 16
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 16


def image(raw: bytes, fmt: str = "jpeg") -> dict:
    return {"format": fmt, "data": base64.b64encode(raw).decode()}


class Test正しい画像:
    def test_画像が無ければ空で通す(self):
        assert _build_image_blocks(None) == ([], None)

    def test_JPEGとPNGをimageブロックに変換する(self):
        blocks, err = _build_image_blocks([image(JPEG, "jpeg"), image(PNG, "png")])

        assert err is None
        assert blocks == [
            {"image": {"format": "jpeg", "source": {"bytes": JPEG}}},
            {"image": {"format": "png", "source": {"bytes": PNG}}},
        ]

    def test_上限枚数ちょうどまでは受け付ける(self):
        blocks, err = _build_image_blocks([image(JPEG)] * MAX_IMAGES)

        assert err is None
        assert len(blocks) == MAX_IMAGES


class Test形の不正:
    @pytest.mark.parametrize(
        "raw",
        [
            pytest.param({"format": "jpeg", "data": ""}, id="リストでない"),
            pytest.param("jpeg", id="文字列"),
        ],
    )
    def test_リストでなければ拒否する(self, raw):
        assert _build_image_blocks(raw) == ([], "画像データの形式が不正です。")

    def test_要素が辞書でなければ拒否する(self):
        assert _build_image_blocks([image(JPEG), "not-a-dict"]) == (
            [],
            "画像データの形式が不正です。",
        )

    def test_枚数が上限を超えたら拒否する(self):
        blocks, err = _build_image_blocks([image(JPEG)] * (MAX_IMAGES + 1))

        assert blocks == []
        assert err == f"画像は{MAX_IMAGES}枚まで添付できます。"

    @pytest.mark.parametrize(
        "item",
        [
            pytest.param({"format": "gif", "data": base64.b64encode(b"GIF89a").decode()}, id="GIF"),
            pytest.param({"format": "JPEG", "data": base64.b64encode(JPEG).decode()}, id="大文字の形式名"),
            pytest.param({"data": base64.b64encode(JPEG).decode()}, id="形式なし"),
            pytest.param({"format": "jpeg", "data": JPEG}, id="dataがbytes"),
            pytest.param({"format": "jpeg"}, id="dataなし"),
        ],
    )
    def test_対応外の形式は拒否する(self, item):
        assert _build_image_blocks([item]) == ([], "対応していない画像形式です（JPEG / PNG のみ）。")

    def test_1枚でも不正なら全体を拒否する(self):
        # 正しい画像を先に並べても、後ろの1枚で全体が落ちる（部分的に通さない）
        blocks, err = _build_image_blocks([image(JPEG), image(PNG), {"format": "gif", "data": ""}])

        assert blocks == []
        assert err is not None

    def test_エラー文に入力値を反射しない(self):
        # 無害化を通らない文字列がそのまま利用者の画面に戻らないようにする
        _, err = _build_image_blocks([{"format": "<script>alert(1)</script>", "data": "x"}])

        assert "<script>" not in err


class Test中身の不正:
    @pytest.mark.parametrize(
        "data",
        [
            pytest.param("", id="空"),
            pytest.param("!!!!", id="base64でない文字"),
            pytest.param("/9j/4A", id="パディング不足"),
            pytest.param(base64.b64encode(JPEG).decode() + "\n", id="改行混じり"),
        ],
    )
    def test_読めないbase64は拒否する(self, data):
        # validate=True なので、b64decode が黙って読み飛ばす文字も通さない
        assert _build_image_blocks([{"format": "jpeg", "data": data}]) == (
            [],
            "画像データを読み取れませんでした。",
        )

    @pytest.mark.parametrize(
        "raw, fmt",
        [
            pytest.param(PNG, "jpeg", id="中身がPNGなのにjpeg"),
            pytest.param(JPEG, "png", id="中身がJPEGなのにpng"),
            pytest.param(b"%PDF-1.7 not an image", "jpeg", id="画像でないバイナリ"),
        ],
    )
    def test_宣言と実体が一致しなければ拒否する(self, raw, fmt):
        assert _build_image_blocks([image(raw, fmt)]) == ([], "画像データと形式が一致しません。")


class Test大きさの上限:
    too_large = f"画像が大きすぎます。{MAX_IMAGE_BYTES // (1024 * 1024)}MB 以下でお願いします。"
    total_too_large = (
        f"添付画像の合計サイズが大きすぎます。"
        f"合計 {MAX_TOTAL_IMAGE_BYTES // (1024 * 1024)}MB 以下でお願いします。"
    )

    def test_base64の文字数が上限を超えたらデコードせずに拒否する(self, monkeypatch):
        decoded = []
        monkeypatch.setattr(base64, "b64decode", lambda *a, **k: decoded.append(a) or b"")

        data = "A" * (MAX_IMAGE_BASE64_LENGTH + 1)

        assert _build_image_blocks([{"format": "jpeg", "data": data}]) == ([], self.too_large)
        assert decoded == []

    def test_文字数の余裕を使ってもデコード後の上限で止める(self):
        # 文字数の上限はパディング分の余裕を持たせてあるので、上限ちょうどの
        # 文字数だと MAX_IMAGE_BYTES を数バイト超える。デコード後の判定がその穴を塞ぐ
        groups = MAX_IMAGE_BASE64_LENGTH // 4
        raw = JPEG + b"\x00" * (groups * 3 - len(JPEG))
        data = base64.b64encode(raw).decode()
        assert len(data) == MAX_IMAGE_BASE64_LENGTH
        assert len(raw) > MAX_IMAGE_BYTES

        assert _build_image_blocks([{"format": "jpeg", "data": data}]) == ([], self.too_large)

    def test_合計の文字数が上限を超えたら残りはデコードしない(self, monkeypatch):
        # 1枚ずつは上限内でも、3枚積むと合計の上限を超える大きさ
        raw = JPEG + b"\x00" * (MAX_IMAGE_BYTES - 512 * 1024)
        items = [image(raw)] * MAX_IMAGES

        real_decode = base64.b64decode
        decoded = []

        def spy(data, *args, **kwargs):
            decoded.append(len(data))
            return real_decode(data, *args, **kwargs)

        monkeypatch.setattr(base64, "b64decode", spy)

        assert _build_image_blocks(items) == ([], self.total_too_large)
        # 合計超過が分かった 3 枚目はデコードしない
        assert len(decoded) == MAX_IMAGES - 1

    def test_デコード後の合計が上限を超えたら拒否する(self):
        # 文字数の合計は上限内に収まるが、デコード後の合計が上限を数バイト超える組み合わせ
        # （上限ちょうどの 2 枚に、ごく小さい 1 枚を足す）
        big = JPEG + b"\x00" * (MAX_IMAGE_BYTES - len(JPEG))
        items = [image(big), image(big), image(b"\xff\xd8\xff")]
        assert sum(len(i["data"]) for i in items) <= main.MAX_TOTAL_IMAGE_BASE64_LENGTH
        assert len(big) * 2 + 3 > MAX_TOTAL_IMAGE_BYTES

        assert _build_image_blocks(items) == ([], self.total_too_large)
