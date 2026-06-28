import { NextResponse } from "next/server";
import { DEFAULT_DISTRIBUTOR_WALLET, DEFAULT_TOKEN_MINT } from "@/lib/config";
import { scanAirdrop } from "@/lib/solana";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");

  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET is required before scheduled scans can run" },
      { status: 412 }
    );
  }

  if (authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await scanAirdrop(DEFAULT_TOKEN_MINT, DEFAULT_DISTRIBUTOR_WALLET);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Scheduled scan failed" },
      { status: 500 }
    );
  }
}
