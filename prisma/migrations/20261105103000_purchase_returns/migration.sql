CREATE TABLE "PurchaseReturn" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "returnNumber" TEXT NOT NULL,
    "total" BIGINT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseReturn_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PurchaseReturnItem" (
    "id" TEXT NOT NULL,
    "purchaseReturnId" TEXT NOT NULL,
    "invoiceItemId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "amount" BIGINT NOT NULL,
    "inventoryCost" BIGINT NOT NULL,

    CONSTRAINT "PurchaseReturnItem_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "InventoryMovement"
ADD COLUMN "purchaseReturnId" TEXT;

ALTER TABLE "Payment"
ADD COLUMN "purchaseReturnId" TEXT;

CREATE UNIQUE INDEX "PurchaseReturn_businessId_returnNumber_key"
ON "PurchaseReturn"("businessId", "returnNumber");

CREATE INDEX "PurchaseReturn_businessId_invoiceId_createdAt_idx"
ON "PurchaseReturn"("businessId", "invoiceId", "createdAt");

CREATE INDEX "PurchaseReturnItem_purchaseReturnId_idx"
ON "PurchaseReturnItem"("purchaseReturnId");

CREATE INDEX "PurchaseReturnItem_invoiceItemId_idx"
ON "PurchaseReturnItem"("invoiceItemId");

CREATE INDEX "Payment_businessId_purchaseReturnId_idx"
ON "Payment"("businessId", "purchaseReturnId");

ALTER TABLE "PurchaseReturn"
ADD CONSTRAINT "PurchaseReturn_businessId_fkey"
FOREIGN KEY ("businessId") REFERENCES "Business"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PurchaseReturn"
ADD CONSTRAINT "PurchaseReturn_invoiceId_fkey"
FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PurchaseReturnItem"
ADD CONSTRAINT "PurchaseReturnItem_purchaseReturnId_fkey"
FOREIGN KEY ("purchaseReturnId") REFERENCES "PurchaseReturn"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PurchaseReturnItem"
ADD CONSTRAINT "PurchaseReturnItem_invoiceItemId_fkey"
FOREIGN KEY ("invoiceItemId") REFERENCES "InvoiceItem"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PurchaseReturnItem"
ADD CONSTRAINT "PurchaseReturnItem_productId_fkey"
FOREIGN KEY ("productId") REFERENCES "Product"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "InventoryMovement"
ADD CONSTRAINT "InventoryMovement_purchaseReturnId_fkey"
FOREIGN KEY ("purchaseReturnId") REFERENCES "PurchaseReturn"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Payment"
ADD CONSTRAINT "Payment_purchaseReturnId_fkey"
FOREIGN KEY ("purchaseReturnId") REFERENCES "PurchaseReturn"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
