# data_recorder_backend

Node.js 上传接收服务（Fastify），用于接收 iOS/Flutter 端上传的 SLAM ZIP 文件并落盘。

## 功能清单

- `POST /api/v1/slam/upload` 接收 `multipart/form-data` 上传
- Token 鉴权（Bearer + 兼容自定义头）
- 基于 `X-Upload-Task-Id` 的幂等处理
- 流式写入临时文件并原子落盘，避免半文件
- 落盘到 `${UPLOAD_ROOT_DIR}/${DATASET_CAPTURE_NAME}/${DATASET_SCENE_NAME}/${DATASET_SEQ_NAME}`
- 单机位自动复制为双份 ZIP（`xxx.zip` 与 `xxx(1).zip`）
- 自动从 ZIP 抽取 `calibration.json/data.jsonl/data.mov/metadata.json`（忽略 `data2.mov`）
- 上传大小限制、MIME/扩展名校验、磁盘余量保护
- `GET /healthz` 健康检查
- `GET /metrics` 基础运行指标
- 定时清理过期 ZIP（按保留天数）

## 环境要求

- Node.js >= 20
- Linux/Windows/macOS 均可运行

## 本地启动

1. 安装依赖

```bash
npm install
```

2. 配置环境变量

```bash
cp .env.example .env
# 按需修改 AUTH_TOKENS、UPLOAD_ROOT_DIR 等
```

Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

3. 运行服务

```bash
npm run dev
# 或生产方式
npm start
```

## 快速验证

健康检查：

```bash
curl http://127.0.0.1:8080/healthz
```

上传测试：

```bash
curl -X POST "http://127.0.0.1:8080/api/v1/slam/upload" \
  -H "Authorization: Bearer replace_with_secure_token_1" \
  -H "X-Upload-Task-Id: test-task-001" \
  -F "file=@./sample.zip" \
  -F "sessionName=recording_2026-04-06_21-10-05" \
  -F "sessionPath=/var/mobile/Containers/.../output/recording_2026-04-06_21-10-05"
```

## 与 Flutter 对接

在 Flutter 端配置：

- `baseUrl`：指向本服务地址，例如 `http://your-server-ip:8080`
- `uploadPath`：`/api/v1/slam/upload`
- `extraHeaders`：注入 `Authorization: Bearer <token>`

## 文档

- 上传接口合同：[docs/upload-api-contract.md](docs/upload-api-contract.md)
- 远程部署说明：[docs/deploy-server.md](docs/deploy-server.md)
- 项目计划：[docs/plan.md](docs/plan.md)
