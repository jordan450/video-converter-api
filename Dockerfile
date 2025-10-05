FROM node:18-slim

RUN apt-get update && apt-get install -y \
    ffmpeg \
    imagemagick \
    libvips-dev \
    pkg-config \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Configure ImageMagick to allow HEIC processing
RUN sed -i 's/rights="none" pattern="HEIC"/rights="read|write" pattern="HEIC"/' /etc/ImageMagick-6/policy.xml || true

WORKDIR /app

COPY package*.json ./

RUN npm install --production

COPY . .

RUN mkdir -p uploads/videos uploads/images uploads/audio processed/videos processed/images processed/audio

EXPOSE 3000

CMD ["node", "server.js"]
