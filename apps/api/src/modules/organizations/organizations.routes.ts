import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { AUDIT_ACTIONS, PERMISSIONS } from '@shopos/shared';
import { Organization } from '../../db/models';
import { validate, body } from '../../middleware/validate';
import { authenticate, requireContext } from '../../middleware/authenticate';
import { requirePermission } from '../../middleware/requirePermission';
import { sendSuccess } from '../../core/http';
import { AppError } from '../../core/AppError';
import { diffFields, recordAudit } from '../../services/auditService';

/**
 * The business profile and its operating settings.
 *
 * `allowNegativeStock` is the setting that matters most. Many Indian shops
 * genuinely do sell goods that are physically on the shelf but not yet entered
 * in the system, and blocking that sale is worse for them than a temporarily
 * negative figure. It stays off by default, and turning it on is a deliberate
 * choice the owner makes with the consequence spelled out.
 */

const organizationUpdateSchema = z.object({
  name: z.string().trim().min(2).max(160).optional(),
  businessType: z.string().trim().max(60).optional(),
  gstin: z.string().trim().max(20).optional(),
  phone: z.string().trim().max(20).optional(),
  email: z.string().trim().email().max(160).optional(),
  addressLine: z.string().trim().max(240).optional(),
  city: z.string().trim().max(80).optional(),
  state: z.string().trim().max(80).optional(),
  pincode: z.string().trim().max(10).optional(),
  settings: z
    .object({
      allowNegativeStock: z.boolean().optional(),
      lowStockThreshold: z.number().int().min(0).max(100000).optional(),
    })
    .optional(),
});

export const organizationsRouter = Router();

organizationsRouter.use(authenticate);

/** The current business. There is no route to fetch a business by id: the only
 *  business a request can read is the one its session is scoped to. */
organizationsRouter.get('/current', async (req: Request, res: Response) => {
  const ctx = requireContext(req);
  const organization = await Organization.findById(ctx.organizationId).lean();
  if (!organization) throw AppError.notFound('Business');
  sendSuccess(res, organization);
});

organizationsRouter.patch(
  '/current',
  requirePermission(PERMISSIONS.ORGANIZATION_MANAGE),
  validate({ body: organizationUpdateSchema }),
  async (req: Request, res: Response) => {
    const ctx = requireContext(req);
    const input = body<z.infer<typeof organizationUpdateSchema>>(req);

    const organization = await Organization.findById(ctx.organizationId);
    if (!organization) throw AppError.notFound('Business');

    const before = organization.toObject();
    const { settings, ...profile } = input;

    Object.assign(organization, profile);
    if (settings) {
      // Merged rather than replaced, so a partial settings update cannot wipe
      // the fields it did not mention.
      Object.assign(organization.settings, settings);
    }
    await organization.save();

    const changes = diffFields(before, {
      ...profile,
      ...(settings ? { settings: organization.settings } : {}),
    });
    if (changes) {
      await recordAudit(ctx, {
        action: AUDIT_ACTIONS.ORGANIZATION_UPDATED,
        entityType: 'Organization',
        entityId: organization._id,
        entityLabel: organization.name,
        ...changes,
      });
    }

    sendSuccess(res, organization.toObject(), 'Business details updated');
  },
);
