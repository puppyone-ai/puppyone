"""
L2.5: Sync Cache 同步缓存层

把云端数据搬到本地，把本地改动搬回云端。
仅在 Folder 模式（L3-Folder）下需要。API/SDK 模式直接跳过此层。

主要组件：
- SyncWorker: PG/S3 → 本地 Lower 目录同步
- CacheManager: 本地缓存目录管理（元数据、增量标记、清理）

适用场景：
- CloudBot（我们自己的沙盒需要本地文件）
- Mac mini + OpenClaw（用户机器上跑 Daemon）
- Claude Code / Cursor（watch 本地文件夹）
- EC2 + OverlayFS（大规模 Agent 共享）

不适用场景：
- n8n / Manus / Lambda（走 API，不需要本地文件）
"""
