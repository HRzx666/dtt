const mongoose = require('mongoose');

const commentLikeSchema = new mongoose.Schema({
  // 评论ID
  commentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Comments',
    required: true
  },
  // 用户ID（用户名）
  username: {
    type: String,
    required: true
  },
  // 点赞时间
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// 唯一索引：防止重复点赞
commentLikeSchema.index({ commentId: 1, username: 1 }, { unique: true });

module.exports = mongoose.model('CommentLike', commentLikeSchema);
