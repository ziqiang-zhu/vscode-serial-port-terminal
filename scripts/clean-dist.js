const fs = require('fs');

fs.rmSync('dist', { recursive: true, force: true });
fs.rmSync('.tmp-build', { recursive: true, force: true });
