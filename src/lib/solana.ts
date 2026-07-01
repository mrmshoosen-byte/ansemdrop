import { Pool } from "pg";
import { DEFAULT_DISTRIBUTOR_WALLET, MAX_WALLETS_PER_SCAN } from "@/lib/config";

/**
 * ENV
 */
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
 * HELIUS FETCH
 * -------------------------
 */
async function heliusGet(url: string) {
  const res = await fetch(url);
  const text = await res.text();

  if (!res.ok) {
    throw new Error(`Helius error: ${text}`);
  }

  return JSON.parse(text);
}

/**
 * -------------------------
 * WALLET FETCH (RECIPIENTS)
 * -------------------------
 */
export async function getAirdropRecipients(
  tokenMint: string,
  distributor?: string
)  {
  const res = await fetch(
    `https://api.helius.xyz/v0/token-metadata?api-key=${process.env.HELIUS_API_KEY}`
  );

  const text = await res.text();

  if (!res.ok) {
    throw new Error(`Helius error: ${text}`);
  }

  const json = JSON.parse(text);

  const accounts = json?.accounts ?? [];

  return accounts
    .filter((a: any) => a.mint === tokenMint)
    .map((a: any) => ({
      walletAddress: a.owner,
      amount: Number(a.amount ?? 0),
    }));
}

/**
 * -------------------------
 * TRANSACTIONS
 * -------------------------
 */
export async function getEnhancedTransactions(wallet: string) {
  const data = await heliusGet(
    `https://api.helius.xyz/v0/addresses/${wallet}/transactions?api-key=${HELIUS_API_KEY}&limit=50`
  );

  return Array.isArray(data) ? data : [];
}

/**
 * -------------------------
 * STORE WALLET
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
 * STORE RECIPIENTS
 * -------------------------
 */
async function storeRecipient(tokenMint: string, distributor: string, r: any) {
  await upsertWallet(r.walletAddress);

  await query(
    `INSERT INTO airdrop_recipients(
      token_mint,
      wallet_address,
      distributor_wallet,
      first_received_signature,
      amount,
      first_received_at
    )
    VALUES($1,$2,$3,$4,$5,$6)
    ON CONFLICT (token_mint, wallet_address, distributor_wallet)
    DO UPDATE SET amount = EXCLUDED.amount`,
    [
      tokenMint,
      r.walletAddress,
      distributor,
      r.signature ?? "unknown",
      r.amount,
      r.receivedAt,
    ]
  );
}

/**
 * -------------------------
 * STORE TXS + TRANSFERS
 * -------------------------
 */
async function storeTransactions(wallet: string, txs: any[]) {
  for (const tx of txs) {
    await query(
      `INSERT INTO transactions(signature, wallet_address, block_time, tx_type, source, raw)
       VALUES($1,$2,$3,$4,$5,$6)
       ON CONFLICT(signature) DO NOTHING`,
      [
        tx.signature,
        wallet,
        tx.blockTime ? new Date(tx.blockTime * 1000) : null,
        tx.type ?? null,
        tx.source ?? null,
        tx,
      ]
    );

    for (const t of tx.tokenTransfers ?? []) {
      await query(
        `INSERT INTO token_transfers(
          signature,
          token_mint,
          from_wallet,
          to_wallet,
          amount,
          token_account
        )
        VALUES($1,$2,$3,$4,$5,$6)
        ON CONFLICT DO NOTHING`,
        [
          tx.signature,
          t.mint,
          t.fromUserAccount,
          t.toUserAccount,
          Number(t.tokenAmount ?? 0),
          t.toTokenAccount ?? null,
        ]
      );
    }
  }
}

/**
 * -------------------------
 * CLASSIFY WALLET
 * -------------------------
 */
async function classifyWallet(wallet: string, tokenMint: string) {
  const txs = await getEnhancedTransactions(wallet);

  let sent = 0;
  let received = 0;

  for (const tx of txs) {
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

  const currentBalance = received - sent;

  await query(
    `INSERT INTO wallet_token_states(
      wallet_address,
      token_mint,
      received_amount,
      current_balance,
      behavior,
      last_classified_at
    )
    VALUES($1,$2,$3,$4,$5,now())
    ON CONFLICT(wallet_address, token_mint)
    DO UPDATE SET
      received_amount = EXCLUDED.received_amount,
      current_balance = EXCLUDED.current_balance,
      behavior = EXCLUDED.behavior,
      last_classified_at = now()`,
    [wallet, tokenMint, received, currentBalance, behavior]
  );

  return { wallet, behavior };
}

/**
 * -------------------------
 * MAIN SCAN
 * -------------------------
 */
export async function scanAirdrop(tokenMint: string, distributor = DEFAULT_DISTRIBUTOR_WALLET) {
  const recipients = await getAirdropRecipients(tokenMint, distributor);

  const limited = recipients.slice(0, MAX_WALLETS_PER_SCAN);

  for (const r of limited) {
    await storeRecipient(tokenMint, distributor, r);

    const txs = await getEnhancedTransactions(r.walletAddress);
    await storeTransactions(r.walletAddress, txs);

    await classifyWallet(r.walletAddress, tokenMint);
  }

  return {
    tokenMint,
    distributor,
    recipientsFound: recipients.length,
    walletsClassified: limited.length,
  };
}
