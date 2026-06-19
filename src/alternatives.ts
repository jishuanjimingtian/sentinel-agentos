/**
 * Alternatives Library — 拦截时的替代方案建议
 *
 * 当操作被拦截或需要确认时，提供可替代的安全方案。
 */

export interface Alternative {
  /** 匹配的规则描述 */
  ruleKey: string;
  /** 安全替代方案描述 */
  suggestion: string;
  /** 替代操作的例子 */
  example?: string;
}

const ALTERNATIVES: Alternative[] = [
  // === 危险命令类 ===
  { ruleKey: 'rm-rf-root', suggestion: '使用精确路径删除，避免 rm -rf /', example: 'rm -rf ./temp-files/' },
  { ruleKey: 'rm-rf-home', suggestion: '删除用户目录前请确认，考虑使用回收站', example: '将文件移到回收站目录' },
  { ruleKey: 'sudo-rm-rf', suggestion: '避免 sudo rm -rf，使用 sudo rm 精确路径', example: 'sudo rm ./specific-file' },
  { ruleKey: 'mkfs-command', suggestion: '格式化磁盘前请确认目标设备是否正确', example: 'lsblk 确认设备后执行' },
  { ruleKey: 'dd-danger', suggestion: 'dd 操作不可逆，请确认 if/of 参数正确', example: '使用 rsync 代替 dd 做备份' },
  { ruleKey: 'chmod-777-R', suggestion: 'chmod 777 -R 可能泄露权限，使用更精确的权限', example: 'chmod 755 file 或 chmod 644 file' },
  { ruleKey: 'drop-database', suggestion: '删除数据库前请确认环境，推荐先备份', example: 'mysqldump dbname > backup.sql' },

  // === Git 操作类 ===
  { ruleKey: 'git-push-force', suggestion: 'git push --force 会覆盖远程历史，推荐 --force-with-lease', example: 'git push --force-with-lease origin main' },
  { ruleKey: 'git-reset-hard', suggestion: 'git reset --hard 会丢失未提交更改，推荐先 git stash', example: 'git stash && git reset --hard HEAD~1' },

  // === npm 操作类 ===
  { ruleKey: 'npm-unpublish', suggestion: 'npm unpublish 有时间窗口限制且不可逆，考虑 npm deprecate', example: 'npm deprecate package-name "消息"' },
  { ruleKey: 'npm-publish', suggestion: '发布前请确认版本号和 CHANGELOG 已更新', example: 'npm version patch && npm publish' },

  // === 文件操作类 ===
  { ruleKey: 'write-sensitive', suggestion: '操作敏感文件（如 .env）请确认内容正确', example: '先 read 确认当前内容再做修改' },
  { ruleKey: 'delete-protected', suggestion: '删除受保护文件前请确认备份', example: '先复制到临时目录再删除' },
  { ruleKey: 'overwrite-config', suggestion: '修改系统配置前请备份原文件', example: 'cp file.json file.json.bak 后再修改' },

  // === 系统配置类 ===
  { ruleKey: 'modify-openclaw-config', suggestion: '修改 openclaw.json 前请备份并确认语法正确', example: '先 cp openclaw.json openclaw.json.bak' },
  { ruleKey: 'exec-dangerous', suggestion: '执行系统命令前请确认命令和参数安全', example: '先用 echo 预览命令效果' },
];

/**
 * 根据规则 key 查找替代方案。
 */
export function findAlternative(ruleKey: string): Alternative | undefined {
  return ALTERNATIVES.find((a) => a.ruleKey === ruleKey);
}

/**
 * 根据规则 key 前缀查找替代方案。
 */
export function findAlternativesByPrefix(prefix: string): Alternative[] {
  return ALTERNATIVES.filter((a) => a.ruleKey.startsWith(prefix));
}

/**
 * 获取所有替代方案。
 */
export function getAllAlternatives(): Alternative[] {
  return [...ALTERNATIVES];
}
