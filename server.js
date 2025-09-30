const express = require('express');
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Storage setup
const storage = multer.diskStorage({
  destination: 'uploads/',
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueName + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage,
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('video/')) {
      cb(null, true);
    } else {
      cb(new Error('Only video files allowed'));
    }
  }
});

// Ensure directories exist
['uploads', 'processed'].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Job storage
const jobs = new Map();
let jobCounter = 0;

// HIGH QUALITY SETTINGS FOR 1080p MIXPOST-READY OUTPUT
const HIGH_QUALITY_SETTINGS = {
  crf: 18,                    // Excellent quality (15-20 = near lossless)
  preset: 'slow',             // Better compression at high quality
  videoBitrate: '8M',         // 8 Mbps for high quality 1080p
  maxBitrate: '10M',          // Maximum bitrate cap
  bufferSize: '16M',          // Buffer size for rate control
  audioBitrate: '192k',       // High quality audio
  audioSampleRate: 48000,     // Professional audio sample rate
  profile: 'high',            // High profile for better quality
  level: '4.0',               // Level 4.0 for HD content
  pixelFormat: 'yuv420p'      // Required for compatibility
};

// High-quality video processing function
async function processVideoHighQuality(inputPath, outputPath, config) {
  return new Promise((resolve, reject) => {
    console.log(`🎬 Processing: ${path.basename(outputPath)}`);
    console.log(`⚙️  Quality: CRF ${HIGH_QUALITY_SETTINGS.crf}, Preset: ${HIGH_QUALITY_SETTINGS.preset}`);
    
    let command = ffmpeg(inputPath);
    
    // Build video filters array
    const videoFilters = [];
    
    // Speed change (if needed)
    if (config.speed && config.speed !== 1) {
      command = command.audioFilters(`atempo=${config.speed}`);
      videoFilters.push(`setpts=${1/config.speed}*PTS`);
    }
    
    // Color adjustments (subtle for quality)
    if (config.brightness || config.contrast || config.saturation) {
      const eqParams = [];
      if (config.brightness) eqParams.push(`brightness=${config.brightness}`);
      if (config.contrast) eqParams.push(`contrast=${config.contrast}`);
      if (config.saturation) eqParams.push(`saturation=${config.saturation}`);
      if (eqParams.length > 0) {
        videoFilters.push(`eq=${eqParams.join(':')}`);
      }
    }
    
    // Geometric transforms
    if (config.scale && config.scale !== 1) {
      videoFilters.push(`scale=iw*${config.scale}:ih*${config.scale}`);
    }
    
    if (config.flip) {
      videoFilters.push('hflip');
    }
    
    // CRITICAL: Scale to 1080p while maintaining aspect ratio
    videoFilters.push('scale=-2:min(1080\\,ih)');
    
    // Ensure even dimensions (required for H.264)
    videoFilters.push('pad=ceil(iw/2)*2:ceil(ih/2)*2');
    
    // Apply all video filters
    if (videoFilters.length > 0) {
      command = command.videoFilters(videoFilters);
    }
    
    // Build the high-quality output
    command
      .output(outputPath)
      .videoCodec('libx264')
      .audioCodec('aac')
      .outputOptions([
        // QUALITY SETTINGS - THIS IS THE KEY TO NO BLURRINESS
        `-crf ${HIGH_QUALITY_SETTINGS.crf}`,
        `-preset ${HIGH_QUALITY_SETTINGS.preset}`,
        
        // Bitrate control for consistent quality
        `-b:v ${HIGH_QUALITY_SETTINGS.videoBitrate}`,
        `-maxrate ${HIGH_QUALITY_SETTINGS.maxBitrate}`,
        `-bufsize ${HIGH_QUALITY_SETTINGS.bufferSize}`,
        
        // Compatibility settings
        `-pix_fmt ${HIGH_QUALITY_SETTINGS.pixelFormat}`,
        `-profile:v ${HIGH_QUALITY_SETTINGS.profile}`,
        `-level ${HIGH_QUALITY_SETTINGS.level}`,
        
        // High quality audio
        `-b:a ${HIGH_QUALITY_SETTINGS.audioBitrate}`,
        `-ar ${HIGH_QUALITY_SETTINGS.audioSampleRate}`,
        '-ac 2',
        
        // Streaming optimization
        '-movflags +faststart',
        '-avoid_negative_ts make_zero',
        '-max_muxing_queue_size 1024',
        '-fflags +genpts'
      ])
      .on('start', (commandLine) => {
        console.log('📹 FFmpeg command:', commandLine);
      })
      .on('progress', (progress) => {
        const percent = Math.round(progress.percent || 0);
        if (percent % 10 === 0) {
          console.log(`⏳ Progress: ${percent}%`);
        }
      })
      .on('end', () => {
        console.log(`✅ Completed: ${path.basename(outputPath)}`);
        resolve();
      })
      .on('error', (error) => {
        console.error(`❌ Error processing ${path.basename(outputPath)}:`, error.message);
        reject(error);
      })
      .run();
  });
}

