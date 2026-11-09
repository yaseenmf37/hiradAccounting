"use client";

import { formatInvoiceDate } from "@/lib/invoice-dates";
import {
  allocateInvoiceItemDiscounts,
  formatRialAsToman,
  getPrintEmptyRowCount,
  hasInvoiceDiscount,
  rialAmountToPersianTomanWords,
} from "@/lib/invoice-presentation";

export type InvoicePrintItem = {
  id?: string;
  quantity?: string | null;
  unitPrice?: string | null;
  total?: string | null;
  product?: { name: string; unit: string } | null;
};

export type InvoicePrintData = {
  type: "PURCHASE" | "SALE";
  invoiceNumber?: string | null;
  invoiceDate?: string | null;
  issuedAt?: string | null;
  createdAt?: string | null;
  subtotal?: string | null;
  extraCosts?: string | null;
  discount?: string | null;
  discountPercent?: string | null;
  total?: string | null;
  description?: string | null;
  contactNameSnapshot?: string | null;
  contactPhoneSnapshot?: string | null;
  contactAddressSnapshot?: string | null;
  contact?: {
    name: string;
    phone?: string | null;
    address?: string | null;
  } | null;
  business?: { name?: string | null; phone?: string | null } | null;
  items?: InvoicePrintItem[] | null;
};

const moneyFormat = new Intl.NumberFormat("fa-IR");
const quantityFormat = new Intl.NumberFormat("fa-IR", {
  maximumFractionDigits: 3,
});

