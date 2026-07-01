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
 * HELIUS SAFE TX FETCH
 * -------------------------
 */
export async function getWalletTransactions(wallet: string) {
  try {
    const res = await fetch(
      `https://api.helius.xyz/v0/addresses/${wallet}/transactions?api-key=${HELIUS_API_KEY}&limit=50`
    );

    const text = await res.text();

    if (!res.ok) {
      console.warn("Helius tx error:", text);
      return [];
    }

    const data = JSON.parse(text);
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.warn("Helius error ignored:", e);
    return [];
  }
}

/**
 * -------------------------
 * FIXED RECIPIENT EXTRACTION (IMPORTANT)
 * -------------------------
 * This is the CORE FIX
 */
export async function getAirdropRecipients(
  tokenMint: string,
  distributor = DEFAULT_DISTRIBUTOR_WALLET
) {
  const res = await fetch(
    `https://api.helius.xyz/v0/addresses/${distributor}/transactions?api-key=${HELIUS_API_KEY}&limit=100`
  );

  const text = await res.text();

  if (!res.ok) {
    throw new Error(`Helius error: ${text}`);
  }

  const txs = JSON.parse(text);

  const recipients = new Map<string, any>();

  for (const tx of txs ?? []) {
    for (const t of tx.tokenTransfers ?? []) {
      if (
        t.mint === tokenMint &&
        t.fromUserAccount === distributor &&
        t.toUserAccount
      ) {
        const existing = recipients.get(t.toUserAccount);

        recipients.set(t.toUserAccount, {
          walletAddress: t.toUserAccount,
          amount: (existing?.amount ?? 0) + Number(t.tokenAmount ?? 0),
          signature: tx.signature,
          receivedAt: tx.blockTime ? new Date(tx.blockTime * 1000) : null,
        });
      }
    }
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
  }

  return {
    tokenMint,
    distributor,
    recipientsFound: recipients.length,
    walletsClassified: limited.length,
  };
}
