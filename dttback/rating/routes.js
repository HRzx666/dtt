const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
// 引入所有模型（路径根据你的项目结构调整）
const Rating = mongoose.model('Rating');
const Song = mongoose.model('Song');
const Single = mongoose.model('Single');
const Album = mongoose.model('Album');
// 复用app.js中的错误类和鉴权中间件（需确保全局可访问）
class AppError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
    this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
    Error.captureStackTrace(this, this.constructor);
  }
}
// 鉴权中间件（复用app.js逻辑）
const authMiddleware = (req, res, next) => {
  try {
    const jwt = require('jsonwebtoken');
    const JWT_SECRET = 'tao_zhe_official_2025_secret_key';
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) throw new AppError('未登录', 401);
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = { username: decoded.username };
    next();
  } catch (err) {
    next(err);
  }
};

// ==================== 1. 评分提交接口（兼容歌曲/单曲） ====================
router.post('/api/:type/:id/rating', authMiddleware, async (req, res, next) => {
  try {
    const { type, id } = req.params; // type: song/single, id: 歌曲/单曲ID
    const { score } = req.body;
    const username = req.user.username;

    // 校验类型
    if (!['song', 'single'].includes(type)) throw new AppError('类型只能是song或single', 400);
    // 校验评分值
    if (![0.5,1,1.5,2,2.5,3,3.5,4,4.5,5].includes(Number(score))) {
      throw new AppError('评分必须是0.5-5的半星递增', 400);
    }
    // 校验歌曲/单曲是否存在
    const resourceExist = type === 'song' 
      ? await Song.findOne({ id }) 
      : await Single.findOne({ id });
    if (!resourceExist) throw new AppError(`${type === 'song' ? '歌曲' : '单曲'}不存在`, 404);

    // 保存评分
    const newRating = new Rating({
      resource_type: type,
      resource_id: id,
      username,
      score: Number(score)
    });
    await newRating.save();

    res.json({ code: 200, msg: '评分成功', data: newRating });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ code: 400, msg: '已评过分，不可重复提交', data: null });
    }
    next(err);
  }
});

// ==================== 2. 专辑内歌曲按评分排序 ====================
router.get('/api/albums/:albumId/songs/sort-by-rating', async (req, res, next) => {
  try {
    const { albumId } = req.params;
    const { page = 1, pageSize = 10 } = req.query;
    const skip = (page - 1) * pageSize;

    // 校验专辑存在
    const album = await Album.findOne({ id: albumId });
    if (!album) throw new AppError('专辑不存在', 404);

    // 步骤1：获取该专辑下所有歌曲
    const albumSongs = await Song.find({ album_id: albumId }).select('id name_cn album_id duration');
    const songIds = albumSongs.map(s => s.id);

    // 步骤2：聚合计算该专辑歌曲的评分
    const ratingAgg = await Rating.aggregate([
      { $match: { resource_type: 'song', resource_id: { $in: songIds } } },
      { $group: {
        _id: '$resource_id',
        averageScore: { $avg: '$score' },
        ratingCount: { $sum: 1 }
      }},
      { $sort: { averageScore: -1, ratingCount: -1 } } // 高分在前，同分按评分人数
    ]);

    // 步骤3：合并歌曲信息 + 排序
    const sortedSongs = albumSongs
      .map(song => {
        const rating = ratingAgg.find(r => r._id === song.id);
        return {
          ...song._doc,
          averageScore: rating ? parseFloat(rating.averageScore.toFixed(1)) : 0,
          ratingCount: rating ? rating.ratingCount : 0
        };
      })
      .sort((a, b) => {
        // 先按平均分降序，再按评分人数降序，最后按曲目编号升序
        if (b.averageScore !== a.averageScore) return b.averageScore - a.averageScore;
        if (b.ratingCount !== a.ratingCount) return b.ratingCount - a.ratingCount;
        return a.track_number - b.track_number;
      });

    // 步骤4：分页
    const paginatedSongs = sortedSongs.slice(skip, skip + Number(pageSize));
    const total = sortedSongs.length;

    res.json({
      code: 200,
      msg: '专辑内歌曲按评分排序成功',
      data: {
        songs: paginatedSongs,
        pagination: { page: Number(page), pageSize: Number(pageSize), total, totalPages: Math.ceil(total / pageSize) }
      }
    });
  } catch (err) {
    next(err);
  }
});

