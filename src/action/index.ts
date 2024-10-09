import {DefaultArtifactClient} from '@actions/artifact'
import {getInput, isDebug as isDebugCore, setFailed, setOutput} from '@actions/core'
import * as glob from '@actions/glob'
import {HttpClient} from '@actions/http-client'
import {readFile} from 'fs/promises'
import {z} from 'zod'
import {UploadRequest} from '~/app/github/upload/types'
import {logger} from '~/tag-logger'

async function main() {
  setOutput('artifacts_uploaded', false)

  const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH!, {encoding: 'utf8'})) as EventType

  function isDebug() {
    if (isDebugCore()) return true
    if (event.repository.full_name === 'mmkal/artifact.ci' && event.ref !== 'refs/heads/main') return true
    return false
  }
  if (isDebug()) {
    logger.level = 'debug'
  }

  logger.debug('event', JSON.stringify(event, null, 2))
  logger.debug('getInput(artifactci-origin)', getInput('artifactci-origin'))

  const StringyBoolean = z.boolean().or(z.enum(['true', 'false']).transform(s => s === 'true'))

  /** camelCase version of the inputs in action.yml */
  const Inputs = z.object({
    path: z.string(),
    name: z.string(),
    ifNoFilesFound: z.enum(['warn', 'error', 'ignore']),
    retentionDays: z.coerce.number().int().min(0).max(90).default(Number(process.env.GITHUB_RETENTION_DAYS)),
    compressionLevel: z.coerce.number().int().min(0).max(9),
    overwrite: StringyBoolean,
    includeHiddenFiles: StringyBoolean,
    artifactciOrigin: z
      .string()
      .default(
        event.repository.full_name === 'mmkal/artifact.ci' && event.ref !== 'refs/heads/main'
          ? `https://artifactci-git-${event.ref.replace('refs/heads/', '').replaceAll(/\W/g, '-')}-mmkals-projects.vercel.app`
          : 'https://www.artifact.ci',
      ),
  })

  const coercedInput = Object.fromEntries(
    Object.entries(Inputs.shape).map(([camelKey]) => {
      const kebabKey = camelKey.replaceAll(/([A-Z])/g, '-$1').toLowerCase()
      const value = getInput(kebabKey, {trimWhitespace: true}) || undefined
      logger.debug({camelKey, kebabKey, value})
      return [camelKey, value]
    }),
  ) as {}
  logger.debug({coercedInput}, process.env.GITHUB_RETENTION_DAYS)
  const inputs = Inputs.parse(coercedInput)
  logger.debug({inputs})

  if (isDebug()) {
    console.log(event)
  }

  const client = new DefaultArtifactClient()

  const globber = await glob.create(inputs.path, {
    matchDirectories: false,
    excludeHiddenFiles: !inputs.includeHiddenFiles,
  })
  const files = await globber.glob()
  const uploadResult = await client.uploadArtifact(inputs.name, files, '.', {
    retentionDays: inputs.retentionDays,
    compressionLevel: inputs.compressionLevel,
  })
  logger.debug({uploadResult})
  const Env = z.object({
    GITHUB_REPOSITORY: z.string(),
    GITHUB_RUN_ID: z.string().transform(Number).pipe(z.number().int()),
    GITHUB_RUN_ATTEMPT: z.string().transform(Number).pipe(z.number().int()),
    GITHUB_JOB: z.string(),
    GITHUB_SHA: z.string().regex(/^[\da-f]{40}$/),
    GITHUB_REF_NAME: z.string(), // for PRs, this is `1234/merge`
    GITHUB_HEAD_REF: z.string().optional(), // for PRs, this is the head branch
  })
  const env = Env.parse(process.env)

  const [owner, repo] = env.GITHUB_REPOSITORY.split('/')
  const uploadRequest = UploadRequest.parse({
    owner,
    repo,
    artifact: {id: uploadResult.id!},
    job: {
      head_branch: env.GITHUB_HEAD_REF || env.GITHUB_REF_NAME,
      head_sha: env.GITHUB_SHA,
      run_id: env.GITHUB_RUN_ID,
      run_attempt: env.GITHUB_RUN_ATTEMPT,
    },
  } satisfies UploadRequest)

  const url = `${inputs.artifactciOrigin}/github/upload`
  logger.debug({url, uploadRequest})

  const http = new HttpClient('artifact.ci/action/v0')
  const resp = await http.post(url, JSON.stringify(uploadRequest), {
    'content-type': 'application/json',
    'artifactci-debug': isDebug() ? 'true' : 'false',
  })

  const body = await resp.readBody()
  logger.debug({statusCode: resp.message.statusCode, body: body.slice(0, 100)})
  if (resp.message.statusCode === 200) {
    console.log('✅ Upload done.')
    setOutput('artifact_uploaded', true)
  } else {
    logger.error(resp.message.statusCode, body)
    setFailed(body)
  }
}

