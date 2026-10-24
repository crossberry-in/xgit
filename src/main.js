#!/usr/bin/env node
'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const VERSION = '1.0.3';
const API = 'https://api.github.com';
const API_VERSION = '2026-03-10';

function usage() {
    return [
        'Usage: xgit <command> [options]',
        '',
        'GitHub full-access helper: git commands and raw REST API via curl.',
        '',
        'Commands:',
        '  token                              Verify the stored GitHub token (gh auth / GH_TOKEN)',
        '  status                             Token + current repo/remote status',
        '  init [dir] [options]               git init; optionally attach a GitHub origin',
        '  add [paths...]                     git add (default: everything)',
        '  commit [git-commit-options...]     git commit with automatic identity fallback',
        '  clone <repo> [dir] [options]       git clone; owner/repo shorthand supported',
        '  push [git-push-options...]         Thin authenticated wrapper around git push',
        '  read <path> [ref] [options]        Read a file (or list a dir) from GitHub',
        '  workflow <sub> [args]              List, read or follow GitHub Actions',
        '  issue <sub> [args]                 List, view, create, close, comment',
        '  pull <sub> [args]                  List, view, create, merge',
        '  release <sub> [args]               List, view, create, upload assets',
        '  gist <sub> [args]                  List, view, create, delete',
        '  branch <sub> [args]                List, create, delete branches (Git refs API)',
        '  search <type> <query>              Search repos, issues (incl. PRs) or code',
        '  rate                               Show current API rate limit',
        '  repo <sub> [args]                  star | unstar | fork <owner/repo>',
        '  create <name> [options]            Create a GitHub repo; scaffold a Noxs package',
        '  rename <new-name>                  Rename origin repo and fix the local remote',
        '  api [METHOD] <path> [-d <json>]    Raw GitHub REST call (curl), HTTP status on stderr',
        '',
        'init options:',
        '  --remote <owner/repo>              Add origin after git init',
        '',
        'commit options (plus any git commit flags):',
        '  -m <message>                       Commit message (required by git)',
        '  --all                              Stage everything before committing',
        '',
        'clone options (plus any git clone flags):',
        '  --depth <n>, --branch <name>       Forwarded to git clone',
        '',
        'read options:',
        '  -r <owner/repo>                    Read from another repository',
        '',
        'workflow subcommands:',
        '  list                               Workflows of origin repo (id, state, path)',
        '  runs [branch...]                   Recent workflow runs with status',
        '  watch [interval]                   Poll origin workflow runs every N seconds',
        '  read <file> [ref]                  Print a workflow file (.github/workflows/*)',
        '',
        'issue subcommands (all accept -r owner/repo):',
        '  list [--closed|--all] [--limit n]  Issues (number, state, title)',
        '  view <number>                      Title, state, author, body',
        '  create -t <title> [-b <body>]      Open an issue; prints the HTML url',
        '  close <number>                     Close an issue',
        '  comment <number> -m <text>         Comment on an issue or pull request',
        '',
        'pull subcommands:',
        '  list [--limit n]                   Pull requests (number, state, branches)',
        '  view <number>                      Title, state, head -> base',
        '  create --head <b> --base <b> -t <title> [-b body] [--draft]',
        '  merge <number> [--squash|--rebase] Merge an open pull request',
        '',
        'release subcommands:',
        '  list                               Releases (tag, name, assets)',
        '  view <tag>                         Release details with asset urls',
        '  create <tag> [-t <name>] [-n <notes>] [--target <branch>]',
        '  asset <tag> <file> [-l <label>]    Upload an asset to an existing release',
        '',
        'gist subcommands:',
        '  list [--public] [-l <n>]           Your gists (or public ones)',
        '  view <id>                          Print each file in the gist',
        '  create <file...|-> [-d <text>] [--public]   (use - to read stdin)',
        '  delete <id>                        Permanently delete a gist',
        '',
        'branch subcommands:',
        '  list                               Branches of origin repo',
        '  create <name> [--from <ref>]       Create a branch (default from default branch)',
        '  delete <name>                      Delete refs/heads/<name>',
        '',
        'search types: repos | issues | code | users',
        '',
        'create options:',
        '  --private                          Create a private repo (default public)',
        '  --node|--nodejs|--rust|--py|--python|--cpp|--go   Template language',
        '  --push                             Commit and push the scaffolded package',
        '  --org <org>                        Create under an organization instead of you',
        '',
        'api examples:',
        '  xgit api GET /user',
        '  xgit api /repos/crossberry-in/xgit/releases',
        '  xgit api POST /user/repos -d \'{"name":"xgit-test","private":false}\'',
        '',
        'Token source: GH_TOKEN / GITHUB_TOKEN, else `gh auth token`.',
        'Tokens are never printed and never passed on the command line.',
    ].join('\n');
}

function die(msg) {
    process.stderr.write('xgit: ' + msg + '\n');
    return 1;
}

function sh(cmd, args, opts) {
    const r = spawnSync(cmd, args, Object.assign({ encoding: 'utf8' }, opts));
    return {
        code: r.status == null ? 1 : r.status,
        stdout: r.stdout || '',
        stderr: r.stderr || '',
    };
}

function token() {
    const envTok = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
    if (envTok && envTok.trim()) {
        return envTok.trim();
    }
    const g = sh('gh', ['auth', 'token']);
    const tok = g.stdout.trim();
    if (g.code !== 0 || !tok) {
        return null;
    }
    return tok;
}

function authToken() {
    const tok = token();
    if (!tok) {
        process.stderr.write(
            'xgit: no token found. Set GH_TOKEN/GITHUB_TOKEN or run: gh auth login\n'
        );
        process.exit(1);
    }
    return tok;
}

function newHeaderFile() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xgit-'));
    fs.chmodSync(dir, 0o700);
    const file = path.join(dir, 'headers');
    fs.writeFileSync(
        file,
        [
            'Authorization: Bearer ' + authToken(),
            'Accept: application/vnd.github+json',
            'X-GitHub-Api-Version: ' + API_VERSION,
        ].join('\n') + '\n'
    );
    fs.chmodSync(file, 0o600);
    return file;
}

function withHeaderFile(fn) {
    let file;
    try {
        file = newHeaderFile();
        return fn(file);
    } finally {
        if (file) {
            fs.rmSync(path.dirname(file), { recursive: true, force: true });
        }
    }
}

function apiCall(method, urlPath, body) {
    return withHeaderFile(function (headerFile) {
        const args = [
            '-sS',
            '--fail-with-body',
            '--max-time', '60',
            '-X', method,
            '-H', '@' + headerFile,
        ];
        if (body != null && body !== '') {
            args.push('-d', body);
        }
        args.push('-w', '\n%{stderr}[xgit] HTTP %{http_code}\n');
        args.push(API + urlPath);
        return sh('curl', args);
    });
}

