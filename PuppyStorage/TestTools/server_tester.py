import os
import json
import string
import random
import requests


def json_reader(
    file_path: str
) -> dict:
    with open(file_path, 'r', encoding='utf-8') as file:
        json_data = json.load(file)
    return json_data

def test_embed_vector(
    base_url: str,
    headers: dict,
    configs: dict,
    user_id: str
) -> str:
    url = f"{base_url}/vector/embed/{user_id}"
    response = requests.post(
        url,
        data=json.dumps(configs),
        headers=headers
    )
    print("Embed Vector Response Status Code:", response.status_code)
    collection_name = response.json()
    print(f"Collection Name: {collection_name}")
    return collection_name

def test_delete_collection(
    base_url: str,
    headers: dict,
    collection_name: str,
    vdb_configs: dict
) -> str:
    url = f"{base_url}/vector/delete/{collection_name}"
    response = requests.delete(
        url,
        data=json.dumps(vdb_configs),
        headers=headers
    )
    response.raise_for_status()
    print("Delete Vector Response Status Code:", response.status_code)
    response_body = response.json()
    print("Delete Vector Response Body:", response_body)
    message = response_body.get("message", None)
    print(f"Message: {message}")
    return message

def test_search_collection(
    base_url: str,
    headers: dict,
    collection_name: str,
    search_configs: dict
) -> str:
    url = f"{base_url}/vector/search/{collection_name}"
    response = requests.get(
        url,
        data=json.dumps(search_configs),
        headers=headers
    )
    response.raise_for_status()
    print("Search Vector Response Status Code:", response.status_code)
    results = response.json()
    print(f"Searched Results: {results}")
    return results

def generate_random_file(
    file_path: str,
    size_kb: int = 1
) -> None:
    with open(file_path, 'w') as file:
        for _ in range(size_kb * 1024):
            file.write(random.choice(string.ascii_letters))

def test_generate_presigned_url_and_upload(
    user_id: str
):
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
    base_url = "http://127.0.0.1:8002"
    test_kit = '../TestKit'
    directory = os.path.join(os.path.dirname(__file__), test_kit)

    for file_name in os.listdir(directory):
        if not file_name.endswith('.json'):
            print(f"ERROR: Invalid test case format: {file_name} \nJson format required")

        file_path = os.path.join(directory, file_name)
        configs = json_reader(file_path)
        headers = {
            "Content-Type": "application/json"
        }
        print(f"========================= {file_name} =========================")
        print("Testing Embedding...")
        embed_configs = {
            "chunks": configs.get("chunks", []),
            "model": "text-embedding-ada-002",
            "vdb_type": configs.get("vdb_type", "pgvector"),
            "create_new": configs.get("create_new", True),
        }
        user_id = configs.get("user_id", "")
        index_name = test_embed_vector(base_url, headers, embed_configs, user_id)

        if index_name:
            print("\nTesting Vector Search...")
            search_configs = {
                "vdb_type": configs.get("vdb_type", "pgvector"),
                "query": configs.get("query", ""),
                "top_k": configs.get("top_k", 5),
                "threshold": configs.get("threshold", 0.5),
                "model": configs.get("model_name", "text-embedding-ada-002")
            }
            test_search_collection(base_url, headers, index_name, search_configs)
            print("\nTesting Delete Collection...")
            delete_configs = {
                "vdb_type": configs.get("vdb_type", "pgvector")
            }
            test_delete_collection(base_url, headers, index_name, delete_configs)
        else:
            print("Failed to retrieve task_id.")
        print("============================================================\n")
