# 🚀 Kin2 Workforce Platform - Complete Production System v2.5.0

> **Enterprise-Grade AI-Powered Workforce Management Platform**  
> Complete, production-ready implementation with all features

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-20+-green.svg)](https://nodejs.org/)
[![Database](https://img.shields.io/badge/Database-PostgreSQL-blue.svg)](https://postgresql.org/)

---

## 📦 What's Included

This is a **complete, production-ready implementation** with:

✅ **Backend (Node.js + Express + Prisma)**
- 50+ database models (complete schema)
- 12 API route modules
- JWT authentication with refresh tokens
- Role-based access control (6 roles)
- Rate limiting & security headers
- Comprehensive error handling
- Request logging with Winston

✅ **AI System (14 Specialized Agents)**
- Resume screening
- Job matching (KFN algorithm)
- Interview scheduling
- Salary recommendations
- Culture fit analysis
- Fraud detection
- Support chatbot
- 7 additional agents

✅ **Payment Processing (Stripe)**
- Payment intents
- Subscriptions
- Webhook handling
- Invoice generation
- Refund processing

✅ **Email System**
- Template-based emails
- Welcome, password reset, notifications
- Interview invitations with calendar
- Payment receipts
- Bulk email support

✅ **Frontend (React + Tailwind)**
- Authentication pages
- Employer dashboard
- Worker dashboard
- Job marketplace
- AI agents interface
- Profile management
- Responsive design

✅ **DevOps**
- Docker configuration
- Deployment scripts
- Environment management
- Health checks
- Logging & monitoring

---

## 🎯 Quick Start (5 Minutes)

### Prerequisites

- Node.js 20+ ([Download](https://nodejs.org/))
- PostgreSQL 15+ (or use [Neon.tech](https://neon.tech) free tier)
- npm 10+

### Installation

```bash
# 1. Extract the package
cd kin2-final

# 2. Install backend dependencies
cd backend
npm install

# 3. Configure environment
cp .env.example .env
# Edit .env with your database URL and API keys

# 4. Setup database
npx prisma generate
npx prisma db push

# 5. Start backend
npm start
```

Backend running at: **http://localhost:3000**

```bash
# 6. Install frontend dependencies (new terminal)
cd ../frontend
npm install

# 7. Start frontend
npm run dev
```

Frontend running at: **http://localhost:5173**

### First Steps

1. Open **http://localhost:5173**
2. Click "Register"
3. Create an account (choose "Employer" or "Worker")
4. Explore the dashboard!

---

## 📁 Project Structure

```
kin2-final/
├── backend/
│   ├── server.js                 # Main Express server
│   ├── package.json             # Backend dependencies
│   ├── .env.example             # Environment template
│   ├── prisma/
│   │   ├── schema.prisma        # 50+ database models
│   │   └── seed.js              # Sample data
│   ├── src/
│   │   ├── routes/              # API routes (12 modules)
│   │   │   ├── auth.routes.js
│   │   │   ├── user.routes.js
│   │   │   ├── employer.routes.js
│   │   │   ├── worker.routes.js
│   │   │   ├── job.routes.js
│   │   │   ├── application.routes.js
│   │   │   ├── ai.routes.js
│   │   │   ├── kfn.routes.js
│   │   │   ├── payment.routes.js
│   │   │   ├── notification.routes.js
│   │   │   ├── analytics.routes.js
│   │   │   └── admin.routes.js
│   │   ├── services/            # Business logic
│   │   │   ├── ai/              # 14 AI agents
│   │   │   ├── kfn/             # KFN scoring
│   │   │   ├── payment/         # Stripe integration
│   │   │   └── email/           # Email service
│   │   ├── middleware/          # Auth, validation, etc.
│   │   ├── utils/               # Helpers
│   │   └── config/              # Configuration
│   └── tests/                   # Test suites
├── frontend/
│   ├── package.json             # Frontend dependencies
│   ├── vite.config.js           # Vite configuration
│   ├── tailwind.config.js       # Tailwind CSS
│   ├── src/
│   │   ├── App.tsx              # Main app
│   │   ├── components/          # React components
│   │   ├── pages/               # Page components
│   │   ├── services/            # API clients
│   │   ├── contexts/            # React contexts
│   │   ├── hooks/               # Custom hooks
│   │   └── utils/               # Utilities
│   └── public/                  # Static assets
├── docker-compose.yml           # Docker orchestration
├── deploy.sh                    # Deployment script
├── README.md                    # This file
└── DEPLOYMENT_GUIDE.md          # Production deployment

```

---

## 🗄️ Database Models (50+)

### Core Models
- **User** - Base user accounts
- **Profile** - User profiles
- **Session** - Active sessions
- **RefreshToken** - JWT refresh tokens
- **ApiKey** - API access keys

### Business Models
- **Employer** - Company accounts
- **Worker** - Worker accounts
- **Volunteer** - Volunteer accounts
- **Freelancer** - Freelancer accounts
- **Seller** - Marketplace sellers
- **Admin** - Platform administrators

### Job & Workflow
- **Job** - Job postings
- **Application** - Job applications
- **Interview** - Interview scheduling
- **Shift** - Work shifts
- **CompletedShift** - Shift records

### AI & Matching
- **AIAgent** - AI agent configurations
- **AIAgentLog** - Agent execution logs
- **JobMatch** - AI-generated matches
- **KFNScore** - Fairness scores

### Financial
- **Payment** - Payment records
- **Earning** - Worker earnings
- **Transaction** - Financial transactions

### Communication
- **Message** - User messages
- **Notification** - System notifications

### Engagement
- **KarmaTransaction** - Karma points
- **Review** - User reviews

### Additional Models
- **Department** - Company departments
- **Product** - Marketplace products
- **ComplianceDoc** - Compliance documents
- **ActivityLog** - Audit trail

[See complete schema in `backend/prisma/schema.prisma`]

---

## 🔐 Authentication

### JWT-Based Authentication

```javascript
// Register
POST /api/auth/register
{
  "email": "user@example.com",
  "password": "securepassword",
  "firstName": "John",
  "lastName": "Doe",
  "role": "WORKER" // or EMPLOYER, VOLUNTEER, etc.
}

// Response
{
  "user": { ... },
  "accessToken": "eyJhbGc...",
  "refreshToken": "eyJhbGc..."
}

// Login
POST /api/auth/login
{
  "email": "user@example.com",
  "password": "securepassword"
}

// Authenticated requests
GET /api/users/me
Authorization: Bearer eyJhbGc...
```

### Roles
- **EMPLOYER** - Post jobs, manage applications
- **WORKER** - Apply for jobs, manage shifts
- **VOLUNTEER** - Volunteer opportunities
- **FREELANCER** - Project-based work
- **SELLER** - Sell products/services
- **ADMIN** - Platform administration

---

## 🤖 AI Agents

### 14 Specialized Agents

#### 1. Resume Screening Agent
Analyzes resumes and matches against job requirements.

```javascript
POST /api/ai/screen
{
  "resumeText": "...",
  "jobId": "job123"
}
```

#### 2. Job Matching Agent (KFN)
Matches workers to jobs using KFN algorithm.

```javascript
POST /api/ai/match
{
  "workerId": "worker123"
}

// Response
{
  "matches": [
    {
      "job": { ... },
      "kfnScore": 87.5,
      "reasoning": "...",
      "strengths": [...],
      "concerns": [...]
    }
  ]
}
```

#### 3. Interview Scheduling Agent
Coordinates interview times automatically.

#### 4. Salary Recommendation Agent
Suggests competitive salary ranges.

#### 5. Culture Fit Analyzer
Assesses candidate-company alignment.

#### 6. Fraud Detection Agent
Identifies suspicious activity.

#### 7. Support Agent
24/7 conversational support.

#### 8-14. Additional Agents
- Onboarding assistant
- Retention advisor
- Performance analyzer
- Compliance checker
- Market analyzer
- Training coordinator
- Skills assessor

### KFN Score Algorithm

**KFN (Kin Fairness Number)** - Proprietary matching algorithm

```javascript
POST /api/kfn/calculate
{
  "workerId": "worker123",
  "jobId": "job456"
}

// Response
{
  "score": 87.5,
  "breakdown": {
    "skills": 90,
    "experience": 85,
    "location": 80,
    "salary": 88,
    "availability": 95
  },
  "recommendation": "STRONG_MATCH",
  "insights": [
    "Excellent skills match",
    "Location within preferred radius"
  ]
}
```

---

## 💳 Payment Processing

### Stripe Integration

```javascript
// Create payment intent
POST /api/payments/create-intent
{
  "amount": 99.99,
  "description": "Job posting - Premium"
}

// Response
{
  "clientSecret": "pi_xxx_secret_xxx",
  "paymentIntentId": "pi_xxx"
}

// Create subscription
POST /api/payments/subscribe
{
  "priceId": "price_xxx",
  "plan": "professional"
}

// Webhook endpoint for Stripe events
POST /api/payments/webhook
```

### Supported Operations
- One-time payments
- Recurring subscriptions
- Refunds
- Invoice generation
- Payment history
- Webhook handling

---

## 📧 Email Notifications

### Email Templates

- Welcome email
- Password reset
- Email verification
- Job application received
- Interview invitation (with calendar)
- Application status update
- Payment receipt
- Weekly AI report

### Send Email

```javascript
// Programmatically
const emailService = require('./services/email');

await emailService.sendWelcomeEmail(user);
await emailService.sendJobApplicationNotification(employer, job, applicant);
await emailService.sendInterviewInvitation(candidate, interview);
```

---

## 🎨 Frontend Features

### Pages

1. **Authentication**
   - Login / Register
   - Password reset
   - Email verification

2. **Employer Dashboard**
   - Overview statistics
   - Active jobs
   - Applications pipeline
   - KFN score monitoring
   - AI agents status

3. **Worker Dashboard**
   - Job recommendations
   - Application status
   - Upcoming shifts
   - Earnings tracker
   - Profile completion

4. **Job Marketplace**
   - Search & filter jobs
   - Advanced filters
   - Map view
   - Job details
   - Quick apply

5. **AI Agents Interface**
   - Agent status
   - Usage analytics
   - Cost tracking
   - Performance metrics

6. **Profile Management**
   - Personal information
   - Skills & experience
   - Certifications
   - Availability
   - Preferences

---

## 🚀 Deployment

### Quick Deploy to Railway

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login
railway login

# Initialize
railway init

# Deploy
railway up
```

### Docker Deployment

```bash
# Build and run
docker-compose up -d

# View logs
docker-compose logs -f

# Stop
docker-compose down
```

### Manual Deployment

See `DEPLOYMENT_GUIDE.md` for detailed instructions on:
- AWS EC2
- DigitalOcean
- Heroku
- Vercel
- Custom VPS

---

## 🔧 Configuration

### Environment Variables

See `.env.example` for all configuration options.

**Critical Variables:**
- `DATABASE_URL` - PostgreSQL connection
- `JWT_SECRET` - Authentication secret
- `DEEPSEEK_API_KEY` - AI provider key
- `STRIPE_SECRET_KEY` - Payment processing
- `SMTP_*` - Email configuration

### Feature Flags

Enable/disable features via environment:

```env
ENABLE_AI_AGENTS=true
ENABLE_EMAIL_NOTIFICATIONS=true
ENABLE_PAYMENTS=true
ENABLE_KFN_SCORING=true
```

---

## 📊 API Documentation

### Base URL
`http://localhost:3000/api`

### Authentication Endpoints
- `POST /auth/register` - Register new user
- `POST /auth/login` - Login
- `POST /auth/refresh` - Refresh token
- `POST /auth/logout` - Logout
- `GET /auth/me` - Get current user

### Job Endpoints
- `GET /jobs` - List jobs
- `POST /jobs` - Create job (employer only)
- `GET /jobs/:id` - Get job details
- `PUT /jobs/:id` - Update job
- `DELETE /jobs/:id` - Delete job

### Application Endpoints
- `POST /applications` - Apply for job
- `GET /applications` - List applications
- `PATCH /applications/:id` - Update status

### AI Endpoints
- `POST /ai/screen` - Screen resume
- `POST /ai/match` - Get job matches
- `POST /ai/chat` - Chat with support agent
- `GET /ai/agents/status` - Agent status

### KFN Endpoints
- `POST /kfn/calculate` - Calculate score
- `POST /kfn/batch` - Batch calculate
- `GET /kfn/worker/:id/trends` - Score trends

### Payment Endpoints
- `POST /payments/create-intent` - Create payment
- `POST /payments/subscribe` - Subscribe
- `GET /payments/history` - Payment history

[Full API documentation: http://localhost:3000/api/docs]

---

## 🧪 Testing

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Run specific test
npm test -- auth.test.js

# Watch mode
npm run test:watch
```

---

## 🐛 Troubleshooting

### Common Issues

**Database Connection Failed**
```bash
# Check PostgreSQL is running
psql -U postgres

# Verify DATABASE_URL in .env
# Format: postgresql://user:password@host:port/database
```

**Port Already in Use**
```bash
# Change PORT in .env
PORT=3001

# Or kill process on port 3000
lsof -ti:3000 | xargs kill
```

**Prisma Client Not Generated**
```bash
npx prisma generate
```

**JWT Token Invalid**
```bash
# Regenerate JWT_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## 📈 Performance

### Expected Metrics

- **Response Time**: < 200ms (average)
- **Throughput**: 1000+ requests/second
- **Database Queries**: < 50ms (average)
- **AI Agent Calls**: 1-3 seconds
- **Uptime**: 99.9%

### Optimization

- Prisma query optimization
- Redis caching (optional)
- CDN for static assets
- Database connection pooling
- Rate limiting per user

---

## 🔒 Security

### Implemented

✅ JWT with refresh tokens
✅ Password hashing (bcrypt)
✅ Helmet security headers
✅ CORS configuration
✅ Rate limiting
✅ Input validation
✅ SQL injection protection (Prisma)
✅ XSS protection
✅ CSRF tokens (optional)

### Best Practices

1. Rotate JWT secrets regularly
2. Use HTTPS in production
3. Enable 2FA for admins
4. Regular security audits
5. Keep dependencies updated
6. Monitor for suspicious activity

---

## 📝 License

MIT License - see LICENSE file

---

## 🤝 Support

- **Email**: support@kin2.co.uk
- **Documentation**: [docs.kin2.co.uk](https://docs.kin2.co.uk)
- **Issues**: GitHub Issues
- **Discord**: [Join Community](https://discord.gg/kin2)

---

## 🎉 Credits

Built with ❤️ by the Kin2 Team

**Technologies:**
- Node.js & Express
- PostgreSQL & Prisma
- React & Tailwind CSS
- DeepSeek AI
- Stripe
- And many more amazing open-source projects

---

## 🚧 Roadmap

### v2.6.0 (Q2 2024)
- [ ] Mobile app (React Native)
- [ ] Advanced analytics
- [ ] ML-based recommendations
- [ ] Multi-language support

### v3.0.0 (Q3 2024)
- [ ] Video interviews
- [ ] Skills assessments
- [ ] Blockchain certifications
- [ ] White-label solution

---

**Built for scale. Ready for production. Loved by users.** 🚀
