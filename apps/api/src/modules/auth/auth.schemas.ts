import { z } from 'zod';
import { emailSchema, objectIdSchema, passwordSchema } from '@shopos/shared';

/**
 * What the API accepts on the authentication routes.
 *
 * These schemas are allow-lists: only the fields declared here survive parsing,
 * so a client cannot add `isActive: true` or `organizationId` to a sign-up body
 * and have it reach the database. That is the defence against mass assignment,
 * and it is the reason validation happens before any service is called.
 */

export const registerSchema = z.object({
  name: z.string().trim().min(2, 'Enter your name').max(120),
  email: emailSchema,
  password: passwordSchema,
  phone: z.string().trim().max(20).optional(),
  businessName: z.string().trim().min(2, 'Enter your business name').max(160),
  businessType: z.string().trim().max(60).optional(),
  city: z.string().trim().max(80).optional(),
  branchName: z.string().trim().max(120).optional(),
});

export const loginSchema = z.object({
  email: emailSchema,
  // Not `passwordSchema`: the rules may tighten over time, and an old password
  // that no longer meets them must still be able to sign in and be changed.
  password: z.string().min(1, 'Enter your password').max(128),
  organizationId: objectIdSchema.optional(),
});

export const googleLoginSchema = z.object({
  credential: z.string().min(10, 'Missing Google credential'),
  organizationId: objectIdSchema.optional(),
  businessName: z.string().trim().min(2).max(160).optional(),
  businessType: z.string().trim().max(60).optional(),
  city: z.string().trim().max(80).optional(),
});

export const switchOrganizationSchema = z.object({
  organizationId: objectIdSchema,
});

export type RegisterBody = z.infer<typeof registerSchema>;
export type LoginBody = z.infer<typeof loginSchema>;
export type GoogleLoginBody = z.infer<typeof googleLoginSchema>;
export type SwitchOrganizationBody = z.infer<typeof switchOrganizationSchema>;
