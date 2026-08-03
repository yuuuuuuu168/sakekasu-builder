from strands.models.bedrock import BedrockModel


def load_model() -> BedrockModel:
    """Bedrock モデルクライアントを IAM 認証情報で取得する。

    東京リージョン CRIS プレフィックス付き Claude Haiku 4.5。既存 OCR と揃える。
    """
    return BedrockModel(model_id="jp.anthropic.claude-haiku-4-5-20251001-v1:0")
