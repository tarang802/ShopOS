import { Schema, model } from 'mongoose';

/**
 * A record that one data migration has run.
 *
 * Deliberately not tenant-guarded: migrations are platform-wide, run once, and
 * keyed by their own id rather than by an organization.
 */

export interface IMigration {
  _id: string;
  description: string;
  appliedAt: Date;
}

const migrationSchema = new Schema<IMigration>(
  {
    _id: { type: String, required: true },
    description: { type: String, required: true, maxlength: 240 },
    appliedAt: { type: Date, required: true, default: () => new Date() },
  },
  { versionKey: false },
);

export const Migration = model<IMigration>('Migration', migrationSchema);
