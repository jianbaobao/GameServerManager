import React, { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import apiClient from '@/utils/api'
import { useNotificationStore } from '@/stores/notificationStore'
import ConfirmDialog from '@/components/ConfirmDialog'
import {
  Plus,
  Settings,
  Trash2,
  Power,
  PowerOff,
  ExternalLink,
  Edit,
  Save,
  X,
  Puzzle,
  User,
  Calendar,
  Tag,
  FileText,
  Globe
} from 'lucide-react'

interface Plugin {
  name: string
  displayName: string
  description: string
  version: string
  author: string
  enabled: boolean
  hasWebInterface: boolean
  entryPoint?: string
  icon?: string
  category?: string
}

interface CreatePluginForm {
  name: string
  displayName: string
  description: string
  version: string
  author: string
  category: string
  icon: string
}

const PluginsPage: React.FC = () => {
  const [plugins, setPlugins] = useState<Plugin[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'local' | 'market'>('local')
  const [marketPlugins, setMarketPlugins] = useState<any[]>([])
  const [marketLoading, setMarketLoading] = useState(false)
  const [installingPlugin, setInstallingPlugin] = useState('')
  const [auditResult, setAuditResult] = useState<any>(null)
  const [auditPluginName, setAuditPluginName] = useState('')
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [editingPlugin, setEditingPlugin] = useState<Plugin | null>(null)
  const [showPluginModal, setShowPluginModal] = useState(false)
  const [currentPluginContent, setCurrentPluginContent] = useState<string>('')
  const [currentPluginName, setCurrentPluginName] = useState<string>('')
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [pluginToDelete, setPluginToDelete] = useState<Plugin | null>(null)
  const [createForm, setCreateForm] = useState<CreatePluginForm>({
    name: '',
    displayName: '',
    description: '',
    version: '1.0.0',
    author: '',
    category: '其他',
    icon: 'puzzle'
  })
  const { addNotification } = useNotificationStore()

  // 监听来自插件的消息
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data && event.data.type === 'gsm3-notification') {
        const { type, message } = event.data.data
        addNotification({
          type: type as 'info' | 'success' | 'warning' | 'error',
          title: '插件消息',
          message
        })
      } else if (event.data && event.data.type === 'gsm3-plugin-loaded') {
        console.log('插件加载完成:', event.data.data)
      } else if (event.data && event.data.type === 'gsm3-api-request') {
        // 代理插件 API 请求到后端（postMessage 安全通信）
        const { id, url, config } = event.data
        const respond = (result: any) => {
          try { (event.source as any)?.postMessage({ type: 'gsm3-api-response', id, result }, '*') } catch {}
        }
        ;(async () => {
          try {
            const method = (config && config.method) || 'GET'
            const bodyStr = config && config.body
            let data
            try { data = bodyStr ? JSON.parse(bodyStr) : undefined } catch { data = bodyStr }
            let res: any
            if (method === 'GET') {
              res = await apiClient.get(String(url))
            } else if (method === 'DELETE') {
              res = await apiClient.delete(String(url))
            } else if (method === 'PUT') {
              res = await apiClient.put(String(url), data)
            } else {
              res = await apiClient.post(String(url), data)
            }
            respond({ ok: true, status: 200, data: res })
          } catch (e: any) {
            respond({ ok: false, status: 500, data: { error: e?.message || '请求失败' } })
          }
        })()
      }
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [addNotification])

  const categories = [
    '工具',
    '游戏',
    '监控',
    '管理',
    '娱乐',
    '开发',
    '系统',
    '其他'
  ]

  const icons = [
    'puzzle',
    'settings',
    'gamepad-2',
    'monitor',
    'shield',
    'music',
    'code',
    'server',
    'globe',
    'tool',
    'heart',
    'star'
  ]

  useEffect(() => {
    loadPlugins()
  }, [])

  const loadPlugins = async () => {
    try {
      setLoading(true)
      const response = await apiClient.get('/plugins/list')
      if (response.success) {
        setPlugins(response.data)
      } else {
        addNotification({ type: 'error', title: '错误', message: '获取插件列表失败' })
      }
    } catch (error) {
      console.error('获取插件列表失败:', error)
      addNotification({ type: 'error', title: '错误', message: '获取插件列表失败' })
    } finally {
      setLoading(false)
    }
  }

  const handleCreatePlugin = async () => {
    try {
      if (!createForm.name.trim()) {
        addNotification({ type: 'error', title: '错误', message: '插件名称不能为空' })
        return
      }

      if (!/^[a-zA-Z0-9_-]+$/.test(createForm.name)) {
        addNotification({ type: 'error', title: '错误', message: '插件名称只能包含字母、数字、下划线和连字符' })
        return
      }

      const response = await apiClient.post('/plugins/create', createForm)
      if (response.success) {
        addNotification({ type: 'success', title: '成功', message: '插件创建成功' })
        setShowCreateModal(false)
        setCreateForm({
          name: '',
          displayName: '',
          description: '',
          version: '1.0.0',
          author: '',
          category: '其他',
          icon: 'puzzle'
        })
        loadPlugins()
      } else {
        addNotification({ type: 'error', title: '错误', message: response.message || '创建插件失败' })
      }
    } catch (error) {
      console.error('创建插件失败:', error)
      addNotification({ type: 'error', title: '错误', message: '创建插件失败' })
    }
  }

  const handleTogglePlugin = async (plugin: Plugin) => {
    try {
      const endpoint = plugin.enabled ? 'disable' : 'enable'
      const response = await apiClient.post(`/plugins/${plugin.name}/${endpoint}`)
      if (response.success) {
        addNotification({ type: 'success', title: '成功', message: `插件已${plugin.enabled ? '禁用' : '启用'}` })
        loadPlugins()
      } else {
        addNotification({ type: 'error', title: '错误', message: response.message || `${plugin.enabled ? '禁用' : '启用'}插件失败` })
      }
    } catch (error) {
      console.error('切换插件状态失败:', error)
      addNotification({ type: 'error', title: '错误', message: '操作失败' })
    }
  }

  const handleDeletePlugin = (plugin: Plugin) => {
    setPluginToDelete(plugin)
    setShowDeleteConfirm(true)
  }

  const confirmDeletePlugin = async () => {
    if (!pluginToDelete) return

    try {
      const response = await apiClient.delete(`/plugins/${pluginToDelete.name}`)
      if (response.success) {
        addNotification({ type: 'success', title: '成功', message: '插件删除成功' })
        loadPlugins()
      } else {
        addNotification({ type: 'error', title: '错误', message: response.message || '删除插件失败' })
      }
    } catch (error) {
      console.error('删除插件失败:', error)
      addNotification({ type: 'error', title: '错误', message: '删除插件失败' })
    } finally {
      setShowDeleteConfirm(false)
      setPluginToDelete(null)
    }
  }

  const handleOpenPlugin = async (plugin: Plugin) => {
    if (plugin.hasWebInterface && plugin.enabled) {
      // 发送正在打开插件的通知
      addNotification({
        type: 'info',
        title: '提示',
        message: `正在打开插件 ${plugin.displayName || plugin.name}...`
      })
      
      try {
        // 通过API获取插件文件内容
        const response = await apiClient.get(`/plugins/${plugin.name}/files/${plugin.entryPoint || 'index.html'}`)
        
        // 检查响应数据格式
        if (response.data) {
          let content = ''
          
          // 如果是JSON格式的响应（HTML、CSS、JS文件）
          if (typeof response.data === 'object' && response.data.success && response.data.data) {
            content = response.data.data
          } 
          // 如果直接返回HTML内容（兼容性处理）
          else if (typeof response.data === 'string' && response.data.trim()) {
            content = response.data
          }
          // 如果是JSON格式但失败
          else if (typeof response.data === 'object' && !response.data.success) {
            addNotification({ 
              type: 'error', 
              title: '错误', 
              message: response.data.message || '获取插件文件失败' 
            })
            return
          }
          
          if (content && content.trim()) {
            // 修复gsm3-api.js的引用路径并注入token
            const token = apiClient.getToken()
            let injectedContent = content
            
            // 替换相对路径的gsm3-api.js引用为正确的API路径
            injectedContent = injectedContent.replace(
              /src="gsm3-api\.js"/g,
              `src="/api/plugins/${plugin.name}/files/gsm3-api.js"`
            )
            
            // 确保gsm3-api.js脚本标签有正确的type属性
            injectedContent = injectedContent.replace(
              /<script src="\/api\/plugins\/${plugin.name}\/files\/gsm3-api\.js"><\/script>/g,
              `<script type="text/javascript" src="/api/plugins/${plugin.name}/files/gsm3-api.js"></script>`
            )
            
            // 注入 fetch 代理脚本（跨域安全通信，无需 allow-same-origin）
            injectedContent = injectedContent.replace(
              '</head>',
              `<script>
                // 安全 fetch 代理：通过 postMessage 转发到父页面（GSM3 面板）
                const __parentOrigin = '${window.location.origin}';
                const __gsm3OrigFetch = window.fetch.bind(window);
                window.fetch = async (input, init) => {
                  const url = typeof input === 'string' ? input : (input && input.url) || String(input);
                  const fullUrl = url.startsWith('http') ? url : __parentOrigin + (url.startsWith('/') ? '' : '/') + url;
                  const id = Math.random().toString(36).slice(2) + Date.now();
                  const result = await new Promise((resolve) => {
                    const handler = (e) => {
                      if (e.data && e.data.type === 'gsm3-api-response' && e.data.id === id) {
                        window.removeEventListener('message', handler);
                        resolve(e.data.result);
                      }
                    };
                    window.addEventListener('message', handler);
                    (window.parent as any).postMessage({
                      type: 'gsm3-api-request',
                      id,
                      url: fullUrl,
                      config: { method: (init && init.method) || 'GET', body: init && init.body }
                    }, '*');
                  });
                  if (result.ok) {
                    return { ok: true, status: result.status || 200, json: async () => result.data, text: async () => JSON.stringify(result.data) };
                  }
                  const err = new Error((result.data && (result.data.error || result.data.message)) || '请求失败');
                  (err as any).response = { status: result.status || 500, data: result.data };
                  throw err;
                };
              </script>
              </head>`
            )
            // 注入token设置脚本
            injectedContent = injectedContent.replace(
              '</head>',
              `<script>
                // 设置全局token变量
                window.gsm3Token = '${token}';
                console.log('全局token已设置:', '${token}');
              </script>
              </head>`
            )
            
            // 在body结束前注入token设置脚本，确保在gsm3-api.js完全初始化后执行
            injectedContent = injectedContent.replace(
              '</body>',
              `<script>
                // 等待gsm3-api.js完全加载并初始化
                (function() {
                  const waitForGsm3AndSetToken = () => {
                    // 检查window.gsm3对象是否存在且具有initialize方法
                    if (window.gsm3 && typeof window.gsm3.initialize === 'function') {
                      console.log('GSM3 API对象已找到，设置token...');
                      window.gsm3.token = '${token}';
                      console.log('GSM3 API Token已设置:', '${token}');
                      
                      // 如果API还未初始化，触发初始化
                      if (!window.gsm3.isInitialized) {
                        window.gsm3.initialize().then(() => {
                          console.log('GSM3 API初始化完成');
                        }).catch(error => {
                          console.error('GSM3 API初始化失败:', error);
                        });
                      }
                      return true;
                    }
                    return false;
                  };
                  
                  // 监听DOMContentLoaded事件，确保在gsm3-api.js的DOMContentLoaded之后执行
                  if (document.readyState === 'loading') {
                    document.addEventListener('DOMContentLoaded', () => {
                      // 延迟一点时间，确保gsm3-api.js的DOMContentLoaded先执行
                      setTimeout(() => {
                        if (!waitForGsm3AndSetToken()) {
                          // 如果仍然失败，继续重试
                          let attempts = 0;
                          const checkGsm3 = () => {
                            attempts++;
                            if (waitForGsm3AndSetToken()) {
                              console.log('Token设置成功，尝试次数:', attempts);
                            } else if (attempts < 30) {
                              setTimeout(checkGsm3, 200);
                            } else {
                              console.error('Token设置失败：超时等待gsm3对象创建');
                              console.log('当前window对象包含的gsm3相关属性:', Object.keys(window).filter(key => key.includes('gsm3')));
                            }
                          };
                          setTimeout(checkGsm3, 200);
                        }
                      }, 100);
                    });
                  } else {
                    // 如果DOM已经加载完成，立即尝试
                    setTimeout(() => {
                      if (!waitForGsm3AndSetToken()) {
                        let attempts = 0;
                        const checkGsm3 = () => {
                          attempts++;
                          if (waitForGsm3AndSetToken()) {
                            console.log('Token设置成功，尝试次数:', attempts);
                          } else if (attempts < 30) {
                            setTimeout(checkGsm3, 200);
                          } else {
                            console.error('Token设置失败：超时等待gsm3对象创建');
                            console.log('当前window对象包含的gsm3相关属性:', Object.keys(window).filter(key => key.includes('gsm3')));
                          }
                        };
                        setTimeout(checkGsm3, 200);
                      }
                    }, 100);
                  }
                })();
              </script>
              </body>`
            )
            
            setCurrentPluginContent(injectedContent)
            setCurrentPluginName(plugin.displayName || plugin.name)
            setShowPluginModal(true)
            
            // 发送插件打开成功的通知
            addNotification({
              type: 'success',
              title: '成功',
              message: `插件 ${plugin.displayName || plugin.name} 已打开`
            })
          } else {
            addNotification({ type: 'error', title: '错误', message: '插件内容为空' })
          }
        } else {
          addNotification({ type: 'error', title: '错误', message: '无法获取插件内容' })
        }
      } catch (error) {
        console.error('打开插件失败:', error)
        addNotification({ 
          type: 'error', 
          title: '错误', 
          message: error instanceof Error ? error.message : '打开插件失败' 
        })
      }
    }
  }

  const getIconComponent = (iconName: string) => {
    const iconMap: { [key: string]: React.ComponentType<any> } = {
      puzzle: Puzzle,
      settings: Settings,
      'gamepad-2': Settings, // 使用Settings作为替代
      monitor: Settings,
      shield: Settings,
      music: Settings,
      code: Settings,
      server: Settings,
      globe: Globe,
      tool: Settings,
      heart: Settings,
      star: Settings
    }
    const IconComponent = iconMap[iconName] || Puzzle
    return <IconComponent className="w-6 h-6" />
  }

  const getCategoryColor = (category: string) => {
    const colorMap: { [key: string]: string } = {
      '工具': 'bg-blue-500',
      '游戏': 'bg-green-500',
      '监控': 'bg-yellow-500',
      '管理': 'bg-purple-500',
      '娱乐': 'bg-pink-500',
      '开发': 'bg-indigo-500',
      '系统': 'bg-red-500',
      '其他': 'bg-gray-500'
    }
    return colorMap[category] || 'bg-gray-500'
  }

  // 插件市场：切换 Tab 时加载市场列表
  useEffect(() => {
    if (activeTab === 'market') loadMarket()
  }, [activeTab])

  if (loading) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="flex items-center justify-center h-64"
      >
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
          className="rounded-full h-12 w-12 border-b-2 border-blue-500"
        />
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="ml-4 text-gray-600 dark:text-gray-400"
        >
          加载插件中...
        </motion.p>
      </motion.div>
    )
  }

  // 加载插件市场
  const loadMarket = async () => {
    setMarketLoading(true)
    try {
      const res: any = await apiClient.get('/api/plugins/market/list')
      if (res.success) setMarketPlugins(res.data || [])
    } catch (e) { console.warn('加载插件市场失败', e) }
    finally { setMarketLoading(false) }
  }

  // 安装插件（含安全审计）
  const installMarketPlugin = async (plugin: any) => {
    if (!plugin.downloadUrl) {
      alert('该插件未提供下载地址')
      return
    }
    if (!confirm(`确定安装插件「${plugin.displayName || plugin.name}」？\n\n安装前将进行安全审计，未通过会阻止安装。`)) return
    setInstallingPlugin(plugin.name)
    setAuditResult(null)
    try {
      const res: any = await apiClient.post('/api/plugins/install', {
        name: plugin.name,
        downloadUrl: plugin.downloadUrl
      })
      if (res.success) {
        setAuditResult(res.data?.audit || null)
        setAuditPluginName(plugin.name)
        alert('插件安装成功！')
        // 刷新本地插件列表
        setTimeout(() => window.location.reload(), 800)
      } else {
        setAuditResult(res.data || null)
        alert('安装失败: ' + (res.error || '未通过安全审计'))
      }
    } catch (e: any) {
      const errData = e?.response?.data
      if (errData?.data) setAuditResult(errData.data)
      alert('安装失败: ' + (errData?.error || e.message))
    } finally { setInstallingPlugin('') }
  }


  return (
    <div className="p-6 space-y-6">
      {/* Tab 切换 */}
      <div className="flex space-x-2 mb-6">
        <button
          onClick={() => setActiveTab('local')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition ${activeTab === 'local' ? 'bg-blue-500 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300'}`}
        >
          已安装插件
        </button>
        <button
          onClick={() => setActiveTab('market')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition ${activeTab === 'market' ? 'bg-blue-500 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300'}`}
        >
          <Globe className="w-4 h-4 inline mr-1" />插件市场
        </button>
      </div>

      {/* 插件市场视图 */}
      {activeTab === 'market' && (
        <div className="space-y-4">
          <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
            <h3 className="text-sm font-medium text-blue-800 dark:text-blue-200 mb-1">🛡️ 插件安全审计</h3>
            <p className="text-xs text-blue-700 dark:text-blue-300">
              安装第三方插件前会自动扫描恶意代码模式（eval/外部脚本/凭证窃取/敏感模块等），
              未通过安全审计的插件将被阻止安装。
            </p>
          </div>

          {auditResult && (
            <div className={`rounded-lg border p-4 ${auditResult.safe ? 'bg-green-50 dark:bg-green-900/30 border-green-200 dark:border-green-800' : 'bg-red-50 dark:bg-red-900/30 border-red-200 dark:border-red-800'}`}>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-medium">「{auditPluginName}」安全审计报告</h4>
                <span className={`text-xs px-2 py-0.5 rounded-full ${auditResult.safe ? 'bg-green-500 text-white' : 'bg-red-500 text-white'}`}>
                  安全评分 {auditResult.score}/100
                </span>
              </div>
              <p className="text-sm mb-3">{auditResult.summary}</p>
              {auditResult.findings?.length > 0 && (
                <div className="max-h-48 overflow-y-auto space-y-2">
                  {auditResult.findings.map((f: any, i: number) => (
                    <div key={i} className={`text-xs p-2 rounded ${f.severity === 'high' ? 'bg-red-100 dark:bg-red-900/50 text-red-800 dark:text-red-200' : f.severity === 'medium' ? 'bg-yellow-100 dark:bg-yellow-900/50 text-yellow-800 dark:text-yellow-200' : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300'}`}>
                      <span className="font-bold">[{f.severity.toUpperCase()}]</span> {f.description}
                      <div className="text-gray-500 dark:text-gray-400 mt-0.5">文件: {f.file}{f.line ? `:${f.line}` : ''}</div>
                      {f.snippet && <code className="block mt-0.5 bg-black/10 dark:bg-white/10 px-1 rounded">{f.snippet}</code>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {marketLoading ? (
            <div className="text-center py-10 text-gray-500">加载插件市场...</div>
          ) : marketPlugins.length === 0 ? (
            <div className="text-center py-10 text-gray-500">暂无可用插件</div>
          ) : (
            marketPlugins.map((plugin: any) => (
              <div key={plugin.name} className="bg-white dark:bg-gray-800 rounded-xl shadow p-5 flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-semibold text-gray-900 dark:text-white">{plugin.displayName || plugin.name}</h3>
                    <span className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 px-2 py-0.5 rounded-full">{plugin.version}</span>
                    <span className="text-xs bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded-full">{plugin.category || '其他'}</span>
                  </div>
                  <p className="text-sm text-gray-600 dark:text-gray-300 mb-2">{plugin.description}</p>
                  <div className="text-xs text-gray-400 flex items-center gap-3">
                    <span className="flex items-center gap-1"><User className="w-3 h-3" />{plugin.author || '未知'}</span>
                    {plugin.builtin && <span className="text-green-500">内置</span>}
                  </div>
                </div>
                {plugin.downloadUrl && (
                  <button
                    onClick={() => installMarketPlugin(plugin)}
                    disabled={installingPlugin === plugin.name}
                    className="ml-4 px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg text-sm font-medium disabled:opacity-50 flex items-center gap-1"
                  >
                    {installingPlugin === plugin.name ? '安装中...' : '安装'}
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      )}

{activeTab === 'local' && (
        <div className="p-6 space-y-6">
      {/* 页面标题和操作 */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="flex items-center justify-between"
      >
        <div>
          <motion.h1
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="text-2xl font-bold text-black dark:text-white"
          >
            插件管理
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="text-gray-600 dark:text-gray-400 mt-1"
          >
            管理和配置系统插件，扩展面板功能
          </motion.p>
        </div>
        <motion.button
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5, delay: 0.3 }}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => setShowCreateModal(true)}
          className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          <span>创建插件</span>
        </motion.button>
      </motion.div>

      {/* 插件列表 */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <AnimatePresence>
          {plugins.map((plugin, index) => (
            <motion.div
              key={plugin.name}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.3, delay: index * 0.1 }}
              className="glass rounded-lg p-6 border border-white/20 dark:border-gray-700/30 hover:shadow-lg transition-all duration-300"
            >
            {/* 插件头部 */}
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center space-x-3">
                <div className="p-2 bg-blue-500/20 rounded-lg">
                  {getIconComponent(plugin.icon || 'puzzle')}
                </div>
                <div>
                  <h3 className="font-semibold text-black dark:text-white">
                    {plugin.displayName}
                  </h3>
                  <div className="flex items-center space-x-2 mt-1">
                    <span className={`px-2 py-1 text-xs text-white rounded-full ${getCategoryColor(plugin.category || '其他')}`}>
                      {plugin.category || '其他'}
                    </span>
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      v{plugin.version}
                    </span>
                  </div>
                </div>
              </div>
              <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                plugin.enabled
                  ? 'bg-green-500/20 text-green-700 dark:text-green-300'
                  : 'bg-gray-500/20 text-gray-600 dark:text-gray-300'
              }`}>
                {plugin.enabled ? '已启用' : '已禁用'}
              </span>
            </div>

            {/* 插件信息 */}
            <div className="space-y-2 mb-4">
              <p className="text-sm text-gray-600 dark:text-gray-400 line-clamp-2">
                {plugin.description}
              </p>
              <div className="flex items-center space-x-4 text-xs text-gray-500 dark:text-gray-400">
                <div className="flex items-center space-x-1">
                  <User className="w-3 h-3" />
                  <span>{plugin.author}</span>
                </div>
                {plugin.hasWebInterface && (
                  <div className="flex items-center space-x-1">
                    <Globe className="w-3 h-3" />
                    <span>Web界面</span>
                  </div>
                )}
              </div>
            </div>

            {/* 操作按钮 */}
            <div className="flex items-center justify-between pt-4 border-t border-white/10 dark:border-gray-700/30">
              <div className="flex items-center space-x-2">
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => handleTogglePlugin(plugin)}
                  className={`inline-flex items-center space-x-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    plugin.enabled
                      ? 'bg-green-500/20 text-green-600 hover:bg-green-500/30'
                      : 'bg-gray-500/20 text-gray-600 hover:bg-gray-500/30'
                  }`}
                  title={plugin.enabled ? '禁用插件' : '启用插件'}
                >
                  {plugin.enabled ? <Power className="w-4 h-4" /> : <PowerOff className="w-4 h-4" />}
                  <span>{plugin.enabled ? '禁用' : '启用'}</span>
                </motion.button>
                {plugin.hasWebInterface && (
                  <motion.button
                    whileHover={{ scale: plugin.enabled ? 1.02 : 1 }}
                    whileTap={{ scale: plugin.enabled ? 0.98 : 1 }}
                    onClick={() => handleOpenPlugin(plugin)}
                    disabled={!plugin.enabled}
                    className={`inline-flex items-center space-x-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                      plugin.enabled
                        ? 'bg-blue-500/20 text-blue-600 hover:bg-blue-500/30'
                        : 'bg-gray-500/10 text-gray-400 cursor-not-allowed'
                    }`}
                    title={plugin.enabled ? '打开插件' : '启用后可打开插件'}
                  >
                    <ExternalLink className="w-4 h-4" />
                    <span>打开</span>
                  </motion.button>
                )}
              </div>
              <motion.button
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
                onClick={() => handleDeletePlugin(plugin)}
                className="p-2 bg-red-500/20 text-red-600 rounded-lg hover:bg-red-500/30 transition-colors"
                title="删除插件"
              >
                <Trash2 className="w-4 h-4" />
              </motion.button>
            </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {plugins.length === 0 && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="text-center py-12"
        >
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ duration: 0.5, delay: 0.2 }}
          >
            <Puzzle className="w-16 h-16 text-gray-400 mx-auto mb-4" />
          </motion.div>
          <motion.h3
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.3 }}
            className="text-lg font-medium text-gray-600 dark:text-gray-400 mb-2"
          >
            暂无插件
          </motion.h3>
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.4 }}
            className="text-gray-500 dark:text-gray-500 mb-4"
          >
            创建您的第一个插件来扩展面板功能
          </motion.p>
          <motion.button
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.5 }}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => setShowCreateModal(true)}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            创建插件
          </motion.button>
        </motion.div>
      )}

      {/* 插件展示模态框 */}
      <AnimatePresence>
        {showPluginModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-2 backdrop-blur-sm sm:p-4 lg:left-[var(--gsm-sidebar-offset,16rem)]"
            onClick={() => {
              setShowPluginModal(false)
              setCurrentPluginContent('')
              setCurrentPluginName('')
            }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              transition={{ duration: 0.3, ease: "easeOut" }}
              className="glass flex h-[calc(100vh-1rem)] w-full max-w-[1600px] flex-col overflow-hidden rounded-lg border border-white/20 dark:border-gray-700/30 sm:h-[92vh]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between gap-3 border-b border-white/10 p-3 dark:border-gray-700/30 sm:p-4">
                <h2 className="min-w-0 truncate text-lg font-bold text-black dark:text-white sm:text-xl">{currentPluginName}</h2>
                <motion.button
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={() => {
                    setShowPluginModal(false)
                    setCurrentPluginContent('')
                    setCurrentPluginName('')
                  }}
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                >
                  <X className="w-6 h-6" />
                </motion.button>
              </div>
              <div className="min-h-0 flex-1 p-2 sm:p-4">
                <motion.iframe
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.4, delay: 0.2 }}
                  srcDoc={currentPluginContent}
                  className="h-full w-full rounded-md border-0 bg-white dark:bg-gray-900 sm:rounded-lg"
                  sandbox="allow-scripts allow-forms"
                  title={currentPluginName}
                />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 创建插件模态框 */}
      <AnimatePresence>
        {showCreateModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-2 backdrop-blur-sm sm:p-4 lg:left-[var(--gsm-sidebar-offset,16rem)]"
            onClick={() => setShowCreateModal(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              transition={{ duration: 0.3, ease: "easeOut" }}
              className="glass rounded-lg p-6 w-full max-w-md mx-4 border border-white/20 dark:border-gray-700/30"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold text-black dark:text-white">创建新插件</h2>
                <motion.button
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={() => setShowCreateModal(false)}
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                >
                  <X className="w-6 h-6" />
                </motion.button>
              </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-black dark:text-white mb-2">
                  插件名称 *
                </label>
                <input
                  type="text"
                  value={createForm.name}
                  onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                  className="w-full px-3 py-2 bg-white/10 dark:bg-gray-800/50 border border-white/20 dark:border-gray-700 rounded-lg text-black dark:text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="例如: my-plugin"
                />
                <p className="text-xs text-gray-500 mt-1">只能包含字母、数字、下划线和连字符</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-black dark:text-white mb-2">
                  显示名称
                </label>
                <input
                  type="text"
                  value={createForm.displayName}
                  onChange={(e) => setCreateForm({ ...createForm, displayName: e.target.value })}
                  className="w-full px-3 py-2 bg-white/10 dark:bg-gray-800/50 border border-white/20 dark:border-gray-700 rounded-lg text-black dark:text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="例如: 我的插件"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-black dark:text-white mb-2">
                  描述
                </label>
                <textarea
                  value={createForm.description}
                  onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
                  className="w-full px-3 py-2 bg-white/10 dark:bg-gray-800/50 border border-white/20 dark:border-gray-700 rounded-lg text-black dark:text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                  rows={3}
                  placeholder="插件功能描述"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-black dark:text-white mb-2">
                    版本
                  </label>
                  <input
                    type="text"
                    value={createForm.version}
                    onChange={(e) => setCreateForm({ ...createForm, version: e.target.value })}
                    className="w-full px-3 py-2 bg-white/10 dark:bg-gray-800/50 border border-white/20 dark:border-gray-700 rounded-lg text-black dark:text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-black dark:text-white mb-2">
                    作者
                  </label>
                  <input
                    type="text"
                    value={createForm.author}
                    onChange={(e) => setCreateForm({ ...createForm, author: e.target.value })}
                    className="w-full px-3 py-2 bg-white/10 dark:bg-gray-800/50 border border-white/20 dark:border-gray-700 rounded-lg text-black dark:text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="作者名称"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-black dark:text-white mb-2">
                    分类
                  </label>
                  <select
                    value={createForm.category}
                    onChange={(e) => setCreateForm({ ...createForm, category: e.target.value })}
                    className="w-full px-3 py-2 bg-white/10 dark:bg-gray-800/50 border border-white/20 dark:border-gray-700 rounded-lg text-black dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {categories.map((category) => (
                      <option key={category} value={category} className="bg-white dark:bg-gray-800">
                        {category}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-black dark:text-white mb-2">
                    图标
                  </label>
                  <select
                    value={createForm.icon}
                    onChange={(e) => setCreateForm({ ...createForm, icon: e.target.value })}
                    className="w-full px-3 py-2 bg-white/10 dark:bg-gray-800/50 border border-white/20 dark:border-gray-700 rounded-lg text-black dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {icons.map((icon) => (
                      <option key={icon} value={icon} className="bg-white dark:bg-gray-800">
                        {icon}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

              <div className="flex items-center justify-end space-x-3 mt-6">
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition-colors"
                >
                  取消
                </motion.button>
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={handleCreatePlugin}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  创建
                </motion.button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 删除确认对话框 */}
      <ConfirmDialog
        visible={showDeleteConfirm}
        title="删除插件"
        message={`确定要删除插件 "${pluginToDelete?.displayName || pluginToDelete?.name}" 吗？此操作不可撤销。`}
        confirmText="删除"
        cancelText="取消"
        type="danger"
        onConfirm={confirmDeletePlugin}
        onCancel={() => {
          setShowDeleteConfirm(false)
          setPluginToDelete(null)
        }}
      />
        </div>
      )}
    </div>
  )
}

export default PluginsPage
