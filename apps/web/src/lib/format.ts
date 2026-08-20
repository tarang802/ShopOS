import { paiseToRupees, type Paise } from '@shopos/shared';

/**
 * Formatting for an Indian business.
 *
 * WHY this file exists: the Western thousands grouping (120,000) is not how
 * anyone in an Indian shop reads a number. They read one lakh twenty thousand,
 * written 1,20,000. Getting this wrong makes every figure on screen feel foreign
 * and slows down the people who have to check it against a paper register.
 *
 * `en-IN` gives the lakh/crore grouping for free, so all of it flows through
 * these helpers rather than being formatted ad hoc in components.
 */

const rupeeFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const rupeeCompactFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const numberFormatter = new Intl.NumberFormat('en-IN');

/** 48000 paise -> "Rs 480.00", with the rupee sign. */
export function formatMoney(paise: Paise): string {
  return rupeeFormatter.format(paiseToRupees(paise));
}

/** Same, without paise. For headline figures where the decimals are noise. */
export function formatMoneyShort(paise: Paise): string {
  return rupeeCompactFormatter.format(paiseToRupees(paise));
}

/** 120000 -> "1,20,000". Lakh grouping, as an Indian reader expects. */
export function formatNumber(value: number): string {
  return numberFormatter.format(value);
}

/** A quantity with its unit: "1,200 pcs". */
export function formatQuantity(value: number, unitSymbol?: string): string {
  const digits = Number.isInteger(value) ? formatNumber(value) : value.toFixed(3).replace(/0+$/, '');
  return unitSymbol ? `${digits} ${unitSymbol}` : digits;
}

/**
 * Rupees typed into a form, converted to paise for the API.
 * Accepts "4.80", "4,80" is rejected, and blanks become zero.
 */
export function parseRupeeInput(value: string): number {
  const cleaned = value.replace(/[^0-9.]/g, '');
  const parsed = Number.parseFloat(cleaned);
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(parsed * 100);
}

/** Paise back into the plain decimal a form field should show. */
export function paiseToInput(paise: Paise): string {
  return (paise / 100).toFixed(2);
}

const dateFormatter = new Intl.DateTimeFormat('en-IN', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});

const dateTimeFormatter = new Intl.DateTimeFormat('en-IN', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '-';
  return dateFormatter.format(new Date(value));
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '-';
  return dateTimeFormatter.format(new Date(value));
}

/** "2 hours ago" style, for activity feeds where the exact minute does not matter. */
export function formatRelative(value: string | Date | null | undefined): string {
  if (!value) return '-';
  const then = new Date(value).getTime();
  const seconds = Math.round((Date.now() - then) / 1000);

  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hr ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)} days ago`;
  return formatDate(value);
}
