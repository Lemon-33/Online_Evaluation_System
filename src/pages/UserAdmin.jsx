import { useCallback, useEffect, useState } from 'react';
import { Typography, message } from 'antd';
import { apiRequest } from '../lib/cloudbase';
import { UserManagementTab } from './Backdoor';

// 员工信息维护（侧边栏入口 /user-admin）
// ------------------------------------------------------------
// 功能本体就是 /backdoor 里的「员工信息维护」Tab（UserManagementTab）——
// 同一个组件，没有复制代码；这里只负责把数据取回来喂给它。
//
// 权限：默认不授权给任何账号，所以本页对所有人不可见、也进不来。
//   想放开给谁 → 系统管理员在 /backdoor →「权限管理」页给该账号勾上
//   「员工信息维护」（数据存 permission 表），本人重新登录后即生效：
//     · 后端 requireUserAdmin 放行 /api/backdoor/users 的写接口
//     · 登录接口下发 canUserAdmin → 侧边栏菜单项出现、本页守卫放行
//
// ⚠️ 本页**只能修改已有员工，不能新建账号**（2026-10-19 起彻底取消新建功能）：
//     · 工号：仍**只**系统管理员能改；其它被授权账号改了会被后端拒绝
//     · 身份（admin_type）：只有系统管理员能改（2026-10-19 起撤销党总支书记的例外）；
//       其余被授权账号进来只读
//     · 新建账号需要先在注册白名单里登记好，再在搜索框里输入该工号加载进来修改
export default function UserAdmin() {
  const [users, setUsers] = useState([]);

  // 只拉员工名单（审核关系维护那份数据本页用不到，不重复请求）
  const reload = useCallback(async () => {
    try {
      const res = await apiRequest('/api/backdoor/users');
      setUsers(res?.data || []);
    } catch (e) {
      message.error(e.message || '加载员工名单失败');
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  return (
    <div>
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        员工信息维护
      </Typography.Title>
      <UserManagementTab users={users} reload={reload} />
    </div>
  );
}
