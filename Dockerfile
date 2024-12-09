# Use Python 3.11 base image
FROM python:3.11.5

# Set a working directory for the app
WORKDIR /app

# Install system dependencies required for OpenCV
RUN apt-get update && apt-get install -y \
    libgl1-mesa-glx \
    libglib2.0-0

# Copy requirements.txt and install dependencies
COPY PuppyEngine/requirements.txt . 
RUN pip install --no-cache-dir -r requirements.txt

# Copy the entire project directory to the container
COPY . .

# Set PYTHONPATH to /app for module imports
ENV PYTHONPATH="/app/PuppyEngine"

# Expose the port FastAPI will run on
EXPOSE 8000

# Set the entry point to run the FastAPI server from PuppyEngine
CMD ["uvicorn", "PuppyEngine.Server.fastapi_server:app", "--host", "0.0.0.0", "--port", "8000"]
