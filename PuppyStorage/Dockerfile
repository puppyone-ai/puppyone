# Use Python 3.11 base image
FROM python:3.11.5-slim

# Install build-essential
RUN apt-get update && apt-get install -y \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Set a working directory for the app
WORKDIR /app

# Copy requirements.txt and install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the entire project directory to the container
COPY . .

# Add current directory to PYTHONPATH
ENV PYTHONPATH="/app"

# Expose the port FastAPI will run on
EXPOSE 8002

# Set the entry point to run the FastAPI server
CMD ["hypercorn", "server.storage_server:app", "--bind", "0.0.0.0:8002"]
