import { Schema, Types, model } from 'mongoose';

/**
 * One signed-in device.
 *
 * WHY sessions exist as documents: an access token is short-lived and cannot be
 * withdrawn once issued. The refresh token is the thing with real power - it can
 * mint new access tokens for weeks - so it must be revocable. Keeping it here
 * means "log out everywhere" and "this account is compromised" are both a single
 * database update.
 *
 * Only a SHA-256 hash of the refresh token is stored. A leaked database dump
 * therefore yields no usable tokens, exactly as with passwords.
 *
 * Rotation and reuse detection: every refresh issues a new token and marks the
 * old one replaced. If an already-replaced token is presented, it was stolen -
 * the whole session family is revoked immediately rather than serving the
 * attacker.
 */

export interface ISession {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  /** The organization this session is working in. Set when a business is chosen. */
  organizationId?: Types.ObjectId;
  refreshTokenHash: string;
  /** Groups every rotation of one login, so reuse can revoke the whole chain. */
  familyId: Types.ObjectId;
  userAgent?: string;
  ipAddress?: string;
  expiresAt: Date;
  revokedAt?: Date;
  revokedReason?: string;
  lastUsedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const sessionSchema = new Schema<ISession>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization' },
    refreshTokenHash: { type: String, required: true, unique: true },
    familyId: { type: Schema.Types.ObjectId, required: true, index: true },
    userAgent: { type: String, maxlength: 400 },
    ipAddress: { type: String, maxlength: 64 },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date },
    revokedReason: { type: String, maxlength: 120 },
    lastUsedAt: { type: Date },
  },
  { timestamps: true },
);

// MongoDB deletes expired sessions on its own, so the collection cannot grow
// without bound as devices come and go.
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const Session = model<ISession>('Session', sessionSchema);
