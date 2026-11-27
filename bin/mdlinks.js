#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { run } from '../src/cli.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const { code, out, err } = await run(process.argv.slice(2), { version: pkg.version });
if (out) process.stdout.write(out);
if (err) process.stderr.write(err);
process.exitCode = code;
