"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";

import {
  LayoutDashboard,
  Package,
  ShoppingCart,
  ReceiptText,
  Users,
  ChartNoAxesCombined,
  Settings,
  Plus,
  ArrowUpLeft,
  ArrowDownRight,
  Wallet,
  TrendingUp,
  FileText,
  MoreHorizontal,
  LogOut,
  KeyRound,
  X,
  Menu as MenuIcon,
  UserRound,
  RefreshCw,
} from "lucide-react";

import { useEffect, useState } from "react";
import type { ElementType } from "react";
import type { QuickAction } from "@/lib/quick-actions";

function SectionLoading() {
  return (
    <div
      role="status"
      className="rounded-2xl border border-[#222d38] bg-[#111820] p-8 text-center text-sm text-slate-400"
    >
      در حال بارگذاری بخش...
    </div>
  );
}

const InventoryClient = dynamic(
  () => import("@/components/inventory/inventory-client"),
  { loading: SectionLoading }
);
const ContactsClient = dynamic(
  () => import("@/components/contacts/contacts-client"),
  { loading: SectionLoading }
);
const InvoicesClient = dynamic(
  () => import("@/components/invoices/invoices-client"),
  { loading: SectionLoading }
);
const PaymentsClient = dynamic(
  () => import("@/components/payments/payments-client"),
  { loading: SectionLoading }
);
const ExpensesClient = dynamic(
  () => import("@/components/expenses/expenses-client"),
  { loading: SectionLoading }
);
const ReportsClient = dynamic(
  () => import("@/components/reports/reports-client"),
  { loading: SectionLoading }
);
const DashboardSalesChart = dynamic(
  () => import("@/components/dashboard/sales-chart"),
  {
    loading: () => (
      <div className="flex h-full items-center justify-center text-sm text-slate-500">
        در حال بارگذاری نمودار...
      </div>
    ),
  }
);

const menu = [
  { title: "داشبورد", icon: LayoutDashboard },
  { title: "مدیریت انبار", icon: Package },
  { title: "فاکتور خرید", icon: ShoppingCart },
  { title: "فاکتور فروش", icon: ReceiptText },
  { title: "مشتریان", icon: Users },
  { title: "گزارش‌های مالی", icon: ChartNoAxesCombined },
  { title: "دریافت و پرداخت", icon: Wallet },
  { title: "مدیریت هزینه‌ها", icon: Wallet },
];

type DashboardUser = {
  id: string;
  username: string;
  fullName: string;
  role: "SUPER_ADMIN" | "BUSINESS_OWNER";
  mustChangePassword: boolean;
  business: {
    id: string;
    name: string;
  } | null;
};

type CurrencyUnit = "RIAL" | "TOMAN";

type DashboardData = {
  currencyUnit: CurrencyUnit;
  stats: {
    sales: string;
    purchases: string;
    expenses: string;
    productCount: number;
    salesChange: number | null;
    purchasesChange: number | null;
    expensesChange: number | null;
  };
  salesTrend: {
    month: string;
    sales: number;
  }[];
  recentInvoices: {
    id: string;
    invoiceNumber: string | null;
    type: "SALE" | "PURCHASE";
    status: "DRAFT" | "CANCELLED" | "PAID" | "UNPAID" | "PARTIAL";
    amount: string;
    contactName: string;
    date: string;
  }[];
};

type CurrentView =
  | "dashboard"
  | "inventory"
  | "contacts"
  | "purchase-invoices"
  | "sales-invoices"
  | "payments"
  | "expenses"
  | "reports";

function formatAmount(amount: string, unit: CurrencyUnit) {
  let value = BigInt(amount);
  if (unit === "TOMAN") {
    value /= BigInt(10);
  }

  return new Intl.NumberFormat("fa-IR").format(value);
}

function formatPercentage(value: number) {
  const formatted = new Intl.NumberFormat("fa-IR", {
    maximumFractionDigits: 1,
  }).format(Math.abs(value));

  return `${value > 0 ? "+" : value < 0 ? "−" : ""}${formatted}٪`;
}

function formatDate(date: string) {
  return new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(date));
}

