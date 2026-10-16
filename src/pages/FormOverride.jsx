import { Typography } from 'antd';
import FormOverridePanel from '../components/FormOverridePanel';

// 个人问卷维护（侧边栏入口 /form-override）
// ------------------------------------------------------------
// 功能本体就是 components/FormOverridePanel.jsx —— 与 /backdoor 里的
// 「个人问卷维护」Tab 是同一个组件，没有复制代码，也不需要重写。
//
// 权限：默认不授权给任何账号，所以本页对所有人不可见、也进不来。
//   想放开给谁 → 系统管理员在 /backdoor →「权限管理」页给该账号勾上
//   「个人问卷维护」（数据存 permission 表），本人重新登录后即生效：
//     · 后端 canUseTool(u, 'formOverride') 放行 /api/form-overrides/* 写接口
//     · 登录接口下发 canFormOverride → 侧边栏菜单项出现、本页路由守卫放行
export default function FormOverride() {
  return (
    <div>
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        个人问卷维护
      </Typography.Title>
      <FormOverridePanel />
    </div>
  );
}
