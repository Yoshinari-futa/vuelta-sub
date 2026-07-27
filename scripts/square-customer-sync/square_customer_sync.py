#!/usr/bin/env python3
"""
Square 会計データ → Notion 顧客DB連動 + Slack 日次サマリー

毎朝 5:00 JST 過ぎに GitHub Actions から実行される。
前営業日 (05:00 JST 切替、square-tax-report.py と同一基準) の
COMPLETED オーダーのうち顧客が紐付いたものを集計し、

  1. Notion「お客様ノート」と照合 (Square顧客ID → 名前照合の順)
  2. 同日の来店記録があれば注文内容・売上金額を追記 (Slack転記が正)
     なければ「記録元=Square自動」印付きで新規作成し来店回数を加算
  3. #10-daily に前日来店サマリー + 新規顧客ハイライトを投稿

設計上の絶対条件: Slack #03-guests → customer_record.py の転記が正。
本スクリプトは補完のみ。来店回数の加算は「その営業日の来店記録が
1件もない場合」に限る (日単位の二重カウント防止)。
冪等性: 来店記録の「Square注文ID」に処理済み order_id を刻み、
再実行時は差分のみ処理する。

名前照合: 完全一致 → 敬称外し → 空白除去 (contains は使わない。
ゆか/ゆかり誤結合防止、karte 実証 171/173 と同一方針)。
INSTANT_PROFILE (カード決済の自動生成顧客) は照合・新規通知の対象外。
"""

import argparse
import json
import logging
import os
import re
import sys
import time
from datetime import datetime, timedelta, timezone, date

import requests

JST = timezone(timedelta(hours=9))
NOTION_VERSION = "2022-06-28"
SQUARE_VERSION = "2024-01-17"
BUSINESS_DAY_END_HOUR = 5  # 05:00 JST 未満は前営業日扱い
HONORIFICS = ("さん", "サン", "様", "さま", "くん", "ちゃん", "氏")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
log = logging.getLogger(__name__)


# ──────────────────────────────
# 共通
# ──────────────────────────────

def require_env(*keys):
    env = {}
    missing = []
    for k in keys:
        v = os.environ.get(k, "").strip()
        if v:
            env[k] = v
        else:
            missing.append(k)
    if missing:
        log.error(f"環境変数が未設定: {', '.join(missing)}")
        sys.exit(1)
    return env


def request_with_retry(method, url, *, headers=None, json_body=None, params=None,
                       max_attempts=3, timeout=30):
    last = None
    for attempt in range(1, max_attempts + 1):
        try:
            resp = requests.request(method, url, headers=headers, json=json_body,
                                    params=params, timeout=timeout)
            if resp.status_code in (429, 500, 502, 503, 504):
                raise RuntimeError(f"HTTP {resp.status_code}: {resp.text[:120]}")
            return resp
        except Exception as e:
            last = e
            if attempt < max_attempts:
                wait = 5 * attempt
                log.warning(f"リトライ {attempt}/{max_attempts} ({e}) {wait}s待機")
                time.sleep(wait)
    raise RuntimeError(f"リクエスト失敗: {url} ({last})")


def normalize_name(name):
    """空白(半角/全角)除去 + 末尾敬称外し"""
    n = (name or "").replace(" ", "").replace("　", "").strip()
    for h in HONORIFICS:
        if n.endswith(h) and len(n) > len(h):
            n = n[: -len(h)]
            break
    return n


def business_window(biz_date):
    begin = datetime(biz_date.year, biz_date.month, biz_date.day,
                     BUSINESS_DAY_END_HOUR, 0, 0, tzinfo=JST)
    return begin, begin + timedelta(days=1)


def default_business_date():
    """直近の完了済み営業日 = (現在JST - 5時間) の前日"""
    return (datetime.now(JST) - timedelta(hours=BUSINESS_DAY_END_HOUR)).date() - timedelta(days=1)


# ──────────────────────────────
# Square
# ──────────────────────────────

def square_headers(token):
    return {"Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Square-Version": SQUARE_VERSION}


