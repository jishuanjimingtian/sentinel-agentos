// ── 安全性规则 ──
const hardcodedSecrets = {
    name: 'hardcoded-secrets',
    severity: 'error',
    check(line, lineNumber) {
        const patterns = [
            /(?:password|passwd|pwd|secret|api[_-]?key|token)\s*[:=]\s*['"][^'"]+['"]/i,
        ];
        if (patterns.some(p => p.test(line))) {
            return {
                severity: 'error',
                rule: this.name,
                message: '检测到疑似硬编码的密码/密钥，建议使用环境变量或密钥管理服务',
                line: lineNumber,
            };
        }
        return null;
    },
};
// ── 潜在 Bug ──
const consoleLog = {
    name: 'console-log-leftover',
    severity: 'warning',
    check(line, lineNumber) {
        if (/console\.(log|debug)\(/.test(line) && !/\/\/(\s*)?TODO/i.test(line)) {
            return {
                severity: 'warning',
                rule: this.name,
                message: '发现 console.log/debug，生产代码中建议移除或替换为日志库',
                line: lineNumber,
            };
        }
        return null;
    },
};
const todoComment = {
    name: 'todo-leftover',
    severity: 'info',
    check(line, lineNumber) {
        if (/\/\/\s*(TODO|FIXME|HACK|XXX)/i.test(line)) {
            return {
                severity: 'info',
                rule: this.name,
                message: '待办注释：' + line.trim(),
                line: lineNumber,
            };
        }
        return null;
    },
};
// ── 代码风格 ──
const longLine = {
    name: 'line-too-long',
    severity: 'warning',
    check(line, lineNumber) {
        if (line.length > 120) {
            return {
                severity: 'warning',
                rule: this.name,
                message: `行过长 (${line.length} 字符)，建议不超过 120 字符`,
                line: lineNumber,
            };
        }
        return null;
    },
};
const trailingWhitespace = {
    name: 'trailing-whitespace',
    severity: 'info',
    check(line, lineNumber) {
        if (line !== '' && /\s+$/.test(line)) {
            return {
                severity: 'info',
                rule: this.name,
                message: '行末有多余空格',
                line: lineNumber,
            };
        }
        return null;
    },
};
// ── TypeScript 安全 ──
const anyType = {
    name: 'no-explicit-any',
    severity: 'warning',
    check(line, lineNumber, ctx) {
        if (ctx.fileExtension === '.ts' || ctx.fileExtension === '.tsx') {
            if (/: any\b/.test(line) || /as any\b/.test(line)) {
                return {
                    severity: 'warning',
                    rule: this.name,
                    message: '避免使用 `any` 类型，建议使用更具体的类型',
                    line: lineNumber,
                };
            }
        }
        return null;
    },
};
// ── React Hooks 规范 ──
const hooksDeps = {
    name: 'react-hooks-deps',
    severity: 'warning',
    check(line, lineNumber, ctx) {
        const hooks = ['useEffect', 'useCallback', 'useMemo', 'useLayoutEffect'];
        const hookPattern = new RegExp(`\\b(${hooks.join('|')})\\(`);
        if (hookPattern.test(line) && !line.includes('}])')) {
            return {
                severity: 'warning',
                rule: this.name,
                message: `React Hook 调用可能缺少依赖数组，建议检查是否遗漏了闭包依赖`,
                line: lineNumber,
            };
        }
        return null;
    },
};
const hooksConditional = {
    name: 'react-hooks-conditional',
    severity: 'error',
    check(line, lineNumber, ctx) {
        const hooks = ['useEffect', 'useCallback', 'useMemo', 'useState', 'useRef', 'useContext', 'useReducer'];
        const hookPattern = new RegExp(`\\b(${hooks.join('|')})\\(`);
        // 检测 hooks 前面有 if/else/return 的情况
        if (hookPattern.test(line)) {
            const prevLines = ctx.lines.slice(Math.max(0, lineNumber - 3), lineNumber);
            let prevText = '';
            for (let i = prevLines.length - 1; i >= 0; i--) {
                const prev = prevLines[i].trim();
                if (prev === '')
                    continue;
                if (prev.startsWith('if (') || prev.startsWith('else ') || prev === '}') {
                    prevText = prev;
                }
                break;
            }
            if (/^(?:if|else|\})/.test(prevText)) {
                return {
                    severity: 'error',
                    rule: this.name,
                    message: `React Hook 不能在条件语句中调用，违反了 Hooks 规则`,
                    line: lineNumber,
                };
            }
        }
        return null;
    },
};
const useStateSetter = {
    name: 'react-setstate-direct',
    severity: 'warning',
    check(line, lineNumber, ctx) {
        // 检测直接修改 state 而非使用 setter
        if (/this\.state\.\w+\s*=/.test(line)) {
            return {
                severity: 'warning',
                rule: this.name,
                message: '不要直接修改 state，使用 this.setState() 或 useState setter 函数',
                line: lineNumber,
            };
        }
        return null;
    },
};
// ── 性能反模式 ──
const arraySpreadInRender = {
    name: 'perf-array-spread-render',
    severity: 'warning',
    check(line, lineNumber) {
        // 检测渲染路径中的数组展开/新对象创建
        if (/\[\.\.\.\w+\]/.test(line) || /\{[^}]*\.\.\.\w+[^}]*\}/.test(line)) {
            // 只在赋值/return 上下文中警告
            if (/=>\s*\[\.\.\./.test(line) || /return\s+\[\.\.\./.test(line) ||
                /=>\s*\{[^}]*\.\.\./.test(line) || /return\s+\{[^}]*\.\.\./.test(line)) {
                return {
                    severity: 'warning',
                    rule: this.name,
                    message: '渲染路径中每次都会创建新数组/对象，建议用 useMemo 缓存或提取为常量',
                    line: lineNumber,
                };
            }
        }
        return null;
    },
};
const syncXhr = {
    name: 'perf-sync-xhr',
    severity: 'error',
    check(line, lineNumber) {
        if (/XMLHttpRequest\.open\(['"]GET['"]/.test(line) && /false\)/i.test(line)) {
            return {
                severity: 'error',
                rule: this.name,
                message: '同步 XMLHttpRequest 会阻塞主线程，建议使用 fetch 或异步请求',
                line: lineNumber,
            };
        }
        if (/async:\s*false/.test(line)) {
            return {
                severity: 'error',
                rule: this.name,
                message: '同步 Ajax 请求已废弃，会严重阻塞用户体验',
                line: lineNumber,
            };
        }
        return null;
    },
};
const largeArrayLiteral = {
    name: 'perf-large-array-literal',
    severity: 'info',
    check(line, lineNumber) {
        // 检测超过20个元素的手写数组字面量
        const match = line.match(/^\s*(?:const|let|var)\s+\w+\s*=\s*\[([^\]]+)\]/);
        if (match) {
            const items = match[1].split(',');
            if (items.length > 20) {
                return {
                    severity: 'info',
                    rule: this.name,
                    message: `大数组字面量 (${items.length} 项)，考虑从 JSON/API 加载`,
                    line: lineNumber,
                };
            }
        }
        return null;
    },
};
// ── 安全漏洞 ──
const sqlInjection = {
    name: 'security-sql-injection',
    severity: 'error',
    check(line, lineNumber) {
        // 检测字符串拼接的 SQL 查询
        if (/(?:SELECT|INSERT|UPDATE|DELETE)\b.*\$\{/.test(line) ||
            /(?:SELECT|INSERT|UPDATE|DELETE)\b.*['"]\s*\+\s*\w+\./.test(line)) {
            return {
                severity: 'error',
                rule: this.name,
                message: '检测到字符串拼接 SQL 查询，存在 SQL 注入风险，请使用参数化查询或 ORM',
                line: lineNumber,
            };
        }
        return null;
    },
};
const xssDanger = {
    name: 'security-xss-unsafe',
    severity: 'error',
    check(line, lineNumber) {
        // 检测危险的 innerHTML / dangerouslySetInnerHTML
        if (/\.innerHTML\s*=/.test(line) && !/innerHTML\s*=\s*['"].*['"]$/.test(line)) {
            return {
                severity: 'error',
                rule: this.name,
                message: '使用 innerHTML 可能存在 XSS 风险，建议使用 textContent 或 sanitize 输入',
                line: lineNumber,
            };
        }
        if (/dangerouslySetInnerHTML/i.test(line)) {
            return {
                severity: 'error',
                rule: this.name,
                message: 'React dangerouslySetInnerHTML 存在 XSS 风险，请确保内容是可信的',
                line: lineNumber,
            };
        }
        return null;
    },
};
const evalUsage = {
    name: 'security-eval',
    severity: 'error',
    check(line, lineNumber) {
        if (/\beval\s*\(/.test(line) || /\bFunction\s*\(/.test(line)) {
            return {
                severity: 'error',
                rule: this.name,
                message: '避免使用 eval() / Function() 执行动态代码，存在严重安全风险',
                line: lineNumber,
            };
        }
        return null;
    },
};
const unvalidatedRedirect = {
    name: 'security-unvalidated-redirect',
    severity: 'warning',
    check(line, lineNumber) {
        // 检测未验证的重定向
        if (/(?:window\.)?location\s*=/.test(line) && !/location\s*=\s*['"].*['"]$/.test(line)) {
            return {
                severity: 'warning',
                rule: this.name,
                message: '动态 URL 重定向可能导致开放重定向安全漏洞，建议验证目标 URL',
                line: lineNumber,
            };
        }
        return null;
    },
};
const insecureProtocol = {
    name: 'security-insecure-protocol',
    severity: 'warning',
    check(line, lineNumber) {
        if (/(?:http|ws):\/\/(?!localhost\b|127\.0\.0\.1\b)/.test(line)) {
            return {
                severity: 'warning',
                rule: this.name,
                message: '检测到非 HTTPS/WSS 协议连接，生产中建议使用 HTTPS/WSS',
                line: lineNumber,
            };
        }
        return null;
    },
};
const looseComparison = {
    name: 'security-loose-comparison',
    severity: 'warning',
    check(line, lineNumber) {
        // 检测松散的 == null 比较
        if (/==\s*null/.test(line) || /null\s*==/.test(line)) {
            return null; // x == null 同时检查 null 和 undefined，可以
        }
        if (/\b\w+\s*==\s*(?:true|false|0|1|'|['"]\d+['"])/.test(line)) {
            return {
                severity: 'warning',
                rule: this.name,
                message: '建议使用 === 代替 == 以避免隐式类型转换导致的安全问题',
                line: lineNumber,
            };
        }
        return null;
    },
};
export const builtinRules = [
    hardcodedSecrets,
    consoleLog,
    todoComment,
    longLine,
    trailingWhitespace,
    anyType,
    // React Hooks
    hooksDeps,
    hooksConditional,
    useStateSetter,
    // 性能
    arraySpreadInRender,
    syncXhr,
    largeArrayLiteral,
    // 安全
    sqlInjection,
    xssDanger,
    evalUsage,
    unvalidatedRedirect,
    insecureProtocol,
    looseComparison,
];
//# sourceMappingURL=rules.js.map