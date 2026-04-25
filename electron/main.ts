import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Portable logic: Get the directory where the EXE is located
const getBaseDir = () => {
  if (process.env.PORTABLE_EXECUTABLE_DIR) {
    return process.env.PORTABLE_EXECUTABLE_DIR
  }
  if (app.isPackaged) {
    return path.dirname(process.executablePath)
  }
  return process.cwd()
}

const BASE_DIR = getBaseDir()
const SCANS_DIR = path.join(BASE_DIR, 'scans')
const DATA_DIR = path.join(BASE_DIR, 'data')

const ensureStorageDirs = () =>
  Promise.all([
    fs.promises.mkdir(SCANS_DIR, { recursive: true }),
    fs.promises.mkdir(DATA_DIR, { recursive: true }),
  ])

const storageReady = ensureStorageDirs()
const SCAN_FILE_PREFIX = 'ids_'
const SCAN_FILE_SUFFIX = '.bin'

const getScanFilePath = (location?: string) =>
  path.join(SCANS_DIR, `${SCAN_FILE_PREFIX}${location || 'unknown'}${SCAN_FILE_SUFFIX}`)

const sanitizeScanName = (rawName: string) => rawName.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')

// Redirect all Electron data (including LocalStorage) to the local 'data' folder
if (app.isPackaged || process.env.PORTABLE_EXECUTABLE_DIR) {
  app.setPath('userData', DATA_DIR)
  app.setPath('sessionData', DATA_DIR)
}

// The built directory structure
//
// ├─┬ dist
// │ └── index.html
// ├─┬ dist-electron
// │ ├── main.js
// │ └── preload.js
//
process.env.APP_ROOT = path.join(__dirname, '..')

// 🚧 Wait for Vite dev server to start
export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

let win: BrowserWindow | null

function createWindow() {
  win = new BrowserWindow({
    icon: path.join(process.env.VITE_PUBLIC, 'electron-vite.svg'),
    show: false,
    backgroundColor: '#f8fafc',
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
    },
  })

  win.once('ready-to-show', () => {
    win?.show()
  })

  // Test active push message to Renderer-process.
  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('main-process-message', (new Date).toLocaleString())
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    // win.loadFile('dist/index.html')
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }
}

// IPC Handlers
ipcMain.handle('save-scan', async (_event, { last5, location }) => {
  if (!last5) return { success: false, error: 'No last5 provided' }

  const filePath = getScanFilePath(location)
  
  const buffer = Buffer.alloc(2)
  buffer.writeUInt16LE(parseInt(last5, 10), 0)
  
  try {
    await storageReady
    fs.appendFileSync(filePath, buffer)
    return { success: true }
  } catch (err) {
    console.error('Failed to write to file:', err)
    return { success: false, error: err.message }
  }
})

ipcMain.handle('has-scan-data', async (_event, { location }) => {
  if (!location || typeof location !== 'string') {
    return { success: false, error: 'Invalid location', hasData: false }
  }

  const filePath = getScanFilePath(location)

  try {
    await storageReady
    const stat = await fs.promises.stat(filePath)
    return { success: true, hasData: stat.size > 0 }
  } catch (err) {
    const error = err as NodeJS.ErrnoException
    if (error.code === 'ENOENT') {
      return { success: true, hasData: false }
    }
    console.error('Failed to check scan file:', err)
    return { success: false, hasData: false, error: error.message }
  }
})

ipcMain.handle('delete-scan-value', async (_event, { location, last5 }) => {
  if (!location || typeof location !== 'string') {
    return { success: false, error: 'Invalid location', removed: false }
  }
  if (!last5 || typeof last5 !== 'string') {
    return { success: false, error: 'Invalid last5', removed: false }
  }

  const filePath = getScanFilePath(location)
  const target = Number.parseInt(last5, 10)
  if (Number.isNaN(target)) {
    return { success: false, error: 'Invalid number', removed: false }
  }

  try {
    await storageReady
    const file = await fs.promises.readFile(filePath)

    if (file.length % 2 !== 0) {
      return { success: false, error: 'Invalid binary data', removed: false }
    }

    let removeOffset = -1
    for (let offset = file.length - 2; offset >= 0; offset -= 2) {
      if (file.readUInt16LE(offset) === target) {
        removeOffset = offset
        break
      }
    }

    if (removeOffset < 0) {
      return { success: true, removed: false }
    }

    const rewritten = Buffer.concat([
      file.subarray(0, removeOffset),
      file.subarray(removeOffset + 2),
    ])

    await fs.promises.writeFile(filePath, rewritten)
    return { success: true, removed: true }
  } catch (err) {
    const error = err as NodeJS.ErrnoException
    if (error.code === 'ENOENT') {
      return { success: true, removed: false }
    }
    console.error('Failed to delete scan value:', err)
    return { success: false, error: error.message, removed: false }
  }
})

ipcMain.handle('clear-all-scans', async () => {
  try {
    await storageReady
    const entries = await fs.promises.readdir(SCANS_DIR, { withFileTypes: true })

    const targets = entries
      .filter((entry) => entry.isFile() && entry.name.startsWith(SCAN_FILE_PREFIX) && entry.name.endsWith(SCAN_FILE_SUFFIX))
      .map((entry) => fs.promises.unlink(path.join(SCANS_DIR, entry.name)))

    await Promise.all(targets)
    return { success: true }
  } catch (err) {
    const error = err as Error
    console.error('Failed to clear scan files:', err)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('rename-scan-file', async (_event, { location, newName }) => {
  if (!location || typeof location !== 'string') {
    return { success: false, error: 'Invalid location' }
  }
  if (!newName || typeof newName !== 'string') {
    return { success: false, error: 'Invalid newName' }
  }

  const sanitizedName = sanitizeScanName(newName)
  if (!sanitizedName) {
    return { success: false, error: 'New name is empty' }
  }

  const sourcePath = getScanFilePath(location)
  const destinationPath = getScanFilePath(sanitizedName)

  if (sourcePath === destinationPath) {
    return { success: true, newName: sanitizedName }
  }

  try {
    await storageReady

    try {
      await fs.promises.access(destinationPath, fs.constants.F_OK)
      return { success: false, error: 'Destination already exists' }
    } catch (err) {
      const accessError = err as NodeJS.ErrnoException
      if (accessError.code !== 'ENOENT') {
        throw accessError
      }
    }

    await fs.promises.rename(sourcePath, destinationPath)
    return { success: true, newName: sanitizedName }
  } catch (err) {
    const error = err as NodeJS.ErrnoException
    if (error.code === 'ENOENT') {
      return { success: false, error: 'Source file not found' }
    }
    console.error('Failed to rename scan file:', err)
    return { success: false, error: error.message }
  }
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
    win = null
  }
})

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

app.whenReady().then(() => {
  createWindow()
})
