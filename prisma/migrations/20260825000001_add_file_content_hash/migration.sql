-- AlterTable: add contentHash column to files table
ALTER TABLE "files" ADD COLUMN "contentHash" TEXT;

-- Index for fast duplicate lookup on payment slip uploads
CREATE INDEX "files_contentHash_idx" ON "files"("contentHash");
