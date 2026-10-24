# xgit

A Noxs package (nodejs) that gives you full GitHub access from the command
line, on top of the `2026-03-10` REST API: a git workflow
(init/add/commit/clone/push), issues, pull requests, releases with asset
upload, gists, branches, Actions visibility, repo search, and a raw REST-API
wrapper driven by curl.

## Commands

    xgit token                          Verify the stored GitHub token
    xgit status                         Token + current repo/remote health
    xgit init [dir] [--remote o/r]      git init; attach GitHub origin
    xgit add [paths...]                 git add (default: everything)
    xgit commit [--all] -m <msg>        git commit with identity fallback
    xgit clone <o/r|url> [dir]          git clone (owner/repo shorthand)
    xgit push [git-push-options...]     Thin authenticated wrapper around git push
    xgit read <path> [ref] [-r o/r]     Read a file (or list a dir) from GitHub
    xgit workflow list|runs|watch|read  GitHub Actions visibility
    xgit issue list|view|create|close|comment   Issues (-r owner/repo supported)
    xgit pull list|view|create|merge    Pull requests
    xgit release list|view|create|asset Releases (asset upload via uploads.github.com)
    xgit gist list|view|create|delete   Gists (delete is permanent)
    xgit branch list|create|delete      Branches via the Git refs API
    xgit search repos|issues|code|users <query>   Code + repo search
    xgit rate                           API rate-limit status
    xgit repo star|unstar|fork <o/r>    Stars and forks
    xgit create <name> [options]        Create a GitHub repo; optional Noxs scaffold + push
    xgit rename <new-name>              Rename origin repo and fix the local remote
    xgit api [METHOD] <path> [-d json]  Raw GitHub REST call (curl); HTTP status on stderr

### init / add / commit / clone

    xgit init . --remote crossberry-in/mypkg
    xgit add src/
    xgit commit --all -m "first"
    xgit clone crossberry-in/xgit --depth 1

`commit` falls back to the `gh`-authenticated identity (login +
users.noreply.github.com) when no git identity is configured.

### read

    xgit read README.md
    xgit read src                  # directories are listed
    xgit read LICENSE v1.0.1       # read at a tag/branch/commit
    xgit read -r torvalds/linux init/main.c   # any repo you can access

Files are decoded from the contents API (base64) and printed raw.

### workflow

    xgit workflow list             # workflows: id, state, path, name
    xgit workflow runs             # recent runs: id, status, conclusion, event, branch, sha, title
    xgit workflow runs master      # filter by branch
    xgit workflow watch            # poll until the 5 most recent runs finish
    xgit workflow read pkg.yml     # print .github/workflows/pkg.yml

### issue / pull / release / gist / branch

    xgit issue list --limit 5
    xgit issue create -t "Bug" -b "Steps to reproduce..." -r my-org/myrepo
    xgit issue close 12
    xgit pull list
    xgit pull create --head feature --base master -t "Add x"
    xgit pull merge 42 --squash
    xgit release list
    xgit release create v2.0.0 -t "2.0" -n "Release notes"
    xgit release asset v2.0.0 dist/mypkg.tar.xz -l "linux binary"
    xgit gist create notes.txt -d "meeting notes" --public
    xgit branch create hotfix-x --from master
    xgit branch delete xgit-smoke-13

Issue bodies (`-b`), PR bodies and release notes accept multi-line text.

### create

    xgit create mypkg --node --private --push
    xgit create mypkg --org my-org --rust --push

- `--private` / `--public`        Repository visibility (default public)
- `--node|--rust|--py|--cpp|--go` Scaffold a Noxs package template
- `--push`                        Commit and push the scaffolded package
- `--org <org>`                   Create under an organization instead of your account

### api

    xgit api GET /user
    xgit api /repos/crossberry-in/xgit/releases
    xgit api POST /user/repos -d '{"name":"xgit-test","private":false}'

The response body goes to stdout; `[xgit] HTTP <status>` and errors go to
stderr. The subcommand exits non-zero on HTTP 4xx/5xx via curl
`--fail-with-body`.

## Auth and token handling

- Token source: `GH_TOKEN` / `GITHUB_TOKEN` environment variables, else `gh auth token`.
- API calls pin `X-GitHub-Api-Version: 2026-03-10`.
- The token is never printed, logged, or passed on the command line.
- API calls pass the token through a temporary header file inside a `0700`
  temp directory with `0600` permissions, deleted after every call.

## Development

    nx pkg build        # build with the language's own build system
    nx pkg release      # pre-flight validation before publishing

## Releasing

1. Bump `VERSION` (semantic versioning, MAJOR.MINOR.PATCH)
2. Commit and push — GitHub Actions builds all supported architectures,
   tags `xgit-v<version>`, creates the GitHub Release and updates
   `registry.json` automatically
3. Users install it with:

    nx install xgit

or pinned:

    nx install xgit@1.0.3

## Files

- `.github/workflows/pkg.yml` — build + release automation (do not edit)
- `registry.json` — release metadata (updated automatically by CI)
- `VERSION` — the version the next release publishes
