CREATE TABLE "SalesReturn" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "returnNumber" TEXT NOT NULL,
    "total" BIGINT NOT NULL,
    "description" TEXT,
    "idempotencyKey" TEXT,
    "idempotencyRequestHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalesReturn_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SalesReturnItem" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "salesReturnId" TEXT NOT NULL,
    "invoiceItemId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "amount" BIGINT NOT NULL,
    "inventoryCost" BIGINT NOT NULL,

    CONSTRAINT "SalesReturnItem_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Payment"
ADD COLUMN "salesReturnId" TEXT;

ALTER TABLE "InventoryMovement"
ADD COLUMN "salesReturnId" TEXT;

CREATE UNIQUE INDEX "SalesReturn_businessId_returnNumber_key"
ON "SalesReturn"("businessId", "returnNumber");

CREATE UNIQUE INDEX "SalesReturn_businessId_idempotencyKey_key"
ON "SalesReturn"("businessId", "idempotencyKey");

CREATE UNIQUE INDEX "SalesReturn_id_businessId_invoiceId_key"
ON "SalesReturn"("id", "businessId", "invoiceId");

CREATE UNIQUE INDEX "SalesReturn_id_businessId_key"
ON "SalesReturn"("id", "businessId");

CREATE UNIQUE INDEX "Product_id_businessId_key"
ON "Product"("id", "businessId");

CREATE UNIQUE INDEX "Invoice_id_businessId_key"
ON "Invoice"("id", "businessId");

CREATE UNIQUE INDEX "InvoiceItem_id_invoiceId_productId_key"
ON "InvoiceItem"("id", "invoiceId", "productId");

CREATE INDEX "SalesReturn_businessId_invoiceId_createdAt_idx"
ON "SalesReturn"("businessId", "invoiceId", "createdAt");

CREATE INDEX "SalesReturnItem_salesReturnId_idx"
ON "SalesReturnItem"("salesReturnId");

CREATE INDEX "SalesReturnItem_invoiceItemId_idx"
ON "SalesReturnItem"("invoiceItemId");

CREATE INDEX "Payment_businessId_salesReturnId_idx"
ON "Payment"("businessId", "salesReturnId");

CREATE INDEX "InventoryMovement_salesReturnId_idx"
ON "InventoryMovement"("salesReturnId");

ALTER TABLE "SalesReturn"
ADD CONSTRAINT "SalesReturn_businessId_fkey"
FOREIGN KEY ("businessId") REFERENCES "Business"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SalesReturn"
ADD CONSTRAINT "SalesReturn_invoiceId_fkey"
FOREIGN KEY ("invoiceId", "businessId") REFERENCES "Invoice"("id", "businessId")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SalesReturnItem"
ADD CONSTRAINT "SalesReturnItem_salesReturnId_fkey"
FOREIGN KEY ("salesReturnId", "businessId", "invoiceId") REFERENCES "SalesReturn"("id", "businessId", "invoiceId")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SalesReturnItem"
ADD CONSTRAINT "SalesReturnItem_invoiceItemId_fkey"
FOREIGN KEY ("invoiceItemId", "invoiceId", "productId") REFERENCES "InvoiceItem"("id", "invoiceId", "productId")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SalesReturnItem"
ADD CONSTRAINT "SalesReturnItem_productId_fkey"
FOREIGN KEY ("productId", "businessId") REFERENCES "Product"("id", "businessId")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Payment"
ADD CONSTRAINT "Payment_salesReturnId_fkey"
FOREIGN KEY ("salesReturnId", "businessId") REFERENCES "SalesReturn"("id", "businessId")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "InventoryMovement"
ADD CONSTRAINT "InventoryMovement_salesReturnId_fkey"
FOREIGN KEY ("salesReturnId", "businessId") REFERENCES "SalesReturn"("id", "businessId")
ON DELETE RESTRICT ON UPDATE CASCADE;
