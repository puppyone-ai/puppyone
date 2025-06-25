#!/usr/bin/env python3
"""
Engine Server Usage Integration 测试脚本

测试用户认证和usage tracking功能
"""

import os
import json
import time
import requests
import asyncio
from typing import Dict, Any

# 配置
ENGINE_SERVER_URL = "http://localhost:8001"
USER_SYSTEM_URL = "http://localhost:8000"

# 测试用的JWT token（需要从用户系统获取）
TEST_JWT_TOKEN = None

def get_test_token():
    """从环境变量或用户输入获取测试token"""
    global TEST_JWT_TOKEN
    
    # 1. 尝试从环境变量获取
    TEST_JWT_TOKEN = os.getenv("TEST_JWT_TOKEN")
    if TEST_JWT_TOKEN:
        print(f"✅ 从环境变量获取JWT token: {TEST_JWT_TOKEN[:20]}...")
        return
    
    # 2. 用户输入
    print("🔑 需要JWT token进行测试")
    print("请从以下方式之一获取JWT token:")
    print("1. 登录用户系统，从浏览器开发者工具的cookies中复制access_token")
    print("2. 使用用户系统的登录API获取access_token")
    print("3. 设置环境变量 TEST_JWT_TOKEN")
    
    token = input("\n请输入JWT token (留空则使用本地模式): ").strip()
    if token:
        TEST_JWT_TOKEN = token
        print(f"✅ 获取JWT token: {TEST_JWT_TOKEN[:20]}...")
    else:
        print("🏠 将使用本地模式测试")

def test_health_check():
    """测试健康检查"""
    print("\n🔍 测试1: Engine Server健康检查")
    try:
        response = requests.get(f"{ENGINE_SERVER_URL}/health", timeout=5)
        if response.status_code == 200:
            print("✅ Engine Server运行正常")
            return True
        else:
            print(f"❌ Engine Server健康检查失败: {response.status_code}")
            return False
    except Exception as e:
        print(f"❌ Engine Server连接失败: {str(e)}")
        return False

def test_send_data_without_auth():
    """测试不带认证的数据发送（本地模式）"""
    print("\n🔍 测试2: 不带认证的workflow发送")
    
    workflow_data = {
        "blocks": {
            "block1": {
                "data": {"content": "Hello from test"},
                "type": "text"
            },
            "block2": {
                "data": {"content": "World"},
                "type": "text"
            }
        },
        "edges": {}
    }
    
    try:
        response = requests.post(
            f"{ENGINE_SERVER_URL}/send_data",
            json=workflow_data,
            headers={'Content-Type': 'application/json'},
            timeout=10
        )
        
        if response.status_code == 200:
            result = response.json()
            task_id = result.get("task_id")
            user_id = result.get("user_id")
            print(f"✅ Workflow发送成功")
            print(f"   Task ID: {task_id}")
            print(f"   User ID: {user_id}")
            return task_id
        else:
            print(f"❌ Workflow发送失败: {response.status_code}")
            print(f"   响应: {response.text}")
            return None
            
    except Exception as e:
        print(f"❌ Workflow发送异常: {str(e)}")
        return None

def test_send_data_with_auth():
    """测试带认证的数据发送"""
    if not TEST_JWT_TOKEN:
        print("\n⏭️  跳过测试3: 带认证的workflow发送（无JWT token）")
        return None
        
    print("\n🔍 测试3: 带认证的workflow发送")
    
    workflow_data = {
        "blocks": {
            "block1": {
                "data": {"content": "Hello with auth"},
                "type": "text"
            },
            "block2": {
                "data": {"content": "Authenticated World"},
                "type": "text"
            }
        },
        "edges": {}
    }
    
    try:
        response = requests.post(
            f"{ENGINE_SERVER_URL}/send_data",
            json=workflow_data,
            headers={
                'Content-Type': 'application/json',
                'Authorization': f'Bearer {TEST_JWT_TOKEN}'
            },
            timeout=10
        )
        
        if response.status_code == 200:
            result = response.json()
            task_id = result.get("task_id")
            user_id = result.get("user_id")
            print(f"✅ 带认证的Workflow发送成功")
            print(f"   Task ID: {task_id}")
            print(f"   User ID: {user_id}")
            return task_id
        elif response.status_code == 401:
            print(f"❌ 认证失败: {response.text}")
            return None
        elif response.status_code == 429:
            print(f"❌ Usage不足: {response.text}")
            return None
        else:
            print(f"❌ 带认证的Workflow发送失败: {response.status_code}")
            print(f"   响应: {response.text}")
            return None
            
    except Exception as e:
        print(f"❌ 带认证的Workflow发送异常: {str(e)}")
        return None

