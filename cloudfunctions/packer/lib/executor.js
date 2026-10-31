/**
 * 兜底执行器 —— PRD 5.3 的后半段
 *
 * 分工：
 *   patrol.js   判断"该做什么"（纯判定，可单测）
 *   executor.js 真正去做（改状态、扣信用分、冻结、发告警）
 *
 * 设计成"纯状态变换"：输入一个 state 对象，原地修改，返回执行报告。
 *   - 本地后台：state 就是 data.json，改完存盘
 *   - 云函数：state 由若干文档拼出来，改完只回写报告里列出的那几条
 * 这样同一份业务逻辑只有一处实现，且能在 Node 里跑断言。
 *
 * 幂等保证：每个动作都先校验包的当前状态，状态不符就跳过。
 * 于是"连点两次执行"或"两个调度员同时点"都不会重复扣分、重复回落。
 */

const RULES = {
  // 接了单却 12 分钟没到店：扣 5 分
  creditRecycle: -5,
  // 当日累计 3 次回收 → 冻结接单
  freezeThreshold: 3,
  freezeHours: 24,
  // 无人接回落不扣学生分——没人接不是哪个学生的错
}

function sameDay(a, b) {
  const x = new Date(a)
  const y = new Date(b)
  return x.getFullYear() === y.getFullYear() &&
    x.getMonth() === y.getMonth() &&
    x.getDate() === y.getDate()
}

function findPack(state, id) {
  return (state.packs || []).filter(function (p) {
    return p.id === id || p._id === id
  })[0] || null
}

function findStudent(state, key) {
  if (!key) return null
  return (state.students || []).filter(function (s) {
    return s.id === key || s.openid === key
  })[0] || null
}

function todayRecycleCount(state, key, now) {
  return (state.creditLogs || []).filter(function (l) {
    return (l.openid === key || l.studentId === key) &&
      l.reason === 'recycle' &&
      sameDay(l.at, now)
  }).length
}

function pushAlert(state, alert) {
  state.alerts = state.alerts || []
  state.alerts.push(Object.assign({
    id: 'AL' + alert.packId + '-' + state.alerts.length,
    at: Date.now(),
    handled: false,
  }, alert))
}

function touch(state, report, pack) {
  if (report.changedPacks.indexOf(pack.id || pack._id) < 0) {
    report.changedPacks.push(pack.id || pack._id)
  }
}

function touchStudent(state, report, stu) {
  const key = stu.id || stu.openid
  if (report.changedStudents.indexOf(key) < 0) report.changedStudents.push(key)
}

/**
 * @param {Object} state   { packs, students, creditLogs, alerts }
 * @param {Array}  actions patrol() 的输出
 * @param {Object} options { now, rules }
 * @returns {{report, changedPacks, changedStudents}}
 */
