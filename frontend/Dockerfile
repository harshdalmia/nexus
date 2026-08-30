# Static demo image: build with Node, serve the output with nginx.
#
# Demo build (no engine, bundled data):
#   docker build -t nexus-frontend .
#
# Build pointed at a live engine instead:
#   docker build --build-arg BUILD_MODE=live --build-arg VITE_API_BASE_URL=https://engine.example.com -t nexus-frontend .
#
# Run:
#   docker run --rm -p 8080:8080 nexus-frontend

FROM node:20.18.1-alpine AS build

WORKDIR /app

# Dependencies first, so a source-only change does not reinstall them.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# `demo` selects .env.demo; `live` uses the values passed in below.
ARG BUILD_MODE=demo
ARG VITE_API_BASE_URL
ARG VITE_BASE_PATH
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
ENV VITE_BASE_PATH=$VITE_BASE_PATH

RUN if [ "$BUILD_MODE" = "demo" ]; then npm run build:demo; else npm run build; fi

FROM nginx:1.27.3-alpine AS serve

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Unprivileged port, so the container can run as a non-root user.
EXPOSE 8080

# nginx:alpine ships this user; the image writes only to /var/cache/nginx and /tmp.
USER nginx

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget --quiet --tries=1 --spider http://127.0.0.1:8080/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
