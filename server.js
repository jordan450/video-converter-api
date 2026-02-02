// ============================================
// MULTI-VERSION VIDEO CONVERTER SERVER
// Final Version: Fixed ReferenceError & Mixpost Path
// ============================================

const express = require('express');
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');
const FormData = require('form-data');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Storage Setup
const dirs = ['uploads', 'processed/videos'];
dirs.forEach(dir => { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${Math.random().toString(36).substr(2, 9)}${path.extname(file.originalname)}`)
});

const upload = multer({ storage: storage, limits: { fileSize: 500 * 1024 * 1024 } });
const jobs = new Map();

// Health Check
app.get(['/', '/health'], (req, res) => {
    res.json({ status: 'online', timestamp: new Date().toISOString() });
});

// Video Processing Route
app.post(['/api/video/process', '/api/video/upload', '/api/convert'], upload.any(), (req, res) => {
  const file = req.file || (req.files && req.files[0]);
  if (!file) return res.status(400).json({ error: 'No video file uploaded' });

  const jobId = `single_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
  jobs.set(jobId, {
    status: 'processing',
    versions: { version1: { status: 'pending', progress: 0 } },
    originalFilename: file.originalname,
    startTime: Date.now()
  });

  res.json({ jobId, message: 'Processing started' });
  processVersion(file.path, jobId, 'version1');
});

// Job Status Route (FIXED REFERENCE ERROR)
app.get(['/api/job/:jobId', '/api/video/status/:jobId'], (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  
  // FIX: Ensure version1 exists before accessing properties
  const v1 = job.versions.version1;
  
  res.json({
    jobId: req.params.jobId,
    status: job.status === 'processing' ? 'active' : job.status,
    progress: v1 ? v1.progress : 0,
    data: job.status === 'completed' && v1 ? [{
      id: 'version1',
      name: v1.filename,
      // FIXED: Removed ${version1} typo, used hardcoded string
      downloadUrl: `/api/download/${req.params.jobId}/version1`,
      size: v1.sizeReadable
    }] : undefined
  });
});

// ============================================
// MIXPOST UPLOAD ROUTE (FIXED PATH)
// ============================================

