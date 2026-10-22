import fs from 'fs'
import { join } from 'path'
import { spawn } from 'child_process'

// Electron-free helpers to run the bundled ffmpeg / ffprobe (so they can be unit-tested with plain
// Node as well as used by the main process).

// ffmpeg / ffprobe ship inside the app (resources/bin when installed, vendor/ffmpeg in a checkout),
// so nothing has to be installed on the PC; fall back to the PATH if they are missing.
export function resolveTool(name, { resourcesPath = process.resourcesPath, appPath = process.cwd() } = {}) {
  const file = process.platform === 'win32' ? `${name}.exe` : name
  const candidates = []
  if (resourcesPath) candidates.push(join(resourcesPath, 'bin', file))
  if (appPath) candidates.push(join(appPath, 'vendor', 'ffmpeg', file))
  return candidates.find((candidate) => fs.existsSync(candidate)) || name
}

// Runs a process (no shell) and resolves with its stdout; rejects on a non-zero exit, on a spawn
// error and when it takes longer than timeoutMs (the process is killed).
export function runProcess(cmd, args, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { shell: false, windowsHide: true })
    const timer = setTimeout(() => {
      proc.kill()
      reject(new Error(`${cmd} timed out after ${timeoutMs / 1000}s`))
    }, timeoutMs)
    let out = ''
    let err = ''
    proc.stdout.on('data', (d) => (out += d))
    proc.stderr.on('data', (d) => (err += d))
    proc.on('error', (e) => {
      clearTimeout(timer)
      reject(e)
    })
    proc.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve(out)
      else reject(new Error(`${cmd} exited with ${code}: ${err.slice(-300)}`))
    })
  })
}

// `-user_agent` is an option of ffmpeg's HTTP protocol: ffmpeg/ffprobe refuse it for a local file.
// It tells our own backend that the request comes from ffmpeg (see the /streamfile route).
export const httpInputArgs = (input) => (/^https?:\/\//i.test(String(input)) ? ['-user_agent', 'KaizenSubs'] : [])
