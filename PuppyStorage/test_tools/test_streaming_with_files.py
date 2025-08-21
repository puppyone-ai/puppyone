#!/usr/bin/env python3
"""
使用现有文件API的流式消费测试
模拟通过文件上传和轮询实现流式数据传输
"""

import sys
import os
import json
import time
import threading
from typing import Set

# 添加项目根目录到Python路径
current_dir = os.path.dirname(os.path.abspath(__file__))
parent_dir = os.path.dirname(current_dir)
sys.path.insert(0, parent_dir)

from test_multipart_api import MultipartAPITester
from utils.logger import log_info, log_error, log_debug

class StreamingWithFilesTest(MultipartAPITester):
    """使用文件API实现流式消费的测试"""
    
    def test_streaming_with_file_api(self):
        """使用文件上传API模拟流式消费"""
        log_info("=== 测试基于文件API的流式消费 ===")
        
        try:
            # 准备测试数据
            user_id = self.test_user_id if self.test_user_id else "test_user"
            block_id = f"stream_file_test_{int(time.time())}"
            version_id = f"v_{int(time.time())}"
            
            # 共享状态
            producer_done = threading.Event()
            consumer_error = threading.Event()
            consumed_chunks: Set[str] = set()
            chunks_lock = threading.Lock()
            manifest_key = f"{user_id}/{block_id}/{version_id}/manifest.json"
            
            # 预定义的测试数据块
            test_chunks = [
                {"name": "chunk_001.txt", "content": b"First chunk data", "delay": 1.0},
                {"name": "chunk_002.txt", "content": b"Second chunk data", "delay": 1.5},
                {"name": "chunk_003.txt", "content": b"Third chunk data", "delay": 1.0},
            ]
            
            def producer_thread():
                """生产者线程：逐步上传数据并更新manifest文件"""
                try:
                    log_info("[Producer] 开始生产数据...")
                    
                    # 1. 创建初始manifest文件
                    initial_manifest = {
                        "status": "generating",
                        "total_chunks": 0,
                        "chunks": [],
                        "created_at": time.time()
                    }
                    
                    # 使用multipart上传manifest
                    manifest_data = json.dumps(initial_manifest, indent=2).encode()
                    upload_manifest_result = self.upload_file_via_multipart(
                        manifest_key, manifest_data
                    )
                    
                    if not upload_manifest_result:
                        log_error("[Producer] 创建初始manifest失败")
                        consumer_error.set()
                        return
                    
                    log_info("[Producer] 初始manifest创建成功")
                    
                    # 2. 逐个上传数据块并更新manifest
                    uploaded_chunks = []
                    for i, chunk_info in enumerate(test_chunks):
                        time.sleep(chunk_info["delay"])  # 模拟处理延迟
                        
                        # 上传数据块
                        chunk_key = f"{user_id}/{block_id}/{version_id}/{chunk_info['name']}"
                        chunk_result = self.upload_file_via_multipart(
                            chunk_key, chunk_info["content"]
                        )
                        
                        if not chunk_result:
                            log_error(f"[Producer] 上传chunk失败: {chunk_info['name']}")
                            consumer_error.set()
                            return
                        
                        log_info(f"[Producer] 上传chunk成功: {chunk_info['name']}")
                        
                        # 更新manifest文件
                        uploaded_chunks.append({
                            "name": chunk_info['name'],
                            "size": len(chunk_info['content']),
                            "uploaded_at": time.time()
                        })
                        
                        updated_manifest = {
                            "status": "generating",
                            "total_chunks": len(uploaded_chunks),
                            "chunks": uploaded_chunks,
                            "created_at": initial_manifest["created_at"],
                            "updated_at": time.time()
                        }
                        
                        manifest_data = json.dumps(updated_manifest, indent=2).encode()
                        update_result = self.upload_file_via_multipart(
                            manifest_key, manifest_data
                        )
                        
                        if not update_result:
                            log_error(f"[Producer] 更新manifest失败")
                            consumer_error.set()
                            return
                        
                        log_info(f"[Producer] Manifest更新成功 ({i+1}/{len(test_chunks)})")
                    
                    # 3. 最后更新状态为completed
                    time.sleep(0.5)
                    final_manifest = {
                        "status": "completed",
                        "total_chunks": len(uploaded_chunks),
                        "chunks": uploaded_chunks,
                        "created_at": initial_manifest["created_at"],
                        "updated_at": time.time(),
                        "completed_at": time.time()
                    }
                    
                    manifest_data = json.dumps(final_manifest, indent=2).encode()
                    final_result = self.upload_file_via_multipart(
                        manifest_key, manifest_data
                    )
                    
                    if not final_result:
                        log_error("[Producer] 更新最终状态失败")
                        consumer_error.set()
                        return
                    
                    log_info("[Producer] 所有数据生产完成，状态已设置为completed")
                    producer_done.set()
                    
                except Exception as e:
                    log_error(f"[Producer] 异常: {str(e)}")
                    consumer_error.set()
                    producer_done.set()
            
            def consumer_thread():
                """消费者线程：轮询manifest文件并下载新数据"""
                try:
                    log_info("[Consumer] 开始轮询消费...")
                    poll_interval = 0.5  # 轮询间隔
                    max_polls = 30  # 最大轮询次数（15秒）
                    polls = 0
                    
                    while polls < max_polls:
                        polls += 1
                        
                        # 1. 下载manifest文件
                        manifest_response = self.download_file_direct(manifest_key)
                        
                        if manifest_response is None:
                            # manifest还不存在，继续等待
                            log_debug(f"[Consumer] 第{polls}次轮询：manifest还不存在")
                            time.sleep(poll_interval)
                            continue
                        
                        try:
                            manifest = json.loads(manifest_response.decode())
                        except Exception as e:
                            log_error(f"[Consumer] 解析manifest失败: {str(e)}")
                            consumer_error.set()
                            return
                        
                        chunks = manifest.get("chunks", [])
                        status = manifest.get("status", "unknown")
                        
                        # 2. 检查并下载新的chunks
                        new_chunks = []
                        with chunks_lock:
                            for chunk in chunks:
                                chunk_name = chunk.get("name")
                                if chunk_name and chunk_name not in consumed_chunks:
                                    new_chunks.append(chunk)
                        
                        # 3. 下载新的chunks
                        for chunk in new_chunks:
                            chunk_name = chunk["name"]
                            chunk_key = f"{user_id}/{block_id}/{version_id}/{chunk_name}"
                            
                            # 下载数据
                            chunk_data = self.download_file_direct(chunk_key)
                            if chunk_data is None:
                                log_error(f"[Consumer] 下载数据失败: {chunk_name}")
                                consumer_error.set()
                                return
                            
                            with chunks_lock:
                                consumed_chunks.add(chunk_name)
                            
                            log_info(f"[Consumer] 成功消费chunk: {chunk_name} (大小: {len(chunk_data)} bytes)")
                        
                        # 4. 检查是否完成
                        if status == "completed":
                            log_info(f"[Consumer] 检测到completed状态，共消费了{len(consumed_chunks)}个chunks")
                            break
                        
                        # 5. 继续轮询
                        log_debug(f"[Consumer] 第{polls}次轮询：已消费{len(consumed_chunks)}个chunks，状态: {status}")
                        time.sleep(poll_interval)
                    
                    if polls >= max_polls:
                        log_error("[Consumer] 轮询超时")
                        consumer_error.set()
                    
                except Exception as e:
                    log_error(f"[Consumer] 异常: {str(e)}")
                    consumer_error.set()
            
            # 启动生产者和消费者线程
            producer = threading.Thread(target=producer_thread, name="Producer")
            consumer = threading.Thread(target=consumer_thread, name="Consumer")
            
            log_info("启动生产者和消费者线程...")
            producer.start()
            time.sleep(0.2)  # 让生产者先启动
            consumer.start()
            
            # 等待线程完成
            producer.join(timeout=20)
            consumer.join(timeout=20)
            
            # 验证结果
            if consumer_error.is_set():
                log_error("消费者遇到错误")
                return False
            
            if not producer_done.is_set():
                log_error("生产者未能完成")
                return False
            
            # 验证所有chunks都被消费
            expected_chunks = {chunk["name"] for chunk in test_chunks}
            with chunks_lock:
                if consumed_chunks != expected_chunks:
                    log_error(f"消费的chunks不匹配: 期望{expected_chunks}, 实际{consumed_chunks}")
                    return False
            
            log_info("✅ 基于文件API的流式消费测试成功!")
            log_info(f"   - 生产者上传了{len(test_chunks)}个chunks")
            log_info(f"   - 消费者成功消费了所有{len(consumed_chunks)}个chunks")
            log_info(f"   - 通过manifest文件实现了增量数据流")
            
            return True
            
        except Exception as e:
            log_error(f"流式消费测试失败: {str(e)}")
            import traceback
            traceback.print_exc()
            return False
    
    def upload_file_via_multipart(self, key: str, data: bytes) -> bool:
        """使用multipart API上传文件"""
        try:
            log_debug(f"尝试上传文件: {key}, 大小: {len(data)} bytes")
            # 1. 初始化上传
            init_response = self.session.post(
                f"{self.base_url}/upload/init",
                json={"key": key},
                headers=self.get_auth_headers()
            )
            
            if init_response.status_code != 200:
                log_error(f"初始化上传失败: {init_response.status_code}, {init_response.text}")
                return False
            
            upload_id = init_response.json()["upload_id"]
            
            # 2. 获取上传URL
            url_response = self.session.post(
                f"{self.base_url}/upload/get_upload_url",
                json={
                    "key": key,
                    "upload_id": upload_id,
                    "part_number": 1
                },
                headers=self.get_auth_headers()
            )
            
            if url_response.status_code != 200:
                return False
            
            upload_url = url_response.json().get("url") or url_response.json().get("upload_url")
            
            # 3. 上传数据
            upload_response = self.session.put(upload_url, data=data)
            if upload_response.status_code != 200:
                return False
            
            etag = upload_response.headers.get("ETag", "").strip('"')
            
            # 4. 完成上传
            complete_response = self.session.post(
                f"{self.base_url}/upload/complete",
                json={
                    "key": key,
                    "upload_id": upload_id,
                    "parts": [{"PartNumber": 1, "ETag": etag}]
                },
                headers=self.get_auth_headers()
            )
            
            return complete_response.status_code == 200
            
        except Exception as e:
            log_error(f"上传文件失败: {str(e)}")
            return False
    
    def download_file_direct(self, key: str) -> bytes:
        """直接下载文件内容"""
        try:
            # 获取下载URL
            url_response = self.session.get(
                f"{self.base_url}/download/url",
                params={"key": key},
                headers=self.get_auth_headers()
            )
            
            if url_response.status_code != 200:
                return None
            
            download_url = url_response.json().get("url") or url_response.json().get("download_url")
            
            # 下载文件
            download_response = self.session.get(download_url)
            if download_response.status_code != 200:
                return None
            
            return download_response.content
            
        except Exception:
            return None

def main():
    """运行测试"""
    log_info("=== 运行基于文件API的流式消费测试 ===")
    
    # 创建测试器实例
    tester = StreamingWithFilesTest()
    
    # 设置认证（如果需要）
    try:
        if not tester.setup_authentication():
            log_info("认证设置失败，继续无认证模式")
    except Exception as e:
        log_info(f"认证设置异常: {str(e)}")
    
    # 运行测试
    success = tester.test_streaming_with_file_api()
    
    if success:
        log_info("\n✅ 基于文件API的流式消费测试通过！")
        log_info("这证明了：")
        log_info("1. 可以使用现有的文件上传API实现流式数据传输")
        log_info("2. 通过manifest.json文件协调生产者和消费者")
        log_info("3. 消费者可以通过轮询检测新数据并增量下载")
    else:
        log_error("\n❌ 测试失败")
    
    return 0 if success else 1

if __name__ == "__main__":
    sys.exit(main())