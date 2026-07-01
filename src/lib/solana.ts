import { Pool } from "pg";
import {
  DEFAULT_DISTRIBUTOR_WALLET,
  MAX_WALLETS_PER_SCAN,
  MAX_WALLET_TX_PAGES_PER_SCAN,
} from "@/lib/config";

const HELIUS_API_KEY = process.env.HELIUS_API_KEY!;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function query(text: string, params?: any[]) {
  return pool.query(text, params);
}

/**
 * -------------------------
 * HELIUS: GET TRANSACTIONS
 * -------------------------
 * Uses ONLY supported endpoint
 */
async function getTransactions(address: string, before?: string) {
  const url = new URL(
    `https://api.helius.xyz/v0/addresses/${address}/transactions`
  );

  url.searchParams.append("api-key", HELIUS_API_KEY);
  url.searchParams.append("limit", "50");
  if (before) url.searchParams.append("before", before);

  const res = await fetch(url.toString());
  const text = await res.text();

  if (!res.ok) {
    throw new Error(`Helius error: ${text}`);
  }

  const data = JSON.parse(text);
  return Array.isArray(data) ? data : [];
}

/**
 * -------------------------
 * 1. FIND AIRDROP RECIPIENTS
 * -------------------------
 * This is the CORE FIX
 */
export async function getAirdropRecipients(
  tokenMint: string,
  distributor: string = DEFAULT_DISTRIBUTOR_WALLET
) {
  const recipients = new Map<
    string,
    { walletAddress: string; amount: number; signature: string }
  >();

  let before: string | undefined;

  for (let i = 0; i < 20; i++) {
    const txs = await getTransactions(distributor, before);
    if (!txs.length) break;

    for (const tx of txs) {
      for (const t of tx.tokenTransfers ?? []) {
        if (
          t.mint === tokenMint &&
          t.fromUserAccount === distributor &&
          t.toUserAccount
        ) {
          recipients.set(t.toUserAccount, {
            walletAddress: t.toUserAccount,
            amount: Number(t.tokenAmount ?? 0),
            signature: tx.signature,
          });
        }
      }
    }

    before = txs.at(-1)?.signature;
  }

  return Array.from(recipients.values());
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
 * STORE RECIPIENT
 * -------------------------
 */
async function storeRecipient(
  tokenMint: string,
  distributor: string,
  r: any
) {
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
    VALUES($1,$2,$3,$4,$5,now())
    ON CONFLICT (token_mint, wallet_address, distributor_wallet)
    DO UPDATE SET amount = EXCLUDED.amount`,
    [
      tokenMint,
      r.walletAddress,
      distributor,
      r.signature,
      r.amount,
    ]
  );
}

/**
 * -------------------------
 * 2. WALLET HISTORY
 * -------------------------
 */
export async function getWalletTransactions(wallet: string) {
  let all: any[] = [];
  let before: string | undefined;

  for (let i = 0; i < MAX_WALLET_TX_PAGES_PER_SCAN; i++) {
    const txs = await getTransactions(wallet, before);
    if (!txs.length) break;

    all.push(...txs);
    before = txs.at(-1)?.signature;
  }

  return all;
}

/**
 * -------------------------
 * STORE TXS
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
  const txs = await getWalletTransactions(wallet);

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

  let behavior: "SOLD" | "HELD" | "ACCUMULATED" = "HELD";

  if (sent > 0 && received === 0) behavior = "SOLD";
  else if (received > sent) behavior = "ACCUMULATED";

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
    [wallet, tokenMint, received, received - sent, behavior]
  );

  return { wallet, behavior };
}

/**
 * -------------------------
 * MAIN SCAN (FIXED PIPELINE)
 * -------------------------
 */
export async function scanAirdrop(
  tokenMint: string,
  distributor: string = DEFAULT_DISTRIBUTOR_WALLET
) {
  const recipients = await getAirdropRecipients(tokenMint, distributor);

  const existing = await query(
  `SELECT wallet_address FROM airdrop_recipients WHERE token_mint = $1 AND distributor_wallet = $2`,
  [tokenMint, distributor]
);

const seen = new Set(existing.rows.map((r: any) => r.wallet_address));

const limited = recipients.filter(
  (r) => !seen.has(r.walletAddress)
).slice(0, MAX_WALLETS_PER_SCAN);

 for (const r of limited) {
  await storeRecipient(tokenMint, distributor, r);

  const txs = await getWalletTransactions(r.walletAddress);
  await storeTransactions(r.walletAddress, txs);

  await classifyWallet(r.walletAddress, tokenMint);

  await new Promise((res) => setTimeout(res, 250)); // 👈 IMPORTANT
}
  return {
    tokenMint,
    distributor,
    recipientsFound: recipients.length,
    walletsClassified: limited.length,
  };
}
