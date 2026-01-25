# Webhookテスト手順

## ステップ1: Stripe CLIのインストール（未インストールの場合）

```bash
brew install stripe/stripe-cli/stripe
```

## ステップ2: Stripe CLIでログイン

```bash
stripe login
```

ブラウザが開くので、Stripeアカウントでログインしてください。

## ステップ3: Webhookを転送

**新しいターミナルウィンドウを開いて**、以下のコマンドを実行：

```bash
stripe listen --forward-to localhost:3000/webhook/stripe
```

このコマンドを実行すると、以下のようなメッセージが表示されます：

```
> Ready! Your webhook signing secret is whsec_xxxxxxxxxxxxx (^C to quit)
```

**重要**: このWebhookシークレットをコピーしてください。

## ステップ4: Webhookシークレットを更新

`.env`ファイルの`STRIPE_WEBHOOK_SECRET`を、ステップ3で表示されたシークレットに更新：

```env
STRIPE_WEBHOOK_SECRET=whsec_xxxxxxxxxxxxx
```

## ステップ5: サーバーを再起動

`.env`ファイルを更新したら、サーバーを再起動：

```bash
# サーバーを停止（Ctrl + C）
# その後、再起動
npm start
```

## ステップ6: テスト決済をトリガー

**別のターミナルウィンドウで**、以下のコマンドを実行：

```bash
stripe trigger checkout.session.completed
```

## ステップ7: サーバーログを確認

サーバーを起動しているターミナルに、以下のようなログが表示されるはずです：

```
=== Webhook received ===
Webhook event type: checkout.session.completed
=== Webhook received: checkout.session.completed ===
Session ID: evt_...
Customer ID: cus_...
Customer email: ...
Generating PassKit card...
Creating PassKit member for ...
✓ PassKit member created: ...
PassKit wallet URL: ...
Sending email to ...
✓ Email sent successfully to ...
```

## トラブルシューティング

### Stripe CLIが見つからない場合

```bash
# Homebrewでインストール
brew install stripe/stripe-cli/stripe

# または、直接ダウンロード
# https://stripe.com/docs/stripe-cli
```

### Webhookが転送されない場合

1. サーバーが起動しているか確認: `curl http://localhost:3000/health`
2. ポート3000が使用可能か確認: `lsof -i :3000`
3. Stripe CLIのログを確認

### メールが送信されない場合

サーバーログにエラーメッセージが表示されているか確認してください。
