# Worker image: Node (BullMQ orchestration) + Python + FFmpeg (the media service).
# Node remains the sole queue orchestrator; Python is spawned per job as an argv
# array (no shell).
FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg python3 fonts-inter fonts-dejavu-core ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable
WORKDIR /app

COPY pnpm-workspace.yaml package.json ./
COPY packages/contracts/package.json packages/contracts/
COPY apps/worker/package.json apps/worker/
RUN pnpm install --frozen-lockfile=false

COPY packages ./packages
COPY apps/worker ./apps/worker
COPY services ./services

ENV MEDIA_SCRIPT=/app/services/media/render.py
CMD ["pnpm", "--filter", "@clipforge/worker", "start"]
