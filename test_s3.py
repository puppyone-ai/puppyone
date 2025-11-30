import boto3

# LocalStack 网关地址（你用 localstack start 默认也是 4566）
# endpoint_url = "http://localhost.localstack.cloud:4566"
# 或直接用 localhost:
endpoint_url = "http://localhost:4566"

s3 = boto3.client(
    "s3",
    endpoint_url=endpoint_url,
    region_name="us-east-1",
    aws_access_key_id="test",
    aws_secret_access_key="test",
)

# 列出本地 S3 的所有 bucket
resp = s3.list_buckets()
print(resp.get("Buckets"))