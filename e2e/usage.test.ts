import {expect, test, type Page} from '@playwright/test'
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'

const execFileAsync = promisify(execFile)
const installRepoSlug = 'mmkal-bot/test-repo'
const installRepoUrl = `https://github.com/${installRepoSlug}`
const defaultSharedRepoSlug = 'mmkal/artifact.ci'
const sharedRepoSlug = process.env.E2E_SHARED_REPO_SLUG || defaultSharedRepoSlug
const githubApiOrigin = 'https://api.github.com'
const tunnelUrlFile = path.join(import.meta.dirname, '..', '.alchemy', 'tunnel-url.txt')

async function readTunnelUrl() {
  const raw = await readFile(tunnelUrlFile, 'utf8').catch(() => '')
  return raw.trim()
}

class ArtifactCiAppFixture {
  readonly page: Page

  constructor(page: Page) {
    this.page = page
  }

  static async create(page: Page) {
    const fixture = new ArtifactCiAppFixture(page)
    await fixture.assertInstalled()
    return fixture
  }

  async assertInstalled() {
    await this.page.goto(`${installRepoUrl}/settings/installations`)
    await expect.poll(async () => (await this.page.locator('body').innerText()).includes('artifact.ci'), {timeout: 30_000}).toBe(true)
    await expect(this.page.getByRole('link', {name: 'Configure'}).last()).toBeVisible({timeout: 30_000})
  }

  async [Symbol.asyncDispose]() {
    await this.assertInstalled()
  }
}

interface WorkflowRepoFixture {
  readonly repoSlug: string
  readonly repoUrl: string
  readonly branch: string
  readonly workflowName: string
  readonly commitMessage: string
  readonly [Symbol.asyncDispose]: () => Promise<void>
}

/**
 * Default fixture: pushes a fresh branch to a shared repo (mmkal/artifact.ci
 * by default). Cleans up the branch on dispose unless KEEP_E2E_REPO=1.
 *
 * Much faster and less spammy than creating a one-off repo per run; the
 * tradeoff is we don't exercise /github/upload's auto-register path. Flip
 * to {@link FreshRepoFixture} with E2E_FRESH_REPO=1 when that's what you
 * want.
 */
class SharedRepoBranchFixture implements WorkflowRepoFixture {
  readonly repoSlug: string
  readonly repoUrl: string
  readonly branch: string
  readonly workflowName: string
  readonly commitMessage: string
  readonly workflowPath: string
  readonly tempDir: string
  readonly artifactciOrigin: string

  private constructor(params: {
    repoSlug: string
    branch: string
    workflowName: string
    commitMessage: string
    workflowPath: string
    tempDir: string
    artifactciOrigin: string
  }) {
    this.repoSlug = params.repoSlug
    this.repoUrl = `https://github.com/${params.repoSlug}`
    this.branch = params.branch
    this.workflowName = params.workflowName
    this.commitMessage = params.commitMessage
    this.workflowPath = params.workflowPath
    this.tempDir = params.tempDir
    this.artifactciOrigin = params.artifactciOrigin
  }

  static async create(artifactciOrigin: string) {
    const stamp = Date.now()
    const workflowName = `artifact-ci-showcase-${stamp}`
    const branch = `e2e/${workflowName}`
    const workflowPath = `.github/workflows/${workflowName}.yml`
    const commitMessage = `e2e: add ${workflowName}`
    const tempDir = await mkdtemp(path.join(tmpdir(), 'artifact-ci-e2e-'))

    const fixture = new SharedRepoBranchFixture({
      repoSlug: sharedRepoSlug,
      branch,
      workflowName,
      commitMessage,
      workflowPath,
      tempDir,
      artifactciOrigin,
    })
    await fixture.pushBranch()
    return fixture
  }

  private async pushBranch() {
    const remote = authenticatedGitRemote(this.repoSlug)
    await git(['clone', '--depth', '1', remote, this.tempDir])
    await git(['checkout', '-b', this.branch], {cwd: this.tempDir})

    // Strip other workflow files on this branch so we don't trigger the
    // repo's full CI / recipes / custom-action workflows for every e2e run.
    // The branch is ephemeral so there's no risk of this leaking back into
    // main.
    const workflowsDir = path.join(this.tempDir, '.github', 'workflows')
    await rm(workflowsDir, {recursive: true, force: true})

    const fullPath = path.join(this.tempDir, this.workflowPath)
    await mkdir(path.dirname(fullPath), {recursive: true})
    await writeFile(fullPath, buildWorkflowYaml(this.workflowName, this.artifactciOrigin))
    await git(['add', '-A', '.github/workflows'], {cwd: this.tempDir})
    await git(
      [
        '-c',
        'user.name=artifact-ci-e2e',
        '-c',
        'user.email=artifact-ci-e2e@users.noreply.github.com',
        'commit',
        '-m',
        this.commitMessage,
      ],
      {cwd: this.tempDir},
    )
    await git(['push', '--set-upstream', 'origin', this.branch], {cwd: this.tempDir})
  }

