# Fly.io scope-sandbox 实环境验证(2026-06-13)

承接 `sandbox-validation-results-2026-06.md`(E2B 已实连)。本轮**首次在真实 Fly.io 上端到端跑通** scope-sandbox 的 Fly provider —— 用免费额度,不绑专用 IPv4。

## TL;DR

| 验证项 | 结果 |
|---|---|
| 远程构建 + 推镜像(`sandbox/scope-fly/`,无本地 Docker) | ✅ `registry.fly.io/puppyone-sandboxes:scope-sandbox`(75MB) |
| `FlyMachinesProvider` create → running | ✅ ~7s(镜像已缓存;首次 ~21s) |
| `exec`(Machines API,以 `puppy` 身份)| ✅ `whoami=puppy`、`git 2.47.3`、sshd 配置硬化 |
| 短期凭证 grant(tagged + `expiry-time="…Z"`) | ✅ 写入 `~/.ssh/authorized_keys` |
| revoke(删行) | ✅ |
| 生命周期 stop → stopped → start → running → destroy | ✅(stop 是**异步**,见下) |
| **SSH 实连**(经 `fly proxy` / WireGuard):grant→可连、revoke→拒 | ✅ **离职即失权** |
| 公网 TCP `:22` 直连 | ⛔ 未做(需付费专用 IPv4,见下) |

**结论:Fly provider 的代码 + 镜像 + 凭证治理全链路实环境通过(SSH 经 WireGuard 隧道)。** 唯一未覆盖的是公网 `:22` 入口(需付费 IPv4)。

## 环境

- App `puppyone-sandboxes`(personal org,免费额度);region **`sin`**(Singapore)。
- 机器 `shared-cpu-1x:512MB`,跑几分钟即销毁,成本在月度免费额度内。
- 配置写入 `backend/.env`:`SCOPE_SANDBOX_FLY_APP/IMAGE/TOKEN`(token 由 `fly tokens create deploy` 签发,gitignored)。
- 脚本:`backend/scripts/scope_sandbox_fly_smoke.py`(provider 全生命周期)、`backend/scripts/fly_ssh_e2e.py`(SSH 实连)。

## 为什么用 `fly proxy` 而不是公网 :22

公网 raw TCP `:22` 需要**专用 IPv4**(`fly ips allocate-v4`,~$3.60/mo,要绑支付)。本轮用免费路径:
- `fly proxy <local>:2222 <machine>.vm.<app>.internal` 经 **6PN/WireGuard** 把本地端口转发到机器内网 `:2222`,**免费**;
- `provider.exec` 走 Machines API,本就与公网无关 —— 与生产同一代码路径;
- 因此除「公网 :22 入口」外,create/exec/凭证/SSH 实连全部为真。

生产启用公网 SSH 时再 `fly ips allocate-v4`(provider 已按公网 22→内部 2222 写好 services 配置),其余不变。

## 踩坑 + 修复(本轮发现的真问题)

1. **`hkg` region 已废弃** —— Machines API create 返回 400 `Region hkg is deprecated… use sin`。改用 `sin`。(脚本默认 `sin`。)

2. **【真 bug,已修】镜像里 `puppy` 账号被锁,key 认证被拒。** 症状:SSH 完成握手但 `Permission denied (publickey)`,即使 key 已在 `authorized_keys`、权限完美(700/700/600 `puppy:puppy`)、sshd 配置正确。`fly logs` 揭示真因:**`User puppy not allowed because account is locked`**。
   - 根因:`useradd -m` 创建的账号 `/etc/shadow` 密码字段是 `!`(锁定);**OpenSSH 10**(镜像 Debian trixie 带 `OpenSSH_10.0p2`)在 `UsePAM no` 下**拒绝锁定账号的 key 认证**。
   - E2B 没踩到是因为 E2B 模板的 `user` 是正常未锁账号。
   - 修复:Dockerfile 加 `usermod -p '*' puppy` —— 密码哈希设为 `*`(非锁定、且无法密码登录;`PasswordAuthentication no` 本就关着),即「仅 key 登录」解锁。重建镜像后 SSH 实连通过。

3. **Fly `stop` 是异步的** —— `stop` 后机器经 `stopping`→`stopped`,立刻 `start` 会 412 `Precondition Failed`。manager 的 reap-stop 与下次 acquire-start 之间天然有间隔,生产不受影响;测试里轮询等 `stopped` 再 start 即可。(provider 未改;如需可在 `stop()` 里等 `stopped` 或让 `start()` 容忍 stopping,属后续硬化项。)

## 待办

- **公网 :22 实连**:绑支付 + `fly ips allocate-v4` 后跑一轮 `ssh puppy@<app>.fly.dev`(provider 的 `ConnectionInfo(host=<app>.fly.dev, port=22)` 即为此设计)。
- **VSCode Remote-SSH 全流程**:把 `fly proxy` 当 `ProxyCommand`(或公网 :22)在 VSCode 里实连一次。
- provider `stop/start` 异步硬化(可选)。
