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
returns text as $$
declare
  ksuid_value text;
begin
  -- Generate a KSUID
  ksuid_value := gen_random_ksuid_microsecond();
  
  -- Concatenate the prefix and KSUID
  return prefix || '_' || ksuid_value;
end;
$$ language plpgsql;

-- Create a custom type for the prefixed KSUID
create domain prefixed_ksuid as text
check (value ~ '^[a-z_]+_[0-9A-Za-z]{27}$');

-- note: prefixed_ksuid is basically just a string, but it's nice to have a domain to enforce the format
-- if the format needs to change some day, it might be painful to change the domain, so try to avoid. But in theory you could just `alter table my_table alter column id type text`
-- and everything should work fine, but it'd have to rebuild indexes etc.

-- #endregion KSUID Setup

create table test_table (
    id prefixed_ksuid primary key default generate_prefixed_ksuid('test_table'),
    name text not null
);

-- Table for storing repository information
create table repos (
  id prefixed_ksuid primary key default generate_prefixed_ksuid('repo'),
  owner text not null,
  name text not null,
  html_url text not null unique,
  created_at timestamp with time zone not null default current_timestamp,
  updated_at timestamp with time zone not null default current_timestamp
);

-- Table for storing upload information
create table uploads (
    id prefixed_ksuid primary key default generate_prefixed_ksuid('upload'),
    pathname text not null,
    mime_type text not null,
    blob_url text not null,
    repo_id prefixed_ksuid not null references repos(id),
	ref text not null,
	sha text not null,
    created_at timestamp with time zone not null default current_timestamp,
    updated_at timestamp with time zone not null default current_timestamp
);

-- Create indexes
create index idx_uploads_repo_id on uploads(repo_id);
create index idx_repos_owner_name on repos(owner, name);
