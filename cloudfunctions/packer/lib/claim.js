/**
 * 抢单引擎 —— 学生侧
 *
 * 学生不投标、不还价。看到代理商定的价格，决定抢不抢，先到先得。
 *
 * 这个引擎负责三件事：
 *   1. 准入：谁有资格抢（认证、信用、单日上限、惩罚期、楼栋覆盖）
 *   2. 抢单结果判定：抢到 / 手慢了 / 不合规
 *   3. 确认窗口：抢到后多久不动作要作废
 *
 * 真正的"先到先得"靠数据库的条件更新实现，不靠这个模块——
 * 这里只判定"能不能抢"和"结果怎么算"，保持纯函数可测。
 */

const RULES = {
  // 单日最多抢几批，防疲劳，也防形成事实劳动关系
  maxClaimsPerDay: 6,
  // 低于这个信用分只能被指派，不能抢单
  minCredit: 80,
  // 抢到后多少分钟内必须开始取餐，超时释放
  confirmWindowMin: 10,
  // 同一学生同时最多持有几个未完成的批次
  maxActiveClaims: 2,
}

/**
 * 他能不能抢这一批
 * @returns {{ok:boolean, reason?:string}}
 */
function canClaim(student, batch, now, rules) {
  const cfg = Object.assign({}, RULES, rules || {})
  const ts = now || Date.now()

  if (!student) return { ok: false, reason: 'no_student' }
  if (student.status !== 'active') return { ok: false, reason: 'not_certified' }

  if (student.punishUntil && student.punishUntil > ts) {
    return { ok: false, reason: 'punished' }
  }
  if ((student.credit || 0) < cfg.minCredit) {
    return { ok: false, reason: 'credit_too_low' }
  }
  if ((student.claimsToday || 0) >= cfg.maxClaimsPerDay) {
    return { ok: false, reason: 'daily_limit' }
  }
  if ((student.activeClaims || 0) >= cfg.maxActiveClaims) {
    return { ok: false, reason: 'active_limit' }
  }

  if (!batch) return { ok: false, reason: 'no_batch' }
  if (batch.status !== 'POOLED') return { ok: false, reason: 'already_taken' }
  if (batch.claimDeadline && ts > batch.claimDeadline) {
    return { ok: false, reason: 'expired' }
  }

  // 楼栋必须在他注册时选定的覆盖范围内
  const need = batch.buildingIds || (batch.buildingId ? [batch.buildingId] : [])
  const cover = student.coverageBuildings ||
    (student.buildingId ? [student.buildingId] : [])
  if (!cover.length) return { ok: false, reason: 'no_building' }
  for (let i = 0; i < need.length; i++) {
    if (cover.indexOf(need[i]) < 0) return { ok: false, reason: 'building_not_covered' }
  }

  // 价格必须是代理商发布时定好的，学生不能改
  if (!(batch.price > 0)) return { ok: false, reason: 'no_price' }

  return { ok: true }
}

/**
 * 原子抢单的结果判定。
 * 调用方按 where({_id, status:'POOLED'}) 更新，updated===1 才算抢到。
 * @param {Number} updated 条件更新影响的行数
 */
function judgeClaim(updated) {
  if (updated === 1) return { ok: true, reason: 'claimed' }
  return { ok: false, reason: 'already_taken' }
}

/** 这一批结算给学生多少钱 */
function settle(batch) {
  const count = batch.orderCount || (batch.orders || []).length
  const price = Number(batch.price) || 0
  return Math.round(price * count * 100) / 100
}

/** 抢到后超过确认窗口没动作 → 释放回池子 */
function isClaimExpired(batch, now, rules) {
  const cfg = Object.assign({}, RULES, rules || {})
  if (!batch || !batch.claimedAt) return false
  return ((now || Date.now()) - batch.claimedAt) > cfg.confirmWindowMin * 60000
}

module.exports = {
  RULES: RULES,
  canClaim: canClaim,
  judgeClaim: judgeClaim,
  settle: settle,
  isClaimExpired: isClaimExpired,
}
