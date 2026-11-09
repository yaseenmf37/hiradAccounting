import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import InvoicePrintViewModule from "../src/components/invoices/invoice-print-view.tsx";

const InvoicePrintView = InvoicePrintViewModule.default ?? InvoicePrintViewModule;
const root = process.cwd();
const outputDirectory = path.join(
  tmpdir(),
  `hirad-invoice-print-${process.pid}`,
);
const printCss = (await readFile(
  path.join(root, "src", "app", "globals.css"),
  "utf8",
)).replace(/^\s*@import\s+["']tailwindcss["'];/m, "");

after(async () => {
  await rm(outputDirectory, { recursive: true, force: true });
});

function createInvoice(
  type,
  itemCount,
  discount,
  total,
) {
  const items = Array.from({ length: itemCount }, (_, index) => ({
    id: `test-item-${String(index + 1).padStart(2, "0")}`,
    quantity: "2",
    unitPrice: "5000000",
    total: "10000000",
    product: {
      name: `کالای آزمایشی ${String(index + 1).padStart(2, "0")}`,
      unit: "عدد",
    },
  }));

  return {
    type,
    invoiceNumber: `TEST-${itemCount}`,
    invoiceDate: "2026-11-09",
    createdAt: "2026-11-09T10:00:00.000Z",
    subtotal: String(itemCount * 10_000_000),
    extraCosts: "0",
    discount: String(discount),
    discountPercent: discount ? "10" : "0",
    total: String(total),
    description: "فاکتور نمونه برای آزمون چاپ؛ داده آزمایشی",
    contactNameSnapshot: "طرف حساب آزمایشی",
    contactPhoneSnapshot: "09120000000",
    contactAddressSnapshot: "نشانی نمونه",
    contact: {
      name: "طرف حساب آزمایشی",
      phone: "09120000000",
      address: "نشانی نمونه",
    },
    business: { name: "فروشگاه آزمایشی", phone: "02100000000" },
    items,
  };
}

const scenarios = [
  {
    name: "invoice-05-sale-discount",
    type: "SALE",
    itemCount: 5,
    discount: 5_000_000,
    total: 45_000_000,
    expectedAmount: "۴٬۵۰۰٬۰۰۰ تومان",
    expectedWords: "چهار میلیون و پانصد هزار تومان",
    expectedTitle: "فاکتور فروش",
    expectedSeller: "فروشگاه آزمایشی",
    expectedCustomer: "طرف حساب آزمایشی",
  },
  {
    name: "invoice-35-purchase-no-discount",
    type: "PURCHASE",
    itemCount: 35,
    discount: 0,
    total: 350_000_000,
    expectedAmount: "۳۵٬۰۰۰٬۰۰۰ تومان",
    expectedWords: "سی و پنج میلیون تومان",
    expectedTitle: "فاکتور خرید",
    expectedSeller: "طرف حساب آزمایشی",
    expectedCustomer: "فروشگاه آزمایشی",
  },
  {
    name: "invoice-40-sale-discount",
    type: "SALE",
    itemCount: 40,
    discount: 20_000_000,
    total: 380_000_000,
    expectedAmount: "۳۸٬۰۰۰٬۰۰۰ تومان",
    expectedWords: "سی و هشت میلیون تومان",
    expectedTitle: "فاکتور فروش",
    expectedSeller: "فروشگاه آزمایشی",
    expectedCustomer: "طرف حساب آزمایشی",
  },
];

function countMatches(value, expression) {
  return [...value.matchAll(expression)].length;
}

function renderInvoice(invoice) {
  return renderToStaticMarkup(
    React.createElement(InvoicePrintView, { invoice }),
  );
}

function assertInvoiceMarkup(scenario, markup) {
  const tableRowCount = countMatches(markup, /<tr(?:\s|>)/g) - 1;
  assert.equal(tableRowCount, Math.max(35, scenario.itemCount));
  assert.equal(
    countMatches(markup, /class="print-invoice-header-column /g),
    3,
    "print header must contain three columns",
  );
  assert.match(markup, new RegExp(scenario.expectedTitle));
  assert.match(markup, /شماره تماس فروشنده/);
  assert.match(markup, new RegExp(`نام فروشنده: ${scenario.expectedSeller}`));
  assert.match(markup, new RegExp(`نام مشتری: ${scenario.expectedCustomer}`));
  assert.equal(markup.includes("آدرس مشتری"), scenario.type === "SALE");
  assert.match(markup, /شماره تماس خریدار/);
  assert.match(markup, /شماره فاکتور/);
  assert.match(markup, /تاریخ فاکتور/);
  assert.match(markup, /۲ عدد/);
  assert.match(markup, /۵۰۰٬۰۰۰ تومان/);
  assert.ok(markup.includes(scenario.expectedAmount));
  assert.match(markup, new RegExp(scenario.expectedWords));
  assert.match(markup, /امضای خریدار/);
  assert.match(markup, /امضای فروشنده/);
  assert.match(markup, /ممنون از خرید شما/);
  assert.match(markup, /کالای آزمایشی 01/);
  assert.match(
    markup,
    new RegExp(`کالای آزمایشی ${String(scenario.itemCount).padStart(2, "0")}`),
  );
  assert.equal(markup.includes("<th>تخفیف</th>"), scenario.discount > 0);
  assert.equal(markup.includes("تخفیف (۱۰٪)"), scenario.discount > 0);
  assert.equal(
    markup.includes("مبلغ قابل پرداخت پس از تخفیف"),
    scenario.discount > 0,
  );
  assert.equal(
    markup.includes("class=\"print-invoice-empty-row\""),
    scenario.itemCount < 35,
  );
}

test("purchase and sales invoices render the production print component", async () => {
  await mkdir(outputDirectory, { recursive: true });

  for (const scenario of scenarios) {
    const invoice = createInvoice(
      scenario.type,
      scenario.itemCount,
      scenario.discount,
      scenario.total,
    );
    const markup = renderInvoice(invoice);
    assertInvoiceMarkup(scenario, markup);

    const html = [
      "<!doctype html>",
      '<html lang="fa" dir="rtl">',
      "<head>",
      '<meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
      `<style>${printCss}</style>`,
      "</head>",
      '<body class="printing-invoice">',
      markup,
      "</body>",
      "</html>",
    ].join("");
    await writeFile(
      path.join(outputDirectory, `${scenario.name}.html`),
      html,
      "utf8",
    );
  }
});

test("missing print data is shown as unknown without crashing or inventing values", () => {
  const markup = renderInvoice({
    type: "PURCHASE",
    invoiceNumber: null,
    invoiceDate: null,
    createdAt: null,
    subtotal: null,
    extraCosts: null,
    discount: null,
    discountPercent: null,
    total: null,
    description: null,
    contact: null,
    business: null,
    items: [
      {
        quantity: null,
        unitPrice: null,
        total: null,
        product: null,
      },
    ],
  });

  assert.match(markup, /تعداد اقلام: ۱ قلم/);
  assert.match(markup, /شماره فاکتور: —/);
  assert.match(markup, /نامشخص/);
  assert.match(markup, /امضای فروشنده/);
  assert.match(markup, /ممنون از خرید شما/);
  assert.doesNotMatch(markup, /NaN|undefined|null/);
  assert.doesNotMatch(markup, /تخفیف/);
});

test("an empty invoice shows a zero item count and keeps the fixed row height", () => {
  const markup = renderInvoice({
    type: "SALE",
    invoiceNumber: "TEST-EMPTY",
    invoiceDate: null,
    subtotal: "0",
    extraCosts: "0",
    discount: "0",
    total: "0",
    items: [],
    contact: null,
    business: null,
  });

  assert.match(markup, /تعداد اقلام: ۰ قلم/);
  assert.equal(countMatches(markup, /class="print-invoice-empty-row"/g), 35);
});
