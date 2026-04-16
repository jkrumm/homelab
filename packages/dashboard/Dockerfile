# Stage 1: Build
FROM oven/bun:1-alpine AS build
WORKDIR /app

# Copy workspace manifests for dependency resolution
COPY package.json bun.lock ./
COPY packages/dashboard/package.json ./packages/dashboard/

# Install all dependencies (dev included — needed for vite build)
RUN bun install --frozen-lockfile

# Copy dashboard source
COPY packages/dashboard/ ./packages/dashboard/

# Build Vite app
WORKDIR /app/packages/dashboard
RUN bun run build

# Stage 2: Serve with nginx
FROM nginx:alpine
COPY --from=build /app/packages/dashboard/dist /usr/share/nginx/html
COPY packages/dashboard/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
