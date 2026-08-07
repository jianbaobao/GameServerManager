import React, { useEffect, useRef, useState, useCallback } from 'react'
import apiClient from '@/utils/api'
import type { Instance } from '@/types'
import { useNotificationStore } from '@/stores/notificationStore'

const PAGE_TITLE = '服主便携控制后台'

interface LogEntry {
  time: string
  type: 'info' | 'success' | 'error' | 'command' | 'output'
  text: string
}

// 各游戏专属快捷指令（开服工具）
const GAME_QUICK_CMDS: Record<string, { label: string; cmd: string }[]> = {
  minecraft: [
    { label: '/list 玩家列表', cmd: '/list' },
    { label: '/save-all 保存世界', cmd: '/save-all' },
    { label: '/time set day', cmd: '/time set day' },
    { label: '/weather clear', cmd: '/weather clear' },
    { label: '创造模式', cmd: '/gamemode creative @a' },
    { label: '/op 给管理员', cmd: '/op ' },
    { label: '/ban 封禁', cmd: '/ban ' },
    { label: '/kick 踢出', cmd: '/kick ' },
    { label: '公告:重启', cmd: '/say 服务器即将重启，请保存退出！' },
  ],
  Palworld: [
    { label: '广播公告', cmd: '/broadcast 服务器维护中' },
    { label: '保存世界', cmd: '/save' },
    { label: '查看在线玩家', cmd: '/showplayers' },
    { label: '停止服务器', cmd: '/stop' },
    { label: '踢出玩家', cmd: '/kickplayer 玩家ID' },
    { label: '封禁玩家', cmd: '/banplayer 玩家ID' },
  ],
  Rust: [
    { label: '保存世界', cmd: 'server.save' },
    { label: '停止服务器', cmd: 'server.stop' },
    { label: '广播公告', cmd: 'say 服务器维护中' },
    { label: '在线玩家', cmd: 'playerlist' },
    { label: '踢出玩家', cmd: 'kick "玩家名" 理由' },
    { label: '给物品', cmd: 'inventory.give "玩家名" wood 100' },
    { label: '天气-晴天', cmd: 'weather.clear' },
  ],
  '7_Days_to_Die': [
    { label: '保存世界', cmd: 'saveworld' },
    { label: '停止服务器', cmd: 'shutdown' },
    { label: '广播公告', cmd: 'say 服务器维护中' },
    { label: '在线玩家', cmd: 'listplayers' },
    { label: '踢出玩家', cmd: 'kick 玩家名 理由' },
    { label: '封禁玩家', cmd: 'ban 玩家名 理由' },
    { label: '给物品', cmd: 'give 玩家名 木材 100' },
  ],
  ARK: [
    { label: '保存世界', cmd: 'saveworld' },
    { label: '广播公告', cmd: 'broadcast 服务器维护中' },
    { label: '在线玩家', cmd: 'listplayers' },
    { label: '踢出玩家', cmd: 'kickplayer 玩家ID' },
    { label: '封禁玩家', cmd: 'banplayer 玩家ID' },
    { label: '查看服务器设置', cmd: 'getoptions' },
  ],
  CS2: [
    { label: '重启回合', cmd: 'mp_restartgame 5' },
    { label: '切换地图', cmd: 'changelevel de_dust2' },
    { label: '机器人数量', cmd: 'bot_quota 5' },
    { label: '广播公告', cmd: 'say 服务器维护中' },
    { label: '踢出玩家', cmd: 'kick "玩家名"' },
    { label: '封禁玩家', cmd: 'banid 0 "玩家名"' },
  ],
  L4D2: [
    { label: '切换到下一关', cmd: 'changelevel c1m1_hotel' },
    { label: '广播公告', cmd: 'say 服务器维护中' },
    { label: '踢出玩家', cmd: 'kick "玩家名"' },
    { label: '封禁玩家', cmd: 'banid 0 "玩家名"' },
    { label: '查看玩家', cmd: 'status' },
  ],
  Terraria: [
    { label: '保存世界', cmd: 'save' },
    { label: '停止服务器', cmd: 'exit' },
    { label: '广播公告', cmd: 'say 服务器维护中' },
    { label: '在线玩家', cmd: 'playing' },
    { label: '踢出玩家', cmd: 'kick 玩家名 理由' },
    { label: '封禁玩家', cmd: 'ban 玩家名 理由' },
  ],
  Dont_Starve_Together: [
    { label: '保存世界', cmd: 'c_save()' },
    { label: '停止服务器', cmd: 'c_shutdown()' },
    { label: '广播公告', cmd: 'c_announce("服务器维护中")' },
    { label: '查看玩家', cmd: 'c_listallplayers()' },
    { label: '踢出玩家', cmd: 'c_kick("玩家名", "理由")' },
  ],
  Unturned: [
    { label: '广播公告', cmd: 'say 服务器维护中' },
    { label: '停止服务器', cmd: 'shutdown' },
    { label: '在线玩家', cmd: 'players' },
    { label: '踢出玩家', cmd: 'kick 玩家名 理由' },
    { label: '封禁玩家', cmd: 'ban 玩家名 理由' },
    { label: '保存世界', cmd: 'save' },
  ],
  Satisfactory: [
    { label: '保存世界', cmd: 'SaveGame' },
    { label: '停止服务器', cmd: 'Shutdown' },
    { label: '查看玩家', cmd: 'ListPlayers' },
    { label: '踢出玩家', cmd: 'KickPlayer "玩家名"' },
  ],
  Project_Zomboid: [
    { label: '保存世界', cmd: 'save' },
    { label: '停止服务器', cmd: 'quit' },
    { label: '广播公告', cmd: 'servermsg 服务器维护中' },
    { label: '在线玩家', cmd: 'players' },
    { label: '踢出玩家', cmd: 'kickuser 玩家名 理由' },
    { label: '封禁玩家', cmd: 'banuser 玩家名 理由' },
  ],
}

