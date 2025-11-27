"""
MinerU API 工具函数
用于解析有价值的二进制文件（PDF、DOCX、PPTX、图像等）
"""
import requests
import time
from typing import Optional, Dict, Any
from pathlib import Path
from app.core.config import settings
from app.utils.logger import log_info, log_error


class MinerUClient:
    """MinerU API 客户端"""
    
    def __init__(self):
        self.api_key = settings.MINERU_API_TOKEN
        if not self.api_key:
            raise ValueError("MINERU_API_TOKEN is not configured. Please set it in .env file.")
        
        # 规范化 base_url，移除末尾的 /api/v4（如果存在）
        base_url = settings.MINERU_API_URL.rstrip('/')
        if base_url.endswith('/api/v4'):
            base_url = base_url[:-7]  # 移除 '/api/v4'
        self.base_url = base_url.rstrip('/')
        self.headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }
        
        log_info(f"MinerU client initialized: base_url={self.base_url}, token_configured={bool(self.api_key)}")
    
    def create_extract_task(self, file_url: str, model_version: str = "vlm") -> Dict[str, Any]:
        """
        创建解析任务
        
        Args:
            file_url: 文件的 URL（需要可公开访问）
            model_version: 模型版本，默认为 "vlm"
        
        Returns:
            包含 task_id 的响应字典
        """
        url = f"{self.base_url}/api/v4/extract/task"
        data = {
            "url": file_url,
            "model_version": model_version
        }
        
        try:
            log_info(f"Creating MinerU task: URL={url}, file_url={file_url}")
            response = requests.post(url, headers=self.headers, json=data, timeout=30)
            
            # 记录响应状态和内容（用于调试）
            log_info(f"MinerU API response status: {response.status_code}")
            
            # 如果状态码不是 2xx，记录错误响应
            if not response.ok:
                error_text = response.text[:500]  # 只记录前500字符
                log_error(f"MinerU API error response: {error_text}")
                response.raise_for_status()
            
            result = response.json()
            log_info(f"MinerU API response: {result}")
            
            # 检查 MinerU API 是否返回了错误响应
            if "code" in result and result.get("code") != 0:
                error_code = result.get("code")
                error_msg = result.get("msg", "Unknown error")
                log_error(f"MinerU API returned error: code={error_code}, msg={error_msg}")
                
                # 根据错误码提供更详细的错误信息
                if error_code == -60003:
                    raise Exception(
                        f"MinerU API 无法访问文件 URL: {error_msg}. "
                        f"文件 URL ({file_url}) 可能无法被 MinerU 服务器访问。"
                        f"如果使用 localhost，请使用 ngrok 或部署到公网服务器。"
                    )
                else:
                    raise Exception(f"MinerU API 错误 (code={error_code}): {error_msg}")
            
            # 检查多种可能的 task_id 字段名
            task_id = (
                result.get("task_id") or 
                result.get("taskId") or 
                result.get("id") or
                result.get("data", {}).get("task_id") if isinstance(result.get("data"), dict) else None
            )
            
            if task_id:
                log_info(f"MinerU task created successfully: task_id={task_id}")
            else:
                log_error(f"MinerU API response does not contain task_id. Response keys: {result.keys()}")
                log_error(f"Full response: {result}")
                raise Exception(
                    f"MinerU API 响应格式异常，未找到 task_id。"
                    f"响应内容: {result}"
                )
            
            return result
        except requests.exceptions.HTTPError as e:
            error_text = ""
            try:
                error_text = e.response.text[:500] if e.response else ""
            except:
                pass
            log_error(f"HTTP error creating MinerU task: {e}, response: {error_text}")
            raise Exception(f"Failed to create MinerU extraction task: HTTP {e.response.status_code if e.response else 'unknown'} - {str(e)}")
        except requests.exceptions.RequestException as e:
            log_error(f"Request error creating MinerU task: {e}")
            raise Exception(f"Failed to create MinerU extraction task: {str(e)}")
        except Exception as e:
            log_error(f"Unexpected error creating MinerU task: {e}")
            raise
    
    def get_task_result(self, task_id: str, max_wait_time: Optional[int] = None) -> Dict[str, Any]:
        """
        查询任务结果（带轮询）
        
        Args:
            task_id: 任务 ID
            max_wait_time: 最大等待时间（秒），默认使用配置中的 MINERU_TIMEOUT
        
        Returns:
            任务结果字典
        """
        if max_wait_time is None:
            max_wait_time = settings.MINERU_TIMEOUT
        
        url = f"{self.base_url}/api/v4/extract/task/{task_id}"
        start_time = time.time()
        poll_interval = 3  # 每 3 秒查询一次
        
        while True:
            try:
                response = requests.get(url, headers=self.headers, timeout=30)
                response.raise_for_status()
                result = response.json()
                
                status = result.get("status", "unknown")
                
                if status == "completed":
                    log_info(f"MinerU task {task_id} completed")
                    return result
                elif status == "failed":
                    error_msg = result.get("error", "Unknown error")
                    log_error(f"MinerU task {task_id} failed: {error_msg}")
                    raise Exception(f"MinerU extraction failed: {error_msg}")
                
                # 检查是否超时
                elapsed = time.time() - start_time
                if elapsed > max_wait_time:
                    raise Exception(f"MinerU task timeout after {max_wait_time}s")
                
                # 等待后继续轮询
                time.sleep(poll_interval)
                
            except requests.exceptions.RequestException as e:
                log_error(f"Failed to query MinerU task {task_id}: {e}")
                raise Exception(f"Failed to query MinerU task: {str(e)}")
    
    def extract_text_from_file(self, file_url: str, model_version: str = "vlm") -> str:
        """
        从文件 URL 提取文本内容（完整流程）
        
        Args:
            file_url: 文件的 URL
            model_version: 模型版本
        
        Returns:
            提取的文本内容
        """
        # 创建任务
        task_result = self.create_extract_task(file_url, model_version)
        
        # 尝试多种可能的 task_id 字段名
        task_id = (
            task_result.get("task_id") or 
            task_result.get("taskId") or 
            task_result.get("id") or
            task_result.get("data", {}).get("task_id") if isinstance(task_result.get("data"), dict) else None
        )
        
        if not task_id:
            log_error(f"Failed to get task_id from MinerU API. Response: {task_result}")
            raise Exception(f"Failed to get task_id from MinerU API. Response keys: {list(task_result.keys())}")
        
        # 等待任务完成并获取结果
        result = self.get_task_result(task_id)
        
        # 提取文本内容
        # MinerU 返回的结果结构可能包含 markdown 或其他格式
        # 根据 MinerU API 文档，结果可能包含以下字段：
        # - markdown: Markdown 格式的文本
        # - content: 原始内容
        # - text: 纯文本
        # - data: 结构化数据
        
        # 优先返回 markdown（最常用）
        markdown = result.get("markdown", "")
        if markdown:
            return markdown
        
        # 其次返回 content
        content = result.get("content", "")
        if content:
            return content
        
        # 再次尝试 text
        text = result.get("text", "")
        if text:
            return text
        
        # 如果结果中包含 data 字段，尝试提取其中的文本
        data = result.get("data", {})
        if isinstance(data, dict):
            data_markdown = data.get("markdown", "")
            if data_markdown:
                return data_markdown
            data_content = data.get("content", "")
            if data_content:
                return data_content
        
        # 如果都没有，返回整个结果的字符串表示（用于调试）
        log_error(f"MinerU response structure: {result.keys()}")
        raise Exception("No content found in MinerU response. Response structure may have changed.")


def get_mineru_client() -> Optional[MinerUClient]:
    """获取 MinerU 客户端实例（如果配置了 API Token）"""
    if not settings.MINERU_API_TOKEN:
        return None
    return MinerUClient()

