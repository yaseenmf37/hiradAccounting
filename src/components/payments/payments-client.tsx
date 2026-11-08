
"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Plus,
  Search,
  RefreshCw,
  X,
  Loader2,
  Ban,
  Wallet,
  Receipt,
  CalendarDays,
  CheckCircle2,
} from "lucide-react";

import DatePicker from "react-multi-date-picker";
import persian from "react-date-object/calendars/persian";
import persian_fa from "react-date-object/locales/persian_fa";
import DateObject from "react-date-object";
import CursorPagination from "@/components/shared/cursor-pagination";
import NumericInput from "@/components/shared/numeric-input";
import useCursorPage from "@/hooks/use-cursor-page";
import useDebouncedValue from "@/hooks/use-debounced-value";
import type { QuickAction } from "@/lib/quick-actions";

type CurrencyUnit = "RIAL" | "TOMAN";
type PaymentType = "RECEIPT" | "PAYMENT";
type PaymentMethod =
  | "CASH"
  | "POS"
  | "CARD_TO_CARD"
  | "BANK_TRANSFER"
  | "CHECK";
type PaymentStatus = "CONFIRMED" | "CANCELLED";

type Contact = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  type: "CUSTOMER" | "SUPPLIER" | "BOTH";
};

type Invoice = {
  id: string;
  invoiceNumber: string;
  type: "PURCHASE" | "SALE";
  status: "DRAFT" | "ISSUED" | "CANCELLED";
  total: string;
  contactId: string | null;
  contact?: { id: string; name: string } | null;
};

type Payment = {
  id: string;
  contactId: string | null;
  invoiceId: string | null;
  type: PaymentType;
  method: PaymentMethod;
  status: PaymentStatus;
  amount: string;
  trackingNumber: string | null;
  checkNumber?: string | null;
  checkIssuedAt?: string | null;
  checkDueAt?: string | null;
  checkClearedAt?: string | null;
  payableTo?: string | null;
  destinationDetails?: string | null;
  description: string | null;
  paidAt: string;
  cancelledAt: string | null;
  cancelReason: string | null;
  contact?: { id: string; name: string } | null;
  invoice?: {
    id: string;
    invoiceNumber: string;
    type: "PURCHASE" | "SALE";
    status: string;
    total: string;
  } | null;
};

type PaymentForm = {
  type: PaymentType;
  method: PaymentMethod;
  contactId: string;
  invoiceId: string;
  amount: string;
  trackingNumber: string;
  checkNumber: string;
  checkIssuedAt: string;
  checkDueAt: string;
  checkClearedAt: string;
  payableTo: string;
  destinationDetails: string;
  description: string;
  paidAt: string;
};

const emptyForm: PaymentForm = {
  type: "RECEIPT",
  method: "CASH",
  contactId: "",
  invoiceId: "",
  amount: "",
  trackingNumber: "",
  checkNumber: "",
  checkIssuedAt: "",
  checkDueAt: "",
  checkClearedAt: "",
  payableTo: "",
  destinationDetails: "",
  description: "",
  paidAt: new Date().toISOString().slice(0, 16),
};

const inputClass =
  "w-full rounded-xl border border-[#293642] bg-[#111b24] px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-green-500";

const methodLabels: Record<PaymentMethod, string> = {
  CASH: "نقدی",
  POS: "کارت‌خوان",
  CARD_TO_CARD: "کارت‌به‌کارت",
  BANK_TRANSFER: "حواله بانکی",
  CHECK: "چک",
};

function formatAmount(value: string | number | bigint, unit: CurrencyUnit) {
  let amount = BigInt(value);

  if (unit === "TOMAN") amount /= BigInt(10);

  return new Intl.NumberFormat("fa-IR").format(amount);
}

function currencyLabel(unit: CurrencyUnit) {
  return unit === "TOMAN" ? "تومان" : "ریال";
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-[#293642] bg-[#17232d] shadow-2xl">
        <div className="flex items-center justify-between border-b border-[#293642] px-5 py-4">
          <h2 className="font-bold text-white">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-slate-400 hover:bg-white/5 hover:text-white"
          >
            <X size={19} />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-2">
      <span className="text-sm text-slate-300">{label}</span>
      {children}
    </label>
  );
}

