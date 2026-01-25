# Stripe + PassKit 連携実装ガイド（方法B）

## 概要
Stripe決済完了後、その顧客専用の会員証URLをメールで自動送信する実装方法です。

## 必要なもの
1. **バックエンドサーバー**（Node.js推奨）
2. **Stripeアカウント**（Webhook設定）
3. **PassKitアカウント**（APIキー）
4. **メール送信サービス**（SendGrid、Mailgun、AWS SESなど）

## 実装ステップ

### 1. バックエンドサーバーのセットアップ

#### Node.js + Express の場合

```bash
npm init -y
npm install express stripe @passkit/passkit dotenv nodemailer
```

#### 必要な環境変数（.env）

```env
STRIPE_SECRET_KEY=sk_test_your_stripe_secret_key_here
STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret_here
PASSKIT_API_KEY=https://api.pub2.passkit.io
PASSKIT_API_KEY_SECRET=your_passkit_api_key_secret_here
PASSKIT_TIER_ID=your_passkit_tier_id_here
EMAIL_FROM=noreply@vuelta.jp
EMAIL_SERVICE=gmail  # または sendgrid, mailgun など
EMAIL_USER=your_email@gmail.com
EMAIL_PASS=your_app_password
FRONTEND_URL=https://your-domain.com
```

### 2. Webhookエンドポイントの実装

`server.js` を作成：

```javascript
const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { PassKit } = require('@passkit/passkit');
const nodemailer = require('nodemailer');

const app = express();
app.use(express.json({ verify: (req, res, buf) => {
    req.rawBody = buf.toString();
}}));

// メール送信設定
const transporter = nodemailer.createTransport({
    service: process.env.EMAIL_SERVICE,
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

// PassKit初期化
const passkit = new PassKit({
    apiKey: process.env.PASSKIT_API_KEY
});

// Webhookエンドポイント
app.post('/webhook/stripe', express.raw({type: 'application/json'}), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;

    try {
        event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
        console.log(`Webhook signature verification failed.`, err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // 決済成功イベントを処理
    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        
        try {
            // 顧客情報を取得
            const customer = await stripe.customers.retrieve(session.customer);
            const customerEmail = customer.email;
            const customerName = customer.name || 'VUELTA Member';

            // PassKitで顧客専用の会員証を生成
            const memberData = {
                tierId: process.env.PASSKIT_TIER_ID,
                programId: process.env.PASSKIT_PROGRAM_ID || 'default',
                person: {
                    displayName: customerName,
                    externalId: session.customer
                },
                externalId: session.customer,
                points: 0,
                tierPoints: 0
            };

            const member = await passkit.members.create(memberData);
            const pass = await passkit.members.getPass(member.id);
            const walletUrl = pass.downloadUrl; // Apple Wallet / Google Wallet用URL

            // メール送信
            const mailOptions = {
                from: process.env.EMAIL_FROM,
                to: customerEmail,
                subject: 'VUELTA Membership - 会員証のご案内',
                html: `
                    <h2>Welcome to VUELTA!</h2>
                    <p>ご入会ありがとうございます。</p>
                    <p>会員証の準備が整いました。下のリンクからスマートフォンに追加してください。</p>
                    <p><a href="${walletUrl}" style="display: inline-block; padding: 12px 24px; background-color: #1a2e1a; color: white; text-decoration: none; border-radius: 4px;">Add to Wallet</a></p>
                    <p>または、こちらのURLをコピーしてブラウザで開いてください：</p>
                    <p>${walletUrl}</p>
                `
            };

            await transporter.sendMail(mailOptions);
            console.log(`Membership card sent to ${customerEmail}`);

        } catch (error) {
            console.error('Error processing membership:', error);
        }
    }

    res.json({received: true});
});

// ヘルスチェック
app.get('/health', (req, res) => {
    res.json({status: 'ok'});
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
```

### 3. Stripe Webhookの設定

1. Stripeダッシュボードにログイン
2. **開発者** > **Webhooks** に移動
3. **エンドポイントを追加** をクリック
4. エンドポイントURL: `https://your-domain.com/webhook/stripe`
5. イベントを選択: `checkout.session.completed`
6. Webhookシークレットをコピーして `.env` に設定

### 4. PassKitの設定

1. PassKitアカウントでTier（階層）を作成
2. Tier IDを取得
3. APIキーを取得
4. `.env` に設定
   - `PASSKIT_API_KEY`: PassKitのAPIキー
   - `PASSKIT_TIER_ID`: 作成したTierのID

### 5. デプロイ

#### Vercel / Netlify Functions の場合

`api/webhook.js` を作成：

```javascript
// Vercel Serverless Function
export default async function handler(req, res) {
    // 上記のWebhook処理コードをここに配置
}
```

#### 独自サーバーの場合

```bash
# PM2でデプロイ
pm2 start server.js --name vuelta-webhook
```

### 6. Stripe決済リンクの設定

1. Stripeダッシュボード > 決済リンク > 編集
2. **支払い後の処理** タブ
3. **顧客を自分のウェブサイトにリダイレクトする** を選択
4. リダイレクトURL: `https://your-domain.com/thanks.html`

## テスト方法

1. Stripeテストモードで決済を実行
2. Webhookが正しく受信されるか確認
3. メールが送信されるか確認
4. 会員証URLが正しく生成されるか確認

## トラブルシューティング

- **Webhookが届かない**: Stripe CLIでローカルテスト `stripe listen --forward-to localhost:3000/webhook/stripe`
- **メールが送信されない**: メールサービス設定を確認
- **PassKitエラー**: APIキーとテンプレートIDを確認

## セキュリティ注意事項

- Webhookシークレットは必ず検証
- APIキーは環境変数で管理
- HTTPS必須（本番環境）
- レート制限を実装
