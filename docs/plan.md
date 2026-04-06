## Plan: Node 上传接收服务落地

基于你当前 Flutter 客户端已实现的 ZIP 上传契约，推荐使用独立 Node.js 服务（Fastify）承接上传流量，首版只负责可靠接收、鉴权、落盘和可观测性；不做解压与后处理编排。这样能最快上线并与现有重试队列稳定对齐。

**Steps**
1. Phase 1 - 冻结客户端/服务端合同。对齐现有 Flutter 上传细节：`POST /api/v1/slam/upload`、`multipart/form-data` 字段（file/sessionName/sessionPath）、`X-Upload-Task-Id` 幂等头、2xx 判成功、4xx/5xx 错误分类。输出一页《上传接口合同》作为联调基线。
2. Phase 1 - 定义服务端错误码与状态映射（depends on 1）。明确 `401/403`（鉴权失败，不可重试）、`413`（文件过大，不可重试）、`429/5xx`（可重试），避免客户端重试策略失效。
3. Phase 1 - 定义配置模型（parallel with 2）。确定运行配置：监听端口、目标落盘根目录、单文件大小上限、允许的 token 列表或 JWT 密钥、日志级别、保留天数。
4. Phase 2 - 搭建独立 Node 服务骨架（depends on 1-3）。采用 Fastify + multipart 流式接收，增加 `GET /healthz` 健康检查，统一错误处理与请求日志中间件。
5. Phase 2 - 实现上传入口（depends on 4）。上传流写入临时文件（staging），写入完成后原子移动到目标目录（final），目录建议按日期与会话名分层：`<root>/YYYY-MM-DD/<sessionName>/`；保存 `*.zip` 文件名包含 taskId 以便排障。
6. Phase 2 - 实现 Token 鉴权（depends on 4, parallel with 5）。增加鉴权中间件，优先支持 `Authorization: Bearer <token>`；兼容自定义头作为过渡方案。未通过时直接返回 401。
7. Phase 2 - 实现幂等处理（depends on 5-6）。用 `X-Upload-Task-Id` 做去重键，重复请求返回已处理结果，防止客户端重试导致重复落盘。
8. Phase 3 - 增加上传内容安全防护（depends on 5）。限制 MIME 与扩展名为 ZIP、限制最大文件大小、拒绝空文件、拒绝异常 `sessionName`（防路径穿越），并校验磁盘剩余空间阈值。
9. Phase 3 - 增加可观测性与运维（depends on 5-8）。输出结构化日志（taskId/sessionName/size/duration/result），暴露基础指标（成功率、失败率、95 分位耗时、磁盘占用），增加按保留期清理历史 ZIP 的定时任务。
10. Phase 4 - 客户端联调（depends on 2,5,6,7）。将 Flutter 配置指向新服务地址与路径，注入鉴权 header，完成真机端到端上传验证与失败场景验证。
11. Phase 4 - 灰度上线与回滚预案（depends on 10）。先在测试环境压测与稳定性验证，再灰度到生产；预设回滚策略（切回旧地址或暂停自动上传）。

**Relevant files**
- `d:/AndroidStudioProjects/spatial_data_recorder/lib/core/upload/services/upload_http_client.dart` — 客户端真实上传合同来源（multipart 字段、header、错误映射）。
- `d:/AndroidStudioProjects/spatial_data_recorder/lib/core/upload/upload_config.dart` — 对接新服务时需要替换的 baseUrl/uploadPath 与超时策略。
- `d:/AndroidStudioProjects/spatial_data_recorder/lib/core/upload/controller/upload_queue_controller.dart` — 客户端重试与状态机行为，服务端错误码需与其重试语义对齐。
- `d:/AndroidStudioProjects/spatial_data_recorder/docs/P3_upload_architecture.md` — P3 上传架构文档，服务端接入约束与边界。
- 独立 Node 服务仓库（待新建） — 实现 upload route、鉴权、幂等、落盘与运维逻辑。

**Verification**
1. 合同验证：用 curl/Postman 构造 multipart 请求，验证字段缺失时返回 400，鉴权失败返回 401。
2. 成功路径：上传 1 个真实会话 ZIP，返回 2xx，目标目录存在文件且大小与请求一致。
3. 幂等验证：使用同一个 `X-Upload-Task-Id` 重复上传，服务端不重复落盘且返回幂等命中结果。
4. 重试语义验证：模拟 429/500，Flutter 端进入 retrying；模拟 401/403，Flutter 端立即 failed 且不重试。
5. 稳定性验证：并发上传（例如 5-20 并发）与大文件上传（接近上限）下服务不崩溃，耗时在可接受范围。
6. 运维验证：磁盘空间不足、目标目录无权限、服务重启后上传功能恢复正常且日志可追溯 taskId。

**Decisions**
- 已确认：采用独立 Node.js 上传服务，而非并入现有 BFF。
- 已确认：首版仅落盘 ZIP，不自动解压。
- 已确认：首版即启用 Token 鉴权。
- 范围内：上传接收、鉴权、幂等、落盘、日志与基础运维。
- 范围外：分片上传、断点续传、后台任务调度、对象存储归档、服务端深度解析 ZIP 内容。

**Further Considerations**
1. Token 管理方案：固定静态 token（上线快）或 JWT（可扩展），推荐先静态 token + 定期轮换。
2. 存储演进：本地磁盘稳定后可平滑迁移到对象存储（S3/OSS/COS），保留当前接口不变。
3. 后处理解耦：后续若要自动解压与质检，建议通过消息队列异步消费，避免阻塞上传接口。