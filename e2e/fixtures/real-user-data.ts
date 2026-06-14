import { existsSync, statSync } from 'fs';
import { homedir } from 'os';
import path from 'path';

/**
 * Mirror app/main.js getUserDataDir() / src/config.get_user_data_dir() for the
 * PRODUCTION (no-override) location. Computed independently of the code under
 * test on purpose: if a keystone bug broke getUserDataDir(), sharing the prod
 * helper would make both the app and the assertion wrong in the same direction
 * and the "real dir untouched" check would pass falsely.
 */
export function realUserDataDir(): string {
  if (process.platform === 'darwin') {
    return path.join(homedir(), 'Library', 'Application Support', 'stenoai');
  }
  if (process.platform === 'win32') {
    const base = process.env.APPDATA || path.join(homedir(), 'AppData', 'Roaming');
    return path.join(base, 'stenoai');
  }
  const base = process.env.XDG_DATA_HOME || path.join(homedir(), '.local', 'share');
  return path.join(base, 'stenoai');
}

/** Stat signature (exists + mtime + size) so a test can prove a path was untouched. */
export function fileSig(p: string): string {
  if (!existsSync(p)) return 'absent';
  const s = statSync(p);
  return `${s.mtimeMs}:${s.size}`;
}
