FROM oven/bun:1-alpine
WORKDIR /app
# Copy workspace manifests for dependency resolution
COPY package.json bun.lock ./
COPY packages/api/package.json ./packages/api/
RUN bun install
# Copy API source
COPY packages/api/src/ ./packages/api/src/
EXPOSE 4000
CMD ["bun", "run", "packages/api/src/index.ts"]
