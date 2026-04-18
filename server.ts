import express from 'express';
import fs from 'node:fs';
import path from 'node:path';

const app = express();
const PORT = 3000;
const SCANS_DIR = path.join(process.cwd(), 'scans');

if (!fs.existsSync(SCANS_DIR)) {
  fs.mkdirSync(SCANS_DIR);
}

app.use(express.json());

app.post('/save-scan', (req, res) => {
  const { last5, location } = req.body;
  if (last5) {
    const fileName = location ? `ids_${location}.bin` : 'all_scans.bin';
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

app.listen(PORT, 'localhost', () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
