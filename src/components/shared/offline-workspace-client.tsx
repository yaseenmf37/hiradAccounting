"use client";

import { useEffect, useState, type FormEvent } from "react";
import DashboardClient from "@/app/dashboard-client";
import {
  configureOfflineWorkspace,
  getActiveOfflineWorkspace,
  verifyOfflineUnlockCredential,
  type OfflineWorkspace,
} from "@/lib/offline-storage";

export default function OfflineWorkspaceClient() {
  const [savedWorkspace, setSavedWorkspace] = useState<OfflineWorkspace | null>(null);
  const [workspace, setWorkspace] = useState<OfflineWorkspace | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [password, setPassword] = useState("");
  const [unlocking, setUnlocking] = useState(false);

  useEffect(() => {
    let active = true;
    void getActiveOfflineWorkspace()
      .then((savedWorkspace) => {
        if (!active) return;
        setSavedWorkspace(savedWorkspace);
      })
      .catch((loadError: unknown) => {
        console.error("Offline workspace load failed:", loadError);
        if (active) setError("خواندن فضای ذخیره‌شدهٔ حساب ممکن نیست.");
      })
      .finally(() => {
        if (active) setLoaded(true);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const handleLock = (event: Event) => {
      const account = (event as CustomEvent<{ account?: string }>).detail?.account;
      if (account && account === savedWorkspace?.accountKey) {
        setWorkspace(null);
        setPassword("");
      }
    };
    window.addEventListener("hirad-offline-workspace-locked", handleLock);
    return () =>
      window.removeEventListener("hirad-offline-workspace-locked", handleLock);
  }, [savedWorkspace?.accountKey]);

  async function unlockWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!savedWorkspace || unlocking) return;
    setUnlocking(true);
    setError("");
    try {
      const verified = await verifyOfflineUnlockCredential(
        savedWorkspace.userId,
        savedWorkspace.businessId,
        password
      );
      if (!verified) {
        setError("رمز عبور نادرست است یا قفل محلی برای این حساب تنظیم نشده است.");
        return;
      }
      configureOfflineWorkspace({
        userId: savedWorkspace.userId,
        businessId: savedWorkspace.businessId,
        businessName: savedWorkspace.businessName,
      });
      setWorkspace(savedWorkspace);
      setPassword("");
    } catch (unlockError) {
      console.error("Offline workspace unlock failed:", unlockError);
      setError("بازکردن امن فضای آفلاین ناموفق بود.");
    } finally {
      setUnlocking(false);
    }
  }

  if (!loaded) {
    return (
      <main className="min-h-screen bg-[#0b0f14] p-8 text-center text-sm text-slate-400">
        در حال بازیابی فضای کاری ذخیره‌شده...
      </main>
    );
  }

  if (!workspace) {
    return (
      <main className="min-h-screen bg-[#0b0f14] px-4 py-12 text-slate-100">
        <section className="mx-auto max-w-lg rounded-2xl border border-[#222d38] bg-[#111820] p-6">
          <h1 className="text-lg font-bold">
            {savedWorkspace ? "بازکردن فضای آفلاین" : "فضای آفلاین آماده نیست"}
          </h1>
          <p className="mt-3 text-sm leading-7 text-slate-400">
            {savedWorkspace
              ? "برای مشاهده اطلاعات ذخیره‌شده، رمز عبور حساب را دوباره وارد کنید."
              : "برای آماده‌سازی فضای آفلاین، آنلاین وارد حساب شوید و دریافت اطلاعات اولیه را کامل کنید."}
          </p>
          {savedWorkspace && (
            <form onSubmit={unlockWorkspace} className="mt-5 space-y-3">
              <label className="block text-sm text-slate-300" htmlFor="offline-unlock-password">
                رمز عبور حساب
              </label>
              <input
                id="offline-unlock-password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="w-full rounded-xl border border-[#293642] bg-[#0b0f14] px-4 py-3 text-sm text-white outline-none focus:border-green-500"
              />
              <button
                type="submit"
                disabled={unlocking}
                className="w-full rounded-xl bg-green-500 px-4 py-3 text-sm font-bold text-black disabled:opacity-60"
              >
                {unlocking ? "در حال بررسی..." : "بازکردن فضای آفلاین"}
              </button>
            </form>
          )}
          {error && (
            <p role="alert" className="mt-4 text-sm text-red-300">
              {error}
            </p>
          )}
        </section>
      </main>
    );
  }

  return (
    <DashboardClient
      user={{
        id: workspace.userId,
        username: "",
        fullName: workspace.businessName,
        role: "BUSINESS_OWNER",
        mustChangePassword: false,
        business: {
          id: workspace.businessId,
          name: workspace.businessName,
        },
      }}
      initialView="dashboard"
      offlineWorkspace
    />
  );
}
