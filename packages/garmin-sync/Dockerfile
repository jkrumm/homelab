FROM python:3.13-alpine

WORKDIR /app

COPY packages/garmin-sync/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY packages/garmin-sync/sync.py .

# Tokens persisted to volume, DB shared with API container
VOLUME ["/app/tokens", "/app/data"]

CMD ["python", "-u", "sync.py"]
