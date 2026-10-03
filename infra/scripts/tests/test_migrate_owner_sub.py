"""migrate_owner_sub.py のテスト。AWS には出ない（S3 と DynamoDB は手書きの偽物）。

実行:
    uv run --with boto3 --with pytest pytest infra/scripts/tests
"""

import sys
from pathlib import Path

import pytest
from botocore.exceptions import ClientError

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import migrate_owner_sub as m  # noqa: E402

OLD = "1a2b3c4d-1111-4111-8111-abcdef111111"
NEW = "22222222-2222-4222-8222-222222222222"
OTHER = "33333333-3333-4333-8333-333333333333"


# ---------------------------------------------------------------------------
# 純粋関数
# ---------------------------------------------------------------------------


class TestValidateSubs:
    def test_UUID_の組なら通る(self):
        m.validate_subs(OLD, NEW)

    @pytest.mark.parametrize(
        "old,new",
        [
            ("", NEW),  # 空文字はバケット全体に前方一致してしまう
            (OLD, "user@example.com"),
            (OLD.upper(), NEW),
            (OLD, OLD),
        ],
    )
    def test_形が違うか同じなら落とす(self, old, new):
        with pytest.raises(ValueError):
            m.validate_subs(old, new)


class TestRewriteKey:
    def test_先頭の旧subだけを置き換える(self):
        key = f"{OLD}/purchase/rec-1/{OLD}.jpg"
        assert m.rewrite_key(key, OLD, NEW) == f"{NEW}/purchase/rec-1/{OLD}.jpg"

    def test_サムネイルも同じ規則(self):
        assert m.rewrite_key(f"{OLD}/drinking/r/thumb_a.jpg", OLD, NEW) == f"{NEW}/drinking/r/thumb_a.jpg"

    @pytest.mark.parametrize("key", [f"{OTHER}/purchase/r/a.jpg", f"x{OLD}/a.jpg", OLD])
    def test_旧subで始まらないキーはそのまま(self, key):
        assert m.rewrite_key(key, OLD, NEW) == key

    def test_付け替え済みのキーに二度かけても変わらない(self):
        once = m.rewrite_key(f"{OLD}/purchase/r/a.jpg", OLD, NEW)
        assert m.rewrite_key(once, OLD, NEW) == once


class TestS3CopyTarget:
    def test_記録の画像は写す(self):
        assert m.s3_copy_target(f"{OLD}/purchase/r/a.jpg", OLD, NEW) == f"{NEW}/purchase/r/a.jpg"

    @pytest.mark.parametrize(
        "key",
        [f"{OLD}/tmp/x/a.jpg", f"{OLD}/", f"{OTHER}/purchase/r/a.jpg", f"{OLD}x/a.jpg"],
    )
    def test_一時領域と旧subの外は写さない(self, key):
        assert m.s3_copy_target(key, OLD, NEW) is None


def record(owner=OLD, **extra):
    item = {"id": {"S": "rec-1"}, "owner": {"S": owner}, "updatedAt": {"S": "2026-10-01T00:00:00Z"}}
    item.update(extra)
    return item


