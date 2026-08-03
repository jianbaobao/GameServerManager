import express from 'express'
import path from 'path'
import { promises as fs } from 'fs'
import fsSync from 'fs'
import { authenticateToken } from '../middleware/auth.js'
import type { PluginManager } from '../modules/plugin/PluginManager.js'
import { PluginSecurityAudit } from '../modules/plugin/pluginSecurityAudit.js'
import logger from '../utils/logger.js'

const router = express.Router()

let pluginManager: PluginManager

export function setPluginManager(manager: PluginManager) {
  pluginManager = manager
}

const audit = new PluginSecurityAudit(logger)

// 第三方插件市场源（GitHub 仓库的 plugins 目录，JSON 索引）
const PLUGIN_MARKET_URLS = [
  'https://raw.githubusercontent.com/jianbaobao/GameServerManager/main/docs/plugins/marketplace.json',
  'https://ghfast.top/https://raw.githubusercontent.com/jianbaobao/GameServerManager/main/docs/plugins/marketplace.json',
]

// 获取第三方插件市场列表（合并多个市场源，去重）
router.get('/market/list', authenticateToken, async (_req, res) => {
  try {
    const merged: any[] = []
    const seen = new Set<string>()
    let loadedSource = ''

    // 遍历所有市场源，合并插件列表
    for (const url of PLUGIN_MARKET_URLS) {
      try {
        const resp = await fetch(url, { signal: AbortSignal.timeout(8000) })
        if (!resp.ok) continue
        const data: any = await resp.json()
        const plugins = Array.isArray(data) ? data : (data.plugins || [])
        if (Array.isArray(plugins)) {
          for (const p of plugins) {
            if (p && p.name && !seen.has(p.name)) {
              seen.add(p.name)
              merged.push(p)
            }
          }
          if (plugins.length > 0 && !loadedSource) loadedSource = url
        }
      } catch {}
    }

    if (merged.length > 0) {
      return res.json({ success: true, data: merged, source: loadedSource })
    }

    // 无远程源时返回内置示例
    res.json({ success: true, data: [], source: 'builtin' })
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message })
  }
})

// 审计插件目录
router.post('/audit', authenticateToken, async (req, res) => {
  try {
    const { name } = req.body || {}
    if (!name || typeof name !== 'string') {
      return res.status(400).json({ success: false, error: '缺少插件名称' })
    }
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(name)) {
      return res.status(400).json({ success: false, error: '插件名称格式不正确' })
    }
    const pluginPath = pluginManager.getPluginPath(name)
    if (!fsSync.existsSync(pluginPath)) {
      return res.status(404).json({ success: false, error: '插件不存在' })
    }
    const result = await audit.auditPlugin(pluginPath)
    res.json({ success: true, data: result })
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message })
  }
})

// 安装第三方插件（下载 -> 安全审计 -> 通过后安装）
router.post('/install', authenticateToken, async (req, res) => {
  try {
    const { name, downloadUrl, skipAudit } = req.body || {}
    if (!name || !downloadUrl) {
      return res.status(400).json({ success: false, error: '缺少插件名称或下载地址' })
    }
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(name)) {
      return res.status(400).json({ success: false, error: '插件名称格式不正确' })
    }
    // 仅允许 http(s) 下载地址，防止本地文件读取
    if (!/^https?:\/\//i.test(downloadUrl)) {
      return res.status(400).json({ success: false, error: '仅支持 http(s) 下载地址' })
    }

    const pluginDir = pluginManager.getPluginPath(name)
    const tmpDir = path.join(process.cwd(), 'data', 'tmp', 'plugin-install-' + Date.now())

    try {
      // 1. 下载插件包（zip/tar.gz）
      await fs.mkdir(tmpDir, { recursive: true })
      const resp = await fetch(downloadUrl, { signal: AbortSignal.timeout(30000) })
      if (!resp.ok) throw new Error('下载失败: HTTP ' + resp.status)
      const buf = Buffer.from(await resp.arrayBuffer())
      if (buf.length === 0 || buf.length > 50 * 1024 * 1024) {
        throw new Error('插件包大小无效')
      }
      const archivePath = path.join(tmpDir, 'plugin-archive')
      await fs.writeFile(archivePath, buf)

      // 2. 解压到临时目录
      const extractDir = path.join(tmpDir, 'extracted')
      await fs.mkdir(extractDir, { recursive: true })
      if (downloadUrl.endsWith('.zip')) {
        await extractZip(archivePath, extractDir)
      } else {
        const { default: tar } = await import('tar') as any
        await tar.x({ file: archivePath, cwd: extractDir })
      }

      // 3. 安全审计
      if (!skipAudit) {
        const auditResult = await audit.auditPlugin(extractDir)
        if (!auditResult.safe) {
          await fs.rm(tmpDir, { recursive: true, force: true })
          return res.status(400).json({
            success: false,
            error: '插件未通过安全审计，已阻止安装',
            data: auditResult
          })
        }
      }

      // 4. 复制到插件目录
      await fs.mkdir(pluginDir, { recursive: true })
      // 如果解压后是单目录，取内部内容
      const entries = await fs.readdir(extractDir)
      let sourceDir = extractDir
      if (entries.length === 1) {
        const single = path.join(extractDir, entries[0])
        const stat = await fs.stat(single)
        if (stat.isDirectory()) sourceDir = single
      }
      await fs.cp(sourceDir, pluginDir, { recursive: true, force: true })

      // 5. 重新加载插件
      await (pluginManager as any).loadPlugin(name)

      // 6. 返回审计报告
      const auditResult = await audit.auditPlugin(pluginDir)
      await fs.rm(tmpDir, { recursive: true, force: true })

      res.json({
        success: true,
        message: '插件安装成功（已通过安全审计）',
        data: { name, audit: auditResult }
      })
    } catch (error: any) {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
      res.status(500).json({ success: false, error: error.message || '安装失败' })
    }
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message })
  }
})

