// ============================================================
// 内置网络工具模块：Steam访问加速 + frpc内网穿透 + EasyTier虚拟局域网
// ============================================================
import { Router, Request, Response } from 'express'
import { promises as fs } from 'fs'
import fsSync from 'fs'
import path from 'path'
import os from 'os'
import { execFile, spawn, spawnSync } from 'child_process'
import { promisify } from 'util'
import winston from 'winston'
import { authenticateToken } from '../middleware/auth.js'
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

async function downloadFrpc(): Promise<boolean> {
  const binPath = getFrpcBinaryPath()
  if (fsSync.existsSync(binPath)) return true
  const key = getPlatformKey()
  const url = FRPC_DOWNLOADS[key]
  if (!url) throw new Error('不支持当前平台的 frpc 下载')
  await fs.mkdir(getLibDir(), { recursive: true })
  const tmp = path.join(getLibDir(), 'frp_download.tmp')
  const resp = await fetch(url)
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
  // 找到 frpc 可执行文件
  const entries = await fs.readdir(getLibDir())
  for (const e of entries) {
    const full = path.join(getLibDir(), e)
    const binName = process.platform === 'win32' ? 'frpc.exe' : 'frpc'
    const found = await findBinaryInDir(full, binName)
    if (found) {
      await fs.chmod(found, 0o755).catch(() => {})
    }
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
    res.json({
      success: true,
      data: {
        installed: fsSync.existsSync(binPath),
        running,
        configPath: getFrpcConfigPath(),
        binaryPath: binPath
      }
    })
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
    if (!cfg?.serverAddr || !cfg?.serverPort) {
      return res.status(400).json({ success: false, error: '请填写 frps 服务器地址和端口' })
    }
    if (!fsSync.existsSync(getFrpcBinaryPath())) {
      await downloadFrpc()
    }
    const configPath = await writeFrpcConfig(cfg)
    // 停止旧的 frpc
    await stopFrpc()
    const binPath = getFrpcBinaryPath()
    const proc = spawn(binPath, ['-c', configPath], { detached: true, stdio: 'ignore' })
    proc.unref()
    res.json({ success: true, data: { running: true, configPath } })
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message })
  }
})

router.post('/frpc/stop', async (_req: Request, res: Response) => {
  try {
    await stopFrpc()
    res.json({ success: true, data: { running: false } })
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message })
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

async function downloadEasyTier(): Promise<boolean> {
  const binPath = getEasyTierBinaryPath()
  if (fsSync.existsSync(binPath)) return true
  const key = getPlatformKey()
  const url = EASYTIER_DOWNLOADS[key]
  if (!url) throw new Error('不支持当前平台的 EasyTier 下载')
  await fs.mkdir(getLibDir(), { recursive: true })
  const tmp = path.join(getLibDir(), 'easytier_download.tmp')
  const resp = await fetch(url)
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
  const binName = process.platform === 'win32' ? 'easytier-core.exe' : 'easytier-core'
  const found = await findBinaryInDir(getLibDir(), binName)
  if (found && found !== binPath) {
    await fs.copyFile(found, binPath).catch(() => {})
  }
  return fsSync.existsSync(binPath)
}

router.get('/vpn/status', async (_req: Request, res: Response) => {
  try {
    res.json({
      success: true,
      data: {
        installed: fsSync.existsSync(getEasyTierBinaryPath()),
        binaryPath: getEasyTierBinaryPath(),
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
