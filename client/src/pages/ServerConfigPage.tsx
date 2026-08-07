import React, { useEffect, useRef, useState, useCallback } from 'react'
import apiClient from '@/utils/api'
import type { Instance } from '@/types'
import { useNotificationStore } from '@/stores/notificationStore'

const PROPERTY_FIELDS: { key: string; label: string; type: 'text' | 'number' | 'select' | 'toggle'; options?: string[]; hint?: string }[] = [
  { key: 'motd', label: '服务器名称 (MOTD)', type: 'text', hint: '玩家列表显示的服务器名' },
  { key: 'difficulty', label: '难度', type: 'select', options: ['peaceful', 'easy', 'normal', 'hard'], hint: '和平 / 简单 / 普通 / 困难' },
  { key: 'gamemode', label: '默认游戏模式', type: 'select', options: ['survival', 'creative', 'adventure', 'spectator'], hint: '新玩家进入时的模式' },
  { key: 'pvp', label: '玩家对战 (PVP)', type: 'toggle', hint: '允许玩家互相攻击' },
  { key: 'online-mode', label: '正版验证', type: 'toggle', hint: '开启=仅正版可进；关闭=离线可进' },
  { key: 'white-list', label: '白名单', type: 'toggle', hint: '开启后仅白名单玩家可进' },
  { key: 'max-players', label: '最大玩家数', type: 'number', hint: '同时在线人数上限' },
  { key: 'view-distance', label: '视距 (区块)', type: 'number', hint: '玩家可视范围' },
  { key: 'server-port', label: '端口', type: 'number', hint: '监听端口（默认25565）' },
  { key: 'level-name', label: '世界名称', type: 'text', hint: '主世界文件夹名' },
  { key: 'spawn-monsters', label: '生成怪物', type: 'toggle', hint: '夜晚生成怪物' },
  { key: 'spawn-animals', label: '生成动物', type: 'toggle', hint: '生成被动生物' },
  { key: 'spawn-npcs', label: '生成NPC', type: 'toggle', hint: '生成村民等' },
  { key: 'enable-command-block', label: '命令方块', type: 'toggle', hint: '允许命令方块' },
  { key: 'allow-flight', label: '允许飞行', type: 'toggle', hint: '防止飞行作弊踢出' },
  { key: 'hardcore', label: '极限模式', type: 'toggle', hint: '死亡即封禁' },
]

const CONFIG_FILES = ['server.properties', 'bukkit.yml', 'spigot.yml', 'paper.yml', 'whitelist.json', 'ops.json', 'banned-players.json', 'banned-ips.json', 'permissions.yml', 'usercache.json']

