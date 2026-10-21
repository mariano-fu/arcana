# Built with context web/ and the named context `caddyconf` (this directory); see
# deploy/docker-compose.yml. Base images are pinned by tag and digest; bump both together.

# The PWA, built from the committed sources and lockfile.
FROM node:26.11.1-alpine@sha256:143494b1da2945f061539253adc65e4f1569ddf07da2d384c022c791a9d90a4a AS web
WORKDIR /web
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
# The commit shown in Ajustes → Versiones. The build context has no .git, so vite.config.ts
# would fall back to "dev"; compose passes it in (BUILD_COMMIT, see deploy/README.md).
ARG BUILD_COMMIT=
# `npm run build` also checks licenses.json against the installed dependencies.
RUN GITHUB_SHA="${BUILD_COMMIT}" npm run build

FROM caddy:2.11.7-alpine@sha256:d8542f48d34a9cf4e4c11a478865229840e87e4c96ea3f439101f31a5d35f75f
# The image's binary carries a file capability (bind ports < 1024). Caddy here listens on 8080
# as a non-root user with every capability dropped, where a binary with file capabilities
# can't be executed; a plain copy drops them.
RUN cp /usr/bin/caddy /tmp/caddy && mv /tmp/caddy /usr/bin/caddy \
    && adduser -D -H -u 10002 caddy
COPY --from=caddyconf Caddyfile /etc/caddy/Caddyfile
COPY --from=web /web/dist /srv
USER caddy
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD ["wget", "-q", "--spider", "http://127.0.0.1:8080/healthz"]
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
