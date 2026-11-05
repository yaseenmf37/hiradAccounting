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

type Props = {
  data: { month: string; sales: number }[];
  currencyUnit: "RIAL" | "TOMAN";
};

function formatAmount(amount: number, unit: Props["currencyUnit"]) {
  const roundedAmount = BigInt(Math.round(amount));
  const displayed =
    unit === "TOMAN" ? roundedAmount / 10n : roundedAmount;

  return new Intl.NumberFormat("fa-IR").format(displayed);
}

export default function SalesChart({ data, currencyUnit }: Props) {
  const currencyLabel = currencyUnit === "TOMAN" ? "تومان" : "ریال";

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data}>
        <defs>
          <linearGradient
            id="salesGradient"
            x1="0"
            y1="0"
            x2="0"
            y2="1"
          >
            <stop offset="0%" stopColor="#22c55e" stopOpacity={0.25} />
            <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
          </linearGradient>
        </defs>

        <CartesianGrid
          stroke="#26323d"
          strokeDasharray="4 4"
          vertical={false}
        />

        <XAxis
          dataKey="month"
          stroke="#64748b"
          tick={{ fontSize: 10 }}
          axisLine={false}
          tickLine={false}
        />

        <YAxis
          stroke="#64748b"
          tick={{ fontSize: 10 }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(value) =>
            new Intl.NumberFormat("fa-IR", {
              notation: "compact",
              maximumFractionDigits: 1,
            }).format(
              currencyUnit === "TOMAN" ? Number(value) / 10 : Number(value)
            )
          }
        />

        <Tooltip
          contentStyle={{
            background: "#18222d",
            border: "1px solid #344454",
            borderRadius: 12,
            color: "#fff",
            fontSize: 12,
          }}
          formatter={(value) => [
            `${formatAmount(Number(value ?? 0), currencyUnit)} ${currencyLabel}`,
            "فروش",
          ]}
        />

        <Area
          type="monotone"
          dataKey="sales"
          stroke="#22c55e"
          strokeWidth={2.5}
          fill="url(#salesGradient)"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
