import { HELIUS_REQUEST_DELAY_MS, requireEnv } from "@/lib/config";
import type { HeliusTransaction } from "@/lib/types";

const LAMPORTS_PER_SOL = 1_000_000_000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function heliusFetch<T>(url: string, init?: RequestInit, attempt = 0): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {})
    },
    cache: "no-store"
  });

  if ((response.status === 429 || response.status >= 500) && attempt < 5) {
    const backoff = Math.min(8_000, 600 * 2 ** attempt);
    await sleep(backoff);
    return heliusFetch<T>(url, init, attempt + 1);
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Helius request failed (${response.status}): ${body}`);
  }

  if (HELIUS_REQUEST_DELAY_MS > 0) {
    await sleep(HELIUS_REQUEST_DELAY_MS);
  }

  return response.json() as Promise<T>;
}

export async function getEnhancedTransactions(
  address: string,
  before?: string,
  limit = 100
) {
  const apiKey = requireEnv("HELIUS_API_KEY");
  const params = new URLSearchParams({
    "api-key": apiKey,
    limit: String(limit),
    commitment: "finalized"
  });

  if (before) {
    params.set("before", before);
  }

  return heliusFetch<HeliusTransaction[]>(
    `https://api.helius.xyz/v0/addresses/${address}/transactions?${params.toString()}`
  );
}

export async function getTokenAccountsBalance(owner: string, tokenMint: string) {
  const apiKey = requireEnv("HELIUS_API_KEY");
  const response = await heliusFetch<{
    result?: {
      value?: Array<{
        account?: {
          data?: {
            parsed?: {
              info?: {
                tokenAmount?: {
                  uiAmountString?: string;
                  uiAmount?: number;
                };
              };
            };
          };
        };
      }>;
    };
  }>(`https://mainnet.helius-rpc.com/?api-key=${apiKey}`, {
    method: "POST",
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "get-token-accounts",
      method: "getTokenAccountsByOwner",
      params: [
        owner,
        { mint: tokenMint },
        { encoding: "jsonParsed", commitment: "finalized" }
      ]
    })
  });

  return (
    response.result?.value?.reduce((sum, account) => {
      const tokenAmount = account.account?.data?.parsed?.info?.tokenAmount;
      return sum + Number(tokenAmount?.uiAmountString ?? tokenAmount?.uiAmount ?? 0);
    }, 0) ?? 0
  );
}

export function lamportsToSol(lamports?: number) {
  return (lamports ?? 0) / LAMPORTS_PER_SOL;
}
