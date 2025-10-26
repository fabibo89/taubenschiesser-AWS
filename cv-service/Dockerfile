FROM python:3.11-slim

WORKDIR /app

# Install system dependencies including execstack for onnxruntime fix
RUN apt-get update && apt-get install -y \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender-dev \
    libgomp1 \
    libgthread-2.0-0 \
    libglib2.0-0 \
    libgl1-mesa-dri \
    libgl1 \
    execstack \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements and install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Fix onnxruntime executable stack issue on Linux
# This removes the executable stack requirement that causes security errors
RUN find /usr/local/lib/python3.11/site-packages/onnxruntime -name "*.so" -exec execstack -c {} \; 2>/dev/null || true

# Copy source code
COPY . .

# Create models directory
RUN mkdir -p /app/models

# Create non-root user
RUN useradd --create-home --shell /bin/bash app
RUN chown -R app:app /app
USER app

# Expose port
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD python -c "import requests; requests.get('http://localhost:8000/health')"

# Start the application
CMD ["python", "app.py"]
