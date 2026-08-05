// ============================================================
// 内置网络工具模块：Steam访问加速 + frpc内网穿透 + EasyTier虚拟局域网
// ============================================================
import { Router, Request, Response } from 'express'
import { promises as fs } from 'fs'
import fsSync from 'fs'
import path from 'path'
import os from 'os'
import { execFile, spawn, spawnSync } from 'child_process'
import https from 'https'
import { promisify } from 'util'
import winston from 'winston'
import { authenticateToken } from '../middleware/auth.js'
import logger from '../utils/logger.js'
import { isPrivateHost } from '../utils/networkSecurity.js'

const execFileAsync = promisify(execFile)
const router = Router()

// 所有接口需要认证
router.use(authenticateToken)

// ---------- 工具类 ----------
const getHostsPath = (): string => {
  return process.platform === 'win32'
    ? path.join(process.env.WINDIR || 'C:\\Windows', 'System32', 'drivers', 'etc', 'hosts')
    : '/etc/hosts'
}

const getLibDir = (): string => path.join(process.cwd(), 'data', 'lib')

// ---------- Steam 访问加速 ----------
const STEAM_DOMAINS = [
  'store.steampowered.com',
  'steamcommunity.com',
  'api.steampowered.com',
  'login.steampowered.com',
  'cdn.cloudflare.steamstatic.com',
  'media.steampowered.com',
  'client-update.akamai.steamstatic.com',
  'client-download.steamstatic.com',
  'steamcdn-a.akamaihd.net',
]

// 内置公共解析节点（阿里/腾讯/谷歌 DNS 查询备用 IP 表）
const STEAM_ACCEL_BEGIN = '# === GSM3 Steam Accel BEGIN ==='
const STEAM_ACCEL_END = '# === GSM3 Steam Accel END ==='

// 通过 DNS 查询获取域名的可用 IP（取第一个结果）
async function resolveDomain(domain: string): Promise<string[]> {
  const ips: string[] = []
  const dnsServers = ['223.5.5.5', '119.29.29.29', '8.8.8.8']
  for (const dns of dnsServers) {
    try {
      const { stdout } = await execFileAsync('nslookup', [domain, dns], { timeout: 5000 })
      // 解析 nslookup 输出中的 IPv4 地址
      const matches = stdout.match(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g) || []
      for (const m of matches) {
        if (m !== dns && !ips.includes(m)) ips.push(m)
      }
      if (ips.length > 0) break
    } catch {}
  }
  return ips
}

// 获取当前加速状态
async function getSteamAccelStatus(): Promise<any> {
  const hostsPath = getHostsPath()
  let content = ''
  try { content = await fs.readFile(hostsPath, 'utf-8') } catch { return { enabled: false, error: '无法读取 hosts 文件' } }
  const inRange = content.includes(STEAM_ACCEL_BEGIN)
  return { enabled: inRange, hostsPath, domainCount: STEAM_DOMAINS.length }
}

router.get('/steam-accel/status', async (_req: Request, res: Response) => {
  try {
    res.json({ success: true, data: await getSteamAccelStatus() })
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message })
  }
})

router.post('/steam-accel/enable', async (req: Request, res: Response) => {
  try {
    const hostsPath = getHostsPath()
    let content = ''
    try { content = await fs.readFile(hostsPath, 'utf-8') } catch {}

    // 先移除旧的加速块
    let cleanContent = content.replace(new RegExp(`${STEAM_ACCEL_BEGIN}[\\s\\S]*?${STEAM_ACCEL_END}\\n?`, 'g'), '')

    // 解析域名 IP
    const entries: string[] = []
    for (const domain of STEAM_DOMAINS) {
      const ips = await resolveDomain(domain)
      const ip = ips[0] || '0.0.0.0'
      entries.push(`${ip} ${domain}`)
      // 也加速 www 和 dl 子域
      entries.push(`${ip} dl.${domain}`)
      entries.push(`${ip} www.${domain}`)
    }

    // 备份原 hosts
    try { await fs.copyFile(hostsPath, hostsPath + '.gsm3.bak') } catch {}

    const block = `${STEAM_ACCEL_BEGIN}\n# 由 GSM3 Steam 加速插件管理，禁用后自动还原\n${entries.join('\n')}\n${STEAM_ACCEL_END}\n`
    await fs.writeFile(hostsPath, cleanContent + '\n' + block, 'utf-8')

    res.json({ success: true, data: { enabled: true, entries: entries.length } })
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message })
  }
})

