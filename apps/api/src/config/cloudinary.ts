import { v2 as cloudinary } from 'cloudinary';
import { env, features } from './env';
import { AppError } from '../core/AppError';


if (features.imageUpload) {
  cloudinary.config({
    cloud_name: env.CLOUDINARY_CLOUD_NAME,
    api_key: env.CLOUDINARY_API_KEY,
    api_secret: env.CLOUDINARY_API_SECRET,
    secure: true,
  });
}

export interface UploadSignature {
  cloudName: string;
  apiKey: string;
  timestamp: number;
  signature: string;
  folder: string;
}

/**
 * Sign a single upload.
 *
 * The folder is fixed to the caller's organization and is part of what gets
 * signed, so a signature issued to one business cannot be used to write into
 * another business's folder.
 */
export function buildUploadSignature(organizationId: string): UploadSignature {
  if (!features.imageUpload || !env.CLOUDINARY_API_SECRET) {
    throw AppError.businessRule(
      'Image upload is not configured on this server. Add your Cloudinary keys to enable it',
    );
  }

  const timestamp = Math.round(Date.now() / 1000);
  const folder = `shopos/${organizationId}/products`;

  const signature = cloudinary.utils.api_sign_request(
    { timestamp, folder },
    env.CLOUDINARY_API_SECRET,
  );

  return {
    cloudName: env.CLOUDINARY_CLOUD_NAME!,
    apiKey: env.CLOUDINARY_API_KEY!,
    timestamp,
    signature,
    folder,
  };
}

/** Remove an image that is no longer attached to any product. */
export async function deleteImage(publicId: string): Promise<void> {
  if (!features.imageUpload) return;
  await cloudinary.uploader.destroy(publicId);
}
