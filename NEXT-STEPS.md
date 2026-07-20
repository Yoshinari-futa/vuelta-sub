# NEXT-STEPS.md — 明日以降のための引き継ぎメモ

> **使い方**: セッション開始時に「`NEXT-STEPS.md` を読んで、プラン A の PassKit 設定を進めて」
> と Claude に伝えれば、この文書から文脈を取り戻して続きから進めます。

---

## 📅 2026-04-24 のセッションで完了したこと

| # | PR | 内容 | 状態 |
|---|---|---|---|
| 1 | #1 | ジオフェンス機能追加 + 共通モジュール化 | ✅ Merged |
| 2 | #2 | Stripe webhook でメールが届かない問題を修正（res.json を最後に移動） | ✅ Merged・動作確認済み |
| 3 | #3 | 紹介プログラム + フード1品無料クーポン機能（バックエンド） | ✅ Merged |
| 4 | #4 | `universal.info` 経由で Wallet 裏に紹介リンクを配信する試み | ✅ Merged（効果なし） |
| 5 | #5 | secondaryPoints + relevantDate で Wallet push を発火させる試み | ✅ Merged（効果限定的） |
| 7 | #7 | ジオフェンスのフィールド名を PassKit 形式に修正 | ✅ Merged（効果なし） |

**確定している実益:**
- Stripe 決済後に **ウェルカムメール + Wallet カードメール + Slack 通知** が必ず届くようになった
- 決済 → 入会のフローが初心者でもテストできる診断パス（`/health`, `/list-members`）が整備済み

---

## 🚨 残っている問題（プラン A で解決する）

### 問題の全体像

PassKit REST API で以下の更新を試みたが、**PUT が 200 を返すにもかかわらず実際には保存されない**:

- `passOverrides.locations`（ジオフェンス座標）→ 全メンバーで `lat:0, lon:0` のまま
- `passOverrides.imageIds`（カード画像）→ `null` のまま
- `passOverrides.backFields`（カード裏の追加フィールド）→ そもそもレスポンスに存在しない
- `passOverrides.relevantDate`（push 発火用）→ レスポンスに存在しない

一方、`metaData`（top-level）と `secondaryPoints` は PUT で更新される。

### 結論: **PassKit のテンプレート設定は Dashboard（Designer）でしか変更できない**

- API は member 単位で `metaData` や `points` は上書き可能
- しかし `passOverrides` はテンプレートから継承する読み取り専用に近い
- geofence、image、back field などは **テンプレート側で設定** する必要がある
- `/set-geofence` エンドポイントが叩く `template_get_failed` はこれの証拠（API からテンプレートは触れない）

---

## 🎯 明日やること（プラン A: PassKit Dashboard で手動設定）

### 前提情報

- **PassKit プログラム ID**: `4tKgN425sFQKWAAdLF5kH5`
- **プログラム名**: VUELTA FIRST-DRINK PASS
- **ホスト**: `https://api.pub2.passkit.io`
- **Pass Type Identifier**: `pass.com.vuelta.membership`

### 触る 5 つのテンプレート

| ティア | Template ID |
|---|---|
| Base | `5XDN0eRvqsF8tcxERa438o` |
| Gold | `7pvljCV6FJGp4Vmko76y08` |
| Silver | `6CjMtVAxW9lq3fPtcjGtf8` |
| Black | `5OjLWYeATH7CkTjJWRk8Nr` |
| Rainbow | `2vpAN1NnOl5cIT4roEsLNo` |

### ログイン先

PassKit の管理画面（dashboard）。URL は恐らく:
- `https://app.passkit.com` か
- `https://dashboard.passkit.com`

Futa さんが過去ログインした履歴があるはず。env の `PASSKIT_API_KEY` と `PASSKIT_API_KEY_SECRET` を発行したときに使ったアカウントでログイン。

### 各テンプレートで設定する項目

#### A. ジオフェンス（Locations）

1. テンプレート編集画面を開く
2. 「Locations」セクション（または「Geofence」）を探す
3. 新規追加:
   - **Latitude**: `34.3893066`
   - **Longitude**: `132.4541823`
   - **Radius (maxDistance)**: `300` メートル
   - **Relevant Text / Lock Screen Message**: `You're near VUELTA. How about a drink tonight?`
4. 保存

※ 環境変数 `VUELTA_GEOFENCE_LAT/LNG/TEXT` で上書き可能にしてあるが、テンプレ側は固定値で OK。

#### B. Information 欄（紹介リンク用）

現状: デフォルトの "Tell your members about their exclusive benefits here." が表示されている。

選択肢 1（簡単）: **Information フィールドを「動的」に変更**
- field key を `universal.info` にする（既にコード側はこの key に URL を書いている）
- Default value は空でも可
- Change Message: `VUELTA: %@`（過去の実装を踏襲）

