const { EventEmitter } = require('events');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const ytdlp = require('./ytdlp');

// How long to keep a completed file on disk before auto-deleting (default 1 hour)
const CLEANUP_AFTER_MS = parseInt(process.env.CLEANUP_AFTER_MS || '3600000', 10);

class DownloadQueue extends EventEmitter {
  constructor() {
    super();
    this.jobs = new Map();
    this.activeCount = 0;
    this.maxConcurrent = parseInt(process.env.MAX_CONCURRENT || '2', 10);
  }

  add(videoInfo, format, quality, options = {}) {
    const id = uuidv4();
    const job = {
      id,
      sessionId:    options.sessionId || 'anonymous',
      videoId:      videoInfo.id,
      url:          `https://www.youtube.com/watch?v=${videoInfo.id}`,
      title:        videoInfo.title,
      thumbnail:    videoInfo.thumbnail,
      duration:     videoInfo.duration,
      channel:      videoInfo.channel,
      format,
      quality:      quality || 'best',
      // extra options
      sponsorBlock: options.sponsorBlock || false,
      subtitles:    options.subtitles    || false,
      clipStart:    options.clipStart    || null,
      clipEnd:      options.clipEnd      || null,
      audioFormat:  options.audioFormat  || 'mp3',
      audioQuality: options.audioQuality || '0',
      // state
      status:       'pending',
      progress:     0,
      speed:        null,
      eta:          null,
      filename:     null,
      error:        null,
      createdAt:    new Date().toISOString(),
      completedAt:  null,
    };

    this.jobs.set(id, job);
    this.emit('job:added', this._pub(job));
    this._processNext();
    return job;
  }

  async _processNext() {
    if (this.activeCount >= this.maxConcurrent) return;

    const job = [...this.jobs.values()].find((j) => j.status === 'pending');
    if (!job) return;

    job.status = 'downloading';
    this.activeCount++;
    this.emit('job:updated', this._pub(job));

    try {
      await ytdlp.download(job, (progress) => {
        Object.assign(job, progress);
        this.emit('job:updated', this._pub(job));
      });
      job.status      = 'completed';
      job.progress    = 100;
      job.speed       = null;
      job.eta         = null;
      job.completedAt = new Date().toISOString();
      this._scheduleCleanup(job.id);
    } catch (err) {
      if (job.status !== 'cancelled') {
        job.status = 'failed';
        job.error  = err.message;
      }
    }

    this.activeCount--;
    this.emit('job:updated', this._pub(job));
    this._processNext();
  }

  // Auto-delete completed file after CLEANUP_AFTER_MS
  _scheduleCleanup(id) {
    const job = this.jobs.get(id);
    if (!job) return;
    job._cleanupTimer = setTimeout(() => {
      const j = this.jobs.get(id);
      if (j && j.status === 'completed') this.remove(id);
    }, CLEANUP_AFTER_MS);
  }

  cancel(id) {
    const job = this.jobs.get(id);
    if (!job) return false;

    if (job.status === 'pending' || job.status === 'downloading') {
      const wasDownloading = job.status === 'downloading';
      job.status = 'cancelled';
      ytdlp.killProcess(job);
      this.emit('job:updated', this._pub(job));
      if (wasDownloading) this.activeCount--;
      this._processNext();
      return true;
    }
    return false;
  }

  remove(id) {
    const job = this.jobs.get(id);
    if (!job) return false;

    clearTimeout(job._cleanupTimer);
    this.cancel(id);

    if (job.filePath && fs.existsSync(job.filePath)) {
      try { fs.unlinkSync(job.filePath); } catch (_) {}
    }

    this.jobs.delete(id);
    this.emit('job:removed', { id, sessionId: job.sessionId });
    return true;
  }

  retry(id) {
    const job = this.jobs.get(id);
    if (!job || (job.status !== 'failed' && job.status !== 'cancelled')) return null;

    clearTimeout(job._cleanupTimer);
    job.status      = 'pending';
    job.progress    = 0;
    job.speed       = null;
    job.eta         = null;
    job.error       = null;
    job.filename    = null;
    delete job.filePath;
    delete job._lastDest;

    this.emit('job:updated', this._pub(job));
    this._processNext();
    return this._pub(job);
  }

  getAll(sessionId = null) {
    let jobs = [...this.jobs.values()];
    if (sessionId) {
      jobs = jobs.filter(j => j.sessionId === sessionId);
    }
    return jobs.map((j) => this._pub(j))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  get(id) {
    const job = this.jobs.get(id);
    return job ? this._pub(job) : null;
  }

  getFilePath(id) {
    return this.jobs.get(id)?.filePath || null;
  }

  _pub(job) {
    const { _process, _lastDest, filePath, _cleanupTimer, ...pub } = job;
    return pub;
  }
}

module.exports = new DownloadQueue();
