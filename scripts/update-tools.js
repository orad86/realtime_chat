#!/usr/bin/env node

/**
 * Update @orad86/ai-aero-tools to the latest version from the local git repo.
 * Usage: node scripts/update-tools.js
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const TOOLS_REPO = '/Users/oradeldar/projects/ai-aero-tools';
const REALTIME_CHAT_ROOT = __dirname;
const TARBALL_PATTERN = /^orad86-ai-aero-tools-.*\.tgz$/;

function run(cmd, cwd) {
  console.log(`\n🔧 Running: ${cmd}`);
  try {
    const result = execSync(cmd, { cwd, encoding: 'utf8', stdio: 'inherit' });
    return result;
  } catch (err) {
    console.error(`❌ Failed to run: ${cmd}`);
    console.error(err.message);
    process.exit(1);
  }
}

function findTarball(dir) {
  const files = fs.readdirSync(dir);
  const matches = files.filter(f => TARBALL_PATTERN.test(f));
  if (matches.length === 0) {
    throw new Error('No ai-aero-tools tarball found in ' + dir);
  }
  if (matches.length > 1) {
    console.log('📋 Multiple tarballs found:', matches);
    // Sort by version number and pick the newest
    matches.sort((a, b) => {
      const versionA = a.match(/orad86-ai-aero-tools-(.*)\.tgz$/)[1];
      const versionB = b.match(/orad86-ai-aero-tools-(.*)\.tgz$/)[1];
      return versionB.localeCompare(versionA); // Sort descending (newest first)
    });
    console.log('✅ Using newest version:', matches[0]);
  }
  return path.join(dir, matches[0]);
}

function main() {
  console.log('🚀 Updating @orad86/ai-aero-tools to latest local build...\n');

  // 1. Clean and build the tools repo
  run('npm run clean', TOOLS_REPO);
  run('npm run build', TOOLS_REPO);
  run('npm pack', TOOLS_REPO);

  // 2. Find the generated tarball
  const tarballPath = findTarball(TOOLS_REPO);
  console.log(`📦 Found tarball: ${tarballPath}`);

  // 3. Uninstall old version (if present) and install new tarball
  try {
    run('npm uninstall @orad86/ai-aero-tools', REALTIME_CHAT_ROOT);
  } catch (_) {
    // ignore if not installed
  }
  run(`npm install "${tarballPath}"`, REALTIME_CHAT_ROOT);

  // 4. Verify the tools list
  console.log('\n✅ Verifying installed tools...');
  const tools = execSync(
    'node -e "console.log(JSON.stringify(require(\'@orad86/ai-aero-tools\').tools.map((t,i)=>({i,type:t?.type,fnName:t?.function?.name})),null,2))"',
    { cwd: REALTIME_CHAT_ROOT, encoding: 'utf8' }
  );
  console.log(tools);

  console.log('\n🎉 @orad86/ai-aero-tools updated successfully!');
}

if (require.main === module) {
  main();
}
