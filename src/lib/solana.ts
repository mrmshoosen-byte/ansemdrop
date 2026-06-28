import {
  DEFAULT_DISTRIBUTOR_WALLET,
  MAX_DISTRIBUTOR_PAGES_PER_SCAN,
  MAX_WALLETS_PER_SCAN,
  MAX_WALLET_TX_PAGES_PER_SCAN
} from "@/lib/config";
import { getEnhancedTransactions, getTokenAccountsBalance, lamportsToSol } from "@/lib/helius";
import { query, withClient } from "@/lib/db";
import type { HeliusTransaction, Recipient, SwapEvent, WalletBehavior } from "@/lib/types";

const EPSILON = 0.000001;

function transactionDate(tx: HeliusTransaction) {
  return tx.timestamp ? new Date(tx.timestamp * 1000) : null;
}

function normalizeAmount(value?: number) {
  return Number(value ?? 0);
}

export async function getAirdropRecipients(
  tokenMint: string,
  distributorWallet = DEFAULT_DISTRIBUTOR_WALLET
) {
  const recipients = new Map<string, Recipient>();
  let before: string | undefined;
  let page = 0;
  const maxPages = MAX_DISTRIBUTOR_PAGES_PER_SCAN;

  while (page < maxPages) {
    const transactions = await getEnhancedTransactions(distributorWallet, before);
    if (!transactions.length) break;

    for (const tx of transactions) {
      for (const transfer of tx.tokenTransfers ?? []) {
        if (
          transfer.mint === tokenMint &&
          transfer.fromUserAccount === distributorWallet &&
          transfer.toUserAccount &&
          transfer.toUserAccount !== distributorWallet
        ) {
          const current = recipients.get(transfer.toUserAccount);
          const nextAmount = normalizeAmount(transfer.tokenAmount);
          recipients.set(transfer.toUserAccount, {
            walletAddress: transfer.toUserAccount,
            amount: (current?.amount ?? 0) + nextAmount,
            signature: current?.signature ?? tx.signature,
            receivedAt: current?.receivedAt ?? transactionDate(tx)
          });
        }
      }
    }

    before = transactions.at(-1)?.signature;
    page += 1;
  }

  return Array.from(recipients.values());
}

export async function getWalletTransactions(walletAddress: string) {
  const transactions: HeliusTransaction[] = [];
  let before: string | undefined;
  const maxPages = MAX_WALLET_TX_PAGES_PER_SCAN;

  for (let page = 0; page < maxPages; page += 1) {
    const batch = await getEnhancedTransactions(walletAddress, before);
    if (!batch.length) break;
    transactions.push(...batch);
    before = batch.at(-1)?.signature;
  }

  return transactions;
}

export function detectSwapEvents(
  transaction: HeliusTransaction,
  walletAddress = ""
): SwapEvent[] {
  const swap = transaction.events?.swap;
  if (!swap) return [];

  const tokenInputs = swap.tokenInputs ?? [];
  const tokenOutputs = swap.tokenOutputs ?? [];
  const eventAt = transactionDate(transaction);

  if (!tokenInputs.length && !tokenOutputs.length) {
    return [];
  }

  const input = tokenInputs[0];
  const output = tokenOutputs[0];
  const nativeChange =
    lamportsToSol(swap.nativeOutput?.amount) - lamportsToSol(swap.nativeInput?.amount);

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
      nativeSolChange: nativeChange || undefined,
      eventAt,
      raw: swap
    }
  ];
}

export async function getWalletTokenBalance(walletAddress: string, tokenMint: string) {
  return getTokenAccountsBalance(walletAddress, tokenMint);
}

