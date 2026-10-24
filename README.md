# xgit

A Noxs package (nodejs) that gives you full GitHub access from the command line:
repo creation and renaming, authenticated pushes, and a raw REST-API wrapper
driven by curl.

## Commands

    xgit token                          Verify the stored GitHub token
    xgit status                         Token + current repo/remote health
    xgit create <name> [options]        Create a GitHub repo; optional Noxs scaffold + push
    xgit rename <new-name>              Rename origin repo and fix the local remote
    xgit push [git-push-options...]     Thin authenticated wrapper around git push
    xgit api [METHOD] <path> [-d json]  Raw GitHub REST call (curl); HTTP status on stderr

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

    nx install xgit@1.0.1

## Files

- `.github/workflows/pkg.yml` — build + release automation (do not edit)
- `registry.json` — release metadata (updated automatically by CI)
- `VERSION` — the version the next release publishes
