// Describes a built web app for over-the-air updates (see modules/d7t-native/ios/D7TOta.swift).
//   node scripts/make-ota.js <web-dir> <channel-branch>
// Writes <web-dir>/ota.json (what this build is and where newer ones are published; it ships inside
// the IPA) and <web-dir>/manifest.json (every file with its SHA-256; it is what the app downloads).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Bump together with `shellVersion` in D7TOta.swift when the web app starts to need new native code:
// older IPAs then keep the web app they have instead of loading one they cannot run.
const SHELL = 1;

const [dir, channel] = process.argv.slice(2);
if (!dir || !channel) {
  console.error('usage: node scripts/make-ota.js <web-dir> <channel-branch>');
  process.exit(1);
}
const version = process.env.GITHUB_SHA || 'dev';
const repo = process.env.GITHUB_REPOSITORY || 'byd7my/d7my-tv';
const SKIP = new Set(['ota.json', 'manifest.json', '.DS_Store']);

// The page reads this to know which build it is (and to tell when a newer one is waiting).
fs.writeFileSync(path.join(dir, 'version.json'), JSON.stringify({ version }));

const files = [];
(function walk(rel) {
  for (const name of fs.readdirSync(path.join(dir, rel)).sort()) {
    const relPath = rel ? `${rel}/${name}` : name;
    const full = path.join(dir, relPath);
    if (fs.statSync(full).isDirectory()) walk(relPath);
    else if (!SKIP.has(name)) {
      const sha256 = crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex');
      files.push({ path: relPath, sha256 });
    }
  }
})('');

fs.writeFileSync(path.join(dir, 'ota.json'), JSON.stringify({ repo, channel, version }));
fs.writeFileSync(
  path.join(dir, 'manifest.json'),
  JSON.stringify({ version, shell: SHELL, built: new Date().toISOString(), files })
);
console.log(`OTA manifest: ${files.length} files, version ${version}, channel ${channel}`);
