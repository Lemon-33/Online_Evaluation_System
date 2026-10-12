import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ConfigProvider, App as AntdApp } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import App from './App';
import { AuthProvider } from './context/AuthContext';
import { initCloudBase, isMockMode } from './lib/cloudbase';
import 'antd/dist/reset.css';
import './styles.css';

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