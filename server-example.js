/**
 * Stripe + PassKit 連携サーバー例
 * 
 * 使用方法:
 * 1. npm install express stripe @passkit/passkit dotenv nodemailer
 * 2. .envファイルを作成して必要な環境変数を設定
 * 3. node server-example.js で起動
 */

require('dotenv').config();
const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const nodemailer = require('nodemailer');

const app = express();

// CORS設定（必要に応じて）
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

// メール送信設定（SendGrid例）
let transporter;
try {
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
        console.warn('⚠ EMAIL_USER or EMAIL_PASS is not set. Email sending will not work.');
    } else {
        transporter = nodemailer.createTransport({
            service: process.env.EMAIL_SERVICE || 'gmail',
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS
            }
        });
        
        // メール送信設定の検証
        transporter.verify(function (error, success) {
            if (error) {
                console.error('✗ Mail transporter verification failed:', error.message);
                console.error('   Please check your EMAIL_USER and EMAIL_PASS settings.');
            } else {
                console.log('✓ Mail transporter configured successfully');
            }
        });
    }
} catch (error) {
    console.error('✗ Mail transporter initialization failed:', error.message);
}

// Webhookエンドポイント（express.json()より前に定義する必要がある）
// express.raw()を使用して生のリクエストボディを取得（Stripe署名検証のため）
app.post('/webhook/stripe', 
    express.raw({type: 'application/json'}), 
    async (req, res) => {
        console.log('\n=== Webhook received ===');
        console.log('Headers:', JSON.stringify(req.headers, null, 2));
        console.log('Body length:', req.body ? req.body.length : 0);
        
        const sig = req.headers['stripe-signature'];
        let event;

        try {
            event = stripe.webhooks.constructEvent(
                req.body, 
                sig, 
                process.env.STRIPE_WEBHOOK_SECRET
            );
            console.log(`Webhook event type: ${event.type}`);
            console.log(`Webhook event ID: ${event.id}`);
        } catch (err) {
            console.error(`✗ Webhook signature verification failed.`, err.message);
            console.error('Signature header:', sig);
            return res.status(400).send(`Webhook Error: ${err.message}`);
        }

        // 決済成功イベントを処理
        if (event.type === 'checkout.session.completed') {
            const session = event.data.object;
            console.log(`\n=== Webhook received: checkout.session.completed ===`);
            console.log(`Session ID: ${session.id}`);
            
            try {
                // 顧客IDの確認
                if (!session.customer) {
                    console.error('✗ No customer ID in session:', session.id);
                    console.error('Session data:', JSON.stringify(session, null, 2));
                    return res.status(400).json({error: 'No customer ID in session'});
                }

                console.log(`Customer ID: ${session.customer}`);

                // 顧客情報を取得
                const customer = await stripe.customers.retrieve(session.customer);
                console.log(`Customer retrieved: ${customer.id}`);
                
                // メールアドレスの確認
                const customerEmail = customer.email || session.customer_email || session.customer_details?.email;
                if (!customerEmail) {
                    console.error('✗ No email address found for customer:', session.customer);
                    console.error('Customer data:', JSON.stringify(customer, null, 2));
                    console.error('Session customer_email:', session.customer_email);
                    console.error('Session customer_details:', JSON.stringify(session.customer_details, null, 2));
                    return res.status(400).json({error: 'No email address found'});
                }

                console.log(`Customer email: ${customerEmail}`);
                const customerName = customer.name || session.customer_details?.name || 'VUELTA Member';
                console.log(`Customer name: ${customerName}`);

                // PassKitで顧客専用の会員証を生成
                console.log('Generating PassKit card...');
                let walletUrl;
                try {
                    walletUrl = await generatePassKitCard({
                        email: customerEmail,
                        name: customerName,
                        customerId: session.customer,
                        tierId: process.env.PASSKIT_TIER_ID
                    });
                    console.log(`PassKit wallet URL: ${walletUrl}`);
                    
                    // URLが有効か確認（PassKitのURLであることを確認）
                    if (!walletUrl || walletUrl.includes('example.com') || walletUrl.includes('your-domain.com')) {
                        throw new Error(`Invalid PassKit URL received: ${walletUrl}`);
                    }
                } catch (passkitError) {
                    console.error('✗ Failed to generate PassKit card:', passkitError.message);
                    // PassKitエラーが発生した場合でもメールは送信するが、エラーメッセージを含める
                    walletUrl = null;
                }

                // メール送信（PassKit URLが取得できた場合のみ）
                if (walletUrl) {
                    console.log(`Sending email to ${customerEmail}...`);
                    try {
                        await sendMembershipEmail(customerEmail, customerName, walletUrl);
                        console.log(`✓ Membership card sent successfully to ${customerEmail}`);
                    } catch (emailError) {
                        console.error(`✗ Failed to send email to ${customerEmail}:`, emailError.message);
                        console.error('Email error details:', JSON.stringify(emailError, Object.getOwnPropertyNames(emailError), 2));
                        throw emailError; // エラーを再スローしてログに記録
                    }
                } else {
                    console.error(`✗ Cannot send email: PassKit URL not available`);
                    console.error(`  Customer email: ${customerEmail}`);
                    console.error(`  This means PassKit card generation failed. Check the error above.`);
                    // PassKit URLが取得できない場合でも、エラーメールを送信するか検討
                }
                console.log(`=== Webhook processing completed ===\n`);

            } catch (error) {
                console.error('\n✗✗✗ ERROR PROCESSING MEMBERSHIP ✗✗✗');
                console.error('Error message:', error.message);
                console.error('Error stack:', error.stack);
                console.error('Error name:', error.name);
                console.error('Error code:', error.code);
                console.error('Full error:', JSON.stringify(error, Object.getOwnPropertyNames(error), 2));
                console.error('✗✗✗ END ERROR ✗✗✗\n');
                // エラーが発生してもWebhookは成功として返す（Stripeに再送信させないため）
                // ただし、ログには記録する
            }
        } else {
            console.log(`Webhook event type received: ${event.type} (not processing)`);
            console.log(`Event ID: ${event.id}`);
            console.log(`Event data:`, JSON.stringify(event.data, null, 2));
        }

        console.log('=== Sending webhook response ===');
        res.json({received: true});
    }
);

