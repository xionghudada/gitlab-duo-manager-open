# GitLab Duo Manager

GitLab Duo AI 代理网关，支持多 PAT 管理、负载均衡、流式代理与自动续传。

## 功能

- 多 GitLab PAT 管理（添加/删除/排序/启禁用/权重）
- 三种负载均衡（轮询 / 加权轮询 / 顺序降级）
- Token 自动刷新（60s 检查，<30min 过期自动刷新）
- 流式 Key 重试（多 Key 候选，逐个尝试直到成功）
- 失败计数 + 自动黑名单 + 后台自动恢复验证
- 批量导入 / 导出 PAT，文件内去重
- 多 Proxy API Key + 登录鉴权
- 流式 / 非流式代理转发
- `max_tokens_cap` 防截断（默认 4096，防止 GitLab ~93s 超时）
- 流式自动续传（可按 API Key 开关，聊天客户端开启 / Claude Code 关闭）
- tool_use 安全网（缓冲完整块，截断丢弃）
- 请求日志 + Per-Key 用量统计
- Docker 一键部署

## 快速部署

```bash
git clone <repo-url>
cd gitlab-duo-manager

# （可选）设置管理密码
cp backend/.env.example backend/.env
# 编辑 backend/.env 设置 ADMIN_PASSWORD

# 启动
docker compose up -d --build
```

服务启动后访问 `http://localhost:22341`。

> 如未设置 `ADMIN_PASSWORD`，启动时会自动生成并输出到控制台日志。

## 配置说明

### 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `ADMIN_PASSWORD` | 管理面板登录密码 | 自动生成 |

### 管理面板设置

| 设置 | 说明 | 默认值 |
|------|------|--------|
| 轮询模式 | round_robin / weighted_round_robin / ordered_fallback | weighted_round_robin |
| 最大重试 | 单次请求最大重试次数 | 2 |
| 黑名单阈值 | 连续失败几次自动黑名单 | 5 |
| 验证间隔 | 后台自动验证 Key 的间隔（分钟） | 5 |
| 自动续传次数 | 流式截断时最大续传轮数，0=禁用 | 3 |
| Token 上限 | 裁剪 max_tokens 防止 93s 超时，0=不限制 | 4096 |

### Proxy API Key 模式

每个 Proxy API Key 可独立设置 **续传 / 直通** 模式：

- **续传**（默认）：代理拦截 `max_tokens` 截断，自动续传。适用于 Cherry 等聊天客户端。
- **直通**：直接转发 `stop_reason: "max_tokens"` 给客户端，由客户端自行处理。适用于 Claude Code 等自带续传能力的客户端。

## 使用方式

1. 登录管理面板，添加 GitLab PAT
2. 创建 Proxy API Key，根据客户端类型设置续传模式
3. 客户端配置 API Base URL 为 `http://<host>:22341/v1`，API Key 为生成的 Proxy Key

## 技术栈

- **后端**：Python / FastAPI / httpx / uvicorn
- **前端**：React 19 / Vite 6 / TypeScript / Tailwind CSS v4
- **部署**：Docker 多阶段构建。
