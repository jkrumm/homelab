FROM python:3.13-alpine

WORKDIR /app

RUN apk add --no-cache curl gcc musl-dev libffi-dev openssl-dev \
  && addgroup -S app && adduser -S app -G app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY server.py relogin.py ./

RUN mkdir -p /app/tokens && chown -R app:app /app

USER app

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -fsS http://localhost:8080/health || exit 1

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8080", "--log-level", "info"]
