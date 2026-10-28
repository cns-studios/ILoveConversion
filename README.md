# ILoveConversion

### Available [here](https://ilc.cns.ad)

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

- **API (Go)**: A gateway handling uploads, job management, and file serving. The static frontend is embedded in the binary, so no separate web server is needed.
- **Worker (Go)**: It manages the processing lifecycle and orchestrates system tools like `libvips`, `ffmpeg`, `ghostscript`, and `qpdf`.
- **Rembg Service (Python)**: An AI service dedicated to background removal tasks.
- **PostgreSQL**: Stores job metadata and session state, and is the job queue itself (leased rows claimed with `FOR UPDATE SKIP LOCKED`).

Running on Kubernetes (k3s, CNPG, several replicas)? See [docs/kubernetes.md](docs/kubernetes.md).

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
   The site is available on `http://localhost:5823` (`PORT`). Database migrations run first in a one-shot `migrate` service (`./api --migrate-only`).

## Configuration

| Variable | Default | Description |
|---|---|---|
| `POSTGRES_PASSWORD` | required | Database password |
| `ENCRYPTION_MASTER_KEY` | required | 64 hex characters; every job key is derived from it |
| `ENCRYPTION_KEY_ID`, `ENCRYPTION_OLD_KEYS` | `1`, empty | Key rotation: id of the current key and `id:hex` pairs of retired keys |
| `TRUSTED_PROXIES`, `CLIENT_IP_HEADER` | empty | CIDRs whose forwarding headers are believed, and an optional header such as `CF-Connecting-IP`. Empty trusts nothing |
| `JOB_LEASE_SECONDS`, `DRAIN_TIMEOUT_SECONDS` | `60`, `120` | Worker lease length (heartbeat at a quarter of it) and how long a stopping worker waits for running jobs |
| `POSTGRES_USER`, `POSTGRES_DB` | `ilc` | Database user and name |
| `MAX_FILE_SIZE` | `524288000` | Upload limit in bytes (500 MB) |
| `FILE_RETENTION_HOURS` | `1` | Hours until results and job records are deleted |
| `CLEANUP_INTERVAL_MINUTES` | `5` | How often expired jobs are removed |
| `RATE_LIMIT_PER_HOUR` | `600` | Uploads per IP and hour |
| `FLAG_THRESHOLD` | `5000` | Uploads per IP and hour after which the IP is blocked |
| `WORKER_CONCURRENCY` | `4` | Jobs processed in parallel |
| `TMPFS_SIZE`, `API_TMPFS_SIZE` | `1g` | RAM-backed scratch space for the worker and the API |
| `TIMEOUT_*`, `RETRY_*` | see `.env.example` | Per-operation time limits (seconds) and retries |
| `LOG_RETENTION_DAYS` | `7` | Days of container logs to keep |
| `DOCKER_CONTAINERS_DIR` | `/var/lib/docker/containers` | Location of Docker's container logs on the host |
| `PORT` | `5823` | Host port the API (and the site) is published on |
| `API_PORT` | `3015` | Internal API port |

## Data Processing Pipeline

### 1. Ingestion & Encryption
When a file is uploaded via the `/api/jobs` endpoint:
- The system generates a cryptographically secure **Job ID**.
- A unique **Encryption Key** is derived using HKDF-SHA256 from the global `MASTER_KEY` and the `JobID`.
- The raw stream is encrypted on-the-fly using **AES-256-GCM** in 64KB chunks before it ever touches the persistent storage (`/storage/inputs`).

### 2. Asynchronous Queuing
Once the encrypted input is stored, a job manifest is recorded in PostgreSQL, and the job is marked claimable in the same table, which acts as the **PostgreSQL-backed queue**. This allows the API to remain responsive regardless of the file size or processing complexity.

### 3. Secure Worker Processing
A Worker claims the job with a lease (renewed by a heartbeat) and performs the following:
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
