"""测试配置文件 - 确保使用 LocalStack"""

import os

# 设置测试环境变量，确保使用 LocalStack
os.environ.setdefault("S3_ENDPOINT_URL", "http://localhost:4566")
os.environ.setdefault("S3_BUCKET_NAME", "contextbase")
os.environ.setdefault("S3_REGION", "us-east-1")
os.environ.setdefault("S3_ACCESS_KEY_ID", "test")
os.environ.setdefault("S3_SECRET_ACCESS_KEY", "test")