function parseJson(arg) {
    let data = String(arg);
    if (data === '-') {
        const stdin = spawnSync('cat', [], { encoding: 'utf8' });
        data = stdin.stdout || '';
    }
    try {
        return JSON.stringify(JSON.parse(data));
    } catch (e) {
        throw new Error('invalid JSON body\n' + String(e.message || e));
    }
}

function cmdToken() {
    if (!token()) {
        return die('no token: set GH_TOKEN/GITHUB_TOKEN or run `gh auth login`');
    }
    const r = apiCall('GET', '/user');
    const m = r.stdout.match(/"login"\s*:\s*"([^"]+)"/);
    if (r.code !== 0) {
        return die('token invalid (HTTP error, see body above)');
    }
    process.stdout.write('token ok: login=' + (m ? m[1] : 'unknown') + '\n');
    return 0;
}

function parseOriginUrl(url) {
    const m = String(url).trim().match(/github\.com[:/](.+)\/([^/]+?)(?:\.git)?\/?$/);
    if (!m) {
        return null;
    }
    return { owner: m[1].replace(/^.*?\/([^/]+)$/, '$1'), repo: m[2] };
}

function originOwnerRepo(dir) {
    const r = sh('git', ['-C', dir || process.cwd(), 'remote', 'get-url', 'origin']);
    if (r.code !== 0) {
        return null;
    }
    return parseOriginUrl(r.stdout);
}

function cmdStatus() {
    let bad = 0;
    const tok = token();
    if (!tok) {
        process.stderr.write('token   : none (run `gh auth login` or set GH_TOKEN)\n');
        bad = 1;
    }
    const origin = originOwnerRepo();
    process.stdout.write(
        'git     : v' +
            (sh('git', ['--version']).stdout.trim().replace(/^git version /, '') || 'unknown') +
            '\norigin  : ' +
            (origin ? 'https://github.com/' + origin.owner + '/' + origin.repo : 'none') +
            '\n'
    );
    if (origin) {
        const r = apiCall('GET', '/repos/' + origin.owner + '/' + origin.repo);
        if (r.code === 0) {
            process.stdout.write('api     : reachable (repository readable)\n');
        } else {
            process.stderr.write('api     : request failed (see body)\n');
            bad = 1;
        }
    } else {
        process.stderr.write('origin  : not a github.com git repository\n');
        bad = 1;
    }
    if (bad) {
        return die('status: issues detected');
    }
    process.stdout.write('status  : ok\n');
    return 0;
}

function cmdCreate(rest) {
    if (!rest.length || rest[0].startsWith('-')) {
        return die('usage: xgit create <name> [--private|--public] [--node|--rust|--py|--cpp|--go] [--push] [--org <org>]');
    }
    const name = rest.shift();
    const flags = {
        private: false,
        lang: null,
        push: false,
        org: null,
    };
    for (let i = 0; i < rest.length; i++) {
        const a = rest[i];
        if (a === '--private') {
            flags.private = true;
        } else if (a === '--public') {
            flags.private = false;
        } else if (a === '--push') {
            flags.push = true;
        } else if (a === '--org') {
            i += 1;
            if (i >= rest.length) {
                return die('create: --org needs a value');
            }
            flags.org = rest[i];
        } else if (
            a === '--node' || a === '--nodejs' || a === '--rust' ||
            a === '--py' || a === '--python' || a === '--cpp' || a === '--go'
        ) {
            flags.lang = a.replace(/^--/, '');
            if (flags.lang === 'nodejs') {
                flags.lang = 'node';
            }
            if (flags.lang === 'py') {
                flags.lang = 'python';
            }
        } else {
            return die('create: unknown option: ' + a);
        }
    }

    if (!/^[a-z0-9][a-z0-9._-]*$/i.test(name)) {
        return die('create: invalid repo name: ' + name);
    }

    const body = JSON.stringify({
        name: name,
        private: flags.private,
        description: 'Noxs ' + name + ' package built with the NX Package System',
    });
    const host = flags.org
        ? '/orgs/' + encodeURIComponent(flags.org) + '/repos'
        : '/user/repos';
    const r = apiCall('POST', host, body);
    if (r.code !== 0) {
        return die('create: GitHub API error');
    }
    let info;
    try {
        info = JSON.parse(r.stdout.trim());
    } catch (e) {
        return die('create: could not parse API response');
    }
    process.stdout.write(
        'created : ' + info.full_name + ' (' + (flags.private ? 'private' : 'public') + ')\n' +
        'remote  : ' + info.clone_url + '\n'
    );

    const dir = path.join(process.cwd(), name);
    if (flags.lang) {
        process.stdout.write('scaffold: nx pkg init ' + name + ' (--' + flags.lang + ')\n');
        const init = sh('nx', ['pkg', 'init', name, '--' + flags.lang]);
        if (init.code !== 0) {
            process.stderr.write(
                'scaffold: nx failed, skipping local package\n' + init.stderr + init.stdout
            );
        }
    }
    if (flags.push) {
        if (!fs.existsSync(dir)) {
            return die('push: package directory missing: ' + dir);
        }
        const g = function (gitArgs) {
            return sh('git', gitArgs, { cwd: dir });
        };
        if (g(['remote', 'get-url', 'origin']).code !== 0) {
            g(['remote', 'add', 'origin', info.clone_url]);
        }
        if (g(['config', 'user.email']).code !== 0) {
            const me = apiCall('GET', '/user');
            const login = (me.stdout.match(/"login"\s*:\s*"([^"]+)"/) || [])[1] || 'unknown';
            g(['config', 'user.name', login]);
            g(['config', 'user.email', login + '@users.noreply.github.com']);
        }
        g(['add', '-A']);
        const commit = g(['commit', '-m', 'release: ' + name]);
        if (commit.code !== 0 && !/nothing to commit/.test(commit.stderr + commit.stdout)) {
            process.stderr.write('push: commit failed\n' + commit.stderr);
            return 1;
        }
        const branch = (g(['rev-parse', '--abbrev-ref', 'HEAD']).stdout || 'master').trim();
        const push = g(['push', '-u', 'origin', branch]);
        if (push.code !== 0) {
            process.stderr.write('push: failed\n' + push.stderr);
            return 1;
        }
        process.stdout.write('pushed  : branch ' + branch + ' -> ' + info.full_name + '\n');
    }
    if (flags.lang || flags.push) {
        process.stdout.write('note    : GitHub Actions will build and publish ' + name + '\n');
    }
    process.stdout.write('open    : ' + info.html_url + '\n');
    return 0;
}

