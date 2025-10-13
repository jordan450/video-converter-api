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

// Ensure directories exist
const dirs = ['uploads', 'processed/videos', 'processed/images', 'processed/audio'];
dirs.forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Multer storage configuration
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

// ============================================
// JOB TRACKING
// ============================================

const jobs = new Map();

// ============================================
// VERSION PRESETS
// ============================================

const VERSION_PRESETS = {
  version1: {
    name: "Original Enhanced",
    speed: 1.0,
    saturation: 1.1,
    brightness: 0.02,
    contrast: 1.05,
    audioPitch: 0,
    cropPercent: 0,
    description: "Slightly enhanced colors and contrast"
  },
  version2: {
    name: "Warm & Slower",
    speed: 0.85,
    saturation: 1.25,
    brightness: 0.05,
    contrast: 1.1,
    audioPitch: -2,
    cropPercent: 3,
    colorTemp: "warm",
    description: "Warmer tones, 15% slower, zoomed in"
  },
  version3: {
    name: "Cool & Crisp",
    speed: 1.15,
    saturation: 0.9,
    brightness: -0.03,
    contrast: 1.15,
    audioPitch: 2,
    cropPercent: 5,
    colorTemp: "cool",
    sharpen: 1.2,
    description: "Cooler tones, 15% faster, sharpened"
  },
  version4: {
    name: "Vibrant Motion",
    speed: 0.9,
    saturation: 1.4,
    brightness: 0.08,
    contrast: 1.2,
    audioPitch: -1,
    cropPercent: 7,
    vignette: true,
    description: "High saturation, 10% slower, vignette effect"
  },
  version5: {
    name: "Subtle Shift",
    speed: 1.05,
    saturation: 1.05,
    brightness: 0.01,
    contrast: 1.08,
    audioPitch: 1,
    cropPercent: 2,
    gaussianBlur: 0.3,
    description: "Minimal changes, slight repositioning"
  }
};

// ============================================
// ROUTES
// ============================================

// Health check
app.get('/', (req, res) => {
  res.json({ 
    status: 'online', 
    service: 'Multi-Version Video Converter API',
    version: '2.0.0',
    endpoints: {
      convert: '/api/convert',
      convertMulti: '/api/convert-multi',
      status: '/api/job/:jobId',
      download: '/api/download/:jobId/:versionKey',
      downloadAll: '/api/download-all/:jobId'
    }
  });
});

// Legacy single conversion endpoint (for backward compatibility)
app.post('/api/convert', upload.single('video'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No video file uploaded' });
  }

  const jobId = `single_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const inputPath = req.file.path;
  
  jobs.set(jobId, {
    status: 'processing',
    versionCount: 1,
    versions: {
      version1: { status: 'pending', progress: 0 }
    },
    startTime: Date.now(),
    originalFilename: req.file.originalname
  });

  res.json({ 
    jobId, 
    message: 'Processing started',
    versionCount: 1,
    estimatedTime: '1-2 minutes'
  });

  processMultipleVersions(inputPath, jobId, ['version1']);
});

// Multi-version conversion endpoint
app.post('/api/convert-multi', upload.single('video'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No video file uploaded' });
  }

  // Get number of versions from request body (default to 1)
  const versionCount = parseInt(req.body.versionCount) || 1;
  
  if (versionCount < 1 || versionCount > 5) {
    return res.status(400).json({ 
      error: 'Invalid version count. Must be between 1 and 5.' 
    });
  }

  const jobId = `multi_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const inputPath = req.file.path;
  
  // Initialize job tracking based on version count
  const versionsToProcess = {};
  const versionKeys = Object.keys(VERSION_PRESETS).slice(0, versionCount);
  
  versionKeys.forEach(key => {
    versionsToProcess[key] = { 
      status: 'pending', 
      progress: 0 
    };
  });

  jobs.set(jobId, {
    status: 'processing',
    versionCount,
    versions: versionsToProcess,
    startTime: Date.now(),
    originalFilename: req.file.originalname
  });

  res.json({ 
    jobId, 
    message: `Processing started for ${versionCount} version${versionCount > 1 ? 's' : ''}`,
    versionCount,
    estimatedTime: versionCount === 1 ? '1-2 minutes' : `${versionCount}-${versionCount + 2} minutes`
  });

  // Process selected versions
  processMultipleVersions(inputPath, jobId, versionKeys);
});

