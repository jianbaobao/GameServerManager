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
  const [cmdInput, setCmdInput] = useState('')
  const [busy, setBusy] = useState(false)
  const logRef = useRef<HTMLDivElement>(null)
  const [showMc, setShowMc] = useState(false)

  const selected = instances.find(i => i.id === selectedId) || null

  const addLog = useCallback((type: LogEntry['type'], text: string) => {
    setLogs(prev => [...prev.slice(-199), { time: new Date().toLocaleTimeString(), type, text }])
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

  const gameCmds = useCallback((): { label: string; cmd: string }[] => {
    if (!selected) return []
    if (showMc) return GAME_QUICK_CMDS.minecraft || []
    // 按 gameKey / 实例名匹配游戏专属指令
    const key = (selected.gameKey || '') + ' ' + (selected.name || '')
    for (const gk of Object.keys(GAME_QUICK_CMDS)) {
      if (gk === 'minecraft') continue
      if (key.toLowerCase().includes(gk.toLowerCase())) {
        return GAME_QUICK_CMDS[gk] || []
      }
    }
    return []
  }, [selected, showMc])

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

  const restart = async () => {
    await runAction('stop', '停止')
    setTimeout(() => runAction('start', '启动'), 800)
  }

  const sendCommand = async (cmd?: string) => {
    const command = (cmd !== undefined ? cmd : cmdInput).trim()
    if (!command || !selectedId) return
    setCmdInput('')
    addLog('command', '> ' + command)
    try {
      const res: any = await apiClient.post(`/instances/${selectedId}/input`, { input: command })
      const r = res.data || res
      if (r?.success === false) {
        addLog('error', '命令执行失败: ' + (r.message || r.error || ''))
      } else {
        addLog('success', '命令已发送到服务器控制台')
      }
    } catch (e: any) {
      addLog('error', '命令发送失败: ' + (e?.response?.data?.message || e?.message || e))
    }
  }

  const typeLabel = (t?: string) => {
    const map: Record<string, string> = {
      'generic': '通用服务器',
      'minecraft-java': '我的世界 Java 版',
      'minecraft-bedrock': '我的世界 基岩版',
    }
    return (t && map[t]) || t || '通用'
  }

  const statusColor = (s?: string) => {
    const map: Record<string, string> = {
      'running': 'bg-green-500',
      'starting': 'bg-yellow-500 animate-pulse',
      'stopping': 'bg-orange-500 animate-pulse',
      'stopped': 'bg-gray-400',
      'error': 'bg-red-500',
    }
    return (s && map[s]) || 'bg-gray-400'
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100">
      <div className="border-b border-gray-200 dark:border-gray-800 px-6 py-4 bg-white dark:bg-gray-900">
        <h1 className="text-xl font-bold">{PAGE_TITLE}</h1>
        <p className="text-sm text-gray-500 mt-0.5">集中管理所有游戏服务器：启动 / 停止 / 控制台命令，我的世界专属快捷指令</p>
      </div>

      <div className="flex h-[calc(100vh-140px)]">
        {/* 左侧实例列表 */}
        <div className="w-72 border-r border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-y-auto p-3 space-y-2">
          <div className="text-xs text-gray-500 font-semibold px-2 py-1">实例列表 ({instances.length})</div>
          {loading && <div className="text-sm text-gray-400 p-2">加载中...</div>}
          {!loading && instances.length === 0 && (
            <div className="text-sm text-gray-400 p-2">
              暂无实例，请先到 <span className="text-blue-500">游戏部署</span> 或 <span className="text-blue-500">实例管理</span> 创建服务器
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
                <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${statusColor(inst.status)}`} />
                <span className="font-medium text-sm truncate">{inst.name}</span>
              </div>
              <div className="text-xs text-gray-500 mt-1 flex items-center gap-2">
                <span>{typeLabel(inst.instanceType)}</span>
                {inst.gameVersion && <span className="text-blue-400">v{inst.gameVersion}</span>}
              </div>
              <div className="text-[11px] text-gray-400 truncate mt-0.5">{inst.workingDirectory}</div>
            </button>
          ))}
        </div>

        {/* 右侧控制台 */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {!selected ? (
            <div className="flex-1 flex items-center justify-center text-gray-400">
              请选择左侧实例开始管理
            </div>
          ) : (
            <>
              {/* 状态卡片 */}
              <div className="p-4 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div className="flex items-center gap-3">
                    <span className={`w-3 h-3 rounded-full ${statusColor(selected.status)}`} />
                    <h2 className="text-lg font-semibold">{selected.name}</h2>
                    <span className="text-xs px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300">
                      {status?.data?.status || selected.status}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => runAction('start', '启动')} disabled={busy || selected.status === 'running'}
                      className="px-4 py-1.5 text-sm rounded-lg bg-green-600 hover:bg-green-700 disabled:opacity-40 text-white transition-colors">
                      ▶ 启动
                    </button>
                    <button onClick={() => runAction('stop', '停止')} disabled={busy || selected.status !== 'running'}
                      className="px-4 py-1.5 text-sm rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white transition-colors">
                      ⏹ 停止
                    </button>
                    <button onClick={restart} disabled={busy}
                      className="px-4 py-1.5 text-sm rounded-lg bg-orange-500 hover:bg-orange-600 disabled:opacity-40 text-white transition-colors">
                      🔄 重启
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3 text-sm">
                  <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-2.5">
                    <div className="text-xs text-gray-500">工作目录</div>
                    <div className="font-mono text-xs mt-0.5 truncate">{selected.workingDirectory}</div>
                  </div>
                  <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-2.5">
                    <div className="text-xs text-gray-500">启动命令</div>
                    <div className="font-mono text-xs mt-0.5 truncate">{selected.startCommand || '-'}</div>
                  </div>
                  <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-2.5">
                    <div className="text-xs text-gray-500">PID</div>
                    <div className="font-mono text-xs mt-0.5">{selected.pid || status?.data?.pid || '-'}</div>
                  </div>
                  <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-2.5">
                    <div className="text-xs text-gray-500">类型</div>
                    <div className="text-xs mt-0.5">{typeLabel(selected.instanceType)}</div>
                  </div>
                </div>
              </div>

              {/* 快捷命令 */}
              <div className="p-4 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-x-auto">
                {gameCmds().length > 0 && (
                  <div className="mb-3">
                    <div className="text-xs font-semibold text-green-600 dark:text-green-400 mb-2">
                      {showMc ? '⛏ 我的世界服主快捷指令' : '🎮 本游戏开服快捷指令'}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {gameCmds().map(q => (
                        <button key={q.label} onClick={() => sendCommand(q.cmd)}
                          className="text-xs px-3 py-1.5 rounded-md bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 hover:bg-green-200 dark:hover:bg-green-800 transition-colors">
                          {q.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <div className="text-xs font-semibold text-gray-500 mb-2">通用运维命令</div>
                <div className="flex flex-wrap gap-2">
                  {COMMON_QUICK_CMDS.map(q => (
                    <button key={q.label} onClick={() => sendCommand(q.cmd)}
                      className="text-xs px-3 py-1.5 rounded-md bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors">
                      {q.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* 控制台输出 */}
              <div className="flex-1 overflow-y-auto bg-black text-green-400 font-mono text-sm p-4 space-y-1" ref={logRef}>
                {logs.length === 0 && <div className="text-gray-500">等待操作... 输入命令或点击快捷按钮开始</div>}
                {logs.map((log, i) => (
                  <div key={i} className={
                    log.type === 'error' ? 'text-red-400'
                    : log.type === 'success' ? 'text-green-300'
                    : log.type === 'command' ? 'text-yellow-300'
                    : log.type === 'output' ? 'text-gray-300'
                    : 'text-gray-400'
                  }>
                    <span className="text-gray-600">[{log.time}]</span> {log.text}
                  </div>
                ))}
              </div>

              {/* 命令输入 */}
              <div className="p-3 border-t border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 flex gap-2">
                <input
                  value={cmdInput}
                  onChange={e => setCmdInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') sendCommand() }}
                  placeholder={showMc ? '输入我的世界指令，如 /list 或服务器命令...' : '输入服务器控制台命令...'}
                  className="flex-1 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button onClick={() => sendCommand()}
                  className="px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-colors">
                  发送
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
