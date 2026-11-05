"use client";

type Props = {
  total: number;
  page: number;
  hasNext: boolean;
  loading: boolean;
  onPrevious: () => void;
  onNext: () => void;
};

export default function CursorPagination({
  total,
  page,
  hasNext,
  loading,
  onPrevious,
  onNext,
}: Props) {
  const pageSize = 50;
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);

  return (
    <nav
      aria-label="صفحه‌بندی فهرست"
      className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 px-5 py-4 text-sm text-slate-400"
    >
      <span>
        نمایش {start.toLocaleString("fa-IR")} تا{" "}
        {end.toLocaleString("fa-IR")} از {total.toLocaleString("fa-IR")}
      </span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onPrevious}
          disabled={loading || page <= 1}
          className="rounded-lg border border-white/10 px-3 py-2 disabled:opacity-40"
        >
          قبلی
        </button>
        <span className="min-w-20 text-center">
          صفحه {page.toLocaleString("fa-IR")}
        </span>
        <button
          type="button"
          onClick={onNext}
          disabled={loading || !hasNext}
          className="rounded-lg border border-white/10 px-3 py-2 disabled:opacity-40"
        >
          بعدی
        </button>
      </div>
    </nav>
  );
}
