#!/usr/bin/env python3
"""
存储管理器使用示例
演示如何在本地存储和远程存储之间切换
"""

import os
import sys

# 添加项目根目录到Python路径
current_dir = os.path.dirname(os.path.abspath(__file__))
parent_dir = os.path.dirname(current_dir)
sys.path.insert(0, parent_dir)

from storage import get_storage, switch_storage, get_storage_info, reset_storage_manager
from utils.logger import log_info


def demo_storage_usage():
    """演示存储管理器的基本使用"""
    
    print("=== 存储管理器使用演示 ===\n")
    
    # 1. 获取当前存储信息
    print("1. 当前存储配置:")
    info = get_storage_info()
    for key, value in info.items():
        print(f"   {key}: {value}")
    print()
    
    # 2. 获取存储适配器并测试基本功能
    print("2. 测试当前存储适配器:")
    storage = get_storage()
    
    # 测试数据
    test_key = "demo/test_file.txt"
    test_data = b"Hello from storage manager!"
    content_type = "text/plain"
    
    try:
        # 保存文件
        print(f"   保存文件: {test_key}")
        result = storage.save_file(test_key, test_data, content_type)
        print(f"   保存结果: {'成功' if result else '失败'}")
        
        if result:
            # 检查文件是否存在
            exists = storage.check_file_exists(test_key)
            print(f"   文件存在: {exists}")
            
            # 获取文件内容
            retrieved_data, retrieved_type = storage.get_file(test_key)
            if retrieved_data:
                print(f"   获取文件: 成功 (大小: {len(retrieved_data)} 字节)")
                print(f"   内容类型: {retrieved_type}")
                print(f"   内容匹配: {retrieved_data == test_data}")
            else:
                print("   获取文件: 失败")
            
            # 生成下载URL
            try:
                download_url = storage.generate_download_url(test_key)
                print(f"   下载URL: {download_url[:50]}...")
            except Exception as e:
                print(f"   生成下载URL失败: {str(e)}")
            
            # 清理测试文件
            delete_result = storage.delete_file(test_key)
            print(f"   删除文件: {'成功' if delete_result else '失败'}")
        
    except Exception as e:
        print(f"   测试过程中出错: {str(e)}")
    
    print()
    
    # 3. 演示存储类型切换
    print("3. 演示存储类型切换:")
    current_info = get_storage_info()
    current_type = current_info.get("type", "未知")
    
    print(f"   当前存储类型: {current_type}")
    
    # 尝试切换到另一种存储类型
    target_type = "local" if current_type == "remote" else "remote"
    print(f"   尝试切换到: {target_type}")
    
    try:
        switch_storage(target_type)
        new_info = get_storage_info()
        new_type = new_info.get("type", "未知")
        print(f"   切换后类型: {new_type}")
        
        if new_type == target_type:
            print("   切换成功!")
            
            # 测试新的存储适配器
            new_storage = get_storage()
            test_result = new_storage.save_file("demo/switch_test.txt", b"Switch test", "text/plain")
            if test_result:
                print("   新存储适配器工作正常")
                new_storage.delete_file("demo/switch_test.txt")  # 清理
            else:
                print("   新存储适配器测试失败")
        else:
            print("   切换失败或未生效")
            
        # 切换回原来的存储类型
        switch_storage(current_type)
        print(f"   已切换回: {current_type}")
        
    except Exception as e:
        print(f"   切换过程中出错: {str(e)}")
    
    print()


def demo_environment_based_switching():
    """演示基于环境变量的存储切换"""
    
    print("=== 基于环境变量的存储切换演示 ===\n")
    
    # 保存原始环境变量
    original_deployment_type = os.environ.get("DEPLOYMENT_TYPE")
    
    try:
        # 测试不同的环境变量设置
        test_cases = [
            # 标准配置：使用 DEPLOYMENT_TYPE
            {"DEPLOYMENT_TYPE": "local", "expected": "local", "note": "本地开发环境"},
            {"DEPLOYMENT_TYPE": "remote", "expected": "remote", "note": "远程环境", "allow_fallback": True},
            
            # 错误配置测试
            {"DEPLOYMENT_TYPE": "production", "expected": "remote", "note": "不支持的类型，回退到remote", "allow_fallback": True},
            {"DEPLOYMENT_TYPE": "staging", "expected": "remote", "note": "不支持的类型，回退到remote", "allow_fallback": True},
        ]
        
        print("📋 配置说明:")
        print("   • DEPLOYMENT_TYPE - 根据部署环境自动选择存储")
        print("   • 默认: remote (如果未配置)")
        print("   • 注意: S3配置不完整时会自动回退到本地存储\n")
        
        for i, case in enumerate(test_cases, 1):
            print(f"{i}. 测试配置: {case.get('note', '')}")
            
            # 清空环境变量
            if "DEPLOYMENT_TYPE" in os.environ:
                del os.environ["DEPLOYMENT_TYPE"]
            
            # 设置测试环境变量
            for key, value in case.items():
                if key not in ["expected", "note", "allow_fallback"]:
                    os.environ[key] = value
            
            print(f"   配置: DEPLOYMENT_TYPE={case['DEPLOYMENT_TYPE']}")
            
            # 创建新的存储管理器实例来测试环境变量
            from storage import reset_storage_manager
            
            # 重置管理器实例（仅用于演示）
            reset_storage_manager()
            
            # 获取新的存储信息
            info = get_storage_info()
            actual_type = info.get("type", "未知")
            expected_type = case["expected"]
            
            print(f"   期望: {expected_type}")
            print(f"   实际: {actual_type}")
            
            # 检查是否是预期的回退情况
            is_fallback = (case.get("allow_fallback", False) and 
                          expected_type == "remote" and 
                          actual_type == "local")
            
            if actual_type == expected_type:
                print(f"   结果: ✅ 正确")
            elif is_fallback:
                print(f"   结果: ⚠️  S3配置不完整，已回退到本地存储（这是正常的安全行为）")
                print(f"   说明: 在生产环境中，请确保正确配置S3凭证")
            else:
                print(f"   结果: ❌ 错误")
            print()
    
    finally:
        # 恢复原始环境变量
        if original_deployment_type is not None:
            os.environ["DEPLOYMENT_TYPE"] = original_deployment_type
        elif "DEPLOYMENT_TYPE" in os.environ:
            del os.environ["DEPLOYMENT_TYPE"]
        
        # 重置管理器实例
        reset_storage_manager()


def demo_best_practices():
    """演示最佳实践配置"""
    
    print("=== 最佳实践配置建议 ===\n")
    
    print("🎯 推荐配置方式:")
    print("   # 本地开发环境")
    print("   export DEPLOYMENT_TYPE=local")
    print()
    print("   # 远程环境（生产/测试/预发布等）")
    print("   export DEPLOYMENT_TYPE=remote")
    print()
    
    print("📚 支持的部署类型:")
    print("   local → 本地文件存储")
    print("   remote → S3远程存储")
    print()
    
    print("⚙️  配置优先级:")
    print("   1. DEPLOYMENT_TYPE (环境变量)")
    print("   2. DEPLOYMENT_TYPE (配置文件)")
    print("   3. 默认: remote")


if __name__ == "__main__":
    print("存储管理器使用示例")
    print("=" * 50)
    
    try:
        # 基本使用演示
        demo_storage_usage()
        
        # 环境变量演示
        demo_environment_based_switching()
        
        # 最佳实践演示
        demo_best_practices()
        
    except Exception as e:
        print(f"演示过程中发生错误: {str(e)}")
        import traceback
        traceback.print_exc()
    
    print("\n演示完成!") 