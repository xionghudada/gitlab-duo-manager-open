# Stage 1: Build frontend
FROM node:20-alpine AS frontend
RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /app/frontend
COPY frontend/package.json frontend/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY frontend/ .
RUN pnpm build

# Stage 2: Python backend
FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:0.7 /uv /usr/local/bin/uv
WORKDIR /app
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --no-dev --no-editable
ENV PATH="/app/.venv/bin:$PATH"
COPY backend/ .
COPY --from=frontend /app/backend/static ./static
RUN useradd -r -s /usr/sbin/nologin app && mkdir -p /app/data && chown -R app:app /app
USER app

EXPOSE 22341
CMD ["python", "main.py"]