def fetch_orders(token, location_id, begin, end):
    orders = []
    cursor = None
    while True:
        body = {
            "location_ids": [location_id],
            "query": {
                "filter": {
                    "date_time_filter": {"closed_at": {
                        "start_at": begin.isoformat(), "end_at": end.isoformat()}},
                    "state_filter": {"states": ["COMPLETED"]},
                },
                "sort": {"sort_field": "CLOSED_AT", "sort_order": "ASC"},
            },
        }
        if cursor:
            body["cursor"] = cursor
        resp = request_with_retry("POST", "https://connect.squareup.com/v2/orders/search",
                                  headers=square_headers(token), json_body=body)
        if resp.status_code != 200:
            raise RuntimeError(f"Orders検索エラー: {resp.status_code} {resp.text[:200]}")
        data = resp.json()
        orders.extend(data.get("orders", []))
        cursor = data.get("cursor")
        if not cursor:
            return orders


def fetch_payment_customer_map(token, location_id, begin, end):
    """order_id → customer_id のフォールバック (顧客が支払い側にだけ付くケース)"""
    mapping = {}
    cursor = None
    while True:
        params = {"location_id": location_id,
                  "begin_time": begin.isoformat(), "end_time": end.isoformat(),
                  "limit": 100}
        if cursor:
            params["cursor"] = cursor
        resp = request_with_retry("GET", "https://connect.squareup.com/v2/payments",
                                  headers=square_headers(token), params=params)
        if resp.status_code != 200:
            log.warning(f"Payments取得エラー(フォールバック省略): {resp.status_code}")
            return mapping
        data = resp.json()
        for p in data.get("payments", []):
            if p.get("order_id") and p.get("customer_id"):
                mapping[p["order_id"]] = p["customer_id"]
        cursor = data.get("cursor")
        if not cursor:
            return mapping


def fetch_square_customer(token, customer_id):
    resp = request_with_retry("GET", f"https://connect.squareup.com/v2/customers/{customer_id}",
                              headers=square_headers(token))
    if resp.status_code != 200:
        log.warning(f"顧客取得エラー {customer_id}: {resp.status_code}")
        return None
    return resp.json().get("customer")


def fetch_new_square_customers(token, begin, end):
    """営業日内に作成された顧客 (INSTANT_PROFILE 除外)"""
    body = {
        "filter": {"created_at": {"start_at": begin.isoformat(), "end_at": end.isoformat()}},
        "sort": {"field": "CREATED_AT", "order": "ASC"},
    }
    resp = request_with_retry("POST", "https://connect.squareup.com/v2/customers/search",
                              headers=square_headers(token),
                              json_body={"query": body, "limit": 50})
    if resp.status_code != 200:
        log.warning(f"新規顧客検索エラー: {resp.status_code} {resp.text[:120]}")
        return []
    customers = resp.json().get("customers", [])
    return [c for c in customers if c.get("creation_source") != "INSTANT_PROFILE"]


def fetch_all_square_customers(token):
    customers = []
    cursor = None
    while True:
        params = {"limit": 100}
        if cursor:
            params["cursor"] = cursor
        resp = request_with_retry("GET", "https://connect.squareup.com/v2/customers",
                                  headers=square_headers(token), params=params)
        if resp.status_code != 200:
            log.warning(f"Square顧客一覧エラー(自動登録スキップ): {resp.status_code}")
            return None
        data = resp.json()
        customers.extend(data.get("customers", []))
        cursor = data.get("cursor")
        if not cursor:
            return customers


def square_display_name(cust):
    family = (cust.get("family_name") or "").strip()
    given = (cust.get("given_name") or "").strip()
    return (f"{family} {given}".strip()) or cust.get("nickname", "") or "(名前なし)"


def square_name_forms(cust):
    """照合候補: 姓 / 名 / 姓名 / 名姓 (呼び名運用では姓のみが本命)"""
    family = (cust.get("family_name") or "").strip()
    given = (cust.get("given_name") or "").strip()
    nickname = (cust.get("nickname") or "").strip()
    forms = [family, given, nickname, f"{family}{given}", f"{given}{family}"]
    seen = set()
    result = []
    for f in forms:
        n = normalize_name(f)
        if n and n not in seen:
            seen.add(n)
            result.append(n)
    return result


# ──────────────────────────────
# Notion
# ──────────────────────────────

def notion_headers(token):
    return {"Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Notion-Version": NOTION_VERSION}


def notion_query_all(token, db_id, body):
    results = []
    cursor = None
    while True:
        b = dict(body)
        if cursor:
            b["start_cursor"] = cursor
        resp = request_with_retry("POST", f"https://api.notion.com/v1/databases/{db_id}/query",
                                  headers=notion_headers(token), json_body=b)
        if resp.status_code != 200:
            raise RuntimeError(f"Notion query エラー: {resp.status_code} {resp.text[:200]}")
        data = resp.json()
        results.extend(data.get("results", []))
        if not data.get("has_more"):
            return results
        cursor = data.get("next_cursor")