app.post('/api/mixpost/upload', async (req, res) => {
  const { filename, workspaceId } = req.body;
  
  if (!filename || !workspaceId) {
    return res.status(400).json({ error: 'Missing filename or workspaceId' });
  }

  const filePath = path.join('processed', 'videos', filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found on server' });
  }

  try {
    const fileStream = fs.createReadStream(filePath);
    const formData = new FormData();
    formData.append('file', fileStream);

    // FIXED: Added '/mixpost' to the URL path
    // Mixpost default path usually includes /mixpost unless removed in config
    const mixpostBaseUrl = 'https://autoposter.typamanagement.com';
    const uploadUrl = `${mixpostBaseUrl}/mixpost/api/${workspaceId}/media`;
    const mixpostToken = 'kuWpPvLYPVdLX7c1qA3MmMFozHugLkO1U7KWl8vs6b4e64e1';

    console.log(`📤 Uploading to: ${uploadUrl}`);
    
    const response = await fetch(uploadUrl, {
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${mixpostToken}`, 
        ...formData.getHeaders() 
      },
      body: formData
    });

    // Handle non-JSON responses (like 404 HTML)
    const responseText = await response.text();
    let data;
    
    try {
        data = JSON.parse(responseText);
    } catch (e) {
        console.error('❌ Failed to parse Mixpost response:', responseText.substring(0, 200));
        return res.status(500).json({ 
            error: 'Mixpost returned invalid data (likely wrong URL)', 
            details: responseText.substring(0, 100) 
        });
    }

    if (response.ok) {
      console.log('✅ Upload success');
      res.json({ success: true, data });
    } else {
      console.error('❌ Mixpost error:', data);
      res.status(response.status).json({ error: 'Mixpost upload failed', details: data });
    }
  } catch (error) {
    console.error('❌ Server error:', error);
    res.status(500).json({ error: 'Server crash during upload', message: error.message });
  }
});

// Download Route
app.get('/api/download/:jobId/:versionKey', (req, res) => {
  const job = jobs.get(req.params.jobId);
  const version = job?.versions[req.params.versionKey];
  if (!version?.filename) return res.status(404).send('Not found');
  res.download(path.join('processed', 'videos', version.filename));
});

// ============================================
// SMART SCALING PROCESSOR (1080p Logic)
// ============================================

async function processVersion(inputPath, jobId, versionKey) {
  const job = jobs.get(jobId);
  const outputFilename = `${jobId}_${versionKey}.mp4`;
  const outputPath = path.join('processed', 'videos', outputFilename);

  // Set status to processing
  if (job.versions[versionKey]) {
      job.versions[versionKey].status = 'processing';
  }

  return new Promise((resolve, reject) => {
    // 1. Probe the video to check dimensions (Portrait vs Landscape)
    ffmpeg.ffprobe(inputPath, (err, metadata) => {
      if (err) {
        console.error('FFprobe Error:', err);
        // Fail gracefully if probe fails
        if (job.versions[versionKey]) {
             job.versions[versionKey].status = 'failed';
             job.versions[versionKey].error = err.message;
        }
        return reject(err);
      }

      // Find video stream
      const videoStream = metadata.streams.find(s => s.codec_type === 'video');
      if (!videoStream) {
          const err = new Error('No video stream found');
          if (job.versions[versionKey]) {
             job.versions[versionKey].status = 'failed';
             job.versions[versionKey].error = err.message;
          }
          return reject(err);
      }

      const { width, height } = videoStream;
      
      // 2. Determine Smart Target Resolution
      // If video is taller than wide (Portrait), force 1080x1920 (TikTok/Reels/Shorts)
      // If video is wider than tall (Landscape), force 1920x1080 (YouTube/Feed)
      const isPortrait = height > width;
      const targetW = isPortrait ? 1080 : 1920;
      const targetH = isPortrait ? 1920 : 1080;

      console.log(`[${versionKey}] Input: ${width}x${height} | Target: ${targetW}x${targetH} (${isPortrait ? 'Portrait' : 'Landscape'})`);

      // 3. Build Filter Chain
      // force_original_aspect_ratio=decrease: Fits video inside target box without stretching
      // pad: Fills the rest with black bars so it matches exactly 1920x1080 or 1080x1920
      const videoFilters = [
        `scale=${targetW}:${targetH}:force_original_aspect_ratio=decrease`,
        `pad=${targetW}:${targetH}:(ow-iw)/2:(oh-ih)/2`
      ].join(',');

      ffmpeg(inputPath)
        .outputOptions([
          '-b:v 15000k',        // 15Mbps (High Quality for Socials)
          '-maxrate 15000k',
          '-bufsize 30000k',
          '-preset fast',       // Balance speed/quality
          '-pix_fmt yuv420p',   // Ensure compatibility
          '-movflags +faststart'// Web optimization
        ])
        .videoFilters(videoFilters)
        .on('progress', (p) => { 
          if (job.versions[versionKey]) {
             job.versions[versionKey].progress = Math.min(99, Math.floor(p.percent || 0));
          }
        })
        .on('end', () => {
          const stats = fs.statSync(outputPath);
          // Update job status
          job.status = 'completed';
          if (job.versions[versionKey]) {
            job.versions[versionKey] = { 
                status: 'completed', 
                progress: 100, 
                filename: outputFilename, 
                sizeReadable: (stats.size / 1024 / 1024).toFixed(2) + ' MB' 
            };
          }
          
          // Cleanup Input
          if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
          resolve();
        })
        .on('error', (err) => { 
          console.error(`FFmpeg Error for job ${jobId}:`, err);
          job.status = 'failed'; 
          job.error = err.message; 
          reject(err);
        })
        .save(outputPath);
    });
  });
}

app.listen(PORT, () => console.log(`🚀 Server listening on port ${PORT}`));
