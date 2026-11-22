# The site and its server as one container. Build: docker build -t ringpad .
# Run: docker run -p 4710:4710 --env-file .env.production ringpad
# Secrets are given at run time through the environment; none is copied into the image.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
# Two small stand-in packages live in the repository (see ADVISORIES.md); the install needs them present.
COPY vendor ./vendor
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
# Runs as a user that cannot write to the code.
RUN useradd --create-home app && mkdir -p /data && chown app /data
COPY --from=build --chown=root:root /app/package.json /app/next.config.mjs /app/site.config.ts ./
COPY --from=build --chown=root:root /app/vendor ./vendor
COPY --from=build --chown=root:root /app/node_modules ./node_modules
COPY --from=build --chown=root:root /app/.next ./.next
COPY --from=build --chown=root:root /app/dist ./dist
COPY --from=build --chown=root:root /app/public ./public
USER app
# Where keys made on first run and uploaded pictures are kept, when no database or picture store is configured.
ENV APP_DATA_DIR=/data
EXPOSE 4710
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:4710/health').then(r=>process.exit(r.status<500?0:1),()=>process.exit(1))"
CMD ["node", "dist/server.mjs"]
