-- Performance optimization indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS "jobs_status_idx" ON "jobs"("status");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "jobs_published_at_idx" ON "jobs"("published_at");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "jobs_expires_at_idx" ON "jobs"("expires_at");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "jobs_location_idx" ON "jobs"("city", "country");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "applications_status_idx" ON "applications"("status");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "applications_created_at_idx" ON "applications"("created_at");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "applications_job_user_idx" ON "applications"("job_id", "user_id");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "payments_status_idx" ON "payments"("status");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "payments_created_at_idx" ON "payments"("created_at");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "payments_stripe_id_idx" ON "payments"("stripe_id");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "kfn_scores_score_idx" ON "kfn_scores"("overall_score");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "kfn_scores_job_worker_idx" ON "kfn_scores"("job_id", "worker_id");

-- Composite indexes for common queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS "jobs_employer_status_idx" ON "jobs"("employer_id", "status");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "workers_trust_score_idx" ON "workers"("trust_score");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "users_role_status_idx" ON "users"("role", "status");

-- Trigram indexes for fuzzy search
CREATE INDEX CONCURRENTLY IF NOT EXISTS "profiles_name_trgm_idx" ON "profiles" USING GIN (("firstName" || ' ' || "lastName") gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS "jobs_title_trgm_idx" ON "jobs" USING GIN ("title" gin_trgm_ops);

-- Partial indexes for better performance
CREATE INDEX CONCURRENTLY IF NOT EXISTS "active_users_idx" ON "users"("id") WHERE "status" = 'ACTIVE';
CREATE INDEX CONCURRENTLY IF NOT EXISTS "active_jobs_idx" ON "jobs"("id") WHERE "status" = 'PUBLISHED' AND "expires_at" > NOW();
CREATE INDEX CONCURRENTLY IF NOT EXISTS "unread_notifications_idx" ON "notifications"("user_id") WHERE "read_at" IS NULL;
