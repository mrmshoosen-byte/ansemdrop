"use client";

import { useState } from "react";

type Props = {
  tokenMint: string;
  distributorWallet: string;
};

export function ScanPanel({ tokenMint, distributorWallet }: Props) {
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  async function scan() {
    setLoading(true);
    setStatus("Scanning Helius and updating wallet states...");
    try {
      const response = await fetch("/api/airdrop/scan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tokenMint, distributorWallet })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Scan failed");
      setStatus(`Found ${result.recipientsFound} recipients. Classified ${result.walletsClassified} wallets this run.`);
      window.setTimeout(() => window.location.reload(), 1200);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Scan failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="scan-card">
      <span>Live ingestion</span>
      <button onClick={scan} disabled={loading}>{loading ? "Scanning..." : "Scan airdrop"}</button>
      <p>{status || "Uses the configured Helius key. Re-run to continue processing recipients."}</p>
    </div>
  );
}
