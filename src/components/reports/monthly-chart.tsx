"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { getCurrencyLabel } from "@/lib/currency";

type Props = {
  data: {
    month: string;
    sales: number;
    purchases: number;
    expenses: number;
    grossProfit: number;
  }[];
  unit: "RIAL" | "TOMAN";
};

export default function MonthlyChart({ data, unit }: Props) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart
        data={data}
        margin={{
          top: 10,
          right: 5,
          left: 5,
          bottom: 0,
        }}
      >
        <defs>
          <linearGradient
            id="salesGradient"
            x1="0"
            y1="0"
            x2="0"
            y2="1"
          >
            <stop offset="0%" stopColor="#10b981" stopOpacity={0.25} />
            <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
          </linearGradient>

          <linearGradient
            id="expensesGradient"
            x1="0"
            y1="0"
            x2="0"
            y2="1"
          >
            <stop offset="0%" stopColor="#f43f5e" stopOpacity={0.2} />
            <stop offset="100%" stopColor="#f43f5e" stopOpacity={0} />
          </linearGradient>

          <linearGradient
            id="profitGradient"
            x1="0"
            y1="0"
            x2="0"
            y2="1"
          >
            <stop offset="0%" stopColor="#a78bfa" stopOpacity={0.25} />
            <stop offset="100%" stopColor="#a78bfa" stopOpacity={0} />
          </linearGradient>
        </defs>

        <CartesianGrid stroke="#ffffff0b" vertical={false} />

        <XAxis
          dataKey="month"
          tick={{ fill: "#71717a", fontSize: 12 }}
          axisLine={false}
          tickLine={false}
        />

        <YAxis
          orientation="right"
          tick={{ fill: "#71717a", fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(value) =>
            new Intl.NumberFormat("fa-IR", {
              notation: "compact",
            }).format(value)
          }
        />

        <Tooltip
          contentStyle={{
            background: "#20252c",
            border: "1px solid #ffffff15",
            borderRadius: 12,
            color: "#fff",
            direction: "rtl",
          }}
          formatter={(value) => [
            `${new Intl.NumberFormat("fa-IR").format(Number(value))} ${getCurrencyLabel(unit)}`,
          ]}
        />

        <Area
          type="monotone"
          dataKey="sales"
          name="فروش"
          stroke="#10b981"
          strokeWidth={2}
          fill="url(#salesGradient)"
        />

        <Area
          type="monotone"
          dataKey="purchases"
          name="خرید"
          stroke="#3b82f6"
          strokeWidth={2}
          fill="transparent"
        />

        <Area
          type="monotone"
          dataKey="expenses"
          name="هزینه‌ها"
          stroke="#f43f5e"
          strokeWidth={2}
          fill="url(#expensesGradient)"
        />

        <Area
          type="monotone"
          dataKey="grossProfit"
          name="سود ناخالص"
          stroke="#a78bfa"
          strokeWidth={2}
          fill="url(#profitGradient)"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
