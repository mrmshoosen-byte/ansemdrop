import { Pool } from "pg";
import { DEFAULT_DISTRIBUTOR_WALLET, MAX_WALLETS_PER_SCAN } from "@/lib/config";

const HELIUS_API_KEY = process.env.HELIUS_API_KEY!;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

/**
 * -------------------------
 * DB helper
 * -------------------------
 */
async function query(text: string, params?: any[]) {
  return pool.query(text, params);
}

/**
 * -------------------------
 * SIMPLE RATE LIMITER
 * -------------------------
 */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let lastRequestTime = 0;

async function rateLimitedFetch(url: string, options?: any) {
  const now = Date.now();
  const diff = now - lastRequestTime;

  if (diff < 350) {
    await sleep(350 - diff);
  }

  lastRequestTime = Date.now();
  return fetch(url, options);
}

/**
 * -------------------------
 * WALLET TRANSACTIONS (FULL PAGINATION)
 * -------------------------
 */
export async function getWalletTransactions(wallet: string) {
  const all: any[] = [];
  let before: string | undefined;

  for (let i = 0; i < 20; i++) {
    const url = new URL(
      `https://api.helius.xyz/v0/addresses/${wallet}/transactions`
    );

    url.searchParams.set("api-key", HELIUS_API_KEY);
    url.searchParams.set("limit", "50");
    if (before) url.searchParams.set("before", before);

    const res = await rateLimitedFetch(url.toString());
    const text = await res.text();

    if (!res.ok) {
      console.warn("Helius tx error:", text);
      break;
    }

    const batch = JSON.parse(text);
    if (!Array.isArray(batch) || batch.length === 0) break;

    all.push(...batch);
    before = batch[batch.length - 1]?.signature;

    if (batch.length < 50) break;
  }

  return all;
}

/**
 * -------------------------
 * RECIPIENT DETECTION (AIRDROP CORE)
 * -------------------------
 */
export async function getAirdropRecipients(
  tokenMint: string,
  distributor = DEFAULT_DISTRIBUTOR_WALLET
) {
  const recipients = new Map<string, any>();
  let before: string | undefined;

  for (let i = 0; i < 30; i++) {
    const url = new URL(
      `https://api.helius.xyz/v0/addresses/${distributor}/transactions`
    );

    url.searchParams.set("api-key", HELIUS_API_KEY);
    url.searchParams.set("limit", "50");
    if (before) url.searchParams.set("before", before);

    const res = await rateLimitedFetch(url.toString());
    const text = await res.text();

    if (!res.ok) {
      console.warn("Helius recipient error:", text);
      break;
    }

    const txs = JSON.parse(text);
    if (!Array.isArray(txs) || txs.length === 0) break;

    for (const tx of txs) {
      for (const t of tx.tokenTransfers ?? []) {
        if (
          t.mint === tokenMint &&
          t.fromUserAccount === distributor &&
          t.toUserAccount
        ) {
          const existing = recipients.get(t.toUserAccount);

          recipients.set(t.toUserAccount, {
            walletAddress: t.toUserAccount,
            amount:
              (existing?.amount ?? 0) + Number(t.tokenAmount ?? 0),
            signature: tx.signature,
            receivedAt: tx.blockTime
              ? new Date(tx.blockTime * 1000)
              : null,
          });
        }
      }
    }

    before = txs[txs.length - 1]?.signature;

    await sleep(400);
  }

  return Array.from(recipients.values());
}

/**
 * -------------------------
 * WALLET CLASSIFICATION
 * -------------------------
 */
export async function classifyWallet(wallet: string, tokenMint: string) {
  const txs = await getWalletTransactions(wallet);

  let sent = 0;
  let received = 0;

  for (const tx of txs ?? []) {
    for (const t of tx.tokenTransfers ?? []) {
      if (t.mint !== tokenMint) continue;

      const amt = Number(t.tokenAmount ?? 0);

      if (t.fromUserAccount === wallet) sent += amt;
      if (t.toUserAccount === wallet) received += amt;
    }
  }

  let behavior: "SOLD" | "HELD" | "ACCUMULATED" | "UNKNOWN" = "HELD";

  if (sent > 0 && received === 0) behavior = "SOLD";
  else if (received > sent) behavior = "ACCUMULATED";

  const balance = received - sent;

  await query(
    `INSERT INTO wallet_token_states(
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
      last_classified_at = now()`,
    [wallet, tokenMint, received, balance, behavior]
  );

  return { wallet, behavior };
}

/**
 * -------------------------
 * MAIN SCAN
 * -------------------------
 */
export async function scanAirdrop(
  tokenMint: string,
  distributor = DEFAULT_DISTRIBUTOR_WALLET
) {
  const recipients = await getAirdropRecipients(tokenMint, distributor);

  const limited = recipients.slice(0, MAX_WALLETS_PER_SCAN);

  for (const r of limited) {
    await classifyWallet(r.walletAddress, tokenMint);
    await sleep(200);
  }

  return {
    tokenMint,
    distributor,
    recipientsFound: recipients.length,
    walletsClassified: limited.length,
  };
}