// Job status endpoint
app.get('/api/job/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  // Calculate overall progress
  const versionProgresses = Object.values(job.versions).map(v => v.progress || 0);
  const overallProgress = Math.floor(
    versionProgresses.reduce((a, b) => a + b, 0) / versionProgresses.length
  );

  res.json({
    jobId: req.params.jobId,
    status: job.status,
    versionCount: job.versionCount || 1,
    overallProgress,
    versions: job.versions,
    originalFilename: job.originalFilename,
    processingDuration: job.processingDuration ? 
      Math.floor(job.processingDuration / 1000) + 's' : null
  });
});

// Download individual version
app.get('/api/download/:jobId/:versionKey', (req, res) => {
  const { jobId, versionKey } = req.params;
  const job = jobs.get(jobId);
  
  if (!job || !job.versions[versionKey]) {
    return res.status(404).json({ error: 'Version not found' });
  }

  const version = job.versions[versionKey];
  
  if (version.status !== 'completed') {
    return res.status(400).json({ error: 'Version not ready' });
  }

  const filePath = path.join('processed', 'videos', version.filename);
  
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }

  const downloadName = job.versionCount === 1 
    ? `${path.parse(job.originalFilename).name}_converted.mp4`
    : `${path.parse(job.originalFilename).name}_${versionKey}.mp4`;
  
  res.download(filePath, downloadName, (err) => {
    if (err) {
      console.error('Download error:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Download failed' });
      }
    }
  });
});

// Download all versions as ZIP
app.get('/api/download-all/:jobId', async (req, res) => {
  const job = jobs.get(req.params.jobId);
  
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  if (job.status !== 'completed') {
    return res.status(400).json({ error: 'Not all versions ready' });
  }

  // If only 1 version, redirect to single download
  if (job.versionCount === 1) {
    const versionKey = Object.keys(job.versions)[0];
    return res.redirect(`/api/download/${req.params.jobId}/${versionKey}`);
  }

  // Create ZIP for multiple versions
  const archive = archiver('zip', { zlib: { level: 9 } });
  
  const zipName = `${path.parse(job.originalFilename).name}_${job.versionCount}_versions.zip`;
  
  res.attachment(zipName);
  
  archive.on('error', (err) => {
    console.error('Archive error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to create ZIP' });
    }
  });

  archive.pipe(res);

  // Add all completed versions to ZIP
  for (const [versionKey, version] of Object.entries(job.versions)) {
    if (version.status === 'completed') {
      const filePath = path.join('processed', 'videos', version.filename);
      if (fs.existsSync(filePath)) {
        archive.file(filePath, { 
          name: `${versionKey}_${VERSION_PRESETS[versionKey].name}.mp4` 
        });
      }
    }
  }

  archive.finalize();
});

