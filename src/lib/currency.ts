
import type { CurrencyUnit } from "@prisma/client";

const RIAL_PER_TOMAN = 10;
export const MAX_CURRENCY_RIAL = 9_223_372_036_854_775_807n;

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

export function currencyInputToRial(
  amount: string,
  unit: CurrencyUnit
): bigint {
  if (unit === "RIAL") {
    if (!/^\d{1,18}$/.test(amount)) {
      throw new Error("INVALID_CURRENCY_AMOUNT");
    }

    return BigInt(amount);
  }

  if (!/^\d{1,18}(\.\d)?$/.test(amount)) {
    throw new Error("INVALID_CURRENCY_AMOUNT");
  }

  const [whole, fraction = "0"] = amount.split(".");
  const converted = BigInt(whole) * BigInt(RIAL_PER_TOMAN) + BigInt(fraction);
  if (converted > MAX_CURRENCY_RIAL) {
    throw new Error("INVALID_CURRENCY_AMOUNT");
  }

  return converted;
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
