"""
测试PuppyModel包
"""
import sys
import os

# 确保能够导入puppy_model包
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

import puppy_model
from puppy_model import Embedder, LLM, ModelCapability

def test_model_listing():
    """测试模型列表功能"""
    print("=== 测试模型列表 ===")
    
    # 获取注册表实例
    registry = puppy_model.ModelRegistry()
    
    # 列出所有提供商
    providers = registry.list_providers()
    print(f"已注册的提供商: {providers}")
    
    # 列出所有模型
    all_models = registry.list_all_models()
    print(f"所有可用模型:")
    for provider, models in all_models.items():
        print(f"  - {provider}: {len(models)} 个模型")
        for model in models[:3]:  # 只打印前3个
            print(f"    - {model}")
        if len(models) > 3:
            print(f"    - ... 及其他 {len(models)-3} 个模型")
    
    # 列出支持嵌入的模型
    embed_models = registry.list_models_by_capability(ModelCapability.EMBEDDING)
    print(f"\n支持嵌入的模型:")
    for provider, models in embed_models.items():
        print(f"  - {provider}: {len(models)} 个模型")
        if models:
            print(f"    - 示例: {models[0]}")
    
    # 列出支持LLM的模型
    llm_models = registry.list_models_by_capability(ModelCapability.LLM)
    print(f"\n支持LLM的模型:")
    for provider, models in llm_models.items():
        print(f"  - {provider}: {len(models)} 个模型")
        if models:
            print(f"    - 示例: {models[0]}")

def test_ollama_capabilities():
    """测试Ollama提供商能力检测"""
    print("\n=== 测试Ollama能力检测 ===")
    
    # 获取Ollama提供商
    registry = puppy_model.ModelRegistry()
    try:
        ollama = registry.get_provider("ollama")
        
        # 列出模型
        models = ollama.__class__.list_models()
        if not models:
            print("未找到Ollama模型，请确保Ollama服务正在运行")
            return
            
        # 测试第一个模型的能力
        model = models[0]
        print(f"测试模型: {model}")
        
        capabilities = ollama.get_capabilities(model)
        print(f"模型能力: {capabilities}")
        
        if capabilities & ModelCapability.EMBEDDING:
            print(f"- 支持嵌入")
        else:
            print(f"- 不支持嵌入")
            
        if capabilities & ModelCapability.LLM:
            print(f"- 支持LLM")
        else:
            print(f"- 不支持LLM")
    except Exception as e:
        print(f"测试Ollama能力时出错: {e}")

def test_openrouter_capabilities():
    """测试OpenRouter提供商能力检测"""
    print("\n=== 测试OpenRouter能力检测 ===")
    
    # 获取OpenRouter提供商
    registry = puppy_model.ModelRegistry()
    try:
        openrouter = registry.get_provider("openrouter")
        
        # 列出模型
        models = openrouter.__class__.list_models()
        if not models:
            print("未找到OpenRouter模型")
            return
            
        # 测试第一个模型的能力
        model = models[0]
        print(f"测试模型: {model}")
        
        capabilities = openrouter.get_capabilities(model)
        print(f"模型能力: {capabilities}")
        
        if capabilities & ModelCapability.EMBEDDING:
            print(f"- 支持嵌入")
        else:
            print(f"- 不支持嵌入")
            
        if capabilities & ModelCapability.LLM:
            print(f"- 支持LLM")
        else:
            print(f"- 不支持LLM")
    except Exception as e:
        print(f"测试OpenRouter能力时出错: {e}")

def test_embedder():
    """测试嵌入功能"""
    print("\n=== 测试嵌入功能 ===")
    
    # 获取支持嵌入的模型
    embed_models = Embedder.list_models()
    
    if not any(models for models in embed_models.values()):
        print("未找到支持嵌入的模型")
        return
    
    # 找到第一个可用的嵌入模型
    provider = next((p for p, models in embed_models.items() if models), None)
    if not provider:
        return
    
    model = embed_models[provider][0]
    print(f"使用模型: {model} (提供商: {provider})")
    
    try:
        # 创建嵌入器
        embedder = Embedder(model, provider_name=provider)
        
        # 生成嵌入
        texts = ["Hello, world!", "Testing embeddings"]
        embeddings = embedder.embed(texts)
        
        print(f"生成嵌入向量成功:")
        print(f"- 文本数量: {len(texts)}")
        print(f"- 嵌入维度: {len(embeddings[0])}")
        print(f"- 前5个维度: {embeddings[0][:5]}")
    except Exception as e:
        print(f"嵌入测试失败: {e}")

def test_llm():
    """测试LLM功能"""
    print("\n=== 测试LLM功能 ===")
    
    # 获取支持LLM的模型
    llm_models = LLM.list_models()
    
    if not any(models for models in llm_models.values()):
        print("未找到支持LLM的模型")
        return
    
    # 找到第一个可用的LLM模型
    provider = next((p for p, models in llm_models.items() if models), None)
    if not provider:
        return
    
    model = llm_models[provider][0]
    print(f"使用模型: {model} (提供商: {provider})")
    
    try:
        # 创建LLM
        llm = LLM(model, provider_name=provider)
        
        # 生成文本
        prompt = "Tell me a short joke."
        response = llm.generate(prompt)
        
        print(f"生成文本成功:")
        print(f"- 提示: {prompt}")
        print(f"- 回复: {response}")
    except Exception as e:
        print(f"LLM测试失败: {e}")

def test_openrouter_llm():
    """测试OpenRouter LLM功能"""
    print("\n=== 测试OpenRouter LLM功能 ===")
    
    # 检查API密钥
    api_key = os.environ.get("OPENROUTER_API_KEY")
    if not api_key:
        print("警告: OPENROUTER_API_KEY环境变量未设置，无法进行OpenRouter API调用")
        return
    
    # 获取支持LLM的模型
    registry = puppy_model.ModelRegistry()
    try:
        openrouter = registry.get_provider("openrouter")
        models = openrouter.__class__.list_models()
        
        if not models:
            print("未找到OpenRouter模型")
            return
        
        # 选择第一个模型
        model = models[0]
        print(f"使用模型: {model} (提供商: openrouter)")
        
        # 创建LLM
        llm = LLM(model, provider_name="openrouter")
        
        # 生成文本
        prompt = "Tell me a short joke."
        print(f"提示: {prompt}")
        
        response = llm.generate(
            prompt,
            max_tokens=500,
            temperature=0.7,
            system_message="You are a helpful assistant that provides brief, accurate answers."
        )
        
        print(f"回复: {response}")
    except Exception as e:
        print(f"OpenRouter LLM测试失败: {e}")

if __name__ == "__main__":
    # 运行测试
    test_model_listing()
    test_ollama_capabilities()
    test_openrouter_capabilities()
    test_embedder()
    test_llm()
    test_openrouter_llm() 