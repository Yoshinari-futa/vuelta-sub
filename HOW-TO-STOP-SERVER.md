# サーバーの停止方法

## サーバーを停止する方法

### 方法1: Ctrl + C を使用（最も簡単）

1. **サーバーを起動しているターミナルウィンドウをクリック**して選択します
   - 通常、`npm start`を実行したターミナルです
   - そのターミナルに以下のような表示があるはずです：
     ```
     ✓ Server running on port 3000
     ✓ Webhook endpoint: http://localhost:3000/webhook/stripe
     ✓ Health check: http://localhost:3000/health
     ```

2. **キーボードで `Ctrl + C` を押します**
   - `Ctrl`キーを押しながら`C`キーを押します
   - Macの場合: `Control + C` または `⌃ + C`

3. サーバーが停止します
   - ターミナルに`^C`と表示され、プロンプト（`%`）が表示されます

### 方法2: 別のターミナルから停止

サーバーを起動しているターミナルが閉じている、または見つからない場合：

1. **新しいターミナルウィンドウを開きます**

2. **以下のコマンドを実行します**：
   ```bash
   pkill -f "node server-example.js"
   ```

3. サーバーが停止します

## サーバーが停止したか確認

以下のコマンドで確認できます：

```bash
curl http://localhost:3000/health
```

エラーが表示される場合は、サーバーは停止しています。

## サーバーを再起動する方法

サーバーを停止した後、以下のコマンドで再起動できます：

```bash
npm start
```

## 視覚的な説明

### サーバーが起動している状態

```
yoshinarifuta@YFMacBook VUELTA-Subsc: % npm start

> vuelta-membership-backend@1.0.0 start
> node server-example.js

✓ Environment variables loaded
✓ Stripe Secret Key: Set
✓ Stripe Webhook Secret: Set
✓ PassKit Tier ID: 553OicVbQ5uwlwUhnzUEvy

✓ Server running on port 3000
✓ Webhook endpoint: http://localhost:3000/webhook/stripe
✓ Health check: http://localhost:3000/health

✓ Mail transporter configured successfully

← ここで Ctrl + C を押す
```

### サーバーを停止した後

```
yoshinarifuta@YFMacBook VUELTA-Subsc: % npm start

> vuelta-membership-backend@1.0.0 start
> node server-example.js

✓ Environment variables loaded
✓ Stripe Secret Key: Set
✓ Stripe Webhook Secret: Set
✓ PassKit Tier ID: 553OicVbQ5uwlwUhnzUEvy

✓ Server running on port 3000
✓ Webhook endpoint: http://localhost:3000/webhook/stripe
✓ Health check: http://localhost:3000/health

✓ Mail transporter configured successfully

^C                    ← Ctrl + C を押した後、このように表示される
yoshinarifuta@YFMacBook VUELTA-Subsc: %  ← プロンプトが表示される（停止完了）
```

## よくある質問

### Q: Ctrl + C を押しても反応しない

A: ターミナルウィンドウが正しく選択されているか確認してください。別のウィンドウを選択している可能性があります。

### Q: サーバーが複数起動している

A: 以下のコマンドで全て停止できます：
```bash
pkill -f "node server-example.js"
```

### Q: どのターミナルがサーバーを起動しているかわからない

A: 以下のコマンドで確認できます：
```bash
ps aux | grep "node server-example.js"
```
