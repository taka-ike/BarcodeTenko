import { app, BrowserWindow } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import fs from 'node:fs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SCANS_DIR = path.join(process.cwd(), 'scans')

if (!fs.existsSync(SCANS_DIR)) {
  fs.mkdirSync(SCANS_DIR)
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

// Start Express Server
function startExpress() {
  const appExpress = express()
  const PORT = 3030

  appExpress.use(express.json())

  appExpress.post('/save-scan', (req, res) => {
    const { last5, location } = req.body;
    if (last5) {
      const fileName = `ids_${location}.bin`;
      const filePath = path.join(SCANS_DIR, fileName);
      
      const buffer = Buffer.alloc(2);
      buffer.writeUInt16LE(parseInt(last5, 10), 0);
      
      try {
        fs.appendFileSync(filePath, buffer);
        res.status(200).send({ success: true });
      } catch (err) {
        console.error('Failed to write to file:', err);
        res.status(500).send({ success: false });
      }
    } else {
      res.status(400).send({ success: false });
    }
  });

  appExpress.listen(PORT, 'localhost', () => {
    console.log(`Server running on http://localhost:${PORT}`)
  })
}

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
  startExpress()
  createWindow()
})
