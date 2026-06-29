import { NextResponse } from "next/server";
import { z } from "zod";
import {
  DEFAULT_DISTRIBUTOR_WALLET,
  DEFAULT_TOKEN_MINT
} from "@/lib/config";
import { scanAirdrop } from "@/lib/solana";

export const runtime = "nodejs";
export const maxDuration = 60;

const ScanSchema = z.object({
  tokenMint: z.string().min(32).default(DEFAULT_TOKEN_MINT),
  distributorWallet: z.string().min(32).default(DEFAULT_DISTRIBUTOR_WALLET)
});

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const payload = ScanSchema.parse(body);

    console.log("🚀 Starting scan:", payload);

    const result = await scanAirdrop(
      payload.tokenMint,
      payload.distributorWallet
    );

    console.log("✅ Scan result:", result);

    return NextResponse.json(result);
  } catch (error) {
    console.error("🔥 /api/airdrop/scan FAILED:", error);

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Scan failed",
        stack: error instanceof Error ? error.stack : undefined
      },
      { status: 500 }
    );
  }
}