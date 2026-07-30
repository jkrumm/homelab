# syntax=docker/dockerfile:1
FROM python:3.13-alpine

WORKDIR /app

RUN apk add --no-cache curl gcc musl-dev libffi-dev openssl-dev \
  && addgroup -S app && adduser -S app -G app

COPY requirements.txt .
# Cache mount instead of --no-cache-dir: pip's download + built-wheel cache lives
# outside the image (no size penalty) and survives `docker compose build --no-cache`,
# which is how this service is always rebuilt — so the C extensions above are not
# recompiled from source on every deploy.
RUN --mount=type=cache,target=/root/.cache/pip \
  pip install -r requirements.txt

COPY server.py relogin.py relogin_auto.py ./

RUN mkdir -p /app/tokens && chown -R app:app /app

USER app

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -fsS http://localhost:8080/health || exit 1

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8080", "--log-level", "info"]
