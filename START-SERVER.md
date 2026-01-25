# サーバー起動ガイド

## クイックスタート

### 最も簡単な方法：テストスクリプトを使用

```bash
./test-server.sh
```

このスクリプトは自動的に：
1. 既存のサーバーを停止
2. 新しいサーバーを起動
3. 動作確認を実行
4. 結果を表示

## 起動方法

### 方法1: npm startを使用（推奨）

ターミナルで以下のコマンドを実行：

```bash
cd /Users/yoshinarifuta/VUELTA-Subsc:
npm start
```

### 方法2: nodeコマンドを直接使用

```bash
cd /Users/yoshinarifuta/VUELTA-Subsc:
node server-example.js
```

### 方法3: 開発モード（nodemon使用、ファイル変更時に自動再起動）

```bash
cd /Users/yoshinarifuta/VUELTA-Subsc:
npm run dev
```

## 起動確認

サーバーが起動すると、以下のメッセージが表示されます：

```
✓ Environment variables loaded
✓ Stripe Secret Key: Set
✓ Stripe Webhook Secret: Set
✓ PassKit Tier ID: 553OicVbQ5uwlwUhnzUEvy

✓ Server running on port 3000
✓ Webhook endpoint: http://localhost:3000/webhook/stripe
✓ Health check: http://localhost:3000/health
```

## 動作確認方法

### 1. ヘルスチェック

ブラウザで開くか、ターミナルで実行：

```bash
curl http://localhost:3000/health
```

正常な応答：
```json
{
  "status": "ok",
  "timestamp": "2026-01-25T05:32:29.958Z"
}
```

### 2. Webhookエンドポイントの確認

```bash
curl -X POST http://localhost:3000/webhook/stripe \
  -H "Content-Type: application/json" \
  -d '{"test": "data"}'
```

署名がない場合はエラーが返りますが、これは正常な動作です。

### 3. ブラウザで確認

以下のURLをブラウザで開いてください：

- ヘルスチェック: http://localhost:3000/health

## サーバーを停止する方法

### Ctrl+Cで停止

ターミナルで `Ctrl + C` を押すとサーバーが停止します。

### プロセスを強制終了

```bash
# ポート3000を使用しているプロセスを確認
lsof -i :3000

# プロセスを停止
pkill -f "node server-example.js"
# または
lsof -ti:3000 | xargs kill -9
```

## トラブルシューティング

### ポート3000が既に使用されている場合

エラーメッセージ：
```
✗ Port 3000 is already in use.
```

解決方法：
1. 既存のサーバーを停止する
2. 別のポートを使用する（`.env`ファイルで`PORT=3001`などに設定）

### 環境変数が読み込まれない場合

`.env`ファイルがプロジェクトルートに存在するか確認してください。

### メール送信が失敗する場合

- Gmailを使用している場合、アプリパスワードが正しく設定されているか確認
- `EMAIL_USER`と`EMAIL_PASS`が正しく設定されているか確認

## 次のステップ

1. Stripe Webhookの設定
   - StripeダッシュボードでWebhookエンドポイントを設定
   - エンドポイントURL: `https://your-domain.com/webhook/stripe`
   - イベント: `checkout.session.completed`

2. テスト決済の実行
   - Stripeテストモードで決済を実行
   - Webhookが正しく受信されるか確認
   - メールが送信されるか確認
   - PassKit会員証が生成されるか確認
