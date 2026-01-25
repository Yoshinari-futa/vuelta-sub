# Webhookデバッグガイド

## メールが来ない場合の確認事項

### 1. サーバーログの確認

サーバーを起動しているターミナルで、以下のメッセージが表示されているか確認：

#### Webhookが受信された場合
```
=== Webhook received: checkout.session.completed ===
Session ID: cs_test_...
Customer ID: cus_...
Customer email: ...
```

#### PassKit処理中
```
Generating PassKit card...
Creating PassKit member for ...
✓ PassKit member created: ...
PassKit wallet URL: ...
```

#### メール送信時
```
Sending email to ...
✓ Email sent successfully to ...
```

### 2. エラーログの確認

以下のようなエラーメッセージがないか確認：

```
✗ Error processing membership:
✗ Failed to generate PassKit card:
✗ Failed to send email to:
```

### 3. Webhookが受信されているか確認

Stripeダッシュボードで確認：
1. Stripeダッシュボード → **開発者** → **Webhooks**
2. Webhookイベントのログを確認
3. `checkout.session.completed`イベントが送信されているか確認
4. レスポンスコードが200か確認

### 4. よくある問題

#### 問題1: Webhookが受信されていない

**症状**: サーバーログに何も表示されない

**原因**:
- Webhookエンドポイントが正しく設定されていない
- ローカルサーバーにWebhookが届いていない（本番URLが必要）

**解決方法**:
- Stripe CLIを使用してローカルでテスト: `stripe listen --forward-to localhost:3000/webhook/stripe`
- または、ngrokなどでローカルサーバーを公開

#### 問題2: PassKit APIエラー

**症状**: `✗ Failed to generate PassKit card:` というエラー

**原因**:
- PassKit APIキーが正しくない
- PassKit Tier IDが正しくない
- PassKit APIのレスポンス構造が異なる

**解決方法**:
- サーバーログの`PassKit API error:`を確認
- PassKit APIキーとTier IDを確認

#### 問題3: メール送信エラー

**症状**: `✗ Failed to send email to:` というエラー

**原因**:
- Gmailアプリパスワードが正しくない
- メール送信設定が正しくない

**解決方法**:
- サーバーログのエラーメッセージを確認
- `/test-email`エンドポイントでテスト

## デバッグ方法

### 1. 詳細ログの確認

サーバーを起動して、決済を実行した際のログをすべて確認してください。

### 2. Stripe CLIでローカルテスト

```bash
# Stripe CLIをインストール（未インストールの場合）
brew install stripe/stripe-cli/stripe

# Stripe CLIでWebhookを転送
stripe listen --forward-to localhost:3000/webhook/stripe
```

別のターミナルで：
```bash
# テスト決済をトリガー
stripe trigger checkout.session.completed
```

### 3. メール送信のテスト

```bash
curl -X POST http://localhost:3000/test-email \
  -H "Content-Type: application/json" \
  -d '{
    "email": "your-email@example.com",
    "name": "Test User",
    "walletUrl": "https://example.com/wallet-card.pkpass"
  }'
```

## ログの保存方法

サーバーのログをファイルに保存：

```bash
npm start > server.log 2>&1
```

その後、`server.log`ファイルを確認してください。
