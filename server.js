// ============================================
// MULTI-VERSION VIDEO CONVERTER SERVER
// Complete server.js for Railway deployment
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

// ============================================
// MIDDLEWARE
// ============================================

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ============================================
// STORAGE CONFIGURATION
// ============================================

const dirs = ['uploads', 'processed/videos', 'processed/images', 'processed/audio'];
dirs.forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/x-matroska', 'video/webm'];
    if (file.mimetype.startsWith('video/') || allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only video files are allowed'));
    }
  }
});

const jobs = new Map();

// ============================================
// VERSION PRESETS
// ============================================

const VERSION_PRESETS = {
  version1: { name: "Original Enhanced", speed: 1.0, saturation: 1.1, brightness: 0.02, contrast: 1.05, audioPitch: 0, cropPercent: 0, description: "Slightly enhanced colors and contrast" },
  version2: { name: "Warm & Slower", speed: 0.85, saturation: 1.25, brightness: 0.05, contrast: 1.1, audioPitch: -2, cropPercent: 3, colorTemp: "warm", description: "Warmer tones, 15% slower, zoomed in" },
  version3: { name: "Cool & Crisp", speed: 1.15, saturation: 0.9, brightness: -0.03, contrast: 1.15, audioPitch: 2, cropPercent: 5, colorTemp: "cool", sharpen: 1.2, description: "Cooler tones, 15% faster, sharpened" },
  version4: { name: "Vibrant Motion", speed: 0.9, saturation: 1.4, brightness: 0.08, contrast: 1.2, audioPitch: -1, cropPercent: 7, vignette: true, description: "High saturation, 10% slower, vignette effect" },
  version5: { name: "Subtle Shift", speed: 1.05, saturation: 1.05, brightness: 0.01, contrast: 1.08, audioPitch: 1, cropPercent: 2, gaussianBlur: 0.3, description: "Minimal changes, slight repositioning" }
};

// ============================================
// ROUTES
// ============================================

app.get('/', (req, res) => {
  res.json({ 
    status: 'online', 
    service: 'Multi-Version Video Converter API',
    version: '2.1.0'
  });
});

app.post(['/api/video/process', '/api/video/upload', '/api/convert'], upload.any(), (req, res) => {
  const file = req.file || (req.files && req.files[0]);
  if (!file) return res.status(400).json({ error: 'No video file uploaded' });

  const jobId = `single_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  jobs.set(jobId, {
    status: 'processing',
    versionCount: 1,
    versions: { version1: { status: 'pending', progress: 0 } },
    startTime: Date.now(),
    originalFilename: file.originalname
  });

  res.json({ jobId, message: 'Processing started' });
  processMultipleVersions(file.path, jobId, ['version1']);
});

app.get(['/api/job/:jobId', '/api/video/status/:jobId'], (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  const progresses = Object.values(job.versions).map(v => v.progress || 0);
  const avgProgress = Math.floor(progresses.reduce((a, b) => a + b, 0) / progresses.length);

  res.json({
    jobId: req.params.jobId,
    status: job.status === 'processing' ? 'active' : job.status,
    progress: avgProgress,
    versions: job.versions,
    data: job.status === 'completed' ? Object.keys(job.versions).map(k => ({
      id: k,
      name: job.versions[k].filename,
      downloadUrl: `/api/download/${req.params.jobId}/${k}`,
      size: job.versions[k].sizeReadable
    })) : undefined
  });
});

app.get('/api/download/:jobId/:versionKey', (req, res) => {
  const { jobId, versionKey } = req.params;
  const job = jobs.get(jobId);
  if (!job || !job.versions[versionKey]) return res.status(404).json({ error: 'Not found' });

  const filePath = path.join('processed', 'videos', job.versions[versionKey].filename);
  res.download(filePath, `${path.parse(job.originalFilename).name}_${versionKey}.mp4`);
});

// ============================================
// MIXPOST UPLOAD ROUTE (MATCHES DOCUMENTATION)
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
    const formData = new FormData();
    // Key MUST be 'file' as per Mixpost API docs
    formData.append('file', fs.createReadStream(filePath));

    // Mixpost API requires Workspace UUID in the URL path
    const mixpostBaseUrl = 'https://autoposter.typamanagement.com';
    const uploadUrl = `${mixpostBaseUrl}/api/${workspaceId}/media`;
    const mixpostToken = 'kuWpPvLYPVdLX7c1qA3MmMFozHugLkO1U7KWl8vs6b4e64e1';

    console.log(`📤 Uploading to Mixpost Workspace: ${workspaceId}`);

    const response = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${mixpostToken}`,
        ...formData.getHeaders()
      },
      body: formData
    });

    const data = await response.json();

    if (response.ok) {
      console.log('✅ Mixpost Upload Success');
      res.json({ success: true, message: 'Uploaded to Mixpost successfully', data });
    } else {
      console.error('❌ Mixpost API Error:', data);
      res.status(response.status).json({ error: 'Mixpost rejected the upload', details: data });
    }
  } catch (error) {
    console.error('❌ Critical Server Error during Mixpost upload:', error.message);
    res.status(500).json({ error: 'Server error during upload', details: error.message });
  }
});