def test_get_data(task_id: str, with_auth: bool = False):
    """测试获取workflow结果"""
    if not task_id:
        return False
        
    test_name = "带认证" if with_auth else "不带认证"
    print(f"\n🔍 测试4: {test_name}的结果获取")
    
    headers = {}
    if with_auth and TEST_JWT_TOKEN:
        headers['Authorization'] = f'Bearer {TEST_JWT_TOKEN}'
    
    try:
        response = requests.get(
            f"{ENGINE_SERVER_URL}/get_data/{task_id}",
            headers=headers,
            stream=True,
            timeout=30
        )
        
        if response.status_code == 200:
            print(f"✅ {test_name}的结果获取开始")
            
            # 解析流式响应
            total_yields = 0
            total_runs_consumed = 0
            completed = False
            
            for line in response.iter_lines(decode_unicode=True):
                if line.startswith("data:"):
                    data_str = line.replace("data: ", "", 1)
                    try:
                        data = json.loads(data_str)
                        
                        if data.get("is_complete"):
                            completed = True
                            total_runs_consumed = data.get("total_runs_consumed", 0)
                            user_id = data.get("user_id", "unknown")
                            print(f"✅ Workflow执行完成")
                            print(f"   总yield次数: {total_yields}")
                            print(f"   总消费runs: {total_runs_consumed}")
                            print(f"   用户ID: {user_id}")
                            break
                        elif data.get("data"):
                            total_yields += 1
                            runs_consumed = data.get("runs_consumed", 0)
                            print(f"   📦 Yield #{total_yields}: {len(data['data'])} blocks, 累计消费 {runs_consumed} runs")
                        elif data.get("error"):
                            error_code = data.get("code", "UNKNOWN")
                            available = data.get("available", 0)
                            print(f"❌ 执行错误: {data['error']}")
                            print(f"   错误代码: {error_code}")
                            if error_code == "USAGE_INSUFFICIENT":
                                print(f"   可用余额: {available}")
                            return False
                            
                    except json.JSONDecodeError:
                        continue
            
            if completed:
                return True
            else:
                print(f"⚠️  Workflow未正常完成")
                return False
                
        elif response.status_code == 401:
            print(f"❌ 认证失败: {response.text}")
            return False
        elif response.status_code == 429:
            print(f"❌ Usage不足: {response.text}")
            return False
        else:
            print(f"❌ 结果获取失败: {response.status_code}")
            print(f"   响应: {response.text}")
            return False
            
    except Exception as e:
        print(f"❌ 结果获取异常: {str(e)}")
        return False

def test_send_data_with_user():
    """测试专用的send_data_with_user接口"""
    if not TEST_JWT_TOKEN:
        print("\n⏭️  跳过测试5: send_data_with_user接口（无JWT token）")
        return None
        
    print("\n🔍 测试5: send_data_with_user接口")
    
    workflow_data = {
        "blocks": {
            "block1": {
                "data": {"content": "Hello with user API"},
                "type": "text"
            }
        },
        "edges": {}
    }
    
    try:
        response = requests.post(
            f"{ENGINE_SERVER_URL}/send_data_with_user",
            json=workflow_data,
            headers={
                'Content-Type': 'application/json',
                'x-user-token': TEST_JWT_TOKEN,
                'x-user-id': 'test-user'
            },
            timeout=10
        )
        
        if response.status_code == 200:
            result = response.json()
            task_id = result.get("task_id")
            user_id = result.get("user_id")
            print(f"✅ send_data_with_user接口调用成功")
            print(f"   Task ID: {task_id}")
            print(f"   User ID: {user_id}")
            return task_id
        else:
            print(f"❌ send_data_with_user接口调用失败: {response.status_code}")
            print(f"   响应: {response.text}")
            return None
            
    except Exception as e:
        print(f"❌ send_data_with_user接口调用异常: {str(e)}")
        return None