class TestPlanItemUpdate:
    def test_ownerと画像キーを書き換える(self):
        item = record(
            imageKey={"S": f"{OLD}/purchase/rec-1/a.jpg"},
            imageKeys={"L": [{"S": f"{OLD}/purchase/rec-1/a.jpg"}, {"S": f"{OLD}/purchase/rec-1/b.jpg"}]},
        )
        update = m.plan_item_update(item, OLD, NEW)
        assert update.key == {"id": {"S": "rec-1"}}
        assert update.values == {
            "owner": {"S": NEW},
            "imageKey": {"S": f"{NEW}/purchase/rec-1/a.jpg"},
            "imageKeys": {"L": [{"S": f"{NEW}/purchase/rec-1/a.jpg"}, {"S": f"{NEW}/purchase/rec-1/b.jpg"}]},
        }
        assert update.condition_updated_at == {"S": "2026-10-01T00:00:00Z"}
        assert update.foreign_image_keys == []

    def test_画像の無い記録はownerだけ(self):
        assert m.plan_item_update(record(), OLD, NEW).values == {"owner": {"S": NEW}}

    @pytest.mark.parametrize("owner", [NEW, OTHER])
    def test_旧subの記録でなければ触らない(self, owner):
        assert m.plan_item_update(record(owner=owner), OLD, NEW) is None

    def test_旧subで始まらない画像キーは残して報告する(self):
        item = record(imageKeys={"L": [{"S": f"{OTHER}/purchase/r/a.jpg"}, {"NULL": True}]})
        update = m.plan_item_update(item, OLD, NEW)
        assert update.values["imageKeys"] == {"L": [{"S": f"{OTHER}/purchase/r/a.jpg"}, {"NULL": True}]}
        assert update.foreign_image_keys == [f"{OTHER}/purchase/r/a.jpg"]


class TestBuildUpdateRequest:
    def test_旧ownerとupdatedAtを条件にする(self):
        update = m.plan_item_update(record(imageKey={"S": f"{OLD}/p/r/a.jpg"}), OLD, NEW)
        req = m.build_update_request("t", update, OLD)
        assert req["ConditionExpression"] == "#owner = :oldOwner AND #updatedAt = :readUpdatedAt"
        assert req["ExpressionAttributeValues"][":oldOwner"] == {"S": OLD}
        assert req["ExpressionAttributeValues"][":readUpdatedAt"] == {"S": "2026-10-01T00:00:00Z"}
        assert req["UpdateExpression"].startswith("SET ")
        assert set(req["ExpressionAttributeNames"].values()) >= {"owner", "imageKey", "updatedAt"}

    def test_updatedAtの無い項目は無いことを条件にする(self):
        item = record()
        del item["updatedAt"]
        req = m.build_update_request("t", m.plan_item_update(item, OLD, NEW), OLD)
        assert req["ConditionExpression"] == "#owner = :oldOwner AND attribute_not_exists(#updatedAt)"


def test_表示するキーからsubを落とす():
    assert m.without_owner(f"{OLD}/purchase/r/a.jpg") == "purchase/r/a.jpg"
    assert m.without_owner("nosep") == "(想定外の形のキー)"


# ---------------------------------------------------------------------------
# 偽物の S3 / DynamoDB で、dry-run と --apply と2回目の振る舞いを見る
# ---------------------------------------------------------------------------


def client_error(code):
    return ClientError({"Error": {"Code": code, "Message": code}}, "op")


class FakeS3:
    def __init__(self, keys):
        self.objects = set(keys)
        self.copies = []

    def list_objects_v2(self, Bucket, Prefix, ContinuationToken=None):
        return {"Contents": [{"Key": k} for k in sorted(self.objects) if k.startswith(Prefix)], "IsTruncated": False}

    def head_object(self, Bucket, Key):
        if Key not in self.objects:
            raise client_error("404")
        return {}

    def copy_object(self, Bucket, Key, CopySource):
        self.copies.append((CopySource["Key"], Key))
        self.objects.add(Key)


class FakeDynamoDB:
    def __init__(self, items):
        self.items = {i["id"]["S"]: dict(i) for i in items}
        self.updates = 0

    def query(self, **kwargs):
        owner = kwargs["ExpressionAttributeValues"][":owner"]["S"]
        return {"Items": [dict(i) for i in self.items.values() if i["owner"]["S"] == owner]}

    def update_item(self, TableName, Key, UpdateExpression, ConditionExpression,
                    ExpressionAttributeNames, ExpressionAttributeValues):
        item = self.items[Key["id"]["S"]]
        if item["owner"] != ExpressionAttributeValues[":oldOwner"]:
            raise client_error("ConditionalCheckFailedException")
        if ":readUpdatedAt" in ExpressionAttributeValues and item.get("updatedAt") != ExpressionAttributeValues[":readUpdatedAt"]:
            raise client_error("ConditionalCheckFailedException")
        for assignment in UpdateExpression[len("SET "):].split(", "):
            name, value = assignment.split(" = ")
            item[ExpressionAttributeNames[name]] = ExpressionAttributeValues[value]
        self.updates += 1