選択肢 2（推奨）: **新しい Back Field を追加**
- key: `referral`
- label: `Introduce a friend`
- Default value: 空
- これでコード側の `passOverrides.backFields` で push される URL が見える

→ **選択肢 2 を推奨**（Information の reminder 用途と切り分けられる）

#### C. カード画像（任意）

現状 `imageIds: null` のままでもカードは表示できている。
もし過去に strip 画像がちゃんと入っていたなら触らなくて OK。
もし入れたい場合は、テンプレート側でアップロードし直す。

### 作業完了後の確認

1. ブラウザで `https://subsc-webhook.vercel.app/set-geofence` を実行
2. `https://subsc-webhook.vercel.app/list-members` で生データ確認
3. `passOverrides.locations` に `lat:34.38, lon:132.45, lockScreenMessage:"..."` が入っていれば成功
4. iPhone の Wallet カード裏の Information / Introduce a friend 欄が更新されているか確認
5. お店付近で「VUELTA is near you」的なロック画面通知が出るか実機テスト

---

## 🅱️ プラン B（α が難しかった場合の代替案）

PassKit Designer での編集が難しい or 時間がかかりすぎる場合:

1. **ウェルカムメールに紹介情報を追加**（`create-member.js` / `webhook/stripe.js` のメールテンプレ）
   - 「Your referral link: `https://subsc-webhook.vercel.app/share/<your-id>`」を含める
   - 会員は必要時にそのメールを見返せばよい
2. **ジオフェンスは一旦諦める**
3. Plan A に戻るタイミングで改めて検討

---

## 📂 ファイルマップ（明日参照するもの）

```
lib/
  geofence.js          — geofence 座標/文言 定義（env 上書き可）
  referral.js          — 紹介リンク URL / backFields ヘルパー
  coupons.js           — foodCoupons 読み書き
  wallet-push.js       — secondaryPoints + relevantDate 発火ヘルパー

api/
  webhook/stripe.js    — Stripe 決済後のメイン処理
  create-member.js     — 手動会員作成
  scan.js              — 来店スキャン（紹介成立で coupon +1）
  set-geofence.js      — 全メンバー一括更新（診断兼ねる）
  use-coupon.js        — クーポン消費エンドポイント
  referral-redirect.js — /r/<id> Stripe Payment Link へリダイレクト
  share-page.js        — /share/<id> QR + コピーリンクのページ
  health.js            — 診断エンドポイント
  list-members.js      — 生データ閲覧（デバッグ用）

public/
  scanner.html         — バーテンダー用スキャン画面（🍽️ 表示あり）
  thanks.html          — Stripe 決済完了後のランディング
  cancel.html          — 解約ページ
```

---

## 🔑 重要な env（Vercel に設定済み）

- `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` / `STRIPE_PRICE_ID`
- `PASSKIT_HOST` / `PASSKIT_API_KEY` / `PASSKIT_API_KEY_SECRET` / `PASSKIT_PROGRAM_ID`
- `PASSKIT_TIER_ID`: 現状 `black` だが **使われていない**（create-member.js は TIER_BASE ハードコード）。将来削除可。
- `EMAIL_FROM` / `EMAIL_SERVICE` / `EMAIL_USER` / `EMAIL_PASS`
- `SCAN_PIN`（バーテンダー画面用）
- `GEOFENCE_SECRET`（`/set-geofence` 認証用、未設定なら認証なしで通る実装）
- `SLACK_WEBHOOK_URL`（布田さんの DM: `D09TV05303C`）
- `VUELTA_GEOFENCE_LAT` / `VUELTA_GEOFENCE_LNG` / `VUELTA_GEOFENCE_TEXT`（optional、env で座標/文言上書き）

---

## 💰 Stripe 情報

- **Payment Link**: `https://buy.stripe.com/cNi7sK0NG9yL7k5cMk6Zy02`
- **サブスク料金**: ¥1,980/月
- **Webhook エンドポイント**: `https://subsc-webhook.vercel.app/webhook/stripe`
- **購読イベント**: `checkout.session.completed`, `customer.subscription.deleted`

---

## 📝 明日の会話の始め方テンプレ

以下どれかで OK:

> 「NEXT-STEPS.md を読んで、プラン A の PassKit 設定を一緒に進めて」

> 「昨日の続き。PassKit Designer でテンプレート 5 つを設定する手順を教えて」

> 「geofence の件、PassKit ダッシュボード開いた。どこ触ればいい？」

---

## 🙏 昨日の振り返り

- **うまくいったこと**: Stripe メール復旧、診断エンドポイント整備、紹介機能のバックエンド実装
- **詰まったこと**: PassKit API の `passOverrides` が PUT で更新できないことを最初に見抜けず、2 時間迷走
- **学び**: PassKit は「member データは API で」「pass の見た目は Designer で」と役割分担している。この前提を早めに把握すべきだった

お疲れさまでした。
