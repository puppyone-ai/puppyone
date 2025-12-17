"""
URL 解析器
负责从各种来源抓取和解析数据
"""

import re
import json
from typing import Dict, Any, Optional, List
from urllib.parse import urlparse
import httpx
from bs4 import BeautifulSoup
from src.exceptions import BusinessException, ErrorCode
from src.utils.logger import log_info, log_error, log_warning
from src.connect.data_provider import DataProvider, DataProviderResult
from src.connect.exceptions import AuthenticationError


class UrlParser:
    """URL 解析器"""

    # 安全设置
    MAX_CONTENT_SIZE = 10 * 1024 * 1024  # 10MB
    REQUEST_TIMEOUT = 30.0  # 30秒

    # 禁止访问的内网IP模式
    BLOCKED_PATTERNS = [
        r'^127\.',
        r'^10\.',
        r'^172\.(1[6-9]|2[0-9]|3[0-1])\.',
        r'^192\.168\.',
        r'^localhost$',
        r'^0\.0\.0\.0$',
    ]

    def __init__(self, user_id: Optional[str] = None):
        """初始化解析器"""
        self.user_id = user_id
        self.client = httpx.AsyncClient(
            timeout=self.REQUEST_TIMEOUT,
            follow_redirects=True,
            limits=httpx.Limits(max_connections=10)
        )
        self.providers: List[DataProvider] = []

    def register_provider(self, provider: DataProvider):
        """注册数据提供者"""
        self.providers.append(provider)

    def _is_safe_url(self, url: str) -> bool:
        """
        检查URL是否安全（防止SSRF攻击）

        Args:
            url: 待检查的URL

        Returns:
            是否安全
        """
        try:
            parsed = urlparse(url)
            hostname = parsed.hostname

            if not hostname:
                return False

            # 检查是否匹配禁止的模式
            for pattern in self.BLOCKED_PATTERNS:
                if re.match(pattern, hostname, re.IGNORECASE):
                    log_warning(f"Blocked URL with internal IP: {url}")
                    return False

            return True
        except Exception as e:
            log_error(f"Error checking URL safety: {e}")
            return False

    def _detect_source_type(self, url: str) -> str:
        """
        检测数据源类型

        Args:
            url: URL

        Returns:
            数据源类型
        """
        url_lower = url.lower()

        if "github.com" in url_lower:
            return "github"
        elif "notion.so" in url_lower or "notion.site" in url_lower:
            return "notion"
        elif "linear.app" in url_lower:
            return "linear"
        elif url_lower.endswith(".json"):
            return "json"
        else:
            return "generic"

    async def parse(self, url: str) -> Dict[str, Any]:
        """
        解析URL并返回结构化数据

        Args:
            url: 要解析的URL

        Returns:
            包含data、source_type、title等信息的字典

        Raises:
            BusinessException: 解析失败时抛出
        """
        # 安全检查
        if not self._is_safe_url(url):
            raise BusinessException(
                message="不允许访问内网地址",
                code=ErrorCode.BAD_REQUEST
            )

        # 检测数据源类型
        source_type = self._detect_source_type(url)

        # 首先尝试使用注册的providers
        log_info(f"Checking {len(self.providers)} registered providers for URL: {url}")
        for provider in self.providers:
            try:
                can_handle = await provider.can_handle(url)
                log_info(f"Provider {provider.__class__.__name__} can_handle: {can_handle}")
                if can_handle:
                    log_info(f"Using provider {provider.__class__.__name__} for {url}")
                    result = await provider.fetch_data(url)

                    # Convert DataProviderResult to expected format
                    return self._convert_provider_result(result)

            except AuthenticationError as e:
                # Re-raise authentication errors with additional context
                log_error(f"Authentication required for {url}: {e}")
                raise BusinessException(
                    message=str(e),
                    code=ErrorCode.UNAUTHORIZED
                )
            except Exception as e:
                log_error(f"Provider {provider.__class__.__name__} failed for {url}: {e}")
                # Continue to try next provider or fallback

        # Fallback to generic HTTP parsing for non-authenticated sources
        try:
            log_info(f"Falling back to generic HTTP parsing for {url}")

            # 发起HTTP请求
            response = await self.client.get(url)
            response.raise_for_status()

            # 检查内容大小
            content_length = len(response.content)
            if content_length > self.MAX_CONTENT_SIZE:
                raise BusinessException(
                    message=f"内容大小超过限制 ({content_length} > {self.MAX_CONTENT_SIZE})",
                    code=ErrorCode.BAD_REQUEST
                )

            content_type = response.headers.get("content-type", "").lower()

            # 根据内容类型解析
            if "application/json" in content_type or source_type == "json":
                return self._parse_json(response.text, url, source_type)
            else:
                return self._parse_html(response.text, url, source_type)

        except httpx.HTTPStatusError as e:
            log_error(f"HTTP error fetching {url}: {e}")

            # Check if this might be an authentication issue for known platforms
            if e.response.status_code in [401, 403] and source_type in ["notion", "github", "linear"]:
                raise BusinessException(
                    message=f"Authentication required to access {source_type}. Please connect your {source_type} account first.",
                    code=ErrorCode.UNAUTHORIZED
                )

            raise BusinessException(
                message=f"HTTP错误: {e.response.status_code}",
                code=ErrorCode.BAD_REQUEST
            )
        except httpx.TimeoutException:
            log_error(f"Timeout fetching {url}")
            raise BusinessException(
                message="请求超时",
                code=ErrorCode.BAD_REQUEST
            )
        except Exception as e:
            log_error(f"Error parsing {url}: {e}")
            raise BusinessException(
                message=f"解析错误: {str(e)}",
                code=ErrorCode.BAD_REQUEST
            )

    def _convert_provider_result(self, result: DataProviderResult) -> Dict[str, Any]:
        """
        将DataProviderResult转换为旧格式

        Args:
            result: DataProviderResult

        Returns:
            转换后的字典
        """
        # Extract fields information for compatibility
        fields = []
        if result.fields:
            fields = result.fields

        return {
            "data": result.data,
            "source_type": result.source_type,
            "title": result.title,
            "description": result.description,
            "fields": fields,
            "structure_info": result.structure_info,
        }

    def _parse_json(self, content: str, url: str, source_type: str) -> Dict[str, Any]:
        """
        解析JSON内容

        Args:
            content: JSON字符串
            url: 原始URL
            source_type: 数据源类型

        Returns:
            解析结果
        """
        try:
            data = json.loads(content)

            # 如果是列表，直接返回
            if isinstance(data, list):
                return {
                    "data": data,
                    "source_type": source_type,
                    "title": f"JSON data from {urlparse(url).netloc}",
                }

            # 如果是字典，尝试找到数据数组
            if isinstance(data, dict):
                # 常见的数据字段名
                data_keys = ["data", "items", "results", "entries", "records"]

                for key in data_keys:
                    if key in data and isinstance(data[key], list):
                        return {
                            "data": data[key],
                            "source_type": source_type,
                            "title": data.get("title") or data.get("name") or f"JSON data from {urlparse(url).netloc}",
                        }

                # 如果没找到数组，将整个字典作为单条数据
                return {
                    "data": [data],
                    "source_type": source_type,
                    "title": data.get("title") or data.get("name") or f"JSON data from {urlparse(url).netloc}",
                }

            # 其他类型，包装成列表
            return {
                "data": [{"value": data}],
                "source_type": source_type,
                "title": f"JSON data from {urlparse(url).netloc}",
            }

        except json.JSONDecodeError as e:
            log_error(f"JSON decode error: {e}")
            raise BusinessException(
                message="JSON格式错误",
                code=ErrorCode.BAD_REQUEST
            )

    def _parse_html(self, content: str, url: str, source_type: str) -> Dict[str, Any]:
        """
        解析HTML内容

        Args:
            content: HTML字符串
            url: 原始URL
            source_type: 数据源类型

        Returns:
            解析结果
        """
        try:
            soup = BeautifulSoup(content, "lxml")

            # 提取标题
            title_tag = soup.find("title")
            title = title_tag.get_text().strip() if title_tag else urlparse(url).netloc

            # 尝试提取表格数据
            tables = soup.find_all("table")
            if tables:
                data = self._extract_table_data(tables[0])
                if data:
                    return {
                        "data": data,
                        "source_type": source_type,
                        "title": title,
                    }

            # 尝试提取列表数据
            lists = soup.find_all(["ul", "ol"])
            if lists:
                data = self._extract_list_data(lists[0])
                if data:
                    return {
                        "data": data,
                        "source_type": source_type,
                        "title": title,
                    }

            # 提取所有文本段落作为基础数据
            paragraphs = soup.find_all("p")
            if paragraphs:
                data = [
                    {"content": p.get_text().strip()}
                    for p in paragraphs
                    if p.get_text().strip()
                ]
                if data:
                    return {
                        "data": data,
                        "source_type": source_type,
                        "title": title,
                    }

            # 如果没有找到结构化数据，返回基本信息
            return {
                "data": [{"title": title, "url": url, "content": "No structured data found"}],
                "source_type": source_type,
                "title": title,
            }

        except Exception as e:
            log_error(f"HTML parsing error: {e}")
            raise BusinessException(
                message=f"HTML解析错误: {str(e)}",
                code=ErrorCode.BAD_REQUEST
            )

    def _extract_table_data(self, table) -> list:
        """
        从HTML表格中提取数据

        Args:
            table: BeautifulSoup表格对象

        Returns:
            数据列表
        """
        data = []

        # 提取表头
        headers = []
        thead = table.find("thead")
        if thead:
            header_row = thead.find("tr")
            if header_row:
                headers = [th.get_text().strip() for th in header_row.find_all(["th", "td"])]

        # 如果没有thead，尝试从第一行提取
        if not headers:
            first_row = table.find("tr")
            if first_row:
                headers = [th.get_text().strip() for th in first_row.find_all(["th", "td"])]

        # 提取数据行
        tbody = table.find("tbody") or table
        rows = tbody.find_all("tr")

        # 跳过表头行（如果第一行是表头）
        start_idx = 1 if not thead and headers else 0

        for row in rows[start_idx:]:
            cells = row.find_all(["td", "th"])
            if cells:
                row_data = {}
                for i, cell in enumerate(cells):
                    header = headers[i] if i < len(headers) else f"column_{i}"
                    row_data[header] = cell.get_text().strip()
                data.append(row_data)

        return data

    def _extract_list_data(self, list_element) -> list:
        """
        从HTML列表中提取数据

        Args:
            list_element: BeautifulSoup列表对象

        Returns:
            数据列表
        """
        data = []
        items = list_element.find_all("li", recursive=False)

        for item in items:
            text = item.get_text().strip()
            if text:
                data.append({"item": text})

        return data

    async def close(self):
        """关闭HTTP客户端和providers"""
        await self.client.aclose()

        for provider in self.providers:
            try:
                await provider.close()
            except Exception as e:
                log_error(f"Error closing provider {provider.__class__.__name__}: {e}")
