from b2sdk.v1 import InMemoryAccountInfo, B2Api

# Set up B2 API
info = InMemoryAccountInfo()
b2_api = B2Api(info)

# Authenticate with Backblaze B2
application_key_id = '0050f60e366b4940000000002'
application_key = 'K005lZeEELd3EVjTztrk7UumGcxG2Y0'
b2_api.authorize_account("production", application_key_id, application_key)

# Define bucket and file details
bucket_name = 'puppyagent-test-bucket'
file_path = './README.md'
file_name = 'README.md'  # This will be the name in the bucket

# Get the bucket
bucket = b2_api.get_bucket_by_name(bucket_name)

# Upload the file
file_info = bucket.upload_local_file(
    local_file=file_path,
    file_name=file_name
)

