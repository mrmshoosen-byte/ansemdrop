"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export function TimeToSellChart({ data }: { data: Array<{ bucket: string; wallets: number }> }) {
  if (!data.length) {
    return <div className="chart-empty">Sold-wallet timing appears after swap exits are indexed.</div>;
  }

  return (
    <div className="chart-box">
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={data}>
          <CartesianGrid stroke="#20242f" vertical={false} />
          <XAxis dataKey="bucket" stroke="#8b93a7" tickLine={false} axisLine={false} />
          <YAxis stroke="#8b93a7" tickLine={false} axisLine={false} allowDecimals={false} />
          <Tooltip
            contentStyle={{ background: "#0b0d12", border: "1px solid #262a36", borderRadius: 8 }}
            cursor={{ fill: "rgba(255,255,255,0.04)" }}
          />
          <Bar dataKey="wallets" fill="#f8fafc" radius={[6, 6, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
