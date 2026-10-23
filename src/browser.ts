import { spawn } from 'node:child_process';

export function browserOpenArgs(platform: NodeJS.Platform, url: string, env: NodeJS.ProcessEnv = process.env): { command: string; args: string[] } {
  if (platform === 'darwin') return { command: 'open', args: [url] };
  if (platform === 'win32' || env.WSL_DISTRO_NAME) return { command: 'powershell.exe', args: ['-NoProfile', '-Command', 'Start-Process', url] };
  return { command: 'xdg-open', args: [url] };
}

/** Best-effort. The caller already has the URL if no browser opens. */
export function openBrowser(url: string, platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): void {
  const spec = browserOpenArgs(platform, url, env);
  try {
    const child = spawn(spec.command, spec.args, { stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.unref();
  } catch {
    // The URL is already printed.
  }
}

/** Production opens a browser. Tests and smoke set DEVIN_LOGIN_OPEN=0. */
export function loginOpener(env: NodeJS.ProcessEnv = process.env): (url: string) => void {
  const value = env.DEVIN_LOGIN_OPEN?.trim().toLowerCase();
  if (value === '0' || value === 'false' || value === 'no' || value === 'off') return () => {};
  return url => { openBrowser(url, process.platform, env); };
}
