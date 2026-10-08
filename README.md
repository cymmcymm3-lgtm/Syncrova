# Syncrova

Syncrova has a Vite/React web client in `frontend/`, an Express + Socket.IO API in
`backend/`, and a separate Expo mobile client in `mobile/`.

## Local development

1. Copy `backend/.env.example` to `backend/.env` and fill in the real secrets locally.
2. Keep both `MONGODB_URI` and `MONGODB_DB_NAME` pointed to `IntegrativeProgramming`.
   That is the existing Atlas database used by the application.
3. Start the API, then the web client:

   ```powershell
   cd backend
   npm ci
   npm run dev

   cd ../frontend
   npm ci
   npm run dev
   ```

The Vite development server proxies `/api` and Socket.IO to `http://localhost:5000`.

## Recover an existing account

From a trusted owner machine with `backend/.env` configured, check the account and
then issue a private, single-use password reset link:

```powershell
cd backend
npm run account:recover -- --email person@example.com --dry-run
npm run account:recover -- --email person@example.com
```

Open the printed link while the local frontend and backend are running. It expires
after 20 minutes; rerun the command to replace an expired link. For the deployed
app, add `--frontend-url https://your-app.vercel.app` and ensure it uses the same
database. Recovery keeps the account's developer/admin role and existing password
unchanged until a new password is submitted. Passwords remain securely hashed;
the old password cannot be retrieved. Do not share or commit a reset link.

## Deploy to Render and Vercel

The web architecture is deliberately direct: Vercel serves the static React app and
the browser connects directly to Render for API, media, and Socket.IO. This preserves
realtime WebSocket support without relying on a Vercel proxy.

1. Create or reactivate the Render Web Service from this repository using
   `render.yaml`. The old Render service must be manually unsuspended in the Render
   dashboard; code changes cannot reactivate a suspended service.
2. In Render, set every `sync: false` variable from your local `backend/.env`.
   At minimum set `MONGODB_URI`, `JWT_SECRET`, `CLIENT_ORIGINS`, and `FRONTEND_URL`.
   The Atlas URI must include `/IntegrativeProgramming`, and
   `MONGODB_DB_NAME` is also pinned to that database in `render.yaml`.
3. Ensure MongoDB Atlas Network Access permits the Render service to connect. Keep
   database credentials and `.env` files out of Git.
   Before the first production deployment, apply the safe performance indexes from
   a machine with the same `backend/.env`:

   ```powershell
   cd backend
   npm run db:indexes
   ```

   This only creates missing indexes; it never drops existing indexes or application
   data. It has already been run for the current `IntegrativeProgramming` database.
4. Create a Vercel project with **Root Directory** `frontend`, framework **Vite**,
   build command `npm run build`, and output directory `dist`.
5. In Vercel, add `VITE_BACKEND_URL` with the public Render origin, for example
   `https://your-render-service.onrender.com` (no trailing `/api`), then deploy.
6. Put the final Vercel production origin in Render as both `CLIENT_ORIGINS` and
   `FRONTEND_URL`, for example `https://your-project.vercel.app`, then redeploy
   Render. Set `BACKEND_PUBLIC_URL` to the Render origin if OAuth is enabled.
7. Copy optional secrets for the features you use: R2 storage, LiveKit/TURN calls,
   VAPID push, and admin provisioning. They are listed in `render.yaml` but never
   stored in this repository.

Verify the API after deployment:

```text
https://your-render-service.onrender.com/api/ready
https://your-render-service.onrender.com/api/ping
```

`/api/ready` returns HTTP 200 only after MongoDB is connected, so it is also the
Render health check.

## Before committing

Run the web production build from `frontend/`:

```powershell
npm run build
```

The Android release metadata step is intentionally separate from web builds. Run
`npm run version:sync` or one of the Android release scripts before building an APK.
For the separate Expo mobile project, configure `mobile/.env` from
`mobile/.env.example` before making a build.
Review the current Git diff before staging: this working tree may contain unrelated
local UI edits.
