FROM node:18-slim

# Install base dependencies
RUN apt-get update && apt-get install -y \
    ffmpeg \
    libvips-dev \
    libde265-dev \
    libx265-dev \
    pkg-config \
    python3 \
    make \
    g++ \
    cmake \
    git \
    wget \
    && rm -rf /var/lib/apt/lists/*

# Build libheif from source with plugin support
RUN cd /tmp && \
    wget https://github.com/strukturag/libheif/releases/download/v1.17.6/libheif-1.17.6.tar.gz && \
    tar -xzf libheif-1.17.6.tar.gz && \
    cd libheif-1.17.6 && \
    mkdir build && cd build && \
    cmake --preset=release .. \
    -DWITH_LIBDE265=ON \
    -DWITH_X265=ON \
    -DWITH_EXAMPLES=OFF && \
    make && make install && \
    ldconfig && \
    cd / && rm -rf /tmp/libheif-1.17.6*

WORKDIR /app

COPY package*.json ./

RUN npm install --production
RUN npm rebuild sharp --build-from-source

# Verify HEIC support
RUN node -e "const sharp = require('sharp'); console.log('Sharp formats:', Object.keys(sharp.format));"

COPY . .

RUN mkdir -p uploads/videos uploads/images uploads/audio processed/videos processed/images processed/audio

EXPOSE 3000

CMD ["node", "server.js"]