function cmdRename(rest) {
    if (rest.length !== 1 || rest[0].startsWith('-')) {
        return die('usage: xgit rename <new-name>');
    }
    const origin = originOwnerRepo();
    if (!origin) {
        return die('rename: not a github.com git repository');
    }
    if (!/^[A-Za-z0-9._-]+$/.test(rest[0])) {
        return die('rename: invalid repo name: ' + rest[0]);
    }
    const r = apiCall(
        'PATCH',
        '/repos/' + origin.owner + '/' + origin.repo,
        JSON.stringify({ name: rest[0] })
    );
    if (r.code !== 0) {
        return die('rename: GitHub API error');
    }
    let info;
    try {
        info = JSON.parse(r.stdout.trim());
    } catch (e) {
        return die('rename: could not parse API response');
    }
    const newUrl = 'https://github.com/' + info.full_name + '.git';
    const u = sh('git', ['remote', 'set-url', 'origin', newUrl]);
    if (u.code !== 0) {
        process.stderr.write('rename: could not update local remote\n');
        return 1;
    }
    process.stdout.write(
        'renamed : ' + origin.owner + '/' + origin.repo + ' -> ' + info.full_name + '\n' +
        'remote  : ' + newUrl + '\n'
    );
    return 0;
}

function cmdPush(rest) {
    const p = spawnSync('git', ['push'].concat(rest), {
        encoding: 'utf8',
        stdio: 'inherit',
    });
    return p.status == null ? 1 : p.status;
}

function cmdApi(rest) {
    if (!rest.length) {
        return die('usage: xgit api [METHOD] <path> [-d <json>|-d -|--data-file <f>]');
    }
    let method = 'GET';
    let urlPath = null;
    let data = null;
    let dataFile = null;
    for (let i = 0; i < rest.length; i++) {
        const a = rest[i];
        if (a === '-d') {
            i += 1;
            if (i >= rest.length) {
                return die('api: -d needs a value');
            }
            data = rest[i];
        } else if (a === '--data-file') {
            i += 1;
            if (i >= rest.length) {
                return die('api: --data-file needs a path');
            }
            dataFile = rest[i];
        } else if (a.startsWith('-') && a.length > 1 && a !== '-') {
            return die('api: unknown option: ' + a);
        } else if (urlPath === null) {
            if (a.startsWith('/')) {
                urlPath = a;
            } else if (a.toUpperCase() === a && a.length >= 3) {
                method = a.toUpperCase();
            } else {
                urlPath = '/' + a;
            }
        } else {
            return die('api: unexpected argument: ' + a);
        }
    }
    if (!urlPath) {
        return die('api: missing request path');
    }
    if (data !== null && (data.startsWith('{') || data === '-')) {
        try {
            data = parseJson(data);
        } catch (e) {
            return die('api: ' + (e.message || String(e)));
        }
    } else if (dataFile) {
        try {
            data = fs.readFileSync(dataFile, 'utf8');
        } catch (e) {
            return die('api: cannot read --data-file: ' + (e.message || e));
        }
    }
    const r = apiCall(method, urlPath, data);
    if (r.stdout) {
        process.stdout.write(r.stdout);
    }
    process.stderr.write(r.stderr);
    return r.code;
}

function requireOrigin() {
    const origin = originOwnerRepo();
    if (!origin) {
        return null;
    }
    return origin;
}

function apiFail(prefix, r) {
    let msg = '';
    try {
        msg = (JSON.parse(r.stdout.trim()) || {}).message || '';
    } catch (e) {
        msg = (r.stdout || '').trim().split('\n')[0];
    }
    return die(prefix + ': ' + (msg || 'GitHub API error'));
}

function resolveRepoArg(arg) {
    if (/^https:\/\//.test(arg) || /^git@/.test(arg)) {
        const parsed = parseOriginUrl(arg);
        if (!parsed) {
            return null;
        }
        return parsed.owner + '/' + parsed.repo;
    }
    if (/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(arg)) {
        return arg;
    }
    return null;
}

function contentsCall(owner, repo, filePath, ref) {
    const enc = String(filePath)
        .split('/')
        .map(function (p) {
            return encodeURIComponent(p);
        })
        .join('/');
    let urlPath = '/repos/' + owner + '/' + repo + '/contents/' + enc;
    if (ref) {
        urlPath += '?ref=' + encodeURIComponent(ref);
    }
    return apiCall('GET', urlPath);
}

function printContents(r, decode) {
    let info;
    try {
        info = JSON.parse((r.stdout || '').trim());
    } catch (e) {
        return die('read: unexpected API response');
    }
    if (info.type === 'file') {
        if (info.encoding === 'base64') {
            const buf = Buffer.from(
                String(info.content || '').replace(/\s+/g, ''),
                'base64'
            );
            process.stdout.write(buf.toString('utf8'));
        } else {
            process.stdout.write(String(info.content || ''));
        }
        return 0;
    }
    if (Array.isArray(info)) {
        info
            .slice()
            .sort(function (a, b) {
                return String(a.type).localeCompare(String(b.type)) ||
                    String(a.name).localeCompare(String(b.name));
            })
            .forEach(function (item) {
                process.stdout.write(item.type + ' ' + item.path + '\n');
            });
        return 0;
    }
    process.stdout.write(JSON.stringify(info, null, 2) + '\n');
    return 0;
}

function cmdRead(rest) {
    let remote = null;
    const args = [];
    for (let i = 0; i < rest.length; i++) {
        if (rest[i] === '-r') {
            i += 1;
            if (i >= rest.length) {
                return die('read: -r needs owner/repo');
            }
            remote = resolveRepoArg(rest[i]);
            if (!remote) {
                return die('read: -r expects owner/repo, got: ' + rest[i]);
            }
        } else {
            args.push(rest[i]);
        }
    }
    if (!args.length || args[0].startsWith('/')) {
        return die('usage: xgit read <path> [ref] [-r owner/repo]');
    }
    let ownerRepo;
    if (remote) {
        const o = remote.split('/');
        ownerRepo = { owner: o[0], repo: o[1] };
    } else {
        const origin = requireOrigin();
        if (!origin) {
            return die('read: not a github.com git repository (use -r owner/repo)');
        }
        ownerRepo = origin;
    }
    let ref = null;
    if (args.length > 1 && !args[1].startsWith('-')) {
        ref = args[1];
    }
    const r = contentsCall(ownerRepo.owner, ownerRepo.repo, args[0], ref);
    if (r.code !== 0) {
        return apiFail('read', r);
    }
    return printContents(r, true);
}

