
## v1.0.7 (2026-06-16)

### 规则补齐 (P0)
- DANGEROUS_COMMANDS: 8→28条
  - 新增 Linux 高危: fork bomb, mv /dev/null, dd写入磁盘
  - 新增 Windows 高危: rd /s /q, Remove-Item -Recurse, cipher /w
  - 新增 Docker 逃逸: run -v /:/host, --privileged, exec -it
  - 新增 数据库: DROP DATABASE/TABLE, TRUNCATE
  - 新增 网络外泄: nc -e, PowerShell Invoke-WebRequest
  - 新增 编码逃逸: base64 解码管道/内联
  - 新增 管道: bash 管道

- WARNING_COMMANDS: 6→18条
  - 新增 Git: push -f, commit --amend, rebase -i
  - 新增 包管理器: pip install, gem install, cargo install, go install

### 同步审计 (P0)
- auditWrite 改为 fs.appendFileSync 同步写入，防止重启/卸载时丢审计
- 删除异步缓冲区 auditBuffer/auditFlushTimer/auditFlush

### api.logger (P1)
- log()/warn() 优先用 api.logger.info/warn，降级到 console

### globMatch 占位符修复 (P2)
- §§ 占位符 → \x00 不可打印字符，避免文件名含§时的误匹配

### session_start 路径迁移 (P2)
- 可搜索索引 memory/agentos-episodic.md → .agentos/search-index.md

### 弹窗上下文提示
- before_prompt_build hook 捕获最近用户消息
- before_tool_call 弹窗显示 📋 最近任务

### 版本号清理
- 注释 v1.1.0 → v1.0.7
