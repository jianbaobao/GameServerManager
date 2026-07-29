import { Router, Request, Response } from 'express'
import { authenticateToken } from '../middleware/auth.js'
import { isPrivateHost as ssrfIsPrivateHost, extractHost as ssrfExtractHost } from '../utils/networkSecurity.js'
import net from 'net'
import http from 'http'
import https from 'https'
import { URL } from 'url'

const router = Router()

// Alias shared SSRF functions for backward compat
const isPrivateHost = ssrfIsPrivateHost
const extractHost = ssrfExtractHost

// 网络检测项配置
type NetworkCheckType = 'auto' | 'tcp' | 'http'

interface NetworkCheckItem {
  id: string
  name: string
  url: string
  status: 'pending' | 'checking' | 'success' | 'failed'
  checkType?: NetworkCheckType
  port?: number
  expectedStatusCode?: number
  responseTime?: number
  errorMessage?: string
}

const networkCheckItems: NetworkCheckItem[] = [
  // ===== 互联网基础连接 =====
  { id: 'baidu', name: '互联网连接状态', url: 'www.baidu.com', status: 'pending' },
  
  // ===== Steam 网络 =====
  { id: 'steamworks-api', name: 'Steamworks API(全球)', url: 'api.steampowered.com', status: 'pending' },
  { id: 'steamworks-partner', name: 'Steamworks API（合作/私有）', url: 'partner.steam-api.com', status: 'pending' },
  { id: 'steam-store', name: 'Steam 商店', url: 'store.steampowered.com', status: 'pending' },
  { id: 'steam-community', name: 'Steam 社区', url: 'steamcommunity.com', status: 'pending' },
  { id: 'steam-cdn', name: 'Steam 下载 CDN', url: 'cdn.steamstatic.com', status: 'pending' },

  // ===== Modrinth =====
  { id: 'modrinth-api', name: 'Modrinth API', url: 'api.modrinth.com', status: 'pending' },
  { id: 'modrinth-cdn', name: 'Modrinth CDN', url: 'cdn.modrinth.com', status: 'pending' },

  // ===== Minecraft =====
  { id: 'mojang-session', name: 'Mojang 会话服务器', url: 'sessionserver.mojang.com', status: 'pending' },
  { id: 'mojang-auth', name: 'Mojang 验证服务器', url: 'authserver.mojang.com', status: 'pending' },
  { id: 'mojang-texture', name: 'Mojang 材质服务器', url: 'textures.minecraft.net', status: 'pending' },
  { id: 'msl-api', name: 'MSL API', url: 'https://api.mslmc.cn/v3', status: 'pending' },
  { id: 'mc-skin', name: 'MC 皮肤站', url: 'littleskin.cn', status: 'pending' },

  // ===== GSManager 服务 =====
  { id: 'gsm-deploy', name: 'GSManager功能服务', url: 'http://langlangy2.server.xiaozhuhouses.asia', status: 'pending', checkType: 'tcp', port: 44409 },
  { id: 'gsm-mirror', name: '文件边缘下载服务', url: 'download.xiaozhuhouses.asia', status: 'pending', expectedStatusCode: 200 },

  // ===== GitHub 加速镜像 =====
  { id: 'github-mirror-ghproxy', name: 'GitHub 代理加速 (ghproxy.net)', url: 'https://ghproxy.net', status: 'pending', checkType: 'http', expectedStatusCode: 200 },
  { id: 'github-mirror-ghproxy2', name: 'GitHub 代理加速 (ghproxy.com)', url: 'https://ghproxy.com', status: 'pending', checkType: 'http', expectedStatusCode: 200 },
  { id: 'github-mirror-fastgit', name: 'GitHub 加速 (fastgit.org)', url: 'https://hub.fastgit.xyz', status: 'pending', checkType: 'http', expectedStatusCode: 200 },
  { id: 'github-mirror-moeyy', name: 'GitHub 加速 (moeyy.cn)', url: 'https://github.moeyy.xyz', status: 'pending', checkType: 'http', expectedStatusCode: 200 },
  { id: 'github-mirror-dgithub', name: 'GitHub 加速 (dgithub.xyz)', url: 'https://dgithub.xyz', status: 'pending', checkType: 'http', expectedStatusCode: 200 },
  { id: 'github-mirror-github', name: 'GitHub 官方直连', url: 'https://github.com', status: 'pending', checkType: 'http', expectedStatusCode: 200 },

  // ===== NPM 镜像 =====
  { id: 'npm-mirror-taobao', name: 'NPM 镜像 (淘宝)', url: 'https://registry.npmmirror.com', status: 'pending', checkType: 'http', expectedStatusCode: 200 },
  { id: 'npm-mirror-huawei', name: 'NPM 镜像 (华为)', url: 'https://repo.huaweicloud.com/repository/npm/', status: 'pending', checkType: 'http', expectedStatusCode: 200 },
  { id: 'npm-mirror-tencent', name: 'NPM 镜像 (腾讯)', url: 'https://mirrors.cloud.tencent.com/npm/', status: 'pending', checkType: 'http', expectedStatusCode: 200 },
  { id: 'npm-mirror-npmmirror', name: 'NPM 镜像 (官方中国)', url: 'https://npmmirror.com', status: 'pending', checkType: 'http', expectedStatusCode: 200 },

  // ===== PyPI 镜像 =====
  { id: 'pip-mirror-aliyun', name: 'PyPI 镜像 (阿里云)', url: 'https://mirrors.aliyun.com/pypi/', status: 'pending', checkType: 'http', expectedStatusCode: 200 },
  { id: 'pip-mirror-huawei', name: 'PyPI 镜像 (华为)', url: 'https://repo.huaweicloud.com/repository/pypi/', status: 'pending', checkType: 'http', expectedStatusCode: 200 },
  { id: 'pip-mirror-tencent', name: 'PyPI 镜像 (腾讯)', url: 'https://mirrors.cloud.tencent.com/pypi/', status: 'pending', checkType: 'http', expectedStatusCode: 200 },
  { id: 'pip-mirror-tsinghua', name: 'PyPI 镜像 (清华)', url: 'https://pypi.tuna.tsinghua.edu.cn/simple/', status: 'pending', checkType: 'http', expectedStatusCode: 200 },
  { id: 'pip-mirror-ustc', name: 'PyPI 镜像 (中科大)', url: 'https://pypi.mirrors.ustc.edu.cn/simple/', status: 'pending', checkType: 'http', expectedStatusCode: 200 },

  // ===== Java/Maven 镜像 =====
  { id: 'java-mirror-huawei', name: 'Maven 镜像 (华为)', url: 'https://repo.huaweicloud.com/repository/maven/', status: 'pending', checkType: 'http', expectedStatusCode: 200 },
  { id: 'java-mirror-tencent', name: 'Maven 镜像 (腾讯)', url: 'https://mirrors.cloud.tencent.com/maven/', status: 'pending', checkType: 'http', expectedStatusCode: 200 },
  { id: 'java-mirror-aliyun', name: 'Maven 镜像 (阿里云)', url: 'https://maven.aliyun.com/repository/public/', status: 'pending', checkType: 'http', expectedStatusCode: 200 },
  { id: 'java-mirror-tsinghua', name: 'Maven 镜像 (清华)', url: 'https://maven.tuna.tsinghua.edu.cn/repository/public/', status: 'pending', checkType: 'http', expectedStatusCode: 200 },
  { id: 'java-adoptium', name: 'Adoptium JDK 下载', url: 'https://api.adoptium.net/v3/assets/feature_releases/11/ga', status: 'pending', checkType: 'http', expectedStatusCode: 200 },

  // ===== Docker 镜像 =====
  { id: 'docker-hub', name: 'Docker Hub', url: 'https://hub.docker.com/v2/', status: 'pending', checkType: 'http', expectedStatusCode: 200 },
  { id: 'docker-mirror-aliyun', name: 'Docker 镜像 (阿里云)', url: 'https://registry.cn-hangzhou.aliyuncs.com', status: 'pending', checkType: 'http', expectedStatusCode: 200 },
  { id: 'docker-mirror-tencent', name: 'Docker 镜像 (腾讯)', url: 'https://mirror.ccs.tencentyun.com', status: 'pending', checkType: 'http', expectedStatusCode: 200 },
  { id: 'docker-mirror-huawei', name: 'Docker 镜像 (华为)', url: 'https://repo.huaweicloud.com/docker-ce/', status: 'pending', checkType: 'http', expectedStatusCode: 200 },
  { id: 'docker-mirror-dao', name: 'Docker 镜像 (DaoCloud)', url: 'https://docker.m.daocloud.io', status: 'pending', checkType: 'http', expectedStatusCode: 200 },
  { id: 'docker-mirror-1panel', name: 'Docker 镜像 (1Panel)', url: 'https://docker.1panel.live', status: 'pending', checkType: 'http', expectedStatusCode: 200 },

  // ===== Rust/Cargo 镜像 =====
  { id: 'cargo-mirror-ustc', name: 'Cargo 镜像 (中科大)', url: 'https://mirrors.ustc.edu.cn/crates.io-index', status: 'pending', checkType: 'http', expectedStatusCode: 200 },
  { id: 'cargo-mirror-rsproxy', name: 'Cargo 镜像 (rsproxy.cn)', url: 'https://rsproxy.cn', status: 'pending', checkType: 'http', expectedStatusCode: 200 },
  { id: 'cargo-mirror-tuna', name: 'Cargo 镜像 (清华)', url: 'https://mirrors.tuna.tsinghua.edu.cn/git/crates.io-index.git', status: 'pending', checkType: 'http', expectedStatusCode: 200 },

  // ===== Go 镜像 =====
  { id: 'go-mirror-aliyun', name: 'Go 镜像 (阿里云)', url: 'https://mirrors.aliyun.com/goproxy/', status: 'pending', checkType: 'http', expectedStatusCode: 200 },
  { id: 'go-mirror-tencent', name: 'Go 镜像 (腾讯)', url: 'https://mirrors.cloud.tencent.com/go/', status: 'pending', checkType: 'http', expectedStatusCode: 200 },
  { id: 'go-mirror-google', name: 'Go 官方代理', url: 'https://proxy.golang.org', status: 'pending', checkType: 'http', expectedStatusCode: 200 },

  // ===== Conda 镜像 =====
  { id: 'conda-mirror-tsinghua', name: 'Conda 镜像 (清华)', url: 'https://mirrors.tuna.tsinghua.edu.cn/anaconda/', status: 'pending', checkType: 'http', expectedStatusCode: 200 },
  { id: 'conda-mirror-ustc', name: 'Conda 镜像 (中科大)', url: 'https://mirrors.ustc.edu.cn/anaconda/', status: 'pending', checkType: 'http', expectedStatusCode: 200 },

  // ===== 游戏服务器相关镜像 =====
  { id: 'mc-paper-api', name: 'PaperMC API', url: 'https://api.papermc.io/v2/projects/paper', status: 'pending', checkType: 'http', expectedStatusCode: 200 },
  { id: 'mc-paper-dl', name: 'PaperMC 下载', url: 'https://papermc.io/api/v2/projects/paper', status: 'pending', checkType: 'http', expectedStatusCode: 200 },
  { id: 'mc-purpur', name: 'PurpurMC API', url: 'https://api.purpurmc.org/v2/purpur', status: 'pending', checkType: 'http', expectedStatusCode: 200 },
  { id: 'mc-forge', name: 'Forge 下载', url: 'https://files.minecraftforge.net/net/minecraftforge/forge/', status: 'pending', checkType: 'http', expectedStatusCode: 200 },
  { id: 'mc-fabric-meta', name: 'FabricMC 元数据', url: 'https://meta.fabricmc.net/v2/versions/loader', status: 'pending', checkType: 'http', expectedStatusCode: 200 },
  { id: 'mc-fabric-maven', name: 'FabricMC Maven', url: 'https://maven.fabricmc.net/', status: 'pending', checkType: 'http', expectedStatusCode: 200 },
  { id: 'mc-bukkit', name: 'Bukkit 下载', url: 'https://dl.bukkit.org/downloads/craftbukkit/', status: 'pending', checkType: 'http', expectedStatusCode: 200 },
  { id: 'mc-spigot', name: 'SpigotMC BuildTools', url: 'https://hub.spigotmc.org/jenkins/job/BuildTools/', status: 'pending', checkType: 'http', expectedStatusCode: 200 },
  { id: 'mc-modrinth-api', name: 'Modrinth API v2', url: 'https://api.modrinth.com/v2/tags', status: 'pending', checkType: 'http', expectedStatusCode: 200 },
  { id: 'mc-curseforge', name: 'CurseForge 下载', url: 'https://minecraft.curseforge.com', status: 'pending', checkType: 'http', expectedStatusCode: 200 },

  // ===== 公益 CDN =====
  { id: 'cdn-bootcdn', name: 'BootCDN (极客族)', url: 'https://cdn.bootcdn.net/ajax/libs', status: 'pending', checkType: 'http', expectedStatusCode: 200 },
  { id: 'cdn-staticfile', name: 'Staticfile CDN (七牛)', url: 'https://cdn.staticfile.org', status: 'pending', checkType: 'http', expectedStatusCode: 200 },
  { id: 'cdn-jsdelivr', name: 'jsDelivr CDN', url: 'https://cdn.jsdelivr.net/npm', status: 'pending', checkType: 'http', expectedStatusCode: 200 },
  { id: 'cdn-unpkg', name: 'UNPKG CDN', url: 'https://unpkg.com', status: 'pending', checkType: 'http', expectedStatusCode: 200 },
  { id: 'cdn-cdnjs', name: 'cdnjs Cloudflare', url: 'https://cdnjs.cloudflare.com/ajax/libs', status: 'pending', checkType: 'http', expectedStatusCode: 200 },
  { id: 'cdn-baidu', name: '百度 CDN', url: 'https://cdn.baomitu.com', status: 'pending', checkType: 'http', expectedStatusCode: 200 },
  { id: 'cdn-360', name: '360 CDN (极库)', url: 'https://cdn.360.net', status: 'pending', checkType: 'http', expectedStatusCode: 200 },
  { id: 'cdn-bytedance', name: '字节跳动 CDN', url: 'https://cdn.bytedance.com', status: 'pending', checkType: 'http', expectedStatusCode: 200 },
  { id: 'cdn-huawei', name: '华为云 CDN', url: 'https://mirrors.huaweicloud.com', status: 'pending', checkType: 'http', expectedStatusCode: 200 },

  // ===== 高校公益镜像站 =====
  { id: 'public-node-tsinghua', name: '清华大学 TUNA 镜像', url: 'https://mirrors.tuna.tsinghua.edu.cn/', status: 'pending', checkType: 'http', expectedStatusCode: 200 },
  { id: 'public-node-ustc', name: '中科大 LUG 镜像', url: 'https://mirrors.ustc.edu.cn/', status: 'pending', checkType: 'http', expectedStatusCode: 200 },
  { id: 'public-node-zju', name: '浙大 ZJU 镜像', url: 'https://mirrors.zju.edu.cn/', status: 'pending', checkType: 'http', expectedStatusCode: 200 },
  { id: 'public-node-sjtu', name: '交大 SJTUG 镜像', url: 'https://mirrors.sjtug.sjtu.edu.cn/', status: 'pending', checkType: 'http', expectedStatusCode: 200 },
  { id: 'public-node-nju', name: '南大 NJU 镜像', url: 'https://mirrors.nju.edu.cn/', status: 'pending', checkType: 'http', expectedStatusCode: 200 },
  { id: 'public-node-bjtu', name: '北交大 BJTU 镜像', url: 'https://mirror.bjtu.edu.cn/', status: 'pending', checkType: 'http', expectedStatusCode: 200 },
  { id: 'public-node-nwafu', name: '西北农林科技大学镜像', url: 'https://mirrors.nwafu.edu.cn/', status: 'pending', checkType: 'http', expectedStatusCode: 200 },
  { id: 'public-node-hit', name: '哈工大 HIT 镜像', url: 'https://mirrors.hit.edu.cn/', status: 'pending', checkType: 'http', expectedStatusCode: 200 },
  { id: 'public-node-lzu', name: '兰大 LZU 镜像', url: 'https://mirror.lzu.edu.cn/', status: 'pending', checkType: 'http', expectedStatusCode: 200 },
  { id: 'public-node-xjtu', name: '西交大 XJTU 镜像', url: 'https://mirrors.xjtu.edu.cn/', status: 'pending', checkType: 'http', expectedStatusCode: 200 },
  { id: 'public-node-dlut', name: '大连理工 DLUT 镜像', url: 'https://mirror.dlut.edu.cn/', status: 'pending', checkType: 'http', expectedStatusCode: 200 },
  { id: 'public-node-sdu', name: '山大 SDU 镜像', url: 'https://mirrors.sdu.edu.cn/', status: 'pending', checkType: 'http', expectedStatusCode: 200 },

  // ===== 云厂商公益镜像 =====
  { id: 'public-node-aliyun', name: '阿里云镜像站', url: 'https://mirrors.aliyun.com/', status: 'pending', checkType: 'http', expectedStatusCode: 200 },
  { id: 'public-node-tencent', name: '腾讯云镜像站', url: 'https://mirrors.tencent.com/', status: 'pending', checkType: 'http', expectedStatusCode: 200 },
  { id: 'public-node-huawei', name: '华为云镜像站', url: 'https://mirrors.huaweicloud.com/', status: 'pending', checkType: 'http', expectedStatusCode: 200 },
  { id: 'public-node-netease', name: '网易开源镜像站', url: 'https://mirrors.163.com/', status: 'pending', checkType: 'http', expectedStatusCode: 200 },
  { id: 'public-node-sohu', name: '搜狐开源镜像站', url: 'https://mirrors.sohu.com/', status: 'pending', checkType: 'http', expectedStatusCode: 200 },

  // ===== 其他开发工具镜像 =====
  { id: 'ruby-mirror-tsinghua', name: 'RubyGems (清华)', url: 'https://mirrors.tuna.tsinghua.edu.cn/rubygems/', status: 'pending', checkType: 'http', expectedStatusCode: 200 },
  { id: 'php-mirror-tsinghua', name: 'PHP Composer (清华)', url: 'https://mirrors.tuna.tsinghua.edu.cn/composer/', status: 'pending', checkType: 'http', expectedStatusCode: 200 },
  { id: 'nodejs-mirror-tsinghua', name: 'Node.js 发行版 (清华)', url: 'https://mirrors.tuna.tsinghua.edu.cn/nodejs-release/', status: 'pending', checkType: 'http', expectedStatusCode: 200 },
  { id: 'nodejs-mirror-huawei', name: 'Node.js 发行版 (华为)', url: 'https://repo.huaweicloud.com/nodejs/', status: 'pending', checkType: 'http', expectedStatusCode: 200 },
  { id: 'mysql-mirror-tsinghua', name: 'MySQL 镜像 (清华)', url: 'https://mirrors.tuna.tsinghua.edu.cn/mysql/', status: 'pending', checkType: 'http', expectedStatusCode: 200 },
  { id: 'postgres-mirror-tsinghua', name: 'PostgreSQL 镜像 (清华)', url: 'https://mirrors.tuna.tsinghua.edu.cn/postgresql/', status: 'pending', checkType: 'http', expectedStatusCode: 200 },
  { id: 'mongodb-mirror-tsinghua', name: 'MongoDB 镜像 (清华)', url: 'https://mirrors.tuna.tsinghua.edu.cn/mongodb/', status: 'pending', checkType: 'http', expectedStatusCode: 200 },
  { id: 'elastic-mirror-tsinghua', name: 'Elasticsearch (清华)', url: 'https://mirrors.tuna.tsinghua.edu.cn/elasticstack/', status: 'pending', checkType: 'http', expectedStatusCode: 200 },
  { id: 'centos-vault', name: 'CentOS Vault 存档', url: 'https://vault.centos.org', status: 'pending', checkType: 'http', expectedStatusCode: 200 },
  { id: 'epel-mirror-aliyun', name: 'EPEL 镜像 (阿里云)', url: 'https://mirrors.aliyun.com/epel/', status: 'pending', checkType: 'http', expectedStatusCode: 200 },

  // ===== 视频/媒体 CDN =====
  { id: 'cdn-bilibili', name: 'Bilibili CDN', url: 'https://i0.hdslb.com', status: 'pending', checkType: 'http', expectedStatusCode: 200 },
  { id: 'cdn-tencent', name: '腾讯云 CDN', url: 'https://cdn.cloud.tencent.com', status: 'pending', checkType: 'http', expectedStatusCode: 200 },
  { id: 'cdn-aliyun', name: '阿里云 CDN', url: 'https://cdn.aliyun.com', status: 'pending', checkType: 'http', expectedStatusCode: 200 },
]

