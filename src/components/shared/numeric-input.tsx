"use client";

import { useLayoutEffect, useRef, useState, type ChangeEvent, type InputHTMLAttributes } from "react";

type NumericInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type" | "value" | "defaultValue" | "onChange" | "min" | "max" | "step"
> & {
  value?: string | number;
  defaultValue?: string | number;
  min?: string | number;
  max?: string | number;
  step?: string | number;
  onChange?: (event: ChangeEvent<HTMLInputElement>) => void;
};

function normalizeDigits(value: string) {
  return value
    .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/[٬,]/g, "")
    .replace(/٫/g, ".");
}

function toRawNumericValue(value: string) {
  const normalized = normalizeDigits(value).replace(/[^\d.-]/g, "");
  const sign = normalized.startsWith("-") ? "-" : "";
  const unsigned = normalized.replace(/-/g, "");
  const decimalIndex = unsigned.indexOf(".");
  const whole = (decimalIndex < 0 ? unsigned : unsigned.slice(0, decimalIndex));
  const fraction = decimalIndex < 0 ? null : unsigned.slice(decimalIndex + 1);
  return `${sign}${whole}${fraction === null ? "" : `.${fraction.replace(/\./g, "")}`}`;
}

function formatNumericValue(raw: string) {
  const sign = raw.startsWith("-") ? "-" : "";
  const unsigned = sign ? raw.slice(1) : raw;
  const decimalIndex = unsigned.indexOf(".");
  const whole = decimalIndex < 0 ? unsigned : unsigned.slice(0, decimalIndex);
  const fraction = decimalIndex < 0 ? null : unsigned.slice(decimalIndex + 1);
  const groupedWhole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}${groupedWhole}${fraction === null ? "" : `.${fraction}`}`;
}

function formattedCaretPosition(formatted: string, rawCharactersBeforeCaret: number) {
  if (rawCharactersBeforeCaret === 0) return 0;
  let rawCharacters = 0;
  for (let index = 0; index < formatted.length; index += 1) {
    if (formatted[index] !== ",") rawCharacters += 1;
    if (rawCharacters >= rawCharactersBeforeCaret) return index + 1;
  }
  return formatted.length;
}

function compareNumericValues(left: string, right: string) {
  const parse = (value: string) => {
    const match = /^(-?)(\d*)(?:\.(\d*))?$/.exec(value);
    if (!match || (!match[2] && !match[3])) return null;
    const fraction = match[3] ?? "";
    const precision = fraction.length;
    const units = BigInt(`${match[1]}${match[2] || "0"}${fraction}`);
    return { units, precision };
  };
  const leftValue = parse(left);
  const rightValue = parse(right);
  if (!leftValue || !rightValue) return null;
  const precision = Math.max(leftValue.precision, rightValue.precision);
  const scale = (value: { units: bigint; precision: number }) =>
    value.units * 10n ** BigInt(precision - value.precision);
  const leftUnits = scale(leftValue);
  const rightUnits = scale(rightValue);
  return leftUnits < rightUnits ? -1 : leftUnits > rightUnits ? 1 : 0;
}

function getValidityMessage(value: string, min?: string | number, max?: string | number) {
  if (value === "" || value === "-" || value === "." || value === "-.") return "";
  if (compareNumericValues(value, value) === null) return "یک مقدار عددی معتبر وارد کنید.";
  if (min !== undefined && compareNumericValues(value, String(min)) === -1) {
    return `مقدار نباید کمتر از ${min} باشد.`;
  }
  if (max !== undefined && compareNumericValues(value, String(max)) === 1) {
    return `مقدار نباید بیشتر از ${max} باشد.`;
  }
  return "";
}

export default function NumericInput({
  value,
  defaultValue,
  min,
  max,
  step: _step,
  inputMode,
  onChange,
  onBlur,
  ...props
}: NumericInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const pendingCaret = useRef<number | null>(null);
  const [uncontrolledValue, setUncontrolledValue] = useState(() =>
    toRawNumericValue(String(defaultValue ?? "")),
  );
  const rawValue = toRawNumericValue(String(value ?? uncontrolledValue));
  const formattedValue = formatNumericValue(rawValue);

  useLayoutEffect(() => {
    const caret = pendingCaret.current;
    const input = inputRef.current;
    if (!input) return;
    input.setCustomValidity(getValidityMessage(rawValue, min, max));
    if (caret === null || document.activeElement !== input) return;
    input.setSelectionRange(caret, caret);
    pendingCaret.current = null;
  }, [formattedValue, max, min, rawValue]);

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const typedValue = input.value;
    const selectionStart = input.selectionStart ?? typedValue.length;
    const raw = toRawNumericValue(typedValue);
    const rawCharactersBeforeCaret = toRawNumericValue(
      typedValue.slice(0, selectionStart),
    ).length;
    const formatted = formatNumericValue(raw);
    pendingCaret.current = formattedCaretPosition(formatted, rawCharactersBeforeCaret);

    setUncontrolledValue(raw);
    input.setCustomValidity(getValidityMessage(raw, min, max));

    const rawTarget = new Proxy(input, {
      get(target, property) {
        return property === "value" ? raw : Reflect.get(target, property, target);
      },
    });
    const rawEvent = new Proxy(event, {
      get(target, property) {
        if (property === "target" || property === "currentTarget") return rawTarget;
        const result = Reflect.get(target, property, target);
        return typeof result === "function" ? result.bind(target) : result;
      },
    });
    onChange?.(rawEvent);
  }

  return (
    <input
      {...props}
      ref={inputRef}
      type="text"
      inputMode={inputMode ?? "decimal"}
      data-numeric-input="true"
      data-numeric-min={min}
      data-numeric-max={max}
      data-numeric-step="1"
      value={formattedValue}
      onChange={handleChange}
      onBlur={(event) => {
        event.currentTarget.setCustomValidity(getValidityMessage(rawValue, min, max));
        onBlur?.(event);
      }}
    />
  );
}
