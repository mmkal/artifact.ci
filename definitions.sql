-- #region KSUID Setup
/**
  * From https://github.com/kiwicopple/pg-extensions/blob/3b8679e7367fc534f941d9ca36431be473e0a424/pg_idkit/pg_idkit--0.0.1--0.0.2.sql
  * On archive.org: https://web.archive.org/web/20240918170547/https://github.com/kiwicopple/pg-extensions/blob/3b8679e7367fc534f941d9ca36431be473e0a424/pg_idkit/pg_idkit--0.0.1--0.0.2.sql
  */
create or replace function gen_random_ksuid_microsecond() returns text as $$
declare
	v_time timestamp with time zone := null;
	v_seconds numeric(50) := null;
	v_micros numeric(50)  := null;
	v_numeric numeric(50) := null;
	v_epoch numeric(50) = 1400000000; -- 2014-05-13T16:53:20Z
	v_base62 text := '';
	v_alphabet char array[62] := array[
		'0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
		'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J',
		'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 
		'U', 'V', 'W', 'X', 'Y', 'Z', 
		'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 
		'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't',
		'u', 'v', 'w', 'x', 'y', 'z'];
	i integer := 0;
begin
	-- Get the current time
	v_time := clock_timestamp();

	-- Extract the epoch seconds and microseconds
	v_seconds := EXTRACT(EPOCH FROM v_time) - v_epoch;
	v_micros  := MOD((EXTRACT(microseconds FROM v_time)::numeric(50)), 1e6::numeric(50));

	-- Generate a KSUID in a numeric variable
	v_numeric := (v_seconds * pow(2::numeric(50), 128))  -- 32 bits for seconds
		+ (v_micros * pow(2::numeric(50), 108))          -- 20 bits for microseconds and 108 bits for randomness
		+ ((random()::numeric(70,20) * pow(2::numeric(70,20), 54))::numeric(50) * pow(2::numeric(50), 54)::numeric(50))
		+  (random()::numeric(70,20) * pow(2::numeric(70,20), 54))::numeric(50);

	-- Encode it to base-62
	while v_numeric <> 0 loop
		v_base62 := v_base62 || v_alphabet[mod(v_numeric, 62) + 1];
		v_numeric := div(v_numeric, 62);
	end loop;
	v_base62 := reverse(v_base62);
	v_base62 := lpad(v_base62, 27, '0');

	return v_base62;
end $$ language plpgsql;

-- KSUID Specification: https://github.com/segmentio/ksuid (archive: https://web.archive.org/web/20240828000938/https://github.com/segmentio/ksuid)

-- Then, create a function to generate a prefixed KSUID
create or replace function generate_prefixed_ksuid(prefix text)
returns text as
$$
select prefix || '_' || gen_random_ksuid_microsecond()
$$
language sql;

-- Create a custom type for the prefixed KSUID
create domain prefixed_ksuid as text
check (value ~ '^[a-z0-9_]+_[0-9A-Za-z]{27}$');

-- note: prefixed_ksuid is basically just a string, but it's nice to have a domain to enforce the format
-- if the format needs to change some day, it might be painful to change the domain, so try to avoid. But in theory you could just `alter table my_table alter column id type text`
-- and everything should work fine, but it'd have to rebuild indexes etc.

-- #endregion KSUID Setup

-- Table for storing repository information
create table repos (
  id prefixed_ksuid primary key default generate_prefixed_ksuid('repo'),
  owner text not null,
  name text not null,
  created_at timestamp with time zone not null default current_timestamp,
  updated_at timestamp with time zone not null default current_timestamp,
  unique(owner, name)
);

create table sponsors (
	id prefixed_ksuid primary key default generate_prefixed_ksuid('sponsor'),
	sponsor_login text not null,
	sponsoree_login text not null, -- github login
	github_type text not null, -- user/org
	monthly_amount_usd numeric(10, 2),
	expiry timestamptz not null, -- set to 3000-01-01 if never expires I guess
	created_at timestamp with time zone not null default current_timestamp,
	updated_at timestamp with time zone not null default current_timestamp,
	unique(sponsor_login, sponsoree_login)
);

create table usage_credits (
	id prefixed_ksuid primary key default generate_prefixed_ksuid('usage_credit'),
	github_login text not null,
	expiry timestamptz not null,
	sponsor_id prefixed_ksuid references sponsors(id),
	reason text not null, -- e.g. "sponsor" or "i like them"
	created_at timestamp with time zone not null default current_timestamp,
	updated_at timestamp with time zone not null default current_timestamp,
	unique(github_login, reason)
);

create table github_installations (
	id prefixed_ksuid primary key default generate_prefixed_ksuid('github_installation'),
	github_id int8 not null,
	created_at timestamp with time zone not null default current_timestamp,
	updated_at timestamp with time zone not null default current_timestamp,
	unique(github_id)
);

create table artifacts (
	id prefixed_ksuid primary key default generate_prefixed_ksuid('artifact'),
	repo_id prefixed_ksuid not null references repos(id),
	name text not null,
	github_id int8 not null,
	download_url text not null,
	installation_id prefixed_ksuid not null references github_installations(id),
	created_at timestamp with time zone not null default current_timestamp,
	updated_at timestamp with time zone not null default current_timestamp,
	unique(repo_id, name, github_id)
);

create table artifact_identifiers (
	id prefixed_ksuid primary key default generate_prefixed_ksuid('artifact_identifier'),
	artifact_id prefixed_ksuid not null references artifacts(id),
	type text not null,
	value text not null,
	created_at timestamp with time zone not null default current_timestamp,
	updated_at timestamp with time zone not null default current_timestamp,
	unique(artifact_id, type, value)
);

create table artifact_entries (
	id prefixed_ksuid primary key default generate_prefixed_ksuid('artifact_entry'),
	artifact_id prefixed_ksuid not null references artifacts(id),
	entry_name text not null, -- the path to the file within the artifact
	aliases text[] not null, -- aliases for the entry, e.g. ["path/to/file.html", "path/to/file"]
	storage_object_id uuid not null, -- references storage.objects(id) but pgkit doesn't know about the storage schema
	created_at timestamp with time zone not null default current_timestamp,
	updated_at timestamp with time zone not null default current_timestamp,
	unique(artifact_id, entry_name)
);

-- not using supabase auth but may as well make sure the anonymous key can't access our tables
alter table repos enable row level security;
alter table sponsors enable row level security;
alter table usage_credits enable row level security;
alter table artifacts enable row level security;
alter table artifact_identifiers enable row level security;
alter table artifact_entries enable row level security;
alter table github_installations enable row level security;

-- Create indexes
create index idx_usage_credits_github_login on usage_credits(github_login);
create index idx_usage_credits_sponsor_id on usage_credits(sponsor_id);
create index idx_artifacts_repo_id on artifacts(repo_id);
create index idx_artifact_identifiers_artifact_id on artifact_identifiers(artifact_id);
create index idx_artifact_entries_artifact_id on artifact_entries(artifact_id);
create index idx_artifact_entries_entry_name on artifact_entries(entry_name);
create index idx_artifact_entries_aliases on artifact_entries(aliases);
create index idx_artifact_entries_storage_object_id on artifact_entries(storage_object_id);
create index idx_artifacts_name on artifacts(name);
create index idx_repos_owner_name on repos(owner, name);
