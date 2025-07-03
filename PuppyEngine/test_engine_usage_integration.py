#!/usr/bin/env python3
"""
Engine Server 与 User System Usage Integration 专项测试

测试Engine Server中的usage_module和auth_module对用户系统usage_routes.py的调用
"""

import os
import json
import time
import requests
import asyncio
from typing import Dict, Any, Optional

# 配置
ENGINE_SERVER_URL = "http://localhost:8001"
USER_SYSTEM_URL = "http://localhost:8000"

# 测试JWT Token
TEST_JWT_TOKEN = None
TEST_USER_ID = None
SERVICE_KEY = None

def setup_test_config():
    """设置测试配置"""
    global TEST_JWT_TOKEN, TEST_USER_ID, SERVICE_KEY
    
    # 从环境变量获取配置，支持多种变量名
    TEST_JWT_TOKEN = os.getenv("TEST_JWT_TOKEN") or os.getenv("JWT_TOKEN")
    TEST_USER_ID = os.getenv("TEST_USER_ID") or os.getenv("USER_ID") or "test-user-123"
    SERVICE_KEY = os.getenv("SERVICE_KEY", "service_123")
    
    print("🔧 测试配置:")
    print(f"   Engine Server: {ENGINE_SERVER_URL}")
    print(f"   User System: {USER_SYSTEM_URL}")
    print(f"   JWT Token: {'已设置' if TEST_JWT_TOKEN else '未设置'}")
    print(f"   User ID: {TEST_USER_ID}")
    print(f"   Service Key: {'已设置' if SERVICE_KEY else '未设置'}")

def test_user_system_health():
    """测试用户系统健康状态"""
    print("\n🔍 测试1: 用户系统健康检查")
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
        return False

def test_engine_health():
    """测试Engine Server健康状态"""
    print("\n🔍 测试2: Engine Server健康检查")
    try:
        response = requests.get(f"{ENGINE_SERVER_URL}/health", timeout=5)
        if response.status_code == 200:
            print("✅ Engine Server运行正常")
            return True
        else:
            print(f"❌ Engine Server响应异常: {response.status_code}")
            return False
    except Exception as e:
        print(f"❌ Engine Server连接失败: {str(e)}")
        return False

def test_direct_usage_check_with_token():
    """直接测试用户系统的usage检查接口（基于token）"""
    if not TEST_JWT_TOKEN or not SERVICE_KEY:
        print("\n⏭️  跳过测试3: 直接usage检查（缺少token或service key）")
        return False
        
    print("\n🔍 测试3: 直接调用用户系统usage检查（基于token）")
    
    payload = {
        "user_token": TEST_JWT_TOKEN,
        "usage_type": "runs",
        "amount": 1
    }
    
    headers = {
        "Content-Type": "application/json",
        "X-Service-Key": SERVICE_KEY
    }
    
    try:
        response = requests.post(
            f"{USER_SYSTEM_URL}/usage/external/check",
            json=payload,
            headers=headers,
            timeout=10
        )
        
        if response.status_code == 200:
            result = response.json()
            print("✅ 直接usage检查成功")
            print(f"   允许: {result.get('allowed')}")
            print(f"   可用: {result.get('available')}")
            print(f"   用户ID: {result.get('user_id')}")
            return True
        else:
            print(f"❌ 直接usage检查失败: {response.status_code}")
            print(f"   响应: {response.text}")
            return False
            
    except Exception as e:
        print(f"❌ 直接usage检查异常: {str(e)}")
        return False

def test_direct_usage_check_with_userid():
    """直接测试用户系统的usage检查接口（基于用户ID）"""
    if not SERVICE_KEY:
        print("\n⏭️  跳过测试4: 直接usage检查（缺少service key）")
        return False
        
    print("\n🔍 测试4: 直接调用用户系统usage检查（基于用户ID）")
    
    payload = {
        "user_id": TEST_USER_ID,
        "usage_type": "runs",
        "amount": 1
    }
    
    headers = {
        "Content-Type": "application/json",
        "X-Service-Key": SERVICE_KEY
    }
    
    try:
        response = requests.post(
            f"{USER_SYSTEM_URL}/usage/external/check_by_user_id",
            json=payload,
            headers=headers,
            timeout=10
        )
        
        if response.status_code == 200:
            result = response.json()
            print("✅ 直接usage检查（用户ID）成功")
            print(f"   允许: {result.get('allowed')}")
            print(f"   可用: {result.get('available')}")
            print(f"   用户ID: {result.get('user_id')}")
            return True
        else:
            print(f"❌ 直接usage检查（用户ID）失败: {response.status_code}")
            print(f"   响应: {response.text}")
            return False
            
    except Exception as e:
        print(f"❌ 直接usage检查（用户ID）异常: {str(e)}")
        return False

