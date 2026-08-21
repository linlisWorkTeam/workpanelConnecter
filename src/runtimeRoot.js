import path from 'node:path';
import { fileURLToPath } from 'node:url';

function isPackagedExecutable() {
  return typeof CONNECTER_PACKAGED !== 'undefined' && CONNECTER_PACKAGED === true;
}

export function runtimeRoot(importMetaUrl, sourceParents = 0) {
  if (isPackagedExecutable()) {
    return path.dirname(process.execPath);
  }

  let current = path.dirname(fileURLToPath(importMetaUrl));
  for (let index = 0; index < sourceParents; index += 1) {
    current = path.dirname(current);
  }
  return current;
}

export function relayResourceDir(importMetaUrl) {
  if (isPackagedExecutable()) {
    return path.join(path.dirname(process.execPath), 'resources', 'relay');
  }
  return path.dirname(fileURLToPath(importMetaUrl));
}
