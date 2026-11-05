const riderApi = require('../../utils/riderApi')

Page({
  data: {
    loading: true,
    error: '',
    batches: [],
    student: null,
    canClaim: null,
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
    this.setData({ loading: true, error: '' })
    riderApi
      .home()
      .then(function (d) {
        that.setData({
          loading: false,
          student: d.student,
          canClaim: d.canClaim,
          batches: (d.batches || []).map(function (b) {
            return Object.assign({}, b, {
              priceText: '¥' + b.price + '/单',
              earnText: '¥' + b.earn,
              buildingText: (b.buildingIds || []).join(' + '),
              crossText: b.crossBuilding ? '跨楼' : '',
            })
          }),
        })
      })
      .catch(function (e) {
        that.setData({ loading: false, error: e.message || '加载失败' })
      })
  },

  grab(e) {
    const that = this
    const id = e.currentTarget.dataset.id
    const target = this.data.batches.filter(function (b) { return b.id === id })[0]
    if (!target) return

    wx.showModal({
      title: '抢这一批？',
      content: target.buildingText + ' · ' + target.orderCount + ' 单 · 到手 ' + target.earnText,
      confirmText: '抢',
      success: function (res) {
        if (!res.confirm) return
        riderApi
          .grab(id)
          .then(function () {
            wx.showToast({ title: '抢到了', icon: 'success' })
            that.load()
          })
          .catch(function (err) {
            wx.showToast({ title: err.message || '手慢了', icon: 'none' })
            that.load()
          })
      },
    })
  },

  goInvite() {
    wx.navigateTo({ url: '/pages/invite/invite' })
  },
})
