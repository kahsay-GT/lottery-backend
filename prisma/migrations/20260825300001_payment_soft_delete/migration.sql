-- Add soft-delete columns to payment_transactions
ALTER TABLE "payment_transactions" ADD COLUMN "deletedAt"    TIMESTAMP(3);
ALTER TABLE "payment_transactions" ADD COLUMN "deleteReason" TEXT;

-- Index so list queries that filter out deleted rows stay fast
CREATE INDEX "payment_transactions_deletedAt_idx" ON "payment_transactions"("deletedAt");
