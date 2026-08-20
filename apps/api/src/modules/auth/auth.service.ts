import bcrypt from 'bcryptjs';
import { OAuth2Client } from 'google-auth-library';
import { Types } from 'mongoose';
import {
  AUTH_PROVIDERS,
  ERROR_CODES,
  MEMBERSHIP_STATUSES,
  type Permission,
} from '@shopos/shared';
import { Membership, Organization, Role, Session, User } from '../../db/models';
import { withTransaction, sessionOption } from '../../db/transaction';
import { bootstrapOrganization } from '../../services/organizationBootstrap';
import {
  generateRefreshToken,
  hashRefreshToken,
  refreshTokenExpiry,
  signAccessToken,
} from '../../services/tokenService';
import { AppError } from '../../core/AppError';
import { env, features } from '../../config/env';
import { logger } from '../../core/logger';

/**
 * Authentication.
 *
 * The cost factor for bcrypt is 12. It is deliberately slow: a fast hash lets an
 * attacker with a stolen database try billions of guesses per second, and shop
 * staff do not choose strong passwords. 12 costs roughly a quarter of a second,
 * which nobody notices at login and which makes bulk guessing impractical.
 */
const BCRYPT_COST = 12;

const googleClient = env.GOOGLE_CLIENT_ID ? new OAuth2Client(env.GOOGLE_CLIENT_ID) : null;

export interface SessionMeta {
  ipAddress?: string;
  userAgent?: string;
}

export interface AuthResult {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    name: string;
    email: string;
    avatarUrl?: string;
  };
  organization: {
    id: string;
    name: string;
    slug: string;
  };
  membership: {
    id: string;
    roleName: string;
    permissions: Permission[];
    allBranches: boolean;
    branchIds: string[];
  };
}

/** A URL-safe handle for a business name, made unique by trying suffixes. */
async function generateUniqueSlug(name: string): Promise<string> {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'business';

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const existing = await Organization.exists({ slug: candidate });
    if (!existing) return candidate;
  }

  return `${base}-${Date.now().toString(36)}`;
}

/**
 * Build the signed-in state for a user in one organization.
 *
 * Shared by password login, Google login, registration and organization
 * switching, so all four produce exactly the same session shape.
 */
async function issueSession(
  userId: Types.ObjectId,
  organizationId: Types.ObjectId,
  meta: SessionMeta,
): Promise<AuthResult> {
  const [user, organization, membership] = await Promise.all([
    User.findById(userId).lean(),
    Organization.findById(organizationId).lean(),
    Membership.findOne({ organizationId, userId }).lean(),
  ]);

  if (!user || !user.isActive) throw AppError.unauthenticated('This account is not active');
  if (!organization || !organization.isActive) {
    throw AppError.forbidden('This business account is not active');
  }
  if (!membership || membership.status !== MEMBERSHIP_STATUSES.ACTIVE) {
    throw AppError.forbidden('You do not have access to this business');
  }

  const role = await Role.findOne({ organizationId, _id: membership.roleId }).lean();
  if (!role) throw AppError.forbidden('Your role no longer exists. Ask the owner to reassign it');

  const refreshToken = generateRefreshToken();
  const familyId = new Types.ObjectId();

  const [session] = await Session.create([
    {
      userId,
      organizationId,
      refreshTokenHash: hashRefreshToken(refreshToken),
      familyId,
      expiresAt: refreshTokenExpiry(),
      userAgent: meta.userAgent,
      ipAddress: meta.ipAddress,
      lastUsedAt: new Date(),
    },
  ]);
  if (!session) throw AppError.internal('Could not start a session');

  await User.updateOne({ _id: userId }, { $set: { lastLoginAt: new Date() } });

  const accessToken = signAccessToken({
    sub: userId.toString(),
    org: organizationId.toString(),
    mid: membership._id.toString(),
    sid: session._id.toString(),
  });

  return {
    accessToken,
    refreshToken,
    user: {
      id: user._id.toString(),
      name: user.name,
      email: user.email,
      ...(user.avatarUrl ? { avatarUrl: user.avatarUrl } : {}),
    },
    organization: {
      id: organization._id.toString(),
      name: organization.name,
      slug: organization.slug,
    },
    membership: {
      id: membership._id.toString(),
      roleName: role.name,
      permissions: role.permissions,
      allBranches: membership.allBranches,
      branchIds: membership.branchIds.map((id) => id.toString()),
    },
  };
}

