
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { toRial } from "@/lib/currency";

const amountSchema = z.string().regex(/^\d{1,18}$/);

const invoiceSchema = z.object({
  type: z.enum(["PURCHASE", "SALE"]),
  contactId: z.string().nullable().optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  extraCosts: amountSchema.default("0"),
  discount: amountSchema.default("0"),
  items: z.array(
    z.object({
      productId: z.string().min(1),
      quantity: z.string().regex(/^\d{1,12}(\.\d{1,3})?$/),
      unitPrice: amountSchema,
    })
  ).min(1).max(100),
});

function authorize(user: Awaited<ReturnType<typeof getCurrentUser>>) {
  if (!user) {
    return {
      error: NextResponse.json(
        { message: "لطفاً وارد حساب کاربری شوید." },
        { status: 401 }
      ),
    };
  }

  if (user.role !== "BUSINESS_OWNER" || !user.business?.isActive) {
    return {
      error: NextResponse.json(
        { message: "دسترسی به این بخش مجاز نیست." },
        { status: 403 }
      ),
    };
  }

  return { businessId: user.business.id };
}


function serializeInvoice(invoice: {
  id: string;
  invoiceNumber: string;
  type: string;
  status: string;
  subtotal: bigint;
  extraCosts: bigint;
  discount: bigint;
  total: bigint;
  description: string | null;
  issuedAt: Date | null;
  createdAt: Date;
  contact: { id: string; name: string } | null;
  items: {
    id: string;
    productId: string;
    quantity: Prisma.Decimal;
    unitPrice: bigint;
    total: bigint;
    costOfGoodsSold: bigint;
    product: { name: string; unit: string };
  }[];
}) {
  return {
    ...invoice,
    subtotal: invoice.subtotal.toString(),
    extraCosts: invoice.extraCosts.toString(),
    discount: invoice.discount.toString(),
    total: invoice.total.toString(),
    items: invoice.items.map((item) => ({
      ...item,
      quantity: item.quantity.toString(),
      unitPrice: item.unitPrice.toString(),
      total: item.total.toString(),
      costOfGoodsSold: item.costOfGoodsSold.toString(),
    })),
  };
}


// دریافت فهرست فاکتورها
export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    const auth = authorize(user);

    if ("error" in auth) return auth.error;

    const params = request.nextUrl.searchParams;
    const type = params.get("type");
    const status = params.get("status");
    const search = params.get("search")?.trim();

    const invoices = await prisma.invoice.findMany({
      where: {
        businessId: auth.businessId,
        ...(type === "PURCHASE" || type === "SALE" ? { type } : {}),
        ...(status === "DRAFT" || status === "ISSUED" || status === "CANCELLED"
          ? { status }
          : {}),
        ...(search
          ? {
              OR: [
                { invoiceNumber: { contains: search, mode: "insensitive" } },
                { contact: { name: { contains: search, mode: "insensitive" } } },
              ],
            }
          : {}),
      },
      include: {
        contact: { select: { id: true, name: true } },
        items: {
          include: {
            product: { select: { name: true, unit: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({
      invoices: invoices.map(serializeInvoice),
      total: invoices.length,
    });
  } catch (error) {
    console.error("Get invoices error:", error);

    return NextResponse.json(
      { message: "خطا در دریافت فاکتورها." },
      { status: 500 }
    );
  }
}

// ایجاد پیش‌نویس فاکتور
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    const auth = authorize(user);

    if ("error" in auth) return auth.error;

    const body = await request.json();
    const validation = invoiceSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        {
          message: "اطلاعات فاکتور معتبر نیست.",
          errors: validation.error.flatten().fieldErrors,
        },
        { status: 400 }
      );
    }

    const data = validation.data;
    const businessId = auth.businessId;

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

    const productIds = [...new Set(data.items.map((item) => item.productId))];

    const products = await prisma.product.findMany({
      where: {
        id: { in: productIds },
        businessId,
        isActive: true,
      },
      select: { id: true },
    });

    if (products.length !== productIds.length) {
      return NextResponse.json(
        { message: "یک یا چند کالا معتبر نیستند یا متعلق به این کسب‌وکار نیستند." },
        { status: 400 }
      );
    }

    if (data.contactId) {
      const contact = await prisma.contact.findFirst({
        where: {
          id: data.contactId,
          businessId,
          isActive: true,
          ...(data.type === "SALE"
            ? { type: { in: ["CUSTOMER", "BOTH"] } }
            : { type: { in: ["SUPPLIER", "BOTH"] } }),
        },
        select: { id: true },
      });

      if (!contact) {
        return NextResponse.json(
          { message: "طرف حساب انتخاب‌شده معتبر نیست." },
          { status: 400 }
        );
      }
    }

    const extraCosts = toRial(BigInt(data.extraCosts), business.currencyUnit);
    const discount = toRial(BigInt(data.discount), business.currencyUnit);

    const items = data.items.map((item) => {
      const quantity = new Prisma.Decimal(item.quantity);
      const unitPrice = toRial(
        BigInt(item.unitPrice),
        business.currencyUnit
      );

      const total = BigInt(
        quantity
          .mul(unitPrice.toString())
          .toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP)
          .toFixed(0)
      );

      if (quantity.lessThanOrEqualTo(0)) {
        throw new Error("INVALID_QUANTITY");
      }

      return {
        productId: item.productId,
        quantity,
        unitPrice,
        total,
      };
    });

    const subtotal = items.reduce(
      (sum, item) => sum + item.total,
      BigInt(0)
    );

    if (discount > subtotal + extraCosts) {
      return NextResponse.json(
        { message: "تخفیف نمی‌تواند از مجموع مبلغ فاکتور بیشتر باشد." },
        { status: 400 }
      );
    }

    const total = subtotal + extraCosts - discount;

    const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const prefix = data.type === "SALE" ? "S" : "P";
    const invoiceNumber = `${prefix}-${datePart}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

    const invoice = await prisma.invoice.create({
      data: {
        businessId,
        contactId: data.contactId || null,
        type: data.type,
        status: "DRAFT",
        invoiceNumber,
        subtotal,
        extraCosts,
        discount,
        total,
        description: data.description || null,
        items: {
          create: items,
        },
      },
      include: {
        contact: { select: { id: true, name: true } },
        items: {
          include: {
            product: { select: { name: true, unit: true } },
          },
        },
      },
    });

    return NextResponse.json(
      {
        message: "پیش‌نویس فاکتور با موفقیت ایجاد شد.",
        invoice: serializeInvoice(invoice),
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof Error && error.message === "INVALID_QUANTITY") {
      return NextResponse.json(
        { message: "تعداد کالا باید بیشتر از صفر باشد." },
        { status: 400 }
      );
    }

    console.error("Create invoice error:", error);

    return NextResponse.json(
      { message: "خطا در ایجاد پیش‌نویس فاکتور." },
      { status: 500 }
    );
  }
}
