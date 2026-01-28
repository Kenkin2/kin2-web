/**
 * Database migration utilities
 */

const { PrismaClient } = require('@prisma/client');
const { systemLogger, errorLogger } = require('../../utils/logger');
const fs = require('fs');
const path = require('path');

class MigrationService {
  constructor(databaseService) {
    this.database = databaseService;
    this.prisma = databaseService.prisma;
    this.migrationsDir = path.join(process.cwd(), 'prisma/migrations');
  }

  /**
   * Run pending migrations
   */
  async runMigrations() {
    try {
      systemLogger.info('🚀 Running database migrations...');
      
      // Check if migrations table exists
      const migrationsTableExists = await this.checkMigrationsTable();
      
      if (!migrationsTableExists) {
        await this.createMigrationsTable();
      }
      
      // Get applied migrations
      const appliedMigrations = await this.getAppliedMigrations();
      
      // Get available migration files
      const migrationFiles = this.getMigrationFiles();
      
      // Find pending migrations
      const pendingMigrations = migrationFiles.filter(
        file => !appliedMigrations.includes(file.name)
      );
      
      if (pendingMigrations.length === 0) {
        systemLogger.info('✅ No pending migrations');
        return { applied: 0, pending: 0 };
      }
      
      // Apply pending migrations
      const results = [];
      for (const migration of pendingMigrations) {
        try {
          await this.applyMigration(migration);
          results.push({
            name: migration.name,
            status: 'applied',
            timestamp: new Date()
          });
        } catch (error) {
          results.push({
            name: migration.name,
            status: 'failed',
            error: error.message,
            timestamp: new Date()
          });
          throw error;
        }
      }
      
      systemLogger.info(`✅ Applied ${results.length} migration(s)`);
      return {
        applied: results.length,
        pending: 0,
        results
      };
      
    } catch (error) {
      errorLogger.error('Migration failed:', error);
      throw error;
    }
  }

  /**
   * Rollback last migration
   */
  async rollbackMigration() {
    try {
      systemLogger.info('↩️ Rolling back last migration...');
      
      // Get last applied migration
      const lastMigration = await this.prisma.$queryRaw`
        SELECT * FROM "_prisma_migrations" 
        WHERE applied_at IS NOT NULL 
        ORDER BY applied_at DESC 
        LIMIT 1
      `;
      
      if (!lastMigration || lastMigration.length === 0) {
        systemLogger.info('ℹ️ No migrations to rollback');
        return null;
      }
      
      const migrationName = lastMigration[0].migration_name;
      const migrationFile = path.join(this.migrationsDir, migrationName, 'migration.sql');
      
      if (!fs.existsSync(migrationFile)) {
        throw new Error(`Migration file not found: ${migrationFile}`);
      }
      
      // Read and execute rollback SQL
      const sql = fs.readFileSync(migrationFile, 'utf8');
      const rollbackStatements = this.extractRollbackStatements(sql);
      
      if (rollbackStatements.length === 0) {
        systemLogger.warn(`No rollback statements found for ${migrationName}`);
        return null;
      }
      
      // Execute rollback in transaction
      await this.database.transaction(async (prisma) => {
        for (const statement of rollbackStatements) {
          await prisma.$executeRawUnsafe(statement);
        }
        
        // Mark migration as rolled back
        await prisma.$executeRaw`
          DELETE FROM "_prisma_migrations" 
          WHERE migration_name = ${migrationName}
        `;
      });
      
      systemLogger.info(`✅ Rolled back migration: ${migrationName}`);
      
      return {
        name: migrationName,
        rolledBack: true,
        timestamp: new Date()
      };
      
    } catch (error) {
      errorLogger.error('Rollback failed:', error);
      throw error;
    }
  }

  /**
   * Create seed data
   */
  async seedDatabase() {
    try {
      systemLogger.info('🌱 Seeding database...');
      
      // Check if already seeded
      const seeded = await this.prisma.systemConfig.findUnique({
        where: { key: 'database.seeded' }
      });
      
      if (seeded && seeded.value === 'true') {
        systemLogger.info('✅ Database already seeded');
        return { seeded: false, reason: 'already seeded' };
      }
      
      // Execute seed operations
      await this.database.transaction(async (prisma) => {
        // Create admin user
        const bcrypt = require('bcryptjs');
        const adminPassword = await bcrypt.hash('Admin123!', 12);
        
        const adminUser = await prisma.user.create({
          data: {
            email: 'admin@kin2.co.uk',
            passwordHash: adminPassword,
            role: 'ADMIN',
            status: 'VERIFIED',
            isEmailVerified: true,
            profile: {
              create: {
                firstName: 'System',
                lastName: 'Administrator',
                preferredLanguage: 'en',
                currency: 'USD',
                profileCompletion: 100
              }
            },
            admin: {
              create: {
                adminLevel: 5,
                permissions: ['users', 'jobs', 'payments', 'reports', 'settings'],
                isSuperAdmin: true
              }
            }
          }
        });
        
        // Create system configurations
        const configs = [
          { key: 'app.name', value: '"Kin2 Workforce Platform"', type: 'string', category: 'general' },
          { key: 'app.version', value: '"2.5.0"', type: 'string', category: 'general' },
          { key: 'database.seeded', value: 'true', type: 'boolean', category: 'system' },
          { key: 'job.autoExpireDays', value: '30', type: 'number', category: 'jobs' },
          { key: 'email.enabled', value: 'true', type: 'boolean', category: 'email' }
        ];
        
        await prisma.systemConfig.createMany({
          data: configs
        });
        
        // Create AI agents
        const agents = [
          {
            agentId: 'RESUME_SCREENER_01',
            name: 'Resume Screening Agent',
            type: 'RESUME_SCREENER',
            version: '2.0.0',
            provider: 'DEEPSEEK',
            model: 'deepseek-chat',
            temperature: 0.3,
            maxTokens: 2000,
            status: 'IDLE',
            isActive: true
          },
          {
            agentId: 'JOB_MATCHER_01',
            name: 'Job Matching Agent',
            type: 'JOB_MATCHER',
            version: '2.0.0',
            provider: 'DEEPSEEK',
            model: 'deepseek-chat',
            temperature: 0.5,
            maxTokens: 3000,
            status: 'IDLE',
            isActive: true
          }
        ];
        
        await prisma.aIAgent.createMany({
          data: agents
        });
      });
      
      systemLogger.info('✅ Database seeded successfully');
      return { seeded: true };
      
    } catch (error) {
      errorLogger.error('Seeding failed:', error);
      throw error;
    }
  }

