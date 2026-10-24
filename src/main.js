#!/usr/bin/env node
'use strict';

const VERSION = '1.0.0';

function usage() {
    return [
        'Usage: a [OPTIONS] [ARGS...]',
        '',
        'A Noxs package built with the NX Package System.',
        '',
        'Options:',
        '  -n, --no-newline   Print ARGS joined by spaces without a trailing newline',
        '  -V, --version      Print version and exit',
        '  -h, --help         Show this help and exit',
        '',
        'ARGS are printed as a single line (default: empty line).',
    ].join('\n');
}

function main(argv) {
    let noNewline = false;
    const operands = [];

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--') {
            operands.push(...argv.slice(i + 1));
            break;
        }
        if (arg === '-h' || arg === '--help') {
            console.log(usage());
            return 0;
        }
        if (arg === '-V' || arg === '--version') {
            console.log(VERSION);
            return 0;
        }
        if (arg === '-n' || arg === '--no-newline') {
            noNewline = true;
            continue;
        }
        if (arg === '-') {
            operands.push(arg);
            break;
        }
        if (arg.startsWith('-')) {
            process.stderr.write('a: unknown option: ' + arg + '\n' + usage() + '\n');
            return 2;
        }
        operands.push(...argv.slice(i));
        break;
    }

    process.stdout.write(operands.join(' ') + (noNewline ? '' : '\n'));
    return 0;
}

if (require.main === module) {
    process.exitCode = main(process.argv.slice(2));
}

module.exports = { main, VERSION };
