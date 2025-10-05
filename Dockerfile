FROM node:18-slim

# Install base dependencies
RUN apt-get update && apt-get install -y \
    ffmpeg \
    libde265-dev \
    libx265-dev \
    pkg-config \
    python3 \
    make \
    g++ \
    cmake \
    git \
    wget \
    meson \
    ninja-build \
    libexpat1-dev \
    libglib2.0-dev \
    libjpeg-dev \
    libpng-dev \
    libwebp-dev \
    libtiff-dev \
    libexif-dev \
    libgsf-1-dev \
    && rm -rf /var/lib/apt/lists/*

# Build libheif from source with plugins
RUN cd /tmp && \
    wget https://github.com/strukturag/libheif/releases/download/v1.17.6/libheif-1.17.6.tar.gz && \
    tar -xzf libheif-1.17.6.tar.gz && \
    cd libheif-1.17.6 && \
    mkdir build && cd build && \
    cmake --preset=release .. -DWITH_LIBDE265=ON -DWITH_X265=ON -DWITH_EXAMPLES=OFF && \
    make -j$(nproc) && make install && \
    ldconfig && \
    rm -rf /tmp/libheif-1.17.6*

# Build libvips from source with libheif support
RUN cd /tmp && \
    wget https://github.com/libvips/libvips/releases/download/v8.15.1/vips-8.15.1.tar.xz && \
    tar -xf vips-8.15.1.tar.xz && \
    cd vips-8.15.1 && \
    meson setup build --buildtype=release --prefix=/usr/local && \
    cd build && \
    ninja && \
    ninja install && \
    ldconfig && \
    rm -rf /tmp/vips-8.15.1*

WORKDIR /app

COPY package*.json ./

RUN npm install --production
RUN npm rebuild sharp --build-from-source

# Verify formats
RUN node -e "const sharp = require('sharp'); console.log('Sharp formats:', Object.keys(sharp.format));"

COPY . .

RUN mkdir -p uploads/videos uploads/images uploads/audio processed/videos processed/images processed/audio

EXPOSE 3000

CMD ["node", "server.js"]
