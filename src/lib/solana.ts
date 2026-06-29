import { Pool, QueryResultRow } from "pg";
import {
  DEFAULT_DISTRIBUTOR_WALLET,
  MAX_DISTRIBUTOR_PAGES_PER_SCAN,
  MAX_WALLET_TX_PAGES_PER_SCAN,
  MAX_WALLETS_PER_SCAN,
} from "@/lib/config";

/**
 * ENV (IMPORTANT FIX)
 */
const HELIUS_API_KEY = process.env.HELIUS_API_KEY!;

/**
 * PostgreSQL pool
 */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

/**
 * FIX: pg TypeScript generic constraint issue
 */
export async function query<T extends QueryResultRow = any>(
  text: string,
  params?: any[]
) {
  const res = await pool.query<T>(text, params);
  return res;
}

/**
 * DB helper
 */
export async function withClient(
  fn: (client: any) => Promise<void>
) {
  const client = await pool.connect();
  try {
    await fn(client);
  } finally {
    client.release();
  }
}

/**
 * Safety constant
 */
export const EPSILON = 1e-9;

/**
 * Types
 */
export type Recipient = {
  walletAddress: string;
  amount: number;
  signature?: string;
  receivedAt?: Date;
};

export type HeliusTransaction = any;

/**
 * HELIUS RPC CALL (FIXED)
 */
export async function getEnhancedTransactions(
  wallet: string,
  before?: string
): Promise<any[]> {
  const res = await fetch(HELIUS_API_KEY, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getSignaturesForAddress",
      params: [
        wallet,
        {
          limit: 50,
          before,
        },
      ],
    }),
  });

  const data = await res.json();
  return data?.result ?? [];
}

/**
 * Normalize amount safely
 */
export function normalizeAmount(amount: any): number {
  if (!amount) return 0;
  if (typeof amount === "number") return amount;
  if (typeof amount === "string") return parseFloat(amount);
  return 0;
}

/**
 * Lamports → SOL
 */
export function lamportsToSol(lamports?: number): number {
  if (!lamports) return 0;
  return lamports / 1e9;
}

/**
 * Transaction date helper
 */
export function transactionDate(tx: any): Date | null {
  return tx?.blockTime ? new Date(tx.blockTime * 1000) : null;
}

/**
 * Get airdrop recipients
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
        if (
          t?.mint === tokenMint &&
          t?.fromUserAccount === distributorWallet &&
          t?.toUserAccount &&
          t.toUserAccount !== distributorWallet
        ) {
          const existing = recipients.get(t.toUserAccount);

          recipients.set(t.toUserAccount, {
            walletAddress: t.toUserAccount,
            amount:
              (existing?.amount ?? 0) +
              normalizeAmount(t.tokenAmount),
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
 * Wallet tx history
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
 * Swap detection
 */
export function detectSwapEvents(tx: any, walletAddress = "") {
  const swap = tx?.events?.swap;
  if (!swap) return [];

  const input = swap.tokenInputs?.[0];
  const output = swap.tokenOutputs?.[0];

  const nativeChange =
    lamportsToSol(swap.nativeOutput?.amount) -
    lamportsToSol(swap.nativeInput?.amount);

  return [
    {
      signature: tx.signature,
      walletAddress,
      tokenMintIn: input?.mint,
      tokenMintOut: output?.mint,
      amountIn: normalizeAmount(input?.tokenAmount),
      amountOut: normalizeAmount(output?.tokenAmount),
      soldTokenMint: input?.mint,
      boughtTokenMint: output?.mint,
      nativeSolChange: nativeChange || undefined,
      eventAt: transactionDate(tx),
      raw: swap,
    },
  ];
}

/**
 * Store transactions
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
 * Classification
 */
export async function classifyWalletBehavior(
  wallet: string,
  tokenMint: string
) {
  const currentBalance = 0;

  let behavior: "SOLD" | "HELD" | "ACCUMULATED" | "UNKNOWN" =
    "UNKNOWN";

  if (currentBalance <= EPSILON) {
    behavior = "SOLD";
  } else {
    behavior = "HELD";
  }

  return {
    walletAddress: wallet,
    tokenMint,
    currentBalance,
    behavior,
  };
}

/**
 * MAIN SCAN
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