router.post('/steam-accel/disable', async (_req: Request, res: Response) => {
  try {
    const hostsPath = getHostsPath()
    let content = ''
    try { content = await fs.readFile(hostsPath, 'utf-8') } catch {}
    const cleanContent = content.replace(new RegExp(`${STEAM_ACCEL_BEGIN}[\\s\\S]*?${STEAM_ACCEL_END}\\n?`, 'g'), '')
    await fs.writeFile(hostsPath, cleanContent, 'utf-8')
    res.json({ success: true, data: { enabled: false } })
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message })
  }
})

// ---------- frpc 内网穿透 ----------
interface FrpcConfig {
  serverAddr: string
  serverPort: number
  token?: string
  overwriteConfig?: boolean
  proxies: Array<{ name: string; type: string; localIp: string; localPort: number; remotePort?: number; customDomains?: string }>
}

const getFrpcBinaryPath = (): string => {
  const name = process.platform === 'win32' ? 'frpc.exe' : 'frpc'
  return path.join(getLibDir(), name)
}

const getFrpcConfigPath = (): string => path.join(getLibDir(), 'frpc.toml')

const FRPC_DOWNLOADS: Record<string, string> = {
  linux_x64: 'https://github.com/fatedier/frp/releases/download/v0.61.1/frp_0.61.1_linux_amd64.tar.gz',
  linux_arm64: 'https://github.com/fatedier/frp/releases/download/v0.61.1/frp_0.61.1_linux_arm64.tar.gz',
  darwin_x64: 'https://github.com/fatedier/frp/releases/download/v0.61.1/frp_0.61.1_darwin_amd64.tar.gz',
  win32_x64: 'https://github.com/fatedier/frp/releases/download/v0.61.1/frp_0.61.1_windows_amd64.zip',
}

function getPlatformKey(): string {
  const p = process.platform
  const arch = os.arch()
  if (p === 'win32' && arch === 'x64') return 'win32_x64'
  if (p === 'linux' && arch === 'x64') return 'linux_x64'
  if (p === 'linux' && arch === 'arm64') return 'linux_arm64'
  if (p === 'darwin' && arch === 'x64') return 'darwin_x64'
  return 'linux_x64'
}

async function findLocalBinary(binName: string): Promise<string | null> {
  // 1. data/lib 下已解压的目录（如 frp_0.61.1_linux_amd64/frpc, easytier-*/easytier-core）
  try {
    const entries = await fs.readdir(getLibDir())
    for (const e of entries) {
      const full = path.join(getLibDir(), e)
      const found = await findBinaryInDir(full, binName)
      if (found) return found
    }
  } catch {}
  // 2. 项目自带 binaries 目录（随发布包分发，如 server/binaries/）
  const bundleDirs = [
    path.join(process.cwd(), 'server', 'binaries'),
    path.join(process.cwd(), 'binaries'),
  ]
  for (const d of bundleDirs) {
    try {
      const found = await findBinaryInDir(d, binName)
      if (found) return found
    } catch {}
  }
  return null
}

interface GitHubAsset { name: string; browser_download_url: string }

const getPlatformAliases = (): string[] => {
  switch (process.platform) {
    case 'win32': return ['windows', 'win32', 'win']
    case 'linux': return ['linux']
    case 'darwin': return ['darwin', 'macos', 'mac']
    default: return [process.platform]
  }
}

