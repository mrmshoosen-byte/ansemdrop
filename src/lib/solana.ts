import { Pool } from "pg";
import {
  DEFAULT_DISTRIBUTOR_WALLET,
  MAX_DISTRIBUTOR_PAGES_PER_SCAN,
  MAX_WALLET_TX_PAGES_PER_SCAN
} from "@/lib/config";

// -----------------------------
// DB SETUP
// -----------------------------
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

export async function query<T = any>(text: string, params?: any[]) {
  const res = await pool.query<T>(text, params);
  return res;
}

export async function withClient(fn: (client: any) => Promise<void>) {
  const client = await pool.connect();
  try {
    await fn(client);
  } finally {
    client.release();
  }
}

// -----------------------------
// HELIUS FETCH
// -----------------------------
export async function getEnhancedTransactions(address: string, before?: string) {
  const apiKey = process.env.HELIUS_API_KEY;

  const url = new URL(
    `https://api.helius.xyz/v0/addresses/${address}/transactions`
  );

  url.searchParams.set("api-key", apiKey!);
  url.searchParams.set("limit", "100");

  if (before) {
    url.searchParams.set("before", before);
  }

  const res = await fetch(url.toString());

  if (!res.ok) {
    throw new Error(await res.text());
  }

  return await res.json();
}

// -----------------------------
// HELPERS
// -----------------------------
export function normalizeAmount(amount: any) {
  if (!amount) return 0;
  return Number(amount);
}

export function transactionDate(tx: any) {
  return tx.timestamp ? new Date(tx.timestamp * 1000) : new Date();
}

// -----------------------------
// AIRDROP RECIPIENTS (FIXED)
// -----------------------------
export async function getAirdropRecipients(
  tokenMint: string,
  distributorWallet = DEFAULT_DISTRIBUTOR_WALLET
) {
  const recipients = new Map<string, Recipient>();
  let before: string | undefined;
  let page = 0;

  while (page < MAX_DISTRIBUTOR_PAGES_PER_SCAN) {
    const transactions = await getEnhancedTransactions(distributorWallet, before);
    if (!transactions.length) break;

    for (const tx of transactions) {
      const transfers = tx.tokenTransfers ?? [];

      for (const transfer of transfers) {
        if (!transfer.mint) continue;
        if (transfer.mint !== tokenMint) continue;
        if (!transfer.toUserAccount) continue;

        const wallet = transfer.toUserAccount;

        // ignore self transfers
        if (wallet === distributorWallet) continue;

        const current = recipients.get(wallet);
        const amount = normalizeAmount(transfer.tokenAmount);

        recipients.set(wallet, {
          walletAddress: wallet,
          amount: (current?.amount ?? 0) + amount,
          signature: current?.signature ?? tx.signature,
          receivedAt: current?.receivedAt ?? transactionDate(tx)
        });
      }
    }

    before = transactions.at(-1)?.signature;
    page++;
  }

  return Array.from(recipients.values());
}

// -----------------------------
// WALLET TX HISTORY
// -----------------------------
export async function getWalletTransactions(walletAddress: string) {
  const transactions: any[] = [];
  let before: string | undefined;

  for (let i = 0; i < MAX_WALLET_TX_PAGES_PER_SCAN; i++) {
    const batch = await getEnhancedTransactions(walletAddress, before);
    if (!batch.length) break;

    transactions.push(...batch);
    before = batch.at(-1)?.signature;
  }

  return transactions;
}

// -----------------------------
// SWAP DETECTION
// -----------------------------
export function detectSwapEvents(transaction: any, walletAddress = "") {
  const swap = transaction.events?.swap;
  if (!swap) return [];

  const input = swap.tokenInputs?.[0];
  const output = swap.tokenOutputs?.[0];

  return [
    {
      signature: transaction.signature,
      walletAddress,
      tokenMintIn: input?.mint,
      tokenMintOut: output?.mint,
      amountIn: normalizeAmount(input?.tokenAmount),
      amountOut: normalizeAmount(output?.tokenAmount),
      soldTokenMint: input?.mint,
      boughtTokenMint: output?.mint,
      nativeSolChange: 0,
      eventAt: transactionDate(transaction),
      raw: swap
    }
  ];
}

// -----------------------------
// WALLET TOKEN BALANCE (stub-safe)
// -----------------------------
export async function getWalletTokenBalance(walletAddress: string, tokenMint: string) {
  return 0; // keep safe unless you implement SPL balance lookup
}

// -----------------------------
// CLASSIFY WALLET
// -----------------------------
export async function classifyWalletBehavior(walletAddress: string, tokenMint: string) {
  const recipient = await query(
    `SELECT amount, first_received_at
     FROM airdrop_recipients
     WHERE wallet_address = $1 AND token_mint = $2
     LIMIT 1`,
    [walletAddress, tokenMint]
  );

  const receivedAmount = Number(recipient.rows[0]?.amount ?? 0);
  const currentBalance = await getWalletTokenBalance(walletAddress, tokenMint);

  const swapOut = await query(
    `SELECT MIN(event_at) AS first_sell_at
     FROM swap_events
     WHERE wallet_address = $1 AND sold_token_mint = $2`,
    [walletAddress, tokenMint]
  );

  const firstSellAt = swapOut.rows[0]?.first_sell_at ?? null;

  let behavior: "ACCUMULATED" | "SOLD" | "HELD" | "UNKNOWN" = "UNKNOWN";

  if (receivedAmount > 0 && currentBalance === 0 && firstSellAt) {
    behavior = "SOLD";
  } else if (receivedAmount > 0) {
    behavior = "HELD";
  }

  return {
    walletAddress,
    tokenMint,
    receivedAmount,
    currentBalance,
    behavior,
    firstSellAt
  };
}

// -----------------------------
// MAIN SCAN
// -----------------------------
export async function scanAirdrop(
  tokenMint: string,
  distributorWallet = DEFAULT_DISTRIBUTOR_WALLET
) {
  const recipients = await getAirdropRecipients(tokenMint, distributorWallet);

  await withClient(async (client) => {
    await client.query("BEGIN");

    for (const r of recipients) {
      await client.query(
        `INSERT INTO airdrop_recipients(
          token_mint, wallet_address, distributor_wallet,
          first_received_signature, first_received_at, amount
        )
        VALUES($1,$2,$3,$4,$5,$6)
        ON CONFLICT(token_mint, wallet_address, distributor_wallet)
        DO UPDATE SET amount = EXCLUDED.amount`,
        [
          tokenMint,
          r.walletAddress,
          distributorWallet,
          r.signature,
          r.receivedAt,
          r.amount
        ]
      );
    }

    await client.query("COMMIT");
  });

  return {
    tokenMint,
    distributorWallet,
    recipientsFound: recipients.length
  };
}