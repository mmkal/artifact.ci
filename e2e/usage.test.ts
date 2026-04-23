import {expect, test, type Page} from '@playwright/test'
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'

const execFileAsync = promisify(execFile)
const installRepoSlug = 'mmkal-bot/test-repo'
const installRepoUrl = `https://github.com/${installRepoSlug}`
const workflowRepoOwner = 'mmkal'
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

class WorkflowRepoFixture {
  readonly repoName: string
  readonly repoSlug: string
  readonly repoUrl: string
  readonly branch: string
  readonly workflowName: string
  readonly commitMessage: string
  readonly workflowPath: string
  readonly tempDir: string
  readonly artifactciOrigin: string

  constructor(params: {
    repoName: string
    branch: string
    workflowName: string
    commitMessage: string
    workflowPath: string
    tempDir: string
    artifactciOrigin: string
  }) {
    this.repoName = params.repoName
    this.repoSlug = `${workflowRepoOwner}/${params.repoName}`
    this.repoUrl = `https://github.com/${this.repoSlug}`
    this.branch = params.branch
    this.workflowName = params.workflowName
    this.commitMessage = params.commitMessage
    this.workflowPath = params.workflowPath
    this.tempDir = params.tempDir
    this.artifactciOrigin = params.artifactciOrigin
  }

  static async create(artifactciOrigin: string) {
    const repoName = `artifact-ci-e2e-${Date.now()}`
    const workflowName = `artifact-ci-showcase-${Date.now()}`
    const branch = workflowName
    const commitMessage = `add ${workflowName}`
    const workflowPath = `.github/workflows/${workflowName}.yml`
    const tempDir = await mkdtemp(path.join(tmpdir(), 'artifact-ci-e2e-'))
    const fixture = new WorkflowRepoFixture({
      repoName,
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

  async createRepo() {
    await githubJson('/user/repos', {
      method: 'POST',
      body: JSON.stringify({
        name: this.repoName,
        private: false,
        auto_init: true,
      }),
    })
  }

  async pushWorkflow() {
    const remote = authenticatedGitRemote(this.repoSlug)
    await git(['clone', '--depth', '1', '--branch', 'main', remote, this.tempDir])
    await git(['checkout', '-b', this.branch], {cwd: this.tempDir})
    const fullPath = path.join(this.tempDir, this.workflowPath)
    await mkdir(path.dirname(fullPath), {recursive: true})
    await writeFile(fullPath, buildWorkflowYaml(this.workflowName, this.artifactciOrigin))
    await git(['add', this.workflowPath], {cwd: this.tempDir})
    await git(['-c', 'user.name=artifact-ci-e2e', '-c', 'user.email=artifact-ci-e2e@users.noreply.github.com', 'commit', '-m', this.commitMessage], {
      cwd: this.tempDir,
    })
    await git(['push', '--set-upstream', 'origin', this.branch], {cwd: this.tempDir})
  }

  async [Symbol.asyncDispose]() {
    if (process.env.KEEP_E2E_REPO !== '1') {
      try {
        await githubDelete(`/repos/${this.repoSlug}`)
      } catch {
        // best effort cleanup
      }
    } else {
      console.log(`[e2e] KEEP_E2E_REPO=1 → leaving ${this.repoUrl} for inspection`)
    }
    await rm(this.tempDir, {recursive: true, force: true})
  }
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
  await using repo = await WorkflowRepoFixture.create(tunnelUrl)

  const run = await waitForWorkflowSuccess(repo)

  await page.goto(`${repo.repoUrl}/tree/${repo.branch}`)
  await expect(page.getByTitle(repo.commitMessage)).toBeVisible({timeout: 30_000})

  const checksBadge = page.getByTestId('checks-status-badge-icon').first()
  await expect(checksBadge).toBeVisible({timeout: 30_000})
  await checksBadge.click()
  await expect(page.getByText(repo.workflowName, {exact: true})).toBeVisible({timeout: 30_000})

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
