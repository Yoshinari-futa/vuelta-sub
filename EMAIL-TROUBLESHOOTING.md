# メール送信トラブルシューティングガイド

## メールが送信されない場合の確認事項

### 1. 環境変数の確認

`.env`ファイルに以下の設定があるか確認してください：

```env
EMAIL_USER=your_email@gmail.com
EMAIL_PASS=your_app_password
EMAIL_FROM=noreply@vuelta.jp
EMAIL_SERVICE=gmail
```

### 2. Gmailアプリパスワードの設定

Gmailを使用する場合、通常のパスワードではなく**アプリパスワード**が必要です。

#### アプリパスワードの取得方法：

1. Googleアカウントにログイン
2. [Googleアカウント設定](https://myaccount.google.com/)にアクセス
3. **セキュリティ** → **2段階認証プロセス**を有効化（まだの場合）
4. **アプリパスワード**を選択
5. **アプリを選択** → **その他（カスタム名）** → 名前を入力（例: "VUELTA Server"）
6. **生成**をクリック
7. 表示された16文字のパスワードをコピーして`.env`の`EMAIL_PASS`に設定

**重要**: 通常のGmailパスワードでは動作しません。必ずアプリパスワードを使用してください。

### 3. サーバーログの確認

サーバーを起動した際に、以下のメッセージが表示されるか確認してください：

```
✓ Mail transporter configured successfully
```

このメッセージが表示されない場合、メール設定に問題があります。

### 4. Webhookが正しく受信されているか確認

サーバーログに以下のようなメッセージが表示されるか確認：

```
=== Webhook received: checkout.session.completed ===
Session ID: cs_test_...
Customer ID: cus_...
Customer email: test@example.com
```

このメッセージが表示されない場合、Webhookが正しく受信されていない可能性があります。

### 5. メール送信テスト

サーバーが起動している状態で、以下のコマンドでメール送信をテストできます：

```bash
curl -X POST http://localhost:3000/test-email \
  -H "Content-Type: application/json" \
  -d '{
    "email": "your-test-email@example.com",
    "name": "Test User",
    "walletUrl": "https://example.com/wallet-card.pkpass"
  }'
```

正常な場合の応答：
```json
{
  "success": true,
  "message": "Test email sent successfully to your-test-email@example.com"
}
```

エラーの場合の応答：
```json
{
  "success": false,
  "error": "Error message here",
  "details": {
    "code": "EAUTH",
    "response": "535-5.7.8 Username and Password not accepted"
  }
}
```

### 6. よくあるエラーと解決方法

#### エラー: `EAUTH` または `535-5.7.8 Username and Password not accepted`

**原因**: Gmailアプリパスワードが正しく設定されていない、または通常のパスワードを使用している

**解決方法**:
- アプリパスワードを再生成
- `.env`ファイルの`EMAIL_PASS`を更新
- サーバーを再起動

#### エラー: `Mail transporter is not configured`

**原因**: `EMAIL_USER`または`EMAIL_PASS`が設定されていない

**解決方法**:
- `.env`ファイルに`EMAIL_USER`と`EMAIL_PASS`を設定
- サーバーを再起動

#### エラー: `No email address found for customer`

**原因**: Stripeのセッションにメールアドレスが含まれていない

**解決方法**:
- Stripeの決済リンクでメールアドレスの収集を有効化
- 顧客がメールアドレスを入力しているか確認

#### Webhookが受信されない

**原因**: Stripe Webhookの設定が正しくない

**解決方法**:
1. Stripeダッシュボード → **開発者** → **Webhooks**
2. Webhookエンドポイントが正しく設定されているか確認
3. イベント`checkout.session.completed`が選択されているか確認
4. Webhookシークレットが`.env`の`STRIPE_WEBHOOK_SECRET`と一致しているか確認

### 7. ログの確認方法

サーバーのログを確認して、エラーメッセージを探してください：

```bash
# サーバーを起動してログを確認
npm start

# または、ログをファイルに保存
npm start > server.log 2>&1
```

ログに表示されるエラーメッセージから、問題の原因を特定できます。

### 8. 代替メールサービス

Gmailで問題が解決しない場合、以下のサービスも使用できます：

#### SendGrid
```env
EMAIL_SERVICE=sendgrid
EMAIL_USER=apikey
EMAIL_PASS=your_sendgrid_api_key
```

#### Mailgun
```env
EMAIL_SERVICE=mailgun
EMAIL_USER=your_mailgun_username
EMAIL_PASS=your_mailgun_password
```

### 9. デバッグモードの有効化

より詳細なログを取得するには、サーバー起動時に環境変数を設定：

```bash
DEBUG=* npm start
```

## サポート

問題が解決しない場合、以下の情報を含めてお問い合わせください：

1. サーバーログのエラーメッセージ
2. `.env`ファイルの設定（パスワードは除く）
3. 使用しているメールサービス（Gmail、SendGridなど）
4. Webhookが受信されているかどうか
