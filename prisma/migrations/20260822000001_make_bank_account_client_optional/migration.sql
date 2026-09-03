-- AlterTable: make clientId nullable on bank_accounts to support platform-level accounts
ALTER TABLE "bank_accounts" ALTER COLUMN "clientId" DROP NOT NULL;
