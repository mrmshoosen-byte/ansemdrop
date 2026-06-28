import { NextResponse } from "next/server";
import { DEFAULT_TOKEN_MINT } from "@/lib/config";
import { getDashboardAnalytics } from "@/lib/analytics";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const mint = searchParams.get("mint") ?? DEFAULT_TOKEN_MINT;

  try {
    const data = await getDashboardAnalytics(mint);
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load analytics" },
      { status: 500 }
    );
  }
}
