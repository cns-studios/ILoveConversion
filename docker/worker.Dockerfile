FROM golang:1.22.12-bookworm@sha256:3d699e4d15d0f8f13c9195c0632a16702b8cbdece2955af1c23b37ae5d55a253 AS builder

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        libvips-dev \
        pkg-config \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

COPY go.mod go.sum ./
RUN go mod download

COPY internal ./internal
COPY cmd/worker ./cmd/worker

RUN mkdir -p /out && \
    CGO_ENABLED=1 GOOS=linux GOARCH=amd64 \
    go build -trimpath -ldflags="-s -w" -o /out/worker ./cmd/worker

FROM debian:bookworm-20250224-slim@sha256:12c396bd585df7ec21d5679bb6a83d4878bc4415ce926c9e5ea6426d23c60bdc

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        ca-certificates \
        tzdata \
        libvips42 \
        ffmpeg \
        ghostscript \
        qpdf \
        pngquant \
    && rm -rf /var/lib/apt/lists/*

RUN groupadd -g 10001 app && useradd -r -u 10001 -g app -M -s /usr/sbin/nologin app

WORKDIR /app
COPY --from=builder /out/worker .

RUN mkdir -p /app/storage/inputs /app/storage/outputs /tmp/processing && \
    chown -R 10001:10001 /app /tmp/processing

USER 10001:10001

EXPOSE 8081

CMD ["./worker"]