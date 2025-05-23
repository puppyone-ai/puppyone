"""
测试OpenRouter提供商
"""
import os
import sys
from dotenv import load_dotenv

# 加载环境变量（如果有.env文件）
load_dotenv()

# 确保能够导入puppy_model包
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import puppy_model
from puppy_model import LLM, ModelCapability
from puppy_model.providers.openrouter import OpenRouterProvider

def test_openrouter_provider():
    """测试OpenRouter提供商"""
    print("=== 测试OpenRouter提供商 ===")
    
    # 获取注册表实例
    registry = puppy_model.ModelRegistry()
    
    # 检查OpenRouter是否已注册
    providers = registry.list_providers()
    print(f"已注册的提供商: {providers}")
    
    if 'openrouter' not in providers:
        print("OpenRouter提供商未注册，正在尝试注册...")
        try:
            registry.register('openrouter', OpenRouterProvider)
            print("OpenRouter提供商注册成功")
        except Exception as e:
            print(f"注册OpenRouter失败: {e}")
            return
    
    # 获取OpenRouter提供商
    try:
        openrouter = registry.get_provider('openrouter')
        print("成功获取OpenRouter提供商")
        
        # 列出模型
        models = openrouter.__class__.list_models()
        print(f"OpenRouter可用模型: {models}")
        
        # 检查API密钥
        api_key = os.environ.get("OPENROUTER_API_KEY")
        if not api_key:
            print("警告: OPENROUTER_API_KEY环境变量未设置，无法进行实际的API调用")
            return
        
        # 测试LLM功能
        test_openrouter_llm(models[0])
        
    except Exception as e:
        print(f"测试OpenRouter提供商时出错: {e}")

def test_openrouter_llm(model_name):
    """测试OpenRouter LLM功能"""
    print(f"\n=== 测试OpenRouter LLM (模型: {model_name}) ===")
    
    try:
        # 创建LLM实例
        llm = LLM(model_name, provider_name='openrouter')
        
        # 测试简单问题
        prompt = "What is the capital of France?"
        print(f"提问: {prompt}")
        
        # 设置API调用参数
        response = llm.generate(
            prompt, 
            max_tokens=500,
            temperature=0.7,
            system_message="You are a helpful assistant that provides brief, accurate answers."
        )
        
        print(f"回答: {response}")
    except Exception as e:
        print(f"测试OpenRouter LLM失败: {e}")

if __name__ == "__main__":
    # 运行测试
    test_openrouter_provider() 