#!/usr/bin/env python3
"""
Slack #03-guests_顧客管理 チャンネルの投稿を読み取り、
Notionのお客様ノート・来店記録データベースに自動登録するスクリプト。
毎日深夜2時にGitHub Actions の cron から実行される。

対応フォーマット:

(A) Slack Workflow フォーム投稿 (subtype=bot_message)
    *名前*
    タケシさん
    *新規/リピーター*
    新規
    *人数*
    2
    *メモ*
    野球の話で盛り上がった
    *紹介者*
    華

(B) 旧【来店記録】プレーンテキスト (後方互換)
    【来店記録】
    名前: タケシさん
    新規: はい
    人数: 2
    注文: 桜尾ジントニック×2
    メモ: ...
    次回: ...
    流入: Instagram
    好み: ジン系
    満足度: とても良い
    写真OK: いいえ
"""

import json
import logging
import os
import re
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests

BASE_DIR = Path(__file__).parent
LOG_FILE = BASE_DIR / "logs" / "customer_record.log"
PROCESSED_FILE = BASE_DIR / "processed_messages.json"
ENV_FILE = BASE_DIR / ".env"

LOG_FILE.parent.mkdir(exist_ok=True)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler(LOG_FILE, encoding="utf-8"),
        logging.StreamHandler(sys.stdout),
    ],
)
log = logging.getLogger(__name__)

JST = timezone(timedelta(hours=9))

NOTION_VERSION = "2022-06-28"


# ──────────────────────────────
# 設定読み込み
# ──────────────────────────────

def load_env():
    env = {}
    if ENV_FILE.exists():
        for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip()
    for key in ["SLACK_BOT_TOKEN", "SLACK_CHANNEL_ID", "NOTION_TOKEN",
                "NOTION_VISIT_DB_ID", "NOTION_CUSTOMER_DB_ID"]:
        if key in os.environ:
            env[key] = os.environ[key]
    return env


# ──────────────────────────────
# Slack
# ──────────────────────────────

def get_slack_messages(token, channel_id, oldest_ts):
    url = "https://slack.com/api/conversations.history"
    headers = {"Authorization": f"Bearer {token}"}
    params = {"channel": channel_id, "oldest": oldest_ts, "limit": 200}
    resp = requests.get(url, headers=headers, params=params, timeout=30)
    data = resp.json()
    if not data.get("ok"):
        raise RuntimeError(f"Slack API error: {data.get('error')}")
    return data.get("messages", [])


def diagnose_slack(token, channel_id):
    """【診断用】bot 同一性とチャンネル到達性を確認してログ出力"""
    # auth.test: このトークンがどの bot のものか
    try:
        r = requests.post(
            "https://slack.com/api/auth.test",
            headers={"Authorization": f"Bearer {token}"},
            timeout=10,
        )
        d = r.json()
        if d.get("ok"):
            log.info(f"  [診断] Bot: user={d.get('user')} / "
                     f"bot_id={d.get('bot_id')} / team={d.get('team')} "
                     f"/ url={d.get('url')}")
        else:
            log.warning(f"  [診断] auth.test 失敗: {d.get('error')}")
    except Exception as e:
        log.warning(f"  [診断] auth.test 例外: {e}")

    # conversations.info: チャンネルが読めるか・bot がメンバーか
    try:
        r = requests.get(
            "https://slack.com/api/conversations.info",
            headers={"Authorization": f"Bearer {token}"},
            params={"channel": channel_id},
            timeout=10,
        )
        d = r.json()
        if d.get("ok"):
            ch = d.get("channel", {})
            log.info(f"  [診断] Channel: name=#{ch.get('name')} / "
                     f"id={ch.get('id')} / is_member={ch.get('is_member')} "
                     f"/ is_private={ch.get('is_private')} "
                     f"/ is_archived={ch.get('is_archived')} "
                     f"/ num_members={ch.get('num_members')}")
        else:
            log.warning(f"  [診断] conversations.info 失敗: {d.get('error')}")
    except Exception as e:
        log.warning(f"  [診断] conversations.info 例外: {e}")


