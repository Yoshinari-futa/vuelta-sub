# ポート3000が使用中の場合の解決方法

## エラーメッセージ

```
✗ Port 3000 is already in use.
Please stop the existing server or use a different port.
```

## 解決方法

### 方法1: 既存のサーバーを停止（推奨）

ターミナルで以下のコマンドを実行：

```bash
pkill -f "node server-example.js"
```

その後、少し待ってから（2-3秒）、再度サーバーを起動：

```bash
npm start
```

### 方法2: ポートを使用しているプロセスを確認して停止

1. **ポート3000を使用しているプロセスを確認**：
   ```bash
   lsof -i :3000
   ```
   
   このコマンドで、以下のような情報が表示されます：
   ```
   COMMAND   PID          USER   FD   TYPE DEVICE SIZE/OFF NODE NAME
   node    12345 yoshinarifuta   16u  IPv6 0x...      0t0  TCP *:3000 (LISTEN)
   ```

2. **プロセスID（PID）を確認**（上記の例では `12345`）

3. **プロセスを停止**：
   ```bash
   kill -9 12345
   ```
   （`12345`の部分を、実際のPIDに置き換えてください）

4. **サーバーを再起動**：
   ```bash
   npm start
   ```

### 方法3: すべてのnodeプロセスを停止（注意が必要）

```bash
pkill node
```

**注意**: このコマンドは、すべてのnodeプロセスを停止します。他のnodeアプリケーションも停止される可能性があります。

### 方法4: 別のポートを使用

`.env`ファイルに以下を追加：

```env
PORT=3001
```

その後、サーバーを起動：

```bash
npm start
```

サーバーはポート3001で起動します。

## 確認方法

サーバーが停止したか確認：

```bash
curl http://localhost:3000/health
```

エラーが表示される場合は、サーバーは停止しています。

## 推奨手順

1. **既存のサーバーを停止**：
   ```bash
   pkill -f "node server-example.js"
   ```

2. **少し待つ**（2-3秒）

3. **サーバーを再起動**：
   ```bash
   npm start
   ```

4. **正常に起動したことを確認**：
   ```
   ✓ Server running on port 3000
   ```
