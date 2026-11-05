
"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  Plus, Search, RefreshCw, FileText, ShoppingCart, TrendingUp,
  X, Trash2, Pencil, Eye, CheckCircle2, Ban, Loader2,
  Package, Calculator, ChevronDown,
  Printer, RotateCcw,
} from "lucide-react";
import { currencyInputToRial } from "@/lib/currency";
import CursorPagination from "@/components/shared/cursor-pagination";
import NumericInput from "@/components/shared/numeric-input";
import useCursorPage from "@/hooks/use-cursor-page";
import useDebouncedValue from "@/hooks/use-debounced-value";
import type { QuickAction } from "@/lib/quick-actions";
import DatePicker from "react-multi-date-picker";
import DateObject from "react-date-object";
import persian from "react-date-object/calendars/persian";
import persian_fa from "react-date-object/locales/persian_fa";
import { formatInvoiceDate, invoiceDateToDay, toInvoiceDateObject } from "@/lib/invoice-dates";

type CurrencyUnit = "RIAL" | "TOMAN";
type InvoiceType = "PURCHASE" | "SALE";
type InvoiceStatus = "DRAFT" | "ISSUED" | "CANCELLED";

type Props = {
  currencyUnit: CurrencyUnit;
  initialType: InvoiceType;
  quickAction?: QuickAction | null;
};

type Product = {
  id: string;
  name: string;
  sku: string | null;
  unit: string;
  purchasePrice: string;
  salePrice: string;
  stock: string;
};

type Contact = {
  id: string;
  name: string;
  type: "CUSTOMER" | "SUPPLIER" | "BOTH";
  phone: string | null;
};

type InvoiceItem = {
  costOfGoodsSold?: string;
  costedQuantity?: string;
  id?: string;
  productId: string;
  quantity: string;
  unitPrice: string;
  total?: string;
  product?: { name: string; unit: string };
};

type InvoiceReturn = {
  id: string;
  returnNumber: string;
  total: string;
  description: string | null;
  createdAt: string;
  items: {
    id: string;
    invoiceItemId: string;
    productId: string;
    quantity: string;
    amount: string;
    inventoryCost: string;
    product: { name: string; unit: string };
  }[];
  payments: {
    method: string;
    amount: string;
    description: string | null;
    checkNumber?: string | null;
    checkIssuedAt?: string | null;
    checkDueAt?: string | null;
    payableTo?: string | null;
    destinationDetails?: string | null;
  }[];
};

type Invoice = {
  costingRecordedAt?: string | null;
  id: string;
  invoiceNumber: string;
  type: InvoiceType;
  status: InvoiceStatus;
  subtotal: string;
  extraCosts: string;
  discount: string;
  total: string;
  description: string | null;
  issuedAt: string | null;
  invoiceDate: string;
  createdAt: string;
  contact: {
    id: string;
    name: string;
    phone?: string | null;
    address?: string | null;
  } | null;
  business?: { name: string; phone: string | null };
  payments?: {
    allocationBatchId?: string | null;
    method: string;
    amount: string;
    description: string | null;
    checkNumber?: string | null;
    checkIssuedAt?: string | null;
    checkDueAt?: string | null;
    payableTo?: string | null;
    destinationDetails?: string | null;
  }[];
  purchaseReturns?: InvoiceReturn[];
  salesReturns?: InvoiceReturn[];
  revisions?: {
    id: string;
    createdAt: string;
    before: { total?: string; description?: string | null; invoiceDate?: string; items?: unknown[] };
    after: { total?: string; description?: string | null; invoiceDate?: string; items?: unknown[] };
  }[];
  contactNameSnapshot?: string | null;
  contactPhoneSnapshot?: string | null;
  contactAddressSnapshot?: string | null;
  items: InvoiceItem[];
};

type FormItem = {
  productId: string;
  quantity: string;
  unitPrice: string;
};

type PaymentForm = {
  method: "CASH" | "CHECK" | "CARD_TO_CARD" | "POS" | "LEDGER" | "BANK_TRANSFER";
  amount: string;
  description: string;
  checkNumber: string;
  checkIssuedAt: string;
  checkDueAt: string;
  payableTo: string;
  destinationDetails: string;
};

const paymentMethods: PaymentForm["method"][] = [
  "CASH", "CHECK", "CARD_TO_CARD", "POS", "LEDGER",
];
const paymentMethodLabels: Record<PaymentForm["method"], string> = {
  CASH: "نقدی",
  CHECK: "چک",
  CARD_TO_CARD: "کارت‌به‌کارت",
  POS: "کارت‌خوان",
  LEDGER: "حساب دفتری",
  BANK_TRANSFER: "انتقال بانکی",
};
function getPaymentDetails(payment: NonNullable<Invoice["payments"]>[number]) {
  return [
    payment.checkNumber && `شماره چک: ${payment.checkNumber}`,
    payment.checkIssuedAt && `تاریخ صدور: ${formatInvoiceDate(payment.checkIssuedAt)}`,
    payment.checkDueAt && `تاریخ سررسید: ${formatInvoiceDate(payment.checkDueAt)}`,
    payment.payableTo && `در وجه: ${payment.payableTo}`,
    payment.destinationDetails && `مقصد: ${payment.destinationDetails}`,
  ].filter((detail): detail is string => Boolean(detail));
}
const emptyPayments = (): PaymentForm[] => paymentMethods.map((method) => ({
  method, amount: "0", description: "", checkNumber: "", checkIssuedAt: "",
  checkDueAt: "", payableTo: "", destinationDetails: "",
}));

const emptyItem = (): FormItem => ({
  productId: "",
  quantity: "1",
  unitPrice: "0",
});

function normalizeDigits(value: string) {
  return value
    .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/[\s,٬]/g, "");
}

function parseCurrencyAmount(value: string, unit: CurrencyUnit): bigint | null {
  const normalized = normalizeDigits(value);
  if (!normalized) return 0n;
  try {
    return currencyInputToRial(normalized, unit);
  } catch (error) {
    if (error instanceof Error && error.message === "INVALID_CURRENCY_AMOUNT") {
      return null;
    }
    throw error;
  }
}

function parseQuantityUnits(value: string) {
  const normalized = normalizeDigits(value);
  if (!/^\d{1,12}(\.\d{1,3})?$/.test(normalized)) return 0n;
  const [whole, fraction = ""] = normalized.split(".");
  return BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, "0"));
}

function parseStockUnits(value: string) {
  const normalized = normalizeDigits(value);
  const negative = normalized.startsWith("-");
  const units = parseQuantityUnits(negative ? normalized.slice(1) : normalized);
  return negative ? -units : units;
}

