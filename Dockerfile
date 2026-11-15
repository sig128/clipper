# Clipforge server (Railway): Node API + jobs, the FFmpeg/libass renderer (Python) and the streamlink recorder.
FROM node:22-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg python3 python3-numpy python3-pip fonts-inter fonts-dejavu-core fontconfig ca-certificates \
 && pip3 install --no-cache-dir --break-system-packages streamlink \
 && rm -rf /var/lib/apt/lists/* \
 && corepack enable

WORKDIR /app
# Workspace manifests first so the dependency layer caches between code changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/contracts/package.json packages/contracts/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
RUN pnpm install --frozen-lockfile --prod --filter @clipforge/server...

COPY packages/contracts packages/contracts
COPY apps/server/src apps/server/src
COPY apps/server/tsconfig.json apps/server/
COPY services/media services/media

ENV NODE_ENV=production MEDIA_SERVICE_DIR=/app/services/media MEDIA_DIR=/data/media WORK_DIR=/data/work PORT=8080
EXPOSE 8080
# tsx resolves from the server package's own node_modules.
WORKDIR /app/apps/server
CMD ["node", "--import", "tsx", "src/index.ts"]
