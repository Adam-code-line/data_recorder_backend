# 远程服务器部署指南（Node.js）

本文以 Ubuntu 22.04 为例，演示如何把服务部署到远程服务器长期运行。

## 0. 快速更新重部署

适用于已经部署过后端、当前只想拉最新代码并重新启动服务的场景。

### 0.1 PM2 快速指令

直接复制执行：

```bash
ssh <你的服务器>
cd /srv/data_recorder_backend

# 1) 备份当前环境变量
cp .env .env.bak-$(date +%F-%H%M%S)

# 2) 拉取最新代码
git fetch origin
git checkout main
git pull --ff-only origin main

# 3) 安装依赖
if [ -f package-lock.json ]; then npm ci; else npm install; fi

# 4) 可选：先做语法检查
node --check src/app.js
node --check src/routes/upload.js
node --check src/storage.js

# 5) 重启服务并刷新环境变量
pm2 restart data-recorder-backend --update-env
pm2 save

# 6) 查看状态与最近日志
pm2 status
pm2 logs data-recorder-backend --lines 200
```

### 0.2 systemd 快速指令

如果你不是用 PM2，而是用 `systemd` 托管：

```bash
ssh <你的服务器>
cd /srv/data_recorder_backend

# 1) 备份当前环境变量
cp .env .env.bak-$(date +%F-%H%M%S)

# 2) 拉取最新代码
git fetch origin
git checkout main
git pull --ff-only origin main

# 3) 安装依赖
if [ -f package-lock.json ]; then npm ci; else npm install; fi

# 4) 可选：先做语法检查
node --check src/app.js
node --check src/routes/upload.js
node --check src/storage.js

# 5) 重启服务
sudo systemctl restart data-recorder-backend

# 6) 查看状态与最近日志
sudo systemctl status data-recorder-backend --no-pager
journalctl -u data-recorder-backend -n 200 --no-pager
```

### 0.3 更新后快速验证

```bash
# 健康检查
curl http://127.0.0.1:8080/healthz

# 查看 PM2 日志
pm2 logs data-recorder-backend --lines 50

# 或查看 systemd 日志
journalctl -u data-recorder-backend -n 50 --no-pager
```

如果这次更新涉及上传协议，建议再补一个最小上传验证：

```bash
curl -X POST "http://127.0.0.1:8080/api/v1/slam/upload" \
  -H "Authorization: Bearer <你的token>" \
  -H "X-Upload-Task-Id: redeploy-check-001" \
  -F "file=@/tmp/test.zip" \
  -F "sessionName=recording_2026-04-06_21-10-05" \
  -F "captureType=scene_only" \
  -F "sceneName=scene_redeploy_check" \
  -F "seqName=seq_redeploy_check" \
  -F "pairGroupId=group_redeploy_check" \
  -F "audioTrackPresent=false"
```

### 0.4 最常用的一行版

如果你已经确认 `.env` 没问题，且服务由 PM2 管理，最常用的一套就是：

```bash
cd /srv/data_recorder_backend && git fetch origin && git checkout main && git pull --ff-only origin main && (if [ -f package-lock.json ]; then npm ci; else npm install; fi) && pm2 restart data-recorder-backend --update-env && pm2 save && pm2 logs data-recorder-backend --lines 100
```

## 1. 服务器准备

更新系统：

```bash
sudo apt update
sudo apt upgrade -y
```

安装 Node.js 20（NodeSource）：

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs git
node -v
npm -v
```

## 2. 拉取代码并安装依赖

```bash
cd /srv
sudo install -d -o $USER -g $USER /srv/data_recorder_backend
git clone <你的仓库地址> /srv/data_recorder_backend
cd /srv/data_recorder_backend

