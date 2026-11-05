"use client";

import { useState } from "react";

export default function useCursorPage() {
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  function nextPage() {
    if (!nextCursor) return null;
    setCursors((current) =>
      current[current.length - 1] === nextCursor
        ? current
        : [...current, nextCursor]
    );
    return nextCursor;
  }

  function previousPage() {
    const previousCursor =
      cursors.length > 1 ? cursors[cursors.length - 2] : null;
    setCursors((current) =>
      current.length > 1 ? current.slice(0, -1) : current
    );
    setNextCursor(null);
    return previousCursor;
  }

  function resetPages() {
    setCursors([null]);
    setNextCursor(null);
  }

  return {
    cursor: cursors[cursors.length - 1],
    page: cursors.length,
    nextCursor,
    setNextCursor,
    nextPage,
    previousPage,
    resetPages,
  };
}
