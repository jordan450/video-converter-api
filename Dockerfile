# Use Debian-based Node image for better library compatibility
FROM node:18-bullseye

# Install FFmpeg and image processing libraries including HEIC support
RUN apt-get update && apt-get install -y \
    ffmpeg \
    libvips-dev \
    libheif-dev \
    libde265-dev \
    libx265-dev \
    pkg-config \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Environment variables to force Sharp to use system libvips
ENV SHARP_IGNORE_GLOBAL_LIBVIPS=0
ENV npm_config_sharp_libvips_binary_host=""

# Copy package files
COPY package*.json ./

# Remove sharp from package-lock if it exists, then install
RUN rm -rf node_modules package-lock.json && \
    npm install --production --build-from-source sharp && \
    npm install --production

# Verify Sharp has HEIC support
RUN node -e "const sharp = require('sharp'); sharp.format; console.log('Sharp formats:', Object.keys(sharp.format));"

# Copy application code
COPY . .

# Create necessary directories
RUN mkdir -p uploads/videos uploads/images uploads/audio processed/videos processed/images processed/audio

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (res) => { \
    if (res.statusCode === 200) process.exit(0); else process.exit(1); \
  }).on('error', () => process.exit(1));"

# Start the application
CMD ["npm", "start"]