def parse_workflow_form(text):
    """Slack Workflow フォーム投稿（bot_message）形式をパース。
    構造: *ラベル*\\n値\\n*ラベル*\\n値 ..."""
    if not text or "*名前*" not in text:
        return None

    # Slack ラベル → スクリプト内部キー
    label_map = {
        "名前":          "名前",
        "新規/リピーター": "__新規raw",  # 後処理で「はい/いいえ」に変換
        "人数":          "人数",
        "メモ":          "メモ",
        "紹介者":        "紹介者",
    }

    fields = {}
    for slack_label, canonical in label_map.items():
        # *LABEL* の次の行を値として抽出
        m = re.search(
            rf"\*{re.escape(slack_label)}\*\s*\n([^\n]*)",
            text,
        )
        if m:
            value = m.group(1).strip()
            if value:
                fields[canonical] = value

    # 新規/リピーター → 新規(はい/いいえ)
    raw = fields.pop("__新規raw", None)
    if raw is not None:
        fields["新規"] = "はい" if raw == "新規" else "いいえ"

    return fields if fields else None


def parse_legacy_template(text):
    """旧【来店記録】プレーンテキスト形式をパース"""
    if "【来店記録】" not in text:
        return None

    fields = {}
    patterns = {
        "名前":   r"名前[：:]\s*(.+)",
        "新規":   r"新規[：:]\s*(はい|いいえ)",
        "人数":   r"人数[：:]\s*(\d+)",
        "注文":   r"注文[：:]\s*(.+)",
        "メモ":   r"メモ[：:]\s*(.+)",
        "次回":   r"次回[：:]\s*(.+)",
        "流入":   r"流入[：:]\s*(.+)",
        "好み":   r"好み[：:]\s*(.+)",
        "満足度": r"満足度[：:]\s*(.+)",
        "写真OK": r"写真OK[：:]\s*(はい|いいえ)",
    }
    for key, pattern in patterns.items():
        m = re.search(pattern, text, re.IGNORECASE | re.MULTILINE)
        if m:
            fields[key] = m.group(1).strip()

    return fields if fields else None


def parse_message(text):
    """メッセージを新旧両フォーマットでパース"""
    return parse_workflow_form(text) or parse_legacy_template(text)


# ──────────────────────────────
# Notion 共通
# ──────────────────────────────

def notion_headers(token):
    return {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "Notion-Version": NOTION_VERSION,
    }


def notion_get(token, path):
    resp = requests.get(f"https://api.notion.com/v1{path}",
                        headers=notion_headers(token), timeout=30)
    return resp


def notion_post(token, path, body):
    resp = requests.post(f"https://api.notion.com/v1{path}",
                         headers=notion_headers(token), json=body, timeout=30)
    return resp


def notion_patch(token, path, body):
    resp = requests.patch(f"https://api.notion.com/v1{path}",
                          headers=notion_headers(token), json=body, timeout=30)
    return resp


# ──────────────────────────────
# お客様ノート操作
# ──────────────────────────────

def search_customer_by_name(token, customer_db_id, name):
    """名前でお客様ノートを検索。最初にヒットしたページIDを返す"""
    body = {
        "filter": {
            "property": "お名前",
            "title": {"contains": name}
        },
        "page_size": 5,
    }
    resp = notion_post(token, f"/databases/{customer_db_id}/query", body)
    if resp.status_code != 200:
        log.warning(f"お客様ノート検索エラー: {resp.status_code} {resp.text[:100]}")
        return None
    results = resp.json().get("results", [])
    if results:
        log.info(f"  既存顧客ヒット: {results[0]['id']} ({len(results)}件)")
        return results[0]["id"]
    return None


