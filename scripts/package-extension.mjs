#!/usr/bin/env node
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { EXTENSION_PACKAGE_FILES, ROOT_PACKAGE_FILES } from './release-files.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const extensionDir = join(root, 'extension');
const distDir = join(root, 'dist');
const manifest = JSON.parse(await import('node:fs/promises').then(fs => fs.readFile(join(extensionDir, 'manifest.json'), 'utf8')));

const targets = process.argv.slice(2);
const requestedTargets = targets.length > 0 ? targets : ['chrome', 'edge'];
const validTargets = new Set(['chrome', 'edge']);

for (const target of requestedTargets) {
  if (!validTargets.has(target)) {
    throw new Error(`Unknown package target "${target}". Use "chrome" or "edge".`);
  }
}

for (const file of EXTENSION_PACKAGE_FILES) {
  if (!existsSync(join(extensionDir, file))) {
    throw new Error(`Package file is missing: ${file}`);
  }
}
for (const file of ROOT_PACKAGE_FILES) {
  if (!existsSync(join(root, file))) {
    throw new Error(`Root package file is missing: ${file}`);
  }
}

mkdirSync(distDir, { recursive: true });

for (const target of requestedTargets) {
  const output = join(distDir, `browse-loom-${target}-${manifest.version}.zip`);
  rmSync(output, { force: true });

  const result = spawnSync('zip', ['-X', '-q', output, ...EXTENSION_PACKAGE_FILES], {
    cwd: extensionDir,
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    throw new Error(`Failed to create ${relative(root, output)}:\n${result.stderr || result.stdout}`);
  }

  const rootFilesResult = spawnSync('zip', ['-X', '-q', '-j', output, ...ROOT_PACKAGE_FILES.map(file => join(root, file))], {
    cwd: root,
    encoding: 'utf8',
  });

  if (rootFilesResult.status !== 0) {
    throw new Error(`Failed to add root license files to ${relative(root, output)}:\n${rootFilesResult.stderr || rootFilesResult.stdout}`);
  }

  console.log(`Created ${relative(root, output)}`);
}