  /**
   * Check if migrations table exists
   */
  async checkMigrationsTable() {
    try {
      await this.prisma.$queryRaw`
        SELECT 1 FROM "_prisma_migrations" LIMIT 1
      `;
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Create migrations table
   */
  async createMigrationsTable() {
    await this.prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
        id VARCHAR(36) PRIMARY KEY,
        checksum VARCHAR(64) NOT NULL,
        finished_at TIMESTAMP WITH TIME ZONE,
        migration_name VARCHAR(255) NOT NULL,
        logs TEXT,
        rolled_back_at TIMESTAMP WITH TIME ZONE,
        started_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
        applied_steps_count INTEGER DEFAULT 0 NOT NULL
      )
    `;
  }

  /**
   * Get applied migrations
   */
  async getAppliedMigrations() {
    const migrations = await this.prisma.$queryRaw`
      SELECT migration_name FROM "_prisma_migrations" 
      WHERE finished_at IS NOT NULL
    `;
    
    return migrations.map(m => m.migration_name);
  }

  /**
   * Get migration files
   */
  getMigrationFiles() {
    if (!fs.existsSync(this.migrationsDir)) {
      return [];
    }
    
    const dirs = fs.readdirSync(this.migrationsDir, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => ({
        name: dirent.name,
        path: path.join(this.migrationsDir, dirent.name),
        migrationFile: path.join(this.migrationsDir, dirent.name, 'migration.sql')
      }))
      .filter(migration => fs.existsSync(migration.migrationFile))
      .sort((a, b) => a.name.localeCompare(b.name));
    
    return dirs;
  }

  /**
   * Apply a single migration
   */
  async applyMigration(migration) {
    const sql = fs.readFileSync(migration.migrationFile, 'utf8');
    
    await this.prisma.$transaction(async (prisma) => {
      // Split SQL by statements
      const statements = sql
        .split(';')
        .map(s => s.trim())
        .filter(s => s.length > 0);
      
      // Execute each statement
      for (const statement of statements) {
        await prisma.$executeRawUnsafe(statement);
      }
      
      // Record migration
      await prisma.$executeRaw`
        INSERT INTO "_prisma_migrations" (
          id, checksum, migration_name, started_at, applied_steps_count
        ) VALUES (
          gen_random_uuid(), 
          md5(${sql}),
          ${migration.name},
          CURRENT_TIMESTAMP,
          ${statements.length}
        )
      `;
    });
  }

  /**
   * Extract rollback statements from migration SQL
   */
  extractRollbackStatements(sql) {
    const lines = sql.split('\n');
    const rollbackStatements = [];
    let inRollbackSection = false;
    
    for (const line of lines) {
      if (line.trim().toUpperCase().startsWith('-- ROLLBACK')) {
        inRollbackSection = true;
        continue;
      }
      
      if (inRollbackSection) {
        if (line.trim().toUpperCase().startsWith('-- END ROLLBACK')) {
          break;
        }
        
        if (line.trim().length > 0 && !line.trim().startsWith('--')) {
          rollbackStatements.push(line.trim());
        }
      }
    }
    
    return rollbackStatements;
  }

  /**
   * Get migration status
   */
  async getMigrationStatus() {
    const applied = await this.getAppliedMigrations();
    const available = this.getMigrationFiles();
    
    const status = available.map(migration => ({
      name: migration.name,
      applied: applied.includes(migration.name),
      path: migration.path
    }));
    
    return {
      applied: applied.length,
      available: available.length,
      pending: available.length - applied.length,
      status
    };
  }

  /**
   * Create a new migration
   */
  async createMigration(name, upSQL, downSQL = '') {
    const timestamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
    const migrationName = `${timestamp}_${name}`;
    const migrationDir = path.join(this.migrationsDir, migrationName);
    
    // Create migration directory
    fs.mkdirSync(migrationDir, { recursive: true });
    
    // Create migration.sql file
    const migrationSQL = `-- Migration generated at ${new Date().toISOString()}\n\n${upSQL}`;
    
    if (downSQL) {
      migrationSQL += `\n\n-- ROLLBACK\n${downSQL}\n-- END ROLLBACK`;
    }
    
    fs.writeFileSync(
      path.join(migrationDir, 'migration.sql'),
      migrationSQL
    );
    
    // Create README.md
    const readme = `# ${name}\n\nGenerated: ${new Date().toISOString()}\n\n${upSQL}`;
    fs.writeFileSync(
      path.join(migrationDir, 'README.md'),
      readme
    );
    
    return {
      name: migrationName,
      path: migrationDir,
      timestamp: new Date().toISOString()
    };
  }
}

module.exports = MigrationService;
