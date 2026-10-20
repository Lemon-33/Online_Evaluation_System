import { Grid } from 'antd';

const { useBreakpoint } = Grid;

// 窄屏（手机）判定：视口宽度 < 768px（antd 的 md 断点以下，即 xs / sm）
// ---------------------------------------------------------------------------
// 只按**视口宽度**判断，不做 UA 嗅探 —— 需求是「电脑上保持原样、手机上优化布局」，
// 这本质是宽度问题而非设备型号问题；用 UA 会把 iPad、电脑窄窗口误判成手机。
//
// 与 antd Row/Col 的 xs / sm / lg 断点是同一套口径（xs<576 sm≥576 md≥768 lg≥992），
// 窗口缩放、手机横竖屏切换都会实时重渲染。
//
// ⚠️ 必须写成 `screens.md === false`，不能写 `!screens.md`：
//    首帧 useBreakpoint() 可能返回空对象，`!undefined === true` 会让桌面端
//    先渲染一帧手机布局（闪一下），再跳回桌面布局。
export function useIsMobile() {
  const screens = useBreakpoint();
  return screens.md === false;
}

export default useIsMobile;
