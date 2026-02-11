#!/usr/bin/env python3
"""
简单的文件上传测试
"""

import sys
import os

# 添加项目根目录到Python路径
current_dir = os.path.dirname(os.path.abspath(__file__))
parent_dir = os.path.dirname(current_dir)
sys.path.insert(0, parent_dir)

from test_multipart_api import MultipartAPITester
from utils.logger import log_info, log_error

def main():
    """运行简单上传测试"""
    log_info("=== 运行简单文件上传测试 ===")
    
    # 创建测试器实例
    tester = MultipartAPITester()
    
    # 设置认证（如果需要）
    try:
        if not tester.setup_authentication():
            log_info("认证设置失败，继续无认证模式")
    except Exception as e:
        log_info(f"认证设置异常: {str(e)}")
    
    # 测试基本的文件上传
    try:
        # 生成测试key
        test_key = tester.generate_test_key()
        log_info(f"测试key: {test_key}")
        
        # 测试数据
        test_data = b"Hello, PuppyStorage!"
        
        # 1. 初始化上传
        init_response = tester.session.post(
            f"{tester.base_url}/upload/init",
            json={"key": test_key},
            headers=tester.get_auth_headers()
        )
        
        log_info(f"初始化响应: {init_response.status_code}")
        if init_response.status_code == 200:
            log_info(f"响应内容: {init_response.json()}")
            upload_id = init_response.json()["upload_id"]
            log_info(f"✅ 初始化成功，upload_id: {upload_id}")
            
            # 2. 获取上传URL
            url_response = tester.session.post(
                f"{tester.base_url}/upload/get_upload_url",
                json={
                    "key": test_key,
                    "upload_id": upload_id,
                    "part_number": 1
                },
                headers=tester.get_auth_headers()
            )
            
            log_info(f"获取URL响应: {url_response.status_code}")
            if url_response.status_code == 200:
                url_data = url_response.json()
                log_info(f"URL响应内容: {url_data}")
                upload_url = url_data.get("url") or url_data.get("upload_url")
                log_info(f"✅ 获取上传URL成功")
                
                # 3. 上传数据
                upload_response = tester.session.put(upload_url, data=test_data)
                log_info(f"上传响应: {upload_response.status_code}")
                
                if upload_response.status_code == 200:
                    etag = upload_response.headers.get("ETag", "").strip('"')
                    log_info(f"✅ 数据上传成功，ETag: {etag}")
                    
                    # 4. 完成上传
                    complete_response = tester.session.post(
                        f"{tester.base_url}/upload/complete",
                        json={
                            "key": test_key,
                            "upload_id": upload_id,
                            "parts": [{"PartNumber": 1, "ETag": etag}]
                        },
                        headers=tester.get_auth_headers()
                    )
                    
                    log_info(f"完成响应: {complete_response.status_code}")
                    if complete_response.status_code == 200:
                        log_info("✅ 文件上传完成！")
                        
                        # 5. 尝试下载文件
                        download_response = tester.session.get(
                            f"{tester.base_url}/download/url",
                            params={"key": test_key},
                            headers=tester.get_auth_headers()
                        )
                        
                        log_info(f"获取下载URL响应: {download_response.status_code}")
                        if download_response.status_code == 200:
                            download_data = download_response.json()
                            log_info(f"下载URL响应内容: {download_data}")
                            download_url = download_data.get("url") or download_data.get("download_url")
                            log_info("✅ 获取下载URL成功")
                            
                            # 下载文件
                            file_response = tester.session.get(download_url)
                            if file_response.status_code == 200:
                                downloaded_data = file_response.content
                                log_info(f"✅ 文件下载成功，内容: {downloaded_data}")
                                
                                if downloaded_data == test_data:
                                    log_info("✅ 数据验证成功！上传和下载的内容一致")
                                else:
                                    log_error("❌ 数据不一致")
                            else:
                                log_error(f"下载文件失败: {file_response.status_code}")
                        else:
                            log_error(f"获取下载URL失败: {download_response.text}")
                    else:
                        log_error(f"完成上传失败: {complete_response.text}")
                else:
                    log_error(f"数据上传失败: {upload_response.text}")
            else:
                log_error(f"获取上传URL失败: {url_response.text}")
        else:
            log_error(f"初始化失败: {init_response.text}")
        
    except Exception as e:
        log_error(f"测试失败: {str(e)}")
        import traceback
        traceback.print_exc()
        return 1
    
    return 0

if __name__ == "__main__":
    sys.exit(main())