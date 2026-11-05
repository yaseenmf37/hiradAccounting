"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import {
  TrendingUp,
  ShoppingCart,
  Wallet,
  RefreshCw,
  CalendarDays,
  ArrowUpRight,
  ArrowDownRight,
  Coins,
  ChartNoAxesCombined,
  AlertTriangle,
} from "lucide-react";
import DatePicker from "react-multi-date-picker";
import persian from "react-date-object/calendars/persian";
import persian_fa from "react-date-object/locales/persian_fa";
import gregorian from "react-date-object/calendars/gregorian";
import DateObject from "react-date-object";

import type { CurrencyUnit } from "@prisma/client";
import { formatCurrency } from "@/lib/currency";

const MonthlyChart = dynamic(
  () => import("@/components/reports/monthly-chart"),
  {
    loading: () => (
      <div className="flex h-full items-center justify-center text-sm text-zinc-500">
        در حال بارگذاری نمودار...
      </div>
    ),
  }
);

type SummaryItem = {
  amount: string;
  count: number;
};

type MonthlyItem = {
  month: string;
  sales: string;
  purchases: string;
  receipts: string;
  payments: string;
  expenses: string;
  costOfGoodsSold: string;
  grossProfit: string;
  uncostedSales: string;
};

type ReportsData = {
  currencyUnit: CurrencyUnit;
  period: {
    from: string;
    to: string;
  };
  summary: {
    sales: SummaryItem;
    purchases: SummaryItem;
    receipts: SummaryItem;
    payments: SummaryItem;
    expenses: SummaryItem;
    costedSales: SummaryItem;
    costOfGoodsSold: {
      amount: string;
    };
    grossProfit: {
      amount: string;
    };
    uncostedSales: SummaryItem;
  };
  costing: {
    availableFrom: string;
    hasUncostedSales: boolean;
  };
  monthlyPerformance: MonthlyItem[];
};

type Props = {
  currencyUnit: CurrencyUnit;
};

function toEnglishDigits(value: string) {
  return value.replace(/[۰-۹]/g, (digit) =>
    String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit))
  );
}

function getPersianDate(value: string) {
  if (!value) return null;

  const [year, month, day] = value.split("-").map(Number);

  return new DateObject({
    date: new Date(year, month - 1, day),
    calendar: gregorian,
  }).convert(persian);
}

function getGregorianDate(value: {
  convert: (calendar: typeof gregorian) => {
    format: (pattern: string) => string;
  };
}) {
  return toEnglishDigits(
    value.convert(gregorian).format("YYYY-MM-DD")
  );
}

function formatAmount(amount: string, unit: CurrencyUnit) {
  return formatCurrency(BigInt(amount), unit);
}

function formatMonth(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);

  return new Intl.DateTimeFormat("fa-IR", {
    month: "short",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, monthNumber - 1, 1)));
}