def rich_text_value(props, name):
    return "".join(rt.get("plain_text", "") for rt in (props.get(name, {}).get("rich_text") or []))


def title_value(props):
    for p in props.values():
        if p.get("type") == "title":
            return "".join(t.get("plain_text", "") for t in p.get("title", []))
    return ""


def load_notion_customers(token, customer_db_id):
    pages = notion_query_all(token, customer_db_id, {"page_size": 100})
    customers = []
    for page in pages:
        props = page["properties"]
        customers.append({
            "page_id": page["id"],
            "name": title_value(props),
            "square_id": rich_text_value(props, "Square顧客ID"),
            "count": props.get("来店回数", {}).get("number") or 0,
            "type": (props.get("タイプ", {}).get("select") or {}).get("name", "初来店"),
            "last_visit": (props.get("最終来店日", {}).get("date") or {}).get("start"),
        })
    return customers


def load_visit_records(token, visit_db_id, biz_date):
    """営業日当日 + 翌暦日 (深夜のSlack投稿は暦日がずれる) の来店記録"""
    next_day = biz_date + timedelta(days=1)
    body = {
        "filter": {"and": [
            {"property": "来店日", "date": {"on_or_after": biz_date.isoformat()}},
            {"property": "来店日", "date": {"on_or_before": next_day.isoformat()}},
        ]},
        "page_size": 100,
    }
    records = []
    for page in notion_query_all(token, visit_db_id, body):
        props = page["properties"]
        records.append({
            "page_id": page["id"],
            "title": title_value(props),
            "relation_ids": [r["id"] for r in (props.get("お客様", {}).get("relation") or [])],
            "order_text": rich_text_value(props, "注文したもの"),
            "square_order_ids": rich_text_value(props, "Square注文ID"),
        })
    return records


def verify_schema(token, customer_db_id, visit_db_id):
    """必須プロパティの存在確認 (欠けていたら fail fast)"""
    need = {
        customer_db_id: ["お名前", "来店回数", "最終来店日", "タイプ", "Square顧客ID"],
        visit_db_id: ["日付メモ", "来店日", "お客様", "注文したもの", "売上金額", "Square注文ID", "記録元"],
    }
    for db_id, props in need.items():
        resp = request_with_retry("GET", f"https://api.notion.com/v1/databases/{db_id}",
                                  headers=notion_headers(token))
        if resp.status_code != 200:
            raise RuntimeError(f"DB取得エラー {db_id}: {resp.status_code}")
        existing = set(resp.json()["properties"].keys())
        missing = [p for p in props if p not in existing]
        if missing:
            raise RuntimeError(f"Notion DBにプロパティがありません: {missing} (db={db_id})")


def notion_patch_page(token, page_id, props, dry_run):
    if dry_run:
        log.info(f"  [dry-run] PATCH {page_id}: {list(props.keys())}")
        return
    resp = request_with_retry("PATCH", f"https://api.notion.com/v1/pages/{page_id}",
                              headers=notion_headers(token), json_body={"properties": props})
    if resp.status_code != 200:
        raise RuntimeError(f"ページ更新エラー: {resp.status_code} {resp.text[:200]}")


def notion_create_page(token, db_id, props, dry_run):
    if dry_run:
        log.info(f"  [dry-run] CREATE in {db_id}: {list(props.keys())}")
        return "dry-run-page-id"
    resp = request_with_retry("POST", "https://api.notion.com/v1/pages",
                              headers=notion_headers(token),
                              json_body={"parent": {"database_id": db_id}, "properties": props})
    if resp.status_code != 200:
        raise RuntimeError(f"ページ作成エラー: {resp.status_code} {resp.text[:200]}")
    return resp.json()["id"]


# ──────────────────────────────
# 照合・集計
# ──────────────────────────────

def kana_fold(s):
    """カタカナ→ひらがな (表記ゆれ吸収用)"""
    return "".join(chr(ord(c) - 0x60) if "ァ" <= c <= "ヶ" else c for c in s)


