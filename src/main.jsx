import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ConfigProvider, App as AntdApp } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';
import App from './App';
import { AuthProvider } from './context/AuthContext';
import { initCloudBase, isMockMode } from './lib/cloudbase';
import 'antd/dist/reset.css';
import './styles.css';

// dayjs 全局中文化：DatePicker / Calendar 的月份、星期名称依赖 dayjs locale
// （ConfigProvider 的 antd locale 只覆盖组件文案，不覆盖日期文案）
dayjs.locale('zh-cn');

async function bootstrap() {
  // 启动时尝试初始化 CloudBase（mock 模式下不阻塞）
  try {
    await initCloudBase();
  } catch (e) {
    console.error('[initCloudBase] 失败：', e);
  }

  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <ConfigProvider
        locale={zhCN}
        theme={{
          token: {
            colorPrimary: '#b71c1c',
            borderRadius: 6,
          },
        }}
      >
        <AntdApp>
          <BrowserRouter>
            <AuthProvider>
              <App mockMode={isMockMode()} />
            </AuthProvider>
          </BrowserRouter>
        </AntdApp>
      </ConfigProvider>
    </React.StrictMode>
  );
}

bootstrap();