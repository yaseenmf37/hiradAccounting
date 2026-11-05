export type QuickAction = {
  action: "invoice" | "product" | "contact" | "payment" | "expense";
  requestId: number;
  targetView:
    | "inventory"
    | "contacts"
    | "purchase-invoices"
    | "sales-invoices"
    | "payments"
    | "expenses";
};
