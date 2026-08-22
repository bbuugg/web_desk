# linux_web

一个基于 Go 后端与 React (Vite + TypeScript) 前端的“桌面式”Web 项目。项目结构将后端服务放在 `server/`，前端应用放在 `web/`，并提供 Docker Compose 一键运行配置。

## 目录结构（简要）
- `server/`：Go 后端，包含 `main.go` 和 handler 实现。
- `web/`：前端代码（Vite + React + TypeScript）。
- `Dockerfile`, `docker-compose.yml`：容器与编排配置。

## 特性
- 可运行的 Go 后端用于文件/终端/监控等功能。
- 前端实现桌面式 UI，包含文件管理、文档/媒体预览、终端等应用组件。

## 先决条件
- Go 1.18+（建议使用最新版 Go）
- Node.js 18+（或兼容版本）
- pnpm（项目包含 `pnpm-lock.yaml`，推荐使用 `pnpm`）
- Docker & Docker Compose（可选，用于容器化部署）

## 本地开发 - 后端
1. 进入后端目录并运行：

```bash
cd server
go run .
```

2. 配置：后端使用 `linux_web_config.json`（位于 `server/`）作为默认配置，根据需要调整。

3. 运行测试：

```bash
cd server
go test ./...
```

## 本地开发 - 前端
1. 安装依赖并启动开发服务器：

```bash
cd web
pnpm install
pnpm dev
```

2. 构建生产包：

```bash
cd web
pnpm build
```

3. 代码位置示例：
- 前端入口：`web/src/main.tsx`
- 主要组件：`web/src/components/desktop/` 下的各类应用

## 使用 Docker (推荐用于快速体验)
项目根目录提供 `docker-compose.yml`，可以用一条命令构建并启动前后端服务：

```bash
docker-compose up --build
```

这会根据 `Dockerfile` 与 `docker-compose.yml` 中的设置构建镜像并启动容器。

## 构建与发布
- 后端构建：

```bash
cd server
go build -o bin/linux_web_server .
```

- 前端构建：`cd web && pnpm build`，将生成的静态文件放在 `web/dist/`（或由 Vite 配置的输出目录），可由后端静态托管或 Nginx 等反向代理提供服务。

## 配置与环境
- 后端默认配置文件：`server/linux_web_config.json`，可通过替换配置或环境变量来调整端口、路径、权限等。

## 开发提示
- 在修改前端依赖或锁文件后，优先使用 `pnpm install` 保持一致性。
- 后端有跨平台的 shell 实现：`shell_unix.go` 与 `shell_windows.go`，调试时请注意运行平台差异。

## 常见命令速查

```bash
# 启动后端（本机）
cd server && go run .

# 启动前端（本机）
cd web && pnpm install && pnpm dev

# 运行后端测试
cd server && go test ./...

# 使用 Docker Compose 一键运行
docker-compose up --build
```

## 贡献
欢迎提交 Issue 或 Pull Request。建议先在本地跑通 `pnpm dev` 和 `go run .`，并为新增功能添加对应的测试。

## 许可证
此仓库未包含明确许可证。请根据项目需求添加 `LICENSE` 文件（例如 MIT、Apache-2.0 等）。

## 联系
如需帮助，请在仓库 Issue 中描述复现步骤与期望行为。

https://gotenberg.dev/docs/getting-started/installation