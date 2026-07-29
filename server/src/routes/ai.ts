import { Router, Request, Response } from 'express'
import { AIAssistant, AIQueryRequest } from '../modules/ai/AIAssistant.js'
import { authenticateToken } from '../middleware/auth.js'
import logger from '../utils/logger.js'

const router = Router()

let aiAssistant: AIAssistant

export function setAIAssistant(assistant: AIAssistant) {
  aiAssistant = assistant
}

// All AI routes require authentication
router.use(authenticateToken)

// AI query endpoint
router.post('/query', async (req: Request, res: Response) => {
  try {
    if (!aiAssistant) {
      return res.status(500).json({ success: false, error: 'AI 助手未初始化' })
    }
    const { prompt, context, terminalOutput } = req.body as AIQueryRequest
    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
      return res.status(400).json({ success: false, error: '请提供查询内容' })
    }
    const result = await aiAssistant.query({ prompt: prompt.trim(), context, terminalOutput })
    res.json(result)
  } catch (error: any) {
    logger.error('AI 查询失败:', error)
    res.status(500).json({ success: false, answer: 'AI 查询失败', error: error.message })
  }
})

// Analyze terminal output
router.post('/analyze-terminal', async (req: Request, res: Response) => {
  try {
    if (!aiAssistant) {
      return res.status(500).json({ success: false, error: 'AI 助手未初始化' })
    }
    const { output, prompt } = req.body
    if (!output || typeof output !== 'string') {
      return res.status(400).json({ success: false, error: '请提供终端输出内容' })
    }
    const result = await aiAssistant.query({
      prompt: prompt || '分析以下终端输出中的错误和警告',
      terminalOutput: output.substring(0, 5000)
    })
    res.json(result)
  } catch (error: any) {
    logger.error('终端分析失败:', error)
    res.status(500).json({ success: false, answer: '终端分析失败', error: error.message })
  }
})

export default router
