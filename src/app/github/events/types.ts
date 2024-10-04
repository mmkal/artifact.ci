import {z} from 'zod'

export const WorkflowJobCompleted = z.object({
  action: z.enum(['queued', 'waiting', 'in_progress', 'completed']),
  installation: z.object({
    id: z.number(),
  }),
  workflow_job: z.object({
    id: z.number(),
    run_id: z.number(),
    workflow_name: z.string(),
    head_branch: z.string(),
    head_sha: z.string(),
    run_attempt: z.number(),
    status: z.string(),
    conclusion: z.string(),
    name: z.string().brand('WorkflowJobName'),
  }),
  repository: z.object({
    full_name: z.string(),
  }),
})
export type WorkflowJobCompleted = z.infer<typeof WorkflowJobCompleted>

export const AppWebhookEvent = z.union([
  WorkflowJobCompleted.transform(data => ({
    ...data,
    // manually add an `eventType` because `action` is on all payloads, but we want a simple discrimator so we know this action is related to a workflow job
    eventType: 'workflow_job_update' as const,
  })),
  z.object({action: z.string(), worfklow_job: z.undefined().optional()}).transform(data => ({
    ...data,
    eventType: 'ignored_action' as const,
  })),
])
export type AppWebhookEvent = z.infer<typeof AppWebhookEvent>

