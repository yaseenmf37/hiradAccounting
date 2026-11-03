
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import AdminClient from "./admin-client";

export const instant = false;

export default async function AdminPage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  if (user.role !== "SUPER_ADMIN") {
    redirect("/");
  }

  return <AdminClient adminName={user.fullName} />;
}
