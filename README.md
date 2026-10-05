# ILoveConversion

### Available [here](https://ilc.cns-studios.com)

**ILoveConversion** is a high-performance, privacy-focused file processing engine designed for modern web environments. It provides a robust infrastructure to convert, compress, and transform various media types while maintaining strict security standards.

All files are **encrypted at rest** using AES-256-GCM with unique keys derived for every single job. The system is built for speed, utilizing RAM-disks (tmpfs) for all intermediate processing to ensure zero data traces on physical disks during transformation.

## Features

- **Image Transformation**:
  - Format Conversion: JPEG, PNG, WebP, TIFF, GIF, AVIF, HEIF, BMP.
  - High-Efficiency Compression: Lossless and lossy modes with fine-grained quality control.
  - **AI Background Removal**: Seamless integration with the `rembg` microservice using the Silueta model.
- **PDF Optimization**:
  - Multi-stage pipeline using Ghostscript and QPDF.
  - Smart presets: Screen (72 DPI), Ebook (150 DPI), Printer (300 DPI), and Prepress.
- **Audio Processing**:
  - Support for MP3, WAV, FLAC, OGG, OPUS, AAC, M4A, AIFF.
  - Variable and Constant Bitrate (VBR/CBR) control.
- **Video Compression**:
  - Optimized for the web using H.264 (MP4/MKV) and VP9 (WebM).
  - Advanced CRF-based bitrate management and metadata stripping.
- **Privacy First**:
  - Local mode (default) processes images and audio in the browser; nothing is uploaded.
  - Every uploaded file is encrypted immediately upon arrival.
  - Inputs are deleted as soon as a job finishes; results and job records after 1 hour.
  - Uploads are limited to 500 MB by default.

## Architecture

ILC operates as a distributed microservices architecture:

- **API (Go)**: A gateway handling uploads, job management, and file serving.
- **Worker (Go)**: It manages the processing lifecycle and orchestrates system tools like `libvips`, `ffmpeg`, `ghostscript`, and `qpdf`.
- **Rembg Service (Python)**: An AI service dedicated to background removal tasks.
- **Redis**: The backbone for the asynchronous job queue and internal messaging.
- **PostgreSQL**: Stores job metadata, session states, and audit trails.
- **Nginx**: Provides reverse proxying and serves the frontend.

## Quick Start (Docker)

1. **Clone & Enter**:
   ```bash
   git clone https://github.com/cns-studios/ILoveConversion.git && cd ILoveConversion
   ```

2. **Environment Setup**:
   ```bash
   cp .env.example .env
   ```
   Set `POSTGRES_PASSWORD` and `ENCRYPTION_MASTER_KEY` (64 hex characters, `openssl rand -hex 32`). Both are required.

3. **Run**:
   ```bash
   docker compose up -d --build
   ```
   The site is available on `http://localhost:8080` (`NGINX_PORT`). The port is published by `docker-compose.override.yml`, which Docker Compose loads automatically for local runs.

## Deploying on Coolify

1. Create a new resource from this Git repository and choose the **Docker Compose** build pack.
2. Set the Docker Compose location to `/docker-compose.yml`.
3. In **Environment Variables**, fill in `POSTGRES_PASSWORD` and `ENCRYPTION_MASTER_KEY`. Coolify blocks the deployment until both are set. Every other variable has a default and can be changed there as well.
4. Assign your domain to the `nginx` service (port 80). No ports are published on the host; Coolify's proxy routes traffic to nginx.
5. Deploy.

The `log-janitor` service reads Docker's log files from `/var/lib/docker/containers` on the host to delete entries older than `LOG_RETENTION_DAYS`. Set `DOCKER_CONTAINERS_DIR` if Docker stores them elsewhere.

## Configuration

| Variable | Default | Description |
|---|---|---|
| `POSTGRES_PASSWORD` | required | Database password |
| `ENCRYPTION_MASTER_KEY` | required | 64 hex characters; every job key is derived from it |
| `POSTGRES_USER`, `POSTGRES_DB` | `ilc` | Database user and name |
| `MAX_FILE_SIZE` | `524288000` | Upload limit in bytes (500 MB) |
| `NGINX_MAX_BODY_SIZE` | `510m` | nginx request limit; keep it about 10 MB above `MAX_FILE_SIZE` |
| `FILE_RETENTION_HOURS` | `1` | Hours until results and job records are deleted |
| `CLEANUP_INTERVAL_MINUTES` | `5` | How often expired jobs are removed |
| `RATE_LIMIT_PER_HOUR` | `600` | Uploads per IP and hour |
| `FLAG_THRESHOLD` | `5000` | Uploads per IP and hour after which the IP is blocked |
| `WORKER_CONCURRENCY` | `4` | Jobs processed in parallel |
| `TMPFS_SIZE`, `API_TMPFS_SIZE` | `1g` | RAM-backed scratch space for the worker and the API |
| `TIMEOUT_*`, `RETRY_*` | see `.env.example` | Per-operation time limits (seconds) and retries |
| `LOG_RETENTION_DAYS` | `7` | Days of container logs to keep |
| `DOCKER_CONTAINERS_DIR` | `/var/lib/docker/containers` | Location of Docker's container logs on the host |
| `NGINX_PORT` | `8080` | Local port (only used by `docker-compose.override.yml`) |
| `API_PORT` | `3015` | Internal API port |

## Data Processing Pipeline

### 1. Ingestion & Encryption
When a file is uploaded via the `/api/jobs` endpoint:
- The system generates a cryptographically secure **Job ID**.
- A unique **Encryption Key** is derived using HKDF-SHA256 from the global `MASTER_KEY` and the `JobID`.
- The raw stream is encrypted on-the-fly using **AES-256-GCM** in 64KB chunks before it ever touches the persistent storage (`/storage/inputs`).

### 2. Asynchronous Queuing
Once the encrypted input is stored, a job manifest is recorded in PostgreSQL, and the `JobID` is pushed into a **Redis-backed queue**. This allows the API to remain responsive regardless of the file size or processing complexity.

### 3. Secure Worker Processing
A Worker picks up the `JobID` and performs the following:
- **Sandbox Creation**: A temporary directory is created in a RAM-disk (`tmpfs`). This ensures that intermediate, unencrypted files never touch a physical SSD/HDD.
- **Decryption**: The worker derives the job-specific key and decrypts the input file from storage into the RAM-disk.
- **Orchestration**: Depending on the requested operation, the worker invokes the appropriate processor:
    - **Images**: Utilizes `libvips` (via `bimg`) for memory-efficient transformations or `pngquant` for lossy optimization.
    - **PDFs**: Runs a two-pass optimization using `Ghostscript` for content downsampling and `QPDF` for linearization and stream compression.
    - **Audio/Video**: Leverages `ffmpeg` with optimized presets for high-quality, low-bitrate output.
    - **AI Tasks**: For background removal, the file is securely streamed to the internal Rembg microservice.

### 4. Finalization & Output
The resulting file in the RAM-disk is:
- **Re-encrypted**: Using the same job-specific key before being moved to the persistent output storage (`/storage/outputs`).
- **Validated**: The system checks the integrity and size of the output.
- **Cleaned Up**: The RAM-disk sandbox is immediately wiped.

### 5. Automated Cleanup
Encrypted inputs are deleted as soon as a job completes or fails. A background task runs every `CLEANUP_INTERVAL_MINUTES` (default 5) and removes jobs older than `FILE_RETENTION_HOURS` (default 1) together with their output files. Rate-limit records of IP addresses are deleted after 24 hours without a request.