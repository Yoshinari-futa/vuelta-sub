# Webhookエンドポイントの動作確認方法

## 「Cannot GET /webhook/stripe」について

このエラーは**正常な動作**です。理由：

1. **WebhookエンドポイントはPOSTメソッドのみ受け付けます**
   - ブラウザでURLを開くとGETリクエストが送られます
   - Webhookエンドポイントは `app.post()` で定義されているため、GETリクエストは拒否されます

2. **セキュリティ上の理由**
   - WebhookエンドポイントはStripeからのPOSTリクエストのみを受け付けるべきです
   - ブラウザから直接アクセスできないようにするのは正しい設計です

## 正しい動作確認方法

### 1. ヘルスチェックエンドポイント（GET）

ブラウザで開くか、curlで確認：

```bash
# ブラウザで開く
http://localhost:3000/health

# または curl
curl http://localhost:3000/health
```

正常な応答：
```json
{
  "status": "ok",
  "timestamp": "2026-01-25T05:57:02.076Z"
}
```

### 2. Webhookエンドポイント（POST）

**ブラウザでは確認できません**。ターミナルでcurlを使用：

```bash
curl -X POST http://localhost:3000/webhook/stripe \
  -H "Content-Type: application/json" \
  -d '{"test": "data"}'
```

正常な応答（署名がない場合）：
```
Webhook Error: No stripe-signature header value was provided.
```

これは正常です。Stripeからのリクエストには署名ヘッダーが必要ですが、テストリクエストには含まれていないためです。

### 3. メール送信テストエンドポイント（POST）

```bash
curl -X POST http://localhost:3000/test-email \
  -H "Content-Type: application/json" \
  -d '{
    "email": "your-email@example.com",
    "name": "Test User",
    "walletUrl": "https://example.com/wallet-card.pkpass"
  }'
```

## サーバーの動作確認

### ブラウザで確認できるエンドポイント

- ✅ **ヘルスチェック**: http://localhost:3000/health
  - サーバーが起動しているか確認できます

### ブラウザでは確認できないエンドポイント

- ❌ **Webhook**: http://localhost:3000/webhook/stripe
  - POSTメソッドのみ受け付けます
  - Stripeからのリクエスト専用です

- ❌ **メール送信テスト**: http://localhost:3000/test-email
  - POSTメソッドのみ受け付けます

## まとめ

- ✅ **サーバーは正常に動作しています**
- ✅ **「Cannot GET /webhook/stripe」は正常な動作です**
- ✅ **ヘルスチェックエンドポイントで動作確認できます**

Webhookエンドポイントは、Stripeからの実際の決済完了イベントが発生したときに自動的に呼び出されます。ブラウザから直接アクセスする必要はありません。