def test_user_system_connection():
    """测试用户系统连接"""
    print(f"\n🔍 测试6: 用户系统连接检查")
    
    try:
        response = requests.get(f"{USER_SYSTEM_URL}/health", timeout=5)
        if response.status_code == 200:
            print("✅ 用户系统运行正常")
            return True
        else:
            print(f"❌ 用户系统响应异常: {response.status_code}")
            return False
    except Exception as e:
        print(f"❌ 用户系统连接失败: {str(e)}")
        print("ℹ️  这在本地模式下是正常的")
        return False

def show_configuration_info():
    """显示配置信息"""
    print("\n📋 当前配置:")
    print(f"   Engine Server URL: {ENGINE_SERVER_URL}")
    print(f"   User System URL: {USER_SYSTEM_URL}")
    print(f"   AUTH_MODE: {os.getenv('AUTH_MODE', 'local')}")
    print(f"   SERVICE_KEY: {'已设置' if os.getenv('SERVICE_KEY') else '未设置'}")
    print(f"   JWT Token: {'已提供' if TEST_JWT_TOKEN else '未提供'}")

def main():
    """主测试流程"""
    print("🚀 Engine Server Usage Integration 测试")
    print("=" * 50)
    
    # 显示配置信息
    show_configuration_info()
    
    # 获取测试token
    get_test_token()
    
    # 执行测试
    tests_passed = 0
    total_tests = 0
    
    # 测试1: 健康检查
    total_tests += 1
    if test_health_check():
        tests_passed += 1
    
    # 测试2: 不带认证的workflow
    total_tests += 1
    task_id_no_auth = test_send_data_without_auth()
    if task_id_no_auth:
        tests_passed += 1
        
        # 测试4a: 获取结果（不带认证）
        total_tests += 1
        if test_get_data(task_id_no_auth, with_auth=False):
            tests_passed += 1
    
    # 测试3: 带认证的workflow
    if TEST_JWT_TOKEN:
        total_tests += 1
        task_id_with_auth = test_send_data_with_auth()
        if task_id_with_auth:
            tests_passed += 1
            
            # 测试4b: 获取结果（带认证）
            total_tests += 1
            if test_get_data(task_id_with_auth, with_auth=True):
                tests_passed += 1
        
        # 测试5: send_data_with_user接口
        total_tests += 1
        task_id_user_api = test_send_data_with_user()
        if task_id_user_api:
            tests_passed += 1
    
    # 测试6: 用户系统连接
    total_tests += 1
    if test_user_system_connection():
        tests_passed += 1
    
    # 测试结果总结
    print(f"\n📊 测试结果总结:")
    print(f"   通过: {tests_passed}/{total_tests}")
    print(f"   成功率: {(tests_passed/total_tests)*100:.1f}%")
    
    if tests_passed == total_tests:
        print("🎉 所有测试通过！")
    elif tests_passed >= total_tests * 0.8:
        print("✅ 大部分测试通过，系统基本正常")
    else:
        print("⚠️  多项测试失败，请检查配置和服务状态")
    
    # 提供故障排除建议
    if tests_passed < total_tests:
        print("\n🔧 故障排除建议:")
        print("1. 确保Engine Server在运行 (python EngineServer.py)")
        print("2. 检查环境变量配置 (AUTH_MODE, USER_SYSTEM_URL, SERVICE_KEY)")
        print("3. 验证JWT token有效性")
        print("4. 确保用户系统在运行（如果使用远程模式）")
        print("5. 查看Engine Server日志获取详细错误信息")

if __name__ == "__main__":
    main() 