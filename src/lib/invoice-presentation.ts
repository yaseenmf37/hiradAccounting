const persianNumberFormat = new Intl.NumberFormat("fa-IR");

const units = [
  "صفر",
  "یک",
  "دو",
  "سه",
  "چهار",
  "پنج",
  "شش",
  "هفت",
  "هشت",
  "نه",
  "ده",
  "یازده",
  "دوازده",
  "سیزده",
  "چهارده",
  "پانزده",
  "شانزده",
  "هفده",
  "هجده",
  "نوزده",
];

const tens = ["", "", "بیست", "سی", "چهل", "پنجاه", "شصت", "هفتاد", "هشتاد", "نود"];
const hundreds = [
  "",
  "یکصد",
  "دویست",
  "سیصد",
  "چهارصد",
  "پانصد",
  "ششصد",
  "هفتصد",
  "هشتصد",
  "نهصد",
];
const scales = [
  "",
  "هزار",
  "میلیون",
  "میلیارد",
  "تریلیون",
  "کوادریلیون",
  "کوینتیلیون",
  "سکستیلیون",
  "سپتیلیون",
  "اکتیلیون",
  "نانیلیون",
  "دسیلیون",
];

function threeDigitGroupToWords(value: number) {
  const parts: string[] = [];
  const hundred = Math.floor(value / 100);
  const remainder = value % 100;
  if (hundred) parts.push(hundreds[hundred]);
  if (remainder < 20 && remainder > 0) {
    parts.push(units[remainder]);
  } else if (remainder >= 20) {
    parts.push(tens[Math.floor(remainder / 10)]);
    if (remainder % 10) parts.push(units[remainder % 10]);
  }
  return parts.join(" و ");
}

export function numberToPersianWords(value: bigint | number | string) {
  let amount = BigInt(value);
  if (amount === 0n) return units[0];
  const negative = amount < 0n;
  if (negative) amount = -amount;

  const groups: string[] = [];
  let scale = 0;
  while (amount > 0n) {
    if (scale >= scales.length) {
      throw new RangeError("عدد از محدوده پشتیبانی تبدیل حروف فارسی بزرگ‌تر است.");
    }
    const group = Number(amount % 1000n);
    if (group > 0) {
      const words = threeDigitGroupToWords(group);
      groups.unshift(scales[scale] ? `${words} ${scales[scale]}` : words);
    }
    amount /= 1000n;
    scale += 1;
  }
  return `${negative ? "منفی " : ""}${groups.join(" و ")}`;
}

export function formatRialAsToman(rialAmount: bigint | string) {
  const amount = BigInt(rialAmount);
  const negative = amount < 0n;
  const absolute = negative ? -amount : amount;
  const wholeToman = absolute / 10n;
  const rialRemainder = absolute % 10n;
  const sign = negative ? "−" : "";
  const fraction = rialRemainder
    ? `٫${persianNumberFormat.format(rialRemainder)}`
    : "";
  return `${sign}${persianNumberFormat.format(wholeToman)}${fraction} تومان`;
}

export function rialAmountToPersianTomanWords(rialAmount: bigint | string) {
  const amount = BigInt(rialAmount);
  const negative = amount < 0n;
  const absolute = negative ? -amount : amount;
  const wholeToman = absolute / 10n;
  const rialRemainder = absolute % 10n;
  const words = numberToPersianWords(wholeToman);
  const fractionWords = rialRemainder
    ? ` و ${numberToPersianWords(rialRemainder)} ریال`
    : "";
  return `${negative ? "منفی " : ""}${words} تومان${fractionWords}`;
}

export function countInvoiceItemRows<T extends { productId: string }>(
  rows: T[]
) {
  return rows.filter((row) => row.productId !== "").length;
}

export function getPrintEmptyRowCount(itemCount: number) {
  return Math.max(0, 35 - itemCount);
}

export function filterInvoiceProducts<
  T extends {
    name: string;
    sku: string | null;
    barcode?: string | null;
    categoryId?: string | null;
  },
>(products: T[], categoryId: string, search: string) {
  const query = search.trim().toLocaleLowerCase();
  return products.filter((product) => {
    const matchesCategory =
      categoryId === "all" || product.categoryId === categoryId;
    const matchesSearch =
      !query ||
      [product.name, product.sku ?? "", product.barcode ?? ""]
        .some((value) => value.toLocaleLowerCase().includes(query));
    return matchesCategory && matchesSearch;
  });
}

export function hasInvoiceDiscount(discount: string | bigint) {
  return BigInt(discount) > 0n;
}

export function allocateInvoiceItemDiscounts(
  discount: bigint,
  items: { total?: string | null }[],
) : bigint[] | null {
  const weights = items.map((item) => {
    if (item.total === null || item.total === undefined || !/^-?\d+$/.test(item.total)) {
      return null;
    }
    return BigInt(item.total);
  });
  if (weights.some((weight) => weight === null)) return null;
  const validWeights = weights.filter(
    (weight): weight is bigint => weight !== null,
  );
  const totalWeight = validWeights.reduce((sum, weight) => sum + weight, 0n);
  if (totalWeight <= 0n) return null;

  const allocations = validWeights.map((weight) => (discount * weight) / totalWeight);
  let remainder = discount - allocations.reduce((sum, amount) => sum + amount, 0n);
  for (let index = 0; remainder > 0n; index = (index + 1) % allocations.length) {
    allocations[index] += 1n;
    remainder -= 1n;
  }
  return allocations;
}