function cmdWorkflow(rest) {
    const sub = rest[0];
    const args = rest.slice(1);
    const origin = requireOrigin();
    if (!origin) {
        return die('workflow: not a github.com git repository');
    }
    const base = '/repos/' + origin.owner + '/' + origin.repo;
    if (sub === 'list') {
        const r = apiCall('GET', base + '/actions/workflows');
        if (r.code !== 0) {
            return apiFail('workflow list', r);
        }
        let info;
        try {
            info = JSON.parse(r.stdout.trim());
        } catch (e) {
            return die('workflow list: could not parse API response');
        }
        (info.workflows || []).forEach(function (w) {
            process.stdout.write(
                w.id + '\t' + (w.state || '?') + '\t' + w.path +
                '\t' + (w.name || '')
            );
            process.stdout.write('\n');
        });
        return 0;
    }
    if (sub === 'runs') {
        let runsPath = base + '/actions/runs';
        if (args.length > 0) {
            const branch = args[0].replace(/[^A-Za-z0-9._/-]/g, '');
            runsPath += '?branch=' + encodeURIComponent(branch);
        }
        const r = apiCall('GET', runsPath);
        if (r.code !== 0) {
            return apiFail('workflow runs', r);
        }
        let info;
        try {
            info = JSON.parse(r.stdout.trim());
        } catch (e) {
            return die('workflow runs: could not parse API response');
        }
        (info.workflow_runs || []).forEach(function (run) {
            process.stdout.write(
                [
                    run.id,
                    run.status || '-',
                    run.conclusion || '-',
                    run.event || '-',
                    run.head_branch || '-',
                    (run.head_sha || '').slice(0, 7),
                    run.display_title || '',
                ].join('\t')
            );
            process.stdout.write('\n');
        });
        return 0;
    }
    if (sub === 'watch') {
        let interval = 15;
        if (args.length > 0) {
            const n = parseInt(args[0], 10);
            if (!isNaN(n) && n >= 2 && n <= 300) {
                interval = n;
            }
        }
        process.stdout.write(
            'xgit: watching ' + origin.owner + '/' + origin.repo +
            ' workflow runs every ' + interval + 's (Ctrl-C to quit)\n'
        );
        for (;;) {
            const r = apiCall('GET', base + '/actions/runs?per_page=5');
            if (r.code !== 0) {
                return apiFail('workflow watch', r);
            }
            let info;
            try {
                info = JSON.parse(r.stdout.trim());
            } catch (e) {
                return die('workflow watch: could not parse API response');
            }
            const lines = [];
            (info.workflow_runs || []).forEach(function (run) {
                lines.push(
                    run.id + '\t' + (run.status || '-') + '\t' + (run.conclusion || '-') +
                    '\t' + (run.display_title || '')
                );
            });
            process.stdout.write('\n### ' + new Date().toISOString() + '\n' + lines.join('\n') + '\n');
            if ((info.workflow_runs || []).every(function (run) {
                return run.status === 'completed';
            })) {
                process.stdout.write('xgit: all recent runs finished\n');
                return 0;
            }
            spawnSync('sleep', [String(interval)]);
        }
    }
    if (sub === 'read') {
        if (!args.length) {
            return die('usage: xgit workflow read <file.yml> [ref]');
        }
        let ref = null;
        let file = args[0];
        if (args.length > 1 && !args[1].startsWith('-')) {
            ref = args[1];
        }
        if (!file.startsWith('.github')) {
            file = '.github/workflows/' + file;
        }
        const r = contentsCall(origin.owner, origin.repo, file, ref);
        if (r.code !== 0) {
            return apiFail('workflow read', r);
        }
        return printContents(r, true);
    }
    return die('workflow: unknown subcommand: ' + (sub || '') + ' (list|runs|watch|read)');
}

function cmdInit(rest) {
    let dir = '.';
    let remote = null;
    for (let i = 0; i < rest.length; i++) {
        const a = rest[i];
        if (a === '--remote' || a === '-r') {
            i += 1;
            if (i >= rest.length || rest[i].startsWith('-')) {
                return die('init: --remote needs owner/repo');
            }
            remote = resolveRepoArg(rest[i]);
            if (!remote) {
                return die('init: --remote expects owner/repo, got: ' + rest[i]);
            }
        } else if (a.startsWith('-')) {
            return die('init: unknown option: ' + a);
        } else {
            dir = a;
        }
    }
    if (sh('git', ['-C', dir, 'rev-parse', '--git-dir']).code === 0) {
        return die('init: already a git repository: ' + dir);
    }
    const init = sh('git', ['init', dir]);
    if (init.code !== 0) {
        process.stderr.write(init.stderr);
        return die('init: git init failed');
    }
    process.stdout.write('initialized : ' + dir + '\n');
    if (remote) {
        const o = remote.split('/');
        const url = 'https://github.com/' + remote + '.git';
        const add = sh('git', ['-C', dir, 'remote', 'add', 'origin', url]);
        if (add.code !== 0) {
            process.stderr.write(add.stderr);
            return die('init: could not add origin');
        }
        process.stdout.write('origin      : ' + url + '\n');
        process.stdout.write(
            'next        : git add ...; xgit commit -m "init"; xgit push -u origin ' +
            path.basename(gitHead(dir)) + '\n'
        );
    }
    return 0;
}

function gitHead(dir) {
    const r = sh('git', ['-C', dir, 'rev-parse', '--abbrev-ref', 'HEAD']);
    const out = (r.stdout || '').trim();
    return r.code === 0 && out && out !== 'HEAD' ? out : 'master';
}

function gitIdentityFallback(dir) {
    if (sh('git', ['-C', dir, 'config', 'user.email']).code === 0) {
        return;
    }
    const r = apiCall('GET', '/user');
    let login = 'unknown';
    try {
        login = (JSON.parse((r.stdout || '').trim()).login) || login;
    } catch (e) {}
    if (r.code !== 0) {
        return;
    }
    const set = function (gitArgs) {
        sh('git', gitArgs, { cwd: dir });
    };
    set(['config', 'user.name', login]);
    set(['config', 'user.email', login + '@users.noreply.github.com']);
    process.stderr.write('xgit: using fallback identity ' + login + '\n');
}

function cmdAdd(rest) {
    const args = rest.length ? rest.slice() : ['-A'];
    const p = spawnSync('git', ['add'].concat(args), {
        encoding: 'utf8',
        stdio: 'inherit',
    });
    return p.status == null ? 1 : p.status;
}

function cmdCommit(rest) {
    if (!rest.length) {
        return die('commit: git commit needs arguments (e.g. -m "message")');
    }
    gitIdentityFallback(process.cwd());
    const args = rest.slice();
    let addAll = false;
    const passthrough = [];
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--all') {
            addAll = true;
        } else {
            passthrough.push(args[i]);
        }
    }
    if (addAll) {
        const a = sh('git', ['add', '-A']);
        if (a.code !== 0) {
            process.stderr.write(a.stderr);
            return die('commit: git add failed');
        }
    }
    const p = spawnSync('git', ['commit'].concat(passthrough), {
        encoding: 'utf8',
        stdio: 'inherit',
    });
    if (p.status != null && p.status !== 0) {
        return p.status;
    }
    return 0;
}