const COMMON_QUICK_CMDS = [
  { label: '查看内存', cmd: 'free -h' },
  { label: '磁盘占用', cmd: 'df -h' },
  { label: '运行时长', cmd: 'uptime' },
  { label: '进程列表', cmd: 'ps aux | head -20' },
  { label: '查看日志', cmd: 'ls -la logs/ 2>/dev/null || ls -la' },
  { label: '当前目录', cmd: 'pwd && ls -la' },
]

export default function ServerConsolePage() {
  const { addNotification } = useNotificationStore()
  const [instances, setInstances] = useState<Instance[]>([])
  const [selectedId, setSelectedId] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState<any>(null)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [busy, setBusy] = useState(false)
  const [playerName, setPlayerName] = useState('')
  const [announceText, setAnnounceText] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const logRef = useRef<HTMLDivElement>(null)
  const [showMc, setShowMc] = useState(false)

  const selected = instances.find(i => i.id === selectedId) || null

  const addLog = useCallback((type: LogEntry['type'], text: string) => {
    setLogs(prev => [...prev.slice(-99), { time: new Date().toLocaleTimeString(), type, text }])
    if (type === 'error') {
      addNotification({ type: 'error', title: '操作失败', message: text, duration: 4000 })
    }
  }, [addNotification])

  const loadInstances = useCallback(async () => {
    try {
      const res = await apiClient.getInstances()
      const data = res.data || res
      const list: Instance[] = Array.isArray(data) ? data : (data as any).data || []
      setInstances(list)
      if (!selectedId && list.length > 0) setSelectedId(list[0].id)
    } catch (e: any) {
      addLog('error', '加载实例列表失败: ' + (e?.message || e))
    } finally {
      setLoading(false)
    }
  }, [selectedId, addLog])

  const loadStatus = useCallback(async (id: string) => {
    try {
      const res = await apiClient.getInstanceStatus(id)
      setStatus(res.data || res)
    } catch { /* 忽略轮询错误 */ }
  }, [])

  useEffect(() => { loadInstances() }, [loadInstances])

  useEffect(() => {
    if (!selectedId) return
    loadStatus(selectedId)
    const timer = setInterval(() => loadStatus(selectedId), 5000)
    return () => clearInterval(timer)
  }, [selectedId, loadStatus])

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [logs])

  useEffect(() => {
    if (!selected) return
    const isMc = selected.instanceType === 'minecraft-java' || selected.instanceType === 'minecraft-bedrock'
      || (selected.gameKey || '').toLowerCase().includes('minecraft')
      || (selected.name || '').toLowerCase().includes('mc')
      || (selected.name || '').toLowerCase().includes('我的世界')
      || (selected.name || '').toLowerCase().includes('minecraft')
    setShowMc(!!isMc)
  }, [selected])

  const isRunning = selected?.status === 'running' || status?.data?.status === 'running'

  const sendCommand = async (command: string, label?: string) => {
    if (!command || !selectedId) return
    addLog('command', (label ? label + ': ' : '') + command)
    try {
      const res: any = await apiClient.post(`/instances/${selectedId}/input`, { input: command })
      const r = res.data || res
      if (r?.success === false) {
        addLog('error', '操作失败: ' + (r.message || r.error || ''))
      } else {
        addLog('success', '操作已执行')
      }
    } catch (e: any) {
      addLog('error', '操作失败: ' + (e?.response?.data?.message || e?.message || e))
    }
  }

  const runAction = async (action: 'start' | 'stop', label: string) => {
    if (!selectedId || busy) return
    setBusy(true)
    try {
      const res = action === 'start'
        ? await apiClient.startInstance(selectedId)
        : await apiClient.stopInstance(selectedId)
      const r: any = res.data || res
      if (r?.success === false) {
        addLog('error', `${label}失败: ${r.error || r.message || '未知错误'}`)
      } else {
        addLog('success', `${label}成功`)
      }
      await loadStatus(selectedId)
      await loadInstances()
    } catch (e: any) {
      addLog('error', `${label}失败: ${e?.response?.data?.message || e?.message || e}`)
    } finally {
      setBusy(false)
    }
  }

  const togglePower = () => {
    if (isRunning) runAction('stop', '停止')
    else runAction('start', '启动')
  }

  const restart = async () => {
    await runAction('stop', '停止')
    setTimeout(() => runAction('start', '启动'), 800)
  }

  // 一键常用操作（无需命令）
  const quickActions = () => {
    const base: { label: string; icon: string; cmd: string; color: string; always?: boolean }[] = []
    if (showMc) {
      base.push(
        { label: '保存世界', icon: '💾', cmd: '/save-all', color: 'bg-blue-500 hover:bg-blue-600' },
        { label: '在线玩家', icon: '👥', cmd: '/list', color: 'bg-indigo-500 hover:bg-indigo-600' },
        { label: '设为白天', icon: '☀️', cmd: '/time set day', color: 'bg-amber-500 hover:bg-amber-600' },
        { label: '晴朗天气', icon: '🌤', cmd: '/weather clear', color: 'bg-sky-500 hover:bg-sky-600' },
        { label: '全员创造', icon: '🛠', cmd: '/gamemode creative @a', color: 'bg-purple-500 hover:bg-purple-600' },
        { label: '全员生存', icon: '⚔️', cmd: '/gamemode survival @a', color: 'bg-emerald-500 hover:bg-emerald-600' },
      )
    }
    base.push(
      { label: '查看内存', icon: '📊', cmd: 'free -h', color: 'bg-gray-500 hover:bg-gray-600' },
      { label: '磁盘空间', icon: '💽', cmd: 'df -h', color: 'bg-gray-500 hover:bg-gray-600' },
      { label: '运行时长', icon: '⏱', cmd: 'uptime', color: 'bg-gray-500 hover:bg-gray-600' },
    )
    return base
  }

  // 玩家操作按钮
  const playerOps = () => {
    const ops: { label: string; cmd: (n: string) => string; color: string; confirm?: string }[] = []
    if (showMc) {
      ops.push(
        { label: '踢出玩家', cmd: n => `/kick ${n}`, color: 'bg-orange-500 hover:bg-orange-600' },
        { label: '封禁玩家', cmd: n => `/ban ${n}`, color: 'bg-red-500 hover:bg-red-600' },
        { label: '设为管理员', cmd: n => `/op ${n}`, color: 'bg-purple-500 hover:bg-purple-600' },
        { label: '解除管理员', cmd: n => `/deop ${n}`, color: 'bg-violet-500 hover:bg-violet-600' },
      )
    } else {
      ops.push(
        { label: '踢出玩家', cmd: n => `kick "${n}"`, color: 'bg-orange-500 hover:bg-orange-600' },
        { label: '封禁玩家', cmd: n => `ban "${n}"`, color: 'bg-red-500 hover:bg-red-600' },
      )
    }
    return ops
  }

  const doPlayerOp = (op: { label: string; cmd: (n: string) => string }) => {
    const name = playerName.trim()
    if (!name) {
      addLog('error', '请先填写玩家名称')
      return
    }
    sendCommand(op.cmd(name), op.label)
    setPlayerName('')
  }

  const sendAnnounce = () => {
    const text = announceText.trim()
    if (!text) { addLog('error', '请先填写公告内容'); return }
    let cmd = ''
    if (showMc) cmd = `/say ${text}`
    else if ((selected?.gameKey || '').toLowerCase().includes('palworld')) cmd = `/broadcast ${text}`
    else cmd = `say ${text}`
    sendCommand(cmd, '发送公告')
    setAnnounceText('')
  }

  const typeLabel = (t?: string) => {
    const map: Record<string, string> = {
      'generic': '通用服务器',
      'minecraft-java': '我的世界 Java 版',
      'minecraft-bedrock': '我的世界 基岩版',
    }
    return (t && map[t]) || t || '通用'
  }

  const statusInfo = () => {
    const s = status?.data?.status || selected?.status || 'stopped'
    const map: Record<string, { text: string; dot: string; card: string }> = {
      'running': { text: '● 运行中', dot: 'bg-green-500', card: 'border-green-500 bg-green-50 dark:bg-green-950/30' },
      'starting': { text: '◐ 启动中...', dot: 'bg-yellow-500 animate-pulse', card: 'border-yellow-500 bg-yellow-50 dark:bg-yellow-950/30' },
      'stopping': { text: '◐ 停止中...', dot: 'bg-orange-500 animate-pulse', card: 'border-orange-500 bg-orange-50 dark:bg-orange-950/30' },
      'error': { text: '✕ 异常', dot: 'bg-red-500', card: 'border-red-500 bg-red-50 dark:bg-red-950/30' },
      'stopped': { text: '○ 已停止', dot: 'bg-gray-400', card: 'border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900' },
    }
    return map[s] || map['stopped']
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100">
      <div className="border-b border-gray-200 dark:border-gray-800 px-6 py-4 bg-white dark:bg-gray-900">
        <h1 className="text-xl font-bold">服主便携控制后台</h1>
        <p className="text-sm text-gray-500 mt-0.5">简单可视化操作：点按钮就能管理服务器，无需输入命令</p>
      </div>

      <div className="flex h-[calc(100vh-140px)]">
        {/* 左侧实例列表 */}
        <div className="w-64 border-r border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-y-auto p-3 space-y-2">
          <div className="text-xs text-gray-500 font-semibold px-2 py-1">我的服务器 ({instances.length})</div>
          {loading && <div className="text-sm text-gray-400 p-2">加载中...</div>}
          {!loading && instances.length === 0 && (
            <div className="text-sm text-gray-400 p-2">
              还没有服务器实例，先到 <span className="text-blue-500">游戏部署</span> 或 <span className="text-blue-500">实例管理</span> 创建一个吧
            </div>
          )}
          {instances.map(inst => (
            <button
              key={inst.id}
              onClick={() => setSelectedId(inst.id)}
              className={`w-full text-left px-3 py-2.5 rounded-lg border transition-colors ${
                selectedId === inst.id
                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/40'
                  : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${inst.status === 'running' ? 'bg-green-500' : inst.status === 'error' ? 'bg-red-500' : 'bg-gray-400'}`} />
                <span className="font-medium text-sm truncate">{inst.name}</span>
              </div>
              <div className="text-xs text-gray-500 mt-1">{typeLabel(inst.instanceType)}{inst.gameVersion ? ' · v' + inst.gameVersion : ''}</div>
            </button>
          ))}
        </div>

        {/* 右侧操作区 */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {!selected ? (
            <div className="flex-1 flex items-center justify-center text-gray-400">
              请先在左侧选择要管理的服务器
            </div>
          ) : (
            <>
              {/* 状态 + 大开关 */}
              <div className={`p-5 border-b-2 ${statusInfo().card}`}>
                <div className="flex items-center justify-between flex-wrap gap-4">
                  <div>
                    <div className="flex items-center gap-3">
                      <span className={`w-3 h-3 rounded-full ${statusInfo().dot}`} />
                      <h2 className="text-lg font-semibold">{selected.name}</h2>
                      <span className="text-sm text-gray-600 dark:text-gray-300">{statusInfo().text}</span>
                    </div>
                    <div className="text-xs text-gray-500 mt-1.5">
                      {typeLabel(selected.instanceType)} · 端口信息见实例管理页
                    </div>
                  </div>
                  {/* 大电源开关 */}
                  <button
                    onClick={togglePower}
                    disabled={busy || selected.status === 'starting' || selected.status === 'stopping'}
                    className={`relative w-28 h-14 rounded-full transition-all shadow-lg ${
                      isRunning ? 'bg-green-500 hover:bg-green-600' : 'bg-gray-400 hover:bg-gray-500'
                    } disabled:opacity-50 flex items-center justify-center text-white font-bold text-sm`}
                  >
                    <span className={`absolute left-4 top-1/2 -translate-y-1/2 text-2xl ${isRunning ? '' : 'opacity-50'}`}>
                      {isRunning ? '⏹' : '▶'}
                    </span>
                    <span className="ml-8">{isRunning ? '停止' : '启动'}</span>
                  </button>
                </div>
                {/* 操作按钮行 */}
                <div className="flex gap-2 mt-4 flex-wrap">
                  <button onClick={() => runAction('start', '启动')} disabled={busy || isRunning}
                    className="px-4 py-2 rounded-lg bg-green-600 hover:bg-green-700 disabled:opacity-40 text-white text-sm font-medium">
                    ▶ 启动
                  </button>
                  <button onClick={() => runAction('stop', '停止')} disabled={busy || !isRunning}
                    className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white text-sm font-medium">
                    ⏹ 停止
                  </button>
                  <button onClick={restart} disabled={busy}
                    className="px-4 py-2 rounded-lg bg-orange-500 hover:bg-orange-600 disabled:opacity-40 text-white text-sm font-medium">
                    🔄 重启
                  </button>
                </div>
              </div>

              {/* 一键操作 */}
              <div className="p-4 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
                <div className="text-xs font-semibold text-gray-500 mb-2">一键操作（点一下就行）</div>
                <div className="flex flex-wrap gap-2">
                  {quickActions().map(q => (
                    <button key={q.label} onClick={() => sendCommand(q.cmd, q.label)}
                      className={`px-3 py-2 rounded-lg text-white text-xs font-medium transition-colors ${q.color}`}>
                      {q.icon} {q.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* 玩家管理 */}
              <div className="p-4 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
                <div className="text-xs font-semibold text-gray-500 mb-2">👤 玩家管理</div>
                <div className="flex gap-2 flex-wrap items-center">
                  <input
                    value={playerName}
                    onChange={e => setPlayerName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && playerOps().length) doPlayerOp(playerOps()[0]) }}
                    placeholder={showMc ? '输入玩家名称（如 Steve）' : '输入玩家名称'}
                    className="w-48 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  {playerOps().map(op => (
                    <button key={op.label} onClick={() => doPlayerOp(op)}
                      className={`px-3 py-2 rounded-lg text-white text-xs font-medium transition-colors ${op.color}`}>
                      {op.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* 公告 */}
              <div className="p-4 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
                <div className="text-xs font-semibold text-gray-500 mb-2">📢 服务器公告</div>
                <div className="flex gap-2">
                  <input
                    value={announceText}
                    onChange={e => setAnnounceText(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') sendAnnounce() }}
                    placeholder="输入公告内容，如：服务器将于 20:00 重启"
                    className="flex-1 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <button onClick={sendAnnounce}
                    className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium">
                    发送公告
                  </button>
                </div>
              </div>

              {/* 操作记录 + 高级命令 */}
              <div className="flex-1 flex flex-col min-h-0">
                <div className="flex-1 overflow-y-auto bg-black text-green-400 font-mono text-xs p-3 space-y-1">
                  {logs.length === 0 && <div className="text-gray-500">操作记录会显示在这里</div>}
                  {logs.map((log, i) => (
                    <div key={i} className={
                      log.type === 'error' ? 'text-red-400'
                      : log.type === 'success' ? 'text-green-300'
                      : log.type === 'command' ? 'text-yellow-300'
                      : 'text-gray-400'
                    }>
                      <span className="text-gray-600">[{log.time}]</span> {log.text}
                    </div>
                  ))}
                </div>
                <button onClick={() => setShowAdvanced(!showAdvanced)}
                  className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 border-t border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 text-left">
                  {showAdvanced ? '▾ 收起高级命令' : '▸ 高级命令（手动输入）'}
                </button>
                {showAdvanced && (
                  <div className="p-3 border-t border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 flex gap-2">
                    <input
                      id="adv-cmd-input"
                      placeholder={showMc ? '输入命令，如 /list' : '输入命令，如 free -h'}
                      className="flex-1 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      onKeyDown={e => { if (e.key === 'Enter') { const v = (e.target as HTMLInputElement).value.trim(); if (v) { sendCommand(v); (e.target as HTMLInputElement).value = '' } } }}
                    />
                    <button onClick={() => {
                      const el = document.getElementById('adv-cmd-input') as HTMLInputElement
                      const v = el?.value?.trim()
                      if (v) { sendCommand(v); el.value = '' }
                    }} className="px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-800 text-white text-sm font-medium">
                      发送
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
