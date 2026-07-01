import { NextResponse } from "next/server";
import { query } from "@/lib/solana";
import {
  getWalletTransactions,
  classifyWallet
} from "@/lib/solana";

export async function POST() {
  const { rows } = await query(
    `SELECT wallet_address, token_mint
     FROM airdrop_recipients
     WHERE wallet_address NOT IN (
       SELECT wallet_address FROM wallet_token_states
     )
     LIMIT 10`
  );

  for (const r of rows) {
    const txs = await getWalletTransactions(r.wallet_address);

    await classifyWallet(r.wallet_address, r.token_mint);
  }

  return NextResponse.json({
    processed: rows.length
  });
}