function cmdClone(rest) {
    if (!rest.length) {
        return die('usage: xgit clone <owner/repo|https url> [dir] [--depth <n>] [--branch <name>]');
    }
    const full = resolveRepoArg(rest.shift());
    if (!full) {
        return die('clone: expected owner/repo or https url, got: ' + full);
    }
    const url = 'https://github.com/' + full + '.git';
    let dirArg = null;
    const passthrough = [];
    for (let i = 0; i < rest.length; i++) {
        const a = rest[i];
        if (a === '--') {
            passthrough.push(a);
        } else if (a.startsWith('-')) {
            if (dirsPassthroughFlag(a)) {
                i += 1;
                if (i >= rest.length) {
                    return die('clone: ' + a + ' needs a value');
                }
                passthrough.push(a, rest[i]);
            } else {
                passthrough.push(a);
            }
        } else if (dirArg === null) {
            dirArg = a;
        } else {
            return die('clone: unexpected argument: ' + a);
        }
    }
    const finalDir = dirArg || path.basename(full);
    if (fs.existsSync(finalDir)) {
        return die('clone: directory already exists: ' + finalDir);
    }
    const p = spawnSync('git', ['clone', url].concat(passthrough, [finalDir]), {
        encoding: 'utf8',
        stdio: ['ignore', 'inherit', 'inherit'],
    });
    if (p.status != null && p.status !== 0) {
        return p.status;
    }
    process.stdout.write('cloned : ' + url + ' -> ' + finalDir + '\n');
    const origin = { owner: full.split('/')[0], repo: full.split('/')[1] };
    const r = apiCall('GET', '/repos/' + origin.owner + '/' + origin.repo);
    if (r.code === 0) {
        let info;
        try {
            info = JSON.parse(r.stdout.trim());
        } catch (e) {
            info = null;
        }
        if (info && info.default_branch) {
            process.stdout.write('branch : ' + info.default_branch + '\n');
        }
    }
    process.stdout.write('next   : cd ' + finalDir + '; xgit status\n');
    return 0;
}

function dirsPassthroughFlag(flag) {
    return flag === '--depth' || flag === '--branch' || flag === '--template' || flag === '--separate-git-dir' || flag === '-o' || flag === '-b' || flag === '--origin' || flag === '--name';
}

function extractRemote(args) {
    const out = [];
    let remote = null;
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '-r') {
            i += 1;
            if (i >= args.length) {
                return null;
            }
            remote = resolveRepoArg(args[i]);
            if (!remote) {
                return null;
            }
        } else {
            out.push(args[i]);
        }
    }
    return { remote: remote, args: out };
}

function resolveRepoPair(remote, label) {
    if (remote) {
        const parts = remote.split('/');
        return { owner: parts[0], repo: parts[1] };
    }
    const origin = originOwnerRepo();
    if (!origin) {
        die(label + ': not a github.com git repository (use -r owner/repo)');
        return null;
    }
    return origin;
}

function parseLimit(args, defaultValue) {
    let limit = defaultValue;
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--limit' || args[i] === '-l') {
            const n = parseInt(args[i + 1], 10);
            if (!isNaN(n) && n > 0) {
                limit = n;
                args.splice(i, 2);
                i -= 1;
            }
        }
    }
    return limit;
}

function collectFlagValue(args, names) {
    for (let i = 0; i < args.length; i++) {
        if (names.indexOf(args[i]) !== -1) {
            const value = args[i + 1];
            if (i + 1 < args.length) {
                args.splice(i, 2);
                return value;
            }
            args.splice(i, 1);
            return null;
        }
    }
    return null;
}

function hasFlag(args, names) {
    for (let i = 0; i < args.length; i++) {
        if (names.indexOf(args[i]) !== -1) {
            args.splice(i, 1);
            return true;
        }
    }
    return false;
}

function truncLine(text, max) {
    text = String(text || '').split('\n')[0] || '';
    return text.length > max ? text.slice(0, max - 1) + '\u2026' : text;
}

function brief(key, item) {
    try {
        return JSON.parse((item || '').trim())[key];
    } catch (e) {
        return null;
    }
}

function cmdIssue(rest) {
    const parsed = extractRemote(rest.slice());
    if (!parsed) {
        return die('issue: -r expects owner/repo');
    }
    const pair = resolveRepoPair(parsed.remote, 'issue');
    if (!pair) {
        return 1;
    }
    const args = parsed.args.slice();
    const sub = args.shift();
    const base = '/repos/' + pair.owner + '/' + pair.repo + '/issues';
    if (!sub || sub === 'list') {
        const limit = parseLimit(args, 20);
        const state = hasFlag(args, ['--all']) ? 'all' :
            hasFlag(args, ['--closed']) ? 'closed' : 'open';
        const r = apiCall('GET', base + '?state=' + state + '&per_page=50');
        if (r.code !== 0) {
            return apiFail('issue list', r);
        }
        let info;
        try {
            info = JSON.parse(r.stdout.trim());
        } catch (e) {
            return die('issue list: could not parse API response');
        }
        info.filter(function (i) { return !i.pull_request; })
            .slice(0, limit)
            .forEach(function (i) {
                process.stdout.write([
                    '#' + i.number, i.state, i.user.login,
                    '"' + truncLine(i.title, 70) + '"',
                ].join('\t') + '\n');
            });
        return 0;
    }
    if (sub === 'view') {
        if (!args.length || !/^\d+$/.test(args[0])) {
            return die('usage: xgit issue view <number>');
        }
        const r = apiCall('GET', base + '/' + args[0]);
        if (r.code !== 0) {
            return apiFail('issue view', r);
        }
        let info;
        try {
            info = JSON.parse(r.stdout.trim());
        } catch (e) {
            return die('issue view: could not parse API response');
        }
        process.stdout.write(
            '#' + info.number + ' ' + info.state + ' ' +
            (info.closed_at || '') + '\n' +
            'title : ' + info.title + '\n' +
            'by    : ' + info.user.login + '\n' +
            'url   : ' + info.html_url + '\n' +
            String(info.body || '').replace(/\s+$/, '') + '\n'
        );
        return 0;
    }
    if (sub === 'create') {
        const title = collectFlagValue(args, ['-t', '--title']);
        const body = collectFlagValue(args, ['-b', '--body']);
        if (!title) {
            return die('usage: xgit issue create -t <title> [-b <body>]');
        }
        const payload = { title: title, body: body || null };
        const r = apiCall('POST', base, JSON.stringify(payload));
        if (r.code !== 0) {
            return apiFail('issue create', r);
        }
        const url = brief('html_url', r.stdout);
        process.stdout.write('issue created: ' + url + '\n');
        return 0;
    }
    if (sub === 'close') {
        if (!args.length || !/^\d+$/.test(args[0])) {
            return die('usage: xgit issue close <number>');
        }
        const r = apiCall(
            'PATCH', base + '/' + args[0],
            JSON.stringify({ state: 'closed' })
        );
        if (r.code !== 0) {
            return apiFail('issue close', r);
        }
        process.stdout.write('#' + args[0] + ' closed\n');
        return 0;
    }
    if (sub === 'comment') {
        if (!args.length || !/^\d+$/.test(args[0])) {
            return die('usage: xgit issue comment <number> -m <text>');
        }
        const num = args.shift();
        const text = collectFlagValue(args, ['-m', '--message']);
        if (!text) {
            return die('issue comment: -m <text> is required');
        }
        const r = apiCall(
            'POST', base + '/' + num + '/comments',
            JSON.stringify({ body: text })
        );
        if (r.code !== 0) {
            return apiFail('issue comment', r);
        }
        process.stdout.write('comment added to #' + num + ': ' + brief('html_url', r.stdout) + '\n');
        return 0;
    }
    return die('issue: unknown subcommand: ' + sub + ' (list|view|create|close|comment)');
}

