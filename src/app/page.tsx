import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import DashboardClient from "./dashboard-client";

export const instant = false;
export default async function Home() {
  const user = await getCurrentUser();

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
    />
  );
}