// TCP Ping 函数
function tcpPing(host: string, port: number, timeout: number = 10000): Promise<{ success: boolean; responseTime?: number; error?: string }> {
  return new Promise((resolve) => {
    const startTime = Date.now()
    const socket = new net.Socket()

    const timeoutId = setTimeout(() => {
      socket.destroy()
      resolve({ success: false, error: `连接超时 (${timeout}ms)` })
    }, timeout)

    socket.setTimeout(timeout)

    socket.connect(port, host, () => {
      const responseTime = Date.now() - startTime
      clearTimeout(timeoutId)
      socket.destroy()
      resolve({ success: true, responseTime })
    })

    socket.on('error', (err) => {
      clearTimeout(timeoutId)
      socket.destroy()
      resolve({ success: false, error: err.message })
    })

    socket.on('timeout', () => {
      clearTimeout(timeoutId)
      socket.destroy()
      resolve({ success: false, error: `连接超时 (${timeout}ms)` })
    })
  })
}

// HTTP/HTTPS Ping 函数
function httpPing(
  url: string,
  timeout: number = 10000,
  expectedStatusCode?: number
): Promise<{ success: boolean; responseTime?: number; error?: string }> {
  return new Promise((resolve) => {
    const startTime = Date.now()
    
    try {
      let parsedUrl: URL
      // 如果URL不包含协议，尝试添加https://
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        try {
          // 先尝试HTTPS
          parsedUrl = new URL(`https://${url}`)
        } catch {
          parsedUrl = new URL(`http://${url}`)
        }
      } else {
        parsedUrl = new URL(url)
      }

      const protocol = parsedUrl.protocol === 'https:' ? https : http

      const req = protocol.get(parsedUrl.toString(), {
        timeout,
        headers: {
          'User-Agent': 'GSManager-NetworkCheck/1.0'
        }
      }, (res) => {
        const responseTime = Date.now() - startTime
        const statusCode = res.statusCode ?? 0
        const isStatusValid = expectedStatusCode !== undefined
          ? statusCode === expectedStatusCode
          : statusCode >= 200 && statusCode < 300

        res.resume() // 消费响应数据
        if (isStatusValid) {
          resolve({ success: true, responseTime })
          return
        }

        const expectedLabel = expectedStatusCode !== undefined
          ? `，期望 ${expectedStatusCode}`
          : '，期望 2xx'
        resolve({ success: false, error: `HTTP状态码异常: ${statusCode}${expectedLabel}` })
      })

      req.on('error', (err) => {
        resolve({ success: false, error: err.message })
      })

      req.on('timeout', () => {
        req.destroy()
        resolve({ success: false, error: `连接超时 (${timeout}ms)` })
      })

    } catch (error: any) {
      resolve({ success: false, error: error.message })
    }
  })
}

