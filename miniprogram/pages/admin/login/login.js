const adminApi = require('../../utils/adminApi')

Page({
  data: {
    username: '',
    password: '',
    submitting: false,
    mode: 'login', // login | bootstrap
    error: '',
  },

  onLoad() {
    if (adminApi.getToken()) {
      wx.redirectTo({ url: '/pages/admin/dashboard/dashboard' })
      return
    }
    // 已登录过的账号回填，省得每次重输
    const last = wx.getStorageSync('admin_last_user')
    if (last) this.setData({ username: last })
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field
    this.setData({ [field]: e.detail.value, error: '' })
  },

  toggleMode() {
    this.setData({
      mode: this.data.mode === 'login' ? 'bootstrap' : 'login',
      error: '',
    })
  },

  submit() {
    if (this.data.submitting) return
    const username = this.data.username.trim()
    const password = this.data.password

    if (!username || !password) {
      this.setData({ error: '请输入账号和密码' })
      return
    }

    const that = this
    this.setData({ submitting: true, error: '' })

    const task = this.data.mode === 'bootstrap'
      ? adminApi.bootstrap(username, password)
      : adminApi.login(username, password)

    task
      .then(function () {
        wx.setStorageSync('admin_last_user', username)
        wx.redirectTo({ url: '/pages/admin/dashboard/dashboard' })
      })
      .catch(function (e) {
        that.setData({ submitting: false, error: e.message || '登录失败' })
      })
  },
})
