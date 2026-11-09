"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  Users,
  Plus,
  Search,
  RefreshCw,
  X,
  Pencil,
  Archive,
  RotateCcw,
  Loader2,
  Phone,
  Mail,
  MapPin,
  UserRound,
  Truck,
  UserRoundCheck,
  BookOpen,
  ArrowLeftRight,
  Printer,
} from "lucide-react";
import DatePicker from "react-multi-date-picker";
import persian from "react-date-object/calendars/persian";
import persian_fa from "react-date-object/locales/persian_fa";
import gregorian from "react-date-object/calendars/gregorian";
import DateObject from "react-date-object";
import CursorPagination from "@/components/shared/cursor-pagination";
import useCursorPage from "@/hooks/use-cursor-page";
import useDebouncedValue from "@/hooks/use-debounced-value";
import type { QuickAction } from "@/lib/quick-actions";


type ContactType = "CUSTOMER" | "SUPPLIER" | "BOTH";
type FilterType = "ALL" | ContactType;

type Contact = {
  id: string;
  name: string;
  type: ContactType;
  phone: string | null;
  email: string | null;
  address: string | null;
  description: string | null;
  isActive: boolean;
  createdAt: string;
  _count?: {
    invoices: number;
    payments: number;
  };
};

type ContactForm = {
  name: string;
  type: ContactType;
  phone: string;
  email: string;
  address: string;
  description: string;
};

type LedgerInvoice = {
  id: string;
  invoiceNumber: string;
  type: "SALE" | "PURCHASE";
  invoiceDate: string;
  total: string;
  paidAmount: string;
  balanceDue: string;
  paymentMethods: { method: string; amount: string; paidAmount: string }[];
};

type LedgerInvoiceDetail = {
  id: string;
  invoiceNumber: string;
  type: "SALE" | "PURCHASE";
  status: string;
  invoiceDate: string;
  subtotal: string;
  extraCosts: string;
  discount: string;
  discountPercent?: string | null;
  total: string;
  description: string | null;
  paidAmount: string;
  balanceDue: string;
  items: {
    id: string;
    quantity: string;
    unitPrice: string;
    total: string;
    product: { name: string; unit: string };
  }[];
  payments: {
    method: string;
    amount: string;
    description: string | null;
    status?: string;
    checkNumber?: string | null;
    checkIssuedAt?: string | null;
    checkDueAt?: string | null;
    checkClearedAt?: string | null;
    payableTo?: string | null;
    destinationDetails?: string | null;
  }[];
};

type LedgerData = {
  summary: {
    openingBalance: string;
    totalDebit: string;
    totalCredit: string;
    balance: string;
  };
  entries: {
    id: string;
    date: string;
    title: string;
    reference: string | null;
    description: string | null;
    direction: "DEBIT" | "CREDIT" | "INFO";
    amount: string;
    balance: string;
    paymentMethod?: string;
    trackingNumber?: string | null;
    paymentDetails?: Record<string, string | null>;
  }[];
  total: number;
  nextCursor: string | null;
};

const paymentMethodLabels: Record<string, string> = {
  CASH: "نقدی",
  CHECK: "چک",
  CARD_TO_CARD: "کارت‌به‌کارت",
  POS: "کارت‌خوان",
  LEDGER: "حساب دفتری",
  BANK_TRANSFER: "انتقال بانکی",
};

const emptyForm: ContactForm = {
  name: "",
  type: "CUSTOMER",
  phone: "",
  email: "",
  address: "",
  description: "",
};

const inputClass =
  "w-full rounded-xl border border-[#293642] bg-[#111b24] px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-green-500";

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
      <div className="flex h-[calc(100dvh-2rem)] w-full flex-col overflow-hidden rounded-2xl border border-[#293642] bg-[#17232d] shadow-2xl">
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
        <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
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

function typeLabel(type: ContactType) {
  const labels: Record<ContactType, string> = {
    CUSTOMER: "مشتری",
    SUPPLIER: "تأمین‌کننده",
    BOTH: "مشتری و تأمین‌کننده",
  };
  return labels[type];
}

function typeColor(type: ContactType) {
  if (type === "CUSTOMER") {
    return "border-blue-500/30 bg-blue-500/10 text-blue-400";
  }
  if (type === "SUPPLIER") {
    return "border-amber-500/30 bg-amber-500/10 text-amber-400";
  }
  return "border-purple-500/30 bg-purple-500/10 text-purple-400";
}

function toEnglishDigits(value: string): string {
  return value.replace(/[۰-۹]/g, (digit) =>
    String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)),
  );
}

