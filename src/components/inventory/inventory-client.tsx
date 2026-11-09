"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  Package, Plus, Search, RefreshCw, AlertTriangle, Boxes,
  Archive, X, ChevronDown, Tag, Loader2, Pencil, History,
  ArrowDownToLine, ArrowUpFromLine, RotateCcw,
} from "lucide-react";
import CursorPagination from "@/components/shared/cursor-pagination";
import NumericInput from "@/components/shared/numeric-input";
import useCursorPage from "@/hooks/use-cursor-page";
import useDebouncedValue from "@/hooks/use-debounced-value";
import type { QuickAction } from "@/lib/quick-actions";

type Product = {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  unit: string;
  purchasePrice: string;
  salePrice: string;
  averageCost: string;
  inventoryValue: string;
  stock: string;
  minStock: string;
  isActive: boolean;
  categoryId: string | null;
  category: { id: string; name: string } | null;
};

type Category = {
  id: string;
  name: string;
  _count?: { products: number };
};

type Movement = {
  id: string;
  type: string;
  quantity: string;
  totalCost: string;
  averageCost: string;
  description: string | null;
  invoiceId: string | null;
  createdAt: string;
};

type Backorder = {
  id: string;
  shortage: string;
  product: { name: string; unit: string; stock: string };
};

type CurrencyUnit = "RIAL" | "TOMAN";
type Props = { currencyUnit: CurrencyUnit; quickAction?: QuickAction | null };

type ProductForm = {
  name: string;
  sku: string;
  barcode: string;
  categoryId: string;
  unit: string;
  purchasePrice: string;
  salePrice: string;
  initialStock: string;
  minStock: string;
};

const emptyForm: ProductForm = {
  name: "",
  sku: "",
  barcode: "",
  categoryId: "",
  unit: "عدد",
  purchasePrice: "0",
  salePrice: "0",
  initialStock: "0",
  minStock: "0",
};

const numberFormat = new Intl.NumberFormat("fa-IR", {
  maximumFractionDigits: 3,
});

function formatNumber(value: string | number) {
  const number = Number(value);
  return Number.isFinite(number) ? numberFormat.format(number) : "۰";
}

function formatMoney(value: string, unit: CurrencyUnit) {
  const parsed = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!parsed) return `— ${unit === "TOMAN" ? "تومان" : "ریال"}`;

  const [, sign, whole, fraction = ""] = parsed;
  const roundedRial =
    BigInt(whole) + (fraction[0] && fraction[0] >= "5" ? 1n : 0n);
  const isNegative = sign === "-" && roundedRial !== 0n;
  const displaySign = isNegative ? "−" : "";
  const formatter = new Intl.NumberFormat("fa-IR");

  if (unit === "RIAL") {
    return `${displaySign}${formatter.format(roundedRial)} ریال`;
  }

  const wholeToman = roundedRial / 10n;
  const rialRemainder = roundedRial % 10n;
  const fractionalToman = rialRemainder
    ? `٫${formatter.format(rialRemainder)}`
    : "";

  return `${displaySign}${formatter.format(wholeToman)}${fractionalToman} تومان`;
}

async function readResponse(response: Response) {
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.message || data.error || "عملیات ناموفق بود.");
  }

  return data;
}

