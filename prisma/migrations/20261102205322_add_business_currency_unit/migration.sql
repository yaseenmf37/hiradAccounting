-- CreateEnum
CREATE TYPE "CurrencyUnit" AS ENUM ('RIAL', 'TOMAN');

-- AlterTable
ALTER TABLE "Business" ADD COLUMN     "currencyUnit" "CurrencyUnit" NOT NULL DEFAULT 'TOMAN';
