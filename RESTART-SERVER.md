# サーバー再起動ガイド

## 問題: ポート3000が既に使用されている

エラーメッセージ：
```
✗ Port 3000 is already in use.
Please stop the existing server or use a different port.
```

## 解決方法

### 方法1: 既存のサーバーを停止してから再起動（推奨）

#### ステップ1: 既存のサーバーを停止

**オプションA: サーバーを起動したターミナルで**
- `Ctrl + C` を押す

**オプションB: 別のターミナルで**
```bash
# ポート3000を使用しているプロセスを停止
pkill -f "node server-example.js"

# または、より強制的に
lsof -ti:3000 | xargs kill -9
```

#### ステップ2: サーバーを再起動

```bash
npm start
```

### 方法2: 別のポートを使用

`.env`ファイルに以下を追加：
```env
PORT=3001
```

その後、サーバーを起動：
```bash
npm start
```

## 注意事項

⚠️ **ログの内容をコマンドとして実行しないでください**

サーバーの出力（`✓ Environment variables loaded`など）は、コマンドではありません。
これらをコピー&ペーストして実行すると、`zsh: command not found`エラーが発生します。

## 正しい手順

1. **既存のサーバーを停止**
   ```bash
   pkill -f "node server-example.js"
   ```

2. **少し待つ（2-3秒）**

3. **サーバーを再起動**
   ```bash
   npm start
   ```

4. **正常に起動したことを確認**
   ```
   ✓ Environment variables loaded
   ✓ Stripe Secret Key: Set
   ✓ Stripe Webhook Secret: Set
   ✓ PassKit Tier ID: 553OicVbQ5uwlwUhnzUEvy
   ✓ Mail transporter configured successfully
   
   ✓ Server running on port 3000
   ✓ Webhook endpoint: http://localhost:3000/webhook/stripe
   ✓ Health check: http://localhost:3000/health
   ```

## トラブルシューティング

### プロセスが停止しない場合

```bash
# プロセスIDを確認
lsof -i :3000

# プロセスIDを指定して停止（例: PIDが1234の場合）
kill -9 1234
```

### 複数のプロセスが起動している場合

```bash
# すべてのnodeプロセスを確認
ps aux | grep node

# すべてのnodeプロセスを停止（注意: 他のnodeアプリも停止されます）
pkill node
```
