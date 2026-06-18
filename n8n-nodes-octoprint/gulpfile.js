// Copies node/credential icons (svg/png) into dist/ after `tsc`.
// Run directly with `node gulpfile.js` (no gulp CLI needed) so the build has
// one fewer dependency.
const fs = require('fs');
const path = require('path');

function copyIcons(srcDir, destDir) {
  if (!fs.existsSync(srcDir)) return;
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const src = path.join(srcDir, entry.name);
    const dest = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyIcons(src, dest);
    } else if (/\.(svg|png)$/i.test(entry.name)) {
      fs.mkdirSync(destDir, { recursive: true });
      fs.copyFileSync(src, dest);
      console.log(`icon: ${path.relative('.', dest)}`);
    }
  }
}

copyIcons(path.resolve('nodes'), path.resolve('dist', 'nodes'));
copyIcons(path.resolve('credentials'), path.resolve('dist', 'credentials'));
