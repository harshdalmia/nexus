const numberFormat = new Intl.NumberFormat('en-US');
const moneyFormat = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

export const num = (value: number): string => numberFormat.format(value);

export const money = (value: number): string => moneyFormat.format(value);

export const seconds = (ms: number): string => `${(ms / 1000).toFixed(1)}s`;

export const slaLabel = (hours: number): string => {
  if (hours === 0) {
    return 'closed';
  }

  if (hours < 24) {
    return `${String(hours)}h left`;
  }

  return `${String(Math.round(hours / 24))}d left`;
};

export const percent = (value: number, digits = 0): string => `${(value * 100).toFixed(digits)}%`;

export const signed = (value: number): string => (value > 0 ? `+${String(value)}` : String(value));
