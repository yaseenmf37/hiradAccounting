import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import DashboardClient from "./dashboard-client";

export const instant = false;
type DashboardView =
  | "dashboard"
  | "inventory"
  | "contacts"
  | "purchase-invoices"
  | "sales-invoices"
  | "payments"
  | "expenses"
  | "reports";
const views = new Set<DashboardView>([
  "dashboard",
  "inventory",
  "contacts",
  "purchase-invoices",
  "sales-invoices",
  "payments",
  "expenses",
  "reports",
]);

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const user = await getCurrentUser();
  const { view } = await searchParams;
  const initialView: DashboardView = views.has(view as DashboardView)
    ? (view as DashboardView)
    : "dashboard";

  if (!user) {
    redirect("/login");
  }

  if (user.role === "SUPER_ADMIN") {
    redirect("/admin");
  }

  return (
    <DashboardClient
      user={{
        id: user.id,
        username: user.username,
        fullName: user.fullName,
        role: user.role,
        mustChangePassword: user.mustChangePassword,
        business: user.business
          ? {
              id: user.business.id,
              name: user.business.name,
            }
          : null,
      }}
      initialView={initialView}
    />
  );
}