-- Make buyer email optional (NULL allowed).
-- The @@unique([clientId, email]) index is kept — Postgres treats NULL != NULL
-- so multiple rows with email=NULL on the same clientId are all allowed.

ALTER TABLE "buyers" ALTER COLUMN "email" DROP NOT NULL;

-- Make ticket_reservations.buyerEmail optional too
ALTER TABLE "ticket_reservations" ALTER COLUMN "buyerEmail" DROP NOT NULL;

-- Backfill: clear the fake guest placeholder emails that were auto-generated
UPDATE "buyers"
SET "email" = NULL
WHERE "email" LIKE '%@guest.lotterysaas.local';

UPDATE "ticket_reservations"
SET "buyerEmail" = NULL
WHERE "buyerEmail" LIKE '%@guest.lotterysaas.local';
