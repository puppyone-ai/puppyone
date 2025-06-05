import os
import sys
import pytest
from fastapi.testclient import TestClient
from fastapi import FastAPI
import json
from datetime import datetime
import requests

# 添加项目根目录到Python路径
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from server.routes.file_routes import file_router, storage_router
from server.routes.vector_routes import vector_router
from storage import get_storage_info
from utils.config import config

# 创建测试应用
app = FastAPI()
app.include_router(file_router)
app.include_router(storage_router)
app.include_router(vector_router)

# 创建测试客户端
client = TestClient(app)

# 通过存储管理器检查存储类型
storage_info = get_storage_info()
is_remote_storage = storage_info.get("type") == "remote"

def test_file_url_generation():
    """测试文件URL生成功能"""
    print("\n===== 测试文件URL生成 =====")
    print(f"当前存储类型: {'S3/Cloudflare R2' if is_remote_storage else '本地存储'}")
    
    # 测试正常URL生成
    user_id = f"test_user_{datetime.now().strftime('%Y%m%d%H%M%S')}"
    url_response = client.post(
        "/file/generate_urls/text",
        json={
            "user_id": user_id,
            "content_name": "test_document.txt"
        }
    )
    
    if url_response.status_code == 200:
        url_data = url_response.json()
        print(f"✅ URL生成成功! 文件ID: {url_data['content_id']}")
        print(f"   上传URL: {url_data['upload_url'][:50]}...")
        print(f"   下载URL: {url_data['download_url'][:50]}...")
        print(f"   删除URL: {url_data['delete_url'][:50]}...")
        print(f"   内容类型: {url_data['content_type_header']}")
    else:
        print(f"❌ URL生成失败: {url_response.text}")
        return False
    
    # 测试不支持的内容类型
    print("\n测试不支持的内容类型...")
    invalid_response = client.post(
        "/file/generate_urls/invalid_type",
        json={
            "user_id": user_id,
            "content_name": "test.invalid"
        }
    )
    
    if invalid_response.status_code != 200:
        print(f"✅ 不支持的内容类型处理正确: {invalid_response.status_code}")
    else:
        print(f"❌ 不支持的内容类型应该返回错误")
        return False
    
    return True

