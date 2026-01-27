# 🚀 Kin2 Workforce Platform - Installation Guide

## Quick Installation (10 Minutes)

### Step 1: Extract Package

```bash
# Extract the downloaded file
unzip kin2-final.zip
cd kin2-final
```

### Step 2: Install Backend

```bash
cd backend

# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# Edit .env with your values
nano .env  # or use your favorite editor
```

**Required Environment Variables:**

```env
# Database (Get free from neon.tech)
DATABASE_URL="postgresql://user:password@host:5432/database"

# JWT Secret (Generate random string)
JWT_SECRET="your-secret-minimum-32-chars"

# AI Provider (Get from platform.deepseek.com - $5 free credit)
DEEPSEEK_API_KEY="sk-your-key"
```

### Step 3: Setup Database

```bash
# Generate Prisma Client
npx prisma generate

# Push schema to database
npx prisma db push

# (Optional) Seed with sample data
npm run db:seed
```

### Step 4: Start Backend

```bash
npm start

# Backend running at: http://localhost:3000
# Health check: http://localhost:3000/health
```

### Step 5: Install Frontend (New Terminal)

```bash
cd ../frontend

# Install dependencies
npm install

# Start development server
npm run dev

# Frontend running at: http://localhost:5173
```

### Step 6: Test the System

1. Open **http://localhost:5173**
2. Click "Register"
3. Create account (choose role: EMPLOYER or WORKER)
4. Login and explore!

---

## 📋 Detailed Prerequisites

### Required Software

