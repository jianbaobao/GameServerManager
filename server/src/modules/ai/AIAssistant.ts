import winston from 'winston'
import https from 'https'
import http from 'http'

// Common server error patterns for built-in analysis (no external API needed)
const ERROR_PATTERNS: { pattern: RegExp; category: string; suggestion: string }[] = [
  { pattern: /Address already in use|EADDRINUSE|port already in use/i, category: 'port', suggestion: '端口已被占用，请更换端口号或关闭占用端口的进程' },
  { pattern: /Connection refused|ECONNREFUSED/i, category: 'network', suggestion: '连接被拒绝，检查目标服务是否已启动以及端口是否正确' },
  { pattern: /Out of memory|OutOfMemoryError|Cannot allocate memory/i, category: 'memory', suggestion: '内存不足，请增加分配的内存（-Xmx）或关闭其他占用内存的进程' },
  { pattern: /No space left on device|ENOSPC/i, category: 'disk', suggestion: '磁盘空间不足，请清理磁盘空间或扩展存储' },
  { pattern: /Permission denied|EACCES/i, category: 'permission', suggestion: '权限不足，请检查文件权限或以管理员身份运行' },
  { pattern: /not found|No such file|ENOENT/i, category: 'file', suggestion: '文件不存在，请检查路径是否正确或重新安装服务端' },
  { pattern: /java\.lang\.(NullPointerException|ArrayIndexOutOfBoundsException)/i, category: 'java', suggestion: 'Java运行时异常，可能是模组冲突或服务端核心损坏，尝试更新或更换服务端核心' },
  { pattern: /java\.lang\.OutOfMemoryError/i, category: 'java', suggestion: 'Java内存溢出，增加-Xmx参数值（如 -Xmx4G）' },
  { pattern: /Timed out|timeout|time out/i, category: 'network', suggestion: '连接超时，检查网络连接或增加超时时间设置' },
  { pattern: /failed to bind|Failed to bind/i, category: 'port', suggestion: '端口绑定失败，请检查端口是否被占用或需要管理员权限' },
  { pattern: /Invalid key|invalid key|key code/i, category: 'auth', suggestion: '密钥无效，请检查密钥是否正确或重新生成' },
  { pattern: /could not find|Could not find|not loaded/i, category: 'file', suggestion: '找不到文件或模块，请检查依赖是否完整安装' },
  { pattern: /segfault|SIGSEGV|Segmentation fault/i, category: 'system', suggestion: '程序崩溃（段错误），可能是硬件问题或软件Bug，尝试更新版本' },
  { pattern: /killed|SIGKILL|SIGTERM/i, category: 'system', suggestion: '进程被终止，可能是系统OOM Killer或手动操作' },
  { pattern: /error|Error|ERROR|failed|Failed|FAILED|exception|Exception/i, category: 'unknown', suggestion: '检测到错误输出，请检查日志获取详细信息' },
]

export interface AIQueryRequest {
  prompt: string
  context?: string
  terminalOutput?: string
}

export interface AIQueryResponse {
  success: boolean
  answer: string
  category?: string
  suggestions?: string[]
  source: 'builtin' | 'api'
}

export class AIAssistant {
  private logger: winston.Logger
  private apiEndpoint: string
  private apiKey: string
  private model: string

  constructor(logger: winston.Logger) {
    this.logger = logger
    this.apiEndpoint = process.env.AI_API_ENDPOINT || ''
    this.apiKey = process.env.AI_API_KEY || ''
    this.model = process.env.AI_MODEL || 'gpt-3.5-turbo'
  }

  // Built-in pattern-based analysis (no external API needed)
  private analyzeWithBuiltin(terminalOutput: string): { matches: { pattern: string; category: string; suggestion: string }[] } {
    const matches: { pattern: string; category: string; suggestion: string }[] = []
    for (const ep of ERROR_PATTERNS) {
      if (ep.pattern.test(terminalOutput)) {
        matches.push({ pattern: ep.pattern.source, category: ep.category, suggestion: ep.suggestion })
      }
    }
    return { matches }
  }

