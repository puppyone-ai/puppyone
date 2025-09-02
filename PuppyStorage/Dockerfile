# Use Python 3.11 base image
FROM python:3.11.5-slim

# Install OS dependencies needed by some Python packages
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    ffmpeg \
    libgl1 \
    libglib2.0-0 \
    git \
    && rm -rf /var/lib/apt/lists/*

# Set a working directory for the app
WORKDIR /app

# Copy requirements.txt and install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip setuptools wheel \
    && pip install --no-cache-dir -r requirements.txt

# Copy the entire project directory to the container
COPY . .
RUN if [ ! -f .env ] && [ -f .env.example ]; then cp .env.example .env; fi

# Add current directory to PYTHONPATH
ENV PYTHONPATH="/app"

# Expose the port FastAPI will run on
EXPOSE 8002

# Set the entry point to run the FastAPI server
CMD ["python", "-m", "hypercorn", "server.storage_server:app", "--bind", "0.0.0.0:8002"]