// 解析URL并检测
async function checkUrl(
  url: string,
  timeout: number = 10000,
  expectedStatusCode?: number
): Promise<{ success: boolean; responseTime?: number; error?: string }> {
  try {
    // SSRF 防护：拒绝私有地址
    const checkHost = extractHost(url)
    if (isPrivateHost(checkHost)) {
      return { success: false, error: 'Target is a private/internal address' }
    }
    // 如果是完整的HTTP/HTTPS URL，使用HTTP ping
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return await httpPing(url, timeout, expectedStatusCode)
    }

    // 对于域名，先尝试HTTP ping
    const httpResult = await httpPing(url, timeout, expectedStatusCode)
    if (httpResult.success) {
      return httpResult
    }

    // HTTP失败，尝试TCP ping到80端口
    const hostname = url.replace(/^(https?:\/\/)/, '')
    return await tcpPing(hostname, 80, timeout)
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}


async function checkItem(
  item: NetworkCheckItem,
  timeout: number = 10000
): Promise<{ success: boolean; responseTime?: number; error?: string }> {
  const itemHost = extractHost(item.url)
  if (isPrivateHost(itemHost)) {
    return { success: false, error: 'Target is a private/internal address' }
  }
  if (item.checkType === 'tcp') {
    return tcpPing(itemHost, item.port ?? 80, timeout)
  }

  if (item.checkType === 'http') {
    return httpPing(item.url, timeout, item.expectedStatusCode)
  }

  return checkUrl(item.url, timeout, item.expectedStatusCode)
}

