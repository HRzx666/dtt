const mongoose = require('mongoose');

const ratingSchema = new mongoose.Schema({
  song_id: { type: String, required: true },
  username: { type: String, required: true }, // 新增：关联评分用户
  score: { 
    type: Number, 
    required: true, 
    min: 0.5,
    max: 5,
    enum: [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5]
  },
  createdAt: { type: Date, default: Date.now }
});

// 新增唯一索引：限制同一个用户对同一首歌只能评一次分
ratingSchema.index({ song_id: 1, username: 1 }, { unique: true });

module.exports = mongoose.model('Rating', ratingSchema);