const getFrpArchAliases = (): string[] => {
  switch (process.arch) {
    case 'x64': return ['amd64', 'x86_64', 'x64']
    case 'arm64': return ['arm64', 'aarch64']
    case 'arm': return ['arm', 'arm_hf']
    default: return [process.arch]
  }
}

const isSupportedArchive = (name: string): boolean => {
  const n = name.toLowerCase()
  return n.endsWith('.zip') || n.endsWith('.tar.gz') || n.endsWith('.tgz')
}

const scoreFrpAsset = (name: string): number => {
  const n = name.toLowerCase()
  if (!isSupportedArchive(n)) return -1
  if (!n.startsWith('frp_')) return -1
  if (n.includes('android')) return -1
  const hasPlatform = getPlatformAliases().some(a => n.includes(a))
  const hasArch = getFrpArchAliases().some(a => n.includes(a))
  if (!hasPlatform || !hasArch) return -1
  let score = 100
  if (n.includes('_' + getPlatformAliases()[0] + '_' + getFrpArchAliases()[0])) score += 20
  if (n.endsWith('.zip')) score += process.platform === 'win32' ? 8 : 2
  if (n.endsWith('.tar.gz') || n.endsWith('.tgz')) score += process.platform === 'win32' ? 2 : 8
  return score
}

const requestJson = async (url: string): Promise<any> => {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: { 'Accept': 'application/vnd.github+json', 'User-Agent': 'GSM3-NetworkTools' }
    }, response => {
      let body = ''
      response.on('data', chunk => { body += chunk })
      response.on('end', () => {
        if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
          try { reject(new Error(JSON.parse(body).message || 'HTTP ' + response.statusCode)) }
          catch { reject(new Error('HTTP ' + response.statusCode)) }
          return
        }
        try { resolve(JSON.parse(body)) } catch (e) { reject(e) }
      })
    }).on('error', reject)
  })
}

// 获取 frp 最新 release 并挑选适合当前平台的 asset（原版 scoreAsset 逻辑）
async function fetchLatestFrpAsset(): Promise<GitHubAsset> {
  const release: any = await requestJson('https://api.github.com/repos/fatedier/frp/releases/latest')
  if (!release || !Array.isArray(release.assets)) {
    throw new Error('无法获取 frp 最新版本信息')
  }
  const candidates = release.assets
    .map((a: any) => ({ name: a.name, browser_download_url: a.browser_download_url, score: scoreFrpAsset(a.name) }))
    .filter((a: any) => a.score >= 0)
    .sort((a: any, b: any) => b.score - a.score)
  if (candidates.length === 0) {
    throw new Error('未找到适用于 ' + process.platform + '/' + process.arch + ' 的 frp release')
  }
  return { name: candidates[0].name, browser_download_url: candidates[0].browser_download_url }
}

// 检测已安装 frpc 的版本
async function getFrpcVersion(binPath: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync(binPath, ['--version'], { timeout: 8000 })
    return (stdout || '').trim().split(String.fromCharCode(10))[0] || ''
  } catch {
    return ''
  }
}