function execute(state, actions, options) {
  const cfg = Object.assign({}, RULES, (options && options.rules) || {})
  const now = (options && options.now) || Date.now()

  state.creditLogs = state.creditLogs || []
  state.alerts = state.alerts || []

  const report = {
    applied: [],
    skipped: [],
    changedPacks: [],
    changedStudents: [],
  }

  ;(actions || []).forEach(function (action) {
    const pack = findPack(state, action.packId)

    if (!pack) {
      report.skipped.push({ packId: action.packId, action: action.action, why: 'pack_not_found' })
      return
    }

    // ---------- 无人接：回落自有运力 ----------
    if (action.action === 'fallback_to_fleet') {
      if (pack.status !== 'available') {
        report.skipped.push({ packId: pack.id, action: action.action, why: 'status_changed:' + pack.status })
        return
      }
      if (pack.fallbackAt) {
        report.skipped.push({ packId: pack.id, action: action.action, why: 'already_fallback' })
        return
      }

      pack.status = 'fallback'
      pack.fallbackAt = now
      pack.fallbackReason = 'no_accept'
      pack.updatedAt = now

      touch(state, report, pack)
      pushAlert(state, {
        type: 'fallback',
        packId: pack.id,
        severity: 'high',
        message: (pack.buildingName || pack.buildingId) + ' 的包 ' + pack.id +
          ' 推出 ' + action.ageMin + ' 分钟无人接，已回落自有运力',
      })
      report.applied.push({ packId: pack.id, action: 'fallback_to_fleet' })
      return
    }

    // ---------- 接了不动：回收 + 扣分 ----------
    if (action.action === 'recycle') {
      if (pack.status !== 'accepted') {
        report.skipped.push({ packId: pack.id, action: action.action, why: 'status_changed:' + pack.status })
        return
      }

      const prev = pack.acceptedBy
      pack.previousAcceptedBy = prev
      pack.acceptedBy = null
      pack.status = 'fallback'
      pack.fallbackAt = now
      pack.fallbackReason = 'not_arrived'
      pack.updatedAt = now

      touch(state, report, pack)

      const stu = findStudent(state, prev)
      if (stu) {
        stu.credit = (stu.credit == null ? 100 : stu.credit) + cfg.creditRecycle
        state.creditLogs.push({
          openid: stu.openid || stu.id,
          studentId: stu.id,
          delta: cfg.creditRecycle,
          reason: 'recycle',
          packId: pack.id,
          at: now,
        })

        // 当日累计 3 次 → 冻结（只在"刚跨过阈值"时告警，避免每次回收都刷一条）
        const count = todayRecycleCount(state, stu.openid || stu.id, now)
        const alreadyFrozen = stu.frozenUntil && stu.frozenUntil > now
        if (count >= cfg.freezeThreshold && !alreadyFrozen) {
          stu.frozenUntil = now + cfg.freezeHours * 3600 * 1000
          pushAlert(state, {
            type: 'freeze',
            packId: pack.id,
            severity: 'medium',
            message: (stu.name || stu.id) + ' 今日已累计 ' + count + ' 次回收，冻结接单 ' + cfg.freezeHours + ' 小时',
          })
        }
        touchStudent(state, report, stu)
      }

      pushAlert(state, {
        type: 'recycle',
        packId: pack.id,
        severity: 'high',
        message: '包 ' + pack.id + ' 接单 ' + action.ageMin + ' 分钟未到店，已回收并回落',
      })
      report.applied.push({ packId: pack.id, action: 'recycle', creditDelta: cfg.creditRecycle })
      return
    }

    // ---------- 送达超时：只告警，不动状态 ----------
    if (action.action === 'warn_deliver') {
      if (pack.status !== 'picked') {
        report.skipped.push({ packId: pack.id, action: action.action, why: 'status_changed:' + pack.status })
        return
      }
      const exists = state.alerts.some(function (a) {
        return a.type === 'deliver_timeout' && a.packId === pack.id
      })
      if (exists) {
        report.skipped.push({ packId: pack.id, action: action.action, why: 'alert_exists' })
        return
      }
      pushAlert(state, {
        type: 'deliver_timeout',
        packId: pack.id,
        severity: 'medium',
        message: '包 ' + pack.id + ' 取餐后 ' + action.ageMin + ' 分钟仍未送达，餐可能要凉',
      })
      report.applied.push({ packId: pack.id, action: 'warn_deliver' })
    }
  })

  return report
}

/**
 * 重派：把回落出去的包放回池子，重新推给学生。
 * 这是"回收"之后唯一的人工挽救手段——调度看没人接，可以加价或指定人重推。
 */
function republish(state, packId, options) {
  const now = (options && options.now) || Date.now()
  const pack = findPack(state, packId)
  if (!pack) return { ok: false, why: 'pack_not_found' }
  if (pack.status !== 'fallback') return { ok: false, why: 'status_changed:' + pack.status }

  pack.status = 'available'
  pack.offeredAt = now
  pack.fallbackAt = null
  pack.fallbackReason = null
  pack.republishedAt = now
  pack.republishCount = (pack.republishCount || 0) + 1
  pack.updatedAt = now

  // 相关告警标记为已处理，避免调度台一直挂着红色
  ;(state.alerts || []).forEach(function (a) {
    if (a.packId === pack.id) a.handled = true
  })

  return { ok: true, pack: pack }
}

module.exports = {
  RULES: RULES,
  execute: execute,
  republish: republish,
  todayRecycleCount: todayRecycleCount,
}
