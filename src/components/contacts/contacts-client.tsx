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
} from "lucide-react";
import DatePicker from "react-multi-date-picker";
import persian from "react-date-object/calendars/persian";
import persian_fa from "react-date-object/locales/persian_fa";
import gregorian from "react-date-object/calendars/gregorian";
import DateObject from "react-date-object";


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
}: {
  currencyUnit: "RIAL" | "TOMAN";
}) {
  
function formatLedgerAmount(amount: string) {
  const value = BigInt(amount);
  const isNegative = value < BigInt(0);
  const absoluteValue = isNegative ? -value : value;

  const displayValue =
    currencyUnit === "TOMAN"
      ? absoluteValue / BigInt(10)
      : absoluteValue;

  const formatted = new Intl.NumberFormat("fa-IR").format(displayValue);

  return isNegative ? `−${formatted}` : formatted;
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
  const [ledgerData, setLedgerData] = useState<any>(null);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [ledgerError, setLedgerError] = useState("");
  const [ledgerStartDate, setLedgerStartDate] = useState<DateObject | null>(null);
  const [ledgerEndDate, setLedgerEndDate] = useState<DateObject | null>(null);

  const loadContacts = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const params = new URLSearchParams({
        status: statusFilter,
        type: typeFilter,
      });

      if (search.trim()) params.set("search", search.trim());

      const response = await fetch(`/api/contacts?${params.toString()}`, {
        cache: "no-store",
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "دریافت مخاطبین ناموفق بود.");
      }

      setContacts(data.contacts ?? []);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "دریافت مخاطبین ناموفق بود."
      );
    } finally {
      setLoading(false);
    }
  }, [search, typeFilter, statusFilter]);

  useEffect(() => {
    void loadContacts();
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
) {
  setLedgerContact(contact);
  setLedgerData(null);
  setLedgerError("");
  setLedgerLoading(true);

  try {
const params = new URLSearchParams();

if (startDate) {
  params.set(
  "startDate",
  toEnglishDigits(startDate.convert(gregorian).format("YYYY-MM-DD")),
);
}

if (endDate) {
  params.set(
  "endDate",
  toEnglishDigits(endDate.convert(gregorian).format("YYYY-MM-DD")),
);
}

const query = params.toString();
console.log({
  startDate: startDate?.format("YYYY-MM-DD"),
  endDate: endDate?.format("YYYY-MM-DD"),
  query,
});
const response = await fetch(
  `/api/contacts/${contact.id}/ledger${query ? `?${query}` : ""}`,
  { cache: "no-store" },
);

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || data.message || "دریافت دفتر حساب ناموفق بود.");
    }

    setLedgerData(data);
  } catch (err) {
    setLedgerError(
      err instanceof Error ? err.message : "دریافت دفتر حساب ناموفق بود."
    );
  } finally {
    setLedgerLoading(false);
  }
}

  const activeCount = contacts.filter((item) => item.isActive).length;
  const customerCount = contacts.filter(
    (item) => item.type === "CUSTOMER" || item.type === "BOTH"
  ).length;
  const supplierCount = contacts.filter(
    (item) => item.type === "SUPPLIER" || item.type === "BOTH"
  ).length;

  return (
    <section dir="rtl" className="space-y-7">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold text-white">مدیریت مخاطبین</h1>
          <p className="mt-2 text-sm text-slate-400">
            مشتریان و تأمین‌کنندگان کسب‌وکار خود را مدیریت کنید.
          </p>
        </div>

        <button
          type="button"
          onClick={openCreateModal}
          className="flex items-center justify-center gap-2 rounded-xl bg-green-500 px-5 py-3 text-sm font-bold text-black transition hover:bg-green-400"
        >
          <Plus size={18} />
          افزودن مخاطب
        </button>
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
              onChange={(event) => setSearch(event.target.value)}
              placeholder="جست‌وجوی نام، شماره تماس یا ایمیل..."
              className={`${inputClass} pr-11`}
            />
          </div>

          <select
            value={typeFilter}
            onChange={(event) =>
              setTypeFilter(event.target.value as FilterType)
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
              setStatusFilter(event.target.value as "active" | "all")
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
  onClick={() => void openLedger(contact)}
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
      setLedgerError("");
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
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-[#293642] bg-[#111b24] p-4">
              <p className="text-xs text-slate-400">مجموع بدهکار</p>
              <p className="mt-2 font-bold text-red-400">
                {formatLedgerAmount(ledgerData.summary.totalDebit)}
              </p>
            </div>

            <div className="rounded-xl border border-[#293642] bg-[#111b24] p-4">
              <p className="text-xs text-slate-400">مجموع بستانکار</p>
              <p className="mt-2 font-bold text-green-400">
                {formatLedgerAmount(ledgerData.summary.totalCredit)}
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-[#293642] bg-[#111b24] p-4">
            <p className="text-xs text-slate-400">مانده حساب</p>
            <p className="mt-2 text-xl font-bold text-white">
              {formatLedgerAmount(ledgerData.summary.balance)}
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
      openLedger(ledgerContact, ledgerStartDate, ledgerEndDate);
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
        openLedger(ledgerContact, null, null);
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
            <th className="p-3">بستانکار</th>
            <th className="p-3">مانده</th>
          </tr>
        </thead>

        <tbody className="divide-y divide-[#293642]">
          {ledgerData.entries.map((entry: any) => (
            <tr key={entry.id} className="text-slate-300">
              <td className="whitespace-nowrap p-3">
                {new Date(entry.date).toLocaleDateString("fa-IR-u-ca-persian")}
              </td>
              <td className="p-3">{entry.description}</td>
              <td className="p-3 font-medium text-red-400">
                {entry.type === "DEBIT"
                  ? formatLedgerAmount(entry.amount)
                  : "—"}
              </td>
              <td className="p-3 font-medium text-green-400">
                {entry.type === "CREDIT"
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
</div>
        </div>
      ) : null}
    </div>
  </Modal>
)}
    </section>
  );
}