export default function ContactsClient({
  currencyUnit,
  quickAction,
}: {
  currencyUnit: "RIAL" | "TOMAN";
  quickAction?: QuickAction | null;
}) {
  
function formatLedgerAmount(amount: string) {
  const value = BigInt(amount);
  const isNegative = value < BigInt(0);
  const absoluteValue = isNegative ? -value : value;
  const whole = currencyUnit === "TOMAN" ? absoluteValue / 10n : absoluteValue;
  const fraction = currencyUnit === "TOMAN" ? absoluteValue % 10n : 0n;
  const formatted = `${isNegative ? "−" : ""}${new Intl.NumberFormat("fa-IR").format(whole)}${fraction ? `٫${new Intl.NumberFormat("fa-IR").format(fraction)}` : ""}`;
  return `${formatted} ${currencyUnit === "TOMAN" ? "تومان" : "ریال"}`;
}

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<FilterType>("ALL");
  const [statusFilter, setStatusFilter] = useState<"active" | "all">("active");
  const [modalOpen, setModalOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [form, setForm] = useState<ContactForm>(emptyForm);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [ledgerContact, setLedgerContact] = useState<Contact | null>(null);
  const [ledgerData, setLedgerData] = useState<LedgerData | null>(null);
  const [ledgerInvoices, setLedgerInvoices] = useState<LedgerInvoice[]>([]);
  const [invoiceSettlement, setInvoiceSettlement] = useState<"all" | "settled" | "outstanding">("all");
  const [invoiceNextCursor, setInvoiceNextCursor] = useState<string | null>(null);
  const [invoiceLoading, setInvoiceLoading] = useState(false);
  const [invoiceListError, setInvoiceListError] = useState("");
  const [expandedInvoiceId, setExpandedInvoiceId] = useState<string | null>(null);
  const [ledgerInvoiceDetail, setLedgerInvoiceDetail] = useState<LedgerInvoiceDetail | null>(null);
  const [ledgerInvoiceDetailError, setLedgerInvoiceDetailError] = useState("");
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [ledgerError, setLedgerError] = useState("");
  const [ledgerStartDate, setLedgerStartDate] = useState<DateObject | null>(null);
  const [ledgerEndDate, setLedgerEndDate] = useState<DateObject | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [listStats, setListStats] = useState({
    active: 0,
    customers: 0,
    suppliers: 0,
  });
  const debouncedSearch = useDebouncedValue(search);
  const paging = useCursorPage();
  const ledgerPaging = useCursorPage();

  useEffect(() => {
    if (
      quickAction?.action !== "contact" ||
      quickAction.targetView !== "contacts"
    ) return;
    setEditingContact(null);
    setForm({ ...emptyForm, type: "CUSTOMER" });
    setError("");
    setModalOpen(true);
  }, [quickAction?.requestId, quickAction?.action]);

  const loadContacts = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError("");

    try {
      const params = new URLSearchParams({
        status: statusFilter,
        type: typeFilter,
        limit: "50",
      });

      if (paging.cursor) params.set("cursor", paging.cursor);
      if (debouncedSearch.trim()) params.set("search", debouncedSearch.trim());

      const response = await fetch(`/api/contacts?${params.toString()}`, {
        cache: "no-store",
        signal,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "دریافت مخاطبین ناموفق بود.");
      }

      setContacts(data.contacts ?? []);
      setTotalCount(data.total ?? 0);
      setListStats(data.stats ?? { active: 0, customers: 0, suppliers: 0 });
      paging.setNextCursor(data.nextCursor ?? null);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      setError(
        err instanceof Error ? err.message : "دریافت مخاطبین ناموفق بود."
      );
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [debouncedSearch, typeFilter, statusFilter, paging.cursor, paging.setNextCursor]);

  useEffect(() => {
    const controller = new AbortController();
    void loadContacts(controller.signal);
    return () => controller.abort();
  }, [loadContacts]);

  function updateForm<K extends keyof ContactForm>(
    key: K,
    value: ContactForm[K]
  ) {
    setForm((previous) => ({ ...previous, [key]: value }));
  }

  function openCreateModal() {
    setEditingContact(null);
    setForm(emptyForm);
    setError("");
    setModalOpen(true);
  }

  function startEditing(contact: Contact) {
    setEditingContact(contact);
    setForm({
      name: contact.name,
      type: contact.type,
      phone: contact.phone ?? "",
      email: contact.email ?? "",
      address: contact.address ?? "",
      description: contact.description ?? "",
    });
    setError("");
    setModalOpen(true);
  }

  async function submitContact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setSuccess("");

    try {
      const payload = {
        ...form,
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
        address: form.address.trim() || null,
        description: form.description.trim() || null,
      };

      const response = await fetch(
        editingContact
          ? `/api/contacts/${editingContact.id}`
          : "/api/contacts",
        {
          method: editingContact ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "ذخیره مخاطب ناموفق بود.");
      }

      setModalOpen(false);
      setEditingContact(null);
      setForm(emptyForm);
      setSuccess(
        editingContact
          ? "اطلاعات مخاطب ویرایش شد."
          : "مخاطب با موفقیت ثبت شد."
      );

      await loadContacts();
    } catch (err) {
      setError(err instanceof Error ? err.message : "ذخیره مخاطب ناموفق بود.");
    } finally {
      setSaving(false);
    }
  }

  async function archiveContact(contact: Contact) {
    if (!window.confirm(`مخاطب «${contact.name}» آرشیو شود؟`)) return;

    setError("");
    setSuccess("");

    try {
      const response = await fetch(`/api/contacts/${contact.id}`, {
        method: "DELETE",
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "آرشیو مخاطب ناموفق بود.");
      }

      setSuccess("مخاطب آرشیو شد.");
      await loadContacts();
    } catch (err) {
      setError(err instanceof Error ? err.message : "آرشیو مخاطب ناموفق بود.");
    }
  }

  async function restoreContact(contact: Contact) {
    setError("");
    setSuccess("");

    try {
      const response = await fetch(`/api/contacts/${contact.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: true }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "فعال‌سازی مخاطب ناموفق بود.");
      }

      setSuccess("مخاطب دوباره فعال شد.");
      await loadContacts();
    } catch (err) {
      setError(err instanceof Error ? err.message : "فعال‌سازی ناموفق بود.");
    }
  }

  async function openLedger(
  contact: Contact,
  startDate = ledgerStartDate,
  endDate = ledgerEndDate,
    cursor: string | null = ledgerPaging.cursor,
  ) {
  setLedgerContact(contact);
  setLedgerData(null);
  setLedgerError("");
  setLedgerLoading(true);
  setInvoiceLoading(true);
  setInvoiceListError("");

  try {
const params = new URLSearchParams();
params.set("limit", "50");
if (cursor) params.set("cursor", cursor);

const invoiceParams = new URLSearchParams({
  limit: "50",
  settlement: invoiceSettlement,
});

if (startDate) {
  const date = toEnglishDigits(startDate.convert(gregorian).format("YYYY-MM-DD"));
  params.set("startDate", date);
  invoiceParams.set("startDate", date);
}

if (endDate) {
  const date = toEnglishDigits(endDate.convert(gregorian).format("YYYY-MM-DD"));
  params.set("endDate", date);
  invoiceParams.set("endDate", date);
}

const [response, invoicesResponse] = await Promise.all([
  fetch(`/api/contacts/${contact.id}/ledger?${params}`, { cache: "no-store" }),
  fetch(`/api/contacts/${contact.id}/invoices?${invoiceParams}`, { cache: "no-store" }),
]);
const [data, invoiceData] = await Promise.all([
  response.json(),
  invoicesResponse.json(),
]);

if (!response.ok) {
  throw new Error(data.error || data.message || "دریافت دفتر حساب ناموفق بود.");
}
if (!invoicesResponse.ok) {
  throw new Error(invoiceData.error || "دریافت فاکتورهای طرف حساب ناموفق بود.");
}

setLedgerData(data);
setLedgerInvoices(invoiceData.invoices ?? []);
setInvoiceNextCursor(invoiceData.nextCursor ?? null);
setExpandedInvoiceId(null);
ledgerPaging.setNextCursor(data.nextCursor ?? null);
  } catch (err) {
    const message = err instanceof Error ? err.message : "دریافت دفتر حساب ناموفق بود.";
    setLedgerError(message);
    setInvoiceListError(message);
  } finally {
    setLedgerLoading(false);
    setInvoiceLoading(false);
  }
}

  async function loadMoreLedgerInvoices() {
    if (!ledgerContact || !invoiceNextCursor || invoiceLoading) return;
    setInvoiceLoading(true);
    setInvoiceListError("");

    try {
      const params = new URLSearchParams({
        limit: "50",
        settlement: invoiceSettlement,
        cursor: invoiceNextCursor,
      });
      if (ledgerStartDate) {
        params.set("startDate", toEnglishDigits(ledgerStartDate.convert(gregorian).format("YYYY-MM-DD")));
      }
      if (ledgerEndDate) {
        params.set("endDate", toEnglishDigits(ledgerEndDate.convert(gregorian).format("YYYY-MM-DD")));
      }
      const response = await fetch(
        `/api/contacts/${ledgerContact.id}/invoices?${params}`,
        { cache: "no-store" },
      );
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "دریافت فاکتورهای طرف حساب ناموفق بود.");
      }
      setLedgerInvoices((current) => [...current, ...(data.invoices ?? [])]);
      setInvoiceNextCursor(data.nextCursor ?? null);
    } catch (err) {
      setInvoiceListError(err instanceof Error ? err.message : "دریافت فاکتورهای طرف حساب ناموفق بود.");
    } finally {
      setInvoiceLoading(false);
    }
  }

  async function filterLedgerInvoices(value: "all" | "settled" | "outstanding") {
    setInvoiceSettlement(value);
    setInvoiceNextCursor(null);
    setLedgerInvoices([]);
    setExpandedInvoiceId(null);
    if (ledgerContact) {
      const params = new URLSearchParams({
        limit: "50",
        settlement: value,
      });
      if (ledgerStartDate) {
        params.set("startDate", toEnglishDigits(ledgerStartDate.convert(gregorian).format("YYYY-MM-DD")));
      }
      if (ledgerEndDate) {
        params.set("endDate", toEnglishDigits(ledgerEndDate.convert(gregorian).format("YYYY-MM-DD")));
      }
      setInvoiceLoading(true);
      setInvoiceListError("");
      try {
        const response = await fetch(
          `/api/contacts/${ledgerContact.id}/invoices?${params}`,
          { cache: "no-store" },
        );
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || "اعمال فیلتر فاکتورها ناموفق بود.");
        }
        setLedgerInvoices(data.invoices ?? []);
        setInvoiceNextCursor(data.nextCursor ?? null);
      } catch (err) {
        setInvoiceListError(err instanceof Error ? err.message : "اعمال فیلتر فاکتورها ناموفق بود.");
      } finally {
        setInvoiceLoading(false);
      }
    }
  }

  async function openLedgerInvoice(invoice: LedgerInvoice) {
    setExpandedInvoiceId(invoice.id);
    setLedgerInvoiceDetail(null);
    setLedgerInvoiceDetailError("");
    try {
      const response = await fetch(`/api/invoices/${invoice.id}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || data.error || "دریافت جزئیات فاکتور ناموفق بود.");
      }
      setLedgerInvoiceDetail({
        ...data.invoice,
        paidAmount: invoice.paidAmount,
        balanceDue: invoice.balanceDue,
      });
    } catch (err) {
      setLedgerInvoiceDetailError(err instanceof Error ? err.message : "دریافت جزئیات فاکتور ناموفق بود.");
    } finally {
      setExpandedInvoiceId(null);
    }
  }

  const activeCount = listStats.active;
  const customerCount = listStats.customers;
  const supplierCount = listStats.suppliers;

  return (
    <section dir="rtl" className="space-y-7">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold text-white">مدیریت مخاطبین</h1>
          <p className="mt-2 text-sm text-slate-400">
            مشتریان و تأمین‌کنندگان کسب‌وکار خود را مدیریت کنید.
          </p>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => window.print()}
            className="flex items-center justify-center gap-2 rounded-xl border border-[#293642] px-4 py-3 text-sm text-slate-300 transition hover:bg-white/5"
          >
            <Printer size={17} />
            چاپ فهرست
          </button>
          <button
            type="button"
            onClick={openCreateModal}
            className="flex items-center justify-center gap-2 rounded-xl bg-green-500 px-5 py-3 text-sm font-bold text-black transition hover:bg-green-400"
          >
            <Plus size={18} />
            افزودن مخاطب
          </button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-[#293642] bg-[#17232d] p-5">
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-400">مخاطبین نمایش‌داده‌شده</span>
            <Users className="text-green-400" size={21} />
          </div>
          <p className="mt-3 text-2xl font-bold text-white">
            {contacts.length.toLocaleString("fa-IR")}
          </p>
        </div>

        <div className="rounded-2xl border border-[#293642] bg-[#17232d] p-5">
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-400">مشتریان</span>
            <UserRound className="text-blue-400" size={21} />
          </div>
          <p className="mt-3 text-2xl font-bold text-white">
            {customerCount.toLocaleString("fa-IR")}
          </p>
        </div>

        <div className="rounded-2xl border border-[#293642] bg-[#17232d] p-5">
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-400">تأمین‌کنندگان</span>
            <Truck className="text-amber-400" size={21} />
          </div>
          <p className="mt-3 text-2xl font-bold text-white">
            {supplierCount.toLocaleString("fa-IR")}
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
              placeholder="جست‌وجوی نام، شماره تماس یا ایمیل..."
              className={`${inputClass} pr-11`}
            />
          </div>

          <select
            value={typeFilter}
            onChange={(event) =>
              {
                paging.resetPages();
                setTypeFilter(event.target.value as FilterType);
              }
            }
            className={`${inputClass} lg:w-48`}
          >
            <option value="ALL">همه انواع</option>
            <option value="CUSTOMER">مشتریان</option>
            <option value="SUPPLIER">تأمین‌کنندگان</option>
            <option value="BOTH">مشترک</option>
          </select>

          <select
            value={statusFilter}
            onChange={(event) =>
              {
                paging.resetPages();
                setStatusFilter(event.target.value as "active" | "all");
              }
            }
            className={`${inputClass} lg:w-44`}
          >
            <option value="active">مخاطبین فعال</option>
            <option value="all">همه مخاطبین</option>
          </select>

          <button
            type="button"
            onClick={() => void loadContacts()}
            disabled={loading}
            title="بروزرسانی"
            className="flex items-center justify-center rounded-xl border border-[#293642] px-4 text-slate-300 hover:bg-white/5 disabled:opacity-50"
          >
            <RefreshCw size={18} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-[#293642] bg-[#17232d]">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[850px] text-right">
            <thead className="border-b border-[#293642] bg-[#111b24]">
              <tr className="text-xs text-slate-400">
                <th className="px-5 py-4 font-medium">نام مخاطب</th>
                <th className="px-5 py-4 font-medium">نوع</th>
                <th className="px-5 py-4 font-medium">شماره تماس</th>
                <th className="px-5 py-4 font-medium">ایمیل</th>
                <th className="px-5 py-4 font-medium">وضعیت</th>
                <th className="px-5 py-4 font-medium">عملیات</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-[#293642]">
              {loading ? (
                <tr>
                  <td colSpan={6} className="py-14 text-center text-slate-400">
                    <Loader2 className="mx-auto mb-3 animate-spin" size={23} />
                    در حال دریافت مخاطبین...
                  </td>
                </tr>
              ) : contacts.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-14 text-center">
                    <Users className="mx-auto mb-3 text-slate-600" size={32} />
                    <p className="text-sm text-slate-400">
                      مخاطبی برای نمایش وجود ندارد.
                    </p>
                  </td>
                </tr>
              ) : (
                contacts.map((contact) => (
                  <tr
                    key={contact.id}
                    className="text-sm transition hover:bg-white/[0.02]"
                  >
                    <td className="px-5 py-4">
                      <div className="font-medium text-white">
                        {contact.name}
                      </div>
                      {contact.address && (
                        <div className="mt-1 flex items-center gap-1 text-xs text-slate-500">
                          <MapPin size={12} />
                          <span className="max-w-48 truncate">
                            {contact.address}
                          </span>
                        </div>
                      )}
                    </td>

                    <td className="px-5 py-4">
                      <span
                        className={`inline-flex rounded-lg border px-2.5 py-1 text-xs ${typeColor(contact.type)}`}
                      >
                        {typeLabel(contact.type)}
                      </span>
                    </td>

                    <td className="px-5 py-4 text-slate-300" dir="ltr">
                      <span className="flex items-center justify-end gap-2">
                        {contact.phone || "—"}
                        {contact.phone && (
                          <Phone size={14} className="text-slate-500" />
                        )}
                      </span>
                    </td>

                    <td className="px-5 py-4 text-slate-400" dir="ltr">
                      {contact.email || "—"}
                    </td>

                    <td className="px-5 py-4">
                      <span
                        className={`rounded-lg px-2.5 py-1 text-xs ${
                          contact.isActive
                            ? "bg-green-500/10 text-green-400"
                            : "bg-red-500/10 text-red-400"
                        }`}
                      >
                        {contact.isActive ? "فعال" : "آرشیوشده"}
                      </span>
                    </td>

                    <td className="px-5 py-4">
                      <div className="flex items-center gap-2">
                        <button
  type="button"
  title="مشاهده دفتر حساب"
  onClick={() => {
    ledgerPaging.resetPages();
    void openLedger(contact, ledgerStartDate, ledgerEndDate, null);
  }}
  className="rounded-lg border border-[#293642] p-2 text-blue-400 transition hover:border-blue-500/50 hover:bg-blue-500/10"
>
  <BookOpen size={16} />
</button>
                        {contact.isActive ? (
                          <>
                            <button
                              type="button"
                              title="ویرایش مخاطب"
                              onClick={() => startEditing(contact)}
                              className="rounded-lg border border-[#293642] p-2 text-slate-300 hover:border-green-500/50 hover:text-green-400"
                            >
                              <Pencil size={16} />
                            </button>
                            <button
                              type="button"
                              title="آرشیو مخاطب"
                              onClick={() => void archiveContact(contact)}
                              className="rounded-lg border border-[#293642] p-2 text-red-400 hover:border-red-500/50"
                            >
                              <Archive size={16} />
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            title="فعال‌سازی مجدد"
                            onClick={() => void restoreContact(contact)}
                            className="flex items-center gap-2 rounded-lg border border-green-500/30 px-3 py-2 text-xs text-green-400 hover:bg-green-500/10"
                          >
                            <RotateCcw size={15} />
                            فعال‌سازی
                          </button>
                        )}
                      </div>
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

      <p className="text-xs text-slate-500">
        تعداد مخاطبین فعال در نتایج: {activeCount.toLocaleString("fa-IR")}
      </p>

      {modalOpen && (
        <Modal
          title={editingContact ? "ویرایش مخاطب" : "افزودن مخاطب جدید"}
          onClose={() => {
            setModalOpen(false);
            setEditingContact(null);
            setError("");
          }}
        >
          <form onSubmit={submitContact} className="space-y-4">
            {error && (
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
                {error}
              </div>
            )}

            <Field label="نام مخاطب *">
              <input
                required
                minLength={2}
                maxLength={150}
                value={form.name}
                onChange={(event) => updateForm("name", event.target.value)}
                placeholder="نام شخص یا شرکت"
                className={inputClass}
              />
            </Field>

            <Field label="نوع مخاطب *">
              <select
                required
                value={form.type}
                onChange={(event) =>
                  updateForm("type", event.target.value as ContactType)
                }
                className={inputClass}
              >
                <option value="CUSTOMER">مشتری</option>
                <option value="SUPPLIER">تأمین‌کننده</option>
                <option value="BOTH">مشتری و تأمین‌کننده</option>
              </select>
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="شماره تماس">
                <input
                  maxLength={30}
                  value={form.phone}
                  onChange={(event) => updateForm("phone", event.target.value)}
                  placeholder="09..."
                  className={inputClass}
                  dir="ltr"
                />
              </Field>

              <Field label="ایمیل">
                <input
                  type="email"
                  maxLength={150}
                  value={form.email}
                  onChange={(event) => updateForm("email", event.target.value)}
                  placeholder="example@email.com"
                  className={inputClass}
                  dir="ltr"
                />
              </Field>
            </div>

            <Field label="آدرس">
              <input
                maxLength={1000}
                value={form.address}
                onChange={(event) => updateForm("address", event.target.value)}
                placeholder="آدرس کامل مخاطب"
                className={inputClass}
              />
            </Field>

            <Field label="توضیحات">
              <textarea
                rows={3}
                maxLength={2000}
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
                  setEditingContact(null);
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
                {editingContact ? "ذخیره تغییرات" : "ثبت مخاطب"}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {ledgerContact && (
  <Modal
    title={`دفتر حساب: ${ledgerContact.name}`}
    onClose={() => {
      setLedgerContact(null);
      setLedgerData(null);
      setLedgerInvoices([]);
      setInvoiceNextCursor(null);
      setExpandedInvoiceId(null);
      setLedgerInvoiceDetail(null);
      setLedgerInvoiceDetailError("");
      setLedgerError("");
      setInvoiceListError("");
    }}
  >
    <div className="space-y-4">
      {ledgerLoading ? (
        <div className="py-12 text-center text-slate-400">
          <Loader2 className="mx-auto mb-3 animate-spin" size={25} />
          در حال دریافت دفتر حساب...
        </div>
      ) : ledgerError ? (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-400">
          {ledgerError}
        </div>
      ) : ledgerData ? (
        <div className="space-y-4">
          <div className="overflow-hidden rounded-xl border border-[#293642]">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#293642] p-4">
              <p className="font-bold text-white">فاکتورهای طرف حساب</p>
              <select
                value={invoiceSettlement}
                onChange={(event) => {
                  void filterLedgerInvoices(event.target.value as typeof invoiceSettlement);
                }}
                className="rounded-lg border border-[#344452] bg-[#111b24] px-3 py-2 text-sm text-white"
              >
                <option value="all">همه فاکتورها</option>
                <option value="outstanding">دارای مانده</option>
                <option value="settled">تسویه‌شده</option>
              </select>
            </div>
            {invoiceListError ? (
              <p className="p-4 text-sm text-red-400">{invoiceListError}</p>
            ) : invoiceLoading ? (
              <p className="p-4 text-center text-sm text-slate-400">در حال دریافت فاکتورها...</p>
            ) : ledgerInvoices.length === 0 ? (
              <p className="p-4 text-center text-sm text-slate-500">فاکتوری با این وضعیت پیدا نشد.</p>
            ) : (
              <div className="divide-y divide-[#293642]">
                {ledgerInvoices.map((invoice) => {
                  const expanded = expandedInvoiceId === invoice.id;
                  return (
                    <div key={invoice.id}>
                      <button
                        type="button"
                        onClick={() => void openLedgerInvoice(invoice)}
                        className="flex w-full flex-wrap items-center justify-between gap-2 p-4 text-right transition hover:bg-white/5"
                      >
                        <span>
                          <span className="block font-semibold text-white">
                            {invoice.type === "SALE" ? "فروش" : "خرید"} · {invoice.invoiceNumber}
                          </span>
                          <span className="mt-1 block text-xs text-slate-400">
                            {new Date(invoice.invoiceDate).toLocaleDateString("fa-IR-u-ca-persian")}
                          </span>
                        </span>
                        <span className={`text-sm font-semibold ${BigInt(invoice.balanceDue) > 0n ? "text-amber-400" : "text-green-400"}`}>
                          {expanded ? "در حال دریافت جزئیات..." : BigInt(invoice.balanceDue) > 0n ? "دارای مانده · مشاهده جزئیات" : "تسویه‌شده · مشاهده جزئیات"}
                        </span>
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
            {invoiceNextCursor && (
              <button
                type="button"
                onClick={() => void loadMoreLedgerInvoices()}
                disabled={invoiceLoading}
                className="w-full border-t border-[#293642] px-4 py-3 text-sm text-green-400 hover:bg-white/5 disabled:opacity-50"
              >
                {invoiceLoading ? "در حال دریافت..." : "نمایش فاکتورهای بیشتر"}
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-[#293642] bg-[#111b24] p-4">
              <p className="text-xs text-slate-400">بدهکار</p>
              <p className="mt-2 font-bold text-red-400">
                {formatLedgerAmount(ledgerData.summary.totalDebit)}
              </p>
            </div>

            <div className="rounded-xl border border-[#293642] bg-[#111b24] p-4">
              <p className="text-xs text-slate-400">پرداختی</p>
              <p className="mt-2 font-bold text-green-400">
                {formatLedgerAmount(ledgerData.summary.totalCredit)}
              </p>
              <p className="mt-1 text-[11px] text-slate-500">
                شامل تراکنش‌های کاهنده مانده، از جمله مرجوعی‌ها
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-[#293642] bg-[#111b24] p-4">
            <p className="text-xs text-slate-400">مانده</p>
            <p className="mt-2 text-xl font-bold text-white">
              {formatLedgerAmount(ledgerData.summary.balance)}
            </p>
            <p className="mt-2 text-sm text-slate-300">
              {BigInt(ledgerData.summary.balance) > 0n
                ? "طرف حساب به ما بدهکار است."
                : BigInt(ledgerData.summary.balance) < 0n
                  ? "ما به طرف حساب بدهکاریم."
                  : "حساب تسویه است."}
            </p>
          </div>

          <div className="overflow-hidden rounded-xl border border-[#293642]">
  <div className="border-b border-[#293642] p-4">
    <p className="font-bold text-white">گردش حساب</p>
  </div>
<div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
  <div>
    <label className="mb-2 block text-sm text-slate-400">
      از تاریخ
    </label>
    <DatePicker
      calendar={persian}
      locale={persian_fa}
      value={ledgerStartDate}
      onChange={(date) => {
  setLedgerStartDate(date);
}}
      calendarPosition="bottom-right"
      inputClass="w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-white"
      placeholder="انتخاب تاریخ شروع"
    />
  </div>

  <div>
    <label className="mb-2 block text-sm text-slate-400">
      تا تاریخ
    </label>
    <DatePicker
      calendar={persian}
      locale={persian_fa}
      value={ledgerEndDate}
     onChange={(date) => {
  setLedgerEndDate(date);
}}
      calendarPosition="bottom-right"
      inputClass="w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-white"
      placeholder="انتخاب تاریخ پایان"
    />
  </div>

    <button
  type="button"
  onClick={() => {
    if (ledgerContact) {
      ledgerPaging.resetPages();
      openLedger(ledgerContact, ledgerStartDate, ledgerEndDate, null);
    }
  }}
  style={{justifyItems : "center"}}
  disabled={ledgerLoading}
  className="col-span-2 w-[89%] m-auto rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-500 disabled:opacity-50"
>
  {ledgerLoading ? "در حال اعمال..." : "اعمال فیلتر"}
</button>
</div>

<div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#293642] bg-[#111b24] p-4">
  <div>
    <p className="text-sm text-slate-400">مانده اول دوره</p>
    <p className="mt-1 font-semibold text-white">
      {formatLedgerAmount(ledgerData.summary.openingBalance)}{" "}
      {currencyUnit === "TOMAN" ? "تومان" : "ریال"}
    </p>
  </div>

  <button
    type="button"
    onClick={() => {
      setLedgerStartDate(null);
      setLedgerEndDate(null);

      if (ledgerContact) {
        ledgerPaging.resetPages();
        openLedger(ledgerContact, null, null, null);
      }
    }}
    className="rounded-lg border border-[#344452] px-4 py-2 text-sm text-slate-300 transition hover:bg-[#1c2a36]"
  >
    پاک‌کردن فیلتر تاریخ
  </button>
</div>
  {ledgerData.entries.length === 0 ? (
    <p className="py-10 text-center text-sm text-slate-500">
      هنوز تراکنشی ثبت نشده است.
    </p>
  ) : (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[650px] text-right text-sm">
        <thead className="bg-[#111b24] text-xs text-slate-400">
          <tr>
            <th className="p-3">تاریخ</th>
            <th className="p-3">شرح</th>
            <th className="p-3">بدهکار</th>
            <th className="p-3">پرداختی</th>
            <th className="p-3">مانده</th>
          </tr>
        </thead>

        <tbody className="divide-y divide-[#293642]">
          {ledgerData.entries.map((entry) => (
            <tr key={entry.id} className="text-slate-300">
              <td className="whitespace-nowrap p-3">
                {new Date(entry.date).toLocaleDateString("fa-IR-u-ca-persian")}
              </td>
              <td className="p-3">
                <p>{entry.title}</p>
                {entry.reference && <p className="text-xs text-slate-500">{entry.reference}</p>}
                {entry.description && <p className="text-xs text-slate-500">{entry.description}</p>}
                {entry.paymentMethod && (
                  <p className="text-xs text-slate-400">
                    روش پرداخت: {paymentMethodLabels[entry.paymentMethod] ?? entry.paymentMethod}
                    {entry.trackingNumber ? ` — پیگیری: ${entry.trackingNumber}` : ""}
                  </p>
                )}
                {entry.direction === "INFO" && (
                  <p className="text-xs text-slate-400">
                    {entry.paymentMethod === "CHECK" && !entry.paymentDetails?.checkClearedAt
                      ? `چک در انتظار پاس‌شدن است؛ ${formatLedgerAmount(entry.amount)} هنوز از بدهی کسر نشده است.`
                      : `مبلغ حساب دفتری: ${formatLedgerAmount(entry.amount)} (بدون اثر نقدی بر مانده)`}
                  </p>
                )}
                {entry.paymentDetails && Object.entries(entry.paymentDetails)
                  .map(([key, value]) => {
                    if (typeof value !== "string" || !value) return null;
                    const labels: Record<string, string> = {
                      checkNumber: "شماره چک",
                      checkIssuedAt: "تاریخ صدور",
                      checkDueAt: "سررسید",
                      checkClearedAt: "تاریخ پاس‌شدن",
                      payableTo: "در وجه",
                      destinationDetails: "حساب/کارت مقصد",
                    };
                    return (
                      <p key={key} className="text-xs text-slate-500">
                        {labels[key] ?? key}: {value}
                      </p>
                    );
                  })}
              </td>
              <td className="p-3 font-medium text-red-400">
                {entry.direction === "DEBIT"
                  ? formatLedgerAmount(entry.amount)
                  : "—"}
              </td>
              <td className="p-3 font-medium text-green-400">
                {entry.direction === "CREDIT"
                  ? formatLedgerAmount(entry.amount)
                  : "—"}
              </td>
              <td className="p-3">
                {formatLedgerAmount(entry.balance)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )}
  <CursorPagination
    total={ledgerData.total ?? 0}
    page={ledgerPaging.page}
    hasNext={Boolean(ledgerPaging.nextCursor)}
    loading={ledgerLoading}
    onPrevious={() => {
      const cursor = ledgerPaging.previousPage();
      if (ledgerContact) {
        void openLedger(ledgerContact, ledgerStartDate, ledgerEndDate, cursor);
      }
    }}
    onNext={() => {
      const cursor = ledgerPaging.nextPage();
      if (ledgerContact && cursor) {
        void openLedger(ledgerContact, ledgerStartDate, ledgerEndDate, cursor);
      }
    }}
  />
</div>
        </div>
      ) : null}
    </div>
  </Modal>
)}
{ledgerInvoiceDetailError && (
  <Modal
    title="جزئیات فاکتور"
    onClose={() => setLedgerInvoiceDetailError("")}
  >
    <p role="alert" className="text-sm text-red-400">{ledgerInvoiceDetailError}</p>
  </Modal>
)}
{ledgerInvoiceDetail && (
  <Modal
    title={`${ledgerInvoiceDetail.type === "SALE" ? "جزئیات فاکتور فروش" : "جزئیات فاکتور خرید"} · ${ledgerInvoiceDetail.invoiceNumber}`}
    onClose={() => setLedgerInvoiceDetail(null)}
  >
    <div className="space-y-4">
      <div className="grid gap-3 text-sm sm:grid-cols-2">
        <p className="text-slate-400">
          تاریخ: <span className="text-white">{new Date(ledgerInvoiceDetail.invoiceDate).toLocaleDateString("fa-IR-u-ca-persian")}</span>
        </p>
        <p className="text-slate-400">
          وضعیت: <span className="text-white">{ledgerInvoiceDetail.status === "ISSUED" ? "صادرشده" : ledgerInvoiceDetail.status === "DRAFT" ? "پیش‌نویس" : "لغوشده"}</span>
        </p>
      </div>

      <div className="overflow-x-auto rounded-xl border border-[#293642]">
        <p className="px-3 pt-3 text-xs text-slate-400">
          تعداد اقلام فاکتور: {new Intl.NumberFormat("fa-IR").format(ledgerInvoiceDetail.items.length)} قلم
        </p>
        <table className="w-full min-w-[560px] text-right text-sm">
          <thead className="bg-[#111b24] text-xs text-slate-400">
            <tr>
              <th className="p-3">کالا</th>
              <th className="p-3">تعداد</th>
              <th className="p-3">قیمت واحد</th>
              <th className="p-3">مبلغ</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#293642]">
            {ledgerInvoiceDetail.items.map((item) => (
              <tr key={item.id} className="text-slate-300">
                <td className="p-3 text-white">{item.product.name}</td>
                <td className="p-3">{new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 3 }).format(Number(item.quantity))} {item.product.unit}</td>
                <td className="p-3">{formatLedgerAmount(item.unitPrice)}</td>
                <td className="p-3">{formatLedgerAmount(item.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="space-y-2 rounded-xl border border-[#293642] bg-[#111b24] p-4 text-sm">
        <div className="flex justify-between text-slate-300"><span>جمع کالاها</span><span>{formatLedgerAmount(ledgerInvoiceDetail.subtotal)}</span></div>
        <div className="flex justify-between text-slate-300"><span>تخفیف{ledgerInvoiceDetail.discountPercent ? ` (${ledgerInvoiceDetail.discountPercent}٪)` : ""}</span><span>{formatLedgerAmount(ledgerInvoiceDetail.discount)}</span></div>
        <div className="flex justify-between text-slate-300"><span>هزینه جانبی</span><span>{formatLedgerAmount(ledgerInvoiceDetail.extraCosts)}</span></div>
        <div className="flex justify-between border-t border-[#293642] pt-2 font-bold text-white"><span>مبلغ نهایی</span><span>{formatLedgerAmount(ledgerInvoiceDetail.total)}</span></div>
        <div className="flex justify-between text-green-400"><span>پرداخت واقعی ثبت‌شده</span><span>{formatLedgerAmount(ledgerInvoiceDetail.paidAmount)}</span></div>
        <div className="flex justify-between font-semibold text-amber-400"><span>{ledgerInvoiceDetail.type === "SALE" ? "مانده بدهی مشتری پس از مرجوعی‌ها" : "مانده بدهی به تأمین‌کننده پس از مرجوعی‌ها"}</span><span>{formatLedgerAmount(ledgerInvoiceDetail.balanceDue)}</span></div>
      </div>

      <section className="rounded-xl border border-[#293642] p-4">
        <h3 className="mb-2 font-bold text-white">پرداخت‌ها و اطلاعات تکمیلی</h3>
        {ledgerInvoiceDetail.payments.length === 0 ? (
          <p className="text-sm text-slate-500">پرداختی برای این فاکتور ثبت نشده است.</p>
        ) : ledgerInvoiceDetail.payments.map((payment, index) => (
          <div key={`${payment.method}-${index}`} className="border-t border-[#293642] py-3 text-sm text-slate-300">
            <p className="font-semibold text-white">
              {paymentMethodLabels[payment.method] ?? payment.method} · {formatLedgerAmount(payment.amount)}
              {payment.status === "PENDING" ? " · در انتظار تأیید" : ""}
              {payment.method === "CHECK" ? payment.checkClearedAt ? " · پاس‌شده" : " · پاس‌نشده" : ""}
            </p>
            {payment.description && <p className="mt-1 text-xs text-slate-400">شرح: {payment.description}</p>}
            {payment.checkNumber && <p className="mt-1 text-xs text-slate-400">شماره چک: {payment.checkNumber}</p>}
            {payment.checkIssuedAt && <p className="mt-1 text-xs text-slate-400">تاریخ صدور: {new Date(payment.checkIssuedAt).toLocaleDateString("fa-IR-u-ca-persian")}</p>}
            {payment.checkDueAt && <p className="mt-1 text-xs text-slate-400">تاریخ سررسید: {new Date(payment.checkDueAt).toLocaleDateString("fa-IR-u-ca-persian")}</p>}
            {payment.checkClearedAt && <p className="mt-1 text-xs text-slate-400">تاریخ واقعی پاس‌شدن: {new Date(payment.checkClearedAt).toLocaleDateString("fa-IR-u-ca-persian")}</p>}
            {payment.payableTo && <p className="mt-1 text-xs text-slate-400">در وجه: {payment.payableTo}</p>}
            {payment.destinationDetails && <p className="mt-1 text-xs text-slate-400">مقصد: {payment.destinationDetails}</p>}
          </div>
        ))}
      </section>
      {ledgerInvoiceDetail.description && (
        <p className="rounded-xl border border-[#293642] p-4 text-sm text-slate-300">توضیحات: {ledgerInvoiceDetail.description}</p>
      )}
    </div>
  </Modal>
)}
<section className="print-only" dir="rtl">
  <h1>فهرست مخاطبین</h1>
  <p>تاریخ چاپ: {new Intl.DateTimeFormat("fa-IR").format(new Date())}</p>
  <table className="print-invoice-table">
    <thead>
      <tr>
        <th>ردیف</th><th>نام</th><th>نوع</th><th>تلفن</th><th>ایمیل</th><th>آدرس</th>
      </tr>
    </thead>
    <tbody>
      {contacts.map((contact, index) => (
        <tr key={contact.id}>
          <td>{new Intl.NumberFormat("fa-IR").format(index + 1)}</td>
          <td>{contact.name}</td>
          <td>{typeLabel(contact.type)}</td>
          <td>{contact.phone || "—"}</td>
          <td>{contact.email || "—"}</td>
          <td>{contact.address || "—"}</td>
        </tr>
      ))}
    </tbody>
  </table>
</section>
    </section>
  );
}