def test_file_routes():
    """测试完整的文件路由功能"""
    print("\n===== 测试文件路由完整流程 =====")
    print(f"当前存储类型: {'S3/Cloudflare R2' if is_remote_storage else '本地存储'}")
    
    # 测试用例
    test_cases = [
        {"content_type": "text", "content_name": "test_document.txt", "test_content": "这是一个纯文本文档"},
        {"content_type": "json", "content_name": "test_data.json", "test_content": '{"name": "测试", "value": 123}'},
        {"content_type": "html", "content_name": "test_page.html", "test_content": "<html><body><h1>测试页面</h1></body></html>"},
        {"content_type": "md", "content_name": "test_markdown.md", "test_content": "# 测试Markdown\n\n这是一个测试文档。"}
    ]
    
    results = {}
    
    for case in test_cases:
        print(f"\n测试文件类型: {case['content_type']}, 文件名: {case['content_name']}")
        
        # 1. 生成URL
        user_id = f"test_user_{datetime.now().strftime('%Y%m%d%H%M%S')}"
        url_response = client.post(
            f"/file/generate_urls/{case['content_type']}",
            json={
                "user_id": user_id,
                "content_name": case["content_name"]
            }
        )
        
        if url_response.status_code != 200:
            print(f"❌ URL生成失败: {url_response.text}")
            results[case['content_type']] = False
            continue
            
        url_data = url_response.json()
        print(f"✅ URL生成成功! 文件ID: {url_data['content_id']}")
        
        # 验证URL数据结构
        required_fields = ['upload_url', 'download_url', 'delete_url', 'content_id', 'content_type_header', 'expires_at']
        if not all(field in url_data for field in required_fields):
            print(f"❌ URL响应数据结构不完整")
            results[case['content_type']] = False
            continue
        
        # 2. 上传文件
        print("测试文件上传...")
        
        if is_remote_storage:
            # 对于S3/R2存储，使用外部请求库直接上传到预签名URL
            upload_url = url_data['upload_url']
            print(f"使用S3预签名URL直接上传")
            try:
                upload_response = requests.put(
                    upload_url,
                    data=case["test_content"],
                    headers={"Content-Type": url_data['content_type_header']},
                    timeout=30  # 添加超时设置
                )
            except Exception as e:
                print(f"❌ 发送请求时出错: {str(e)}")
                results[case['content_type']] = False
                continue
        else:
            # 对于本地存储，使用测试客户端上传
            key = f"{user_id}/{url_data['content_id']}/{case['content_name']}"
            upload_response = client.put(
                f"/storage/upload/{key}",
                content=case["test_content"],
                params={"content_type": url_data['content_type_header']}
            )
        
        if upload_response.status_code not in [200, 204]:  # S3可能返回204
            print(f"❌ 文件上传失败: 状态码 {upload_response.status_code}")
            if hasattr(upload_response, 'text'):
                print(f"   错误详情: {upload_response.text}")
            results[case['content_type']] = False
            continue
            
        print(f"✅ 文件上传成功!")
        
        # 3. 下载文件
        print("测试文件下载...")
        download_url = url_data['download_url']
        
        try:
            if is_remote_storage:
                # 对于S3/R2存储，使用外部请求库直接从预签名URL下载
                download_response = requests.get(download_url, timeout=30)
            else:
                # 对于本地存储，使用测试客户端下载
                download_response = client.get(download_url)
                
            if download_response.status_code != 200:
                print(f"❌ 文件下载失败: {download_response.status_code}")
                results[case['content_type']] = False
                continue
                
            print(f"✅ 文件下载成功!")
            
            # 验证内容
            try:
                if is_remote_storage:
                    # 对于S3/R2存储，处理编码问题
                    if case['content_type'] in ['png', 'jpg', 'gif', 'mp3', 'mp4', 'pdf', 'zip']:
                        # 二进制文件比较
                        if download_response.content == case["test_content"].encode('utf-8'):
                            print(f"✅ 文件内容验证成功!")
                        else:
                            print(f"❌ 文件内容验证失败! (二进制比较)")
                            results[case['content_type']] = False
                            continue
                    else:
                        # 文本文件比较
                        downloaded_text = download_response.content.decode('utf-8').strip()
                        original_text = case["test_content"].strip()
                        
                        if downloaded_text == original_text:
                            print(f"✅ 文件内容验证成功!")
                        else:
                            print(f"❌ 文件内容验证失败!")
                            print(f"   原始长度: {len(original_text)}, 下载长度: {len(downloaded_text)}")
                            results[case['content_type']] = False
                            continue
                else:
                    # 本地存储内容验证
                    content = download_response.text if hasattr(download_response, 'text') else download_response.content.decode('utf-8')
                    if content == case["test_content"]:
                        print(f"✅ 文件内容验证成功!")
                    else:
                        print(f"❌ 文件内容验证失败!")
                        results[case['content_type']] = False
                        continue
            except Exception as e:
                print(f"❌ 内容验证时出错: {str(e)}")
                results[case['content_type']] = False
                continue
                
        except Exception as e:
            print(f"❌ 下载文件时出错: {str(e)}")
            results[case['content_type']] = False
            continue
        
        # 4. 删除文件
        print("测试文件删除...")
        key = f"{user_id}/{url_data['content_id']}/{case['content_name']}"
        delete_response = client.delete(f"/storage/delete/{key}")
        
        if delete_response.status_code != 200:
            print(f"❌ 文件删除失败: {delete_response.text}")
            results[case['content_type']] = False
            continue
            
        delete_data = delete_response.json()
        print(f"✅ 文件删除成功! 删除时间: {delete_data['deleted_at']}")
        
        # 5. 验证文件已删除
        print("验证文件已删除...")
        try:
            if is_remote_storage:
                verify_response = requests.get(download_url, timeout=10)
            else:
                verify_response = client.get(download_url)
                
            if verify_response.status_code >= 400:  # 错误响应表示文件已删除
                print(f"✅ 文件删除验证成功: 文件已不可访问 (状态码: {verify_response.status_code})")
                results[case['content_type']] = True
            else:
                print(f"❌ 文件删除验证失败: 文件仍然可访问")
                results[case['content_type']] = False
                
        except Exception as e:
            # 如果请求抛出异常，通常说明文件已不可访问
            print(f"✅ 文件删除验证成功: 访问文件时出错（文件已删除）")
            results[case['content_type']] = True
    
    # 打印测试摘要
    print("\n====== 测试摘要 ======")
    for content_type, success in results.items():
        print(f"{content_type}: {'✅ 通过' if success else '❌ 失败'}")
    
    total_tests = len(results)
    passed_tests = sum(1 for success in results.values() if success)
    print(f"总计: {total_tests} 个测试, {passed_tests} 个通过, {total_tests - passed_tests} 个失败")
    
    return passed_tests == total_tests

