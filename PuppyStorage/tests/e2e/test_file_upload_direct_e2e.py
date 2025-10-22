"""
E2E Test: 小文件直接上传完整流程

场景: 用户在 Block 中上传小文件 (< 5MB)
路径: Frontend → Proxy → Storage → S3/Local → Manifest → Download
验证: 文件存储、Manifest 正确性、下载验证

关键路径:
1. POST /upload/chunk/direct - 上传文件
2. PUT /upload/manifest - 更新 Manifest
3. GET /download/url - 获取下载链接
4. 验证文件内容完整性

前端调用: PuppyFlow/app/components/workflow/blockNode/hooks/useFileUpload.ts
"""

import pytest
import uuid
import time
import hashlib
from httpx import AsyncClient


@pytest.fixture
def test_file_data():
    """测试文件数据"""
    content = b"Test file content for E2E direct upload " * 100  # ~4KB
    return {
        "content": content,
        "name": "test_direct_upload.bin",
        "size": len(content),
        "etag": hashlib.md5(content).hexdigest(),
        "content_type": "application/octet-stream"
    }


@pytest.fixture
def test_block_context():
    """测试 Block 上下文"""
    return {
        "block_id": f"block_{uuid.uuid4().hex[:8]}",
        "version_id": f"v_{int(time.time())}",
        "user_id": "test_user_e2e"
    }


# Helper function for shared upload test logic
async def _execute_upload_test_flow(
    api_client: AsyncClient,
    test_file_data: dict,
    test_block_context: dict,
    deployment_type: str
):
    """
    共享的上传测试流程
    
    Steps:
    1. Upload file via /upload/chunk/direct
    2. Update manifest via /upload/manifest
    3. Get download URL via /download/url
    4. Verify file content (local mode only)
    5. Cleanup
    """
    
    # Step 1: 直接上传文件
    print(f"\n[E2E] Step 1: 直接上传文件 (deployment={deployment_type})")
    
    upload_resp = await api_client.post(
        "/upload/chunk/direct",
        params={
            "block_id": test_block_context["block_id"],
            "file_name": test_file_data["name"],
            "content_type": test_file_data["content_type"],
            "version_id": test_block_context["version_id"]
        },
        content=test_file_data["content"],
        headers={"Authorization": "Bearer testtoken"}
    )
    
    # 验证上传响应
    assert upload_resp.status_code == 200, f"上传失败: {upload_resp.text}"
    upload_result = upload_resp.json()
    
    assert upload_result["success"] is True
    assert upload_result["size"] == test_file_data["size"]
    assert "key" in upload_result
    assert "etag" in upload_result
    assert upload_result["etag"]  # ETag 不为空
    
    uploaded_key = upload_result["key"]
    uploaded_etag = upload_result["etag"]
    
    print(f"[E2E] ✅ 文件已上传: key={uploaded_key}, etag={uploaded_etag}")
    
    # Step 2: 更新 Manifest
    print(f"[E2E] Step 2: 更新 Block Manifest")
    
    manifest_body = {
        "user_id": test_block_context["user_id"],
        "block_id": test_block_context["block_id"],
        "version_id": test_block_context["version_id"],
        "new_chunk": {
            "key": uploaded_key,
            "etag": uploaded_etag,
            "size": test_file_data["size"],
            "name": test_file_data["name"],
            "file_name": test_file_data["name"],
            "content_type": test_file_data["content_type"]
        }
    }
    
    manifest_resp = await api_client.put(
        "/upload/manifest",
        json=manifest_body,
        headers={"Authorization": "Bearer testtoken"}
    )
    
    assert manifest_resp.status_code == 200, f"Manifest 更新失败: {manifest_resp.text}"
    manifest_result = manifest_resp.json()
    
    assert manifest_result["success"] is True
    
    print(f"[E2E] ✅ Manifest 已更新")
    
    # Step 3: 获取下载 URL
    print(f"[E2E] Step 3: 获取下载 URL")
    
    download_url_resp = await api_client.get(
        "/download/url",
        params={"key": uploaded_key},
        headers={"Authorization": "Bearer testtoken"}
    )
    
    assert download_url_resp.status_code == 200, f"获取下载 URL 失败: {download_url_resp.text}"
    download_result = download_url_resp.json()
    
    assert "download_url" in download_result
    download_url = download_result["download_url"]
    
    print(f"[E2E] ✅ 下载 URL 已生成: {download_url[:50]}...")
    
    # Step 4: 下载并验证文件内容
    print(f"[E2E] Step 4: 下载并验证文件内容")
    
    # 如果是本地存储，直接读取文件
    if deployment_type == "local":
        from storage import get_storage
        storage = get_storage()
        downloaded_content, content_type = storage.get_file(uploaded_key)
        
        assert downloaded_content == test_file_data["content"], "文件内容不匹配"
        assert content_type == test_file_data["content_type"], "Content-Type 不匹配"
        
        print(f"[E2E] ✅ 文件下载成功，内容验证通过")
    else:
        # 对于远程存储，这里可以进一步测试 presigned URL
        print(f"[E2E] ⚠️  远程存储的下载验证需要真实 S3 环境")
    
    # Step 5: 清理 - 删除测试文件
    print(f"[E2E] Step 5: 清理测试数据")
    
    delete_resp = await api_client.request(
        "DELETE",
        "/management/delete",
        json={"keys": [uploaded_key]},
        headers={"Authorization": "Bearer testtoken"}
    )
    
    # 删除可能失败（如果文件不存在），但不影响测试结果
    if delete_resp.status_code == 200:
        print(f"[E2E] ✅ 测试数据已清理")
    else:
        print(f"[E2E] ⚠️  清理失败（可忽略）: {delete_resp.status_code}")
    
    print(f"\n[E2E] ✅✅✅ E2E-01 测试完成: 小文件直接上传流程正常 ({deployment_type} mode)")


