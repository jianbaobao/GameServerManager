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

// 服务器助理系统提示词（管理/修复/开服专家）
const ASSISTANT_SYSTEM_PROMPT = `你是 GSM3 游戏服务器管理面板的 AI 服务器助理机器人。
你的职责：
1. 管理服务器：查看实例状态、启动/停止/重启游戏服务器实例
2. 修复问题：分析终端报错、排查故障、给出修复步骤或执行操作
3. 开服：推荐游戏、说明部署步骤、检查部署条件
4. 提供专业建议：游戏服务器配置优化、端口、内存、SteamCMD 等

你可以调用工具来执行实际操作（列出实例、启停实例、查看系统状态等）。
回答使用简体中文，简洁专业，操作后汇报结果。`;

// 可调用工具定义（OpenAI function calling 格式）
const ASSISTANT_TOOLS: any[] = [
  {
    type: 'function',
    function: {
      name: 'list_instances',
      description: '列出所有游戏服务器实例及其状态',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_instance_status',
      description: '获取指定实例的详细状态',
      parameters: { type: 'object', properties: { id: { type: 'string', description: '实例 ID' } }, required: ['id'] }
    }
  },
  {
    type: 'function',
    function: {
      name: 'start_instance',
      description: '启动指定实例',
      parameters: { type: 'object', properties: { id: { type: 'string', description: '实例 ID' } }, required: ['id'] }
    }
  },
  {
    type: 'function',
    function: {
      name: 'stop_instance',
      description: '停止指定实例',
      parameters: { type: 'object', properties: { id: { type: 'string', description: '实例 ID' } }, required: ['id'] }
    }
  },
  {
    type: 'function',
    function: {
      name: 'restart_instance',
      description: '重启指定实例',
      parameters: { type: 'object', properties: { id: { type: 'string', description: '实例 ID' } }, required: ['id'] }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_system_status',
      description: '获取服务器系统状态（CPU/内存/磁盘）',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_instance_terminal_log',
      description: '获取实例最近的终端日志（用于诊断报错）',
      parameters: { type: 'object', properties: { id: { type: 'string', description: '实例 ID' }, lines: { type: 'number', description: '日志行数，默认 50' } }, required: ['id'] }
    }
  }
]

export class AIAssistant {
  private logger: winston.Logger
  private apiEndpoint: string
  private apiKey: string
  private model: string
  private instanceManager: any = null
  private systemStatusGetter: (() => Promise<any>) | null = null
  private chatHistory: Array<{ role: string; content: string }> = []

  constructor(logger: winston.Logger) {
    this.logger = logger
    // 支持免费/开源网关：OpenAI 兼容端点（one-api、OpenRouter、Groq、DeepSeek、智谱等）
    this.apiEndpoint = process.env.AI_API_ENDPOINT || 'https://api.openai.com/v1/chat/completions'
    this.apiKey = process.env.AI_API_KEY || ''
    this.model = process.env.AI_MODEL || 'gpt-3.5-turbo'
  }

  // 注入实例管理器（供工具调用）
  setInstanceManager(manager: any): void {
    this.instanceManager = manager
  }

  // 注入系统状态获取函数
  setSystemStatusGetter(fn: () => Promise<any>): void {
    this.systemStatusGetter = fn
  }

  // 获取当前 AI 配置（供前端显示）
  getConfig(): { endpoint: string; model: string; hasKey: boolean } {
    return {
      endpoint: this.apiEndpoint,
      model: this.model,
      hasKey: !!this.apiKey
    }
  }

