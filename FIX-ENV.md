# .envファイルの修正方法

## 現在の問題点

現在の`.env`ファイルには以下の問題があります：

1. **括弧内の値が含まれている**: `sk_test_...（実際の値）`という形式になっている
2. **不要な文字**: 12行目に不要な```がある
3. **値の形式**: 環境変数の値は括弧なしで直接記述する必要がある

## 修正方法

`.env`ファイルを以下の形式に修正してください：

```env
# Stripe設定
STRIPE_SECRET_KEY=sk_test_your_stripe_secret_key_here
STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret_here

# PassKit設定
PASSKIT_API_KEY=https://api.pub2.passkit.io
PASSKIT_API_KEY_SECRET=your_passkit_api_key_secret_here
PASSKIT_TIER_ID=your_passkit_tier_id_here

# メール設定
EMAIL_FROM=noreply@vuelta.jp
EMAIL_SERVICE=gmail
EMAIL_USER=your_email@gmail.com
EMAIL_PASS=your_app_password

# その他
FRONTEND_URL=https://your-domain.com
PORT=3000
```

## 重要なポイント

1. **括弧を削除**: `（実際の値）`の部分を削除し、値だけを記述
2. **等号の後**: `=`の後にスペースを入れず、直接値を記述
3. **引用符不要**: 値に引用符（`"`や`'`）は不要
4. **コメント**: `#`で始まる行はコメントとして扱われる

## 修正後の確認

修正後、サーバーを再起動して以下のメッセージが表示されるか確認：

```
✓ Environment variables loaded
✓ Stripe Secret Key: Set
✓ Stripe Webhook Secret: Set
✓ PassKit Tier ID: 553OicVbQ5uwlwUhnzUEvy
✓ Mail transporter configured successfully
```

## メール設定について

現在の設定：
- `EMAIL_USER=head_office@vuelta-hr.com`
- `EMAIL_PASS=zmnqvdshzlteyshf`

このパスワードがGmailアプリパスワード（16文字）であることを確認してください。
通常のGmailパスワードでは動作しません。

## トラブルシューティング

修正後もメールが送信されない場合：

1. サーバーを再起動
2. ログを確認してエラーメッセージを確認
3. `/test-email`エンドポイントでテスト

```bash
curl -X POST http://localhost:3000/test-email \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "name": "Test User"
  }'
```
