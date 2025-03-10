# Use Python 3.11-slim base image
FROM python:3.11-slim

# Set the working directory
WORKDIR /app

# Install build dependencies
RUN apt-get update && apt-get install -y \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Upgrade pip
RUN pip install --no-cache-dir --upgrade pip

# Copy the dependencies file
COPY requirements.txt .

# Install the dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Add current directory to PYTHONPATH
ENV PYTHONPATH="/app"

# Copy the entire project directory to the container
COPY . .

# Expose the port
EXPOSE 8002

# Use Hypercorn as the ASGI server
CMD ["hypercorn", "./Server.StorageServer:app", "--bind", "0.0.0.0:8002"]
