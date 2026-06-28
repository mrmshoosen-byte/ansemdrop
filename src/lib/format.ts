export function compactAddress(address: string) {
  if (!address || address.length < 12) return address;
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

export function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: value > 10 ? 2 : 6
  }).format(value);
}

export function formatPct(value: number) {
  return `${value.toFixed(1)}%`;
}