function StatCard({
  title,
  value,
  change,
  icon: Icon,
  positive,
  description,
}: {
  title: string;
  value: string;
  change?: number | null;
  icon: ElementType;
  positive?: boolean;
  description?: string;
}) {
  const hasChange = change !== undefined && change !== null;
  const isPositive =
    positive ?? (change !== null && change !== undefined && change >= 0);

  const [currencySaving, setCurrencySaving] = useState(false);
  const [currencyError, setCurrencyError] = useState("");
  const [currencySuccess, setCurrencySuccess] = useState("");

  return (
    <div className="rounded-2xl border border-[#222d38] bg-[#111820] p-5 transition hover:border-[#344454]">
      <div className="flex items-center justify-between">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#1c2934] text-green-400">
          <Icon size={21} />
        </div>
        <MoreHorizontal size={20} className="text-slate-500" />
      </div>

      <p className="mt-5 text-sm text-slate-400">{title}</p>

      <div className="mt-2 flex items-end justify-between gap-2">
        <h3 className="text-xl font-bold tracking-tight text-white">
          {value}
        </h3>

        {hasChange && (
          <span
            className={`flex items-center gap-1 text-xs ${
              isPositive ? "text-green-400" : "text-red-400"
            }`}
          >
            {isPositive ? (
              <ArrowUpLeft size={14} />
            ) : (
              <ArrowDownRight size={14} />
            )}
            {formatPercentage(change)}
          </span>
        )}
      </div>

      <p className="mt-2 text-xs text-slate-500">
        {description ??
          (hasChange ? "نسبت به ماه گذشته" : "آمار ثبت‌شده در کسب‌وکار")}
      </p>
    </div>
  );
}

function getInvoiceStatus(
  status: DashboardData["recentInvoices"][number]["status"]
) {
  switch (status) {
    case "PAID":
      return {
        label: "پرداخت شده",
        color: "text-green-400",
        bg: "bg-green-500/10",
      };
    case "PARTIAL":
      return {
        label: "پرداخت ناقص",
        color: "text-amber-400",
        bg: "bg-amber-500/10",
      };
    case "UNPAID":
      return {
        label: "پرداخت نشده",
        color: "text-red-400",
        bg: "bg-red-500/10",
      };
    case "DRAFT":
      return {
        label: "پیش‌نویس",
        color: "text-slate-400",
        bg: "bg-slate-500/10",
      };
    case "CANCELLED":
      return {
        label: "لغو شده",
        color: "text-red-400",
        bg: "bg-red-500/10",
      };
  }
}

