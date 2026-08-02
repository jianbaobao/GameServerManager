// ============================================================
// 插件安全审计模块
// 扫描插件文件中的恶意代码模式，防止第三方插件包含病毒/木马
// ============================================================
import { promises as fs } from 'fs'
import path from 'path'
import winston from 'winston'

export interface AuditFinding {
  severity: 'high' | 'medium' | 'low'
  pattern: string
  description: string
  file: string
  line?: number
  snippet?: string
}

export interface AuditResult {
  safe: boolean
  score: number          // 0-100，越高越安全
  findings: AuditFinding[]
  summary: string
}

// 高风险模式：直接威胁
const HIGH_RISK_PATTERNS: Array<{ regex: RegExp; description: string }> = [
  { regex: /eval\s*\(/i, description: '使用 eval() 动态执行代码，可能执行恶意脚本' },
  { regex: /new\s+Function\s*\(/i, description: '使用 new Function 动态构造函数' },
  { regex: /document\.cookie/i, description: '读取浏览器 Cookie，可能窃取登录凭证' },
  { regex: /child_process/i, description: '引用 Node.js 子进程模块（后端代码）' },
  { regex: /require\s*\(\s*['"](?:fs|net|http|https|child_process|os|path)['"]\s*\)/i, description: '加载敏感 Node.js 模块' },
  { regex: /process\.(?:env|mainModule|binding)/i, description: '访问进程环境变量/内部对象' },
  { regex: /atob\s*\(\s*['"][A-Za-z0-9+/=]{50,}/i, description: '大量 base64 编码内容，疑似混淆恶意代码' },
  { regex: /<script[^>]*\bsrc\s*=\s*["']https?:\/\/(?!.*(?:unpkg|cdn\.jsdelivr|cdnjs|code\.jquery|bootcdn|staticfile|unpkg\.com))[^"']+/i, description: '加载外部未知域名脚本' },
  { regex: /fetch\s*\(\s*["']https?:\/\/(?!.*(?:steam|steampowered|steamstatic|steamcommunity|xiaozhuhouses|localhost|127\.0\.0\.1))/i, description: '请求未知外部域名' },
]

// 中风险模式：可疑但可能合法
const MEDIUM_RISK_PATTERNS: Array<{ regex: RegExp; description: string }> = [
  { regex: /localStorage|sessionStorage/i, description: '访问本地存储（可能读取 token）' },
  { regex: /XMLHttpRequest|fetch\s*\(/i, description: '发起网络请求' },
  { regex: /onerror\s*=|onload\s*=|onclick\s*=/i, description: '内联事件处理器' },
  { regex: /window\.(?:parent|top)\b/i, description: '访问父窗口（跨 iframe 操作）' },
  { regex: /document\.(?:write|writeln)/i, description: '动态写入文档内容' },
  { regex: /WebSocket\s*\(/i, description: '建立 WebSocket 连接' },
  { regex: /indexedDB|openDatabase/i, description: '访问浏览器数据库' },
  { regex: /\.innerHTML\s*=\s*['"`]/i, description: '直接设置 innerHTML（XSS 风险）' },
]

// 低风险模式：信息收集
const LOW_RISK_PATTERNS: Array<{ regex: RegExp; description: string }> = [
  { regex: /navigator\.(?:userAgent|platform)/i, description: '读取浏览器信息' },
  { regex: /screen\.(?:width|height)/i, description: '读取屏幕信息' },
  { regex: /performance\./i, description: '读取性能数据' },
]

const MAX_FILE_SIZE = 2 * 1024 * 1024 // 单文件最大 2MB

export class PluginSecurityAudit {
  private logger: winston.Logger

  constructor(logger: winston.Logger) {
    this.logger = logger
  }

  /**
   * 审计插件目录
   * @param pluginDir 插件目录
   * @returns 审计结果
   */
  async auditPlugin(pluginDir: string): Promise<AuditResult> {
    const findings: AuditFinding[] = []
    let scannedFiles = 0
    let totalSize = 0

    try {
      const files = await this.collectFiles(pluginDir)
      for (const file of files) {
        const relPath = path.relative(pluginDir, file)
        // 只审计文本文件
        if (!/\.(html?|js|mjs|cjs|css|json|ts|py|sh|bat|ps1)$/i.test(file)) continue

        const stat = await fs.stat(file)
        if (stat.size > MAX_FILE_SIZE) {
          findings.push({
            severity: 'low',
            pattern: 'oversize',
            description: `文件过大 (${(stat.size / 1024 / 1024).toFixed(1)}MB)，跳过内容扫描`,
            file: relPath
          })
          continue
        }
        totalSize += stat.size
        scannedFiles++

        let content = ''
        try {
          content = await fs.readFile(file, 'utf-8')
        } catch {
          continue // 二进制文件跳过
        }

        // 逐行扫描以定位行号
        const lines = content.split('\n')
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]
          // 高风险
          for (const p of HIGH_RISK_PATTERNS) {
            if (p.regex.test(line)) {
              findings.push({
                severity: 'high',
                pattern: p.regex.source.slice(0, 40),
                description: p.description,
                file: relPath,
                line: i + 1,
                snippet: line.trim().slice(0, 100)
              })
            }
          }
          // 中风险
          for (const p of MEDIUM_RISK_PATTERNS) {
            if (p.regex.test(line)) {
              findings.push({
                severity: 'medium',
                pattern: p.regex.source.slice(0, 40),
                description: p.description,
                file: relPath,
                line: i + 1,
                snippet: line.trim().slice(0, 100)
              })
            }
          }
          // 低风险
          for (const p of LOW_RISK_PATTERNS) {
            if (p.regex.test(line)) {
              findings.push({
                severity: 'low',
                pattern: p.regex.source.slice(0, 40),
                description: p.description,
                file: relPath,
                line: i + 1,
                snippet: line.trim().slice(0, 100)
              })
            }
          }
        }
      }
    } catch (error: any) {
      this.logger.error('插件审计失败:', error)
      return {
        safe: false,
        score: 0,
        findings,
        summary: `审计过程出错: ${error.message}`
      }
    }

    // 计算安全评分
    const highCount = findings.filter(f => f.severity === 'high').length
    const mediumCount = findings.filter(f => f.severity === 'medium').length
    const lowCount = findings.filter(f => f.severity === 'low').length

    let score = 100
    score -= highCount * 40
    score -= mediumCount * 8
    score -= lowCount * 2
    score = Math.max(0, Math.min(100, score))

    const safe = highCount === 0

    let summary = ''
    if (scannedFiles === 0) {
      summary = '未找到可扫描的代码文件'
    } else if (highCount > 0) {
      summary = `发现 ${highCount} 个高危风险、${mediumCount} 个中危风险，禁止安装！`
    } else if (mediumCount > 0) {
      summary = `发现 ${mediumCount} 个中危风险，建议谨慎使用`
    } else {
      summary = `扫描 ${scannedFiles} 个文件，未发现高风险内容，安全`
    }

    return { safe, score, findings, summary }
  }

  private async collectFiles(dir: string): Promise<string[]> {
    const results: string[] = []
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true })
      for (const entry of entries) {
        // 跳过隐藏目录和 node_modules
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          results.push(...await this.collectFiles(full))
        } else {
          results.push(full)
        }
      }
    } catch {}
    return results
  }
}
