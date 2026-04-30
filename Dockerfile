FROM node:22-bookworm-slim AS web-build

ARG NPM_REGISTRY=

WORKDIR /app/web

COPY web/package.json web/pnpm-lock.yaml ./

RUN corepack enable \
    && if [ -n "$NPM_REGISTRY" ]; then pnpm config set registry "$NPM_REGISTRY"; fi \
    && pnpm install --frozen-lockfile

COPY web/ ./

RUN pnpm build


FROM golang:1.25-bookworm AS server-build

ARG GO_PROXY=https://proxy.golang.org,direct
ARG GO_SUMDB=sum.golang.org
ARG GO_PRIVATE=
ARG GO_NO_SUMDB=

ENV GOPROXY=${GO_PROXY}
ENV GOSUMDB=${GO_SUMDB}
ENV GOPRIVATE=${GO_PRIVATE}
ENV GONOSUMDB=${GO_NO_SUMDB}

WORKDIR /app/server

COPY server/go.mod server/go.sum ./

RUN go mod download

COPY server/ ./

RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o /out/linux-web-server ./main.go


FROM debian:bookworm-slim

ARG DEBIAN_MIRROR=http://mirrors.ustc.edu.cn/debian
ARG DEBIAN_SECURITY_MIRROR=http://mirrors.ustc.edu.cn/debian-security
ARG APT_PACKAGES="bash ca-certificates curl net-tools procps vim wget"

ENV APT_PACKAGES=${APT_PACKAGES}

WORKDIR /data

RUN printf '%s\n' \
    'Types: deb' \
    "URIs: ${DEBIAN_MIRROR}" \
    'Suites: bookworm bookworm-updates' \
    'Components: main contrib non-free non-free-firmware' \
    'Signed-By: /usr/share/keyrings/debian-archive-keyring.gpg' \
    '' \
    'Types: deb' \
    "URIs: ${DEBIAN_SECURITY_MIRROR}" \
    'Suites: bookworm-security' \
    'Components: main contrib non-free non-free-firmware' \
    'Signed-By: /usr/share/keyrings/debian-archive-keyring.gpg' \
    > /etc/apt/sources.list.d/debian.sources \
    && apt-get update \
    && apt-get install -y --no-install-recommends ${APT_PACKAGES} \
    && mkdir -p /app/web/dist /data /tmp \
    && rm -rf /var/lib/apt/lists/*

COPY --from=server-build /out/linux-web-server /app/server
COPY --from=web-build /app/web/dist /app/web/dist

RUN chown -R root:root /app \
    && chmod -R a=rX /app

ENV HOME=/data
ENV STATIC_DIR=/app/web/dist
ENV GIN_MODE=release

EXPOSE 8080

CMD ["/app/server"]