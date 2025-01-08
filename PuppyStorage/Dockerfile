# Use Python 3.11-slim base image
FROM python:3.11-slim

# Set the working directory
WORKDIR /app

# Copy the dependencies file
COPY requirements.txt .

# Install the dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy the entire project directory to the container
COPY . .

# Expose the port
EXPOSE 8002

# Use Hypercorn as the ASGI server
CMD ["hypercorn", "Server.fastapi_server:app", "--bind", "0.0.0.0:8002"]
