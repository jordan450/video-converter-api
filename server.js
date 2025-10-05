const express = require('express');
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const FormData = require('form-data');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

// Mixpost Configuration
const MIXPOST_API_KEY = process.env.MIXPOST_API_KEY || 'q8tCpIiGu8qe4nQNlq2Hg2TTkYr8SvgAyBYweJVld0ec7391';
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

// Storage setup for videos
const videoStorage = multer.diskStorage({
  destination: 'uploads/videos/',
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueName + path.extname(file.originalname));
  }
});

const videoUpload = multer({ 
  storage: videoStorage,
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('video/')) {
      cb(null, true);
    } else {
      cb(new Error('Only video files allowed'));
    }
  }
});

// Storage setup for images
const imageStorage = multer.diskStorage({
  destination: 'uploads/images/',
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueName + path.extname(file.originalname));
  }
});

const imageUpload = multer({
  storage: imageStorage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    // Accept image files and HEIC specifically
    const allowedMimes = [
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'image/heic',
      'image/heif',
      'image/heic-sequence',
      'image/heif-sequence'
    ];
    
    // Also check file extension as fallback
    const ext = path.extname(file.originalname).toLowerCase();
    const allowedExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic', '.heif'];
    
    if (file.mimetype.startsWith('image/') || allowedMimes.includes(file.mimetype) || allowedExts.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only image files allowed'));
    }
  }
});

// Ensure directories exist
['uploads/videos', 'uploads/images', 'processed/videos', 'processed/images'].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Job storage
const jobs = new Map();
let jobCounter = 0;

// HIGH QUALITY VIDEO SETTINGS
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

// ==================== VIDEO PROCESSING ====================

async function processVideoHighQuality(inputPath, outputPath, config) {
  return new Promise((resolve, reject) => {
    console.log(`Processing video: ${path.basename(outputPath)}`);
    
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
          console.log(`Video progress: ${percent}%`);
        }
      })
      .on('end', () => {
        console.log(`Video completed: ${path.basename(outputPath)}`);
        resolve();
      })
      .on('error', (error) => {
        console.error(`Video error: ${error.message}`);
        reject(error);
      })
      .run();
  });
}

function generateConfig(index) {
  return {
    speed: 1,
    brightness: 0,
    contrast: 1,
    saturation: 1,
    scale: 1,
    flip: false
  };
}

function calculateSimilarity(config) {
  return 100;
}

// ==================== IMAGE PROCESSING ====================

const { promisify } = require('util');
const exec = promisify(require('child_process').exec);

async function convertImage(inputPath, outputPath, format, quality) {
  console.log(`Converting image: ${path.basename(inputPath)} -> ${format.toUpperCase()}`);
  
  const ext = path.extname(inputPath).toLowerCase();
  const isHeic = ext === '.heic' || ext === '.heif';
  
  try {
    // Try ImageMagick for HEIC files first
    if (isHeic) {
      console.log('Detected HEIC file, attempting ImageMagick conversion');
      
      const qualityParam = format === 'png' ? '-quality 100' : `-quality ${quality}`;
      const command = `convert "${inputPath}" ${qualityParam} "${outputPath}"`;
      
      console.log('ImageMagick command:', command);
      await exec(command);
      
      const outputStats = fs.statSync(outputPath);
      const inputStats = fs.statSync(inputPath);
      
      console.log(`HEIC converted via ImageMagick successfully`);
      console.log(`  Original: HEIC (${(inputStats.size / 1024 / 1024).toFixed(2)}MB)`);
      console.log(`  Output: ${format} (${(outputStats.size / 1024 / 1024).toFixed(2)}MB)`);
      
      return {
        originalFormat: 'heic',
        width: null,  // ImageMagick doesn't provide metadata easily
        height: null,
        originalSize: inputStats.size,
        outputSize: outputStats.size
      };
    }
    
    // Use Sharp for non-HEIC formats
    const image = sharp(inputPath);
    const metadata = await image.metadata();
    
    console.log('Image metadata:', {
      format: metadata.format,
      width: metadata.width,
      height: metadata.height
    });
    
    if (format === 'png') {
      await image
        .png({ quality: 100, compressionLevel: 9, effort: 10 })
        .toFile(outputPath);
    } else if (format === 'jpg' || format === 'jpeg') {
      await image
        .jpeg({ quality: parseInt(quality), mozjpeg: true })
        .toFile(outputPath);
    }
    
    const outputStats = fs.statSync(outputPath);
    const inputStats = fs.statSync(inputPath);
    
    console.log(`Image converted successfully`);
    console.log(`  Original: ${metadata.format} (${(inputStats.size / 1024 / 1024).toFixed(2)}MB)`);
    console.log(`  Output: ${format} (${(outputStats.size / 1024 / 1024).toFixed(2)}MB)`);
    
    return {
      originalFormat: metadata.format,
      width: metadata.width,
      height: metadata.height,
      originalSize: inputStats.size,
      outputSize: outputStats.size
    };
  } catch (error) {
    console.error('Image conversion error:', error.message);
    
    if (isHeic) {
      throw new Error('HEIC format could not be converted. Please convert your image to JPG or PNG first using https://heictojpg.com');
    }
    
    throw error;
  }
}
    
    // Use Sharp for other formats
    if (format === 'png') {
      await image
        .png({ quality: 100, compressionLevel: 9, effort: 10 })
        .toFile(outputPath);
    } else if (format === 'jpg' || format === 'jpeg') {
      await image
        .jpeg({ quality: parseInt(quality), mozjpeg: true })
        .toFile(outputPath);
    }
    
    const outputStats = fs.statSync(outputPath);
    const inputStats = fs.statSync(inputPath);
    
    console.log(`Image converted successfully`);
    console.log(`  Original: ${metadata.format} (${(inputStats.size / 1024 / 1024).toFixed(2)}MB)`);
    console.log(`  Output: ${format} (${(outputStats.size / 1024 / 1024).toFixed(2)}MB)`);
    
    return {
      originalFormat: metadata.format,
      width: metadata.width,
      height: metadata.height,
      originalSize: inputStats.size,
      outputSize: outputStats.size
    };
  } catch (error) {
    console.error('Image conversion error:', error.message);
    console.error('Stack:', error.stack);
    throw error;
  }
}