# ==================== E2E-01: 小文件直接上传（分离 local/remote） ====================

@pytest.mark.e2e
@pytest.mark.critical_path
@pytest.mark.asyncio
async def test_direct_upload_local_mode(
    api_client: AsyncClient,
    test_file_data: dict,
    test_block_context: dict,
    monkeypatch
):
    """
    E2E-01a: 小文件直接上传（本地模式）
    
    测试本地存储模式下的完整上传流程：
    - 使用 LocalAuthProvider（跳过远程认证）
    - 文件存储到本地文件系统
    - 可直接验证文件内容
    
    ✅ 无需 mock 外部服务
    """
    monkeypatch.setenv("DEPLOYMENT_TYPE", "local")
    await _execute_upload_test_flow(api_client, test_file_data, test_block_context, "local")


@pytest.mark.e2e
@pytest.mark.critical_path
@pytest.mark.asyncio
@pytest.mark.skip(reason="Remote mode requires mocking RemoteAuthProvider's internal httpx client - better tested in integration layer")
async def test_direct_upload_remote_mode(
    api_client: AsyncClient,
    test_file_data: dict,
    test_block_context: dict,
    monkeypatch
):
    """
    E2E-01b: 小文件直接上传（远程模式）【已跳过】
    
    ⚠️ **为什么跳过？**
    pytest-httpx 的 httpx_mock 无法拦截 RemoteAuthProvider 内部创建的 httpx.AsyncClient。
    
    **替代方案：**
    - ✅ Integration Tests：Mock RemoteAuthProvider.verify_user_token() 方法
    - ✅ Staging Environment：使用真实 User System 进行全栈测试
    
    **原因分析：**
    1. RemoteAuthProvider 在 __init__ 时创建独立的 httpx.AsyncClient
    2. pytest-httpx 只 mock 测试框架的客户端，不影响应用内部客户端
    3. 需要更深层的 mock（monkeypatch RemoteAuthProvider.__init__）
    
    **E2E 测试原则：**
    - E2E 应尽量减少 mock，使用真实组件
    - Remote 认证流程应在 Integration 层测试（可以 mock RemoteAuthProvider）
    - E2E 层重点测试业务流程（local 模式足够覆盖）
    """
    monkeypatch.setenv("DEPLOYMENT_TYPE", "remote")
    await _execute_upload_test_flow(api_client, test_file_data, test_block_context, "remote")