def names_similar(square_cust, notion_name):
    """自動紐付けの安全弁: 先頭文字一致か包含があれば「似ている」"""
    b = kana_fold(normalize_name(notion_name))
    for form in square_name_forms(square_cust):
        a = kana_fold(form)
        if a and b and (a[0] == b[0] or a in b or b in a):
            return True
    return False


def visit_title_name(title):
    """来店記録タイトル「M/D 名前　注文...」から正規化名を抽出"""
    m = re.match(r"^\d{1,2}/\d{1,2}\s*(.+)$", title)
    body = m.group(1) if m else title
    return normalize_name(body.split("　")[0].strip())


def same_night_candidates(notion_customers, visit_records):
    """当夜の来店記録に載っていて Square顧客ID が未設定の Notion 顧客
    (= Slack には記録されたが Square と未紐付けの人 = 自動紐付けの候補)"""
    by_norm = {}
    for c in notion_customers:
        n = normalize_name(c["name"])
        if n:
            by_norm.setdefault(n, c)
    by_id = {c["page_id"]: c for c in notion_customers}
    out = []
    for r in visit_records:
        page = None
        for rid in r["relation_ids"]:
            if rid in by_id:
                page = by_id[rid]
                break
        if page is None:
            page = by_norm.get(visit_title_name(r["title"]))
        if page and not page["square_id"] and page not in out:
            out.append(page)
    return out


def register_missing_in_square(sq_token, notion_token, notion_customers, biz_date, dry_run):
    """Square顧客IDが未設定のNotion顧客(前夜のSlack記録から生まれた新規客など)を
    Squareに自動登録し、次回来店時にレジ検索で選べるようにする。
    同名のSquare顧客が既にいれば作成せず紐付けのみ(重複防止)。
    現場でSquareに顧客を新規作成する運用は廃止(2026-07-27 布田さん判断:
    会計時点では名前が分からないのが普通のため、入口はSlackメモに一本化)。"""
    targets = [c for c in notion_customers
               if not c["square_id"] and normalize_name(c["name"])]
    if not targets:
        return []
    all_sq = fetch_all_square_customers(sq_token)
    if all_sq is None:
        return []
    index = {}
    for c in all_sq:
        for f in square_name_forms(c):
            index.setdefault(f, c)
    results = []
    for nc in targets:
        norm = normalize_name(nc["name"])
        if norm in index:
            sqid = index[norm]["id"]
            action = "既存に紐付け"
        elif dry_run:
            sqid = "dry-run-id"
            action = "登録"
        else:
            body = {"idempotency_key": f"autoreg-{nc['page_id']}",
                    "family_name": nc["name"],
                    "reference_id": nc["page_id"],
                    "note": f"Slack記録から自動登録 {biz_date.isoformat()}"}
            resp = request_with_retry("POST", "https://connect.squareup.com/v2/customers",
                                      headers=square_headers(sq_token), json_body=body)
            if resp.status_code != 200:
                log.warning(f"Square自動登録失敗 ({nc['name']}): {resp.status_code} {resp.text[:120]}")
                continue
            sqid = resp.json()["customer"]["id"]
            action = "登録"
        notion_patch_page(notion_token, nc["page_id"],
                          {"Square顧客ID": {"rich_text": [{"text": {"content": sqid}}]}},
                          dry_run)
        nc["square_id"] = sqid
        log.info(f"Square自動{action}: {nc['name']}")
        results.append((nc["name"], action))
    return results


def match_notion_customer(square_cust, notion_customers):
    """Square顧客ID → 名前照合 (完全一致→正規化一致) の順。containsなし"""
    sq_id = square_cust["id"]
    for nc in notion_customers:
        if nc["square_id"] and sq_id in nc["square_id"]:
            return nc
    forms = square_name_forms(square_cust)
    by_norm = {}
    for nc in notion_customers:
        norm = normalize_name(nc["name"])
        if norm:
            by_norm.setdefault(norm, nc)
    for form in forms:
        if form in by_norm:
            return by_norm[form]
    return None


def aggregate_orders(orders):
    items = {}
    total = 0
    order_ids = []
    first_closed = None
    for o in orders:
        order_ids.append(o["id"])
        total += o.get("total_money", {}).get("amount", 0)
        closed = o.get("closed_at")
        if closed and (first_closed is None or closed < first_closed):
            first_closed = closed
        for li in o.get("line_items", []):
            name = li.get("name", "?")
            qty = int(float(li.get("quantity", "1")))
            items[name] = items.get(name, 0) + qty
    item_text = ", ".join(f"{n}×{q}" if q > 1 else n for n, q in items.items())
    return {"items": item_text, "total": total, "order_ids": order_ids,
            "first_closed": first_closed}


