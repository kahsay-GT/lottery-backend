-- Add ticket range fields to lotteries
ALTER TABLE "lotteries" ADD COLUMN "ticketStart" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "lotteries" ADD COLUMN "ticketEnd" INTEGER;
