# 轻量级 JSON 编辑沙盒
# 用于安全执行 Claude 返回的 CLI 命令

FROM alpine:3.19

# 安装必要工具
RUN apk add --no-cache \
    jq \
    bash \
    coreutils \
    sed \
    grep \
    && rm -rf /var/cache/apk/*

# 创建工作目录
WORKDIR /workspace

# 默认保持容器运行
CMD ["tail", "-f", "/dev/null"]