export interface RegisterInput {
  name: string;
  email: string;
  password: string;
  phone?: string;
  businessName: string;
  businessType?: string;
  city?: string;
  branchName?: string;
}

/**
 * Sign up: create the person, the business, and everything the business needs.
 *
 * This is the one place where a user and an organization are created together.
 * All of it runs in a transaction where MongoDB supports one, because a business
 * that exists without its owner's membership is unusable and invisible - nobody
 * can log in to fix it.
 */
export async function register(input: RegisterInput, meta: SessionMeta): Promise<AuthResult> {
  const email = input.email.toLowerCase().trim();

  const existing = await User.findOne({ email }).lean();
  if (existing) {
    throw AppError.duplicate('An account with this email already exists. Try signing in instead');
  }

  const passwordHash = await bcrypt.hash(input.password, BCRYPT_COST);
  const slug = await generateUniqueSlug(input.businessName);

  const organizationId = await withTransaction(async (session) => {
    const opts = sessionOption(session);

    const [user] = await User.create(
      [
        {
          name: input.name.trim(),
          email,
          phone: input.phone,
          passwordHash,
          authProviders: [AUTH_PROVIDERS.PASSWORD],
          isActive: true,
        },
      ],
      opts,
    );
    if (!user) throw AppError.internal('Could not create the account');

    const [organization] = await Organization.create(
      [
        {
          name: input.businessName.trim(),
          slug,
          businessType: input.businessType,
          city: input.city,
          phone: input.phone,
          email,
          createdBy: user._id,
        },
      ],
      opts,
    );
    if (!organization) throw AppError.internal('Could not create the business');

    await bootstrapOrganization(
      organization._id,
      user._id,
      { branchName: input.branchName, city: input.city },
      session,
    );

    return organization._id;
  });

  const user = await User.findOne({ email }).lean();
  if (!user) throw AppError.internal('Could not complete sign up');

  return issueSession(user._id, organizationId, meta);
}

export interface LoginInput {
  email: string;
  password: string;
  organizationId?: string;
}

export async function login(input: LoginInput, meta: SessionMeta): Promise<AuthResult> {
  const email = input.email.toLowerCase().trim();

  // The hash is `select: false` on the schema, so it must be asked for.
  const user = await User.findOne({ email }).select('+passwordHash').lean();

  /**
   * The same message and the same work whether the email is unknown or the
   * password is wrong. Two different replies would let anyone test which emails
   * have accounts, and differing response times would leak the same thing.
   */
  const invalid = new AppError(
    401,
    ERROR_CODES.INVALID_CREDENTIALS,
    'Email or password is incorrect',
  );

  if (!user || !user.passwordHash) {
    await bcrypt.compare(input.password, '$2a$12$invalidsaltinvalidsaltinvalidsaltinvalidsaltuO');
    throw invalid;
  }

  const matches = await bcrypt.compare(input.password, user.passwordHash);
  if (!matches) throw invalid;
  if (!user.isActive) throw AppError.forbidden('This account has been deactivated');

  const organizationId = await resolveOrganizationForUser(user._id, input.organizationId);
  return issueSession(user._id, organizationId, meta);
}

/**
 * Which business is this login for?
 *
 * Most people belong to exactly one. When someone belongs to several - an
 * accountant, or a family running three shops - the client names one, and the
 * choice is still verified against their memberships rather than trusted.
 */
async function resolveOrganizationForUser(
  userId: Types.ObjectId,
  requestedOrganizationId?: string,
): Promise<Types.ObjectId> {
  // Listing a person's businesses is legitimately cross-tenant, so it opts out
  // of the tenant guard explicitly rather than by omission.
  const memberships = await Membership.find({
    userId,
    status: MEMBERSHIP_STATUSES.ACTIVE,
  })
    .setOptions({ allowCrossTenant: true })
    .lean();

  if (memberships.length === 0) {
    throw AppError.forbidden('This account is not linked to any business yet');
  }

  if (requestedOrganizationId) {
    if (!Types.ObjectId.isValid(requestedOrganizationId)) {
      throw AppError.badRequest('Invalid business selected');
    }
    const requested = new Types.ObjectId(requestedOrganizationId);
    const match = memberships.find((membership) =>
      membership.organizationId.equals(requested),
    );
    if (!match) throw AppError.forbidden('You do not have access to that business');
    return match.organizationId;
  }

  const first = memberships[0];
  if (!first) throw AppError.forbidden('This account is not linked to any business yet');
  return first.organizationId;
}

