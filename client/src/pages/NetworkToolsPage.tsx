import React, { useState, useEffect } from 'react'
import {
  Zap, ArrowLeftRight, Network as NetworkIcon, Loader2,
  Play, Square, Download, RefreshCw, Shield, Globe, Server
} from 'lucide-react'
import apiClient from '@/utils/api'

type TabKey = 'steam' | 'frpc' | 'vpn'

const NetworkToolsPage: React.FC = () => {
  const [tab, setTab] = useState<TabKey>('steam')

  // Steam 加速状态
  const [steamStatus, setSteamStatus] = useState<any>(null)
  const [steamLoading, setSteamLoading] = useState(false)

  // frpc 状态
  const [frpcStatus, setFrpcStatus] = useState<any>(null)
  const [frpcForm, setFrpcForm] = useState({
    serverAddr: '', serverPort: 7000, token: '',
    name: 'gsm3', type: 'tcp', localIp: '127.0.0.1', localPort: 3001, remotePort: 0
  })
  const [frpcLoading, setFrpcLoading] = useState(false)
  const [frpcView, setFrpcView] = useState<'form' | 'config'>('form')
  const [frpcConfigContent, setFrpcConfigContent] = useState('')
  const [frpcConfigExists, setFrpcConfigExists] = useState(false)
  const [frpcConfigLoading, setFrpcConfigLoading] = useState(false)

  // VPN 状态
  const [vpnStatus, setVpnStatus] = useState<any>(null)
  const [vpnForm, setVpnForm] = useState({
    networkName: 'gsm3-net', networkSecret: '', peer: '', ipv4: ''
  })
  const [vpnLoading, setVpnLoading] = useState(false)

  const refreshAll = () => {
    fetchSteamStatus()
    fetchFrpcStatus()
    fetchVpnStatus()
  }

  useEffect(() => { refreshAll() }, [])

  const fetchSteamStatus = async () => {
    try {
      const res: any = await apiClient.get('/network-tools/steam-accel/status')
      if (res.success) setSteamStatus(res.data)
    } catch (e) { console.warn('Steam加速状态获取失败', e) }
  }

  const toggleSteamAccel = async () => {
    setSteamLoading(true)
    try {
      const url = steamStatus?.enabled
        ? '/network-tools/steam-accel/disable'
        : '/network-tools/steam-accel/enable'
      const res: any = await apiClient.post(url)
      if (res.success) await fetchSteamStatus()
    } catch (e: any) {
      alert('操作失败: ' + (e?.response?.data?.error || e.message))
    } finally { setSteamLoading(false) }
  }

  const fetchFrpcStatus = async () => {
    try {
      const res: any = await apiClient.get('/network-tools/frpc/status')
      if (res.success) setFrpcStatus(res.data)
    } catch (e) { console.warn('frpc状态获取失败', e) }
  }

  const loadFrpcConfig = async () => {
    setFrpcConfigLoading(true)
    try {
      const res: any = await apiClient.get('/network-tools/frpc/config')
      if (res.success) {
        setFrpcConfigContent(res.data.content || '')
        setFrpcConfigExists(res.data.exists)
      }
    } catch (e: any) {
      alert('读取配置失败: ' + (e?.response?.data?.error || e.message))
    } finally { setFrpcConfigLoading(false) }
  }

  const saveFrpcConfig = async () => {
    setFrpcConfigLoading(true)
    try {
      const res: any = await apiClient.post('/network-tools/frpc/config', { content: frpcConfigContent })
      if (res.success) {
        setFrpcConfigExists(true)
        alert('配置文件已保存')
      }
    } catch (e: any) {
      alert('保存配置失败: ' + (e?.response?.data?.error || e.message))
    } finally { setFrpcConfigLoading(false) }
  }

  const loadDefaultConfig = () => {
    setFrpcConfigContent(`serverAddr = "1.2.3.4"
serverPort = 7000

auth.token = "your_token"

[[proxies]]
name = "gsm3-panel"
type = "tcp"
localIP = "127.0.0.1"
localPort = 3001
remotePort = 3001

[[proxies]]
name = "gsm3-terminal"
type = "tcp"
localIP = "127.0.0.1"
localPort = 3002
remotePort = 3002
`)
  }

  const installFrpc = async () => {
    setFrpcLoading(true)
    try {
      const res: any = await apiClient.post('/network-tools/frpc/install')
      if (res.success) await fetchFrpcStatus()
    } catch (e: any) {
      alert('frpc 安装失败: ' + (e?.response?.data?.error || e.message))
    } finally { setFrpcLoading(false) }
  }

  const startFrpc = async () => {
    setFrpcLoading(true)
    try {
      const res: any = await apiClient.post('/network-tools/frpc/start', {
        serverAddr: frpcForm.serverAddr,
        serverPort: Number(frpcForm.serverPort),
        token: frpcForm.token || undefined,
        proxies: [{
          name: frpcForm.name,
          type: frpcForm.type,
          localIp: frpcForm.localIp,
          localPort: Number(frpcForm.localPort),
          remotePort: Number(frpcForm.remotePort) || undefined
        }]
      })
      if (res.success) await fetchFrpcStatus()
    } catch (e: any) {
      alert('frpc 启动失败: ' + (e?.response?.data?.error || e?.response?.data?.errorDetail || e?.message || JSON.stringify(e)))
    } finally { setFrpcLoading(false) }
  }

  const stopFrpc = async () => {
    setFrpcLoading(true)
    try {
      const res: any = await apiClient.post('/network-tools/frpc/stop')
      if (res.success) await fetchFrpcStatus()
    } catch (e: any) {
      alert('frpc 停止失败: ' + e.message)
    } finally { setFrpcLoading(false) }
  }

  const fetchVpnStatus = async () => {
    try {
      const res: any = await apiClient.get('/network-tools/vpn/status')
      if (res.success) setVpnStatus(res.data)
    } catch (e) { console.warn('VPN状态获取失败', e) }
  }

  const installVpn = async () => {
    setVpnLoading(true)
    try {
      const res: any = await apiClient.post('/network-tools/vpn/install')
      if (res.success) await fetchVpnStatus()
    } catch (e: any) {
      alert('EasyTier 安装失败: ' + (e?.response?.data?.error || e.message))
    } finally { setVpnLoading(false) }
  }

  const startVpn = async () => {
    setVpnLoading(true)
    try {
      const res: any = await apiClient.post('/network-tools/vpn/start', {
        networkName: vpnForm.networkName,
        networkSecret: vpnForm.networkSecret || undefined,
        peer: vpnForm.peer || undefined,
        ipv4: vpnForm.ipv4 || undefined
      })
      if (res.success) await fetchVpnStatus()
    } catch (e: any) {
      alert('EasyTier 启动失败: ' + (e?.response?.data?.error || e.message))
    } finally { setVpnLoading(false) }
  }

  const stopVpn = async () => {
    setVpnLoading(true)
    try {
      const res: any = await apiClient.post('/network-tools/vpn/stop')
      if (res.success) await fetchVpnStatus()
    } catch (e: any) {
      alert('EasyTier 停止失败: ' + e.message)
    } finally { setVpnLoading(false) }
  }

  const inputCls = "w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
  const labelCls = "block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-6 flex items-center gap-2">
        <NetworkIcon className="w-6 h-6 text-blue-500" /> 网络工具
      </h1>

      {/* Tab 切换 */}
      <div className="flex space-x-2 mb-6 bg-gray-100 dark:bg-gray-800 p-1 rounded-lg w-fit">
        {([['steam', 'Steam 加速', Zap], ['frpc', 'frpc 内网穿透', ArrowLeftRight], ['vpn', '虚拟局域网', Globe]] as [TabKey, string, any][]).map(([key, label, Icon]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition ${
              tab === key ? 'bg-blue-500 text-white shadow' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
            }`}
          >
            <Icon className="w-4 h-4" /> {label}
          </button>
        ))}
      </div>

      {/* Steam 加速 */}
      {tab === 'steam' && (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                <Zap className="w-5 h-5 text-yellow-500" /> Steam 访问加速
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                基于 hosts 解析优化（Watt Toolkit 同款方案），加速 Steam 商店/社区/下载域名的访问
              </p>
            </div>
            <button onClick={fetchSteamStatus} className="p-2 text-gray-500 hover:text-blue-500" title="刷新">
              <RefreshCw className="w-5 h-5" />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-4 mb-6">
            <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4 text-center">
              <div className={`text-3xl font-bold ${steamStatus?.enabled ? 'text-green-500' : 'text-gray-400'}`}>
                {steamStatus?.enabled ? '已启用' : '未启用'}
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">加速状态</div>
            </div>
            <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4 text-center">
              <div className="text-3xl font-bold text-blue-500">{steamStatus?.domainCount ?? 9}</div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">加速域名数</div>
            </div>
          </div>

          <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-3 mb-4">
            <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">hosts 文件路径</div>
            <code className="text-sm text-gray-800 dark:text-gray-200 break-all">{steamStatus?.hostsPath || '加载中...'}</code>
          </div>

          <button
            onClick={toggleSteamAccel}
            disabled={steamLoading}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-white font-medium transition ${
              steamStatus?.enabled
                ? 'bg-red-500 hover:bg-red-600'
                : 'bg-blue-500 hover:bg-blue-600'
            } disabled:opacity-50`}
          >
            {steamLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : steamStatus?.enabled ? <Square className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            {steamStatus?.enabled ? '禁用加速' : '启用加速'}
          </button>
          <p className="text-xs text-gray-400 mt-3">
            ⚠️ 启用会修改系统 hosts 文件（自动备份），加速后 Steam 商店/社区访问更快。禁用后自动还原。
          </p>
        </div>
      )}

      {/* frpc 内网穿透 */}
      {tab === 'frpc' && (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                <ArrowLeftRight className="w-5 h-5 text-blue-500" /> frpc 内网穿透
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                基于开源 frp 项目（fatedier/frp），将本地面板/游戏服务穿透到公网
              </p>
            </div>
            <button onClick={fetchFrpcStatus} className="p-2 text-gray-500 hover:text-blue-500" title="刷新">
              <RefreshCw className="w-5 h-5" />
            </button>
          </div>

          <div className="flex items-center gap-3 mb-4">
            <span className={`px-3 py-1 rounded-full text-xs font-medium ${frpcStatus?.installed ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300' : 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300'}`}>
              {frpcStatus?.installed ? (frpcStatus.version ? `已安装 ${frpcStatus.version}` : '已安装') : '未安装'}
            </span>
            <span className={`px-3 py-1 rounded-full text-xs font-medium ${frpcStatus?.running ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300' : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'}`}>
              {frpcStatus?.running ? '运行中' : '未运行'}
            </span>
            {!frpcStatus?.installed && (
              <button onClick={installFrpc} disabled={frpcLoading}
                className="flex items-center gap-2 px-4 py-1.5 bg-blue-500 hover:bg-blue-600 text-white rounded-lg text-sm disabled:opacity-50">
                {frpcLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} 安装 frpc
              </button>
            )}
            <span className="flex-1" />
            <div className="flex rounded-lg bg-gray-100 dark:bg-gray-700 p-0.5">
              <button
                onClick={() => setFrpcView('form')}
                className={`px-3 py-1 rounded-md text-xs font-medium ${frpcView === 'form' ? 'bg-blue-500 text-white' : 'text-gray-600 dark:text-gray-300'}`}
              >
                快速配置
              </button>
              <button
                onClick={() => { setFrpcView('config'); loadFrpcConfig() }}
                className={`px-3 py-1 rounded-md text-xs font-medium ${frpcView === 'config' ? 'bg-blue-500 text-white' : 'text-gray-600 dark:text-gray-300'}`}
              >
                配置文件
              </button>
            </div>
          </div>

          {/* 配置文件视图 */}
          {frpcView === 'config' && (
            <div className="mb-4">
              <div className="flex items-center justify-between mb-2">
                <div className="text-sm text-gray-600 dark:text-gray-300">
                  {frpcConfigExists ? (
                    <span className="text-green-500">✓ 当前使用自定义配置</span>
                  ) : (
                    <span className="text-gray-400">尚未保存配置文件（使用快速配置生成）</span>
                  )}
                </div>
                <div className="flex gap-2">
                  <button onClick={loadDefaultConfig}
                    className="px-3 py-1.5 text-sm bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-500">
                    示例配置
                  </button>
                  <button onClick={saveFrpcConfig} disabled={frpcConfigLoading}
                    className="px-3 py-1.5 text-sm bg-blue-500 hover:bg-blue-600 text-white rounded-lg disabled:opacity-50">
                    {frpcConfigLoading ? <Loader2 className="w-4 h-4 animate-spin inline" /> : '保存配置'}
                  </button>
                </div>
              </div>
              <textarea
                value={frpcConfigContent}
                onChange={(e) => setFrpcConfigContent(e.target.value)}
                rows={16}
                spellCheck={false}
                className="w-full font-mono text-xs p-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-900 text-gray-800 dark:text-gray-200 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder={`serverAddr = "1.2.3.4"
serverPort = 7000

[[proxies]]
name = "gsm3"
type = "tcp"
localIP = "127.0.0.1"
localPort = 3001
remotePort = 3001`}
              />
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                💡 支持 frpc.toml 完整语法，可配置多个隧道（TCP/UDP/HTTP/HTTPS）。保存后点击下方"启动 frpc"即使用此配置。
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className={labelCls}>frps 服务器地址</label>
              <input className={inputCls} value={frpcForm.serverAddr} onChange={e => setFrpcForm({ ...frpcForm, serverAddr: e.target.value })} placeholder="1.2.3.4" />
            </div>
            <div>
              <label className={labelCls}>frps 端口</label>
              <input className={inputCls} type="number" value={frpcForm.serverPort} onChange={e => setFrpcForm({ ...frpcForm, serverPort: Number(e.target.value) })} />
            </div>
            <div>
              <label className={labelCls}>认证 token（可选）</label>
              <input className={inputCls} value={frpcForm.token} onChange={e => setFrpcForm({ ...frpcForm, token: e.target.value })} placeholder="与 frps 一致" />
            </div>
            <div>
              <label className={labelCls}>隧道名称</label>
              <input className={inputCls} value={frpcForm.name} onChange={e => setFrpcForm({ ...frpcForm, name: e.target.value })} />
            </div>
            <div>
              <label className={labelCls}>本地端口</label>
              <input className={inputCls} type="number" value={frpcForm.localPort} onChange={e => setFrpcForm({ ...frpcForm, localPort: Number(e.target.value) })} />
            </div>
            <div>
              <label className={labelCls}>远程端口（TCP）</label>
              <input className={inputCls} type="number" value={frpcForm.remotePort} onChange={e => setFrpcForm({ ...frpcForm, remotePort: Number(e.target.value) })} />
            </div>
          </div>

          <div className="flex gap-3">
            <button onClick={startFrpc} disabled={frpcLoading}
              className="flex items-center gap-2 px-5 py-2.5 bg-blue-500 hover:bg-blue-600 text-white rounded-lg font-medium disabled:opacity-50">
              {frpcLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />} {frpcView === 'config' && frpcConfigExists ? '使用配置文件启动' : '启动 frpc'}
            </button>
            <button onClick={stopFrpc} disabled={frpcLoading}
              className="flex items-center gap-2 px-5 py-2.5 bg-red-500 hover:bg-red-600 text-white rounded-lg font-medium disabled:opacity-50">
              <Square className="w-4 h-4" /> 停止
            </button>
          </div>
        </div>
      )}

      {/* 虚拟局域网 */}
      {tab === 'vpn' && (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                <Globe className="w-5 h-5 text-green-500" /> 虚拟局域网（EasyTier）
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                基于开源 EasyTier 项目，轻松组建跨网络虚拟局域网，多服务器互通
              </p>
            </div>
            <button onClick={fetchVpnStatus} className="p-2 text-gray-500 hover:text-blue-500" title="刷新">
              <RefreshCw className="w-5 h-5" />
            </button>
          </div>

          <div className="flex items-center gap-3 mb-6">
            <span className={`px-3 py-1 rounded-full text-xs font-medium ${vpnStatus?.installed ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300' : 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300'}`}>
              {vpnStatus?.installed ? (vpnStatus.version ? `已安装 ${vpnStatus.version}` : '已安装') : '未安装'}
            </span>
            <span className="px-3 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300">
              平台: {vpnStatus?.platform || '检测中'}
            </span>
            {!vpnStatus?.installed && (
              <button onClick={installVpn} disabled={vpnLoading}
                className="flex items-center gap-2 px-4 py-1.5 bg-blue-500 hover:bg-blue-600 text-white rounded-lg text-sm disabled:opacity-50">
                {vpnLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} 安装 EasyTier
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className={labelCls}>网络名称</label>
              <input className={inputCls} value={vpnForm.networkName} onChange={e => setVpnForm({ ...vpnForm, networkName: e.target.value })} />
            </div>
            <div>
              <label className={labelCls}>网络密钥（可选）</label>
              <input className={inputCls} value={vpnForm.networkSecret} onChange={e => setVpnForm({ ...vpnForm, networkSecret: e.target.value })} />
            </div>
            <div>
              <label className={labelCls}>对等节点地址（可选）</label>
              <input className={inputCls} value={vpnForm.peer} onChange={e => setVpnForm({ ...vpnForm, peer: e.target.value })} placeholder="tcp://1.2.3.4:11010" />
            </div>
            <div>
              <label className={labelCls}>虚拟 IP（可选）</label>
              <input className={inputCls} value={vpnForm.ipv4} onChange={e => setVpnForm({ ...vpnForm, ipv4: e.target.value })} placeholder="10.26.0.2" />
            </div>
          </div>

          <div className="flex gap-3">
            <button onClick={startVpn} disabled={vpnLoading}
              className="flex items-center gap-2 px-5 py-2.5 bg-blue-500 hover:bg-blue-600 text-white rounded-lg font-medium disabled:opacity-50">
              {vpnLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />} 加入网络
            </button>
            <button onClick={stopVpn} disabled={vpnLoading}
              className="flex items-center gap-2 px-5 py-2.5 bg-red-500 hover:bg-red-600 text-white rounded-lg font-medium disabled:opacity-50">
              <Square className="w-4 h-4" /> 退出网络
            </button>
          </div>
          <p className="text-xs text-gray-400 mt-3">
            💡 多台服务器填写相同的网络名称和密钥即可组网，通过虚拟 IP 相互访问（如访问另一台的面板/游戏端口）。
          </p>
        </div>
      )}
    </div>
  )
}

export default NetworkToolsPage
