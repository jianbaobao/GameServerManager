import { Router, Request, Response } from 'express'
import { InstanceManager } from '../modules/instance/InstanceManager.js'
import { authenticateToken } from '../middleware/auth.js'
import logger from '../utils/logger.js'
import PythonManager from '../utils/pythonManager.js'
import os from 'os'
import fsSync from 'fs'
import https from 'https'
import http from 'http'
import { promises as fs } from 'fs'
import path from 'path'

const router = Router()

// 注意：这里需要在实际使用时注入InstanceManager实例
let instanceManager: InstanceManager

// 设置InstanceManager实例的函数
export function setInstanceManager(manager: InstanceManager) {
  instanceManager = manager
}

// 获取所有实例
router.get('/', authenticateToken, (req: Request, res: Response) => {
  try {
    if (!instanceManager) {
      return res.status(500).json({ 
        success: false, 
        error: '实例管理器未初始化' 
      })
    }
    
    const instances = instanceManager.getInstances()
    res.json({
      success: true,
      data: instances
    })
  } catch (error: any) {
    logger.error('获取实例列表失败:', error)
    res.status(500).json({
      success: false,
      error: '获取实例列表失败',
      message: error.message
    })
  }
})

// 获取实例市场列表
router.get('/market', authenticateToken, async (req: Request, res: Response) => {
  try {
    // 本地优先：从 installgame.json 生成实例市场（与游戏部署页 108 个游戏一一对应）
    const paths = [
      path.join(process.cwd(), 'data', 'games', 'installgame.json'),
      path.join(process.cwd(), 'server', 'data', 'games', 'installgame.json'),
    ]
    let gamesData: any = {}
    for (const p of paths) {
      try { gamesData = JSON.parse(await fs.readFile(p, 'utf-8')); break } catch {}
    }
    const pf = os.platform() === 'win32' ? 'Windows' : 'Linux'
    const market = Object.entries(gamesData).map(([key, info]: [string, any]) => {
      const cmd = info.start_command
      let command = ''
      if (typeof cmd === 'string') command = cmd
      else if (cmd) command = cmd[pf] || cmd['Linux'] || cmd['Windows'] || ''
      // 默认游戏目录（安装路径提示）：Steam 常见目录
      const defaultDir = pf === 'Windows'
        ? `D:\\Games\\${key}`
        : `/opt/games/${key}`
      return {
        name: info.game_nameCN || key,
        gameKey: key,
        appid: info.appid || '',
        image: info.image || '',
        command: command || 'Set manually',
        stopcommand: 'ctrl+c',
        category: info.category || 'other',
        memory: info.memory || 4,
        versions: info.versions || ['public'],
        defaultDir,
        system: info.system || ['Windows', 'Linux'],
        url: info.url || '',
        tip: info.tip || ''
      }
    })
    res.json({ success: true, data: { instances: market, total: market.length }, source: 'local' })
  } catch (error: any) {
    logger.error('Failed to get market list:', error)
    res.status(500).json({ success: false, error: 'Failed to get market list', message: error.message })
  }
})

// 获取单个实例
router.get('/:id', authenticateToken, (req: Request, res: Response) => {
  try {
    if (!instanceManager) {
      return res.status(500).json({ 
        success: false, 
        error: '实例管理器未初始化' 
      })
    }
    
    const { id } = req.params
    const instance = instanceManager.getInstance(id)
    
    if (!instance) {
      return res.status(404).json({
        success: false,
        error: '实例不存在'
      })
    }
    
    res.json({
      success: true,
      data: instance
    })
  } catch (error: any) {
    logger.error('获取实例失败:', error)
    res.status(500).json({
      success: false,
      error: '获取实例失败',
      message: error.message
    })
  }
})