// ==================== ROUTES ====================

app.get('/health', (req, res) => {
  res.json({ 
    status: 'SUCCESS', 
    message: 'High-Quality Video & Image Converter ready',
    features: {
      video: 'Available (FFmpeg)',
      image: 'Available (Sharp)',
      mixpost: MIXPOST_API_KEY !== 'your-api-key-here'
    },
    videoQuality: {
      resolution: '1080p',
      crf: HIGH_QUALITY_SETTINGS.crf,
      preset: HIGH_QUALITY_SETTINGS.preset
    },
    imageFormats: {
      input: ['JPEG', 'PNG', 'WebP', 'GIF', 'HEIC', 'TIFF', 'AVIF'],
      output: ['PNG', 'JPG']
    }
  });
});

// ==================== VIDEO ENDPOINTS ====================

app.post('/api/video/upload', videoUpload.single('video'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No video uploaded' });
  }
  
  console.log(`Video upload: ${req.file.originalname}`);
  
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
  
  console.log(`Starting video job ${jobId}`);
  
  jobs.set(jobId, {
    type: 'video',
    status: 'active',
    progress: 0,
    data: null,
    startTime: Date.now()
  });
  
  processVideos(jobId, videoId, variationCount);
  
  res.json({ 
    success: true, 
    jobId,
    message: 'Processing high-quality 1080p video'
  });
});

