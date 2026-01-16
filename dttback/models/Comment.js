const mongoose = require('mongoose');

const commentSchema = new mongoose.Schema({
  // 资源类型：song/album/single（区分单曲/专辑/单曲）
  resourceType: {
    type: String,
    required: true,
    enum: ['song', 'album', 'single'], // 扩展支持单曲
    default: 'song'
  },
  // 资源ID（单曲ID/专辑ID/单曲ID）
  resourceId: {
    type: String,
    required: true
  },
  // 用户相关字段
  username: { type: String, required: true }, // 用户名（兜底）
  nick_name: { type: String, required: true }, // 用户昵称（前端显示用）
  avatar: { type: String, default: '' }, // 用户头像（base64/URL）
  // 评论内容
  content: { type: String, required: true, maxlength: 500 },
  // 点赞数
  likeCount: { type: Number, default: 0 },
  // 回复相关字段（按照文档要求重构）
  parent_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Comment',
    default: null
  },
  // 回复目标评论ID（reply_to_comment）
  reply_to_comment: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Comment',
    default: null
  },
  // 回复目标用户ID（reply_to_user）
  reply_to_user: {
    type: String,
    default: ''
  },
  // 回复目标用户名（用于显示）
  reply_to_name: {
    type: String,
    default: ''
  },
  createdAt: { type: Date, default: Date.now }
}, { timestamps: true });

// 索引优化
commentSchema.index({ resourceType: 1, resourceId: 1, createdAt: -1 });
commentSchema.index({ parent_id: 1, createdAt: -1 });
commentSchema.index({ reply_to_comment: 1 });

module.exports = mongoose.model('Comment', commentSchema);