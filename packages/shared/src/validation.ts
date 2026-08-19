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

/** Physical quantities may be fractional (2.5 kg) but never absurdly precise. */
export const quantitySchema = z
  .number()
  .finite()
  .refine((n) => Number.isInteger(n * 1000), 'At most 3 decimal places');

export const percentSchema = z.number().min(0).max(100);
