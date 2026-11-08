ALTER TABLE "Business"
ADD COLUMN "nextInvoiceNumber" INTEGER NOT NULL DEFAULT 1000;

ALTER TABLE "Invoice"
ADD COLUMN "discountPercent" DECIMAL(5,2),
ADD COLUMN "reference" TEXT,
ADD COLUMN "referenceNumber" TEXT;
