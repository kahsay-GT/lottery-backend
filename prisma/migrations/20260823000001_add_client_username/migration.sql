-- AlterTable: add nullable unique username to clients
ALTER TABLE "clients" ADD COLUMN "username" TEXT;
CREATE UNIQUE INDEX "clients_username_key" ON "clients"("username");
