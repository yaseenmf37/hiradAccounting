ALTER TABLE "Invoice"
ADD COLUMN "idempotencyKey" TEXT,
ADD COLUMN "idempotencyRequestHash" TEXT;

CREATE UNIQUE INDEX "Invoice_businessId_idempotencyKey_key"
ON "Invoice"("businessId", "idempotencyKey");
