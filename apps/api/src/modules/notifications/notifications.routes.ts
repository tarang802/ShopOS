import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { objectIdSchema, paginationQuerySchema } from '@shopos/shared';
import { validate, params, query } from '../../middleware/validate';
import { authenticate, requireContext } from '../../middleware/authenticate';
import { sendPaginated, sendSuccess } from '../../core/http';
import { toObjectId } from '../../core/tenantContext';
import {
  listNotifications,
  markAllRead,
  markRead,
  notificationSummary,
} from '../../services/notificationService';

/**
 * Notifications are for whoever is signed in, so no permission gates the routes
 * themselves. What a person sees is decided inside the service from the
 * permissions and branches they hold right now.
 */

const listQuerySchema = paginationQuerySchema.extend({
  unreadOnly: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
});

export const notificationsRouter = Router();
notificationsRouter.use(authenticate);

notificationsRouter.get(
  '/',
  validate({ query: listQuerySchema }),
  async (req: Request, res: Response) => {
    const listQuery = query<z.infer<typeof listQuerySchema>>(req);
    const result = await listNotifications(requireContext(req), listQuery, listQuery);
    sendPaginated(res, result.items, result);
  },
);

notificationsRouter.get('/summary', async (req: Request, res: Response) => {
  sendSuccess(res, await notificationSummary(requireContext(req)));
});

notificationsRouter.post('/read-all', async (req: Request, res: Response) => {
  const updated = await markAllRead(requireContext(req));
  sendSuccess(res, { updated }, 'All notifications marked as read');
});

notificationsRouter.post(
  '/:id/read',
  validate({ params: z.object({ id: objectIdSchema }) }),
  async (req: Request, res: Response) => {
    await markRead(requireContext(req), toObjectId(params<{ id: string }>(req).id, 'notification id'));
    sendSuccess(res, { read: true });
  },
);
