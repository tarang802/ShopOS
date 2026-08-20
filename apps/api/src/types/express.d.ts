import type { TenantContext } from '../core/tenantContext';

/**
 * Express request augmentation.
 *
 * Express 5 exposes req.query as a read-only getter, so validated input cannot
 * be written back over the raw input. Instead every validated payload is placed
 * on req.validated, which also makes it obvious in a controller whether it is
 * reading raw or checked data.
 */
declare global {
  namespace Express {
    interface Request {
      /** Correlation id, echoed to the client as the X-Request-Id header. */
      id: string;
      /** Populated by the validate() middleware. Never present without it. */
      validated?: {
        body?: unknown;
        query?: unknown;
        params?: unknown;
      };
      /**
       * Who is asking and what they may do. Set by authenticate(), derived from
       * the session - never from the request body.
       */
      ctx?: TenantContext;
    }
  }
}

export {};
