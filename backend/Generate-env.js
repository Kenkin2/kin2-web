#!/usr/bin/env node

/**
 * Environment File Generator for Kin2 Platform
 * Run: node generate-env.js production
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function generateSecret(length = 32) {
  return crypto.randomBytes(length).toString('hex');
}

function generatePassword(length = 16) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
  let password = '';
  for (let i = 0; i < length; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
}

async function generateEnvFile(environment) {
  console.log(`\n🔐 Generating ${environment} environment configuration...\n`);
  
  // Generate secure secrets
  const secrets = {
    JWT_SECRET: generateSecret(32),
    JWT_REFRESH_SECRET: generateSecret(32),
    SESSION_SECRET: generateSecret(32),
    ENCRYPTION_KEY: generateSecret(32),
    ENCRYPTION_IV: generateSecret(16),
    WEBHOOK_SECRET: generateSecret(32),
    BACKUP_ENCRYPTION_KEY: generateSecret(32)
  };

  // Base configuration
  let config = `# ======================================================\n`;
  config += `# KIN2 WORKFORCE PLATFORM - ${environment.toUpperCase()} ENVIRONMENT\n`;
  config += `# Generated: ${new Date().toISOString()}\n`;
  config += `# ======================================================\n\n`;

  // Add secrets
  config += `# 🔒 SECURITY SECRETS (AUTO-GENERATED)\n`;
  for (const [key, value] of Object.entries(secrets)) {
    config += `${key}=${value}\n`;
  }
  config += `\n`;

  // Ask for user input for other values
  const answers = {};
  
  const questions = [
    { key: 'APP_URL', question: 'Frontend Application URL:', default: environment === 'production' ? 'https://app.kin2.co.uk' : 'http://localhost:5173' },
    { key: 'API_URL', question: 'Backend API URL:', default: environment === 'production' ? 'https://api.kin2.co.uk' : 'http://localhost:3000' },
    { key: 'DATABASE_URL', question: 'PostgreSQL Database URL:', default: 'postgresql://user:password@localhost:5432/kin2_db' },
    { key: 'DEEPSEEK_API_KEY', question: 'DeepSeek API Key:', default: 'sk-your-key-here' },
    { key: 'STRIPE_SECRET_KEY', question: 'Stripe Secret Key:', default: environment === 'production' ? 'sk_live_xxx' : 'sk_test_xxx' },
    { key: 'SMTP_HOST', question: 'SMTP Host:', default: environment === 'production' ? 'email-smtp.eu-west-1.amazonaws.com' : 'localhost' }
  ];

  for (const q of questions) {
    const answer = await askQuestion(q.question, q.default);
    answers[q.key] = answer;
  }

  // Add environment-specific settings
  config += `# 🌍 ENVIRONMENT SETTINGS\n`;
  config += `NODE_ENV=${environment}\n`;
  config += `PORT=${environment === 'production' ? '8080' : '3000'}\n`;
  config += `LOG_LEVEL=${environment === 'production' ? 'info' : 'debug'}\n\n`;

  // Add user-provided values
  config += `# 🔧 APPLICATION CONFIGURATION\n`;
  for (const [key, value] of Object.entries(answers)) {
    config += `${key}=${value}\n`;
  }
  config += `\n`;

  // Add feature flags
  config += `# 🚩 FEATURE FLAGS\n`;
  const features = {
    'ENABLE_AI_AGENTS': 'true',
    'ENABLE_EMAIL_NOTIFICATIONS': environment === 'production' ? 'true' : 'false',
    'ENABLE_PAYMENTS': environment === 'production' ? 'true' : 'false',
    'ENABLE_KFN_SCORING': 'true',
    'MOCK_AI_RESPONSES': environment === 'production' ? 'false' : 'true',
    'MOCK_EMAIL_SENDING': environment === 'production' ? 'false' : 'true',
    'MOCK_PAYMENTS': environment === 'production' ? 'false' : 'true'
  };

  for (const [key, value] of Object.entries(features)) {
    config += `${key}=${value}\n`;
  }

  // Write to file
  const fileName = environment === 'production' ? '.env' : `.env.${environment}`;
  fs.writeFileSync(path.join(process.cwd(), fileName), config);
  
  console.log(`\n✅ ${fileName} generated successfully!`);
  console.log(`\n📋 Generated Secrets:`);
  console.log(`   JWT_SECRET: ${secrets.JWT_SECRET}`);
  console.log(`   JWT_REFRESH_SECRET: ${secrets.JWT_REFRESH_SECRET}`);
  console.log(`   SESSION_SECRET: ${secrets.SESSION_SECRET}`);
  console.log(`\n⚠️  IMPORTANT: Save these secrets in a secure location!`);
  console.log(`   They will not be shown again.`);
  
  // Create .env.local with passwords if needed
  if (environment === 'development') {
    const localConfig = `# Local development overrides (gitignored)\n`;
    localConfig += `DB_PASSWORD=${generatePassword()}\n`;
    localConfig += `REDIS_PASSWORD=${generatePassword()}\n`;
    localConfig += `ADMIN_PASSWORD=${generatePassword()}\n`;
    
    fs.writeFileSync(path.join(process.cwd(), '.env.local'), localConfig);
    console.log(`\n🔐 .env.local created with database passwords`);
  }
}

function askQuestion(question, defaultValue) {
  return new Promise((resolve) => {
    const formattedQuestion = defaultValue ? `${question} [${defaultValue}]: ` : `${question}: `;
    rl.question(formattedQuestion, (answer) => {
      resolve(answer.trim() || defaultValue);
    });
  });
}

async function main() {
  const environment = process.argv[2] || 'development';
  
  if (!['development', 'production', 'staging', 'test'].includes(environment)) {
    console.error('❌ Invalid environment. Use: development, production, staging, or test');
    process.exit(1);
  }

  console.log(`🚀 Kin2 Environment Generator`);
  console.log(`=============================`);
  
  await generateEnvFile(environment);
  
  rl.close();
  process.exit(0);
}

main().catch(console.error);
