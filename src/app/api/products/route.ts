import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { currencyInputToRial } from "@/lib/currency";
import {
  getCursorPage,
  parseCursorPageParams,
} from "@/lib/cursor-pagination";

const productSchema = z.object({
  name: z.string().trim().min(2).max(150),
  sku: z.string().trim().max(80).optional().nullable(),
  barcode: z.string().trim().max(100).optional().nullable(),
  categoryId: z.string().optional().nullable(),
  unit: z.string().trim().min(1).max(30).default("عدد"),
  purchasePrice: z.string().regex(/^\d{1,18}(\.\d)?$/).default("0"),
  salePrice: z.string().regex(/^\d{1,18}(\.\d)?$/).default("0"),
  initialStock: z.string().regex(/^\d+(\.\d{1,3})?$/).default("0"),
  minStock: z.string().regex(/^\d+(\.\d{1,3})?$/).default("0"),
});

function serializeProduct(product: {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  unit: string;
  purchasePrice: bigint;
  salePrice: bigint;
  averageCost: Prisma.Decimal;
  inventoryValue: bigint;
  stock: Prisma.Decimal;
  minStock: Prisma.Decimal;
  isActive: boolean;
  category: { id: string; name: string } | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    ...product,
    purchasePrice: product.purchasePrice.toString(),
    salePrice: product.salePrice.toString(),
    averageCost: product.averageCost.toString(),
    inventoryValue: product.inventoryValue.toString(),
    stock: product.stock.toString(),
    minStock: product.minStock.toString(),
  };
}

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json(
        { message: "لطفاً وارد حساب کاربری شوید." },
        { status: 401 }
      );
    }

    if (user.role !== "BUSINESS_OWNER" || !user.business?.isActive) {
      return NextResponse.json(
        { message: "دسترسی به این بخش مجاز نیست." },
        { status: 403 }
      );
    }

    const searchParams = request.nextUrl.searchParams;
    const search = searchParams.get("search")?.trim();
    const categoryId = searchParams.get("categoryId");
    const includeArchived = searchParams.get("includeArchived") === "true";
    const rawIds = searchParams.get("ids");
    const ids = rawIds ? rawIds.split(",").filter(Boolean).slice(0, 100) : [];
    if (ids.length > 0) {
      const products = await prisma.product.findMany({
        where: {
          businessId: user.business.id,
          id: { in: ids },
          ...(includeArchived ? {} : { isActive: true }),
          ...(categoryId ? { categoryId } : {}),
          ...(search
            ? {
                OR: [
                  { name: { contains: search, mode: "insensitive" as const } },
                  { sku: { contains: search, mode: "insensitive" as const } },
                  { barcode: { contains: search, mode: "insensitive" as const } },
                ],
              }
            : {}),
        },
        include: {
          category: { select: { id: true, name: true } },
        },
      });

      return NextResponse.json({
        products: products.map(serializeProduct),
        total: products.length,
        nextCursor: null,
      });
    }

    const pagination = parseCursorPageParams(searchParams);

    if (!pagination) {
      return NextResponse.json(
        { message: "محدوده تعداد نتایج معتبر نیست." },
        { status: 400 }
      );
    }

    const where = {
      businessId: user.business.id,
      ...(includeArchived ? {} : { isActive: true }),
      ...(categoryId ? { categoryId } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" as const } },
              { sku: { contains: search, mode: "insensitive" as const } },
              { barcode: { contains: search, mode: "insensitive" as const } },
            ],
          }
        : {}),
    };

    const [rows, total, stats] = await prisma.$transaction([
      prisma.product.findMany({
        where,
        select: {
          id: true,
          name: true,
          sku: true,
          barcode: true,
          unit: true,
          purchasePrice: true,
          salePrice: true,
          averageCost: true,
          inventoryValue: true,
          stock: true,
          minStock: true,
          isActive: true,
          categoryId: true,
          createdAt: true,
          updatedAt: true,
          category: {
            select: { id: true, name: true },
          },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: pagination.limit + 1,
        ...(pagination.cursor
          ? { cursor: { id: pagination.cursor }, skip: 1 }
          : {}),
      }),
      prisma.product.count({
        where: {
          businessId: user.business.id,
          ...(includeArchived ? {} : { isActive: true }),
          ...(categoryId ? { categoryId } : {}),
          ...(search
            ? {
                OR: [
                  { name: { contains: search, mode: "insensitive" as const } },
                  { sku: { contains: search, mode: "insensitive" as const } },
                  { barcode: { contains: search, mode: "insensitive" as const } },
                ],
              }
            : {}),
        },
      }),
      prisma.$queryRaw<{
        activeCount: bigint;
        archivedCount: bigint;
        lowStockCount: bigint;
        inventoryValue: bigint;
      }[]>`SELECT
            COUNT(*) FILTER (WHERE "isActive") AS "activeCount",
            COUNT(*) FILTER (WHERE NOT "isActive") AS "archivedCount",
            COUNT(*) FILTER (WHERE "isActive" AND "stock" <= "minStock") AS "lowStockCount",
            COALESCE(SUM("inventoryValue") FILTER (WHERE "isActive"), 0) AS "inventoryValue"
          FROM "Product" WHERE "businessId" = ${user.business.id}`,
    ]);

    const page = getCursorPage(rows, pagination.limit);

    return NextResponse.json({
      products: page.items.map(serializeProduct),
      total,
      nextCursor: page.nextCursor,
      stats: {
        total: Number(stats[0]?.activeCount ?? 0n),
        archived: Number(stats[0]?.archivedCount ?? 0n),
        lowStock: Number(stats[0]?.lowStockCount ?? 0n),
        inventoryValue: (stats[0]?.inventoryValue ?? 0n).toString(),
      },
    });
  } catch (error) {
    console.error("Get products error:", error);

    return NextResponse.json(
      { message: "خطا در دریافت کالاها." },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json(
        { message: "لطفاً وارد حساب کاربری شوید." },
        { status: 401 }
      );
    }

    if (user.role !== "BUSINESS_OWNER" || !user.business?.isActive) {
      return NextResponse.json(
        { message: "دسترسی به این بخش مجاز نیست." },
        { status: 403 }
      );
    }

    const body = await request.json();
    const validation = productSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        {
          message: "اطلاعات کالا معتبر نیست.",
          errors: validation.error.flatten().fieldErrors,
        },
        { status: 400 }
      );
    }

    const data = validation.data;
    const businessId = user.business.id;

    const business = await prisma.business.findUnique({
      where: { id: businessId },
      select: { currencyUnit: true },
    });

    if (!business) {
      return NextResponse.json(
        { message: "کسب‌وکار پیدا نشد." },
        { status: 404 }
      );
    }

    const purchasePrice = currencyInputToRial(data.purchasePrice, business.currencyUnit);

    const salePrice = currencyInputToRial(data.salePrice, business.currencyUnit);

    const initialStock = new Prisma.Decimal(data.initialStock);
    const minStock = new Prisma.Decimal(data.minStock);

    const inventoryValue = BigInt(
      initialStock
        .mul(purchasePrice.toString())
        .toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP)
        .toFixed(0)
    );

    const product = await prisma.$transaction(async (tx) => {
      if (data.categoryId) {
        const category = await tx.category.findFirst({
          where: {
            id: data.categoryId,
            businessId,
          },
          select: { id: true },
        });

        if (!category) {
          throw new Error("CATEGORY_NOT_FOUND");
        }
      }

      const createdProduct = await tx.product.create({
        data: {
          businessId,
          categoryId: data.categoryId || null,
          name: data.name,
          sku: data.sku || null,
          barcode: data.barcode || null,
          unit: data.unit,
          purchasePrice,
          salePrice,
          stock: initialStock,
          minStock,
          averageCost: new Prisma.Decimal(purchasePrice.toString()),
          inventoryValue,
        },
        include: {
          category: {
            select: { id: true, name: true },
          },
        },
      });

      if (initialStock.greaterThan(0)) {
        await tx.inventoryMovement.create({
          data: {
            businessId,
            productId: createdProduct.id,
            type: "INITIAL_STOCK",
            quantity: initialStock,
            totalCost: inventoryValue,
            averageCost: createdProduct.averageCost,
            description: "موجودی اولیه کالا",
          },
        });
      }

      return createdProduct;
    });

    return NextResponse.json(
      {
        message: "کالا با موفقیت ثبت شد.",
        product: serializeProduct(product),
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof Error && error.message === "CATEGORY_NOT_FOUND") {
      return NextResponse.json(
        { message: "دسته‌بندی انتخاب‌شده معتبر نیست." },
        { status: 400 }
      );
    }
    if (error instanceof Error && error.message === "INVALID_CURRENCY_AMOUNT") {
      return NextResponse.json(
        { message: "مبلغ قیمت با واحد پول کسب‌وکار سازگار نیست." },
        { status: 400 }
      );
    }

    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "P2002"
    ) {
      return NextResponse.json(
        { message: "کد کالا یا بارکد قبلاً ثبت شده است." },
        { status: 409 }
      );
    }

    console.error("Create product error:", error);

    return NextResponse.json(
      { message: "خطا در ثبت کالا." },
      { status: 500 }
    );
  }
}
