-- AlterTable
ALTER TABLE "clients" ADD COLUMN "isVerified" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "clients" ADD COLUMN "verifiedAt" TIMESTAMP(3);
