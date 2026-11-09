
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  Building2,
  CheckCircle2,
  Clock3,
  Loader2,
  Plus,
  Search,
  ShieldCheck,
  Users,
  X,
  PauseCircle,
  PlayCircle,
  Pencil,
  Save,
} from "lucide-react";

type Business = {
  id: string;
  name: string;
  phone: string | null;
  isActive: boolean;
  createdAt: string;
  owner: {
    id: string;
    username: string;
    fullName: string;
    isActive: boolean;
  };
  _count: {
    products: number;
    contacts: number;
    invoices: number;
  };
};

type FormData = {
  businessName: string;
  phone: string;
  ownerUsername: string;
  ownerFullName: string;
  ownerPassword: string;
};

const initialForm: FormData = {
  businessName: "",
  phone: "",
  ownerUsername: "",
  ownerFullName: "",
  ownerPassword: "",
};

export default function AdminClient({
  adminName,
}: {
  adminName: string;
}) {
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<FormData>(initialForm);
  const [success, setSuccess] = useState("");
  const [updatingBusinessId, setUpdatingBusinessId] = useState<string | null>(null);
  const [editingBusiness, setEditingBusiness] = useState<Business | null>(null);
  const [editSaving, setEditSaving] = useState(false);

  const [editForm, setEditForm] = useState({
    businessName: "",
    phone: "",
    ownerUsername: "",
    ownerFullName: "",
  }); 

  const loadBusinesses = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/admin/businesses", {
        cache: "no-store",
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "دریافت اطلاعات ناموفق بود.");
      }

      setBusinesses(data.businesses);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "خطا در دریافت اطلاعات."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadBusinesses();
  }, [loadBusinesses]);

  const filteredBusinesses = useMemo(() => {
    const query = search.trim().toLowerCase();

    if (!query) return businesses;

    return businesses.filter((business) =>
      [
        business.name,
        business.owner.fullName,
        business.owner.username,
        business.phone ?? "",
      ].some((value) => value.toLowerCase().includes(query))
    );
  }, [businesses, search]);

  const activeCount = businesses.filter((item) => item.isActive).length;
  const inactiveCount = businesses.length - activeCount;

  async function createBusiness(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setSuccess("");

    try {
      const response = await fetch("/api/admin/businesses", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(form),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "ساخت کسب‌وکار ناموفق بود.");
      }

      setSuccess("کسب‌وکار با موفقیت ایجاد شد.");
      setForm(initialForm);
      setModalOpen(false);
      await loadBusinesses();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "خطا در ایجاد کسب‌وکار."
      );
    } finally {
      setSaving(false);
    }
  }

  
  async function toggleBusinessStatus(business: Business) {
    const nextStatus = !business.isActive;

    const confirmed = window.confirm(
      nextStatus
        ? `آیا از فعال‌سازی کسب‌وکار «${business.name}» مطمئن هستید؟`
        : `آیا از تعلیق کسب‌وکار «${business.name}» مطمئن هستید؟ مدیر این کسب‌وکار نیز از دسترسی خارج خواهد شد.`
    );

    if (!confirmed) return;

    setUpdatingBusinessId(business.id);
    setError("");
    setSuccess("");

    try {
      const response = await fetch(
        `/api/admin/businesses/${business.id}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ isActive: nextStatus }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || data.message || "تغییر وضعیت ناموفق بود."
        );
      }

      setSuccess(
        nextStatus
          ? "کسب‌وکار با موفقیت فعال شد."
          : "کسب‌وکار با موفقیت تعلیق شد."
      );

      await loadBusinesses();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "خطا در تغییر وضعیت."
      );
    } finally {
      setUpdatingBusinessId(null);
    }
  }


function openEditModal(business: Business) {
  setError("");
  setSuccess("");

  setEditForm({
    businessName: business.name,
    phone: business.phone ?? "",
    ownerUsername: business.owner.username,
    ownerFullName: business.owner.fullName,
  });

  setEditingBusiness(business);
}

async function updateBusiness(event: React.FormEvent<HTMLFormElement>) {
  event.preventDefault();

  if (!editingBusiness) return;

  setEditSaving(true);
  setError("");
  setSuccess("");

  try {
    const response = await fetch(
      `/api/admin/businesses/${editingBusiness.id}`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(editForm),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data.error || data.message || "ویرایش اطلاعات ناموفق بود."
      );
    }

    setEditingBusiness(null);
    setSuccess("اطلاعات کسب‌وکار با موفقیت ویرایش شد.");

    await loadBusinesses();
  } catch (err) {
    setError(
      err instanceof Error ? err.message : "خطا در ویرایش اطلاعات."
    );
  } finally {
    setEditSaving(false);
  }
}


  const formatDate = (date: string) =>
    new Intl.DateTimeFormat("fa-IR", {
      year: "numeric",
      month: "long",
      day: "numeric",
    }).format(new Date(date));

  return (
    <main dir="rtl" className="min-h-screen bg-[#0b0f14] text-slate-100">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <header className="mb-10 flex flex-wrap items-center justify-between gap-5">
          <div>
            <div className="mb-3 flex items-center gap-2 text-sm text-green-400">
              <ShieldCheck size={17} />
              <span>Hirad Accounting / مدیریت سیستم</span>
            </div>
            <h1 className="text-2xl font-bold sm:text-3xl">
              پنل مدیریت کل
            </h1>
            <p className="mt-2 text-sm text-slate-500">
              خوش آمدید، {adminName}
            </p>
          </div>

          <button
            onClick={() => {
              setError("");
              setSuccess("");
              setModalOpen(true);
            }}
            className="flex h-11 items-center gap-2 rounded-xl bg-green-500 px-5 text-sm font-bold text-black transition hover:bg-green-400"
          >
            <Plus size={19} />
            ایجاد کسب‌وکار
          </button>
        </header>

        {success && (
          <div className="mb-6 rounded-xl border border-green-500/20 bg-green-500/10 p-4 text-sm text-green-400">
            {success}
          </div>
        )}

        {error && (
          <div className="mb-6 flex items-center justify-between gap-3 rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-400">
            <span>{error}</span>
            <button onClick={() => setError("")} aria-label="بستن">
              <X size={17} />
            </button>
          </div>
        )}

        <section className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            title="کل کسب‌وکارها"
            value={businesses.length}
            icon={<Building2 size={21} />}
            color="text-blue-400"
            loading={loading}
          />
          <StatCard
            title="حساب‌های فعال"
            value={activeCount}
            icon={<CheckCircle2 size={21} />}
            color="text-green-400"
            loading={loading}
          />
          <StatCard
            title="حساب‌های غیرفعال"
            value={inactiveCount}
            icon={<Clock3 size={21} />}
            color="text-red-400"
            loading={loading}
          />
          <StatCard
            title="مدیران کسب‌وکار"
            value={businesses.length}
            icon={<Users size={21} />}
            color="text-purple-400"
            loading={loading}
          />
        </section>

        <section className="overflow-hidden rounded-2xl border border-[#222d38] bg-[#111820]">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#222d38] p-5">
            <div>
              <h2 className="font-bold">کسب‌وکارهای ثبت‌شده</h2>
              <p className="mt-1 text-xs text-slate-500">
                مدیریت حساب مشتریان سیستم
              </p>
            </div>

            <div className="flex h-10 w-full max-w-xs items-center gap-2 rounded-xl border border-[#293642] bg-[#0b0f14] px-3">
              <Search size={17} className="text-slate-500" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="جست‌وجوی کسب‌وکار یا مدیر..."
                className="w-full bg-transparent text-sm outline-none placeholder:text-slate-600"
              />
            </div>
          </div>

          {loading ? (
            <div className="flex min-h-64 items-center justify-center gap-3 text-sm text-slate-400">
              <Loader2 size={20} className="animate-spin" />
              در حال دریافت اطلاعات...
            </div>
          ) : filteredBusinesses.length === 0 ? (
            <div className="flex min-h-64 flex-col items-center justify-center px-5 text-center">
              <Building2 size={36} className="mb-4 text-slate-600" />
              <p className="font-semibold">
                {search ? "نتیجه‌ای پیدا نشد." : "هنوز کسب‌وکاری ثبت نشده است."}
              </p>
              <p className="mt-2 text-sm text-slate-500">
                {search
                  ? "عبارت جست‌وجو را تغییر دهید."
                  : "اولین کسب‌وکار را ایجاد کنید."}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[950px] text-right text-sm">
                <thead className="bg-[#151e28] text-xs text-slate-400">
                  <tr>
                    <th className="px-5 py-4">کسب‌وکار</th>
                    <th className="px-5 py-4">مدیر حساب</th>
                    <th className="px-5 py-4">نام کاربری</th>
                    <th className="px-5 py-4">تاریخ ایجاد</th>
                    <th className="px-5 py-4">اطلاعات</th>
                    <th className="px-5 py-4">وضعیت</th>
                    <th className="px-5 py-4">عملیات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#222d38]">
                  {filteredBusinesses.map((business) => (
                    <tr key={business.id} className="transition hover:bg-white/[0.02]">
                      <td className="px-5 py-4 font-semibold">
                        {business.name}
                        <p className="mt-1 text-xs font-normal text-slate-500">
                          {business.phone || "بدون شماره تماس"}
                        </p>
                      </td>
                      <td className="px-5 py-4">
                        {business.owner.fullName}
                      </td>
                      <td className="px-5 py-4 text-slate-400" dir="ltr">
                        {business.owner.username}
                      </td>
                      <td className="px-5 py-4 text-slate-400">
                        {formatDate(business.createdAt)}
                      </td>
                      <td className="px-5 py-4 text-xs text-slate-400">
                        <div className="flex flex-col gap-1">
                          <span>{business._count.products} کالا</span>
                          <span>{business._count.contacts} مخاطب</span>
                          <span>{business._count.invoices} فاکتور</span>
                        </div>
                      </td>
                      <td className="px-5 py-4">
                        <span
                          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs ${
                            business.isActive
                              ? "bg-green-500/10 text-green-400"
                              : "bg-red-500/10 text-red-400"
                          }`}
                        >
                          <span className="h-1.5 w-1.5 rounded-full bg-current" />
                          {business.isActive ? "فعال" : "غیرفعال"}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => openEditModal(business)}
                            disabled={updatingBusinessId !== null || editSaving}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-blue-500/20 bg-blue-500/10 px-3 py-2 text-xs font-semibold text-blue-400 transition hover:bg-blue-500/20 disabled:opacity-50"
                          >
                            <Pencil size={14} />
                            ویرایش
                          </button>

                          <button
                            onClick={() => void toggleBusinessStatus(business)}
                            disabled={updatingBusinessId !== null || editSaving}
                            className={`inline-flex min-w-28 items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
                              business.isActive
                                ? "border border-red-500/20 bg-red-500/10 text-red-400 hover:bg-red-500/20"
                                : "border border-green-500/20 bg-green-500/10 text-green-400 hover:bg-green-500/20"
                            }`}
                          >
                            {updatingBusinessId === business.id ? (
                              <Loader2 size={15} className="animate-spin" />
                            ) : business.isActive ? (
                              <PauseCircle size={15} />
                            ) : (
                              <PlayCircle size={15} />
                            )}

                            {business.isActive ? "تعلیق حساب" : "فعال‌سازی"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex items-center justify-between border-t border-[#222d38] px-5 py-4 text-xs text-slate-500">
            <span>
              نمایش {filteredBusinesses.length} از {businesses.length} کسب‌وکار
            </span>
            <button
              onClick={() => void loadBusinesses()}
              disabled={loading}
              className="flex items-center gap-2 transition hover:text-white disabled:opacity-50"
            >
              <Activity size={15} />
              بروزرسانی
            </button>
          </div>
        </section>

        {modalOpen && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget && !saving) {
                setModalOpen(false);
              }
            }}
          >
            <div className="my-auto flex h-[calc(100dvh-2rem)] w-full flex-col overflow-hidden rounded-2xl border border-[#293642] bg-[#111820] shadow-2xl">
              <div className="flex items-center justify-between border-b border-[#222d38] p-5">
                <div>
                  <h2 className="text-lg font-bold">ایجاد کسب‌وکار جدید</h2>
                  <p className="mt-1 text-xs text-slate-500">
                    اطلاعات مجموعه و مدیر آن را وارد کنید.
                  </p>
                </div>
                <button
                  onClick={() => setModalOpen(false)}
                  disabled={saving}
                  className="rounded-lg p-2 text-slate-400 hover:bg-white/5 hover:text-white"
                  aria-label="بستن"
                >
                  <X size={20} />
                </button>
              </div>

              <form onSubmit={createBusiness} className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
                <div>
                  <p className="mb-3 text-sm font-semibold text-green-400">
                    اطلاعات کسب‌وکار
                  </p>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field
                      label="نام کسب‌وکار"
                      value={form.businessName}
                      onChange={(value) => setForm({ ...form, businessName: value })}
                      placeholder="مثلاً فروشگاه مرکزی"
                      required
                    />
                    <Field
                      label="شماره تماس"
                      value={form.phone}
                      onChange={(value) => setForm({ ...form, phone: value })}
                      placeholder="اختیاری"
                    />
                  </div>
                </div>

                <div className="border-t border-[#222d38] pt-5">
                  <p className="mb-3 text-sm font-semibold text-green-400">
                    اطلاعات مدیر کسب‌وکار
                  </p>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field
                      label="نام و نام خانوادگی"
                      value={form.ownerFullName}
                      onChange={(value) => setForm({ ...form, ownerFullName: value })}
                      placeholder="نام مدیر"
                      required
                    />
                    <Field
                      label="نام کاربری"
                      value={form.ownerUsername}
                      onChange={(value) => setForm({ ...form, ownerUsername: value })}
                      placeholder="username"
                      required
                      dir="ltr"
                    />
                    <div className="sm:col-span-2">
                      <Field
                        label="رمز عبور اولیه"
                        value={form.ownerPassword}
                        onChange={(value) => setForm({ ...form, ownerPassword: value })}
                        placeholder="حداقل ۱۲ کاراکتر"
                        required
                        dir="ltr"
                        type="password"
                      />
                      <p className="mt-2 text-xs text-slate-500">
                        مدیر در اولین ورود باید رمز عبور خود را تغییر دهد.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex gap-3 border-t border-[#222d38] pt-5">
                  <button
                    type="submit"
                    disabled={saving}
                    className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-green-500 text-sm font-bold text-black transition hover:bg-green-400 disabled:opacity-50"
                  >
                    {saving ? (
                      <>
                        <Loader2 size={17} className="animate-spin" />
                        در حال ثبت...
                      </>
                    ) : (
                      <>
                        <Plus size={17} />
                        ایجاد کسب‌وکار
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => setModalOpen(false)}
                    disabled={saving}
                    className="rounded-xl border border-[#293642] px-5 text-sm text-slate-300 hover:bg-white/5"
                  >
                    انصراف
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
        {editingBusiness && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget && !editSaving) {
                setEditingBusiness(null);
              }
            }}
          >
            <div className="my-auto flex h-[calc(100dvh-2rem)] w-full flex-col overflow-hidden rounded-2xl border border-[#293642] bg-[#111820] shadow-2xl">
              <div className="flex items-center justify-between border-b border-[#222d38] p-5">
                <div>
                  <h2 className="text-lg font-bold">ویرایش کسب‌وکار</h2>
                  <p className="mt-1 text-xs text-slate-500">
                    اطلاعات کسب‌وکار و مدیر آن را ویرایش کنید.
                  </p>
                </div>

                <button
                  onClick={() => setEditingBusiness(null)}
                  disabled={editSaving}
                  className="rounded-lg p-2 text-slate-400 hover:bg-white/5 hover:text-white"
                  aria-label="بستن"
                >
                  <X size={20} />
                </button>
              </div>

              <form onSubmit={updateBusiness} className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
                <div>
                  <p className="mb-3 text-sm font-semibold text-green-400">
                    اطلاعات کسب‌وکار
                  </p>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field
                      label="نام کسب‌وکار"
                      value={editForm.businessName}
                      onChange={(value) =>
                        setEditForm({ ...editForm, businessName: value })
                      }
                      placeholder="نام کسب‌وکار"
                      required
                    />

                    <Field
                      label="شماره تماس"
                      value={editForm.phone}
                      onChange={(value) =>
                        setEditForm({ ...editForm, phone: value })
                      }
                      placeholder="شماره تماس"
                    />
                  </div>
                </div>

                <div className="border-t border-[#222d38] pt-5">
                  <p className="mb-3 text-sm font-semibold text-green-400">
                    اطلاعات مدیر
                  </p>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field
                      label="نام و نام خانوادگی"
                      value={editForm.ownerFullName}
                      onChange={(value) =>
                        setEditForm({ ...editForm, ownerFullName: value })
                      }
                      placeholder="نام مدیر"
                      required
                    />

                    <Field
                      label="نام کاربری"
                      value={editForm.ownerUsername}
                      onChange={(value) =>
                        setEditForm({ ...editForm, ownerUsername: value })
                      }
                      placeholder="username"
                      required
                      dir="ltr"
                    />
                  </div>
                </div>

                <div className="flex gap-3 border-t border-[#222d38] pt-5">
                  <button
                    type="submit"
                    disabled={editSaving}
                    className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-green-500 text-sm font-bold text-black transition hover:bg-green-400 disabled:opacity-50"
                  >
                    {editSaving ? (
                      <>
                        <Loader2 size={17} className="animate-spin" />
                        در حال ذخیره...
                      </>
                    ) : (
                      <>
                        <Save size={17} />
                        ذخیره تغییرات
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => setEditingBusiness(null)}
                    disabled={editSaving}
                    className="rounded-xl border border-[#293642] px-5 text-sm text-slate-300 hover:bg-white/5"
                  >
                    انصراف
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

function StatCard({
  title,
  value,
  icon,
  color,
  loading,
}: {
  title: string;
  value: number;
  icon: React.ReactNode;
  color: string;
  loading: boolean;
}) {
  return (
    <div className="rounded-2xl border border-[#222d38] bg-[#111820] p-5">
      <div className="mb-5 flex items-center justify-between">
        <span className="text-sm text-slate-400">{title}</span>
        <span className={color}>{icon}</span>
      </div>
      <p className="text-3xl font-bold tabular-nums">
        {loading ? "—" : value.toLocaleString("fa-IR")}
      </p>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  required = false,
  dir,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  required?: boolean;
  dir?: "ltr" | "rtl";
  type?: string;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-xs text-slate-300">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        required={required}
        dir={dir}
        minLength={type === "password" ? 12 : undefined}
        maxLength={type === "password" ? 200 : 120}
        className="h-11 w-full rounded-xl border border-[#293642] bg-[#0b0f14] px-3 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-green-500"
      />
    </label>
  );
}
