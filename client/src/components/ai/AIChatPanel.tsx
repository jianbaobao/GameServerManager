import React, { useState, useRef, useEffect } from 'react'
import apiClient from '../../utils/api'

interface AIChatProps {
  terminalOutput?: string
  instanceId?: string
}

const AIChatPanel: React.FC<AIChatProps> = ({ terminalOutput, instanceId }) => {
  const [isOpen, setIsOpen] = useState(false)
  const [messages, setMessages] = useState<{role: 'user' | 'assistant'; content: string}[]>([
    { role: 'assistant', content: '你好！我是 GSM3 AI 助手，我可以帮你分析服务器问题、解答配置疑问。你可以直接提问，或者粘贴终端输出来分析错误。' }
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Auto-analyze terminal output when provided
  useEffect(() => {
    if (terminalOutput && terminalOutput.length > 50 && isOpen) {
      analyzeOutput(terminalOutput)
    }
  }, [terminalOutput, isOpen])

  const analyzeOutput = async (output: string) => {
    setLoading(true)
    setMessages(prev => [...prev, { role: 'user', content: '请分析以下终端输出中的错误和警告：\n```\n' + output.substring(0, 1000) + '\n```' }])
    try {
      const res = await apiClient.post('/api/ai/analyze-terminal', { output })
      if (res.success) {
        setMessages(prev => [...prev, { role: 'assistant', content: res.answer }])
      }
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: '分析失败，请稍后重试。' }])
    }
    setLoading(false)
  }

  const sendQuery = async () => {
    if (!input.trim() || loading) return
    const q = input.trim()
    setInput('')
    setMessages(prev => [...prev, { role: 'user', content: q }])
    setLoading(true)
    try {
      const res = await apiClient.post('/api/ai/query', {
        prompt: q,
        terminalOutput: terminalOutput?.substring(0, 3000)
      })
      if (res.success) {
        setMessages(prev => [...prev, { role: 'assistant', content: res.answer }])
      }
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: '查询失败，请检查网络连接。' }])
    }
    setLoading(false)
  }

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{
          position: 'fixed', bottom: '20px', right: '20px', zIndex: 1000,
          width: '56px', height: '56px', borderRadius: '50%',
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          color: 'white', border: 'none', cursor: 'pointer',
          boxShadow: '0 4px 15px rgba(102, 126, 234, 0.4)',
          fontSize: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}
        title="AI 助手"
      >
        {isOpen ? '✕' : '🤖'}
      </button>

      {/* Chat panel */}
      {isOpen && (
        <div style={{
          position: 'fixed', bottom: '90px', right: '20px', zIndex: 1000,
          width: '380px', height: '500px',
          background: '#1a1a2e', borderRadius: '16px',
          boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden', border: '1px solid rgba(255,255,255,0.1)'
        }}>
          {/* Header */}
          <div style={{
            padding: '16px 20px', background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
            color: 'white', fontWeight: 'bold', fontSize: '16px'
          }}>
            🤖 GSM3 AI 助手
            <span style={{ fontSize: '12px', opacity: 0.8, marginLeft: '8px' }}>内置分析引擎</span>
          </div>

          {/* Messages */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
            {messages.map((msg, i) => (
              <div key={i} style={{
                marginBottom: '12px',
                display: 'flex',
                justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start'
              }}>
                <div style={{
                  maxWidth: '85%',
                  padding: '10px 14px',
                  borderRadius: msg.role === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                  background: msg.role === 'user' ? '#667eea' : 'rgba(255,255,255,0.08)',
                  color: 'white',
                  fontSize: '13px',
                  lineHeight: '1.5',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word'
                }}>
                  {msg.content}
                </div>
              </div>
            ))}
            {loading && (
              <div style={{ textAlign: 'center', color: '#888', padding: '10px', fontSize: '13px' }}>
                分析中...
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div style={{ padding: '12px 16px', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && sendQuery()}
                placeholder="输入您的问题..."
                style={{
                  flex: 1, padding: '10px 14px', borderRadius: '24px',
                  border: '1px solid rgba(255,255,255,0.15)',
                  background: 'rgba(255,255,255,0.05)', color: 'white',
                  fontSize: '13px', outline: 'none'
                }}
              />
              <button
                onClick={sendQuery}
                disabled={loading || !input.trim()}
                style={{
                  width: '40px', height: '40px', borderRadius: '50%',
                  border: 'none', background: '#667eea', color: 'white',
                  cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.5 : 1,
                  fontSize: '18px', display: 'flex', alignItems: 'center', justifyContent: 'center'
                }}
              >
                ➤
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export default AIChatPanel
