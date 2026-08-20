import type { Request, Response } from 'express';
import { sendCreated, sendSuccess } from '../../core/http';
import { body } from '../../middleware/validate';
import { requireContext } from '../../middleware/authenticate';
import {
  REFRESH_COOKIE_NAME,
  clearRefreshCookie,
  setRefreshCookie,
} from '../../services/tokenService';
import { AppError } from '../../core/AppError';
import * as authService from './auth.service';
import type {
  GoogleLoginBody,
  LoginBody,
  RegisterBody,
  SwitchOrganizationBody,
} from './auth.schemas';

/**
 * Controllers stay thin: read validated input, call a service, send a response.
 *
 * The one piece of real logic here is where the two tokens go. The access token
 * is returned in the body for the client to hold in memory; the refresh token
 * goes into an httpOnly cookie and is never visible to the response body or to
 * JavaScript.
 */

function sessionMeta(req: Request): authService.SessionMeta {
  return {
    ipAddress: req.ip,
    userAgent: req.get('user-agent'),
  };
}

/** Strip the refresh token before the result is serialised to the client. */
function respondWithSession(
  res: Response,
  result: authService.AuthResult,
  statusCode: 200 | 201,
  message: string,
): void {
  const { refreshToken, ...safe } = result;
  setRefreshCookie(res, refreshToken);
  if (statusCode === 201) sendCreated(res, safe, message);
  else sendSuccess(res, safe, message);
}

export async function register(req: Request, res: Response): Promise<void> {
  const input = body<RegisterBody>(req);
  const result = await authService.register(input, sessionMeta(req));
  respondWithSession(res, result, 201, 'Your business account is ready');
}

export async function login(req: Request, res: Response): Promise<void> {
  const input = body<LoginBody>(req);
  const result = await authService.login(input, sessionMeta(req));
  respondWithSession(res, result, 200, 'Signed in');
}

export async function googleLogin(req: Request, res: Response): Promise<void> {
  const input = body<GoogleLoginBody>(req);
  const result = await authService.loginWithGoogle(input, sessionMeta(req));
  respondWithSession(res, result, 200, 'Signed in with Google');
}

export async function refresh(req: Request, res: Response): Promise<void> {
  const token = req.cookies?.[REFRESH_COOKIE_NAME] as string | undefined;
  if (!token) throw AppError.unauthenticated('Please sign in again');

  const result = await authService.refresh(token, sessionMeta(req));
  respondWithSession(res, result, 200, 'Session refreshed');
}

export async function logout(req: Request, res: Response): Promise<void> {
  const token = req.cookies?.[REFRESH_COOKIE_NAME] as string | undefined;
  await authService.logout(token);
  clearRefreshCookie(res);
  sendSuccess(res, { signedOut: true }, 'Signed out');
}

/** Everything the client needs to render the app for the signed-in user. */
export async function me(req: Request, res: Response): Promise<void> {
  const ctx = requireContext(req);
  sendSuccess(res, {
    user: { id: ctx.userId.toString(), name: ctx.userName },
    organization: { id: ctx.organizationId.toString() },
    membership: {
      id: ctx.membershipId.toString(),
      roleName: ctx.roleName,
      permissions: [...ctx.permissions],
      allBranches: ctx.allBranches,
      branchIds: ctx.branchIds.map((id) => id.toString()),
    },
  });
}

export async function myOrganizations(req: Request, res: Response): Promise<void> {
  const ctx = requireContext(req);
  const organizations = await authService.listUserOrganizations(ctx.userId);
  sendSuccess(res, organizations);
}

export async function switchOrganization(req: Request, res: Response): Promise<void> {
  const ctx = requireContext(req);
  const input = body<SwitchOrganizationBody>(req);
  const result = await authService.switchOrganization(
    ctx.userId,
    input.organizationId,
    sessionMeta(req),
  );
  respondWithSession(res, result, 200, 'Switched business');
}

/** Which sign-in methods this deployment supports. Read before showing the form. */
export function capabilities(_req: Request, res: Response): void {
  sendSuccess(res, authService.authCapabilities());
}
