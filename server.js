const express = require('express');
const multer  = require('multer');
const ffmpeg  = require('fluent-ffmpeg');
const cors    = require('cors');
const fs      = require('fs');
const path    = require('path');
const os      = require('os');

const app    = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 500 * 1024 * 1024 } });

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ── POST /render ──────────────────────────────────────────────────────────────
// Body: multipart/form-data
//   fps      : number
//   frames[] : JPEG files (one per frame, in order)
//
// Returns: MP4 file download
// ─────────────────────────────────────────────────────────────────────────────
app.post('/render', upload.array('frames'), async (req, res) => {
  const fps = parseInt(req.body.fps) || 60;
  const crf = parseInt(req.body.crf) || 16;

  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'Nenhum frame recebido' });
  }

  // Create temp dir for this job
  const jobDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cup-'));
  const outPath = path.join(jobDir, 'out.mp4');

  try {
    // Write frames to disk as frame000000.jpg, frame000001.jpg, ...
    for (let i = 0; i < req.files.length; i++) {
      const name = `frame${String(i).padStart(6, '0')}.jpg`;
      fs.writeFileSync(path.join(jobDir, name), req.files[i].buffer);
    }

    console.log(`[render] ${req.files.length} frames @ ${fps}fps → ${outPath}`);

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
          '-preset fast',
          `-crf ${crf}`,
          `-g ${fps}`,
          `-keyint_min ${fps}`,
          '-sc_threshold 0',
        ])
        .output(outPath)
        .on('end', resolve)
        .on('error', reject)
        .run();
    });

    const stat = fs.statSync(outPath);
    console.log(`[render] Done — ${Math.round(stat.size / 1024)} KB`);

    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', 'attachment; filename="cup-mockup.mp4"');
    res.setHeader('Content-Length', stat.size);
    fs.createReadStream(outPath).pipe(res);

  } catch (err) {
    console.error('[render] Error:', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    // Cleanup temp files after response
    res.on('finish', () => {
      try { fs.rmSync(jobDir, { recursive: true }); } catch {}
    });
  }
});

// ── GET /health ───────────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ ok: true, version: '1.0.0' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Cup Render Server rodando na porta ${PORT}`));

// Serve frontend static files
app.use(express.static(path.join(__dirname, 'public')));
