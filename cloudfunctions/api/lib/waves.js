/** 与小程序端 utils/waves.js 保持一致的波次表（管理端可配置，这里读配置表） */
const WAVES = [
  { id: 'W1', time: '11:35', label: '11:35 波次' },
  { id: 'W2', time: '11:50', label: '11:50 波次', main: true },
  { id: 'W3', time: '12:05', label: '12:05 波次' },
  { id: 'W4', time: '12:20', label: '12:20 波次' },
  { id: 'W5', time: '17:20', label: '17:20 波次' },
  { id: 'W6', time: '17:35', label: '17:35 波次', main: true },
  { id: 'W7', time: '17:50', label: '17:50 波次' },
]

function minutesUntil(hhmm, base) {
  const parts = hhmm.split(':')
  const target = new Date(base.getTime())
  target.setHours(Number(parts[0]), Number(parts[1]), 0, 0)
  return Math.round((target.getTime() - base.getTime()) / 60000)
}

function nextWave(base) {
  const now = base || new Date()
  for (let i = 0; i < WAVES.length; i++) {
    const m = minutesUntil(WAVES[i].time, now)
    if (m >= 0) return Object.assign({}, WAVES[i], { minutes: m, tomorrow: false })
  }
  const first = WAVES[0]
  const tomorrow = new Date(now.getTime() + 24 * 3600 * 1000)
  return Object.assign({}, first, {
    minutes: minutesUntil(first.time, tomorrow),
    tomorrow: true,
  })
}

function byId(id) {
  return WAVES.filter(function (w) { return w.id === id })[0] || null
}

module.exports = { WAVES: WAVES, nextWave: nextWave, byId: byId }
