ALTER TABLE "InvoiceItem"
ADD COLUMN "costedQuantity" DECIMAL(18,3) NOT NULL DEFAULT 0;

UPDATE "InvoiceItem" AS item
SET "costedQuantity" = CASE
    WHEN invoice."type" <> 'SALE' OR invoice."status" <> 'ISSUED' THEN 0
    WHEN EXISTS (
        SELECT 1 FROM "Backorder" AS backorder
        WHERE backorder."invoiceItemId" = item."id"
    ) THEN COALESCE((
        SELECT backorder."fulfilled" FROM "Backorder" AS backorder
        WHERE backorder."invoiceItemId" = item."id"
    ), 0)
    WHEN invoice."costingRecordedAt" IS NOT NULL THEN item."quantity"
    ELSE 0
END
FROM "Invoice" AS invoice
WHERE invoice."id" = item."invoiceId";

UPDATE "InvoiceItem" AS item
SET "costedQuantity" = 0
FROM "Invoice" AS invoice
WHERE invoice."id" = item."invoiceId"
  AND invoice."type" = 'SALE'
  AND invoice."status" = 'ISSUED'
  AND EXISTS (
      SELECT 1
      FROM "Backorder" AS backorder
      WHERE backorder."invoiceId" = invoice."id"
        AND backorder."productId" = item."productId"
        AND backorder."invoiceItemId" IS NULL
        AND backorder."outstanding" > 0
  );

UPDATE "Invoice"
SET "costingRecordedAt" = NULL
WHERE "type" = 'SALE'
  AND "status" = 'ISSUED'
  AND EXISTS (
      SELECT 1
      FROM "Backorder" AS backorder
      WHERE backorder."invoiceId" = "Invoice"."id"
        AND backorder."outstanding" > 0
  );

ALTER TABLE "Payment"
ADD COLUMN "allocationBatchId" TEXT;

CREATE INDEX "Payment_invoiceId_allocationBatchId_status_idx"
ON "Payment"("invoiceId", "allocationBatchId", "status");

ALTER TABLE "PurchaseReturn"
ADD COLUMN "idempotencyKey" TEXT,
ADD COLUMN "idempotencyRequestHash" TEXT;

CREATE UNIQUE INDEX "PurchaseReturn_businessId_idempotencyKey_key"
ON "PurchaseReturn"("businessId", "idempotencyKey");
