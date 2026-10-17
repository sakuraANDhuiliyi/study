// Temporary, fingerprinted security backports. See patches/build-hardening.json and its licenses.
const { readFileSync, writeFileSync, realpathSync } = require('node:fs');
const { resolve, sep } = require('node:path');
const { createHash } = require('node:crypto');
const root = resolve(__dirname, '..');
const manifest = require('../patches/build-hardening.json');
const digest = (text) => createHash('sha256').update(text).digest('hex');
function check(apply = false) {
  const lock = JSON.parse(readFileSync(resolve(root, 'package-lock.json'), 'utf8'));
  let checked = 0;
  for (const patch of manifest.patches) {
    const copies = Object.keys(lock.packages).filter(
      (path) => path === 'node_modules/' + patch.package || path.endsWith('/node_modules/' + patch.package),
    );
    if (!copies.length) throw new Error('Required build dependency missing: ' + patch.package);
    for (const copy of copies) {
      const base = resolve(root, copy);
      const file = realpathSync(resolve(base, patch.file));
      if (!file.startsWith(resolve(root, 'node_modules') + sep))
        throw new Error('Build patch path escapes isolated dependencies');
      if (JSON.parse(readFileSync(resolve(base, 'package.json'), 'utf8')).version !== patch.version)
        throw new Error('Unreviewed build dependency version: ' + patch.package);
      let text = readFileSync(file, 'utf8');
      const hash = digest(text);
      if (hash === patch.afterSha256) {
        checked++;
        continue;
      }
      if (!apply || hash !== patch.beforeSha256)
        throw new Error('Build dependency fingerprint mismatch: ' + patch.package + '/' + patch.file);
      for (const change of patch.changes) {
        if (text.split(change.before).length !== 2) throw new Error('Build patch context mismatch');
        text = text.replace(change.before, change.after);
      }
      if (digest(text) !== patch.afterSha256) throw new Error('Build patch result mismatch');
      writeFileSync(file, text);
      checked++;
    }
  }
  return { patchedFilesVerified: checked, backportedAdvisories: manifest.advisories };
}
module.exports = { check };
if (require.main === module) console.log(JSON.stringify(check(!process.argv.includes('--check'))));