// 创建实例
router.post('/', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!instanceManager) {
      return res.status(500).json({ 
        success: false, 
        error: '实例管理器未初始化' 
      })
    }
    
    const { name, description, workingDirectory, startCommand, autoStart, stopCommand, enableStreamForward, programPath, terminalUser, instanceType, javaVersion, gameKey, gameVersion } = req.body
    
    // 根据实例类型设置默认值
    const actualInstanceType = instanceType || 'generic'
    let actualStartCommand = startCommand?.trim() || ''
    let actualStopCommand = stopCommand || 'ctrl+c'
    
    // 我的世界基岩版 - 根据平台设置启动命令
    if (actualInstanceType === 'minecraft-bedrock') {
      const platform = os.platform()
      if (platform === 'win32') {
        actualStartCommand = '.\\bedrock_server.exe'
      } else {
        actualStartCommand = './bedrock_server'
      }
      actualStopCommand = 'stop'
    }
    
    // 我的世界Java版 - 启动命令会在启动时动态生成
    if (actualInstanceType === 'minecraft-java') {
      actualStartCommand = 'echo Minecraft Java Edition'  // 占位符，启动时会被替换为实际命令
      actualStopCommand = 'stop'
    }
    
    // 验证必填字段
    if (!name || !workingDirectory) {
      return res.status(400).json({
        success: false,
        error: '缺少必填字段',
        message: '实例名称和工作目录为必塡项'
      })
    }
    // 验证工作目录不含危险字符
    if (/[$`;|&<>]/.test(workingDirectory)) {
      return res.status(400).json({
        success: false,
        error: '无效的工作目录',
        message: '工作目录包含不允许的字符'
      })
    }
    
    // 通用类型需要启动命令
    if (actualInstanceType === 'generic' && !actualStartCommand) {
      return res.status(400).json({
        success: false,
        error: '缺少必填字段',
        message: '启动命令为必填项'
      })
    }
    
    // 验证停止命令
    if (actualStopCommand && !['ctrl+c', 'stop', 'exit', 'quit'].includes(actualStopCommand)) {
      return res.status(400).json({
        success: false,
        error: '无效的停止命令',
        message: '停止命令必须是 ctrl+c、stop、exit 或 quit 之一'
      })
    }
    
    const instanceData: any = {
      name: name.trim(),
      description: description?.trim() || '',
      workingDirectory: workingDirectory.trim(),
      startCommand: actualStartCommand,
      autoStart: Boolean(autoStart),
      stopCommand: actualStopCommand,
      enableStreamForward: Boolean(enableStreamForward),
      programPath: programPath?.trim() || '',
      instanceType: actualInstanceType,
      javaVersion: javaVersion?.trim() || undefined,
      gameKey: gameKey?.trim() || undefined,
      gameVersion: gameVersion?.trim() || undefined
    }
    // Handle terminalUser field：如果是空字符串则设为空字符串，如果有值则设置值
    if (typeof terminalUser === 'string') {
      instanceData.terminalUser = terminalUser.trim()
    }
    
    const instance = await instanceManager.createInstance(instanceData)
    
    logger.info(`用户创建实例: ${instance.name}, 类型: ${actualInstanceType}`)
    
    res.status(201).json({
      success: true,
      data: instance,
      message: '实例创建成功'
    })
  } catch (error: any) {
    logger.error('创建实例失败:', error)
    res.status(500).json({
      success: false,
      error: '创建实例失败',
      message: error.message
    })
  }
})

// 更新实例
router.put('/:id', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!instanceManager) {
      return res.status(500).json({ 
        success: false, 
        error: '实例管理器未初始化' 
      })
    }
    
    const { id } = req.params
    const { name, description, workingDirectory, startCommand, autoStart, stopCommand, enableStreamForward, programPath, terminalUser, instanceType, javaVersion, gameKey, gameVersion } = req.body
    
    // 根据实例类型设置默认值
    const actualInstanceType = instanceType || 'generic'
    let actualStartCommand = startCommand?.trim() || ''
    let actualStopCommand = stopCommand || 'ctrl+c'
    
    // 我的世界基岩版 - 根据平台设置启动命令
    if (actualInstanceType === 'minecraft-bedrock') {
      const platform = os.platform()
      if (platform === 'win32') {
        actualStartCommand = '.\\bedrock_server.exe'
      } else {
        actualStartCommand = './bedrock_server'
      }
      actualStopCommand = 'stop'
    }
    
    // 我的世界Java版 - 启动命令会在启动时动态生成
    if (actualInstanceType === 'minecraft-java') {
      actualStartCommand = 'echo Minecraft Java Edition'  // 占位符，启动时会被替换为实际命令
      actualStopCommand = 'stop'
    }
    
    // 验证必填字段
    if (!name || !workingDirectory) {
      return res.status(400).json({
        success: false,
        error: '缺少必填字段',
        message: '实例名称和工作目录为必塡项'
      })
    }
    // 验证工作目录不含危险字符
    if (/[$`;|&<>]/.test(workingDirectory)) {
      return res.status(400).json({
        success: false,
        error: '无效的工作目录',
        message: '工作目录包含不允许的字符'
      })
    }
    
    // 通用类型需要启动命令
    if (actualInstanceType === 'generic' && !actualStartCommand) {
      return res.status(400).json({
        success: false,
        error: '缺少必填字段',
        message: '启动命令为必填项'
      })
    }
    
    // 验证停止命令
    if (actualStopCommand && !['ctrl+c', 'stop', 'exit', 'quit'].includes(actualStopCommand)) {
      return res.status(400).json({
        success: false,
        error: '无效的停止命令',
        message: '停止命令必须是 ctrl+c、stop、exit 或 quit 之一'
      })
    }
    
    const instanceData: any = {
      name: name.trim(),
      description: description?.trim() || '',
      workingDirectory: workingDirectory.trim(),
      startCommand: actualStartCommand,
      autoStart: Boolean(autoStart),
      stopCommand: actualStopCommand,
      enableStreamForward: Boolean(enableStreamForward),
      programPath: programPath?.trim() || '',
      instanceType: actualInstanceType,
      javaVersion: javaVersion?.trim() || undefined,
      gameKey: gameKey?.trim() || undefined,
      gameVersion: gameVersion?.trim() || undefined
    }
    // Handle terminalUser field：如果是空字符串则设为空字符串，如果有值则设置值
    if (typeof terminalUser === 'string') {
      instanceData.terminalUser = terminalUser.trim()
    }
    
    const instance = await instanceManager.updateInstance(id, instanceData)
    
    if (!instance) {
      return res.status(404).json({
        success: false,
        error: '实例不存在'
      })
    }
    
    logger.info(`用户更新实例: ${instance.name}`)
    
    res.json({
      success: true,
      data: instance,
      message: '实例更新成功'
    })
  } catch (error: any) {
    logger.error('更新实例失败:', error)
    
    if (error.message === '无法修改正在运行的实例配置') {
      return res.status(400).json({
        success: false,
        error: '无法修改正在运行的实例配置',
        message: '请先停止实例再进行修改'
      })
    }
    
    res.status(500).json({
      success: false,
      error: '更新实例失败',
      message: error.message
    })
  }
})

