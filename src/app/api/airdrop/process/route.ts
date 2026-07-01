import { NextResponse } from "next/server";
import { Pool } from "pg";
import { getWalletTransactions } from "@/lib/solana";

export const runtime = "nodejs";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function query(text: string, params?: any[]) {
  return pool.query(text, params);
}

export async function POST() {
  try {
    const { rows } = await query(
      `
      SELECT wallet_address, token_mint
      FROM airdrop_recipients
      WHERE wallet_address NOT IN (
        SELECT wallet_address FROM wallet_token_states
      )
      LIMIT 2
      `
    );

    if (!rows.length) {
      return NextResponse.json({
        processed: 0,
        message: "No wallets left to process"
      });
    }

    for (const r of rows) {
      const txs = await getWalletTransactions(r.wallet_address);

      let sent = 0;
      let received = 0;

      // REAL analysis
      for (const tx of txs ?? []) {
        for (const t of tx.tokenTransfers ?? []) {
          if (t.mint !== r.token_mint) continue;

          const amt = Number(t.tokenAmount ?? 0);

          if (t.fromUserAccount === r.wallet_address) sent += amt;
          if (t.toUserAccount === r.wallet_address) received += amt;
        }
      }

      const balance = received - sent;

      let behavior: "SOLD" | "HELD" | "ACCUMULATED" = "HELD";

      if (sent > 0 && received === 0) behavior = "SOLD";
      else if (received > sent) behavior = "ACCUMULATED";

      await query(
        `
        INSERT INTO wallet_token_states(
          wallet_address,
          token_mint,
          received_amount,
          current_balance,
          behavior,
          last_classified_at
        )
        VALUES ($1,$2,$3,$4,$5,now())
        ON CONFLICT (wallet_address, token_mint)
        DO UPDATE SET
          received_amount = EXCLUDED.received_amount,
          current_balance = EXCLUDED.current_balance,
          behavior = EXCLUDED.behavior,
          last_classified_at = now()
        `,
        [
          r.wallet_address,
          r.token_mint,
          received,
          balance,
          behavior
        ]
      );
    }

    return NextResponse.json({
      processed: rows.length,
      status: "ok"
    });

  } catch (error) {
    console.error("PROCESS ERROR:", error);

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unknown error"
      },
      { status: 500 }
    );
  }
}