async function downloadFrpc(): Promise<boolean> {
  const binPath = getFrpcBinaryPath()
  if (fsSync.existsSync(binPath)) return true

  // 本地优先：从已解压目录/自带包复制
  const local = await findLocalBinary(process.platform === 'win32' ? 'frpc.exe' : 'frpc')
  if (local) {
    logger.info(`使用本地 frpc 二进制: ${local}`)
    await fs.mkdir(getLibDir(), { recursive: true })
    await fs.copyFile(local, binPath)
    await fs.chmod(binPath, 0o755).catch(() => {})
    return true
  }

  // 联网下载（兜底）：动态获取 GitHub 最新 release 并选择合适平台 asset（原版机制）
  const asset = await fetchLatestFrpAsset()
  logger.info(`从 GitHub 下载 frp: ${asset.name}`)
  const url = asset.browser_download_url
  await fs.mkdir(getLibDir(), { recursive: true })
  const tmp = path.join(getLibDir(), 'frp_download.tmp')
  const resp = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
    signal: AbortSignal.timeout(180000)
  })
  if (!resp.ok) throw new Error('frpc 下载失败: HTTP ' + resp.status)
  const buf = Buffer.from(await resp.arrayBuffer())
  await fs.writeFile(tmp, buf)
  // 解压 tar.gz 或 zip
  if (url.endsWith('.tar.gz')) {
    const { default: tar } = await import('tar') as any
    await tar.x({ file: tmp, cwd: getLibDir() })
  } else {
    // Windows: 用 PowerShell Expand-Archive 解压 zip
    const zipPath = tmp + '.zip'
    await fs.rename(tmp, zipPath)
    await execFileAsync('powershell', ['-NoProfile', '-Command', `Expand-Archive -Force -Path "${zipPath}" -DestinationPath "${getLibDir()}"`], { timeout: 60000 })
    await fs.unlink(zipPath).catch(() => {})
  }
  await fs.unlink(tmp).catch(() => {})
  const found = await findLocalBinary(process.platform === 'win32' ? 'frpc.exe' : 'frpc')
  if (found && found !== binPath) {
    await fs.copyFile(found, binPath)
    await fs.chmod(binPath, 0o755).catch(() => {})
  }
  return fsSync.existsSync(binPath)
}

async function findBinaryInDir(dir: string, name: string): Promise<string | null> {
  try {
    const stat = await fs.stat(dir)
    if (stat.isDirectory()) {
      const entries = await fs.readdir(dir)
      for (const e of entries) {
        const found = await findBinaryInDir(path.join(dir, e), name)
        if (found) return found
      }
    } else if (dir.endsWith(name)) {
      return dir
    }
  } catch {}
  return null
}

async function writeFrpcConfig(cfg: FrpcConfig): Promise<string> {
  await fs.mkdir(getLibDir(), { recursive: true })
  let toml = `serverAddr = "${cfg.serverAddr}"\nserverPort = ${cfg.serverPort}\n`
  if (cfg.token) toml += `auth.token = "${cfg.token}"\n\n`
  for (const p of cfg.proxies) {
    toml += `[[proxies]]\nname = "${p.name}"\ntype = "${p.type}"\nlocalIP = "${p.localIp}"\nlocalPort = ${p.localPort}\n`
    if (p.type === 'tcp' && p.remotePort) toml += `remotePort = ${p.remotePort}\n`
    if (p.type === 'http' && p.customDomains) toml += `customDomains = ["${p.customDomains}"]\n`
    toml += '\n'
  }
  await fs.writeFile(getFrpcConfigPath(), toml, 'utf-8')
  return getFrpcConfigPath()
}

router.get('/frpc/status', async (_req: Request, res: Response) => {
  try {
    const binPath = getFrpcBinaryPath()
    const running = isProcessRunning('frpc')
    // 检测已安装版本（原版机制同步）
    let version = ''
    if (fsSync.existsSync(binPath)) {
      version = await getFrpcVersion(binPath)
    }
    res.json({
      success: true,
      data: {
        installed: fsSync.existsSync(binPath),
        running,
        version,
        configPath: getFrpcConfigPath(),
        binaryPath: binPath
      }
    })
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message })
  }
})

// 读取 frpc 配置文件内容
router.get('/frpc/config', async (_req: Request, res: Response) => {
  try {
    const configPath = getFrpcConfigPath()
    let content = ''
    let exists = false
    try {
      content = await fs.readFile(configPath, 'utf-8')
      exists = true
    } catch {}
    res.json({ success: true, data: { exists, content, configPath } })
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message })
  }
})

