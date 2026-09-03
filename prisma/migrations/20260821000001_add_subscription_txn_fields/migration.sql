-- Add metadata, approvedAt, rejectionReason, reviewedAt to subscription_transactions

ALTER TABLE "subscription_transactions"
  ADD COLUMN IF NOT EXISTS "metadata"        JSONB,
  ADD COLUMN IF NOT EXISTS "approvedAt"      TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "rejectionReason" TEXT,
  ADD COLUMN IF NOT EXISTS "reviewedAt"      TIMESTAMP(3);