async function extractZip(archivePath: string, destDir: string): Promise<void> {
  if (process.platform === 'win32') {
    const { execFile } = await import('child_process') as any
    const { promisify } = await import('util') as any
    await promisify(execFile)('powershell', ['-NoProfile', '-Command', `Expand-Archive -Force -Path "${archivePath}" -DestinationPath "${destDir}"`], { timeout: 60000 })
  } else {
    const { execFile } = await import('child_process') as any
    const { promisify } = await import('util') as any
    await promisify(execFile)('unzip', ['-o', archivePath, '-d', destDir], { timeout: 60000 })
  }
}

// 获取所有插件列表
router.get('/list', authenticateToken, async (req, res) => {
  try {
    const plugins = pluginManager.getPlugins()
    res.json({
      success: true,
      data: plugins
    })
  } catch (error) {
    console.error('获取插件列表失败:', error)
    res.status(500).json({
      success: false,
      message: '获取插件列表失败',
      error: error instanceof Error ? error.message : '未知错误'
    })
  }
})

// 获取单个插件信息
router.get('/:name', authenticateToken, async (req, res) => {
  try {
    const { name } = req.params
    const plugin = pluginManager.getPlugin(name)
    
    if (!plugin) {
      return res.status(404).json({
        success: false,
        message: '插件不存在'
      })
    }

    res.json({
      success: true,
      data: plugin
    })
  } catch (error) {
    console.error('获取插件信息失败:', error)
    res.status(500).json({
      success: false,
      message: '获取插件信息失败',
      error: error instanceof Error ? error.message : '未知错误'
    })
  }
})

// 启用插件
router.post('/:name/enable', authenticateToken, async (req, res) => {
  try {
    const { name } = req.params
    const success = await pluginManager.enablePlugin(name)
    
    if (!success) {
      return res.status(404).json({
        success: false,
        message: '插件不存在'
      })
    }

    res.json({
      success: true,
      message: '插件已启用'
    })
  } catch (error) {
    console.error('启用插件失败:', error)
    res.status(500).json({
      success: false,
      message: '启用插件失败',
      error: error instanceof Error ? error.message : '未知错误'
    })
  }
})

// 禁用插件
router.post('/:name/disable', authenticateToken, async (req, res) => {
  try {
    const { name } = req.params
    const success = await pluginManager.disablePlugin(name)
    
    if (!success) {
      return res.status(404).json({
        success: false,
        message: '插件不存在'
      })
    }

    res.json({
      success: true,
      message: '插件已禁用'
    })
  } catch (error) {
    console.error('禁用插件失败:', error)
    res.status(500).json({
      success: false,
      message: '禁用插件失败',
      error: error instanceof Error ? error.message : '未知错误'
    })
  }
})

// 创建新插件
router.post('/create', authenticateToken, async (req, res) => {
  try {
    const { name, displayName, description, version, author, category, icon } = req.body
    
    if (!name) {
      return res.status(400).json({
        success: false,
        message: '插件名称不能为空'
      })
    }

    // 验证插件名称格式（只允许字母、数字、下划线、连字符）
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      return res.status(400).json({
        success: false,
        message: '插件名称只能包含字母、数字、下划线和连字符'
      })
    }

    const success = await pluginManager.createPlugin(name, {
      displayName,
      description,
      version,
      author,
      category,
      icon
    })
    
    if (!success) {
      return res.status(400).json({
        success: false,
        message: '插件已存在或创建失败'
      })
    }

    res.json({
      success: true,
      message: '插件创建成功'
    })
  } catch (error) {
    console.error('创建插件失败:', error)
    res.status(500).json({
      success: false,
      message: '创建插件失败',
      error: error instanceof Error ? error.message : '未知错误'
    })
  }
})