// 删除实例
router.delete('/:id', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!instanceManager) {
      return res.status(500).json({ 
        success: false, 
        error: '实例管理器未初始化' 
      })
    }
    
    const { id } = req.params
    const success = await instanceManager.deleteInstance(id)
    
    if (!success) {
      return res.status(404).json({
        success: false,
        error: '实例不存在'
      })
    }
    
    logger.info(`用户删除实例: ${id}`)
    
    res.json({
      success: true,
      message: '实例删除成功'
    })
  } catch (error: any) {
    logger.error('删除实例失败:', error)
    res.status(500).json({
      success: false,
      error: '删除实例失败',
      message: error.message
    })
  }
})

// 启动实例
router.post('/:id/start', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!instanceManager) {
      return res.status(500).json({ 
        success: false, 
        error: '实例管理器未初始化' 
      })
    }
    
    const { id } = req.params
    const result = await instanceManager.startInstance(id)
    
    logger.info(`用户启动实例: ${id}`)
    
    res.json({
      success: true,
      message: '实例启动成功',
      data: {
        terminalSessionId: result.terminalSessionId
      }
    })
  } catch (error: any) {
    logger.error('启动实例失败:', error)
    
    let statusCode = 500
    if (error.message.includes('不存在') || error.message.includes('已在运行') || error.message.includes('正在启动')) {
      statusCode = 400
    }
    
    res.status(statusCode).json({
      success: false,
      error: '启动实例失败',
      message: error.message
    })
  }
})

