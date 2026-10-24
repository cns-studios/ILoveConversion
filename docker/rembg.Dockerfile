FROM python:3.11.11-slim-bookworm@sha256:081075da77b2b55c23c088251026fb69a7b2bf92471e491ff5fd75c192fd38e5

RUN apt-get update && \
    apt-get install -y --no-install-recommends curl && \
    rm -rf /var/lib/apt/lists/*

RUN groupadd -g 10001 app && \
    useradd -r -u 10001 -g app -m -d /home/app app

WORKDIR /app

COPY rembg-service/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

ENV U2NET_HOME=/app/models
ENV NUMBA_CACHE_DIR=/app/numba_cache
ENV MPLCONFIGDIR=/app/mpl_config

RUN mkdir -p /app/models /app/numba_cache /app/mpl_config

RUN python -c "\
from rembg import new_session; \
new_session('silueta'); \
print('Model + numba ready')"

COPY rembg-service/app.py .

RUN chown -R 10001:10001 /app /home/app

USER 10001:10001

EXPOSE 5000

CMD ["gunicorn", "--bind", "0.0.0.0:5000", "--workers", "1", "--timeout", "120", "app:app"]