def test_engine_with_auth():
    """测试Engine Server带认证的workflow执行"""
    if not TEST_JWT_TOKEN:
        print("\n⏭️  跳过测试5: Engine Server带认证测试（缺少JWT token）")
        return False
        
    print("\n🔍 测试5: Engine Server带认证的workflow执行")
    
    workflow_data = {
        "blocks": {
            "block1": {
                "data": {"content": "Auth test workflow"},
                "type": "text"
            }
        },
        "edges": {}
    }
    
    try:
        # 发送workflow
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
            print(f"✅ 带认证workflow发送成功")
            print(f"   Task ID: {task_id}")
            print(f"   User ID: {user_id}")
            
            # 获取执行结果
            return test_engine_get_data_with_auth(task_id)
        else:
            print(f"❌ 带认证workflow发送失败: {response.status_code}")
            print(f"   响应: {response.text}")
            return False
            
    except Exception as e:
        print(f"❌ 带认证workflow发送异常: {str(e)}")
        return False

def test_engine_get_data_with_auth(task_id: str):
    """测试Engine Server带认证的结果获取"""
    if not task_id or not TEST_JWT_TOKEN:
        return False
        
    print(f"\n🔍 测试5.1: 获取workflow结果（Task: {task_id}）")
    
    try:
        response = requests.get(
            f"{ENGINE_SERVER_URL}/get_data/{task_id}",
            headers={'Authorization': f'Bearer {TEST_JWT_TOKEN}'},
            stream=True,
            timeout=30
        )
        
        if response.status_code == 200:
            print("✅ 带认证结果获取开始")
            
            total_yields = 0
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
                            print(f"✅ 带认证workflow执行完成")
                            print(f"   总yield次数: {total_yields}")
                            print(f"   总消费runs: {total_runs_consumed}")
                            print(f"   用户ID: {user_id}")
                            break
                        elif data.get("data"):
                            total_yields += 1
                            runs_consumed = data.get("runs_consumed", 0)
                            print(f"   📦 Yield #{total_yields}: 消费 {runs_consumed} runs")
                        elif data.get("error"):
                            print(f"❌ 执行错误: {data['error']}")
                            return False
                            
                    except json.JSONDecodeError:
                        continue
            
            return completed
        else:
            print(f"❌ 带认证结果获取失败: {response.status_code}")
            return False
            
    except Exception as e:
        print(f"❌ 带认证结果获取异常: {str(e)}")
        return False

def test_engine_with_userid():
    """测试Engine Server基于用户ID的workflow执行"""
    print("\n🔍 测试6: Engine Server基于用户ID的workflow执行")
    
    workflow_data = {
        "blocks": {
            "block1": {
                "data": {"content": "User ID test workflow"},
                "type": "text"
            }
        },
        "edges": {}
    }
    
    try:
        # 使用x-user-id header
        response = requests.post(
            f"{ENGINE_SERVER_URL}/send_data",
            json=workflow_data,
            headers={
                'Content-Type': 'application/json',
                'x-user-id': TEST_USER_ID
            },
            timeout=10
        )
        
        if response.status_code == 200:
            result = response.json()
            task_id = result.get("task_id")
            user_id = result.get("user_id")
            print(f"✅ 基于用户ID的workflow发送成功")
            print(f"   Task ID: {task_id}")
            print(f"   User ID: {user_id}")
            
            # 获取执行结果
            return test_engine_get_data_with_userid(task_id)
        else:
            print(f"❌ 基于用户ID的workflow发送失败: {response.status_code}")
            print(f"   响应: {response.text}")
            return False
            
    except Exception as e:
        print(f"❌ 基于用户ID的workflow发送异常: {str(e)}")
        return False

def test_engine_get_data_with_userid(task_id: str):
    """测试Engine Server基于用户ID的结果获取"""
    if not task_id:
        return False
        
    print(f"\n🔍 测试6.1: 获取workflow结果（User ID方式，Task: {task_id}）")
    
    try:
        response = requests.get(
            f"{ENGINE_SERVER_URL}/get_data/{task_id}",
            headers={'x-user-id': TEST_USER_ID},
            stream=True,
            timeout=30
        )
        
        if response.status_code == 200:
            print("✅ 基于用户ID的结果获取开始")
            
            total_yields = 0
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
                            print(f"✅ 基于用户ID的workflow执行完成")
                            print(f"   总yield次数: {total_yields}")
                            print(f"   总消费runs: {total_runs_consumed}")
                            print(f"   用户ID: {user_id}")
                            break
                        elif data.get("data"):
                            total_yields += 1
                            runs_consumed = data.get("runs_consumed", 0)
                            print(f"   📦 Yield #{total_yields}: 消费 {runs_consumed} runs")
                        elif data.get("error"):
                            print(f"❌ 执行错误: {data['error']}")
                            return False
                            
                    except json.JSONDecodeError:
                        continue
            
            return completed
        else:
            print(f"❌ 基于用户ID的结果获取失败: {response.status_code}")
            return False
            
    except Exception as e:
        print(f"❌ 基于用户ID的结果获取异常: {str(e)}")
        return False

