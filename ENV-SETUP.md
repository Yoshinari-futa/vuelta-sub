# 環境変数設定ガイド

## .envファイルの作成

プロジェクトルートに`.env`ファイルを作成し、以下の内容を設定してください：

```env
STRIPE_SECRET_KEY=sk_test_your_stripe_secret_key_here
STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret_here
PASSKIT_API_KEY=https://api.pub2.passkit.io
PASSKIT_API_KEY_SECRET=your_actual_passkit_api_key_here
PASSKIT_TIER_ID=your_passkit_tier_id_here
EMAIL_FROM=noreply@vuelta.jp
EMAIL_SERVICE=gmail
EMAIL_USER=your_email@gmail.com
EMAIL_PASS=your_app_password
FRONTEND_URL=https://your-domain.com
PORT=3000
```

## 重要な注意事項

1. **PASSKIT_API_KEY_SECRET**: `PASSKIT_API_KEY`がURLの場合は、実際のAPIキーを`PASSKIT_API_KEY_SECRET`に設定してください
2. **EMAIL_PASS**: Gmailを使用する場合、アプリパスワードを設定する必要があります
3. **FRONTEND_URL**: 実際のドメインに変更してください

## サーバー起動方法

```bash
# 1. 依存パッケージのインストール（初回のみ）
npm install

# 2. .envファイルを作成（上記の内容をコピー）

# 3. サーバー起動
node server-example.js
```

## 動作確認

サーバーが起動すると、以下のメッセージが表示されます：

```
✓ Server running on port 3000
✓ Webhook endpoint: http://localhost:3000/webhook/stripe
```

ヘルスチェックエンドポイントにアクセスして確認：
```bash
curl http://localhost:3000/health
```
