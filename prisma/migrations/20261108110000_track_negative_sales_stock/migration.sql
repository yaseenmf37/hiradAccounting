ALTER TABLE "Backorder"
ADD COLUMN "inventoryDeducted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "cancelledAt" TIMESTAMP(3);

ALTER TABLE "BackorderAllocation"
ADD COLUMN "totalCost" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN "inventoryMovementId" TEXT;

CREATE INDEX "BackorderAllocation_inventoryMovementId_idx"
ON "BackorderAllocation"("inventoryMovementId");

ALTER TABLE "BackorderAllocation"
ADD CONSTRAINT "BackorderAllocation_inventoryMovementId_fkey"
FOREIGN KEY ("inventoryMovementId") REFERENCES "InventoryMovement"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