# 有 package-lock.json 用 npm ci；否则用 npm install
if [ -f package-lock.json ]; then npm ci; else npm install; fi
```

说明：

- 这里直接把仓库 clone 到 `/srv/data_recorder_backend`，避免出现
  `/srv/data_recorder_backend/data_recorder_backend` 的嵌套目录。
- 如果你没有 `/srv` 的权限，可改为在家目录部署：
  `git clone <你的仓库地址> ~/data_recorder_backend`

## 3. 配置环境变量

```bash
cp .env.example .env
nano .env
```

建议重点修改：

- `AUTH_TOKENS`：自用可先用单 token（示例：`slam-self-use-token`），并与 Flutter 端保持一致
- `UPLOAD_ROOT_DIR`：例如 `/home/wubin/EmbodMocap_dev/datasets`
- `IDEMPOTENCY_FILE_PATH`：例如 `/home/wubin/EmbodMocap_dev/datasets/idempotency-store.json`
- `DATASET_CAPTURE_NAME`：例如 `my_capture`
- `DATASET_SCENE_NAME`：例如 `scene`（作为场景名前缀，最终会自动生成 `scene_YYYYMMDD_HHMMSS`）
- `DATASET_SEQ_NAME`：例如 `seq0`
- `PORT`：例如 `8080`
- `MAX_FILE_SIZE_MB`：按实际 ZIP 大小配置
- `DISK_FREE_THRESHOLD_MB`：保留安全空间

关键说明（避免落盘到错误目录）：

- `UPLOAD_ROOT_DIR` 和 `IDEMPOTENCY_FILE_PATH` 请使用绝对路径。
- 若写成相对路径（例如 `./data/uploads`），后端会按服务进程当前工作目录解析，通常会变成 `/srv/data_recorder_backend/data/uploads`。
- 因此你看到“文件上传到 `/srv/data_recorder_backend/data/uploads`”通常是 `.env` 里仍是相对路径导致。

如果你的 `.env` 已经存在相对路径，可直接执行以下修正命令：

```bash
cd /srv/data_recorder_backend
cp .env .env.bak-$(date +%F-%H%M%S)

sed -i 's|^UPLOAD_ROOT_DIR=.*|UPLOAD_ROOT_DIR=/home/wubin/EmbodMocap_dev/datasets|' .env
sed -i 's|^IDEMPOTENCY_FILE_PATH=.*|IDEMPOTENCY_FILE_PATH=/home/wubin/EmbodMocap_dev/datasets/idempotency-store.json|' .env

grep -E 'UPLOAD_ROOT_DIR|IDEMPOTENCY_FILE_PATH|DATASET_CAPTURE_NAME|DATASET_SCENE_NAME|DATASET_SEQ_NAME' .env
```

创建存储目录：

```bash
sudo mkdir -p /home/wubin/EmbodMocap_dev/datasets/my_capture
sudo chown -R $USER:$USER /home/wubin/EmbodMocap_dev/datasets
```

## 4. 启动方式 A：PM2（推荐）

安装 PM2：

```bash
npm install -g pm2
```

启动服务：

```bash
cd /srv/data_recorder_backend
pm2 start src/server.js --name data-recorder-backend
pm2 save
pm2 startup
```

查看日志：

```bash
pm2 logs data-recorder-backend --lines 200
```

查看状态：

```bash
pm2 status
```

## 5. 启动方式 B：systemd（可替代 PM2）

创建服务文件：

```bash
sudo nano /etc/systemd/system/data-recorder-backend.service
```

写入：

```ini
[Unit]
Description=Data Recorder Upload Backend
After=network.target

[Service]
Type=simple
WorkingDirectory=/srv/data_recorder_backend
ExecStart=/usr/bin/node /srv/data_recorder_backend/src/server.js
Restart=always
RestartSec=3
Environment=NODE_ENV=production
EnvironmentFile=/srv/data_recorder_backend/.env
User=<你的用户名>
Group=<你的用户名>

[Install]
WantedBy=multi-user.target
```

启用并启动：

```bash
sudo systemctl daemon-reload
sudo systemctl enable data-recorder-backend
sudo systemctl start data-recorder-backend
sudo systemctl status data-recorder-backend
```

查看日志：

```bash
journalctl -u data-recorder-backend -f
```

## 6. 防火墙与反向代理

放行端口（示例 8080）：

```bash
sudo ufw allow 8080/tcp
sudo ufw status
```

生产建议：

- 用 Nginx/Caddy 做 HTTPS 终止
- 上传接口加 IP 白名单
- 配置请求体大小上限（与后端保持一致）

## 7. 上线后验证

健康检查：

```bash
curl http://127.0.0.1:8080/healthz
```

上传接口：

```bash
curl -X POST "http://127.0.0.1:8080/api/v1/slam/upload" \
  -H "Authorization: Bearer <你的token>" \
  -H "X-Upload-Task-Id: deploy-check-001" \
  -F "file=@/tmp/test.zip" \
  -F "sessionName=recording_2026-04-06_21-10-05"