// SSRF 防护：检查目标主机是否为私有地址

// 检测所有网络项
router.get('/check-all', authenticateToken, async (req: Request, res: Response) => {
  try {
    const results = await Promise.all(
      networkCheckItems.map(async (item) => {
        const result = await checkItem(item, 10000)
        return {
          id: item.id,
          name: item.name,
          url: item.url,
          status: result.success ? 'success' : 'failed',
          responseTime: result.responseTime,
          error: result.error
        }
      })
    )

    res.json({
      success: true,
      data: {
        results,
        timestamp: new Date().toISOString()
      }
    })
  } catch (error: any) {
    console.error('网络检测失败:', error)
    res.status(500).json({
      success: false,
      message: '网络检测失败',
      error: error.message
    })
  }
})

// 检测单个网络项
router.post('/check-single', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { url, id } = req.body

    if (!url) {
      return res.status(400).json({
        success: false,
        message: '缺少URL参数'
      })
    }

    const matchedItem = typeof id === 'string'
      ? networkCheckItems.find((item) => item.id === id)
      : undefined

    if (!matchedItem && isPrivateHost(extractHost(url))) {
      return res.status(403).json({ success: false, message: 'Private/internal addresses not allowed' })
    }
    const result = matchedItem
      ? await checkItem(matchedItem, 10000)
      : await checkUrl(url, 10000)

    res.json({
      success: true,
      data: {
        id,
        url,
        status: result.success ? 'success' : 'failed',
        responseTime: result.responseTime,
        error: result.error,
        timestamp: new Date().toISOString()
      }
    })
  } catch (error: any) {
    console.error('单项网络检测失败:', error)
    res.status(500).json({
      success: false,
      message: '网络检测失败',
      error: error.message
    })
  }
})


