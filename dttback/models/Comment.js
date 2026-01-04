// models/Comment.js
const mongoose = require('mongoose');

// 评论数据模型
const commentSchema = new mongoose.Schema({
  song_id: { 
    type: String, 
    required: true, 
    index: true // 索引优化：加快按歌曲ID查询评论
  },
  resource_type: { type: String, default: 'song' }, // 区分资源类型（歌曲/专辑）
  username: { type: String, required: true }, // 评论者用户名
  content: { 
    type: String, 
    required: true, 
    trim: true,
    maxlength: 500 // 限制评论最大长度
  },
  create_time: { type: Date, default: Date.now } // 评论发布时间
}, { timestamps: true });

// 按“歌曲ID+发布时间”排序的索引
commentSchema.index({ song_id: 1, create_time: -1 });

module.exports = mongoose.model('Comment', commentSchema);