// 停止实例
router.post('/:id/stop', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!instanceManager) {
      return res.status(500).json({ 
        success: false, 
        error: '实例管理器未初始化' 
      })
    }
    
    const { id } = req.params
    await instanceManager.stopInstance(id)
    
    logger.info(`用户停止实例: ${id}`)
    
    res.json({
      success: true,
      message: '实例停止成功'
    })
  } catch (error: any) {
    logger.error('停止实例失败:', error)
    
    let statusCode = 500
    if (error.message.includes('不存在') || error.message.includes('未在运行')) {
      statusCode = 400
    }
    
    res.status(statusCode).json({
      success: false,
      error: '停止实例失败',
      message: error.message
    })
  }
})

// 关闭终端
router.post('/:id/close-terminal', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!instanceManager) {
      return res.status(500).json({ 
        success: false, 
        error: '实例管理器未初始化' 
      })
    }
    
    const { id } = req.params
    await instanceManager.closeTerminal(id)
    
    logger.info(`用户关闭实例终端: ${id}`)
    
    res.json({
      success: true,
      message: '终端关闭成功'
    })
  } catch (error: any) {
    logger.error('关闭终端失败:', error)
    
    let statusCode = 500
    if (error.message.includes('不存在') || error.message.includes('终端会话')) {
      statusCode = 400
    }
    
    res.status(statusCode).json({
      success: false,
      error: '关闭终端失败',
      message: error.message
    })
  }
})

// 获取实例状态
router.get('/:id/status', authenticateToken, (req: Request, res: Response) => {
  try {
    if (!instanceManager) {
      return res.status(500).json({ 
        success: false, 
        error: '实例管理器未初始化' 
      })
    }
    
    const { id } = req.params
    const status = instanceManager.getInstanceStatus(id)
    
    if (!status) {
      return res.status(404).json({
        success: false,
        error: '实例不存在'
      })
    }
    
    res.json({
      success: true,
      data: status
    })
  } catch (error: any) {
    logger.error('获取实例状态失败:', error)
    res.status(500).json({
      success: false,
      error: '获取实例状态失败',
      message: error.message
    })
  }
})

// 向实例发送输入
router.post('/:id/input', authenticateToken, (req: Request, res: Response) => {
  try {
    if (!instanceManager) {
      return res.status(500).json({ 
        success: false, 
        error: '实例管理器未初始化' 
      })
    }
    
    const { id } = req.params
    const { input } = req.body
    
    if (typeof input !== 'string') {
      return res.status(400).json({
        success: false,
        error: '无效的输入',
        message: '输入必须是字符串'
      })
    }
    
    const success = instanceManager.sendInput(id, input)
    
    if (!success) {
      return res.status(400).json({
        success: false,
        error: '发送输入失败',
        message: '实例不存在或未在运行'
      })
    }
    
    res.json({
      success: true,
      message: '输入发送成功'
    })
  } catch (error: any) {
    logger.error('发送输入失败:', error)
    res.status(500).json({
      success: false,
      error: '发送输入失败',
      message: error.message
    })
  }
})





// 获取可用的游戏配置文件列表
router.get('/configs/available', authenticateToken, async (req: Request, res: Response) => {
  try {
    const result = await PythonManager.getAvailableConfigs()
    res.json({
      success: true,
      data: result
    })
  } catch (error: any) {
    logger.error('获取游戏配置列表失败:', error)
    res.status(500).json({
      success: false,
      error: '获取游戏配置列表失败',
      message: error.message
    })
  }
})

// 获取指定游戏配置的模板结构
router.get('/configs/schema/:configId', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { configId } = req.params
    const decodedConfigId = decodeURIComponent(configId)
    const result = await PythonManager.getConfigSchema(decodedConfigId)
    
    if (!result) {
      return res.status(404).json({
        success: false,
        error: '配置模板不存在'
      })
    }
    
    res.json({
      success: true,
      data: result
    })
  } catch (error: any) {
    logger.error('获取配置模板失败:', error)
    res.status(500).json({
      success: false,
      error: '获取配置模板失败',
      message: error.message
    })
  }
})