// ==================== 3. 全量歌曲按评分排序（跨专辑） ====================
router.get('/api/songs/sort-by-rating', async (req, res, next) => {
  try {
    const { page = 1, pageSize = 10 } = req.query;
    const skip = (page - 1) * pageSize;

    // 步骤1：获取所有歌曲
    const allSongs = await Song.find({}).select('id name_cn album_id duration');
    const songIds = allSongs.map(s => s.id);

    // 步骤2：聚合评分
    const ratingAgg = await Rating.aggregate([
      { $match: { resource_type: 'song', resource_id: { $in: songIds } } },
      { $group: {
        _id: '$resource_id',
        averageScore: { $avg: '$score' },
        ratingCount: { $sum: 1 }
      }},
      { $sort: { averageScore: -1, ratingCount: -1 } }
    ]);

    // 步骤3：合并+排序
    const sortedSongs = allSongs
      .map(song => {
        const rating = ratingAgg.find(r => r._id === song.id);
        return {
          ...song._doc,
          averageScore: rating ? parseFloat(rating.averageScore.toFixed(1)) : 0,
          ratingCount: rating ? rating.ratingCount : 0
        };
      })
      .sort((a, b) => {
        if (b.averageScore !== a.averageScore) return b.averageScore - a.averageScore;
        return b.ratingCount - a.ratingCount;
      });

    // 分页
    const paginatedSongs = sortedSongs.slice(skip, skip + Number(pageSize));
    const total = sortedSongs.length;

    res.json({
      code: 200,
      msg: '全量歌曲按评分排序成功',
      data: { songs: paginatedSongs, pagination: { page: Number(page), pageSize: Number(pageSize), total, totalPages: Math.ceil(total / pageSize) } }
    });
  } catch (err) {
    next(err);
  }
});

// ==================== 4. 全量单曲按评分排序 ====================
router.get('/api/singles/sort-by-rating', async (req, res, next) => {
  try {
    const { page = 1, pageSize = 10 } = req.query;
    const skip = (page - 1) * pageSize;

    // 步骤1：获取所有单曲
    const allSingles = await Single.find({}).select('id name_cn release_date description');
    const singleIds = allSingles.map(s => s.id);

    // 步骤2：聚合评分
    const ratingAgg = await Rating.aggregate([
      { $match: { resource_type: 'single', resource_id: { $in: singleIds } } },
      { $group: {
        _id: '$resource_id',
        averageScore: { $avg: '$score' },
        ratingCount: { $sum: 1 }
      }},
      { $sort: { averageScore: -1, ratingCount: -1 } }
    ]);

    // 步骤3：合并+排序
    const sortedSingles = allSingles
      .map(single => {
        const rating = ratingAgg.find(r => r._id === single.id);
        return {
          ...single._doc,
          averageScore: rating ? parseFloat(rating.averageScore.toFixed(1)) : 0,
          ratingCount: rating ? rating.ratingCount : 0
        };
      })
      .sort((a, b) => {
        if (b.averageScore !== a.averageScore) return b.averageScore - a.averageScore;
        return b.ratingCount - a.ratingCount;
      });

    // 分页
    const paginatedSingles = sortedSingles.slice(skip, skip + Number(pageSize));
    const total = sortedSingles.length;

    res.json({
      code: 200,
      msg: '全量单曲按评分排序成功',
      data: { singles: paginatedSingles, pagination: { page: Number(page), pageSize: Number(pageSize), total, totalPages: Math.ceil(total / pageSize) } }
    });
  } catch (err) {
    next(err);
  }
});

// ==================== 5. 错误处理中间件 ====================
const errorHandler = (err, req, res, next) => {
  err.statusCode = err.statusCode || 500;
  res.status(err.statusCode).json({
    code: err.statusCode,
    msg: process.env.NODE_ENV === 'development' ? err.message : '服务器错误',
    data: null
  });
};
router.use(errorHandler);

module.exports = router;