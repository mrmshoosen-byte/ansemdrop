import { Pool, QueryResultRow } from "pg";
import {
  DEFAULT_DISTRIBUTOR_WALLET,
  MAX_DISTRIBUTOR_PAGES_PER_SCAN,
  MAX_WALLET_TX_PAGES_PER_SCAN,
  MAX_WALLETS_PER_SCAN,
} from "@/lib/config";

/**
 * ENV
 */
const HELIUS_API_KEY = process.env.HELIUS_API_KEY!;

/**
 * PostgreSQL pool
 */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

/**
 * DB helper
 */
export async function query<T extends QueryResultRow = any>(
  text: string,
  params?: any[]
) {
  return pool.query<T>(text, params);
}

export async function withClient(fn: (client: any) => Promise<void>) {
  const client = await pool.connect();
  try {
    await fn(client);
  } finally {
    client.release();
  }
}

/**
 * Types
 */
export type Recipient = {
  walletAddress: string;
  amount: number;
  signature?: string;
  receivedAt?: Date;
};

/**
 * FIXED HELIUS CALL (THIS WAS YOUR MAIN BUG)
 */
export async function getEnhancedTransactions(
  wallet: string,
  before?: string
) {
  const res = await fetch(
    `https://api.helius.xyz/v0/addresses/${wallet}/transactions?api-key=${HELIUS_API_KEY}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        limit: 50,
        before: before ?? undefined,
      }),
    }
  );

  const data = await res.json();

  if (!Array.isArray(data)) return [];

  return data;
}

/**
 * SAFE HELPERS
 */
export function normalizeAmount(amount: any): number {
  if (!amount) return 0;
  if (typeof amount === "number") return amount;
  if (typeof amount === "string") return parseFloat(amount);
  return 0;
}

export function transactionDate(tx: any): Date | null {
  return tx?.blockTime ? new Date(tx.blockTime * 1000) : null;
}

/**
 * STEP 1 — GET RECIPIENTS (FIXED LOGIC)
 */
export async function getAirdropRecipients(
  tokenMint: string,
  distributorWallet = DEFAULT_DISTRIBUTOR_WALLET
): Promise<Recipient[]> {
  const recipients = new Map<string, Recipient>();

  let before: string | undefined;

  for (let i = 0; i < MAX_DISTRIBUTOR_PAGES_PER_SCAN; i++) {
    const txs = await getEnhancedTransactions(distributorWallet, before);
    if (!txs.length) break;

    for (const tx of txs) {
      const transfers = tx.tokenTransfers ?? [];

      for (const t of transfers) {
        if (!t?.mint) continue;

        // 🔥 FIXED FILTER (was too strict before)
        const isRelevant =
          t.mint === tokenMint &&
          (t.fromUserAccount === distributorWallet ||
            tx.feePayer === distributorWallet);

        if (!isRelevant) continue;

        if (t?.toUserAccount && t.toUserAccount !== distributorWallet) {
          const existing = recipients.get(t.toUserAccount);

          recipients.set(t.toUserAccount, {
            walletAddress: t.toUserAccount,
            amount:
              (existing?.amount ?? 0) + normalizeAmount(t.tokenAmount),
            signature: existing?.signature ?? tx.signature,
            receivedAt:
              existing?.receivedAt ?? transactionDate(tx) ?? undefined,
          });
        }
      }
    }

    before = txs.at(-1)?.signature;
  }

  return Array.from(recipients.values());
}

/**
 * STEP 2 — WALLET HISTORY
 */
export async function getWalletTransactions(wallet: string) {
  const txs: any[] = [];
  let before: string | undefined;

  for (let i = 0; i < MAX_WALLET_TX_PAGES_PER_SCAN; i++) {
    const batch = await getEnhancedTransactions(wallet, before);
    if (!batch.length) break;

    txs.push(...batch);
    before = batch.at(-1)?.signature;
  }

  return txs;
}

/**
 * STEP 3 — STORE
 */
async function storeTransactions(wallet: string, transactions: any[]) {
  await withClient(async (client) => {
    await client.query("BEGIN");

    try {
      await client.query(
        `INSERT INTO wallets(address, last_seen_at)
         VALUES($1, now())
         ON CONFLICT(address) DO UPDATE SET last_seen_at = now()`,
        [wallet]
      );

      for (const tx of transactions) {
        await client.query(
          `INSERT INTO transactions(signature, wallet_address, slot, block_time, tx_type, source, raw)
           VALUES($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT(signature) DO NOTHING`,
          [
            tx.signature,
            wallet,
            tx.slot ?? null,
            transactionDate(tx),
            tx.type ?? null,
            tx.source ?? null,
            JSON.stringify(tx),
          ]
        );

        for (const t of tx.tokenTransfers ?? []) {
          await client.query(
            `INSERT INTO token_transfers(signature, token_mint, from_wallet, to_wallet, amount, token_account)
             VALUES($1,$2,$3,$4,$5,$6)
             ON CONFLICT DO NOTHING`,
            [
              tx.signature,
              t?.mint,
              t?.fromUserAccount ?? null,
              t?.toUserAccount ?? null,
              normalizeAmount(t?.tokenAmount),
              t?.toTokenAccount ?? t?.fromTokenAccount ?? null,
            ]
          );
        }
      }

      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    }
  });
}

/**
 * STEP 4 — CLASSIFICATION (simple but working)
 */
export async function classifyWalletBehavior(
  wallet: string,
  tokenMint: string
) {
  const txs = await getWalletTransactions(wallet);

  const hasOutgoing = txs.some((tx) =>
    tx.tokenTransfers?.some(
      (t: any) =>
        t.mint === tokenMint && t.fromUserAccount === wallet
    )
  );

  const hasIncoming = txs.some((tx) =>
    tx.tokenTransfers?.some(
      (t: any) =>
        t.mint === tokenMint && t.toUserAccount === wallet
    )
  );

  let behavior: "SOLD" | "HELD" | "ACCUMULATED" = "HELD";

  if (hasOutgoing && !hasIncoming) behavior = "SOLD";
  else if (hasIncoming && hasOutgoing) behavior = "ACCUMULATED";

  return {
    walletAddress: wallet,
    tokenMint,
    currentBalance: 0,
    behavior,
  };
}

/**
 * STEP 5 — MAIN SCAN
 */
export async function scanAirdrop(
  tokenMint: string,
  distributorWallet = DEFAULT_DISTRIBUTOR_WALLET
) {
  const recipients = await getAirdropRecipients(
    tokenMint,
    distributorWallet
  );

  const limited = recipients.slice(0, MAX_WALLETS_PER_SCAN);

  const classified = [];

  for (const r of limited) {
    const txs = await getWalletTransactions(r.walletAddress);
    await storeTransactions(r.walletAddress, txs);

    classified.push(
      await classifyWalletBehavior(r.walletAddress, tokenMint)
    );
  }

  return {
    tokenMint,
    distributorWallet,
    recipientsFound: recipients.length,
    walletsClassified: classified.length,
  };
}
