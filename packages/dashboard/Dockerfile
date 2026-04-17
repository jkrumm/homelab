# Stage 1: Build
FROM oven/bun:1-alpine AS build
WORKDIR /app

# Build args for VITE_ env vars (embedded at build time)
ARG VITE_API_URL=https://api.jkrumm.com
ENV VITE_API_URL=$VITE_API_URL

# Copy workspace manifests for dependency resolution
COPY package.json bun.lock ./
COPY packages/dashboard/package.json ./packages/dashboard/
COPY packages/api/package.json ./packages/api/

# Install all workspace dependencies (dev included — needed for vite build + type checking)
RUN bun install

# Copy source — API src needed for @homelab/api type resolution (type-only, stripped at build)
COPY packages/api/src/ ./packages/api/src/
COPY packages/dashboard/ ./packages/dashboard/

# Build Vite app
WORKDIR /app/packages/dashboard
RUN bun run build

# Stage 2: Serve with nginx
FROM nginx:alpine
COPY --from=build /app/packages/dashboard/dist /usr/share/nginx/html
COPY packages/dashboard/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
