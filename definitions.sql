create table test_table (
    id serial primary key,
    name text not null
);

-- Table for storing repository information
create table repos (
    id serial primary key,
    owner text not null,
    name text not null,
    html_url text not null unique,
    created_at timestamp with time zone not null default current_timestamp,
    updated_at timestamp with time zone not null default current_timestamp
);

-- Table for storing upload information
create table uploads (
    id serial primary key,
    pathname text not null,
    mime_type text not null,
    blob_url text not null,
    repo_id integer not null references repos(id),
    created_at timestamp with time zone not null default current_timestamp,
    updated_at timestamp with time zone not null default current_timestamp
);

-- Create indexes
create index idx_uploads_repo_id on uploads(repo_id);
create index idx_repos_owner_name on repos(owner, name);
