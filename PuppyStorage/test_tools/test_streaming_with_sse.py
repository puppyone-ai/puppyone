#!/usr/bin/env python3
"""
带有SSE (Server-Sent Events) 支持的流式消费测试
模拟实时通知机制的流式数据传输
"""

import sys
import os
import json
import time
import threading
import queue
from typing import Set, Dict, Any
from dataclasses import dataclass
from enum import Enum

# 添加项目根目录到Python路径
current_dir = os.path.dirname(os.path.abspath(__file__))
parent_dir = os.path.dirname(current_dir)
sys.path.insert(0, parent_dir)

from test_multipart_api import MultipartAPITester
from utils.logger import log_info, log_error, log_debug

class SSEEventType(Enum):
    """SSE事件类型"""
    STREAMING_STARTED = "streaming_started"
    CHUNK_AVAILABLE = "chunk_available"
    STREAMING_COMPLETED = "streaming_completed"
    ERROR_OCCURRED = "error_occurred"

@dataclass
class SSEEvent:
    """SSE事件数据结构"""
    event_type: SSEEventType
    data: Dict[str, Any]
    timestamp: float
    stream_id: str

class MockSSEServer:
    """模拟SSE服务器"""
    
    def __init__(self):
        self.subscribers: Dict[str, queue.Queue] = {}
        self.active_streams: Dict[str, Dict] = {}
    
    def subscribe(self, stream_id: str) -> queue.Queue:
        """订阅SSE事件流"""
        event_queue = queue.Queue()
        self.subscribers[stream_id] = event_queue
        log_info(f"[SSE] 客户端订阅流: {stream_id}")
        return event_queue
    
    def unsubscribe(self, stream_id: str):
        """取消订阅"""
        if stream_id in self.subscribers:
            del self.subscribers[stream_id]
            log_info(f"[SSE] 客户端取消订阅流: {stream_id}")
    
    def publish_event(self, stream_id: str, event_type: SSEEventType, data: Dict[str, Any]):
        """发布SSE事件"""
        event = SSEEvent(
            event_type=event_type,
            data=data,
            timestamp=time.time(),
            stream_id=stream_id
        )
        
        # 发送给所有订阅者
        if stream_id in self.subscribers:
            try:
                self.subscribers[stream_id].put_nowait(event)
                log_debug(f"[SSE] 发布事件: {event_type.value} -> {stream_id}")
            except queue.Full:
                log_error(f"[SSE] 事件队列已满: {stream_id}")
    
    def start_stream(self, stream_id: str, metadata: Dict[str, Any]):
        """开始新的数据流"""
        self.active_streams[stream_id] = {
            "status": "generating",
            "metadata": metadata,
            "start_time": time.time()
        }
        
        self.publish_event(stream_id, SSEEventType.STREAMING_STARTED, {
            "stream_id": stream_id,
            "metadata": metadata,
            "message": "数据流已开始生成"
        })
    
    def notify_chunk_available(self, stream_id: str, chunk_info: Dict[str, Any]):
        """通知新的数据块可用"""
        self.publish_event(stream_id, SSEEventType.CHUNK_AVAILABLE, {
            "stream_id": stream_id,
            "chunk": chunk_info,
            "message": f"新数据块可用: {chunk_info.get('name')}"
        })
    
    def complete_stream(self, stream_id: str, summary: Dict[str, Any]):
        """完成数据流"""
        if stream_id in self.active_streams:
            self.active_streams[stream_id]["status"] = "completed"
            self.active_streams[stream_id]["end_time"] = time.time()
        
        self.publish_event(stream_id, SSEEventType.STREAMING_COMPLETED, {
            "stream_id": stream_id,
            "summary": summary,
            "message": "数据流生成完成"
        })
    
    def notify_error(self, stream_id: str, error_info: Dict[str, Any]):
        """通知错误"""
        self.publish_event(stream_id, SSEEventType.ERROR_OCCURRED, {
            "stream_id": stream_id,
            "error": error_info,
            "message": f"数据流出现错误: {error_info.get('message')}"
        })

