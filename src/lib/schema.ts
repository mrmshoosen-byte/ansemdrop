export const SCHEMA_SQL = `
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS wallets (
  address TEXT PRIMARY KEY,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS airdrop_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_mint TEXT NOT NULL,
  distributor_wallet TEXT NOT NULL,
  token_symbol TEXT NOT NULL DEFAULT 'ANSEM',
  first_scanned_signature TEXT,
  last_scanned_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (token_mint, distributor_wallet)
);

CREATE TABLE IF NOT EXISTS airdrop_recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_mint TEXT NOT NULL,
  wallet_address TEXT NOT NULL REFERENCES wallets(address) ON DELETE CASCADE,
  distributor_wallet TEXT NOT NULL,
  first_received_signature TEXT NOT NULL,
  first_received_at TIMESTAMPTZ,
  amount NUMERIC(38, 12) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (token_mint, wallet_address, distributor_wallet)
);

CREATE TABLE IF NOT EXISTS transactions (
  signature TEXT PRIMARY KEY,
  wallet_address TEXT REFERENCES wallets(address) ON DELETE SET NULL,
  slot BIGINT,
  block_time TIMESTAMPTZ,
  tx_type TEXT,
  source TEXT,
  raw JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS token_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signature TEXT NOT NULL REFERENCES transactions(signature) ON DELETE CASCADE,
  token_mint TEXT NOT NULL,
  from_wallet TEXT,
  to_wallet TEXT,
  amount NUMERIC(38, 12) NOT NULL DEFAULT 0,
  token_account TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_token_transfer_event
  ON token_transfers(signature, token_mint, COALESCE(from_wallet, ''), COALESCE(to_wallet, ''), amount);

CREATE TABLE IF NOT EXISTS swap_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signature TEXT NOT NULL REFERENCES transactions(signature) ON DELETE CASCADE,
  wallet_address TEXT REFERENCES wallets(address) ON DELETE SET NULL,
  token_mint_in TEXT,
  token_mint_out TEXT,
  amount_in NUMERIC(38, 12),
  amount_out NUMERIC(38, 12),
  sold_token_mint TEXT,
  bought_token_mint TEXT,
  native_sol_change NUMERIC(38, 12),
  event_at TIMESTAMPTZ,
  raw JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_swap_event
  ON swap_events(signature, COALESCE(wallet_address, ''), COALESCE(sold_token_mint, ''), COALESCE(bought_token_mint, ''));

CREATE TABLE IF NOT EXISTS wallet_token_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address TEXT NOT NULL REFERENCES wallets(address) ON DELETE CASCADE,
  token_mint TEXT NOT NULL,
  received_amount NUMERIC(38, 12) NOT NULL DEFAULT 0,
  current_balance NUMERIC(38, 12) NOT NULL DEFAULT 0,
  behavior TEXT NOT NULL CHECK (behavior IN ('SOLD', 'HELD', 'ACCUMULATED', 'UNKNOWN')),
  first_received_at TIMESTAMPTZ,
  first_sell_at TIMESTAMPTZ,
  time_to_sell_seconds BIGINT,
  estimated_realized_value NUMERIC(38, 12),
  estimated_realized_currency TEXT,
  last_classified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (wallet_address, token_mint)
);

CREATE INDEX IF NOT EXISTS idx_airdrop_recipients_mint ON airdrop_recipients(token_mint);
CREATE INDEX IF NOT EXISTS idx_transactions_wallet ON transactions(wallet_address);
CREATE INDEX IF NOT EXISTS idx_token_transfers_mint ON token_transfers(token_mint);
CREATE INDEX IF NOT EXISTS idx_swap_events_wallet ON swap_events(wallet_address);
CREATE INDEX IF NOT EXISTS idx_wallet_states_mint_behavior ON wallet_token_states(token_mint, behavior);
`;
