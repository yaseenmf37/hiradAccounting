/*
  Warnings:

  - Added the required column `updatedAt` to the `Expense` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "ExpenseCategory" AS ENUM ('RENT', 'SALARY', 'TRANSPORT', 'UTILITIES', 'ADVERTISING', 'MAINTENANCE', 'TAX', 'OTHER');

-- CreateEnum
CREATE TYPE "ExpenseStatus" AS ENUM ('CONFIRMED', 'CANCELLED');

-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "cancelReason" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "category" "ExpenseCategory" NOT NULL DEFAULT 'OTHER',
ADD COLUMN     "method" "PaymentMethod" NOT NULL DEFAULT 'CASH',
ADD COLUMN     "status" "ExpenseStatus" NOT NULL DEFAULT 'CONFIRMED',
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- CreateIndex
CREATE INDEX "Expense_businessId_category_spentAt_idx" ON "Expense"("businessId", "category", "spentAt");

-- CreateIndex
CREATE INDEX "Expense_businessId_status_spentAt_idx" ON "Expense"("businessId", "status", "spentAt");
