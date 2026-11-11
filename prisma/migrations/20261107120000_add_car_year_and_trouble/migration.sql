-- AlterTable
ALTER TABLE "Order" ADD COLUMN "carYear" TEXT;
ALTER TABLE "Order" ADD COLUMN "trouble" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: a season runs June to May and is named after the car it builds,
-- so June 2026 – May 2027 is AME27. Orders since 2026-06-01 stay AME27.
UPDATE "Order"
SET "carYear" = 'AME' || (
    (EXTRACT(YEAR FROM "createdAt")::int % 100)
    + CASE WHEN EXTRACT(MONTH FROM "createdAt") >= 6 THEN 1 ELSE 0 END
);

ALTER TABLE "Order" ALTER COLUMN "carYear" SET NOT NULL;

-- CreateIndex
CREATE INDEX "Order_carYear_idx" ON "Order"("carYear");
