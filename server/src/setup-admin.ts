/**
 * setup-admin.ts - 交互式设置/重置管理员密码
 * 用法: node server/dist/setup-admin.js [用户名] [新密码]
 *   不带参数则交互式输入
 */
import bcrypt from 'bcryptjs'
import fs from 'fs/promises'
import path from 'path'
import readline from 'readline'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const usersFilePath = path.join(process.cwd(), 'data', 'users.json')

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
})

const ask = (q: string) => new Promise<string>((resolve) => rl.question(q, resolve))

async function loadUsers(): Promise<any[]> {
  try {
    const raw = await fs.readFile(usersFilePath, 'utf-8')
    return JSON.parse(raw)
  } catch {
    return []
  }
}

async function saveUsers(users: any[]): Promise<void> {
  await fs.mkdir(path.dirname(usersFilePath), { recursive: true })
  await fs.writeFile(usersFilePath, JSON.stringify(users, null, 2), 'utf-8')
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  let username = args[0] || 'admin'
  let newPassword = args[1]

  if (!newPassword) {
    console.log('=== GSM3 管理员密码设置 ===')
    username = ((await ask(`用户名 [${username}]: `)).trim()) || username
    while (true) {
      newPassword = await ask('新密码（至少6位）: ')
      if (newPassword.length < 6) {
        console.log('密码太短，至少 6 位')
        continue
      }
      const confirm = await ask('再次输入确认: ')
      if (confirm !== newPassword) {
        console.log('两次输入不一致，请重试')
        continue
      }
      break
    }
  }

  const users = await loadUsers()
  let target = users.find((u: any) => u.username === username)
  const hashed = await bcrypt.hash(newPassword, 12)

  if (target) {
    target.password = hashed
    target.updatedAt = new Date().toISOString()
    console.log(`已重置用户 ${username} 的密码`)
  } else {
    users.push({
      id: username,
      username,
      password: hashed,
      role: 'admin',
      createdAt: new Date().toISOString(),
      loginAttempts: 0
    })
    console.log(`已创建管理员用户 ${username}`)
  }

  await saveUsers(users)
  console.log('密码设置成功！请使用新密码登录。')
  rl.close()
}

main().catch(err => {
  console.error('设置失败:', err.message)
  process.exit(1)
})
