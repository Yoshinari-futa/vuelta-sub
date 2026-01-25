/**
 * サーバーの動作確認用テストスクリプト
 */

require('dotenv').config();

console.log('=== Server Configuration Check ===\n');

// 環境変数の確認
const checks = {
    'Node.js version': process.version,
    'STRIPE_SECRET_KEY': process.env.STRIPE_SECRET_KEY ? '✓ Set' : '✗ Missing',
    'STRIPE_WEBHOOK_SECRET': process.env.STRIPE_WEBHOOK_SECRET ? '✓ Set' : '✗ Missing',
    'PASSKIT_API_KEY': process.env.PASSKIT_API_KEY ? '✓ Set' : '✗ Missing',
    'PASSKIT_API_KEY_SECRET': process.env.PASSKIT_API_KEY_SECRET ? '✓ Set' : '✗ Missing (optional if PASSKIT_API_KEY is not a URL)',
    'PASSKIT_TIER_ID': process.env.PASSKIT_TIER_ID || '✗ Missing',
    'EMAIL_FROM': process.env.EMAIL_FROM || '✗ Missing',
    'EMAIL_USER': process.env.EMAIL_USER || '✗ Missing',
    'FRONTEND_URL': process.env.FRONTEND_URL || '✗ Missing',
    'PORT': process.env.PORT || '3000 (default)'
};

Object.entries(checks).forEach(([key, value]) => {
    console.log(`${key}: ${value}`);
});

console.log('\n=== Package Check ===\n');

// 必要なパッケージの確認
const packages = ['express', 'stripe', 'dotenv', 'nodemailer'];
packages.forEach(pkg => {
    try {
        require(pkg);
        console.log(`✓ ${pkg} installed`);
    } catch (e) {
        console.log(`✗ ${pkg} NOT installed`);
    }
});

console.log('\n=== Server File Check ===\n');

const fs = require('fs');
const files = ['server-example.js', 'package.json'];
files.forEach(file => {
    if (fs.existsSync(file)) {
        console.log(`✓ ${file} exists`);
    } else {
        console.log(`✗ ${file} NOT found`);
    }
});

console.log('\n=== Next Steps ===\n');
console.log('1. Create .env file with required variables (see ENV-SETUP.md)');
console.log('2. Run: node server-example.js');
console.log('3. Test health endpoint: curl http://localhost:3000/health\n');
