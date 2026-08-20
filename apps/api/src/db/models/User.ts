import { Schema, Types, model } from 'mongoose';
import type { AuthProvider } from '@shopos/shared';
import { AUTH_PROVIDERS } from '@shopos/shared';

/**
 * A user is a person, identified globally by email.
 *
 * WHY global rather than per-organization: an accountant may keep the books for
 * two businesses, and a family may run three shops as separate organizations
 * under one login. Identity is global; what a person may *do* is decided by
 * their Membership, which belongs to one organization.
 *
 * The password hash is `select: false`, so it is left out of every query unless
 * explicitly asked for. Exposure then requires a deliberate act, not a
 * forgotten projection.
 */

export interface IUser {
  _id: Types.ObjectId;
  name: string;
  email: string;
  phone?: string;
  /** Argon2/bcrypt hash. Absent for accounts that only ever used Google. */
  passwordHash?: string;
  /** Which sign-in methods this person has actually used. */
  authProviders: AuthProvider[];
  /** Google's stable subject id. Never the email, which a person can change. */
  googleId?: string;
  avatarUrl?: string;
  emailVerifiedAt?: Date;
  lastLoginAt?: Date;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<IUser>(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: 160,
    },
    phone: { type: String, trim: true, maxlength: 20 },
    passwordHash: { type: String, select: false },
    authProviders: {
      type: [String],
      enum: Object.values(AUTH_PROVIDERS),
      default: [],
    },
    googleId: { type: String, sparse: true, index: true },
    avatarUrl: { type: String, maxlength: 500 },
    emailVerifiedAt: { type: Date },
    lastLoginAt: { type: Date },
    isActive: { type: Boolean, required: true, default: true },
  },
  { timestamps: true },
);

/**
 * Users are not tenant-scoped, so the tenant guard is not applied. Access to a
 * user record is instead gated by membership: a request may only read users who
 * share the caller's organization, which the user service enforces.
 */
export const User = model<IUser>('User', userSchema);
