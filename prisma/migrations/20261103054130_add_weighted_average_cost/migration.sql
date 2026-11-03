-- AlterTable
ALTER TABLE "InventoryMovement" ADD COLUMN     "averageCost" DECIMAL(30,9) NOT NULL DEFAULT 0,
ADD COLUMN     "totalCost" BIGINT NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "InvoiceItem" ADD COLUMN     "costOfGoodsSold" BIGINT NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "averageCost" DECIMAL(30,9) NOT NULL DEFAULT 0,
ADD COLUMN     "inventoryValue" BIGINT NOT NULL DEFAULT 0;
