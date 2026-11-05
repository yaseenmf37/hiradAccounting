ALTER TABLE "Invoice"
ADD COLUMN "invoiceDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "Invoice"
SET "invoiceDate" = COALESCE("issuedAt", "createdAt");
