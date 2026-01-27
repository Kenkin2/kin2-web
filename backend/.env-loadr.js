const fs = require('fs');
const path = require('path');

class EnvLoader {
  constructor() {
    this.env = process.env.NODE_ENV || 'development';
    this.loaded = false;
  }

  load() {
    if (this.loaded) return;

    // Load base .env
    const basePath = path.join(process.cwd(), '.env');
    this.loadFile(basePath);

    // Load environment-specific .env
    const envPath = path.join(process.cwd(), `.env.${this.env}`);
    this.loadFile(envPath);

    // Load local overrides (gitignored)
    const localPath = path.join(process.cwd(), '.env.local');
    if (fs.existsSync(localPath)) {
      this.loadFile(localPath);
    }

    this.validate();
    this.loaded = true;
  }

  loadFile(filePath) {
    if (!fs.existsSync(filePath)) return;

    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');

    lines.forEach(line => {
      line = line.trim();
      
      // Skip comments and empty lines
      if (!line || line.startsWith('#')) return;
      
      // Parse key=value
      const match = line.match(/^([^=]+)=(.*)$/);
      if (match) {
        const key = match[1].trim();
        let value = match[2].trim();
        
        // Remove quotes if present
        if (value.startsWith('"') && value.endsWith('"')) {
          value = value.slice(1, -1);
        } else if (value.startsWith("'") && value.endsWith("'")) {
          value = value.slice(1, -1);
        }
        
        // Set environment variable if not already set
        if (!process.env[key]) {
          process.env[key] = this.expandVariables(value);
        }
      }
    });
  }

  expandVariables(value) {
    // Expand ${VAR} or $VAR references
    return value.replace(/\$\{([^}]+)\}|\$([A-Z_]+)/g, (match, p1, p2) => {
      const varName = p1 || p2;
      return process.env[varName] || match;
    });
  }

  validate() {
    const required = [
      'NODE_ENV',
      'PORT',
      'DATABASE_URL',
      'JWT_SECRET',
      'JWT_REFRESH_SECRET'
    ];

    const missing = required.filter(key => !process.env[key]);
    
    if (missing.length > 0) {
      console.error('❌ Missing required environment variables:');
      missing.forEach(key => console.error(`   - ${key}`));
      process.exit(1);
    }

    // Validate specific formats
    this.validateDatabaseUrl();
    this.validateJwtSecrets();
    this.validateApiKeys();
  }

  validateDatabaseUrl() {
    const url = process.env.DATABASE_URL;
    if (!url.startsWith('postgresql://')) {
      console.error('❌ DATABASE_URL must start with postgresql://');
      process.exit(1);
    }
  }

  validateJwtSecrets() {
    const jwtSecret = process.env.JWT_SECRET;
    const refreshSecret = process.env.JWT_REFRESH_SECRET;
    
    if (jwtSecret.length < 32) {
      console.error('❌ JWT_SECRET must be at least 32 characters');
      process.exit(1);
    }
    
    if (refreshSecret.length < 32) {
      console.error('❌ JWT_REFRESH_SECRET must be at least 32 characters');
      process.exit(1);
    }
    
    if (jwtSecret === refreshSecret) {
      console.error('❌ JWT_SECRET and JWT_REFRESH_SECRET must be different');
      process.exit(1);
    }
  }

  validateApiKeys() {
    if (process.env.ENABLE_AI_AGENTS === 'true' && !process.env.DEEPSEEK_API_KEY) {
      console.warn('⚠️  AI agents enabled but DEEPSEEK_API_KEY not set');
    }
    
    if (process.env.ENABLE_PAYMENTS === 'true' && !process.env.STRIPE_SECRET_KEY) {
      console.warn('⚠️  Payments enabled but STRIPE_SECRET_KEY not set');
    }
    
    if (process.env.ENABLE_EMAIL_NOTIFICATIONS === 'true' && !process.env.SMTP_HOST) {
      console.warn('⚠️  Email notifications enabled but SMTP not configured');
    }
  }

  getAll() {
    return { ...process.env };
  }

  get(key, defaultValue = null) {
    return process.env[key] || defaultValue;
  }

  isProduction() {
    return this.env === 'production';
  }

  isDevelopment() {
    return this.env === 'development';
  }

  isTesting() {
    return this.env === 'test';
  }
}

module.exports = new EnvLoader();