def test_direct_usage_consume():
    """直接测试用户系统的usage消费接口"""
    if not TEST_JWT_TOKEN or not SERVICE_KEY:
        print("\n⏭️  跳过测试7: 直接usage消费（缺少token或service key）")
        return False
        
    print("\n🔍 测试7: 直接调用用户系统usage消费")
    
    payload = {
        "user_token": TEST_JWT_TOKEN,
        "usage_type": "runs",
        "amount": 1,
        "event_metadata": {
            "test_source": "direct_test",
            "edge_type": "test_edge"
        }
    }
    
    headers = {
        "Content-Type": "application/json",
        "X-Service-Key": SERVICE_KEY
    }
    
    try:
        response = requests.post(
            f"{USER_SYSTEM_URL}/usage/external/consume",
            json=payload,
            headers=headers,
            timeout=10
        )
        
        if response.status_code == 200:
            result = response.json()
            print("✅ 直接usage消费成功")
            print(f"   成功: {result.get('success')}")
            print(f"   消费: {result.get('consumed')}")
            print(f"   剩余: {result.get('remaining')}")
            print(f"   用户ID: {result.get('user_id')}")
            return True
        else:
            print(f"❌ 直接usage消费失败: {response.status_code}")
            print(f"   响应: {response.text}")
            return False
            
    except Exception as e:
        print(f"❌ 直接usage消费异常: {str(e)}")
        return False

def test_engine_mode_configuration():
    """测试Engine Server的实际运行模式（通过API行为检测）"""
    print("\n🔍 测试8: Engine Server运行模式检测")
    
    # 通过发送一个需要认证的请求来检测模式
    test_payload = {
        "blocks": {
            "test_block": {
                "data": {"content": "mode test"},
                "type": "text"
            }
        },
        "edges": {}
    }
    
    # 1. 测试无认证请求的行为
    try:
        response = requests.post(
            f"{ENGINE_SERVER_URL}/send_data",
            json=test_payload,
            timeout=5
        )
        
        if response.status_code == 200:
            print("ℹ️  Engine Server运行在本地模式（无认证检查）")
            return True
        elif response.status_code == 401:
            print("ℹ️  Engine Server运行在远程模式（需要认证）")
            return True
        elif response.status_code == 429:
            print("ℹ️  Engine Server运行在远程模式（usage检查生效）")
            return True
        else:
            print(f"⚠️  Engine Server响应状态: {response.status_code}")
            print(f"    响应内容: {response.text[:200]}...")
            return True
            
    except Exception as e:
        print(f"❌ 模式检测失败: {str(e)}")
        return False

def main():
    """主测试流程"""
    print("🚀 Engine Server Usage Integration 专项测试")
    print("=" * 60)
    
    # 设置配置
    setup_test_config()
    
    # 执行测试
    tests_passed = 0
    total_tests = 0
    
    # 基础健康检查
    total_tests += 1
    if test_user_system_health():
        tests_passed += 1
    
    total_tests += 1
    if test_engine_health():
        tests_passed += 1
    
    # 配置检查
    total_tests += 1
    if test_engine_mode_configuration():
        tests_passed += 1
    
    # 直接API调用测试
    total_tests += 1
    if test_direct_usage_check_with_token():
        tests_passed += 1
    
    total_tests += 1
    if test_direct_usage_check_with_userid():
        tests_passed += 1
    
    total_tests += 1
    if test_direct_usage_consume():
        tests_passed += 1
    
    # Engine Server集成测试
    total_tests += 1
    if test_engine_with_auth():
        tests_passed += 1
    
    total_tests += 1
    if test_engine_with_userid():
        tests_passed += 1
    
    # 测试结果总结
    print(f"\n📊 专项测试结果总结:")
    print(f"   通过: {tests_passed}/{total_tests}")
    print(f"   成功率: {(tests_passed/total_tests)*100:.1f}%")
    
    if tests_passed == total_tests:
        print("🎉 所有集成测试通过！Engine Server与用户系统集成正常")
    elif tests_passed >= total_tests * 0.7:
        print("✅ 大部分集成测试通过，系统基本可用")
    else:
        print("⚠️  多项集成测试失败，请检查配置和集成实现")
    
    # 集成分析报告
    print(f"\n📋 集成调用分析:")
    print("   Engine Server调用的用户系统接口:")
    print("   1. POST /usage/external/check - 基于token检查usage")
    print("   2. POST /usage/external/consume - 基于token消费usage")
    print("   3. POST /usage/external/check_by_user_id - 基于用户ID检查usage")
    print("   4. POST /usage/external/consume_by_user_id - 基于用户ID消费usage")
    print("   5. POST /verify_token - 验证用户JWT token")
    
    print(f"\n🔗 调用流程:")
    print("   1. 用户发送请求到Engine Server")
    print("   2. Engine Server验证用户认证（local模式跳过）")
    print("   3. Engine Server检查用户usage（local模式跳过）")
    print("   4. 执行workflow，每个edge消费usage")
    print("   5. 返回执行结果和usage消费统计")

if __name__ == "__main__":
    main() 