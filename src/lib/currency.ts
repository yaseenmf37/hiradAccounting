
import type { CurrencyUnit } from "@/generated/prisma/client";

const RIAL_PER_TOMAN = 10;

/**
 * تبدیل مبلغ ورودی به واحد پایه دیتابیس (ریال)
 */
export function toRial(
  amount: bigint,
  unit: CurrencyUnit
): bigint {
  return unit === "TOMAN"
    ? amount * BigInt(RIAL_PER_TOMAN)
    : amount;
}

/**
 * تبدیل مبلغ ریالی به واحد نمایشی کسب‌وکار
 */
export function fromRial(
  amount: bigint,
  unit: CurrencyUnit
): bigint {
  return unit === "TOMAN"
    ? amount / BigInt(RIAL_PER_TOMAN)
    : amount;
}

/**
 * فرمت مبلغ برای نمایش در رابط کاربری
 */
export function formatCurrency(
  amountInRial: bigint,
  unit: CurrencyUnit
): string {
  const displayAmount = fromRial(amountInRial, unit);

  return new Intl.NumberFormat("fa-IR").format(displayAmount);
}

/**
 * عنوان واحد پول
 */
export function getCurrencyLabel(unit: CurrencyUnit): string {
  return unit === "TOMAN" ? "تومان" : "ریال";
}

/**
 * نمایش مبلغ همراه با واحد پول
 */
export function formatMoney(
  amountInRial: bigint,
  unit: CurrencyUnit
): string {
  return `${formatCurrency(amountInRial, unit)} ${getCurrencyLabel(unit)}`;
}
