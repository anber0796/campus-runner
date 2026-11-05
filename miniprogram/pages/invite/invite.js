const riderApi = require('../../utils/riderApi')

Page({
  data: {
    loading: true,
    error: '',
    code: '',
    registered: 0,
    firstOrdered: 0,
    amount: 0,
    nextRegisterGap: 10,
    nextOrderGap: 10,
    inputCode: '',
    binding: false,
  },

  onShow() {
    this.load()
  },

  load() {
    const that = this
    this.setData({ loading: true, error: '' })
    riderApi
      .invite()
      .then(function (d) {
        that.setData({
          loading: false,
          code: d.code,
          registered: d.registered,
          firstOrdered: d.firstOrdered,
          amount: d.amount,
          nextRegisterGap: d.nextRegisterGap,
          nextOrderGap: d.nextOrderGap,
        })
      })
      .catch(function (e) {
        that.setData({ loading: false, error: e.message || '加载失败' })
      })
  },

  copyCode() {
    wx.setClipboardData({ data: this.data.code })
  },

  onInput(e) {
    this.setData({ inputCode: e.detail.value })
  },

  bind() {
    const that = this
    const code = this.data.inputCode.trim()
    if (!code) return wx.showToast({ title: '请输入邀请码', icon: 'none' })
    if (this.data.binding) return

    this.setData({ binding: true })
    riderApi
      .bindInvite(code)
      .then(function (d) {
        that.setData({ binding: false, inputCode: '' })
        wx.showToast({ title: '已绑定', icon: 'success' })
      })
      .catch(function (e) {
        that.setData({ binding: false })
        wx.showToast({ title: e.message || '绑定失败', icon: 'none' })
      })
  },
})
