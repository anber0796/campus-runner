/**
 * 下课波次表 —— 按学校作息在管理端配置，这里给的是 PRD 第六章的示例值。
 * 波次是 v3 的核心机制：订单、档口备餐、学生动线对齐同一张时刻表。
 */
const WAVES = [
  { id: 'W1', time: '11:35', label: '11:35 波次' },
  { id: 'W2', time: '11:50', label: '11:50 波次', main: true },
  { id: 'W3', time: '12:05', label: '12:05 波次' },
  { id: 'W4', time: '12:20', label: '12:20 波次' },
  { id: 'W5', time: '17:20', label: '17:20 波次' },
  { id: 'W6', time: '17:35', label: '17:35 波次', main: true },
  { id: 'W7', time: '17:50', label: '17:50 波次' },
]

function minutesUntil(hhmm, now) {
  const base = now || new Date()
  const parts = hhmm.split(':')
  const target = new Date(base.getTime())
  target.setHours(Number(parts[0]), Number(parts[1]), 0, 0)
  return Math.round((target.getTime() - base.getTime()) / 60000)
}

/** 取下一个还没到的波次；今天的都过了就返回明天的第一个 */
function nextWave(now) {
  const base = now || new Date()
  for (let i = 0; i < WAVES.length; i++) {
    const m = minutesUntil(WAVES[i].time, base)
    if (m >= 0) {
      return Object.assign({}, WAVES[i], { minutes: m, tomorrow: false })
    }
  }
  const first = WAVES[0]
  const tomorrow = new Date(base.getTime() + 24 * 3600 * 1000)
  return Object.assign({}, first, {
    minutes: minutesUntil(first.time, tomorrow),
    tomorrow: true,
  })
}

function byId(id) {
  return WAVES.filter(function (w) { return w.id === id })[0] || null
}

module.exports = { WAVES: WAVES, nextWave: nextWave, byId: byId }