function StatCard({
  title,
  amount,
  count,
  unit,
  icon: Icon,
  color,
  description,
}: {
  title: string;
  amount: string;
  count?: number;
  unit: CurrencyUnit;
  icon: typeof Wallet;
  color: string;
  description?: string;
}) {
  return (
    <div className="rounded-2xl border border-white/[0.07] bg-[#15191e] p-5 transition-colors hover:border-white/[0.12]">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-zinc-400">{title}</span>
        <div
          className={`flex h-10 w-10 items-center justify-center rounded-xl ${color}`}
        >
          <Icon size={19} />
        </div>
      </div>

      <div className="mt-5">
        <div className="text-xl font-bold text-white">
          {formatAmount(amount, unit)}
        </div>

        {description ? (
          <div className="mt-2 text-xs text-zinc-500">
            {description}
          </div>
        ) : typeof count === "number" ? (
          <div className="mt-2 text-xs text-zinc-500">
            {count.toLocaleString("fa-IR")} سند ثبت‌شده
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default function ReportsClient({ currencyUnit }: Props) {
  const [data, setData] = useState<ReportsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const loadReports = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const params = new URLSearchParams();

      if (fromDate) {
        params.set("from", `${fromDate}T00:00:00.000Z`);
      }

      if (toDate) {
        params.set("to", `${toDate}T23:59:59.999Z`);
      }

      const response = await fetch(
        `/api/reports?${params.toString()}`
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          result.error || "دریافت گزارش‌ها ناموفق بود."
        );
      }

      setData(result);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "خطایی در دریافت گزارش‌ها رخ داد."
      );
    } finally {
      setLoading(false);
    }
  }, [fromDate, toDate]);

  useEffect(() => {
    loadReports();
  }, [loadReports]);

  const unit = data?.currencyUnit ?? currencyUnit;

  const chartData =
    data?.monthlyPerformance.map((item) => ({
      month: formatMonth(item.month),
      sales: Number(item.sales),
      purchases: Number(item.purchases),
      expenses: Number(item.expenses),
      grossProfit: Number(item.grossProfit),
    })) ?? [];

  const summaryCards = data
    ? [
        {
          title: "مجموع فروش",
          amount: data.summary.sales.amount,
          count: data.summary.sales.count,
          icon: TrendingUp,
          color: "bg-emerald-500/10 text-emerald-400",
        },
        {
          title: "سود ناخالص",
          amount: data.summary.grossProfit.amount,
          count: data.summary.costedSales.count,
          icon: ChartNoAxesCombined,
          color: "bg-violet-500/10 text-violet-400",
          description: "فقط فروش‌های دارای بهای تمام‌شده",
        },
        {
          title: "بهای تمام‌شده فروش",
          amount: data.summary.costOfGoodsSold.amount,
          icon: Coins,
          color: "bg-amber-500/10 text-amber-400",
          description: "بر اساس میانگین موزون",
        },
        {
          title: "مجموع خرید",
          amount: data.summary.purchases.amount,
          count: data.summary.purchases.count,
          icon: ShoppingCart,
          color: "bg-blue-500/10 text-blue-400",
        },
        {
          title: "دریافت‌ها",
          amount: data.summary.receipts.amount,
          count: data.summary.receipts.count,
          icon: ArrowDownRight,
          color: "bg-teal-500/10 text-teal-400",
        },
        {
          title: "پرداخت‌ها",
          amount: data.summary.payments.amount,
          count: data.summary.payments.count,
          icon: ArrowUpRight,
          color: "bg-orange-500/10 text-orange-400",
        },
        {
          title: "هزینه‌ها",
          amount: data.summary.expenses.amount,
          count: data.summary.expenses.count,
          icon: Wallet,
          color: "bg-rose-500/10 text-rose-400",
        },
      ]
    : [];

  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
        <div>
          <h2 className="text-xl font-bold text-white">
            گزارش‌های مالی
          </h2>
          <p className="mt-1 text-sm text-zinc-500">
            بررسی عملکرد مالی و سود ناخالص کسب‌وکار
          </p>
        </div>

        <button
          onClick={loadReports}
          disabled={loading}
          className="flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm text-zinc-300 transition hover:bg-white/[0.08] disabled:opacity-50"
        >
          <RefreshCw
            size={16}
            className={loading ? "animate-spin" : ""}
          />
          بروزرسانی
        </button>
      </div>

      <div className="rounded-2xl border border-white/[0.07] bg-[#15191e] p-4">
        <div className="mb-4 flex items-center gap-2 text-sm font-medium text-zinc-300">
          <CalendarDays size={17} />
          فیلتر بازه زمانی
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_auto]">
          <div>
            <label className="mb-2 block text-xs text-zinc-500">
              از تاریخ
            </label>
            <DatePicker
              calendar={persian}
              locale={persian_fa}
              calendarPosition="bottom-right"
              format="YYYY/MM/DD"
              value={getPersianDate(fromDate)}
              onChange={(value) => {
                if (!value) {
                  setFromDate("");
                  return;
                }

                setFromDate(getGregorianDate(value));
              }}
              inputClass="w-full rounded-xl border border-white/10 bg-[#0e1115] px-4 py-3 text-sm text-white outline-none focus:border-emerald-500/50"
              placeholder="انتخاب تاریخ شروع"
            />
          </div>

          <div>
            <label className="mb-2 block text-xs text-zinc-500">
              تا تاریخ
            </label>
            <DatePicker
              calendar={persian}
              locale={persian_fa}
              calendarPosition="bottom-right"
              format="YYYY/MM/DD"
              value={getPersianDate(toDate)}
              onChange={(value) => {
                if (!value) {
                  setToDate("");
                  return;
                }

                setToDate(getGregorianDate(value));
              }}
              inputClass="w-full rounded-xl border border-white/10 bg-[#0e1115] px-4 py-3 text-sm text-white outline-none focus:border-emerald-500/50"
              placeholder="انتخاب تاریخ پایان"
            />
          </div>

          <div className="flex items-end">
            <button
              onClick={loadReports}
              disabled={loading}
              className="w-full rounded-xl bg-emerald-500 px-5 py-3 text-sm font-semibold text-black transition hover:bg-emerald-400 disabled:opacity-50"
            >
              اعمال فیلتر
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-4 text-sm text-rose-300">
          {error}
        </div>
      )}

      {loading && !data ? (
        <div className="rounded-2xl border border-white/[0.07] bg-[#15191e] p-12 text-center text-sm text-zinc-500">
          در حال دریافت گزارش‌های مالی...
        </div>
      ) : data ? (
        <>
          {data.costing.hasUncostedSales && (
            <div className="flex items-start gap-3 rounded-2xl border border-amber-500/20 bg-amber-500/[0.07] p-4">
              <AlertTriangle
                size={20}
                className="mt-0.5 shrink-0 text-amber-400"
              />
              <div>
                <p className="text-sm font-semibold text-amber-300">
                  تعدادی از فروش‌ها بهای تمام‌شده ندارند
                </p>
                <p className="mt-1 text-xs leading-6 text-amber-200/70">
                  مبلغ{" "}
                  {formatAmount(
                    data.summary.uncostedSales.amount,
                    unit
                  )}{" "}
                  از فروش‌ها در محاسبه سود ناخالص لحاظ نشده است.
                  تعداد اسناد:{" "}
                  {data.summary.uncostedSales.count.toLocaleString(
                    "fa-IR"
                  )}
                </p>
              </div>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {summaryCards.map((item) => (
              <StatCard
                key={item.title}
                title={item.title}
                amount={item.amount}
                count={item.count}
                unit={unit}
                icon={item.icon}
                color={item.color}
                description={item.description}
              />
            ))}
          </div>

          <div className="rounded-2xl border border-white/[0.07] bg-[#15191e] p-5">
            <div className="mb-6">
              <h3 className="font-bold text-white">
                عملکرد ماهانه
              </h3>
              <p className="mt-1 text-xs text-zinc-500">
                مقایسه فروش، خرید، هزینه‌ها و سود ناخالص
              </p>
            </div>

            <div className="h-[320px] w-full">
              {chartData.length > 0 ? (
                <MonthlyChart data={chartData} unit={unit} />
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-zinc-500">
                  اطلاعاتی برای نمایش نمودار وجود ندارد.
                </div>
              )}
            </div>

            <div className="mt-4 flex flex-wrap gap-5 text-xs text-zinc-400">
              <span className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                فروش
              </span>
              <span className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-blue-500" />
                خرید
              </span>
              <span className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-rose-500" />
                هزینه‌ها
              </span>
              <span className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-violet-400" />
                سود ناخالص
              </span>
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-white/[0.07] bg-[#15191e]">
            <div className="border-b border-white/[0.07] p-5">
              <h3 className="font-bold text-white">
                جزئیات عملکرد ماهانه
              </h3>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[1050px] text-sm">
                <thead>
                  <tr className="bg-white/[0.025] text-right text-xs text-zinc-500">
                    <th className="px-5 py-4 font-medium">ماه</th>
                    <th className="px-5 py-4 font-medium">فروش</th>
                    <th className="px-5 py-4 font-medium">خرید</th>
                    <th className="px-5 py-4 font-medium">بهای تمام‌شده</th>
                    <th className="px-5 py-4 font-medium">سود ناخالص</th>
                    <th className="px-5 py-4 font-medium">دریافت</th>
                    <th className="px-5 py-4 font-medium">پرداخت</th>
                    <th className="px-5 py-4 font-medium">هزینه</th>
                  </tr>
                </thead>

                <tbody>
                  {data.monthlyPerformance.map((item) => (
                    <tr
                      key={item.month}
                      className="border-t border-white/[0.05] text-zinc-300"
                    >
                      <td className="px-5 py-4 font-medium">
                        {formatMonth(item.month)}
                      </td>

                      <td className="px-5 py-4 text-emerald-400">
                        {formatAmount(item.sales, unit)}
                      </td>

                      <td className="px-5 py-4 text-blue-400">
                        {formatAmount(item.purchases, unit)}
                      </td>

                      <td className="px-5 py-4 text-amber-400">
                        {formatAmount(item.costOfGoodsSold, unit)}
                      </td>

                      <td className="px-5 py-4 text-violet-400">
                        {formatAmount(item.grossProfit, unit)}
                      </td>

                      <td className="px-5 py-4 text-teal-400">
                        {formatAmount(item.receipts, unit)}
                      </td>

                      <td className="px-5 py-4 text-orange-400">
                        {formatAmount(item.payments, unit)}
                      </td>

                      <td className="px-5 py-4 text-rose-400">
                        {formatAmount(item.expenses, unit)}
                      </td>
                    </tr>
                  ))}

                  {data.monthlyPerformance.length === 0 && (
                    <tr>
                      <td
                        colSpan={8}
                        className="px-5 py-12 text-center text-zinc-500"
                      >
                        اطلاعاتی برای این بازه ثبت نشده است.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <p className="text-xs leading-6 text-zinc-500">
            سود ناخالص از کسر بهای تمام‌شده کالای فروش‌رفته از
            فروش‌های دارای اطلاعات بهای تمام‌شده محاسبه می‌شود.
            فروش‌های فاقد بهای تمام‌شده در این محاسبه لحاظ
            نمی‌شوند. این عدد سود خالص نیست و هزینه‌های عملیاتی
            از آن کسر نشده‌اند.
          </p>
        </>
      ) : null}
    </div>
  );
}