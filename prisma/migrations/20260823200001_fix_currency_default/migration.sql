-- Fix currency column default from 'USD' to 'ETB' to match schema.prisma
ALTER TABLE "subscription_transactions" ALTER COLUMN "currency" SET DEFAULT 'ETB';
ALTER TABLE "payment_transactions" ALTER COLUMN "currency" SET DEFAULT 'ETB';
