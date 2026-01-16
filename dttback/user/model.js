const mongoose = require('mongoose');

// 用户Schema设计（移除nickname所有验证规则）
const userSchema = new mongoose.Schema({
  username: { 
    type: String, 
    unique: true,  
    required: true,
    minlength: 3   
  },
  password: { 
    type: String, 
    required: true,
    minlength: 6   
  },
  // 昵称字段：仅保留基础定义，无任何验证规则
  nickname: {
    type: String,
    required: false, // 非必填
    default: ''      // 默认空字符串
  },
  // 新增：用户头像（存储Base64字符串，可选）
  avatar: {
    type: String,
    default: '' // 默认无头像
  },
  createdAt: { type: Date, default: Date.now }
});

// 导出用户模型
module.exports = mongoose.model('User', userSchema);