def sample():
    s3 = FakeS3([
        f"{OLD}/purchase/rec-1/a.jpg",
        f"{OLD}/purchase/rec-1/thumb_a.jpg",
        f"{OLD}/tmp/x/ocr.jpg",
        f"{OTHER}/purchase/z/z.jpg",
    ])
    db = FakeDynamoDB([
        record(imageKeys={"L": [{"S": f"{OLD}/purchase/rec-1/a.jpg"}]}),
        {"id": {"S": "rec-other"}, "owner": {"S": OTHER}},
    ])
    return s3, db


def test_dry_runは何も書かない():
    s3, db = sample()
    assert m.migrate_images(s3, "b", OLD, NEW, apply=False) == 0
    assert m.migrate_table(db, "t", OLD, NEW, apply=False) == 0
    assert s3.copies == []
    assert db.updates == 0
    assert db.items["rec-1"]["owner"] == {"S": OLD}


def test_applyで写して付け替え_二度目は何もしない():
    s3, db = sample()
    assert m.migrate_images(s3, "b", OLD, NEW, apply=True) == 0
    assert sorted(dst for _src, dst in s3.copies) == [
        f"{NEW}/purchase/rec-1/a.jpg",
        f"{NEW}/purchase/rec-1/thumb_a.jpg",
    ]
    # 旧キーは消さない
    assert f"{OLD}/purchase/rec-1/a.jpg" in s3.objects

    assert m.migrate_table(db, "t", OLD, NEW, apply=True) == 0
    assert db.items["rec-1"]["owner"] == {"S": NEW}
    assert db.items["rec-1"]["imageKeys"] == {"L": [{"S": f"{NEW}/purchase/rec-1/a.jpg"}]}
    # 他人の記録には触れない
    assert db.items["rec-other"]["owner"] == {"S": OTHER}

    # 二度目: 写し先はすでにあり、旧 sub の記録はもう無い
    s3.copies.clear()
    updates = db.updates
    assert m.migrate_images(s3, "b", OLD, NEW, apply=True) == 0
    assert m.migrate_table(db, "t", OLD, NEW, apply=True) == 0
    assert s3.copies == []
    assert db.updates == updates


def test_読んだあとに編集された記録は上書きしない(monkeypatch):
    _s3, db = sample()
    original_query = db.query

    def query_then_edit(**kwargs):
        result = original_query(**kwargs)
        # 読んだ直後に画面から編集された
        db.items["rec-1"]["updatedAt"] = {"S": "2026-10-02T00:00:00Z"}
        return result

    monkeypatch.setattr(db, "query", query_then_edit)
    assert m.migrate_table(db, "t", OLD, NEW, apply=True) == 0
    assert db.items["rec-1"]["owner"] == {"S": OLD}


def test_入れ替えて流せば戻る():
    s3, db = sample()
    m.migrate_images(s3, "b", OLD, NEW, apply=True)
    m.migrate_table(db, "t", OLD, NEW, apply=True)

    s3.copies.clear()
    m.migrate_images(s3, "b", NEW, OLD, apply=True)
    m.migrate_table(db, "t", NEW, OLD, apply=True)
    # 旧キーは残っているのでコピーは起きない
    assert s3.copies == []
    assert db.items["rec-1"]["owner"] == {"S": OLD}
    assert db.items["rec-1"]["imageKeys"] == {"L": [{"S": f"{OLD}/purchase/rec-1/a.jpg"}]}


def test_mainはsubの形が違えば何もせずに終わる(capsys):
    code = m.main([
        "--old-sub", "", "--new-sub", NEW,
        "--purchase-table", "p", "--drinking-table", "d", "--bucket", "b",
    ])
    assert code == 2
    assert "sub" in capsys.readouterr().err
