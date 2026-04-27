-- #region core tables
create table github_installations (
  id text primary key,
  github_id integer not null,
  removed_at text,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  unique(github_id)
);

create table repos (
  id text primary key,
  owner text not null,
  name text not null,
  installation_id text not null references github_installations(id),
  default_visibility text not null default 'private',
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  unique(owner, name)
);

create table sponsors (
  id text primary key,
  sponsor_login text not null,
  sponsoree_login text not null,
  github_type text not null,
  monthly_amount_usd numeric,
  expiry text not null,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  unique(sponsor_login, sponsoree_login)
);

create table usage_credits (
  id text primary key,
  github_login text not null,
  expiry text not null,
  sponsor_id text references sponsors(id),
  reason text not null,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  unique(github_login, reason, expiry)
);

create table artifacts (
  id text primary key,
  repo_id text not null references repos(id),
  name text not null,
  github_id integer not null,
  download_url text,
  installation_id text not null references github_installations(id),
  visibility text not null default 'private',
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  unique(repo_id, name, github_id)
);

create table artifact_identifiers (
  id text primary key,
  artifact_id text not null references artifacts(id),
  type text not null,
  value text not null,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  unique(artifact_id, type, value)
);

create table artifact_entries (
  id text primary key,
  artifact_id text not null references artifacts(id),
  entry_name text not null,
  aliases text not null,
  storage_pathname text not null,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  unique(artifact_id, entry_name)
);

create table upload_tokens (
  token_hash text primary key,
  github_login text not null,
  created_at integer not null,
  expires_at integer not null
);
-- #endregion core tables

-- #region auth tables
create table "user" (
  "id" text not null primary key,
  "name" text not null,
  "email" text not null unique,
  "emailVerified" integer not null,
  "image" text,
  "createdAt" text default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) not null,
  "updatedAt" text default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) not null,
  "role" text,
  "banned" integer,
  "banReason" text,
  "banExpires" text,
  "githubLogin" text
);

create table "session" (
  "id" text not null primary key,
  "expiresAt" text not null,
  "token" text not null unique,
  "createdAt" text default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) not null,
  "updatedAt" text not null,
  "ipAddress" text,
  "userAgent" text,
  "userId" text not null references "user" ("id") on delete cascade,
  "impersonatedBy" text
);

create table "account" (
  "id" text not null primary key,
  "accountId" text not null,
  "providerId" text not null,
  "userId" text not null references "user" ("id") on delete cascade,
  "accessToken" text,
  "refreshToken" text,
  "idToken" text,
  "accessTokenExpiresAt" text,
  "refreshTokenExpiresAt" text,
  "scope" text,
  "password" text,
  "createdAt" text default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) not null,
  "updatedAt" text not null
);

create table "verification" (
  "id" text not null primary key,
  "identifier" text not null,
  "value" text not null,
  "expiresAt" text not null,
  "createdAt" text default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) not null,
  "updatedAt" text default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) not null
);

create index "session_userId_idx" on "session" ("userId");
create index "account_userId_idx" on "account" ("userId");
create index "verification_identifier_idx" on "verification" ("identifier");
-- #endregion auth tables

-- #region indexes
create index idx_usage_credits_github_login on usage_credits(github_login);
create index idx_usage_credits_sponsor_id on usage_credits(sponsor_id);
create index idx_upload_tokens_expires_at on upload_tokens(expires_at);
create index idx_artifacts_repo_id on artifacts(repo_id);
create index idx_artifact_identifiers_artifact_id on artifact_identifiers(artifact_id);
create index idx_artifact_entries_artifact_id on artifact_entries(artifact_id);
create index idx_artifact_entries_entry_name on artifact_entries(entry_name);
create index idx_artifact_entries_storage_pathname on artifact_entries(storage_pathname);
create index idx_artifacts_name on artifacts(name);
create index idx_repos_owner_name on repos(owner, name);
-- #endregion indexes
