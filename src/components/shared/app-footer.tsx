"use client";

export default function AppFooter() {
  return (
    <footer className="mt-auto flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-t border-[#222d38] bg-[#0b0f14] px-5 py-4 text-center text-xs text-slate-500">
      <span>
        طراحی‌شده توسط مجموعه{" "}
        <a
          href="https://hiradcode.ir"
          className="underline decoration-slate-700 underline-offset-4 transition hover:text-slate-300"
        >
          هیراد کد
        </a>
      </span>
    </footer>
  );
}
