# Keys and Secrets

Everything ShopOS needs from the outside world, where to get it, and what breaks
without it.

All of it goes in `apps/api/.env` (copy from `apps/api/.env.example`), except the
one browser value noted at the end, which goes in `apps/web/.env`.

**`.env` is gitignored. Never commit it.**

---

## Required

### 1. MongoDB connection string

```
MONGODB_URI=mongodb://127.0.0.1:27017/shopos?replicaSet=rs0
```

**Where from:** your own MongoDB, or a free MongoDB Atlas cluster
(<https://cloud.mongodb.com>). On Atlas: *Database → Connect → Drivers*, then
replace `<password>` and add `/shopos` before the `?`.

**Why a replica set matters:** stock transfers and stock corrections write
several documents that must all succeed or all fail together. MongoDB only
allows that on a replica set or a sharded cluster. Atlas is already a replica
set. For a local server, see `deployment.md` - a single node still counts.

Without a replica set ShopOS runs, but a transfer interrupted half-way could
leave stock missing from one branch without arriving at the other. The API logs
a warning at startup and **Administration → System Status** shows it.

### 2. Token signing secrets

```
JWT_ACCESS_SECRET=<64 random bytes as hex>
JWT_REFRESH_SECRET=<a different 64 random bytes>
```

**Where from:** generate them yourself. They are not accounts, just long random
strings:

```bash
openssl rand -hex 64
```

Run it twice - the two values must differ.

**What they do:** sign the tokens that prove who is signed in. Anyone who learns
these can mint a valid login for any user in the system, so they belong in
`.env` and nowhere else.

In development the placeholder values in `.env.example` work fine. **Production
boot fails on purpose** if either is still a placeholder or shorter than 32
characters.

---

## Optional

Each of these is genuinely optional. ShopOS starts without them and simply hides
the feature.

### 3. Google Sign-In

```
GOOGLE_CLIENT_ID=1234567890-abcdef.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-...
```

**Where from:** <https://console.cloud.google.com/apis/credentials>

1. Create a project (or pick an existing one).
2. **Create Credentials → OAuth client ID → Web application**.
3. Under **Authorised JavaScript origins**, add the address you open ShopOS at:
   - `http://localhost:5173` for development
   - your real site address for production
4. Copy the **Client ID** and **Client secret**.

You will also be asked to configure the OAuth consent screen once. For internal
use, "External" with your own account as a test user is enough.

**Without it:** the login page shows no Google button and email + password
sign-in works normally.

**Note:** ShopOS uses Google Identity Services, which verifies an ID token
server-side. The client secret is stored for future flows that need it; the
current sign-in path only requires the client id.

### 4. Cloudinary, for product images

```
CLOUDINARY_CLOUD_NAME=your-cloud-name
CLOUDINARY_API_KEY=123456789012345
CLOUDINARY_API_SECRET=abcdefgh...
```

**Where from:** <https://console.cloudinary.com> → Dashboard. All three values
are on the front page. The free tier is generous enough for a product catalogue.

**What it does:** the browser uploads an image straight to Cloudinary using a
signature this API produces, and only the resulting URL is stored in MongoDB.
Image files never pass through the API and never go into the database.

**Without it:** the image upload endpoint returns a clear "not configured"
message. Everything else - products, rates, stock - works.

---

## Browser-side value

One value belongs to the web app rather than the API. Create `apps/web/.env`:

```
VITE_GOOGLE_CLIENT_ID=<the same client id as above>
VITE_API_BASE_URL=
```

`VITE_API_BASE_URL` stays empty in development - requests go through the Vite
proxy to port 4000. Set it only when the built site is served from a different
address than the API.

**Anything starting with `VITE_` is compiled into the JavaScript sent to the
browser, so it is public.** A Google client id is designed to be public. Never
put a secret, an API secret or a database URI behind a `VITE_` name.

---

## Summary

| Variable | Required | Breaks without it |
|---|---|---|
| `MONGODB_URI` | Yes | Nothing starts |
| `JWT_ACCESS_SECRET` | Production | Boot fails in production |
| `JWT_REFRESH_SECRET` | Production | Boot fails in production |
| `GOOGLE_CLIENT_ID` | No | Google button hidden |
| `GOOGLE_CLIENT_SECRET` | No | Nothing today |
| `CLOUDINARY_*` | No | Image upload disabled |
| `VITE_GOOGLE_CLIENT_ID` | No | Google button hidden |
| `CORS_ORIGINS` | Production | Browser calls refused |
| `COOKIE_DOMAIN` | Only across domains | Sign-in fails across domains |
| `JOBS_ENABLED` | No | Overdue reminders stop when false (default true) |
| `TEST_MONGODB_URI` | Tests only | Tests use the local replica set on port 27018 |

## Rotating a secret

Changing `JWT_ACCESS_SECRET` or `JWT_REFRESH_SECRET` invalidates every signed-in
session at once - everyone signs in again. That is the correct response to a
suspected leak. Nothing else is lost.
