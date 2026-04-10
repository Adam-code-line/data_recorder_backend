# 上传接口合同（Flutter 对接基线）

本合同与客户端当前实现保持一致：

- 请求方法：`POST`
- 路径：`/api/v1/slam/upload`
- Content-Type：`multipart/form-data`
- 成功判定：HTTP `2xx`

## 1. 请求头

- `Authorization: Bearer <token>`（推荐）
- `X-Upload-Task-Id: <taskId>`（必需，幂等键）
- 兼容过渡头：`x-upload-token: <token>`（可选）

## 2. Form 字段

- `file`：ZIP 文件（必需）
- `sessionName`：会话目录名（必需）
- `sessionPath`：客户端会话绝对路径（可选）
- `captureName`：数据集一级目录（可选，默认来自服务端 `DATASET_CAPTURE_NAME`）
- `sceneName`：场景目录（可选，默认来自服务端 `DATASET_SCENE_NAME`）
- `seqName`：序列目录（可选，默认来自服务端 `DATASET_SEQ_NAME`）

## 3. 成功响应（示例）

```json
{
  "code": 0,
  "message": "Upload succeeded.",
  "data": {
    "taskId": "e8b2adf3-3440-4bc0-8564-3d4ca8a1f7d4",
    "sessionName": "recording_2026-04-06_21-10-05",
    "sessionPath": "/var/mobile/...",
    "captureName": "my_capture",
    "sceneName": "livingroom1",
    "seqName": "seq0",
    "fileName": "recording_2026-04-06_21-10-05.zip",
    "mirrorFileName": "recording_2026-04-06_21-10-05(1).zip",
    "storedPath": "/home/wubin/EmbodMocap_dev/datasets/my_capture/livingroom1/seq0/recording_2026-04-06_21-10-05.zip",
    "mirrorStoredPath": "/home/wubin/EmbodMocap_dev/datasets/my_capture/livingroom1/seq0/recording_2026-04-06_21-10-05(1).zip",
    "sceneDir": "/home/wubin/EmbodMocap_dev/datasets/my_capture/livingroom1",
    "extractedSceneFiles": [
      "calibration.json",
      "data.jsonl",
      "data.mov",
      "metadata.json"
    ],
    "uploadedBytes": 20345123,
    "mimeType": "application/octet-stream",
    "originalFileName": "recording_2026-04-06_21-10-05.zip",
    "uploadedAt": "2026-04-06T13:20:16.002Z",
    "idempotent": false,
    "durationMs": 921
  }
}
```

幂等命中（同一个 `X-Upload-Task-Id` 再次请求）也返回 `200`，`data.idempotent=true`。

## 4. 错误响应（统一结构）

```json
{
  "code": -1,
  "message": "鉴权失败。",
  "errorCode": "UNAUTHORIZED",
  "retryable": false
}
```

## 5. 状态码与客户端重试语义

- `400`：参数错误 / 文件字段错误 / 非 ZIP（不可重试）
- `401/403`：鉴权失败（不可重试）
- `409`：同 taskId 正在处理中（可重试）
- `413`：文件超限（不可重试）
- `429`：服务限流（可重试）
- `500+`：服务异常（可重试）
- `507`：磁盘空间不足（可重试）

这与 Flutter 端分类语义一致：`429/5xx/超时/网络` 可重试，`401/403/其他4xx` 默认不重试。
