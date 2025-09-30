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
const MIXPOST_API_KEY = process.env.MIXPOST_API_KEY || 'your-api-key-here';
const MIXPOST_BASE_URL = process.env.MIXPOST_BASE_URL || 'https://autoposter.typamanagement.com/mixpost';

// Middleware
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
    mixpost: {
      configured: MIXPOST_API_KEY !== 'your-api-key-here',
      baseUrl: MIXPOST_BASE_URL
    },
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

// MIXPOST INTEGRATION ENDPOINT WITH FULL DEBUG LOGGING
app.post('/api/mixpost/upload', async (req, res) => {
  const { videoFilename, workspaceId } = req.body;
  
  console.log('\n========== MIXPOST UPLOAD DEBUG ==========');
  console.log('Timestamp:', new Date().toISOString());
  console.log('Video filename:', videoFilename);
  console.log('Workspace ID:', workspaceId);
  console.log('MIXPOST_BASE_URL:', MIXPOST_BASE_URL);
  console.log('MIXPOST_API_KEY configured:', MIXPOST_API_KEY !== 'your-api-key-here');
  console.log('API Key (first 20 chars):', MIXPOST_API_KEY ? MIXPOST_API_KEY.substring(0, 20) + '...' : 'NOT SET');
  
  if (!MIXPOST_API_KEY || MIXPOST_API_KEY === 'your-api-key-here') {
    console.log('ERROR: Mixpost API key not configured');
    return res.status(500).json({ error: 'Mixpost API key not configured on server' });
  }
  
  if (!workspaceId) {
    console.log('ERROR: Workspace ID missing');
    return res.status(400).json({ error: 'Workspace ID is required' });
  }
  
  try {
    const videoPath = path.join(__dirname, 'processed', videoFilename);
    console.log('Video path:', videoPath);
    
    if (!fs.existsSync(videoPath)) {
      console.log('ERROR: Video file not found at path');
      return res.status(404).json({ error: 'Video file not found' });
    }
    
    const fileStats = fs.statSync(videoPath);
    console.log('Video file size:', (fileStats.size / (1024 * 1024)).toFixed(2), 'MB');
    
    const formData = new FormData();
    formData.append('file', fs.createReadStream(videoPath));
    
    // Construct the correct Mixpost URL based on documentation
    const uploadUrl = `${MIXPOST_BASE_URL}/api/${workspaceId}/media`;
    console.log('Upload URL:', uploadUrl);
    
    console.log('Making request to Mixpost API...');
    
    const response = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${MIXPOST_API_KEY}`,
        ...formData.getHeaders()
      },
      body: formData
    });
    
    console.log('Response status:', response.status);
    console.log('Response status text:', response.statusText);
    console.log('Response headers:', JSON.stringify(response.headers.raw(), null, 2));
    
    const responseText = await response.text();
    console.log('Response body (first 500 chars):', responseText.substring(0, 500));
    
    if (!response.ok) {
      console.log('ERROR: Mixpost API returned non-OK status');
      console.log('Full error response:', responseText);
      
      throw new Error(`Mixpost API error (${response.status}): ${responseText.substring(0, 200)}`);
    }
    
    let result;
    try {
      result = JSON.parse(responseText);
      console.log('Parsed response:', JSON.stringify(result, null, 2));
    } catch (parseError) {
      console.log('ERROR: Failed to parse response as JSON');
      throw new Error('Invalid JSON response from Mixpost');
    }
    
    console.log('SUCCESS: Video uploaded to Mixpost');
    console.log('Media ID:', result.id || result.uuid);
    console.log('==========================================\n');
    
    res.json({ 
      success: true, 
      mediaId: result.id || result.uuid,
      mediaUrl: result.url,
      message: 'Video uploaded to Mixpost workspace'
    });
    
  } catch (error) {
    console.error('EXCEPTION in Mixpost upload:', error.message);
    console.error('Stack trace:', error.stack);
    console.log('==========================================\n');
    
    res.status(500).json({ 
      error: error.message,
      details: 'Check server logs for more information'
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
  console.log(`\n========================================`);
  console.log(`High-Quality Video Converter Server`);
  console.log(`========================================`);
  console.log(`Port: ${PORT}`);
  console.log(`Quality: 1080p CRF ${HIGH_QUALITY_SETTINGS.crf}`);
  console.log(`Preset: ${HIGH_QUALITY_SETTINGS.preset}`);
  console.log(`Video Bitrate: ${HIGH_QUALITY_SETTINGS.videoBitrate}`);
  console.log(`Audio Bitrate: ${HIGH_QUALITY_SETTINGS.audioBitrate}`);
  console.log(`Mixpost: ${MIXPOST_API_KEY !== 'your-api-key-here' ? 'Configured' : 'Not configured'}`);
  console.log(`Mixpost URL: ${MIXPOST_BASE_URL}`);
  console.log(`========================================\n`);
});
