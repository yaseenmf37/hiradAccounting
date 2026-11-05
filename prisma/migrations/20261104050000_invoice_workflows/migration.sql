ALTER TYPE "PaymentMethod" ADD VALUE 'LEDGER';
ALTER TYPE "PaymentStatus" ADD VALUE 'PENDING';

ALTER TABLE "Invoice"
ADD COLUMN "contactNameSnapshot" TEXT,
ADD COLUMN "contactPhoneSnapshot" TEXT,
ADD COLUMN "contactAddressSnapshot" TEXT,
ADD COLUMN "paymentPlanRecorded" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Payment"
ADD COLUMN "checkNumber" TEXT,
ADD COLUMN "checkIssuedAt" TIMESTAMP(3),
ADD COLUMN "checkDueAt" TIMESTAMP(3),
ADD COLUMN "payableTo" TEXT,
ADD COLUMN "destinationDetails" TEXT;

CREATE TYPE "ProductPriceField" AS ENUM ('PURCHASE', 'SALE');

CREATE TABLE "ProductPriceHistory" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "field" "ProductPriceField" NOT NULL,
    "oldPrice" BIGINT NOT NULL,
    "newPrice" BIGINT NOT NULL,
    "increaseBasisPoints" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProductPriceHistory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InvoiceRevision" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "editorId" TEXT NOT NULL,
    "before" JSONB NOT NULL,
    "after" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InvoiceRevision_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Backorder" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "invoiceItemId" TEXT,
    "productId" TEXT NOT NULL,
    "requested" DECIMAL(18,3) NOT NULL,
    "fulfilled" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "outstanding" DECIMAL(18,3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Backorder_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BackorderAllocation" (
    "id" TEXT NOT NULL,
    "backorderId" TEXT NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BackorderAllocation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Backorder_invoiceItemId_key" ON "Backorder"("invoiceItemId");
CREATE INDEX "ProductPriceHistory_businessId_createdAt_idx" ON "ProductPriceHistory"("businessId", "createdAt");
CREATE INDEX "ProductPriceHistory_productId_createdAt_idx" ON "ProductPriceHistory"("productId", "createdAt");
CREATE INDEX "InvoiceRevision_invoiceId_createdAt_idx" ON "InvoiceRevision"("invoiceId", "createdAt");
CREATE INDEX "Backorder_businessId_productId_outstanding_idx" ON "Backorder"("businessId", "productId", "outstanding");
CREATE INDEX "Backorder_invoiceId_idx" ON "Backorder"("invoiceId");
CREATE INDEX "BackorderAllocation_backorderId_createdAt_idx" ON "BackorderAllocation"("backorderId", "createdAt");

ALTER TABLE "ProductPriceHistory" ADD CONSTRAINT "ProductPriceHistory_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductPriceHistory" ADD CONSTRAINT "ProductPriceHistory_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InvoiceRevision" ADD CONSTRAINT "InvoiceRevision_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Backorder" ADD CONSTRAINT "Backorder_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Backorder" ADD CONSTRAINT "Backorder_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Backorder" ADD CONSTRAINT "Backorder_invoiceItemId_fkey" FOREIGN KEY ("invoiceItemId") REFERENCES "InvoiceItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Backorder" ADD CONSTRAINT "Backorder_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BackorderAllocation" ADD CONSTRAINT "BackorderAllocation_backorderId_fkey" FOREIGN KEY ("backorderId") REFERENCES "Backorder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