  async [Symbol.asyncDispose]() {
    if (process.env.KEEP_E2E_REPO === '1') {
      console.log(`[e2e] KEEP_E2E_REPO=1 → leaving branch ${this.branch} on ${this.repoUrl}`)
    } else {
      try {
        await githubDelete(`/repos/${this.repoSlug}/git/refs/heads/${this.branch}`)
      } catch {
        // best effort cleanup
      }
    }
    await rm(this.tempDir, {recursive: true, force: true})
  }
}

/**
 * Alternative fixture: creates a brand new repo under the authenticated user
 * (mmkal) for the duration of the test. Exercises /github/upload's
 * auto-register path, at the cost of being slow and leaving debris on any
 * aborted run. Enabled via E2E_FRESH_REPO=1.
 */
class FreshRepoFixture implements WorkflowRepoFixture {
  readonly repoSlug: string
  readonly repoUrl: string
  readonly branch: string
  readonly workflowName: string
  readonly commitMessage: string
  readonly workflowPath: string
  readonly tempDir: string
  readonly artifactciOrigin: string
  readonly repoName: string

  private constructor(params: {
    repoName: string
    repoSlug: string
    branch: string
    workflowName: string
    commitMessage: string
    workflowPath: string
    tempDir: string
    artifactciOrigin: string
  }) {
    this.repoName = params.repoName
    this.repoSlug = params.repoSlug
    this.repoUrl = `https://github.com/${params.repoSlug}`
    this.branch = params.branch
    this.workflowName = params.workflowName
    this.commitMessage = params.commitMessage
    this.workflowPath = params.workflowPath
    this.tempDir = params.tempDir
    this.artifactciOrigin = params.artifactciOrigin
  }

  static async create(artifactciOrigin: string) {
    const stamp = Date.now()
    const repoName = `artifact-ci-e2e-${stamp}`
    const owner = sharedRepoSlug.split('/')[0]
    const repoSlug = `${owner}/${repoName}`
    const workflowName = `artifact-ci-showcase-${stamp}`
    const branch = workflowName
    const workflowPath = `.github/workflows/${workflowName}.yml`
    const commitMessage = `add ${workflowName}`
    const tempDir = await mkdtemp(path.join(tmpdir(), 'artifact-ci-e2e-'))

    const fixture = new FreshRepoFixture({
      repoName,
      repoSlug,
      branch,
      workflowName,
      commitMessage,
      workflowPath,
      tempDir,
      artifactciOrigin,
    })
    await fixture.createRepo()
    await fixture.pushWorkflow()
    return fixture
  }

  private async createRepo() {
    await githubJson('/user/repos', {
      method: 'POST',
      body: JSON.stringify({
        name: this.repoName,
        private: false,
        auto_init: true,
      }),
    })
  }

  private async pushWorkflow() {
    const remote = authenticatedGitRemote(this.repoSlug)
    await git(['clone', '--depth', '1', '--branch', 'main', remote, this.tempDir])
    await git(['checkout', '-b', this.branch], {cwd: this.tempDir})
    const fullPath = path.join(this.tempDir, this.workflowPath)
    await mkdir(path.dirname(fullPath), {recursive: true})
    await writeFile(fullPath, buildWorkflowYaml(this.workflowName, this.artifactciOrigin))
    await git(['add', this.workflowPath], {cwd: this.tempDir})
    await git(
      [
        '-c',
        'user.name=artifact-ci-e2e',
        '-c',
        'user.email=artifact-ci-e2e@users.noreply.github.com',
        'commit',
        '-m',
        this.commitMessage,
      ],
      {cwd: this.tempDir},
    )
    await git(['push', '--set-upstream', 'origin', this.branch], {cwd: this.tempDir})
  }

  async [Symbol.asyncDispose]() {
    if (process.env.KEEP_E2E_REPO === '1') {
      console.log(`[e2e] KEEP_E2E_REPO=1 → leaving ${this.repoUrl}`)
    } else {
      try {
        await githubDelete(`/repos/${this.repoSlug}`)
      } catch {
        // best effort cleanup
      }
    }
    await rm(this.tempDir, {recursive: true, force: true})
  }
}

async function createWorkflowFixture(artifactciOrigin: string): Promise<WorkflowRepoFixture> {
  return process.env.E2E_FRESH_REPO === '1'
    ? FreshRepoFixture.create(artifactciOrigin)
    : SharedRepoBranchFixture.create(artifactciOrigin)
}

