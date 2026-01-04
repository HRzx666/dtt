const mongoose = require('mongoose');

// 用户Schema设计（用户名唯一，存储密码）
// 注意：生产环境建议对密码加密（如bcrypt），此处先做基础实现
const userSchema = new mongoose.Schema({
  username: { 
    type: String, 
    unique: true,  // 用户名唯一
    required: true,
    minlength: 3   // 用户名至少3位
  },
  password: { 
    type: String, 
    required: true,
    minlength: 6   // 密码至少6位
  },
  createdAt: { type: Date, default: Date.now } // 创建时间
});

// 导出用户模型
module.exports = mongoose.model('User', userSchema);