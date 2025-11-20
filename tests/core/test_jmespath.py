import json
import jmespath

def query_json_data(data: dict, query: str, max_length: int = 2000) -> str:
    """
    对 JSON 数据执行 JMESPath 查询。
    
    Args:
        data (dict): 目标 JSON 数据源。
        query (str): JMESPath 查询字符串。
        max_length (int): 返回结果的最大字符数，防止 Context 溢出。
        
    Returns:
        str: 查询结果的 JSON 字符串，或者错误信息。
    """
    try:
        # 1. 执行查询
        # jmespath.search 返回的是 Python 对象 (dict, list, str, etc.)
        result = jmespath.search(query, data)

        # 2. 处理空结果
        # 这一点很重要，告诉模型没找到，而不是返回 None 造成困惑
        if result is None:
            return "No results found."

        # 3. 将结果转换为 JSON 字符串
        # ensure_ascii=False 保证中文能正常显示
        json_result = json.dumps(result, ensure_ascii=False, indent=2)

        # 4. 长度截断保护 (Token Economy)
        # 如果结果太长，直接截断并提示模型缩小范围
        if len(json_result) > max_length:
            truncated = json_result[:max_length]
            return f"{truncated}\n... [Result truncated due to length. Please refine your query.]"

        return json_result

    except jmespath.exceptions.ParseError:
        # 捕捉语法错误，返回给模型，让模型知道自己语法写错了
        return f"Error: Invalid JMESPath syntax in query: '{query}'."
    except Exception as e:
        # 捕捉其他未知错误
        return f"Error: An unexpected error occurred: {str(e)}"

# --- 测试代码 ---

if __name__ == "__main__":
    # 模拟数据
    source_data = {
        "company": "FutureAI Inc.",
        "departments": [
            {
                "name": "R&D",
                "employees": [
                    {"name": "Alice", "active": True, "skills": ["Python", "AI"]},
                    {"name": "Bob", "active": False, "skills": ["Java"]}
                ]
            },
            {
                "name": "Marketing",
                "employees": [
                    {"name": "Charlie", "active": True, "skills": ["SEO"]}
                ]
            }
        ]
    }

    # 测试 1: 获取特定数据
    print("--- Test 1: Find Alice's skills ---")
    q1 = "departments[0].employees[0].skills"
    print(query_json_data(source_data, q1))

    # 测试 2: 复杂过滤 (查找 R&D 部门 active 的员工名字)
    print("\n--- Test 2: Filter Active Employees in R&D ---")
    # 注意：JMESPath 中比较字符串用单引号
    q2 = "departments[?name=='R&D'].employees[?active==`true`].name" 
    print(query_json_data(source_data, q2))

    # 测试 3: 错误的语法 (测试容错性)
    print("\n--- Test 3: Invalid Syntax ---")
    q3 = "departments[[wrong_syntax"
    print(query_json_data(source_data, q3))