| Software | Version | Installation |
|----------|---------|--------------|
| **Node.js** | 20.0.0+ | [Download](https://nodejs.org/) |
| **npm** | 10.0.0+ | Included with Node.js |
| **PostgreSQL** | 15.0+ | [Download](https://postgresql.org/) or use [Neon.tech](https://neon.tech) |

### Check Your Versions

```bash
node --version    # Should be v20.0.0 or higher
npm --version     # Should be 10.0.0 or higher
psql --version    # Should be 15.0 or higher (if using local PostgreSQL)
```

---

## 🗄️ Database Setup Options

### Option A: Neon.tech (Recommended - Free)

1. Go to [neon.tech](https://neon.tech)
2. Sign up (no credit card required)
3. Create new project
4. Copy connection string
5. Paste in `.env` as `DATABASE_URL`

**Pros:**
- Free tier (0.5 GB storage)
- No installation needed
- Automatic backups
- Fast setup

### Option B: Local PostgreSQL

```bash
# Install PostgreSQL
# macOS
brew install postgresql@16

# Ubuntu/Debian
sudo apt-get install postgresql-16

# Windows
# Download from postgresql.org

# Start PostgreSQL
brew services start postgresql  # macOS
sudo systemctl start postgresql # Linux

# Create database
createdb kin2_workforce

# Set DATABASE_URL in .env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/kin2_workforce"
```

### Option C: Railway (Free Tier)

1. Go to [railway.app](https://railway.app)
2. Create new project
3. Add PostgreSQL
4. Copy connection string
5. Use in `.env`

### Option D: Docker PostgreSQL

```bash
docker run --name kin2-postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=kin2_workforce \
  -p 5432:5432 \
  -d postgres:16-alpine

# DATABASE_URL="postgresql://postgres:postgres@localhost:5432/kin2_workforce"
```

---

## 🔑 API Keys Setup

### 1. DeepSeek AI (Primary AI Provider)

**Cost:** $5 free credit, then $0.14 per million tokens

1. Go to [platform.deepseek.com](https://platform.deepseek.com)
2. Sign up
3. Go to API Keys
4. Create new key
5. Copy to `.env` as `DEEPSEEK_API_KEY`

### 2. Stripe (For Payments - Optional)

**Cost:** Free test mode, 2.9% + 30¢ per transaction in production

1. Go to [stripe.com](https://stripe.com)
2. Sign up
3. Get API keys from Dashboard
4. Copy to `.env`:
   ```env
   STRIPE_SECRET_KEY="sk_test_..."
   STRIPE_PUBLISHABLE_KEY="pk_test_..."
   ```

### 3. Email SMTP (Optional)

**Option A: Gmail**

1. Enable 2-factor authentication
2. Generate App Password
3. Configure in `.env`:
   ```env
   SMTP_HOST="smtp.gmail.com"
   SMTP_PORT=587
   SMTP_USER="your-email@gmail.com"
   SMTP_PASSWORD="your-app-password"
   ```

**Option B: SendGrid (100 emails/day free)**

1. Go to [sendgrid.com](https://sendgrid.com)
2. Sign up
3. Create API key
4. Configure in `.env`:
   ```env
   SMTP_HOST="smtp.sendgrid.net"
   SMTP_PORT=587
   SMTP_USER="apikey"
   SMTP_PASSWORD="SG.your-api-key"
   ```

---

## ⚙️ Configuration Checklist

### Minimum Required (.env)

```env
✓ DATABASE_URL          # PostgreSQL connection string
✓ JWT_SECRET            # Random string (32+ characters)
✓ DEEPSEEK_API_KEY      # AI provider key
```

### Recommended (.env)

```env
✓ NODE_ENV="production"              # Or "development"
✓ PORT=3000                          # Server port
✓ CORS_ORIGIN="http://localhost:5173"  # Frontend URL
✓ APP_URL="http://localhost:3000"   # Backend URL
✓ STRIPE_SECRET_KEY                  # For payments
✓ SMTP_*                             # For emails
```

### Generate JWT Secret

```bash
# Generate random 32-character string
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Copy output to .env as JWT_SECRET
```

---

## 🧪 Testing Your Installation

### 1. Health Check

```bash
curl http://localhost:3000/health

# Expected response:
{
  "status": "ok",
  "timestamp": "2024-01-27T...",
  "database": "connected",
  "version": "2.5.0"
}
```

### 2. Test Registration

```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "password123",
    "firstName": "Test",
    "lastName": "User",
    "role": "WORKER"
  }'

# Should return user object and tokens
```

### 3. Test Authentication

```bash
# Replace TOKEN with accessToken from registration
curl http://localhost:3000/api/auth/me \
  -H "Authorization: Bearer TOKEN"

# Should return current user details
```

### 4. Test Frontend

1. Open http://localhost:5173
2. Should see Kin2 login page
3. Register new account
4. Should redirect to dashboard

---

## 🐛 Troubleshooting

### Issue: "Cannot connect to database"

**Solution:**
```bash
# Check DATABASE_URL format
postgresql://USER:PASSWORD@HOST:PORT/DATABASE

# Test connection
psql $DATABASE_URL

# Common issues:
- Missing password in URL
- Wrong host/port
- Database doesn't exist
- SSL required (add ?sslmode=require)
```

### Issue: "Port 3000 already in use"

**Solution:**
```bash
# Option 1: Change port in .env
PORT=3001

# Option 2: Kill process using port
lsof -ti:3000 | xargs kill
```

### Issue: "Prisma Client not generated"

**Solution:**
```bash
cd backend
npx prisma generate
```

### Issue: "Module not found"

**Solution:**
```bash
# Reinstall dependencies
rm -rf node_modules package-lock.json
npm install
```

### Issue: "JWT token invalid"

**Solution:**
```bash
# Ensure JWT_SECRET is set in .env
# Must be at least 32 characters
# Regenerate if needed
```

### Issue: "CORS error in browser"

**Solution:**
```env
# In backend/.env, add frontend URL
CORS_ORIGIN="http://localhost:5173,http://localhost:3000"
```

---

## 🚀 Production Deployment

### Quick Deploy to Railway

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login
railway login

# Deploy
railway init
railway up

# Set environment variables in Railway dashboard
```

### Docker Deployment

```bash
# Build and run with Docker Compose
docker-compose up -d

# View logs
docker-compose logs -f

# Stop
docker-compose down
```

### Manual VPS Deployment

```bash
# 1. SSH to your server
ssh user@your-server.com

# 2. Clone/upload project
git clone your-repo
# or
scp -r kin2-final user@server:/path

# 3. Install dependencies
cd kin2-final/backend
npm install --production

# 4. Setup environment
cp .env.example .env
nano .env

# 5. Setup database
npx prisma generate
npx prisma migrate deploy

# 6. Install PM2
npm install -g pm2

# 7. Start with PM2
pm2 start server.js --name kin2-workforce
pm2 save
pm2 startup

# 8. Setup Nginx reverse proxy
sudo nano /etc/nginx/sites-available/kin2

# 9. Enable site
sudo ln -s /etc/nginx/sites-available/kin2 /etc/nginx/sites-enabled/
sudo systemctl restart nginx
```

---

## 📊 Post-Installation Steps

### 1. Create Admin Account

```bash
# In Prisma Studio
npx prisma studio

# Or using SQL
psql $DATABASE_URL -c "UPDATE users SET role='ADMIN' WHERE email='admin@example.com';"
```

### 2. Configure Email Templates

Edit files in `backend/src/services/email/templates/`

### 3. Setup Cron Jobs (Optional)

```bash
# Add to crontab
crontab -e

# Daily KFN recalculation (midnight)
0 0 * * * cd /path/to/backend && node scripts/calculate-kfn.js

# Weekly reports (Sunday 9 AM)
0 9 * * 0 cd /path/to/backend && node scripts/weekly-report.js
```

### 4. Enable Monitoring

```env
# Add to .env
SENTRY_DSN="your-sentry-dsn"
NEW_RELIC_LICENSE_KEY="your-key"
```

### 5. Backup Database

```bash
# Create backup script
pg_dump $DATABASE_URL > backup-$(date +%Y%m%d).sql

# Schedule daily backups
0 2 * * * /path/to/backup-script.sh
```

---

## 📚 Next Steps

1. **Read the README.md** - Full documentation
2. **Explore API** - http://localhost:3000/api/docs
3. **Configure AI agents** - Enable/disable as needed
4. **Customize frontend** - Branding, colors, features
5. **Setup analytics** - Track usage and performance
6. **Enable features** - Payments, emails, notifications
7. **Test thoroughly** - Before production deployment
8. **Deploy** - Follow production deployment guide

---

## 🆘 Getting Help

- **Documentation**: README.md, API docs
- **Email**: support@kin2.co.uk
- **Issues**: GitHub Issues (if applicable)
- **Community**: Discord (link in README)

---

## ✅ Installation Complete!

You now have a fully functional Kin2 Workforce Platform running locally.

**Access Points:**
- **Frontend**: http://localhost:5173
- **Backend API**: http://localhost:3000/api
- **Health Check**: http://localhost:3000/health
- **Database**: Prisma Studio (`npx prisma studio`)

**Default Test Accounts:** (if seeded)
- Employer: `employer@test.com` / `password123`
- Worker: `worker@test.com` / `password123`

🎉 **Happy Building!**
