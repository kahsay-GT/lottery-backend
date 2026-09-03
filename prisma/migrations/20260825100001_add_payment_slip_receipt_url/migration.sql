-- AlterTable: store the QR-decoded receipt URL directly on the slip row
-- so it is available immediately after upload, before async OCR completes.
ALTER TABLE "payment_slips" ADD COLUMN "receiptUrl" TEXT;
