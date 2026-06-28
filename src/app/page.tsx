import { DEFAULT_DISTRIBUTOR_WALLET, DEFAULT_TOKEN_MINT } from "@/lib/config";
import { getDashboardAnalytics } from "@/lib/analytics";
import { BehaviorChart } from "@/components/behavior-chart";
import { TimeToSellChart } from "@/components/time-to-sell-chart";
import { ScanPanel } from "@/components/scan-panel";
import { WalletSearch } from "@/components/wallet-search";
import { StatCard } from "@/components/stat-card";
import { compactAddress, formatNumber, formatPct } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function Home() {
  let analytics: Awaited<ReturnType<typeof getDashboardAnalytics>> | null = null;
  let setupError = "";

  try {
    analytics = await getDashboardAnalytics(DEFAULT_TOKEN_MINT);
  } catch (error) {
    setupError = error instanceof Error ? error.message : "Unable to load dashboard";
  }

  const summary = analytics?.summary;

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">A</div>
          <div>
            <p className="eyebrow">Solana intelligence</p>
            <h1>ANSEM Airdrops</h1>
          </div>
        </div>
        <nav className="nav-list" aria-label="Dashboard sections">
          <a href="#overview">Overview</a>
          <a href="#behavior">Behavior</a>
          <a href="#wallets">Wallets</a>
          <a href="#search">Search</a>
        </nav>
        <div className="side-meta">
          <span>Mint</span>
          <strong>{compactAddress(DEFAULT_TOKEN_MINT)}</strong>
          <span>Distributor</span>
          <strong>{compactAddress(DEFAULT_DISTRIBUTOR_WALLET)}</strong>
        </div>
      </aside>

      <section className="content">
        <header className="hero" id="overview">
          <div>
            <p className="eyebrow">$ANSEM holder behavior</p>
            <h2>Real on-chain airdrop tracking for wallets funded by blknoiz06.</h2>
            <p className="hero-copy">
              Scan the distributor wallet, persist recipients, decode transfers and swaps, then
              classify every recipient as sold, held, or accumulated.
            </p>
          </div>
          <ScanPanel tokenMint={DEFAULT_TOKEN_MINT} distributorWallet={DEFAULT_DISTRIBUTOR_WALLET} />
        </header>

        {setupError ? (
          <section className="notice">
            <h3>Setup needed</h3>
            <p>{setupError}</p>
            <p>
              Add `DATABASE_URL` and `HELIUS_API_KEY`, run the migration, then press scan. No demo
              data is displayed because this dashboard only reports live indexed chain data.
            </p>
          </section>
        ) : null}

        <section className="metrics-grid" aria-label="Analytics summary">
          <StatCard label="Wallets classified" value={formatNumber(summary?.totalWallets ?? 0)} />
          <StatCard label="Sold" value={formatPct(summary?.soldPct ?? 0)} detail={`${summary?.sold ?? 0} wallets`} tone="red" />
          <StatCard label="Holding" value={formatPct(summary?.heldPct ?? 0)} detail={`${summary?.held ?? 0} wallets`} tone="green" />
          <StatCard label="Accumulated" value={formatPct(summary?.accumulatedPct ?? 0)} detail={`${summary?.accumulated ?? 0} wallets`} tone="blue" />
        </section>

        <section className="panel-grid" id="behavior">
          <article className="panel">
            <div className="panel-head">
              <div>
                <p className="eyebrow">Behavior split</p>
                <h3>Sold vs held vs accumulated</h3>
              </div>
            </div>
            <BehaviorChart summary={summary ?? null} />
          </article>

          <article className="panel">
            <div className="panel-head">
              <div>
                <p className="eyebrow">Exit timing</p>
                <h3>Time-to-sell distribution</h3>
              </div>
            </div>
            <TimeToSellChart data={analytics?.timeToSell ?? []} />
          </article>
        </section>

        <section className="table-grid" id="wallets">
          <article className="panel">
            <div className="panel-head">
              <div>
                <p className="eyebrow">Seller pressure</p>
                <h3>Top sellers</h3>
              </div>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Wallet</th>
                    <th>Received</th>
                    <th>Realized</th>
                    <th>Time</th>
                  </tr>
                </thead>
                <tbody>
                  {(analytics?.topSellers ?? []).map((wallet) => (
                    <tr key={wallet.wallet_address}>
                      <td>{compactAddress(wallet.wallet_address)}</td>
                      <td>{formatNumber(wallet.received_amount)}</td>
                      <td>{wallet.estimated_realized_value ? `${formatNumber(wallet.estimated_realized_value)} SOL` : "Unknown"}</td>
                      <td>{wallet.time_to_sell_seconds ? `${Math.round(wallet.time_to_sell_seconds / 3600)}h` : "Unknown"}</td>
                    </tr>
                  ))}
                  {!analytics?.topSellers.length ? (
                    <tr><td colSpan={4}>No sold wallets indexed yet.</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </article>

          <article className="panel">
            <div className="panel-head">
              <div>
                <p className="eyebrow">Diamond hands</p>
                <h3>Largest holders</h3>
              </div>
            </div>
            <div className="wallet-list">
              {(analytics?.diamondHands ?? []).map((wallet) => (
                <div className="wallet-row" key={wallet.wallet_address}>
                  <span>{compactAddress(wallet.wallet_address)}</span>
                  <strong>{formatNumber(wallet.current_balance)}</strong>
                  <em>{wallet.behavior}</em>
                </div>
              ))}
              {!analytics?.diamondHands.length ? <p className="empty">No holders indexed yet.</p> : null}
            </div>
          </article>
        </section>

        <section className="panel" id="search">
          <div className="panel-head">
            <div>
              <p className="eyebrow">Wallet investigation</p>
              <h3>Search a recipient timeline</h3>
            </div>
          </div>
          <WalletSearch tokenMint={DEFAULT_TOKEN_MINT} />
        </section>
      </section>
    </main>
  );
}
