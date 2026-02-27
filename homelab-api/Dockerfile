FROM oven/bun:1-alpine
WORKDIR /app
COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile --production
COPY src ./src
EXPOSE 3030
CMD ["bun", "run", "src/index.ts"]