// JSONボディパーサー（Webhook以外のエンドポイント用）
// Webhookエンドポイントより後に定義することで、Webhookには影響しない
app.use(express.json());

/**
 * PassKitで会員証を生成
 * PassKit APIを使用して顧客専用の会員証を生成
 */
async function generatePassKitCard({ email, name, customerId, tierId }) {
    try {
        // PassKit APIベースURL（環境変数から取得）
        // PASSKIT_API_KEYがURLの場合はベースURLとして使用
        const passkitBaseUrl = process.env.PASSKIT_API_KEY && process.env.PASSKIT_API_KEY.startsWith('http')
            ? process.env.PASSKIT_API_KEY.replace(/\/$/, '') // 末尾のスラッシュを削除
            : 'https://api.pub2.passkit.io';
        
        // PassKit APIキー（実際のAPIキーは別の環境変数から取得、またはPASSKIT_API_KEYがURLでない場合はそのまま使用）
        const passkitApiKey = process.env.PASSKIT_API_KEY_SECRET || 
                              (process.env.PASSKIT_API_KEY && !process.env.PASSKIT_API_KEY.startsWith('http') 
                                  ? process.env.PASSKIT_API_KEY 
                                  : null);
        
        if (!passkitApiKey) {
            throw new Error('PASSKIT_API_KEY_SECRET or PASSKIT_API_KEY (non-URL) is required');
        }

        console.log(`Creating PassKit member for ${email}...`);
        console.log(`Using PassKit base URL: ${passkitBaseUrl}`);
        
        // PassKit API呼び出し（Membership API）
        const response = await fetch(`${passkitBaseUrl}/membership/members`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${passkitApiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                tierId: tierId,
                programId: process.env.PASSKIT_PROGRAM_ID || 'default',
                person: {
                    displayName: name,
                    externalId: customerId
                },
                externalId: customerId,
                points: 0,
                tierPoints: 0
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`PassKit API error: ${response.status} - ${errorText}`);
            throw new Error(`PassKit API error: ${response.status} ${response.statusText}`);
        }

        const member = await response.json();
        console.log(`✓ PassKit member created: ${member.id}`);
        console.log(`Member data:`, JSON.stringify(member, null, 2));
        
        // 会員証のダウンロードURLを取得
        const passResponse = await fetch(`${passkitBaseUrl}/membership/members/${member.id}/pass`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${passkitApiKey}`
            }
        });

        if (!passResponse.ok) {
            const errorText = await passResponse.text();
            console.error(`PassKit Pass API error: ${passResponse.status} - ${errorText}`);
            throw new Error(`PassKit Pass API error: ${passResponse.status} ${passResponse.statusText}`);
        }

        const passData = await passResponse.json();
        console.log(`Pass data:`, JSON.stringify(passData, null, 2));
        
        // PassKit APIから返ってくる実際のURLを取得（優先順位順）
        const walletUrl = passData.downloadUrl || 
                         passData.appleWalletUrl || 
                         passData.googleWalletUrl ||
                         passData.url || 
                         passData.passUrl ||
                         passData.walletUrl;
        
        if (!walletUrl) {
            console.error('PassKit response:', JSON.stringify(passData, null, 2));
            throw new Error('PassKit did not return a download URL. Response: ' + JSON.stringify(passData));
        }

        console.log(`✓ PassKit wallet URL generated: ${walletUrl}`);
        return walletUrl;

    } catch (error) {
        console.error('✗ Error generating PassKit card:', error.message);
        console.error('Error stack:', error.stack);
        // エラー時はエラーを再スローして、呼び出し元で適切に処理する
        // フォールバックURLは使用しない（実際のPassKit URLが必要）
        throw error;
    }
}

/**
 * 会員証メールを送信
 */
async function sendMembershipEmail(email, name, walletUrl) {
    if (!transporter) {
        const errorMsg = 'Mail transporter is not configured. Please check EMAIL_USER and EMAIL_PASS in .env file.';
        console.error('✗ ' + errorMsg);
        throw new Error(errorMsg);
    }

    const mailOptions = {
        from: process.env.EMAIL_FROM || 'noreply@vuelta.jp',
        to: email,
        subject: 'VUELTA Membership - 会員証のご案内',
        html: `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <style>
                    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
                    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                    .button { display: inline-block; padding: 12px 24px; background-color: #1a2e1a; color: white; text-decoration: none; border-radius: 4px; margin: 20px 0; }
                </style>
            </head>
            <body>
                <div class="container">
                    <h2>Welcome to VUELTA!</h2>
                    <p>${name}様</p>
                    <p>ご入会ありがとうございます。VUELTAでの特別な時間が始まります。</p>
                    <p>会員証の準備が整いました。下のリンクからスマートフォンに追加してください。</p>
                    <p><a href="${walletUrl}" class="button">Add to Wallet</a></p>
                    <p>または、こちらのURLをコピーしてブラウザで開いてください：</p>
                    <p style="word-break: break-all; color: #666;">${walletUrl}</p>
                    <hr style="margin: 30px 0; border: none; border-top: 1px solid #eee;">
                    <p style="font-size: 12px; color: #999;">© 2026 VUELTA. All rights reserved.</p>
                </div>
            </body>
            </html>
        `
    };

    try {
        console.log(`Attempting to send email:`);
        console.log(`  From: ${mailOptions.from}`);
        console.log(`  To: ${email}`);
        console.log(`  Subject: ${mailOptions.subject}`);
        
        const info = await transporter.sendMail(mailOptions);
        console.log(`✓ Email sent successfully to ${email}`);
        console.log(`  Message ID: ${info.messageId}`);
        console.log(`  Response: ${info.response}`);
        return info;
    } catch (error) {
        console.error(`✗ Failed to send email to ${email}:`);
        console.error(`  Error code: ${error.code}`);
        console.error(`  Error message: ${error.message}`);
        if (error.response) {
            console.error(`  SMTP response: ${error.response}`);
        }
        if (error.responseCode) {
            console.error(`  Response code: ${error.responseCode}`);
        }
        throw error;
    }
}

// ヘルスチェック
app.get('/health', (req, res) => {
    res.json({status: 'ok', timestamp: new Date().toISOString()});
});

// メール送信テストエンドポイント（開発・デバッグ用）
app.post('/test-email', express.json(), async (req, res) => {
    const { email, name, walletUrl } = req.body;
    
    if (!email) {
        return res.status(400).json({error: 'Email is required'});
    }
    
    try {
        await sendMembershipEmail(
            email, 
            name || 'Test User', 
            walletUrl || 'https://example.com/wallet-card.pkpass'
        );
        res.json({
            success: true,
            message: `Test email sent successfully to ${email}`
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message,
            details: {
                code: error.code,
                response: error.response
            }
        });
    }
});

// 環境変数の検証
const requiredEnvVars = ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'PASSKIT_TIER_ID'];
const missingVars = requiredEnvVars.filter(v => !process.env[v]);

if (missingVars.length > 0) {
    console.error('✗ Missing required environment variables:');
    missingVars.forEach(v => console.error(`  - ${v}`));
    console.error('\nPlease create a .env file with the required variables.');
    console.error('See ENV-SETUP.md for details.');
    process.exit(1);
}

// PassKit API設定の確認
const passkitApiKey = process.env.PASSKIT_API_KEY_SECRET || 
                      (process.env.PASSKIT_API_KEY && !process.env.PASSKIT_API_KEY.startsWith('http') 
                          ? process.env.PASSKIT_API_KEY 
                          : null);
if (!passkitApiKey) {
    console.warn('⚠ Warning: PASSKIT_API_KEY_SECRET or PASSKIT_API_KEY (non-URL) is not set.');
    console.warn('PassKit integration will not work correctly.');
    console.warn('If PASSKIT_API_KEY is a URL, set PASSKIT_API_KEY_SECRET with the actual API key.');
}

// メール設定の確認
if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.warn('⚠ Warning: EMAIL_USER or EMAIL_PASS is not set.');
    console.warn('Email sending will not work.');
}

console.log('✓ Environment variables loaded');
console.log(`✓ Stripe Secret Key: ${process.env.STRIPE_SECRET_KEY ? 'Set' : 'Missing'}`);
console.log(`✓ Stripe Webhook Secret: ${process.env.STRIPE_WEBHOOK_SECRET ? 'Set' : 'Missing'}`);
console.log(`✓ PassKit Tier ID: ${process.env.PASSKIT_TIER_ID || 'Missing'}`);

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
    console.log(`\n✓ Server running on port ${PORT}`);
    console.log(`✓ Webhook endpoint: http://localhost:${PORT}/webhook/stripe`);
    console.log(`✓ Health check: http://localhost:${PORT}/health\n`);
});

// エラーハンドリング
server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
        console.error(`\n✗ Port ${PORT} is already in use.`);
        console.error('Please stop the existing server or use a different port.');
        console.error(`You can check what's using the port with: lsof -i :${PORT}\n`);
        process.exit(1);
    } else {
        console.error('✗ Server error:', error);
        process.exit(1);
    }
});
