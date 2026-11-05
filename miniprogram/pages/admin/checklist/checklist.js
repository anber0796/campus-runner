const adminApi = require('../../../utils/adminApi')

Page({
  data: {
    loading: true,
    error: '',
    items: [],
    summary: null,
    text: '',
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
      .checklist()
      .then(function (d) {
        that.setData({
          loading: false,
          items: d.items || [],
          summary: d.summary,
          text: d.text || '',
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

  // 整份清单复制到微信，发给驻点
  copyAll() {
    if (!this.data.text) return wx.showToast({ title: '还没有清单', icon: 'none' })
    wx.setClipboardData({
      data: this.data.text,
      success: function () { wx.showToast({ title: '已复制，可发微信', icon: 'success' }) },
    })
  },

  copyPhone(e) {
    const phone = e.currentTarget.dataset.phone
    if (!phone) return
    wx.setClipboardData({ data: phone })
  },

  markOne(e) {
    const that = this
    const item = this.data.items[e.currentTarget.dataset.index]
    if (!item) return

    if (!item.studentId) {
      return wx.showToast({ title: '没有可用骑手', icon: 'none' })
    }

    this.setData({ busy: true })
    adminApi
      .assignBatch(item.batchId, item.studentId)
      .then(function () {
        that.setData({ busy: false })
        wx.showToast({ title: '已标记指派', icon: 'success' })
        that.load()
      })
      .catch(function (err) {
        that.setData({ busy: false })
        wx.showToast({ title: err.message || '指派失败', icon: 'none' })
      })
  },

  assignAll() {
    const that = this
    if (!this.data.items.length) return wx.showToast({ title: '没有待指派的批次', icon: 'none' })

    wx.showModal({
      title: '一键指派',
      content: '按推荐骑手把 ' + this.data.summary.count + ' 个批次全部指派？',
      confirmText: '指派',
      success: function (res) {
        if (!res.confirm) return
        that.setData({ busy: true })
        adminApi
          .assignAll()
          .then(function (r) {
            that.setData({ busy: false })
            wx.showToast({ title: '已指派 ' + r.assigned + ' 批', icon: 'success' })
            that.load()
          })
          .catch(function (err) {
            that.setData({ busy: false })
            wx.showToast({ title: err.message || '指派失败', icon: 'none' })
          })
      },
    })
  },
})
