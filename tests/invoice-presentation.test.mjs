import assert from "node:assert/strict";
import { test } from "node:test";
import {
  allocateInvoiceItemDiscounts,
  countInvoiceItemRows,
  filterInvoiceProducts,
  formatRialAsToman,
  getPrintEmptyRowCount,
  hasInvoiceDiscount,
  numberToPersianWords,
  rialAmountToPersianTomanWords,
} from "../src/lib/invoice-presentation.ts";

test("print table pads short invoices to 35 rows without truncating longer invoices", () => {
  assert.equal(getPrintEmptyRowCount(0), 35);
  assert.equal(getPrintEmptyRowCount(1), 34);
  assert.equal(getPrintEmptyRowCount(34), 1);
  assert.equal(getPrintEmptyRowCount(35), 0);
  assert.equal(getPrintEmptyRowCount(36), 0);
  assert.equal(getPrintEmptyRowCount(101), 0);
});

test("item count follows product rows, not their quantities, and updates on add/remove", () => {
  const rows = [
    { productId: "a", quantity: "5" },
    { productId: "b", quantity: "2" },
    { productId: "c", quantity: "10" },
    { productId: "", quantity: "1" },
  ];
  assert.equal(countInvoiceItemRows([]), 0);
  assert.equal(countInvoiceItemRows(rows), 3);
  assert.equal(countInvoiceItemRows([...rows, { productId: "d", quantity: "1" }]), 4);
  assert.equal(countInvoiceItemRows(rows.slice(1)), 2);
});

test("invoice product category and search filters compose without changing selected rows", () => {
  const products = [
    { id: "1", name: "سیب", sku: "APL", barcode: null, categoryId: "fruit" },
    { id: "2", name: "گلابی", sku: "PEAR", barcode: null, categoryId: "fruit" },
    { id: "3", name: "دفتر", sku: "NOTE", barcode: "123", categoryId: "stationery" },
    { id: "4", name: "خودکار", sku: "PEN", barcode: null, categoryId: null },
  ];
  const selectedRows = [{ productId: "2", quantity: "5" }];

  assert.deepEqual(
    filterInvoiceProducts(products, "fruit", ""),
    products.slice(0, 2)
  );
  assert.deepEqual(
    filterInvoiceProducts(products, "all", ""),
    products
  );
  assert.deepEqual(
    filterInvoiceProducts(products, "fruit", "APL"),
    products.slice(0, 1)
  );
  assert.deepEqual(
    filterInvoiceProducts(products, "stationery", "123"),
    products.slice(2, 3)
  );
  assert.deepEqual(selectedRows, [{ productId: "2", quantity: "5" }]);
});

test("invoice discount rows are enabled only for a positive actual amount", () => {
  assert.equal(hasInvoiceDiscount("0"), false);
  assert.equal(hasInvoiceDiscount("000"), false);
  assert.equal(hasInvoiceDiscount("1"), true);
  assert.equal(hasInvoiceDiscount(100n), true);
});

test("print discount allocation preserves the total discount across rows", () => {
  const rows = [
    { total: "100" },
    { total: "200" },
    { total: "300" },
  ];
  const allocated = allocateInvoiceItemDiscounts(100n, rows);
  assert.deepEqual(allocated, [17n, 33n, 50n]);
  assert.equal(allocated.reduce((sum, amount) => sum + amount, 0n), 100n);
  assert.equal(allocateInvoiceItemDiscounts(100n, [{ total: null }]), null);
  assert.equal(allocateInvoiceItemDiscounts(100n, [{ total: "invalid" }]), null);
});

test("Rial totals format in Toman and Persian words including zero, fractions, and large values", () => {
  assert.equal(formatRialAsToman("9000000"), "۹۰۰٬۰۰۰ تومان");
  assert.equal(rialAmountToPersianTomanWords("9000000"), "نهصد هزار تومان");
  assert.equal(formatRialAsToman("0"), "۰ تومان");
  assert.equal(rialAmountToPersianTomanWords("0"), "صفر تومان");
  assert.equal(formatRialAsToman("15"), "۱٫۵ تومان");
  assert.equal(rialAmountToPersianTomanWords("15"), "یک تومان و پنج ریال");
  assert.equal(numberToPersianWords("123456"), "یکصد و بیست و سه هزار و چهارصد و پنجاه و شش");
  assert.equal(numberToPersianWords("900000000000000000"), "نهصد کوادریلیون");
  assert.equal(rialAmountToPersianTomanWords("9000000000000000000"), "نهصد کوادریلیون تومان");
});