// 读取实例的游戏配置文件
router.get('/:instanceId/configs/:configId', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!instanceManager) {
      return res.status(500).json({ 
        success: false, 
        error: '实例管理器未初始化' 
      })
    }
    
    const { instanceId, configId } = req.params
    const decodedConfigId = decodeURIComponent(configId)
    
    // 获取实例信息
    const instance = instanceManager.getInstance(instanceId)
    if (!instance) {
      return res.status(404).json({
        success: false,
        error: '实例不存在'
      })
    }
    
    // 获取配置模板
    const schema = await PythonManager.getConfigSchema(decodedConfigId)
    if (!schema) {
      return res.status(404).json({
        success: false,
        error: '配置模板不存在'
      })
    }
    
    // 从配置模板中获取正确的解析器类型
    const parser = schema.meta?.parser || 'configobj'
    logger.info(`使用解析器: ${parser} 读取配置: ${decodedConfigId}`)
    
    // 读取配置文件
    const result = await PythonManager.readGameConfig(
      instance.workingDirectory,
      schema,
      parser
    )
    
    res.json({
      success: true,
      data: result
    })
  } catch (error: any) {
    logger.error('读取游戏配置失败:', error)
    res.status(500).json({
      success: false,
      error: '读取游戏配置失败',
      message: error.message
    })
  }
})

// 保存实例的游戏配置文件
router.post('/:instanceId/configs/:configId', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!instanceManager) {
      return res.status(500).json({ 
        success: false, 
        error: '实例管理器未初始化' 
      })
    }
    
    const { instanceId, configId } = req.params
    const { configData } = req.body
    const decodedConfigId = decodeURIComponent(configId)
    
    if (!configData) {
      return res.status(400).json({
        success: false,
        error: '缺少配置数据'
      })
    }
    
    // 获取实例信息
    const instance = instanceManager.getInstance(instanceId)
    if (!instance) {
      return res.status(404).json({
        success: false,
        error: '实例不存在'
      })
    }
    
    // 获取配置模板
    const schema = await PythonManager.getConfigSchema(decodedConfigId)
    if (!schema) {
      return res.status(404).json({
        success: false,
        error: '配置模板不存在'
      })
    }
    
    // 从配置模板中获取正确的解析器类型
    const parser = schema.meta?.parser || 'configobj'
    logger.info(`使用解析器: ${parser} 保存配置: ${decodedConfigId}`)
    
    // 保存配置文件
    const result = await PythonManager.saveGameConfig(
      instance.workingDirectory,
      schema,
      configData,
      parser
    )
    
    if (result) {
      logger.info(`用户保存游戏配置: 实例=${instanceId}, 配置=${decodedConfigId}, 解析器=${parser}`)
      res.json({
        success: true,
        message: '配置保存成功'
      })
    } else {
      res.status(500).json({
        success: false,
        error: '配置保存失败'
      })
    }
  } catch (error: any) {
    logger.error('保存游戏配置失败:', error)
    res.status(500).json({
      success: false,
      error: '保存游戏配置失败',
      message: error.message
    })
  }
})

// Python环境重置功能已移除

// Python环境检测
router.get('/python/check', authenticateToken, async (req: Request, res: Response) => {
  try {
    const result = await PythonManager.checkPythonEnvironment()
    
    res.json({
      success: true,
      data: result
    })
  } catch (error: any) {
    logger.error('Python环境检测异常:', error)
    
    res.json({
      success: true,
      data: {
        available: false,
        error: `Python环境检测失败: ${error.message}`,
        platform: os.platform()
      }
    })
  }
})

// 导出设置函数和路由
export function setupInstanceRoutes(manager: InstanceManager) {
  setInstanceManager(manager)
  return router
}


