"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

type Summary = {
  sold: number;
  held: number;
  accumulated: number;
  unknown: number;
} | null;

const COLORS = ["#ff5c7a", "#4ade80", "#38bdf8", "#737373"];

export function BehaviorChart({ summary }: { summary: Summary }) {
  const data = [
    { name: "Sold", value: summary?.sold ?? 0 },
    { name: "Held", value: summary?.held ?? 0 },
    { name: "Accumulated", value: summary?.accumulated ?? 0 },
    { name: "Unknown", value: summary?.unknown ?? 0 }
  ].filter((item) => item.value > 0);

  if (!data.length) {
    return <div className="chart-empty">Scan the token to populate behavior analytics.</div>;
  }

  return (
    <div className="chart-box">
      <ResponsiveContainer width="100%" height={280}>
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" innerRadius={72} outerRadius={112} paddingAngle={3}>
            {data.map((_, index) => (
              <Cell key={index} fill={COLORS[index % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{ background: "#0b0d12", border: "1px solid #262a36", borderRadius: 8 }}
            itemStyle={{ color: "#f7f7f8" }}
          />
        </PieChart>
      </ResponsiveContainer>
      <div className="legend">
        {data.map((item, index) => (
          <span key={item.name}><i style={{ background: COLORS[index] }} />{item.name}</span>
        ))}
      </div>
    </div>
  );
}
