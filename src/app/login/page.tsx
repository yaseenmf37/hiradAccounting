
"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Wallet, User, Lock, Eye, EyeOff, Loader2 } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.message || "ورود ناموفق بود.");
        return;
      }

      router.replace("/");
      router.refresh();
    } catch {
      setError("ارتباط با سرور برقرار نشد. دوباره تلاش کنید.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main dir="rtl" className="flex min-h-screen items-center justify-center bg-[#0b0f14] px-4 py-10 text-slate-100">
      <div className="w-full max-w-[420px]">
        <div className="mb-8 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-green-500 text-black shadow-lg shadow-green-500/10">
            <Wallet size={32} />
          </div>
          <h1 className="mt-5 text-2xl font-bold text-white">حسابینو</h1>
          <p className="mt-2 text-sm text-slate-500">سیستم مدیریت مالی و حسابداری</p>
        </div>

        <div className="rounded-3xl border border-[#222d38] bg-[#111820] p-7 shadow-2xl shadow-black/20 sm:p-9">
          <div className="mb-7">
            <h2 className="text-xl font-bold text-white">ورود به حساب</h2>
            <p className="mt-2 text-sm text-slate-400">
              برای ادامه، اطلاعات حساب خود را وارد کنید.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="mb-2 block text-sm text-slate-300">نام کاربری</label>
              <div className="flex h-12 items-center gap-3 rounded-xl border border-[#293642] bg-[#0b0f14] px-4 transition focus-within:border-green-500">
                <User size={18} className="text-slate-500" />
                <input
                  autoComplete="username"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder="نام کاربری خود را وارد کنید"
                  className="h-full w-full bg-transparent text-sm text-white outline-none placeholder:text-slate-600"
                  required
                  maxLength={80}
                />
              </div>
            </div>

            <div>
              <label className="mb-2 block text-sm text-slate-300">رمز عبور</label>
              <div className="flex h-12 items-center gap-3 rounded-xl border border-[#293642] bg-[#0b0f14] px-4 transition focus-within:border-green-500">
                <Lock size={18} className="text-slate-500" />
                <input
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="رمز عبور خود را وارد کنید"
                  className="h-full w-full bg-transparent text-sm text-white outline-none placeholder:text-slate-600"
                  required
                  maxLength={200}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="text-slate-500 transition hover:text-white"
                  aria-label={showPassword ? "مخفی کردن رمز" : "نمایش رمز"}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            {error && (
              <div role="alert" className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-green-500 text-sm font-bold text-black transition hover:bg-green-400 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  در حال ورود...
                </>
              ) : (
                "ورود به حساب"
              )}
            </button>
          </form>
        </div>

        <p className="mt-6 text-center text-xs text-slate-600">
          حسابینو | سیستم مدیریت مالی و حسابداری
        </p>
      </div>
    </main>
  );
}