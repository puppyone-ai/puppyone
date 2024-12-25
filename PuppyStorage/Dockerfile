# 使用官方的 Python 3.11 slim 基础镜像
FROM python:3.11-slim

# 设置工作目录
WORKDIR /app

# 复制项目的 requirements.txt 文件到容器中
COPY requirements.txt .

# 安装 Python 依赖
RUN pip install --no-cache-dir -r requirements.txt

# 复制项目的所有文件到容器中
COPY . .

# 暴露应用运行的端口（假设 FastAPI 默认端口为8000）
EXPOSE 8002

# 启动 FastAPI 服务器，使用 hypercorn
CMD ["hypercorn", "Server.fastapi_server:app", "--bind", "0.0.0.0:8002"] 