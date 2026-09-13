FROM litestream/litestream:0.5.17 AS litestream

FROM oven/bun:1.4
WORKDIR /app
COPY --from=litestream /usr/local/bin/litestream /usr/local/bin/litestream
COPY package.json bun.lock bunfig.toml tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
RUN bun install --frozen-lockfile && bun run build
COPY litestream.yml ./
COPY docker ./docker
ENV PERCH_DB_PATH=/data/perch.db PERCH_UPLOAD_DIR=/data/uploads PERCH_WEB_DIST=/app/apps/web/dist PORT=3000
EXPOSE 3000
CMD ["sh", "/app/docker/start.sh"]
