const adminApi = require('../../../utils/adminApi')

Page({
  data: {
    loading: true,
    error: '',
    batches: [],
    summary: null,
    busy: false,
  },

  onShow() {
    if (!adminApi.getToken()) {
      wx.redirectTo({ url: '/pages/admin/login/login' })
      return
    }
    this.load()
  },

  onPullDownRefresh() {
    this.load()
    wx.stopPullDownRefresh()
  },

  load() {
    const that = this
    this.setData({ loading: true, error: '' })
    adminApi
      .pendingBatches()
      .then(function (d) {
        that.setData({
          loading: false,
          summary: d.summary,
          batches: (d.batches || []).map(function (b) {
            return Object.assign({}, b, {
              buildingText: (b.buildingIds || []).join(' + '),
              priceInput: String(b.suggestedPrice),
              costText: '¥' + b.cost,
            })
          }),
        })
      })
      .catch(function (e) {
        if (e.code === 401) {
          wx.redirectTo({ url: '/pages/admin/login/login' })
          return
        }
        that.setData({ loading: false, error: e.message || '加载失败' })
      })
  },

  onPriceInput(e) {
    const idx = e.currentTarget.dataset.index
    const key = 'batches[' + idx + '].priceInput'
    const patch = {}
    patch[key] = e.detail.value
    this.setData(patch)
  },

  publishOne(e) {
    const that = this
    const idx = e.currentTarget.dataset.index
    const b = this.data.batches[idx]
    const price = Number(b.priceInput)

    if (!isFinite(price) || price <= 0) {
      return wx.showToast({ title: '价格不对', icon: 'none' })
    }

    this.setData({ busy: true })
    adminApi
      .publishBatch(b.id, price)
      .then(function () {
        that.setData({ busy: false })
        wx.showToast({ title: '已发单', icon: 'success' })
        that.load()
      })
      .catch(function (err) {
        that.setData({ busy: false })
        wx.showToast({ title: err.message || '发单失败', icon: 'none' })
      })
  },

  publishAll() {
    const that = this
    if (!this.data.batches.length) return wx.showToast({ title: '没有待发单批次', icon: 'none' })

    wx.showModal({
      title: '全部按建议价发单',
      content: '共 ' + this.data.summary.count + ' 批 · ' + this.data.summary.totalOrders +
        ' 单 · 合计 ¥' + this.data.summary.totalCost,
      confirmText: '发布',
      success: function (res) {
        if (!res.confirm) return
        that.setData({ busy: true })
        adminApi
          .publishAll()
          .then(function (r) {
            that.setData({ busy: false })
            wx.showToast({ title: '已发 ' + r.published + ' 批', icon: 'success' })
            that.load()
          })
          .catch(function (err) {
            that.setData({ busy: false })
            wx.showToast({ title: err.message || '发单失败', icon: 'none' })
          })
      },
    })
  },
})
