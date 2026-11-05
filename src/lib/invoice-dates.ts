import DateObject from "react-date-object";
import gregorian from "react-date-object/calendars/gregorian";
import persian from "react-date-object/calendars/persian";
import persian_fa from "react-date-object/locales/persian_fa";

export function formatInvoiceDate(value: string | Date | null | undefined) {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  return new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Tehran",
  }).format(date);
}

export function toInvoiceDateObject(value: string | null | undefined) {
  const datePart = value?.slice(0, 10);
  const match = datePart
    ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(datePart)
    : null;
  const now = new Date();
  const date = match
    ? new DateObject({
        year: Number(match[1]),
        month: Number(match[2]),
        day: Number(match[3]),
        calendar: gregorian,
        locale: persian_fa,
      })
    : new DateObject({
        year: now.getFullYear(),
        month: now.getMonth() + 1,
        day: now.getDate(),
        calendar: gregorian,
        locale: persian_fa,
      });

  return date.convert(persian);
}

export function invoiceDateToIso(value: DateObject) {
  const date = value.convert(gregorian);
  const formatted = date.format("YYYY-MM-DD");
  const englishDigits = formatted.replace(/[۰-۹]/g, (digit) =>
    String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)),
  );
  return new Date(`${englishDigits}T00:00:00.000Z`).toISOString();
}

export function invoiceDateToDay(value: DateObject) {
  return invoiceDateToIso(value).slice(0, 10);
}