function cmdPull(rest) {
    const parsed = extractRemote(rest.slice());
    if (!parsed) {
        return die('pull: -r expects owner/repo');
    }
    const pair = resolveRepoPair(parsed.remote, 'pull');
    if (!pair) {
        return 1;
    }
    const args = parsed.args.slice();
    const sub = args.shift();
    const base = '/repos/' + pair.owner + '/' + pair.repo + '/pulls';
    if (!sub || sub === 'list') {
        const limit = parseLimit(args, 20);
        const r = apiCall('GET', base + '?state=open&per_page=50');
        if (r.code !== 0) {
            return apiFail('pull list', r);
        }
        let info;
        try {
            info = JSON.parse(r.stdout.trim());
        } catch (e) {
            return die('pull list: could not parse API response');
        }
        info.slice(0, limit).forEach(function (p) {
            process.stdout.write([
                '#' + p.number, p.state,
                p.head.ref + ' -> ' + p.base.ref,
                '"' + truncLine(p.title, 60) + '"',
            ].join('\t') + '\n');
        });
        return 0;
    }
    if (sub === 'view') {
        if (!args.length || !/^\d+$/.test(args[0])) {
            return die('usage: xgit pull view <number>');
        }
        const r = apiCall('GET', base + '/' + args[0]);
        if (r.code !== 0) {
            return apiFail('pull view', r);
        }
        let info;
        try {
            info = JSON.parse(r.stdout.trim());
        } catch (e) {
            return die('pull view: could not parse API response');
        }
        process.stdout.write(
            '#' + info.number + ' ' + info.state + '\n' +
            'title: ' + info.title + '\n' +
            'head : ' + info.head.ref + ' (' + info.head.repo.full_name + ')\n' +
            'base : ' + info.base.ref + '\n' +
            'url  : ' + info.html_url + '\n' +
            String((info.body || '')).replace(/\s+$/, '') + '\n'
        );
        return 0;
    }
    if (sub === 'create') {
        const head = collectFlagValue(args, ['--head']);
        const baseRef = collectFlagValue(args, ['--base']);
        const title = collectFlagValue(args, ['-t', '--title']);
        const body = collectFlagValue(args, ['-b', '--body']);
        const draft = hasFlag(args, ['--draft']);
        if (!head || !baseRef || !title) {
            return die('usage: xgit pull create --head <branch> --base <branch> -t <title> [-b <body>] [--draft]');
        }
        const payload = {
            title: title,
            head: head,
            base: baseRef,
            body: body || null,
            draft: draft,
        };
        const r = apiCall('POST', base, JSON.stringify(payload));
        if (r.code !== 0) {
            return apiFail('pull create', r);
        }
        process.stdout.write('pull request opened: ' + brief('html_url', r.stdout) + '\n');
        return 0;
    }
    if (sub === 'merge') {
        if (!args.length || !/^\d+$/.test(args[0])) {
            return die('usage: xgit pull merge <number> [--squash|--rebase]');
        }
        const num = args.shift();
        let method = 'merge';
        if (hasFlag(args, ['--squash'])) {
            method = 'squash';
        } else if (hasFlag(args, ['--rebase'])) {
            method = 'rebase';
        }
        const r = apiCall(
            'PUT', base + '/' + num + '/merge',
            JSON.stringify({ merge_method: method })
        );
        if (r.code !== 0) {
            return apiFail('pull merge', r);
        }
        process.stdout.write(brief('message', r.stdout) + '\n');
        return 0;
    }
    return die('pull: unknown subcommand: ' + sub + ' (list|view|create|merge)');
}

function assetUploadCall(url, filePath, label) {
    return withHeaderFile(function (headerFile) {
        const name = path.basename(filePath);
        const args = [
            '-sS',
            '--fail-with-body',
            '--max-time', '300',
            '-X', 'POST',
            '-H', '@' + headerFile,
            '-H', 'Content-Type: application/octet-stream',
            '--data-binary', '@' + filePath,
        ];
        args.push(String(url).replace(/\{\?[^}]*\}/, '') +
            '?name=' + encodeURIComponent(name) +
            (label ? '&label=' + encodeURIComponent(label) : ''));
        args.push('-w', '\n%{stderr}[xgit] HTTP %{http_code}\n');
        return sh('curl', args);
    });
}