export interface GoogleLoginInput {
  /** The ID token issued by Google Identity Services in the browser. */
  credential: string;
  organizationId?: string;
  /** Supplied when a first-time Google user is also creating their business. */
  businessName?: string;
  businessType?: string;
  city?: string;
}

/**
 * Sign in with Google.
 *
 * WHY verify the token server-side: the browser could send anything. Google's
 * library checks the signature against Google's public keys and confirms the
 * token was issued for *our* client id - without that second check, a token
 * minted for some other application would be accepted here.
 *
 * The account is matched on Google's stable subject id, falling back to email
 * for people who first signed up with a password and later click "Continue with
 * Google". Matching on email alone would be unsafe if the email were not
 * verified, so `email_verified` is required.
 */
export async function loginWithGoogle(
  input: GoogleLoginInput,
  meta: SessionMeta,
): Promise<AuthResult> {
  if (!googleClient || !env.GOOGLE_CLIENT_ID) {
    throw AppError.badRequest('Google sign-in is not configured on this server');
  }

  let payload;
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: input.credential,
      audience: env.GOOGLE_CLIENT_ID,
    });
    payload = ticket.getPayload();
  } catch (error) {
    logger.warn({ err: error }, 'Google ID token verification failed');
    throw AppError.unauthenticated('Google sign-in failed. Please try again');
  }

  if (!payload?.email || !payload.sub) {
    throw AppError.unauthenticated('Google did not return an email address');
  }
  if (!payload.email_verified) {
    throw AppError.unauthenticated('This Google account does not have a verified email');
  }

  const email = payload.email.toLowerCase();
  let user = await User.findOne({ $or: [{ googleId: payload.sub }, { email }] }).lean();

  if (user) {
    if (!user.isActive) throw AppError.forbidden('This account has been deactivated');
    // Link the Google identity on first use, and trust Google's verification of
    // the address rather than sending our own confirmation email.
    await User.updateOne(
      { _id: user._id },
      {
        $set: {
          googleId: payload.sub,
          emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
          ...(user.avatarUrl ? {} : { avatarUrl: payload.picture }),
        },
        $addToSet: { authProviders: AUTH_PROVIDERS.GOOGLE },
      },
    );
  } else {
    const [created] = await User.create([
      {
        name: payload.name ?? email.split('@')[0],
        email,
        googleId: payload.sub,
        avatarUrl: payload.picture,
        authProviders: [AUTH_PROVIDERS.GOOGLE],
        emailVerifiedAt: new Date(),
        isActive: true,
      },
    ]);
    if (!created) throw AppError.internal('Could not create the account');
    user = created.toObject();
  }

  const memberships = await Membership.find({
    userId: user._id,
    status: MEMBERSHIP_STATUSES.ACTIVE,
  })
    .setOptions({ allowCrossTenant: true })
    .lean();

  // A brand-new Google user has no business yet. If they named one, create it
  // now; otherwise tell the client to ask for it.
  if (memberships.length === 0) {
    if (!input.businessName?.trim()) {
      throw new AppError(
        409,
        ERROR_CODES.CONFLICT,
        'No business is linked to this Google account yet. Enter your business name to create one',
      );
    }

    const slug = await generateUniqueSlug(input.businessName);
    const userId = user._id;

    const organizationId = await withTransaction(async (session) => {
      const [organization] = await Organization.create(
        [
          {
            name: input.businessName!.trim(),
            slug,
            businessType: input.businessType,
            city: input.city,
            email,
            createdBy: userId,
          },
        ],
        sessionOption(session),
      );
      if (!organization) throw AppError.internal('Could not create the business');

      await bootstrapOrganization(organization._id, userId, { city: input.city }, session);
      return organization._id;
    });

    return issueSession(userId, organizationId, meta);
  }

  const organizationId = await resolveOrganizationForUser(user._id, input.organizationId);
  return issueSession(user._id, organizationId, meta);
}

/**
 * Exchange a refresh token for a new pair, and rotate it.
 *
 * REUSE DETECTION: each refresh token may be used exactly once. Presenting one
 * that has already been rotated means two parties hold it - the legitimate user
 * and somebody who copied it. There is no way to tell which one is asking, so
 * the entire session family is revoked and both must log in again. Annoying once;
 * far better than silently serving an attacker for a month.
 */
