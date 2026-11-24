import { AppError } from "@/lib/errors";

export type GapCtx = { params: Promise<{ id: string }> };

export async function gapId(context?: GapCtx): Promise<string> {
  const id = (await context?.params)?.id ?? "";
  if (!/^gap_[a-f0-9]{6,32}$/.test(id)) throw AppError.validation("Invalid knowledge gap id.", "id");
  return id;
}