export default function InventoryClient({ currencyUnit, quickAction }: Props) {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("active");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [form, setForm] = useState<ProductForm>(emptyForm);
  const [categoryName, setCategoryName] = useState("");
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState("");
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [movementProduct, setMovementProduct] = useState<Product | null>(null);
  const [historyProduct, setHistoryProduct] = useState<Product | null>(null);

  const [movementType, setMovementType] = useState<
    "ADJUSTMENT_IN" | "ADJUSTMENT_OUT"
  >("ADJUSTMENT_IN");

  const [movementQuantity, setMovementQuantity] = useState("1");
  const [movementUnitCost, setMovementUnitCost] = useState("");
  const [movementDescription, setMovementDescription] = useState("");
  const [movements, setMovements] = useState<Movement[]>([]);
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const [bulkPriceOpen, setBulkPriceOpen] = useState(false);
  const [bulkPriceField, setBulkPriceField] = useState<"PURCHASE" | "SALE">("SALE");
  const [bulkPercent, setBulkPercent] = useState("");
  const [backorders, setBackorders] = useState<Backorder[]>([]);
  const [productTotal, setProductTotal] = useState(0);
  const [productStats, setProductStats] = useState({
    total: 0,
    lowStock: 0,
    archived: 0,
    inventoryValue: "0",
  });
  const [backorderTotal, setBackorderTotal] = useState(0);
  const productPaging = useCursorPage();
  const backorderPaging = useCursorPage();
  const debouncedSearch = useDebouncedValue(search);

  useEffect(() => {
    if (
      quickAction?.action !== "product" ||
      quickAction.targetView !== "inventory"
    ) return;
    setForm(emptyForm);
    setEditingProduct(null);
    setError("");
    setModalOpen(true);
  }, [quickAction?.requestId, quickAction?.action]);

  const loadData = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError("");

    try {
      const params = new URLSearchParams({
        includeArchived: String(statusFilter === "all"),
        limit: "50",
      });
      if (productPaging.cursor) params.set("cursor", productPaging.cursor);
      if (categoryFilter !== "all") params.set("categoryId", categoryFilter);
      if (debouncedSearch.trim()) params.set("search", debouncedSearch.trim());

      const productsResponse = await fetch(`/api/products?${params}`, {
        cache: "no-store",
        signal,
      });
      const productsData = await readResponse(productsResponse);

      setProducts(productsData.products ?? []);
      setProductTotal(productsData.total ?? 0);
      setProductStats(productsData.stats ?? {
        total: 0,
        lowStock: 0,
        archived: 0,
        inventoryValue: "0",
      });
      productPaging.setNextCursor(productsData.nextCursor ?? null);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      setError(
        err instanceof Error
          ? err.message
          : "خطا در دریافت اطلاعات انبار.",
      );
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [statusFilter, categoryFilter, debouncedSearch, productPaging.cursor, productPaging.setNextCursor]);

  const loadBackorders = useCallback(async (signal?: AbortSignal) => {
    try {
      const params = new URLSearchParams({ limit: "50" });
      if (backorderPaging.cursor) params.set("cursor", backorderPaging.cursor);
      const response = await fetch(`/api/backorders?${params}`, {
        cache: "no-store",
        signal,
      });
      const data = await readResponse(response);
      setBackorders(data.backorders ?? []);
      setBackorderTotal(data.total ?? 0);
      backorderPaging.setNextCursor(data.nextCursor ?? null);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "دریافت کسری سفارش‌ها ناموفق بود.");
    }
  }, [backorderPaging.cursor, backorderPaging.setNextCursor]);

  useEffect(() => {
    const controller = new AbortController();
    void loadData(controller.signal);
    return () => controller.abort();
  }, [loadData]);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/api/categories", {
          cache: "no-store",
          signal: controller.signal,
        });
        const data = await readResponse(response);
        setCategories(Array.isArray(data) ? data : data.categories ?? []);
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "دریافت دسته‌بندی‌ها ناموفق بود.");
      }
    })();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadBackorders(controller.signal);
    return () => controller.abort();
  }, [loadBackorders]);

  const filteredProducts = products;

  const stats = useMemo(() => {
    return productStats;
  }, [productStats]);

  const bulkPricePreview = useMemo(() => {
    if (!/^\d{1,3}(\.\d{1,2})?$/.test(bulkPercent) || !selectedProductIds.length) return [];
    const [whole, fraction = ""] = bulkPercent.split(".");
    const basisPoints = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
    if (basisPoints <= 0n || basisPoints > 99999n) return [];
    return products.filter((product) => selectedProductIds.includes(product.id)).map((product) => {
      const before = BigInt(bulkPriceField === "PURCHASE" ? product.purchasePrice : product.salePrice);
      return {
        id: product.id,
        name: product.name,
        before,
        after: (before * (10000n + basisPoints) + 5000n) / 10000n,
      };
    });
  }, [bulkPercent, bulkPriceField, products, selectedProductIds]);

  async function applyBulkPriceIncrease() {
    if (!bulkPricePreview.length) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/products/prices/bulk", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productIds: selectedProductIds,
          field: bulkPriceField,
          percent: bulkPercent,
        }),
      });
      await readResponse(response);
      setBulkPriceOpen(false);
      setBulkPercent("");
      setSelectedProductIds([]);
      setSuccess("قیمت کالاهای انتخاب‌شده افزایش یافت.");
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "افزایش گروهی قیمت ناموفق بود.");
    } finally {
      setSaving(false);
    }
  }

  function updateForm(field: keyof ProductForm, value: string) {
    setForm((previous) => ({ ...previous, [field]: value }));
  }

  async function submitProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setSuccess("");

    try {
      const payload = {
        ...form,
        sku: form.sku.trim() || null,
        barcode: form.barcode.trim() || null,
        categoryId: form.categoryId || null,
      };

      const response = await fetch("/api/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      await readResponse(response);

      setModalOpen(false);
      setForm(emptyForm);
      setSuccess("کالا با موفقیت ثبت شد.");
      await loadData();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "ثبت کالا انجام نشد.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function submitCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!categoryName.trim()) return;

    setSaving(true);
    setError("");

    try {
      const response = await fetch("/api/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: categoryName.trim() }),
      });

      const data = await readResponse(response);
      const created = data.category ?? data;

      await loadData();

      if (created.id) {
        setForm((previous) => ({
          ...previous,
          categoryId: created.id,
        }));
      }

      setCategoryName("");
      setCategoryModalOpen(false);
      setSuccess("دسته‌بندی با موفقیت ایجاد شد.");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "ساخت دسته‌بندی انجام نشد.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function submitProductEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingProduct) return;

    setSaving(true);
    setError("");
    setSuccess("");

    try {
      const payload = {
        ...form,
        sku: form.sku.trim() || null,
        barcode: form.barcode.trim() || null,
        categoryId: form.categoryId || null,
      };

      const response = await fetch(`/api/products/${editingProduct.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      await readResponse(response);

      setModalOpen(false);
      setEditingProduct(null);
      setForm(emptyForm);
      setSuccess("اطلاعات کالا با موفقیت ویرایش شد.");
      await loadData();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "ویرایش کالا انجام نشد.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function archiveProduct(product: Product) {
    if (!window.confirm(`آیا از آرشیو کردن «${product.name}» مطمئن هستید؟`)) {
      return;
    }

    setError("");
    setSuccess("");

    try {
      const response = await fetch(`/api/products/${product.id}`, {
        method: "DELETE",
      });

      await readResponse(response);

      setSuccess("کالا با موفقیت آرشیو شد.");
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "آرشیو کالا انجام نشد.");
    }
  }

  async function restoreProduct(product: Product) {
    setError("");
    setSuccess("");

    try {
      const response = await fetch(`/api/products/${product.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: true }),
      });

      await readResponse(response);

      setSuccess("کالا با موفقیت فعال شد.");
      await loadData();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "فعال‌سازی کالا انجام نشد.",
      );
    }
  }

  async function submitMovement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!movementProduct) return;

    setSaving(true);
    setError("");
    setSuccess("");

    try {
      const response = await fetch(
        `/api/products/${movementProduct.id}/movements`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: movementType,
            quantity: movementQuantity,
            ...(movementType === "ADJUSTMENT_IN"
              ? { unitCost: movementUnitCost }
              : {}),
            description: movementDescription.trim() || null,
          }),
        },
      );

      await readResponse(response);

      setMovementProduct(null);
      setMovementQuantity("1");
      setMovementUnitCost("");
      setMovementDescription("");
      setSuccess("گردش موجودی با موفقیت ثبت شد.");
      await loadData();
      await loadBackorders();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "ثبت گردش موجودی انجام نشد.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function openHistory(product: Product) {
    setHistoryProduct(product);
    setMovements([]);
    setError("");

    try {
      const response = await fetch(
        `/api/products/${product.id}/movements`,
        { cache: "no-store" },
      );

      const data = await readResponse(response);
      setMovements(data.movements ?? []);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "دریافت تاریخچه ناموفق بود.",
      );
      setHistoryProduct(null);
    }
  }

  function startEditing(product: Product) {
    setForm({
      name: product.name,
      sku: product.sku ?? "",
      barcode: product.barcode ?? "",
      categoryId: product.categoryId ?? "",
      unit: product.unit,
      purchasePrice:
        currencyUnit === "TOMAN"
          ? (BigInt(product.purchasePrice) / 10n).toString()
          : product.purchasePrice,
      salePrice:
        currencyUnit === "TOMAN"
          ? (BigInt(product.salePrice) / 10n).toString()
          : product.salePrice,
      initialStock: "0",
      minStock: product.minStock,
    });

    setEditingProduct(product);
    setError("");
    setModalOpen(true);
  }

  function openMovement(product: Product) {
    setMovementUnitCost("");
    setMovementQuantity("1");
    setMovementDescription("");
    setMovementType("ADJUSTMENT_IN");
    setMovementProduct(product);
  }

  return (
    <section className="space-y-6" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-green-400">
            <Package size={20} />
            <span className="text-xs font-semibold">مدیریت موجودی</span>
          </div>

          <h1 className="mt-2 text-2xl font-bold text-white">
            مدیریت انبار
          </h1>

          <p className="mt-2 text-sm text-slate-400">
            کنترل کالاها، دسته‌بندی‌ها و موجودی کسب‌وکار
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              void loadData();
              void loadBackorders();
              backorderPaging.resetPages();
            }}
            disabled={loading}
            className="flex items-center gap-2 rounded-xl border border-[#293642] bg-[#111820] px-4 py-3 text-sm text-slate-300 transition hover:border-green-500/40 disabled:opacity-50"
          >
            <RefreshCw
              size={16}
              className={loading ? "animate-spin" : ""}
            />
            بروزرسانی
          </button>

          <button
            type="button"
            onClick={() => setCategoryModalOpen(true)}
            className="flex items-center gap-2 rounded-xl border border-[#293642] bg-[#111820] px-4 py-3 text-sm text-slate-300 transition hover:border-green-500/40"
          >
            <Tag size={16} />
            دسته‌بندی جدید
          </button>

          <button
            type="button"
            onClick={() => {
              setForm(emptyForm);
              setEditingProduct(null);
              setModalOpen(true);
            }}
            className="flex items-center gap-2 rounded-xl bg-green-500 px-4 py-3 text-sm font-bold text-black transition hover:bg-green-400"
          >
            <Plus size={17} />
            افزودن کالا
          </button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat icon={Boxes} label="کالاهای فعال" value={stats.total} />
        <Stat
          icon={AlertTriangle}
          label="نیازمند بررسی موجودی"
          value={stats.lowStock}
          warning
        />
        <Stat
          icon={Archive}
          label="کالاهای آرشیوشده"
          value={stats.archived}
        />

        <div className="rounded-2xl border border-[#222d38] bg-[#111820] p-5">
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-400">
              ارزش کل موجودی فعال
            </span>
            <Boxes size={19} className="text-blue-400" />
          </div>

          <p className="mt-4 break-words text-xl font-bold text-white">
            {formatMoney(stats.inventoryValue, currencyUnit)}
          </p>
        </div>
      </div>

      <div className="rounded-2xl border border-[#222d38] bg-[#111820] p-4">
        <div className="flex flex-col gap-3 lg:flex-row">
          <div className="relative flex-1">
            <Search
              size={18}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500"
            />

            <input
              value={search}
              onChange={(event) => {
                productPaging.resetPages();
                setSearch(event.target.value);
              }}
              placeholder="جست‌وجوی نام کالا، کد یا بارکد..."
              className="h-11 w-full rounded-xl border border-[#293642] bg-[#0b0f14] pr-10 pl-3 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-green-500/60"
            />
          </div>

          <div className="relative">
            <select
              value={categoryFilter}
              onChange={(event) => {
                productPaging.resetPages();
                setCategoryFilter(event.target.value);
              }}
              className="h-11 min-w-44 appearance-none rounded-xl border border-[#293642] bg-[#0b0f14] px-4 pl-10 text-sm text-slate-300 outline-none focus:border-green-500/60"
            >
              <option value="all">همه دسته‌بندی‌ها</option>

              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>

            <ChevronDown
              size={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"
            />
          </div>

          <select
            value={statusFilter}
            onChange={(event) => {
              productPaging.resetPages();
              setStatusFilter(event.target.value);
            }}
            className="h-11 rounded-xl border border-[#293642] bg-[#0b0f14] px-4 text-sm text-slate-300 outline-none focus:border-green-500/60"
          >
            <option value="active">کالاهای فعال</option>
            <option value="all">همه کالاها</option>
          </select>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-400">
          {error}

          <button
            onClick={() => void loadData()}
            className="mr-3 underline"
          >
            تلاش مجدد
          </button>
        </div>
      )}

      {success && (
        <div className="rounded-xl border border-green-500/20 bg-green-500/10 p-4 text-sm text-green-400">
          {success}

          <button
            onClick={() => setSuccess("")}
            className="mr-3 underline"
          >
            بستن
          </button>
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-[#222d38] bg-[#111820]">
        <div className="flex items-center justify-between border-b border-[#222d38] px-5 py-4">
          <div>
            <h2 className="font-bold text-white">فهرست کالاها</h2>
            <p className="mt-1 text-xs text-slate-500">
              تعداد اقلام این صفحه: {formatNumber(filteredProducts.length)} قلم
              {" · "}در فهرست: {formatNumber(productTotal)} قلم
            </p>
          </div>
          <button
            type="button"
            disabled={!selectedProductIds.length}
            onClick={() => setBulkPriceOpen(true)}
            className="rounded-lg border border-green-500/30 px-3 py-2 text-xs text-green-400 disabled:opacity-40"
          >
            افزایش قیمت انتخاب‌شده‌ها ({formatNumber(selectedProductIds.length)} قلم)
          </button>
        </div>

        {loading ? (
          <div className="p-12 text-center text-sm text-slate-500">
            در حال دریافت اطلاعات انبار...
          </div>
        ) : filteredProducts.length === 0 ? (
          <div className="p-12 text-center">
            <Package size={35} className="mx-auto text-slate-600" />

            <p className="mt-4 font-semibold text-slate-300">
              کالایی برای نمایش وجود ندارد
            </p>

            <p className="mt-2 text-xs text-slate-500">
              جست‌وجو یا فیلترها را تغییر دهید یا کالای جدیدی اضافه کنید.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1150px] text-right text-sm">
              <thead className="bg-[#0b0f14] text-xs text-slate-500">
                <tr>
                  <th className="px-3 py-4">
                    <input
                      type="checkbox"
                      aria-label="انتخاب همه کالاها"
                      checked={filteredProducts.length > 0 && filteredProducts.every((product) => selectedProductIds.includes(product.id))}
                      onChange={(event) => setSelectedProductIds((current) => event.target.checked
                        ? [...new Set([...current, ...filteredProducts.map((product) => product.id)])]
                        : current.filter((id) => !filteredProducts.some((product) => product.id === id)))}
                    />
                  </th>
                  <th className="px-5 py-4 font-medium">نام کالا</th>
                  <th className="px-5 py-4 font-medium">دسته‌بندی</th>
                  <th className="px-5 py-4 font-medium">کد کالا</th>
                  <th className="px-5 py-4 font-medium">قیمت خرید</th>
                  <th className="px-5 py-4 font-medium">قیمت فروش</th>
                  <th className="px-5 py-4 font-medium">میانگین بهای تمام‌شده</th>
                  <th className="px-5 py-4 font-medium">ارزش موجودی</th>
                  <th className="px-5 py-4 font-medium">موجودی</th>
                  <th className="px-5 py-4 font-medium">وضعیت</th>
                  <th className="px-5 py-4 font-medium">عملیات</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-[#222d38]">
                {filteredProducts.map((product) => {
                  const lowStock =
                    Number(product.stock) <= Number(product.minStock);

                  return (
                    <tr
                      key={product.id}
                      className="transition hover:bg-white/[0.02]"
                    >
                      <td className="px-3 py-4">
                        <input
                          type="checkbox"
                          aria-label={`انتخاب ${product.name}`}
                          checked={selectedProductIds.includes(product.id)}
                          onChange={(event) => setSelectedProductIds((current) => event.target.checked
                            ? [...new Set([...current, product.id])]
                            : current.filter((id) => id !== product.id))}
                        />
                      </td>
                      <td className="px-5 py-4">
                        <p className="font-semibold text-white">
                          {product.name}
                        </p>

                        {product.barcode && (
                          <p
                            dir="ltr"
                            className="mt-1 text-right text-[11px] text-slate-500"
                          >
                            {product.barcode}
                          </p>
                        )}
                      </td>

                      <td className="px-5 py-4 text-slate-400">
                        {product.category?.name ?? "بدون دسته‌بندی"}
                      </td>

                      <td
                        dir="ltr"
                        className="px-5 py-4 text-right text-slate-400"
                      >
                        {product.sku ?? "—"}
                      </td>

                      <td className="px-5 py-4 text-slate-300">
                        {formatMoney(product.purchasePrice, currencyUnit)}
                      </td>

                      <td className="px-5 py-4 text-slate-300">
                        {formatMoney(product.salePrice, currencyUnit)}
                      </td>

                      <td className="px-5 py-4 text-blue-300">
                        {formatMoney(product.averageCost, currencyUnit)}
                      </td>

                      <td className="px-5 py-4 font-semibold text-white">
                        {formatMoney(product.inventoryValue, currencyUnit)}
                      </td>

                      <td className="px-5 py-4">
                        <span
                          className={
                            lowStock ? "text-amber-400" : "text-green-400"
                          }
                        >
                          {formatNumber(product.stock)} {product.unit}
                        </span>
                      </td>

                      <td className="px-5 py-4">
                        {product.isActive ? (
                          <span className="rounded-lg bg-green-500/10 px-2.5 py-1.5 text-xs text-green-400">
                            فعال
                          </span>
                        ) : (
                          <span className="rounded-lg bg-slate-500/10 px-2.5 py-1.5 text-xs text-slate-400">
                            آرشیو
                          </span>
                        )}
                      </td>

                      <td className="px-5 py-4">
                        <div className="flex items-center gap-2">
                          {product.isActive ? (
                            <>
                              <button
                                type="button"
                                title="ویرایش کالا"
                                onClick={() => startEditing(product)}
                                className="rounded-lg border border-[#293642] p-2 text-slate-300 hover:border-green-500/50 hover:text-green-400"
                              >
                                <Pencil size={16} />
                              </button>

                              <button
                                type="button"
                                title="ورود و خروج موجودی"
                                onClick={() => openMovement(product)}
                                className="rounded-lg border border-[#293642] p-2 text-blue-400 hover:border-blue-500/50"
                              >
                                <ArrowUpFromLine size={16} />
                              </button>

                              <button
                                type="button"
                                title="تاریخچه موجودی"
                                onClick={() => void openHistory(product)}
                                className="rounded-lg border border-[#293642] p-2 text-amber-400 hover:border-amber-500/50"
                              >
                                <History size={16} />
                              </button>

                              <button
                                type="button"
                                title="آرشیو کالا"
                                onClick={() => void archiveProduct(product)}
                                className="rounded-lg border border-[#293642] p-2 text-red-400 hover:border-red-500/50"
                              >
                                <Archive size={16} />
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              title="فعال‌سازی مجدد"
                              onClick={() => void restoreProduct(product)}
                              className="flex items-center gap-2 rounded-lg border border-green-500/30 px-3 py-2 text-xs text-green-400 hover:bg-green-500/10"
                            >
                              <RotateCcw size={15} />
                              فعال‌سازی
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <CursorPagination
          total={productTotal}
          page={productPaging.page}
          hasNext={Boolean(productPaging.nextCursor)}
          loading={loading}
          onPrevious={productPaging.previousPage}
          onNext={productPaging.nextPage}
        />
      </div>

      {bulkPriceOpen && (
        <Modal title="افزایش درصدی قیمت" onClose={() => setBulkPriceOpen(false)}>
          <div className="space-y-4">
            <label className="block space-y-2 text-sm text-slate-300">
              نوع قیمت
              <select value={bulkPriceField} onChange={(event) => setBulkPriceField(event.target.value as "PURCHASE" | "SALE")} className={inputClass}>
                <option value="PURCHASE">قیمت خرید</option>
                <option value="SALE">قیمت فروش</option>
              </select>
            </label>
            <label className="block space-y-2 text-sm text-slate-300">
              درصد افزایش
              <NumericInput min="0.01" max="999.99" step="0.01" value={bulkPercent} onChange={(event) => setBulkPercent(event.target.value)} onFocus={(event) => event.currentTarget.select()} className={inputClass} />
            </label>
            <p className="text-xs text-slate-400">
              تعداد اقلام انتخاب‌شده: {formatNumber(bulkPricePreview.length)} قلم
            </p>
            <div className="max-h-60 overflow-y-auto rounded-xl border border-[#293642]">
              <table className="w-full text-right text-xs">
                <thead><tr className="text-slate-500"><th className="p-3">کالا</th><th className="p-3">قیمت فعلی</th><th className="p-3">قیمت جدید</th></tr></thead>
                <tbody>
                  {bulkPricePreview.map((item) => (
                    <tr key={item.id} className="border-t border-[#293642] text-slate-300">
                      <td className="p-3">{item.name}</td>
                      <td className="p-3">{formatMoney(item.before.toString(), currencyUnit)}</td>
                      <td className="p-3 text-green-400">{formatMoney(item.after.toString(), currencyUnit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!bulkPricePreview.length && <p className="p-3 text-slate-500">درصد معتبر و محصولات انتخاب‌شده را بررسی کنید.</p>}
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setBulkPriceOpen(false)} className="rounded-lg border border-[#293642] px-4 py-2 text-sm text-slate-300">انصراف</button>
              <button type="button" disabled={saving || !bulkPricePreview.length} onClick={() => void applyBulkPriceIncrease()} className="rounded-lg bg-green-500 px-4 py-2 text-sm font-bold text-black disabled:opacity-40">تأیید و اعمال</button>
            </div>
          </div>
        </Modal>
      )}

      {backorderTotal > 0 && (
        <div className="rounded-2xl border border-amber-500/20 bg-[#111820]">
          <div className="border-b border-[#222d38] p-5">
            <h2 className="font-bold text-white">کسری موجودی</h2>
            <p className="mt-1 text-xs text-slate-400">
              کالاهایی که موجودی انبارشان منفی است نمایش داده می‌شوند؛ با ورود موجودی، مقدار کسری به‌طور خودکار کاهش می‌یابد.
              {" "}تعداد اقلام این صفحه: {formatNumber(backorders.length)} قلم از {formatNumber(backorderTotal)} قلم
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-right text-sm">
              <thead className="text-xs text-slate-500"><tr><th className="p-4">کالا</th><th className="p-4">موجودی فعلی</th><th className="p-4">مقدار کسری</th></tr></thead>
              <tbody>
                {backorders.map((entry) => (
                  <tr key={entry.id} className="border-t border-[#222d38] text-slate-300">
                    <td className="p-4">{entry.product.name}</td>
                    <td className="p-4 text-rose-400">
                      {formatNumber(entry.product.stock)} {entry.product.unit}
                    </td>
                    <td className="p-4 text-amber-400">{formatNumber(entry.shortage)} {entry.product.unit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <CursorPagination
            total={backorderTotal}
            page={backorderPaging.page}
            hasNext={Boolean(backorderPaging.nextCursor)}
            loading={false}
            onPrevious={backorderPaging.previousPage}
            onNext={backorderPaging.nextPage}
          />
        </div>
      )}

      {modalOpen && (
        <Modal
          title={editingProduct ? "ویرایش کالا" : "افزودن کالای جدید"}
          onClose={() => {
            setModalOpen(false);
            setEditingProduct(null);
          }}
        >
          <form
            onSubmit={editingProduct ? submitProductEdit : submitProduct}
            className="space-y-4"
          >
            <Field label="نام کالا *">
              <input
                required
                minLength={2}
                maxLength={150}
                value={form.name}
                onChange={(event) => updateForm("name", event.target.value)}
                placeholder="مثلاً ورق MDF سفید"
                className={inputClass}
              />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="کد کالا (SKU)">
                <input
                  maxLength={80}
                  value={form.sku}
                  onChange={(event) => updateForm("sku", event.target.value)}
                  className={inputClass}
                  dir="ltr"
                />
              </Field>

              <Field label="بارکد">
                <input
                  maxLength={100}
                  value={form.barcode}
                  onChange={(event) =>
                    updateForm("barcode", event.target.value)
                  }
                  className={inputClass}
                  dir="ltr"
                />
              </Field>
            </div>

            <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
              <Field label="دسته‌بندی">
                <select
                  value={form.categoryId}
                  onChange={(event) =>
                    updateForm("categoryId", event.target.value)
                  }
                  className={inputClass}
                >
                  <option value="">بدون دسته‌بندی</option>

                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </Field>

              <div className="flex items-end">
                <button
                  type="button"
                  onClick={() => setCategoryModalOpen(true)}
                  className="h-11 rounded-xl border border-green-500/30 px-4 text-sm text-green-400 hover:bg-green-500/10"
                >
                  <Plus size={15} className="inline ml-1" />
                  دسته جدید
                </button>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="واحد شمارش *">
                <input
                  required
                  maxLength={30}
                  value={form.unit}
                  onChange={(event) => updateForm("unit", event.target.value)}
                  placeholder="عدد، متر، کیلوگرم..."
                  className={inputClass}
                />
              </Field>

              <Field label="حداقل موجودی">
                <NumericInput
                  min="0"
                  step="0.001"
                  value={form.minStock}
                  onChange={(event) =>
                    updateForm("minStock", event.target.value)
                  }
                  className={inputClass}
                  dir="ltr"
                />
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label={`قیمت خرید (${currencyUnit === "TOMAN" ? "تومان" : "ریال"})`}
              >
                <NumericInput
                  min="0"
                  step="1"
                  value={form.purchasePrice}
                  onChange={(event) =>
                    updateForm("purchasePrice", event.target.value)
                  }
                  className={inputClass}
                  dir="ltr"
                />
              </Field>

              <Field
                label={`قیمت فروش (${currencyUnit === "TOMAN" ? "تومان" : "ریال"})`}
              >
                <NumericInput
                  min="0"
                  step="1"
                  value={form.salePrice}
                  onChange={(event) =>
                    updateForm("salePrice", event.target.value)
                  }
                  className={inputClass}
                  dir="ltr"
                />
              </Field>
            </div>

            {!editingProduct && (
              <Field label="موجودی اولیه">
                <NumericInput
                  min="0"
                  step="0.001"
                  value={form.initialStock}
                  onChange={(event) =>
                    updateForm("initialStock", event.target.value)
                  }
                  className={inputClass}
                  dir="ltr"
                />
              </Field>
            )}

            <div className="flex justify-end gap-3 border-t border-[#293642] pt-4">
              <button
                type="button"
                onClick={() => {
                  setModalOpen(false);
                  setEditingProduct(null);
                }}
                className="rounded-xl border border-[#293642] px-5 py-3 text-sm text-slate-300"
              >
                انصراف
              </button>

              <button
                type="submit"
                disabled={saving}
                className="flex items-center gap-2 rounded-xl bg-green-500 px-5 py-3 text-sm font-bold text-black hover:bg-green-400 disabled:opacity-50"
              >
                {saving && <Loader2 size={16} className="animate-spin" />}
                {editingProduct ? "ذخیره تغییرات" : "ثبت کالا"}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {categoryModalOpen && (
        <Modal
          title="ایجاد دسته‌بندی جدید"
          onClose={() => setCategoryModalOpen(false)}
        >
          <form onSubmit={submitCategory} className="space-y-4">
            <Field label="نام دسته‌بندی *">
              <input
                required
                minLength={2}
                maxLength={100}
                autoFocus
                value={categoryName}
                onChange={(event) => setCategoryName(event.target.value)}
                placeholder="مثلاً ورق و صفحات"
                className={inputClass}
              />
            </Field>

            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setCategoryModalOpen(false)}
                className="rounded-xl border border-[#293642] px-5 py-3 text-sm text-slate-300"
              >
                انصراف
              </button>

              <button
                type="submit"
                disabled={saving}
                className="flex items-center gap-2 rounded-xl bg-green-500 px-5 py-3 text-sm font-bold text-black disabled:opacity-50"
              >
                {saving && <Loader2 size={16} className="animate-spin" />}
                ایجاد دسته‌بندی
              </button>
            </div>
          </form>
        </Modal>
      )}

      {movementProduct && (
        <Modal
          title={`ثبت گردش موجودی — ${movementProduct.name}`}
          onClose={() => setMovementProduct(null)}
        >
          <form onSubmit={submitMovement} className="space-y-4">
            <div className="rounded-xl border border-[#293642] bg-[#111b24] p-4">
              <p className="text-sm text-slate-400">موجودی فعلی</p>
              <p className="mt-1 text-xl font-bold text-white">
                {formatNumber(movementProduct.stock)} {movementProduct.unit}
              </p>
            </div>

            <div>
              <label className="mb-2 block text-sm text-slate-300">
                نوع عملیات
              </label>

              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setMovementType("ADJUSTMENT_IN")}
                  className={`rounded-xl border p-3 text-sm ${
                    movementType === "ADJUSTMENT_IN"
                      ? "border-green-500 bg-green-500/10 text-green-400"
                      : "border-[#293642] text-slate-400"
                  }`}
                >
                  <ArrowDownToLine className="mx-auto mb-2" size={20} />
                  ورود به انبار
                </button>

                <button
                  type="button"
                  onClick={() => setMovementType("ADJUSTMENT_OUT")}
                  className={`rounded-xl border p-3 text-sm ${
                    movementType === "ADJUSTMENT_OUT"
                      ? "border-red-500 bg-red-500/10 text-red-400"
                      : "border-[#293642] text-slate-400"
                  }`}
                >
                  <ArrowUpFromLine className="mx-auto mb-2" size={20} />
                  خروج از انبار
                </button>
              </div>
            </div>

            <Field label="مقدار">
              <NumericInput
                min="0.001"
                step="0.001"
                required
                value={movementQuantity}
                onChange={(event) =>
                  setMovementQuantity(event.target.value)
                }
                className={inputClass}
                dir="ltr"
              />
            </Field>

            {movementType === "ADJUSTMENT_IN" && (
              <Field
                label={`بهای خرید هر واحد (${currencyUnit === "TOMAN" ? "تومان" : "ریال"})`}
              >
                <NumericInput
                  min="0"
                  step="1"
                  required
                  value={movementUnitCost}
                  onChange={(event) =>
                    setMovementUnitCost(event.target.value)
                  }
                  placeholder="قیمت خرید هر واحد"
                  className={inputClass}
                  dir="ltr"
                />
              </Field>
            )}

            <Field label="توضیحات (اختیاری)">
              <textarea
                value={movementDescription}
                onChange={(event) =>
                  setMovementDescription(event.target.value)
                }
                rows={3}
                placeholder="مثلاً خرید جدید یا اصلاح موجودی..."
                className="w-full resize-none rounded-xl border border-[#293642] bg-[#111b24] px-4 py-3 text-white outline-none focus:border-green-500"
              />
            </Field>

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => setMovementProduct(null)}
                className="flex-1 rounded-xl border border-[#293642] px-4 py-3 text-sm text-slate-300 hover:bg-white/5"
              >
                انصراف
              </button>

              <button
                type="submit"
                disabled={
                  saving ||
                  (movementType === "ADJUSTMENT_IN" &&
                    movementUnitCost.trim() === "")
                }
                className="flex-1 rounded-xl bg-green-500 px-4 py-3 text-sm font-bold text-black transition hover:bg-green-400 disabled:opacity-50"
              >
                {saving ? "در حال ثبت..." : "ثبت عملیات"}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {historyProduct && (
        <Modal
          title={`تاریخچه موجودی — ${historyProduct.name}`}
          onClose={() => setHistoryProduct(null)}
        >
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-[#293642] bg-[#111b24] p-4">
                <p className="text-xs text-slate-400">موجودی فعلی</p>
                <p className="mt-2 text-lg font-bold text-white">
                  {formatNumber(historyProduct.stock)} {historyProduct.unit}
                </p>
              </div>

              <div className="rounded-xl border border-[#293642] bg-[#111b24] p-4">
                <p className="text-xs text-slate-400">
                  میانگین بهای تمام‌شده
                </p>
                <p className="mt-2 text-sm font-bold text-blue-300">
                  {formatMoney(historyProduct.averageCost, currencyUnit)}
                </p>
              </div>

              <div className="rounded-xl border border-[#293642] bg-[#111b24] p-4">
                <p className="text-xs text-slate-400">ارزش موجودی</p>
                <p className="mt-2 text-sm font-bold text-white">
                  {formatMoney(historyProduct.inventoryValue, currencyUnit)}
                </p>
              </div>
            </div>

            <div className="max-h-[420px] space-y-3 overflow-y-auto">
              {movements.length === 0 ? (
                <div className="rounded-xl border border-[#293642] p-6 text-center text-sm text-slate-400">
                  هنوز هیچ گردش موجودی برای این کالا ثبت نشده است.
                </div>
              ) : (
                movements.map((movement) => {
                  const isIncoming = [
                    "INITIAL_STOCK",
                    "ADJUSTMENT_IN",
                    "PURCHASE",
                    "RETURN_IN",
                  ].includes(movement.type);

                  const labels: Record<string, string> = {
                    INITIAL_STOCK: "موجودی اولیه",
                    ADJUSTMENT_IN: "ورود دستی",
                    ADJUSTMENT_OUT: "خروج دستی",
                    PURCHASE: "خرید",
                    SALE: "فروش",
                    RETURN_IN: "برگشت از فروش",
                    RETURN_OUT: "برگشت به تأمین‌کننده",
                  };

                  return (
                    <div
                      key={movement.id}
                      className="rounded-xl border border-[#293642] bg-[#111b24] p-4"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          {isIncoming ? (
                            <ArrowDownToLine
                              size={18}
                              className="text-green-400"
                            />
                          ) : (
                            <ArrowUpFromLine
                              size={18}
                              className="text-red-400"
                            />
                          )}

                          <span className="text-sm font-medium text-white">
                            {labels[movement.type] ?? movement.type}
                          </span>
                        </div>

                        <span
                          className={`font-bold ${
                            isIncoming ? "text-green-400" : "text-red-400"
                          }`}
                        >
                          {isIncoming ? "+" : "-"}
                          {formatNumber(movement.quantity)} {historyProduct.unit}
                        </span>
                      </div>

                      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                        <span>
                          {new Date(movement.createdAt).toLocaleString("fa-IR")}
                        </span>

                        {movement.invoiceId && (
                          <span>شناسه فاکتور: {movement.invoiceId}</span>
                        )}
                      </div>

                      <div className="mt-3 grid grid-cols-2 gap-3">
                        <div className="rounded-lg bg-black/20 p-3">
                          <p className="text-xs text-slate-500">
                            ارزش کل گردش
                          </p>
                          <p className="mt-1 text-sm font-semibold text-white">
                            {formatMoney(movement.totalCost, currencyUnit)}
                          </p>
                        </div>

                        <div className="rounded-lg bg-black/20 p-3">
                          <p className="text-xs text-slate-500">
                            میانگین بهای هر واحد
                          </p>
                          <p className="mt-1 text-sm font-semibold text-white">
                            {formatMoney(movement.averageCost, currencyUnit)}
                          </p>
                        </div>
                      </div>

                      {movement.description && (
                        <p className="mt-2 text-sm text-slate-400">
                          {movement.description}
                        </p>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            <button
              type="button"
              onClick={() => setHistoryProduct(null)}
              className="w-full rounded-xl border border-[#293642] px-4 py-3 text-sm text-slate-300 hover:bg-white/5"
            >
              بستن
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}

const inputClass =
  "h-11 w-full rounded-xl border border-[#293642] bg-[#0b0f14] px-3 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-green-500/60";

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-2">
      <span className="text-xs font-medium text-slate-400">{label}</span>
      {children}
    </label>
  );
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="flex h-[calc(100dvh-2rem)] w-full flex-col overflow-hidden rounded-2xl border border-[#293642] bg-[#111820] shadow-2xl">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-lg font-bold text-white">{title}</h2>

          <button
            type="button"
            onClick={onClose}
            aria-label="بستن"
          >
            <X size={20} className="text-slate-400 hover:text-white" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-6">{children}</div>
      </div>
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  warning = false,
}: {
  icon: typeof Package;
  label: string;
  value: number;
  warning?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-[#222d38] bg-[#111820] p-5">
      <div className="flex items-center justify-between">
        <span className="text-sm text-slate-400">{label}</span>

        <Icon
          size={19}
          className={warning ? "text-amber-400" : "text-green-400"}
        />
      </div>

      <p className="mt-4 text-2xl font-bold text-white">
        {formatNumber(value)}
      </p>
    </div>
  );
}