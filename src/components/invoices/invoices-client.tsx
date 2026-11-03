
"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  Plus, Search, RefreshCw, FileText, ShoppingCart, TrendingUp,
  X, Trash2, Pencil, Eye, CheckCircle2, Ban, Loader2,
  Package, Calculator, ChevronDown,
} from "lucide-react";

type CurrencyUnit = "RIAL" | "TOMAN";
type InvoiceType = "PURCHASE" | "SALE";
type InvoiceStatus = "DRAFT" | "ISSUED" | "CANCELLED";

type Props = {
  currencyUnit: CurrencyUnit;
  initialType: InvoiceType;
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
  id?: string;
  productId: string;
  quantity: string;
  unitPrice: string;
  total?: string;
  product?: { name: string; unit: string };
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
  createdAt: string;
  contact: { id: string; name: string } | null;
  items: InvoiceItem[];
};

type FormItem = {
  productId: string;
  quantity: string;
  unitPrice: string;
};

const emptyItem = (): FormItem => ({
  productId: "",
  quantity: "1",
  unitPrice: "0",
});

const moneyFormat = new Intl.NumberFormat("fa-IR");
const quantityFormat = new Intl.NumberFormat("fa-IR", {
  maximumFractionDigits: 3,
});

function formatMoney(value: string | number, unit: CurrencyUnit) {
  const amount = BigInt(String(value || "0"));
  const displayed = unit === "TOMAN" ? amount / 10n : amount;
  return `${moneyFormat.format(displayed)} ${unit === "TOMAN" ? "تومان" : "ریال"}`;
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

export default function InvoicesClient({ currencyUnit, initialType }: Props) { 
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
  const [editingInvoice, setEditingInvoice] = useState<Invoice | null>(null);

  const [contactId, setContactId] = useState("");
  const [description, setDescription] = useState("");
  const [extraCosts, setExtraCosts] = useState("0");
  const [discount, setDiscount] = useState("0");
  const [items, setItems] = useState<FormItem[]>([emptyItem()]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const params = new URLSearchParams({
        type,
        status: statusFilter,
        search: search.trim(),
      });

      const [invoiceResponse, productResponse, contactResponse] =
        await Promise.all([
          fetch(`/api/invoices?${params}`, { cache: "no-store" }),
          fetch("/api/products", { cache: "no-store" }),
          fetch(
            `/api/contacts?type=${type === "PURCHASE" ? "SUPPLIER" : "CUSTOMER"}`,
            { cache: "no-store" }
          ),
        ]);

      const [invoiceData, productData, contactData] = await Promise.all([
        readResponse(invoiceResponse),
        readResponse(productResponse),
        readResponse(contactResponse),
      ]);

      setInvoices(invoiceData.invoices ?? []);
      setProducts(productData.products ?? []);
      setContacts(contactData.contacts ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "خطا در دریافت اطلاعات.");
    } finally {
      setLoading(false);
    }
  }, [type, statusFilter, search]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const resetForm = () => {
    setContactId("");
    setDescription("");
    setExtraCosts("0");
    setDiscount("0");
    setItems([emptyItem()]);
    setEditingInvoice(null);
  };

  const openNewInvoice = () => {
    resetForm();
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

      setEditingInvoice(fullInvoice);
      setContactId(fullInvoice.contact?.id ?? "");
      setDescription(fullInvoice.description ?? "");
      setExtraCosts(
        currencyUnit === "TOMAN"
          ? (BigInt(fullInvoice.extraCosts) / 10n).toString()
          : fullInvoice.extraCosts
      );
      setDiscount(
        currencyUnit === "TOMAN"
          ? (BigInt(fullInvoice.discount) / 10n).toString()
          : fullInvoice.discount
      );
      setItems(
        fullInvoice.items.map((item) => ({
          productId: item.productId,
          quantity: item.quantity,
          unitPrice:
            currencyUnit === "TOMAN"
              ? (BigInt(item.unitPrice) / 10n).toString()
              : item.unitPrice,
        }))
      );
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

  const subtotal = useMemo(() => {
    return items.reduce((sum, item) => {
      const quantity = Number(item.quantity);
      const price = Number(item.unitPrice);
      if (!Number.isFinite(quantity) || !Number.isFinite(price)) return sum;
      return sum + Math.round(quantity * price);
    }, 0);
  }, [items]);

  const finalTotal = Math.max(
    0,
    subtotal + (Number(extraCosts) || 0) - (Number(discount) || 0)
  );

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

    try {
      const validItems = items.filter(
        (item) =>
          item.productId &&
          Number(item.quantity) > 0 &&
          Number(item.unitPrice) >= 0
      );

      if (validItems.length === 0) {
        throw new Error("حداقل یک کالای معتبر به فاکتور اضافه کنید.");
      }

      const payload = {
        type,
        contactId: contactId || null,
        description: description.trim() || null,
        extraCosts: extraCosts || "0",
        discount: discount || "0",
        items: validItems,
      };

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

      await readResponse(response);
      setSuccess(editingInvoice ? "پیش‌نویس ویرایش شد." : "فاکتور ثبت شد.");
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
    if (!window.confirm(`فاکتور ${invoice.invoiceNumber} صادر شود؟`)) return;

    setSaving(true);
    setError("");

    try {
      const response = await fetch(
        `/api/invoices/${invoice.id}/issue`,
        { method: "POST" }
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
      const response = await fetch(`/api/invoices/${invoice.id}`, {
        cache: "no-store",
      });
      const data = await readResponse(response);
      setDetailInvoice(data.invoice);
    } catch (err) {
      setError(err instanceof Error ? err.message : "خطا در دریافت جزئیات.");
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
            onChange={(event) => setSearch(event.target.value)}
            placeholder="جست‌وجوی شماره فاکتور..."
            className="w-full rounded-xl border border-[#263341] bg-[#111820] py-3 pr-10 pl-4 text-sm text-white outline-none focus:border-green-500"
          />
        </div>

        <select
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value)}
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

      <div className="overflow-hidden rounded-2xl border border-[#263341] bg-[#111820]">
        <div className="flex items-center justify-between border-b border-[#263341] px-5 py-4">
          <h3 className="font-bold text-white">
            {type === "PURCHASE" ? "فاکتورهای خرید" : "فاکتورهای فروش"}
          </h3>
          <span className="text-xs text-slate-500">
            {moneyFormat.format(invoices.length)} فاکتور
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
                      {invoice.contact?.name ?? "بدون طرف حساب"}
                    </td>
                    <td className="px-5 py-4 text-slate-400">
                      {new Intl.DateTimeFormat("fa-IR").format(new Date(invoice.createdAt))}
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
                            <button
                              title="حذف"
                              disabled={saving}
                              onClick={() => void deleteInvoice(invoice)}
                              className="rounded-lg p-2 text-red-400 hover:bg-red-500/10"
                            >
                              <Trash2 size={17} />
                            </button>
                          </>
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
                  {editingInvoice ? "ویرایش پیش‌نویس" : "ثبت فاکتور جدید"}
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
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="space-y-2 text-sm text-slate-300">
                  <span>{type === "PURCHASE" ? "تأمین‌کننده" : "مشتری"}</span>
                  <select
                    value={contactId}
                    onChange={(event) => setContactId(event.target.value)}
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
                <div className="flex items-center justify-between">
                  <h4 className="font-bold text-white">اقلام فاکتور</h4>
                  <button type="button" onClick={addItem} className="flex items-center gap-1 rounded-lg bg-green-500/10 px-3 py-2 text-xs font-bold text-green-400 hover:bg-green-500/20">
                    <Plus size={15} />
                    افزودن کالا
                  </button>
                </div>

                {items.map((item, index) => {
                  const product = selectedProduct(item.productId);
                  const lineTotal = Math.round(
                    (Number(item.quantity) || 0) * (Number(item.unitPrice) || 0)
                  );

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
                                  ? (currencyUnit === "TOMAN"
                                      ? (BigInt(selected.purchasePrice) / 10n).toString()
                                      : selected.purchasePrice)
                                  : (currencyUnit === "TOMAN"
                                      ? (BigInt(selected.salePrice) / 10n).toString()
                                      : selected.salePrice)
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
                        <input
                          required
                          min="0.001"
                          step="0.001"
                          type="number"
                          value={item.quantity}
                          onChange={(event) => updateItem(index, "quantity", event.target.value)}
                          className="w-full rounded-lg border border-[#263341] bg-[#111820] p-2.5 text-sm text-white outline-none"
                        />
                      </label>

                      <label className="space-y-2 text-xs text-slate-400">
                        <span>قیمت واحد ({currencyUnit === "TOMAN" ? "تومان" : "ریال"})</span>
                        <input
                          required
                          min="0"
                          step="1"
                          type="number"
                          value={item.unitPrice}
                          onChange={(event) => updateItem(index, "unitPrice", event.target.value)}
                          className="w-full rounded-lg border border-[#263341] bg-[#111820] p-2.5 text-sm text-white outline-none"
                        />
                      </label>

                      <div className="space-y-2 text-xs text-slate-400">
                        <span className="block">جمع ردیف</span>
                        <span className="block rounded-lg bg-[#111820] p-2.5 font-semibold text-white">
                          {moneyFormat.format(lineTotal)}
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
                  <input
                    type="number"
                    min="0"
                    value={extraCosts}
                    onChange={(event) => setExtraCosts(event.target.value)}
                    className="w-full rounded-xl border border-[#263341] bg-[#0d141c] p-3 text-white outline-none"
                  />
                </label>
                <label className="space-y-2 text-sm text-slate-300">
                  <span>تخفیف ({currencyUnit === "TOMAN" ? "تومان" : "ریال"})</span>
                  <input
                    type="number"
                    min="0"
                    value={discount}
                    onChange={(event) => setDiscount(event.target.value)}
                    className="w-full rounded-xl border border-[#263341] bg-[#0d141c] p-3 text-white outline-none"
                  />
                </label>
              </div>

              <div className="rounded-xl border border-green-500/20 bg-green-500/5 p-4">
                <div className="flex items-center justify-between text-sm text-slate-400">
                  <span>جمع کالاها</span>
                  <span>{moneyFormat.format(subtotal)} {currencyUnit === "TOMAN" ? "تومان" : "ریال"}</span>
                </div>
                <div className="mt-2 flex items-center justify-between text-sm text-slate-400">
                  <span>هزینه جانبی</span>
                  <span>{moneyFormat.format(Number(extraCosts) || 0)}</span>
                </div>
                <div className="mt-2 flex items-center justify-between text-sm text-slate-400">
                  <span>تخفیف</span>
                  <span>{moneyFormat.format(Number(discount) || 0)}</span>
                </div>
                <div className="mt-4 flex items-center justify-between border-t border-green-500/20 pt-4">
                  <span className="font-bold text-white">مبلغ نهایی</span>
                  <span className="text-xl font-black text-green-400">
                    {moneyFormat.format(finalTotal)} {currencyUnit === "TOMAN" ? "تومان" : "ریال"}
                  </span>
                </div>
              </div>

              <p className="text-xs leading-6 text-amber-400/80">
                ذخیره این فرم فقط پیش‌نویس ایجاد می‌کند و موجودی انبار را تغییر نمی‌دهد.
                تغییر موجودی فقط پس از صدور قطعی فاکتور انجام می‌شود.
              </p>
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
                {editingInvoice ? "ذخیره تغییرات" : "ذخیره پیش‌نویس"}
              </button>
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
              <button onClick={() => setDetailInvoice(null)} className="rounded-lg p-2 text-slate-400 hover:bg-white/5">
                <X size={20} />
              </button>
            </div>

            <div className="space-y-4 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className={`rounded-lg px-3 py-1.5 text-xs ${statusClass(detailInvoice.status)}`}>
                  {statusLabel(detailInvoice.status)}
                </span>
                <span className="text-sm text-slate-400">
                  {detailInvoice.contact?.name ?? "بدون طرف حساب"}
                </span>
              </div>

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
                {detailInvoice.type === "SALE" &&
  detailInvoice.status === "ISSUED" && (
    <>
      <div className="flex justify-between text-slate-400">
        <span>بهای تمام‌شده کالاهای فروخته‌شده</span>
        <span>
          {formatMoney(
            detailCostOfGoodsSold.toString(),
            currencyUnit
          )}
        </span>
      </div>

      <div className="flex justify-between border-t border-[#263341] pt-3 font-bold">
        <span className="text-slate-300">سود ناخالص</span>
        <span
          className={
            detailGrossProfit >= 0n
              ? "text-green-400"
              : "text-red-400"
          }
        >
          {formatMoney(
            detailGrossProfit.toString(),
            currencyUnit
          )}
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
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