function parseAmount(value: string | null | undefined) {
  if (value === null || value === undefined || value.trim() === "") return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

function formatAmount(value: string | null | undefined) {
  const amount = parseAmount(value);
  return amount === null ? "نامشخص" : formatRialAsToman(amount);
}

function formatQuantity(value: string | null | undefined) {
  const number = Number(value);
  return value !== null && value !== undefined && Number.isFinite(number)
    ? quantityFormat.format(number)
    : "—";
}

function formatDiscountPercent(value: string) {
  const percent = Number(value);
  return Number.isFinite(percent)
    ? `${new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 2 }).format(percent)}٪`
    : "";
}

export default function InvoicePrintView({ invoice }: { invoice: InvoicePrintData }) {
  const items = Array.isArray(invoice.items) ? invoice.items : [];
  const discountAmount = parseAmount(invoice.discount);
  const hasDiscount =
    discountAmount !== null && hasInvoiceDiscount(discountAmount);
  const extraCostsAmount = parseAmount(invoice.extraCosts);
  const totalAmount = parseAmount(invoice.total);
  const discountPercent =
    invoice.discountPercent ? formatDiscountPercent(invoice.discountPercent) : "";
  const emptyRowCount = getPrintEmptyRowCount(items.length);
  const discountAllocations = allocateInvoiceItemDiscounts(
    discountAmount ?? 0n,
    items,
  );
  const businessName = invoice.business?.name ?? "";
  const contactName = invoice.contactNameSnapshot ?? invoice.contact?.name ?? "";
  const contactPhone = invoice.contactPhoneSnapshot ?? invoice.contact?.phone ?? "";
  const contactAddress =
    invoice.contactAddressSnapshot ?? invoice.contact?.address ?? "";
  const sellerName = invoice.type === "SALE" ? businessName : contactName;
  const sellerPhone =
    invoice.type === "SALE" ? invoice.business?.phone ?? "" : contactPhone;
  const customerName = invoice.type === "SALE" ? contactName : businessName;
  const customerAddress = invoice.type === "SALE" ? contactAddress : "";
  const buyerPhone =
    invoice.type === "SALE" ? contactPhone : invoice.business?.phone ?? "";

  return (
    <section className="print-only print-invoice-root" dir="rtl">
      <h1 className="print-invoice-title">
        {invoice.type === "SALE" ? "فاکتور فروش" : "فاکتور خرید"}
      </h1>
      <header className="print-invoice-header">
        <div className="print-invoice-header-column print-invoice-seller">
          {sellerPhone && <p>شماره تماس فروشنده: {sellerPhone}</p>}
          {sellerName && <p>نام فروشنده: {sellerName}</p>}
          {customerName && <p>نام مشتری: {customerName}</p>}
          {customerAddress && <p>آدرس مشتری: {customerAddress}</p>}
        </div>
        <div className="print-invoice-header-column print-invoice-brand">
          {businessName && <strong>{businessName}</strong>}
          {buyerPhone && <p>شماره تماس خریدار: {buyerPhone}</p>}
          {invoice.description && <p>توضیحات فاکتور: {invoice.description}</p>}
        </div>
        <div className="print-invoice-header-column print-invoice-meta">
          <p>
            شماره فاکتور:{" "}
            {(invoice.invoiceNumber ?? "—").replace(
              /\d/g,
              (digit) => "۰۱۲۳۴۵۶۷۸۹"[Number(digit)],
            )}
          </p>
          <p>
            تاریخ فاکتور:{" "}
            {formatInvoiceDate(
              invoice.invoiceDate ?? invoice.issuedAt ?? invoice.createdAt,
            )}
          </p>
        </div>
      </header>
      <table className="print-invoice-table">
        <caption>
          تعداد اقلام: {moneyFormat.format(items.length)} قلم
        </caption>
        <thead>
          <tr>
            <th>ردیف</th>
            <th>نام کالا</th>
            <th>تعداد</th>
            <th>قیمت واحد</th>
            {hasDiscount && <th>تخفیف</th>}
            <th>جمع ردیف</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, index) => (
            <tr key={item.id ?? index}>
              <td>{moneyFormat.format(index + 1)}</td>
              <td>{item.product?.name ?? ""}</td>
              <td>
                {formatQuantity(item.quantity)} {item.product?.unit ?? ""}
              </td>
              <td>{formatAmount(item.unitPrice)}</td>
              {hasDiscount && (
                <td>
                  {discountAllocations
                    ? formatRialAsToman(discountAllocations[index] ?? 0n)
                    : "نامشخص"}
                </td>
              )}
              <td>{formatAmount(item.total)}</td>
            </tr>
          ))}
          {Array.from({ length: emptyRowCount }, (_, index) => (
            <tr key={`print-empty-${index}`} className="print-invoice-empty-row">
              <td></td>
              <td></td>
              <td></td>
              <td></td>
              {hasDiscount && <td></td>}
              <td></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="print-invoice-bottom">
        <div className="print-invoice-totals">
          <p>جمع کالاها: {formatAmount(invoice.subtotal)}</p>
          {extraCostsAmount !== null && extraCostsAmount > 0n && (
            <p>هزینه‌های جانبی: {formatAmount(invoice.extraCosts)}</p>
          )}
          {hasDiscount && (
            <p>
              تخفیف
              {discountPercent ? ` (${discountPercent})` : ""}
              : {formatAmount(invoice.discount)}
            </p>
          )}
          <strong>
            {hasDiscount ? "مبلغ قابل پرداخت پس از تخفیف" : "جمع کل"}:{" "}
            {formatAmount(invoice.total)}
          </strong>
          <p className="print-invoice-total-words">
            به حروف: {totalAmount === null
              ? "نامشخص"
              : rialAmountToPersianTomanWords(totalAmount)}
          </p>
        </div>
        <footer className="print-invoice-footer">
          <div className="print-invoice-signatures">
            <span>
              امضای {invoice.type === "SALE" ? "خریدار" : "فروشنده"}
            </span>
            <span>
              امضای {invoice.type === "SALE" ? "فروشنده" : "خریدار"}
            </span>
          </div>
          <p className="print-invoice-thanks">ممنون از خرید شما</p>
        </footer>
      </div>
    </section>
  );
}
