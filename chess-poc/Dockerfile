# Canton Chess in one container: Canton sandbox (in-memory), Wallet Gateway, mock OAuth, the chess UI and nginx.
# Everything is transient: deleting the container deletes all data. Only port 8080 is exposed; put TLS in front
# of it (it serves the chess UI on / and the Wallet Gateway under /wallet-gateway/).
#
#   docker build -f chess-poc/Dockerfile -t canton-chess .        (context: the repository root)
#   docker buildx build --platform linux/arm64 -f chess-poc/Dockerfile -t canton-chess --load .   (e.g. for a Raspberry Pi)
#
# Multi-arch: the heavy stages (pnpm build, Daml build) always run on the build machine's own architecture; only
# the small runtime stage is per target platform. The Daml SDK (dpm) has no ARM build, so the DAR and the Canton jar
# (a JVM fat jar that bundles its own linux aarch64 natives) are produced in an amd64 stage and just copied over.
#   docker run -p 8080:8080 -e PUBLIC_URL=https://canton-chess.honegger.dev canton-chess

# ---- build the workspace packages the PoC consumes ---------------------------------------------------------
# One RUN on purpose: the installed workspace is several GB and must not end up in an image layer. The pnpm store is
# a cache mount, so rebuilds do not download everything again.
FROM --platform=$BUILDPLATFORM node:24-bookworm-slim AS build
RUN corepack enable
WORKDIR /repo
COPY . .
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
# install the native optional dependencies (esbuild, ...) for both linux architectures, so the deployed
# node_modules work on whichever platform the image is built for
RUN printf 'supportedArchitectures:\n  os: [linux]\n  cpu: [x64, arm64]\n  libc: [glibc]\n' >> pnpm-workspace.yaml
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile \
 && pnpm nx build @canton-network/wallet-gateway-remote \
 && pnpm nx build @canton-network/dapp-sdk \
 && (cd chess-poc/web && ./node_modules/.bin/vite build) \
 && pnpm --filter @canton-network/wallet-gateway-remote deploy --prod --config.inject-workspace-packages=true /out/gateway \
 && pnpm --filter @canton-network/mock-oauth2 deploy --config.inject-workspace-packages=true /out/mock-oauth \
 && cp -r chess-poc/web/dist /out/web \
 && rm -rf /repo/node_modules /repo/.nx

# ---- Daml build: the DAR and the Canton jar --------------------------------------------------------------------
# runs on the build machine's own architecture (dpm needs a native amd64 or arm64 host).
FROM --platform=$BUILDPLATFORM nginx:stable-bookworm AS daml
ARG SDK_VERSION=3.6.0
ENV DPM_SDK_VERSION=$SDK_VERSION HOME=/root PATH=/root/.dpm/bin:$PATH
# one RUN: the SDK is several GB and must not stay in a layer; only the two files in /out do
COPY chess-poc/daml /src/daml
RUN curl -sSL https://get.digitalasset.com/install/install.sh | sh -s $SDK_VERSION \
 && cd /src/daml && dpm build \
 && mkdir /out \
 && cp .daml/dist/chess-poc-0.0.1.dar /out/chess-poc.dar \
 && cp /root/.dpm/cache/components/canton-open-source/*/lib/canton-open-source-*.jar /out/canton.jar \
 && rm -rf /root/.dpm

# ---- runtime ---------------------------------------------------------------------------------------------------
# nginx image (Debian 12, has curl and bash) plus the Java runtime Canton needs and Node, copied from their official
# images so that nothing has to be installed with apt.
FROM eclipse-temurin:21-jre-jammy AS jre
FROM node:24-bookworm-slim AS node
FROM nginx:stable-bookworm
COPY --from=jre /opt/java/openjdk /opt/java/openjdk
COPY --from=node /usr/local/bin/node /usr/local/bin/node
ENV JAVA_HOME=/opt/java/openjdk PATH=/opt/java/openjdk/bin:$PATH
COPY --from=build /out/gateway /opt/chess/gateway
COPY --from=build /out/mock-oauth /opt/chess/mock-oauth
COPY --from=build /out/web /opt/chess/web
# Canton 3.6 (self-issued party tokens need >= 3.6) runs straight from its jar, no dpm in the runtime image.
COPY --from=daml /out/canton.jar /opt/chess/canton.jar
COPY --from=daml /out/chess-poc.dar /opt/chess/chess-poc.dar

COPY chess-poc/gateway /opt/chess/gateway-config
COPY chess-poc/scripts/grant-lobby-read.mjs /opt/chess/grant-lobby-read.mjs
COPY chess-poc/docker /opt/chess/docker
RUN chmod +x /opt/chess/docker/start.sh

ENV PUBLIC_URL=https://canton-chess.honegger.dev
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=600s CMD curl -sf http://127.0.0.1:8080/wallet-gateway/healthz || exit 1
ENTRYPOINT ["/opt/chess/docker/start.sh"]