async function storeTransactions(walletAddress: string, transactions: HeliusTransaction[]) {
  await withClient(async (client) => {
    await client.query("BEGIN");
    try {
      await client.query(
        "INSERT INTO wallets(address, last_seen_at) VALUES($1, now()) ON CONFLICT(address) DO UPDATE SET last_seen_at = now()",
        [walletAddress]
      );

      for (const tx of transactions) {
        await client.query(
          `INSERT INTO transactions(signature, wallet_address, slot, block_time, tx_type, source, raw)
           VALUES($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT(signature) DO UPDATE SET raw = EXCLUDED.raw`,
          [
            tx.signature,
            walletAddress,
            tx.slot ?? null,
            transactionDate(tx),
            tx.type ?? null,
            tx.source ?? null,
            JSON.stringify(tx)
          ]
        );

        for (const transfer of tx.tokenTransfers ?? []) {
          if (!transfer.mint) continue;
          await client.query(
            `INSERT INTO token_transfers(signature, token_mint, from_wallet, to_wallet, amount, token_account)
             VALUES($1, $2, $3, $4, $5, $6)
             ON CONFLICT DO NOTHING`,
            [
              tx.signature,
              transfer.mint,
              transfer.fromUserAccount ?? null,
              transfer.toUserAccount ?? null,
              normalizeAmount(transfer.tokenAmount),
              transfer.toTokenAccount ?? transfer.fromTokenAccount ?? null
            ]
          );
        }

        for (const event of detectSwapEvents(tx, walletAddress)) {
          await client.query(
            `INSERT INTO swap_events(
              signature, wallet_address, token_mint_in, token_mint_out, amount_in, amount_out,
              sold_token_mint, bought_token_mint, native_sol_change, event_at, raw
            )
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
             ON CONFLICT DO NOTHING`,
            [
              event.signature,
              event.walletAddress,
              event.tokenMintIn ?? null,
              event.tokenMintOut ?? null,
              event.amountIn ?? null,
              event.amountOut ?? null,
              event.soldTokenMint ?? null,
              event.boughtTokenMint ?? null,
              event.nativeSolChange ?? null,
              event.eventAt ?? null,
              JSON.stringify(event.raw)
            ]
          );
        }
      }

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  });
}

export async function classifyWalletBehavior(walletAddress: string, tokenMint: string) {
  const recipient = await query<{
    amount: string;
    first_received_at: Date | null;
  }>(
    `SELECT amount, first_received_at
     FROM airdrop_recipients
     WHERE wallet_address = $1 AND token_mint = $2
     ORDER BY first_received_at NULLS LAST
     LIMIT 1`,
    [walletAddress, tokenMint]
  );

  const receivedAmount = Number(recipient.rows[0]?.amount ?? 0);
  const firstReceivedAt = recipient.rows[0]?.first_received_at ?? null;
  const currentBalance = await getWalletTokenBalance(walletAddress, tokenMint);

  const swapOut = await query<{
    first_sell_at: Date | null;
    estimated_realized_value: string | null;
  }>(
    `SELECT MIN(event_at) AS first_sell_at,
            SUM(CASE WHEN native_sol_change > 0 THEN native_sol_change ELSE 0 END) AS estimated_realized_value
     FROM swap_events
     WHERE wallet_address = $1 AND sold_token_mint = $2`,
    [walletAddress, tokenMint]
  );

  const firstSellAt = swapOut.rows[0]?.first_sell_at ?? null;
  const estimatedRealizedValue = Number(swapOut.rows[0]?.estimated_realized_value ?? 0);

  let behavior: WalletBehavior = "UNKNOWN";
  if (receivedAmount > 0 && currentBalance > receivedAmount + EPSILON) {
    behavior = "ACCUMULATED";
  } else if (receivedAmount > 0 && currentBalance <= EPSILON && firstSellAt) {
    behavior = "SOLD";
  } else if (receivedAmount > 0 && currentBalance >= receivedAmount - EPSILON) {
    behavior = "HELD";
  } else if (receivedAmount > 0) {
    behavior = "HELD";
  }

  const timeToSellSeconds =
    firstReceivedAt && firstSellAt
      ? Math.max(0, Math.floor((firstSellAt.getTime() - firstReceivedAt.getTime()) / 1000))
      : null;

  await query(
    `INSERT INTO wallet_token_states(
      wallet_address, token_mint, received_amount, current_balance, behavior,
      first_received_at, first_sell_at, time_to_sell_seconds,
      estimated_realized_value, estimated_realized_currency, last_classified_at
    )
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now())
     ON CONFLICT(wallet_address, token_mint)
     DO UPDATE SET
       received_amount = EXCLUDED.received_amount,
       current_balance = EXCLUDED.current_balance,
       behavior = EXCLUDED.behavior,
       first_received_at = EXCLUDED.first_received_at,
       first_sell_at = EXCLUDED.first_sell_at,
       time_to_sell_seconds = EXCLUDED.time_to_sell_seconds,
       estimated_realized_value = EXCLUDED.estimated_realized_value,
       estimated_realized_currency = EXCLUDED.estimated_realized_currency,
       last_classified_at = now()`,
    [
      walletAddress,
      tokenMint,
      receivedAmount,
      currentBalance,
      behavior,
      firstReceivedAt,
      firstSellAt,
      timeToSellSeconds,
      estimatedRealizedValue || null,
      estimatedRealizedValue ? "SOL" : null
    ]
  );

  return {
    walletAddress,
    tokenMint,
    receivedAmount,
    currentBalance,
    behavior,
    firstReceivedAt,
    firstSellAt,
    timeToSellSeconds,
    estimatedRealizedValue: estimatedRealizedValue || null,
    estimatedRealizedCurrency: estimatedRealizedValue ? "SOL" : null
  };
}

export async function scanAirdrop(tokenMint: string, distributorWallet = DEFAULT_DISTRIBUTOR_WALLET) {
  const recipients = await getAirdropRecipients(tokenMint, distributorWallet);

  await withClient(async (client) => {
    await client.query("BEGIN");
    try {
      await client.query(
        `INSERT INTO airdrop_campaigns(token_mint, distributor_wallet, token_symbol, last_scanned_at)
         VALUES($1, $2, 'ANSEM', now())
         ON CONFLICT(token_mint, distributor_wallet)
         DO UPDATE SET last_scanned_at = now()`,
        [tokenMint, distributorWallet]
      );

      for (const recipient of recipients) {
        await client.query(
          "INSERT INTO wallets(address, last_seen_at) VALUES($1, now()) ON CONFLICT(address) DO UPDATE SET last_seen_at = now()",
          [recipient.walletAddress]
        );
        await client.query(
          `INSERT INTO airdrop_recipients(
            token_mint, wallet_address, distributor_wallet, first_received_signature, first_received_at, amount
          )
           VALUES($1,$2,$3,$4,$5,$6)
           ON CONFLICT(token_mint, wallet_address, distributor_wallet)
           DO UPDATE SET amount = EXCLUDED.amount`,
          [
            tokenMint,
            recipient.walletAddress,
            distributorWallet,
            recipient.signature,
            recipient.receivedAt,
            recipient.amount
          ]
        );
      }

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  });

  const pending = await query<{ wallet_address: string }>(
    `SELECT ar.wallet_address
     FROM airdrop_recipients ar
     LEFT JOIN wallet_token_states wts
       ON wts.wallet_address = ar.wallet_address AND wts.token_mint = ar.token_mint
     WHERE ar.token_mint = $1
     ORDER BY wts.last_classified_at NULLS FIRST, ar.first_received_at ASC NULLS LAST
     LIMIT $2`,
    [tokenMint, MAX_WALLETS_PER_SCAN]
  );

  const classified = [];
  for (const row of pending.rows) {
    const txs = await getWalletTransactions(row.wallet_address);
    await storeTransactions(row.wallet_address, txs);
    classified.push(await classifyWalletBehavior(row.wallet_address, tokenMint));
  }

  return {
    tokenMint,
    distributorWallet,
    recipientsFound: recipients.length,
    walletsClassified: classified.length,
    classificationLimit: MAX_WALLETS_PER_SCAN
  };
}