def test_delete_file_errors():
    """测试文件删除接口的错误处理"""
    print("\n===== 测试文件删除错误处理 =====")
    
    test_results = []
    
    # 测试不带key参数的删除请求
    print("\n测试删除请求缺少key参数...")
    no_key_response = client.delete("/storage/delete")
    
    if no_key_response.status_code == 400:
        print(f"✅ 缺少key参数测试通过: {no_key_response.json().get('error', 'Unknown error')}")
        test_results.append(True)
    else:
        print(f"❌ 缺少key参数测试失败: 状态码 {no_key_response.status_code}")
        test_results.append(False)
    
    # 测试不存在的文件
    print("\n测试删除不存在的文件...")
    non_existent_key = "non_existent_user/non_existent_id/non_existent_file.txt"
    non_existent_response = client.delete(f"/storage/delete/{non_existent_key}")
    
    if non_existent_response.status_code == 404:
        print(f"✅ 删除不存在的文件测试通过: {non_existent_response.json()}")
        test_results.append(True)
    else:
        print(f"❌ 删除不存在的文件测试失败: 状态码 {non_existent_response.status_code}")
        test_results.append(False)
    
    # 测试无效的路径格式
    print("\n测试删除无效路径格式...")
    invalid_keys = ["invalid_path", "user_id/content_id", ""]
    
    for invalid_key in invalid_keys:
        print(f"  测试无效路径: '{invalid_key}'")
        invalid_response = client.delete(f"/storage/delete/{invalid_key}")
        
        if invalid_response.status_code == 400:
            print(f"  ✅ 无效路径测试通过")
            test_results.append(True)
        else:
            print(f"  ❌ 无效路径测试失败: 状态码 {invalid_response.status_code}")
            test_results.append(False)
    
    passed = sum(test_results)
    total = len(test_results)
    print(f"\n错误处理测试: {passed}/{total} 通过")
    
    return passed == total

def test_storage_routes():
    """测试存储路由功能"""
    print("\n===== 测试存储路由 =====")
    
    if is_remote_storage:
        print("当前使用S3/Cloudflare R2存储，跳过直接存储路由测试")
        return True
        
    # 以下测试仅在本地存储模式下运行
    print("测试本地存储直接操作...")
    
    user_id = f"test_user_{datetime.now().strftime('%Y%m%d%H%M%S')}"
    test_content = "这是一个测试文件内容"
    test_filename = "test_storage_file.txt"
    
    # 生成文件路径
    key = f"{user_id}/direct_upload/{test_filename}"
    
    # 1. 直接上传文件
    print("\n测试直接上传文件...")
    upload_response = client.put(
        f"/storage/upload/{key}",
        content=test_content,
        params={"content_type": "text/plain"}
    )
    
    if upload_response.status_code != 200:
        print(f"❌ 直接上传文件失败: {upload_response.text}")
        return False
        
    upload_data = upload_response.json()
    print(f"✅ 直接上传文件成功! Key: {upload_data.get('key')}")
    
    # 2. 下载文件
    print("\n测试下载文件...")
    download_response = client.get(f"/storage/download/{key}")
    
    if download_response.status_code != 200:
        print(f"❌ 下载文件失败: {download_response.text}")
        return False
        
    if download_response.content.decode() == test_content:
        print(f"✅ 下载文件成功，内容匹配!")
    else:
        print(f"❌ 下载文件成功，但内容不匹配!")
        print(f"   期望: '{test_content}'")
        print(f"   实际: '{download_response.content.decode()}'")
        return False
    
    # 3. 删除文件
    print("\n测试删除文件...")
    delete_response = client.delete(f"/storage/delete/{key}")
    
    if delete_response.status_code != 200:
        print(f"❌ 删除文件失败: {delete_response.text}")
        return False
        
    delete_data = delete_response.json()
    print(f"✅ 文件删除成功! 删除时间: {delete_data['deleted_at']}")
    
    # 4. 验证文件已删除
    print("\n验证文件已删除...")
    verify_response = client.get(f"/storage/download/{key}")
    if verify_response.status_code == 404:
        print(f"✅ 文件删除验证成功: 文件已不可访问")
        return True
    else:
        print(f"❌ 文件删除验证失败: 文件仍然可访问 (状态码: {verify_response.status_code})")
        return False

