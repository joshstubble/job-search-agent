FROM node:20-slim

ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    NEXT_TELEMETRY_DISABLED=1 \
    # puppeteer-core uses this system chromium instead of downloading its own
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    PUPPETEER_SKIP_DOWNLOAD=true

WORKDIR /app

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
        ca-certificates \
        chromium \
        fonts-liberation \
        fonts-noto-color-emoji \
        fonts-dejavu-core \
        libnss3 \
        libatk1.0-0 \
        libatk-bridge2.0-0 \
        libcups2 \
        libdrm2 \
        libxkbcommon0 \
        libxcomposite1 \
        libxdamage1 \
        libxfixes3 \
        libxrandr2 \
        libgbm1 \
        libpango-1.0-0 \
        libasound2 \
 && rm -rf /var/lib/apt/lists/* \
 && corepack enable \
 && corepack prepare pnpm@10 --activate

# The source tree is volume-mounted in compose (./dashboard:/app) so we don't
# COPY it in. Dev-mode command: pnpm dev with Turbopack on 0.0.0.0:3000.

CMD ["pnpm", "dev", "--hostname", "0.0.0.0", "--port", "3000"]
