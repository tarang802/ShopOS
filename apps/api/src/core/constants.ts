/** Values that describe the running service itself. */
export const API_VERSION = 'v1';
export const API_PREFIX = `/api/${API_VERSION}`;
export const APP_NAME = 'ShopOS API';
export const APP_VERSION = '0.1.0';

/** Request body ceiling. Generous for a document with many lines, small enough
 *  that a hostile client cannot exhaust memory with one upload. */
export const JSON_BODY_LIMIT = '1mb';
