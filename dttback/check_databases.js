const mongoose = require('mongoose');

async function checkDatabases() {
  try {
    console.log('正在连接MongoDB...');
    await mongoose.connect('mongodb://localhost:27017');
    console.log('连接成功！');
    
    // 列出所有数据库
    const adminDb = mongoose.connection.db.admin();
    const databases = await adminDb.listDatabases();
    
    console.log('\n=== 可用数据库 ===');
    databases.databases.forEach(db => {
      console.log(`数据库: ${db.name} | 大小: ${(db.sizeOnDisk / 1024 / 1024).toFixed(2)} MB`);
    });
    
    // 检查dttback数据库的集合
    await mongoose.connection.useDb('dttback');
    const collections = await mongoose.connection.db.listCollections().toArray();
    
    console.log('\n=== dttback数据库中的集合 ===');
    if (collections.length === 0) {
      console.log('dttback数据库中没有集合');
    } else {
      collections.forEach(collection => {
        console.log(`集合: ${collection.name}`);
      });
    }
    
    await mongoose.disconnect();
  } catch (error) {
    console.error('错误:', error.message);
  }
}

checkDatabases();