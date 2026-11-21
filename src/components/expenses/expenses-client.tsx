"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import DatePicker from "react-multi-date-picker";
import persian from "react-date-object/calendars/persian";
import persian_fa from "react-date-object/locales/persian_fa";
import gregorian from "react-date-object/calendars/gregorian";
import DateObject from "react-date-object";
import {
  Plus,
  Search,
  Pencil,
  Ban,
  X,
  RefreshCw,
  Wallet,
  TrendingDown,
  CheckCircle2,
  Filter,
} from "lucide-react";
import CursorPagination from "@/components/shared/cursor-pagination";
import NumericInput from "@/components/shared/numeric-input";
import useCursorPage from "@/hooks/use-cursor-page";
import useDebouncedValue from "@/hooks/use-debounced-value";
import type { QuickAction } from "@/lib/quick-actions";
import {
  enqueueOfflineOperation,
  getCachedEndpointCollection,
  getOfflineAccountKey,
  getOfflineOutboxOperations,
  isOfflineWorkspaceUnlocked,
} from "@/lib/offline-storage";
import {
  ExpenseCategory,
  PaymentMethod,
  ExpenseStatus,
} from "@prisma/client";

type CurrencyUnit = "RIAL" | "TOMAN";

type Expense = {
  id: string;
  title: string;
  category: ExpenseCategory;
  amount: string;
  method: PaymentMethod;
  status: ExpenseStatus | "PENDING";
  description: string | null;
  spentAt: string;
  createdAt: string;
  cancelledAt: string | null;
  cancelReason: string | null;
  offlineSyncStatus?: string;
};

const categories: { value: ExpenseCategory; label: string }[] = [
  { value: "RENT", label: "اجاره" },
  { value: "SALARY", label: "حقوق و دستمزد" },
  { value: "TRANSPORT", label: "حمل‌ونقل" },
  { value: "UTILITIES", label: "قبوض و خدمات" },
  { value: "ADVERTISING", label: "تبلیغات" },
  { value: "MAINTENANCE", label: "تعمیر و نگهداری" },
  { value: "TAX", label: "مالیات" },
  { value: "OTHER", label: "سایر" },
];

const methods: { value: PaymentMethod; label: string }[] = [
  { value: "CASH", label: "نقدی" },
  { value: "POS", label: "کارت‌خوان" },
  { value: "CARD_TO_CARD", label: "کارت‌به‌کارت" },
  { value: "BANK_TRANSFER", label: "انتقال بانکی" },
  { value: "CHECK", label: "چک" },
];

function toEnglishDigits(value: string) {
  return value.replace(/[۰-۹]/g, (digit) =>
    String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)),
  );
}

function formatAmount(amount: string, currencyUnit: CurrencyUnit) {
  const value = BigInt(amount);
  const displayValue =
    currencyUnit === "TOMAN" ? value / BigInt(10) : value;

  return new Intl.NumberFormat("fa-IR").format(displayValue);
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("fa-IR-u-ca-persian", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Tehran",
  });
}

function getDateValue(value?: string | null) {
  const date = value ? new Date(value) : new Date();

  return new DateObject({
    date,
    calendar: persian,
    locale: persian_fa,
  });
}

function getGregorianDate(value: DateObject) {
  const date = value.convert(gregorian);
  return toEnglishDigits(date.format("YYYY-MM-DD"));
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="flex h-[calc(100dvh-2rem)] w-full flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#151b26] shadow-2xl">
        <div className="sticky top-0 flex items-center justify-between border-b border-white/10 bg-[#151b26] px-5 py-4">
          <h2 className="text-lg font-bold text-white">{title}</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-gray-400 transition hover:bg-white/10 hover:text-white"
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
      <span className="text-sm font-medium text-gray-300">{label}</span>
      {children}
    </label>
  );
}

const inputClass =
  "w-full rounded-xl border border-white/10 bg-[#0d131d] px-3 py-3 text-sm text-white outline-none transition placeholder:text-gray-600 focus:border-emerald-500";

const initialForm = {
  title: "",
  category: "OTHER" as ExpenseCategory,
  amount: "",
  method: "CASH" as PaymentMethod,
  description: "",
  spentAt: getGregorianDate(getDateValue()),
};

