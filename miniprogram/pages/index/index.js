const api = require('../../utils/api')
const fmt = require('../../utils/format')

Page({
  data: {
    loading: true,
    packs: [],
    wave: null,
    student: null,
    missing: [],
    missingText: '',
  },

  onShow() {
    this.load()
  },

  onPullDownRefresh() {
    this.load()
    wx.stopPullDownRefresh()
  },

  load() {
    const that = this
    this.setData({ loading: true })
    Promise.all([api.listPacks(), api.getStudent()])
      .then(function (res) {
        const p = res[0]
        const s = res[1]
        const packs = (p.packs || []).map(function (x) {
          const floors = x.orders.map(function (o) { return o.floor })
          const min = Math.min.apply(null, floors)
          const max = Math.max.apply(null, floors)
          const stalls = []
          x.orders.forEach(function (o) {
            if (stalls.indexOf(o.stall) < 0) stalls.push(o.stall)
          })
          return Object.assign({}, x, {
            incomeText: '¥' + fmt.money(x.income.total),
            floorText: min === max ? max + ' 层' : min + '-' + max + ' 层',
            stallText: stalls.join(' / '),
          })
        })
        that.setData({
          loading: false,
          packs: packs,
          wave: p.wave,
          student: s.student,
          missing: s.missing || [],
          missingText: (s.missing || []).join('、'),
        })
      })
      .catch(function (e) {
        that.setData({ loading: false })
        wx.showToast({ title: e.message || '加载失败', icon: 'none' })
      })
  },

  openPack(e) {
    wx.navigateTo({ url: '/pages/pack/pack?id=' + e.currentTarget.dataset.id })
  },

  goRegister() {
    wx.navigateTo({ url: '/pages/register/register' })
  },
})
