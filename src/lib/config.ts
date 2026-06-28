export const DEFAULT_TOKEN_MINT =
  process.env.DEFAULT_TOKEN_MINT ?? "9cRCn9rGT8V2imeM2BaKs13yhMEais3ruM3rPvTGpump";

export const DEFAULT_DISTRIBUTOR_WALLET =
  process.env.DEFAULT_DISTRIBUTOR_WALLET ?? "GV6UUmNxz2RpKxmNAPadYKb7uQpszwqQAu3qLJxVdC52";

export const DEFAULT_TOKEN_SYMBOL = "ANSEM";

export const MAX_WALLETS_PER_SCAN = Number(process.env.MAX_WALLETS_PER_SCAN ?? 5);

export const MAX_DISTRIBUTOR_PAGES_PER_SCAN = Number(
  process.env.MAX_DISTRIBUTOR_PAGES_PER_SCAN ?? 3
);

export const MAX_WALLET_TX_PAGES_PER_SCAN = Number(
  process.env.MAX_WALLET_TX_PAGES_PER_SCAN ?? 2
);

export const HELIUS_REQUEST_DELAY_MS = Number(process.env.HELIUS_REQUEST_DELAY_MS ?? 220);

export function requireEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}