// 删除插件
router.delete('/:name', authenticateToken, async (req, res) => {
  try {
    const { name } = req.params
    const success = await pluginManager.deletePlugin(name)
    
    if (!success) {
      return res.status(404).json({
        success: false,
        message: '插件不存在'
      })
    }

    res.json({
      success: true,
      message: '插件删除成功'
    })
  } catch (error) {
    console.error('删除插件失败:', error)
    res.status(500).json({
      success: false,
      message: '删除插件失败',
      error: error instanceof Error ? error.message : '未知错误'
    })
  }
})

// 获取插件文件内容（无需认证的公共资源）
router.get('/:name/files/*', async (req, res) => {
  const { name } = req.params
  const filePath = req.params[0] || 'index.html'
  
  // 对于非公共资源文件，需要认证
  const publicFiles = ['gsm3-api.js', 'index.html', 'style.css']
  const isPublicFile = publicFiles.some(file => filePath.endsWith(file))
  
  if (!isPublicFile) {
    return authenticateToken(req, res, async () => {
      await handleFileRequest(req, res)
    })
  }
  
  await handleFileRequest(req, res)
})

// 处理文件请求的通用函数
async function handleFileRequest(req: any, res: any) {
  try {
    const { name } = req.params
    const filePath = req.params[0] || 'index.html'
    
    const plugin = pluginManager.getPlugin(name)
    if (!plugin) {
      return res.status(404).json({
        success: false,
        message: '插件不存在'
      })
    }

    const pluginPath = pluginManager.getPluginPath(name)
    const fullPath = path.join(pluginPath, filePath)
    
    // 安全检查：确保文件路径在插件目录内
    const normalizedPluginPath = path.normalize(pluginPath)
    const normalizedFullPath = path.normalize(fullPath)
    if (!normalizedFullPath.startsWith(normalizedPluginPath)) {
      return res.status(403).json({
        success: false,
        message: '访问被拒绝'
      })
    }

    try {
      const stats = await fs.stat(fullPath)
      if (!stats.isFile()) {
        return res.status(404).json({
          success: false,
          message: '文件不存在'
        })
      }

      // 根据文件扩展名设置Content-Type
      const ext = path.extname(filePath).toLowerCase()
      const contentTypes: { [key: string]: string } = {
        '.html': 'text/html; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.js': 'application/javascript; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.svg': 'image/svg+xml',
        '.ico': 'image/x-icon'
      }

      // 对于JS文件，直接返回文件内容以便浏览器正确执行
      if (ext === '.js') {
        const contentType = contentTypes[ext] || 'application/javascript; charset=utf-8'
        res.setHeader('Content-Type', contentType)
        const fileContent = await fs.readFile(fullPath, 'utf-8')
        res.send(fileContent)
      }
      // 对于HTML、CSS、JSON等文本文件，返回JSON格式的内容
      else if (['.html', '.css', '.json'].includes(ext)) {
        const fileContent = await fs.readFile(fullPath, 'utf-8')
        res.json({
          success: true,
          data: fileContent
        })
      } else {
        // 对于图片等二进制文件，直接返回文件内容
        const contentType = contentTypes[ext] || 'application/octet-stream'
        res.setHeader('Content-Type', contentType)
        const fileContent = await fs.readFile(fullPath)
        res.send(fileContent)
      }
    } catch (fileError) {
      return res.status(404).json({
        success: false,
        message: '文件不存在'
      })
    }
  } catch (error) {
    console.error('获取插件文件失败:', error)
    res.status(500).json({
      success: false,
      message: '获取插件文件失败',
      error: error instanceof Error ? error.message : '未知错误'
    })
  }
}

// 更新插件文件内容
router.put('/:name/files/*', authenticateToken, async (req, res) => {
  try {
    const { name } = req.params
    const filePath = req.params[0]
    const { content } = req.body
    
    if (!filePath) {
      return res.status(400).json({
        success: false,
        message: '文件路径不能为空'
      })
    }

    const plugin = pluginManager.getPlugin(name)
    if (!plugin) {
      return res.status(404).json({
        success: false,
        message: '插件不存在'
      })
    }

    const pluginPath = pluginManager.getPluginPath(name)
    const fullPath = path.join(pluginPath, filePath)
    
    // 安全检查：确保文件路径在插件目录内
    const normalizedPluginPath = path.normalize(pluginPath)
    const normalizedFullPath = path.normalize(fullPath)
    if (!normalizedFullPath.startsWith(normalizedPluginPath)) {
      return res.status(403).json({
        success: false,
        message: '访问被拒绝'
      })
    }

    // 确保目录存在
    const dir = path.dirname(fullPath)
    await fs.mkdir(dir, { recursive: true })
    
    // 写入文件
    await fs.writeFile(fullPath, content, 'utf-8')

    res.json({
      success: true,
      message: '文件保存成功'
    })
  } catch (error) {
    console.error('保存插件文件失败:', error)
    res.status(500).json({
      success: false,
      message: '保存插件文件失败',
      error: error instanceof Error ? error.message : '未知错误'
    })
  }
})

export default router