FROM golang:1.22.12-bookworm@sha256:3d699e4d15d0f8f13c9195c0632a16702b8cbdece2955af1c23b37ae5d55a253 AS builder

WORKDIR /build

COPY go.mod go.sum ./
RUN go mod download

COPY internal ./internal
COPY frontend ./frontend
COPY cmd/api ./cmd/api

RUN mkdir -p /out && \
    CGO_ENABLED=0 GOOS=linux \
    go build -trimpath -ldflags="-s -w" -o /out/api ./cmd/api

FROM alpine:3.20.6@sha256:de4fe7064d8f98419ea6b49190df1abbf43450c1702eeb864fe9ced453c1cc5f

RUN apk add --no-cache ca-certificates tzdata && \
    addgroup -S -g 10001 app && adduser -S -u 10001 -G app app

WORKDIR /app
COPY --from=builder /out/api .

RUN mkdir -p /app/storage/inputs /app/storage/outputs && \
    chown -R 10001:10001 /app

USER 10001:10001

EXPOSE 3015 9090

CMD ["./api"]
