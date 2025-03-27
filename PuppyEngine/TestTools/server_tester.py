import json
import requests
from requests.exceptions import ChunkedEncodingError


def server_health_check(
    base_url: str
):
    url = f"{base_url}/health"
    response = requests.get(url)
    response_body = response.json()
    print(response_body.get("status"))

def json_reader(
    file_path: str
) -> dict:
    with open(file_path, 'r', encoding='utf-8') as file:
        json_data = json.load(file)
    return json_data

def test_send_data(
    file_path: str,
    base_url: str
) -> str:
    url = f"{base_url}/send_data"
    headers = {'Content-Type': 'application/json'}
    response = requests.post(url, data=json.dumps(json_reader(file_path)), headers=headers)

    print("Send Data Response Status Code:", response.status_code)
    response_body = response.json()
    print("Send Data Response Body:", response_body)

    # Extract and return the task_id from the response
    task_id = response_body.get("task_id")
    print(f"Task ID: {task_id}")
    return task_id

def test_get_data(
    task_id: str,
    base_url: str
):
    url = f"{base_url}/get_data/{task_id}"
    retries = 3
    for attempt in range(retries):
        try:
            response = requests.get(url, stream=True)
            response.raise_for_status()
            print("Get Data Response Status Code:", response.status_code)
            parse_results(response)
            break
        except ChunkedEncodingError as e:
            print(f"ChunkedEncodingError: {e}, attempt {attempt + 1} of {retries}")
            if attempt == retries - 1:
                raise

def parse_results(
    response
):
    for line in response.iter_lines(decode_unicode=True):
        if line.startswith("data:"):
            line = line.replace("data: ", "", 1)
            data = json.loads(line)
            if data.get("is_complete"):
                print("All edges processed.")
            else:
                print("Intermediate data:", data.get("data"))


if __name__ == "__main__":
    import os
    import time
    base_url = "http://127.0.0.1:8001"
    test_kit = '../TestKit'
    directory = os.path.join(os.path.dirname(__file__), test_kit)

    server_health_check(base_url)

    start = time.time()
    for file_name in os.listdir(directory):
        if not file_name.endswith('.json'):
            print(f"ERROR: Invalid test case format: {file_name} \nJson format required")
        # if file_name != "test_vdb_search.json":
        #     continue

        file_path = os.path.join(directory, file_name)
        print(f"========================= {file_name} =========================")
        print("Testing send_data...")
        task_id = test_send_data(file_path, base_url)

        if task_id:
            print("\nTesting get_data...")
            test_get_data(task_id, base_url)
        else:
            print("Failed to retrieve task_id.")
        print("============================================================\n")
    end = time.time()
    print(f"Total time taken: {end - start} seconds")
