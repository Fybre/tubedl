const express = require('express');
const router  = express.Router();
const path    = require('path');
const fs      = require('fs');
const { spawn }         = require('child_process');
const archiver          = require('archiver');
const { fetchPlaylist } = require('../services/ytdlp');
const queue             = require('../services/queue');

// Validate a clip time string (HH:MM:SS, MM:SS, or raw seconds)
const TIME_RE = /^\d+([:.]\d+)*$/;

// ── Queue a download ───────────────────────────────────────
router.post('/download', (req, res) => {
  const { videoInfo, format, quality, sponsorBlock, subtitles, clipStart, clipEnd, audioFormat, audioQuality, sessionId } = req.body;

  if (!videoInfo?.id) return res.status(400).json({ error: 'videoInfo.id is required' });
  if (!['audio', 'video'].includes(format)) return res.status(400).json({ error: 'format must be "audio" or "video"' });

  if ((clipStart || clipEnd) && (!TIME_RE.test(clipStart || '0') || !TIME_RE.test(clipEnd || '0'))) {
    return res.status(400).json({ error: 'Invalid clip time format' });
  }

  const job = queue.add(videoInfo, format, quality, { sessionId, sponsorBlock, subtitles, clipStart, clipEnd, audioFormat, audioQuality });
  res.json({ job: queue.get(job.id) });
});

// ── Queue listing / management ─────────────────────────────
// Get queue for a specific session (via query param) or all if no session
router.get('/queue', (req, res) => {
  const sessionId = req.query.sessionId || null;
  res.json({ jobs: queue.getAll(sessionId) });
});

router.get('/queue/:id', (req, res) => {
  const job = queue.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json({ job });
});

router.post('/queue/:id/cancel', (req, res) => {
  const ok = queue.cancel(req.params.id);
  if (!ok) return res.status(400).json({ error: 'Job cannot be cancelled' });
  res.json({ success: true });
});

router.post('/queue/:id/retry', (req, res) => {
  const job = queue.retry(req.params.id);
  if (!job) return res.status(400).json({ error: 'Job cannot be retried' });
  res.json({ job });
});

router.delete('/queue/:id', (req, res) => {
  const ok = queue.remove(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Job not found' });
  res.json({ success: true });
});

// ── Serve completed file, then auto-delete ─────────────────
router.get('/file/:id', (req, res) => {
  const job      = queue.get(req.params.id);
  const filePath = queue.getFilePath(req.params.id);

  if (!job || job.status !== 'completed') return res.status(404).json({ error: 'File not available' });
  if (!filePath || !fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found on disk' });

  const ext         = path.extname(filePath).toLowerCase();
  const safeTitle   = (job.title || 'download').replace(/[<>:"/\\|?*]/g, '').trim().substring(0, 200);
  const contentType = ext === '.mp3' ? 'audio/mpeg' : 'video/mp4';
  const stat        = fs.statSync(filePath);

  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(safeTitle + ext)}`);
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Length', stat.size);
  res.setHeader('Accept-Ranges', 'bytes');

  const stream = fs.createReadStream(filePath);
  stream.pipe(res);

  // Remove from queue (and delete file) once the response is fully sent
  res.on('close', () => queue.remove(req.params.id));
});

// ── Zip all completed files for a session ─────────────────
router.get('/zip', (req, res) => {
  const sessionId = req.query.sessionId || null;
  const completed = queue.getAll(sessionId).filter((j) => j.status === 'completed');

  if (!completed.length) return res.status(404).json({ error: 'No completed files to zip' });

  const files = completed
    .map((j) => ({ job: j, filePath: queue.getFilePath(j.id) }))
    .filter(({ filePath }) => filePath && fs.existsSync(filePath));

  if (!files.length) return res.status(404).json({ error: 'No files found on disk' });

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', 'attachment; filename="tubedl-downloads.zip"');

  const archive = archiver('zip', { zlib: { level: 0 } }); // level 0 = store only (audio/video already compressed)
  archive.on('error', (err) => { if (!res.headersSent) res.status(500).end(); else res.end(); });
  archive.pipe(res);

  for (const { job, filePath } of files) {
    const ext      = path.extname(filePath).toLowerCase();
    const safeName = (job.title || 'download').replace(/[<>:"/\\|?*]/g, '').trim().substring(0, 200) + ext;
    archive.file(filePath, { name: safeName });
  }

  archive.finalize();
});

// ── Playlist info ──────────────────────────────────────────
router.get('/playlist', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'url is required' });
  if (!/youtube\.com|youtu\.be/.test(url)) return res.status(400).json({ error: 'Not a YouTube URL' });

  try {
    const items = await fetchPlaylist(url);
    if (!items.length) return res.status(404).json({ error: 'No videos found in playlist' });
    res.json({ items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Stream URL for preview ─────────────────────────────────
router.get('/stream/:videoId', (req, res) => {
  const { videoId } = req.params;
  if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) return res.status(400).json({ error: 'Invalid video ID' });

  const proc = spawn('yt-dlp', [
    '-g', '-f', 'best[height<=720][ext=mp4]/best[height<=720]/best',
    '--no-playlist', '--no-warnings',
    `https://www.youtube.com/watch?v=${videoId}`,
  ]);

  let stdout = '', stderr = '';
  proc.stdout.on('data', (d) => { stdout += d.toString(); });
  proc.stderr.on('data', (d) => { stderr += d.toString(); });
  proc.on('error', () => res.status(500).json({ error: 'yt-dlp not found' }));
  proc.on('close', (code) => {
    if (code !== 0) return res.status(500).json({ error: stderr.trim() || 'Could not retrieve stream URL' });
    const urls = stdout.trim().split('\n').filter(Boolean);
    res.json({ videoUrl: urls[0], audioUrl: urls[1] || null });
  });
});

module.exports = router;
