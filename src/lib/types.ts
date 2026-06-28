export type WalletBehavior = "SOLD" | "HELD" | "ACCUMULATED" | "UNKNOWN";

export type HeliusTokenTransfer = {
  fromUserAccount?: string;
  toUserAccount?: string;
  fromTokenAccount?: string;
  toTokenAccount?: string;
  mint?: string;
  tokenAmount?: number;
};

export type HeliusSwapLeg = {
  mint?: string;
  tokenAmount?: number;
  rawTokenAmount?: {
    tokenAmount?: string;
    decimals?: number;
  };
  userAccount?: string;
};

export type HeliusTransaction = {
  signature: string;
  slot?: number;
  timestamp?: number;
  type?: string;
  source?: string;
  tokenTransfers?: HeliusTokenTransfer[];
  nativeTransfers?: Array<{
    fromUserAccount?: string;
    toUserAccount?: string;
    amount?: number;
  }>;
  events?: {
    swap?: {
      nativeInput?: { amount?: number; account?: string };
      nativeOutput?: { amount?: number; account?: string };
      tokenInputs?: HeliusSwapLeg[];
      tokenOutputs?: HeliusSwapLeg[];
      innerSwaps?: unknown[];
    };
  };
  accountData?: Array<{
    account?: string;
    nativeBalanceChange?: number;
    tokenBalanceChanges?: Array<{
      mint?: string;
      rawTokenAmount?: {
        tokenAmount?: string;
        decimals?: number;
      };
      userAccount?: string;
    }>;
  }>;
};

export type Recipient = {
  walletAddress: string;
  amount: number;
  signature: string;
  receivedAt: Date | null;
};

export type SwapEvent = {
  signature: string;
  walletAddress: string;
  tokenMintIn?: string;
  tokenMintOut?: string;
  amountIn?: number;
  amountOut?: number;
  soldTokenMint?: string;
  boughtTokenMint?: string;
  nativeSolChange?: number;
  eventAt?: Date | null;
  raw: unknown;
};
