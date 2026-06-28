import { DEFAULT_TOKEN_MINT } from "@/lib/config";
import { query } from "@/lib/db";

export async function getDashboardAnalytics(tokenMint = DEFAULT_TOKEN_MINT) {
  const [summary, topSellers, diamondHands, timeToSell, recentRecipients] = await Promise.all([
    query<{
      total_wallets: string;
      sold: string;
      held: string;
      accumulated: string;
      unknown: string;
      total_received: string;
      total_current_balance: string;
      total_realized_sol: string;
    }>(
      `SELECT
        COUNT(*) AS total_wallets,
        COUNT(*) FILTER (WHERE behavior = 'SOLD') AS sold,
        COUNT(*) FILTER (WHERE behavior = 'HELD') AS held,
        COUNT(*) FILTER (WHERE behavior = 'ACCUMULATED') AS accumulated,
        COUNT(*) FILTER (WHERE behavior = 'UNKNOWN') AS unknown,
        COALESCE(SUM(received_amount), 0) AS total_received,
        COALESCE(SUM(current_balance), 0) AS total_current_balance,
        COALESCE(SUM(estimated_realized_value), 0) AS total_realized_sol
       FROM wallet_token_states
       WHERE token_mint = $1`,
      [tokenMint]
    ),
    query<{
      wallet_address: string;
      received_amount: string;
      current_balance: string;
      estimated_realized_value: string | null;
      first_sell_at: Date | null;
      time_to_sell_seconds: string | null;
    }>(
      `SELECT wallet_address, received_amount, current_balance, estimated_realized_value, first_sell_at, time_to_sell_seconds
       FROM wallet_token_states
       WHERE token_mint = $1 AND behavior = 'SOLD'
       ORDER BY estimated_realized_value DESC NULLS LAST, received_amount DESC
       LIMIT 20`,
      [tokenMint]
    ),
    query<{
      wallet_address: string;
      received_amount: string;
      current_balance: string;
      behavior: string;
      first_received_at: Date | null;
    }>(
      `SELECT wallet_address, received_amount, current_balance, behavior, first_received_at
       FROM wallet_token_states
       WHERE token_mint = $1 AND behavior IN ('HELD', 'ACCUMULATED')
       ORDER BY current_balance DESC
       LIMIT 30`,
      [tokenMint]
    ),
    query<{
      bucket: string;
      wallets: string;
    }>(
      `SELECT
        CASE
          WHEN time_to_sell_seconds < 3600 THEN '< 1h'
          WHEN time_to_sell_seconds < 21600 THEN '1-6h'
          WHEN time_to_sell_seconds < 86400 THEN '6-24h'
          WHEN time_to_sell_seconds < 604800 THEN '1-7d'
          ELSE '7d+'
        END AS bucket,
        COUNT(*) AS wallets
       FROM wallet_token_states
       WHERE token_mint = $1 AND behavior = 'SOLD' AND time_to_sell_seconds IS NOT NULL
       GROUP BY bucket
       ORDER BY MIN(time_to_sell_seconds)`,
      [tokenMint]
    ),
    query<{
      wallet_address: string;
      amount: string;
      first_received_at: Date | null;
    }>(
      `SELECT wallet_address, amount, first_received_at
       FROM airdrop_recipients
       WHERE token_mint = $1
       ORDER BY first_received_at DESC NULLS LAST
       LIMIT 20`,
      [tokenMint]
    )
  ]);

  const row = summary.rows[0] ?? {
    total_wallets: "0",
    sold: "0",
    held: "0",
    accumulated: "0",
    unknown: "0",
    total_received: "0",
    total_current_balance: "0",
    total_realized_sol: "0"
  };

  const total = Number(row.total_wallets);

  return {
    tokenMint,
    summary: {
      totalWallets: total,
      sold: Number(row.sold),
      held: Number(row.held),
      accumulated: Number(row.accumulated),
      unknown: Number(row.unknown),
      soldPct: total ? (Number(row.sold) / total) * 100 : 0,
      heldPct: total ? (Number(row.held) / total) * 100 : 0,
      accumulatedPct: total ? (Number(row.accumulated) / total) * 100 : 0,
      totalReceived: Number(row.total_received),
      totalCurrentBalance: Number(row.total_current_balance),
      totalRealizedSol: Number(row.total_realized_sol)
    },
    topSellers: topSellers.rows.map((seller) => ({
      ...seller,
      received_amount: Number(seller.received_amount),
      current_balance: Number(seller.current_balance),
      estimated_realized_value: Number(seller.estimated_realized_value ?? 0),
      time_to_sell_seconds: seller.time_to_sell_seconds ? Number(seller.time_to_sell_seconds) : null
    })),
    diamondHands: diamondHands.rows.map((wallet) => ({
      ...wallet,
      received_amount: Number(wallet.received_amount),
      current_balance: Number(wallet.current_balance)
    })),
    timeToSell: timeToSell.rows.map((item) => ({
      bucket: item.bucket,
      wallets: Number(item.wallets)
    })),
    recentRecipients: recentRecipients.rows.map((recipient) => ({
      ...recipient,
      amount: Number(recipient.amount)
    }))
  };
}

export async function searchWallet(address: string, tokenMint = DEFAULT_TOKEN_MINT) {
  const [state, transfers, swaps] = await Promise.all([
    query(
      `SELECT *
       FROM wallet_token_states
       WHERE wallet_address = $1 AND token_mint = $2`,
      [address, tokenMint]
    ),
    query(
      `SELECT tt.*, t.block_time, t.tx_type
       FROM token_transfers tt
       JOIN transactions t ON t.signature = tt.signature
       WHERE (tt.from_wallet = $1 OR tt.to_wallet = $1) AND tt.token_mint = $2
       ORDER BY t.block_time ASC NULLS LAST
       LIMIT 200`,
      [address, tokenMint]
    ),
    query(
      `SELECT *
       FROM swap_events
       WHERE wallet_address = $1 AND (sold_token_mint = $2 OR bought_token_mint = $2)
       ORDER BY event_at ASC NULLS LAST
       LIMIT 100`,
      [address, tokenMint]
    )
  ]);

  const timeline = [
    ...transfers.rows.map((transfer) => ({
      kind: "TRANSFER",
      at: transfer.block_time,
      signature: transfer.signature,
      amount: Number(transfer.amount),
      direction: transfer.to_wallet === address ? "IN" : "OUT",
      counterparty: transfer.to_wallet === address ? transfer.from_wallet : transfer.to_wallet
    })),
    ...swaps.rows.map((swap) => ({
      kind: "SWAP",
      at: swap.event_at,
      signature: swap.signature,
      soldTokenMint: swap.sold_token_mint,
      boughtTokenMint: swap.bought_token_mint,
      amountIn: Number(swap.amount_in ?? 0),
      amountOut: Number(swap.amount_out ?? 0),
      nativeSolChange: Number(swap.native_sol_change ?? 0)
    }))
  ].sort((a, b) => new Date(a.at ?? 0).getTime() - new Date(b.at ?? 0).getTime());

  return {
    address,
    tokenMint,
    state: state.rows[0] ?? null,
    timeline
  };
}
