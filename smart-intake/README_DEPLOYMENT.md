# Deployment — Moore Divine Care Smart Intake

The app runs locally on SQLite with zero external services. For a public link
you deploy it to Vercel or Render and point it at Supabase/PostgreSQL.

## 1. Switch the database to Supabase/PostgreSQL

1. Create a project at https://supabase.com (free tier works for testing).
2. In `prisma/schema.prisma` change the datasource provider:
   ```prisma
   datasource db {
     provider = "postgresql"
     url      = env("DATABASE_URL")
   }
   ```
3. Set `DATABASE_URL` to the Supabase **connection pooler** string
   (Settings → Database → Connection string → URI, port 6543, add `?pgbouncer=true`).
4. Run once from your machine: `npx prisma db push && npm run seed`.

## 2A. Deploy to Vercel

1. Push this folder to a GitHub repo (or use the existing one).
2. vercel.com → Add New Project → import the repo → set **Root Directory** to
   `smart-intake` if the app lives in a subfolder.
3. Environment variables (Settings → Environment Variables):
   - `DATABASE_URL` (Supabase pooler URL)
   - `SESSION_SECRET` (long random string)
   - `APP_BASE_URL` (e.g. `https://your-app.vercel.app` — update after first deploy)
   - `CLIENT_LINK_EXPIRY_DAYS` = 7
   - optional `DOCUSIGN_*`, `SENDGRID_API_KEY`, `TWILIO_*`
4. Deploy. `vercel.json` is included (build uses `prisma generate`).
5. **Storage note:** Vercel's filesystem is ephemeral. Generated PDFs are
   re-created on demand from the database (safe), but **uploaded client
   documents** need Supabase Storage — swap the two functions in
   `src/lib/storage.ts` (see COWORKER_HANDOFF.md).

## 2B. Deploy to Render (simpler for file storage)

1. render.com → New → Web Service → connect the repo, root dir `smart-intake`.
2. Build command: `npm install && npx prisma db push`
   Start command: `npm run start` (add `npm run build` as a build step: `npm install && npm run build && npx prisma db push`).
3. Add a **Persistent Disk** mounted at `/opt/render/project/src/smart-intake/storage`
   so uploads and generated PDFs survive restarts.
4. Set the same environment variables as above.

## 3. Custom domain

- **Vercel:** Project → Settings → Domains → add `intake.mooredivinecare.com`,
  then create the CNAME record shown at your DNS provider.
- **Render:** Service → Settings → Custom Domains → add the domain and CNAME.
- Update `APP_BASE_URL` to the new domain so client links use it.

## 4. Creating a public client link

Once deployed: log in at `https://your-domain/login` → Create New Intake →
the app returns `https://your-domain/intake/<secure-token>` → copy it or press
"Send by email/SMS". Links expire after `CLIENT_LINK_EXPIRY_DAYS` (extend from
the intake page).

## 5. First login in production

Seed the production DB once (`npm run seed` with production `DATABASE_URL`),
then **change the admin password** by updating the User row (or add a user with
a new bcrypt hash). Never leave the demo password on a public deployment.
