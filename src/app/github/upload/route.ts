import {NextRequest, NextResponse} from 'next/server'
import {fromError} from 'zod-validation-error'
import {UploadRequest, UploadResponse} from './types'
import {toPath} from '~/app/artifact/view/params'
import {getInstallationOctokit} from '~/auth'
import {client, sql} from '~/db'
import {logger} from '~/tag-logger'

export async function POST(request: NextRequest) {
  const rawBody = (await request.json()) as {}

  const parsed = UploadRequest.safeParse(rawBody)
  if (!parsed.success) {
    const readable = fromError(parsed.error)
    logger.error({readable, body: rawBody})
    return NextResponse.json({success: false, error: readable.message}, {status: 400})
  }

  const {owner, repo, ...event} = parsed.data

  const installation = await client.maybeOne(sql<queries.Installation>`
    select github_id id
    from github_installations
    join repos on github_installations.id = repos.installation_id
    where repos.owner = ${owner} and repos.name = ${repo}
    limit 1
  `)

  if (!installation) {
    logger.warn({owner, repo}, `github installation not found`)
    return NextResponse.json({success: false, error: `not found`}, {status: 404})
  }

  const octokit = await getInstallationOctokit(installation.id)

  const {data: workflowRun} = await octokit.rest.actions.getWorkflowRun({
    owner,
    repo,
    run_id: event.job.run_id,
  })

  if (workflowRun.status !== 'in_progress' && workflowRun.status !== 'queued') {
    logger.warn({workflowRun}, `workflow run is not in progress`)
    return NextResponse.json({error: `not in progress`, status: workflowRun.status}, {status: 400})
  }

  const {data: artifact} = await octokit.rest.actions.getArtifact({
    owner,
    repo,
    artifact_id: event.artifact.id,
  })

  const insertResult = await insertArtifactRecord({
    ...parsed.data,
    artifact: {...artifact, visibility: event.artifact.visibility},
    installation,
  })

  const origin = getOrigin(request, {repo: `${owner}/${repo}`, branch: event.job.head_branch})
  const responseBody = UploadResponse.parse({
    success: true,
    urls: insertResult.dbIdentifiers.map(({type: aliasType, value: identifier}) => {
      const url = origin + toPath({owner, repo, aliasType, identifier, artifactName: artifact.name})
      return {aliasType, url}
    }),
  } satisfies UploadResponse)
  return NextResponse.json(responseBody)
}

type InsertParams = UploadRequest & {
  artifact: {name: string; visibility?: 'private' | 'public'}
  installation: {id: number}
}

export const insertArtifactRecord = async ({owner, repo, job, artifact: a, installation}: InsertParams) => {
  return client.transaction(async tx => {
    const dbArtifact = await tx.one(sql<queries.Artifact>`
      with repo as (select * from repos where owner = ${owner} and name = ${repo})
      insert into artifacts (repo_id, name, github_id, installation_id, visibility)
      select
        repo.id as repo_id,
        ${a.name} as name,
        ${a.id} as github_id,
        (select id from github_installations where github_id = ${installation.id}) as installation_id,
        coalesce(${a.visibility || null}, repo.default_visibility) as visibility
      from repo
      on conflict (repo_id, name, github_id)
        do update set
          installation_id = excluded.installation_id,
          -- visibility is only updated if the new visibility is not null
          visibility = coalesce(${a.visibility || null}, artifacts.visibility),
          updated_at = excluded.updated_at
      returning *
    `)

    const dbIdentifiers = await tx.many(sql<queries.ArtifactIdentifier>`
      insert into artifact_identifiers (artifact_id, type, value)
      select artifact_id, type, value
      from jsonb_populate_recordset(
        null::artifact_identifiers,
        ${JSON.stringify([
          {artifact_id: dbArtifact.id, type: 'run', value: `${job.run_id}.${job.run_attempt}`},
          {artifact_id: dbArtifact.id, type: 'sha', value: job.head_sha.slice(0, 7)},
          {artifact_id: dbArtifact.id, type: 'branch', value: job.head_branch.replaceAll('/', '__')},
        ])}
      )
      on conflict (artifact_id, type, value)
      do update set updated_at = current_timestamp
      returning *
    `)
    return {dbArtifact, dbIdentifiers}
  })
}

/** either the preview origin (for this repo) or null if another repo/for the default branch */
export const getPreviewOrigin = (request: NextRequest, params: {repo: string; branch: string}) => {
  const {hostname} = new URL(request.url)

  if (hostname !== 'artifact.ci') return null
  if (params.repo !== 'mmkal/artifact.ci') return null
  if (params.branch === 'main') return null

  return getPreviewUrl(params.branch)
}

/** either the preview origin (for this repo) or the same origin as from the request */
export const getOrigin = (request: NextRequest, params: {repo: string; branch: string}) => {
  return getPreviewOrigin(request, params) || new URL(request.url).origin
}

export const getPreviewUrl = (branch: string) => {
  const branchSlug = branch.replaceAll(/\W/g, '-')
  return `https://artifactci-git-${branchSlug}-mmkals-projects.vercel.app`
}

export declare namespace queries {
  // Generated by @pgkit/typegen

  /** - query: `select github_id id from github_installa... [truncated] ...s.owner = $1 and repos.name = $2 limit 1` */
  export interface Installation {
    /** column: `public.github_installations.github_id`, not null: `true`, regtype: `bigint` */
    id: number
  }

  /** - query: `with repo as (select * from repos where ... [truncated] ...ted_at = excluded.updated_at returning *` */
  export interface Artifact {
    /** column: `public.artifacts.id`, not null: `true`, regtype: `prefixed_ksuid` */
    id: import('~/db').Id<'artifacts'>

    /** column: `public.artifacts.repo_id`, not null: `true`, regtype: `prefixed_ksuid` */
    repo_id: string

    /** column: `public.artifacts.name`, not null: `true`, regtype: `text` */
    name: string

    /** column: `public.artifacts.created_at`, not null: `true`, regtype: `timestamp with time zone` */
    created_at: Date

    /** column: `public.artifacts.updated_at`, not null: `true`, regtype: `timestamp with time zone` */
    updated_at: Date

    /** column: `public.artifacts.download_url`, regtype: `text` */
    download_url: string | null

    /** column: `public.artifacts.github_id`, not null: `true`, regtype: `bigint` */
    github_id: number

    /** column: `public.artifacts.installation_id`, not null: `true`, regtype: `prefixed_ksuid` */
    installation_id: string

    /** column: `public.artifacts.visibility`, not null: `true`, regtype: `text` */
    visibility: string
  }

  /** - query: `insert into artifact_identifiers (artifa... [truncated] ...dated_at = current_timestamp returning *` */
  export interface ArtifactIdentifier {
    /** column: `public.artifact_identifiers.id`, not null: `true`, regtype: `prefixed_ksuid` */
    id: import('~/db').Id<'artifact_identifiers'>

    /** column: `public.artifact_identifiers.artifact_id`, not null: `true`, regtype: `prefixed_ksuid` */
    artifact_id: string

    /** column: `public.artifact_identifiers.type`, not null: `true`, regtype: `text` */
    type: string

    /** column: `public.artifact_identifiers.value`, not null: `true`, regtype: `text` */
    value: string

    /** column: `public.artifact_identifiers.created_at`, not null: `true`, regtype: `timestamp with time zone` */
    created_at: Date

    /** column: `public.artifact_identifiers.updated_at`, not null: `true`, regtype: `timestamp with time zone` */
    updated_at: Date
  }
}
