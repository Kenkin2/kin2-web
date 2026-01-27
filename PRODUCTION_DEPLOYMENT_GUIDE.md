# 🚀 KIN2 Production Deployment Guide

**Version:** 2.5.0  
**Last Updated:** January 27, 2026  
**Status:** Production-Ready

---

## 📋 Table of Contents

1. [Pre-Deployment Checklist](#pre-deployment-checklist)
2. [Environment Setup](#environment-setup)
3. [Security Hardening](#security-hardening)
4. [Database Configuration](#database-configuration)
5. [Deployment Options](#deployment-options)
6. [Post-Deployment Verification](#post-deployment-verification)
7. [Monitoring & Maintenance](#monitoring--maintenance)
8. [Troubleshooting](#troubleshooting)

---

## 🔍 Pre-Deployment Checklist

### Critical Requirements

Before deploying to production, ensure you have:

- [ ] **Production Database** - PostgreSQL 15+ (recommended: managed service)
- [ ] **Domain Name** - Registered and configured
- [ ] **SSL Certificate** - For HTTPS (Let's Encrypt or purchased)
- [ ] **Email Service** - SMTP provider (SendGrid, AWS SES, etc.)
- [ ] **Payment Gateway** - Stripe account with live keys
- [ ] **AI API Keys** - DeepSeek or OpenAI production keys
- [ ] **Backup Strategy** - Database backup plan
- [ ] **Monitoring Tools** - Error tracking (Sentry, LogRocket, etc.)
- [ ] **CDN** - Content delivery network (optional but recommended)

### Legal & Compliance

- [ ] Terms of Service reviewed and published
- [ ] Privacy Policy compliant with GDPR/CCPA
- [ ] Cookie consent mechanism implemented
- [ ] Data processing agreements signed
- [ ] Legal entity established
- [ ] Business licenses obtained
- [ ] Insurance policies purchased

### Security Audit

- [ ] All dependencies updated to latest stable versions
- [ ] Security scan completed (npm audit, Snyk, etc.)
- [ ] Penetration testing performed
- [ ] Rate limiting configured
- [ ] CORS policies properly restricted
- [ ] Input validation comprehensive
- [ ] SQL injection prevention verified
- [ ] XSS protection implemented
- [ ] JWT secrets are cryptographically secure
- [ ] API keys stored securely (environment variables or secrets manager)

---

## 🛠️ Environment Setup

### Production Environment Variables

Create a `.env.production` file with the following variables:

```bash
# ============================================
# APPLICATION CONFIGURATION
# ============================================
NODE_ENV=production
PORT=3000
APP_URL=https://yourdomain.com
API_URL=https://api.yourdomain.com
FRONTEND_URL=https://yourdomain.com

# ============================================
# DATABASE CONFIGURATION
# ============================================
# PostgreSQL Connection String
# Format: postgresql://USERNAME:PASSWORD@HOST:PORT/DATABASE?sslmode=require
DATABASE_URL=postgresql://kin2_user:SECURE_PASSWORD@db.example.com:5432/kin2_production?sslmode=require

# Database Pool Configuration
DATABASE_POOL_MIN=2
DATABASE_POOL_MAX=10

# ============================================
# SECURITY & AUTHENTICATION
# ============================================
# Generate with: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
JWT_SECRET=YOUR_SECURE_JWT_SECRET_HERE_64_CHARS_MINIMUM
JWT_REFRESH_SECRET=YOUR_SECURE_REFRESH_SECRET_HERE_64_CHARS_MINIMUM

# Token Expiration
JWT_EXPIRATION=15m
JWT_REFRESH_EXPIRATION=7d

# Password Hashing
BCRYPT_ROUNDS=12

# ============================================
# AI SERVICE CONFIGURATION
# ============================================
# DeepSeek API (Primary)
DEEPSEEK_API_KEY=your_deepseek_api_key_here
DEEPSEEK_BASE_URL=https://api.deepseek.com

# OpenAI API (Fallback)
OPENAI_API_KEY=your_openai_api_key_here
OPENAI_ORG_ID=your_org_id_here

# AI Service Settings
AI_MAX_RETRIES=3
AI_TIMEOUT=30000
AI_ENABLE_FALLBACK=true

# ============================================
# PAYMENT PROCESSING (STRIPE)
# ============================================
STRIPE_SECRET_KEY=sk_live_YOUR_LIVE_SECRET_KEY
STRIPE_PUBLISHABLE_KEY=pk_live_YOUR_LIVE_PUBLISHABLE_KEY
STRIPE_WEBHOOK_SECRET=whsec_YOUR_WEBHOOK_SECRET

# Payment Settings
STRIPE_CURRENCY=usd
STRIPE_ENABLE_SUBSCRIPTIONS=true

# ============================================
# EMAIL SERVICE
# ============================================
# SMTP Configuration
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_SECURE=true
SMTP_USER=apikey
SMTP_PASS=YOUR_SENDGRID_API_KEY

# Email Settings
EMAIL_FROM=noreply@yourdomain.com
EMAIL_FROM_NAME=KIN2 Workforce
EMAIL_SUPPORT=support@yourdomain.com

# ============================================
# RATE LIMITING & SECURITY
# ============================================
# Rate Limits (requests per window)
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100
RATE_LIMIT_AUTH_MAX=20

# CORS Configuration
CORS_ORIGIN=https://yourdomain.com,https://app.yourdomain.com
CORS_CREDENTIALS=true

# Security Headers
HELMET_ENABLE=true
HSTS_MAX_AGE=31536000

# ============================================
# FILE STORAGE
# ============================================
# AWS S3 (recommended for production)
AWS_ACCESS_KEY_ID=your_aws_access_key
AWS_SECRET_ACCESS_KEY=your_aws_secret_key
AWS_REGION=us-east-1
AWS_S3_BUCKET=kin2-production-files

# Or use local storage (not recommended for production)
FILE_STORAGE_TYPE=s3
FILE_MAX_SIZE_MB=10
FILE_ALLOWED_TYPES=pdf,doc,docx,jpg,jpeg,png

# ============================================
# LOGGING & MONITORING
# ============================================
# Log Level
LOG_LEVEL=info
LOG_FORMAT=json

# Sentry Error Tracking
SENTRY_DSN=https://your_sentry_dsn@sentry.io/project_id
SENTRY_ENVIRONMENT=production
SENTRY_SAMPLE_RATE=0.1

# Application Performance Monitoring
APM_ENABLED=true
APM_SERVICE_NAME=kin2-api

# ============================================
# CACHING (REDIS)
# ============================================
REDIS_ENABLED=true
REDIS_URL=redis://redis.example.com:6379
REDIS_PASSWORD=your_redis_password
REDIS_TTL_DEFAULT=3600

# ============================================
# FEATURE FLAGS
# ============================================
ENABLE_AI_AGENTS=true
ENABLE_EMAIL_NOTIFICATIONS=true
ENABLE_SMS_NOTIFICATIONS=false
ENABLE_PAYMENTS=true
ENABLE_KFN_SCORING=true
ENABLE_WEBHOOKS=true
ENABLE_API_DOCS=false

# ============================================
# MAINTENANCE MODE
# ============================================
MAINTENANCE_MODE=false
MAINTENANCE_MESSAGE=We're currently performing scheduled maintenance. We'll be back shortly!

# ============================================
# EXTERNAL INTEGRATIONS
# ============================================
# Google OAuth (optional)
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret

# LinkedIn OAuth (optional)
LINKEDIN_CLIENT_ID=your_linkedin_client_id
LINKEDIN_CLIENT_SECRET=your_linkedin_client_secret

# Twilio SMS (if enabling SMS)
TWILIO_ACCOUNT_SID=your_twilio_account_sid
TWILIO_AUTH_TOKEN=your_twilio_auth_token
TWILIO_PHONE_NUMBER=+1234567890

# ============================================
# ANALYTICS & TRACKING
# ============================================
# Google Analytics
GA_TRACKING_ID=UA-XXXXXXXXX-X

# Mixpanel
MIXPANEL_TOKEN=your_mixpanel_token

# ============================================
# BACKUP & DISASTER RECOVERY
# ============================================
BACKUP_ENABLED=true
BACKUP_SCHEDULE=0 2 * * *
BACKUP_RETENTION_DAYS=30
BACKUP_S3_BUCKET=kin2-backups

# ============================================
# HEALTH CHECKS & MONITORING
# ============================================
HEALTH_CHECK_ENABLED=true
HEALTH_CHECK_PATH=/health
HEALTH_CHECK_INTERVAL=60000

# Metrics
METRICS_ENABLED=true
METRICS_PORT=9090
```

### Generating Secure Secrets

```bash
# Generate JWT secrets
node -e "console.log('JWT_SECRET=' + require('crypto').randomBytes(64).toString('hex'))"
node -e "console.log('JWT_REFRESH_SECRET=' + require('crypto').randomBytes(64).toString('hex'))"

# Generate API key
node -e "console.log('API_KEY=' + require('crypto').randomBytes(32).toString('base64'))"
```

---

## 🔒 Security Hardening

### 1. SSL/TLS Configuration

**Option A: Using Let's Encrypt (Free)**

```bash
# Install Certbot
sudo apt-get install certbot

# Generate certificate
sudo certbot certonly --standalone -d yourdomain.com -d www.yourdomain.com

# Certificate will be at:
# /etc/letsencrypt/live/yourdomain.com/fullchain.pem
# /etc/letsencrypt/live/yourdomain.com/privkey.pem

# Auto-renew
sudo certbot renew --dry-run
```

**Option B: Using Nginx as Reverse Proxy**

```nginx
server {
    listen 80;
    server_name yourdomain.com www.yourdomain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name yourdomain.com www.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers on;
    ssl_ciphers 'ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256';

    # Security Headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### 2. Firewall Configuration

```bash
# Ubuntu/Debian using UFW
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow ssh
sudo ufw allow 'Nginx Full'
sudo ufw enable

# Check status
sudo ufw status
```

### 3. Database Security

```sql
-- Create dedicated database user
CREATE USER kin2_app WITH PASSWORD 'SECURE_PASSWORD_HERE';

-- Grant only necessary permissions
GRANT CONNECT ON DATABASE kin2_production TO kin2_app;
GRANT USAGE ON SCHEMA public TO kin2_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO kin2_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO kin2_app;

-- Revoke superuser privileges
REVOKE ALL PRIVILEGES ON DATABASE postgres FROM kin2_app;

-- Enable SSL for database connections
-- In postgresql.conf:
-- ssl = on
-- ssl_cert_file = '/path/to/cert.pem'
-- ssl_key_file = '/path/to/key.pem'
```

### 4. Application Security

```javascript
// backend/src/config/security.js
module.exports = {
  helmet: {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'", 'https://api.stripe.com'],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        mediaSrc: ["'self'"],
        frameSrc: ["'none'"],
      },
    },
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true
    },
  },
  
  cors: {
    origin: process.env.CORS_ORIGIN.split(','),
    credentials: true,
    optionsSuccessStatus: 200
  },
  
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS),
    max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS),
    message: 'Too many requests from this IP, please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
  }
};
```

---

## 💾 Database Configuration

### Production Database Setup

**Recommended: Managed PostgreSQL Service**

Choose one of:
- **AWS RDS** - Fully managed, automatic backups
- **DigitalOcean Managed Databases** - Easy setup, good value
- **Heroku Postgres** - Simple integration
- **Google Cloud SQL** - Enterprise features
- **Neon** - Serverless PostgreSQL

### Database Migration

```bash
# 1. Backup development database
pg_dump -U your_user -d kin2_dev > backup.sql

# 2. Create production database
createdb -U postgres kin2_production

# 3. Run Prisma migrations
npx prisma migrate deploy

# 4. Generate Prisma Client
npx prisma generate

# 5. Verify schema
npx prisma db push --skip-generate
```

### Database Optimization

```sql
-- Create indexes for better performance
CREATE INDEX idx_jobs_status ON "Job" (status);
CREATE INDEX idx_jobs_employer_id ON "Job" ("employerId");
CREATE INDEX idx_applications_status ON "Application" (status);
CREATE INDEX idx_applications_job_id ON "Application" ("jobId");
CREATE INDEX idx_applications_worker_id ON "Application" ("workerId");
CREATE INDEX idx_users_email ON "User" (email);
CREATE INDEX idx_users_role ON "User" (role);

-- Enable query statistics
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- Vacuum and analyze
VACUUM ANALYZE;
```

### Backup Strategy

```bash
# Automated daily backups
# Create backup script: /home/kin2/backup.sh
#!/bin/bash
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/backups/kin2"
DB_NAME="kin2_production"

mkdir -p $BACKUP_DIR

# Dump database
pg_dump -U kin2_app -Fc $DB_NAME > $BACKUP_DIR/backup_$DATE.dump

# Upload to S3
aws s3 cp $BACKUP_DIR/backup_$DATE.dump s3://kin2-backups/database/

# Keep only last 30 days locally
find $BACKUP_DIR -type f -mtime +30 -delete

# Add to crontab
# 0 2 * * * /home/kin2/backup.sh
```

---

## 🚀 Deployment Options

### Option 1: Docker Deployment (Recommended)

**docker-compose.production.yml**

```yaml
version: '3.8'

services:
  backend:
    build:
      context: ./backend
      dockerfile: Dockerfile.production
    ports:
      - "3000:3000"
    env_file:
      - .env.production
    depends_on:
      - postgres
      - redis
    restart: unless-stopped
    networks:
      - kin2-network
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile.production
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      - ./nginx/ssl:/etc/nginx/ssl:ro
    depends_on:
      - backend
    restart: unless-stopped
    networks:
      - kin2-network

  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_DB: kin2_production
      POSTGRES_USER: kin2_app
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./backups:/backups
    restart: unless-stopped
    networks:
      - kin2-network
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U kin2_app"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    command: redis-server --requirepass ${REDIS_PASSWORD}
    volumes:
      - redis_data:/data
    restart: unless-stopped
    networks:
      - kin2-network
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 3s
      retries: 5

  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      - ./nginx/ssl:/etc/nginx/ssl:ro
      - ./frontend/dist:/usr/share/nginx/html:ro
    depends_on:
      - backend
    restart: unless-stopped
    networks:
      - kin2-network

volumes:
  postgres_data:
    driver: local
  redis_data:
    driver: local

networks:
  kin2-network:
    driver: bridge
```

**Deployment Commands**

```bash
# Build images
docker-compose -f docker-compose.production.yml build

# Start services
docker-compose -f docker-compose.production.yml up -d

# View logs
docker-compose -f docker-compose.production.yml logs -f

# Stop services
docker-compose -f docker-compose.production.yml down

# Update deployment
git pull
docker-compose -f docker-compose.production.yml build
docker-compose -f docker-compose.production.yml up -d
```

### Option 2: Railway Deployment

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login
railway login

# Initialize project
railway init

# Add PostgreSQL service
railway add

# Set environment variables
railway variables set NODE_ENV=production
railway variables set DATABASE_URL=postgresql://...

# Deploy
railway up
```

### Option 3: AWS EC2 Deployment

```bash
# 1. Launch EC2 instance (Ubuntu 22.04 LTS, t3.medium)

# 2. Connect via SSH
ssh -i your-key.pem ubuntu@your-ec2-ip

# 3. Install dependencies
sudo apt update && sudo apt upgrade -y
sudo apt install -y nodejs npm postgresql postgresql-contrib nginx

# 4. Clone repository
git clone https://github.com/yourusername/kin2-platform.git
cd kin2-platform

# 5. Setup backend
cd backend
npm install --production
cp .env.example .env
# Edit .env with production values

# 6. Setup database
npx prisma generate
npx prisma migrate deploy

# 7. Install PM2
sudo npm install -g pm2

# 8. Start application
pm2 start server.js --name kin2-api
pm2 startup
pm2 save

# 9. Configure Nginx (see section above)

# 10. Setup SSL (see security hardening section)
```

### Option 4: DigitalOcean App Platform

```yaml
# app.yaml
name: kin2-platform
services:
  - name: api
    github:
      repo: yourusername/kin2-platform
      branch: main
      deploy_on_push: true
    build_command: cd backend && npm install
    run_command: cd backend && npm start
    environment_slug: node-js
    envs:
      - key: NODE_ENV
        value: production
      - key: DATABASE_URL
        value: ${db.DATABASE_URL}
    http_port: 3000
    instance_count: 2
    instance_size_slug: professional-xs
    
databases:
  - name: kin2-db
    engine: PG
    version: "15"
    production: true
```

---

## ✅ Post-Deployment Verification

### Automated Health Checks

```bash
# Create health check script: check_health.sh
#!/bin/bash
API_URL="https://api.yourdomain.com"

# Check API health
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" $API_URL/health)

if [ $HTTP_STATUS -eq 200 ]; then
    echo "✅ API is healthy"
else
    echo "❌ API health check failed (HTTP $HTTP_STATUS)"
    exit 1
fi

# Check database connection
curl -s $API_URL/health/db | grep -q "ok"
if [ $? -eq 0 ]; then
    echo "✅ Database connection OK"
else
    echo "❌ Database connection failed"
    exit 1
fi

# Check Redis connection
curl -s $API_URL/health/redis | grep -q "ok"
if [ $? -eq 0 ]; then
    echo "✅ Redis connection OK"
else
    echo "⚠️  Redis connection failed (non-critical)"
fi

echo "✅ All systems operational"
```

### Manual Verification Checklist

- [ ] **API Health**: https://api.yourdomain.com/health returns 200
- [ ] **Database**: Can connect and query
- [ ] **Authentication**: Login/register works
- [ ] **File Uploads**: Documents upload successfully
- [ ] **Email**: Test emails are delivered
- [ ] **Payments**: Test Stripe payment works
- [ ] **AI Agents**: Resume screening functions
- [ ] **KFN Scoring**: Score calculation works
- [ ] **HTTPS**: SSL certificate valid
- [ ] **CORS**: Frontend can communicate with API
- [ ] **Rate Limiting**: Excessive requests are blocked
- [ ] **Error Handling**: Errors are logged correctly
- [ ] **Monitoring**: Sentry receives errors
- [ ] **Backups**: Automated backups running
- [ ] **Performance**: Response times < 500ms

### Load Testing

```bash
# Install Apache Bench
sudo apt-get install apache2-utils

# Test API endpoint
ab -n 1000 -c 10 https://api.yourdomain.com/api/jobs

# Install Artillery for advanced testing
npm install -g artillery

# Create test scenario: load-test.yml
artillery run load-test.yml
```

---

## 📊 Monitoring & Maintenance

### Application Monitoring

**Setup Sentry Error Tracking**

```javascript
// backend/src/config/sentry.js
const Sentry = require('@sentry/node');
const Tracing = require('@sentry/tracing');

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: 0.1,
  integrations: [
    new Sentry.Integrations.Http({ tracing: true }),
    new Tracing.Integrations.Express({ app }),
  ],
});
```

### Database Monitoring

```sql
-- Check active connections
SELECT count(*) FROM pg_stat_activity;

-- Check slow queries
SELECT query, mean_exec_time, calls
FROM pg_stat_statements
ORDER BY mean_exec_time DESC
LIMIT 10;

-- Check database size
SELECT pg_size_pretty(pg_database_size('kin2_production'));

-- Check table sizes
SELECT 
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
```

### Log Management

```bash
# View application logs
pm2 logs kin2-api

# View Nginx logs
tail -f /var/log/nginx/access.log
tail -f /var/log/nginx/error.log

# View system logs
journalctl -u kin2-api -f

# Rotate logs
logrotate -f /etc/logrotate.d/kin2
```

### Performance Monitoring

```javascript
// backend/src/middleware/metrics.js
const prometheus = require('prom-client');

// Create metrics
const httpRequestDuration = new prometheus.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code']
});

const httpRequestTotal = new prometheus.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code']
});

// Middleware
module.exports = (req, res, next) => {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = (Date.now() - start) / 1000;
    
    httpRequestDuration.labels(
      req.method,
      req.route?.path || req.path,
      res.statusCode
    ).observe(duration);
    
    httpRequestTotal.labels(
      req.method,
      req.route?.path || req.path,
      res.statusCode
    ).inc();
  });
  
  next();
};
```

### Automated Maintenance Tasks

```bash
# Create maintenance script: maintenance.sh
#!/bin/bash

# Database vacuum
psql $DATABASE_URL -c "VACUUM ANALYZE;"

# Clear old logs
find /var/log/kin2 -type f -mtime +30 -delete

# Clear old sessions
psql $DATABASE_URL -c "DELETE FROM \"Session\" WHERE \"expiresAt\" < NOW();"

# Clear old notifications
psql $DATABASE_URL -c "DELETE FROM \"Notification\" WHERE \"createdAt\" < NOW() - INTERVAL '90 days';"

# Restart application (if needed)
# pm2 restart kin2-api

echo "Maintenance completed at $(date)"

# Add to crontab
# 0 3 * * 0 /home/kin2/maintenance.sh
```

---

## 🐛 Troubleshooting

### Common Production Issues

#### Issue: High CPU Usage

**Symptoms**: Slow response times, server unresponsive

**Solutions**:
```bash
# Check process usage
top
htop

# Check Node.js process
pm2 monit

# Check for memory leaks
node --inspect server.js

# Scale horizontally
pm2 scale kin2-api 4

# Optimize database queries
# Enable query logging in PostgreSQL
```

#### Issue: Database Connection Pool Exhausted

**Symptoms**: "Error: No more connections available"

**Solutions**:
```javascript
// Increase pool size in prisma/schema.prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
  pool_timeout = 20
  max_connections = 20
}

// Or in DATABASE_URL
postgresql://user:pass@host:5432/db?connection_limit=20
```

#### Issue: Out of Memory

**Symptoms**: Application crashes, PM2 restarts

**Solutions**:
```bash
# Increase Node.js memory limit
node --max-old-space-size=4096 server.js

# Or in PM2
pm2 start server.js --node-args="--max-old-space-size=4096"

# Check memory usage
free -h
pm2 monit
```

#### Issue: SSL Certificate Expired

**Symptoms**: HTTPS not working, browser warnings

**Solutions**:
```bash
# Renew Let's Encrypt certificate
sudo certbot renew

# Check certificate expiry
openssl x509 -in /etc/letsencrypt/live/yourdomain.com/cert.pem -noout -dates

# Auto-renewal should be in crontab
0 0 1 * * /usr/bin/certbot renew --quiet
```

#### Issue: AI API Rate Limiting

**Symptoms**: AI features failing with 429 errors

**Solutions**:
```javascript
// Implement exponential backoff
async function retryWithBackoff(fn, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (error.status === 429 && i < maxRetries - 1) {
        const delay = Math.pow(2, i) * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        throw error;
      }
    }
  }
}

// Implement request queuing
const Queue = require('bull');
const aiQueue = new Queue('ai-requests', process.env.REDIS_URL);

aiQueue.process(async (job) => {
  return await processAIRequest(job.data);
});
```

### Emergency Procedures

#### Application Down

```bash
# 1. Check if process is running
pm2 status

# 2. Restart application
pm2 restart kin2-api

# 3. Check logs for errors
pm2 logs kin2-api --lines 100

# 4. Check system resources
df -h
free -m
top

# 5. Rollback if needed
git checkout previous-tag
pm2 restart kin2-api
```

#### Database Down

```bash
# 1. Check database status
sudo systemctl status postgresql

# 2. Restart database
sudo systemctl restart postgresql

# 3. Check connections
psql -U kin2_app -d kin2_production -c "SELECT 1"

# 4. Restore from backup if needed
pg_restore -U kin2_app -d kin2_production backup_20260127.dump
```

---

## 📈 Scaling Considerations

### Vertical Scaling

When to scale up:
- CPU usage consistently > 70%
- Memory usage > 80%
- Response times > 1 second
- Database connections maxed out

**Actions**:
- Upgrade server instance size
- Increase database tier
- Add more memory to Node.js process

### Horizontal Scaling

When to scale out:
- Single server cannot handle load
- Need high availability
- Geographic distribution required

**Implementation**:
```yaml
# docker-compose with multiple backend instances
services:
  backend-1:
    build: ./backend
    ports:
      - "3001:3000"
  
  backend-2:
    build: ./backend
    ports:
      - "3002:3000"
  
  backend-3:
    build: ./backend
    ports:
      - "3003:3000"
  
  load-balancer:
    image: nginx
    volumes:
      - ./nginx/load-balancer.conf:/etc/nginx/nginx.conf
    ports:
      - "3000:80"
    depends_on:
      - backend-1
      - backend-2
      - backend-3
```

### Caching Strategy

```javascript
// Implement Redis caching
const redis = require('redis');
const client = redis.createClient({ url: process.env.REDIS_URL });

// Cache middleware
async function cacheMiddleware(req, res, next) {
  const key = `cache:${req.originalUrl}`;
  
  try {
    const cached = await client.get(key);
    if (cached) {
      return res.json(JSON.parse(cached));
    }
    
    // Store original send function
    const originalSend = res.json;
    
    // Override send to cache response
    res.json = function(data) {
      client.setEx(key, 3600, JSON.stringify(data));
      return originalSend.call(this, data);
    };
    
    next();
  } catch (error) {
    next();
  }
}
```

---

## 🎯 Performance Optimization

### Database Optimization

```sql
-- Add missing indexes
CREATE INDEX CONCURRENTLY idx_applications_status_created 
ON "Application" (status, "createdAt" DESC);

-- Optimize queries
EXPLAIN ANALYZE
SELECT * FROM "Job" 
WHERE status = 'ACTIVE' 
ORDER BY "createdAt" DESC 
LIMIT 10;

-- Enable connection pooling
ALTER SYSTEM SET max_connections = 100;
ALTER SYSTEM SET shared_buffers = '256MB';
ALTER SYSTEM SET effective_cache_size = '1GB';
```

### Application Optimization

```javascript
// Enable compression
const compression = require('compression');
app.use(compression());

// Optimize JSON parsing
app.use(express.json({ limit: '1mb' }));

// Enable HTTP/2
const spdy = require('spdy');
const server = spdy.createServer(options, app);

// Implement clustering
const cluster = require('cluster');
const numCPUs = require('os').cpus().length;

if (cluster.isMaster) {
  for (let i = 0; i < numCPUs; i++) {
    cluster.fork();
  }
} else {
  app.listen(PORT);
}
```

---

## 📞 Support & Resources

### Production Support

- **Emergency Contact**: emergency@yourdomain.com
- **Status Page**: status.yourdomain.com
- **Documentation**: docs.yourdomain.com
- **Slack Channel**: #production-alerts

### External Resources

- [PostgreSQL Performance Tuning](https://wiki.postgresql.org/wiki/Performance_Optimization)
- [Node.js Production Best Practices](https://nodejs.org/en/docs/guides/nodejs-docker-webapp/)
- [Express Security Best Practices](https://expressjs.com/en/advanced/best-practice-security.html)
- [Docker Security](https://docs.docker.com/engine/security/)

---

## ✅ Deployment Checklist Summary

### Pre-Launch

- [ ] All environment variables set in production
- [ ] SSL certificates installed and valid
- [ ] Database backups configured
- [ ] Monitoring and error tracking active
- [ ] Load testing completed successfully
- [ ] Security audit passed
- [ ] Legal documents published
- [ ] Payment processing tested

### Launch Day

- [ ] DNS configured and propagated
- [ ] Application deployed and running
- [ ] Health checks passing
- [ ] All services responding correctly
- [ ] Monitoring dashboards active
- [ ] Team briefed on emergency procedures
- [ ] Support channels prepared

### Post-Launch

- [ ] Monitor error rates for 24 hours
- [ ] Check performance metrics
- [ ] Review user feedback
- [ ] Update documentation with any issues found
- [ ] Schedule follow-up security review

---

**Deployment Date:** _________________  
**Deployed By:** _________________  
**Sign-off:** _________________ 

---

*This guide is maintained by the KIN2 team and updated regularly. Last update: January 27, 2026*
