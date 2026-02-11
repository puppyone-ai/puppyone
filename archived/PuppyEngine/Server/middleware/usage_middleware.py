"""
Usage checking middleware for Engine Server
"""

from Server.usage_module import usage_module, UsageError
from Server.middleware.auth_middleware import AuthenticationResult
from Utils.logger import log_info, log_error

class UsageCheckResult:
    """Container for usage check results"""
    def __init__(self, allowed: bool, available: int = 0, estimated_required: int = 0):
        self.allowed = allowed
        self.available = available
        self.estimated_required = estimated_required

async def check_usage_limit(
    auth_result: AuthenticationResult,
    estimated_runs: int
) -> UsageCheckResult:
    """
    Check if user has sufficient usage quota for the estimated runs.
    
    Args:
        auth_result: Authentication result containing user and token info
        estimated_runs: Estimated number of runs needed
        
    Returns:
        UsageCheckResult: Contains check results
        
    Raises:
        UsageError: If usage check fails or quota is insufficient
    """
    if not usage_module.requires_usage_check():
        # Local mode: explicitly skip usage pre-check
        log_info("Local mode: skipping usage pre-check")
        return UsageCheckResult(allowed=True, available=float('inf'), estimated_required=estimated_runs)
    
    try:
        if auth_result.user_token:
            # 有token，使用基于token的方法
            check_result = await usage_module.check_usage_async(
                user_token=auth_result.user_token,
                usage_type="runs",
                amount=estimated_runs
            )
        else:
            # 只有用户ID，使用基于用户ID的方法
            check_result = await usage_module.check_usage_by_user_id_async(
                user_id=auth_result.user.user_id,
                usage_type="runs",
                amount=estimated_runs
            )
        
        allowed = check_result.get("allowed", False)
        available = check_result.get("available", 0)
        
        if not allowed:
            raise UsageError(
                f"Usage不足: 预估需要{estimated_runs}个runs，但只有{available}个可用",
                status_code=429,
                available=available
            )
        
        log_info(f"Usage预检查通过: 用户 {auth_result.user.user_id} 有足够的runs (预估需要: {estimated_runs}, 可用: {available})")
        return UsageCheckResult(allowed=True, available=available, estimated_required=estimated_runs)
        
    except UsageError as ue:
        log_error(f"Usage预检查失败: {ue.message}")
        raise ue
    except Exception as ue:
        log_error(f"Usage预检查发生未预期错误: {str(ue)}")
        raise UsageError(
            "Usage服务错误",
            status_code=503,
            available=0
        )

async def consume_usage_for_edge(
    auth_result: AuthenticationResult,
    edge_metadata: dict
) -> None:
    """
    Consume usage for a successfully executed edge.
    
    Args:
        auth_result: Authentication result containing user and token info
        edge_metadata: Metadata about the edge execution
        
    Raises:
        UsageError: If usage consumption fails
    """
    if not usage_module.requires_usage_check():
        log_info("Local mode: skipping usage consumption")
        return
    
    execution_success = edge_metadata.get("execution_success", False)

    edge_type = edge_metadata.get("edge_type")

    # 更新事件元数据
    event_metadata = {
        "task_id": edge_metadata.get("task_id"),
        "connection_id": edge_metadata.get("connection_id"),
        "edge_id": edge_metadata.get("edge_id"),
        "edge_type": edge_type,
        "execution_time": edge_metadata.get("execution_time", 0.0),
        "execution_success": execution_success,
        "workflow_type": "engine_execution"
    }

    # 添加错误信息（如果有）
    if edge_metadata.get("error_info"):
        event_metadata["error_info"] = edge_metadata["error_info"]

    # 决定usage类型与数量
    from typing import Optional
    usage_type: Optional[str] = None
    amount: int = 0

    if edge_type == "llm":
        # LLM边对应 calls
        usage_type = "llm_calls"
        amount = 1 if execution_success else 0
        if not execution_success:
            event_metadata["failure_reason"] = "llm_call_failed"
    else:
        # 其他基础边：成功执行就计入 runs；失败记录事件（amount=0）
        usage_type = "runs"
        amount = 1 if execution_success else 0
        if not execution_success:
            event_metadata["failure_reason"] = "edge_execution_failed"

    # 失败为 amount=0 也需要上报（用于审计），成功则上报对应的 amount

    # 发送到用户系统（或本地模式跳过）
    async def _consume(utype: str, amt: int):
        if auth_result.user_token:
            await usage_module.consume_usage_async(
                user_token=auth_result.user_token,
                usage_type=utype,
                amount=amt,
                event_metadata=event_metadata
            )
        else:
            await usage_module.consume_usage_by_user_id_async(
                user_id=auth_result.user.user_id,
                usage_type=utype,
                amount=amt,
                event_metadata=event_metadata
            )

    if edge_type in ("llm", "search"):
        # 对 LLM 与 Search 边：同时计 runs 和 calls（统一记到 llm_calls）
        await _consume("runs", 1 if execution_success else 0)
        await _consume("llm_calls", 1 if execution_success else 0)
    else:
        await _consume("runs", amount)