export default function PaymentsClient({
  currencyUnit,
  quickAction,
}: {
  currencyUnit: CurrencyUnit;
  quickAction?: QuickAction | null;
}) {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"ALL" | PaymentType>("ALL");
  const [statusFilter, setStatusFilter] = useState<"ALL" | PaymentStatus>("ALL");

  const [form, setForm] = useState<PaymentForm>(emptyForm);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [checkClearingId, setCheckClearingId] = useState<string | null>(null);
  const [checkClearDate, setCheckClearDate] = useState("");
  const [totalCount, setTotalCount] = useState(0);
  const [serverStats, setServerStats] = useState({
    receipts: "0",
    payments: "0",
    confirmedCount: 0,
  });
  const debouncedSearch = useDebouncedValue(search);
  const [contactSearch, setContactSearch] = useState("");
  const [invoiceSearch, setInvoiceSearch] = useState("");
  const debouncedContactSearch = useDebouncedValue(contactSearch);
  const debouncedInvoiceSearch = useDebouncedValue(invoiceSearch);
  const paging = useCursorPage();

  useEffect(() => {
    if (
      quickAction?.action === "payment" &&
      quickAction.targetView === "payments"
    ) openCreateModal();
  }, [quickAction?.requestId, quickAction?.action]);

  const loadData = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError("");

    try {
      const params = new URLSearchParams();
      params.set("limit", "50");
      if (paging.cursor) params.set("cursor", paging.cursor);
      if (typeFilter !== "ALL") params.set("type", typeFilter);
      if (statusFilter !== "ALL") params.set("status", statusFilter);
      if (debouncedSearch.trim()) params.set("search", debouncedSearch.trim());

      const paymentResponse = await fetch(`/api/payments?${params.toString()}`, {
        cache: "no-store",
        signal,
      });
      const paymentData = await paymentResponse.json();

      if (!paymentResponse.ok) {
        throw new Error(paymentData.error || "دریافت تراکنش‌ها ناموفق بود.");
      }

      setPayments(paymentData.payments ?? []);
      setTotalCount(paymentData.total ?? 0);
      setServerStats(paymentData.stats ?? {
        receipts: "0",
        payments: "0",
        confirmedCount: 0,
      });
      paging.setNextCursor(paymentData.nextCursor ?? null);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      setError(
        err instanceof Error ? err.message : "دریافت اطلاعات ناموفق بود."
      );
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [debouncedSearch, typeFilter, statusFilter, paging.cursor, paging.setNextCursor]);

  useEffect(() => {
    const controller = new AbortController();
    void loadData(controller.signal);
    return () => controller.abort();
  }, [loadData]);

  useEffect(() => {
    if (!modalOpen) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const contactParams = new URLSearchParams({
          status: "active",
          type: "ALL",
          limit: "100",
        });
        if (debouncedContactSearch.trim()) {
          contactParams.set("search", debouncedContactSearch.trim());
        }
        const invoiceParams = new URLSearchParams({
          status: "ISSUED",
          limit: "100",
        });
        if (debouncedInvoiceSearch.trim()) {
          invoiceParams.set("search", debouncedInvoiceSearch.trim());
        }
        const [contactResponse, invoiceResponse] = await Promise.all([
          fetch(`/api/contacts?${contactParams}`, {
            cache: "no-store",
            signal: controller.signal,
          }),
          fetch(`/api/invoices?${invoiceParams}`, {
            cache: "no-store",
            signal: controller.signal,
          }),
        ]);
        const [contactData, invoiceData] = await Promise.all([
          contactResponse.json(),
          invoiceResponse.json(),
        ]);
        if (!contactResponse.ok) {
          throw new Error(contactData.message || "دریافت مخاطبین ناموفق بود.");
        }
        if (!invoiceResponse.ok) {
          throw new Error(invoiceData.message || "دریافت فاکتورها ناموفق بود.");
        }
        setContacts((current) => {
          const byId = new Map(current.map((contact: Contact) => [contact.id, contact]));
          for (const contact of contactData.contacts ?? []) byId.set(contact.id, contact);
          return [...byId.values()];
        });
        setInvoices((current) => {
          const byId = new Map(current.map((invoice: Invoice) => [invoice.id, invoice]));
          for (const invoice of invoiceData.invoices ?? []) byId.set(invoice.id, invoice);
          return [...byId.values()];
        });
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "دریافت اطلاعات فرم ناموفق بود.");
      }
    })();
    return () => controller.abort();
  }, [modalOpen, debouncedContactSearch, debouncedInvoiceSearch]);

  function updateForm<K extends keyof PaymentForm>(
    key: K,
    value: PaymentForm[K]
  ) {
    setForm((previous) => ({ ...previous, [key]: value }));
  }

  function openCreateModal() {
    setForm(emptyForm);
    setContactSearch("");
    setInvoiceSearch("");
    setError("");
    setModalOpen(true);
  }

  const selectedInvoice = invoices.find(
    (invoice) => invoice.id === form.invoiceId
  );

  const availableInvoices = invoices.filter((invoice) => {
    const expectedType = form.type === "RECEIPT" ? "SALE" : "PURCHASE";
    const query = invoiceSearch.trim().toLocaleLowerCase();

    return (
      invoice.type === expectedType &&
      (!form.contactId || invoice.contactId === form.contactId) &&
      (!query ||
        invoice.invoiceNumber.toLocaleLowerCase().includes(query) ||
        invoice.contact?.name.toLocaleLowerCase().includes(query))
    );
  });

  function handleTypeChange(type: PaymentType) {
    setForm((previous) => ({
      ...previous,
      type,
      invoiceId: "",
      contactId: "",
    }));
  }

  function handleContactChange(contactId: string) {
    setForm((previous) => ({
      ...previous,
      contactId,
      invoiceId: "",
    }));
  }

  async function submitPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setSuccess("");

    try {
      const amount = Number(form.amount);

      if (!Number.isSafeInteger(amount) || amount <= 0) {
        throw new Error("مبلغ باید یک عدد صحیح و مثبت باشد.");
      }

      const response = await fetch("/api/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: form.type,
          method: form.method,
          contactId: form.contactId || null,
          invoiceId: form.invoiceId || null,
          amount,
          trackingNumber: form.trackingNumber.trim() || null,
          checkNumber: form.method === "CHECK" ? form.checkNumber.trim() || null : null,
          checkIssuedAt: form.method === "CHECK" ? form.checkIssuedAt || null : null,
          checkDueAt: form.method === "CHECK" ? form.checkDueAt || null : null,
          checkClearedAt: form.method === "CHECK" ? form.checkClearedAt || null : null,
          payableTo: form.method === "CHECK" ? form.payableTo.trim() || null : null,
          destinationDetails:
            form.method === "CARD_TO_CARD" || form.method === "POS"
              ? form.destinationDetails.trim() || null
              : null,
          description: form.description.trim() || null,
          paidAt: new Date(form.paidAt).toISOString(),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "ثبت تراکنش ناموفق بود.");
      }

      setModalOpen(false);
      setForm(emptyForm);
      setSuccess("تراکنش با موفقیت ثبت شد.");
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "ثبت تراکنش ناموفق بود.");
    } finally {
      setSaving(false);
    }
  }

  async function cancelPayment(payment: Payment) {
    if (payment.status !== "CONFIRMED") return;

    const reason = window.prompt(
      `دلیل لغو تراکنش ${formatAmount(payment.amount, currencyUnit)} ${currencyLabel(currencyUnit)} را وارد کنید:`
    );

    if (!reason || reason.trim().length < 3) return;

    setError("");
    setSuccess("");

    try {
      const response = await fetch(
        `/api/payments/${payment.id}/cancel`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: reason.trim() }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "لغو تراکنش ناموفق بود.");
      }

      setSuccess("تراکنش با موفقیت لغو شد.");
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "لغو تراکنش ناموفق بود.");
    }
  }

  async function markCheckCleared(payment: Payment) {
    if (!checkClearDate) return;

    setError("");
    setSuccess("");

    try {
      const response = await fetch(`/api/payments/${payment.id}/clear-check`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ checkClearedAt: checkClearDate }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "ثبت پاس‌شدن چک ناموفق بود.");
      }

      setCheckClearingId(null);
      setCheckClearDate("");
      setSuccess("تاریخ پاس‌شدن چک ثبت شد.");
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "ثبت پاس‌شدن چک ناموفق بود.");
    }
  }

  const totalReceipts = BigInt(serverStats.receipts);
  const totalPayments = BigInt(serverStats.payments);

  return (
    <section dir="rtl" className="space-y-7">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold text-white">دریافت و پرداخت</h1>
          <p className="mt-2 text-sm text-slate-400">
            مدیریت دریافت‌ها، پرداخت‌ها و تراکنش‌های مالی کسب‌وکار.
          </p>
        </div>

        <button
          type="button"
          onClick={openCreateModal}
          className="flex items-center justify-center gap-2 rounded-xl bg-green-500 px-5 py-3 text-sm font-bold text-black transition hover:bg-green-400"
        >
          <Plus size={18} />
          ثبت تراکنش جدید
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-[#293642] bg-[#17232d] p-5">
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-400">مجموع دریافت‌ها</span>
            <ArrowDownLeft className="text-green-400" size={22} />
          </div>
          <p className="mt-3 text-xl font-bold text-white">
            {formatAmount(totalReceipts, currencyUnit)}
          </p>
          <span className="mt-1 block text-xs text-slate-500">
            {currencyLabel(currencyUnit)}
          </span>
        </div>

        <div className="rounded-2xl border border-[#293642] bg-[#17232d] p-5">
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-400">مجموع پرداخت‌ها</span>
            <ArrowUpRight className="text-red-400" size={22} />
          </div>
          <p className="mt-3 text-xl font-bold text-white">
            {formatAmount(totalPayments, currencyUnit)}
          </p>
          <span className="mt-1 block text-xs text-slate-500">
            {currencyLabel(currencyUnit)}
          </span>
        </div>

        <div className="rounded-2xl border border-[#293642] bg-[#17232d] p-5">
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-400">تعداد تراکنش‌های معتبر</span>
            <Wallet className="text-blue-400" size={22} />
          </div>
          <p className="mt-3 text-2xl font-bold text-white">
            {serverStats.confirmedCount.toLocaleString("fa-IR")}
          </p>
        </div>
      </div>

      {error && !modalOpen && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {success && (
        <div className="rounded-xl border border-green-500/30 bg-green-500/10 px-4 py-3 text-sm text-green-400">
          {success}
        </div>
      )}

      <div className="rounded-2xl border border-[#293642] bg-[#17232d] p-4">
        <div className="flex flex-col gap-3 lg:flex-row">
          <div className="relative flex-1">
            <Search
              size={18}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500"
            />
            <input
              value={search}
              onChange={(event) => {
                paging.resetPages();
                setSearch(event.target.value);
              }}
              placeholder="جست‌وجوی طرف حساب، شماره پیگیری یا فاکتور..."
              className={`${inputClass} pr-11`}
            />
          </div>

          <select
            value={typeFilter}
            onChange={(event) =>
              {
                paging.resetPages();
                setTypeFilter(event.target.value as "ALL" | PaymentType);
              }
            }
            className={`${inputClass} lg:w-44`}
          >
            <option value="ALL">همه تراکنش‌ها</option>
            <option value="RECEIPT">دریافت‌ها</option>
            <option value="PAYMENT">پرداخت‌ها</option>
          </select>

          <select
            value={statusFilter}
            onChange={(event) =>
              {
                paging.resetPages();
                setStatusFilter(event.target.value as "ALL" | PaymentStatus);
              }
            }
            className={`${inputClass} lg:w-44`}
          >
            <option value="ALL">همه وضعیت‌ها</option>
            <option value="CONFIRMED">تأییدشده</option>
            <option value="CANCELLED">لغوشده</option>
          </select>

          <button
            type="button"
            onClick={() => void loadData()}
            disabled={loading}
            title="بروزرسانی"
            className="flex items-center justify-center rounded-xl border border-[#293642] px-4 text-slate-300 hover:bg-white/5 disabled:opacity-50"
          >
            <RefreshCw
              size={18}
              className={loading ? "animate-spin" : ""}
            />
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-[#293642] bg-[#17232d]">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[950px] text-right">
            <thead className="border-b border-[#293642] bg-[#111b24]">
              <tr className="text-xs text-slate-400">
                <th className="px-5 py-4 font-medium">نوع تراکنش</th>
                <th className="px-5 py-4 font-medium">طرف حساب</th>
                <th className="px-5 py-4 font-medium">مبلغ</th>
                <th className="px-5 py-4 font-medium">روش پرداخت</th>
                <th className="px-5 py-4 font-medium">شماره پیگیری</th>
                <th className="px-5 py-4 font-medium">فاکتور</th>
                <th className="px-5 py-4 font-medium">تاریخ</th>
                <th className="px-5 py-4 font-medium">وضعیت</th>
                <th className="px-5 py-4 font-medium">عملیات</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-[#293642]">
              {loading ? (
                <tr>
                  <td colSpan={9} className="py-14 text-center text-slate-400">
                    <Loader2 className="mx-auto mb-3 animate-spin" size={23} />
                    در حال دریافت تراکنش‌ها...
                  </td>
                </tr>
              ) : payments.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-14 text-center">
                    <Receipt className="mx-auto mb-3 text-slate-600" size={32} />
                    <p className="text-sm text-slate-400">
                      تراکنشی برای نمایش وجود ندارد.
                    </p>
                  </td>
                </tr>
              ) : (
                payments.map((payment) => (
                  <tr
                    key={payment.id}
                    className="text-sm transition hover:bg-white/[0.02]"
                  >
                    <td className="px-5 py-4">
                      <span
                        className={`inline-flex items-center gap-2 ${
                          payment.type === "RECEIPT"
                            ? "text-green-400"
                            : "text-red-400"
                        }`}
                      >
                        {payment.type === "RECEIPT" ? (
                          <ArrowDownLeft size={17} />
                        ) : (
                          <ArrowUpRight size={17} />
                        )}
                        {payment.type === "RECEIPT" ? "دریافت" : "پرداخت"}
                      </span>
                    </td>

                    <td className="px-5 py-4 text-white">
                      {payment.contact?.name || "بدون طرف حساب"}
                    </td>

                    <td className="px-5 py-4 font-bold text-white">
                      {formatAmount(payment.amount, currencyUnit)}
                      <span className="mr-1 text-xs font-normal text-slate-500">
                        {currencyLabel(currencyUnit)}
                      </span>
                    </td>

                    <td className="px-5 py-4 text-slate-300">
                      {methodLabels[payment.method]}
                      {payment.method === "CHECK" && (
                        <span className="mt-1 block text-xs text-slate-500">
                          {payment.checkClearedAt
                            ? `پاس‌شده: ${new Date(payment.checkClearedAt).toLocaleDateString("fa-IR-u-ca-persian", { timeZone: "Asia/Tehran" })}`
                            : "پاس‌نشده / نامشخص"}
                        </span>
                      )}
                    </td>

                    <td className="px-5 py-4 text-slate-400" dir="ltr">
                      {payment.trackingNumber || "—"}
                    </td>

                    <td className="px-5 py-4 text-slate-300">
                      {payment.invoice?.invoiceNumber || "—"}
                    </td>

                    <td className="px-5 py-4 text-slate-400">
                      <span className="flex items-center gap-2">
                        <CalendarDays size={14} />
                        {new Date(payment.paidAt).toLocaleDateString("fa-IR-u-ca-persian", {
                          year: "numeric",
                          month: "2-digit",
                          day: "2-digit",
                          timeZone: "Asia/Tehran",
                        })}
                      </span>
                    </td>

                    <td className="px-5 py-4">
                      <span
                        className={`rounded-lg px-2.5 py-1 text-xs ${
                          payment.status === "CONFIRMED"
                            ? "bg-green-500/10 text-green-400"
                            : "bg-red-500/10 text-red-400"
                        }`}
                      >
                        {payment.status === "CONFIRMED"
                          ? "تأییدشده"
                          : "لغوشده"}
                      </span>
                    </td>

                    <td className="px-5 py-4">
                      {payment.status === "CONFIRMED" ? (
                        <div className="flex items-center gap-2">
                          {payment.method === "CHECK" && !payment.checkClearedAt && (
                            checkClearingId === payment.id ? (
                              <div className="flex items-center gap-1">
                                <input
                                  aria-label="تاریخ واقعی پاس‌شدن چک"
                                  type="date"
                                  value={checkClearDate}
                                  min={payment.checkIssuedAt?.slice(0, 10)}
                                  onChange={(event) => setCheckClearDate(event.target.value)}
                                  className="w-32 rounded-lg border border-[#293642] bg-[#111b24] p-2 text-xs text-white"
                                />
                                <button
                                  type="button"
                                  title="ثبت تاریخ پاس‌شدن"
                                  disabled={!checkClearDate}
                                  onClick={() => void markCheckCleared(payment)}
                                  className="rounded-lg border border-green-500/30 p-2 text-green-400 disabled:opacity-40"
                                >
                                  <CheckCircle2 size={16} />
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                title="ثبت پاس‌شدن چک"
                                onClick={() => {
                                  setCheckClearingId(payment.id);
                                  setCheckClearDate("");
                                }}
                                className="rounded-lg border border-green-500/30 px-2 py-1 text-xs text-green-400 hover:bg-green-500/10"
                              >
                                چک پاس شد
                              </button>
                            )
                          )}
                          <button
                            type="button"
                            title="لغو تراکنش"
                            onClick={() => void cancelPayment(payment)}
                            className="rounded-lg border border-red-500/30 p-2 text-red-400 hover:bg-red-500/10"
                          >
                            <Ban size={16} />
                          </button>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-600">
                          {payment.cancelReason || "—"}
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
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
        <Modal
          title="ثبت تراکنش جدید"
          onClose={() => {
            setModalOpen(false);
            setError("");
          }}
        >
          <form onSubmit={submitPayment} className="space-y-4">
            {error && (
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
                {error}
              </div>
            )}

            <Field label="نوع تراکنش">
              <select
                value={form.type}
                onChange={(event) =>
                  handleTypeChange(event.target.value as PaymentType)
                }
                className={inputClass}
              >
                <option value="RECEIPT">دریافت وجه از مشتری</option>
                <option value="PAYMENT">پرداخت وجه به تأمین‌کننده</option>
              </select>
            </Field>

            <Field label="روش پرداخت">
              <select
                value={form.method}
                onChange={(event) =>
                  updateForm("method", event.target.value as PaymentMethod)
                }
                className={inputClass}
              >
                {Object.entries(methodLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="طرف حساب">
              <input
                value={contactSearch}
                onChange={(event) => setContactSearch(event.target.value)}
                placeholder="جست‌وجوی مخاطب..."
                className={`${inputClass} mb-2`}
              />
              <select
                value={form.contactId}
                onChange={(event) => handleContactChange(event.target.value)}
                className={inputClass}
              >
                <option value="">بدون طرف حساب</option>
                {contacts
                  .filter(
                    (contact) => {
                      const query = contactSearch.trim().toLocaleLowerCase();
                      const typeMatches =
                        contact.type === "BOTH" ||
                        (form.type === "RECEIPT"
                          ? contact.type === "CUSTOMER"
                          : contact.type === "SUPPLIER");
                      return (
                        typeMatches &&
                        (!query ||
                          contact.name.toLocaleLowerCase().includes(query) ||
                          contact.phone?.includes(query) ||
                          contact.email?.toLocaleLowerCase().includes(query))
                      );
                    }
                  )
                  .map((contact) => (
                    <option key={contact.id} value={contact.id}>
                      {contact.name}
                    </option>
                  ))}
              </select>
            </Field>

            <Field label="اتصال به فاکتور (اختیاری)">
              <input
                value={invoiceSearch}
                onChange={(event) => setInvoiceSearch(event.target.value)}
                placeholder="جست‌وجوی شماره یا طرف‌حساب فاکتور..."
                className={`${inputClass} mb-2`}
              />
              <select
                value={form.invoiceId}
                onChange={(event) =>
                  updateForm("invoiceId", event.target.value)
                }
                className={inputClass}
              >
                <option value="">پرداخت مستقل / بدون فاکتور</option>
                {availableInvoices.map((invoice) => (
                  <option key={invoice.id} value={invoice.id}>
                    {invoice.invoiceNumber} — {invoice.contact?.name || "بدون مخاطب"}
                  </option>
                ))}
              </select>
            </Field>

            {selectedInvoice && (
              <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-4">
                <p className="text-xs text-slate-400">مبلغ کل فاکتور</p>
                <p className="mt-1 font-bold text-white">
                  {formatAmount(selectedInvoice.total, currencyUnit)}{" "}
                  {currencyLabel(currencyUnit)}
                </p>
                <p className="mt-2 text-xs text-slate-500">
                  کنترل مانده قابل پرداخت در سرور انجام می‌شود.
                </p>
              </div>
            )}

            <Field label={`مبلغ (${currencyLabel(currencyUnit)})`}>
              <NumericInput
                required
                min="1"
                step="1"
                value={form.amount}
                onChange={(event) => updateForm("amount", event.target.value)}
                placeholder="مبلغ تراکنش"
                className={inputClass}
                dir="ltr"
              />
            </Field>

            <Field label="شماره پیگیری / شماره چک">
              <input
                maxLength={100}
                value={form.trackingNumber}
                onChange={(event) =>
                  updateForm("trackingNumber", event.target.value)
                }
                placeholder="اختیاری"
                className={inputClass}
              />
            </Field>
            {form.method === "CHECK" && (
              <>
                <Field label="شماره چک">
                  <input maxLength={100} value={form.checkNumber} onChange={(event) => updateForm("checkNumber", event.target.value)} className={inputClass} />
                </Field>
                <Field label="تاریخ صدور چک">
                  <input type="date" value={form.checkIssuedAt} onChange={(event) => updateForm("checkIssuedAt", event.target.value)} className={inputClass} />
                </Field>
                <Field label="تاریخ سررسید چک">
                  <input type="date" min={form.checkIssuedAt || undefined} value={form.checkDueAt} onChange={(event) => updateForm("checkDueAt", event.target.value)} className={inputClass} />
                </Field>
                <Field label="در وجه">
                  <input maxLength={150} value={form.payableTo} onChange={(event) => updateForm("payableTo", event.target.value)} className={inputClass} />
                </Field>
                <Field label="تاریخ واقعی پاس‌شدن (در صورت پاس‌شدن)">
                  <input
                    type="date"
                    min={form.checkIssuedAt || undefined}
                    value={form.checkClearedAt}
                    onChange={(event) => updateForm("checkClearedAt", event.target.value)}
                    className={inputClass}
                  />
                </Field>
              </>
            )}
            {(form.method === "CARD_TO_CARD" || form.method === "POS") && (
              <Field label={form.method === "POS" ? "دستگاه و حساب متصل" : "حساب یا کارت مقصد"}>
                <input maxLength={300} value={form.destinationDetails} onChange={(event) => updateForm("destinationDetails", event.target.value)} className={inputClass} />
              </Field>
            )}

            <Field label="تاریخ تراکنش">
              <DatePicker
                value={
                  form.paidAt
                    ? new DateObject({
                        date: new Date(form.paidAt),
                        calendar: persian,
                        locale: persian_fa,
                      })
                    : new DateObject({
                        calendar: persian,
                        locale: persian_fa,
                      })
                }
                onChange={(date) => {
                  if (!date) return;

                  const selectedDate = date.toDate();
                  const currentDate = form.paidAt
                    ? new Date(form.paidAt)
                    : new Date();

                  selectedDate.setHours(
                    currentDate.getHours(),
                    currentDate.getMinutes(),
                    0,
                    0,
                  );

                  updateForm(
                    "paidAt",
                    `${selectedDate.getFullYear()}-${String(
                      selectedDate.getMonth() + 1,
                    ).padStart(2, "0")}-${String(selectedDate.getDate()).padStart(
                      2,
                      "0",
                    )}T${String(selectedDate.getHours()).padStart(2, "0")}:${String(
                      selectedDate.getMinutes(),
                    ).padStart(2, "0")}`,
                  );
                }}
                calendar={persian}
                locale={persian_fa}
                calendarPosition="bottom-right"
                format="YYYY/MM/DD"
                inputClass={inputClass}
              />
            </Field>

            <Field label="توضیحات">
              <textarea
                rows={3}
                maxLength={1000}
                value={form.description}
                onChange={(event) =>
                  updateForm("description", event.target.value)
                }
                placeholder="توضیحات تکمیلی..."
                className={`${inputClass} resize-none`}
              />
            </Field>

            <div className="flex justify-end gap-3 border-t border-[#293642] pt-4">
              <button
                type="button"
                onClick={() => {
                  setModalOpen(false);
                  setError("");
                }}
                className="rounded-xl border border-[#293642] px-5 py-3 text-sm text-slate-300"
              >
                انصراف
              </button>

              <button
                type="submit"
                disabled={saving}
                className="flex items-center gap-2 rounded-xl bg-green-500 px-5 py-3 text-sm font-bold text-black hover:bg-green-400 disabled:opacity-50"
              >
                {saving && <Loader2 size={16} className="animate-spin" />}
                ثبت تراکنش
              </button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}
