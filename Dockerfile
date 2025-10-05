FROM node:18-slim

# Install all dependencies including HEIC codec plugins
RUN apt-get update && apt-get install -y \
    ffmpeg \
    libvips-dev \
    libheif-dev \
    libde265-dev \
    libx265-dev \
    libheif-plugin-libde265 \
    libheif-plugin-x265 \
    pkg-config \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./

# Install dependencies and rebuild sharp with full HEIC support
RUN npm install --production
RUN npm rebuild sharp --build-from-source

# Verify HEIC support
RUN node -e "const sharp = require('sharp'); console.log('Sharp formats:', Object.keys(sharp.format));"

COPY . .

RUN mkdir -p uploads/videos uploads/images uploads/audio processed/videos processed/images processed/audio

EXPOSE 3000

CMD ["node", "server.js"]
