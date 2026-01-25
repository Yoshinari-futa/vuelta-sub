# 本番環境への移行ガイド

## テスト環境から本番環境への変更点

### 1. Stripe設定の変更

#### 現在（テスト環境）
```env
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

#### 本番環境
```env
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...（本番用Webhookシークレット）
```

**変更手順**:
1. Stripeダッシュボードにログイン
2. **開発者** → **APIキー** に移動
3. **本番用シークレットキー**をコピー（`sk_live_...`で始まる）
4. `.env`ファイルの`STRIPE_SECRET_KEY`を更新

### 2. Stripe Webhook設定

#### 本番用Webhookエンドポイントの設定

1. Stripeダッシュボード → **開発者** → **Webhooks**
2. **エンドポイントを追加** をクリック
3. エンドポイントURL: `https://your-domain.com/webhook/stripe`
   - 本番サーバーのURLを設定
   - 例: `https://api.vuelta.jp/webhook/stripe`
4. イベントを選択: `checkout.session.completed`
5. **エンドポイントを追加** をクリック
6. 表示された**署名シークレット**をコピー
7. `.env`ファイルの`STRIPE_WEBHOOK_SECRET`を更新

### 3. PassKit設定の確認

PassKitの設定は通常、テスト環境と本番環境で同じAPIキーを使用しますが、確認してください：

```env
PASSKIT_API_KEY=https://api.pub2.passkit.io
PASSKIT_API_KEY_SECRET=giGvBqhctSlS7QLhVAOPuuhCHKs2RUvwuIaqOm6t
PASSKIT_TIER_ID=553OicVbQ5uwlwUhnzUEvy
```

### 4. フロントエンドURLの更新

```env
FRONTEND_URL=https://your-domain.com
```

実際のドメインに変更してください。例：
```env
FRONTEND_URL=https://vuelta.jp
```

### 5. メール設定の確認

本番環境でも同じメール設定を使用できますが、確認してください：

```env
EMAIL_FROM=noreply@vuelta.jp
EMAIL_SERVICE=gmail
EMAIL_USER=head_office@vuelta-hr.com
EMAIL_PASS=zmnqvdshzlteyshf
```

### 6. 環境変数の完全なリスト（本番用）

```env
# Stripe（本番用）
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...

# PassKit
PASSKIT_API_KEY=https://api.pub2.passkit.io
PASSKIT_API_KEY_SECRET=giGvBqhctSlS7QLhVAOPuuhCHKs2RUvwuIaqOm6t
PASSKIT_TIER_ID=553OicVbQ5uwlwUhnzUEvy
PASSKIT_PROGRAM_ID=default

# メール
EMAIL_FROM=noreply@vuelta.jp
EMAIL_SERVICE=gmail
EMAIL_USER=head_office@vuelta-hr.com
EMAIL_PASS=zmnqvdshzlteyshf

# その他
FRONTEND_URL=https://vuelta.jp
PORT=3000
```

## 本番環境へのデプロイ

### オプション1: クラウドサーバー（VPS、AWS EC2など）

1. サーバーにNode.jsをインストール
2. プロジェクトファイルをアップロード
3. `.env`ファイルを本番用に設定
4. `npm install`で依存関係をインストール
5. PM2などでサーバーを起動

```bash
# PM2を使用する場合
npm install -g pm2
pm2 start server-example.js --name vuelta-webhook
pm2 save
pm2 startup
```

### オプション2: Heroku

1. Herokuアカウントを作成
2. Heroku CLIをインストール
3. プロジェクトをHerokuにデプロイ

```bash
heroku create vuelta-webhook
heroku config:set STRIPE_SECRET_KEY=sk_live_...
heroku config:set STRIPE_WEBHOOK_SECRET=whsec_...
# 他の環境変数も設定
git push heroku main
```

### オプション3: Vercel / Netlify Functions

サーバーレス関数としてデプロイする場合、コードを少し変更する必要があります。

## セキュリティチェックリスト

- [ ] `.env`ファイルが`.gitignore`に含まれているか確認
- [ ] 本番環境の`.env`ファイルにテスト用のキーが残っていないか確認
- [ ] HTTPSが有効になっているか確認
- [ ] Webhookシークレットが正しく設定されているか確認
- [ ] メール送信設定が正しく動作するか確認

## 動作確認

本番環境にデプロイ後：

1. ヘルスチェックエンドポイントを確認：
   ```bash
   curl https://your-domain.com/health
   ```

2. StripeダッシュボードでWebhookのログを確認
3. 実際の決済をテスト（少額で）
4. メールが正しく送信されるか確認

## トラブルシューティング

### Webhookが受信されない

- WebhookエンドポイントURLが正しいか確認
- HTTPSが有効になっているか確認
- サーバーのログを確認

### メールが送信されない

- メール設定が正しいか確認
- サーバーのログを確認
- Gmailアプリパスワードが有効か確認
