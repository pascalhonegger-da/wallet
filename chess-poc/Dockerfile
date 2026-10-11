# Canton Chess in one container: Canton sandbox (in-memory), Wallet Gateway, mock OAuth, the chess UI and nginx.
# Everything is transient: deleting the container deletes all data. Only port 8080 is exposed; put TLS in front
# of it (it serves the chess UI on / and the Wallet Gateway under /wallet-gateway/).
#
#   docker build -f chess-poc/Dockerfile -t canton-chess .        (context: the repository root)
#   docker run -p 8080:8080 -e PUBLIC_URL=https://canton-chess.honegger.dev canton-chess

# ---- build the workspace packages the PoC consumes ---------------------------------------------------------
# One RUN on purpose: the installed workspace is several GB and must not end up in an image layer. The pnpm store is
# a cache mount, so rebuilds do not download everything again.
FROM node:24-bookworm-slim AS build
RUN corepack enable
WORKDIR /repo
COPY . .
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile \
 && pnpm nx build @canton-network/wallet-gateway-remote \
 && pnpm nx build @canton-network/dapp-sdk \
 && (cd chess-poc/web && ./node_modules/.bin/vite build) \
 && pnpm --filter @canton-network/wallet-gateway-remote deploy --prod --legacy /out/gateway \
 && pnpm --filter @canton-network/mock-oauth2 deploy --legacy /out/mock-oauth \
 && cp -r chess-poc/web/dist /out/web

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
# dpm (Daml SDK 3.6.0, which contains the Canton sandbox) is installed here; use another SDK_VERSION at your own risk:
# self-issued party tokens need Canton >= 3.6.
ARG SDK_VERSION=3.6.0
ENV DPM_SDK_VERSION=$SDK_VERSION HOME=/root PATH=/root/.dpm/bin:$PATH
COPY chess-poc/daml /opt/chess/daml
# install the SDK (several GB: damlc, Canton, ...) and build the DAR
RUN curl -sSL https://get.digitalasset.com/install/install.sh | sh -s $SDK_VERSION \
 && cd /opt/chess/daml && dpm build

COPY chess-poc/gateway /opt/chess/gateway-config
COPY chess-poc/scripts/grant-lobby-read.mjs /opt/chess/grant-lobby-read.mjs
COPY chess-poc/docker /opt/chess/docker
RUN chmod +x /opt/chess/docker/start.sh

ENV PUBLIC_URL=https://canton-chess.honegger.dev
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=180s CMD curl -sf http://127.0.0.1:8080/wallet-gateway/healthz || exit 1
ENTRYPOINT ["/opt/chess/docker/start.sh"]
