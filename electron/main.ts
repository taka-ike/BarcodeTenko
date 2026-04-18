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

// Redirect all Electron data (including LocalStorage) to the local 'data' folder
if (app.isPackaged || process.env.PORTABLE_EXECUTABLE_DIR) {
  app.setPath('userData', DATA_DIR)
  app.setPath('sessionData', DATA_DIR)
}

if (!fs.existsSync(SCANS_DIR)) {
  fs.mkdirSync(SCANS_DIR, { recursive: true })
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
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
    },
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

  const fileName = `ids_${location || 'unknown'}.bin`
  const filePath = path.join(SCANS_DIR, fileName)
  
  const buffer = Buffer.alloc(2)
  buffer.writeUInt16LE(parseInt(last5, 10), 0)
  
  try {
    fs.appendFileSync(filePath, buffer)
    return { success: true }
  } catch (err) {
    console.error('Failed to write to file:', err)
    return { success: false, error: err.message }
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