function formatQuantityUnits(value: bigint) {
  const whole = value / 1000n;
  const fraction = (value % 1000n).toString().padStart(3, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function rialAmountToInput(value: string, unit: CurrencyUnit) {
  const amount = BigInt(value);
  if (unit === "RIAL") return amount.toString();
  const whole = amount / 10n;
  const fraction = amount % 10n;
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function lineAmount(quantity: string, unitPrice: string, unit: CurrencyUnit) {
  const price = parseCurrencyAmount(unitPrice, unit);
  return price === null
    ? 0n
    : (parseQuantityUnits(quantity) * price + 500n) / 1000n;
}

const moneyFormat = new Intl.NumberFormat("fa-IR");
const quantityFormat = new Intl.NumberFormat("fa-IR", {
  maximumFractionDigits: 3,
});

function formatMoney(value: string | number | bigint, unit: CurrencyUnit) {
  const amount = BigInt(String(value || "0"));
  if (unit === "RIAL") return `${moneyFormat.format(amount)} ریال`;
  const absolute = amount < 0n ? -amount : amount;
  const whole = absolute / 10n;
  const fraction = absolute % 10n;
  const formatted = `${amount < 0n ? "−" : ""}${moneyFormat.format(whole)}${fraction ? `٫${moneyFormat.format(fraction)}` : ""}`;
  return `${formatted} تومان`;
}

function formatQuantity(value: string | number) {
  const number = Number(value);
  return Number.isFinite(number) ? quantityFormat.format(number) : "۰";
}

function statusLabel(status: InvoiceStatus) {
  return {
    DRAFT: "پیش‌نویس",
    ISSUED: "صادر شده",
    CANCELLED: "لغو شده",
  }[status];
}

function statusClass(status: InvoiceStatus) {
  return {
    DRAFT: "bg-amber-500/10 text-amber-400",
    ISSUED: "bg-green-500/10 text-green-400",
    CANCELLED: "bg-red-500/10 text-red-400",
  }[status];
}

async function readResponse(response: Response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || "عملیات ناموفق بود.");
  }
  return data;
}

export default function InvoicesClient({ currencyUnit, initialType, quickAction }: Props) {
  const [type, setType] = useState<InvoiceType>(initialType);  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [modalOpen, setModalOpen] = useState(false);
  const [detailInvoice, setDetailInvoice] = useState<Invoice | null>(null);
  const [returnModalOpen, setReturnModalOpen] = useState(false);
  const [returnQuantities, setReturnQuantities] = useState<Record<string, string>>({});
  const [returnRefundAmount, setReturnRefundAmount] = useState("0");
  const [returnRefundMethod, setReturnRefundMethod] = useState<"CASH" | "CHECK" | "CARD_TO_CARD" | "POS">("CASH");
  const [returnRefundCheck, setReturnRefundCheck] = useState({
    number: "",
    issuedAt: "",
    dueAt: "",
    payableTo: "",
  });
  const [returnRefundDestination, setReturnRefundDestination] = useState("");
  const [returnDescription, setReturnDescription] = useState("");
  const returnRequestRef = useRef<{ key: string; body: string } | null>(null);
  const [editingInvoice, setEditingInvoice] = useState<Invoice | null>(null);

  const [contactId, setContactId] = useState("");
  const [contactSearch, setContactSearch] = useState("");
  const [description, setDescription] = useState("");
  const [extraCosts, setExtraCosts] = useState("0");
  const [discount, setDiscount] = useState("0");
  const [items, setItems] = useState<FormItem[]>([emptyItem()]);
  const [payments, setPayments] = useState<PaymentForm[]>(emptyPayments);
  const [contactSnapshot, setContactSnapshot] = useState({ name: "", phone: "", address: "" });
  const [productSearch, setProductSearch] = useState("");
  const [quickProductOpen, setQuickProductOpen] = useState(false);
  const [quickProduct, setQuickProduct] = useState({ name: "", unit: "عدد", purchasePrice: "0", salePrice: "0" });
  const [issueImmediately, setIssueImmediately] = useState(false);
  const [invoiceDate, setInvoiceDate] = useState<DateObject>(() => toInvoiceDateObject(null));
  const [startDate, setStartDate] = useState<DateObject | null>(null);
  const [endDate, setEndDate] = useState<DateObject | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const debouncedSearch = useDebouncedValue(search);
  const debouncedContactSearch = useDebouncedValue(contactSearch);
  const paging = useCursorPage();

  const loadData = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError("");

    try {
      const params = new URLSearchParams({
        type,
        status: statusFilter,
        search: debouncedSearch.trim(),
        limit: "50",
      });
      if (paging.cursor) params.set("cursor", paging.cursor);
      if (startDate) params.set("startDate", invoiceDateToDay(startDate));
      if (endDate) params.set("endDate", invoiceDateToDay(endDate));

      const invoiceResponse = await fetch(`/api/invoices?${params}`, {
        cache: "no-store",
        signal,
      });
      const invoiceData = await readResponse(invoiceResponse);

      setInvoices(invoiceData.invoices ?? []);
      setTotalCount(invoiceData.total ?? 0);
      paging.setNextCursor(invoiceData.nextCursor ?? null);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "خطا در دریافت اطلاعات.");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [type, statusFilter, debouncedSearch, paging.cursor, paging.setNextCursor, startDate, endDate]);

  useEffect(() => {
    const controller = new AbortController();
    void loadData(controller.signal);
    return () => controller.abort();
  }, [loadData]);

  useEffect(() => {
    if (
      quickAction?.action === "invoice" &&
      quickAction.targetView ===
        (initialType === "PURCHASE" ? "purchase-invoices" : "sales-invoices")
    ) {
      openNewInvoice();
    }
  }, [quickAction?.requestId, quickAction?.action, quickAction?.targetView, initialType]);

  useEffect(() => {
    if (!modalOpen) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const query = productSearch.trim();
        if (!query) {
          const response = await fetch("/api/products?limit=100", {
            cache: "no-store",
            signal: controller.signal,
          });
          const data = await readResponse(response);
          setProducts((current) => [...(data.products ?? []), ...current.filter(
            (product) => !(data.products ?? []).some((listed: Product) => listed.id === product.id),
          )]);
          return;
        }
        const response = await fetch(
          `/api/products?search=${encodeURIComponent(query)}&limit=100`,
          { cache: "no-store", signal: controller.signal }
        );
        const data = await readResponse(response);
        setProducts((current) => {
          const results: Product[] = data.products ?? [];
          const byId = new Map(current.map((product) => [product.id, product]));
          for (const product of results) byId.set(product.id, product);
          return [...byId.values()];
        });
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "جست‌وجوی کالا انجام نشد.");
      }
    }, 200);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [modalOpen, productSearch]);

  useEffect(() => {
    if (!modalOpen) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(
          `/api/contacts?type=${type === "PURCHASE" ? "SUPPLIER" : "CUSTOMER"}&limit=100${debouncedContactSearch.trim() ? `&search=${encodeURIComponent(debouncedContactSearch.trim())}` : ""}`,
          { cache: "no-store", signal: controller.signal }
        );
        const data = await readResponse(response);
        const results: Contact[] = data.contacts ?? [];
        setContacts((current) => {
          const selected = current.find((contact) => contact.id === contactId);
          return selected && !results.some((contact) => contact.id === selected.id)
            ? [selected, ...results]
            : results;
        });
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "دریافت طرف‌حساب‌ها ناموفق بود.");
      }
    })();
    return () => controller.abort();
  }, [modalOpen, type, debouncedContactSearch, contactId]);

  const resetForm = () => {
    setContactId("");
    setDescription("");
    setExtraCosts("0");
    setDiscount("0");
    setItems([emptyItem()]);
    setPayments(emptyPayments());
    setContactSnapshot({ name: "", phone: "", address: "" });
    setIssueImmediately(false);
    setInvoiceDate(toInvoiceDateObject(null));
    setEditingInvoice(null);
  };

  const openNewInvoice = () => {
    resetForm();
    setContactSearch("");
    setModalOpen(true);
  };

  const openEditInvoice = async (invoice: Invoice) => {
    try {
      setError("");
      const response = await fetch(`/api/invoices/${invoice.id}`, {
        cache: "no-store",
      });
      const data = await readResponse(response);
      const fullInvoice: Invoice = data.invoice;
      const productResponse = await fetch(
        `/api/products?ids=${fullInvoice.items.map((item) => item.productId).join(",")}`,
        { cache: "no-store" },
      );
      const productData = await readResponse(productResponse);
      setProducts((current) => {
        const byId = new Map(current.map((product) => [product.id, product]));
        for (const product of productData.products ?? []) byId.set(product.id, product);
        return [...byId.values()];
      });

      setEditingInvoice(fullInvoice);
      setInvoiceDate(toInvoiceDateObject(fullInvoice.invoiceDate ?? fullInvoice.createdAt));
      setContactId(fullInvoice.contact?.id ?? "");
      setContactSnapshot({
        name: fullInvoice.contactNameSnapshot ?? "",
        phone: fullInvoice.contactPhoneSnapshot ?? "",
        address: fullInvoice.contactAddressSnapshot ?? "",
      });
      setDescription(fullInvoice.description ?? "");
      setExtraCosts(rialAmountToInput(fullInvoice.extraCosts, currencyUnit));
      setDiscount(rialAmountToInput(fullInvoice.discount, currencyUnit));
      setItems(
        fullInvoice.items.map((item) => ({
          productId: item.productId,
          quantity: item.quantity,
          unitPrice: rialAmountToInput(item.unitPrice, currencyUnit),
        }))
      );
      const currentBatchId = fullInvoice.payments?.find(
        (payment) => payment.allocationBatchId,
      )?.allocationBatchId;
      const planPayments = currentBatchId
        ? fullInvoice.payments?.filter(
            (payment) => payment.allocationBatchId === currentBatchId,
          )
        : fullInvoice.payments;
      setPayments(emptyPayments().map((payment) => {
        const existing = planPayments?.find((entry) => entry.method === payment.method);
        return existing ? {
          ...payment,
          amount: rialAmountToInput(existing.amount, currencyUnit),
          description: existing.description ?? "",
          checkNumber: existing.checkNumber ?? "",
          checkIssuedAt: existing.checkIssuedAt?.slice(0, 10) ?? "",
          checkDueAt: existing.checkDueAt?.slice(0, 10) ?? "",
          payableTo: existing.payableTo ?? "",
          destinationDetails: existing.destinationDetails ?? "",
        } : payment;
      }));
      setModalOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "خطا در دریافت فاکتور.");
    }
  };

  const addItem = () => setItems((current) => [...current, emptyItem()]);

  const removeItem = (index: number) => {
    setItems((current) =>
      current.length > 1 ? current.filter((_, i) => i !== index) : current
    );
  };

  const updateItem = (
    index: number,
    field: keyof FormItem,
    value: string
  ) => {
    setItems((current) =>
      current.map((item, i) =>
        i === index ? { ...item, [field]: value } : item
      )
    );
  };

  const selectedProduct = (productId: string) =>
    products.find((product) => product.id === productId);
  const getShortages = (
    rows: { productId: string; quantity: string }[],
    candidates: Product[] = products,
  ) => {
    const quantities = new Map<string, bigint>();
    for (const item of rows) {
      quantities.set(
        item.productId,
        (quantities.get(item.productId) ?? 0n) + parseQuantityUnits(item.quantity),
      );
    }
    return [...quantities.entries()].flatMap(([productId, quantity]) => {
      const product = candidates.find((candidate) => candidate.id === productId);
      return product && parseStockUnits(product.stock) < quantity
        ? [{ product, quantity }]
        : [];
    });
  };
  const chooseShortageModes = (
    shortages: { product: Product; quantity: bigint }[],
  ): Record<string, "NEGATIVE" | "BACKORDER"> | null => {
    const modes: Record<string, "NEGATIVE" | "BACKORDER"> = {};
    for (const { product, quantity } of shortages) {
      const choice = window.prompt(
        `موجودی «${product.name}» ${formatQuantity(product.stock)} ${product.unit} است، اما مقدار سفارش ${formatQuantityUnits(quantity)} است.\nبرای فروش با موجودی منفی «منفی» یا برای ثبت کسری سفارش «کسری» را وارد کنید. برای انصراف، لغو را بزنید.`,
        "منفی",
      );
      if (choice === null) return null;
      if (choice.trim() === "منفی") modes[product.id] = "NEGATIVE";
      else if (choice.trim() === "کسری") modes[product.id] = "BACKORDER";
      else throw new Error("برای هر کالا «منفی» یا «کسری» را انتخاب کنید.");
    }
    return modes;
  };
  const matchingProducts = products.filter((product) =>
    product.name.toLocaleLowerCase().includes(productSearch.trim().toLocaleLowerCase()) ||
    product.sku?.toLocaleLowerCase().includes(productSearch.trim().toLocaleLowerCase())
  );
  const addProductToInvoice = (product: Product) => {
    const price = type === "PURCHASE" ? product.purchasePrice : product.salePrice;
    const displayedPrice = rialAmountToInput(price, currencyUnit);
    setItems((current) => {
      const existing = current.findIndex((item) => item.productId === product.id);
      if (existing >= 0) {
        return current.map((item, index) => index === existing
          ? { ...item, quantity: formatQuantityUnits(parseQuantityUnits(item.quantity) + 1000n) }
          : item);
      }
      const rows = current.length === 1 && !current[0].productId ? [] : current;
      return [...rows, { productId: product.id, quantity: "1", unitPrice: displayedPrice }];
    });
  };

  const createQuickProduct = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: quickProduct.name,
          unit: quickProduct.unit,
          purchasePrice: normalizeDigits(quickProduct.purchasePrice),
          salePrice: normalizeDigits(quickProduct.salePrice),
          initialStock: "0",
          minStock: "0",
        }),
      });
      const data = await readResponse(response);
      const created: Product = data.product;
      setProducts((current) => [created, ...current]);
      addProductToInvoice(created);
      setQuickProductOpen(false);
      setQuickProduct({ name: "", unit: "عدد", purchasePrice: "0", salePrice: "0" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "ایجاد کالا انجام نشد.");
    } finally {
      setSaving(false);
    }
  };

  const subtotal = useMemo(
    () => items.reduce((sum, item) => sum + lineAmount(item.quantity, item.unitPrice, currencyUnit), 0n),
    [items, currencyUnit],
  );
  const finalTotal = subtotal +
    (parseCurrencyAmount(extraCosts, currencyUnit) ?? 0n) -
    (parseCurrencyAmount(discount, currencyUnit) ?? 0n);

  const detailCostOfGoodsSold = detailInvoice?.items.reduce(
  (sum, item) => sum + BigInt(item.costOfGoodsSold ?? "0"),
  0n
) ?? 0n;