export async function refresh(refreshToken: string, meta: SessionMeta): Promise<AuthResult> {
  const tokenHash = hashRefreshToken(refreshToken);
  const session = await Session.findOne({ refreshTokenHash: tokenHash });

  if (!session) throw AppError.unauthenticated('Please sign in again');

  if (session.revokedAt) {
    await Session.updateMany(
      { familyId: session.familyId, revokedAt: { $exists: false } },
      { $set: { revokedAt: new Date(), revokedReason: 'Refresh token reuse detected' } },
    );
    logger.warn(
      { userId: session.userId.toString(), familyId: session.familyId.toString() },
      'Refresh token reuse detected, session family revoked',
    );
    throw AppError.unauthenticated('Your session has ended. Please sign in again');
  }

  if (session.expiresAt.getTime() < Date.now()) {
    throw AppError.unauthenticated('Your session has expired. Please sign in again');
  }
  if (!session.organizationId) {
    throw AppError.unauthenticated('Please sign in again');
  }

  const organizationId = session.organizationId;
  const userId = session.userId;

  const newToken = generateRefreshToken();
  const familyId = session.familyId;

  // Mark the presented token used before issuing the next one, so a replay of it
  // is detectable even if the following write fails.
  session.revokedAt = new Date();
  session.revokedReason = 'Rotated';
  await session.save();

  const [rotated] = await Session.create([
    {
      userId,
      organizationId,
      refreshTokenHash: hashRefreshToken(newToken),
      familyId,
      expiresAt: refreshTokenExpiry(),
      userAgent: meta.userAgent,
      ipAddress: meta.ipAddress,
      lastUsedAt: new Date(),
    },
  ]);
  if (!rotated) throw AppError.internal('Could not refresh the session');

  const [user, organization, membership] = await Promise.all([
    User.findById(userId).lean(),
    Organization.findById(organizationId).lean(),
    Membership.findOne({ organizationId, userId }).lean(),
  ]);

  if (!user?.isActive || !organization?.isActive || !membership) {
    throw AppError.unauthenticated('Please sign in again');
  }
  if (membership.status !== MEMBERSHIP_STATUSES.ACTIVE) {
    throw AppError.forbidden('Your access to this business has been suspended');
  }

  const role = await Role.findOne({ organizationId, _id: membership.roleId }).lean();
  if (!role) throw AppError.forbidden('Your role no longer exists');

  const accessToken = signAccessToken({
    sub: userId.toString(),
    org: organizationId.toString(),
    mid: membership._id.toString(),
    sid: rotated._id.toString(),
  });

  return {
    accessToken,
    refreshToken: newToken,
    user: {
      id: user._id.toString(),
      name: user.name,
      email: user.email,
      ...(user.avatarUrl ? { avatarUrl: user.avatarUrl } : {}),
    },
    organization: {
      id: organization._id.toString(),
      name: organization.name,
      slug: organization.slug,
    },
    membership: {
      id: membership._id.toString(),
      roleName: role.name,
      permissions: role.permissions,
      allBranches: membership.allBranches,
      branchIds: membership.branchIds.map((id) => id.toString()),
    },
  };
}

/** Sign out this device. Other devices keep their sessions. */
export async function logout(refreshToken: string | undefined): Promise<void> {
  if (!refreshToken) return;
  await Session.updateOne(
    { refreshTokenHash: hashRefreshToken(refreshToken) },
    { $set: { revokedAt: new Date(), revokedReason: 'Signed out' } },
  );
}

/** Businesses this person can switch between. */
export async function listUserOrganizations(userId: Types.ObjectId) {
  const memberships = await Membership.find({ userId, status: MEMBERSHIP_STATUSES.ACTIVE })
    .setOptions({ allowCrossTenant: true })
    .lean();

  const organizationIds = memberships.map((membership) => membership.organizationId);
  const organizations = await Organization.find({
    _id: { $in: organizationIds },
    isActive: true,
  }).lean();

  return organizations.map((organization) => ({
    id: organization._id.toString(),
    name: organization.name,
    slug: organization.slug,
    businessType: organization.businessType,
    city: organization.city,
  }));
}

/** Move an existing login to another business the person belongs to. */
export async function switchOrganization(
  userId: Types.ObjectId,
  organizationId: string,
  meta: SessionMeta,
): Promise<AuthResult> {
  const target = await resolveOrganizationForUser(userId, organizationId);
  return issueSession(userId, target, meta);
}

/** What the client needs to know about sign-in options before showing the form. */
export function authCapabilities() {
  return {
    googleLogin: features.googleLogin,
    googleClientId: features.googleLogin ? env.GOOGLE_CLIENT_ID : undefined,
  };
}