  // 执行工具调用
  private async executeTool(name: string, args: any): Promise<string> {
    try {
      switch (name) {
        case 'list_instances': {
          if (!this.instanceManager) return '实例管理器不可用'
          const instances = this.instanceManager.getAllInstances ? this.instanceManager.getAllInstances() : []
          if (!instances || instances.length === 0) return '当前没有游戏服务器实例'
          return JSON.stringify(instances.map((i: any) => ({
            id: i.id, name: i.name, status: i.status, gameKey: i.gameKey || '', port: i.port || ''
          })))
        }
        case 'get_instance_status':
        case 'start_instance':
        case 'stop_instance':
        case 'restart_instance': {
          if (!this.instanceManager) return '实例管理器不可用'
          const id = args?.id
          if (!id) return '缺少实例 ID'
          if (name === 'get_instance_status') {
            const inst = this.instanceManager.getInstance ? this.instanceManager.getInstance(id) : null
            return inst ? JSON.stringify({ id: inst.id, name: inst.name, status: inst.status, startCommand: inst.startCommand, workingDirectory: inst.workingDirectory }) : `实例 ${id} 不存在`
          }
          const action = name.replace('_instance', '')
          if (this.instanceManager[action + 'Instance']) {
            await this.instanceManager[action + 'Instance'](id)
            return `已执行 ${action} 实例 ${id}`
          }
          return `实例管理器不支持 ${action} 操作`
        }
        case 'get_system_status': {
          if (this.systemStatusGetter) {
            const s = await this.systemStatusGetter()
            return JSON.stringify(s)
          }
          return '系统状态获取器未配置'
        }
        case 'get_instance_terminal_log': {
          if (!this.instanceManager) return '实例管理器不可用'
          const id = args?.id
          const lines = args?.lines || 50
          if (this.instanceManager.getTerminalLog) {
            const log = await this.instanceManager.getTerminalLog(id, lines)
            return log || `实例 ${id} 无终端日志`
          }
          return '实例管理器不支持获取终端日志'
        }
        default:
          return `未知工具: ${name}`
      }
    } catch (e: any) {
      return `工具执行失败: ${e?.message || e}`
    }
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

  // 清空对话历史
  clearChat(): void {
    this.chatHistory = []
  }

  // 服务器助理对话（多轮 + 工具调用）
  async assistantChat(userMessage: string): Promise<{ answer: string; toolCalls: any[]; historyLength: number }> {
    const toolCalls: any[] = []
    if (!this.apiEndpoint) {
      return { answer: '未配置 AI API。请在 .env 中设置 AI_API_ENDPOINT / AI_API_KEY / AI_MODEL（支持 OpenAI 兼容网关：one-api、OpenRouter、Groq、DeepSeek 等免费/开源方案）。', toolCalls, historyLength: 0 }
    }

    try {
      // 维护对话历史（最多 20 条）
      this.chatHistory.push({ role: 'user', content: userMessage })
      if (this.chatHistory.length > 20) {
        this.chatHistory = this.chatHistory.slice(-20)
      }

      const messages = [
        { role: 'system', content: ASSISTANT_SYSTEM_PROMPT },
        ...this.chatHistory
      ]

      const body = JSON.stringify({
        model: this.model,
        messages,
        tools: ASSISTANT_TOOLS,
        tool_choice: 'auto',
        max_tokens: 1500,
        temperature: 0.5,
      })

      const url = new URL(this.apiEndpoint)
      const client = url.protocol === 'https:' ? https : http
      const response = await new Promise<string>((resolve, reject) => {
        const req = client.request(url.toString(), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': this.apiKey ? `Bearer ${this.apiKey}` : '',
          },
        }, (res) => {
          let data = ''
          res.on('data', (chunk: string) => { data += chunk })
          res.on('end', () => resolve(data))
        })
        req.on('error', reject)
        req.setTimeout(30000, () => { req.destroy(); reject(new Error('AI 请求超时')) })
        req.write(body)
        req.end()
      })

      const json = JSON.parse(response)
      const message = json.choices?.[0]?.message

      // 工具调用循环（最多 3 轮）
      let finalContent = message?.content || ''
      let loopMessage = message
      for (let round = 0; round < 3 && loopMessage?.tool_calls?.length; round++) {
        // 记录工具调用
        const roundCalls = []
        const toolResults = []
        for (const tc of loopMessage.tool_calls) {
          const fnName = tc.function?.name || ''
          let args: any = {}
          try { args = JSON.parse(tc.function?.arguments || '{}') } catch {}
          const result = await this.executeTool(fnName, args)
          roundCalls.push({ name: fnName, args })
          toolResults.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: result
          })
        }
        toolCalls.push(...roundCalls)

        // 把工具结果回传给 AI 生成最终回答
        const toolMessages = [
          { role: 'system', content: ASSISTANT_SYSTEM_PROMPT },
          ...this.chatHistory,
          loopMessage,
          ...toolResults
        ]
        const body2 = JSON.stringify({
          model: this.model,
          messages: toolMessages,
          max_tokens: 1500,
          temperature: 0.5,
        })
        const response2 = await new Promise<string>((resolve, reject) => {
          const req2 = client.request(url.toString(), {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': this.apiKey ? `Bearer ${this.apiKey}` : '',
            },
          }, (res2) => {
            let d2 = ''
            res2.on('data', (chunk: string) => { d2 += chunk })
            res2.on('end', () => resolve(d2))
          })
          req2.on('error', reject)
          req2.setTimeout(30000, () => { req2.destroy(); reject(new Error('AI 请求超时')) })
          req2.write(body2)
          req2.end()
        })
        const json2 = JSON.parse(response2)
        loopMessage = json2.choices?.[0]?.message
        if (loopMessage?.content) finalContent = loopMessage.content
      }

      // 保存 AI 回复到历史
      this.chatHistory.push({ role: 'assistant', content: finalContent || '（无回复）' })

      return { answer: finalContent || '（AI 未返回内容）', toolCalls, historyLength: this.chatHistory.length }
    } catch (err: any) {
      this.logger.warn(`AI assistant error: ${err?.message || err}`)
      return { answer: `AI 请求失败: ${err?.message || err}。请检查 AI_API_ENDPOINT / AI_API_KEY 配置。`, toolCalls, historyLength: this.chatHistory.length }
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