```

上传成功后会生成如下结构：

```text
/home/wubin/EmbodMocap_dev/datasets/
└── my_capture/
  └── scene_20260410_132011/
    ├── calibration.json        # 若 ZIP 中包含则会抽取
    ├── data.jsonl              # 若 ZIP 中包含则会抽取
    ├── data.mov                # 若 ZIP 中包含则会抽取
    ├── metadata.json           # 若 ZIP 中包含则会抽取
    ├── upload_context.json     # 若 ZIP 中包含则会抽取
    ├── frames2/                # 若 ZIP 中包含则会抽取
    └── seq0/
      └── recording_2026-04-06_21-10-05.zip
```

## 8. Flutter 对接要点

在 Flutter 上传配置中：

- `baseUrl` 改为服务器地址，例如 `http://<公网IP>:8080`
- `uploadPath` 保持 `/api/v1/slam/upload`
- `extraHeaders` 增加 `Authorization: Bearer <token>`

## 9. 常见问题

1. `401 Unauthorized`

- 检查 `AUTH_TOKENS` 与请求头是否一致
- 确认请求头为 `Authorization: Bearer <token>`

2. `413 FILE_TOO_LARGE`

- 提高 `.env` 中 `MAX_FILE_SIZE_MB`
- 同步调整 Nginx `client_max_body_size`

3. `507 INSUFFICIENT_STORAGE`

- 清理磁盘空间
- 降低 `DISK_FREE_THRESHOLD_MB`

4. 服务重启后幂等失效

- 确认 `IDEMPOTENCY_FILE_PATH` 指向持久化目录
- 确认进程用户对该路径有读写权限

5. 目录出现嵌套（`.../data_recorder_backend/data_recorder_backend`）

- 重新清理并按第 2 节命令拉取：

```bash
cd /srv
sudo rm -rf /srv/data_recorder_backend
sudo install -d -o $USER -g $USER /srv/data_recorder_backend
git clone <你的仓库地址> /srv/data_recorder_backend
cd /srv/data_recorder_backend
```

## 10. PM2 更新部署（拉取最新代码）

你当前使用 PM2 管理服务，建议按以下固定流程更新：

```bash
ssh <你的服务器>
cd /srv/data_recorder_backend

# 1) 备份当前环境变量（建议）
cp .env .env.bak-$(date +%F-%H%M%S)

# 1.1) 确认/修正为绝对路径（避免落盘到 /srv/data_recorder_backend/data/uploads）
sed -i 's|^UPLOAD_ROOT_DIR=.*|UPLOAD_ROOT_DIR=/home/wubin/EmbodMocap_dev/datasets|' .env
sed -i 's|^IDEMPOTENCY_FILE_PATH=.*|IDEMPOTENCY_FILE_PATH=/home/wubin/EmbodMocap_dev/datasets/idempotency-store.json|' .env

# 2) 拉取最新代码（以 main 分支为例）
git fetch origin
git checkout main
git pull --ff-only origin main

# 3) 安装依赖
if [ -f package-lock.json ]; then npm ci; else npm install; fi

# 4) 重启 PM2 进程并刷新环境变量
pm2 restart data-recorder-backend --update-env
pm2 save

# 5) 检查状态与日志
pm2 status
pm2 logs data-recorder-backend --lines 200

# 6) 确认运行时读取到的路径
grep -E 'UPLOAD_ROOT_DIR|IDEMPOTENCY_FILE_PATH' .env
```

重点检查日志里的启动参数：

- `uploadRootDir` 应为 `/home/wubin/EmbodMocap_dev/datasets`
- `datasetCaptureName / datasetSceneName / datasetSeqName` 应符合你的期望

另外建议确认当前确实只有 PM2 在管理该服务，避免和 systemd 重复启动：

```bash
pm2 status
sudo systemctl status data-recorder-backend --no-pager
```
