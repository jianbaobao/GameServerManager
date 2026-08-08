import { Router, Request, Response } from 'express'
import fs from 'fs/promises'
import fsSync from 'fs'
import path from 'path'
import { promises as fsPromises } from 'fs'
import { authenticateToken } from '../middleware/auth.js'
import logger from '../utils/logger.js'

const router = Router()

// ============ 各游戏配置 schema ============
interface GameField {
  key: string
  label: string
  type: 'text' | 'number' | 'select' | 'toggle' | 'password'
  options?: string[]
  hint?: string
  section?: string       // ini/xml 的节
  attr?: string          // xml 属性名
}
interface GameSchema {
  gameKey: string
  gameName: string
  icon: string
  file: string            // 相对 workingDirectory 的配置文件路径
  format: 'properties' | 'ini' | 'xml' | 'cfg' | 'json'
  fields: GameField[]
}

const GAME_SCHEMAS: GameSchema[] = [
  {
    gameKey: 'minecraft',
    gameName: '我的世界',
    icon: '⛏️',
    file: 'server.properties',
    format: 'properties',
    fields: [
      { key: 'motd', label: '服务器名称 (MOTD)', type: 'text', hint: '玩家列表显示的服务器名' },
      { key: 'difficulty', label: '难度', type: 'select', options: ['peaceful', 'easy', 'normal', 'hard'] },
      { key: 'gamemode', label: '默认游戏模式', type: 'select', options: ['survival', 'creative', 'adventure', 'spectator'] },
      { key: 'pvp', label: '玩家对战 (PVP)', type: 'toggle' },
      { key: 'online-mode', label: '正版验证', type: 'toggle', hint: '关闭=离线可进' },
      { key: 'white-list', label: '白名单', type: 'toggle' },
      { key: 'max-players', label: '最大玩家数', type: 'number' },
      { key: 'view-distance', label: '视距', type: 'number' },
      { key: 'server-port', label: '端口', type: 'number' },
      { key: 'level-name', label: '世界名称', type: 'text' },
      { key: 'spawn-monsters', label: '生成怪物', type: 'toggle' },
      { key: 'spawn-animals', label: '生成动物', type: 'toggle' },
      { key: 'spawn-npcs', label: '生成NPC', type: 'toggle' },
      { key: 'enable-command-block', label: '命令方块', type: 'toggle' },
      { key: 'allow-flight', label: '允许飞行', type: 'toggle' },
      { key: 'hardcore', label: '极限模式', type: 'toggle' },
    ],
  },
  {
    gameKey: 'palworld',
    gameName: '幻兽帕鲁',
    icon: '🐾',
    file: 'Pal/Saved/Config/LinuxServer/PalWorldSettings.ini',
    format: 'ini',
    fields: [
      { key: 'ServerName', label: '服务器名称', type: 'text', section: '/Script/Pal.PalGameWorldSettings', hint: '玩家列表显示的服务器名' },
      { key: 'ServerDescription', label: '服务器描述', type: 'text', section: '/Script/Pal.PalGameWorldSettings' },
      { key: 'ServerPassword', label: '服务器密码', type: 'password', section: '/Script/Pal.PalGameWorldSettings', hint: '留空=无密码' },
      { key: 'PublicPort', label: '端口', type: 'number', section: '/Script/Pal.PalGameWorldSettings' },
      { key: 'MaxPlayers', label: '最大玩家数', type: 'number', section: '/Script/Pal.PalGameWorldSettings', hint: '默认32' },
      { key: 'Difficulty', label: '难度', type: 'select', options: ['None', 'Casual', 'Normal', 'Hard'], section: '/Script/Pal.PalGameWorldSettings' },
      { key: 'bIsPvP', label: 'PVP 模式', type: 'toggle', section: '/Script/Pal.PalGameWorldSettings' },
      { key: 'bHardcore', label: '硬核模式', type: 'toggle', section: '/Script/Pal.PalGameWorldSettings' },
      { key: 'DayTimeSpeedRate', label: '白天速度', type: 'number', section: '/Script/Pal.PalGameWorldSettings' },
      { key: 'NightTimeSpeedRate', label: '夜晚速度', type: 'number', section: '/Script/Pal.PalGameWorldSettings' },
      { key: 'ExpRate', label: '经验倍率', type: 'number', section: '/Script/Pal.PalGameWorldSettings', hint: '默认1.0' },
      { key: 'PalCaptureRate', label: '帕鲁捕获率', type: 'number', section: '/Script/Pal.PalGameWorldSettings' },
      { key: 'DropItemAliveMaxHours', label: '掉落物存活时间', type: 'number', section: '/Script/Pal.PalGameWorldSettings' },
    ],
  },
  {
    gameKey: '7_days_to_die',
    gameName: '七日杀',
    icon: '🧟',
    file: 'serverconfig.xml',
    format: 'xml',
    fields: [
      { key: 'ServerName', label: '服务器名称', type: 'text', attr: 'name' },
      { key: 'ServerPort', label: '端口', type: 'number', attr: 'value' },
      { key: 'ServerPassword', label: '密码', type: 'password', attr: 'value' },
      { key: 'ServerMaxPlayerCount', label: '最大玩家数', type: 'number', attr: 'value' },
      { key: 'GameDifficulty', label: '游戏难度', type: 'select', options: ['1', '2', '3', '4', '5', '6'], attr: 'value', hint: '1最简单-6最难' },
      { key: 'ZombieMove', label: '僵尸速度', type: 'select', options: ['Walk', 'Jog', 'Run', 'Sprint', 'Nightmare'], attr: 'value' },
      { key: 'DayLightLength', label: '白天时长(分钟)', type: 'number', attr: 'value' },
      { key: 'DayNightLength', label: '昼夜时长(分钟)', type: 'number', attr: 'value' },
      { key: 'BloodMoonFrequency', label: '血月频率(天)', type: 'number', attr: 'value', hint: '0=关闭' },
      { key: 'XPMultiplier', label: '经验倍率', type: 'number', attr: 'value' },
      { key: 'LootAbundance', label: '战利品丰富度', type: 'number', attr: 'value' },
      { key: 'AirDropFrequency', label: '空投频率', type: 'number', attr: 'value' },
      { key: 'DropOnDeath', label: '死亡掉落', type: 'select', options: ['0', '1', '2', '3'], attr: 'value', hint: '0全部/1工具/2背包/3除了工具' },
    ],
  },
  {
    gameKey: 'rust',
    gameName: '腐蚀(Rust)',
    icon: '🔧',
    file: 'server.cfg',
    format: 'cfg',
    fields: [
      { key: 'server.hostname', label: '服务器名称', type: 'text' },
      { key: 'server.description', label: '服务器描述', type: 'text' },
      { key: 'server.port', label: '端口', type: 'number' },
      { key: 'server.maxplayers', label: '最大玩家数', type: 'number' },
      { key: 'server.pvp', label: 'PVP', type: 'toggle' },
      { key: 'server.seed', label: '世界种子', type: 'number' },
      { key: 'server.worldsize', label: '世界大小', type: 'number' },
      { key: 'server.identity', label: '存档名称', type: 'text' },
      { key: 'server.saveinterval', label: '自动保存间隔(秒)', type: 'number' },
      { key: 'server.tickrate', label: 'Tick 频率', type: 'number', hint: '默认30' },
    ],
  },
  {
    gameKey: 'terraria',
    gameName: '泰拉瑞亚',
    icon: '⛏️',
    file: 'serverconfig.txt',
    format: 'properties',
    fields: [
      { key: 'world', label: '世界文件', type: 'text', hint: '如 world.wld' },
      { key: 'autocreate', label: '自动创建世界', type: 'select', options: ['1', '2', '3'], hint: '1小/2中/3大' },
      { key: 'seed', label: '世界种子', type: 'text' },
      { key: 'port', label: '端口', type: 'number' },
      { key: 'maxplayers', label: '最大玩家数', type: 'number' },
      { key: 'password', label: '密码', type: 'password' },
      { key: 'motd', label: '服务器名称', type: 'text' },
      { key: 'difficulty', label: '难度', type: 'select', options: ['0', '1', '2', '3'], hint: '0经典/1专家/2大师/3旅途' },
      { key: 'secure', label: '防作弊', type: 'toggle' },
      { key: 'npcstream', label: 'NPC 同步距离', type: 'number' },
    ],
  },
  {
    gameKey: 'valheim',
    gameName: '英灵神殿',
    icon: '⚔️',
    file: '',   // Valheim 用启动参数，无配置文件
    format: 'properties',
    fields: [
      { key: 'name', label: '服务器名称', type: 'text', hint: '通过启动参数设置' },
      { key: 'password', label: '密码', type: 'password', hint: '通过启动参数设置' },
      { key: 'port', label: '端口', type: 'number', hint: '默认2456' },
    ],
  },
  {
    gameKey: 'counter',
    gameName: '反恐精英2',
    icon: '🎯',
    file: 'cs2/cfg/server.cfg',
    format: 'cfg',
    fields: [
      { key: 'hostname', label: '服务器名称', type: 'text' },
      { key: 'sv_password', label: '密码', type: 'password' },
      { key: 'mp_maxplayers', label: '最大玩家数', type: 'number' },
      { key: 'mp_roundtime', label: '回合时长(分钟)', type: 'number' },
      { key: 'mp_restartgame', label: '回合数', type: 'number' },
      { key: 'bot_quota', label: '机器人数量', type: 'number' },
      { key: 'sv_cheats', label: '作弊模式', type: 'toggle' },
      { key: 'sv_pausable', label: '允许暂停', type: 'toggle' },
    ],
  },
  {
    gameKey: 'ark',
    gameName: '方舟生存进化',
    icon: '🦖',
    file: 'ShooterGame/Saved/Config/LinuxServer/GameUserSettings.ini',
    format: 'ini',
    fields: [
      { key: 'SessionName', label: '服务器名称', type: 'text', section: '/Script/ShooterGame.ShooterGameUserSettings' },
      { key: 'ServerPassword', label: '密码', type: 'password', section: '/Script/ShooterGame.ShooterGameUserSettings' },
      { key: 'MaxPlayers', label: '最大玩家数', type: 'number', section: '/Script/ShooterGame.ShooterGameUserSettings' },
      { key: 'DifficultyOffset', label: '难度', type: 'number', section: '/Script/ShooterGame.ShooterGameUserSettings' },
      { key: 'XPMultiplier', label: '经验倍率', type: 'number', section: '/Script/ShooterGame.ShooterGameUserSettings' },
      { key: 'TamingSpeedMultiplier', label: '驯服速度', type: 'number', section: '/Script/ShooterGame.ShooterGameUserSettings' },
      { key: 'HarvestAmountMultiplier', label: '采集倍率', type: 'number', section: '/Script/ShooterGame.ShooterGameUserSettings' },
      { key: 'bPvP', label: 'PVP', type: 'toggle', section: '/Script/ShooterGame.ShooterGameUserSettings' },
    ],
  },
  {
    gameKey: 'satisfactory',
    gameName: '幸福工厂',
    icon: '🏭',
    file: 'GameUserSettings.ini',
    format: 'ini',
    fields: [
      { key: 'ServerName', label: '服务器名称', type: 'text', section: '/Script/FactoryGame.FGGameUserSettings' },
      { key: 'ServerPassword', label: '密码', type: 'password', section: '/Script/FactoryGame.FGGameUserSettings' },
      { key: 'AutoSaveInterval', label: '自动保存间隔', type: 'number', section: '/Script/FactoryGame.FGGameUserSettings' },
      { key: 'MaxPlayers', label: '最大玩家数', type: 'number', section: '/Script/FactoryGame.FGGameUserSettings' },
    ],
  },
]