// Generate subtle variation config (maintains quality)
function generateConfig(index) {
  // Very subtle changes to avoid quality degradation
  return {
    speed: 0.98 + Math.random() * 0.04,        // 98-102% speed (subtle)
    brightness: -0.02 + Math.random() * 0.04,   // Very subtle brightness
    contrast: 0.98 + Math.random() * 0.04,      // Very subtle contrast
    saturation: 0.97 + Math.random() * 0.06,    // Subtle saturation
    scale: 0.99 + Math.random() * 0.02,         // 99-101% scale (minimal)
    flip: Math.random() > 0.8                   // 20% chance of flip
  };
}

// Calculate similarity based on config
function calculateSimilarity(config) {
  let similarity = 100;
  if (Math.abs(config.speed - 1) > 0.02) similarity -= 5;
  if (Math.abs(config.brightness) > 0.01) similarity -= 3;
  if (Math.abs(config.contrast - 1) > 0.01) similarity -= 3;
  if (config.flip) similarity -= 8;
  if (Math.abs(config.scale - 1) > 0.01) similarity -= 2;
  return Math.max(60, Math.min(95, similarity));
}

// Routes
app.get('/health', (req, res) => {
  res.json({ 
    status: 'SUCCESS', 
    message: 'High-Quality 1080p FFmpeg processing ready',
    ffmpeg: 'Available',
    quality: {
      resolution: '1080p',
      crf: HIGH_QUALITY_SETTINGS.crf,
      preset: HIGH_QUALITY_SETTINGS.preset,
      videoBitrate: HIGH_QUALITY_SETTINGS.videoBitrate,
      audioBitrate: HIGH_QUALITY_SETTINGS.audioBitrate
    }
  });
});

app.post('/api/video/upload', upload.single('video'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No video uploaded' });
  }
  
  console.log(`📤 Upload received: ${req.file.originalname} (${(req.file.size / (1024 * 1024)).toFixed(2)} MB)`);
  
  res.json({
    success: true,
    videoId: path.parse(req.file.filename).name,
    originalName: req.file.originalname,
    size: (req.file.size / (1024 * 1024)).toFixed(2) + ' MB'
  });
});

app.post('/api/video/process', async (req, res) => {
  const { videoId, variationCount = 5 } = req.body;
  const jobId = ++jobCounter;
  
  console.log(`🚀 Starting job ${jobId}: ${variationCount} variations for video ${videoId}`);
  
  jobs.set(jobId, {
    status: 'active',
    progress: 0,
    data: null,
    startTime: Date.now()
  });
  
  // Start processing (non-blocking)
  processVideos(jobId, videoId, variationCount);
  
  res.json({ 
    success: true, 
    jobId,
    message: `Processing ${variationCount} high-quality 1080p variations`
  });
});

