import { NextResponse } from "next/server";
import { DEFAULT_TOKEN_MINT } from "@/lib/config";
import { searchWallet } from "@/lib/analytics";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const address = searchParams.get("address");
  const mint = searchParams.get("mint") ?? DEFAULT_TOKEN_MINT;

  if (!address) {
    return NextResponse.json({ error: "address is required" }, { status: 400 });
  }

  try {
    return NextResponse.json(await searchWallet(address, mint));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Wallet search failed" },
      { status: 500 }
    );
  }
}
