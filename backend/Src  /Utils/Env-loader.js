/**
 * Advanced Environment Loader for Kin2 Platform
 * Loads .env files with inheritance and validation
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class EnvLoader {
  constructor() {
    this.env = process.env.NODE_ENV || 'development';
    this.loadedFiles = [];
    this.loaded = false;
    this.errors = [];
    this.warnings = [];
  }

  /**
   * Load all environment files in order of precedence
   */
  load() {
    if (this.loaded) {
      console.warn('⚠️ Environment already loaded');
      return;
    }

    console.log(`🌍 Loading environment for: ${this.env}`);

    // Define load order (last file wins)
    const filesToLoad = [
      '.env',                    // Base config
      `.env.${this.env}`,       // Environment-specific
      '.env.local',             // Local overrides (gitignored)
      `.env.${this.env}.local`  // Environment-specific local overrides
    ];

    // Load each file
    for (const fileName of filesToLoad) {
      this.loadFile(fileName);
    }

    // Expand variables (resolve ${VAR} references)
    this.expandVariables();

    // Set defaults for critical variables
    this.setDefaults();

    // Validate configuration
    this.validate();

    // Log results
    this.logResults();

    this.loaded = true;
  }

  /**
   * Load a single environment file
   */
  loadFile(fileName) {
    const filePath = path.join(process.cwd(), fileName);
    
    if (!fs.existsSync(filePath)) {
      return;
    }

    console.log(`   📄 Loading: ${fileName}`);
    this.loadedFiles.push(fileName);

    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');

    lines.forEach((line, index) => {
      line = line.trim();
      
      // Skip comments and empty lines
      if (!line || line.startsWith('#')) return;
      
      // Parse key=value
      const match = line.match(/^([^=]+)=(.*)$/);
      if (match) {
        const key = match[1].trim();
        let value = match[2].trim();
        
        // Remove surrounding quotes if present
        value = this.unquoteValue(value);
        
        // Only set if not already defined (allow overrides)
        if (process.env[key] === undefined) {
          process.env[key] = value;
        }
      } else {
        this.warnings.push(`Invalid line in ${fileName}:${index + 1}: ${line}`);
      }
    });
  }

  /**
   * Remove quotes from value
   */
  unquoteValue(value) {
    if ((value.startsWith('"') && value.endsWith('"')) || 
        (value.startsWith("'") && value.endsWith("'"))) {
      return value.slice(1, -1);
    }
    return value;
  }

  /**
   * Expand variable references like ${VAR_NAME}
   */
  expandVariables() {
    Object.keys(process.env).forEach(key => {
      let value = process.env[key];
      if (typeof value === 'string') {
        // Replace ${VAR} or $VAR references
        value = value.replace(/\$\{([^}]+)\}|\$([A-Z_][A-Z0-9_]*)/gi, (match, p1, p2) => {
          const varName = p1 || p2;
          return process.env[varName] || match;
        });
        process.env[key] = value;
      }
    });
  }

  /**
   * Set default values for critical variables
   */
  setDefaults() {
    const defaults = {
      NODE_ENV: this.env,
      PORT: '3000',
      HOST: '0.0.0.0',
      APP_URL: 'http://localhost:5173',
      API_URL: 'http://localhost:3000',
      CORS_ORIGIN: 'http://localhost:5173',
      LOG_LEVEL: 'info',
      ENABLE_AI_AGENTS: 'true',
      ENABLE_EMAIL_NOTIFICATIONS: 'true',
      ENABLE_PAYMENTS: 'true',
      ENABLE_KFN_SCORING: 'true',
      BCRYPT_SALT_ROUNDS: '12',
      JWT_EXPIRES_IN: '15m',
      JWT_REFRESH_EXPIRES_IN: '7d',
      CACHE_TTL_DEFAULT: '3600',
      RATE_LIMIT_WINDOW_MS: '900000',
      RATE_LIMIT_MAX_API: '100'
    };

    Object.entries(defaults).forEach(([key, defaultValue]) => {
      if (!process.env[key]) {
        process.env[key] = defaultValue;
        console.log(`   ⚙️  Set default: ${key}=${defaultValue}`);
      }
    });
  }

  /**
   * Validate critical environment variables
   */
  validate() {
    // Required variables
    const required = {
      DATABASE_URL: {
        test: (val) => val && val.startsWith('postgresql://'),
        message: 'DATABASE_URL must start with postgresql://'
      },
      JWT_SECRET: {
        test: (val) => val && val.length >= 32,
        message: 'JWT_SECRET must be at least 32 characters'
      },
      JWT_REFRESH_SECRET: {
        test: (val) => val && val.length >= 32,
        message: 'JWT_REFRESH_SECRET must be at least 32 characters'
      }
    };

    // Check required variables
    Object.entries(required).forEach(([key, validation]) => {
      const value = process.env[key];
      if (!value || !validation.test(value)) {
        this.errors.push(`❌ ${validation.message}`);
      }
    });

    // Check for duplicate secrets
    if (process.env.JWT_SECRET === process.env.JWT_REFRESH_SECRET) {
      this.errors.push('❌ JWT_SECRET and JWT_REFRESH_SECRET must be different');
    }

    // Warn about weak secrets in production
    if (this.isProduction()) {
      if (process.env.JWT_SECRET && process.env.JWT_SECRET.length < 32) {
        this.warnings.push('⚠️  JWT_SECRET is too short for production (min 32 chars)');
      }
      if (process.env.SESSION_SECRET && process.env.SESSION_SECRET.length < 32) {
        this.warnings.push('⚠️  SESSION_SECRET is too short for production (min 32 chars)');
      }
    }

    // Feature-specific validation
    if (this.get('ENABLE_AI_AGENTS') === 'true' && !this.get('DEEPSEEK_API_KEY')) {
      this.warnings.push('⚠️  AI agents enabled but DEEPSEEK_API_KEY not set');
    }

    if (this.get('ENABLE_PAYMENTS') === 'true' && !this.get('STRIPE_SECRET_KEY')) {
      this.warnings.push('⚠️  Payments enabled but STRIPE_SECRET_KEY not set');
    }

    if (this.get('ENABLE_EMAIL_NOTIFICATIONS') === 'true' && !this.get('SMTP_HOST')) {
      this.warnings.push('⚠️  Email notifications enabled but SMTP not configured');
    }
  }

  /**
   * Log loading results
   */
  logResults() {
    if (this.errors.length > 0) {
      console.error('\n❌ Environment Validation Errors:');
      this.errors.forEach(error => console.error(`   ${error}`));
      console.error('\nPlease fix these errors and restart.');
      process.exit(1);
    }

    console.log(`\n✅ Environment loaded successfully`);
    console.log(`   Loaded ${this.loadedFiles.length} config files`);
    console.log(`   Mode: ${this.isProduction() ? 'PRODUCTION' : this.isDevelopment() ? 'DEVELOPMENT' : this.env.toUpperCase()}`);
    
    if (this.warnings.length > 0) {
      console.log('\n⚠️  Warnings:');
      this.warnings.forEach(warning => console.log(`   ${warning}`));
    }
  }

  /**
   * Get environment variable with optional default
   */
  get(key, defaultValue = null) {
    return process.env[key] || defaultValue;
  }

  /**
   * Get all environment variables (filtered)
   */
  getAll() {
    const all = {};
    Object.keys(process.env)
      .filter(key => !key.startsWith('npm_'))
      .forEach(key => {
        // Hide sensitive values
        if (key.toLowerCase().includes('secret') || 
            key.toLowerCase().includes('key') || 
            key.toLowerCase().includes('password') ||
            key.toLowerCase().includes('token')) {
          all[key] = '********';
        } else {
          all[key] = process.env[key];
        }
      });
    return all;
  }

  /**
   * Check if running in specific environment
   */
  isProduction() {
    return this.env === 'production';
  }

  isDevelopment() {
    return this.env === 'development';
  }

  isStaging() {
    return this.env === 'staging';
  }

  isTesting() {
    return this.env === 'test';
  }

  /**
   * Generate a secure random secret
   */
  generateSecret(length = 32) {
    return crypto.randomBytes(length).toString('hex');
  }

  /**
   * Get list of loaded files
   */
  getLoadedFiles() {
    return this.loadedFiles;
  }

  /**
   * Reload environment (for testing)
   */
  reload() {
    this.loaded = false;
    this.loadedFiles = [];
    this.errors = [];
    this.warnings = [];
    this.load();
  }
}

// Create singleton instance
const envLoader = new EnvLoader();

// Auto-load on require if not in test mode
if (process.env.NODE_ENV !== 'test') {
  envLoader.load();
}

module.exports = envLoader;