// eslint-disable-next-line @typescript-eslint/no-floating-promises, unicorn/prefer-top-level-await
;(async function run() {
  try {
    await logger.try('action', main)
  } catch (error) {
    setFailed(String((error as Error)?.stack || error))
  }
})()

export type EventType = typeof _sampleEvent
const _sampleEvent = {
  after: '0c0366448e2ac36d8af75041a437974aee0292c8',
  base_ref: null,
  before: '22a36a03d0545a07e3470a4d5e3f4ae8d1518b01',
  commits: [
    {
      author: {
        email: 'mmkal@users.noreply.github.com',
        name: 'Misha Kaletsky',
        username: 'mmkal',
      },
      committer: {
        email: 'mmkal@users.noreply.github.com',
        name: 'Misha Kaletsky',
        username: 'mmkal',
      },
      distinct: true,
      id: '0c0366448e2ac36d8af75041a437974aee0292c8',
      message: 'keep stack (updated 12:41)',
      timestamp: '2024-09-27T12:41:55-04:00',
      tree_id: '08bf619caf28d21a573f78149c588da38e58edb4',
      url: 'https://github.com/mmkal/artifact.ci/commit/0c0366448e2ac36d8af75041a437974aee0292c8',
    },
  ],
  compare: 'https://github.com/mmkal/artifact.ci/compare/22a36a03d054...0c0366448e2a',
  created: false,
  deleted: false,
  forced: true,
  head_commit: {
    author: {
      email: 'mmkal@users.noreply.github.com',
      name: 'Misha Kaletsky',
      username: 'mmkal',
    },
    committer: {
      email: 'mmkal@users.noreply.github.com',
      name: 'Misha Kaletsky',
      username: 'mmkal',
    },
    distinct: true,
    id: '0c0366448e2ac36d8af75041a437974aee0292c8',
    message: 'keep stack (updated 12:41)',
    timestamp: '2024-09-27T12:41:55-04:00',
    tree_id: '08bf619caf28d21a573f78149c588da38e58edb4',
    url: 'https://github.com/mmkal/artifact.ci/commit/0c0366448e2ac36d8af75041a437974aee0292c8',
  },
  pusher: {
    email: '15040698+mmkal@users.noreply.github.com',
    name: 'mmkal',
  },
  ref: 'refs/heads/js-action',
  repository: {
    allow_forking: true,
    archive_url: 'https://api.github.com/repos/mmkal/artifact.ci/{archive_format}{/ref}',
    archived: false,
    assignees_url: 'https://api.github.com/repos/mmkal/artifact.ci/assignees{/user}',
    blobs_url: 'https://api.github.com/repos/mmkal/artifact.ci/git/blobs{/sha}',
    branches_url: 'https://api.github.com/repos/mmkal/artifact.ci/branches{/branch}',
    clone_url: 'https://github.com/mmkal/artifact.ci.git',
    collaborators_url: 'https://api.github.com/repos/mmkal/artifact.ci/collaborators{/collaborator}',
    comments_url: 'https://api.github.com/repos/mmkal/artifact.ci/comments{/number}',
    commits_url: 'https://api.github.com/repos/mmkal/artifact.ci/commits{/sha}',
    compare_url: 'https://api.github.com/repos/mmkal/artifact.ci/compare/{base}...{head}',
    contents_url: 'https://api.github.com/repos/mmkal/artifact.ci/contents/{+path}',
    contributors_url: 'https://api.github.com/repos/mmkal/artifact.ci/contributors',
    created_at: 1_724_792_016,
    default_branch: 'main',
    deployments_url: 'https://api.github.com/repos/mmkal/artifact.ci/deployments',
    description: 'Browse uploaded GitHub Artifacts',
    disabled: false,
    downloads_url: 'https://api.github.com/repos/mmkal/artifact.ci/downloads',
    events_url: 'https://api.github.com/repos/mmkal/artifact.ci/events',
    fork: false,
    forks: 0,
    forks_count: 0,
    forks_url: 'https://api.github.com/repos/mmkal/artifact.ci/forks',
    full_name: 'mmkal/artifact.ci',
    git_commits_url: 'https://api.github.com/repos/mmkal/artifact.ci/git/commits{/sha}',
    git_refs_url: 'https://api.github.com/repos/mmkal/artifact.ci/git/refs{/sha}',
    git_tags_url: 'https://api.github.com/repos/mmkal/artifact.ci/git/tags{/sha}',
    git_url: 'git://github.com/mmkal/artifact.ci.git',
    has_discussions: false,
    has_downloads: true,
    has_issues: true,
    has_pages: false,
    has_projects: true,
    has_wiki: true,
    homepage: 'https://artifact.ci',
    hooks_url: 'https://api.github.com/repos/mmkal/artifact.ci/hooks',
    html_url: 'https://github.com/mmkal/artifact.ci',
    id: 848_480_916,
    is_template: false,
    issue_comment_url: 'https://api.github.com/repos/mmkal/artifact.ci/issues/comments{/number}',
    issue_events_url: 'https://api.github.com/repos/mmkal/artifact.ci/issues/events{/number}',
    issues_url: 'https://api.github.com/repos/mmkal/artifact.ci/issues{/number}',
    keys_url: 'https://api.github.com/repos/mmkal/artifact.ci/keys{/key_id}',
    labels_url: 'https://api.github.com/repos/mmkal/artifact.ci/labels{/name}',
    language: 'TypeScript',
    languages_url: 'https://api.github.com/repos/mmkal/artifact.ci/languages',
    license: {
      key: 'apache-2.0',
      name: 'Apache License 2.0',
      node_id: 'MDc6TGljZW5zZTI=',
      spdx_id: 'Apache-2.0',
      url: 'https://api.github.com/licenses/apache-2.0',
    },
    master_branch: 'main',
    merges_url: 'https://api.github.com/repos/mmkal/artifact.ci/merges',
    milestones_url: 'https://api.github.com/repos/mmkal/artifact.ci/milestones{/number}',
    mirror_url: null,
    name: 'artifact.ci',
    node_id: 'R_kgDOMpLKlA',
    notifications_url: 'https://api.github.com/repos/mmkal/artifact.ci/notifications{?since,all,participating}',
    open_issues: 1,
    open_issues_count: 1,
    owner: {
      avatar_url: 'https://avatars.githubusercontent.com/u/15040698?v=4',
      email: '15040698+mmkal@users.noreply.github.com',
      events_url: 'https://api.github.com/users/mmkal/events{/privacy}',
      followers_url: 'https://api.github.com/users/mmkal/followers',
      following_url: 'https://api.github.com/users/mmkal/following{/other_user}',
      gists_url: 'https://api.github.com/users/mmkal/gists{/gist_id}',
      gravatar_id: '',
      html_url: 'https://github.com/mmkal',
      id: 15_040_698,
      login: 'mmkal',
      name: 'mmkal',
      node_id: 'MDQ6VXNlcjE1MDQwNjk4',
      organizations_url: 'https://api.github.com/users/mmkal/orgs',
      received_events_url: 'https://api.github.com/users/mmkal/received_events',
      repos_url: 'https://api.github.com/users/mmkal/repos',
      site_admin: false,
      starred_url: 'https://api.github.com/users/mmkal/starred{/owner}{/repo}',
      subscriptions_url: 'https://api.github.com/users/mmkal/subscriptions',
      type: 'User',
      url: 'https://api.github.com/users/mmkal',
    },
    private: false,
    pulls_url: 'https://api.github.com/repos/mmkal/artifact.ci/pulls{/number}',
    pushed_at: 1_727_455_316,
    releases_url: 'https://api.github.com/repos/mmkal/artifact.ci/releases{/id}',
    size: 3359,
    ssh_url: 'git@github.com:mmkal/artifact.ci.git',
    stargazers: 1,
    stargazers_count: 1,
    stargazers_url: 'https://api.github.com/repos/mmkal/artifact.ci/stargazers',
    statuses_url: 'https://api.github.com/repos/mmkal/artifact.ci/statuses/{sha}',
    subscribers_url: 'https://api.github.com/repos/mmkal/artifact.ci/subscribers',
    subscription_url: 'https://api.github.com/repos/mmkal/artifact.ci/subscription',
    svn_url: 'https://github.com/mmkal/artifact.ci',
    tags_url: 'https://api.github.com/repos/mmkal/artifact.ci/tags',
    teams_url: 'https://api.github.com/repos/mmkal/artifact.ci/teams',
    topics: [],
    trees_url: 'https://api.github.com/repos/mmkal/artifact.ci/git/trees{/sha}',
    updated_at: '2024-09-27T02:03:36Z',
    url: 'https://github.com/mmkal/artifact.ci',
    visibility: 'public',
    watchers: 1,
    watchers_count: 1,
    web_commit_signoff_required: false,
  },
  sender: {
    avatar_url: 'https://avatars.githubusercontent.com/u/15040698?v=4',
    events_url: 'https://api.github.com/users/mmkal/events{/privacy}',
    followers_url: 'https://api.github.com/users/mmkal/followers',
    following_url: 'https://api.github.com/users/mmkal/following{/other_user}',
    gists_url: 'https://api.github.com/users/mmkal/gists{/gist_id}',
    gravatar_id: '',
    html_url: 'https://github.com/mmkal',
    id: 15_040_698,
    login: 'mmkal',
    node_id: 'MDQ6VXNlcjE1MDQwNjk4',
    organizations_url: 'https://api.github.com/users/mmkal/orgs',
    received_events_url: 'https://api.github.com/users/mmkal/received_events',
    repos_url: 'https://api.github.com/users/mmkal/repos',
    site_admin: false,
    starred_url: 'https://api.github.com/users/mmkal/starred{/owner}{/repo}',
    subscriptions_url: 'https://api.github.com/users/mmkal/subscriptions',
    type: 'User',
    url: 'https://api.github.com/users/mmkal',
  },
}
