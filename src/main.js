#!/usr/bin/env node
'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const VERSION = '1.0.1';
const API = 'https://api.github.com';

function usage() {
    return [
        'Usage: xgit <command> [options]',
        '',
        'GitHub full-access helper: create, rename, push and raw REST API via curl.',
        '',
        'Commands:',
        '  token                              Verify the stored GitHub token (gh auth / GH_TOKEN)',
        '  status                             Token + current repo/remote status',
        '  create <name> [options]            Create a GitHub repo; scaffold a Noxs package',
        '  rename <new-name>                  Rename origin repo and fix the local remote',
        '  push [git-push-options...]         Thin authenticated wrapper around git push',
        '  api [METHOD] <path> [-d <json>]    Raw GitHub REST call (curl), HTTP status on stderr',
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
            'X-GitHub-Api-Version: 2022-11-28',
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