// ============ 解析器 ============
function parseProperties(content: string): Record<string, string> {
  const out: Record<string, string> = {}
  content.split(/\r?\n/).forEach(line => {
    const m = line.match(/^\s*([a-zA-Z0-9_.-]+)\s*=\s*(.*)$/)
    if (m) out[m[1]] = m[2].trim()
  })
  return out
}

function parseIni(content: string): Record<string, string> {
  const out: Record<string, string> = {}
  let section = ''
  content.split(/\r?\n/).forEach(line => {
    const s = line.match(/^\s*\[([^\]]+)\]\s*$/)
    if (s) { section = s[1]; return }
    const m = line.match(/^\s*([a-zA-Z0-9_.-]+)\s*=\s*(.*)$/)
    if (m) out[m[1]] = m[2].trim()
  })
  return out
}

function parseXml(content: string): Record<string, string> {
  const out: Record<string, string> = {}
  const re = /<([a-zA-Z0-9_]+)[^>]*\bname="([^"]*)"[^>]*\bvalue="([^"]*)"/g
  let m: RegExpExecArray | null
  while ((m = re.exec(content)) !== null) {
    out[m[2]] = m[3]
  }
  return out
}

function parseCfg(content: string): Record<string, string> {
  const out: Record<string, string> = {}
  content.split(/\r?\n/).forEach(line => {
    const m = line.match(/^\s*([a-zA-Z0-9_.-]+)\s+["']?([^"'\n]+)?["']?\s*$/)
    if (m && m[2] !== undefined) out[m[1]] = m[2].trim()
  })
  return out
}

function serializeProperties(data: Record<string, string>, original: string): string {
  const lines = original.split(/\r?\n/)
  const keys = new Set(Object.keys(data))
  const updated = lines.map(line => {
    const m = line.match(/^\s*([a-zA-Z0-9_.-]+)\s*=/)
    if (m && keys.has(m[1])) return `${m[1]}=${data[m[1]]}`
    return line
  })
  const existing = new Set(lines.map(l => { const m = l.match(/^\s*([a-zA-Z0-9_.-]+)\s*=/); return m ? m[1] : null }).filter(Boolean))
  Object.keys(data).filter(k => !existing.has(k)).forEach(k => updated.push(`${k}=${data[k]}`))
  return updated.join('\n')
}

function serializeIni(data: Record<string, string>, original: string): string {
  const lines = original.split(/\r?\n/)
  const keys = new Set(Object.keys(data))
  const updated = lines.map(line => {
    const m = line.match(/^\s*([a-zA-Z0-9_.-]+)\s*=\s*(.*)$/)
    if (m && keys.has(m[1])) return `${m[1]}=${data[m[1]]}`
    return line
  })
  const existing = new Set(lines.map(l => { const m = l.match(/^\s*([a-zA-Z0-9_.-]+)\s*=/); return m ? m[1] : null }).filter(Boolean))
  Object.keys(data).filter(k => !existing.has(k)).forEach(k => updated.push(`${k}=${data[k]}`))
  return updated.join('\n')
}

function serializeXml(data: Record<string, string>, original: string): string {
  let out = original
  Object.entries(data).forEach(([name, value]) => {
    const re = new RegExp(`(<[a-zA-Z0-9_]+[^>]*\bname="${name}"[^>]*\bvalue=")[^"]*(")`)
    if (re.test(out)) {
      out = out.replace(re, `$1${value}$2`)
    } else {
      // 追加新配置项
      out = out.replace(/(<\/Property>|<\/serverconfig>)/, `  <property name="${name}" value="${value}" />\n$1`)
    }
  })
  return out
}

function serializeCfg(data: Record<string, string>, original: string): string {
  const lines = original.split(/\r?\n/)
  const keys = new Set(Object.keys(data))
  const updated = lines.map(line => {
    const m = line.match(/^\s*([a-zA-Z0-9_.-]+)\s+/)
    if (m && keys.has(m[1])) return `${m[1]} ${data[m[1]]}`
    return line
  })
  const existing = new Set(lines.map(l => { const m = l.match(/^\s*([a-zA-Z0-9_.-]+)\s+/); return m ? m[1] : null }).filter(Boolean))
  Object.keys(data).filter(k => !existing.has(k)).forEach(k => updated.push(`${k} ${data[k]}`))
  return updated.join('\n')
}

// ============ 路由 ============

// 获取某实例对应游戏的配置 schema
router.get('/schema/:instanceId', authenticateToken, async (req: Request, res: Response) => {
  try {
    const instanceId = req.params.instanceId
    const instance = getInstanceById(instanceId)
    if (!instance) return res.status(404).json({ success: false, error: '实例不存在' })
    const gameKey = (instance.gameKey || instance.name || '').toLowerCase()
    let schema: GameSchema | null = null
    for (const s of GAME_SCHEMAS) {
      if (gameKey.includes(s.gameKey.toLowerCase())) { schema = s; break }
    }
    // 实例类型匹配（minecraft-java/bedrock）
    if (!schema && (instance.instanceType || '').includes('minecraft')) schema = GAME_SCHEMAS[0]
    if (!schema) {
      return res.json({ success: false, error: '该游戏暂不支持可视化配置（可用文件管理编辑配置文件）', data: { gameKey } })
    }
    res.json({ success: true, data: schema })
  } catch (error: any) {
    res.status(500).json({ success: false, error: '获取配置模板失败', message: error.message })
  }
})

// 读取实例游戏配置（解析成字段值）
router.get('/:instanceId', authenticateToken, async (req: Request, res: Response) => {
  try {
    const instance = getInstanceById(req.params.instanceId)
    if (!instance) return res.status(404).json({ success: false, error: '实例不存在' })
    const gameKey = (instance.gameKey || instance.name || '').toLowerCase()
    let schema: GameSchema | null = null
    for (const s of GAME_SCHEMAS) {
      if (gameKey.includes(s.gameKey.toLowerCase())) { schema = s; break }
    }
    if (!schema && (instance.instanceType || '').includes('minecraft')) schema = GAME_SCHEMAS[0]
    if (!schema || !schema.file) {
      return res.json({ success: false, error: '该游戏无配置文件或暂不支持', data: { file: '', exists: false } })
    }
    const filePath = path.join(instance.workingDirectory, schema.file)
    if (!fsSync.existsSync(filePath)) {
      return res.json({ success: false, error: `配置文件不存在: ${schema.file}（服务器首次启动后生成）`, data: { file: schema.file, exists: false } })
    }
    const content = await fs.readFile(filePath, 'utf-8')
    let values: Record<string, string> = {}
    if (schema.format === 'ini') values = parseIni(content)
    else if (schema.format === 'xml') values = parseXml(content)
    else if (schema.format === 'cfg') values = parseCfg(content)
    else values = parseProperties(content)
    res.json({ success: true, data: { file: schema.file, exists: true, format: schema.format, values, content } })
  } catch (error: any) {
    res.status(500).json({ success: false, error: '读取配置失败', message: error.message })
  }
})

// 保存实例游戏配置
router.put('/:instanceId', authenticateToken, async (req: Request, res: Response) => {
  try {
    const instance = getInstanceById(req.params.instanceId)
    if (!instance) return res.status(404).json({ success: false, error: '实例不存在' })
    const gameKey = (instance.gameKey || instance.name || '').toLowerCase()
    let schema: GameSchema | null = null
    for (const s of GAME_SCHEMAS) {
      if (gameKey.includes(s.gameKey.toLowerCase())) { schema = s; break }
    }
    if (!schema && (instance.instanceType || '').includes('minecraft')) schema = GAME_SCHEMAS[0]
    if (!schema || !schema.file) return res.status(400).json({ success: false, error: '该游戏无配置文件或暂不支持' })

    const { values } = req.body
    if (!values || typeof values !== 'object') return res.status(400).json({ success: false, error: 'values 必须是对象' })

    const filePath = path.join(instance.workingDirectory, schema.file)
    let original = ''
    if (fsSync.existsSync(filePath)) original = await fs.readFile(filePath, 'utf-8')

    let output = ''
    if (schema.format === 'ini') output = serializeIni(values, original)
    else if (schema.format === 'xml') output = serializeXml(values, original)
    else if (schema.format === 'cfg') output = serializeCfg(values, original)
    else output = serializeProperties(values, original)

    await fsPromises.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, output, 'utf-8')
    res.json({ success: true, message: `${schema.gameName} 配置已保存（重启服务器生效）` })
  } catch (error: any) {
    res.status(500).json({ success: false, error: '保存配置失败', message: error.message })
  }
})

// 实例管理器引用（从注册时传入）
let instanceManagerRef: any = null
export function setInstanceManagerForGameConfig(im: any) { instanceManagerRef = im }

function getInstanceById(id: string): any {
  try {
    if (instanceManagerRef) {
      const inst = instanceManagerRef.getInstance(id)
      if (inst) return inst
    }
  } catch {}
  return null
}

export default router