def find_visit_record(records, customer_page_id, name_forms):
    for r in records:
        if customer_page_id in r["relation_ids"]:
            return r
    for r in records:
        title_norm = normalize_name(r["title"])
        for form in name_forms:
            if form and form in title_norm:
                return r
    return None


def days_since(last_visit_iso, biz_date):
    if not last_visit_iso:
        return None
    try:
        prev = date.fromisoformat(last_visit_iso[:10])
        return (biz_date - prev).days
    except ValueError:
        return None


def next_type(current_type, new_count):
    if new_count >= 5 and current_type in ("初来店", "2回目以降"):
        return "常連"
    if new_count >= 2 and current_type == "初来店":
        return "2回目以降"
    return current_type


# ──────────────────────────────
# Slack
# ──────────────────────────────

def post_slack(token, channel, text, dry_run):
    if dry_run:
        log.info(f"  [dry-run] Slack投稿 ({len(text)}文字):\n{text}")
        return
    chunks = []
    current = ""
    for line in text.split("\n"):
        if len(current) + len(line) + 1 > 2900:
            chunks.append(current)
            current = line
        else:
            current = f"{current}\n{line}" if current else line
    if current:
        chunks.append(current)
    blocks = [{"type": "section", "text": {"type": "mrkdwn", "text": c}} for c in chunks]
    resp = request_with_retry("POST", "https://slack.com/api/chat.postMessage",
                              headers={"Authorization": f"Bearer {token}",
                                       "Content-Type": "application/json"},
                              json_body={"channel": channel, "text": text[:3900],
                                         "blocks": blocks})
    data = resp.json()
    if not data.get("ok"):
        raise RuntimeError(f"Slack投稿エラー: {data.get('error')}")
    log.info("Slack投稿完了")


WEEKDAYS_JA = ["月", "火", "水", "木", "金", "土", "日"]


def build_message(biz_date, total_orders, visits, unmatched, new_customers, notes=None):
    d = f"{biz_date.month}/{biz_date.day}({WEEKDAYS_JA[biz_date.weekday()]})"
    lines = [f"*Square顧客連携 | {d} 営業分*"]
    attached = len(visits) + len(unmatched)
    lines.append(f"会計 {total_orders}件 / 顧客紐付き {attached}件")
    for n in (notes or []):
        lines.append(n)

    if visits:
        lines.append("")
        lines.append("*来店サマリー*")
        for v in visits:
            gap = f"前回から{v['gap']}日" if v["gap"] is not None else "初回"
            src = "" if v["created"] else " (Slack記録に追記)"
            auto = " (自動紐付け)" if v.get("auto") else ""
            lines.append(f"・{v['name']} — {v['count']}回目 / {gap} / ¥{v['total']:,}{src}{auto}")
            if v["items"]:
                lines.append(f"    {v['items']}")
    if unmatched:
        lines.append("")
        lines.append("*Notion未照合 (Slackの顧客情報入力で記録してください)*")
        for u in unmatched:
            lines.append(f"・{u['name']} — ¥{u['total']:,} ({u['items']})")
    if new_customers:
        lines.append("")
        lines.append("*Squareに新規登録された顧客*")
        src_ja = {"DIRECTORY": "店頭登録", "APPOINTMENTS": "ネット予約", "MERGE": "統合"}
        for c in new_customers:
            label = src_ja.get(c.get("creation_source"), c.get("creation_source", "?"))
            lines.append(f"・{square_display_name(c)} ({label})")
    if not visits and not unmatched:
        lines.append("顧客紐付きの会計はありませんでした。会計時の顧客紐付けを忘れずに。")
    return "\n".join(lines)


