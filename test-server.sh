#!/bin/bash

# サーバー起動テストスクリプト

echo "=== VUELTA サーバー起動テスト ==="
echo ""

# プロジェクトディレクトリに移動
cd "$(dirname "$0")"

# 既存のサーバーを停止
echo "1. 既存のサーバーを停止中..."
pkill -f "node server-example.js" 2>/dev/null
sleep 2

# サーバーを起動
echo "2. サーバーを起動中..."
node server-example.js > /tmp/vuelta-server.log 2>&1 &
SERVER_PID=$!
sleep 4

# サーバーの起動を確認
echo "3. サーバーの起動を確認中..."
if curl -s http://localhost:3000/health > /dev/null 2>&1; then
    echo "✓ サーバーは正常に起動しました！"
    echo ""
    echo "=== サーバー情報 ==="
    echo "PID: $SERVER_PID"
    echo "ポート: 3000"
    echo "ヘルスチェック: http://localhost:3000/health"
    echo "Webhook: http://localhost:3000/webhook/stripe"
    echo ""
    echo "=== ヘルスチェック結果 ==="
    curl -s http://localhost:3000/health | python3 -m json.tool 2>/dev/null || curl -s http://localhost:3000/health
    echo ""
    echo "=== サーバーログ（最新10行） ==="
    tail -10 /tmp/vuelta-server.log
    echo ""
    echo "サーバーを停止するには: kill $SERVER_PID"
    echo "または: pkill -f 'node server-example.js'"
else
    echo "✗ サーバーの起動に失敗しました"
    echo ""
    echo "=== エラーログ ==="
    cat /tmp/vuelta-server.log
    kill $SERVER_PID 2>/dev/null
    exit 1
fi
