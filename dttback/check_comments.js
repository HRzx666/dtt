const mongoose = require('mongoose');
const Comment = require('./models/Comment');

async function checkComments() {
  try {
    console.log('正在连接数据库...');
    await mongoose.connect('mongodb://localhost:27017/tao_zhe_official');
    console.log('数据库连接成功！');
    
    // 检查数据库中的评论总数
    const totalComments = await Comment.countDocuments();
    console.log(`\n数据库中共有 ${totalComments} 条评论`);
    
    // 查询最新的几条评论，包括parent_id字段
    const comments = await Comment.find()
      .select('_id parent_id resource_type resource_id content createdAt')
      .sort({ createdAt: -1 })
      .limit(10);
    
    console.log('\n=== 最近10条评论数据 ===');
    if (comments.length === 0) {
      console.log('数据库中没有评论数据');
    } else {
      comments.forEach((comment, index) => {
        console.log(`\n${index + 1}. 评论ID: ${comment._id}`);
        console.log(`   资源类型: ${comment.resource_type}`);
        console.log(`   资源ID: ${comment.resource_id}`);
        console.log(`   parent_id: ${comment.parent_id}`);
        console.log(`   parent_id类型: ${typeof comment.parent_id}`);
        console.log(`   内容: ${comment.content.substring(0, 50)}...`);
        console.log(`   创建时间: ${comment.createdAt}`);
      });
    }
    
    // 特别检查parent_id不为null的评论
    const replies = await Comment.find({ parent_id: { $ne: null } })
      .select('_id parent_id content createdAt')
      .populate('parent_id', '_id content')
      .limit(5);
    
    console.log('\n=== 子评论数据（parent_id不为null） ===');
    if (replies.length === 0) {
      console.log('没有找到子评论（parent_id不为null的评论）');
    } else {
      replies.forEach((reply, index) => {
        console.log(`\n${index + 1}. 子评论ID: ${reply._id}`);
        console.log(`   parent_id: ${reply.parent_id}`);
        console.log(`   父评论内容: ${reply.parent_id ? reply.parent_id.content : '无'}`);
        console.log(`   子评论内容: ${reply.content.substring(0, 50)}...`);
      });
    }
    
    // 检查parent_id为null的评论数量
    const nullParentComments = await Comment.countDocuments({ parent_id: null });
    console.log(`\n=== 统计信息 ===`);
    console.log(`主评论数量（parent_id为null）: ${nullParentComments}`);
    console.log(`子评论数量（parent_id不为null）: ${totalComments - nullParentComments}`);
    
    await mongoose.disconnect();
    console.log('\n数据库连接已关闭');
  } catch (error) {
    console.error('数据库操作错误:', error.message);
    console.error('错误堆栈:', error.stack);
  }
}

checkComments();