class StreamingWithSSETest(MultipartAPITester):
    """带有SSE支持的流式消费测试"""
    
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.sse_server = MockSSEServer()
    
    def test_streaming_with_sse_notifications(self):
        """测试带有SSE通知的流式消费"""
        log_info("=== 开始测试带有SSE通知的流式消费 ===")
        
        try:
            # 准备测试数据
            user_id = self.test_user_id if self.test_user_id else "test_user"
            block_id = f"sse_stream_test_{int(time.time())}"
            version_id = f"v_{int(time.time())}"
            stream_id = f"{user_id}/{block_id}/{version_id}"
            manifest_key = f"{stream_id}/manifest.json"
            
            # 共享状态
            producer_done = threading.Event()
            consumer_error = threading.Event()
            consumer_done = threading.Event()
            consumed_chunks: Set[str] = set()
            chunks_lock = threading.Lock()
            
            # 预定义的测试数据块
            test_chunks = [
                {"name": "chunk_001.txt", "content": b"First chunk data", "delay": 1.0},
                {"name": "chunk_002.txt", "content": b"Second chunk data", "delay": 1.5},
                {"name": "chunk_003.txt", "content": b"Third chunk data", "delay": 1.0},
            ]
            
            def producer_thread():
                """生产者线程：逐步上传数据并发送SSE通知"""
                try:
                    log_info("[Producer] 开始生产数据...")
                    
                    # 1. 启动数据流并发送SSE通知
                    self.sse_server.start_stream(stream_id, {
                        "user_id": user_id,
                        "block_id": block_id,
                        "version_id": version_id,
                        "total_chunks": len(test_chunks)
                    })
                    
                    # 2. 创建初始manifest文件
                    initial_manifest = {
                        "status": "generating",
                        "total_chunks": 0,
                        "chunks": [],
                        "created_at": time.time(),
                        "stream_id": stream_id
                    }
                    
                    manifest_data = json.dumps(initial_manifest, indent=2).encode()
                    if not self.upload_file_via_multipart(manifest_key, manifest_data):
                        self.sse_server.notify_error(stream_id, {
                            "message": "创建初始manifest失败",
                            "stage": "initialization"
                        })
                        consumer_error.set()
                        return
                    
                    log_info("[Producer] 初始manifest创建成功")
                    
                    # 3. 逐个上传数据块并发送SSE通知
                    uploaded_chunks = []
                    for i, chunk_info in enumerate(test_chunks):
                        time.sleep(chunk_info["delay"])  # 模拟处理延迟
                        
                        # 上传数据块
                        chunk_key = f"{stream_id}/{chunk_info['name']}"
                        if not self.upload_file_via_multipart(chunk_key, chunk_info["content"]):
                            self.sse_server.notify_error(stream_id, {
                                "message": f"上传chunk失败: {chunk_info['name']}",
                                "stage": "upload",
                                "chunk": chunk_info['name']
                            })
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
                            "updated_at": time.time(),
                            "stream_id": stream_id
                        }
                        
                        manifest_data = json.dumps(updated_manifest, indent=2).encode()
                        if not self.upload_file_via_multipart(manifest_key, manifest_data):
                            self.sse_server.notify_error(stream_id, {
                                "message": "更新manifest失败",
                                "stage": "manifest_update",
                                "chunk": chunk_info['name']
                            })
                            consumer_error.set()
                            return
                        
                        # 发送SSE通知：新chunk可用
                        self.sse_server.notify_chunk_available(stream_id, {
                            "name": chunk_info['name'],
                            "size": len(chunk_info['content']),
                            "index": i + 1,
                            "total": len(test_chunks)
                        })
                        
                        log_info(f"[Producer] Manifest更新成功 ({i+1}/{len(test_chunks)})")
                    
                    # 4. 完成数据流并发送SSE通知
                    time.sleep(0.5)
                    final_manifest = {
                        "status": "completed",
                        "total_chunks": len(uploaded_chunks),
                        "chunks": uploaded_chunks,
                        "created_at": initial_manifest["created_at"],
                        "updated_at": time.time(),
                        "completed_at": time.time(),
                        "stream_id": stream_id
                    }
                    
                    manifest_data = json.dumps(final_manifest, indent=2).encode()
                    if not self.upload_file_via_multipart(manifest_key, manifest_data):
                        self.sse_server.notify_error(stream_id, {
                            "message": "更新最终状态失败",
                            "stage": "completion"
                        })
                        consumer_error.set()
                        return
                    
                    # 发送SSE通知：流式传输完成
                    self.sse_server.complete_stream(stream_id, {
                        "total_chunks": len(uploaded_chunks),
                        "total_size": sum(len(c["content"]) for c in test_chunks),
                        "duration": time.time() - initial_manifest["created_at"]
                    })
                    
                    log_info("[Producer] 所有数据生产完成，状态已设置为completed")
                    producer_done.set()
                    
                except Exception as e:
                    self.sse_server.notify_error(stream_id, {
                        "message": str(e),
                        "stage": "unknown",
                        "exception_type": type(e).__name__
                    })
                    log_error(f"[Producer] 异常: {str(e)}")
                    consumer_error.set()
                    producer_done.set()
            
            def consumer_thread():
                """消费者线程：通过SSE通知和轮询结合消费数据"""
                try:
                    log_info("[Consumer] 开始SSE事件驱动消费...")
                    
                    # 订阅SSE事件流
                    event_queue = self.sse_server.subscribe(stream_id)
                    
                    # 事件驱动的消费循环
                    max_wait_time = 30.0  # 最大等待时间
                    start_time = time.time()
                    stream_started = False
                    expected_chunks_count = len(test_chunks)
                    
                    while time.time() - start_time < max_wait_time:
                        try:
                            # 等待SSE事件（带超时）
                            event = event_queue.get(timeout=1.0)
                            
                            if event.event_type == SSEEventType.STREAMING_STARTED:
                                log_info(f"[Consumer] 收到流式开始通知: {event.data['message']}")
                                stream_started = True
                                
                            elif event.event_type == SSEEventType.CHUNK_AVAILABLE:
                                chunk_info = event.data["chunk"]
                                chunk_name = chunk_info["name"]
                                
                                log_info(f"[Consumer] 收到新chunk通知: {chunk_name}")
                                
                                # 检查是否已经消费过
                                with chunks_lock:
                                    if chunk_name in consumed_chunks:
                                        log_debug(f"[Consumer] chunk已消费，跳过: {chunk_name}")
                                        continue
                                
                                # 下载新的chunk
                                chunk_key = f"{stream_id}/{chunk_name}"
                                chunk_data = self.download_file_direct(chunk_key)
                                
                                if chunk_data is None:
                                    log_error(f"[Consumer] 下载数据失败: {chunk_name}")
                                    consumer_error.set()
                                    return
                                
                                with chunks_lock:
                                    consumed_chunks.add(chunk_name)
                                
                                log_info(f"[Consumer] 成功消费chunk: {chunk_name} (大小: {len(chunk_data)} bytes)")
                                
                            elif event.event_type == SSEEventType.STREAMING_COMPLETED:
                                log_info(f"[Consumer] 收到流式完成通知: {event.data['message']}")
                                summary = event.data["summary"]
                                log_info(f"[Consumer] 流式传输摘要: {summary}")
                                consumer_done.set()
                                break
                                
                            elif event.event_type == SSEEventType.ERROR_OCCURRED:
                                log_error(f"[Consumer] 收到错误通知: {event.data['message']}")
                                consumer_error.set()
                                return
                        
                        except queue.Empty:
                            # 超时，继续等待
                            if stream_started:
                                log_debug(f"[Consumer] 等待新的SSE事件... (已消费{len(consumed_chunks)}/{expected_chunks_count})")
                            continue
                    
                    # 取消订阅
                    self.sse_server.unsubscribe(stream_id)
                    
                    if not consumer_done.is_set():
                        # 检查是否所有chunks都已消费，如果是，则认为成功
                        with chunks_lock:
                            if len(consumed_chunks) >= expected_chunks_count:
                                log_info(f"[Consumer] 所有chunks已消费完成 ({len(consumed_chunks)}/{expected_chunks_count})")
                                consumer_done.set()
                            else:
                                log_error(f"[Consumer] SSE事件消费超时，只消费了{len(consumed_chunks)}/{expected_chunks_count}个chunks")
                                consumer_error.set()
                    
                except Exception as e:
                    log_error(f"[Consumer] 异常: {str(e)}")
                    consumer_error.set()
            
            # 启动生产者和消费者线程
            producer = threading.Thread(target=producer_thread, name="SSE-Producer")
            consumer = threading.Thread(target=consumer_thread, name="SSE-Consumer")
            
            log_info("启动SSE模式的生产者和消费者线程...")
            producer.start()
            time.sleep(0.2)  # 让生产者先启动
            consumer.start()
            
            # 等待线程完成
            producer.join(timeout=25)
            consumer.join(timeout=25)
            
            # 验证结果
            if consumer_error.is_set():
                log_error("消费者遇到错误")
                return False
            
            if not producer_done.is_set():
                log_error("生产者未能完成")
                return False
            
            if not consumer_done.is_set():
                log_error("消费者未能完成")
                return False
            
            # 验证所有chunks都被消费
            expected_chunks = {chunk["name"] for chunk in test_chunks}
            with chunks_lock:
                if consumed_chunks != expected_chunks:
                    log_error(f"消费的chunks不匹配: 期望{expected_chunks}, 实际{consumed_chunks}")
                    return False
            
            log_info("✅ 带有SSE通知的流式消费测试成功!")
            log_info(f"   - 生产者上传了{len(test_chunks)}个chunks")
            log_info(f"   - 消费者通过SSE事件成功消费了所有{len(consumed_chunks)}个chunks")
            log_info(f"   - 实现了真正的事件驱动流式数据传输")
            
            return True
            
        except Exception as e:
            log_error(f"SSE流式消费测试失败: {str(e)}")
            import traceback
            traceback.print_exc()
            return False

def main():
    """运行SSE流式消费测试"""
    log_info("=== 运行带有SSE支持的流式消费测试 ===")
    
    # 创建测试器实例
    tester = StreamingWithSSETest()
    
    # 设置认证（如果需要）
    try:
        if not tester.setup_authentication():
            log_info("认证设置失败，继续无认证模式")
    except Exception as e:
        log_info(f"认证设置异常: {str(e)}")
    
    # 运行SSE测试
    success = tester.test_streaming_with_sse_notifications()
    
    if success:
        log_info("\n✅ 带有SSE支持的流式消费测试通过！")
        log_info("这证明了：")
        log_info("1. 可以实现真正的事件驱动数据传输")
        log_info("2. SSE通知机制可以替代轮询，提供实时性")
        log_info("3. 生产者可以主动通知消费者新数据的可用性")
        log_info("4. 支持开始/结束/错误等多种类型的通知")
    else:
        log_error("\n❌ SSE流式消费测试失败")
    
    return 0 if success else 1

if __name__ == "__main__":
    sys.exit(main())