/* eslint-disable */
const sampleWorkflowJobCompleted = {
    "action": "completed",
    "workflow_job": {
        "id": 30799966660,
        "run_id": 11079048872,
        "workflow_name": "Recipes",
        "head_branch": "js-action",
        "run_url": "https://api.github.com/repos/mmkal/artifact.ci/actions/runs/11079048872",
        "run_attempt": 3,
        "node_id": "CR_kwDOMpLKlM8AAAAHK9IxxA",
        "head_sha": "8d51f3ce6d146c669cf2f836113d566d8fe0159a",
        "url": "https://api.github.com/repos/mmkal/artifact.ci/actions/jobs/30799966660",
        "html_url": "https://github.com/mmkal/artifact.ci/actions/runs/11079048872/job/30799966660",
        "status": "completed",
        "conclusion": "success",
        "created_at": "2024-09-28T14:08:05Z",
        "started_at": "2024-09-28T14:08:11Z",
        "completed_at": "2024-09-28T14:08:31Z",
        "name": "go",
        "steps": [
            {
                "name": "Set up job",
                "status": "completed",
                "conclusion": "success",
                "number": 1,
                "started_at": "2024-09-28T14:08:10Z",
                "completed_at": "2024-09-28T14:08:11Z"
            },
            {
                "name": "Run actions/checkout@v4",
                "status": "completed",
                "conclusion": "success",
                "number": 2,
                "started_at": "2024-09-28T14:08:11Z",
                "completed_at": "2024-09-28T14:08:11Z"
            },
            {
                "name": "setup",
                "status": "completed",
                "conclusion": "success",
                "number": 3,
                "started_at": "2024-09-28T14:08:12Z",
                "completed_at": "2024-09-28T14:08:26Z"
            },
            {
                "name": "Run ls ~/go/bin",
                "status": "completed",
                "conclusion": "success",
                "number": 4,
                "started_at": "2024-09-28T14:08:26Z",
                "completed_at": "2024-09-28T14:08:26Z"
            },
            {
                "name": "run tests",
                "status": "completed",
                "conclusion": "success",
                "number": 5,
                "started_at": "2024-09-28T14:08:26Z",
                "completed_at": "2024-09-28T14:08:28Z"
            },
            {
                "name": "Run /./upload",
                "status": "completed",
                "conclusion": "success",
                "number": 6,
                "started_at": "2024-09-28T14:08:28Z",
                "completed_at": "2024-09-28T14:08:29Z"
            },
            {
                "name": "Post Run actions/checkout@v4",
                "status": "completed",
                "conclusion": "success",
                "number": 12,
                "started_at": "2024-09-28T14:08:31Z",
                "completed_at": "2024-09-28T14:08:31Z"
            },
            {
                "name": "Complete job",
                "status": "completed",
                "conclusion": "success",
                "number": 13,
                "started_at": "2024-09-28T14:08:29Z",
                "completed_at": "2024-09-28T14:08:29Z"
            }
        ],
        "check_run_url": "https://api.github.com/repos/mmkal/artifact.ci/check-runs/30799966660",
        "labels": [
            "ubuntu-latest"
        ],
        "runner_id": 26,
        "runner_name": "GitHub Actions 26",
        "runner_group_id": 2,
        "runner_group_name": "GitHub Actions"
    },
    "repository": {
        "id": 848480916,
        "node_id": "R_kgDOMpLKlA",
        "name": "artifact.ci",
        "full_name": "mmkal/artifact.ci",
        "private": false,
        "owner": {
            "login": "mmkal",
            "id": 15040698,
            "node_id": "MDQ6VXNlcjE1MDQwNjk4",
            "avatar_url": "https://avatars.githubusercontent.com/u/15040698?v=4",
            "gravatar_id": "",
            "url": "https://api.github.com/users/mmkal",
            "html_url": "https://github.com/mmkal",
            "followers_url": "https://api.github.com/users/mmkal/followers",
            "following_url": "https://api.github.com/users/mmkal/following{/other_user}",
            "gists_url": "https://api.github.com/users/mmkal/gists{/gist_id}",
            "starred_url": "https://api.github.com/users/mmkal/starred{/owner}{/repo}",
            "subscriptions_url": "https://api.github.com/users/mmkal/subscriptions",
            "organizations_url": "https://api.github.com/users/mmkal/orgs",
            "repos_url": "https://api.github.com/users/mmkal/repos",
            "events_url": "https://api.github.com/users/mmkal/events{/privacy}",
            "received_events_url": "https://api.github.com/users/mmkal/received_events",
            "type": "User",
            "site_admin": false
        },
        "html_url": "https://github.com/mmkal/artifact.ci",
        "description": "Browse uploaded GitHub Artifacts",
        "fork": false,
        "url": "https://api.github.com/repos/mmkal/artifact.ci",
        "forks_url": "https://api.github.com/repos/mmkal/artifact.ci/forks",
        "keys_url": "https://api.github.com/repos/mmkal/artifact.ci/keys{/key_id}",
        "collaborators_url": "https://api.github.com/repos/mmkal/artifact.ci/collaborators{/collaborator}",
        "teams_url": "https://api.github.com/repos/mmkal/artifact.ci/teams",
        "hooks_url": "https://api.github.com/repos/mmkal/artifact.ci/hooks",
        "issue_events_url": "https://api.github.com/repos/mmkal/artifact.ci/issues/events{/number}",
        "events_url": "https://api.github.com/repos/mmkal/artifact.ci/events",
        "assignees_url": "https://api.github.com/repos/mmkal/artifact.ci/assignees{/user}",
        "branches_url": "https://api.github.com/repos/mmkal/artifact.ci/branches{/branch}",
        "tags_url": "https://api.github.com/repos/mmkal/artifact.ci/tags",
        "blobs_url": "https://api.github.com/repos/mmkal/artifact.ci/git/blobs{/sha}",
        "git_tags_url": "https://api.github.com/repos/mmkal/artifact.ci/git/tags{/sha}",
        "git_refs_url": "https://api.github.com/repos/mmkal/artifact.ci/git/refs{/sha}",
        "trees_url": "https://api.github.com/repos/mmkal/artifact.ci/git/trees{/sha}",
        "statuses_url": "https://api.github.com/repos/mmkal/artifact.ci/statuses/{sha}",
        "languages_url": "https://api.github.com/repos/mmkal/artifact.ci/languages",
        "stargazers_url": "https://api.github.com/repos/mmkal/artifact.ci/stargazers",
        "contributors_url": "https://api.github.com/repos/mmkal/artifact.ci/contributors",
        "subscribers_url": "https://api.github.com/repos/mmkal/artifact.ci/subscribers",
        "subscription_url": "https://api.github.com/repos/mmkal/artifact.ci/subscription",
        "commits_url": "https://api.github.com/repos/mmkal/artifact.ci/commits{/sha}",
        "git_commits_url": "https://api.github.com/repos/mmkal/artifact.ci/git/commits{/sha}",
        "comments_url": "https://api.github.com/repos/mmkal/artifact.ci/comments{/number}",
        "issue_comment_url": "https://api.github.com/repos/mmkal/artifact.ci/issues/comments{/number}",
        "contents_url": "https://api.github.com/repos/mmkal/artifact.ci/contents/{+path}",
        "compare_url": "https://api.github.com/repos/mmkal/artifact.ci/compare/{base}...{head}",
        "merges_url": "https://api.github.com/repos/mmkal/artifact.ci/merges",
        "archive_url": "https://api.github.com/repos/mmkal/artifact.ci/{archive_format}{/ref}",
        "downloads_url": "https://api.github.com/repos/mmkal/artifact.ci/downloads",
        "issues_url": "https://api.github.com/repos/mmkal/artifact.ci/issues{/number}",
        "pulls_url": "https://api.github.com/repos/mmkal/artifact.ci/pulls{/number}",
        "milestones_url": "https://api.github.com/repos/mmkal/artifact.ci/milestones{/number}",
        "notifications_url": "https://api.github.com/repos/mmkal/artifact.ci/notifications{?since,all,participating}",
        "labels_url": "https://api.github.com/repos/mmkal/artifact.ci/labels{/name}",
        "releases_url": "https://api.github.com/repos/mmkal/artifact.ci/releases{/id}",
        "deployments_url": "https://api.github.com/repos/mmkal/artifact.ci/deployments",
        "created_at": "2024-08-27T20:53:36Z",
        "updated_at": "2024-09-27T02:03:36Z",
        "pushed_at": "2024-09-27T23:33:21Z",
        "git_url": "git://github.com/mmkal/artifact.ci.git",
        "ssh_url": "git@github.com:mmkal/artifact.ci.git",
        "clone_url": "https://github.com/mmkal/artifact.ci.git",
        "svn_url": "https://github.com/mmkal/artifact.ci",
        "homepage": "https://artifact.ci",
        "size": 6440,
        "stargazers_count": 1,
        "watchers_count": 1,
        "language": "TypeScript",
        "has_issues": true,
        "has_projects": true,
        "has_downloads": true,
        "has_wiki": true,
        "has_pages": false,
        "has_discussions": false,
        "forks_count": 0,
        "mirror_url": null,
        "archived": false,
        "disabled": false,
        "open_issues_count": 1,
        "license": {
            "key": "apache-2.0",
            "name": "Apache License 2.0",
            "spdx_id": "Apache-2.0",
            "url": "https://api.github.com/licenses/apache-2.0",
            "node_id": "MDc6TGljZW5zZTI="
        },
        "allow_forking": true,
        "is_template": false,
        "web_commit_signoff_required": false,
        "topics": [],
        "visibility": "public",
        "forks": 0,
        "open_issues": 1,
        "watchers": 1,
        "default_branch": "main"
    },
    "sender": {
        "login": "mmkal",
        "id": 15040698,
        "node_id": "MDQ6VXNlcjE1MDQwNjk4",
        "avatar_url": "https://avatars.githubusercontent.com/u/15040698?v=4",
        "gravatar_id": "",
        "url": "https://api.github.com/users/mmkal",
        "html_url": "https://github.com/mmkal",
        "followers_url": "https://api.github.com/users/mmkal/followers",
        "following_url": "https://api.github.com/users/mmkal/following{/other_user}",
        "gists_url": "https://api.github.com/users/mmkal/gists{/gist_id}",
        "starred_url": "https://api.github.com/users/mmkal/starred{/owner}{/repo}",
        "subscriptions_url": "https://api.github.com/users/mmkal/subscriptions",
        "organizations_url": "https://api.github.com/users/mmkal/orgs",
        "repos_url": "https://api.github.com/users/mmkal/repos",
        "events_url": "https://api.github.com/users/mmkal/events{/privacy}",
        "received_events_url": "https://api.github.com/users/mmkal/received_events",
        "type": "User",
        "site_admin": false
    },
    "installation": {
        "id": 55366339,
        "node_id": "MDIzOkludGVncmF0aW9uSW5zdGFsbGF0aW9uNTUzNjYzMzk="
    }
}