// Upload to Mixpost endpoint
app.post('/api/upload-to-mixpost', async (req, res) => {
  const { jobId, versionKey, mixpostUrl, mixpostToken } = req.body;
  
  if (!jobId || !versionKey || !mixpostUrl || !mixpostToken) {
    return res.status(400).json({ error: 'Missing required parameters' });
  }

  const job = jobs.get(jobId);
  
  if (!job || !job.versions[versionKey]) {
    return res.status(404).json({ error: 'Version not found' });
  }

  const version = job.versions[versionKey];
  
  if (version.status !== 'completed') {
    return res.status(400).json({ error: 'Version not ready' });
  }

  const filePath = path.join('processed', 'videos', version.filename);
  
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }

  try {
    const FormData = require('form-data');
    const fetch = require('node-fetch');
    
    const formData = new FormData();
    formData.append('file', fs.createReadStream(filePath));
    formData.append('name', `${job.originalFilename}_${versionKey}`);

    const response = await fetch(`${mixpostUrl}/api/media`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${mixpostToken}`,
        ...formData.getHeaders()
      },
      body: formData
    });

    const data = await response.json();

    if (response.ok) {
      console.log(`✅ Successfully uploaded ${versionKey} to Mixpost`);
      res.json({ 
        success: true, 
        message: 'Uploaded to Mixpost successfully',
        mixpostResponse: data 
      });
    } else {
      console.error(`❌ Mixpost upload failed:`, data);
      res.status(response.status).json({ 
        error: 'Mixpost upload failed', 
        details: data 
      });
    }
  } catch (error) {
    console.error('Mixpost upload error:', error);
    res.status(500).json({ 
      error: 'Failed to upload to Mixpost', 
      details: error.message 
    });
  }
});

// ============================================
// PROCESSING FUNCTIONS
// ============================================

async function processMultipleVersions(inputPath, jobId, versionKeys) {
  const job = jobs.get(jobId);
  
  try {
    console.log(`🎬 Starting processing for job ${jobId} - ${versionKeys.length} version(s)`);
    
    // Process selected versions in parallel
    const versionPromises = versionKeys.map(versionKey => 
      processVersionVariation(inputPath, jobId, versionKey)
    );

    await Promise.all(versionPromises);

    // Update job status
    job.status = 'completed';
    job.completedTime = Date.now();
    job.processingDuration = job.completedTime - job.startTime;

    console.log(`✅ All ${versionKeys.length} version(s) completed for job ${jobId} in ${Math.floor(job.processingDuration / 1000)}s`);

  } catch (error) {
    console.error(`❌ Processing failed for job ${jobId}:`, error);
    job.status = 'failed';
    job.error = error.message;
  } finally {
    // Cleanup original file
    setTimeout(() => {
      try {
        if (fs.existsSync(inputPath)) {
          fs.unlinkSync(inputPath);
          console.log(`🗑️ Cleaned up original file for job ${jobId}`);
        }
      } catch (err) {
        console.error('Cleanup error:', err);
      }
    }, 1000);
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
      if (err) {
        job.versions[versionKey].status = 'failed';
        job.versions[versionKey].error = err.message;
        return reject(err);
      }

      const videoStream = metadata.streams.find(s => s.codec_type === 'video');
      if (!videoStream) {
        const error = new Error('No video stream found');
        job.versions[versionKey].status = 'failed';
        job.versions[versionKey].error = error.message;
        return reject(error);
      }

      const width = videoStream.width;
      const height = videoStream.height;

      // Calculate crop dimensions
      let cropFilter = '';
      if (preset.cropPercent > 0) {
        const cropW = Math.floor(width * (1 - preset.cropPercent / 100));
        const cropH = Math.floor(height * (1 - preset.cropPercent / 100));
        const cropX = Math.floor((width - cropW) / 2);
        const cropY = Math.floor((height - cropH) / 2);
        cropFilter = `crop=${cropW}:${cropH}:${cropX}:${cropY},scale=1920:1080`;
      } else {
        cropFilter = 'scale=1920:1080';
      }

      // Build filter chains
      const videoFilters = buildVideoFilterChain(preset, cropFilter);
      const audioFilters = buildAudioFilterChain(preset);

      // Start FFmpeg processing
      let command = ffmpeg(inputPath)
        .outputOptions([
          '-crf 18',
          '-preset slow',
          '-b:v 8M',
          '-maxrate 10M',
          '-bufsize 16M',
          '-pix_fmt yuv420p',
          '-profile:v high',
          '-level 4.0',
          '-b:a 192k',
          '-ar 48000',
          '-ac 2',
          '-movflags +faststart',
          '-avoid_negative_ts make_zero',
          '-max_muxing_queue_size 1024'
        ])
        .videoFilters(videoFilters)
        .audioFilters(audioFilters);

      // Apply speed change if needed
      if (preset.speed !== 1.0) {
        // Video speed
        command.outputOptions(`-filter:v setpts=${(1/preset.speed).toFixed(2)}*PTS`);
        // Audio speed (maintain pitch)
        command.outputOptions(`-filter:a atempo=${preset.speed.toFixed(2)}`);
      }

      command
        .output(outputPath)
        .on('start', (commandLine) => {
          console.log(`🎬 Starting ${versionKey}: ${preset.name}`);
          console.log(`   Speed: ${preset.speed}x, Saturation: ${preset.saturation}, Crop: ${preset.cropPercent}%`);
        })
        .on('progress', (progress) => {
          const percent = Math.min(99, Math.floor(progress.percent || 0));
          job.versions[versionKey].progress = percent;
          
          if (percent % 25 === 0 && percent > 0) {
            console.log(`   ${versionKey}: ${percent}%`);
          }
        })
        .on('end', () => {
          const stats = fs.statSync(outputPath);
          job.versions[versionKey].status = 'completed';
          job.versions[versionKey].progress = 100;
          job.versions[versionKey].filename = outputFilename;
          job.versions[versionKey].size = stats.size;
          job.versions[versionKey].sizeReadable = formatBytes(stats.size);
          job.versions[versionKey].description = preset.description;
          
          console.log(`✅ ${versionKey} completed: ${formatBytes(stats.size)}`);
          resolve();
        })
        .on('error', (err) => {
          console.error(`❌ ${versionKey} failed:`, err.message);
          job.versions[versionKey].status = 'failed';
          job.versions[versionKey].error = err.message;
          reject(err);
        })
        .run();
    });
  });
}

function buildVideoFilterChain(preset, cropFilter) {
  const filters = [cropFilter];

  // Color adjustments
  filters.push(`eq=saturation=${preset.saturation}:brightness=${preset.brightness}:contrast=${preset.contrast}`);

  // Color temperature
  if (preset.colorTemp === 'warm') {
    filters.push('colortemperature=temperature=6500:mix=0.3');
  } else if (preset.colorTemp === 'cool') {
    filters.push('colortemperature=temperature=8500:mix=0.3');
  }

  // Sharpening
  if (preset.sharpen) {
    filters.push(`unsharp=5:5:${preset.sharpen}:5:5:0.0`);
  }

  // Subtle blur
  if (preset.gaussianBlur) {
    filters.push(`gblur=sigma=${preset.gaussianBlur}`);
  }

  // Vignette effect
  if (preset.vignette) {
    filters.push('vignette=angle=PI/4');
  }

  return filters.join(',');
}

function buildAudioFilterChain(preset) {
  const filters = [];

  // Audio pitch shift
  if (preset.audioPitch !== 0) {
    const semitones = preset.audioPitch;
    filters.push(`asetrate=48000*2^(${semitones}/12),aresample=48000`);
  }

  // Audio normalization
  filters.push('loudnorm=I=-16:TP=-1.5:LRA=11');

  return filters.join(',');
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

// ============================================
// CLEANUP JOB
// ============================================

setInterval(() => {
  const now = Date.now();
  const CLEANUP_AGE = 60 * 60 * 1000; // 1 hour
  
  for (const [jobId, job] of jobs.entries()) {
    if (job.completedTime && (now - job.completedTime > CLEANUP_AGE)) {
      // Delete files
      for (const version of Object.values(job.versions)) {
        if (version.filename) {
          const filePath = path.join('processed', 'videos', version.filename);
          try {
            if (fs.existsSync(filePath)) {
              fs.unlinkSync(filePath);
            }
          } catch (err) {
            console.error('Cleanup error:', err);
          }
        }
      }
      // Remove job from memory
      jobs.delete(jobId);
      console.log(`🗑️ Cleaned up job ${jobId}`);
    }
  }
}, 15 * 60 * 1000); // Run every 15 minutes

// ============================================
// ERROR HANDLING
// ============================================

app.use((err, req, res, next) => {
  console.error('Error:', err);
  
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File too large. Maximum size is 500MB.' });
    }
    return res.status(400).json({ error: err.message });
  }
  
  res.status(500).json({ error: err.message || 'Internal server error' });
});

// ============================================
// START SERVER
// ============================================

app.listen(PORT, () => {
  console.log('='.repeat(50));
  console.log('🚀 Multi-Version Video Converter API');
  console.log('='.repeat(50));
  console.log(`📡 Server listening on port ${PORT}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`📁 Upload directory: ${path.resolve('uploads')}`);
  console.log(`📁 Output directory: ${path.resolve('processed/videos')}`);
  console.log('='.repeat(50));
  console.log('✅ Ready to process videos!');
  console.log('');
});