// Get game version info from Steam API
router.get('/steam-version/:appId', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { appId } = req.params
    if (!appId || !/^\d+$/.test(appId)) {
      return res.status(400).json({ success: false, error: '无效的 AppID' })
    }
    // Fetch real-time version info from Steam store API (no key needed)
    let storeData: any = null
    try {
      const storeResp = await fetch(`https://store.steampowered.com/api/appdetails?appids=${appId}&l=schinese`, {
        headers: { 'User-Agent': 'GSM3/1.0' },
        signal: AbortSignal.timeout(5000)
      })
      const storeJson: any = await storeResp.json()
      if (storeJson[appId]?.success) {
        const d = storeJson[appId].data
        storeData = {
          name: d.name,
          type: d.type,
          releaseDate: d.release_date?.date,
          comingSoon: d.release_date?.coming_soon,
          buildid: d.buildid || '',
          isFree: d.is_free,
          headerImage: d.header_image,
          shortDescription: d.short_description
        }
      }
    } catch (err) {
      logger.warn('Steam store API request failed:', err)
    }

    // Try Steam Web API for build number if key is configured
    let buildData: any = null
    const steamApiKey = process.env.STEAM_API_KEY || ''
    if (steamApiKey) {
      try {
        const apiUrl = `https://api.steampowered.com/ISteamApps/GetAppBuildNumber/v1/?appid=${appId}&key=${steamApiKey}`
        const response = await fetch(apiUrl)
        const data = await response.json()
        buildData = data
      } catch (err) {
        logger.warn('Steam API request failed:', err)
      }
    }

    // Common Steam branches for popular dedicated servers
    const commonBranches: Record<string, string[]> = {
      '2394010': ['public', 'experimental'],
      '252490': ['public', 'staging'],
      '294420': ['public', 'staging'],
      '346110': ['public', 'beta'],
      '108600': ['public', 'beta'],
      '285720': ['public', 'latest_experimental'],
      '892970': ['public', 'beta'],
      '427730': ['public', 'beta'],
      '294850': ['public', 'beta'],
      '413150': ['public', 'beta'],
      '648800': ['public', 'beta'],
      '2054970': ['public', 'experimental'],
      '730': ['public', 'beta'],
    }

    // Merge local config versions with common branches
    const paths = [
      path.join(process.cwd(), 'data', 'games', 'installgame.json'),
      path.join(process.cwd(), 'server', 'data', 'games', 'installgame.json'),
    ]
    let localInfo: any = {}
    for (const p of paths) {
      try {
        const raw = JSON.parse(await fs.readFile(p, 'utf-8'))
        for (const [key, info] of Object.entries(raw)) {
          const g = info as any
          if (String(g.appid) === appId) {
            localInfo = { gameKey: key, gameName: g.game_nameCN, versions: g.versions || [], category: g.category }
            break
          }
        }
        break
      } catch {}
    }

    // Combine branches: local config + common branches, dedupe, ensure public first
    const branchSet = new Set<string>(['public'])
    ;(localInfo.versions || []).forEach((v: string) => branchSet.add(v))
    ;(commonBranches[appId] || []).forEach((v: string) => branchSet.add(v))
    const versions = Array.from(branchSet)

    res.json({
      success: true,
      data: {
        appId,
        name: storeData?.name || localInfo.gameName || appId,
        gameKey: localInfo.gameKey,
        currentBuildId: buildData?.response?.success === 1 ? buildData.response?.data?.lastbuild : (storeData?.buildid || ''),
        releaseDate: storeData?.releaseDate,
        comingSoon: storeData?.comingSoon,
        versions,
        source: storeData ? 'steam_store' : 'local'
      }
    })
  } catch (error: any) {
    logger.error('Steam version query failed:', error)
    res.status(500).json({ success: false, error: '查询失败', message: error.message })
  }
})



// Search games from Steam store (no API key needed)
router.get('/steam-search', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { q } = req.query
    if (!q || typeof q !== 'string' || q.trim().length < 2) {
      return res.status(400).json({ success: false, error: '请输入至少2个字符的搜索关键词' })
    }
    // Search via Steam store
    const searchUrl = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(q)}&l=schinese&cc=cn`
    const resp = await fetch(searchUrl)
    const data: any = await resp.json()
    if (data?.items) {
      const games = data.items
        .filter((item: any) => item.type === 'app' || item.type === 'game')
        .map((item: any) => ({
          appId: item.id,
          name: item.name,
          price: item.price?.final_formatted || (item.is_free ? 'Free' : 'N/A'),
          image: `https://steamcdn-a.akamaihd.net/steam/apps/${item.id}/header.jpg`,
          url: `https://store.steampowered.com/app/${item.id}`,
          platform: item.platforms || { windows: true, linux: false, mac: false }
        }))
      return res.json({ success: true, data: games, total: data.total })
    }
    res.json({ success: true, data: [], total: 0 })
  } catch (error: any) {
    logger.error('Steam search failed:', error)
    res.status(500).json({ success: false, error: '搜索失败', message: error.message })
  }
})


