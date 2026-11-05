export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 100;

export type CursorPageParams = {
  limit: number;
  cursor: string | null;
};

export function parseCursorPageParams(
  searchParams: URLSearchParams
): CursorPageParams | null {
  const rawLimit = searchParams.get("limit");
  const rawCursor = searchParams.get("cursor");
  const limit = rawLimit === null ? DEFAULT_PAGE_SIZE : Number(rawLimit);

  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > MAX_PAGE_SIZE ||
    (rawCursor !== null && (rawCursor.length === 0 || rawCursor.length > 200))
  ) {
    return null;
  }

  return { limit, cursor: rawCursor };
}

export function getCursorPage<T extends { id: string }>(
  rows: T[],
  limit: number
) {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;

  return {
    items,
    nextCursor: hasMore ? items.at(-1)?.id ?? null : null,
  };
}
