/**
 * 指派引擎 —— L2 形态（有派单权，但执行仍在平台后台）
 *
 * 与 claim.js（抢单）的区别：
 *   抢单：学生自己点，先到先得，我们只判定资格
 *   指派：运营选人，我们把清单生成出来，驻点照着在平台后台点
 *
 * 所以这个模块干三件事：
 *   1. 这个人能不能被指派（复用抢单的准入规则，避免两套标准）
 *   2. 一批单该派给谁（同楼优先 → 今日少优先 → 信用高优先）
 *   3. 把结果排成一张能照着点的清单
 *
 * 第 3 件是 L2 的核心交付物：驻点一屏一包、尾号大字、骑手手机号可复制，
 * 目标是每次操作 ≤5 秒（PRD 8.6 的测算依据）。
 */
const claim = require('./claim')

const RULES = {
  // 单日最多指派几批（防疲劳，也防事实劳动关系）
  maxAssignPerDay: 6,
  // 同楼的优先权重
  sameBuildingScore: 30,
  // 今日每少做一批加多少分
  eachFewerClaimScore: 10,
  // 信用分权重
  creditWeight: 0.5,
}

/** 能不能把这一批指派给他 */
function canAssign(student, batch, now, rules) {
  if (!batch) return { ok: false, reason: 'no_batch' }
  if (batch.status !== 'POOLED' && batch.status !== 'ASSIGNED') {
    return { ok: false, reason: 'bad_status:' + batch.status }
  }
  // 复用抢单准入门槛：认证、信用、惩罚期、日上限、楼栋覆盖、有定价
  const shim = Object.assign({}, batch, {
    status: 'POOLED',
    price: batch.price || 1,
  })
  return claim.canClaim(student, shim, now, rules)
}

/**
 * 给候选人打分：分越高越该派给他
 * 同楼 +30，今日每少一批 +10，信用分 ×0.5
 */
function score(student, batch, rules) {
  const cfg = Object.assign({}, RULES, rules || {})
  const need = batch.buildingIds || [batch.buildingId]
  const same = student.buildingId && need.indexOf(student.buildingId) >= 0
  const few = (cfg.maxAssignPerDay - (student.claimsToday || 0)) * cfg.eachFewerClaimScore
  const credit = (student.credit || 0) * cfg.creditWeight
  return Math.round((same ? cfg.sameBuildingScore : 0) + few + credit)
}

/**
 * 从候选人里挑一个最合适的
 * @returns {{student:Object|null, reason?:string, ranked:Array}}
 */
function pickBest(students, batch, now, rules) {
  const cfg = Object.assign({}, RULES, rules || {})
  const eligible = []

  ;(students || []).forEach(function (s) {
    if (!canAssign(s, batch, now, cfg).ok) return
    eligible.push({ student: s, score: score(s, batch, cfg) })
  })

  eligible.sort(function (a, b) {
    if (b.score !== a.score) return b.score - a.score
    return String(a.student.id).localeCompare(String(b.student.id))
  })

  if (!eligible.length) {
    return { student: null, reason: 'no_candidate', ranked: [] }
  }
  return { student: eligible[0].student, reason: 'ok', ranked: eligible }
}

/**
 * 生成给驻点的清单文本 —— 微信里直接能发，打印出来也能用
 * @param {Array} items [{ batchId, buildingText, floorRange, orderCount, price, tails, assignee, phone }]
 * @param {Object} meta { date, wave, tenantName }
 */
function buildChecklist(items, meta) {
  const m = meta || {}
  const list = items || []
  const totalOrders = list.reduce(function (s, x) { return s + (x.orderCount || 0) }, 0)
  const totalCost = Math.round(
    list.reduce(function (s, x) { return s + (x.cost || 0) }, 0) * 100
  ) / 100

  const lines = []
  lines.push('【顺路 · 指派清单】' + (m.date || '') + (m.wave ? ' ' + m.wave : ''))
  lines.push('共 ' + list.length + ' 包 / ' + totalOrders + ' 单 / 成本 ¥' + totalCost)
  lines.push('')

  list.forEach(function (x, i) {
    lines.push((i + 1) + '. ' + x.batchId + '  ' + (x.buildingText || '') + ' ' + (x.floorRange || ''))
    lines.push('   骑手 ' + (x.assignee || '待定') + '  ' + (x.phone || ''))
    lines.push('   尾号 ' + (x.tails || []).join(' / '))
    lines.push('   □ 已指派')
    lines.push('')
  })

  lines.push('操作：平台后台 → 按订单尾号搜索 → 指派给上面的骑手 → 打勾')
  return lines.join('\n')
}

module.exports = {
  RULES: RULES,
  canAssign: canAssign,
  score: score,
  pickBest: pickBest,
  buildChecklist: buildChecklist,
}
