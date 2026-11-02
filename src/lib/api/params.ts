import { AppError } from "@/lib/errors";

/** Positive integer route/query id, or a 400 naming the field. */
export function parseId(value: string | null | undefined, field = "id"): number {
  const n = Number(value);
  if (!value || !Number.isInteger(n) || n <= 0) throw AppError.validation(`Invalid ${field}.`, field);
  return n;
}

/** Optional positive integer query param. */
export function optionalInt(value: string | null | undefined): number | undefined {
  const n = Number(value);
  return value && Number.isInteger(n) && n > 0 ? n : undefined;
}