async function processVideos(jobId, videoId, count) {
  const job = jobs.get(jobId);
  
  try {
    const files = fs.readdirSync('uploads/videos').filter(f => f.startsWith(videoId));
    if (files.length === 0) {
      throw new Error('Input video file not found');
    }
    
    const actualInput = `uploads/videos/${files[0]}`;
    const results = [];
    
    for (let i = 0; i < count; i++) {
      const config = generateConfig(i);
      const outputPath = `processed/videos/${videoId}_variation_${i + 1}.mp4`;
      
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
    
    console.log(`Video job ${jobId} completed in ${job.totalTime}`);
    
  } catch (error) {
    console.error(`Video job ${jobId} failed:`, error.message);
    job.status = 'failed';
    job.error = error.message;
  }
}

app.get('/api/video/status/:jobId', (req, res) => {
  const job = jobs.get(parseInt(req.params.jobId));
  if (!job || job.type !== 'video') {
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
  const filePath = `processed/videos/${req.params.videoId}.mp4`;
  
  if (fs.existsSync(filePath)) {
    res.download(filePath);
  } else {
    res.status(404).json({ error: 'Video file not found' });
  }
});

// ==================== IMAGE ENDPOINTS ====================

app.post('/api/image/upload', imageUpload.single('image'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No image uploaded' });
  }
  
  const { format = 'png', quality = 95 } = req.body;
  
  console.log(`Image upload: ${req.file.originalname}, converting to ${format.toUpperCase()}`);
  
  try {
    const imageId = path.parse(req.file.filename).name;
    const outputFilename = `${imageId}.${format}`;
    const outputPath = `processed/images/${outputFilename}`;
    
    const result = await convertImage(
      req.file.path, 
      outputPath, 
      format, 
      quality
    );
    
    res.json({
      success: true,
      imageId: imageId,
      filename: outputFilename,
      downloadUrl: `/api/image/download/${outputFilename}`,
      originalFormat: result.originalFormat,
      outputFormat: format.toUpperCase(),
      dimensions: `${result.width}x${result.height}`,
      originalSize: (result.originalSize / 1024).toFixed(2) + ' KB',
      outputSize: (result.outputSize / 1024).toFixed(2) + ' KB',
      compression: ((1 - result.outputSize / result.originalSize) * 100).toFixed(1) + '%'
    });
    
  } catch (error) {
    console.error('Image conversion error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/image/download/:filename', (req, res) => {
  const filePath = `processed/images/${req.params.filename}`;
  
  if (fs.existsSync(filePath)) {
    res.download(filePath);
  } else {
    res.status(404).json({ error: 'Image file not found' });
  }
});

// ==================== MIXPOST INTEGRATION ====================

app.post('/api/mixpost/upload', async (req, res) => {
  const { filename, workspaceId } = req.body;
  
  console.log('\n========== MIXPOST UPLOAD ==========');
  console.log('Filename:', filename);
  console.log('Workspace ID:', workspaceId);
  
  if (!MIXPOST_API_KEY || MIXPOST_API_KEY === 'your-api-key-here') {
    return res.status(500).json({ error: 'Mixpost API key not configured' });
  }
  
  if (!workspaceId) {
    return res.status(400).json({ error: 'Workspace ID required' });
  }
  
  try {
    // Check both video and image directories
    let filePath;
    if (fs.existsSync(`processed/videos/${filename}`)) {
      filePath = `processed/videos/${filename}`;
    } else if (fs.existsSync(`processed/images/${filename}`)) {
      filePath = `processed/images/${filename}`;
    } else {
      return res.status(404).json({ error: 'File not found' });
    }
    
    console.log('File path:', filePath);
    console.log('File size:', (fs.statSync(filePath).size / 1024).toFixed(2), 'KB');
    
    const formData = new FormData();
    formData.append('file', fs.createReadStream(filePath));
    
    const uploadUrl = `${MIXPOST_BASE_URL}/api/${workspaceId}/media`;
    console.log('Upload URL:', uploadUrl);
    
    const response = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${MIXPOST_API_KEY}`,
        ...formData.getHeaders()
      },
      body: formData
    });
    
    console.log('Response status:', response.status);
    
    const responseText = await response.text();
    
    if (!response.ok) {
      console.log('Error response:', responseText.substring(0, 200));
      throw new Error(`Mixpost API error (${response.status})`);
    }
    
    const result = JSON.parse(responseText);
    console.log('SUCCESS - Media ID:', result.id || result.uuid);
    console.log('====================================\n');
    
    res.json({ 
      success: true, 
      mediaId: result.id || result.uuid,
      mediaUrl: result.url,
      message: 'Uploaded to Mixpost workspace'
    });
    
  } catch (error) {
    console.error('Mixpost upload error:', error.message);
    console.log('====================================\n');
    res.status(500).json({ error: error.message });
  }
});

// ==================== CLEANUP ====================

setInterval(() => {
  const now = Date.now();
  const maxAge = 24 * 60 * 60 * 1000;
  
  ['uploads/videos', 'uploads/images', 'processed/videos', 'processed/images'].forEach(dir => {
    if (!fs.existsSync(dir)) return;
    
    fs.readdirSync(dir).forEach(file => {
      const filePath = path.join(dir, file);
      const stats = fs.statSync(filePath);
      if (now - stats.mtimeMs > maxAge) {
        fs.unlinkSync(filePath);
        console.log(`Cleaned: ${file}`);
      }
    });
  });
}, 60 * 60 * 1000);

// ==================== START SERVER ====================

app.listen(PORT, () => {
  console.log('\n========================================');
  console.log('TYPA Converter Server');
  console.log('========================================');
  console.log(`Port: ${PORT}`);
  console.log('Features:');
  console.log('  - Video: 1080p High Quality');
  console.log('  - Images: PNG/JPG conversion');
  console.log('  - Mixpost: ' + (MIXPOST_API_KEY !== 'your-api-key-here' ? 'Enabled' : 'Disabled'));
  console.log('========================================\n');
});







