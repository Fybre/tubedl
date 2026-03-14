const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const DOWNLOAD_DIR = process.env.DOWNLOAD_DIR || path.join(__dirname, '..', 'downloads');

if (!fs.existsSync(DOWNLOAD_DIR)) {
  fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
}

// ── Shared JSON line parser ────────────────────────────────
function parseJsonLines(proc, onItem) {
  let buffer = '';
  proc.stdout.on('data', (data) => {
    buffer += data.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      try { onItem(JSON.parse(line)); } catch (_) {}
    }
  });
}

function normaliseItem(item) {
  return {
    id:         item.id,
    title:      item.title || 'Unknown Title',
    duration:   item.duration || 0,
    channel:    item.channel || item.uploader || item.channel_id || '',
    viewCount:  item.view_count || 0,
    uploadDate: item.upload_date || '',
    thumbnail:  item.thumbnail
      || (item.thumbnails?.length ? item.thumbnails[item.thumbnails.length - 1].url : null)
      || `https://i.ytimg.com/vi/${item.id}/hqdefault.jpg`,
  };
}

// ── Search ─────────────────────────────────────────────────
function search(query, limit = 12) {
  return new Promise((resolve, reject) => {
    const results = [];
    const proc = spawn('yt-dlp', [
      `ytsearch${limit}:${query}`,
      '--dump-json', '--flat-playlist', '--no-warnings', '--ignore-errors',
    ]);
    parseJsonLines(proc, (item) => results.push(normaliseItem(item)));
    proc.on('error', (err) => reject(new Error(`yt-dlp not found: ${err.message}`)));
    proc.on('close', () => resolve(results));
  });
}

// ── Playlist ───────────────────────────────────────────────
function fetchPlaylist(url) {
  return new Promise((resolve, reject) => {
    const items = [];
    const proc = spawn('yt-dlp', [
      url,
      '--dump-json', '--flat-playlist', '--no-warnings', '--ignore-errors',
    ]);
    parseJsonLines(proc, (item) => items.push(normaliseItem(item)));
    proc.on('error', (err) => reject(new Error(`yt-dlp not found: ${err.message}`)));
    proc.on('close', () => resolve(items));
  });
}

// ── Download ───────────────────────────────────────────────
function download(job, onProgress) {
  return new Promise((resolve, reject) => {
    const outputTemplate = path.join(DOWNLOAD_DIR, `${job.id}.%(ext)s`);

    // ── Format-specific base args ──────────────────────────
    let args;
    if (job.format === 'audio') {
      const audioFmt = job.audioFormat || 'mp3';
      const audioQual = job.audioQuality || '0';
      args = [
        job.url,
        '-x', '--audio-format', audioFmt, '--audio-quality', audioQual,
        '-o', outputTemplate,
      ];
    } else {
      let formatStr;
      const q = job.quality || 'best';
      if      (q === '1080p') formatStr = 'bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=1080]+bestaudio/best[height<=1080]/best';
      else if (q === '720p')  formatStr = 'bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=720]+bestaudio/best[height<=720]/best';
      else if (q === '480p')  formatStr = 'bestvideo[height<=480][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=480]+bestaudio/best[height<=480]/best';
      else                    formatStr = 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best';
      args = [
        job.url,
        '-f', formatStr, '--merge-output-format', 'mp4',
        '-o', outputTemplate,
      ];
    }

    // ── Always-on: metadata + artwork ─────────────────────
    args.push('--embed-metadata', '--embed-thumbnail');

    // ── Subtitles (video only) ─────────────────────────────
    if (job.subtitles && job.format !== 'audio') {
      args.push('--write-subs', '--embed-subs', '--sub-langs', 'en.*,en');
    }

    // ── SponsorBlock ───────────────────────────────────────
    if (job.sponsorBlock) {
      args.push('--sponsorblock-remove', 'sponsor,selfpromo,interaction,intro,outro,filler,music_offtopic');
    }

    // ── Clip / trim ────────────────────────────────────────
    if (job.clipStart || job.clipEnd) {
      const start = job.clipStart || '0:00';
      const end   = job.clipEnd   || 'inf';
      args.push('--download-sections', `*${start}-${end}`, '--force-keyframes-at-cuts');
    }

    // ── Common flags ───────────────────────────────────────
    args.push('--no-playlist', '--no-warnings', '--newline', '--progress');

    const proc = spawn('yt-dlp', args);
    job._process = proc;

    let stderr = '';

    proc.stdout.on('data', (data) => {
      for (const line of data.toString().split('\n')) {
        const progressMatch = line.match(
          /\[download\]\s+([\d.]+)%\s+of\s+~?[\d.]+\S+\s+at\s+([\d.]+\S+\/s)\s+ETA\s+(\S+)/
        );
        if (progressMatch) {
          onProgress({ progress: parseFloat(progressMatch[1]), speed: progressMatch[2], eta: progressMatch[3] });
          continue;
        }
        const destMatch  = line.match(/\[download\] Destination:\s+(.+)/);
        if (destMatch)  { job._lastDest = destMatch[1].trim();  continue; }
        const mergeMatch = line.match(/\[Merger\] Merging formats into "(.+)"/);
        if (mergeMatch) { job._lastDest = mergeMatch[1].trim(); continue; }
        const audioMatch = line.match(/\[ExtractAudio\] Destination:\s+(.+)/);
        if (audioMatch) { job._lastDest = audioMatch[1].trim(); }
      }
    });

    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', (err) => reject(new Error(`Failed to start yt-dlp: ${err.message}`)));

    proc.on('close', (code) => {
      delete job._process;

      if (job.status === 'cancelled') return reject(new Error('Download cancelled'));
      if (code !== 0) return reject(new Error(stderr.trim() || `yt-dlp exited with code ${code}`));

      const ext      = job.format === 'audio' ? 'mp3' : 'mp4';
      const expected = path.join(DOWNLOAD_DIR, `${job.id}.${ext}`);

      if (fs.existsSync(expected)) {
        job.filename = `${job.id}.${ext}`; job.filePath = expected; return resolve();
      }
      if (job._lastDest && fs.existsSync(job._lastDest)) {
        job.filename = path.basename(job._lastDest); job.filePath = job._lastDest; return resolve();
      }
      try {
        const files = fs.readdirSync(DOWNLOAD_DIR).filter((f) => f.startsWith(job.id));
        if (files.length > 0) {
          job.filename = files[0]; job.filePath = path.join(DOWNLOAD_DIR, files[0]); return resolve();
        }
      } catch (_) {}

      reject(new Error('Download completed but output file could not be located'));
    });
  });
}

function killProcess(job) {
  if (job._process) job._process.kill('SIGTERM');
}

module.exports = { search, fetchPlaylist, download, killProcess, DOWNLOAD_DIR };