// 保存 frpc 配置文件（原样写入，支持自定义多隧道配置）
router.post('/frpc/config', async (req: Request, res: Response) => {
  try {
    const { content } = req.body || {}
    if (typeof content !== 'string' || !content.trim()) {
      return res.status(400).json({ success: false, error: '配置文件内容不能为空' })
    }
    if (content.length > 100000) {
      return res.status(400).json({ success: false, error: '配置文件过大' })
    }
    // 安全校验：禁止危险配置（如从配置文件读取本地文件等）
    if (/\$(?:{|\(?)|<%/i.test(content)) {
      return res.status(400).json({ success: false, error: '配置文件包含不支持的表达式' })
    }
    await fs.mkdir(getLibDir(), { recursive: true })
    await fs.writeFile(getFrpcConfigPath(), content, 'utf-8')
    res.json({ success: true, data: { saved: true, configPath: getFrpcConfigPath() } })
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message })
  }
})

router.post('/frpc/install', async (_req: Request, res: Response) => {
  try {
    const ok = await downloadFrpc()
    res.json({ success: true, data: { installed: ok, binaryPath: getFrpcBinaryPath() } })
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message })
  }
})

router.post('/frpc/start', async (req: Request, res: Response) => {
  try {
    const cfg = req.body as FrpcConfig
    // 检查是否已有自定义配置文件（优先使用）
    let configPath = getFrpcConfigPath()
    let customConfig = false
    try {
      const existing = await fs.readFile(configPath, 'utf-8')
      customConfig = existing.trim().length > 0
    } catch { customConfig = false }

    // 有自定义配置时无需填写 serverAddr；无配置时才要求表单填写
    if (!customConfig && (!cfg?.serverAddr || !cfg?.serverPort)) {
      return res.status(400).json({ success: false, error: '请填写 frps 服务器地址和端口（或先保存配置文件）' })
    }
    if (!fsSync.existsSync(getFrpcBinaryPath())) {
      await downloadFrpc()
    }

    if (customConfig && !cfg?.overwriteConfig) {
      // 使用自定义配置
      logger.info('frpc 使用自定义配置文件启动')
    } else {
      configPath = await writeFrpcConfig(cfg)
    }
    // 停止旧的 frpc
    await stopFrpc()
    const binPath = getFrpcBinaryPath()
    logger.info(`启动 frpc: ${binPath} -c ${configPath}`)
    const proc = spawn(binPath, ['-c', configPath], { detached: true, stdio: 'ignore' })
    // 处理 spawn 错误（如二进制缺失/损坏），避免静默失败
    proc.on('error', (err) => {
      logger.error('frpc 进程启动错误:', err)
    })
    proc.unref()
    res.json({ success: true, data: { running: true, configPath, customConfig } })
  } catch (error: any) {
    logger.error('frpc 启动失败:', error)
    res.status(500).json({ success: false, error: error?.message || String(error), errorDetail: error?.stack || '' })
  }
})

router.post('/frpc/stop', async (_req: Request, res: Response) => {
  try {
    await stopFrpc()
    res.json({ success: true, data: { running: false } })
  } catch (error: any) {
    logger.error('frpc 停止失败:', error)
    res.status(500).json({ success: false, error: error?.message || String(error) })
  }
})

async function stopFrpc(): Promise<void> {
  const cmd = process.platform === 'win32' ? 'taskkill' : 'pkill'
  const args = process.platform === 'win32' ? ['/F', '/IM', 'frpc.exe'] : ['-f', 'frpc']
  try { await execFileAsync(cmd, args, { timeout: 5000 }) } catch {}
}

function isProcessRunning(name: string): boolean {
  try {
    if (process.platform === 'win32') {
      const r = spawnSync('tasklist', ['/FI', `IMAGENAME eq ${name}.exe`], { encoding: 'utf-8' })
      return r.stdout ? r.stdout.toLowerCase().includes(name.toLowerCase()) : false
    } else {
      const r = spawnSync('pgrep', ['-f', name], { encoding: 'utf-8' })
      return r.stdout ? r.stdout.trim().length > 0 : false
    }
  } catch { return false }
}