function cmdRelease(rest) {
    const parsed = extractRemote(rest.slice());
    if (!parsed) {
        return die('release: -r expects owner/repo');
    }
    const pair = resolveRepoPair(parsed.remote, 'release');
    if (!pair) {
        return 1;
    }
    const args = parsed.args.slice();
    const sub = args.shift();
    const base = '/repos/' + pair.owner + '/' + pair.repo + '/releases';
    if (!sub || sub === 'list') {
        const limit = parseLimit(args, 20);
        const r = apiCall('GET', base);
        if (r.code !== 0) {
            return apiFail('release list', r);
        }
        let info;
        try {
            info = JSON.parse(r.stdout.trim());
        } catch (e) {
            return die('release list: could not parse API response');
        }
        info.slice(0, limit).forEach(function (rel) {
            process.stdout.write([
                rel.tag_name,
                '"' + (rel.name || '') + '"',
                (rel.assets || []).length + ' asset(s)',
                rel.draft ? 'draft' : rel.prerelease ? 'pre' : 'stable',
            ].join('\t') + '\n');
        });
        return 0;
    }
    if (sub === 'view') {
        if (!args.length) {
            return die('usage: xgit release view <tag>');
        }
        const r = apiCall('GET', base + '/tags/' + encodeURIComponent(args[0]));
        if (r.code !== 0) {
            return apiFail('release view', r);
        }
        let info;
        try {
            info = JSON.parse(r.stdout.trim());
        } catch (e) {
            return die('release view: could not parse API response');
        }
        process.stdout.write(
            'tag  : ' + info.tag_name + ' (' + info.name + ')\n' +
            'url  : ' + info.html_url + '\n' +
            'body : ' + truncLine((info.body || '').replace(/\s+$/, ''), 100) + '\n' +
            'assets:\n'
        );
        (info.assets || []).forEach(function (a) {
            process.stdout.write('  ' + a.name + '  ' + a.size + 'B\n  ' + a.browser_download_url + '\n');
        });
        return 0;
    }
    if (sub === 'create') {
        const tag = args.shift();
        const name = collectFlagValue(args, ['-t', '--title']);
        const notes = collectFlagValue(args, ['-n', '--notes']);
        const target = collectFlagValue(args, ['--target']);
        if (!tag || tag.indexOf('/') !== -1) {
            return die('usage: xgit release create <tag> [-t <name>] [-n <notes>] [--target <branch>]');
        }
        const payload = { tag_name: tag };
        if (name) {
            payload.name = name;
        }
        if (notes) {
            payload.body = notes;
        }
        if (target) {
            payload.target_commitish = target;
        }
        const r = apiCall('POST', base, JSON.stringify(payload));
        if (r.code !== 0) {
            return apiFail('release create', r);
        }
        process.stdout.write('release created: ' + brief('html_url', r.stdout) + '\n');
        return 0;
    }
    if (sub === 'asset') {
        const tag = args.shift();
        const file = args.shift();
        const label = collectFlagValue(args, ['-l', '--label']);
        if (!tag || !file) {
            return die('usage: xgit release asset <tag> <file> [-l <label>]');
        }
        const pre = apiCall('GET', base + '/tags/' + encodeURIComponent(tag));
        if (pre.code !== 0) {
            return apiFail('release asset', pre);
        }
        let rel;
        try {
            rel = JSON.parse(pre.stdout.trim());
        } catch (e) {
            return die('release asset: could not parse API response');
        }
        if (!rel.upload_url) {
            return die('release asset: no upload endpoint for ' + tag);
        }
        const exists = (rel.assets || []).some(function (a) { return a.name === path.basename(file); });
        if (exists) {
            return die('release asset: ' + path.basename(file) + ' already exists on ' + tag);
        }
        const up = assetUploadCall(rel.upload_url, file, label);
        if (up.code !== 0) {
            return apiFail('release asset', up);
        }
        process.stdout.write('asset uploaded: ' + path.basename(file) + ' -> ' + brief('browser_download_url', up.stdout) + '\n');
        return 0;
    }
    return die('release: unknown subcommand: ' + sub + ' (list|view|create|asset)');
}

function cmdGist(rest) {
    const args = rest.slice();
    const sub = args.shift();
    if (!sub || sub === 'list') {
        const isPublic = hasFlag(args, ['--public']);
        const limit = parseLimit(args, 20);
        let pathUrl = '/gists';
        if (isPublic) {
            pathUrl += '?public=true';
        }
        const r = apiCall('GET', pathUrl);
        if (r.code !== 0) {
            return apiFail('gist list', r);
        }
        let info;
        try {
            info = JSON.parse(r.stdout.trim());
        } catch (e) {
            return die('gist list: could not parse API response');
        }
        info.slice(0, limit).forEach(function (g) {
            const files = Object.keys(g.files || {}).join(',');
            process.stdout.write([
                g.id, isPublic ? 'public' : (g.public ? 'public' : 'secret'),
                '"' + truncLine(g.description || files, 60) + '"',
            ].join('\t') + '\n');
        });
        return 0;
    }
    if (sub === 'view') {
        if (!args.length) {
            return die('usage: xgit gist view <id>');
        }
        const r = apiCall('GET', '/gists/' + encodeURIComponent(args[0]));
        if (r.code !== 0) {
            return apiFail('gist view', r);
        }
        let info;
        try {
            info = JSON.parse(r.stdout.trim());
        } catch (e) {
            return die('gist view: could not parse API response');
        }
        process.stdout.write('gist ' + info.id + ': ' + (info.description || '') + '\n');
        Object.keys(info.files || {}).forEach(function (fname) {
            const f = info.files[fname];
            process.stdout.write(
                '\n=== ' + fname + ' ===\n' +
                (f.truncated ? '(content truncated on API)\n' : '') +
                String(f.content || '')
            );
        });
        return 0;
    }
    if (sub === 'create') {
        const desc = collectFlagValue(args, ['-d', '--description']);
        const isPublic = hasFlag(args, ['--public']);
        if (!args.length) {
            return die('usage: xgit gist create <file...|-> [-d <text>] [--public]');
        }
        const files = {};
        args.forEach(function (src) {
            let name, content;
            if (src === '-') {
                name = args.length > 1 ? 'stdin.txt' : 'gist-content.txt';
                content = fs.readFileSync(0, 'utf8');
            } else {
                name = path.basename(src);
                content = fs.readFileSync(src, 'utf8');
            }
            files[name] = { content: content };
        });
        const r = apiCall(
            'POST', '/gists',
            JSON.stringify({ description: desc || null, public: !!isPublic, files: files })
        );
        if (r.code !== 0) {
            return apiFail('gist create', r);
        }
        process.stdout.write('gist created: ' + brief('html_url', r.stdout) + '\n');
        return 0;
    }
    if (sub === 'delete') {
        if (!args.length) {
            return die('usage: xgit gist delete <id>');
        }
        const r = apiCall('DELETE', '/gists/' + encodeURIComponent(args[0]));
        if (r.code !== 0) {
            return apiFail('gist delete', r);
        }
        process.stdout.write('gist deleted: ' + args[0] + '\n');
        return 0;
    }
    return die('gist: unknown subcommand: ' + sub + ' (list|view|create|delete)');
}

function cmdBranch(rest) {
    const parsed = extractRemote(rest.slice());
    if (!parsed) {
        return die('branch: -r expects owner/repo');
    }
    const pair = resolveRepoPair(parsed.remote, 'branch');
    if (!pair) {
        return 1;
    }
    const args = parsed.args.slice();
    const sub = args.shift();
    const base = '/repos/' + pair.owner + '/' + pair.repo;
    if (sub === 'list') {
        const limit = parseLimit(args, 30);
        const r = apiCall('GET', base + '/branches?per_page=100');
        if (r.code !== 0) {
            return apiFail('branch list', r);
        }
        let info;
        try {
            info = JSON.parse(r.stdout.trim());
        } catch (e) {
            return die('branch list: could not parse API response');
        }
        info.slice(0, limit).forEach(function (b) {
            process.stdout.write(b.name + '\t' + b.commit.sha.slice(0, 7) + '\n');
        });
        return 0;
    }
    if (sub === 'create') {
        const name = args.shift();
        const from = collectFlagValue(args, ['--from']);
        if (!name || !/^[A-Za-z0-9._/-]+$/.test(name)) {
            return die('usage: xgit branch create <name> [--from <ref>]');
        }
        if (from && !/^[A-Za-z0-9._/-]+$/.test(from)) {
            return die('branch create: invalid --from ref: ' + from);
        }
        const refUrl = base + '/git/ref/heads/' + encodeURIComponent(from || 'master');
        const pre = apiCall('GET', refUrl);
        if (pre.code !== 0) {
            return apiFail('branch create (--from ref)', pre);
        }
        let refInfo;
        try {
            refInfo = JSON.parse(pre.stdout.trim());
        } catch (e) {
            return die('branch create: could not parse API response');
        }
        const sha = refInfo.object && refInfo.object.sha;
        if (!sha) {
            return die('branch create: could not resolve source branch sha');
        }
        const r = apiCall(
            'POST', base + '/git/refs',
            JSON.stringify({ ref: 'refs/heads/' + name, sha: sha })
        );
        if (r.code !== 0) {
            return apiFail('branch create', r);
        }
        process.stdout.write('branch created: ' + name + ' (from ' + (from || 'master') + ')\n');
        return 0;
    }
    if (sub === 'delete') {
        const name = args.shift();
        if (!name || !/^[A-Za-z0-9._/-]+$/.test(name)) {
            return die('usage: xgit branch delete <name>');
        }
        const r = apiCall('DELETE', base + '/git/refs/heads/' + encodeURIComponent(name));
        if (r.code !== 0) {
            return apiFail('branch delete', r);
        }
        process.stdout.write('branch deleted: ' + name + '\n');
        return 0;
    }
    return die('branch: unknown subcommand: ' + (sub || '') + ' (list|create|delete)');
}

