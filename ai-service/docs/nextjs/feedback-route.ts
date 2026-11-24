// app/api/support/feedback/route.ts
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const { runId, helpful, comment } = await req.json();
  const session = { workspaceId: "ws_unocx" };      // TODO: your auth
  const r = await fetch(`${process.env.UNOCX_URL}/v1/feedback`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.UNOCX_SERVICE_TOKEN}` },
    body: JSON.stringify({ workspace_id: session.workspaceId, run_id: runId, helpful, comment }),
  });
  return NextResponse.json(await r.json(), { status: r.status });
}
