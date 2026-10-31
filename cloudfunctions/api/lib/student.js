const COLL = 'students'

function blank(openid) {
  return {
    openid: openid,
    name: '',
    studentNo: '',
    phone: '',
    buildingId: '',
    buildingName: '',
    room: '',
    canteenIds: [],
    canteenNames: [],
    waveIds: [],
    platformRiderId: '',
    credit: 100,
    status: 'none',
    healthExpire: '',
    createdAt: Date.now(),
  }
}

async function getStudent(db, openid) {
  const res = await db.collection(COLL).where({ openid: openid }).limit(1).get()
  return res.data && res.data[0] ? res.data[0] : null
}

/** 认证是否完整，决定能不能接单 */
function isCertified(s) {
  return !!(s && s.status === 'active' && s.buildingId && s.healthExpire)
}

module.exports = { COLL: COLL, blank: blank, getStudent: getStudent, isCertified: isCertified }
