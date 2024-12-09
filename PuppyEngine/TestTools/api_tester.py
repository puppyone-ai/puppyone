import os
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
    with open(file_path, "r", encoding="utf-8") as file:
        json_data = json.load(file)
    return json_data

def test_send_data(
    task_id: str,
    file_path: str,
    base_url: str):
    url = f"{base_url}/api/send_data/{task_id}"
    headers = {"Content-Type": "application/json"}
    response = requests.post(
        url,
        data=json.dumps(json_reader(file_path)),
        headers=headers
    )

    print("Send Data Response Status Code:", response.status_code)
    response_body = response.json()
    print("Send Data Response Body:", response_body)

def test_get_data(
    task_id: str,
    base_url: str
):
    url = f"{base_url}/get_data/{task_id}"
    retries = 3
    for attempt in range(retries):
        try:
            response = requests.get(url, stream=False)
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
    # Define the base URL of the Flask server
    base_url = "http://13.212.169.76:8000"

    server_health_check(base_url)
    test_kit = "TestKit"
    directory = os.path.join(os.path.dirname(os.path.dirname(__file__)), test_kit)
    print(f"Running tests in {directory}")
    failed_test = []
    task_id = "6e68c0cb-5c16-4e14-8a74-30a77d9b687b" # paste task_id here
    for file_name in os.listdir(directory):
        if not file_name.endswith(".json"):
            print(
                f"ERROR: Invalid test case format: {file_name} \nJson format required"
            )
        file_path = os.path.join(directory, file_name)
        print(f"========================= {file_name} =========================")
        print("Testing send_data...")
        test_send_data(task_id, file_path, base_url)

        if task_id:
            print("\nTesting get_data...")
            test_get_data(task_id, base_url)
        else:
            print("Failed to retrieve task_id.")
        print("============================================================\n")
