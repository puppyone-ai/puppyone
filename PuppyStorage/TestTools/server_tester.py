import json
import requests
from requests.exceptions import ChunkedEncodingError
import os
import random
import string

# Define the base URL of the Flask server
base_url = "http://localhost:9000"

def json_reader(
    file_path: str
) -> dict:
    with open(file_path, 'r', encoding='utf-8') as file:
        json_data = json.load(file)
    return json_data

def test_send_data(
        file_path: str,
        user_id: str
) -> str:
    url = f"{base_url}/index/embed/{user_id}"
    headers = {'Content-Type': 'application/json'}
    response = requests.post(url, data=json.dumps(json_reader(file_path)), headers=headers)

    print("Send Data Response Status Code:", response.status_code)
    response_body = response.json()
    print("Send Data Response Body:", response_body)

    # Extract and return the task_id from the response
    index_name = response_body['data'].get('embedding').get("index_name")
    print(f"Index_name: {index_name}")
    return index_name

def test_delete_index(index_name: str, vdb_type: str):
    url = f"{base_url}/index/{index_name}/{vdb_type}"
    retries = 3
    for attempt in range(retries):
        try:
            response = requests.delete(url)
            response.raise_for_status()
            print("Get Data Response Status Code:", response.status_code)
            parse_results(response)
            break
        except ChunkedEncodingError as e:
            print(f"ChunkedEncodingError: {e}, attempt {attempt + 1} of {retries}")
            if attempt == retries - 1:
                raise

def parse_results(response):
    for line in response.iter_lines(decode_unicode=True):
        if line.startswith("data:"):
            line = line.replace("data: ", "", 1)
            data = json.loads(line)
            if data.get("is_complete"):
                print("All edges processed.")
            else:
                print("Intermediate data:", data.get("data"))

def generate_random_file(file_path: str, size_kb: int = 1):
    """Generate a random text file of specified size in kilobytes."""
    with open(file_path, 'w') as file:
        for _ in range(size_kb * 1024):
            file.write(random.choice(string.ascii_letters))

def test_generate_presigned_url_and_upload(user_id: str):
    # Get the presigned URL
    url = f"{base_url}/generate_presigned_url/{user_id}"
    response = requests.get(url)
    presigned_data = response.json()
    print("Presigned URL data:", presigned_data)

    presigned_url = presigned_data.get("presigned_url")
    headers = presigned_data.get("headers", {})

    # Generate a random file
    file_path = "random_test_file.txt"
    generate_random_file(file_path, size_kb=1)

    # Upload the file to Cloudflare R2 using the presigned URL
    with open(file_path, 'rb') as file:
        upload_response = requests.put(presigned_url, data=file, headers=headers)
    
    print("Upload Response Status Code:", upload_response.status_code)
    if upload_response.status_code == 200:
        print("File uploaded successfully.")
    else:
        print("Failed to upload file.")

    # Clean up the generated file
    os.remove(file_path)

if __name__ == "__main__":
    user_id = "test_user"
    test_kit = '../TestKit'
    directory = os.path.join(os.path.dirname(__file__), test_kit)

    for file_name in os.listdir(directory):
        if not file_name.endswith('.json'):
            print(f"ERROR: Invalid test case format: {file_name} \nJson format required")

        file_path = os.path.join(directory, file_name)
        print(f"========================= {file_name} =========================")
        print("Testing create index...")
        index_name = test_send_data(file_path, user_id)
    
        if index_name:
            print("\nTesting delete_index...")
            test_delete_index(index_name, "postgres")
        else:
            print("Failed to retrieve task_id.")
        print(f"============================================================\n")