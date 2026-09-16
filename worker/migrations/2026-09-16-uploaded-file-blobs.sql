-- 没有 R2 绑定的部署把附件正文直接存进 D1；补齐列，使纯 D1 安装也能上传与下载附件。
ALTER TABLE uploaded_files ADD COLUMN data BLOB;
