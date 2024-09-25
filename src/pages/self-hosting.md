# Self-hosting

The code is open-source, so you can self-host it if you want to (e.g. to run on a private network, or to use it without sponsoring me, or to use a different blob storage provider, or to add extra features etc.). Here's how:

- Clone the repository
- Deploy to Vercel - which will automatically detect how to build and deploy the server. You should also be able to use any other platform that supports Next.js.
- You'll need to set the `ALLOWED_GITHUB_OWNERS` environment variable to a comma-separated list of GitHub organizations that are allowed to upload artifacts.
- Blob storage setup:
   - This project uses `@vercel/blob`, but in theory you may be able to use a service that wraps another blob storage provider like AWS, Azure or Cloudflare's offerings, to make them usable with the `@vercel/blob` SDK.
   - Set the `STORAGE_ORIGIN` environment variable to the URL of the storage service you're using.
   - Set the `BLOB_READ_WRITE_TOKEN` environment variable to a token that has read/write access to the storage service.
- Database setup:
   - This project uses `supabase` for the database, but you should be able to use any other PostgreSQL database.
   - Create a database and user, and set the `PGKIT_CONNECTION_STRING` environment variable in your server deployment to the connection string for the database.
   - The client uses [pgkit.dev](https://pgkit.dev):
      - Migrations: run `pnpm pgkit migrate.definitions.updateDb` to create/update/delete tables, views, functions, indexes etc. based on the `definitions.sql` file.
      - Types: if you change the source code, you can run `pnpm pgkit generate` to add TypeScript types to all DB queries.
- Auth setup:
   - Add an environment variable `AUTH_SECRET` to your server deployment.
   - Create a GitHub OAuth app
   - Set the callback URL to `https://<your-domain>/api/auth/callback/github`
   - Set the `AUTH_GITHUB_ID` and `AUTH_GITHUB_SECRET` environment variables to the values from the GitHub OAuth app.
- Local development:
   - Run `pnpm dev` to start the development server.
   - Use ngrok or similar to receive webhooks from the storage provider - otherwise `upload` records will not be written to your DB.
   - Note that simulating a GitHub Actions workflow is tricky. The API checks that the workflow is in "running" status before minting artifact upload tokens.
