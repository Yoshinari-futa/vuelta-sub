#!/usr/bin/env python3
"""
Notion お客様ノート → Square 顧客ディレクトリ 一括登録 (一回きりのバックフィル)

2026-07-27 時点で Notion に蓄積済みの顧客を Square に登録し、
POS 会計時に「検索して選ぶだけ」にする。同時に Notion 側の
「Square顧客ID」を埋め、square_customer_sync.py の ID 照合を
初日から有効にする。

- Square の姓欄 = Notion の呼び名そのまま (POS 検索用)
- Square に同一名(正規化一致)が既存なら作成せず紐付けのみ
- Notion の重複ページ(同一正規化名)は Square 1人に集約し、全ページに同じIDを書く
- 作成した Square 顧客の reference_id に Notion ページIDを刻む
- 対応表 CSV を --out に保存 (ロールバック用: created の行の square_id を削除すれば戻る)
"""

import argparse
import csv
import sys
import time
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from square_customer_sync import (  # noqa: E402
    require_env, request_with_retry, normalize_name, square_headers,
    notion_headers, load_notion_customers, log,
)


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
            raise RuntimeError(f"Square顧客一覧エラー: {resp.status_code} {resp.text[:200]}")
        data = resp.json()
        customers.extend(data.get("customers", []))
        cursor = data.get("cursor")
        if not cursor:
            return customers


def square_norm_forms(c):
    family = (c.get("family_name") or "").strip()
    given = (c.get("given_name") or "").strip()
    nickname = (c.get("nickname") or "").strip()
    forms = set()
    for f in [family, given, nickname, f"{family}{given}", f"{given}{family}"]:
        n = normalize_name(f)
        if n:
            forms.add(n)
    return forms


def create_square_customer(token, name, notion_page_id, dry_run):
    if dry_run:
        return f"dry-{notion_page_id[:8]}"
    body = {
        "idempotency_key": f"backfill-{notion_page_id}",
        "family_name": name,
        "reference_id": notion_page_id,
        "note": "Notionお客様ノートから一括登録 2026-07-27",
    }
    resp = request_with_retry("POST", "https://connect.squareup.com/v2/customers",
                              headers=square_headers(token), json_body=body)
    if resp.status_code != 200:
        raise RuntimeError(f"Square顧客作成エラー ({name}): {resp.status_code} {resp.text[:200]}")
    return resp.json()["customer"]["id"]


def write_notion_square_id(token, page_id, square_id, dry_run):
    if dry_run:
        return
    resp = request_with_retry(
        "PATCH", f"https://api.notion.com/v1/pages/{page_id}",
        headers=notion_headers(token),
        json_body={"properties": {
            "Square顧客ID": {"rich_text": [{"text": {"content": square_id}}]}}})
    if resp.status_code != 200:
        raise RuntimeError(f"Notion更新エラー ({page_id}): {resp.status_code} {resp.text[:150]}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--out", default="square_backfill_map.csv")
    args = parser.parse_args()

    env = require_env("SQUARE_ACCESS_TOKEN", "NOTION_TOKEN", "NOTION_CUSTOMER_DB_ID")

    notion_customers = load_notion_customers(env["NOTION_TOKEN"], env["NOTION_CUSTOMER_DB_ID"])
    log.info(f"Notion顧客: {len(notion_customers)}名")
    square_customers = fetch_all_square_customers(env["SQUARE_ACCESS_TOKEN"])
    log.info(f"Square既存顧客: {len(square_customers)}名")

    square_index = {}
    for c in square_customers:
        for form in square_norm_forms(c):
            square_index.setdefault(form, c)

    groups = {}   # 正規化名 → [notionページ,...]
    skipped = []
    for nc in notion_customers:
        norm = normalize_name(nc["name"])
        if not norm or "流入" in nc["name"] or "次回" in nc["name"]:
            skipped.append(nc["name"] or "(空タイトル)")
            continue
        groups.setdefault(norm, []).append(nc)

    log.info(f"正規化後ユニーク: {len(groups)}名 / スキップ: {len(skipped)}件")

    rows = []
    n_created = n_linked_existing = n_already = 0
    duplicates = []
    for norm, pages in sorted(groups.items()):
        primary = pages[0]
        if len(pages) > 1:
            duplicates.append(f"{primary['name']} ({len(pages)}ページ)")

        already = next((p["square_id"] for p in pages if p["square_id"]), "")
        if already:
            action, square_id = "already", already
            n_already += 1
        elif norm in square_index:
            action, square_id = "linked_existing", square_index[norm]["id"]
            n_linked_existing += 1
            log.info(f"既存Squareに紐付け: {primary['name']} → {square_id}")
        else:
            action = "created"
            square_id = create_square_customer(env["SQUARE_ACCESS_TOKEN"],
                                               primary["name"], primary["page_id"],
                                               args.dry_run)
            n_created += 1
            if not args.dry_run:
                time.sleep(0.2)

        for p in pages:
            if not p["square_id"]:
                write_notion_square_id(env["NOTION_TOKEN"], p["page_id"], square_id,
                                       args.dry_run)
            rows.append({"notion_name": p["name"], "notion_page_id": p["page_id"],
                         "square_id": square_id, "action": action})

    if not args.dry_run:
        with open(args.out, "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=["notion_name", "notion_page_id",
                                              "square_id", "action"])
            w.writeheader()
            w.writerows(rows)
        log.info(f"対応表を保存: {args.out}")

    mode = "[dry-run] " if args.dry_run else ""
    log.info(f"=== {mode}完了: Square新規作成 {n_created} / 既存Squareに紐付け {n_linked_existing} / "
             f"既にID有り {n_already} / Notion重複 {len(duplicates)}組 / スキップ {len(skipped)}件 ===")
    if duplicates:
        log.info("Notion重複ページ(Squareは1人に集約、掃除は別途承認タスク): " + " / ".join(duplicates))
    if skipped:
        log.info("スキップ: " + " / ".join(skipped[:20]))


if __name__ == "__main__":
    main()