export default function ExpensesClient({
  currencyUnit,
  userId,
  businessId,
  quickAction,
}: {
  currencyUnit: CurrencyUnit;
  userId: string;
  businessId: string;
  quickAction?: QuickAction | null;
}) {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [startDate, setStartDate] = useState<DateObject | null>(null);
  const [endDate, setEndDate] = useState<DateObject | null>(null);
  const [appliedFilters, setAppliedFilters] = useState(0);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(initialForm);
  const [totalCount, setTotalCount] = useState(0);
  const [serverStats, setServerStats] = useState<{
    count: number;
    cancelled: number;
    total: string;
  } | null>(null);
  const debouncedSearch = useDebouncedValue(search);
  const paging = useCursorPage();

  useEffect(() => {
    if (
      quickAction?.action === "expense" &&
      quickAction.targetView === "expenses"
    ) openCreate();
  }, [quickAction?.requestId, quickAction?.action]);

  const loadExpenses = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError("");

    try {
      const params = new URLSearchParams();

      params.set("limit", "50");
      if (paging.cursor) params.set("cursor", paging.cursor);
      if (debouncedSearch.trim()) params.set("search", debouncedSearch.trim());
      if (categoryFilter !== "ALL") {
        params.set("category", categoryFilter);
      }
      if (statusFilter !== "ALL") params.set("status", statusFilter);

      if (appliedFilters > 0) {
        if (startDate) {
          params.set("startDate", getGregorianDate(startDate));
        }
        if (endDate) {
          params.set("endDate", getGregorianDate(endDate));
        }
      }

      const response = await fetch(`/api/expenses?${params.toString()}`, { signal });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "دریافت هزینه‌ها ناموفق بود.");
      }

      setExpenses(data.expenses);
      setTotalCount(data.total);
      setServerStats(data.stats);
      paging.setNextCursor(data.nextCursor ?? null);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      if (!navigator.onLine || err instanceof TypeError) {
        try {
          const account = getOfflineAccountKey(userId, businessId);
          if (!isOfflineWorkspaceUnlocked(account)) {
            throw new Error("برای مشاهده هزینه‌های ذخیره‌شده، قفل محلی حساب را باز کنید.");
          }
          const [cached, operations] = await Promise.all([
            getCachedEndpointCollection(account, "/api/expenses", "expenses"),
            getOfflineOutboxOperations(account),
          ]);
          const byId = new Map(
            (cached as Expense[]).map((expense) => [expense.id, expense]),
          );
          for (const operation of operations) {
            if (operation.entityType !== "expense") continue;
            const request = operation.payload as {
              path?: unknown;
              body?: Record<string, unknown>;
            };
            const body = request.body;
            if (
              request.path !== "/api/expenses" ||
              !body ||
              typeof body.id !== "string" ||
              typeof body.title !== "string" ||
              typeof body.amount !== "number"
            ) continue;
            byId.set(body.id, {
              id: body.id,
              title: body.title,
              category: body.category as ExpenseCategory,
              amount: (BigInt(body.amount) * (currencyUnit === "TOMAN" ? 10n : 1n)).toString(),
              method: body.method as PaymentMethod,
              status: operation.status === "synced" ? "CONFIRMED" : "PENDING",
              description: typeof body.description === "string" ? body.description : null,
              spentAt: typeof body.spentAt === "string" ? body.spentAt : operation.createdAt,
              createdAt: operation.createdAt,
              cancelledAt: null,
              cancelReason: null,
              offlineSyncStatus: operation.status,
            });
          }
          const query = debouncedSearch.trim().toLocaleLowerCase();
          const filtered = [...byId.values()]
            .filter((expense) => statusFilter === "ALL" || expense.status === statusFilter)
            .filter((expense) => categoryFilter === "ALL" || expense.category === categoryFilter)
            .filter((expense) =>
              !query || `${expense.title} ${expense.description ?? ""}`
                .toLocaleLowerCase().includes(query)
            )
            .filter((expense) => {
              if (!appliedFilters) return true;
              const date = expense.spentAt.slice(0, 10);
              const start = startDate ? getGregorianDate(startDate) : null;
              const end = endDate ? getGregorianDate(endDate) : null;
              return (!start || date >= start) && (!end || date <= end);
            })
            .sort((left, right) => right.spentAt.localeCompare(left.spentAt));
          setExpenses(filtered);
          setTotalCount(filtered.length);
          setServerStats(null);
          paging.setNextCursor(null);
          setError("");
          return;
        } catch (cacheError) {
          console.error("Offline expense list load failed:", cacheError);
        }
      }
      setError(
        err instanceof Error ? err.message : "خطا در دریافت هزینه‌ها.",
      );
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [
    debouncedSearch,
    categoryFilter,
    statusFilter,
    appliedFilters,
    startDate,
    endDate,
    paging.cursor,
    paging.setNextCursor,
    userId,
    businessId,
    currencyUnit,
  ]);

  useEffect(() => {
    const controller = new AbortController();
    void loadExpenses(controller.signal);
    return () => controller.abort();
  }, [loadExpenses]);

  useEffect(() => {
    const refresh = () => void loadExpenses();
    window.addEventListener("online", refresh);
    window.addEventListener("hirad-offline-workspace-unlocked", refresh);
    window.addEventListener("hirad-offline-sync-succeeded", refresh);
    window.addEventListener("hirad-offline-outbox-updated", refresh);
    return () => {
      window.removeEventListener("online", refresh);
      window.removeEventListener("hirad-offline-workspace-unlocked", refresh);
      window.removeEventListener("hirad-offline-sync-succeeded", refresh);
      window.removeEventListener("hirad-offline-outbox-updated", refresh);
    };
  }, [loadExpenses]);

  const stats = useMemo(() => {
    if (serverStats) {
      return {
        total: BigInt(serverStats.total),
        count: serverStats.count,
        cancelled: serverStats.cancelled,
      };
    }

    const confirmed = expenses.filter(
      (expense) => expense.status === "CONFIRMED",
    );

    const total = confirmed.reduce(
      (sum, expense) => sum + BigInt(expense.amount),
      BigInt(0),
    );

    return {
      total,
      count: confirmed.length,
      cancelled: expenses.filter(
        (expense) => expense.status === "CANCELLED",
      ).length,
    };
  }, [expenses, serverStats]);

  function openCreate() {
    setEditing(null);
    setForm({
      ...initialForm,
      spentAt: getGregorianDate(getDateValue()),
    });
    setModalOpen(true);
  }

  function openEdit(expense: Expense) {
    setEditing(expense);
    setForm({
      title: expense.title,
      category: expense.category,
      amount: (
        currencyUnit === "TOMAN"
          ? BigInt(expense.amount) / BigInt(10)
          : BigInt(expense.amount)
      ).toString(),
      method: expense.method,
      description: expense.description || "",
      spentAt: getGregorianDate(getDateValue(expense.spentAt)),
    });
    setModalOpen(true);
  }

  async function saveExpense(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!form.title.trim() || !form.amount || Number(form.amount) <= 0) {
      return;
    }

    setSaving(true);
    setError("");
    let pendingCreate: { id: string; body: Record<string, unknown> } | null = null;
    let offlineEnqueued = false;

    try {
      if (!navigator.onLine && editing) {
        throw new Error("ویرایش هزینه بدون اتصال برای جلوگیری از تعارض پشتیبانی نمی‌شود.");
      }
      const createId = editing ? null : crypto.randomUUID();
      const body = {
        ...form,
        amount: Number(form.amount),
        spentAt: new Date(`${form.spentAt}T12:00:00.000Z`).toISOString(),
        ...(createId ? { id: createId } : {}),
      };
      if (createId) pendingCreate = { id: createId, body };
      const saveOfflineExpense = async () => {
        if (!pendingCreate) {
          throw new Error("ویرایش هزینه آفلاین پشتیبانی نمی‌شود.");
        }
        const account = getOfflineAccountKey(userId, businessId);
        if (!isOfflineWorkspaceUnlocked(account)) {
          throw new Error("برای نگهداری امن عملیات آفلاین، ابتدا قفل محلی حساب را باز کنید.");
        }
        await enqueueOfflineOperation(account, {
          entityType: "expense",
          entityId: pendingCreate.id,
          idempotencyKey: pendingCreate.id,
          payload: { path: "/api/expenses", method: "POST", body: pendingCreate.body },
        });
        offlineEnqueued = true;
        setModalOpen(false);
        setEditing(null);
        setSuccess("هزینه روی این دستگاه ذخیره شد؛ تا همگام‌سازی با سرور، ثبت نهایی نشده است.");
        await loadExpenses();
      };
      if (!navigator.onLine && !editing) {
        await saveOfflineExpense();
        return;
      }

      const response = await fetch(editing ? `/api/expenses/${editing.id}` : "/api/expenses", {
        method: editing ? "PATCH" : "POST",
        headers: {
          "Content-Type": "application/json",
          ...(createId ? { "Idempotency-Key": createId } : {}),
        },
        body: JSON.stringify(body),
      });

      const data = await response.json();

      if (!response.ok) {
        if (response.status >= 500 && pendingCreate) {
          await saveOfflineExpense();
          return;
        }
        throw new Error(data.error || "ذخیره هزینه انجام نشد.");
      }

      setModalOpen(false);
      await loadExpenses();
    } catch (err) {
      if (
        !offlineEnqueued &&
        pendingCreate &&
        (!navigator.onLine || err instanceof TypeError)
      ) {
        try {
          const account = getOfflineAccountKey(userId, businessId);
          if (!isOfflineWorkspaceUnlocked(account)) {
            throw new Error("برای نگهداری امن عملیات آفلاین، ابتدا قفل محلی حساب را باز کنید.");
          }
          await enqueueOfflineOperation(account, {
            entityType: "expense",
            entityId: pendingCreate.id,
            idempotencyKey: pendingCreate.id,
            payload: { path: "/api/expenses", method: "POST", body: pendingCreate.body },
          });
          setModalOpen(false);
          setEditing(null);
          setSuccess("هزینه روی این دستگاه ذخیره شد؛ تا همگام‌سازی با سرور، ثبت نهایی نشده است.");
          await loadExpenses();
          return;
        } catch (offlineError) {
          setError(offlineError instanceof Error ? offlineError.message : "ذخیره آفلاین هزینه ناموفق بود.");
          return;
        }
      }
      setError(err instanceof Error ? err.message : "خطا در ذخیره هزینه.");
    } finally {
      setSaving(false);
    }
  }

  async function cancelExpense(expense: Expense) {
    const reason = window.prompt("دلیل لغو این هزینه را وارد کنید:");

    if (!reason || reason.trim().length < 3) return;

    if (!window.confirm("از لغو این هزینه مطمئن هستید؟")) return;

    try {
      const response = await fetch(`/api/expenses/${expense.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason.trim() }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "لغو هزینه انجام نشد.");
      }

      await loadExpenses();
    } catch (err) {
      setError(err instanceof Error ? err.message : "خطا در لغو هزینه.");
    }
  }

  return (
    <div className="space-y-6 text-right" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">مدیریت هزینه‌ها</h1>
          <p className="mt-1 text-sm text-gray-400">
            ثبت و مدیریت مخارج کسب‌وکار
          </p>
        </div>

        <button
          onClick={openCreate}
          className="flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-3 text-sm font-bold text-[#07130e] transition hover:bg-emerald-400"
        >
          <Plus size={18} />
          ثبت هزینه جدید
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-white/10 bg-[#151b26] p-5">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-400">مجموع هزینه‌های تأییدشده</span>
            <Wallet className="text-emerald-400" size={21} />
          </div>
          <div className="mt-4 text-xl font-bold text-white">
            {formatAmount(stats.total.toString(), currencyUnit)}
            <span className="mr-2 text-xs text-gray-400">
              {currencyUnit === "TOMAN" ? "تومان" : "ریال"}
            </span>
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-[#151b26] p-5">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-400">تعداد هزینه‌های تأییدشده</span>
            <TrendingDown className="text-amber-400" size={21} />
          </div>
          <div className="mt-4 text-2xl font-bold text-white">
            {new Intl.NumberFormat("fa-IR").format(stats.count)}
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-[#151b26] p-5">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-400">هزینه‌های لغوشده</span>
            <Ban className="text-red-400" size={21} />
          </div>
          <div className="mt-4 text-2xl font-bold text-white">
            {new Intl.NumberFormat("fa-IR").format(stats.cancelled)}
          </div>
        </div>
      </div>

      <div className="space-y-4 rounded-2xl border border-white/10 bg-[#151b26] p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
          <div className="relative">
            <Search
              size={17}
              className="absolute right-3 top-3.5 text-gray-500"
            />
            <input
              value={search}
              onChange={(event) => {
                paging.resetPages();
                setSearch(event.target.value);
              }}
              placeholder="جست‌وجوی عنوان یا توضیحات..."
              className={`${inputClass} pr-10`}
            />
          </div>

          <select
            value={categoryFilter}
            onChange={(event) => {
              paging.resetPages();
              setCategoryFilter(event.target.value);
            }}
            className={inputClass}
          >
            <option value="ALL">همه دسته‌بندی‌ها</option>
            {categories.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>

          <select
            value={statusFilter}
            onChange={(event) => {
              paging.resetPages();
              setStatusFilter(event.target.value);
            }}
            className={inputClass}
          >
            <option value="ALL">همه وضعیت‌ها</option>
            <option value="CONFIRMED">تأییدشده</option>
            <option value="CANCELLED">لغوشده</option>
          </select>

          <button
            onClick={() => void loadExpenses()}
            className="flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-gray-200 transition hover:bg-white/10"
          >
            <RefreshCw size={16} />
            بروزرسانی
          </button>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="از تاریخ">
            <DatePicker
              calendar={persian}
              locale={persian_fa}
              value={startDate}
              onChange={(value) => setStartDate(value)}
              format="YYYY/MM/DD"
              calendarPosition="bottom-right"
              inputClass={inputClass}
              placeholder="انتخاب تاریخ شروع"
              editable={false}
            />
          </Field>

          <Field label="تا تاریخ">
            <DatePicker
              calendar={persian}
              locale={persian_fa}
              value={endDate}
              onChange={(value) => setEndDate(value)}
              format="YYYY/MM/DD"
              calendarPosition="bottom-right"
              inputClass={inputClass}
              placeholder="انتخاب تاریخ پایان"
              editable={false}
            />
          </Field>

          <button
            onClick={() => {
              paging.resetPages();
              setAppliedFilters((value) => value + 1);
            }}
            className="flex items-center justify-center gap-2 rounded-xl bg-white/10 px-4 py-3 text-sm text-white transition hover:bg-white/15 md:col-span-2 md:justify-self-center md:min-w-40"
          >
            <Filter size={16} />
            اعمال فیلتر تاریخ
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center justify-between rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-300">
          <span>{error}</span>
          <button onClick={() => setError("")}>
            <X size={18} />
          </button>
        </div>
      )}
      {success && (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-200">
          {success}
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#151b26]">
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <h2 className="font-bold text-white">فهرست هزینه‌ها</h2>
          <span className="text-xs text-gray-400">
            {new Intl.NumberFormat("fa-IR").format(expenses.length)} مورد
          </span>
        </div>

        {loading ? (
          <div className="p-12 text-center text-sm text-gray-400">
            در حال دریافت اطلاعات...
          </div>
        ) : expenses.length === 0 ? (
          <div className="p-12 text-center text-sm text-gray-400">
            <Wallet size={32} className="mx-auto mb-3 opacity-40" />
            هزینه‌ای برای نمایش وجود ندارد.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[850px] text-sm">
              <thead className="bg-white/[0.03] text-gray-400">
                <tr>
                  <th className="px-5 py-4 text-right font-medium">عنوان</th>
                  <th className="px-5 py-4 text-right font-medium">دسته‌بندی</th>
                  <th className="px-5 py-4 text-right font-medium">مبلغ</th>
                  <th className="px-5 py-4 text-right font-medium">روش پرداخت</th>
                  <th className="px-5 py-4 text-right font-medium">تاریخ</th>
                  <th className="px-5 py-4 text-right font-medium">وضعیت</th>
                  <th className="px-5 py-4 text-center font-medium">عملیات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {expenses.map((expense) => (
                  <tr
                    key={expense.id}
                    className="transition hover:bg-white/[0.025]"
                  >
                    <td className="px-5 py-4">
                      <div className="font-medium text-white">{expense.title}</div>
                      {expense.description && (
                        <div className="mt-1 max-w-48 truncate text-xs text-gray-500">
                          {expense.description}
                        </div>
                      )}
                    </td>
                    <td className="px-5 py-4 text-gray-300">
                      {categories.find((item) => item.value === expense.category)?.label}
                    </td>
                    <td className="px-5 py-4 font-semibold text-white">
                      {formatAmount(expense.amount, currencyUnit)}
                      <span className="mr-1 text-xs text-gray-500">
                        {currencyUnit === "TOMAN" ? "تومان" : "ریال"}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-gray-300">
                      {methods.find((item) => item.value === expense.method)?.label}
                    </td>
                    <td className="px-5 py-4 text-gray-400">
                      {formatDate(expense.spentAt)}
                    </td>
                    <td className="px-5 py-4">
                      {expense.status === "CONFIRMED" ? (
                        <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-500/10 px-2.5 py-1.5 text-xs text-emerald-400">
                          <CheckCircle2 size={14} />
                          تأییدشده
                        </span>
                      ) : expense.status === "PENDING" ? (
                        <span className="rounded-lg bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-300">
                          در انتظار همگام‌سازی؛ ثبت نهایی نشده
                        </span>
                      ) : (
                        <span className="rounded-lg bg-red-500/10 px-2.5 py-1.5 text-xs text-red-400">
                          لغوشده
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-4">
                      {expense.status === "CONFIRMED" && (
                        <div className="flex items-center justify-center gap-2">
                          <button
                            onClick={() => openEdit(expense)}
                            title="ویرایش"
                            className="rounded-lg p-2 text-blue-400 transition hover:bg-blue-500/10"
                          >
                            <Pencil size={16} />
                          </button>
                          <button
                            onClick={() => void cancelExpense(expense)}
                            title="لغو هزینه"
                            className="rounded-lg p-2 text-red-400 transition hover:bg-red-500/10"
                          >
                            <Ban size={16} />
                          </button>
                        </div>
                      )}
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
        <Modal
          title={editing ? "ویرایش هزینه" : "ثبت هزینه جدید"}
          onClose={() => setModalOpen(false)}
        >
          <form onSubmit={saveExpense} className="space-y-4">
            <Field label="عنوان هزینه">
              <input
                required
                minLength={2}
                maxLength={150}
                value={form.title}
                onChange={(event) =>
                  setForm({ ...form, title: event.target.value })
                }
                placeholder="مثلاً اجاره دفتر"
                className={inputClass}
              />
            </Field>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="دسته‌بندی">
                <select
                  value={form.category}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      category: event.target.value as ExpenseCategory,
                    })
                  }
                  className={inputClass}
                >
                  {categories.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label={`مبلغ (${currencyUnit === "TOMAN" ? "تومان" : "ریال"})`}>
                <NumericInput
                  required
                  min="1"
                  step="1"
                  value={form.amount}
                  onChange={(event) =>
                    setForm({ ...form, amount: event.target.value })
                  }
                  placeholder="مبلغ را وارد کنید"
                  className={inputClass}
                />
              </Field>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="روش پرداخت">
                <select
                  value={form.method}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      method: event.target.value as PaymentMethod,
                    })
                  }
                  className={inputClass}
                >
                  {methods.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="تاریخ هزینه">
                <DatePicker
                  calendar={persian}
                  locale={persian_fa}
                  value={getDateValue(form.spentAt)}
                  onChange={(value) => {
                    if (!value) return;

                    setForm({
                        ...form,
                        spentAt: getGregorianDate(value),
                    });
                   }}
                  format="YYYY/MM/DD"
                  calendarPosition="bottom-right"
                  inputClass={inputClass}
                  editable={false}
                />
              </Field>
            </div>

            <Field label="توضیحات (اختیاری)">
              <textarea
                rows={3}
                maxLength={1000}
                value={form.description}
                onChange={(event) =>
                  setForm({ ...form, description: event.target.value })
                }
                placeholder="توضیحات بیشتر..."
                className={inputClass}
              />
            </Field>

            <div className="flex justify-end gap-3 border-t border-white/10 pt-4">
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="rounded-xl border border-white/10 px-5 py-3 text-sm text-gray-300 transition hover:bg-white/5"
              >
                انصراف
              </button>

              <button
                type="submit"
                disabled={saving}
                className="rounded-xl bg-emerald-500 px-6 py-3 text-sm font-bold text-[#07130e] transition hover:bg-emerald-400 disabled:opacity-50"
              >
                {saving ? "در حال ذخیره..." : editing ? "ذخیره تغییرات" : "ثبت هزینه"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}