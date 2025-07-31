#!/usr/bin/env python3
"""
单独测试端到端流式消费功能
用于验证基于manifest的轮询流式获取数据机制
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
    """运行端到端流式消费测试"""
    log_info("=== 单独运行端到端流式消费测试 ===")
    
    # 创建测试器实例
    tester = MultipartAPITester()
    
    # 设置认证（如果需要）
    try:
        if not tester.setup_authentication():
            log_info("认证设置失败，继续无认证模式")
    except Exception as e:
        log_info(f"认证设置异常: {str(e)}")
    
    # 运行端到端测试
    success = tester.test_end_to_end_streaming_consumption()
    
    if success:
        log_info("\n✅ 端到端流式消费测试通过！")
        log_info("这证明了：")
        log_info("1. 生产者可以逐步上传数据并增量更新manifest")
        log_info("2. 消费者可以通过轮询manifest来检测新数据")
        log_info("3. 整个流程实现了真正的流式数据传输")
    else:
        log_error("\n❌ 端到端流式消费测试失败")
    
    return 0 if success else 1

if __name__ == "__main__":
    sys.exit(main())