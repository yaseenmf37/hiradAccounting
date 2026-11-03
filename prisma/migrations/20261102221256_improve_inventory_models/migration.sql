/*
  Warnings:

  - A unique constraint covering the columns `[businessId,barcode]` on the table `Product` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterEnum
ALTER TYPE "MovementType" ADD VALUE 'INITIAL_STOCK';

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "barcode" TEXT,
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "minStock" DECIMAL(18,3) NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "Product_businessId_isActive_name_idx" ON "Product"("businessId", "isActive", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Product_businessId_barcode_key" ON "Product"("businessId", "barcode");
