"""
测试脚本：验证 MCP Server 代理路由功能
"""

import asyncio
import httpx
import json


async def test_mcp_proxy():
    """测试 MCP Server 代理路由"""
    
    base_url = "http://localhost:8000"  # 主应用的基础 URL
    
    # 1. 先登录获取 JWT token（需要替换为实际的用户凭证）
    print("=" * 50)
    print("步骤 1: 用户登录")
    print("=" * 50)
    
    # 这里需要根据实际的认证逻辑调整
    # 假设你已经有了 JWT token
    jwt_token = input("请输入你的 JWT token: ").strip()
    
    if not jwt_token:
        print("错误：需要提供有效的 JWT token")
        return
    
    headers = {
        "Authorization": f"Bearer {jwt_token}",
        "Content-Type": "application/json"
    }
    
    # 2. 创建 MCP 实例
    print("\n" + "=" * 50)
    print("步骤 2: 创建 MCP 实例")
    print("=" * 50)
    
    project_id = int(input("请输入 project_id: ").strip())
    table_id = int(input("请输入 table_id: ").strip())
    
    create_payload = {
        "project_id": project_id,
        "table_id": table_id,
        "json_pointer": "",
        "register_tools": ["query", "create", "update", "delete"]
    }
    
    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            # 创建 MCP 实例
            response = await client.post(
                f"{base_url}/mcp/",
                headers=headers,
                json=create_payload
            )
            
            print(f"状态码: {response.status_code}")
            response_data = response.json()
            print(f"响应: {json.dumps(response_data, indent=2, ensure_ascii=False)}")
            
            if response.status_code != 200:
                print("错误：创建 MCP 实例失败")
                return
            
            api_key = response_data["data"]["api_key"]
            direct_url = response_data["data"]["url"]
            
            print(f"\n✓ MCP 实例创建成功")
            print(f"  API Key: {api_key[:50]}...")
            print(f"  直接访问 URL: {direct_url}")
            
            # 3. 测试代理路由 - 获取工具列表
            print("\n" + "=" * 50)
            print("步骤 3: 通过代理获取 MCP Server 信息")
            print("=" * 50)
            
            # 注意：FastMCP 的 HTTP 端点可能是 /sse 或其他端点
            # 这里测试根路径
            proxy_url = f"{base_url}/mcp/server/{api_key}/"
            
            print(f"代理 URL: {proxy_url}")
            
            response = await client.get(
                proxy_url,
                headers=headers
            )
            
            print(f"状态码: {response.status_code}")
            print(f"响应头: {dict(response.headers)}")
            print(f"响应内容: {response.text[:500]}")
            
            # 4. 测试 SSE 端点（如果存在）
            print("\n" + "=" * 50)
            print("步骤 4: 测试 SSE 端点")
            print("=" * 50)
            
            sse_url = f"{base_url}/mcp/server/{api_key}/sse"
            print(f"SSE URL: {sse_url}")
            
            response = await client.get(
                sse_url,
                headers=headers
            )
            
            print(f"状态码: {response.status_code}")
            print(f"响应类型: {response.headers.get('content-type')}")
            
            # 5. 获取 MCP 实例状态
            print("\n" + "=" * 50)
            print("步骤 5: 查询 MCP 实例状态")
            print("=" * 50)
            
            response = await client.get(
                f"{base_url}/mcp/{api_key}",
                headers=headers
            )
            
            print(f"状态码: {response.status_code}")
            status_data = response.json()
            print(f"状态信息: {json.dumps(status_data, indent=2, ensure_ascii=False)}")
            
            # 6. 清理：删除测试实例（可选）
            print("\n" + "=" * 50)
            print("步骤 6: 清理测试实例")
            print("=" * 50)
            
            cleanup = input("是否删除刚创建的 MCP 实例？(y/n): ").strip().lower()
            
            if cleanup == 'y':
                response = await client.delete(
                    f"{base_url}/mcp/{api_key}",
                    headers=headers
                )
                
                print(f"状态码: {response.status_code}")
                delete_data = response.json()
                print(f"删除结果: {json.dumps(delete_data, indent=2, ensure_ascii=False)}")
                print("✓ 测试实例已删除")
            else:
                print(f"保留测试实例，API Key: {api_key}")
            
            print("\n" + "=" * 50)
            print("测试完成！")
            print("=" * 50)
            
        except httpx.ConnectError as e:
            print(f"连接错误: {e}")
        except httpx.TimeoutException as e:
            print(f"请求超时: {e}")
        except Exception as e:
            print(f"错误: {e}")
            import traceback
            traceback.print_exc()


if __name__ == "__main__":
    print("""
╔══════════════════════════════════════════════════╗
║     MCP Server 代理路由测试脚本                    ║
╚══════════════════════════════════════════════════╝
    
此脚本将测试以下功能：
1. 用户认证
2. 创建 MCP 实例
3. 通过代理访问 MCP Server
4. 查询实例状态
5. 清理测试数据

注意：需要先启动主应用服务器
""")
    
    asyncio.run(test_mcp_proxy())