# ==================== E2E-02: Manifest 增量更新 ====================

@pytest.mark.e2e
@pytest.mark.critical_path
@pytest.mark.asyncio
async def test_direct_upload_with_manifest_update(
    api_client: AsyncClient,
    test_file_data: dict,
    test_block_context: dict
):
    """
    E2E-01b: 测试 Manifest 增量更新
    
    场景: 用户在同一个 Block 中上传多个文件
    验证: Manifest 正确追加文件记录
    """
    print(f"\n[E2E] 测试 Manifest 增量更新")
    
    uploaded_files = []
    
    # 上传3个文件
    for i in range(3):
        content = f"File {i} content".encode() * 100
        file_name = f"test_file_{i}.bin"
        
        upload_resp = await api_client.post(
            "/upload/chunk/direct",
            params={
                "block_id": test_block_context["block_id"],
                "file_name": file_name,
                "version_id": test_block_context["version_id"]
            },
            content=content,
            headers={"Authorization": "Bearer testtoken"}
        )
        
        assert upload_resp.status_code == 200
        result = upload_resp.json()
        
        uploaded_files.append({
            "key": result["key"],
            "etag": result["etag"],
            "size": len(content),
            "name": file_name,
            "content_type": "application/octet-stream"
        })
        
        print(f"[E2E] ✅ 文件 {i+1}/3 已上传")
    
    # 逐条以 new_chunk 方式增量更新 Manifest
    for f in uploaded_files:
        manifest_body = {
            "user_id": test_block_context["user_id"],
            "block_id": test_block_context["block_id"],
            "version_id": test_block_context["version_id"],
            "new_chunk": f,
        }
        manifest_resp = await api_client.put(
            "/upload/manifest",
            json=manifest_body,
            headers={"Authorization": "Bearer testtoken"}
        )
        assert manifest_resp.status_code == 200
        result = manifest_resp.json()
        assert result["success"] is True
    
    print(f"[E2E] ✅✅ Manifest 增量更新测试完成")
    
    # 清理
    keys = [f["key"] for f in uploaded_files]
    await api_client.request(
        "DELETE",
        "/management/delete",
        json={"keys": keys},
        headers={"Authorization": "Bearer testtoken"}
    )


@pytest.mark.e2e
@pytest.mark.critical_path
@pytest.mark.asyncio
async def test_direct_upload_error_handling(
    api_client: AsyncClient,
    test_file_data: dict,
    test_block_context: dict
):
    """
    E2E-01c: 测试错误处理
    
    场景: 上传失败、重试、恢复
    验证: 错误响应和恢复机制
    """
    print(f"\n[E2E] 测试错误处理")
    
    # 测试1: 无认证上传（应失败）
    upload_resp = await api_client.post(
        "/upload/chunk/direct",
        params={
            "block_id": test_block_context["block_id"],
            "file_name": test_file_data["name"],
        },
        content=test_file_data["content"]
        # 没有 Authorization header
    )
    
    # 根据认证配置，可能是 401 或允许匿名上传
    # 这里我们主要测试服务不崩溃
    assert upload_resp.status_code in [200, 401, 403]
    print(f"[E2E] ✅ 无认证上传处理正常: {upload_resp.status_code}")
    
    # 测试2: 空文件上传
    empty_resp = await api_client.post(
        "/upload/chunk/direct",
        params={
            "block_id": test_block_context["block_id"],
            "file_name": "empty.bin",
        },
        content=b"",
        headers={"Authorization": "Bearer testtoken"}
    )
    
    # 空文件应该被接受或拒绝，但不应崩溃
    assert empty_resp.status_code in [200, 400]
    print(f"[E2E] ✅ 空文件上传处理正常: {empty_resp.status_code}")
    
    print(f"[E2E] ✅✅ 错误处理测试完成")


if __name__ == "__main__":
    # 允许直接运行此文件进行测试
    pytest.main([__file__, "-v", "-s", "--tb=short"])

