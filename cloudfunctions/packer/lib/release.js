/**
 * 超时释放 —— 抢了不去取，必须能收回来
 *
 * 没有这一步，学生会把自己锁死：手上挂满 2 批（maxActiveClaims），
 * 又不去取，之后永远抢不了新单，只能人工改库。
 *
 * 规则：
 *   抢单后 N 分钟未到店取餐 → 释放回池子 + 扣信用分 + 当日累计
 *   信用分低于阈值的，下一轮只能被指派，不能再抢
 *
 * 纯函数，判定与执行分离，便于单测。
 */
const RULES = {
  // 抢到后多少分钟未取餐视为放弃
  timeoutMin: 15,
  // 释放时扣多少信用分
  creditPenalty: -3,
  // 释放原因写到 batches，便于运营追责与统计
  reason: 'claim_timeout',
}

function minutesSince(ts, now) {
  if (!ts) return Infinity
  return (now - ts) / 60000
}

/**
 * 找出该释放的批次
 * @param {Array} batches
 * @param {Number} now
 * @returns {Array<{batchId, claimedBy, ageMin}>}
 */
function findExpired(batches, now, rules) {
  const cfg = Object.assign({}, RULES, rules || {})
  const ts = now || Date.now()
  const out = []

  ;(batches || []).forEach(function (b) {
    if (!b || b.status !== 'CLAIMED') return
    if (!b.claimedAt) return

    const age = minutesSince(b.claimedAt, ts)
    if (age < cfg.timeoutMin) return

    // 已经取过任何一单的，说明人到了，不释放
    const anyPicked = (b.orders || []).some(function (o) {
      return typeof o === 'object' && o.picked
    })
    if (anyPicked) return

    out.push({
      batchId: b._id || b.id,
      claimedBy: b.claimedBy || '',
      ageMin: Math.round(age),
    })
  })

  return out
}

/** 判定一次条件更新是否真的释放成功（防并发重复扣分） */
function judgeRelease(updated) {
  return updated === 1
}

module.exports = {
  RULES: RULES,
  findExpired: findExpired,
  judgeRelease: judgeRelease,
}