export default router
// ============ 服务器管理增强接口 ============

// 读取服务器配置文件（server.properties / banned-players.json 等）
router.get('/:id/server-config/:file', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!instanceManager) return res.status(500).json({ success: false, error: '实例管理器未初始化' })
    const instance = instanceManager.getInstance(req.params.id)
    if (!instance) return res.status(404).json({ success: false, error: '实例不存在' })
    
    const file = req.params.file
    // 白名单允许的文件（防目录穿越）
    const allowed = ['server.properties', 'banned-players.json', 'banned-ips.json', 'whitelist.json', 'ops.json', 'permissions.yml']
    if (!allowed.includes(file)) return res.status(400).json({ success: false, error: '不允许访问该文件' })
    
    const filePath = path.join(instance.workingDirectory, file)
    if (!fsSync.existsSync(filePath)) {
      return res.json({ success: true, data: { file, exists: false, content: '' } })
    }
    const content = await fs.readFile(filePath, 'utf-8')
    res.json({ success: true, data: { file, exists: true, content } })
  } catch (error: any) {
    res.status(500).json({ success: false, error: '读取配置失败', message: error.message })
  }
})

// 保存服务器配置文件
router.put('/:id/server-config/:file', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!instanceManager) return res.status(500).json({ success: false, error: '实例管理器未初始化' })
    const instance = instanceManager.getInstance(req.params.id)
    if (!instance) return res.status(404).json({ success: false, error: '实例不存在' })
    
    const file = req.params.file
    const allowed = ['server.properties', 'banned-players.json', 'banned-ips.json', 'whitelist.json', 'ops.json', 'permissions.yml']
    if (!allowed.includes(file)) return res.status(400).json({ success: false, error: '不允许访问该文件' })
    
    const { content } = req.body
    if (typeof content !== 'string') return res.status(400).json({ success: false, error: '内容必须是字符串' })
    
    const filePath = path.join(instance.workingDirectory, file)
    await fs.writeFile(filePath, content, 'utf-8')
    res.json({ success: true, message: '配置已保存（重启服务器生效）' })
  } catch (error: any) {
    res.status(500).json({ success: false, error: '保存配置失败', message: error.message })
  }
})

// 创建世界备份（tar.gz）
router.post('/:id/backup', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!instanceManager) return res.status(500).json({ success: false, error: '实例管理器未初始化' })
    const instance = instanceManager.getInstance(req.params.id)
    if (!instance) return res.status(404).json({ success: false, error: '实例不存在' })
    
    const backupsDir = path.join(instance.workingDirectory, '..', 'backups')
    const backupName = 'backup-' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '.tar.gz'
    await fs.mkdir(backupsDir, { recursive: true })
    
    const backupPath = path.join(backupsDir, backupName)
    // 打包工作目录（排除 backups 自身）
    const { execFile } = await import('child_process')
    const { promisify } = await import('util')
    const execFileAsync = promisify(execFile)
    
    // 用 tar 打包（排除 node_modules 和 backups）
    const excludes = ['--exclude=backups', '--exclude=node_modules', '--exclude=.git', '--exclude=logs']
    const files = fsSync.readdirSync(instance.workingDirectory).filter(f => f !== 'backups' && f !== 'node_modules' && f !== 'logs')
    
    // 并行处理（在服务器上 exec）
    await new Promise<void>((resolve, reject) => {
      const { spawn } = require('child_process') as any
      const args = ['-czf', backupPath, ...excludes, ...files]
      const proc = spawn('tar', args, { cwd: instance.workingDirectory })
      proc.on('close', (code: number) => code === 0 ? resolve() : reject(new Error('tar 退出码 ' + code)))
      proc.on('error', (e: any) => reject(e))
    })
    
    const stats = fsSync.statSync(backupPath)
    res.json({ success: true, message: '备份完成', data: { name: backupName, size: stats.size, path: backupPath } })
  } catch (error: any) {
    res.status(500).json({ success: false, error: '备份失败', message: error.message })
  }
})

