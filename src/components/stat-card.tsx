type Props = {
  label: string;
  value: string;
  detail?: string;
  tone?: "red" | "green" | "blue";
};

export function StatCard({ label, value, detail, tone }: Props) {
  return (
    <article className={`stat-card ${tone ? `tone-${tone}` : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {detail ? <em>{detail}</em> : null}
    </article>
  );
}