// ---------- EasyTier 虚拟局域网 ----------
const getEasyTierBinaryPath = (): string => {
  const name = process.platform === 'win32' ? 'easytier-core.exe' : 'easytier-core'
  return path.join(getLibDir(), name)
}

const EASYTIER_DOWNLOADS: Record<string, string> = {
  linux_x64: 'https://github.com/EasyTier/EasyTier/releases/download/v2.1.2/easytier-linux-x86_64-v2.1.2.tar.gz',
  linux_arm64: 'https://github.com/EasyTier/EasyTier/releases/download/v2.1.2/easytier-linux-aarch64-v2.1.2.tar.gz',
  win32_x64: 'https://github.com/EasyTier/EasyTier/releases/download/v2.1.2/easytier-windows-x86_64-v2.1.2.zip',
  darwin_x64: 'https://github.com/EasyTier/EasyTier/releases/download/v2.1.2/easytier-macos-x86_64-v2.1.2.tar.gz',
}

const getEasyTierArchAliases = (): string[] => {
  switch (process.arch) {
    case 'x64': return ['x86_64', 'amd64', 'x64']
    case 'arm64': return ['aarch64', 'arm64']
    case 'arm': return ['armv7', 'arm']
    default: return [process.arch]
  }
}

// EasyTier asset 打分（原版 scoreAsset 逻辑）
const scoreEasyTierAsset = (name: string): number => {
  const n = name.toLowerCase()
  if (!isSupportedArchive(n)) return -1
  if (!n.startsWith('easytier-')) return -1
  if (n.includes('gui') || n.includes('app-') || n.endsWith('.apk')) return -1
  if (n.endsWith('.rpm') || n.endsWith('.dmg') || n.endsWith('.appimage')) return -1
  const hasPlatform = getPlatformAliases().some(a => n.includes(a))
  const hasArch = getEasyTierArchAliases().some(a => n.includes(a))
  if (!hasPlatform || !hasArch) return -1
  let score = 100
  if (n.includes(getPlatformAliases()[0] + '-' + getEasyTierArchAliases()[0])) score += 20
  if (n.endsWith('.zip')) score += process.platform === 'win32' ? 8 : 2
  if (n.endsWith('.tar.gz') || n.endsWith('.tgz')) score += process.platform === 'win32' ? 2 : 8
  return score
}

// 获取 EasyTier 最新 release asset（原版动态机制）
async function fetchLatestEasyTierAsset(): Promise<GitHubAsset> {
  const release: any = await requestJson('https://api.github.com/repos/EasyTier/EasyTier/releases/latest')
  if (!release || !Array.isArray(release.assets)) {
    throw new Error('无法获取 EasyTier 最新版本信息')
  }
  const candidates = release.assets
    .map((a: any) => ({ name: a.name, browser_download_url: a.browser_download_url, score: scoreEasyTierAsset(a.name) }))
    .filter((a: any) => a.score >= 0)
    .sort((a: any, b: any) => b.score - a.score)
  if (candidates.length === 0) {
    throw new Error('未找到适用于 ' + process.platform + '/' + process.arch + ' 的 EasyTier release')
  }
  return { name: candidates[0].name, browser_download_url: candidates[0].browser_download_url }
}

// 检测 EasyTier 版本
async function getEasyTierVersion(binPath: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync(binPath, ['--version'], { timeout: 8000 })
    return (stdout || '').trim().split(String.fromCharCode(10))[0] || ''
  } catch {
    return ''
  }
}

