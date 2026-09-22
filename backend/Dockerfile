FROM python:3.12-slim AS runtime

# Bytecode is deliberately written, and precompiled below. The usual
# PYTHONDONTWRITEBYTECODE=1 keeps an image small, but this service scales to
# zero, so every cold start was recompiling the whole dependency tree --
# including google-cloud and google-genai -- on a single throttled vCPU.
ENV PYTHONUNBUFFERED=1 \
    PORT=8080

WORKDIR /app
RUN groupadd --system planner && useradd --system --gid planner planner

COPY pyproject.toml ./
COPY app ./app
RUN pip install --no-cache-dir . \
 && python -m compileall -q /usr/local/lib/python3.12/site-packages /app

USER planner
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD python -c "import os,urllib.request; urllib.request.urlopen('http://127.0.0.1:'+os.environ.get('PORT','8080')+'/healthz', timeout=2)"
# One worker. Two meant importing the application twice at start, in parallel,
# on the single vCPU this service is sized for, which bought no throughput:
# the route handlers are sync, so Starlette already runs them in a thread pool
# and containerConcurrency caps the instance at 40 in-flight requests either
# way. Cloud Run adds instances for load; the worker count only added startup.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --workers 1 --proxy-headers"]
