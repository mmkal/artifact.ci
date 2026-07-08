-- rebuilding table "artifacts": column "github_id" not-null removed
alter table artifacts rename to __sqlfu_old_artifacts;
create table artifacts (
  id text primary key,
  repo_id text not null references repos(id),
  name text not null,
  -- github artifact id; null for artifacts stored outside GitHub (see depot_artifact_id)
  github_id integer,
  -- depot ci artifact uuid; non-null marks this row as a Depot-stored artifact
  depot_artifact_id text,
  download_url text,
  installation_id text not null references github_installations(id),
  visibility text not null default 'private',
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  unique(repo_id, name, github_id)
);
insert into artifacts(id, repo_id, name, github_id, download_url, installation_id, visibility, created_at, updated_at) select id, repo_id, name, github_id, download_url, installation_id, visibility, created_at, updated_at from __sqlfu_old_artifacts;
drop table __sqlfu_old_artifacts;
create unique index idx_artifacts_depot_artifact_id on artifacts(repo_id, name, depot_artifact_id) where depot_artifact_id is not null;
create index idx_artifacts_name on artifacts(name);
create index idx_artifacts_repo_id on artifacts(repo_id);
create table depot_connections (
  id text primary key,
  owner text not null,
  repo text not null,
  depot_org_id text not null,
  api_token text not null,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  unique(owner, repo)
);
create table depot_runs (
  id text primary key,
  connection_id text not null references depot_connections(id),
  depot_run_id text not null,
  head_sha text not null,
  ref text,
  status text not null,
  artifact_count integer not null default 0,
  run_created_at text not null,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  unique(depot_run_id)
);
create index idx_depot_runs_connection_id on depot_runs(connection_id);
