"""
测试不同类型模型的输入和输出
"""
import os
from pathlib import Path
from litellm import completion
import base64
import json

os.environ['DEEPINFRA_API_KEY'] = "6hTcqIRiFjZQI4QVyWB7tY57FtbAdj5E"

# 加载一个测试样本
dataset_base_path = Path(__file__).parent / ".ocr-dataset"
test_data_path = dataset_base_path / "少年班072025.jpg"

# 输入准备
with open(test_data_path, "rb") as image_file:
    base64_image = base64.b64encode(image_file.read()).decode('utf-8')

text_prompt = f"""这是一张广告，请你将其中的内容按照下面的JSON格式进行提取。语言：简体中文。
JSON格式：
{{
    "title": "", // 广告的主要标题
    "slogan": [], // 广告的口号
    "location": "", // 广告的地点
    "time": [], // 广告的时间，可能有不同的时间，如举办时间、上课时间等等。
    "contact": "", // 广告的联系方式，如果没有就写None
    "other": "", // 广告的其他信息，用合适的KV对来表示
}}
"""

messages=[
    {
        "role": "user",
        "content": [
            { "type": "image_url", "image_url": { "url": f"data:image/png;base64,{base64_image}"}},
            { "type": "text", "text": text_prompt }
        ]
    }
]

def write_to_json(response, path):
    with open(path, "w") as f:
        json.dump(response.json(), f, ensure_ascii=False, indent=2)
    print(f"测试结果已保存到 {path}")

def test_ocr_model(model):
    print(f"正在测试{model}模型")
    response = completion(
        model=model,
        messages=messages
    )
    output_json_path = dataset_base_path / f"{model.split('/')[-1]}.json"
    write_to_json(response, output_json_path)

if __name__ == "__main__":
    models = [
        "deepinfra/deepseek-ai/DeepSeek-OCR",
        "deepinfra/PaddlePaddle/PaddleOCR-VL-0.9B",
        "deepinfra/Qwen/Qwen3-VL-30B-A3B-Instruct"
    ]
    for model in models:
        test_ocr_model(model)