async function processVideos(jobId, videoId, count) {
  const job = jobs.get(jobId);
  
  try {
    // Find actual input file
    const files = fs.readdirSync('uploads').filter(f => f.startsWith(videoId));
    if (files.length === 0) {
      throw new Error('Input file not found');
    }
    
    const actualInput = `uploads/${files[0]}`;
    const results = [];
    
    console.log(`🎬 Processing ${count} variations from: ${files[0]}`);
    
    for (let i = 0; i < count; i++) {
      console.log(`\n📹 [${i + 1}/${count}] Generating variation ${i + 1}...`);
      
      const config = generateConfig(i);
      const outputPath = `processed/${videoId}_variation_${i + 1}.mp4`;
      
      // Process with high quality settings
      await processVideoHighQuality(actualInput, outputPath, config);
      
      // Get file size
      const stats = fs.statSync(outputPath);
      const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);
      
      results.push({
        id: `${videoId}_variation_${i + 1}`,
        name: `variation_${i + 1}.mp4`,
        similarity: calculateSimilarity(config),
        downloadUrl: `/api/video/download/${videoId}_variation_${i + 1}`,
        size: `${fileSizeMB} MB`,
        quality: '1080p High Quality'
      });
      
      job.progress = Math.round(((i + 1) / count) * 100);
    }
    
    job.status = 'completed';
    job.data = results;
    job.completedTime = Date.now();
    job.totalTime = ((job.completedTime - job.startTime) / 1000).toFixed(1) + 's';
    
    console.log(`\n✅ Job ${jobId} completed! Total time: ${job.totalTime}`);
    
  } catch (error) {
    console.error(`❌ Job ${jobId} failed:`, error.message);
    job.status = 'failed';
    job.error = error.message;
  }
}

app.get('/api/video/status/:jobId', (req, res) => {
  const job = jobs.get(parseInt(req.params.jobId));
  if (!job) {
    return res.json({ status: 'not_found' });
  }
  
  res.json({
    status: job.status,
    progress: job.progress,
    data: job.data,
    error: job.error,
    totalTime: job.totalTime
  });
});

app.get('/api/video/download/:videoId', (req, res) => {
  const filePath = `processed/${req.params.videoId}.mp4`;
  
  if (fs.existsSync(filePath)) {
    console.log(`📥 Download: ${req.params.videoId}.mp4`);
    res.download(filePath);
  } else {
    console.log(`❌ File not found: ${req.params.videoId}.mp4`);
    res.status(404).json({ error: 'File not found' });
  }
});

// Cleanup old files (optional - runs every hour)
setInterval(() => {
  const now = Date.now();
  const maxAge = 24 * 60 * 60 * 1000; // 24 hours
  
  ['uploads', 'processed'].forEach(dir => {
    fs.readdirSync(dir).forEach(file => {
      const filePath = path.join(dir, file);
      const stats = fs.statSync(filePath);
      if (now - stats.mtimeMs > maxAge) {
        fs.unlinkSync(filePath);
        console.log(`🗑️  Cleaned up old file: ${file}`);
      }
    });
  });
}, 60 * 60 * 1000);

app.listen(PORT, () => {
  console.log(`\n🚀 High-Quality Video Converter Server Started`);
  console.log(`📡 Port: ${PORT}`);
  console.log(`🎬 Quality Settings:`);
  console.log(`   - Resolution: 1080p`);
  console.log(`   - CRF: ${HIGH_QUALITY_SETTINGS.crf} (excellent quality)`);
  console.log(`   - Preset: ${HIGH_QUALITY_SETTINGS.preset} (best compression)`);
  console.log(`   - Video Bitrate: ${HIGH_QUALITY_SETTINGS.videoBitrate}`);
  console.log(`   - Audio Bitrate: ${HIGH_QUALITY_SETTINGS.audioBitrate}`);
  console.log(`✅ Ready for Mixpost-compatible conversions!\n`);
});