  // Try external AI API if configured
  private async queryExternalAPI(prompt: string, context?: string): Promise<string | null> {
    if (!this.apiEndpoint) return null

    try {
      const fullPrompt = context
        ? `Context: ${context}\n\nUser question: ${prompt}\n\nPlease provide a helpful answer about game server management.`
        : `User question: ${prompt}\n\nPlease provide a helpful answer about game server management.`

      const body = JSON.stringify({
        model: this.model,
        messages: [{ role: 'system', content: 'You are a game server management assistant. Help users diagnose and fix game server issues.' }, { role: 'user', content: fullPrompt }],
        max_tokens: 1000,
        temperature: 0.7,
      })

      const url = new URL(this.apiEndpoint)
      const client = url.protocol === 'https:' ? https : http

      return new Promise((resolve, reject) => {
        const req = client.request(
          url.toString(),
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': this.apiKey ? `Bearer ${this.apiKey}` : '',
            },
          },
          (res) => {
            let data = ''
            res.on('data', (chunk: string) => { data += chunk })
            res.on('end', () => {
              try {
                const json = JSON.parse(data)
                const answer = json.choices?.[0]?.message?.content || json.response || data
                resolve(answer)
              } catch {
                resolve(data)
              }
            })
          }
        )
        req.on('error', (err: Error) => {
          this.logger.warn(`AI API request failed: ${err.message}`)
          resolve(null)
        })
        req.setTimeout(15000, () => { req.destroy(); resolve(null) })
        req.write(body)
        req.end()
      })
    } catch (err) {
      this.logger.warn(`AI API error: ${err}`)
      return null
    }
  }

  // Main query method - tries external API first, then falls back to built-in analysis
  async query(request: AIQueryRequest): Promise<AIQueryResponse> {
    try {
      // If there's terminal output, do built-in error analysis
      if (request.terminalOutput) {
        const analysis = this.analyzeWithBuiltin(request.terminalOutput)
        if (analysis.matches.length > 0) {
          // Build answer from matched patterns
          const suggestions = [...new Set(analysis.matches.map(m => m.suggestion))]
          const categories = [...new Set(analysis.matches.map(m => m.category))]
          
          // Try external API first, fall back to built-in
          if (this.apiEndpoint) {
            const apiAnswer = await this.queryExternalAPI(
              request.prompt || '分析以下服务器输出中的错误：' + request.terminalOutput.substring(0, 2000),
              `Server output contains errors in categories: ${categories.join(', ')}`
            )
            if (apiAnswer) {
              return { success: true, answer: apiAnswer, category: categories[0], suggestions, source: 'api' }
            }
          }

          // Built-in fallback
          const answer = suggestions.length > 0
            ? `检测到以下问题：\n${analysis.matches.map((m, i) => `${i + 1}. [${m.category}] ${m.suggestion}`).join('\n')}`
            : '未识别到具体的错误模式，请查看完整日志。'
          return { success: true, answer, category: categories[0], suggestions, source: 'builtin' }
        }
      }

      // General query - try external API
      if (this.apiEndpoint) {
        const apiAnswer = await this.queryExternalAPI(request.prompt, request.context)
        if (apiAnswer) {
          return { success: true, answer: apiAnswer, source: 'api' }
        }
      }

      // Built-in general responses for common questions
      const generalResponses: { pattern: RegExp; answer: string }[] = [
        { pattern: /如何安装|怎么安装|install/i, answer: '游戏安装步骤：\n1. 进入"游戏部署"页面\n2. 选择要安装的游戏\n3. 设置安装路径\n4. 点击安装按钮\n5. SteamCMD 会自动下载服务端文件' },
        { pattern: /无法启动|启动失败|start fail/i, answer: '启动失败常见原因：\n1. 工作目录中缺少启动文件\n2. Java未安装或版本不匹配\n3. 端口被占用\n4. 内存不足\n请检查实例日志获取详细信息。' },
        { pattern: /如何添加|添加游戏|add game/i, answer: '您可以通过以下方式添加游戏：\n1. SteamCMD部署（推荐）：在"游戏部署"页面选择游戏安装\n2. 文件部署：上传压缩包到文件管理器\n3. 手动创建实例：在"实例管理"页面创建通用实例' },
        { pattern: /端口|port/i, answer: '端口相关：\n- Minecraft Java版默认端口: 25565\n- Minecraft基岩版: 19132\n- 泰拉瑞亚: 7777\n- 方舟: 7777/27015\n- 幻兽帕鲁: 8211\n请在实例配置中检查端口设置。' },
        { pattern: /备份|backup/i, answer: '备份功能位于实例管理的"备份管理"标签页。\n您可以创建、恢复和删除实例的完整备份。\n建议定期备份重要数据。' },
        { pattern: /模组|mod|插件|plugin/i, answer: '模组和插件管理：\n1. Minecraft模组：放入 mods 文件夹\n2. Bukkit/Spigot/Paper插件：放入 plugins 文件夹\n3. 您可以通过文件管理器上传文件\n4. 某些服务端可能需要重启才能加载新模组' },
      ]

      for (const gr of generalResponses) {
        if (gr.pattern.test(request.prompt)) {
          return { success: true, answer: gr.answer, source: 'builtin' }
        }
      }

      return {
        success: true,
        answer: '我是 GSM3 服务器管理助手。您可以问我关于以下方面的问题：\n- 游戏安装和配置\n- 服务器启动问题\n- 端口和网络设置\n- 模组和插件管理\n- 备份与恢复\n\n提示：在 .env 文件中配置 AI_API_ENDPOINT 和 AI_API_KEY 即可启用 AI 智能分析功能。',
        source: 'builtin'
      }
    } catch (error) {
      this.logger.error('AI query failed:', error)
      return { success: false, answer: 'AI 分析服务暂时不可用，请稍后重试。', source: 'builtin' }
    }
  }
}