const detailGrossProfit = detailInvoice
  ? BigInt(detailInvoice.total) - detailCostOfGoodsSold
  : 0n;

  const submitInvoice = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    setSuccess("");
    const shouldIssueImmediately = type === "PURCHASE" || issueImmediately;

    try {
      const validItems = items.filter((item) => item.productId);

      if (validItems.length === 0) {
        throw new Error("حداقل یک کالای معتبر به فاکتور اضافه کنید.");
      }
      if (validItems.some((item) =>
        parseQuantityUnits(item.quantity) <= 0n ||
        parseCurrencyAmount(item.unitPrice, currencyUnit) === null
      )) {
        throw new Error("تعداد و قیمت همه اقلام باید معتبر و مثبت باشند.");
      }
      if (
        parseCurrencyAmount(extraCosts, currencyUnit) === null ||
        parseCurrencyAmount(discount, currencyUnit) === null ||
        payments.some((payment) => parseCurrencyAmount(payment.amount, currencyUnit) === null)
      ) {
        throw new Error("مبلغ هزینه، تخفیف یا روش پرداخت معتبر نیست.");
      }

      const payload = {
        type,
        invoiceDate: invoiceDateToDay(invoiceDate),
        issueImmediately: shouldIssueImmediately && type === "SALE",
        contactId: contactId || null,
        contactSnapshot: !contactId && contactSnapshot.name.trim()
          ? { ...contactSnapshot, name: contactSnapshot.name.trim() }
          : null,
        description: description.trim() || null,
        extraCosts: normalizeDigits(extraCosts || "0"),
        discount: normalizeDigits(discount || "0"),
        items: validItems.map((item) => ({
          ...item,
          quantity: normalizeDigits(item.quantity),
          unitPrice: normalizeDigits(item.unitPrice),
        })),
        payments: payments.map((payment) => ({
          ...payment,
          amount: normalizeDigits(payment.amount || "0"),
          description: payment.description || null,
          checkNumber: payment.checkNumber || null,
          checkIssuedAt: payment.checkIssuedAt || null,
          checkDueAt: payment.checkDueAt || null,
          payableTo: payment.payableTo || null,
          destinationDetails: payment.destinationDetails || null,
        })),
      };

      const suppliedPaymentTotal = payments.reduce(
        (sum, payment) => sum + (parseCurrencyAmount(payment.amount, currencyUnit) ?? 0n),
        0n,
      );
      if (suppliedPaymentTotal !== finalTotal) {
        throw new Error(suppliedPaymentTotal < finalTotal
          ? "مجموع روش‌های پرداخت کمتر از مبلغ فاکتور است."
          : "مجموع روش‌های پرداخت بیشتر از مبلغ فاکتور است.");
      }

      let directShortageModes: Record<string, "NEGATIVE" | "BACKORDER"> = {};
      if (issueImmediately && type === "SALE" && !editingInvoice) {
        const productIds = [...new Set(validItems.map((item) => item.productId))];
        const productResponse = await fetch(
          `/api/products?ids=${productIds.join(",")}`,
          { cache: "no-store" },
        );
        const productData = await readResponse(productResponse);
        const currentProducts: Product[] = productData.products ?? [];
        setProducts((current) => {
          const byId = new Map(current.map((product) => [product.id, product]));
          for (const product of currentProducts) byId.set(product.id, product);
          return [...byId.values()];
        });
        const shortages = getShortages(validItems, currentProducts);
        if (shortages.length) {
          const selection = chooseShortageModes(shortages);
          if (!selection) {
            throw new Error("صدور مستقیم انصراف داده شد؛ فاکتور ثبت نشد.");
          }
          directShortageModes = selection;
        }
      }

      const response = await fetch(
        editingInvoice
          ? `/api/invoices/${editingInvoice.id}`
          : "/api/invoices",
        {
          method: editingInvoice ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );

      const saved = await readResponse(response);
      if (issueImmediately && type === "SALE" && !editingInvoice) {
        const issueResponse = await fetch(`/api/invoices/${saved.invoice.id}/issue`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ shortageModes: directShortageModes }),
        });
        await readResponse(issueResponse);
      }
      setSuccess(
        editingInvoice?.status === "ISSUED"
          ? "فاکتور صادرشده ویرایش شد."
          : editingInvoice
            ? "پیش‌نویس ویرایش شد."
            : type === "PURCHASE"
              ? "فاکتور خرید مستقیماً صادر شد."
              : issueImmediately
              ? "فاکتور فروش مستقیماً صادر شد."
              : "پیش‌نویس فاکتور ثبت شد.",
      );
      setModalOpen(false);
      resetForm();
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "خطا در ثبت فاکتور.");
    } finally {
      setSaving(false);
    }
  };

  const issueInvoice = async (invoice: Invoice) => {
    setSaving(true);
    setError("");

    try {
      let shortageModes: Record<string, "NEGATIVE" | "BACKORDER"> = {};
      if (invoice.type === "SALE") {
        const productIds = [...new Set(invoice.items.map((item) => item.productId))];
        const productResponse = await fetch(
          `/api/products?ids=${productIds.join(",")}`,
          { cache: "no-store" },
        );
        const productData = await readResponse(productResponse);
        const currentProducts: Product[] = productData.products ?? [];
        setProducts((current) => {
          const byId = new Map(current.map((product) => [product.id, product]));
          for (const product of currentProducts) byId.set(product.id, product);
          return [...byId.values()];
        });
        const shortages = getShortages(invoice.items, currentProducts);
        if (shortages.length) {
          const selection = chooseShortageModes(shortages);
          if (!selection) return;
          shortageModes = selection;
        } else if (!window.confirm(`فاکتور ${invoice.invoiceNumber} صادر شود؟`)) return;
      } else if (!window.confirm(`فاکتور ${invoice.invoiceNumber} صادر شود؟`)) return;

      const response = await fetch(
        `/api/invoices/${invoice.id}/issue`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ shortageModes }),
        }
      );
      await readResponse(response);
      setSuccess("فاکتور با موفقیت صادر شد.");
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "خطا در صدور فاکتور.");
    } finally {
      setSaving(false);
    }
  };

  const cancelInvoice = async (invoice: Invoice) => {
    if (!window.confirm(`فاکتور ${invoice.invoiceNumber} لغو شود؟`)) return;

    setSaving(true);
    setError("");

    try {
      const response = await fetch(
        `/api/invoices/${invoice.id}/cancel`,
        { method: "POST" }
      );
      await readResponse(response);
      setSuccess("فاکتور لغو شد و تغییرات انبار ثبت شد.");
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "خطا در لغو فاکتور.");
    } finally {
      setSaving(false);
    }
  };

  const deleteInvoice = async (invoice: Invoice) => {
    if (invoice.type !== "PURCHASE") return;
    if (!window.confirm(`پیش‌نویس ${invoice.invoiceNumber} حذف شود؟`)) return;

    setSaving(true);
    setError("");

    try {
      const response = await fetch(`/api/invoices/${invoice.id}`, {
        method: "DELETE",
      });
      await readResponse(response);
      setSuccess("پیش‌نویس حذف شد.");
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "خطا در حذف فاکتور.");
    } finally {
      setSaving(false);
    }
  };

  const showDetails = async (invoice: Invoice) => {
    try {
      const [response, revisionsResponse] = await Promise.all([
        fetch(`/api/invoices/${invoice.id}`, { cache: "no-store" }),
        fetch(`/api/invoices/${invoice.id}/revisions`, { cache: "no-store" }),
      ]);
      const [data, revisionData] = await Promise.all([
        readResponse(response),
        readResponse(revisionsResponse),
      ]);
      setDetailInvoice({ ...data.invoice, revisions: revisionData.revisions ?? [] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "خطا در دریافت جزئیات.");
    }
  };

  const remainingReturnQuantity = (invoice: Invoice, invoiceItemId: string) => {
    const item = invoice.items.find((entry) => entry.id === invoiceItemId);
    if (!item) return 0n;
    const returns = invoice.type === "PURCHASE" ? invoice.purchaseReturns : invoice.salesReturns;
    const returned = returns?.reduce(
      (sum, invoiceReturn) => sum + invoiceReturn.items.reduce(
        (itemSum, returnedItem) => returnedItem.invoiceItemId === invoiceItemId
          ? itemSum + parseQuantityUnits(returnedItem.quantity)
          : itemSum,
        0n,
      ),
      0n,
    ) ?? 0n;
    const returnableQuantity = invoice.type === "SALE"
      ? parseQuantityUnits(item.costedQuantity ?? "0")
      : parseQuantityUnits(item.quantity);
    const remaining = returnableQuantity - returned;
    return remaining > 0n ? remaining : 0n;
  };

  const submitInvoiceReturn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!detailInvoice) return;
    const selectedItems = detailInvoice.items.flatMap((item) => {
      const quantity = normalizeDigits(returnQuantities[item.id ?? ""] ?? "0");
      return item.id && parseQuantityUnits(quantity) > 0n
        ? [{ invoiceItemId: item.id, quantity }]
        : [];
    });
    if (!selectedItems.length) {
      setError("برای مرجوعی، حداقل یک کالا با مقدار معتبر انتخاب کنید.");
      return;
    }

    const requestBody = {
      items: selectedItems,
      refundAmount: normalizeDigits(returnRefundAmount || "0"),
      refundMethod: returnRefundMethod,
      refundCheckNumber: returnRefundCheck.number.trim() || null,
      refundCheckIssuedAt: returnRefundCheck.issuedAt || null,
      refundCheckDueAt: returnRefundCheck.dueAt || null,
      refundPayableTo: returnRefundCheck.payableTo.trim() || null,
      refundDestinationDetails: returnRefundDestination.trim() || null,
      description: returnDescription.trim() || null,
    };
    const bodyFingerprint = JSON.stringify(requestBody);
    if (!returnRequestRef.current || returnRequestRef.current.body !== bodyFingerprint) {
      returnRequestRef.current = {
        key: crypto.randomUUID(),
        body: bodyFingerprint,
      };
    }

    setSaving(true);
    setError("");
    try {
      const returnPath = detailInvoice.type === "SALE" ? "sales-returns" : "returns";
      const response = await fetch(`/api/invoices/${detailInvoice.id}/${returnPath}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...requestBody,
          idempotencyKey: returnRequestRef.current.key,
        }),
      });
      const data = await readResponse(response);
      setSuccess(data.message ?? `مرجوعی ${detailInvoice.type === "SALE" ? "فروش" : "خرید"} ثبت شد.`);
      setReturnModalOpen(false);
      setReturnQuantities({});
      setReturnRefundAmount("0");
      setReturnRefundCheck({ number: "", issuedAt: "", dueAt: "", payableTo: "" });
      setReturnRefundDestination("");
      setReturnDescription("");
      returnRequestRef.current = null;
      await Promise.all([loadData(), showDetails(detailInvoice)]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "ثبت مرجوعی انجام نشد.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
            <h2 className="text-xl font-bold text-white">
            {type === "PURCHASE" ? "فاکتور خرید" : "فاکتور فروش"}
            </h2>
            <p className="mt-1 text-sm text-slate-400">
            {type === "PURCHASE"
                ? "ثبت و پیگیری خرید از تأمین‌کنندگان"
                : "ثبت و پیگیری فروش به مشتریان"}
            </p>
        </div>

        <button
          onClick={openNewInvoice}
          className="flex items-center gap-2 rounded-xl bg-green-500 px-4 py-3 text-sm font-bold text-white transition hover:bg-green-400"
        >
          <Plus size={18} />
          ثبت فاکتور جدید
        </button>
      </div>

      {/* <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <button
          onClick={() => setType("PURCHASE")}
          className={`flex items-center gap-3 rounded-2xl border p-4 text-right transition ${
            type === "PURCHASE"
              ? "border-green-500/40 bg-green-500/10"
              : "border-[#263341] bg-[#111820] hover:border-slate-500"
          }`}
        >
          <span className="rounded-xl bg-blue-500/10 p-3 text-blue-400">
            <ShoppingCart size={22} />
          </span>
          <span>
            <span className="block font-bold text-white">فاکتور خرید</span>
            <span className="mt-1 block text-xs text-slate-400">
              ثبت خرید از تأمین‌کنندگان
            </span>
          </span>
        </button>

        <button
          onClick={() => setType("SALE")}
          className={`flex items-center gap-3 rounded-2xl border p-4 text-right transition ${
            type === "SALE"
              ? "border-green-500/40 bg-green-500/10"
              : "border-[#263341] bg-[#111820] hover:border-slate-500"
          }`}
        >
          <span className="rounded-xl bg-green-500/10 p-3 text-green-400">
            <TrendingUp size={22} />
          </span>
          <span>
            <span className="block font-bold text-white">فاکتور فروش</span>
            <span className="mt-1 block text-xs text-slate-400">
              ثبت فروش به مشتریان
            </span>
          </span>
        </button>
      </div> */}

      {error && (
        <div className="flex items-center justify-between rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-300">
          <span>{error}</span>
          <button onClick={() => setError("")}><X size={17} /></button>
        </div>
      )}

      {success && (
        <div className="flex items-center justify-between rounded-xl border border-green-500/20 bg-green-500/10 p-4 text-sm text-green-300">
          <span>{success}</span>
          <button onClick={() => setSuccess("")}><X size={17} /></button>
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
          <input
            value={search}
            onChange={(event) => {
              paging.resetPages();
              setSearch(event.target.value);
            }}
            placeholder="جست‌وجوی شماره فاکتور..."
            className="w-full rounded-xl border border-[#263341] bg-[#111820] py-3 pr-10 pl-4 text-sm text-white outline-none focus:border-green-500"
          />
        </div>

        <select
          value={statusFilter}
          onChange={(event) => {
            paging.resetPages();
            setStatusFilter(event.target.value);
          }}
          className="rounded-xl border border-[#263341] bg-[#111820] px-4 py-3 text-sm text-white outline-none"
        >
          <option value="ALL">همه وضعیت‌ها</option>
          <option value="DRAFT">پیش‌نویس</option>
          <option value="ISSUED">صادر شده</option>
          <option value="CANCELLED">لغو شده</option>
        </select>

        <button
          onClick={() => void loadData()}
          className="flex items-center justify-center gap-2 rounded-xl border border-[#263341] bg-[#111820] px-4 py-3 text-sm text-slate-300 hover:border-slate-500"
        >
          <RefreshCw size={17} />
          بروزرسانی
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs text-slate-400">بازه تاریخ فاکتور:</span>
        <DatePicker
          value={startDate}
          calendar={persian}
          locale={persian_fa}
          format="YYYY/MM/DD"
          inputClass="w-36 rounded-lg border border-[#263341] bg-[#111820] px-3 py-2 text-sm text-white outline-none"
          placeholder="از تاریخ"
          onChange={(value) => {
            paging.resetPages();
            setStartDate(value instanceof DateObject ? value : null);
          }}
        />
        <DatePicker
          value={endDate}
          calendar={persian}
          locale={persian_fa}
          format="YYYY/MM/DD"
          inputClass="w-36 rounded-lg border border-[#263341] bg-[#111820] px-3 py-2 text-sm text-white outline-none"
          placeholder="تا تاریخ"
          onChange={(value) => {
            paging.resetPages();
            setEndDate(value instanceof DateObject ? value : null);
          }}
        />
        {(startDate || endDate) && (
          <button
            type="button"
            onClick={() => {
              paging.resetPages();
              setStartDate(null);
              setEndDate(null);
            }}
            className="rounded-lg border border-[#263341] px-3 py-2 text-xs text-slate-300 hover:bg-white/5"
          >
            پاک‌کردن بازه
          </button>
        )}
      </div>

      <div className="overflow-hidden rounded-2xl border border-[#263341] bg-[#111820]">
        <div className="flex items-center justify-between border-b border-[#263341] px-5 py-4">
          <h3 className="font-bold text-white">
            {type === "PURCHASE" ? "فاکتورهای خرید" : "فاکتورهای فروش"}
          </h3>
          <span className="text-xs text-slate-500">
            {moneyFormat.format(totalCount)} فاکتور
          </span>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 p-12 text-slate-400">
            <Loader2 className="animate-spin" size={20} />
            در حال دریافت اطلاعات...
          </div>
        ) : invoices.length === 0 ? (
          <div className="p-12 text-center">
            <FileText className="mx-auto mb-3 text-slate-600" size={36} />
            <p className="font-medium text-slate-300">فاکتوری ثبت نشده است.</p>
            <p className="mt-1 text-xs text-slate-500">
              برای شروع، فاکتور جدید ثبت کنید.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-right text-sm">
              <thead className="bg-[#0d141c] text-xs text-slate-500">
                <tr>
                  <th className="px-5 py-4">شماره فاکتور</th>
                  <th className="px-5 py-4">طرف حساب</th>
                  <th className="px-5 py-4">تاریخ ثبت</th>
                  <th className="px-5 py-4">مبلغ نهایی</th>
                  <th className="px-5 py-4">وضعیت</th>
                  <th className="px-5 py-4">عملیات</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((invoice) => (
                  <tr key={invoice.id} className="border-t border-[#263341] hover:bg-white/[0.02]">
                    <td className="px-5 py-4 font-semibold text-white" dir="ltr">
                      {invoice.invoiceNumber}
                    </td>
                    <td className="px-5 py-4 text-slate-300">
                      {invoice.contact?.name ?? invoice.contactNameSnapshot ?? "بدون طرف حساب"}
                    </td>
                    <td className="px-5 py-4 text-slate-400">
                      {formatInvoiceDate(invoice.invoiceDate ?? invoice.createdAt)}
                    </td>
                    <td className="px-5 py-4 font-semibold text-white">
                      {formatMoney(invoice.total, currencyUnit)}
                    </td>
                    <td className="px-5 py-4">
                      <span className={`rounded-lg px-3 py-1.5 text-xs ${statusClass(invoice.status)}`}>
                        {statusLabel(invoice.status)}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-2">
                        <button
                          title="مشاهده"
                          onClick={() => void showDetails(invoice)}
                          className="rounded-lg p-2 text-slate-400 hover:bg-white/5 hover:text-white"
                        >
                          <Eye size={17} />
                        </button>
                        {invoice.status === "DRAFT" && (
                          <>
                            <button
                              title="ویرایش"
                              onClick={() => void openEditInvoice(invoice)}
                              className="rounded-lg p-2 text-blue-400 hover:bg-blue-500/10"
                            >
                              <Pencil size={17} />
                            </button>
                            <button
                              title="صدور"
                              disabled={saving}
                              onClick={() => void issueInvoice(invoice)}
                              className="rounded-lg p-2 text-green-400 hover:bg-green-500/10"
                            >
                              <CheckCircle2 size={17} />
                            </button>
                            {invoice.type === "PURCHASE" && <button
                              title="حذف"
                              disabled={saving}
                              onClick={() => void deleteInvoice(invoice)}
                              className="rounded-lg p-2 text-red-400 hover:bg-red-500/10"
                            >
                              <Trash2 size={17} />
                            </button>}
                          </>
                        )}
                        {invoice.status === "ISSUED" && (
                          <button
                            title="ویرایش فاکتور صادرشده"
                            onClick={() => void openEditInvoice(invoice)}
                            className="rounded-lg p-2 text-blue-400 hover:bg-blue-500/10"
                          >
                            <Pencil size={17} />
                          </button>
                        )}
                        {invoice.status === "ISSUED" && (
                          <button
                            title="لغو فاکتور"
                            disabled={saving}
                            onClick={() => void cancelInvoice(invoice)}
                            className="rounded-lg p-2 text-red-400 hover:bg-red-500/10"
                          >
                            <Ban size={17} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <CursorPagination
          total={totalCount}
          page={paging.page}
          hasNext={Boolean(paging.nextCursor)}
          loading={loading}
          onPrevious={paging.previousPage}
          onNext={paging.nextPage}
        />
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/70 p-3 backdrop-blur-sm">
          <form
            onSubmit={submitInvoice}
            className="my-6 w-full max-w-4xl rounded-2xl border border-[#263341] bg-[#111820] shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-[#263341] px-5 py-4">
              <div>
                <h3 className="font-bold text-white">
                  {editingInvoice?.status === "ISSUED"
                    ? "ویرایش فاکتور صادرشده"
                    : editingInvoice ? "ویرایش پیش‌نویس" : "ثبت فاکتور جدید"}
                </h3>
                <p className="mt-1 text-xs text-slate-500">
                  {type === "PURCHASE" ? "فاکتور خرید" : "فاکتور فروش"}
                </p>
              </div>
              <button type="button" onClick={() => setModalOpen(false)} className="rounded-lg p-2 text-slate-400 hover:bg-white/5">
                <X size={20} />
              </button>
            </div>

            <div className="max-h-[70vh] space-y-5 overflow-y-auto p-5">
              <label className="block space-y-2 text-sm text-slate-300">
                <span>تاریخ فاکتور (شمسی)</span>
                <DatePicker
                  value={invoiceDate}
                  calendar={persian}
                  locale={persian_fa}
                  format="YYYY/MM/DD"
                  inputClass="w-full rounded-xl border border-[#263341] bg-[#0d141c] p-3 text-white outline-none focus:border-green-500"
                  onChange={(value) => {
                    if (value instanceof DateObject) setInvoiceDate(value);
                  }}
                />
              </label>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="space-y-2 text-sm text-slate-300">
                  <span>{type === "PURCHASE" ? "تأمین‌کننده" : "مشتری"}</span>
                  <input
                    value={contactSearch}
                    onChange={(event) => setContactSearch(event.target.value)}
                    placeholder="جست‌وجوی مخاطب..."
                    disabled={editingInvoice?.status === "ISSUED"}
                    className="w-full rounded-xl border border-[#263341] bg-[#0d141c] p-3 text-white outline-none focus:border-green-500"
                  />
                  <select
                    value={contactId}
                    onChange={(event) => setContactId(event.target.value)}
                    disabled={editingInvoice?.status === "ISSUED"}
                    className="w-full rounded-xl border border-[#263341] bg-[#0d141c] p-3 text-white outline-none focus:border-green-500"
                  >
                    <option value="">بدون طرف حساب</option>
                    {contacts.map((contact) => (
                      <option key={contact.id} value={contact.id}>
                        {contact.name}{contact.phone ? ` - ${contact.phone}` : ""}
                      </option>
                    ))}
                  </select>
                </label>

                {type === "SALE" && (
                  <label className="space-y-2 text-sm text-slate-300">
                    <span>مشتری موقت (در صورت انتخاب‌نکردن مخاطب)</span>
                    <input
                      value={contactSnapshot.name}
                      onChange={(event) => setContactSnapshot((current) => ({ ...current, name: event.target.value }))}
                      disabled={editingInvoice?.status === "ISSUED"}
                      placeholder="نام مشتری"
                      className="w-full rounded-xl border border-[#263341] bg-[#0d141c] p-3 text-white outline-none focus:border-green-500"
                    />
                    <input
                      value={contactSnapshot.phone}
                      onChange={(event) => setContactSnapshot((current) => ({ ...current, phone: event.target.value }))}
                      disabled={editingInvoice?.status === "ISSUED"}
                      placeholder="شماره تماس"
                      className="w-full rounded-xl border border-[#263341] bg-[#0d141c] p-3 text-white outline-none focus:border-green-500"
                    />
                    <input
                      value={contactSnapshot.address}
                      onChange={(event) => setContactSnapshot((current) => ({ ...current, address: event.target.value }))}
                      disabled={editingInvoice?.status === "ISSUED"}
                      placeholder="آدرس"
                      className="w-full rounded-xl border border-[#263341] bg-[#0d141c] p-3 text-white outline-none focus:border-green-500"
                    />
                  </label>
                )}

                <label className="space-y-2 text-sm text-slate-300">
                  <span>توضیحات</span>
                  <input
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    placeholder="توضیحات اختیاری فاکتور"
                    className="w-full rounded-xl border border-[#263341] bg-[#0d141c] p-3 text-white outline-none focus:border-green-500"
                  />
                </label>
              </div>

              <div className="space-y-3">
                <div className="rounded-xl border border-[#263341] bg-[#0d141c] p-4">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <h4 className="font-bold text-white">جست‌وجو و افزودن کالا</h4>
                    <button
                      type="button"
                      onClick={() => setQuickProductOpen(true)}
                      className="rounded-lg bg-green-500/10 px-3 py-2 text-xs font-bold text-green-400"
                    >
                      ایجاد کالای جدید
                    </button>
                  </div>
                  <input
                    value={productSearch}
                    onChange={(event) => setProductSearch(event.target.value)}
                    placeholder="نام یا کد کالا..."
                    className="mb-3 w-full rounded-lg border border-[#263341] bg-[#111820] p-2.5 text-sm text-white outline-none focus:border-green-500"
                  />
                  <div className="grid max-h-36 grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2">
                    {matchingProducts.map((product) => (
                      <button
                        key={product.id}
                        type="button"
                        onClick={() => addProductToInvoice(product)}
                        className="flex items-center justify-between rounded-lg border border-[#263341] p-2 text-right text-xs text-slate-200 hover:border-green-500/50"
                      >
                        <span>{product.name}</span>
                        <span className="text-slate-500">{formatQuantity(product.stock)} {product.unit}</span>
                      </button>
                    ))}
                    {matchingProducts.length === 0 && (
                      <p className="text-xs text-slate-500">کالایی پیدا نشد؛ از «ایجاد کالای جدید» استفاده کنید.</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <h4 className="font-bold text-white">اقلام فاکتور</h4>
                  <button type="button" onClick={addItem} className="flex items-center gap-1 rounded-lg bg-green-500/10 px-3 py-2 text-xs font-bold text-green-400 hover:bg-green-500/20">
                    <Plus size={15} />
                    افزودن کالا
                  </button>
                </div>

                {items.map((item, index) => {
                  const product = selectedProduct(item.productId);
                  const lineTotal = lineAmount(item.quantity, item.unitPrice, currencyUnit);

                  return (
                    <div key={index} className="grid gap-3 rounded-xl border border-[#263341] bg-[#0d141c] p-3 sm:grid-cols-[2fr_1fr_1fr_1fr_auto] sm:items-end">
                      <label className="space-y-2 text-xs text-slate-400">
                        <span>کالا</span>
                        <select
                          required
                          value={item.productId}
                          onChange={(event) => {
                            const selected = selectedProduct(event.target.value);
                            updateItem(index, "productId", event.target.value);
                            if (selected) {
                              updateItem(
                                index,
                                "unitPrice",
                                type === "PURCHASE"
                                  ? rialAmountToInput(selected.purchasePrice, currencyUnit)
                                  : rialAmountToInput(selected.salePrice, currencyUnit)
                              );
                            }
                          }}
                          className="w-full rounded-lg border border-[#263341] bg-[#111820] p-2.5 text-sm text-white outline-none"
                        >
                          <option value="">انتخاب کالا</option>
                          {products.map((product) => (
                            <option key={product.id} value={product.id}>
                              {product.name} - موجودی: {formatQuantity(product.stock)} {product.unit}
                            </option>
                          ))}
                        </select>
                        {product && (
                          <span className="block text-[11px] text-slate-500">
                            واحد: {product.unit}
                          </span>
                        )}
                      </label>

                      <label className="space-y-2 text-xs text-slate-400">
                        <span>تعداد</span>
                        <NumericInput
                          required
                          min="0.001"
                          step="0.001"
                          value={item.quantity}
                          onChange={(event) => updateItem(index, "quantity", event.target.value)}
                          className="w-full rounded-lg border border-[#263341] bg-[#111820] p-2.5 text-sm text-white outline-none"
                        />
                      </label>

                      <label className="space-y-2 text-xs text-slate-400">
                        <span>قیمت واحد ({currencyUnit === "TOMAN" ? "تومان" : "ریال"})</span>
                        <NumericInput
                          required
                          min="0"
                          step={currencyUnit === "TOMAN" ? "0.1" : "1"}
                          value={item.unitPrice}
                          onChange={(event) => updateItem(index, "unitPrice", event.target.value)}
                          className="w-full rounded-lg border border-[#263341] bg-[#111820] p-2.5 text-sm text-white outline-none"
                        />
                      </label>

                      <div className="space-y-2 text-xs text-slate-400">
                        <span className="block">جمع ردیف</span>
                        <span className="block rounded-lg bg-[#111820] p-2.5 font-semibold text-white">
                          {formatMoney(lineTotal, currencyUnit)}
                        </span>
                      </div>

                      <button
                        type="button"
                        onClick={() => removeItem(index)}
                        disabled={items.length === 1}
                        className="rounded-lg p-2 text-red-400 hover:bg-red-500/10 disabled:opacity-30"
                      >
                        <Trash2 size={17} />
                      </button>
                    </div>
                  );
                })}
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="space-y-2 text-sm text-slate-300">
                  <span>هزینه‌های جانبی ({currencyUnit === "TOMAN" ? "تومان" : "ریال"})</span>
                  <NumericInput
                    min="0"
                    step={currencyUnit === "TOMAN" ? "0.1" : "1"}
                    value={extraCosts}
                    onChange={(event) => setExtraCosts(event.target.value)}
                    className="w-full rounded-xl border border-[#263341] bg-[#0d141c] p-3 text-white outline-none"
                  />
                </label>
                <label className="space-y-2 text-sm text-slate-300">
                  <span>تخفیف ({currencyUnit === "TOMAN" ? "تومان" : "ریال"})</span>
                  <NumericInput
                    min="0"
                    step={currencyUnit === "TOMAN" ? "0.1" : "1"}
                    value={discount}
                    onChange={(event) => setDiscount(event.target.value)}
                    className="w-full rounded-xl border border-[#263341] bg-[#0d141c] p-3 text-white outline-none"
                  />
                </label>
              </div>

              <section className="space-y-3 rounded-xl border border-[#263341] bg-[#0d141c] p-4">
                <div className="flex items-center justify-between">
                  <h4 className="font-bold text-white">روش‌های پرداخت</h4>
                  <span className="text-xs text-slate-400">
                    جمع پرداخت: {formatMoney(payments.reduce(
                      (sum, payment) => sum + (parseCurrencyAmount(payment.amount, currencyUnit) ?? 0n),
                      0n,
                    ), currencyUnit)}
                  </span>
                </div>
                {payments.map((payment, index) => (
                  <details key={payment.method} open={(parseCurrencyAmount(payment.amount, currencyUnit) ?? 0n) > 0n} className="rounded-lg border border-[#263341] p-3">
                    <summary className="flex cursor-pointer list-none items-center justify-between text-sm text-slate-200">
                      <span>{paymentMethodLabels[payment.method]}</span>
                      <span>{formatMoney(parseCurrencyAmount(payment.amount, currencyUnit) ?? 0n, currencyUnit)}</span>
                    </summary>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <label className="space-y-1 text-xs text-slate-400">
                        مبلغ ({currencyUnit === "TOMAN" ? "تومان" : "ریال"})
                        <NumericInput min="0" step={currencyUnit === "TOMAN" ? "0.1" : "1"} value={payment.amount}
                          onFocus={(event) => event.currentTarget.select()}
                          onChange={(event) => setPayments((current) => current.map((entry, i) => i === index ? { ...entry, amount: event.target.value } : entry))}
                          className="w-full rounded-lg border border-[#263341] bg-[#111820] p-2.5 text-sm text-white"
                        />
                      </label>
                      {payment.method === "CHECK" && <>
                        <input placeholder="شماره چک" value={payment.checkNumber} onChange={(event) => setPayments((current) => current.map((entry, i) => i === index ? { ...entry, checkNumber: event.target.value } : entry))} className="rounded-lg border border-[#263341] bg-[#111820] p-2.5 text-sm text-white" />
                        <input type="date" aria-label="تاریخ صدور چک" value={payment.checkIssuedAt} onChange={(event) => setPayments((current) => current.map((entry, i) => i === index ? { ...entry, checkIssuedAt: event.target.value } : entry))} className="rounded-lg border border-[#263341] bg-[#111820] p-2.5 text-sm text-white" />
                        <input type="date" aria-label="تاریخ سررسید چک" value={payment.checkDueAt} onChange={(event) => setPayments((current) => current.map((entry, i) => i === index ? { ...entry, checkDueAt: event.target.value } : entry))} className="rounded-lg border border-[#263341] bg-[#111820] p-2.5 text-sm text-white" />
                        <input placeholder="در وجه" value={payment.payableTo} onChange={(event) => setPayments((current) => current.map((entry, i) => i === index ? { ...entry, payableTo: event.target.value } : entry))} className="rounded-lg border border-[#263341] bg-[#111820] p-2.5 text-sm text-white" />
                      </>}
                      {(payment.method === "CARD_TO_CARD" || payment.method === "POS") && (
                        <input
                          placeholder={payment.method === "POS" ? "مشخصات دستگاه و حساب متصل" : "حساب یا کارت مقصد"}
                          value={payment.destinationDetails}
                          onChange={(event) => setPayments((current) => current.map((entry, i) => i === index ? { ...entry, destinationDetails: event.target.value } : entry))}
                          className="rounded-lg border border-[#263341] bg-[#111820] p-2.5 text-sm text-white"
                        />
                      )}
                      <input
                        placeholder="توضیحات"
                        value={payment.description}
                        onChange={(event) => setPayments((current) => current.map((entry, i) => i === index ? { ...entry, description: event.target.value } : entry))}
                        className="rounded-lg border border-[#263341] bg-[#111820] p-2.5 text-sm text-white"
                      />
                    </div>
                  </details>
                ))}
                <p className="text-xs text-amber-300">
                  {editingInvoice?.status === "ISSUED"
                    ? "تخصیص جدید جایگزین سابقه تخصیص قبلی می‌شود؛ پرداخت‌های مستقلِ ثبت‌شده پس از صدور قابل جایگزینی نیستند."
                    : "مجموع روش‌های پرداخت باید دقیقاً برابر مبلغ نهایی فاکتور باشد؛ مانده به‌صورت خودکار حساب دفتری نمی‌شود."}
                </p>
              </section>

              <div className="rounded-xl border border-green-500/20 bg-green-500/5 p-4">
                <div className="flex items-center justify-between text-sm text-slate-400">
                  <span>جمع کالاها</span>
                  <span>{formatMoney(subtotal, currencyUnit)}</span>
                </div>
                <div className="mt-2 flex items-center justify-between text-sm text-slate-400">
                  <span>هزینه جانبی</span>
                  <span>{formatMoney(parseCurrencyAmount(extraCosts, currencyUnit) ?? 0n, currencyUnit)}</span>
                </div>
                <div className="mt-2 flex items-center justify-between text-sm text-slate-400">
                  <span>تخفیف</span>
                  <span>{formatMoney(parseCurrencyAmount(discount, currencyUnit) ?? 0n, currencyUnit)}</span>
                </div>
                <div className="mt-4 flex items-center justify-between border-t border-green-500/20 pt-4">
                  <span className="font-bold text-white">مبلغ نهایی</span>
                  <span className="text-xl font-black text-green-400">
                    {formatMoney(finalTotal, currencyUnit)}
                  </span>
                </div>
              </div>

              <p className="text-xs leading-6 text-amber-400/80">
                {type === "PURCHASE"
                  ? "ثبت فاکتور خرید پس از اعتبارسنجی، موجودی و پرداخت‌ها را در همان عملیات نهایی می‌کند."
                  : issueImmediately
                    ? "صدور مستقیم فاکتور فروش، موجودی و پرداخت‌ها را هنگام ثبت نهایی می‌کند."
                    : "ذخیره این فرم فقط پیش‌نویس ایجاد می‌کند و موجودی انبار را تغییر نمی‌دهد. تغییر موجودی فقط پس از صدور قطعی فاکتور انجام می‌شود."}
              </p>
              {!editingInvoice && type === "SALE" && (
                <label className="flex items-center gap-2 text-sm text-slate-200">
                  <input type="checkbox" checked={issueImmediately} onChange={(event) => setIssueImmediately(event.target.checked)} />
                  صدور مستقیم فاکتور فروش (بدون ایجاد پیش‌فاکتور)
                </label>
              )}
            </div>

            <div className="flex flex-wrap justify-end gap-3 border-t border-[#263341] p-5">
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="rounded-xl border border-[#263341] px-5 py-3 text-sm text-slate-300 hover:bg-white/5"
              >
                انصراف
              </button>
              <button
                type="submit"
                disabled={saving}
                className="flex items-center gap-2 rounded-xl bg-green-500 px-5 py-3 text-sm font-bold text-white hover:bg-green-400 disabled:opacity-50"
              >
                {saving && <Loader2 size={17} className="animate-spin" />}
                {editingInvoice
                  ? "ذخیره تغییرات"
                  : type === "PURCHASE"
                    ? "ثبت و صدور فاکتور خرید"
                    : issueImmediately
                      ? "ثبت و صدور فاکتور فروش"
                      : "ذخیره پیش‌نویس"}
              </button>
            </div>
          </form>
        </div>
      )}

      {quickProductOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4">
          <form onSubmit={createQuickProduct} className="w-full max-w-lg space-y-4 rounded-2xl border border-[#263341] bg-[#111820] p-5">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-white">ایجاد کالا در فاکتور</h3>
              <button type="button" onClick={() => setQuickProductOpen(false)} className="rounded-lg p-2 text-slate-400 hover:bg-white/5"><X size={18} /></button>
            </div>
            <label className="block space-y-2 text-sm text-slate-300">
              نام کالا
              <input required minLength={2} maxLength={150} value={quickProduct.name} onChange={(event) => setQuickProduct((current) => ({ ...current, name: event.target.value }))} className="w-full rounded-lg border border-[#263341] bg-[#0d141c] p-3 text-white" />
            </label>
            <label className="block space-y-2 text-sm text-slate-300">
              واحد شمارش
              <input required value={quickProduct.unit} onChange={(event) => setQuickProduct((current) => ({ ...current, unit: event.target.value }))} className="w-full rounded-lg border border-[#263341] bg-[#0d141c] p-3 text-white" />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-2 text-sm text-slate-300">قیمت خرید ({currencyUnit === "TOMAN" ? "تومان" : "ریال"})
                <NumericInput min="0" step={currencyUnit === "TOMAN" ? "0.1" : "1"} value={quickProduct.purchasePrice} onChange={(event) => setQuickProduct((current) => ({ ...current, purchasePrice: event.target.value }))} className="w-full rounded-lg border border-[#263341] bg-[#0d141c] p-3 text-white" />
              </label>
              <label className="space-y-2 text-sm text-slate-300">قیمت فروش ({currencyUnit === "TOMAN" ? "تومان" : "ریال"})
                <NumericInput min="0" step={currencyUnit === "TOMAN" ? "0.1" : "1"} value={quickProduct.salePrice} onChange={(event) => setQuickProduct((current) => ({ ...current, salePrice: event.target.value }))} className="w-full rounded-lg border border-[#263341] bg-[#0d141c] p-3 text-white" />
              </label>
            </div>
            {error && <p className="text-sm text-red-400">{error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setQuickProductOpen(false)} className="rounded-lg border border-[#263341] px-4 py-2 text-sm text-slate-300">انصراف</button>
              <button disabled={saving} className="rounded-lg bg-green-500 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">ثبت و افزودن به فاکتور</button>
            </div>
          </form>
        </div>
      )}

      {detailInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/70 p-3 backdrop-blur-sm">
          <div className="my-6 w-full max-w-2xl rounded-2xl border border-[#263341] bg-[#111820]">
            <div className="flex items-center justify-between border-b border-[#263341] p-5">
              <div>
                <h3 className="font-bold text-white">جزئیات فاکتور</h3>
                <p className="mt-1 text-xs text-slate-400" dir="ltr">
                  {detailInvoice.invoiceNumber}
                </p>
              </div>
              <div className="flex gap-2">
                {detailInvoice.status === "ISSUED" &&
                  detailInvoice.items.some((item) =>
                    item.id ? remainingReturnQuantity(detailInvoice, item.id) > 0n : false
                  ) && (
                  <button
                    type="button"
                    onClick={() => {
                      setError("");
                      setReturnQuantities({});
                      setReturnRefundAmount("0");
                      setReturnRefundCheck({ number: "", issuedAt: "", dueAt: "", payableTo: "" });
                      setReturnRefundDestination("");
                      setReturnDescription("");
                      setReturnModalOpen(true);
                    }}
                    className="flex items-center gap-2 rounded-lg border border-amber-500/30 px-3 py-2 text-sm text-amber-300 hover:bg-amber-500/10"
                  >
                    <RotateCcw size={16} />
                    ثبت مرجوعی
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="rounded-lg p-2 text-slate-300 hover:bg-white/5"
                  title="چاپ فاکتور"
                >
                  <Printer size={19} />
                </button>
                <button onClick={() => setDetailInvoice(null)} className="rounded-lg p-2 text-slate-400 hover:bg-white/5">
                  <X size={20} />
                </button>
              </div>
            </div>

            <div className="space-y-4 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className={`rounded-lg px-3 py-1.5 text-xs ${statusClass(detailInvoice.status)}`}>
                  {statusLabel(detailInvoice.status)}
                </span>
                <span className="text-sm text-slate-400">
                  {detailInvoice.contact?.name ?? detailInvoice.contactNameSnapshot ?? "بدون طرف حساب"}
                </span>
                <span className="text-xs text-slate-500">
                  تاریخ فاکتور: {formatInvoiceDate(detailInvoice.invoiceDate ?? detailInvoice.issuedAt ?? detailInvoice.createdAt)}
                </span>
              </div>
              {(detailInvoice.contactPhoneSnapshot || detailInvoice.contactAddressSnapshot) && (
                <div className="text-xs text-slate-400">
                  {detailInvoice.contactPhoneSnapshot && <p>تلفن: {detailInvoice.contactPhoneSnapshot}</p>}
                  {detailInvoice.contactAddressSnapshot && <p>آدرس: {detailInvoice.contactAddressSnapshot}</p>}
                </div>
              )}
              {detailInvoice.payments && detailInvoice.payments.length > 0 && (
                <section className="rounded-xl border border-[#263341] p-4">
                  <h4 className="mb-3 font-bold text-white">روش‌های پرداخت</h4>
                  {detailInvoice.payments.map((payment, index) => (
                    <div key={`${payment.method}-${index}`} className="border-t border-[#263341] py-2 text-sm text-slate-300">
                      {paymentMethodLabels[payment.method as PaymentForm["method"]] ?? payment.method} — {formatMoney(payment.amount, currencyUnit)}
                      {payment.description && <p className="mt-1 text-xs text-slate-500">{payment.description}</p>}
                      {getPaymentDetails(payment).map((detail) => (
                        <p key={detail} className="mt-1 text-xs text-slate-500">{detail}</p>
                      ))}
                    </div>
                  ))}
                </section>
              )}

              <div className="overflow-x-auto rounded-xl border border-[#263341]">
                <table className="w-full min-w-[420px] text-sm">
                  <thead className="bg-[#0d141c] text-xs text-slate-500">
                    <tr>
                      <th className="p-3 text-right">کالا</th>
                      <th className="p-3 text-right">تعداد</th>
                      <th className="p-3 text-right">مبلغ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detailInvoice.items.map((item, index) => (
                      <tr key={item.id ?? index} className="border-t border-[#263341]">
                        <td className="p-3 text-white">{item.product?.name ?? "کالا"}</td>
                        <td className="p-3 text-slate-300">{formatQuantity(item.quantity)}</td>
                        <td className="p-3 text-slate-300">
                          {formatMoney(item.total ?? "0", currencyUnit)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="space-y-2 rounded-xl bg-[#0d141c] p-4 text-sm">
                <div className="flex justify-between text-slate-400">
                  <span>جمع کالاها</span>
                  <span>{formatMoney(detailInvoice.subtotal, currencyUnit)}</span>
                </div>
                <div className="flex justify-between text-slate-400">
                  <span>هزینه جانبی</span>
                  <span>{formatMoney(detailInvoice.extraCosts, currencyUnit)}</span>
                </div>
                <div className="flex justify-between text-slate-400">
                  <span>تخفیف</span>
                  <span>{formatMoney(detailInvoice.discount, currencyUnit)}</span>
                </div>
                {detailInvoice.type === "SALE" && detailInvoice.status === "ISSUED" && (
                  <>
                    <div className="flex justify-between text-slate-400">
                      <span>بهای تمام‌شده کالاهای فروخته‌شده</span>
                      <span>{formatMoney(detailCostOfGoodsSold, currencyUnit)}</span>
                    </div>
                    <div className="flex justify-between border-t border-[#263341] pt-3 font-bold">
                      <span className="text-slate-300">سود ناخالص</span>
                      <span className={detailGrossProfit >= 0n ? "text-green-400" : "text-red-400"}>
                        {formatMoney(detailGrossProfit, currencyUnit)}
                      </span>
                    </div>
                  </>
                )}
                <div className="flex justify-between border-t border-[#263341] pt-3 font-bold text-white">
                  <span>مبلغ نهایی</span>
                  <span className="text-green-400">{formatMoney(detailInvoice.total, currencyUnit)}</span>
                </div>
              </div>

              {detailInvoice.description && (
                <p className="text-sm text-slate-400">
                  توضیحات: {detailInvoice.description}
                </p>
              )}
              {((detailInvoice.type === "PURCHASE" ? detailInvoice.purchaseReturns : detailInvoice.salesReturns)?.length ?? 0) > 0 && (
                <section className="rounded-xl border border-[#263341] p-4">
                  <h4 className="mb-3 font-bold text-white">
                    سوابق مرجوعی {detailInvoice.type === "SALE" ? "فروش" : "خرید"}
                  </h4>
                  {(detailInvoice.type === "PURCHASE" ? detailInvoice.purchaseReturns : detailInvoice.salesReturns)?.map((invoiceReturn) => (
                    <div key={invoiceReturn.id} className="border-t border-[#263341] py-3 text-sm">
                      <div className="flex flex-wrap justify-between gap-2 text-slate-300">
                        <span dir="ltr">{invoiceReturn.returnNumber}</span>
                        <span>{formatInvoiceDate(invoiceReturn.createdAt)}</span>
                        <strong>{formatMoney(invoiceReturn.total, currencyUnit)}</strong>
                      </div>
                      {invoiceReturn.items.map((item) => (
                        <p key={item.id} className="mt-1 text-xs text-slate-500">
                          {item.product.name}: {formatQuantity(item.quantity)} {item.product.unit}
                        </p>
                      ))}
                      {invoiceReturn.payments.map((payment, index) => (
                        <div key={`${invoiceReturn.id}-${index}`} className="mt-1 text-xs text-green-400">
                          <p>
                            {detailInvoice.type === "SALE" ? "بازپرداخت به مشتری" : "بازپرداخت"}
                            {" "}{paymentMethodLabels[payment.method as PaymentForm["method"]] ?? payment.method}: {formatMoney(payment.amount, currencyUnit)}
                          </p>
                          {getPaymentDetails(payment).map((detail) => (
                            <p key={detail} className="mt-1 text-slate-400">{detail}</p>
                          ))}
                        </div>
                      ))}
                      {invoiceReturn.description && <p className="mt-1 text-xs text-slate-500">{invoiceReturn.description}</p>}
                    </div>
                  ))}
                </section>
              )}
              {(detailInvoice.revisions?.length ?? 0) > 0 && (
                <section className="rounded-xl border border-[#263341] p-4">
                  <h4 className="mb-3 font-bold text-white">سوابق ویرایش</h4>
                  {detailInvoice.revisions?.map((revision) => (
                    <div key={revision.id} className="border-t border-[#263341] py-3 text-xs text-slate-400">
                      <p>{formatInvoiceDate(revision.createdAt)}</p>
                      {revision.before.total !== revision.after.total && (
                        <p className="mt-1">
                          مبلغ: {revision.before.total ? formatMoney(revision.before.total, currencyUnit) : "—"}
                          {" ← "}
                          {revision.after.total ? formatMoney(revision.after.total, currencyUnit) : "—"}
                        </p>
                      )}
                      {revision.before.invoiceDate !== revision.after.invoiceDate && (
                        <p className="mt-1">
                          تاریخ فاکتور: {revision.before.invoiceDate ? formatInvoiceDate(revision.before.invoiceDate) : "—"}
                          {" ← "}
                          {revision.after.invoiceDate ? formatInvoiceDate(revision.after.invoiceDate) : "—"}
                        </p>
                      )}
                      {revision.before.description !== revision.after.description && (
                        <p className="mt-1">توضیحات فاکتور تغییر کرده است.</p>
                      )}
                      {JSON.stringify(revision.before.items) !== JSON.stringify(revision.after.items) && (
                        <p className="mt-1">اقلام، تعداد یا قیمت فاکتور تغییر کرده است.</p>
                      )}
                    </div>
                  ))}
                </section>
              )}
            </div>
            <section className="print-only" dir="rtl">
              <header className="print-invoice-header">
                <div>
                  <h1>{detailInvoice.type === "SALE" ? "فاکتور فروش" : "فاکتور خرید"}</h1>
                  <strong>{detailInvoice.business?.name ?? "Hirad Accounting"}</strong>
                  {detailInvoice.business?.phone && <p>تلفن: {detailInvoice.business.phone}</p>}
                </div>
                <div className="print-invoice-meta">
                  <p>شماره: {detailInvoice.invoiceNumber}</p>
                  <p>تاریخ: {formatInvoiceDate(detailInvoice.invoiceDate ?? detailInvoice.issuedAt ?? detailInvoice.createdAt)}</p>
                  <p>{detailInvoice.type === "SALE" ? "خریدار" : "فروشنده"}: {detailInvoice.contact?.name ?? detailInvoice.contactNameSnapshot ?? "—"}</p>
                  {(detailInvoice.contact?.phone ?? detailInvoice.contactPhoneSnapshot) && <p>تلفن: {detailInvoice.contact?.phone ?? detailInvoice.contactPhoneSnapshot}</p>}
                  {(detailInvoice.contact?.address ?? detailInvoice.contactAddressSnapshot) && <p>آدرس: {detailInvoice.contact?.address ?? detailInvoice.contactAddressSnapshot}</p>}
                </div>
              </header>
              <table className="print-invoice-table">
                <thead>
                  <tr>
                    <th>ردیف</th><th>نام کالا</th><th>تعداد</th><th>واحد</th>
                    <th>قیمت واحد</th><th>مبلغ</th>
                  </tr>
                </thead>
                <tbody>
                  {detailInvoice.items.map((item, index) => (
                    <tr key={item.id ?? index}>
                      <td>{moneyFormat.format(index + 1)}</td>
                      <td>{item.product?.name ?? "کالا"}</td>
                      <td>{formatQuantity(item.quantity)}</td>
                      <td>{item.product?.unit ?? "—"}</td>
                      <td>{formatMoney(item.unitPrice, currencyUnit)}</td>
                      <td>{formatMoney(item.total ?? "0", currencyUnit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="print-invoice-totals">
                <p>جمع کالاها: {formatMoney(detailInvoice.subtotal, currencyUnit)}</p>
                <p>هزینه جانبی: {formatMoney(detailInvoice.extraCosts, currencyUnit)}</p>
                <p>تخفیف: {formatMoney(detailInvoice.discount, currencyUnit)}</p>
                <strong>مبلغ نهایی: {formatMoney(detailInvoice.total, currencyUnit)}</strong>
              </div>
              {detailInvoice.payments && detailInvoice.payments.length > 0 && (
                <div className="print-invoice-payments">
                  <h2>اطلاعات پرداخت</h2>
                  {detailInvoice.payments.map((payment, index) => (
                    <div key={`${payment.method}-${index}`}>
                      <p>
                        {paymentMethodLabels[payment.method as PaymentForm["method"]] ?? payment.method}: {formatMoney(payment.amount, currencyUnit)}
                        {payment.description ? ` — ${payment.description}` : ""}
                      </p>
                      {getPaymentDetails(payment).map((detail) => <p key={detail}>{detail}</p>)}
                    </div>
                  ))}
                </div>
              )}
              {detailInvoice.description && <p>توضیحات: {detailInvoice.description}</p>}
              <footer className="print-invoice-signatures">
                <span>امضای {detailInvoice.type === "SALE" ? "خریدار" : "فروشنده"}</span>
                <span>امضای {detailInvoice.type === "SALE" ? "فروشنده" : "خریدار"}</span>
              </footer>
            </section>

              {returnModalOpen && detailInvoice?.status === "ISSUED" && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto bg-black/80 p-3 backdrop-blur-sm">
                  <form onSubmit={submitInvoiceReturn} className="my-6 w-full max-w-2xl rounded-2xl border border-[#263341] bg-[#111820]">
                    <div className="flex items-center justify-between border-b border-[#263341] p-5">
                      <div>
                        <h3 className="font-bold text-white">ثبت مرجوعی {detailInvoice.type === "SALE" ? "فروش" : "خرید"}</h3>
                        <p className="mt-1 text-xs text-slate-400" dir="ltr">{detailInvoice.invoiceNumber}</p>
                      </div>
                      <button type="button" onClick={() => setReturnModalOpen(false)} className="rounded-lg p-2 text-slate-400 hover:bg-white/5">
                        <X size={20} />
                      </button>
                    </div>
                    <div className="max-h-[70vh] space-y-4 overflow-y-auto p-5">
                      {detailInvoice.items.map((item) => {
                        const available = item.id ? remainingReturnQuantity(detailInvoice, item.id) : 0n;
                        if (available <= 0n) return null;
                        return (
                          <label key={item.id} className="grid grid-cols-[1fr_120px] items-center gap-3 rounded-lg border border-[#263341] p-3 text-sm">
                            <span className="text-slate-300">
                              {item.product?.name ?? "کالا"}
                              <span className="mt-1 block text-xs text-slate-500">
                                باقی‌مانده: {formatQuantityUnits(available)} {item.product?.unit}
                              </span>
                            </span>
                            <NumericInput
                              min="0"
                              max={formatQuantityUnits(available)}
                              step="0.001"
                              value={returnQuantities[item.id ?? ""] ?? "0"}
                              onChange={(event) => item.id && setReturnQuantities((current) => ({ ...current, [item.id!]: event.target.value }))}
                              className="w-full rounded-lg border border-[#263341] bg-[#0d141c] p-2 text-white"
                            />
                          </label>
                        );
                      })}
                      <label className="block space-y-2 text-sm text-slate-300">
                        مبلغ بازپرداخت‌شده اکنون ({currencyUnit === "TOMAN" ? "تومان" : "ریال"})
                        <NumericInput
                          min="0"
                          step={currencyUnit === "TOMAN" ? "0.1" : "1"}
                          value={returnRefundAmount}
                          onChange={(event) => setReturnRefundAmount(event.target.value)}
                          className="w-full rounded-lg border border-[#263341] bg-[#0d141c] p-3 text-white"
                        />
                      </label>
                      {parseCurrencyAmount(returnRefundAmount, currencyUnit) !== 0n && (
                        <label className="block space-y-2 text-sm text-slate-300">
                          روش بازپرداخت
                          <select value={returnRefundMethod} onChange={(event) => setReturnRefundMethod(event.target.value as typeof returnRefundMethod)} className="w-full rounded-lg border border-[#263341] bg-[#0d141c] p-3 text-white">
                            <option value="CASH">نقدی</option>
                            <option value="CHECK">چک</option>
                            <option value="CARD_TO_CARD">کارت‌به‌کارت</option>
                            <option value="POS">کارت‌خوان</option>
                          </select>
                        </label>
                      )}
                      {parseCurrencyAmount(returnRefundAmount, currencyUnit) !== 0n &&
                        returnRefundMethod === "CHECK" && (
                          <div className="grid gap-3 sm:grid-cols-2">
                            <input
                              required
                              maxLength={100}
                              placeholder="شماره چک"
                              value={returnRefundCheck.number}
                              onChange={(event) => setReturnRefundCheck((current) => ({ ...current, number: event.target.value }))}
                              className="rounded-lg border border-[#263341] bg-[#0d141c] p-3 text-white"
                            />
                            <input
                              required
                              type="date"
                              aria-label="تاریخ صدور چک بازپرداخت"
                              value={returnRefundCheck.issuedAt}
                              onChange={(event) => setReturnRefundCheck((current) => ({ ...current, issuedAt: event.target.value }))}
                              className="rounded-lg border border-[#263341] bg-[#0d141c] p-3 text-white"
                            />
                            <input
                              required
                              type="date"
                              aria-label="تاریخ سررسید چک بازپرداخت"
                              min={returnRefundCheck.issuedAt || undefined}
                              value={returnRefundCheck.dueAt}
                              onChange={(event) => setReturnRefundCheck((current) => ({ ...current, dueAt: event.target.value }))}
                              className="rounded-lg border border-[#263341] bg-[#0d141c] p-3 text-white"
                            />
                            <input
                              required
                              maxLength={150}
                              placeholder="در وجه"
                              value={returnRefundCheck.payableTo}
                              onChange={(event) => setReturnRefundCheck((current) => ({ ...current, payableTo: event.target.value }))}
                              className="rounded-lg border border-[#263341] bg-[#0d141c] p-3 text-white"
                            />
                          </div>
                        )}
                      {parseCurrencyAmount(returnRefundAmount, currencyUnit) !== 0n &&
                        (returnRefundMethod === "CARD_TO_CARD" || returnRefundMethod === "POS") && (
                          <label className="block space-y-2 text-sm text-slate-300">
                            حساب یا کارت مقصد
                            <input
                              maxLength={250}
                              value={returnRefundDestination}
                              onChange={(event) => setReturnRefundDestination(event.target.value)}
                              className="w-full rounded-lg border border-[#263341] bg-[#0d141c] p-3 text-white"
                            />
                          </label>
                        )}
                      <label className="block space-y-2 text-sm text-slate-300">
                        توضیحات
                        <textarea value={returnDescription} onChange={(event) => setReturnDescription(event.target.value)} maxLength={1000} rows={2} className="w-full rounded-lg border border-[#263341] bg-[#0d141c] p-3 text-white" />
                      </label>
                      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
                      <div className="flex justify-end gap-2">
                        <button type="button" onClick={() => setReturnModalOpen(false)} className="rounded-lg border border-[#263341] px-4 py-2 text-sm text-slate-300">انصراف</button>
                        <button disabled={saving} className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-bold text-slate-950 disabled:opacity-50">
                          {saving ? <Loader2 className="animate-spin" size={18} /> : "ثبت مرجوعی"}
                        </button>
                      </div>
                    </div>
                  </form>
                </div>
              )}
          </div>
        </div>
      )}
    </div>
  );
}
