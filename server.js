const express = require('express');
const multer  = require('multer');
const ffmpeg  = require('fluent-ffmpeg');
const cors    = require('cors');
const fs      = require('fs');
const path    = require('path');
const os      = require('os');

const app    = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 300 * 1024 * 1024 } });

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// GET /health
app.get('/health', (req, res) => res.json({ ok: true }));

// POST /render
app.post('/render', upload.array('frames'), async (req, res) => {
  const fps = parseInt(req.body.fps) || 30;
  const crf = parseInt(req.body.crf) || 18;

  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'Nenhum frame recebido' });
  }

  const jobDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cup-'));
  const outPath = path.join(jobDir, 'out.mp4');

  try {
    console.log(`[render] ${req.files.length} frames @ ${fps}fps`);

    // Write frames to disk
    for (let i = 0; i < req.files.length; i++) {
      fs.writeFileSync(
        path.join(jobDir, `frame${String(i).padStart(6,'0')}.jpg`),
        req.files[i].buffer
      );
      // Free buffer from memory immediately
      req.files[i].buffer = null;
    }

    await new Promise((resolve, reject) => {
      ffmpeg()
        .input(path.join(jobDir, 'frame%06d.jpg'))
        .inputFPS(fps)
        .outputOptions([
          `-r ${fps}`,
          '-c:v libx264',
          '-profile:v baseline',
          '-level 3.0',
          '-pix_fmt yuv420p',
          '-movflags +faststart',
          '-preset ultrafast', // menos CPU e memória
          `-crf ${crf}`,
          `-g ${fps}`,
          `-keyint_min ${fps}`,
          '-sc_threshold 0',
        ])
        .output(outPath)
        .on('start', cmd => console.log('[ffmpeg]', cmd))
        .on('end', resolve)
        .on('error', reject)
        .run();
    });

    const stat = fs.statSync(outPath);
    console.log(`[render] Done — ${Math.round(stat.size/1024)} KB`);

    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', 'attachment; filename="cup-mockup.mp4"');
    res.setHeader('Content-Length', stat.size);
    fs.createReadStream(outPath).pipe(res);

  } catch (err) {
    console.error('[render] Error:', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    res.on('finish', () => {
      try { fs.rmSync(jobDir, { recursive: true }); } catch {}
    });
  }
});

// Fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));