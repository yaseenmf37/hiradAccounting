/*
  Warnings:

  - Added the required column `method` to the `Payment` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `Payment` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'POS', 'CARD_TO_CARD', 'BANK_TRANSFER', 'CHECK');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('CONFIRMED', 'CANCELLED');

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "cancelReason" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "method" "PaymentMethod" NOT NULL,
ADD COLUMN     "status" "PaymentStatus" NOT NULL DEFAULT 'CONFIRMED',
ADD COLUMN     "trackingNumber" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- CreateIndex
CREATE INDEX "Payment_businessId_contactId_paidAt_idx" ON "Payment"("businessId", "contactId", "paidAt");

-- CreateIndex
CREATE INDEX "Payment_businessId_invoiceId_idx" ON "Payment"("businessId", "invoiceId");

-- CreateIndex
CREATE INDEX "Payment_businessId_status_paidAt_idx" ON "Payment"("businessId", "status", "paidAt");
