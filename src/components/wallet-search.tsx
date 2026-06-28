"use client";

import { FormEvent, useState } from "react";
import { compactAddress, formatNumber } from "@/lib/format";

type SearchResult = {
  address: string;
  state: {
    behavior: string;
    received_amount: string;
    current_balance: string;
    estimated_realized_value: string | null;
  } | null;
  timeline: Array<Record<string, string | number | null>>;
};

export function WalletSearch({ tokenMint }: { tokenMint: string }) {
  const [address, setAddress] = useState("");
  const [result, setResult] = useState<SearchResult | null>(null);
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setMessage("Searching indexed activity...");
    setResult(null);

    const response = await fetch(`/api/wallets/search?address=${encodeURIComponent(address)}&mint=${tokenMint}`);
    const payload = await response.json();
    if (!response.ok) {
      setMessage(payload.error ?? "Search failed");
      return;
    }

    setResult(payload);
    setMessage(payload.state ? "" : "Wallet not indexed yet. Run a scan first or wait for this wallet to be processed.");
  }

  return (
    <div className="search-box">
      <form onSubmit={submit} className="search-form">
        <input
          value={address}
          onChange={(event) => setAddress(event.target.value)}
          placeholder="Paste Solana wallet address"
          aria-label="Wallet address"
        />
        <button type="submit">Search</button>
      </form>
      {message ? <p className="empty">{message}</p> : null}
      {result?.state ? (
        <div className="search-result">
          <div className="result-summary">
            <strong>{compactAddress(result.address)}</strong>
            <span>{result.state.behavior}</span>
            <em>Received {formatNumber(Number(result.state.received_amount))}</em>
            <em>Balance {formatNumber(Number(result.state.current_balance))}</em>
          </div>
          <div className="timeline">
            {result.timeline.map((item, index) => (
              <div className="timeline-item" key={`${item.signature}-${index}`}>
                <span>{String(item.kind)}</span>
                <strong>{item.signature ? compactAddress(String(item.signature)) : "Unknown"}</strong>
                <em>{item.at ? new Date(String(item.at)).toLocaleString() : "No timestamp"}</em>
              </div>
            ))}
            {!result.timeline.length ? <p className="empty">No timeline events indexed for this wallet yet.</p> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
