"use client";

import { useEffect, type FocusEvent, type FormEvent, type KeyboardEvent, type ReactNode } from "react";

function parseDecimal(value: string) {
  const match = /^(-?)(\d+)(?:\.(\d*))?$/.exec(value.replace(/,/g, ""));
  if (!match) return null;

  const fraction = match[3] ?? "";
  const scale = 10n ** BigInt(fraction.length);
  const units = BigInt(`${match[1]}${match[2]}${fraction}`);
  return { units, scale, precision: fraction.length };
}

function decimalAtPrecision(value: string, precision: number) {
  const parsed = parseDecimal(value);
  if (!parsed) return null;
  const scale = 10n ** BigInt(precision);
  return {
    units: parsed.units * (scale / parsed.scale),
    scale,
  };
}

function formatDecimal(units: bigint, precision: number) {
  const scale = 10n ** BigInt(precision);
  const negative = units < 0n;
  const absolute = negative ? -units : units;
  const whole = absolute / scale;
  const fraction = (absolute % scale)
    .toString()
    .padStart(precision, "0")
    .replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

function selectOnFocus(event: FocusEvent<HTMLDivElement>) {
  const target = event.target;
  if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return;

  try {
    target.select();
  } catch (error) {
    if (!(error instanceof DOMException) || error.name !== "InvalidStateError") {
      throw error;
    }
  }
}

function preserveNumericStepBase(event: FormEvent<HTMLDivElement>) {
  const target = event.target;
  if (!(target instanceof HTMLInputElement) || target.type !== "number") return;
  if (target.value && parseDecimal(target.value)) {
    target.setAttribute("value", target.value);
  }
}

function stepNumberInput(event: KeyboardEvent<HTMLDivElement>) {
  const target = event.target;
  if (
    !(target instanceof HTMLInputElement) ||
    (target.type !== "number" && target.dataset.numericInput !== "true") ||
    (event.key !== "ArrowUp" && event.key !== "ArrowDown") ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey
  ) {
    return;
  }

  const step = "1";
  const current = target.value ? parseDecimal(target.value) : { precision: 0 };
  const parsedStep = parseDecimal(step);
  if (!parsedStep) return;

  const precision = Math.max(
    current?.precision ?? 0,
    parsedStep.precision,
    (target.dataset.numericMin || target.min)
      ? parseDecimal(target.dataset.numericMin || target.min)?.precision ?? 0
      : 0,
    (target.dataset.numericMax || target.max)
      ? parseDecimal(target.dataset.numericMax || target.max)?.precision ?? 0
      : 0,
  );
  const stepValue = decimalAtPrecision(step, precision);
  const currentValue = decimalAtPrecision(target.value || "0", precision);
  if (!stepValue || !currentValue) return;

  let next = currentValue.units +
    (event.key === "ArrowUp" ? stepValue.units : -stepValue.units);
  const minimumValue = target.dataset.numericMin || target.min;
  const maximumValue = target.dataset.numericMax || target.max;
  const minimum = minimumValue
    ? decimalAtPrecision(minimumValue, precision)?.units
    : undefined;
  const maximum = maximumValue
    ? decimalAtPrecision(maximumValue, precision)?.units
    : undefined;
  if (minimum !== undefined && next < minimum) next = minimum;
  if (maximum !== undefined && next > maximum) next = maximum;

  event.preventDefault();
  const valueSetter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  valueSetter?.call(target, formatDecimal(next, precision));
  target.dispatchEvent(new Event("input", { bubbles: true }));
}

export default function InputBehavior({ children }: { children: ReactNode }) {
  useEffect(() => {
    const normalizeNumberSteps = (root: ParentNode) => {
      root.querySelectorAll<HTMLInputElement>('input[type="number"]').forEach((input) => {
        if (input.step !== "1") input.step = "1";
      });
    };

    normalizeNumberSteps(document);
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === "attributes" && record.target instanceof HTMLInputElement) {
          if (record.target.type === "number" && record.target.step !== "1") {
            record.target.step = "1";
          }
          continue;
        }
        record.addedNodes.forEach((node) => {
          if (!(node instanceof HTMLElement)) return;
          if (
            node instanceof HTMLInputElement &&
            node.type === "number" &&
            node.step !== "1"
          ) {
            node.step = "1";
          }
          normalizeNumberSteps(node);
        });
      }
    });
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["step", "type"],
    });

    return () => observer.disconnect();
  }, []);

  return (
    <div
      className="contents"
      onFocusCapture={selectOnFocus}
      onInputCapture={preserveNumericStepBase}
      onKeyDownCapture={stepNumberInput}
    >
      {children}
    </div>
  );
}
