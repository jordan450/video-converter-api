// Updated server.js for generic video conversion
const express = require('express');
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const cors = require('cors');
const path = require('path');
const fs = require('fs').promises;
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());
app.use('/downloads', express.static('outputs'));

// File upload configuration
const storage = multer.diskStorage({
  destination: 'uploads/',
  filename: (req, file, cb) => {
    cb(null, `${uuidv4()}-${file.originalname}`);
  }
});

const upload = multer({ 
  storage,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('video/')) {
      cb(null, true);
    } else {
      cb(new Error('Only video files allowed'));
    }
  }
});

// Job tracking
const jobs = new Map();

// Generic video conversion settings for maximum social media compatibility
const GENERIC_SETTINGS = {
  name: 'Universal Social Media',
  codec: 'libx264',
  profile: 'baseline',
  level: '3.0',
  pixelFormat: 'yuv420p',
  crf: 23,
  preset: 'medium',
  audioCodec: 'aac',
  audioSampleRate: 44100,
  audioBitrate: '128k'
};

// API Routes

// Upload and convert to generic format
app.post('/api/convert', upload.single('video'), async (req, res) => {
  try {
    const jobId = uuidv4();
    
    if (!req.file) {
      return res.status(400).json({ error: 'No video file provided' });
    }
    
    // Initialize job
    jobs.set(jobId, {
      id: jobId,
      status: 'processing',
      progress: 0,
      result: null,
      error: null,
      createdAt: new Date(),
      originalFile: req.file.originalname
    });
    
    // Start conversion asynchronously
    processVideoGeneric(req.file, jobId);
    
    res.json({ 
      jobId, 
      status: 'processing',
      message: 'Generic video conversion started'
    });
    
  } catch (error) {
    console.error('Conversion error:', error);
    res.status(500).json({ error: 'Conversion failed' });
  }
});

// Get job status
app.get('/api/jobs/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  
  res.json(job);
});

// Download converted file
app.get('/api/download/:filename', async (req, res) => {
  const filename = req.params.filename;
  const filepath = path.join(__dirname, 'outputs', filename);
  
  try {
    await fs.access(filepath);
    res.download(filepath, filename);
  } catch (error) {
    res.status(404).json({ error: 'File not found' });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    activeJobs: jobs.size,
    conversionType: 'generic'
  });
});

// Generic video processing function
const processVideoGeneric = async (file, jobId) => {
  const job = jobs.get(jobId);
  
  try {
    const outputFilename = `${jobId}_universal.mp4`;
    const outputPath = path.join('outputs', outputFilename);
    
    await new Promise((resolve, reject) => {
      ffmpeg(file.path)
        // Video settings for maximum compatibility
        .videoCodec(GENERIC_SETTINGS.codec)
        .outputOptions([
          `-profile:v ${GENERIC_SETTINGS.profile}`,   // Baseline profile for max compatibility
          `-level ${GENERIC_SETTINGS.level}`,         // Level 3.0 for older devices
          `-pix_fmt ${GENERIC_SETTINGS.pixelFormat}`, // yuv420p required by social platforms
          `-crf ${GENERIC_SETTINGS.crf}`,             // Good quality balance
          `-preset ${GENERIC_SETTINGS.preset}`,       // Medium speed/compression balance
          '-movflags +faststart',                      // Enable progressive download
          '-avoid_negative_ts make_zero',              // Fix timestamp issues
          '-max_muxing_queue_size 1024',               // Prevent muxing errors
          '-fflags +genpts'                            // Generate timestamps
        ])
        // Audio settings
        .audioCodec(GENERIC_SETTINGS.audioCodec)
        .audioFrequency(GENERIC_SETTINGS.audioSampleRate)
        .audioBitrate(GENERIC_SETTINGS.audioBitrate)
        .audioChannels(2) // Stereo
        // Scale video to maintain quality while being social-media friendly
        .videoFilters([
          // Scale to max 1920x1080 (Full HD) maintaining aspect ratio
          'scale=min(1920\\,iw):min(1080\\,ih):force_original_aspect_ratio=decrease',
          // Ensure dimensions are even (required by H.264)
          'pad=ceil(iw/2)*2:ceil(ih/2)*2'
        ])
        .output(outputPath)
        .on('progress', (progress) => {
          job.progress = Math.round(progress.percent || 0);
          console.log(`Job ${jobId}: ${job.progress}%`);
        })
        .on('end', () => {
          console.log(`✅ Generic conversion completed for job ${jobId}`);
          
          job.status = 'completed';
          job.progress = 100;
          job.result = {
            filename: outputFilename,
            downloadUrl: `/api/download/${outputFilename}`
          };
          job.completedAt = new Date();
        })
        .on('error', (error) => {
          console.error(`❌ Generic conversion failed for job ${jobId}:`, error.message);
          
          job.status = 'failed';
          job.error = error.message;
          job.failedAt = new Date();
          
          reject(error);
        })
        .run();
    });
    
  } catch (error) {
    console.error(`💥 Job ${jobId} processing failed:`, error);
    job.status = 'failed';
    job.error = error.message;
    job.failedAt = new Date();
  } finally {
    // Cleanup input file
    try {
      await fs.unlink(file.path);
      console.log(`🗑️ Cleaned up input file: ${file.originalname}`);
    } catch (error) {
      console.log('Could not delete input file:', error.message);
    }
  }
};

// Cleanup old files and jobs (runs every hour)
const cleanup = async () => {
  const ONE_DAY = 24 * 60 * 60 * 1000;
  const now = Date.now();
  
  // Clean up old jobs
  for (const [jobId, job] of jobs.entries()) {
    if (now - job.createdAt.getTime() > ONE_DAY) {
      jobs.delete(jobId);
      console.log(`🗑️ Cleaned up old job: ${jobId}`);
    }
  }
  
  // Clean up old output files
  try {
    const files = await fs.readdir('outputs');
    for (const file of files) {
      const filepath = path.join('outputs', file);
      const stats = await fs.stat(filepath);
      
      if (now - stats.mtime.getTime() > ONE_DAY) {
        await fs.unlink(filepath);
        console.log(`🗑️ Deleted old file: ${file}`);
      }
    }
  } catch (error) {
    console.log('Cleanup error:', error.message);
  }
};

// Start cleanup interval
setInterval(cleanup, 60 * 60 * 1000); // Every hour

// Error handling middleware
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File too large. Maximum size is 500MB.' });
    }
  }
  
  console.error('Unhandled error:', error);
  res.status(500).json({ error: 'Internal server error' });
});

// Initialize directories and start server
const startServer = async () => {
  try {
    await fs.mkdir('uploads', { recursive: true });
    await fs.mkdir('outputs', { recursive: true });
    console.log('📁 Directories initialized');
  } catch (error) {
    console.log('Directory setup error:', error.message);
  }
  
  app.listen(PORT, () => {
    console.log(`🚀 TYPA Video Forge API running on port ${PORT}`);
    console.log(`🎥 Generic video conversion service`);
    console.log(`📋 Settings: ${GENERIC_SETTINGS.codec}, ${GENERIC_SETTINGS.profile}, ${GENERIC_SETTINGS.pixelFormat}`);
    console.log(`🌐 Compatible with all major social media platforms`);
    console.log(`📊 Health check: http://localhost:${PORT}/api/health`);
  });
};

startServer().catch(console.error);