# ──────────────────────────────
# メイン
# ──────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--date", help="営業日 YYYY-MM-DD (既定: 直近の完了営業日)")
    parser.add_argument("--dry-run", action="store_true", help="書き込み・Slack投稿なし")
    args = parser.parse_args()

    biz_date = date.fromisoformat(args.date) if args.date else default_business_date()
    begin, end = business_window(biz_date)
    log.info(f"=== Square顧客連携 営業日 {biz_date} ({begin.isoformat()} 〜 {end.isoformat()}) ===")

    env = require_env("SQUARE_ACCESS_TOKEN", "SQUARE_LOCATION_ID",
                      "NOTION_TOKEN", "NOTION_VISIT_DB_ID", "NOTION_CUSTOMER_DB_ID",
                      "SLACK_BOT_TOKEN", "DAILY_CHANNEL_ID")

    verify_schema(env["NOTION_TOKEN"], env["NOTION_CUSTOMER_DB_ID"], env["NOTION_VISIT_DB_ID"])

    orders = fetch_orders(env["SQUARE_ACCESS_TOKEN"], env["SQUARE_LOCATION_ID"], begin, end)
    log.info(f"オーダー {len(orders)}件")

    payment_map = fetch_payment_customer_map(env["SQUARE_ACCESS_TOKEN"],
                                             env["SQUARE_LOCATION_ID"], begin, end)

    by_customer = {}
    for o in orders:
        cid = o.get("customer_id") or payment_map.get(o["id"])
        if cid:
            by_customer.setdefault(cid, []).append(o)
    log.info(f"顧客紐付きオーダー: {sum(len(v) for v in by_customer.values())}件 / {len(by_customer)}顧客")

    new_customers = fetch_new_square_customers(env["SQUARE_ACCESS_TOKEN"], begin, end)
    log.info(f"新規Square顧客 (INSTANT_PROFILE除く): {len(new_customers)}名")

    if biz_date.weekday() == 3 and not by_customer and not new_customers:
        log.info("木曜定休でデータなし。通知をスキップして終了")
        return

    notion_token = env["NOTION_TOKEN"]
    notion_customers = load_notion_customers(notion_token, env["NOTION_CUSTOMER_DB_ID"])
    log.info(f"Notion顧客: {len(notion_customers)}名")
    visit_records = load_visit_records(notion_token, env["NOTION_VISIT_DB_ID"], biz_date)
    log.info(f"対象期間の来店記録: {len(visit_records)}件")

    # Square顧客の解決: ID照合 → 名前照合 → 同夜1対1の自動紐付け
    sq_list = []
    for cid, cust_orders in by_customer.items():
        sq_cust = fetch_square_customer(env["SQUARE_ACCESS_TOKEN"], cid)
        if not sq_cust:
            continue
        # カード決済の自動生成顧客はスタッフの紐付け操作ではないため対象外
        if sq_cust.get("creation_source") == "INSTANT_PROFILE":
            log.info(f"INSTANT_PROFILEをスキップ: {square_display_name(sq_cust)}")
            continue
        sq_list.append((sq_cust, cust_orders))

    resolved = []
    pending = []
    for sq_cust, cust_orders in sq_list:
        m = match_notion_customer(sq_cust, notion_customers)
        if m:
            resolved.append((sq_cust, cust_orders, m, False))
        else:
            pending.append((sq_cust, cust_orders))

    # 表記が違っても、同じ夜に「Square側の未知の1人」と「Slack記録の未紐付けの1人」
    # しかいなければ同一人物とみなして自動紐付け (名前の類似を安全弁に)
    notes = []
    candidates = same_night_candidates(notion_customers, visit_records) if pending else []
    if (len(pending) == 1 and len(candidates) == 1
            and names_similar(pending[0][0], candidates[0]["name"])):
        sq_cust, cust_orders = pending.pop()
        cand = candidates[0]
        notion_patch_page(notion_token, cand["page_id"],
                          {"Square顧客ID": {"rich_text": [{"text": {"content": sq_cust["id"]}}]}},
                          args.dry_run)
        cand["square_id"] = sq_cust["id"]
        resolved.append((sq_cust, cust_orders, cand, True))
        notes.append(f"自動紐付け: Square「{square_display_name(sq_cust)}」= {cand['name']} "
                     f"(同夜の記録が1対1。違っていたら教えてください)")
        log.info(notes[-1])
    elif pending and candidates:
        cnames = " / ".join(c["name"] for c in candidates)
        notes.append(f"当夜のSlack記録で未紐付け: {cnames} — 未照合の会計と同一人物がいれば教えてください")

    visits = []
    unmatched = []
    for sq_cust, cust_orders in pending:
        agg = aggregate_orders(cust_orders)
        log.info(f"未照合: {square_display_name(sq_cust)}")
        unmatched.append({"name": square_display_name(sq_cust),
                          "total": agg["total"], "items": agg["items"]})

    for sq_cust, cust_orders, matched, auto_linked in resolved:
        agg = aggregate_orders(cust_orders)
        log.info(f"照合成功: {square_display_name(sq_cust)} → {matched['name']}")
        record = find_visit_record(visit_records, matched["page_id"],
                                   square_name_forms(sq_cust) + [normalize_name(matched["name"])])

        created = False
        if record:
            done_ids = set(filter(None, record["square_order_ids"].split(",")))
            todo_ids = [i for i in agg["order_ids"] if i not in done_ids]
            if not todo_ids:
                log.info(f"  処理済みスキップ: {matched['name']}")
                gap = days_since(matched["last_visit"], biz_date)
                visits.append({"name": matched["name"], "count": matched["count"],
                               "gap": gap if gap and gap > 0 else None,
                               "total": agg["total"], "items": agg["items"],
                               "created": False, "auto": auto_linked})
                continue
            square_line = f"[Square] {agg['items']} ¥{agg['total']:,}"
            new_text = f"{record['order_text']}\n{square_line}" if record["order_text"] else square_line
            props = {
                "注文したもの": {"rich_text": [{"text": {"content": new_text[:1900]}}]},
                "売上金額": {"number": agg["total"]},
                "Square注文ID": {"rich_text": [{"text": {"content": ",".join(sorted(done_ids | set(agg["order_ids"])))[:1900]}}]},
            }
            if matched["page_id"] not in record["relation_ids"]:
                props["お客様"] = {"relation": [{"id": rid} for rid in record["relation_ids"]] + [{"id": matched["page_id"]}]}
            notion_patch_page(notion_token, record["page_id"], props, args.dry_run)
            log.info(f"  既存来店記録に追記: {record['title']}")
            new_count = matched["count"]  # Slack転記側で加算済み
        else:
            created = True
            title = f"{biz_date.month}/{biz_date.day} {matched['name']}"
            props = {
                "日付メモ": {"title": [{"text": {"content": title}}]},
                "来店日": {"date": {"start": biz_date.isoformat()}},
                "お客様": {"relation": [{"id": matched["page_id"]}]},
                "注文したもの": {"rich_text": [{"text": {"content": f"[Square] {agg['items']}"[:1900]}}]},
                "売上金額": {"number": agg["total"]},
                "Square注文ID": {"rich_text": [{"text": {"content": ",".join(agg["order_ids"])[:1900]}}]},
                "記録元": {"select": {"name": "Square自動"}},
            }
            notion_create_page(notion_token, env["NOTION_VISIT_DB_ID"], props, args.dry_run)
            log.info(f"  来店記録を新規作成: {title}")
            new_count = matched["count"] + 1

        gap = days_since(matched["last_visit"], biz_date)
        cust_props = {"最終来店日": {"date": {"start": biz_date.isoformat()}}}
        if created:
            cust_props["来店回数"] = {"number": new_count}
            t = next_type(matched["type"], new_count)
            if t != matched["type"]:
                cust_props["タイプ"] = {"select": {"name": t}}
        if not matched["square_id"]:
            cust_props["Square顧客ID"] = {"rich_text": [{"text": {"content": sq_cust["id"]}}]}
        notion_patch_page(notion_token, matched["page_id"], cust_props, args.dry_run)

        visits.append({"name": matched["name"], "count": new_count,
                       "gap": gap if gap and gap > 0 else None,
                       "total": agg["total"], "items": agg["items"],
                       "created": created, "auto": auto_linked})

    # 前夜のSlack記録から生まれた新規客をSquareへ自動登録 (次回来店時に検索で出る)
    registered = register_missing_in_square(env["SQUARE_ACCESS_TOKEN"], notion_token,
                                            notion_customers, biz_date, args.dry_run)
    if registered:
        names = "、".join(n for n, _ in registered)
        notes.append(f"Squareに自動登録: {names} (次回来店からレジ検索で選べます)")

    visits.sort(key=lambda v: -v["total"])
    message = build_message(biz_date, len(orders), visits, unmatched, new_customers, notes)
    post_slack(env["SLACK_BOT_TOKEN"], env["DAILY_CHANNEL_ID"], message, args.dry_run)
    log.info(f"=== 完了: サマリー{len(visits)}名 / 未照合{len(unmatched)}名 / 新規{len(new_customers)}名 ===")


if __name__ == "__main__":
    main()
