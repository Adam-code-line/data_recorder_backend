# 远程服务器部署指南（Node.js）

本文以 Ubuntu 22.04 为例，演示如何把服务部署到远程服务器长期运行。

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
sudo mkdir -p data_recorder_backend
sudo chown -R $USER:$USER /srv/data_recorder_backend
cd /srv/data_recorder_backend

git clone <你的仓库地址> .
npm ci
```

## 3. 配置环境变量

```bash
cp .env.example .env
nano .env
```

建议重点修改：

- `AUTH_TOKENS`：换成高强度随机 token
- `UPLOAD_ROOT_DIR`：例如 `/srv/data-recorder/uploads`
- `IDEMPOTENCY_FILE_PATH`：例如 `/srv/data-recorder/idempotency-store.json`
- `PORT`：例如 `8080`
- `MAX_FILE_SIZE_MB`：按实际 ZIP 大小配置
- `DISK_FREE_THRESHOLD_MB`：保留安全空间

创建存储目录：

```bash
sudo mkdir -p /srv/data-recorder/uploads
sudo mkdir -p /srv/data-recorder
sudo chown -R $USER:$USER /srv/data-recorder
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
