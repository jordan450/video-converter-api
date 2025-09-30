const express = require('express');
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const FormData = require('form-data');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

// Mixpost Configuration
const MIXPOST_API_KEY = process.env.MIXPOST_API_KEY || 'Hw6yPBAVaIzgRlXuk3DaFTakerItuBCtDjTcz4xe9b65df26';
const MIXPOST_BASE_URL = process.env.MIXPOST_BASE_URL || 'https://autoposter.typamanagement.com/';

// Middleware - CORS Configuration
app.use(cors({
  origin: [
    'https://lovable.dev',
    'https://*.lovable.dev',
    'https://*.lovable.app',
    /\.lovable\.app$/,
    /\.lovable\.dev$/,
    'http://localhost:3000',
    'http://localhost:5173',
    'https://converter.typamanagement.com'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
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

// HIGH QUALITY SETTINGS FOR 1080p
const HIGH_QUALITY_SETTINGS = {
  crf: 18,
  preset: 'slow',
  videoBitrate: '8M',
  maxBitrate: '10M',
  bufferSize: '16M',
  audioBitrate: '192k',
  audioSampleRate: 48000,
  profile: 'high',
  level: '4.0',
  pixelFormat: 'yuv420p'
};

// High-quality video processing function
async function processVideoHighQuality(inputPath, outputPath, config) {
  return new Promise((resolve, reject) => {
    console.log(`Processing: ${path.basename(outputPath)}`);
    
    let command = ffmpeg(inputPath);
    const videoFilters = [];
    
    if (config.speed && config.speed !== 1) {
      command = command.audioFilters(`atempo=${config.speed}`);
      videoFilters.push(`setpts=${1/config.speed}*PTS`);
    }
    
    if (config.brightness || config.contrast || config.saturation) {
      const eqParams = [];
      if (config.brightness) eqParams.push(`brightness=${config.brightness}`);
      if (config.contrast) eqParams.push(`contrast=${config.contrast}`);
      if (config.saturation) eqParams.push(`saturation=${config.saturation}`);
      if (eqParams.length > 0) {
        videoFilters.push(`eq=${eqParams.join(':')}`);
      }
    }
    
    if (config.scale && config.scale !== 1) {
      videoFilters.push(`scale=iw*${config.scale}:ih*${config.scale}`);
    }
    
    if (config.flip) {
      videoFilters.push('hflip');
    }
    
    videoFilters.push('scale=-2:min(1080\\,ih)');
    videoFilters.push('pad=ceil(iw/2)*2:ceil(ih/2)*2');
    
    if (videoFilters.length > 0) {
      command = command.videoFilters(videoFilters);
    }
    
    command
      .output(outputPath)
      .videoCodec('libx264')
      .audioCodec('aac')
      .outputOptions([
        `-crf ${HIGH_QUALITY_SETTINGS.crf}`,
        `-preset ${HIGH_QUALITY_SETTINGS.preset}`,
        `-b:v ${HIGH_QUALITY_SETTINGS.videoBitrate}`,
        `-maxrate ${HIGH_QUALITY_SETTINGS.maxBitrate}`,
        `-bufsize ${HIGH_QUALITY_SETTINGS.bufferSize}`,
        `-pix_fmt ${HIGH_QUALITY_SETTINGS.pixelFormat}`,
        `-profile:v ${HIGH_QUALITY_SETTINGS.profile}`,
        `-level ${HIGH_QUALITY_SETTINGS.level}`,
        `-b:a ${HIGH_QUALITY_SETTINGS.audioBitrate}`,
        `-ar ${HIGH_QUALITY_SETTINGS.audioSampleRate}`,
        '-ac 2',
        '-movflags +faststart',
        '-avoid_negative_ts make_zero',
        '-max_muxing_queue_size 1024',
        '-fflags +genpts'
      ])
      .on('progress', (progress) => {
        const percent = Math.round(progress.percent || 0);
        if (percent % 10 === 0) {
          console.log(`Progress: ${percent}%`);
        }
      })
      .on('end', () => {
        console.log(`Completed: ${path.basename(outputPath)}`);
        resolve();
      })
      .on('error', (error) => {
        console.error(`Error: ${error.message}`);
        reject(error);
      })
      .run();
  });
}

function generateConfig(index) {
  return {
    speed: 0.98 + Math.random() * 0.04,
    brightness: -0.02 + Math.random() * 0.04,
    contrast: 0.98 + Math.random() * 0.04,
    saturation: 0.97 + Math.random() * 0.06,
    scale: 0.99 + Math.random() * 0.02,
    flip: Math.random() > 0.8
  };
}

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
    mixpost: MIXPOST_API_KEY ? 'Configured' : 'Not configured',
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
  
  console.log(`Upload received: ${req.file.originalname}`);
  
  res.json({
    success: true,
    videoId: path.parse(req.file.filename).name,
    originalName: req.file.originalname,
    size: (req.file.size / (1024 * 1024)).toFixed(2) + ' MB'
  });
});

app.post('/api/video/process', async (req, res) => {
  const { videoId, variationCount = 1 } = req.body;
  const jobId = ++jobCounter;
  
  console.log(`Starting job ${jobId}: ${variationCount} variations`);
  
  jobs.set(jobId, {
    status: 'active',
    progress: 0,
    data: null,
    startTime: Date.now()
  });
  
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
    const files = fs.readdirSync('uploads').filter(f => f.startsWith(videoId));
    if (files.length === 0) {
      throw new Error('Input file not found');
    }
    
    const actualInput = `uploads/${files[0]}`;
    const results = [];
    
    console.log(`Processing ${count} variations from: ${files[0]}`);
    
    for (let i = 0; i < count; i++) {
      console.log(`\n[${i + 1}/${count}] Generating variation ${i + 1}...`);
      
      const config = generateConfig(i);
      const outputPath = `processed/${videoId}_variation_${i + 1}.mp4`;
      
      await processVideoHighQuality(actualInput, outputPath, config);
      
      const stats = fs.statSync(outputPath);
      const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);
      
      results.push({
        id: `${videoId}_variation_${i + 1}`,
        name: `${videoId}_variation_${i + 1}.mp4`,
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
    
    console.log(`\nJob ${jobId} completed! Total time: ${job.totalTime}`);
    
  } catch (error) {
    console.error(`Job ${jobId} failed:`, error.message);
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
    console.log(`Download: ${req.params.videoId}.mp4`);
    res.download(filePath);
  } else {
    console.log(`File not found: ${req.params.videoId}.mp4`);
    res.status(404).json({ error: 'File not found' });
  }
});

// MIXPOST INTEGRATION ENDPOINT
app.post('/api/mixpost/upload', async (req, res) => {
  const { videoFilename, workspaceId } = req.body;
  
  console.log(`Mixpost upload request: ${videoFilename} to workspace ${workspaceId}`);
  
  if (!MIXPOST_API_KEY || MIXPOST_API_KEY === 'your-api-key-here') {
    return res.status(500).json({ error: 'Mixpost API key not configured' });
  }
  
  if (!workspaceId) {
    return res.status(400).json({ error: 'Workspace ID is required' });
  }
  
  try {
    const videoPath = path.join(__dirname, 'processed', videoFilename);
    
    if (!fs.existsSync(videoPath)) {
      return res.status(404).json({ error: 'Video file not found' });
    }
    
    const formData = new FormData();
    formData.append('file', fs.createReadStream(videoPath));
    
    console.log(`Uploading to Mixpost: ${MIXPOST_BASE_URL}/api/${workspaceId}/media`);
    
    const response = await fetch(
      `${MIXPOST_BASE_URL}/api/${workspaceId}/media`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${MIXPOST_API_KEY}`,
          ...formData.getHeaders()
        },
        body: formData
      }
    );
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('Mixpost API error:', errorText);
      throw new Error(`Mixpost API error (${response.status}): ${errorText}`);
    }
    
    const result = await response.json();
    console.log('Successfully uploaded to Mixpost:', result);
    
    res.json({ 
      success: true, 
      mediaId: result.id || result.data?.id,
      message: 'Video uploaded to Mixpost workspace'
    });
    
  } catch (error) {
    console.error('Mixpost upload error:', error);
    res.status(500).json({ 
      error: error.message,
      details: 'Failed to upload to Mixpost. Please check your workspace ID and try again.'
    });
  }
});

// Cleanup old files
setInterval(() => {
  const now = Date.now();
  const maxAge = 24 * 60 * 60 * 1000;
  
  ['uploads', 'processed'].forEach(dir => {
    fs.readdirSync(dir).forEach(file => {
      const filePath = path.join(dir, file);
      const stats = fs.statSync(filePath);
      if (now - stats.mtimeMs > maxAge) {
        fs.unlinkSync(filePath);
        console.log(`Cleaned up old file: ${file}`);
      }
    });
  });
}, 60 * 60 * 1000);

app.listen(PORT, () => {
  console.log(`\nHigh-Quality Video Converter Server Started`);
  console.log(`Port: ${PORT}`);
  console.log(`Quality Settings:`);
  console.log(`   - Resolution: 1080p`);
  console.log(`   - CRF: ${HIGH_QUALITY_SETTINGS.crf}`);
  console.log(`   - Preset: ${HIGH_QUALITY_SETTINGS.preset}`);
  console.log(`   - Video Bitrate: ${HIGH_QUALITY_SETTINGS.videoBitrate}`);
  console.log(`   - Audio Bitrate: ${HIGH_QUALITY_SETTINGS.audioBitrate}`);
  console.log(`Mixpost Integration: ${MIXPOST_API_KEY ? 'Enabled' : 'Disabled'}`);
  console.log(`Ready for conversions!\n`);
});