// ============================================
// PROCESSING LOGIC (20MBPS UPGRADES)
// ============================================

async function processMultipleVersions(inputPath, jobId, versionKeys) {
  const job = jobs.get(jobId);
  try {
    const versionPromises = versionKeys.map(key => processVersionVariation(inputPath, jobId, key));
    await Promise.all(versionPromises);
    job.status = 'completed';
    job.completedTime = Date.now();
  } catch (error) {
    job.status = 'failed';
    job.error = error.message;
  } finally {
    // Keep cleanup delay to ensure files are fully written
    setTimeout(() => { if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath); }, 2000);
  }
}

async function processVersionVariation(inputPath, jobId, versionKey) {
  const job = jobs.get(jobId);
  const preset = VERSION_PRESETS[versionKey];
  const outputFilename = `${jobId}_${versionKey}.mp4`;
  const outputPath = path.join('processed', 'videos', outputFilename);

  job.versions[versionKey].status = 'processing';
  
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(inputPath, (err, metadata) => {
      if (err) return reject(err);

      const videoStream = metadata.streams.find(s => s.codec_type === 'video');
      const { width, height } = videoStream;
      const targetW = height > width ? 1080 : 1920;
      const targetH = height > width ? 1920 : 1080;

      const filters = [];
      if (preset.cropPercent > 0) {
        const cW = Math.floor(width * (1 - preset.cropPercent / 100));
        const cH = Math.floor(height * (1 - preset.cropPercent / 100));
        filters.push(`crop=${cW}:${cH},scale=${targetW}:${targetH}`);
      } else {
        filters.push(`scale=${targetW}:${targetH}`);
      }

      filters.push(`eq=saturation=${preset.saturation}:brightness=${preset.brightness}:contrast=${preset.contrast}`);
      if (preset.colorTemp === 'warm') filters.push('colortemperature=temperature=6500:mix=0.3');
      if (preset.sharpen) filters.push(`unsharp=5:5:${preset.sharpen}:5:5:0.0`);

      let command = ffmpeg(inputPath)
        .outputOptions([
          '-b:v 20000k', // Upgrade to 20Mbps
          '-maxrate 22000k', 
          '-bufsize 44000k',
          '-preset fast', 
          '-pix_fmt yuv420p', 
          '-movflags +faststart'
        ])
        .videoFilters(filters.join(','));

      if (preset.speed !== 1.0) {
        command.outputOptions([`-filter:v setpts=${(1/preset.speed).toFixed(2)}*PTS`, `-filter:a atempo=${preset.speed.toFixed(2)}`]);
      }

      command.output(outputPath)
        .on('progress', (p) => { job.versions[versionKey].progress = Math.min(99, Math.floor(p.percent || 0)); })
        .on('end', () => {
          const stats = fs.statSync(outputPath);
          job.versions[versionKey] = { 
            status: 'completed', 
            progress: 100, 
            filename: outputFilename, 
            sizeReadable: (stats.size / 1024 / 1024).toFixed(2) + ' MB' 
          };
          resolve();
        })
        .on('error', reject)
        .run();
    });
  });
}

// Cleanup: 1 hour age
setInterval(() => {
  const now = Date.now();
  for (const [jobId, job] of jobs.entries()) {
    if (job.completedTime && (now - job.completedTime > 3600000)) {
      Object.values(job.versions).forEach(v => {
        const p = path.join('processed', 'videos', v.filename || '');
        if (fs.existsSync(p)) fs.unlinkSync(p);
      });
      jobs.delete(jobId);
    }
  }
}, 900000);

app.listen(PORT, () => console.log(`🚀 Video Server listening on port ${PORT}`));
