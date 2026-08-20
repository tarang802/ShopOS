import { z } from 'zod';

/** Reusable primitives so the same rule is not re-typed in twenty schemas. */

/** A 24-character hex MongoDB ObjectId, validated as a string at the edge. */
export const objectIdSchema = z
  .string()
  .regex(/^[a-f\d]{24}$/i, 'Must be a valid id');

export const emailSchema = z.string().trim().toLowerCase().email('Enter a valid email address');

/**
 * Password policy. Length is the property that actually resists guessing, so we
 * require real length rather than a maze of character-class rules.
 */
export const passwordSchema = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(128, 'Password must be at most 128 characters');

export const shortNameSchema = z.string().trim().min(1).max(120);

/** Money arriving from a client is always an integer count of paise. */
export const paiseSchema = z
  .number()
  .int('Amount must be a whole number of paise')
  .nonnegative('Amount cannot be negative');

/**
 * Physical quantities may be fractional (2.5 kg of nails) but never absurdly
 * precise, so three decimal places is the limit.
 *
 * Two variants exist because the rules differ by use: a counted stock figure may
 * legitimately be zero, while a transfer line of zero units is a mistake.
 */
const threeDecimalPlaces = (value: number) => Number.isInteger(Math.round(value * 1000));

export const quantitySchema = z
  .number()
  .finite()
  .nonnegative('Quantity cannot be negative')
  .refine(threeDecimalPlaces, 'At most 3 decimal places');

export const positiveQuantitySchema = z
  .number()
  .finite()
  .positive('Quantity must be more than zero')
  .refine(threeDecimalPlaces, 'At most 3 decimal places');

export const percentSchema = z.number().min(0).max(100);
