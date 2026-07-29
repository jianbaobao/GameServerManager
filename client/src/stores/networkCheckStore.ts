import { create } from 'zustand'
import { NetworkCheckState, NetworkCheckCategory, NetworkCheckItem } from '@/types'
import apiClient from '@/utils/api'

// 初始化网络检测项
const initialCategories: NetworkCheckCategory[] = [
  {
    id: 'internet',
    name: '互联网',
    items: [{ id: 'baidu', name: '互联网连接状态', url: 'www.baidu.com', status: 'pending', errorMessage: '外网连接失败，您将无法对外请求' }]
  },
  {
    id: 'steam',
    name: 'Steam 网络',
    items: [
      { id: 'steamworks-api', name: 'Steamworks API', url: 'api.steampowered.com', status: 'pending', errorMessage: 'Steamworks连接失败' },
      { id: 'steamworks-partner', name: 'Steamworks API (合作)', url: 'partner.steam-api.com', status: 'pending', errorMessage: 'Steamworks连接失败' },
      { id: 'steam-store', name: 'Steam 商店', url: 'store.steampowered.com', status: 'pending', errorMessage: 'Steam商店连接失败' },
      { id: 'steam-community', name: 'Steam 社区', url: 'steamcommunity.com', status: 'pending', errorMessage: 'Steam社区连接失败' },
      { id: 'steam-cdn', name: 'Steam 下载 CDN', url: 'cdn.steamstatic.com', status: 'pending', errorMessage: 'Steam CDN连接失败' },
    ]
  },
  {
    id: 'minecraft',
    name: 'Minecraft',
    items: [
      { id: 'mojang-session', name: 'Mojang 会话服务器', url: 'sessionserver.mojang.com', status: 'pending', errorMessage: '正版验证失败可能无法进服' },
      { id: 'mojang-auth', name: 'Mojang 验证服务器', url: 'authserver.mojang.com', status: 'pending', errorMessage: 'Mojang验证失败' },
      { id: 'mc-skin', name: 'MC 皮肤站', url: 'littleskin.cn', status: 'pending', errorMessage: '皮肤站连接失败' },
      { id: 'msl-api', name: 'MSL API', url: 'https://api.mslmc.cn/v3', status: 'pending', errorMessage: 'MSL API连接失败' },
    ]
  },
  {
    id: 'gsmanager',
    name: 'GSManager',
    items: [
      { id: 'gsm-deploy', name: 'GSManager功能服务', url: 'http://langlangy2.server.xiaozhuhouses.asia:44409', status: 'pending', errorMessage: '在线部署功能不可用' },
      { id: 'gsm-mirror', name: '文件边缘下载服务', url: 'https://download.xiaozhuhouses.asia', status: 'pending', errorMessage: '边缘下载功能不可用' },
    ]
  },
  {
    id: 'mirrors',
    name: '镜像源与加速',
    items: [
      { id: 'github-mirror-ghproxy', name: 'GitHub 加速 (ghproxy)', url: 'https://ghproxy.net', status: 'pending', errorMessage: 'GitHub加速不可用' },
      { id: 'github-mirror-fastgit', name: 'GitHub 加速 (fastgit)', url: 'https://hub.fastgit.xyz', status: 'pending', errorMessage: 'GitHub加速不可用' },
      { id: 'github-mirror-moeyy', name: 'GitHub 加速 (moeyy)', url: 'https://github.moeyy.xyz', status: 'pending', errorMessage: 'GitHub加速不可用' },
      { id: 'npm-mirror-taobao', name: 'NPM 镜像 (淘宝)', url: 'https://registry.npmmirror.com', status: 'pending', errorMessage: 'NPM镜像不可用' },
      { id: 'pip-mirror-aliyun', name: 'PyPI 镜像 (阿里云)', url: 'https://mirrors.aliyun.com/pypi/', status: 'pending', errorMessage: 'PyPI镜像不可用' },
      { id: 'java-mirror-huawei', name: 'Maven 镜像 (华为)', url: 'https://repo.huaweicloud.com/repository/maven/', status: 'pending', errorMessage: 'Maven镜像不可用' },
      { id: 'docker-mirror-dao', name: 'Docker 镜像 (DaoCloud)', url: 'https://docker.m.daocloud.io', status: 'pending', errorMessage: 'Docker镜像不可用' },
      { id: 'npm-mirror-npmmirror', name: 'NPM 镜像 (官方中国)', url: 'https://npmmirror.com', status: 'pending', errorMessage: 'NPM镜像不可用' },
    ]
  },
  {
    id: 'game-mirrors',
    name: '游戏服务器镜像',
    items: [
      { id: 'mc-paper-api', name: 'PaperMC API', url: 'https://api.papermc.io/v2/projects/paper', status: 'pending', errorMessage: 'PaperMC连接失败' },
      { id: 'mc-purpur', name: 'PurpurMC API', url: 'https://api.purpurmc.org/v2/purpur', status: 'pending', errorMessage: 'PurpurMC连接失败' },
      { id: 'mc-forge', name: 'Forge 下载', url: 'https://files.minecraftforge.net/net/minecraftforge/forge/', status: 'pending', errorMessage: 'Forge下载不可用' },
      { id: 'mc-fabric-meta', name: 'FabricMC 元数据', url: 'https://meta.fabricmc.net/v2/versions/loader', status: 'pending', errorMessage: 'FabricMC不可用' },
      { id: 'mc-spigot', name: 'SpigotMC BuildTools', url: 'https://hub.spigotmc.org/jenkins/job/BuildTools/', status: 'pending', errorMessage: 'SpigotMC不可用' },
      { id: 'mc-modrinth-api', name: 'Modrinth API', url: 'https://api.modrinth.com/v2/tags', status: 'pending', errorMessage: 'Modrinth不可用' },
    ]
  },
  {
    id: 'public-nodes',
    name: '公益节点与 CDN',
    items: [
      { id: 'public-node-tsinghua', name: '清华 TUNA 镜像', url: 'https://mirrors.tuna.tsinghua.edu.cn/', status: 'pending', errorMessage: '清华镜像不可用' },
      { id: 'public-node-ustc', name: '中科大 LUG 镜像', url: 'https://mirrors.ustc.edu.cn/', status: 'pending', errorMessage: '中科大镜像不可用' },
      { id: 'public-node-aliyun', name: '阿里云镜像站', url: 'https://mirrors.aliyun.com/', status: 'pending', errorMessage: '阿里云镜像不可用' },
      { id: 'cdn-bootcdn', name: 'BootCDN', url: 'https://cdn.bootcdn.net/ajax/libs', status: 'pending', errorMessage: 'BootCDN不可用' },
      { id: 'cdn-staticfile', name: 'Staticfile CDN', url: 'https://cdn.staticfile.org', status: 'pending', errorMessage: 'Staticfile CDN不可用' },
      { id: 'cdn-jsdelivr', name: 'jsDelivr CDN', url: 'https://cdn.jsdelivr.net/npm', status: 'pending', errorMessage: 'jsDelivr不可用' },
      { id: 'public-node-netease', name: '网易开源镜像', url: 'https://mirrors.163.com/', status: 'pending', errorMessage: '网易镜像不可用' },
      { id: 'public-node-zju', name: '浙大 ZJU 镜像', url: 'https://mirrors.zju.edu.cn/', status: 'pending', errorMessage: '浙大镜像不可用' },
      { id: 'cdn-360', name: '360 CDN', url: 'https://cdn.360.net', status: 'pending', errorMessage: '360 CDN不可用' },
    ]
  },
]
export const useNetworkCheckStore = create<NetworkCheckState>((set, get) => ({
  categories: JSON.parse(JSON.stringify(initialCategories)), // 深拷贝
  allChecksComplete: false,
  allChecksPassed: false,
  checking: false,
  lastCheckTime: undefined,

  // 检测所有项目
  checkAll: async () => {
    // 先将所有项目的状态设置为checking
    const checkingCategories = get().categories.map(category => ({
      ...category,
      items: category.items.map(item => ({
        ...item,
        status: 'checking' as const
      }))
    }))
    
    set({ 
      checking: true, 
      allChecksComplete: false,
      categories: checkingCategories
    })
    
    try {
      const response = await apiClient.checkNetwork()
      
      if (response.success && response.data) {
        const updatedCategories = get().categories.map(category => ({
          ...category,
          items: category.items.map(item => {
            const result = response.data.results.find((r: any) => r.id === item.id)
            if (result) {
              return {
                ...item,
                status: result.status,
                responseTime: result.responseTime,
                lastCheckTime: new Date().toISOString()
              }
            }
            return item
          })
        }))

        const allComplete = updatedCategories.every(cat => 
          cat.items.every(item => item.status === 'success' || item.status === 'failed')
        )
        const allPassed = updatedCategories.every(cat =>
          cat.items.every(item => item.status === 'success')
        )

        set({
          categories: updatedCategories,
          allChecksComplete: allComplete,
          allChecksPassed: allPassed,
          checking: false,
          lastCheckTime: new Date().toISOString()
        })
      }
    } catch (error) {
      console.error('网络检测失败:', error)
      set({ checking: false })
    }
  },

  // 检测单个项目
  checkSingle: async (categoryId: string, itemId: string) => {
    const categories = get().categories
    const category = categories.find(c => c.id === categoryId)
    const item = category?.items.find(i => i.id === itemId)
    
    if (!item) return

    // 更新状态为检测中
    const updatedCategories = categories.map(cat => {
      if (cat.id === categoryId) {
        return {
          ...cat,
          items: cat.items.map(i => {
            if (i.id === itemId) {
              return { ...i, status: 'checking' as const }
            }
            return i
          })
        }
      }
      return cat
    })
    set({ categories: updatedCategories })

    try {
      const response = await apiClient.checkSingleNetwork(item.url, item.id)
      
      if (response.success && response.data) {
        const finalCategories = get().categories.map(cat => {
          if (cat.id === categoryId) {
            return {
              ...cat,
              items: cat.items.map(i => {
                if (i.id === itemId) {
                  return {
                    ...i,
                    status: response.data.status,
                    responseTime: response.data.responseTime,
                    lastCheckTime: new Date().toISOString()
                  }
                }
                return i
              })
            }
          }
          return cat
        })
        
        set({ categories: finalCategories })
      }
    } catch (error) {
      console.error('单项网络检测失败:', error)
      const failedCategories = get().categories.map(cat => {
        if (cat.id === categoryId) {
          return {
            ...cat,
            items: cat.items.map(i => {
              if (i.id === itemId) {
                return {
                  ...i,
                  status: 'failed' as const,
                  lastCheckTime: new Date().toISOString()
                }
              }
              return i
            })
          }
        }
        return cat
      })
      set({ categories: failedCategories })
    }
  },

  // 重置所有检测状态
  reset: () => {
    set({
      categories: JSON.parse(JSON.stringify(initialCategories)),
      allChecksComplete: false,
      allChecksPassed: false,
      checking: false,
      lastCheckTime: undefined
    })
  }
}))

