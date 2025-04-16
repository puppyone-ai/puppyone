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
    """测试获取工作流数据，正确处理SSE响应"""
    url = f"{base_url}/get_data/{task_id}"
    retries = 3
    
    for attempt in range(retries):
        try:
            print(f"\n正在从 {url} 获取数据...")
            response = requests.get(url, stream=True)
            response.raise_for_status()
            print(f"响应状态码: {response.status_code}")
            print("\n开始接收流式响应:")
            print("-" * 50)
            
            # 调用专用函数解析SSE格式的结果
            print(f"Response: {response}")
            parse_sse_results(response)
            print("-" * 50)
            print("流式响应接收完成")
            break
            
        except ChunkedEncodingError as e:
            print(f"分块编码错误: {e}, 第 {attempt + 1} 次尝试 (共 {retries} 次)")
            if attempt == retries - 1:
                raise
        except Exception as e:
            print(f"处理响应时出错: {e}")
            break

def parse_sse_results(response):
    """正确解析Server-Sent Events格式的响应"""
    for line in response.iter_lines(decode_unicode=True):
        print(f"Received line: {line}")
        # 跳过空行
        if not line:
            continue
            
        # 处理SSE格式的数据行
        if line.startswith("data:"):
            # 正确提取JSON部分
            json_data = line[line.find("{"):]
            try:
                # 解析每个事件的JSON数据
                data = json.loads(json_data)
                print(f"Received data: {data}")
                # 根据数据类型进行特定处理
                if "error" in data:
                    print(f"❌ 错误: {data['error']}")
                elif data.get("is_complete") is True:
                    print("✅ 处理完成: 所有边缘处理完毕")
                else:
                    # 打印中间数据的概要信息
                    output_blocks = data.get("data", {})
                    block_ids = list(output_blocks.keys()) if isinstance(output_blocks, dict) else []
                    print(f"📦 收到输出块 ({len(block_ids)}个): {', '.join(block_ids)}")
                    
            except json.JSONDecodeError as e:
                print(f"❌ JSON解析错误: {e}, 原始数据: {line}")
            except Exception as e:
                print(f"❌ 处理事件时出错: {e}")


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
        if file_name != "test_files.json":
            continue

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
