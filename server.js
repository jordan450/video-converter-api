// ============================================
// MULTI-VERSION VIDEO CONVERTER SERVER
// Debug Version for Mixpost Uploads
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
    console.log('💓 Health check received');
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

// Job Status Route
app.get(['/api/job/:jobId', '/api/video/status/:jobId'], (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  
  res.json({
    jobId: req.params.jobId,
    status: job.status === 'processing' ? 'active' : job.status,
    progress: job.versions.version1.progress,
    data: job.status === 'completed' ? [{
      id: 'version1',
      name: job.versions.version1.filename,
      downloadUrl: `/api/download/${req.params.jobId}/${version1}`,
      size: job.versions.version1.sizeReadable
    }] : undefined
  });
});

// ============================================
// DEBUGGED MIXPOST UPLOAD ROUTE
// ============================================

app.post('/api/mixpost/upload', async (req, res) => {
  console.log('🔵 [DEBUG] Mixpost upload request started');
  console.log('🔵 [DEBUG] Request Body:', JSON.stringify(req.body));

  const { filename, workspaceId } = req.body;
  
  if (!filename || !workspaceId) {
    console.error('🔴 [ERROR] Missing filename or workspaceId');
    return res.status(400).json({ error: 'Missing parameters', received: req.body });
  }

  const filePath = path.join('processed', 'videos', filename);
  console.log(`🔵 [DEBUG] Looking for file at: ${filePath}`);

  if (!fs.existsSync(filePath)) {
    console.error(`🔴 [ERROR] File NOT found at ${filePath}`);
    // Debug: List files that actually exist to help troubleshoot
    try {
        const existingFiles = fs.readdirSync(path.join('processed', 'videos'));
        console.error(`🔴 [DEBUG] Existing files in processed/videos:`, existingFiles);
    } catch (e) {
        console.error('🔴 [DEBUG] Could not list directory');
    }
    return res.status(404).json({ error: 'File not found on server' });
  }

  try {
    console.log('🔵 [DEBUG] File found. Creating ReadStream...');
    const fileStream = fs.createReadStream(filePath);
    
    const formData = new FormData();
    formData.append('file', fileStream);

    const uploadUrl = `https://autoposter.typamanagement.com/api/${workspaceId}/media`;
    const mixpostToken = 'kuWpPvLYPVdLX7c1qA3MmMFozHugLkO1U7KWl8vs6b4e64e1';

    console.log(`🔵 [DEBUG] Sending POST request to: ${uploadUrl}`);
    
    const response = await fetch(uploadUrl, {
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${mixpostToken}`, 
        ...formData.getHeaders() 
      },
      body: formData
    });

    console.log(`🔵 [DEBUG] Response Status: ${response.status} ${response.statusText}`);

    // Try to parse JSON, but handle text responses (like HTML errors) gracefully
    let data;
    const responseText = await response.text();
    try {
        data = JSON.parse(responseText);
        console.log('🔵 [DEBUG] Parsed Response JSON:', data);
    } catch (e) {
        console.error('🔴 [ERROR] Failed to parse JSON response. Raw text:', responseText);
        return res.status(500).json({ error: 'Invalid response from Mixpost', raw: responseText });
    }

    if (response.ok) {
      console.log('✅ [SUCCESS] Upload successful');
      res.json({ success: true, data });
    } else {
      console.error('🔴 [ERROR] Mixpost API rejected upload');
      res.status(response.status).json({ error: 'Mixpost upload failed', details: data });
    }
  } catch (error) {
    console.error('🔴 [CRITICAL ERROR] Exception caught:', error);
    console.error('🔴 Stack:', error.stack);
    res.status(500).json({ 
        error: 'Server crash during upload', 
        message: error.message,
        stack: error.stack 
    });
  }
});

// Download Route
app.get('/api/download/:jobId/:versionKey', (req, res) => {
  const job = jobs.get(req.params.jobId);
  const version = job?.versions[req.params.versionKey];
  if (!version?.filename) return res.status(404).send('Not found');
  res.download(path.join('processed', 'videos', version.filename));
});

// Processing Function (High Bitrate)
async function processVersion(inputPath, jobId, versionKey) {
  const job = jobs.get(jobId);
  const outputFilename = `${jobId}_${versionKey}.mp4`;
  const outputPath = path.join('processed', 'videos', outputFilename);

  ffmpeg(inputPath)
    .outputOptions(['-b:v 20000k', '-preset fast', '-pix_fmt yuv420p', '-movflags +faststart'])
    .on('progress', (p) => { job.versions[versionKey].progress = Math.min(99, Math.floor(p.percent || 0)); })
    .on('end', () => {
        const stats = fs.statSync(outputPath);
        job.status = 'completed';
        job.versions[versionKey] = { 
            status: 'completed', progress: 100, filename: outputFilename, 
            sizeReadable: (stats.size / 1024 / 1024).toFixed(2) + ' MB' 
        };
        if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
    })
    .on('error', (err) => { 
        console.error(`FFmpeg Error for job ${jobId}:`, err);
        job.status = 'failed'; job.error = err.message; 
    })
    .save(outputPath);
}

app.listen(PORT, () => console.log(`🚀 Debug Server listening on port ${PORT}`));