// 备份列表
router.get('/:id/backups', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!instanceManager) return res.status(500).json({ success: false, error: '实例管理器未初始化' })
    const instance = instanceManager.getInstance(req.params.id)
    if (!instance) return res.status(404).json({ success: false, error: '实例不存在' })
    
    const backupsDir = path.join(instance.workingDirectory, '..', 'backups')
    if (!fsSync.existsSync(backupsDir)) return res.json({ success: true, data: [] })
    
    const files = fsSync.readdirSync(backupsDir)
      .filter(f => f.endsWith('.tar.gz'))
      .map(f => {
        const st = fsSync.statSync(path.join(backupsDir, f))
        return { name: f, size: st.size, mtime: st.mtime }
      })
      .sort((a: any, b: any) => b.mtime - a.mtime)
    res.json({ success: true, data: files })
  } catch (error: any) {
    res.status(500).json({ success: false, error: '获取备份列表失败', message: error.message })
  }
})

// 恢复备份（先停服，恢复后提示重启）
router.post('/:id/backups/:name/restore', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!instanceManager) return res.status(500).json({ success: false, error: '实例管理器未初始化' })
    const instance = instanceManager.getInstance(req.params.id)
    if (!instance) return res.status(404).json({ success: false, error: '实例不存在' })
    
    const name = req.params.name
    if (!name.endsWith('.tar.gz') || name.includes('..')) {
      return res.status(400).json({ success: false, error: '非法备份文件名' })
    }
    
    const backupsDir = path.join(instance.workingDirectory, '..', 'backups')
    const backupPath = path.join(backupsDir, name)
    if (!fsSync.existsSync(backupPath)) return res.status(404).json({ success: false, error: '备份不存在' })
    
    // 先停止实例
    if (instance.status === 'running') {
      try { await instanceManager.stopInstance(instance.id) } catch {}
      await new Promise(r => setTimeout(r, 3000))
    }
    
    // 清空工作目录（保留 paper.jar/eula 等）并恢复
    const keepFiles = ['paper.jar', 'eula.txt', 'server.properties', 'spigot.yml', 'bukkit.yml', 'paper.yml', 'config']
    const files = fsSync.readdirSync(instance.workingDirectory)
    for (const f of files) {
      if (keepFiles.includes(f)) continue
      const fp = path.join(instance.workingDirectory, f)
      fsSync.rmSync(fp, { recursive: true, force: true })
    }
    
    const { spawn } = require('child_process') as any
    await new Promise<void>((resolve, reject) => {
      const proc = spawn('tar', ['-xzf', backupPath, '-C', instance.workingDirectory])
      proc.on('close', (code: number) => code === 0 ? resolve() : reject(new Error('tar 退出码 ' + code)))
      proc.on('error', (e: any) => reject(e))
    })
    
    res.json({ success: true, message: '恢复完成，请启动服务器' })
  } catch (error: any) {
    res.status(500).json({ success: false, error: '恢复失败', message: error.message })
  }
})

// 系统资源监控（该实例所在服务器）
router.get('/:id/resources', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { execFile } = await import('child_process')
    const { promisify } = await import('util')
    const execFileAsync = promisify(execFile)
    
    const [cpuOut, memOut] = await Promise.all([
      execFileAsync('ps', ['-p', process.pid.toString(), '-o', '%cpu=']).catch(() => ({ stdout: '0' })),
      execFileAsync('free', ['-m']).catch(() => ({ stdout: '' })),
    ])
    res.json({ success: true, data: { cpu: cpuOut.stdout.trim(), memory: memOut.stdout } })
  } catch (error: any) {
    res.status(500).json({ success: false, error: '获取资源失败', message: error.message })
  }
})

