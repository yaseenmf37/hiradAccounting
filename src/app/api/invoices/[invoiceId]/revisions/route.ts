import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type RouteContext = { params: Promise<{ invoiceId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  try {
    const user = await getCurrentUser();
    if (!user || user.role !== "BUSINESS_OWNER" || !user.business?.isActive) {
      return NextResponse.json({ message: "دسترسی غیرمجاز است." }, { status: 401 });
    }
    const { invoiceId } = await context.params;
    const invoice = await prisma.invoice.findFirst({
      where: { id: invoiceId, businessId: user.business.id },
      select: {
        revisions: { orderBy: { createdAt: "desc" } },
      },
    });
    if (!invoice) return NextResponse.json({ message: "فاکتور پیدا نشد." }, { status: 404 });
    return NextResponse.json({ revisions: invoice.revisions });
  } catch (error) {
    console.error("GET /api/invoices/[invoiceId]/revisions:", error);
    return NextResponse.json({ message: "دریافت تاریخچه فاکتور انجام نشد." }, { status: 500 });
  }
}