async function downloadEasyTier(): Promise<boolean> {
  const binPath = getEasyTierBinaryPath()
  if (fsSync.existsSync(binPath)) return true

  // 本地优先：从已解压目录/自带包复制
  const binName = process.platform === 'win32' ? 'easytier-core.exe' : 'easytier-core'
  const local = await findLocalBinary(binName)
  if (local) {
    logger.info(`使用本地 EasyTier 二进制: ${local}`)
    await fs.mkdir(getLibDir(), { recursive: true })
    await fs.copyFile(local, binPath)
    await fs.chmod(binPath, 0o755).catch(() => {})
    return true
  }

  // 联网下载（兜底）：动态获取 GitHub 最新 release asset（原版机制）
  const asset = await fetchLatestEasyTierAsset()
  logger.info('从 GitHub 下载 EasyTier: ' + asset.name)
  const url = asset.browser_download_url
  await fs.mkdir(getLibDir(), { recursive: true })
  const tmp = path.join(getLibDir(), 'easytier_download.tmp')
  const resp = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
    signal: AbortSignal.timeout(180000)
  })
  if (!resp.ok) throw new Error('EasyTier 下载失败: HTTP ' + resp.status)
  const buf = Buffer.from(await resp.arrayBuffer())
  await fs.writeFile(tmp, buf)
  if (url.endsWith('.tar.gz')) {
    const { default: tar } = await import('tar') as any
    await tar.x({ file: tmp, cwd: getLibDir() })
  } else {
    // Windows: 用 PowerShell Expand-Archive 解压 zip
    const zipPath = tmp + '.zip'
    await fs.rename(tmp, zipPath)
    await execFileAsync('powershell', ['-NoProfile', '-Command', `Expand-Archive -Force -Path "${zipPath}" -DestinationPath "${getLibDir()}"`], { timeout: 60000 })
    await fs.unlink(zipPath).catch(() => {})
  }
  await fs.unlink(tmp).catch(() => {})
  const found = await findLocalBinary(binName)
  if (found && found !== binPath) {
    await fs.copyFile(found, binPath)
    await fs.chmod(binPath, 0o755).catch(() => {})
  }
  return fsSync.existsSync(binPath)
}

router.get('/vpn/status', async (_req: Request, res: Response) => {
  try {
    const binPath = getEasyTierBinaryPath()
    let version = ''
    if (fsSync.existsSync(binPath)) {
      version = await getEasyTierVersion(binPath)
    }
    res.json({
      success: true,
      data: {
        installed: fsSync.existsSync(binPath),
        version,
        binaryPath: binPath,
        platform: getPlatformKey()
      }
    })
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message })
  }
})

router.post('/vpn/install', async (_req: Request, res: Response) => {
  try {
    const ok = await downloadEasyTier()
    res.json({ success: true, data: { installed: ok } })
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message })
  }
})

router.post('/vpn/start', async (req: Request, res: Response) => {
  try {
    const { networkName, networkSecret, peer, ipv4 } = req.body || {}
    if (!networkName) {
      return res.status(400).json({ success: false, error: '请填写网络名称' })
    }
    if (!fsSync.existsSync(getEasyTierBinaryPath())) {
      await downloadEasyTier()
    }
    // 停止旧的
    try {
      const cmd = process.platform === 'win32' ? 'taskkill' : 'pkill'
      const args = process.platform === 'win32' ? ['/F', '/IM', 'easytier-core.exe'] : ['-f', 'easytier-core']
      await execFileAsync(cmd, args, { timeout: 5000 })
    } catch {}
    const binPath = getEasyTierBinaryPath()
    const args: string[] = ['-n', networkName]
    if (networkSecret) args.push('-k', networkSecret)
    if (peer) args.push('-p', peer)
    if (ipv4) args.push('-i', ipv4)
    args.push('-d')
    const proc = spawn(binPath, args, { detached: true, stdio: 'ignore' })
    proc.unref()
    res.json({ success: true, data: { running: true, args } })
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message })
  }
})

router.post('/vpn/stop', async (_req: Request, res: Response) => {
  try {
    const cmd = process.platform === 'win32' ? 'taskkill' : 'pkill'
    const args = process.platform === 'win32' ? ['/F', '/IM', 'easytier-core.exe'] : ['-f', 'easytier-core']
    await execFileAsync(cmd, args, { timeout: 5000 }).catch(() => {})
    res.json({ success: true, data: { running: false } })
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message })
  }
})

export default router