// ===== 获取所有镜像源列表 =====
router.get('/mirrors', authenticateToken, async (req: Request, res: Response) => {
  try {
    const mirrors = networkCheckItems
      .filter(item => 
        item.id.includes('mirror') || 
        item.id.includes('public-node') || 
        item.id.includes('github-mirror') ||
        item.id.includes('npm-mirror') ||
        item.id.includes('pip-mirror') ||
        item.id.includes('java-mirror') ||
        item.id.includes('mc-') ||
        item.id.includes('steam-dl'))
      .map(item => ({
        id: item.id,
        name: item.name,
        url: item.url,
        category: item.id.startsWith('github-') ? 'github' :
                 item.id.startsWith('npm-') ? 'npm' :
                 item.id.startsWith('pip-') ? 'pip' :
                 item.id.startsWith('java-') ? 'java' :
                 item.id.startsWith('steam-dl') ? 'steam' :
                 item.id.startsWith('mc-') ? 'minecraft' :
                 item.id.startsWith('public-node') ? 'public' : 'other',
        type: item.checkType || 'auto',
        port: item.port
      }))
    res.json({ success: true, data: mirrors })
  } catch (error: any) {
    res.status(500).json({ success: false, message: '获取镜像源列表失败', error: error.message })
  }
})

// ===== 检测单个镜像源连接状态 =====
router.post('/check-mirror', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { url, checkType, port } = req.body
    if (!url) {
      return res.status(400).json({ success: false, message: '缺少URL参数' })
    }
    if (isPrivateHost(extractHost(url))) {
      return res.status(403).json({ success: false, message: 'Private/internal addresses not allowed' })
    }
    let result
    if (checkType === 'tcp') {
      result = await tcpPing(extractHost(url), port || 443, 15000)
    } else {
      result = await httpPing(url, 15000, 200)
    }
    res.json({
      success: true,
      data: {
        url,
        status: result.success ? 'success' : 'failed',
        responseTime: result.responseTime,
        error: result.error,
        timestamp: new Date().toISOString()
      }
    })
  } catch (error: any) {
    res.status(500).json({ success: false, message: '检测失败', error: error.message })
  }
})

export default router

