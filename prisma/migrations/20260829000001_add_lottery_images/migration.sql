-- CreateTable
CREATE TABLE "lottery_images" (
    "id"        TEXT NOT NULL,
    "lotteryId" TEXT NOT NULL,
    "fileId"    TEXT NOT NULL,
    "url"       TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lottery_images_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "lottery_images" ADD CONSTRAINT "lottery_images_lotteryId_fkey"
    FOREIGN KEY ("lotteryId") REFERENCES "lotteries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lottery_images" ADD CONSTRAINT "lottery_images_fileId_fkey"
    FOREIGN KEY ("fileId") REFERENCES "files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