def create_customer(token, customer_db_id, fields, visit_date):
    """お客様ノートに新規顧客を登録"""
    流入_valid = {"Instagram", "Google検索", "TripAdvisor", "友人紹介",
                  "Yelp", "食べログ", "通りがかり", "その他"}

    props = {
        "お名前": {"title": [{"text": {"content": fields.get("名前", "不明")}}]},
        "タイプ": {"select": {"name": "初来店"}},
        "来店回数": {"number": 1},
        "最終来店日": {"date": {"start": visit_date}},
    }
    if "好み" in fields:
        props["好きなお酒"] = {"rich_text": [{"text": {"content": fields["好み"]}}]}
    f = fields.get("流入", "")
    if f in 流入_valid:
        props["流入経路"] = {"select": {"name": f}}

    body = {"parent": {"database_id": customer_db_id}, "properties": props}
    resp = notion_post(token, "/pages", body)
    if resp.status_code != 200:
        raise RuntimeError(f"お客様ノート作成エラー: {resp.status_code} {resp.text[:200]}")
    page = resp.json()
    log.info(f"  新規顧客登録完了: {page['id']}")
    return page["id"]


def update_customer(token, page_url, visit_date):
    """既存顧客の最終来店日・来店回数を更新"""
    page_id = page_url.split("/")[-1].replace("-", "")

    # 現在の来店回数を取得
    resp = notion_get(token, f"/pages/{page_id}")
    if resp.status_code != 200:
        log.warning(f"顧客情報取得失敗: {resp.status_code}")
        return

    props = resp.json().get("properties", {})
    current_count = props.get("来店回数", {}).get("number") or 0
    current_type = props.get("タイプ", {}).get("select", {}).get("name", "初来店")

    # タイプを昇格
    type_map = {"初来店": "2回目以降", "2回目以降": "2回目以降", "観光客": "観光客",
                "インバウンド": "インバウンド", "常連": "常連"}
    if current_count + 1 >= 5:
        new_type = "常連"
    elif current_count + 1 >= 2:
        new_type = type_map.get(current_type, "2回目以降")
    else:
        new_type = current_type

    update_props = {
        "来店回数": {"number": current_count + 1},
        "最終来店日": {"date": {"start": visit_date}},
        "タイプ": {"select": {"name": new_type}},
    }
    notion_patch(token, f"/pages/{page_id}", {"properties": update_props})
    log.info(f"  顧客情報更新: 来店{current_count + 1}回, タイプ={new_type}")


# ──────────────────────────────
# 来店記録操作
# ──────────────────────────────

def create_visit_record(token, visit_db_id, fields, message_ts, customer_page_url=None):
    """来店記録に1件登録"""
    ts_dt = datetime.fromtimestamp(float(message_ts), tz=JST)
    visit_date = ts_dt.date().isoformat()
    name = fields.get("名前", "不明")
    order = fields.get("注文", "")
    title = f"{ts_dt.strftime('%-m/%-d')} {name}{'　' + order[:15] if order else ''}"

    props = {
        "日付メモ": {"title": [{"text": {"content": title}}]},
        "来店日": {"date": {"start": visit_date}},
    }

    # お客さんリレーション
    if customer_page_url:
        props["お客さん"] = {"relation": [{"id": customer_page_url}]}

    if order:
        props["注文したもの"] = {"rich_text": [{"text": {"content": order}}]}
    if "人数" in fields:
        try:
            props["人数"] = {"number": int(fields["人数"])}
        except ValueError:
            pass

    memo_parts = []
    if "メモ" in fields:
        memo_parts.append(fields["メモ"])
    if "流入" in fields:
        memo_parts.append(f"流入: {fields['流入']}")
    if "紹介者" in fields:
        memo_parts.append(f"紹介者: {fields['紹介者']}")
    if memo_parts:
        props["雰囲気・メモ"] = {"rich_text": [{"text": {"content": "\n".join(memo_parts)}}]}
    if "次回" in fields:
        props["次回アクション"] = {"rich_text": [{"text": {"content": fields["次回"]}}]}

    満足度_valid = {"とても良い", "良い", "普通", "改善点あり"}
    if fields.get("満足度") in 満足度_valid:
        props["満足度"] = {"select": {"name": fields["満足度"]}}
    if fields.get("写真OK") == "はい":
        props["写真OK"] = {"checkbox": True}

    body = {"parent": {"database_id": visit_db_id}, "properties": props}
    resp = notion_post(token, "/pages", body)
    if resp.status_code != 200:
        raise RuntimeError(f"来店記録作成エラー: {resp.status_code} {resp.text[:200]}")
    log.info(f"  来店記録登録完了")