def test_vector_routes():
    """测试向量路由功能"""
    print("\n===== 测试向量路由 =====")
    
    # 测试数据
    test_documents = [
        "🎵 Ring-ding-ding-ding-dingeringeding! 🎵",
        "🎵 Wa-pa-pa-pa-pa-pa-pow! 🎵",
        "🎵 Hatee-hatee-hatee-ho! 🎵"
    ]
    
    try:
        # 1. 测试嵌入
        print("\n测试向量嵌入...")
        embed_response = client.post(
            "/vector/embed",
            json={
                "chunks": [{"content": doc, "metadata": {"index": i}} for i, doc in enumerate(test_documents)],
                "model": "text-embedding-ada-002",
                "set_name": "fox_song",
                "user_id": "test_user",
                "vdb_type": "chroma"  # 本地测试使用chroma
            }
        )
        
        if embed_response.status_code != 200:
            print(f"❌ 向量嵌入失败: {embed_response.text}")
            return False
            
        embed_data = embed_response.json()
        collection_name = embed_data['collection_name']
        print(f"✅ 向量嵌入成功! 集合名称: {collection_name}")
        
        # 2. 测试搜索
        print("\n测试向量搜索...")
        search_response = client.post(
            "/vector/search",
            json={
                "query": "What does the fox say?",
                "set_name": "fox_song",
                "user_id": "test_user",
                "model": "text-embedding-ada-002",
                "vdb_type": "chroma",
                "top_k": 2
            }
        )
        
        if search_response.status_code != 200:
            print(f"❌ 向量搜索失败: {search_response.text}")
            return False
            
        search_results = search_response.json()
        print(f"✅ 向量搜索成功! 找到 {len(search_results)} 个结果")
        
        # 3. 测试删除
        print("\n测试向量集合删除...")
        
        delete_data = {
            "vdb_type": "chroma",
            "user_id": "test_user",
            "model": "text-embedding-ada-002",
            "set_name": "fox_song"
        }
        
        delete_response = client.post(
            "/vector/delete",
            json=delete_data
        )
        
        if delete_response.status_code != 200:
            print(f"❌ 向量集合删除失败: {delete_response.text}")
            return False
            
        print("✅ 向量集合删除成功!")
        return True
        
    except Exception as e:
        print(f"❌ 向量路由测试出错: {str(e)}")
        return False

def run_all_tests():
    """运行所有测试并汇总结果"""
    print("=" * 60)
    print("开始运行PuppyStorage路由测试套件")
    print("=" * 60)
    
    test_results = {}
    
    # 运行所有测试
    test_results["URL生成"] = test_file_url_generation()
    test_results["文件路由"] = test_file_routes()
    test_results["删除错误处理"] = test_delete_file_errors()
    test_results["存储路由"] = test_storage_routes()
    test_results["向量路由"] = test_vector_routes()
    
    # 汇总结果
    print("\n" + "=" * 60)
    print("测试结果汇总")
    print("=" * 60)
    
    for test_name, result in test_results.items():
        status = "✅ 通过" if result else "❌ 失败"
        print(f"{test_name}: {status}")
    
    total_tests = len(test_results)
    passed_tests = sum(1 for result in test_results.values() if result)
    
    print(f"\n总计: {total_tests} 个测试组, {passed_tests} 个通过, {total_tests - passed_tests} 个失败")
    
    if passed_tests == total_tests:
        print("🎉 所有测试通过!")
    else:
        print("⚠️  部分测试失败，请检查上面的详细信息")
    
    return passed_tests == total_tests

if __name__ == "__main__":
    run_all_tests() 