test('showcase', async ({page}) => {
  test.setTimeout(1000 * 60 * 5)

  const tunnelUrl = await readTunnelUrl()
  test.skip(
    !tunnelUrl,
    'No tunnel URL found at .alchemy/tunnel-url.txt — run `pnpm dev` first so the GitHub App can reach your laptop.',
  )

  if (process.env.SKIP_APP_FIXTURE !== '1') {
    await using _app = await ArtifactCiAppFixture.create(page)
  }
  await using repo = await createWorkflowFixture(tunnelUrl)

  const run = await waitForWorkflowSuccess(repo)

  const tunnelHost = new URL(tunnelUrl).host
  type CheckRun = {name: string; conclusion: string | null; details_url: string | null}
  let checkRun: CheckRun | null = null
  await expect
    .poll(
      async () => {
        const data = (await githubJson(`/repos/${repo.repoSlug}/commits/${run.head_sha}/check-runs`, {method: 'GET'})) as {
          check_runs: CheckRun[]
        }
        checkRun = data.check_runs.find(c => c.name === tunnelHost) ?? null
        return checkRun
      },
      {timeout: 60_000, message: `waiting for a check run named ${tunnelHost}`},
    )
    .not.toBeNull()
  expect(checkRun!.conclusion, 'artifact.ci check run conclusion').toBe('success')
  const artifactHref = checkRun!.details_url
  expect(artifactHref, 'artifact.ci check run details_url').toBeTruthy()
  expect(new URL(artifactHref!).origin, 'check run link points at the dev tunnel').toBe(tunnelUrl)

  await page.goto(artifactHref!)
  await expect(page.getByRole('heading', {name: 'showcase-report'})).toBeVisible({timeout: 30_000})
  await expect(page.getByRole('link', {name: /index\.html/i}).first()).toBeVisible({timeout: 30_000})
})

async function waitForWorkflowSuccess(repo: WorkflowRepoFixture) {
  const timeoutMs = 180_000
  const started = Date.now()

  while (Date.now() - started < timeoutMs) {
    const data = (await githubJson(`/repos/${repo.repoSlug}/actions/runs?branch=${repo.branch}`, {method: 'GET'})) as {
      workflow_runs?: Array<{
        name: string
        status: string
        conclusion: string | null
        id: number
        html_url: string
        artifacts_url: string
        head_sha: string
      }>
    }
    const run = data.workflow_runs?.find(x => x.name === repo.workflowName)

    if (run?.status === 'completed') {
      if (run.conclusion !== 'success') {
        throw new Error(`Workflow ${repo.workflowName} completed with ${run.conclusion}`)
      }

      const artifacts = (await githubJson(`/repos/${repo.repoSlug}/actions/runs/${run.id}/artifacts`, {method: 'GET'})) as {
        total_count: number
      }
      if (artifacts.total_count === 0) {
        throw new Error(`Workflow ${repo.workflowName} succeeded without artifacts`)
      }

      return run
    }

    await new Promise(resolve => setTimeout(resolve, 5000))
  }

  throw new Error(`Timed out waiting for workflow ${repo.workflowName} to succeed`)
}

function authenticatedGitRemote(repoSlug: string) {
  const githubToken = requiredGithubToken()
  return `https://x-access-token:${encodeURIComponent(githubToken)}@github.com/${repoSlug}.git`
}

async function githubJson(pathname: string, init: RequestInit) {
  const response = await fetch(`${githubApiOrigin}${pathname}`, {
    ...init,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${requiredGithubToken()}`,
      'x-github-api-version': '2022-11-28',
      'content-type': 'application/json',
      ...(init.headers || {}),
    },
  })

  if (!response.ok) {
    throw new Error(`GitHub API ${pathname} failed: ${response.status} ${await response.text()}`)
  }

  return response.json()
}

async function githubDelete(pathname: string) {
  const response = await fetch(`${githubApiOrigin}${pathname}`, {
    method: 'DELETE',
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${requiredGithubToken()}`,
      'x-github-api-version': '2022-11-28',
    },
  })

  if (response.status !== 204 && response.status !== 404) {
    throw new Error(`GitHub API ${pathname} failed: ${response.status} ${await response.text()}`)
  }
}

function requiredGithubToken() {
  const token = process.env.GH_TOKEN
  if (!token) throw new Error('GH_TOKEN is required for showcase usage tests')
  return token
}

async function git(args: string[], options?: {cwd?: string}) {
  await execFileAsync('git', args, {
    cwd: options?.cwd,
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
    },
  })
}

function buildWorkflowYaml(workflowName: string, artifactciOrigin: string) {
  return [
    `name: ${workflowName}`,
    'on:',
    '  push:',
    'jobs:',
    '  showcase:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - name: Write HTML report',
    '        run: |',
    '          mkdir -p html',
    `          printf '<!doctype html><html><body><h1>${workflowName}</h1></body></html>' > html/index.html`,
    '      - uses: mmkal/artifact.ci/upload@main',
    '        with:',
    '          name: showcase-report',
    '          path: html',
    '          artifactci-visibility: public',
    '          artifactci-mode: eager',
    `          artifactci-origin: ${artifactciOrigin}`,
  ].join('\n')
}
