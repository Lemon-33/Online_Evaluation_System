import { useCallback, useEffect, useState } from 'react';
import { Typography, message } from 'antd';
import { apiRequest } from '../lib/cloudbase';
import { ReviewAssignmentsTab } from './Backdoor';

// 审核关系维护（侧边栏入口 /review-assign）
// ------------------------------------------------------------
// 功能本体就是 /backdoor 里的「审核关系维护」Tab（ReviewAssignmentsTab）——
// 同一个组件，没有复制代码；这里只负责把数据取回来喂给它。
//
// 权限：默认不授权给任何账号，所以本页对所有人不可见、也进不来。
//   想放开给谁 → 系统管理员在 /backdoor →「权限管理」页给该账号勾上
//   「审核关系维护」（数据存 permission 表），本人重新登录后即生效：
//     · 后端 requireReviewAssign 放行 /api/backdoor/assignments 的读写接口
//     · 登录接口下发 canReviewAssign → 侧边栏菜单项出现、本页守卫放行
export default function ReviewAssign() {
  const [users, setUsers] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [loading, setLoading] = useState(false);

  // 本页需要两份数据：员工名单（选人用）+ 现有审核关系
  // 与 /backdoor 的 reload 逻辑一致
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [u, a] = await Promise.all([
        apiRequest('/api/backdoor/users'),
        apiRequest('/api/backdoor/assignments'),
      ]);
      setUsers(u?.data || []);
      setAssignments(a?.data || []);
    } catch (e) {
      message.error(e.message || '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  return (
    <div>
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        审核关系维护
      </Typography.Title>
      <ReviewAssignmentsTab
        users={users}
        assignments={assignments}
        loading={loading}
        reload={reload}
      />
    </div>
  );
}
