import { create } from 'zustand';
import type { Permission } from '@shopos/shared';

/**
 * The signed-in session, held in memory.
 *
 * WHY the access token is NOT in localStorage: anything in localStorage can be
 * read by any script that manages to run on the page, so one cross-site
 * scripting bug would become a permanent account takeover. Held in a plain
 * variable it dies with the tab, and the httpOnly refresh cookie - which
 * JavaScript cannot read at all - silently restores the session on reload.
 *
 * That is the whole reason `bootstrap()` exists: on a fresh page load there is
 * no token, so the app asks the server to mint one from the cookie before
 * deciding whether to show the login screen.
 */

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string;
}

export interface SessionOrganization {
  id: string;
  name: string;
  slug: string;
}

export interface SessionMembership {
  id: string;
  roleName: string;
  permissions: Permission[];
  allBranches: boolean;
  branchIds: string[];
}

export interface Session {
  accessToken: string;
  user: SessionUser;
  organization: SessionOrganization;
  membership: SessionMembership;
}

interface AuthState {
  session: Session | null;
  /** True until the first refresh attempt settles, so the app can hold its render. */
  isBootstrapping: boolean;
  setSession: (session: Session) => void;
  clearSession: () => void;
  setBootstrapped: () => void;
  /** Branch currently being viewed. Empty means every branch this person can see. */
  activeBranchId: string | null;
  setActiveBranch: (branchId: string | null) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  session: null,
  isBootstrapping: true,
  activeBranchId: null,
  setSession: (session) => set({ session, isBootstrapping: false }),
  clearSession: () => set({ session: null, isBootstrapping: false, activeBranchId: null }),
  setBootstrapped: () => set({ isBootstrapping: false }),
  setActiveBranch: (activeBranchId) => set({ activeBranchId }),
}));

/** Read the token outside React, for the API client. */
export function getAccessToken(): string | null {
  return useAuthStore.getState().session?.accessToken ?? null;
}

/**
 * Whether the signed-in user holds a permission.
 *
 * This decides what to render, nothing more. The server checks the same
 * permission again on every request, and that check is the one that protects
 * data - this one only avoids showing a button that would fail.
 */
export function useHasPermission(permission: Permission): boolean {
  return useAuthStore((state) => state.session?.membership.permissions.includes(permission) ?? false);
}

export function useHasAnyPermission(...permissions: Permission[]): boolean {
  return useAuthStore((state) => {
    const held = state.session?.membership.permissions;
    if (!held) return false;
    return permissions.some((permission) => held.includes(permission));
  });
}