export default function DashboardClient({
  user,
  initialView,
}: {
  user: DashboardUser;
  initialView: CurrentView;
}) {
  const router = useRouter();
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const [dashboardError, setDashboardError] = useState("");

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [currencySaving, setCurrencySaving] = useState(false);
  const [currencyError, setCurrencyError] = useState("");
  const [currencySuccess, setCurrencySuccess] = useState("");
  const [currentView, setCurrentView] = useState<CurrentView>(initialView);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [visitedViews, setVisitedViews] = useState<CurrentView[]>([initialView]);
  const [quickAction, setQuickAction] = useState<QuickAction | null>(null);
  const [quickActionRequestId, setQuickActionRequestId] = useState(0);

  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordError, setPasswordError] = useState("");
  const [passwordSuccess, setPasswordSuccess] = useState("");

  const [passwordForm, setPasswordForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });

  async function loadDashboard(signal?: AbortSignal) {
    setDashboardLoading(true);
    setDashboardError("");

    try {
      const response = await fetch("/api/dashboard", {
        method: "GET",
        cache: "no-store",
        signal,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "دریافت اطلاعات داشبورد ناموفق بود.");
      }

      setDashboard(data as DashboardData);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return;
      }

      setDashboardError(
        error instanceof Error
          ? error.message
          : "خطای غیرمنتظره رخ داد."
      );
    } finally {
      if (!signal?.aborted) {
        setDashboardLoading(false);
      }
    }
  }

  useEffect(() => {
    const controller = new AbortController();

    loadDashboard(controller.signal);

    return () => controller.abort();
  }, []);

  useEffect(() => {
    setCurrentView(initialView);
    setVisitedViews((previous) =>
      previous.includes(initialView) ? previous : [...previous, initialView]
    );
  }, [initialView]);

  useEffect(() => {
    if (!mobileMenuOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileMenuOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [mobileMenuOpen]);

  async function handleChangePassword(
    event: React.FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    setPasswordError("");
    setPasswordSuccess("");

    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setPasswordError("تکرار رمز عبور با رمز جدید مطابقت ندارد.");
      return;
    }

    if (passwordForm.newPassword.length < 12) {
      setPasswordError("رمز جدید باید حداقل ۱۲ کاراکتر باشد.");
      return;
    }

    setPasswordSaving(true);

    try {
      const response = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(passwordForm),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "تغییر رمز عبور ناموفق بود.");
      }

      setPasswordForm({
        currentPassword: "",
        newPassword: "",
        confirmPassword: "",
      });

      setPasswordSuccess("رمز عبور با موفقیت تغییر کرد.");
    } catch (error) {
      setPasswordError(
        error instanceof Error
          ? error.message
          : "خطای غیرمنتظره رخ داد."
      );
    } finally {
      setPasswordSaving(false);
    }
  }

  async function handleLogout() {
    const response = await fetch("/api/auth/logout", {
      method: "POST",
    });

    if (response.ok) {
      window.location.href = "/login";
    }
  }

  function navigateTo(view: CurrentView, action?: QuickAction["action"]) {
    setMobileMenuOpen(false);
    setCurrentView(view);
    setVisitedViews((previous) =>
      previous.includes(view) ? previous : [...previous, view]
    );
    if (window.location.search !== `?view=${encodeURIComponent(view)}`) {
      router.push(`/?view=${encodeURIComponent(view)}`, { scroll: false });
    }
    if (action && view !== "dashboard" && view !== "reports") {
      const requestId = quickActionRequestId + 1;
      setQuickActionRequestId(requestId);
      setQuickAction({ action, requestId, targetView: view });
    }
  }

  const currencyUnit = dashboard?.currencyUnit ?? "TOMAN";
  const currencyLabel = currencyUnit === "TOMAN" ? "تومان" : "ریال";

  const viewTitles: Record<CurrentView, { title: string; description: string }> =
    {
      dashboard: {
        title: "داشبورد",
        description: "نمای کلی وضعیت مالی کسب‌وکار شما",
      },
      inventory: {
        title: "مدیریت انبار",
        description: "مدیریت کالاها و موجودی کسب‌وکار",
      },
      contacts: {
        title: "مشتریان و طرف‌حساب‌ها",
        description: "مدیریت اطلاعات مشتریان و تأمین‌کنندگان",
      },
      "purchase-invoices": {
        title: "فاکتور خرید",
        description: "مدیریت فاکتورهای خرید کسب‌وکار",
      },
      "sales-invoices": {
        title: "فاکتور فروش",
        description: "مدیریت فاکتورهای فروش کسب‌وکار",
      },
      payments: {
        title: "دریافت و پرداخت",
        description: "مدیریت تراکنش‌های مالی",
      },
      expenses: {
        title: "مدیریت هزینه‌ها",
        description: "ثبت و مدیریت هزینه‌های کسب‌وکار",
      },
      reports: {
        title: "گزارش‌های مالی",
        description: "بررسی عملکرد مالی کسب‌وکار",
      },
    };

  const activeView = viewTitles[currentView];
  const viewByTitle: Record<string, CurrentView> = {
    داشبورد: "dashboard",
    "مدیریت انبار": "inventory",
    "فاکتور خرید": "purchase-invoices",
    "فاکتور فروش": "sales-invoices",
    مشتریان: "contacts",
    "گزارش‌های مالی": "reports",
    "دریافت و پرداخت": "payments",
    "مدیریت هزینه‌ها": "expenses",
  };
  const renderNavigation = () => menu.map((item) => {
    const targetView = viewByTitle[item.title];
    const isActive = currentView === targetView;
    return (
      <button
        key={item.title}
        type="button"
        onClick={() => navigateTo(targetView)}
        aria-current={isActive ? "page" : undefined}
        className={`flex w-full items-center gap-3 rounded-xl px-4 py-3 text-right text-sm transition ${
          isActive
            ? "bg-green-500/10 text-green-400"
            : "text-slate-400 hover:bg-[#1b2732] hover:text-white"
        }`}
      >
        <item.icon size={19} />
        <span>{item.title}</span>
      </button>
    );
  });

  return (
    <main className="min-h-screen bg-[#0b0f14] text-slate-100">
      <aside className="fixed right-0 top-0 z-20 hidden h-screen w-[255px] flex-col border-l border-[#222d38] bg-[#111820] lg:flex">
        <div className="flex h-[82px] items-center gap-3 border-b border-[#222d38] px-6">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-green-500 text-black">
            <Wallet size={22} />
          </div>

          <div>
            <h1 className="text-lg font-bold text-white">
              Hirad Accounting
            </h1>
            <p className="text-[11px] text-slate-500">
              سیستم مدیریت مالی
            </p>
          </div>
        </div>

        <div className="px-4 pt-7">
          <p className="mb-4 px-3 text-[11px] font-medium text-slate-500">
            منوی اصلی
          </p>

          <nav className="space-y-1" aria-label="منوی اصلی">
            {renderNavigation()}
          </nav>
        </div>

        <div className="mt-auto border-t border-[#222d38] p-4">
          <button
            type="button"
            onClick={() => {
              setPasswordError("");
              setPasswordSuccess("");
              setSettingsOpen(true);
            }}
            className="flex w-full items-center gap-3 rounded-xl p-3 text-right transition hover:bg-[#1b2732]"
          >
            <Settings size={19} className="text-slate-400" />
            <span className="text-sm text-slate-400">تنظیمات حساب</span>
          </button>

          <div className="mt-3 flex items-center gap-3 rounded-xl bg-[#1b2732] p-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-green-500/20 text-sm font-bold text-green-400">
              {user.fullName.charAt(0)}
            </div>

            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">{user.fullName}</p>
              <p className="text-xs text-slate-500">
                {user.role === "SUPER_ADMIN"
                  ? "مدیر کل سیستم"
                  : user.business?.name ?? "حساب کسب‌وکار"}
              </p>
            </div>

            <button
              type="button"
              onClick={handleLogout}
              className="rounded-lg p-2 text-slate-400 transition hover:bg-red-500/10 hover:text-red-400"
              title="خروج از حساب"
              aria-label="خروج از حساب"
            >
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </aside>

      {mobileMenuOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label="بستن منوی ناوبری"
            onClick={() => setMobileMenuOpen(false)}
            className="absolute inset-0 h-full w-full bg-black/70 backdrop-blur-sm"
          />
          <aside
            id="mobile-navigation-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="منوی ناوبری"
            className="absolute inset-y-0 right-0 flex h-dvh w-[min(85vw,320px)] flex-col border-l border-[#222d38] bg-[#111820] shadow-2xl"
          >
            <div className="flex h-[82px] items-center justify-between border-b border-[#222d38] px-5">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-green-500 text-black">
                  <Wallet size={22} />
                </div>
                <div>
                  <h1 className="text-lg font-bold text-white">Hirad Accounting</h1>
                  <p className="text-[11px] text-slate-500">سیستم مدیریت مالی</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                aria-label="بستن منو"
                className="rounded-lg p-2 text-slate-400 hover:bg-white/5"
              >
                <X size={20} />
              </button>
            </div>
            <nav className="space-y-1 overflow-y-auto p-4" aria-label="منوی اصلی">
              {renderNavigation()}
            </nav>
            <div className="mt-auto border-t border-[#222d38] p-4">
              <button
                type="button"
                onClick={() => {
                  setMobileMenuOpen(false);
                  setPasswordError("");
                  setPasswordSuccess("");
                  setSettingsOpen(true);
                }}
                className="flex w-full items-center gap-3 rounded-xl p-3 text-right transition hover:bg-[#1b2732]"
              >
                <Settings size={19} className="text-slate-400" />
                <span className="text-sm text-slate-300">تنظیمات حساب</span>
              </button>
              <div className="mt-2 flex items-center gap-3 rounded-xl bg-[#1b2732] p-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{user.fullName}</p>
                  <p className="truncate text-xs text-slate-500">{user.business?.name ?? "حساب کسب‌وکار"}</p>
                </div>
                <button
                  type="button"
                  onClick={handleLogout}
                  aria-label="خروج از حساب"
                  className="rounded-lg p-2 text-slate-400 transition hover:bg-red-500/10 hover:text-red-400"
                >
                  <LogOut size={18} />
                </button>
              </div>
            </div>
          </aside>
        </div>
      )}

      <section className="lg:mr-[255px]">
        <header className="sticky top-0 z-10 flex h-[82px] items-center justify-between border-b border-[#222d38] bg-[#0b0f14]/95 px-5 backdrop-blur-xl md:px-8">
          <div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                aria-label="باز کردن منوی ناوبری"
                aria-expanded={mobileMenuOpen}
                aria-controls="mobile-navigation-drawer"
                onClick={() => setMobileMenuOpen(true)}
                className="rounded-lg border border-[#263341] p-2 text-slate-300 hover:bg-[#1b2732] lg:hidden"
              >
                <MenuIcon size={20} />
              </button>
              <h2 className="text-lg font-bold">{activeView.title}</h2>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              {activeView.description}
            </p>
          </div>

          {user.role === "SUPER_ADMIN" && (
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="flex items-center gap-2 rounded-xl bg-green-500 px-4 py-2.5 text-xs font-bold text-black transition hover:bg-green-400"
            >
              <Plus size={16} />
              <span>ثبت جدید</span>
            </button>
          )}
        </header>

        <div className="space-y-7 p-5 md:p-8">
          {visitedViews.includes("inventory") && (
            <section hidden={currentView !== "inventory"}>
              <InventoryClient
                currencyUnit={currencyUnit}
                quickAction={
                  quickAction?.targetView === "inventory" &&
                  quickAction.action === "product"
                    ? quickAction
                    : null
                }
              />
            </section>
          )}

          {visitedViews.includes("purchase-invoices") && (
            <section hidden={currentView !== "purchase-invoices"}>
              <InvoicesClient
                key="PURCHASE"
                currencyUnit={currencyUnit}
                initialType="PURCHASE"
                quickAction={
                  quickAction?.targetView === "purchase-invoices" &&
                  quickAction.action === "invoice"
                    ? quickAction
                    : null
                }
              />
            </section>
          )}

          {visitedViews.includes("sales-invoices") && (
            <section hidden={currentView !== "sales-invoices"}>
              <InvoicesClient
                key="SALE"
                currencyUnit={currencyUnit}
                initialType="SALE"
                quickAction={
                  quickAction?.targetView === "sales-invoices" &&
                  quickAction.action === "invoice"
                    ? quickAction
                    : null
                }
              />
            </section>
          )}

          {visitedViews.includes("contacts") && (
            <section hidden={currentView !== "contacts"}>
              <ContactsClient
                currencyUnit={currencyUnit}
                quickAction={
                  quickAction?.targetView === "contacts" &&
                  quickAction.action === "contact"
                    ? quickAction
                    : null
                }
              />
            </section>
          )}

          {visitedViews.includes("payments") && (
            <section hidden={currentView !== "payments"}>
              <PaymentsClient
                currencyUnit={currencyUnit}
                quickAction={
                  quickAction?.targetView === "payments" &&
                  quickAction.action === "payment"
                    ? quickAction
                    : null
                }
              />
            </section>
          )}

          {visitedViews.includes("expenses") && (
            <section hidden={currentView !== "expenses"}>
              <ExpensesClient
                currencyUnit={currencyUnit}
                quickAction={
                  quickAction?.targetView === "expenses" &&
                  quickAction.action === "expense"
                    ? quickAction
                    : null
                }
              />
            </section>
          )}

          {visitedViews.includes("reports") && (
            <section hidden={currentView !== "reports"}>
              <ReportsClient currencyUnit={currencyUnit} />
            </section>
          )}

          {currentView === "dashboard" && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-xl font-bold">خوش آمدید 👋</h2>
                  <p className="mt-2 text-sm text-slate-500">
                    وضعیت مالی کسب‌وکار خود را بررسی کنید.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => loadDashboard()}
                  disabled={dashboardLoading}
                  className="flex items-center gap-2 rounded-xl border border-[#222d38] bg-[#111820] px-3 py-2.5 text-xs text-slate-300 transition hover:border-green-500/40 disabled:opacity-50"
                >
                  <RefreshCw
                    size={14}
                    className={dashboardLoading ? "animate-spin" : ""}
                  />
                  بروزرسانی
                </button>
              </div>

              {dashboardError && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-500/20 bg-red-500/10 p-4">
                  <p className="text-sm text-red-400">{dashboardError}</p>
                  <button
                    type="button"
                    onClick={() => loadDashboard()}
                    className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-300 transition hover:bg-red-500/20"
                  >
                    تلاش مجدد
                  </button>
                </div>
              )}

              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <StatCard
                  title="مجموع فروش این ماه"
                  value={
                    dashboardLoading
                      ? "..."
                      : dashboard
                        ? `${formatAmount(dashboard.stats.sales, currencyUnit)} ${currencyLabel}`
                        : "—"
                  }
                  change={dashboard?.stats.salesChange}
                  icon={TrendingUp}
                  positive={
                    dashboard?.stats.salesChange === null ||
                    (dashboard?.stats.salesChange ?? 0) >= 0
                  }
                />

                <StatCard
                  title="مجموع خرید این ماه"
                  value={
                    dashboardLoading
                      ? "..."
                      : dashboard
                        ? `${formatAmount(dashboard.stats.purchases, currencyUnit)} ${currencyLabel}`
                        : "—"
                  }
                  change={dashboard?.stats.purchasesChange}
                  icon={ShoppingCart}
                  positive={
                    dashboard?.stats.purchasesChange !== null &&
                    (dashboard?.stats.purchasesChange ?? 0) < 0
                  }
                />

                <StatCard
                  title="هزینه‌های این ماه"
                  value={
                    dashboardLoading
                      ? "..."
                      : dashboard
                        ? `${formatAmount(dashboard.stats.expenses, currencyUnit)} ${currencyLabel}`
                        : "—"
                  }
                  change={dashboard?.stats.expensesChange}
                  icon={Wallet}
                  positive={
                    dashboard?.stats.expensesChange !== null &&
                    (dashboard?.stats.expensesChange ?? 0) < 0
                  }
                />

                <StatCard
                  title="تعداد کالاها"
                  value={
                    dashboardLoading
                      ? "..."
                      : dashboard
                        ? new Intl.NumberFormat("fa-IR").format(
                            dashboard.stats.productCount
                          )
                        : "—"
                  }
                  icon={Package}
                  description="تعداد کالاهای ثبت‌شده"
                />
              </div>

              <div className="grid gap-5 xl:grid-cols-3">
                <div className="rounded-2xl border border-[#222d38] bg-[#111820] p-5 xl:col-span-2">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="font-bold">نمودار فروش</h3>
                      <p className="mt-1 text-xs text-slate-500">
                        روند فروش در هشت ماه اخیر
                      </p>
                    </div>

                    <span className="rounded-lg bg-green-500/10 px-3 py-2 text-xs text-green-400">
                      فروش ماهانه ({currencyLabel})
                    </span>
                  </div>

                  <div className="mt-7 h-[270px] w-full" dir="ltr">
                    {dashboardLoading ? (
                      <div className="flex h-full items-center justify-center text-sm text-slate-500">
                        در حال دریافت اطلاعات نمودار...
                      </div>
                    ) : dashboard ? (
                      <DashboardSalesChart
                        data={dashboard.salesTrend}
                        currencyUnit={currencyUnit}
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center text-sm text-slate-500">
                        اطلاعات نمودار در دسترس نیست.
                      </div>
                    )}
                  </div>
                </div>

                <div className="rounded-2xl border border-[#222d38] bg-[#111820] p-5">
                  <h3 className="font-bold">دسترسی سریع</h3>
                  <p className="mt-1 text-xs text-slate-500">
                    عملیات پرکاربرد
                  </p>

                  <div className="mt-6 space-y-3">
                    {[
                      { title: "ثبت فاکتور فروش", icon: ReceiptText, view: "sales-invoices" as const, action: "invoice" as const },
                      { title: "ثبت فاکتور خرید", icon: ShoppingCart, view: "purchase-invoices" as const, action: "invoice" as const },
                      { title: "افزودن کالای جدید", icon: Package, view: "inventory" as const, action: "product" as const },
                      { title: "افزودن مشتری", icon: UserRound, view: "contacts" as const, action: "contact" as const },
                      { title: "ثبت پرداخت", icon: Wallet, view: "payments" as const, action: "payment" as const },
                      { title: "ثبت هزینه جدید", icon: Wallet, view: "expenses" as const, action: "expense" as const },
                    ].map((item) => (
                      <button
                        key={item.title}
                        type="button"
                        onClick={() => navigateTo(item.view, item.action)}
                        className="flex w-full items-center gap-3 rounded-xl border border-[#26323d] bg-[#151f29] p-4 text-right text-sm transition hover:border-green-500/40 hover:bg-[#1b2932]"
                      >
                        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-green-500/10 text-green-400">
                          <item.icon size={18} />
                        </div>
                        <span className="flex-1">{item.title}</span>
                        <Plus size={16} className="text-slate-500" />
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="overflow-hidden rounded-2xl border border-[#222d38] bg-[#111820]">
                <div className="flex items-center justify-between border-b border-[#222d38] p-5">
                  <div>
                    <h3 className="font-bold">آخرین فاکتورها</h3>
                    <p className="mt-1 text-xs text-slate-500">
                      آخرین فاکتورهای ثبت‌شده در کسب‌وکار
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => navigateTo("sales-invoices")}
                    className="text-xs text-green-400 transition hover:text-green-300"
                  >
                    مشاهده فاکتورهای فروش
                  </button>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full min-w-[700px] text-right text-sm">
                    <thead className="bg-[#151f29] text-xs text-slate-500">
                      <tr>
                        <th className="px-5 py-4 font-medium">شماره فاکتور</th>
                        <th className="px-5 py-4 font-medium">نوع فاکتور</th>
                        <th className="px-5 py-4 font-medium">طرف حساب</th>
                        <th className="px-5 py-4 font-medium">تاریخ</th>
                        <th className="px-5 py-4 font-medium">
                          مبلغ ({currencyLabel})
                        </th>
                        <th className="px-5 py-4 font-medium">وضعیت</th>
                      </tr>
                    </thead>

                    <tbody>
                      {dashboardLoading ? (
                        <tr>
                          <td
                            colSpan={6}
                            className="px-5 py-10 text-center text-sm text-slate-500"
                          >
                            در حال دریافت فاکتورها...
                          </td>
                        </tr>
                      ) : dashboardError ? (
                        <tr>
                          <td
                            colSpan={6}
                            className="px-5 py-10 text-center text-sm text-slate-500"
                          >
                            دریافت فاکتورها ناموفق بود.
                          </td>
                        </tr>
                      ) : dashboard?.recentInvoices.length ? (
                        dashboard.recentInvoices.map((invoice) => {
                          const status = getInvoiceStatus(invoice.status);

                          return (
                            <tr
                              key={invoice.id}
                              className="border-t border-[#222d38] transition hover:bg-[#151f29]"
                            >
                              <td
                                className="px-5 py-4 text-slate-300"
                                dir="ltr"
                              >
                                {invoice.invoiceNumber ?? invoice.id}
                              </td>

                              <td className="px-5 py-4">
                                <span
                                  className={
                                    invoice.type === "SALE"
                                      ? "text-green-400"
                                      : "text-blue-400"
                                  }
                                >
                                  {invoice.type === "SALE" ? "فروش" : "خرید"}
                                </span>
                              </td>

                              <td className="px-5 py-4">
                                {invoice.contactName}
                              </td>

                              <td className="px-5 py-4 text-slate-400">
                                {formatDate(invoice.date)}
                              </td>

                              <td
                                className="px-5 py-4 font-medium"
                                dir="ltr"
                              >
                                {formatAmount(invoice.amount, currencyUnit)}
                              </td>

                              <td className="px-5 py-4">
                                <span
                                  className={`rounded-lg px-3 py-1.5 text-xs ${status.bg} ${status.color}`}
                                >
                                  {status.label}
                                </span>
                              </td>
                            </tr>
                          );
                        })
                      ) : (
                        <tr>
                          <td
                            colSpan={6}
                            className="px-5 py-10 text-center text-sm text-slate-500"
                          >
                            هنوز فاکتوری ثبت نشده است.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

            </>
          )}
        </div>
      </section>

      {settingsOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm"
          onMouseDown={(event) => {
            if (
              event.target === event.currentTarget &&
              !passwordSaving &&
              !currencySaving
            ) {
              setSettingsOpen(false);
            }
          }}
        >
          <div className="my-auto w-full max-w-lg overflow-hidden rounded-2xl border border-[#293642] bg-[#111820] shadow-2xl">
            <div className="flex items-center justify-between border-b border-[#222d38] p-5">
              <div>
                <h2 className="text-lg font-bold">تنظیمات حساب</h2>
                <p className="mt-1 text-xs text-slate-500">
                  مدیریت اطلاعات، واحد پول و امنیت حساب
                </p>
              </div>

              <button
                type="button"
                onClick={() => setSettingsOpen(false)}
                disabled={passwordSaving || currencySaving}
                className="rounded-lg p-2 text-slate-400 transition hover:bg-white/5 hover:text-white"
                aria-label="بستن"
              >
                <X size={20} />
              </button>
            </div>

            <div className="space-y-6 p-5">
              <div className="rounded-xl border border-[#293642] bg-[#0b0f14] p-4">
                <div className="mb-4 flex items-center gap-2 text-green-400">
                  <UserRound size={19} />
                  <span className="text-sm font-semibold">
                    اطلاعات حساب
                  </span>
                </div>

                <div className="space-y-3 text-sm">
                  <div className="flex justify-between gap-3">
                    <span className="text-slate-500">
                      نام و نام خانوادگی
                    </span>
                    <span className="font-medium">{user.fullName}</span>
                  </div>

                  <div className="flex justify-between gap-3">
                    <span className="text-slate-500">نام کاربری</span>
                    <span dir="ltr">{user.username}</span>
                  </div>

                  <div className="flex justify-between gap-3">
                    <span className="text-slate-500">نوع حساب</span>
                    <span>
                      {user.role === "SUPER_ADMIN"
                        ? "مدیر کل سیستم"
                        : "مدیر کسب‌وکار"}
                    </span>
                  </div>

                  {user.business && (
                    <div className="flex justify-between gap-3">
                      <span className="text-slate-500">کسب‌وکار</span>
                      <span>{user.business.name}</span>
                    </div>
                  )}
                </div>
              </div>

              {user.role === "BUSINESS_OWNER" && (
                <div className="rounded-xl border border-[#293642] bg-[#0b0f14] p-4">
                  <div className="mb-4 flex items-center gap-2 text-green-400">
                    <Wallet size={19} />
                    <span className="text-sm font-semibold">
                      واحد پول کسب‌وکار
                    </span>
                  </div>

                  <p className="mb-4 text-xs leading-6 text-slate-500">
                    واحد پول مورد استفاده در نمایش مبالغ، فاکتورها و گزارش‌های مالی را انتخاب کنید.
                  </p>

                  <div className="grid grid-cols-2 gap-3">
                    {(["TOMAN", "RIAL"] as const).map((unit) => (
                      <button
                        key={unit}
                        type="button"
                        disabled={currencySaving}
                        onClick={async () => {
                          if (unit === currencyUnit) return;

                          setCurrencySaving(true);
                          setCurrencyError("");
                          setCurrencySuccess("");

                          try {
                            const response = await fetch(
                              "/api/settings/currency",
                              {
                                method: "PATCH",
                                headers: {
                                  "Content-Type": "application/json",
                                },
                                body: JSON.stringify({
                                  currencyUnit: unit,
                                }),
                              }
                            );

                            const data = await response.json();

                            if (!response.ok) {
                              throw new Error(
                                data.error || "تغییر واحد پول ناموفق بود."
                              );
                            }

                            await loadDashboard();

                            setCurrencySuccess(
                              "واحد پول با موفقیت تغییر کرد."
                            );
                          } catch (error) {
                            setCurrencyError(
                              error instanceof Error
                                ? error.message
                                : "خطای غیرمنتظره رخ داد."
                            );
                          } finally {
                            setCurrencySaving(false);
                          }
                        }}
                        className={`rounded-xl border p-4 text-center transition disabled:cursor-not-allowed disabled:opacity-50 ${
                          currencyUnit === unit
                            ? "border-green-500 bg-green-500/10 text-green-400"
                            : "border-[#293642] bg-[#151f29] text-slate-400 hover:border-green-500/40"
                        }`}
                      >
                        <span className="block text-lg font-bold">
                          {unit === "TOMAN" ? "تومان" : "ریال"}
                        </span>
                        <span className="mt-1 block text-[11px]">
                          {unit === "TOMAN" ? "واحد تومان" : "واحد ریال"}
                        </span>
                        {currencyUnit === unit && (
                          <span className="mt-2 block text-[10px]">
                            واحد انتخاب‌شده
                          </span>
                        )}
                      </button>
                    ))}
                  </div>

                  {currencySaving && (
                    <p className="mt-3 text-xs text-slate-400">
                      در حال ذخیره واحد پول...
                    </p>
                  )}

                  {currencyError && (
                    <div className="mt-3 rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-400">
                      {currencyError}
                    </div>
                  )}

                  {currencySuccess && (
                    <div className="mt-3 rounded-lg border border-green-500/20 bg-green-500/10 p-3 text-xs text-green-400">
                      {currencySuccess}
                    </div>
                  )}
                </div>
              )}

              <div>
                <div className="mb-4 flex items-center gap-2 text-green-400">
                  <KeyRound size={19} />
                  <span className="text-sm font-semibold">
                    تغییر رمز عبور
                  </span>
                </div>

                <form
                  onSubmit={handleChangePassword}
                  className="space-y-4"
                >
                  <label className="block">
                    <span className="mb-2 block text-xs text-slate-400">
                      رمز عبور فعلی
                    </span>
                    <input
                      type="password"
                      autoComplete="current-password"
                      required
                      value={passwordForm.currentPassword}
                      onChange={(event) =>
                        setPasswordForm({
                          ...passwordForm,
                          currentPassword: event.target.value,
                        })
                      }
                      className="h-11 w-full rounded-xl border border-[#293642] bg-[#0b0f14] px-3 text-sm outline-none transition focus:border-green-500"
                    />
                  </label>

                  <label className="block">
                    <span className="mb-2 block text-xs text-slate-400">
                      رمز عبور جدید
                    </span>
                    <input
                      type="password"
                      autoComplete="new-password"
                      minLength={12}
                      maxLength={200}
                      required
                      value={passwordForm.newPassword}
                      onChange={(event) =>
                        setPasswordForm({
                          ...passwordForm,
                          newPassword: event.target.value,
                        })
                      }
                      className="h-11 w-full rounded-xl border border-[#293642] bg-[#0b0f14] px-3 text-sm outline-none transition focus:border-green-500"
                    />
                    <p className="mt-1.5 text-[11px] text-slate-500">
                      حداقل ۱۲ کاراکتر
                    </p>
                  </label>

                  <label className="block">
                    <span className="mb-2 block text-xs text-slate-400">
                      تکرار رمز عبور جدید
                    </span>
                    <input
                      type="password"
                      autoComplete="new-password"
                      required
                      value={passwordForm.confirmPassword}
                      onChange={(event) =>
                        setPasswordForm({
                          ...passwordForm,
                          confirmPassword: event.target.value,
                        })
                      }
                      className="h-11 w-full rounded-xl border border-[#293642] bg-[#0b0f14] px-3 text-sm outline-none transition focus:border-green-500"
                    />
                  </label>

                  {passwordError && (
                    <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-400">
                      {passwordError}
                    </div>
                  )}

                  {passwordSuccess && (
                    <div className="rounded-lg border border-green-500/20 bg-green-500/10 p-3 text-xs text-green-400">
                      {passwordSuccess}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={passwordSaving}
                    className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-green-500 text-sm font-bold text-black transition hover:bg-green-400 disabled:opacity-50"
                  >
                    {passwordSaving
                      ? "در حال ذخیره..."
                      : "تغییر رمز عبور"}
                  </button>
                </form>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}