#!/usr/bin/env python3
"""
认证集成测试工具
验证PuppyStorage的认证授权功能是否正常工作
"""

import os
import sys
import requests
import json

# 注意：DEPLOYMENT_TYPE 需要在服务启动前设置，测试时设置无效

# 添加项目根目录到Python路径
current_dir = os.path.dirname(os.path.abspath(__file__))
parent_dir = os.path.dirname(current_dir)
sys.path.insert(0, parent_dir)


class AuthIntegrationTest:
    def __init__(self, base_url: str = "http://localhost:8002"):
        self.base_url = base_url
        self.session = requests.Session()
        
    def test_local_mode_auth(self):
        """测试本地模式认证（应该跳过认证）"""
        print("🧪 测试本地模式认证...")
        
        # 测试数据
        test_key = "local-user/test123/test_file.txt"
        
        # 不提供Authorization header，本地模式应该仍然工作
        init_data = {
            "key": test_key,
            "content_type": "text/plain"
        }
        
        try:
            response = self.session.post(
                f"{self.base_url}/multipart/init",
                json=init_data
            )
            
            if response.status_code == 200:
                print("✅ 本地模式认证测试通过：无需认证即可访问")
                return True
            else:
                print(f"❌ 本地模式认证测试失败：{response.status_code} - {response.text}")
                return False
                
        except Exception as e:
            print(f"❌ 本地模式认证测试异常：{str(e)}")
            return False
    
    def test_key_ownership_validation(self):
        """测试key所有权验证（本地模式下仍会验证格式）"""
        print("\n🧪 测试key格式验证...")
        
        test_cases = [
            {
                "name": "正确格式的key",
                "key": "local-user/content123/file.txt",
                "expected_success": True
            },
            {
                "name": "格式错误的key（缺少部分）",
                "key": "user/file.txt",
                "expected_success": False
            },
            {
                "name": "空key",
                "key": "",
                "expected_success": False
            }
        ]
        
        for case in test_cases:
            print(f"  - 测试：{case['name']}")
            
            init_data = {
                "key": case["key"],
                "content_type": "text/plain"
            }
            
            try:
                response = self.session.post(
                    f"{self.base_url}/multipart/init",
                    json=init_data
                )
                
                if case["expected_success"]:
                    if response.status_code == 200:
                        print("    ✅ 通过：正确key格式被接受")
                    else:
                        print(f"    ❌ 失败：正确key格式被拒绝 - {response.status_code}")
                        return False
                else:
                    if response.status_code != 200:
                        print("    ✅ 通过：错误key格式被拒绝")
                    else:
                        print(f"    ❌ 失败：错误key格式被接受")
                        return False
                        
            except Exception as e:
                print(f"    ❌ 异常：{str(e)}")
                return False
        
        return True
    
    def test_health_check(self):
        """测试健康检查endpoint"""
        print("\n🧪 测试健康检查...")
        
        try:
            response = self.session.get(f"{self.base_url}/multipart/health")
            
            if response.status_code == 200:
                data = response.json()
                print(f"✅ 健康检查通过：{data.get('status')}")
                return True
            else:
                print(f"❌ 健康检查失败：{response.status_code}")
                return False
                
        except Exception as e:
            print(f"❌ 健康检查异常：{str(e)}")
            return False
    
    def run_all_tests(self):
        """运行所有测试"""
        print("🚀 开始认证集成测试...\n")
        
        tests = [
            self.test_health_check,
            self.test_local_mode_auth,
            self.test_key_ownership_validation
        ]
        
        passed = 0
        total = len(tests)
        
        for test in tests:
            if test():
                passed += 1
        
        print(f"\n📊 测试结果：{passed}/{total} 通过")
        
        if passed == total:
            print("🎉 所有认证集成测试通过！")
            return True
        else:
            print("⚠️  部分测试失败，请检查实现")
            return False


def main():
    """主函数"""
    # 检查服务是否运行
    test_runner = AuthIntegrationTest()
    
    try:
        response = requests.get("http://localhost:8002/multipart/health")
        if response.status_code != 200:
            print("❌ PuppyStorage服务未运行或不可用")
            print("请先启动服务：cd PuppyStorage && python server/storage_server.py")
            return False
    except requests.exceptions.ConnectionError:
        print("❌ 无法连接到PuppyStorage服务")
        print("请先启动服务：cd PuppyStorage && python server/storage_server.py")
        return False
    
    # 运行测试
    return test_runner.run_all_tests()


if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1) 