# ──────────────────────────────
# 処理済み管理
# ──────────────────────────────

def load_processed():
    if PROCESSED_FILE.exists():
        return set(json.loads(PROCESSED_FILE.read_text(encoding="utf-8")))
    return set()


def save_processed(processed):
    PROCESSED_FILE.write_text(
        json.dumps(sorted(processed), ensure_ascii=False, indent=2),
        encoding="utf-8"
    )


# ──────────────────────────────
# メイン
# ──────────────────────────────

def main():
    log.info("=== 顧客記録 Slack→Notion 開始 ===")

    env = load_env()
    slack_token    = env.get("SLACK_BOT_TOKEN")
    channel_id     = env.get("SLACK_CHANNEL_ID")
    notion_token   = env.get("NOTION_TOKEN")
    visit_db_id    = env.get("NOTION_VISIT_DB_ID")
    customer_db_id = env.get("NOTION_CUSTOMER_DB_ID")

    for key, val in [
        ("SLACK_BOT_TOKEN", slack_token), ("SLACK_CHANNEL_ID", channel_id),
        ("NOTION_TOKEN", notion_token), ("NOTION_VISIT_DB_ID", visit_db_id),
        ("NOTION_CUSTOMER_DB_ID", customer_db_id),
    ]:
        if not val:
            raise RuntimeError(f"環境変数 {key} が未設定です")

    diagnose_slack(slack_token, channel_id)

    oldest = str(time.time() - 48 * 3600)
    messages = get_slack_messages(slack_token, channel_id, oldest)
    log.info(f"取得メッセージ数: {len(messages)}件 (oldest={oldest})")

    processed = load_processed()
    new_count = 0
    skip_already = 0
    skip_no_template = 0
    error_count = 0

    try:
        for msg in messages:
            ts = msg.get("ts", "")
            if ts in processed:
                skip_already += 1
                continue

            text = msg.get("text", "")
            fields = parse_message(text)
            if fields is None:
                skip_no_template += 1
                continue

            try:
                name = fields.get("名前", "不明")
                is_new = fields.get("新規", "いいえ") == "はい"
                log.info(f"処理中: {name} / 新規={is_new} (ts={ts})")

                ts_dt = datetime.fromtimestamp(float(ts), tz=JST)
                visit_date = ts_dt.date().isoformat()

                customer_page_url = None

                if is_new:
                    # 新規：お客様ノートを作成
                    customer_page_url = create_customer(notion_token, customer_db_id, fields, visit_date)
                else:
                    # リピーター：名前で検索
                    customer_page_url = search_customer_by_name(notion_token, customer_db_id, name)
                    if customer_page_url:
                        update_customer(notion_token, customer_page_url, visit_date)
                    else:
                        log.info(f"  名前が見つからないため新規登録: {name}")
                        customer_page_url = create_customer(notion_token, customer_db_id, fields, visit_date)

                # 来店記録を登録（お客様ノートと紐付け）
                create_visit_record(notion_token, visit_db_id, fields, ts, customer_page_url)

                processed.add(ts)
                new_count += 1
            except Exception as e:
                error_count += 1
                log.error(f"  メッセージ処理失敗 (ts={ts}, name={fields.get('名前','?')}): {e}",
                          exc_info=True)
                # このメッセージは processed に追加せず、次回リトライさせる
                continue
    finally:
        save_processed(processed)

    log.info(
        f"=== 完了: 登録 {new_count}件 / "
        f"既処理スキップ {skip_already}件 / "
        f"テンプレート無しスキップ {skip_no_template}件 / "
        f"エラー {error_count}件 ==="
    )

    # エラーがあった場合は非ゼロ終了（ただし save_processed は完了済み）
    if error_count > 0:
        sys.exit(1)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        log.error(f"エラー: {e}", exc_info=True)
        sys.exit(1)
