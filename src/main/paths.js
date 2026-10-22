import { app } from 'electron'
import fs from 'fs'
import path from 'path'

// Per-user data folder (settings.json, cookies.json, library.json): Documents/Kaizen.
// KAIZEN_DATA_DIR relocates it (automated tests run against a throw-away folder, so they never touch
// the real settings or library).
const dataDir = process.env.KAIZEN_DATA_DIR
  ? path.resolve(process.env.KAIZEN_DATA_DIR)
  : path.join(app.getPath('documents'), 'Kaizen')

export function getDataDir() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true })
  return dataDir
}
