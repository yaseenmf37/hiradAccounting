import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { issueInvoiceInTransaction } from "@/lib/issue-invoice-transaction";

type RouteContext = {
  params: Promise<{ invoiceId: string }>;
};

function serializeInvoice(invoice: {
  id: string;
  invoiceNumber: string;
  type: string;
  status: string;
  issuedAt: Date | null;
  total: bigint;
}) {
  return { ...invoice, total: invoice.total.toString() };
}

export async function POST(_request: NextRequest, context: RouteContext) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { message: "لطفاً وارد حساب کاربری شوید." },
        { status: 401 }
      );
    }
    const business = user.business;
    if (user.role !== "BUSINESS_OWNER" || !business?.isActive) {
      return NextResponse.json(
        { message: "دسترسی به این بخش مجاز نیست." },
        { status: 403 }
      );
    }

    const { invoiceId } = await context.params;
    const result = await prisma.$transaction(
      (tx) => issueInvoiceInTransaction(tx, business.id, invoiceId),
      {
        maxWait: 10000,
        timeout: 20000,
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      }
    );
    return NextResponse.json({
      message: "فاکتور با موفقیت صادر شد.",
      invoice: result ? serializeInvoice(result) : null,
    });
  } catch (error) {
    if (error instanceof Error) {
      const knownErrors: Record<string, { message: string; status: number }> = {
        INVOICE_NOT_FOUND: { message: "فاکتور پیدا نشد.", status: 404 },
        INVOICE_NOT_DRAFT: { message: "این فاکتور قبلاً صادر یا لغو شده است.", status: 409 },
        INVOICE_EMPTY: { message: "فاکتور هیچ کالایی ندارد.", status: 400 },
        INVOICE_ITEM_PRICE_REQUIRED: {
          message: "برای صدور فاکتور، قیمت واحد همه کالاها باید بیشتر از صفر باشد.",
          status: 400,
        },
        PRODUCT_NOT_FOUND: { message: "یک یا چند کالا دیگر معتبر یا فعال نیستند.", status: 400 },
        INSUFFICIENT_STOCK: {
          message: "موجودی یک یا چند کالا برای صدور فاکتور کافی نیست.",
          status: 409,
        },
        PAYMENTS_NOT_EQUAL: {
          message: "مجموع روش‌های پرداخت باید دقیقاً با مبلغ فاکتور برابر باشد.",
          status: 400,
        },
        CUSTOMER_ACCOUNT_REQUIRED_FOR_DEBT: {
          message: "برای ثبت بدهی یا چک تسویه‌نشده، مشتری دارای حساب را انتخاب کنید.",
          status: 400,
        },
        INVOICE_ALREADY_ISSUED: {
          message: "این فاکتور هم‌زمان توسط درخواست دیگری صادر شده است.",
          status: 409,
        },
        INVALID_QUANTITY: { message: "مقدار یکی از اقلام فاکتور معتبر نیست.", status: 400 },
        INVALID_PURCHASE_TOTAL: {
          message: "مبلغ کل اقلام فاکتور خرید معتبر نیست.",
          status: 400,
        },
        INVALID_PURCHASE_DISCOUNT: {
          message: "تخفیف فاکتور خرید نمی‌تواند از مبلغ اقلام بیشتر باشد.",
          status: 400,
        },
        INVALID_ACQUISITION_COST: {
          message: "بهای تمام‌شده خرید نمی‌تواند منفی باشد.",
          status: 400,
        },
        INVALID_ALLOCATION: {
          message: "تقسیم هزینه بین اقلام فاکتور امکان‌پذیر نیست.",
          status: 400,
        },
        INVENTORY_VALUE_OVERFLOW: {
          message: "ارزش موجودی از محدوده مجاز سامانه بیشتر است.",
          status: 400,
        },
        STOCK_CONFLICT: {
          message: "موجودی هم‌زمان تغییر کرده است. دوباره تلاش کنید.",
          status: 409,
        },
      };
      const known = knownErrors[error.message];
      if (known) {
        return NextResponse.json({ message: known.message }, { status: known.status });
      }
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2034"
      ) {
        return NextResponse.json(
          { message: "موجودی هم‌زمان تغییر کرده است. دوباره تلاش کنید." },
          { status: 409 }
        );
      }
    }
    console.error("Issue invoice error:", error);
    return NextResponse.json({ message: "خطا در صدور فاکتور." }, { status: 500 });
  }
}