function cmdSearch(rest) {
    const args = rest.slice();
    const type = args.shift();
    const query = args.length ? args.join(' ') : null;
    const types = [
        'repositories', 'issues', 'code', 'users', 'pull-requests',
    ];
    const aliases = {
        repos: 'repositories',
        issue: 'issues',
        pr: 'pull-requests',
        pull: 'pull-requests',
    };
    if (!type || !query) {
        return die('usage: xgit search <repos|issues|code|users> <query>');
    }
    const t = aliases[type] || type;
    if (types.indexOf(t) === -1) {
        return die('search: unknown type: ' + type + ' (try repos|issues|code|users)');
    }
    const r = apiCall(
        'GET',
        '/search/' + t + '?q=' + encodeURIComponent(query) + '&per_page=10'
    );
    if (r.code !== 0) {
        return apiFail('search', r);
    }
    let info;
    try {
        info = JSON.parse(r.stdout.trim());
    } catch (e) {
        return die('search: could not parse API response');
    }
    process.stdout.write('total: ' + (info.total_count || (info.items || []).length) + '\n');
    (info.items || []).slice(0, 10).forEach(function (item) {
        if (t === 'repositories') {
            process.stdout.write(item.full_name + '\t\u2605' + (item.stargazers_count || 0) + '\t' + truncLine(item.description || '', 60) + '\n');
        } else if (t === 'issues') {
            process.stdout.write((item.repository_url || '').replace(/^.*\/repos\//, '') + '#' + item.number + '\t' + item.state + '\t' + truncLine(item.title || '', 60) + '\n');
        } else if (t === 'code') {
            process.stdout.write((item.repository || {}).full_name + ':' + item.path + '\n');
        } else if (t === 'users') {
            process.stdout.write(item.login + '\n');
        } else {
            process.stdout.write(JSON.stringify(item).slice(0, 140) + '\n');
        }
    });
    return 0;
}

function cmdRate() {
    const r = apiCall('GET', '/rate_limit');
    if (r.code !== 0) {
        return apiFail('rate', r);
    }
    let info;
    try {
        info = JSON.parse(r.stdout.trim());
    } catch (e) {
        return die('rate: could not parse API response');
    }
    const core = (info.resources || {}).core || {};
    const reset = core.reset ? new Date(core.reset * 1000).toISOString() : '?';
    process.stdout.write(
        'core   : ' + (core.remaining ?? '-') + ' / ' + (core.limit ?? '-') + ' (resets ' + reset + ')\n' +
        'search : ' + (info.resources.search || {}).remaining + ' / ' + (info.resources.search || {}).limit + '\n'
    );
    return 0;
}

function cmdRepo(rest) {
    const args = rest.slice();
    const sub = args.shift();
    if (sub === 'fork') {
        const full = args[0] && resolveRepoArg(args[0]);
        if (!full) {
            return die('usage: xgit repo fork <owner/repo>');
        }
        const parts = full.split('/');
        const r = apiCall('POST', '/repos/' + parts[0] + '/' + parts[1] + '/forks');
        if (r.code !== 0) {
            return apiFail('repo fork', r);
        }
        process.stdout.write('fork created: ' + brief('full_name', r.stdout) + ' -> ' + brief('html_url', r.stdout) + '\n');
        return 0;
    }
    if (sub === 'star' || sub === 'unstar') {
        const full = args[0] && resolveRepoArg(args[0]);
        if (!full) {
            return die('usage: xgit repo ' + sub + ' <owner/repo>');
        }
        const parts = full.split('/');
        const r = apiCall(
            sub === 'star' ? 'PUT' : 'DELETE',
            '/user/starred/' + parts[0] + '/' + parts[1]
        );
        if (r.code !== 0) {
            return apiFail('repo ' + sub, r);
        }
        process.stdout.write(sub + ': ' + full + '\n');
        return 0;
    }
    return die('repo: unknown subcommand: ' + (sub || '') + ' (star|unstar|fork)');
}

function main(argv) {
    if (!argv.length || argv[0] === 'help' || argv[0] === '--help' || argv[0] === '-h') {
        console.log(usage());
        return 0;
    }
    if (argv[0] === '-V' || argv[0] === '--version' || argv[0] === 'version') {
        console.log(VERSION);
        return 0;
    }
    switch (argv[0]) {
        case 'token':
            return cmdToken();
        case 'status':
            return cmdStatus();
        case 'init':
            return cmdInit(argv.slice(1));
        case 'add':
            return cmdAdd(argv.slice(1));
        case 'commit':
            return cmdCommit(argv.slice(1));
        case 'clone':
            return cmdClone(argv.slice(1));
        case 'read':
            return cmdRead(argv.slice(1));
        case 'workflow':
            return cmdWorkflow(argv.slice(1));
        case 'issue':
            return cmdIssue(argv.slice(1));
        case 'pull':
            return cmdPull(argv.slice(1));
        case 'release':
            return cmdRelease(argv.slice(1));
        case 'gist':
            return cmdGist(argv.slice(1));
        case 'branch':
            return cmdBranch(argv.slice(1));
        case 'search':
            return cmdSearch(argv.slice(1));
        case 'rate':
            return cmdRate();
        case 'repo':
            return cmdRepo(argv.slice(1));
        case 'create':
            return cmdCreate(argv.slice(1));
        case 'rename':
            return cmdRename(argv.slice(1));
        case 'push':
            return cmdPush(argv.slice(1));
        case 'api':
            return cmdApi(argv.slice(1));
        default:
            process.stderr.write('xgit: unknown command: ' + argv[0] + '\n' + usage() + '\n');
            return 2;
    }
}

if (require.main === module) {
    process.exitCode = main(process.argv.slice(2));
}

module.exports = { main, VERSION };
