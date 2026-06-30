import { Pool } from "pg";
import { DEFAULT_DISTRIBUTOR_WALLET, MAX_WALLETS_PER_SCAN } from "@/lib/config";

/**
 * ENV
 */
const HELIUS_API_KEY = process.env.HELIUS_API_KEY!;

/**
 * DB
 */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

/**
 * -------------------------
 * HELPER: safe fetch
 * -------------------------
 */
async function heliusFetch(url: string, options?: any) {
  const res = await fetch(url, options);

  const text = await res.text();

  if (!res.ok) {
    throw new Error(`Helius error: ${text}`);
  }

  return JSON.parse(text);
}

/**
 * -------------------------
 * 1. GET HOLDERS (FIXED CORE)
 * -------------------------
 * This replaces broken tokenTransfers logic
 */
export async function getAirdropRecipients(tokenMint: string) {
  const data = await heliusFetch(
    `https://api.helius.xyz/v0/token-accounts?api-key=${HELIUS_API_KEY}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        mintAccounts: [tokenMint],
      }),
    }
  );

  if (!Array.isArray(data)) return [];

  return data.map((acc: any) => ({
    walletAddress: acc.owner,
    amount: Number(acc.amount ?? 0),
  }));
}

/**
 * -------------------------
 * 2. GET WALLET TXS
 * -------------------------
 */
export async function getEnhancedTransactions(wallet: string, before?: string) {
  const url = new URL(
    `https://api.helius.xyz/v0/addresses/${wallet}/transactions`
  );

  url.searchParams.append("api-key", HELIUS_API_KEY);
  url.searchParams.append("limit", "50");

  if (before) {
    url.searchParams.append("before", before);
  }

  return heliusFetch(url.toString(), { method: "GET" });
}

/**
 * -------------------------
 * 3. CLASSIFY WALLET (LIGHTWEIGHT + RELIABLE)
 * -------------------------
 */
export async function classifyWalletBehavior(wallet: string, tokenMint: string) {
  const txs = await getEnhancedTransactions(wallet);

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

  let behavior: "SOLD" | "HELD" | "ACCUMULATED" = "HELD";

  if (sent > 0 && received === 0) behavior = "SOLD";
  else if (received > sent) behavior = "ACCUMULATED";

  return {
    walletAddress: wallet,
    tokenMint,
    currentBalance: received - sent,
    behavior,
  };
}

/**
 * -------------------------
 * 4. MAIN SCAN
 * -------------------------
 */
export async function scanAirdrop(
  tokenMint: string,
  distributorWallet = DEFAULT_DISTRIBUTOR_WALLET
) {
  const recipients = await getAirdropRecipients(tokenMint);

  const limited = recipients.slice(0, MAX_WALLETS_PER_SCAN);

  const classified = [];

  for (const r of limited) {
    const result = await classifyWalletBehavior(
      r.walletAddress,
      tokenMint
    );

    classified.push(result);
  }

  return {
    tokenMint,
    distributorWallet,
    recipientsFound: recipients.length,
    walletsClassified: classified.length,
  };
}
