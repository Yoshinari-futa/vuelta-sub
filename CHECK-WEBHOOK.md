# Webhook受信確認ガイド

## サーバーは正常に起動しています ✅

現在の状態：
- ✓ サーバーはポート3000で実行中
- ✓ メール送信設定は正常
- ✓ すべての環境変数が読み込まれています

## メールが来ない原因を特定する方法

### 1. 決済を実行してサーバーログを確認

決済を実行した際に、サーバーを起動しているターミナルに以下のようなログが表示されるはずです：

#### Webhookが受信された場合
```
=== Webhook received ===
Webhook event type: checkout.session.completed
=== Webhook received: checkout.session.completed ===
Session ID: cs_test_...
Customer ID: cus_...
Customer email: ...
Generating PassKit card...
```

#### Webhookが受信されていない場合
- 何もログが表示されません

### 2. よくある原因

#### 原因1: Webhookがローカルサーバーに届いていない ⚠️

**症状**: 決済を実行してもサーバーログに何も表示されない

**理由**: 
- StripeのWebhookはインターネット上に公開されているURLに送信されます
- `localhost:3000`はローカル環境のみで、インターネットからアクセスできません

**解決方法**:

**オプションA: Stripe CLIを使用（推奨）**

1. Stripe CLIをインストール（未インストールの場合）:
   ```bash
   brew install stripe/stripe-cli/stripe
   ```

2. Stripe CLIでWebhookを転送:
   ```bash
   stripe listen --forward-to localhost:3000/webhook/stripe
   ```
   
   このコマンドを実行すると、Webhookシークレットが表示されます：
   ```
   > Ready! Your webhook signing secret is whsec_... (^C to quit)
   ```

3. 表示されたWebhookシークレットを`.env`ファイルの`STRIPE_WEBHOOK_SECRET`に設定

4. 別のターミナルでテスト決済をトリガー:
   ```bash
   stripe trigger checkout.session.completed
   ```

**オプションB: ngrokを使用**

1. ngrokをインストール:
   ```bash
   brew install ngrok
   ```

2. ngrokでローカルサーバーを公開:
   ```bash
   ngrok http 3000
   ```

3. 表示されたURL（例: `https://xxxx.ngrok.io`）をStripeダッシュボードのWebhookエンドポイントに設定:
   - エンドポイントURL: `https://xxxx.ngrok.io/webhook/stripe`

#### 原因2: PassKit APIでエラーが発生

**症状**: `✗ Failed to generate PassKit card:` というエラーが表示される

**解決方法**: サーバーログのエラーメッセージを確認して、PassKit APIキーやTier IDを確認

#### 原因3: メール送信でエラーが発生

**症状**: `✗ Failed to send email to:` というエラーが表示される

**解決方法**: サーバーログのエラーメッセージを確認

## 次のステップ

1. **決済を実行**
2. **サーバーログを確認**（サーバーを起動しているターミナルを見る）
3. **ログの内容を共有**してください

ログに何も表示されない場合は、Webhookが受信されていない可能性が高いです。
その場合は、Stripe CLIまたはngrokを使用してWebhookを転送してください。
