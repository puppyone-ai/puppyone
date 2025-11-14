"""
MCP 客户端测试脚本
用于测试 MCP 服务器的各项功能
"""

import asyncio
from fastmcp import Client
from fastmcp.exceptions import McpError
import json


# 配置
# 注意：FastAPI mount 会自动处理尾部斜杠，实际访问路径为 /mcp/
MCP_SERVER_URL = "http://localhost:9090/mcp/"
API_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoxMjMsInByb2plY3RfaWQiOjEyMywiY3R4X2lkIjoxMjMsImlhdCI6MTc2MzEwMjQxOX0.uq2g07L9dYX6jFrOSdZsjlrOxPLoIXFnuqXNNnTprOY"  # 在 api_key_service.py 中配置的测试 API key


async def test_connection():
    """测试连接和基本功能"""
    print("=" * 60)
    print("测试 MCP 服务器连接")
    print("=" * 60)
    
    # 创建客户端，URL 中包含 API key
    client = Client(f"{MCP_SERVER_URL}?api_key={API_KEY}")
    
    try:
        async with client:
            print(f"✅ 成功连接到 MCP 服务器: {MCP_SERVER_URL}")
            
            # 测试 ping
            try:
                await client.ping()
                print("✅ Ping 成功")
            except Exception as e:
                print(f"⚠️  Ping 失败: {e}")
            
            return True
    except Exception as e:
        print(f"❌ 连接失败: {e}")
        return False


async def test_list_tools():
    """测试列出所有工具"""
    print("\n" + "=" * 60)
    print("测试列出所有工具")
    print("=" * 60)
    
    client = Client(f"{MCP_SERVER_URL}?api_key={API_KEY}")
    
    try:
        async with client:
            tools = await client.list_tools()
            print(f"✅ 找到 {len(tools)} 个工具:")
            for tool in tools:
                print(f"  - {tool.name}: {tool.description or '无描述'}")
            return tools
    except Exception as e:
        print(f"❌ 列出工具失败: {e}")
        return []


async def test_get_all_context():
    """测试 get_all_context 工具"""
    print("\n" + "=" * 60)
    print("测试 get_all_context 工具")
    print("=" * 60)
    
    client = Client(f"{MCP_SERVER_URL}?api_key={API_KEY}")
    
    try:
        async with client:
            result = await client.call_tool("get_all_context", {})
            print("✅ 工具调用成功")
            print(f"结果: {json.dumps(result.data, indent=2, ensure_ascii=False)}")
            return result
    except McpError as e:
        print(f"❌ MCP 错误: {e}")
        return None
    except Exception as e:
        print(f"❌ 调用失败: {e}")
        return None


async def test_create_element():
    """测试 create_element 工具"""
    print("\n" + "=" * 60)
    print("测试 create_element 工具")
    print("=" * 60)
    
    client = Client(f"{MCP_SERVER_URL}?api_key={API_KEY}")
    
    test_data = {
        "name": "测试元素",
        "type": "test",
        "value": "这是一个测试元素"
    }
    
    try:
        async with client:
            result = await client.call_tool("create_element", {"element_data": test_data})
            print("✅ 工具调用成功")
            print(f"结果: {json.dumps(result.data, indent=2, ensure_ascii=False)}")
            return result
    except McpError as e:
        print(f"❌ MCP 错误: {e}")
        return None
    except Exception as e:
        print(f"❌ 调用失败: {e}")
        return None


async def test_vector_retrieve():
    """测试 vector_retrieve 工具"""
    print("\n" + "=" * 60)
    print("测试 vector_retrieve 工具")
    print("=" * 60)
    
    client = Client(f"{MCP_SERVER_URL}?api_key={API_KEY}")
    
    try:
        async with client:
            result = await client.call_tool(
                "vector_retrieve",
                {
                    "query": "测试查询",
                    "top_k": 3
                }
            )
            print("✅ 工具调用成功")
            print(f"结果: {json.dumps(result.data, indent=2, ensure_ascii=False)}")
            return result
    except McpError as e:
        print(f"❌ MCP 错误: {e}")
        return None
    except Exception as e:
        print(f"❌ 调用失败: {e}")
        return None


async def test_llm_retrieve():
    """测试 llm_retrieve 工具"""
    print("\n" + "=" * 60)
    print("测试 llm_retrieve 工具")
    print("=" * 60)
    
    client = Client(f"{MCP_SERVER_URL}?api_key={API_KEY}")
    
    try:
        async with client:
            result = await client.call_tool(
                "llm_retrieve",
                {
                    "query": "什么是上下文管理？"
                }
            )
            print("✅ 工具调用成功")
            print(f"结果: {json.dumps(result.data, indent=2, ensure_ascii=False)}")
            return result
    except McpError as e:
        print(f"❌ MCP 错误: {e}")
        return None
    except Exception as e:
        print(f"❌ 调用失败: {e}")
        return None


async def test_authentication_failure():
    """测试认证失败场景"""
    print("\n" + "=" * 60)
    print("测试认证失败场景（缺少 API key）")
    print("=" * 60)
    
    # 不提供 API key
    client = Client(MCP_SERVER_URL)
    
    try:
        async with client:
            tools = await client.list_tools()
            print("⚠️  意外成功（应该失败）")
            return False
    except McpError as e:
        print(f"✅ 预期的认证错误: {e}")
        return True
    except Exception as e:
        print(f"✅ 预期的错误: {e}")
        return True


async def test_invalid_api_key():
    """测试无效的 API key"""
    print("\n" + "=" * 60)
    print("测试无效的 API key")
    print("=" * 60)
    
    client = Client(f"{MCP_SERVER_URL}?api_key=invalid_key_12345")
    
    try:
        async with client:
            tools = await client.list_tools()
            print("⚠️  意外成功（应该失败）")
            return False
    except McpError as e:
        print(f"✅ 预期的认证错误: {e}")
        return True
    except Exception as e:
        print(f"✅ 预期的错误: {e}")
        return True



async def run_all_tests():
    """运行所有测试"""
    print("\n" + "🚀 开始测试 MCP 服务器功能" + "\n")
    
    results = {}
    
    # 1. 测试连接
    results["connection"] = await test_connection()
    
    if not results["connection"]:
        print("\n❌ 连接失败，跳过后续测试")
        return results
    
    # 2. 测试列出工具
    tools = await test_list_tools()
    results["list_tools"] = len(tools) > 0
    
    # 3. 测试各个工具
    results["get_all_context"] = await test_get_all_context() is not None
    results["create_element"] = await test_create_element() is not None
    results["vector_retrieve"] = await test_vector_retrieve() is not None
    results["llm_retrieve"] = await test_llm_retrieve() is not None
    
    # 4. 测试认证
    results["auth_failure"] = await test_authentication_failure()
    results["invalid_key"] = await test_invalid_api_key()
    
    # 打印测试总结
    print("\n" + "=" * 60)
    print("测试总结")
    print("=" * 60)
    
    for test_name, passed in results.items():
        status = "✅ 通过" if passed else "❌ 失败"
        print(f"{test_name:20s}: {status}")
    
    total = len(results)
    passed = sum(1 for v in results.values() if v)
    print(f"\n总计: {passed}/{total} 测试通过")
    
    return results


if __name__ == "__main__":
    # 运行所有测试
    asyncio.run(test_list_tools())