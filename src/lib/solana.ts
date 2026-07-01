import { Pool } from "pg";
import { DEFAULT_DISTRIBUTOR_WALLET, MAX_WALLETS_PER_SCAN } from "@/lib/config";

const HELIUS_API_KEY = process.env.HELIUS_API_KEY!;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function query(text: string, params?: any[]) {
  return pool.query(text, params);
}

/**
 * -------------------------
 * HELIUS - SAFE TX FETCH
 * -------------------------
 */
export async function getWalletTransactions(wallet: string) {
  try {
    const res = await fetch(
      `https://api.helius.xyz/v0/addresses/${wallet}/transactions?api-key=${HELIUS_API_KEY}&limit=10`
    );

    const text = await res.text();

    if (!res.ok) {
      throw new Error(text);
    }

    const data = JSON.parse(text);
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.warn("Helius error (ignored):", e);
    return [];
  }
}

/**
 * -------------------------
 * RECIPIENTS (AIRDROP HOLDERS)
 * -------------------------
 */
export async function getAirdropRecipients(tokenMint: string) {
  const res = await fetch(
    `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getTokenAccounts",
        params: {
          mint: tokenMint,
          limit: 1000,
        },
      }),
    }
  );

  const text = await res.text();

  if (!res.ok) {
    throw new Error(text);
  }

  const json = JSON.parse(text);

  const accounts = json?.result?.token_accounts ?? [];

  return accounts.map((a: any) => ({
    walletAddress: a.owner,
    amount: Number(a.amount ?? 0),
  }));
}

/**
 * -------------------------
 * STORE WALLET STATE
 * -------------------------
 */
async function upsertWallet(address: string) {
  await query(
    `INSERT INTO wallets(address)
     VALUES($1)
     ON CONFLICT(address)
     DO UPDATE SET last_seen_at = now()`,
    [address]
  );
}

/**
 * -------------------------
 * CLASSIFY WALLET (SIMPLE + WORKING)
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
export async function scanAirdrop(tokenMint: string, distributor = DEFAULT_DISTRIBUTOR_WALLET) {
  const recipients = await getAirdropRecipients(tokenMint);

  const limited = recipients.slice(0, MAX_WALLETS_PER_SCAN);

  for (const r of limited) {
    await upsertWallet(r.walletAddress);
    await classifyWallet(r.walletAddress, tokenMint);
  }

  return {
    tokenMint,
    distributor,
    recipientsFound: recipients.length,
    walletsClassified: limited.length,
  };
}