export default function ServerConfigPage() {
  const { addNotification } = useNotificationStore()
  const [instances, setInstances] = useState<Instance[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [configFile, setConfigFile] = useState('server.properties')
  const [mode, setMode] = useState<'form' | 'text'>('form')
  const [content, setContent] = useState('')
  const [form, setForm] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(false)
  const [logs, setLogs] = useState<{ time: string; type: string; text: string }[]>([])
  const logRef = useRef<HTMLDivElement>(null)

  const selected = instances.find(i => i.id === selectedId) || null

  const addLog = useCallback((type: string, text: string) => {
    setLogs(prev => [...prev.slice(-49), { time: new Date().toLocaleTimeString(), type, text }])
    if (type === 'error') addNotification({ type: 'error', title: '操作失败', message: text, duration: 4000 })
  }, [addNotification])

  const loadInstances = useCallback(async () => {
    try {
      const res: any = await apiClient.getInstances()
      const data = res.data || []
      const list: Instance[] = Array.isArray(data) ? data : []
      setInstances(list)
      if (!selectedId && list.length > 0) setSelectedId(list[0].id)
    } catch (e: any) {
      addLog('error', '加载实例失败: ' + (e?.message || e))
    }
  }, [selectedId, addLog])

  const loadConfig = useCallback(async (id: string, file: string) => {
    if (!id) return
    setLoading(true)
    try {
      const res: any = await apiClient.get(`/instances/${id}/server-config/${encodeURIComponent(file)}`)
      if (res?.success) {
        const c = res.data?.content || ''
        setContent(c)
        if (file === 'server.properties') {
          const parsed: Record<string, string> = {}
          c.split('\n').forEach(line => {
            const m = line.match(/^\s*([a-zA-Z0-9-]+)\s*=\s*(.*)$/)
            if (m) parsed[m[1]] = m[2].trim()
          })
          setForm(parsed)
        }
      }
    } catch (e: any) {
      addLog('error', '加载配置失败: ' + (e?.message || e))
    } finally {
      setLoading(false)
    }
  }, [addLog])

  useEffect(() => { loadInstances() }, [loadInstances])

  useEffect(() => {
    if (selectedId) loadConfig(selectedId, configFile)
  }, [selectedId, configFile, loadConfig])

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [logs])

  const save = async () => {
    if (!selectedId || saving) return
    setSaving(true)
    try {
      let toSave = content
      if (configFile === 'server.properties' && mode === 'form') {
        const lines = content.split('\n')
        const keySet = new Set(Object.keys(form))
        const updated = lines.map(line => {
          const m = line.match(/^\s*([a-zA-Z0-9-]+)\s*=\s*(.*)$/)
          if (m && keySet.has(m[1])) return `${m[1]}=${form[m[1]]}`
          return line
        })
        const existingKeys = new Set(lines.map(l => { const m = l.match(/^\s*([a-zA-Z0-9-]+)\s*=/); return m ? m[1] : null }).filter(Boolean))
        Object.keys(form).filter(k => !existingKeys.has(k)).forEach(k => updated.push(`${k}=${form[k]}`))
        toSave = updated.join('\n')
      }
      const res: any = await apiClient.put(`/instances/${selectedId}/server-config/${encodeURIComponent(configFile)}`, { content: toSave })
      if (res?.success) {
        addLog('success', `${configFile} 已保存（重启服务器生效）`)
        loadConfig(selectedId, configFile)
      } else {
        addLog('error', '保存失败: ' + (res?.error || ''))
      }
    } catch (e: any) {
      addLog('error', '保存失败: ' + (e?.message || e))
    } finally {
      setSaving(false)
    }
  }

  const updateField = (key: string, value: string) => setForm(prev => ({ ...prev, [key]: value }))

  const isMc = !!selected && (selected.instanceType === 'minecraft-java' || selected.instanceType === 'minecraft-bedrock'
    || (selected.gameKey || '').toLowerCase().includes('minecraft'))

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100">
      <div className="border-b border-gray-200 dark:border-gray-800 px-6 py-4 bg-white dark:bg-gray-900">
        <h1 className="text-xl font-bold">服务器配置</h1>
        <p className="text-sm text-gray-500 mt-0.5">可视化配置服务器：下拉 / 开关 / 填写，无需手动改文本</p>
      </div>

      <div className="flex h-[calc(100vh-140px)]">
        {/* 左侧实例选择 */}
        <div className="w-72 border-r border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-y-auto p-3">
          <div className="text-xs text-gray-500 font-semibold px-2 py-1">选择服务器</div>
          {instances.length === 0 && <div className="text-sm text-gray-400 p-2">暂无实例，请先创建服务器</div>}
          {instances.map(inst => (
            <button key={inst.id} onClick={() => setSelectedId(inst.id)}
              className={`w-full text-left px-3 py-2.5 rounded-lg border mb-1 transition-colors ${
                selectedId === inst.id ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/40' : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800'
              }`}>
              <div className="flex items-center gap-2">
                <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${inst.status === 'running' ? 'bg-green-500' : 'bg-gray-400'}`} />
                <span className="font-medium text-sm truncate">{inst.name}</span>
              </div>
              <div className="text-xs text-gray-500 mt-1">
                {inst.instanceType === 'minecraft-java' ? '我的世界 Java' : inst.instanceType === 'minecraft-bedrock' ? '我的世界基岩' : '通用服务器'}
              </div>
            </button>
          ))}
        </div>

        {/* 右侧配置区 */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {!selected ? (
            <div className="flex-1 flex items-center justify-center text-gray-400">请选择服务器</div>
          ) : (
            <>
              {/* 顶部工具栏 */}
              <div className="p-4 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <select value={configFile} onChange={e => setConfigFile(e.target.value)}
                      className="px-2 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                      {CONFIG_FILES.map(f => <option key={f} value={f}>{f}</option>)}
                    </select>
                    {configFile === 'server.properties' && (
                      <div className="flex rounded-lg overflow-hidden border border-gray-300 dark:border-gray-700">
                        <button onClick={() => setMode('form')}
                          className={`px-3 py-1.5 text-sm ${mode === 'form' ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-500'}`}>可视化</button>
                        <button onClick={() => setMode('text')}
                          className={`px-3 py-1.5 text-sm ${mode === 'text' ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-500'}`}>文本</button>
                      </div>
                    )}
                    {loading && <span className="text-xs text-gray-400">加载中...</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    {isMc && <span className="text-xs px-2 py-1 rounded bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300">⛏ 我的世界服务器</span>}
                    <button onClick={save} disabled={saving}
                      className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-sm font-medium">
                      {saving ? '保存中...' : '💾 保存设置'}
                    </button>
                  </div>
                </div>
              </div>

              {/* 表单/文本 主体 */}
              <div className="flex-1 overflow-y-auto p-4 bg-white dark:bg-gray-900">
                {configFile === 'server.properties' && mode === 'form' ? (
                  <div className="max-w-3xl mx-auto space-y-2">
                    {PROPERTY_FIELDS.map(f => (
                      <div key={f.key} className="flex items-center justify-between bg-gray-50 dark:bg-gray-800 rounded-xl px-4 py-3">
                        <div className="flex-1 mr-3">
                          <div className="text-sm font-medium">{f.label}</div>
                          <div className="text-[11px] text-gray-400">{f.hint}</div>
                        </div>
                        {f.type === 'toggle' ? (
                          <button onClick={() => updateField(f.key, (form[f.key] || 'false') === 'true' ? 'false' : 'true')}
                            className={`relative w-14 h-7 rounded-full transition-colors ${(form[f.key] || 'false') === 'true' ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'}`}>
                            <span className={`absolute top-0.5 w-6 h-6 rounded-full bg-white shadow transition-all ${(form[f.key] || 'false') === 'true' ? 'left-7' : 'left-0.5'}`} />
                          </button>
                        ) : f.type === 'select' ? (
                          <select value={form[f.key] || ''} onChange={e => updateField(f.key, e.target.value)}
                            className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm w-44">
                            {f.options?.map(o => <option key={o} value={o}>{o}</option>)}
                          </select>
                        ) : (
                          <input type={f.type === 'number' ? 'number' : 'text'} value={form[f.key] || ''}
                            onChange={e => updateField(f.key, e.target.value)}
                            className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm w-44" />
                        )}
                      </div>
                    ))}
                    <div className="text-[11px] text-gray-400 pt-1">表单保存会合并到 server.properties；高级选项切「文本」模式</div>
                  </div>
                ) : (
                  <div className="flex flex-col h-full">
                    <textarea value={content} onChange={e => setContent(e.target.value)}
                      className="flex-1 w-full font-mono text-xs bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none min-h-[300px]" />
                    <div className="text-[11px] text-gray-400 mt-2">
                      {configFile.endsWith('.json') ? 'JSON 名单文件（whitelist/ops/banned），保存后执行对应命令刷新' : 'YAML/配置文件，保存后重启服务器生效'}
                    </div>
                  </div>
                )}
              </div>

              {/* 操作记录 */}
              <div className="h-32 bg-black text-green-400 font-mono text-xs p-3 overflow-y-auto border-t border-gray-800" ref={logRef}>
                {logs.map((l, i) => (
                  <div key={i} className={l.type === 'error' ? 'text-red-400' : l.type === 'success' ? 'text-green-300' : 'text-gray-400'}>
                    <span className="text-gray-600">[{l.time}]</span> {l.text}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
