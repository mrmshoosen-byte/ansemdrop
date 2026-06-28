# ANSEM Airdrop Tracker

A Vercel-ready Next.js dashboard for tracking Solana token airdrops from the known distributor wallet:

- Token mint: `9cRCn9rGT8V2imeM2BaKs13yhMEais3ruM3rPvTGpump`
- Distributor wallet: `GV6UUmNxz2RpKxmNAPadYKb7uQpszwqQAu3qLJxVdC52`
- Token ticker: `$ANSEM`

The app uses real on-chain data only. It does not ship mock analytics.

## What It Does

- Finds wallets that received `$ANSEM` from the distributor wallet.
- Stores recipients, transactions, token transfers, swap events, and wallet token states in PostgreSQL.
- Uses Helius enhanced transactions to decode transfers and swap events.
- Classifies wallets as:
  - `SOLD`: no remaining token balance and an indexed swap-out event.
  - `HELD`: still holding the original allocation or part of it without a confirmed swap exit.
  - `ACCUMULATED`: current balance is greater than the airdropped allocation.
- Shows sold/held/accumulated percentages, top sellers, time-to-sell distribution, and diamond hands.
- Lets you search any indexed wallet and view its `$ANSEM` activity timeline.

## Stack

- Next.js App Router
- PostgreSQL
- Helius API
- Recharts
- Vercel-friendly API routes

## Local Setup

1. Install dependencies:

```bash
npm install
```

2. Create `.env.local`:

```bash
cp .env.example .env.local
```

3. Add your Helius key:

```bash
HELIUS_API_KEY=your_key_here
```

4. Start local PostgreSQL:

```bash
docker compose up -d
```

5. Start the app:

```bash
npm run dev
```

Open `http://localhost:3000`, then press **Scan airdrop**. The app creates the database tables automatically on first use.

## Vercel Deployment

1. Push this repository to GitHub.
2. Import it into Vercel.
3. Add a Vercel Postgres or Neon storage integration to the project.
   - This should inject `POSTGRES_URL` or `DATABASE_URL` automatically.
   - You do not need to paste or run the SQL migration manually.
4. Add these environment variables:

```bash
HELIUS_API_KEY=your_helius_key
CRON_SECRET=make_this_a_long_random_string
DEFAULT_TOKEN_MINT=9cRCn9rGT8V2imeM2BaKs13yhMEais3ruM3rPvTGpump
DEFAULT_DISTRIBUTOR_WALLET=GV6UUmNxz2RpKxmNAPadYKb7uQpszwqQAu3qLJxVdC52
MAX_WALLETS_PER_SCAN=5
MAX_DISTRIBUTOR_PAGES_PER_SCAN=3
MAX_WALLET_TX_PAGES_PER_SCAN=2
HELIUS_REQUEST_DELAY_MS=220
```

5. Deploy.
6. Open the production dashboard and press **Scan airdrop** once.

The scheduled scan runs daily at `03:00 UTC` from `vercel.json`. This is intentionally set for Vercel's free/Hobby cron limits. Cron jobs run only on production deployments.

## Database Setup

The app still needs persistent storage, because Vercel serverless functions cannot keep indexed wallet data on local disk. The easiest path is:

1. In Vercel, open the project.
2. Go to **Storage**.
3. Create or connect **Postgres** or **Neon**.
4. Redeploy after the storage env vars are attached.

The app accepts any of these env vars:

- `DATABASE_URL`
- `POSTGRES_URL`
- `POSTGRES_PRISMA_URL`
- `POSTGRES_URL_NON_POOLING`

Tables are created automatically by `src/lib/schema.ts` the first time the dashboard, scan endpoint, or cron endpoint touches the database.

## Data Accuracy Notes

- Airdrop recipients are inferred from token transfers where the distributor wallet is the sender and the token mint matches `$ANSEM`.
- Sell detection uses Helius decoded swap events, not plain token transfers.
- Profit/loss is estimated only when a swap event exposes a positive SOL output. Airdrop cost basis is assumed to be zero, but not every swap path exposes enough pricing detail for a complete P/L.
- Free Helius keys can rate-limit. The scan endpoint defaults to 5 wallets per run, 3 distributor pages, and 2 transaction pages per wallet; repeat scans continue refreshing and classifying recipients.
- The scanner reads recent distributor-wallet history and is safe to run again as new `$ANSEM` sends happen.
- The Vercel cron job repeats that scan daily so new `$ANSEM` airdrops from the distributor wallet are picked up automatically.

## Required Backend Functions

Implemented in `src/lib/solana.ts`:

- `getAirdropRecipients(tokenMint)`
- `getWalletTransactions(walletAddress)`
- `detectSwapEvents(transaction)`
- `getWalletTokenBalance(walletAddress, tokenMint)`
- `classifyWalletBehavior(walletAddress, tokenMint)`

## Database Tables

The migration includes:

- `wallets`
- `transactions`
- `token_transfers`
- `swap_events`
- `wallet_token_states`

It also adds `airdrop_campaigns` and `airdrop_recipients` to make scans repeatable and auditable.
