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

// Ensure directories exist
const dirs = ['uploads', 'processed/videos'];
dirs.forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/'),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${Math.random().toString(36).substr(2, 9)}${path.extname(file.originalname)}`)
});

const upload = multer({ storage: storage, limits: { fileSize: 500 * 1024 * 1024 } });

const jobs = new Map();

const VERSION_PRESETS = {
    version1: { name: "Original Enhanced", speed: 1.0, saturation: 1.1, brightness: 0.02, contrast: 1.05, audioPitch: 0, cropPercent: 0, description: "Slightly enhanced" }
};

// Health Check (Ensures 404 is fixed)
app.get(['/', '/health'], (req, res) => res.json({ status: 'online', timestamp: new Date().toISOString() }));

// Video Process Endpoints
app.post(['/api/video/process', '/api/video/upload', '/api/convert'], upload.any(), (req, res) => {
    const file = req.file || (req.files && req.files[0]);
    if (!file) return res.status(400).json({ error: 'No video file' });

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

// Status Endpoint
app.get(['/api/job/:jobId', '/api/video/status/:jobId'], (req, res) => {
    const job = jobs.get(req.params.jobId);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    
    const progresses = Object.values(job.versions).map(v => v.progress || 0);
    const avgProgress = Math.floor(progresses.reduce((a, b) => a + b, 0) / progresses.length);

    res.json({
        jobId: req.params.jobId,
        status: job.status === 'processing' ? 'active' : job.status,
        progress: avgProgress,
        data: job.status === 'completed' ? [{
            id: 'version1',
            name: job.versions.version1.filename,
            downloadUrl: `/api/download/${req.params.jobId}/version1`,
            size: job.versions.version1.sizeReadable
        }] : undefined
    });
});

// Corrected Mixpost Upload 
app.post('/api/mixpost/upload', async (req, res) => {
    const { filename, workspaceId } = req.body;
    
    if (!filename || !workspaceId) return res.status(400).json({ error: 'Missing parameters' });

    const filePath = path.join('processed', 'videos', filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });

    try {
        const formData = new FormData();
        formData.append('file', fs.createReadStream(filePath));

        // Format: https://domain.com/api/<workspaceUuid>/media 
        const uploadUrl = `https://autoposter.typamanagement.com/api/${workspaceId}/media`;
        const mixpostToken = 'kuWpPvLYPVdLX7c1qA3MmMFozHugLkO1U7KWl8vs6b4e64e1';

        const response = await fetch(uploadUrl, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${mixpostToken}`, ...formData.getHeaders() },
            body: formData
        });

        const data = await response.json();
        if (response.ok) {
            res.json({ success: true, data });
        } else {
            res.status(response.status).json({ error: 'Mixpost rejected upload', details: data });
        }
    } catch (error) {
        res.status(500).json({ error: 'Upload failed', message: error.message });
    }
});

app.get('/api/download/:jobId/:versionKey', (req, res) => {
    const job = jobs.get(req.params.jobId);
    const version = job?.versions[req.params.versionKey];
    if (!version?.filename) return res.status(404).send('Not found');
    res.download(path.join('processed', 'videos', version.filename));
});

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
            job.completedTime = Date.now();
            job.versions[versionKey] = { 
                status: 'completed', progress: 100, filename: outputFilename, 
                sizeReadable: (stats.size / 1024 / 1024).toFixed(2) + ' MB' 
            };
            if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
        })
        .save(outputPath);
}

app.listen(PORT, () => console.log(`🚀 Server on port ${PORT}`));
