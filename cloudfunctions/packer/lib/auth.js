/**
 * 运营后台鉴权 —— 云函数版
 *
 * 设计取舍：
 *   1. 密码用 PBKDF2-SHA256 加盐存储，不存明文，也不存可逆哈希
 *   2. 登录后签发随机 token，存 admin_sessions，带过期时间（12 小时）
 *   3. 校验用 timingSafeEqual，防时序侧信道
 *   4. token 只存在客户端 storage + 服务端会话表，不放进 JWT 里自己校验
 *      —— JWT 的密钥一旦泄露等于全网可伪造，会话表可以随时吊销
 *
 * 纯函数部分（hash/verify/过期判断）单独导出，便于在 Node 里跑断言。
 */
const crypto = require('crypto')

const TOKEN_TTL_HOURS = 12
const PBKDF2_ITERATIONS = 100000
const KEY_LEN = 32

function hashPassword(password, salt) {
  const s = salt || crypto.randomBytes(16).toString('hex')
  const hash = crypto
    .pbkdf2Sync(String(password), s, PBKDF2_ITERATIONS, KEY_LEN, 'sha256')
    .toString('hex')
  return { salt: s, hash: hash }
}

function verifyPassword(password, salt, expectedHash) {
  if (!salt || !expectedHash) return false
  const actual = crypto
    .pbkdf2Sync(String(password), salt, PBKDF2_ITERATIONS, KEY_LEN, 'sha256')
    .toString('hex')

  const a = Buffer.from(actual, 'hex')
  const b = Buffer.from(expectedHash, 'hex')
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

function issueToken() {
  return crypto.randomBytes(24).toString('hex')
}

function expiresAt(now) {
  return (now || Date.now()) + TOKEN_TTL_HOURS * 3600 * 1000
}

function isExpired(session, now) {
  if (!session) return true
  if (!session.expiresAt) return true
  return session.expiresAt < (now || Date.now())
}

module.exports = {
  TOKEN_TTL_HOURS: TOKEN_TTL_HOURS,
  hashPassword: hashPassword,
  verifyPassword: verifyPassword,
  issueToken: issueToken,
  expiresAt: expiresAt,
  isExpired: isExpired,
}
